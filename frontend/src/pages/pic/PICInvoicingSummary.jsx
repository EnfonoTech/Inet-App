import { Fragment, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { pmApi } from "../../services/api";
import SearchableSelect from "../../components/SearchableSelect";
import { useAuth } from "../../context/AuthContext";
import { money } from "../../utils/numberFormat";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const fmtInt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "2024-05" -> "May-24"
function fmtYearMonthLabel(ym) {
  const [y, m] = String(ym).split("-");
  return `${MONTH_SHORT[parseInt(m, 10) - 1]}-${y.slice(2)}`;
}

// "2026-05-04" -> "4th-May"
function fmtDayLabel(dateStr) {
  const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00`);
  const day = d.getDate();
  const suffix = day % 10 === 1 && day !== 11 ? "st"
    : day % 10 === 2 && day !== 12 ? "nd"
    : day % 10 === 3 && day !== 13 ? "rd"
    : "th";
  return `${day}${suffix}-${MONTH_SHORT[d.getMonth()]}`;
}

// ── Status display order ───────────────────────────────────────────────
// Acceptance flow order, matching the `pic_status` field on PO Dispatch — the
// table should read the way the work moves, not terminal-state first. Only a
// fallback now: pic_invoicing_summary returns `status_order` off that same
// field, so this cannot be what drifts.
// PIC's preferred reading order — terminal/closed state first. Matches
// pic.py's PIC_STATUS_ORDER and PICDashboard.jsx's BUCKET_ORDER; this copy is
// only the fallback for when the backend call fails (pic_invoicing_summary
// normally sends status_order itself — see the two call sites below).
const MS1_STATUS_ORDER = [
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

// Every status in `order` always shows a row, even with zero lines — a
// status with no data is still useful information (nothing stuck there),
// not something to hide. Missing statuses get a zero-value stub; any
// status the backend returned that isn't in `order` still appends at the end.
function sortByStatus(rows, order) {
  const byStatus = new Map(rows.map((r) => [r.pic_status, r]));
  const known = order.map((status) => byStatus.get(status) || {
    pic_status: status, row_count: 0, po_amount: 0, invoiced: 0, vat: 0, unbilled: 0, subcon_amt: 0, inet_amt: 0,
  });
  const unknown = rows.filter((r) => !order.includes(r.pic_status));
  return [...known, ...unknown];
}

// ── Sub-components ─────────────────────────────────────────────────────
function TopSummaryCard({ top }) {
  const rows = [
    { label: "INET",   ms1: top.inet_ms1,   ms2: top.inet_ms2,   total: top.inet_total,   vat: top.inet_total_vat,   totalIncl: top.inet_grand_total,   tone: "blue" },
    { label: "Subcon", ms1: top.subcon_ms1, ms2: top.subcon_ms2, total: top.subcon_total, vat: top.subcon_total_vat, totalIncl: top.subcon_grand_total, tone: "violet" },
    { label: "Total",  ms1: top.total_ms1,  ms2: top.total_ms2,  total: top.grand_total,  vat: top.grand_total_vat,  totalIncl: top.grand_total_incl_vat,  tone: "slate", bold: true },
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
            <th style={{ padding: "8px 14px", textAlign: "right", borderBottom: "1px solid #e2e8f0" }}>VAT (SAR)</th>
            <th style={{ padding: "8px 14px", textAlign: "right", borderBottom: "1px solid #e2e8f0" }}>Total incl. VAT</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const t = tones[r.tone];
            return (
              <tr key={r.label} style={{ background: r.bold ? t.hd : "#fff", borderTop: "1px solid #f1f5f9" }}>
                <td style={{ padding: "10px 14px", fontWeight: r.bold ? 700 : 600, color: t.fg }}>{r.label}</td>
                <td style={{ padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: r.bold ? 700 : 500, color: t.fg }}>
                  {money.format(r.ms1 || 0)}
                </td>
                <td style={{ padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: r.bold ? 700 : 500, color: t.fg }}>
                  {money.format(r.ms2 || 0)}
                </td>
                <td style={{ padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: t.fg }}>
                  {fmt.format(r.total || 0)}
                </td>
                <td style={{ padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: r.bold ? 700 : 500, color: "#64748b" }}>
                  {fmt.format(r.vat || 0)}
                </td>
                <td style={{ padding: "10px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: t.fg }}>
                  {fmt.format(r.totalIncl || 0)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Pure-pending statuses route to the Pending page (Page 1) — a row only
// actually lives there while its OTHER milestone is also untouched, but
// most of a bucket's volume genuinely does. "PO Line Canceled" always means
// the whole row lives on the Cancelled page (Page 3). Everything else is
// unambiguous and lives on PIC Tracker (Page 2). "PO Need to Cancel" is NOT
// here — per _PIC_PENDING_STATUSES_SQL in pic.py only "Work Not Done" counts
// as pending; a flagged-to-cancel row is deterministically Active/Tracker.
const PENDING_STATUSES_SET = new Set(["Work Not Done"]);
const CANCELLED_STATUS = "PO Line Canceled";
// "Commercial Invoice Closed" on one milestone only actually lands on the
// Closed page once BOTH milestones are resolved — see the matching
// CLOSED_BUCKETS comment in PICDashboard.jsx for the same "majority case"
// reasoning applied here.
const CLOSED_STATUSES_SET = new Set(["Commercial Invoice Closed"]);

function StatusTable({ title, rows, statusOrder, tone, milestone, navigable }) {
  const navigate = useNavigate();
  const tones = {
    blue:   { hd: "#1e3a8a", sub: "#1e40af" },
    violet: { hd: "#4c1d95", sub: "#6d28d9" },
  };
  const t = tones[tone] || tones.blue;
  const sorted = statusOrder ? sortByStatus(rows, statusOrder) : rows;

  function handleRowClick(status) {
    if (status === CANCELLED_STATUS) {
      navigate("/pic-cancelled");
    } else if (PENDING_STATUSES_SET.has(status)) {
      navigate("/pic-pending");
    } else if (CLOSED_STATUSES_SET.has(status)) {
      navigate("/pic-closed");
    } else {
      const param = milestone === "ms2" ? "pic_ms2_status" : "pic_status";
      navigate(`/pic-tracker?${param}=${encodeURIComponent(status)}`);
    }
  }

  const totals = rows.reduce((acc, r) => ({
    row_count: acc.row_count + (Number(r.row_count) || 0),
    po_amount: acc.po_amount + (Number(r.po_amount) || 0),
    invoiced:  acc.invoiced  + (Number(r.invoiced)  || 0),
    vat:       acc.vat       + (Number(r.vat)       || 0),
    unbilled:  acc.unbilled  + (Number(r.unbilled)  || 0),
    subcon_amt: acc.subcon_amt + (Number(r.subcon_amt) || 0),
    inet_amt:   acc.inet_amt  + (Number(r.inet_amt)   || 0),
  }), { row_count: 0, po_amount: 0, invoiced: 0, vat: 0, unbilled: 0, subcon_amt: 0, inet_amt: 0 });

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
              <th style={{ padding: "8px 14px", textAlign: "right", borderBottom: "1px solid #e2e8f0" }}>VAT</th>
              <th style={{ padding: "8px 14px", textAlign: "right", borderBottom: "1px solid #e2e8f0" }}>Unbilled</th>
              <th style={{ padding: "8px 14px", textAlign: "right", borderBottom: "1px solid #e2e8f0" }}>Subcon Amt</th>
              <th style={{ padding: "8px 14px", textAlign: "right", borderBottom: "1px solid #e2e8f0" }}>Inet Amt</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => {
              const clickable = navigable && (r.row_count || 0) > 0 && r.pic_status;
              return (
              <tr
                key={r.pic_status || i}
                style={{ borderTop: "1px solid #f1f5f9", ...(clickable ? { cursor: "pointer" } : {}) }}
                onClick={clickable ? () => handleRowClick(r.pic_status) : undefined}
                onMouseEnter={clickable ? (e) => { e.currentTarget.style.background = "#f8fafc"; } : undefined}
                onMouseLeave={clickable ? (e) => { e.currentTarget.style.background = ""; } : undefined}
              >
                <td style={{ padding: "8px 14px", fontWeight: 600, color: statusColor(r.pic_status) }}>
                  {r.pic_status || "(blank)"}
                </td>
                <td style={{ padding: "8px 14px", textAlign: "right", color: "#64748b", fontVariantNumeric: "tabular-nums" }}>
                  {fmtInt.format(r.row_count || 0)}
                </td>
                <td style={{ padding: "8px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                  {money.format(r.po_amount || 0)}
                </td>
                <td style={{ padding: "8px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: (r.invoiced || 0) > 0 ? "#047857" : "#94a3b8" }}>
                  {money.format(r.invoiced || 0)}
                </td>
                <td style={{ padding: "8px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: (r.vat || 0) > 0 ? "#64748b" : "#94a3b8" }}>
                  {(r.vat || 0) > 0 ? fmt.format(r.vat) : <span style={{ color: "#cbd5e1" }}>—</span>}
                </td>
                <td style={{ padding: "8px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: (r.unbilled || 0) > 0 ? "#b45309" : "#94a3b8" }}>
                  {money.format(r.unbilled || 0)}
                </td>
                <td style={{ padding: "8px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#6d28d9" }}>
                  {(r.subcon_amt || 0) > 0 ? money.format(r.subcon_amt) : <span style={{ color: "#cbd5e1" }}>—</span>}
                </td>
                <td style={{ padding: "8px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#1d4ed8" }}>
                  {(r.inet_amt || 0) > 0 ? money.format(r.inet_amt) : <span style={{ color: "#cbd5e1" }}>—</span>}
                </td>
              </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ background: "#f8fafc", borderTop: "2px solid #e2e8f0", fontWeight: 700 }}>
              <td style={{ padding: "9px 14px", color: "#0f172a" }}>Grand Total</td>
              <td style={{ padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#64748b" }}>
                {fmtInt.format(totals.row_count)}
              </td>
              <td style={{ padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {money.format(totals.po_amount)}
              </td>
              <td style={{ padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#047857" }}>
                {money.format(totals.invoiced)}
              </td>
              <td style={{ padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#64748b" }}>
                {fmt.format(totals.vat)}
              </td>
              <td style={{ padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#b45309" }}>
                {money.format(totals.unbilled)}
              </td>
              <td style={{ padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#6d28d9" }}>
                {money.format(totals.subcon_amt)}
              </td>
              <td style={{ padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#1d4ed8" }}>
                {money.format(totals.inet_amt)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ── Payment Ledger tab ──────────────────────────────────────────────────
// Invoicing ledger sectioned by Invoicing Month: year rows collapse to an
// annual total, expand to months, expand a month to one row per day
// (invoice lines applied the same day are summed together, never listed
// individually). Only the month-grain summary loads up front; per-day
// totals for a given month are fetched lazily the first time that month is
// expanded (see pic_payment_ledger_month_detail in pic.py) — keeps this
// fast even with years of history, matching the same render-cost lesson
// PIC Tracker hit.
function PaymentLedgerTab({ refreshKey }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedYears, setExpandedYears] = useState(() => new Set());
  const [expandedMonths, setExpandedMonths] = useState(() => new Set());
  const [monthDetails, setMonthDetails] = useState(() => new Map());
  const [loadingMonths, setLoadingMonths] = useState(() => new Set());
  const [monthErrors, setMonthErrors] = useState(() => new Map());

  const [monthlyRollup, setMonthlyRollup] = useState(null);
  const [monthlyLoading, setMonthlyLoading] = useState(true);
  const [monthlyError, setMonthlyError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const rows = await pmApi.picPaymentLedgerSummary();
        if (!cancelled) setSummary(Array.isArray(rows) ? rows : []);
      } catch (err) {
        if (!cancelled) setError(err.message || "Failed to load payment ledger");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [refreshKey]);

  // Same MS1/MS2-by-invoice-month data the PIC Dashboard's "Monthly
  // Invoicing Roll-up" widget and the Reports "Monthly" report already
  // compute — reused here as-is rather than duplicating the query.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setMonthlyLoading(true);
      setMonthlyError(null);
      try {
        const res = await pmApi.getPicReport("monthly");
        if (!cancelled) setMonthlyRollup(Array.isArray(res?.rows) ? res.rows : []);
      } catch (err) {
        if (!cancelled) setMonthlyError(err.message || "Failed to load monthly roll-up");
      } finally {
        if (!cancelled) setMonthlyLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [refreshKey]);

  const byYear = useMemo(() => {
    const map = new Map();
    (summary || []).forEach((r) => {
      const year = r.year_month.slice(0, 4);
      if (!map.has(year)) map.set(year, []);
      map.get(year).push(r);
    });
    return map;
  }, [summary]);

  const years = useMemo(() => Array.from(byYear.keys()).sort(), [byYear]);

  const grandTotal = useMemo(() => (summary || []).reduce((acc, r) => ({
    invoiced_amount: acc.invoiced_amount + (Number(r.invoiced_amount) || 0),
    vat_amount: acc.vat_amount + (Number(r.vat_amount) || 0),
    total_amount: acc.total_amount + (Number(r.total_amount) || 0),
  }), { invoiced_amount: 0, vat_amount: 0, total_amount: 0 }), [summary]);

  function yearTotal(year) {
    return (byYear.get(year) || []).reduce((acc, r) => ({
      invoiced_amount: acc.invoiced_amount + (Number(r.invoiced_amount) || 0),
      vat_amount: acc.vat_amount + (Number(r.vat_amount) || 0),
      total_amount: acc.total_amount + (Number(r.total_amount) || 0),
    }), { invoiced_amount: 0, vat_amount: 0, total_amount: 0 });
  }

  function toggleYear(year) {
    setExpandedYears((prev) => {
      const next = new Set(prev);
      if (next.has(year)) next.delete(year); else next.add(year);
      return next;
    });
  }

  async function toggleMonth(ym) {
    setExpandedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(ym)) next.delete(ym); else next.add(ym);
      return next;
    });
    if (!monthDetails.has(ym) && !loadingMonths.has(ym)) {
      setLoadingMonths((prev) => new Set(prev).add(ym));
      try {
        const rows = await pmApi.picPaymentLedgerMonthDetail(ym);
        setMonthDetails((prev) => new Map(prev).set(ym, Array.isArray(rows) ? rows : []));
      } catch (err) {
        setMonthErrors((prev) => new Map(prev).set(ym, err.message || "Failed to load month detail"));
      } finally {
        setLoadingMonths((prev) => {
          const next = new Set(prev);
          next.delete(ym);
          return next;
        });
      }
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ background: "#1e3a8a", color: "#fff", padding: "10px 16px", fontWeight: 700, fontSize: "0.88rem", letterSpacing: "0.04em" }}>
          Invoicing Summary
        </div>
        {loading ? (
          <div style={{ padding: 60, textAlign: "center", color: "#94a3b8" }}>Loading…</div>
        ) : error ? (
          <div className="notice error" style={{ margin: 12 }}><span>!</span> {error}</div>
        ) : !years.length ? (
          <div style={{ padding: 60, textAlign: "center", color: "#94a3b8" }}>No invoicing dates set yet.</div>
        ) : (
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem" }}>
          <thead>
            <tr style={{ background: "#f8fafc", color: "#475569", fontSize: "0.72rem", textTransform: "uppercase" }}>
              <th style={{ padding: "8px 14px", textAlign: "left", borderBottom: "1px solid #e2e8f0" }}>Remarks</th>
              <th style={{ padding: "8px 14px", textAlign: "left", borderBottom: "1px solid #e2e8f0" }}>Payment Received Date</th>
              <th style={{ padding: "8px 14px", textAlign: "right", borderBottom: "1px solid #e2e8f0" }}>Invoiced Amount</th>
              <th style={{ padding: "8px 14px", textAlign: "right", borderBottom: "1px solid #e2e8f0" }}>VAT Amount</th>
              <th style={{ padding: "8px 14px", textAlign: "right", borderBottom: "1px solid #e2e8f0" }}>Total Invoice Amount</th>
            </tr>
          </thead>
          <tbody>
            {years.map((year) => {
              const yTotal = yearTotal(year);
              const yExpanded = expandedYears.has(year);
              return (
                <Fragment key={year}>
                  <tr onClick={() => toggleYear(year)} style={{ cursor: "pointer", background: "#eff6ff", borderTop: "1px solid #dbeafe" }}>
                    <td style={{ padding: "9px 14px", fontWeight: 700, color: "#1e40af" }}>
                      <span style={{ display: "inline-block", width: 14 }}>{yExpanded ? "▾" : "▸"}</span>
                      Total Payment Invoices in {year}
                    </td>
                    <td style={{ padding: "9px 14px" }} />
                    <td style={{ padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: "#1e40af" }}>{money.format(yTotal.invoiced_amount)}</td>
                    <td style={{ padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: "#1e40af" }}>{money.format(yTotal.vat_amount)}</td>
                    <td style={{ padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: "#1e40af" }}>{money.format(yTotal.total_amount)}</td>
                  </tr>
                  {yExpanded && byYear.get(year).map((m) => {
                    const mExpanded = expandedMonths.has(m.year_month);
                    const details = monthDetails.get(m.year_month);
                    const monthErr = monthErrors.get(m.year_month);
                    return (
                      <Fragment key={m.year_month}>
                        <tr onClick={() => toggleMonth(m.year_month)} style={{ cursor: "pointer", background: "#f8fafc", borderTop: "1px solid #f1f5f9" }}>
                          <td style={{ padding: "8px 14px 8px 34px", fontWeight: 600, color: "#334155" }}>
                            <span style={{ display: "inline-block", width: 14 }}>{mExpanded ? "▾" : "▸"}</span>
                            Sum of total invoices in {fmtYearMonthLabel(m.year_month)}
                          </td>
                          <td style={{ padding: "8px 14px" }} />
                          <td style={{ padding: "8px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money.format(m.invoiced_amount)}</td>
                          <td style={{ padding: "8px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money.format(m.vat_amount)}</td>
                          <td style={{ padding: "8px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{money.format(m.total_amount)}</td>
                        </tr>
                        {mExpanded && (
                          loadingMonths.has(m.year_month) ? (
                            <tr><td colSpan={5} style={{ padding: 16, textAlign: "center", color: "#94a3b8" }}>Loading…</td></tr>
                          ) : monthErr ? (
                            <tr><td colSpan={5} style={{ padding: "8px 14px", color: "#b91c1c" }}>{monthErr}</td></tr>
                          ) : (details || []).length === 0 ? (
                            <tr><td colSpan={5} style={{ padding: "8px 14px 8px 54px", color: "#94a3b8" }}>No invoice lines.</td></tr>
                          ) : (details || []).map((d) => (
                            <tr key={d.applied_date} style={{ borderTop: "1px solid #f8fafc" }}>
                              <td style={{ padding: "6px 14px 6px 54px", color: "#64748b", fontSize: "0.8rem" }}>
                                {d.applied_date ? `Payment Invoice Date ${fmtDayLabel(d.applied_date)}` : "Payment Invoice Date (unspecified)"}
                              </td>
                              <td style={{ padding: "6px 14px", color: "#64748b", fontSize: "0.8rem" }}>{d.payment_received_date || "—"}</td>
                              <td style={{ padding: "6px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money.format(d.invoiced_amount)}</td>
                              <td style={{ padding: "6px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money.format(d.vat_amount)}</td>
                              <td style={{ padding: "6px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money.format(d.total_amount)}</td>
                            </tr>
                          ))
                        )}
                      </Fragment>
                    );
                  })}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ background: "#f8fafc", borderTop: "2px solid #e2e8f0", fontWeight: 700 }}>
              <td style={{ padding: "9px 14px", color: "#0f172a" }} colSpan={2}>Grand Total</td>
              <td style={{ padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money.format(grandTotal.invoiced_amount)}</td>
              <td style={{ padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money.format(grandTotal.vat_amount)}</td>
              <td style={{ padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money.format(grandTotal.total_amount)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
        )}
      </div>

      <MonthlyRollupCard rows={monthlyRollup} loading={monthlyLoading} error={monthlyError} />
    </div>
  );
}

// Same MS1/MS2-by-Invoicing-Month figures as the PIC Dashboard's "Monthly
// Invoicing Roll-up" widget — shown here too since this page is where the
// PIC actually reviews invoicing detail, not just the dashboard.
function MonthlyRollupCard({ rows, loading, error }) {
  const sorted = useMemo(() => [...(rows || [])].sort((a, b) => a.invoice_month.localeCompare(b.invoice_month)), [rows]);
  const totals = sorted.reduce((acc, r) => ({
    ms1_invoiced: acc.ms1_invoiced + (Number(r.ms1_invoiced) || 0),
    ms2_invoiced: acc.ms2_invoiced + (Number(r.ms2_invoiced) || 0),
    total: acc.total + (Number(r.total) || 0),
    vat_amount: acc.vat_amount + (Number(r.vat_amount) || 0),
    total_amount: acc.total_amount + (Number(r.total_amount) || 0),
  }), { ms1_invoiced: 0, ms2_invoiced: 0, total: 0, vat_amount: 0, total_amount: 0 });

  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden" }}>
      <div style={{ background: "#0ea5e9", color: "#fff", padding: "10px 16px", fontWeight: 700, fontSize: "0.88rem", letterSpacing: "0.04em" }}>
        Monthly Invoicing Roll-up
      </div>
      {loading ? (
        <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Loading…</div>
      ) : error ? (
        <div className="notice error" style={{ margin: 12 }}><span>!</span> {error}</div>
      ) : !sorted.length ? (
        <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>No invoicing dates set yet.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
            <thead>
              <tr style={{ background: "#f8fafc", color: "#475569", fontSize: "0.7rem", textTransform: "uppercase" }}>
                <th style={{ padding: "7px 12px", textAlign: "left", borderBottom: "1px solid #e2e8f0" }}>Invoicing Month</th>
                <th style={{ padding: "7px 12px", textAlign: "right", borderBottom: "1px solid #e2e8f0" }}>First Payment</th>
                <th style={{ padding: "7px 12px", textAlign: "right", borderBottom: "1px solid #e2e8f0" }}>Second Payment</th>
                <th style={{ padding: "7px 12px", textAlign: "right", borderBottom: "1px solid #e2e8f0" }}>Total (excl. VAT)</th>
                <th style={{ padding: "7px 12px", textAlign: "right", borderBottom: "1px solid #e2e8f0" }}>VAT Amount</th>
                <th style={{ padding: "7px 12px", textAlign: "right", borderBottom: "1px solid #e2e8f0" }}>Total Invoice Amount</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => (
                <tr key={r.invoice_month} style={{ borderTop: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "6px 12px", color: "#334155" }}>({String(i + 1).padStart(2, "0")}) {fmtYearMonthLabel(r.invoice_month)}</td>
                  <td style={{ padding: "6px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{(r.ms1_invoiced || 0) > 0 ? money.format(r.ms1_invoiced) : <span style={{ color: "#cbd5e1" }}>—</span>}</td>
                  <td style={{ padding: "6px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{(r.ms2_invoiced || 0) > 0 ? money.format(r.ms2_invoiced) : <span style={{ color: "#cbd5e1" }}>—</span>}</td>
                  <td style={{ padding: "6px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{fmt.format(r.total || 0)}</td>
                  <td style={{ padding: "6px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#64748b" }}>{money.format(r.vat_amount || 0)}</td>
                  <td style={{ padding: "6px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{money.format(r.total_amount || 0)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: "#f8fafc", borderTop: "2px solid #e2e8f0", fontWeight: 700 }}>
                <td style={{ padding: "8px 12px", color: "#0f172a" }}>Grand Total</td>
                <td style={{ padding: "8px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money.format(totals.ms1_invoiced)}</td>
                <td style={{ padding: "8px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money.format(totals.ms2_invoiced)}</td>
                <td style={{ padding: "8px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt.format(totals.total)}</td>
                <td style={{ padding: "8px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#64748b" }}>{money.format(totals.vat_amount)}</td>
                <td style={{ padding: "8px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money.format(totals.total_amount)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────
export default function PICInvoicingSummary() {
  const navigate = useNavigate();
  const { role } = useAuth();
  const navigable = role === "pic";
  const [tab, setTab] = useState("split");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterOpts, setFilterOpts] = useState({ contract_models: [], invoice_months: [], subcontracts: [] });

  // Filters
  const [contractFilter, setContractFilter]   = useState([]);
  const [subcontractFilter, setSubcontract]   = useState([]);
  const [ms1MonthFilter, setMs1Month]         = useState([]);
  const [ms2MonthFilter, setMs2Month]         = useState([]);
  const [refreshKey, setRefreshKey]           = useState(0);

  const hasFilters = !!(contractFilter.length || subcontractFilter.length || ms1MonthFilter.length || ms2MonthFilter.length);

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
        if (contractFilter.length)    portal.contract_model    = contractFilter;
        if (subcontractFilter.length) portal.subcontract        = subcontractFilter;
        if (ms1MonthFilter.length)    portal.ms1_invoice_month = ms1MonthFilter;
        if (ms2MonthFilter.length)    portal.ms2_invoice_month = ms2MonthFilter;
        const res = await pmApi.picInvoicingSummary(portal);
        if (!cancelled) setData(res);
      } catch (err) {
        if (!cancelled) setError(err.message || "Failed to load summary");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [contractFilter, subcontractFilter, ms1MonthFilter, ms2MonthFilter, refreshKey]);

  const monthOptions      = (filterOpts.invoice_months || []).map((m) => ({ id: m, label: m }));
  const contractOptions   = (filterOpts.contract_models || []).map((m) => ({ id: m, label: m }));
  const subcontractOptions = filterOpts.subcontracts || [];

  return (
    <div>
      <div className="page-header">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {role !== "pic" && (
              <button type="button" className="btn-secondary" onClick={() => navigate(-1)}
                style={{ padding: "4px 10px", fontSize: "0.78rem" }}>← Back</button>
            )}
            <h1 className="page-title">Invoicing Summary</h1>
          </div>
          <div className="page-subtitle">
            {tab === "ledger"
              ? "Payment-dated invoicing ledger — year and month totals, drill into individual invoice lines"
              : "INET / Subcons split across MS1 & MS2 by PIC status"}
          </div>
        </div>
        <div className="page-actions">
          <button type="button" className="btn-secondary" onClick={() => setRefreshKey((k) => k + 1)} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      <div role="tablist" style={{ display: "flex", gap: 4, padding: 4, background: "#f1f5f9", borderRadius: 8, border: "1px solid #e2e8f0", margin: "0 16px 8px", width: "fit-content" }}>
        {[
          { id: "split", label: "INET / Subcon Split" },
          { id: "ledger", label: "Payment Ledger" },
        ].map((tt) => {
          const active = tab === tt.id;
          return (
            <button key={tt.id} type="button" role="tab" aria-selected={active} onClick={() => setTab(tt.id)}
              style={{ padding: "5px 14px", fontSize: "0.78rem", fontWeight: 700, border: "none", borderRadius: 6, cursor: "pointer", background: active ? "#1d4ed8" : "transparent", color: active ? "#fff" : "#475569" }}>
              {tt.label}
            </button>
          );
        })}
      </div>

      {tab === "split" && (
        <div className="toolbar" style={{ flexWrap: "wrap", gap: 8 }}>
          <SearchableSelect
              allowBlank
            multi value={contractFilter} onChange={setContractFilter}
            options={contractOptions} placeholder="All Contracts" minWidth={180}
          />
          <SearchableSelect
              allowBlank
            multi value={subcontractFilter} onChange={setSubcontract}
            options={subcontractOptions} placeholder="All Subcontracts" minWidth={200}
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
              setContractFilter([]); setSubcontract([]); setMs1Month([]); setMs2Month([]);
            }}>
              Clear
            </button>
          )}
        </div>
      )}

      {tab === "split" && error && (
        <div className="notice error" style={{ margin: "0 16px 8px" }}>
          <span>!</span> {error}
        </div>
      )}

      <div className="page-content">
        {tab === "ledger" ? (
          <PaymentLedgerTab refreshKey={refreshKey} />
        ) : data ? (
          <>
            <TopSummaryCard top={data.top} />
            <StatusTable
              title="MS1 — 1st Payment Milestone"
              rows={data.ms1_rows}
              statusOrder={data?.status_order || MS1_STATUS_ORDER}
              tone="blue"
              milestone="ms1"
              navigable={navigable}
            />
            <StatusTable
              title="MS2 — 2nd Payment Milestone"
              rows={data.ms2_rows}
              statusOrder={data?.status_order || MS1_STATUS_ORDER}
              tone="violet"
              milestone="ms2"
              navigable={navigable}
            />
          </>
        ) : loading ? (
          <div style={{ padding: 60, textAlign: "center", color: "#94a3b8" }}>Loading…</div>
        ) : null}
      </div>
    </div>
  );
}
