import { useEffect, useRef, useState } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import DashboardSwitcher from "../../components/DashboardSwitcher";
import TrendLineChart, { compactSar } from "../../components/TrendLineChart";
import { MonthRangeFilter, MonthsBackFilter } from "../../components/ChartFilters";
import ChartActions from "../../components/ChartActions";
import { pmApi } from "../../services/api";

const fmt = new Intl.NumberFormat("en-US");

/* Validated on the white panel surface (lightness band, chroma floor,
   all-pairs CVD separation, normal-vision floor, 3:1 contrast). Do not
   substitute a lighter amber — #F57C00 fails contrast at 2.7:1. */
const C = {
  blue: "#1565C0",   // PO published value / INET
  amber: "#E06C00",  // Invoiced value / Subcon
  teal: "#0D9488",   // Monthly invoicing
  green: "#2E7D32",
  gray: "#64748b",
};

const sar = (v) => `SAR ${fmt.format(Math.round(Number(v) || 0))}`;

/* Matches CommandDashboard's fmtTimestamp so both headers read alike. */
function fmtTimestamp(ts) {
  if (!ts) return "";
  const d = new Date(String(ts).replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return String(ts);
  return `${d.getDate()} ${d.toLocaleString("en-US", { month: "short" })} ${d.getFullYear()} · ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const PO_SERIES = [
  { key: "po_value", name: "PO published value (SAR)", color: C.blue },
  { key: "invoiced", name: "Invoiced value (SAR)", color: C.amber, dashed: true },
];
const INV_SERIES = [
  { key: "invoiced", name: "Invoiced (SAR)", color: C.teal, showLabels: true },
];

function Panel({ title, eyebrow, right, children, note, innerRef, fill }) {
  return (
    <div className="nd-panel" ref={innerRef} style={fill ? { display: "flex", flexDirection: "column", height: "100%" } : undefined}>
      <div className="nd-panel-header tinted" style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div>
          {eyebrow && <div className="nd-panel-eyebrow">{eyebrow}</div>}
          <h3>{title}</h3>
        </div>
        {right}
      </div>
      <div className="nd-panel-body" style={fill ? { flex: 1, display: "flex", flexDirection: "column" } : undefined}>
        {children}
        {note && <div className="nd-panel-note">{note}</div>}
      </div>
    </div>
  );
}

function Empty({ children }) {
  return <div style={{ padding: "22px 4px", textAlign: "center", color: "#94a3b8", fontSize: 12 }}>{children}</div>;
}

/** label · value row with an optional share bar — fills the split panel. */
function SplitRow({ label, value, pct, color }) {
  return (
    <div style={{ marginBottom: 9 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 3 }}>
        <span style={{ width: 8, height: 8, borderRadius: 2, background: color, flex: "0 0 auto" }} />
        <span style={{ fontSize: 11.5, color: "#334155", fontWeight: 600 }}>{label}</span>
        <span style={{ marginLeft: "auto", fontSize: 11.5, fontWeight: 700, color: "#334155", fontVariantNumeric: "tabular-nums" }}>
          {sar(value)}
        </span>
        <span style={{ fontSize: 10, color: "#94a3b8", width: 34, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
          {Math.round(pct)}%
        </span>
      </div>
      <div className="nd-progress thin">
        <div className="nd-progress-bar" style={{ width: `${Math.min(pct, 100)}%`, background: color }} />
      </div>
    </div>
  );
}

export default function CommercialDashboard() {
  const [data, setData] = useState(null);
  const [loadErr, setLoadErr] = useState(null);

  // Each chart owns its own filter — changing one never re-scopes the other.
  const [poRange, setPoRange] = useState({ from: "", to: "" });  // "" = all time
  const [poTrend, setPoTrend] = useState(null);
  const [poLoading, setPoLoading] = useState(true);
  const poPanel = useRef(null);

  const [invMonths, setInvMonths] = useState(12);                 // 0 = all time
  const [invTrend, setInvTrend] = useState(null);
  const [invLoading, setInvLoading] = useState(true);
  const invPanel = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await pmApi.getCommercialDashboard();
        if (!cancelled) { setData(res); setLoadErr(null); }
      } catch (e) {
        if (!cancelled) setLoadErr(e?.message || "Failed to load commercial data");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setPoLoading(true);
    (async () => {
      try {
        const res = await pmApi.getPoVsInvoiceTrend({ from_date: poRange.from, to_date: poRange.to });
        if (!cancelled) setPoTrend(res);
      } catch { if (!cancelled) setPoTrend(null); }
      finally { if (!cancelled) setPoLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [poRange.from, poRange.to]);

  useEffect(() => {
    let cancelled = false;
    setInvLoading(true);
    (async () => {
      try {
        const res = await pmApi.getPoVsInvoiceTrend({ months: invMonths });
        if (!cancelled) setInvTrend(res);
      } catch { if (!cancelled) setInvTrend(null); }
      finally { if (!cancelled) setInvLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [invMonths]);

  if (loadErr) {
    return (
      <div className="nd-dashboard">
        <DashboardSwitcher />
        <div className="notice error" style={{ margin: "24px 0" }}><span>⚠</span> {loadErr}</div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="nd-dashboard">
        <DashboardSwitcher />
        <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Loading…</div>
      </div>
    );
  }

  const { kpi = {}, order_book = {}, inet_subcon = {}, per_im = [], per_project = [], per_subcontract = [] } = data;

  /* Revenue split — PIC's INET-vs-Subcon amounts, not the operational
     `inet_achieved` / `sub_revenue` this page used to read (those are the
     current month's Work Done, which rendered as a few hundred SAR). */
  const inetTotal = inet_subcon.inet_total || 0;
  const subTotal = inet_subcon.subcon_total || 0;
  const splitTotal = inetTotal + subTotal;
  const donut = [
    { n: "INET", v: inetTotal, c: C.blue },
    { n: "Subcon", v: subTotal, c: C.amber },
  ].filter((d) => d.v > 0);

  const msRows = [
    { label: "MS1 — INET", v: inet_subcon.inet_ms1 || 0, c: C.blue },
    { label: "MS1 — Subcon", v: inet_subcon.subcon_ms1 || 0, c: C.amber },
    { label: "MS2 — INET", v: inet_subcon.inet_ms2 || 0, c: C.blue },
    { label: "MS2 — Subcon", v: inet_subcon.subcon_ms2 || 0, c: C.amber },
  ];
  const msMax = Math.max(...msRows.map((r) => r.v), 1);

  const projMax = Math.max(...per_project.map((p) => (p.invoiced || 0) + (p.backlog || 0)), 1);
  const subMax = Math.max(...per_subcontract.map((s) => (s.inet_margin || 0) + (s.payout || 0)), 1);

  /* Invoiced = milestone reached "Commercial Invoice Submitted" (raised) or
     "Commercial Invoice Closed" (raised + paid) — the FULL milestone amount
     either way, since a milestone is never partly billed. Paid counts only
     the Closed half. Sub-lines describe the same money as their headline;
     line counts are deliberately absent (a count of lines never matched the
     population behind a money figure). */
  const kpis = [
    { l: "Total Invoiced", v: sar(kpi.total_invoiced), a: C.green,
      sub: `MS1 ${compactSar(kpi.invoiced_ms1)} · MS2 ${compactSar(kpi.invoiced_ms2)}` },
    { l: "Payment Received", v: sar(kpi.paid), a: C.teal, cl: C.teal,
      sub: `${kpi.collected_pct ?? 0}% of invoiced · invoice closed` },
    { l: "Backlog", v: sar(kpi.backlog), a: C.amber, cl: C.amber,
      sub: "milestone value not yet invoiced" },
    { l: "Billed", v: `${kpi.billed_pct ?? 0}%`,
      a: (kpi.billed_pct ?? 0) >= 60 ? C.green : C.amber,
      cl: (kpi.billed_pct ?? 0) >= 60 ? C.green : C.amber,
      sub: `of ${compactSar(kpi.booked_value)} booked milestone value` },
    { l: "Open Order Book", v: sar(order_book.open_value), a: C.blue, cl: C.blue,
      sub: "PO lines not closed or cancelled" },
  ];

  const poRangeLabel = poTrend?.range?.from_month
    ? `${poTrend.range.from_month} → ${poTrend.range.to_month || "now"}`
    : "all time";
  const invTitle = invMonths ? `Monthly Invoicing — Last ${invMonths} Months` : "Monthly Invoicing — All Time";

  return (
    <div className="nd-dashboard">
      <DashboardSwitcher />
      {/* Same header as the Command Dashboard (client-approved): centred
          title + live "last updated" line, flanked by equal spacers. */}
      <div className="dash-header" style={{ display: "flex", alignItems: "center", padding: "12px 20px", marginBottom: 14 }}>
        <div style={{ flex: 1 }} />
        <div style={{ textAlign: "center" }}>
          <h1 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 800, letterSpacing: "-0.2px" }}>
            Commercial Dashboard
          </h1>
          <div className="subtitle" style={{ justifyContent: "center", marginTop: 3 }}>
            <span className="live-dot" />
            <span className="dash-timestamp">
              Last updated: {data.last_updated ? fmtTimestamp(data.last_updated) : "—"}
            </span>
          </div>
        </div>
        <div style={{ flex: 1, display: "flex", justifyContent: "flex-end" }}>
          <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#64748b", whiteSpace: "nowrap" }}>
            Billed <span style={{ color: C.green }}>{kpi.billed_pct ?? 0}%</span>
            {"  ·  "}Collected <span style={{ color: C.teal }}>{kpi.collected_pct ?? 0}%</span>
          </span>
        </div>
      </div>

      <div className="nd-kpi-row">
        {kpis.map((k) => (
          <div className="nd-kpi-card accent" key={k.l} style={{ "--kpi-accent": k.a }}>
            <div className="nd-kpi-label">{k.l}</div>
            <div className="nd-kpi-value" style={k.cl ? { color: k.cl } : {}}>{k.v}</div>
            {k.sub && <div className="nd-kpi-sub">{k.sub}</div>}
          </div>
        ))}
      </div>

      {/* ── Chart 1 — trailing-span filter + export toolbar ──────────── */}
      <div style={{ marginBottom: 10 }}>
        <Panel
          innerRef={poPanel}
          eyebrow="Order to cash"
          title="PO Published Value vs Invoiced Value"
          right={
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              {poTrend?.totals && (
                <span style={{ fontSize: 11, fontWeight: 700, color: C.gray }}>
                  Conversion <span style={{ color: C.green }}>{poTrend.totals.conversion_pct}%</span>
                </span>
              )}
              <span className="nd-chart-filter">
                <MonthRangeFilter value={poRange} onChange={setPoRange} />
              </span>
              <ChartActions
                panelRef={poPanel}
                title="PO Published Value vs Invoiced Value"
                subtitle={`INet Telecom · ${poRangeLabel} · SAR`}
                series={PO_SERIES}
                data={poTrend?.series || []}
              />
            </div>
          }
          note={poTrend?.po_date_basis && (
            <>PO month = publish date where recorded ({fmt.format(poTrend.po_date_basis.publish_date)} lines), otherwise PO start date ({fmt.format(poTrend.po_date_basis.start_date)} lines).
            Invoiced = full MS1/MS2 amount for milestones at Commercial Invoice Submitted or Closed, placed on their invoicing month.
            {poTrend?.undated_invoiced > 0 && <> A further {sar(poTrend.undated_invoiced)} is invoiced but has no invoicing month recorded, so it cannot be placed on any month here.</>}</>
          )}
        >
          {poLoading && !poTrend ? (
            <div className="nd-chart-h340" style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontSize: 12 }}>Loading…</div>
          ) : (
            <TrendLineChart height={340} data={poTrend?.series || []} series={PO_SERIES} area />
          )}
        </Panel>
      </div>

      {/* ── Chart 2 — trailing-window filter + export toolbar ────────── */}
      <div style={{ marginBottom: 10 }}>
        <Panel
          innerRef={invPanel}
          eyebrow="Cash flow trend"
          title={invTitle}
          right={
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span className="nd-chart-filter">
                <MonthsBackFilter value={invMonths} onChange={setInvMonths} />
              </span>
              <ChartActions
                panelRef={invPanel}
                title={invTitle}
                subtitle="INet Telecom · MS1 + MS2 invoiced by invoicing month · SAR"
                series={INV_SERIES}
                data={invTrend?.series || []}
              />
            </div>
          }
          note={<>Full MS1 + MS2 milestone amount for milestones at Commercial Invoice Submitted (raised) or Closed (raised + paid), on their invoicing month.
            Recent months reflect PIC data entry to date, so the tail understates until invoicing months are recorded.
            {invTrend?.undated_invoiced > 0 && <> {sar(invTrend.undated_invoiced)} invoiced has no invoicing month and is excluded from every bar.</>}</>}
        >
          {invLoading && !invTrend ? (
            <div className="nd-chart-h300" style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontSize: 12 }}>Loading…</div>
          ) : (
            <TrendLineChart height={300} data={invTrend?.series || []} series={INV_SERIES} showYAxis={false} area />
          )}
        </Panel>
      </div>

      <div className="nd-grid col2 stretch">
        <Panel
          fill
          eyebrow="Margin"
          title="Revenue Split — INET vs Subcon"
          note="MS1 + MS2 amounts apportioned by each line's subcontract margin / payout percentage."
        >
          {donut.length === 0 ? <Empty>No invoiced amounts yet.</Empty> : (
            <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <div style={{ width: 168, height: 168, flex: "0 0 auto", position: "relative" }}>
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie data={donut} dataKey="v" nameKey="n" innerRadius={54} outerRadius={80} paddingAngle={2} stroke="#fff" strokeWidth={2}>
                        {donut.map((d) => <Cell key={d.n} fill={d.c} />)}
                      </Pie>
                      <Tooltip formatter={(v, n) => [sar(v), n]} contentStyle={{ fontSize: 11, borderRadius: 6, border: "1px solid #e2e8f0" }} />
                    </PieChart>
                  </ResponsiveContainer>
                  {/* Hero number in the hole — the panel's single headline */}
                  <div style={{
                    position: "absolute", inset: 0, display: "flex", flexDirection: "column",
                    alignItems: "center", justifyContent: "center", pointerEvents: "none",
                  }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", fontFamily: '"JetBrains Mono", ui-monospace, monospace' }}>
                      {compactSar(splitTotal)}
                    </div>
                    <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: "0.06em", color: "#94a3b8", textTransform: "uppercase" }}>Total</div>
                  </div>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <SplitRow label="INET margin" value={inetTotal} pct={splitTotal ? (inetTotal / splitTotal) * 100 : 0} color={C.blue} />
                  <SplitRow label="Subcon payout" value={subTotal} pct={splitTotal ? (subTotal / splitTotal) * 100 : 0} color={C.amber} />
                </div>
              </div>
              <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid #f1f5f9", flex: 1 }}>
                <div className="nd-panel-eyebrow" style={{ marginBottom: 7 }}>By milestone</div>
                {msRows.map((r) => (
                  <div key={r.label} style={{ marginBottom: 7 }}>
                    <div className="nd-row-xs">
                      <span style={{ fontSize: 11, color: "#334155" }}>{r.label}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#334155", fontVariantNumeric: "tabular-nums" }}>{sar(r.v)}</span>
                    </div>
                    <div className="nd-progress thin">
                      <div className="nd-progress-bar" style={{ width: `${(r.v / msMax) * 100}%`, background: r.c }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Panel>

        <Panel
          fill
          eyebrow="Delivery partners"
          title="Top Subcontracts by Invoiced Value"
          note="Subcontractor resolved the way PIC resolves it: the POID's own contract, else the rollout-plan team's subcontractor, else the backend team's. Payout / INET margin use each Subcontract Master's percentages."
        >
          {per_subcontract.length === 0 ? <Empty>No subcontracts linked yet.</Empty> : (
            <div>
              {per_subcontract.map((s) => {
                const isInet = String(s.type).toUpperCase() === "INET";
                return (
                  <div key={s.sub_key} className="nd-sub-row">
                    <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                      <span style={{
                        flex: "0 0 auto", fontSize: 8.5, fontWeight: 800, letterSpacing: "0.05em",
                        padding: "2px 5px", borderRadius: 4,
                        background: isInet ? "#e8f0fe" : "#fdf0e3",
                        color: isInet ? C.blue : C.amber,
                      }}>{isInet ? "INET" : "SUB"}</span>
                      <span style={{
                        fontSize: 11.5, fontWeight: 600, color: "#334155",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }} title={s.subcontractor_name}>{s.subcontractor_name}</span>
                      <span style={{ marginLeft: "auto", flex: "0 0 auto", fontSize: 11.5, fontWeight: 700, color: "#334155", fontVariantNumeric: "tabular-nums" }}>
                        {sar(s.invoiced)}
                      </span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                      <div className="nd-splitbar">
                        <span style={{ width: `${((s.inet_margin || 0) / subMax) * 100}%`, background: C.blue }} />
                        <span style={{ width: `${((s.payout || 0) / subMax) * 100}%`, background: C.amber }} />
                      </div>
                      <span style={{ flex: "0 0 auto", fontSize: 10, color: "#94a3b8", fontVariantNumeric: "tabular-nums" }}>
                        {fmt.format(s.line_count || 0)} ln
                        {!isInet && <> · payout {Math.round(s.payout_pct || 0)}%</>}
                      </span>
                    </div>
                  </div>
                );
              })}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 14, marginTop: 8 }}>
                {[{ n: "INET margin", c: C.blue }, { n: "Subcon payout", c: C.amber }].map((l) => (
                  <span key={l.n} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10, fontWeight: 600, color: "#64748b" }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: l.c }} />{l.n}
                  </span>
                ))}
              </div>
            </div>
          )}
        </Panel>
      </div>

      <div className="nd-grid col2 stretch">
        <Panel fill eyebrow="Portfolio" title="Top Projects by Invoiced Value" note="Excludes internal work and dummy POs; cancelled lines contribute no amount.">
          {per_project.length === 0 ? <Empty>No project invoicing yet.</Empty> : (
            <table className="nd-table" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th>Project</th>
                  <th style={{ textAlign: "right" }}>Invoiced</th>
                  <th style={{ textAlign: "right" }}>Backlog</th>
                  <th style={{ width: "22%" }}>Mix</th>
                </tr>
              </thead>
              <tbody>
                {per_project.map((p) => (
                  <tr key={p.project_code}>
                    <td>
                      <strong style={{ fontSize: 11.5 }}>{p.project_code}</strong>
                      <div style={{ fontSize: 10, color: "#94a3b8", maxWidth: 230, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.project_name}</div>
                    </td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{compactSar(p.invoiced)}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: C.amber }}>{compactSar(p.backlog)}</td>
                    <td>
                      <div className="nd-splitbar">
                        <span style={{ width: `${((p.invoiced || 0) / projMax) * 100}%`, background: C.blue }} />
                        <span style={{ width: `${((p.backlog || 0) / projMax) * 100}%`, background: C.amber }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel fill eyebrow="Ownership" title="Invoicing by Implementation Manager" note="Only POIDs with an IM assigned appear here.">
          {per_im.length === 0 ? <Empty>No POIDs have an IM assigned yet.</Empty> : (
            <table className="nd-table" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th>IM</th>
                  <th style={{ textAlign: "right" }}>Lines</th>
                  <th style={{ textAlign: "right" }}>Invoiced</th>
                  <th style={{ textAlign: "right" }}>Backlog</th>
                </tr>
              </thead>
              <tbody>
                {per_im.map((im) => (
                  <tr key={im.im}>
                    <td><strong style={{ fontSize: 11.5 }}>{im.im}</strong></td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt.format(im.line_count || 0)}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{compactSar(im.invoiced)}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: C.amber }}>{compactSar(im.backlog)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </div>
  );
}
