import { useEffect, useRef, useState } from "react";
import TrendLineChart from "./TrendLineChart";
import { MonthRangeFilter, MonthsBackFilter } from "./ChartFilters";
import ChartActions from "./ChartActions";
import { pmApi } from "../services/api";
import { money } from "../utils/numberFormat";

/**
 * The two order-to-cash trends from the old Commercial page, kept as they
 * were — each with its own range buttons, export menu and footnote — now
 * shown on the Executive page:
 *   · PO published value vs invoiced value (conversion %), any month range
 *   · monthly invoicing, trailing N months or all time
 * Both read get_po_vs_invoice_trend.
 */

const fmt = new Intl.NumberFormat("en-US");
const C = { blue: "#1565C0", amber: "#E06C00", teal: "#0D9488", green: "#2E7D32", gray: "#64748b" };
const sar = (v) => `SAR ${money.format(Number(v) || 0)}`;

const PO_SERIES = [
  { key: "po_value", name: "PO published value (SAR)", color: C.blue },
  { key: "invoiced", name: "Invoiced value (SAR)", color: C.amber, dashed: true },
];
const INV_SERIES = [
  { key: "invoiced", name: "Invoiced (SAR)", color: C.teal, showLabels: true },
];

/* The PO series dates each line by the first basis that is present: the date
   it was uploaded, then the customer's publish date, then the PO start date.
   Only the buckets that actually carry lines are named. */
function poDateBasisText(b) {
  const parts = [
    [b.upload_date, "PO upload date"],
    [b.publish_date, "publish date"],
    [b.start_date, "PO start date"],
    [b.creation, "record creation date"],
  ].filter(([n]) => Number(n) > 0);
  if (!parts.length) return "the PO upload date";
  return parts
    .map(([n, label], i) => `${i ? "otherwise " : ""}${label} (${fmt.format(n)} lines)`)
    .join(", ");
}

function Panel({ title, eyebrow, right, children, note, innerRef }) {
  return (
    <div className="nd-panel" ref={innerRef}>
      <div className="nd-panel-header tinted" style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div>
          {eyebrow && <div className="nd-panel-eyebrow">{eyebrow}</div>}
          <h3>{title}</h3>
        </div>
        {right}
      </div>
      <div className="nd-panel-body">
        {children}
        {note && <div className="nd-panel-note">{note}</div>}
      </div>
    </div>
  );
}

const Loading = ({ h }) => (
  <div style={{ height: h, display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontSize: 12 }}>Loading…</div>
);

export default function OrderToCashCharts() {
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
    setPoLoading(true);
    pmApi.getPoVsInvoiceTrend({ from_date: poRange.from, to_date: poRange.to })
      .then((res) => { if (!cancelled) setPoTrend(res); })
      .catch(() => { if (!cancelled) setPoTrend(null); })
      .finally(() => { if (!cancelled) setPoLoading(false); });
    return () => { cancelled = true; };
  }, [poRange.from, poRange.to]);

  useEffect(() => {
    let cancelled = false;
    setInvLoading(true);
    pmApi.getPoVsInvoiceTrend({ months: invMonths })
      .then((res) => { if (!cancelled) setInvTrend(res); })
      .catch(() => { if (!cancelled) setInvTrend(null); })
      .finally(() => { if (!cancelled) setInvLoading(false); });
    return () => { cancelled = true; };
  }, [invMonths]);

  const poRangeLabel = poTrend?.range?.from_month
    ? `${poTrend.range.from_month} → ${poTrend.range.to_month || "now"}`
    : "all time";
  const invTitle = invMonths ? `Monthly Invoicing — Last ${invMonths} Months` : "Monthly Invoicing — All Time";

  return (
    <>
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
          <>PO month = {poDateBasisText(poTrend.po_date_basis)}.
          Invoiced = full MS1/MS2 amount for milestones at Commercial Invoice Submitted or Closed, placed on their invoicing month.
          {poTrend?.undated_invoiced > 0 && <> A further {sar(poTrend.undated_invoiced)} is invoiced but has no invoicing month recorded, so it cannot be placed on any month here.</>}</>
        )}
      >
        {poLoading && !poTrend ? <Loading h={340} /> : (
          <TrendLineChart height={340} data={poTrend?.series || []} series={PO_SERIES} area />
        )}
      </Panel>

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
        {invLoading && !invTrend ? <Loading h={300} /> : (
          <TrendLineChart height={300} data={invTrend?.series || []} series={INV_SERIES} showYAxis={false} area />
        )}
      </Panel>
    </>
  );
}
