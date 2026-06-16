import { useEffect, useState } from "react";
import { pmApi } from "../../services/api";
import SearchableSelect from "../../components/SearchableSelect";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const fmtInt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

// ── Status display order ───────────────────────────────────────────────
const MS1_STATUS_ORDER = [
  "Commercial Invoice Closed",
  "Commercial Invoice Submitted",
  "Ready for Invoice",
  "Under I-BUY",
  "Under ISDP",
  "I-BUY Rejected",
  "ISDP Rejected",
  "Under Process to Apply",
  "PO Need to Cancel",
  "PO Line Canceled",
  "Work Not Done",
];

function statusColor(status) {
  const s = (status || "").toLowerCase();
  if (/closed/.test(s))                    return "#047857";
  if (/submitted/.test(s))                 return "#0369a1";
  if (/ready/.test(s))                     return "#0891b2";
  if (/under i-buy|under isdp/.test(s))    return "#6d28d9";
  if (/rejected|cancel/.test(s))           return "#b91c1c";
  if (/under process|apply/.test(s))       return "#b45309";
  if (/work not done/.test(s))             return "#64748b";
  return "#334155";
}

function sortByStatus(rows, order) {
  return [...rows].sort((a, b) => {
    const ai = order.indexOf(a.pic_status);
    const bi = order.indexOf(b.pic_status);
    if (ai === -1 && bi === -1) return 0;
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

// ── Sub-components ─────────────────────────────────────────────────────
function TopSummaryCard({ top }) {
  const rows = [
    { label: "INET",   ms1: top.inet_ms1,   ms2: top.inet_ms2,   total: top.inet_total,   tone: "blue" },
    { label: "Subcon", ms1: top.subcon_ms1, ms2: top.subcon_ms2, total: top.subcon_total, tone: "violet" },
    { label: "Total",  ms1: top.total_ms1,  ms2: top.total_ms2,  total: top.grand_total,  tone: "slate", bold: true },
  ];
  const tones = {
    blue:   { bg: "#eff6ff", bd: "#bfdbfe", fg: "#1e40af", hd: "#dbeafe" },
    violet: { bg: "#f5f3ff", bd: "#ddd6fe", fg: "#6d28d9", hd: "#ede9fe" },
    slate:  { bg: "#f8fafc", bd: "#e2e8f0", fg: "#0f172a", hd: "#f1f5f9" },
  };
  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden", marginBottom: 20 }}>
      <div style={{ background: "#1e3a8a", color: "#fff", padding: "10px 16px", fontWeight: 700, fontSize: "0.88rem", letterSpacing: "0.04em" }}>
        INET / Subcons Split
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.88rem" }}>
        <thead>
          <tr style={{ background: "#f8fafc", color: "#475569", fontSize: "0.72rem", textTransform: "uppercase" }}>
            <th style={{ padding: "8px 14px", textAlign: "left", borderBottom: "1px solid #e2e8f0" }}>Company</th>
            <th style={{ padding: "8px 14px", textAlign: "right", borderBottom: "1px solid #e2e8f0" }}>MS1 (SAR)</th>
            <th style={{ padding: "8px 14px", textAlign: "right", borderBottom: "1px solid #e2e8f0" }}>MS2 (SAR)</th>
            <th style={{ padding: "8px 14px", textAlign: "right", borderBottom: "1px solid #e2e8f0" }}>Total (SAR)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const t = tones[r.tone];
            return (
              <tr key={r.label} style={{ background: r.bold ? t.hd : "#fff", borderTop: "1px solid #f1f5f9" }}>
                <td style={{ padding: "10px 14px", fontWeight: r.bold ? 700 : 600, color: t.fg }}>{r.label}</td>
                <td style={{ padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: r.bold ? 700 : 500, color: t.fg }}>
                  {fmt.format(r.ms1 || 0)}
                </td>
                <td style={{ padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: r.bold ? 700 : 500, color: t.fg }}>
                  {fmt.format(r.ms2 || 0)}
                </td>
                <td style={{ padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: t.fg }}>
                  {fmt.format(r.total || 0)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StatusTable({ title, rows, statusOrder, tone }) {
  const tones = {
    blue:   { hd: "#1e3a8a", sub: "#1e40af" },
    violet: { hd: "#4c1d95", sub: "#6d28d9" },
  };
  const t = tones[tone] || tones.blue;
  const sorted = statusOrder ? sortByStatus(rows, statusOrder) : rows;

  const totals = rows.reduce((acc, r) => ({
    row_count: acc.row_count + (Number(r.row_count) || 0),
    po_amount: acc.po_amount + (Number(r.po_amount) || 0),
    invoiced:  acc.invoiced  + (Number(r.invoiced)  || 0),
    unbilled:  acc.unbilled  + (Number(r.unbilled)  || 0),
    subcon_amt: acc.subcon_amt + (Number(r.subcon_amt) || 0),
    inet_amt:   acc.inet_amt  + (Number(r.inet_amt)   || 0),
  }), { row_count: 0, po_amount: 0, invoiced: 0, unbilled: 0, subcon_amt: 0, inet_amt: 0 });

  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden", marginBottom: 20 }}>
      <div style={{ background: t.hd, color: "#fff", padding: "10px 16px", fontWeight: 700, fontSize: "0.88rem", letterSpacing: "0.04em" }}>
        {title}
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem" }}>
          <thead>
            <tr style={{ background: "#f8fafc", color: "#475569", fontSize: "0.72rem", textTransform: "uppercase" }}>
              <th style={{ padding: "8px 14px", textAlign: "left",  borderBottom: "1px solid #e2e8f0" }}>PIC Status</th>
              <th style={{ padding: "8px 14px", textAlign: "right", borderBottom: "1px solid #e2e8f0" }}>Count</th>
              <th style={{ padding: "8px 14px", textAlign: "right", borderBottom: "1px solid #e2e8f0" }}>PO Amount</th>
              <th style={{ padding: "8px 14px", textAlign: "right", borderBottom: "1px solid #e2e8f0" }}>Invoiced</th>
              <th style={{ padding: "8px 14px", textAlign: "right", borderBottom: "1px solid #e2e8f0" }}>Unbilled</th>
              <th style={{ padding: "8px 14px", textAlign: "right", borderBottom: "1px solid #e2e8f0" }}>Subcon Amt</th>
              <th style={{ padding: "8px 14px", textAlign: "right", borderBottom: "1px solid #e2e8f0" }}>Inet Amt</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => (
              <tr key={r.pic_status || i} style={{ borderTop: "1px solid #f1f5f9" }}>
                <td style={{ padding: "8px 14px", fontWeight: 600, color: statusColor(r.pic_status) }}>
                  {r.pic_status || "(blank)"}
                </td>
                <td style={{ padding: "8px 14px", textAlign: "right", color: "#64748b", fontVariantNumeric: "tabular-nums" }}>
                  {fmtInt.format(r.row_count || 0)}
                </td>
                <td style={{ padding: "8px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                  {fmt.format(r.po_amount || 0)}
                </td>
                <td style={{ padding: "8px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: (r.invoiced || 0) > 0 ? "#047857" : "#94a3b8" }}>
                  {fmt.format(r.invoiced || 0)}
                </td>
                <td style={{ padding: "8px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: (r.unbilled || 0) > 0 ? "#b45309" : "#94a3b8" }}>
                  {fmt.format(r.unbilled || 0)}
                </td>
                <td style={{ padding: "8px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#6d28d9" }}>
                  {(r.subcon_amt || 0) > 0 ? fmt.format(r.subcon_amt) : <span style={{ color: "#cbd5e1" }}>—</span>}
                </td>
                <td style={{ padding: "8px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#1d4ed8" }}>
                  {(r.inet_amt || 0) > 0 ? fmt.format(r.inet_amt) : <span style={{ color: "#cbd5e1" }}>—</span>}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: "#f8fafc", borderTop: "2px solid #e2e8f0", fontWeight: 700 }}>
              <td style={{ padding: "9px 14px", color: "#0f172a" }}>Grand Total</td>
              <td style={{ padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#64748b" }}>
                {fmtInt.format(totals.row_count)}
              </td>
              <td style={{ padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {fmt.format(totals.po_amount)}
              </td>
              <td style={{ padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#047857" }}>
                {fmt.format(totals.invoiced)}
              </td>
              <td style={{ padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#b45309" }}>
                {fmt.format(totals.unbilled)}
              </td>
              <td style={{ padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#6d28d9" }}>
                {fmt.format(totals.subcon_amt)}
              </td>
              <td style={{ padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#1d4ed8" }}>
                {fmt.format(totals.inet_amt)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────
export default function PICInvoicingSummary() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterOpts, setFilterOpts] = useState({ contract_models: [], invoice_months: [] });

  // Filters
  const [contractFilter, setContractFilter] = useState([]);
  const [ms1MonthFilter, setMs1Month]       = useState([]);
  const [ms2MonthFilter, setMs2Month]       = useState([]);
  const [refreshKey, setRefreshKey]         = useState(0);

  const hasFilters = !!(contractFilter.length || ms1MonthFilter.length || ms2MonthFilter.length);

  // Fetch filter options once
  useEffect(() => {
    pmApi.getPicSummaryFilterOptions()
      .then((res) => {
        if (res) setFilterOpts(res);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const portal = {};
        if (contractFilter.length) portal.contract_model    = contractFilter;
        if (ms1MonthFilter.length) portal.ms1_invoice_month = ms1MonthFilter;
        if (ms2MonthFilter.length) portal.ms2_invoice_month = ms2MonthFilter;
        const res = await pmApi.picInvoicingSummary(portal);
        if (!cancelled) setData(res);
      } catch (err) {
        if (!cancelled) setError(err.message || "Failed to load summary");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [contractFilter, ms1MonthFilter, ms2MonthFilter, refreshKey]);

  const monthOptions = (filterOpts.invoice_months || []).map((m) => ({ id: m, label: m }));
  const contractOptions = (filterOpts.contract_models || []).map((m) => ({ id: m, label: m }));

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Invoicing Summary</h1>
          <div className="page-subtitle">INET / Subcons split across MS1 &amp; MS2 by PIC status</div>
        </div>
        <div className="page-actions">
          <button type="button" className="btn-secondary" onClick={() => setRefreshKey((k) => k + 1)} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      <div className="toolbar" style={{ flexWrap: "wrap", gap: 8 }}>
        <SearchableSelect
          multi value={contractFilter} onChange={setContractFilter}
          options={contractOptions} placeholder="All Contracts" minWidth={180}
        />
        <SearchableSelect
          multi value={ms1MonthFilter} onChange={setMs1Month}
          options={monthOptions} placeholder="MS1 Month" minWidth={150}
        />
        <SearchableSelect
          multi value={ms2MonthFilter} onChange={setMs2Month}
          options={monthOptions} placeholder="MS2 Month" minWidth={150}
        />
        {hasFilters && (
          <button className="btn-secondary" onClick={() => {
            setContractFilter([]); setMs1Month([]); setMs2Month([]);
          }}>
            Clear
          </button>
        )}
      </div>

      {error && (
        <div className="notice error" style={{ margin: "0 16px 8px" }}>
          <span>!</span> {error}
        </div>
      )}

      <div className="page-content">
        {loading ? (
          <div style={{ padding: 60, textAlign: "center", color: "#94a3b8" }}>Loading…</div>
        ) : data ? (
          <>
            <TopSummaryCard top={data.top} />
            <StatusTable
              title="MS1 — 1st Payment Milestone"
              rows={data.ms1_rows}
              statusOrder={MS1_STATUS_ORDER}
              tone="blue"
            />
            <StatusTable
              title="MS2 — 2nd Payment Milestone"
              rows={data.ms2_rows}
              statusOrder={MS1_STATUS_ORDER}
              tone="violet"
            />
          </>
        ) : null}
      </div>
    </div>
  );
}
