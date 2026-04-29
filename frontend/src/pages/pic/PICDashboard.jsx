import { useEffect, useMemo, useState } from "react";
import { pmApi } from "../../services/api";
import DateRangePicker from "../../components/DateRangePicker";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });
const fmtMoney = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

// Acceptance buckets, in the order the spreadsheet shows them.
const BUCKET_ORDER = [
  "Commercial Invoice Closed",
  "Commercial Invoice Submitted",
  "Ready for Invoice",
  "Under I-BUY",
  "Under ISDP",
  "Under Process to Apply",
  "I-BUY Rejected",
  "ISDP Rejected",
  "PO Line Canceled",
  "PO Need to Cancel",
  "Work Not Done",
];

const BUCKET_TONE = {
  "Commercial Invoice Closed":    { bg: "#ecfdf5", border: "#a7f3d0", fg: "#047857", icon: "✓" },
  "Commercial Invoice Submitted": { bg: "#eef2ff", border: "#c7d2fe", fg: "#4338ca", icon: "→" },
  "Ready for Invoice":            { bg: "#eff6ff", border: "#bfdbfe", fg: "#1d4ed8", icon: "▸" },
  "Under I-BUY":                  { bg: "#f5f3ff", border: "#ddd6fe", fg: "#6d28d9", icon: "•" },
  "Under ISDP":                   { bg: "#faf5ff", border: "#e9d5ff", fg: "#7e22ce", icon: "•" },
  "Under Process to Apply":       { bg: "#fffbeb", border: "#fde68a", fg: "#b45309", icon: "⌛" },
  "I-BUY Rejected":               { bg: "#fef2f2", border: "#fecaca", fg: "#b91c1c", icon: "✕" },
  "ISDP Rejected":                { bg: "#fef2f2", border: "#fecaca", fg: "#b91c1c", icon: "✕" },
  "PO Line Canceled":             { bg: "#f8fafc", border: "#cbd5e1", fg: "#475569", icon: "—" },
  "PO Need to Cancel":            { bg: "#fffbeb", border: "#fde68a", fg: "#92400e", icon: "!" },
  "Work Not Done":                { bg: "#f8fafc", border: "#cbd5e1", fg: "#475569", icon: "·" },
};

