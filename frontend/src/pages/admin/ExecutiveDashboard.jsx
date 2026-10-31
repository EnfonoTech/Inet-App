import { useEffect, useMemo, useState } from "react";
import DashboardSwitcher from "../../components/DashboardSwitcher";
import SearchableSelect from "../../components/SearchableSelect";
import { Card, ChartCard, Tile, TopTable, fmt } from "../../components/ReportDashboard";
import OrderToCashCharts from "../../components/OrderToCashCharts";
import { pmApi } from "../../services/api";
import { MONTH_OPTIONS as MONTHS, isoMonth, monthBounds, prevMonth, shortMonth as short } from "../../utils/months";

/**
 * Executive — CEO View and Commercial merged into one page.
 *
 * Two periods, and every figure says which one it is:
 *   · the chosen MONTH — revenue, cost, profit, target, IMs, teams, alerts —
 *     straight from the Command payload for that month, so the two pages agree;
 *   · ALL TIME — invoicing, order book, projects, subcontracts — from the
 *     commercial payload (the PIC computation), which has no month.
 * The old CEO page put a this-month revenue next to an all-time unbilled
 * figure with nothing to tell them apart, read its cost from a key the
 * payload never had (always SAR 0), and coloured every alert red.
 */

const n = (v) => Number(v) || 0;
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const sar = (v) => `SAR ${fmt(v, "int")}`;

// Command watchlist statuses → one colour each. The old page compared them
// in lower case against values that are capitalised, so nothing ever matched.
const STATUS = {
  Optimized: { bg: "#e6f4ea", fg: "#15803d", bd: "#cfe8d6" },
  Behind: { bg: "#fff4e0", fg: "#9a4d00", bd: "#f6d4bf" },
  Recover: { bg: "#fdecec", fg: "#b42318", bd: "#f3c7c3" },
};
const watchValue = (w) => (w.unit === "sar" ? sar(w.current) : w.unit === "pct" ? fmt(w.current, "pct") : fmt(w.current, "int"));

function Bar3({ label, done, target }) {
  const p = pct(n(done), n(target));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem" }}>
        <span>{label}</span>
        <span><b>{sar(done)}</b> <span className="rdash-muted">of {sar(target)}</span></span>
      </div>
      <div style={{ height: 10, background: "#eef2f7", borderRadius: 5 }}>
        <div style={{ width: `${Math.min(p, 100)}%`, height: "100%", borderRadius: 5, background: p >= 90 ? "#15803d" : p >= 60 ? "#e0a320" : "#b42318" }} />
      </div>
      <div className="rdash-muted" style={{ textAlign: "right" }}>{p}% of target to date</div>
    </div>
  );
}

