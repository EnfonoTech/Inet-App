import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import PicReportsPanel from "../../components/PicReportsPanel";
import { pmApi } from "../../services/api";
import DateRangePicker from "../../components/DateRangePicker";
import SearchableSelect from "../../components/SearchableSelect";
import useFilterOptions from "../../hooks/useFilterOptions";

const fmtMoney = new Intl.NumberFormat("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

const money = (v) => fmtMoney.format(Number(v) || 0);
const count = (v) => fmtInt.format(Number(v) || 0);

/**
 * PIC Overview — the PM's read-only window onto the PIC side.
 *
 * A PM does not work POIDs; they want to know where the money is. So this
 * pulls the three PIC pages that answer that — the canned reports, the
 * invoicing roll-up and the subcon payout roll-up — into one page, in that
 * order, and links out to the live pages for anything actionable.
 *
 * The reports come from the SAME component the PIC's own Reports page renders
 * (PicReportsPanel), so the two can never disagree. The two roll-ups call the
 * same endpoints their own pages do and are deliberately read-only here: no
 * filters beyond what each section needs, no editing, no row drill-down.
 */

function Section({ title, subtitle, to, linkLabel, children }) {
  return (
    <div style={{ padding: "0 16px 18px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, margin: "6px 0 10px" }}>
        <h2 style={{ margin: 0, fontSize: "0.98rem", fontWeight: 800, color: "#0f172a", letterSpacing: "-0.2px" }}>
          {title}
        </h2>
        {subtitle && <span style={{ fontSize: "0.78rem", color: "#64748b" }}>{subtitle}</span>}
        {to && (
          <Link to={to} style={{ marginLeft: "auto", fontSize: "0.78rem", fontWeight: 600, color: "#2563eb", textDecoration: "none", whiteSpace: "nowrap" }}>
            {linkLabel} →
          </Link>
        )}
      </div>
      {children}
    </div>
  );
}

function Card({ children }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 2px rgba(15,23,42,0.04)" }}>
      {children}
    </div>
  );
}

/** One horizontally scrolling table — never let a wide roll-up widen the page. */
function Scroller({ children }) {
  return <div style={{ overflowX: "auto" }}>{children}</div>;
}

const th = { padding: "8px 14px", textAlign: "left", borderBottom: "1px solid #e2e8f0", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.04em", color: "#475569", whiteSpace: "nowrap" };
const thR = { ...th, textAlign: "right" };
const td = { padding: "7px 14px", borderBottom: "1px solid #f1f5f9", fontSize: "0.83rem", whiteSpace: "nowrap" };
const tdR = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };
const tfR = { ...tdR, fontWeight: 800, borderTop: "2px solid #e2e8f0", borderBottom: "none", background: "#f8fafc" };
const tfL = { ...td, fontWeight: 800, borderTop: "2px solid #e2e8f0", borderBottom: "none", background: "#f8fafc" };

export default function PICOverview() {
  const [invoicing, setInvoicing] = useState(null);
  const [payout, setPayout] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // One filter bar for the whole page. Both roll-ups accept project_code and
  // scope their dates on the SAME field (ms1_applied_date), so a shared range
  // means one thing across them; the reports panel applies it to whichever
  // date each report is actually about.
  const [project, setProject] = useState([]);
  const [range, setRange] = useState({ from: "", to: "" });
  const { options: dispOpts } = useFilterOptions("PO Dispatch", ["project_code"]);
  const projectOptions = dispOpts.project_code || [];
  const scoped = !!(project.length || range.from || range.to);

  const reload = useCallback(() => setRefreshKey((k) => k + 1), []);

  const portal = useMemo(() => {
    const p = {};
    if (project.length) p.project_code = project;
    if (range.from) p.from_date = range.from;
    if (range.to) p.to_date = range.to;
    return p;
  }, [project, range.from, range.to]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    // One fetch each, in parallel — these are aggregates, not row lists, so
    // there is no row limit to honour and nothing to paginate.
    Promise.all([
      pmApi.picInvoicingSummary(portal).catch((e) => ({ __err: e?.message || "failed" })),
      pmApi.subconPayoutSummary(portal).catch((e) => ({ __err: e?.message || "failed" })),
    ]).then(([inv, pay]) => {
      if (cancelled) return;
      const failed = [inv?.__err && "invoicing summary", pay?.__err && "subcon payout"].filter(Boolean);
      setInvoicing(inv?.__err ? null : inv);
      setPayout(pay?.__err ? null : pay);
      setError(failed.length ? `Could not load ${failed.join(" and ")}.` : null);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [refreshKey, portal]);

  const top = invoicing?.top || {};
  const payTop = payout?.top || {};

  // Unbilled is not in the `top` block — it is per-status, so sum both
  // milestone tables the same way the Invoicing Summary page's footer does.
  const unbilled = useMemo(() => {
    const rows = [...(invoicing?.ms1_rows || []), ...(invoicing?.ms2_rows || [])];
    return rows.reduce((a, r) => a + (Number(r.unbilled) || 0), 0);
  }, [invoicing]);

  const kpis = [
    { label: "Invoiced", value: money(top.grand_total), tone: "good", hint: "MS1 + MS2 invoiced, excl. VAT" },
    { label: "INET", value: money(top.inet_total), tone: "info", hint: "INET's share of invoiced value" },
    { label: "Subcon", value: money(top.subcon_total), tone: "default", hint: "Subcontractors' share of invoiced value" },
    { label: "Unbilled", value: money(unbilled), tone: "warn", hint: "Accepted value not yet invoiced" },
    { label: "Payout", value: money(payTop.payout_total), tone: "default", hint: "Owed to subcontractors, excl. VAT" },
    { label: "Not ordered", value: money(payTop.not_ordered_total), tone: "warn", hint: "Payout with no subcon PO raised yet" },
  ];

  const tones = {
    good: { fg: "#15803d", bd: "#bbf7d0", bg: "#f0fdf4" },
    warn: { fg: "#c2410c", bd: "#fed7aa", bg: "#fff7ed" },
    info: { fg: "#0369a1", bd: "#bae6fd", bg: "#f0f9ff" },
    default: { fg: "#0f172a", bd: "#e2e8f0", bg: "#fff" },
  };

  const msRows = (rows) => (rows || []).filter((r) => Number(r.row_count) > 0);
  const sumOf = (rows, key) => (rows || []).reduce((a, r) => a + (Number(r[key]) || 0), 0);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">PIC Overview</h1>
          <div className="page-subtitle">Invoicing, payout and pipeline</div>
        </div>
        <div className="page-actions">
          <button type="button" className="btn-secondary" onClick={reload} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      <div className="toolbar">
        <SearchableSelect
          allowBlank multi value={project} onChange={setProject}
          options={projectOptions} placeholder="All Projects" minWidth={200}
        />
        <DateRangePicker value={range} onChange={({ from, to }) => setRange({ from, to })} />
        {scoped && (
          <button type="button" className="btn-secondary" style={{ fontSize: "0.8rem" }}
            onClick={() => { setProject([]); setRange({ from: "", to: "" }); }}>
            Clear
          </button>
        )}
      </div>

      {error && (
        <div className="notice error" style={{ margin: "0 16px 8px" }}><span>!</span> {error}</div>
      )}

      {/* Where the money is, before any of the detail below. */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "0 16px 6px" }}>
        <span style={{ fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#475569" }}>
          Position
        </span>
        <span style={{ fontSize: "0.72rem", color: "#94a3b8" }}>
          {scoped
            ? "matching the filters above · dates on MS1 applied date"
            : "all time — narrow it with the filters above"}
        </span>
      </div>
      <div style={{
        display: "flex", flexWrap: "wrap", gap: 10, padding: "0 16px 16px",
        opacity: loading && invoicing ? 0.55 : 1, transition: "opacity 120ms ease",
      }}>
        {kpis.map((k) => {
          const t = tones[k.tone] || tones.default;
          return (
            <div key={k.label} title={k.hint}
              style={{
                flex: "1 1 150px", minWidth: 150, padding: "10px 14px",
                border: `1px solid ${t.bd}`, background: t.bg, borderRadius: 10,
              }}>
              <div style={{ fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase", color: "#64748b" }}>
                {k.label}
              </div>
              <div style={{ fontSize: "1.12rem", fontWeight: 800, letterSpacing: "-0.3px", color: t.fg, fontVariantNumeric: "tabular-nums", marginTop: 2 }}>
                {loading && !invoicing ? "…" : k.value}
              </div>
            </div>
          );
        })}
      </div>

      <Section title="PIC Reports" subtitle="the same five reports the PIC works from" to="/pic-reports" linkLabel="Open PIC Reports">
        <div style={{ margin: "0 -16px" }}>
          <PicReportsPanel project={project} range={range} />
        </div>
      </Section>

      <Section title="Invoicing Summary" subtitle="INET / Subcon split by milestone status" to="/pic-invoicing-summary" linkLabel="Open Invoicing Summary">
        <Card>
          <Scroller>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>Milestone / Status</th>
                  <th style={thR}>Lines</th>
                  <th style={thR}>PO Amount</th>
                  <th style={thR}>Invoiced</th>
                  <th style={thR}>Unbilled</th>
                  <th style={thR}>INET</th>
                  <th style={thR}>Subcon</th>
                </tr>
              </thead>
              {[["MS1", invoicing?.ms1_rows], ["MS2", invoicing?.ms2_rows]].map(([ms, rows]) => {
                const shown = msRows(rows);
                if (!shown.length) return null;
                return (
                  <tbody key={ms}>
                    <tr>
                      <td colSpan={7} style={{ ...td, background: "#f1f5f9", fontWeight: 800, fontSize: "0.74rem", letterSpacing: "0.05em", color: "#334155" }}>
                        {ms}
                      </td>
                    </tr>
                    {shown.map((r) => (
                      <tr key={`${ms}-${r.pic_status}`}>
                        <td style={td}>{r.pic_status || "—"}</td>
                        <td style={tdR}>{count(r.row_count)}</td>
                        <td style={tdR}>{money(r.po_amount)}</td>
                        <td style={tdR}>{money(r.invoiced)}</td>
                        <td style={{ ...tdR, color: Number(r.unbilled) ? "#c2410c" : undefined }}>{money(r.unbilled)}</td>
                        <td style={tdR}>{money(r.inet_amt)}</td>
                        <td style={tdR}>{money(r.subcon_amt)}</td>
                      </tr>
                    ))}
                    <tr>
                      <td style={tfL}>{ms} total</td>
                      <td style={tfR}>{count(sumOf(shown, "row_count"))}</td>
                      <td style={tfR}>{money(sumOf(shown, "po_amount"))}</td>
                      <td style={tfR}>{money(sumOf(shown, "invoiced"))}</td>
                      <td style={tfR}>{money(sumOf(shown, "unbilled"))}</td>
                      <td style={tfR}>{money(sumOf(shown, "inet_amt"))}</td>
                      <td style={tfR}>{money(sumOf(shown, "subcon_amt"))}</td>
                    </tr>
                  </tbody>
                );
              })}
            </table>
          </Scroller>
          {!loading && !invoicing && (
            <div style={{ padding: 28, textAlign: "center", color: "#94a3b8", fontSize: "0.84rem" }}>No invoicing data.</div>
          )}
        </Card>
      </Section>

      <Section title="Subcon Payout Summary" subtitle="what is owed out, by stage and by supplier" to="/pic-subcon-payout" linkLabel="Open Subcon Payout">
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))" }}>
          <Card>
            <div style={{ padding: "10px 14px", borderBottom: "1px solid #e2e8f0", fontSize: "0.78rem", fontWeight: 700, color: "#334155" }}>
              By milestone status
            </div>
            <Scroller>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={th}>Status</th>
                    <th style={thR}>Lines</th>
                    <th style={thR}>Payout</th>
                    <th style={thR}>VAT</th>
                  </tr>
                </thead>
                <tbody>
                  {(payout?.by_status || []).map((r) => (
                    <tr key={r.status}>
                      <td style={td}>{r.status || "—"}</td>
                      <td style={tdR}>{count(r.row_count)}</td>
                      <td style={tdR}>{money(r.payout)}</td>
                      <td style={tdR}>{money(r.vat)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td style={tfL}>Total</td>
                    <td style={tfR}>{count(sumOf(payout?.by_status, "row_count"))}</td>
                    <td style={tfR}>{money(sumOf(payout?.by_status, "payout"))}</td>
                    <td style={tfR}>{money(sumOf(payout?.by_status, "vat"))}</td>
                  </tr>
                </tbody>
              </table>
            </Scroller>
          </Card>

          <Card>
            <div style={{ padding: "10px 14px", borderBottom: "1px solid #e2e8f0", fontSize: "0.78rem", fontWeight: 700, color: "#334155" }}>
              By supplier
            </div>
            <Scroller>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={th}>Supplier</th>
                    <th style={thR}>Lines</th>
                    <th style={thR}>Payout</th>
                    <th style={thR}>INET</th>
                  </tr>
                </thead>
                <tbody>
                  {(payout?.by_supplier || []).map((r, i) => (
                    <tr key={`${r.subcontract || r.supplier}-${i}`}>
                      <td style={{ ...td, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis" }} title={r.subcontract || r.supplier || ""}>
                        {r.supplier || "—"}
                      </td>
                      <td style={tdR}>{count(r.row_count)}</td>
                      <td style={tdR}>{money(r.payout)}</td>
                      <td style={tdR}>{money(r.inet_amount)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td style={tfL}>Total</td>
                    <td style={tfR}>{count(sumOf(payout?.by_supplier, "row_count"))}</td>
                    <td style={tfR}>{money(sumOf(payout?.by_supplier, "payout"))}</td>
                    <td style={tfR}>{money(sumOf(payout?.by_supplier, "inet_amount"))}</td>
                  </tr>
                </tbody>
              </table>
            </Scroller>
          </Card>
        </div>
        {!loading && !payout && (
          <div style={{ padding: 28, textAlign: "center", color: "#94a3b8", fontSize: "0.84rem" }}>No payout data.</div>
        )}
      </Section>
    </div>
  );
}