export default function PICDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [range, setRange] = useState({ from: "", to: "" });
  const [fetchedAt, setFetchedAt] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await pmApi.getPicDashboard(range.from, range.to);
      setData(res || null);
      setFetchedAt(new Date());
    } catch (err) {
      setError(err.message || "Failed to load PIC dashboard");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [range.from, range.to]);
  useEffect(() => {
    const t = setInterval(load, 5 * 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to]);

  const buckets = data?.buckets || [];
  const bucketByKey = useMemo(() => Object.fromEntries(buckets.map((b) => [b.bucket, b])), [buckets]);
  const monthly = data?.monthly || [];
  const pendingIbuy = data?.pending_ibuy || [];
  const pendingIsdp = data?.pending_isdp || [];
  const inetSubcon = data?.inet_subcon || [];
  const kpi = data?.kpi || {};

  // Aggregate amounts across active (non-terminal) buckets to compute the
  // "outstanding pipeline" value the gradient header shows.
  const totals = useMemo(() => {
    let pipeline = 0;
    let closed = 0;
    let cancelled = 0;
    buckets.forEach((b) => {
      if (b.bucket === "Commercial Invoice Closed") closed += Number(b.total) || 0;
      else if (b.bucket === "PO Line Canceled" || b.bucket === "PO Need to Cancel") cancelled += Number(b.total) || 0;
      else pipeline += Number(b.total) || 0;
    });
    const grand = pipeline + closed + cancelled;
    return { pipeline, closed, cancelled, grand };
  }, [buckets]);
  const closedPct = totals.grand > 0 ? Math.round((totals.closed / totals.grand) * 100) : 0;

  const lastUpdated = fetchedAt
    ? fetchedAt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
    : "";

  return (
    <div>
      {/* Hero header — gradient with KPIs */}
      <div style={{
        margin: "0 16px 14px",
        padding: "20px 22px",
        borderRadius: 14,
        background: "linear-gradient(135deg, #1e3a8a 0%, #4338ca 55%, #7c3aed 100%)",
        color: "#fff",
        boxShadow: "0 10px 25px -10px rgba(67,56,202,0.45)",
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
          <div>
            <div style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.1em", opacity: 0.8, fontWeight: 700 }}>
              Project Invoice Controller
            </div>
            <div style={{ fontSize: "1.4rem", fontWeight: 800, marginTop: 3 }}>Cash-Flow Dashboard</div>
            <div style={{ fontSize: "0.82rem", opacity: 0.85, marginTop: 4 }}>
              Acceptance pipeline + invoicing roll-up.
              {lastUpdated && <span style={{ marginLeft: 8, opacity: 0.7 }}>· Last refreshed {lastUpdated}</span>}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <DateRangePicker value={range} onChange={({ from, to }) => setRange({ from, to })} />
            <button type="button" className="btn-secondary" onClick={load} disabled={loading}
              style={{ background: "rgba(255,255,255,0.18)", border: "1px solid rgba(255,255,255,0.25)", color: "#fff", fontWeight: 600 }}>
              {loading && !data ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>

        {/* KPI tiles */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 10, marginTop: 16 }}>
          <HeroKPI label="Active Lines" value={fmt.format(kpi.line_count || 0)} hint="In acceptance pipeline" icon="📑" />
          <HeroKPI label="Total Invoiced" value={fmtMoney.format(kpi.total_invoiced || 0)} suffix="SAR" tone="green" icon="✓" />
          <HeroKPI label="Unbilled MS1" value={fmtMoney.format(kpi.unbilled_ms1 || 0)} suffix="SAR" tone="amber" icon="❶" />
          <HeroKPI label="Unbilled MS2" value={fmtMoney.format(kpi.unbilled_ms2 || 0)} suffix="SAR" tone="amber" icon="❷" />
        </div>

        {/* Progress bar — closed vs pipeline */}
        <div style={{ marginTop: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.74rem", opacity: 0.85, marginBottom: 4 }}>
            <span><strong style={{ fontWeight: 700 }}>{closedPct}%</strong> of total amount has reached <em>Commercial Invoice Closed</em></span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{fmtMoney.format(totals.closed)} / {fmtMoney.format(totals.grand)} SAR</span>
          </div>
          <div style={{ height: 8, background: "rgba(255,255,255,0.18)", borderRadius: 99, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${closedPct}%`, background: "linear-gradient(90deg, #34d399, #10b981)", transition: "width 0.4s ease" }} />
          </div>
        </div>
      </div>

      {error && (
        <div className="notice error" style={{ margin: "0 16px 8px" }}>
          <span>!</span> {error}
        </div>
      )}

      {/* Acceptance pipeline as cards (instead of a flat table) */}
      <SectionTitle>Acceptance Pipeline</SectionTitle>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
        gap: 12,
        padding: "0 16px 16px",
      }}>
        {BUCKET_ORDER.map((key) => {
          const row = bucketByKey[key] || { bucket: key, line_count: 0, ms1_total: 0, ms2_total: 0, total: 0 };
          const tone = BUCKET_TONE[key];
          const isEmpty = (row.line_count || 0) === 0;
          return (
            <div key={key} style={{
              background: tone.bg,
              border: `1px solid ${tone.border}`,
              borderRadius: 10,
              padding: "12px 14px",
              opacity: isEmpty ? 0.6 : 1,
              boxShadow: isEmpty ? "none" : "0 1px 2px rgba(15,23,42,0.04)",
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.74rem", fontWeight: 700, color: tone.fg, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  <span style={{ display: "inline-block", width: 18, textAlign: "center" }}>{tone.icon}</span>
                  {key}
                </span>
              </div>
              <div style={{ fontSize: "1.6rem", fontWeight: 800, color: tone.fg, fontVariantNumeric: "tabular-nums" }}>
                {fmt.format(row.line_count || 0)}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginTop: 8, fontSize: "0.74rem" }}>
                <div>
                  <div style={{ color: "#94a3b8", fontWeight: 600 }}>MS1 Amt</div>
                  <div style={{ color: "#0f172a", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmtMoney.format(row.ms1_total || 0)}</div>
                </div>
                <div>
                  <div style={{ color: "#94a3b8", fontWeight: 600 }}>MS2 Amt</div>
                  <div style={{ color: "#0f172a", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmtMoney.format(row.ms2_total || 0)}</div>
                </div>
              </div>
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${tone.border}` }}>
                <div style={{ fontSize: "0.72rem", color: "#64748b", fontWeight: 600 }}>Total</div>
                <div style={{ fontSize: "0.95rem", color: "#0f172a", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmtMoney.format(row.total || 0)}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Two-column row: Monthly invoicing + INET vs Subcon */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12, padding: "0 16px 12px" }}>
        <Section title="Monthly Invoicing Roll-up" subtitle="MS1 + MS2 invoiced amounts grouped by Invoicing Month">
          {monthly.length === 0 ? (
            <Empty>No invoicing dates set yet.</Empty>
          ) : (
            <table className="data-table" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th>Invoicing Month</th>
                  <th style={{ textAlign: "right" }}>MS1 Invoiced</th>
                  <th style={{ textAlign: "right" }}>MS2 Invoiced</th>
                  <th style={{ textAlign: "right" }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {monthly.map((m) => (
                  <tr key={m.invoice_month}>
                    <td>{m.invoice_month}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtMoney.format(m.ms1_invoiced || 0)}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtMoney.format(m.ms2_invoiced || 0)}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{fmtMoney.format(m.total || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <Section title="INET vs Subcon" subtitle="Lines grouped by team type">
          {inetSubcon.length === 0 ? (
            <Empty>No team data yet.</Empty>
          ) : (
            <div style={{ padding: "8px 12px" }}>
              {inetSubcon.map((r) => (
                <TeamSplitRow key={r.team_type} row={r} />
              ))}
            </div>
          )}
        </Section>
      </div>

      {/* Pending approvals — two side-by-side tables */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, padding: "0 16px 16px" }}>
        <Section title="Pending on E-Supplier" subtitle="POIDs in 'Under I-BUY' grouped by owner">
          <OwnerTable rows={pendingIbuy} />
        </Section>
        <Section title="Pending on ISDP" subtitle="POIDs in 'Under ISDP' grouped by owner">
          <OwnerTable rows={pendingIsdp} />
        </Section>
      </div>
    </div>
  );
}

function HeroKPI({ label, value, suffix, hint, icon, tone }) {
  const accentBg = tone === "green" ? "rgba(16,185,129,0.18)" : tone === "amber" ? "rgba(245,158,11,0.20)" : "rgba(255,255,255,0.10)";
  return (
    <div style={{ background: accentBg, borderRadius: 10, padding: "11px 14px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: "0.66rem", textTransform: "uppercase", letterSpacing: "0.1em", opacity: 0.85, fontWeight: 700 }}>{label}</span>
        <span style={{ fontSize: "0.92rem", opacity: 0.7 }}>{icon}</span>
      </div>
      <div style={{ fontSize: "1.3rem", fontWeight: 800, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>
        {value}{suffix && <span style={{ marginLeft: 5, fontSize: "0.72rem", opacity: 0.75, fontWeight: 600 }}>{suffix}</span>}
      </div>
      {hint && <div style={{ fontSize: "0.7rem", opacity: 0.75, marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

function SectionTitle({ children }) {
  return (
    <div style={{
      fontSize: "0.74rem", fontWeight: 800, letterSpacing: "0.06em",
      textTransform: "uppercase", color: "#475569",
      padding: "4px 16px 8px",
    }}>
      {children}
    </div>
  );
}

function Section({ title, subtitle, children }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 2px rgba(15,23,42,0.03)" }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #e2e8f0" }}>
        <div style={{ fontSize: "0.92rem", fontWeight: 700, color: "#0f172a" }}>{title}</div>
        {subtitle && <div style={{ fontSize: "0.72rem", color: "#94a3b8", marginTop: 2 }}>{subtitle}</div>}
      </div>
      <div style={{ overflowX: "auto" }}>{children}</div>
    </div>
  );
}

function Empty({ children }) {
  return <div style={{ padding: 24, color: "#94a3b8", fontSize: "0.82rem", textAlign: "center" }}>{children}</div>;
}

function OwnerTable({ rows }) {
  if (!rows || rows.length === 0) return <Empty>None pending.</Empty>;
  return (
    <table className="data-table" style={{ width: "100%" }}>
      <thead>
        <tr>
          <th>Owner</th>
          <th style={{ textAlign: "right" }}>Lines</th>
          <th style={{ textAlign: "right" }}>MS1 Amount</th>
          <th style={{ textAlign: "right" }}>MS2 Amount</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.owner}>
            <td style={{ fontSize: "0.82rem" }}>{r.owner || "—"}</td>
            <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt.format(r.line_count || 0)}</td>
            <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtMoney.format(r.amount_ms1 || 0)}</td>
            <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtMoney.format(r.amount_ms2 || 0)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TeamSplitRow({ row }) {
  const isInet = row.team_type === "INET";
  const accent = isInet ? "#3b82f6" : "#a855f7";
  const bg = isInet ? "rgba(59,130,246,0.08)" : "rgba(168,85,247,0.08)";
  const billed = Number(row.invoiced_total || 0);
  const total = Number(row.po_total || 0);
  const pct = total > 0 ? Math.min(100, Math.round((billed / total) * 100)) : 0;
  return (
    <div style={{ background: bg, borderRadius: 10, padding: "10px 12px", marginBottom: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 999, fontSize: "0.74rem", fontWeight: 700, background: accent, color: "#fff" }}>
          {row.team_type}
        </span>
        <span style={{ fontSize: "0.78rem", color: "#475569" }}>{fmt.format(row.line_count || 0)} lines</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 8, fontSize: "0.78rem" }}>
        <div>
          <div style={{ color: "#94a3b8", fontWeight: 600 }}>Invoiced</div>
          <div style={{ color: "#047857", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmtMoney.format(billed)}</div>
        </div>
        <div>
          <div style={{ color: "#94a3b8", fontWeight: 600 }}>PO Total</div>
          <div style={{ color: "#0f172a", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmtMoney.format(total)}</div>
        </div>
      </div>
      <div style={{ height: 4, background: "rgba(15,23,42,0.08)", borderRadius: 99, overflow: "hidden", marginTop: 8 }}>
        <div style={{ height: "100%", width: `${pct}%`, background: accent }} />
      </div>
    </div>
  );
}