export default function ExecutiveDashboard() {
  const [month, setMonth] = useState(isoMonth(new Date()));
  const [cmd, setCmd] = useState(null);
  const [prev, setPrev] = useState(null);
  const [com, setCom] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);

  // The month's Command payload gates the page; last month (for the "vs"
  // line) and the all-time commercial payload fill in as they land.
  useEffect(() => {
    let cancelled = false;
    const { from, to } = monthBounds(month);
    const p = monthBounds(prevMonth(month));
    setLoading(true);
    setError(null);
    setPrev(null);
    pmApi.getCommandDashboard({ from_date: from, to_date: to })
      .then((d) => { if (!cancelled) setCmd(d); })
      .catch((e) => { if (!cancelled) { setCmd(null); setError(e?.message || "Could not load the dashboard."); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    pmApi.getCommandDashboard({ from_date: p.from, to_date: p.to })
      .then((d) => { if (!cancelled) setPrev(d); }).catch(() => {});
    return () => { cancelled = true; };
  }, [month, reload]);

  useEffect(() => {
    let cancelled = false;
    pmApi.getCommercialDashboard().then((d) => { if (!cancelled) setCom(d); }).catch(() => {});
    return () => { cancelled = true; };
  }, [reload]);


  const mon = short(month);
  const c = cmd?.company || {};
  const inet = cmd?.inet || {};
  const sub = cmd?.subcon || {};
  const kpi = com?.kpi || {};
  const book = com?.order_book || {};
  const split = com?.inet_subcon || {};

  const revenue = n(c.total_revenue);
  const prevRevenue = prev ? n(prev.company?.total_revenue) : null;
  const delta = prevRevenue ? Math.round(((revenue - prevRevenue) / prevRevenue) * 1000) / 10 : null;
  const deltaText = delta === null ? null : `${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta)}% vs ${short(prevMonth(month))}`;

  const charts = useMemo(() => ({
    charts: [
      {
        kind: "donut", title: "Who earns the revenue", format: "money", x: "label", centerLabel: "SAR invoiced", sub: "all time",
        data: [
          { label: "INET", value: n(split.inet_total), color: "#1d5fd1" },
          { label: "Subcontractors", value: n(split.subcon_total), color: "#e08a2c" },
        ],
        series: [{ key: "value", label: "SAR" }],
        note: `MS1 ${sar(split.total_ms1)} · MS2 ${sar(split.total_ms2)}`,
      },
    ],
  }), [split]);

  const teams = useMemo(() => (cmd?.top_teams || []).map((t) => ({ ...t, label: t.team_name || t.team })), [cmd]);
  const ims = useMemo(() => (cmd?.im_performance || []).map((r) => ({
    ...r, im: r.im_full_name || r.im, margin_pct: n(r.revenue) ? pct(n(r.profit), n(r.revenue)) : 0,
  })), [cmd]);
  const projects = useMemo(() => (com?.per_project || []).slice(0, 10).map((p) => ({
    ...p, project: p.project_code, billed_pct: pct(n(p.invoiced), n(p.invoiced) + n(p.backlog)),
  })), [com]);
  const byIm = useMemo(() => (com?.per_im || []).slice(0, 10).map((r) => ({ ...r, im: r.im_full_name || r.im })), [com]);
  // INET's own contracts are not subcontracts; they were three of the top rows.
  const subs = useMemo(() => (com?.per_subcontract || []).filter((r) => r.type !== "INET").slice(0, 10), [com]);

  return (
    <div className="nd-dashboard">
      <DashboardSwitcher />
      <div className="page-header" style={{ padding: 0, marginBottom: 12 }}>
        <div>
          <h1 className="page-title">Executive</h1>
          <div className="page-subtitle">Is the business earning, billing and collecting — and who is driving it</div>
        </div>
        <div className="page-actions" style={{ gap: 8 }}>
          <SearchableSelect value={month} onChange={(v) => setMonth(v || isoMonth(new Date()))} options={MONTHS} placeholder="Month" minWidth={180} />
          <button type="button" className="btn-secondary" disabled={loading} onClick={() => setReload((k) => k + 1)}>{loading ? "Loading…" : "Refresh"}</button>
        </div>
      </div>

      {error && <div className="notice error"><span>⚠</span> {error}</div>}
      {!cmd && !error && <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Loading…</div>}

      {cmd && (
        <div className="rdash">
          <div className="rdash-tiles">
            <Tile icon="money" tone="green" label={`Revenue (SAR) · ${mon}`} value={fmt(revenue, "int")} sub={deltaText || "INET + subcontracted work"} />
            <Tile icon="clock" tone="amber" label={`Cost to date (SAR) · ${mon}`} value={fmt(c.total_cost_today, "int")} sub={`INET ${fmt(inet.inet_cost_today, "int")} · subcon ${fmt(sub.sub_expense, "int")}`} />
            <Tile icon={n(c.profit_loss) < 0 ? "down" : "up"} tone={n(c.profit_loss) < 0 ? "red" : "green"} label={`Net profit (SAR) · ${mon}`} value={fmt(c.profit_loss, "int")} sub={`margin ${fmt(pct(n(c.profit_loss), revenue), "pct")}`} />
            <Tile icon="target" tone="blue" label={`Target coverage · ${mon}`} value={fmt(c.coverage_pct, "pct")} sub={`of ${sar(c.company_target)} · day ${fmt(c.day_progress_pct, "int")}%`} />
            <Tile icon="doc" tone="blue" label="Invoiced (SAR) · all time" value={fmt(kpi.total_invoiced, "int")} sub={com ? `${fmt(kpi.billed_pct, "pct")} of booked value` : "loading…"} />
            <Tile icon="alert" tone="amber" label="Not yet invoiced (SAR) · all time" value={fmt(kpi.backlog, "int")} sub={com ? "booked value still to invoice" : "loading…"} />
          </div>

          <div className="rdash-row rdash-row-2">
            <Card title={`${mon} vs target`} aside={<span className="rdash-muted">target to date</span>}>
              <div style={{ padding: "6px 16px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
                <Bar3 label="Company" done={c.total_revenue} target={c.total_target_today} />
                <Bar3 label="INET teams" done={inet.inet_achieved} target={inet.inet_target_today} />
                <Bar3 label="Subcontractors" done={sub.sub_revenue} target={sub.sub_target} />
                <div className="rdash-muted">Gap to date {sar(c.company_gap)} · {fmt(inet.active_inet_teams, "int")} INET and {fmt(sub.active_sub_teams, "int")} subcon teams active</div>
              </div>
            </Card>
            <ChartCard chart={charts.charts[0]} />
          </div>

          <div className="rdash-row rdash-row-3">
            <Card title={`IM performance · ${mon}`}>
              <TopTable rowKey="im" rows={ims} empty="No IM activity" cols={[
                { key: "im", label: "IM" },
                { key: "revenue", label: "Revenue", num: true },
                { key: "profit", label: "Profit", num: true },
                { key: "margin_pct", label: "Margin", render: (r) => (n(r.revenue) ? <span style={{ color: n(r.profit) < 0 ? "#b42318" : "#15803d", fontWeight: 700 }}>{fmt(r.margin_pct, "pct")}</span> : <span className="rdash-muted">—</span>) },
              ]} />
            </Card>
            <ChartCard chart={{
              kind: "hbar", title: `Top teams by profit · ${mon}`, format: "money", x: "label",
              data: [...teams].sort((a, b) => n(b.profit) - n(a.profit)),
              series: [{ key: "profit", label: "Profit" }],
            }} />
            <Card title="Needs attention" aside={<span className="rdash-muted">{mon}</span>}>
              <div style={{ padding: "4px 14px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
                {(cmd.watchlist || []).length === 0 && <div className="rdash-muted">Nothing flagged.</div>}
                {(cmd.watchlist || []).map((w) => {
                  const st = STATUS[w.status] || STATUS.Behind;
                  return (
                    <div key={w.indicator} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "9px 12px", border: `1px solid ${st.bd}`, background: "#fff", borderRadius: 9 }}>
                      <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                        <b style={{ fontSize: "0.8rem" }}>{w.indicator}</b>
                        <span className="rdash-muted">{watchValue(w)}</span>
                      </span>
                      <span style={{ background: st.bg, color: st.fg, fontSize: "0.68rem", fontWeight: 700, padding: "3px 9px", borderRadius: 999, whiteSpace: "nowrap" }}>{w.status}</span>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginTop: 6, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 800, color: "#0f1e36" }}>Commercial · all time</h2>
          </div>
          <OrderToCashCharts />
          {!com && <div className="rdash-muted">Loading commercial figures…</div>}
          {com && (
            <>
              <div className="rdash-tiles">
                <Tile icon="doc" tone="blue" label="Booked value (SAR)" value={fmt(kpi.booked_value, "int")} sub={`${fmt(kpi.line_count, "int")} lines`} />
                <Tile icon="done" tone="green" label="Invoiced (SAR)" value={fmt(kpi.total_invoiced, "int")} sub={`MS1 ${fmt(kpi.invoiced_ms1, "int")} · MS2 ${fmt(kpi.invoiced_ms2, "int")}`} />
                <Tile icon="money" tone="green" label="Invoice closed (SAR)" value={fmt(kpi.paid, "int")} sub={`${fmt(kpi.collected_pct, "pct")} of invoiced`} />
                <Tile icon="clock" tone="amber" label="Not yet invoiced (SAR)" value={fmt(kpi.backlog, "int")} sub={`${fmt(kpi.billed_pct, "pct")} invoiced so far`} />
                <Tile icon="folder" tone="grey" label="Open order book (SAR)" value={fmt(book.open_value, "int")} sub={`${fmt(book.open_lines, "int")} lines not yet done`} />
              </div>
              <div className="rdash-row rdash-row-3">
                <Card title="Top projects" aside={<span className="rdash-muted">by invoiced</span>}>
                  <TopTable rowKey="project" rows={projects} cols={[
                    { key: "project", label: "Project" }, { key: "invoiced", label: "Invoiced", num: true },
                    { key: "backlog", label: "Not invoiced", num: true }, { key: "billed_pct", label: "Invoiced %", pct: true },
                  ]} />
                </Card>
                <Card title="Invoicing by IM">
                  <TopTable rowKey="im" rows={byIm} cols={[
                    { key: "im", label: "IM" }, { key: "line_count", label: "Lines", num: true },
                    { key: "invoiced", label: "Invoiced", num: true }, { key: "backlog", label: "Not invoiced", num: true },
                  ]} />
                </Card>
                <Card title="Subcontracts" aside={<span className="rdash-muted">top 10 by invoiced</span>}>
                  <TopTable rowKey="sub_key" rows={subs} cols={[
                    { key: "subcontractor_name", label: "Subcontract" }, { key: "invoiced", label: "Invoiced", num: true },
                    { key: "payout", label: "Payout", num: true },
                    { key: "margin_pct", label: "INET %", render: (r) => fmt(r.margin_pct, "pct") },
                  ]} />
                </Card>
              </div>
            </>
          )}
          {cmd.last_updated && <div className="rdash-muted">Last updated {String(cmd.last_updated).replace("T", " ").slice(0, 16)}</div>}
        </div>
      )}
    </div>
  );
}
