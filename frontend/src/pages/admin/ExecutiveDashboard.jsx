import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import DashboardSwitcher from "../../components/DashboardSwitcher";
import DateRangePicker, { DATE_PRESETS } from "../../components/DateRangePicker";
import { Card, ChartCard, Tile, TopTable, fmt } from "../../components/ReportDashboard";
import OrderToCashCharts from "../../components/OrderToCashCharts";
import { pmApi } from "../../services/api";
import DashHeader from "../../components/DashHeader";

/**
 * Executive — CEO View and Commercial merged into one page.
 *
 * Two periods, and every figure says which one it is:
 *   · the chosen DATE RANGE (the app's standard picker) — revenue, cost,
 *     profit, target, IMs, teams, alerts straight from the Command payload
 *     for that range, so the two pages agree; invoicing and PO intake in the
 *     range from get_executive_extras;
 *   · AS OF TODAY — order book, not yet invoiced, projects, subcontracts —
 *     stock figures with no date to filter on (see get_commercial_dashboard).
 * The old CEO page put a this-month revenue next to an all-time unbilled
 * figure with nothing to tell them apart, read its cost from a key the
 * payload never had (always SAR 0), and coloured every alert red.
 *
 * Audit, 2 Nov 2026:
 *   · The Subcontractors bar measured month-to-date revenue against the
 *     WHOLE month's target, and "Gap to date" was the whole-month gap; both
 *     now use the target to date, like the Company and INET bars.
 *   · The bars now add up to the Company figure: Direct Close / Backend on
 *     INET's side is part of Revenue but was in neither bar.
 *   · "Top teams by profit" took the five biggest by REVENUE and re-sorted
 *     them, so three of its five were loss-making while the real top earners
 *     were missing. It now reads the whole Top Teams report.
 *   · The month-on-month "vs" compared a month in progress with a whole
 *     month; it now compares the same days.
 *   · The two all-time tiles at the top repeated the Commercial row below;
 *     they are replaced by the month's invoicing and PO intake.
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

// Team profit bars, red where the team lost money.
function TeamProfitBars({ data }) {
  const max = Math.max(1, ...data.map((d) => Math.abs(d.profit)));
  return (
    <div style={{ padding: "6px 14px 14px", display: "flex", flexDirection: "column", gap: 5 }}>
      {data.length === 0 && <div className="rdash-muted">No team activity</div>}
      {data.map((d, i) => (
        <div key={`${d.label}-${i}`} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 1fr) 70px", alignItems: "center", gap: 8, fontSize: "0.76rem" }}>
          <span title={d.label} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#33445e" }}>{d.label}</span>
          <span style={{ height: 10, background: "#eef2f7", borderRadius: 5 }}>
            <span style={{ display: "block", width: `${(Math.abs(d.profit) / max) * 100}%`, height: "100%", borderRadius: 5, background: d.profit < 0 ? "#d9534f" : "#15803d" }} />
          </span>
          <b style={{ textAlign: "right", color: d.profit < 0 ? "#b42318" : "#15803d" }}>{fmt(d.profit, "int")}</b>
        </div>
      ))}
    </div>
  );
}

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

const pad = (v) => String(v).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (v) => new Date(`${v}T00:00:00`);
const monShort = (d) => d.toLocaleString("en", { month: "short" });
const isMonthEnd = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getDate() === 1;

function defaultRange() {
  const r = DATE_PRESETS.this_month.range(new Date());
  return { from: iso(r.from), to: iso(r.to) };
}

// "Oct", "5–20 Oct", "Jul – Sep", "28 Sep – 4 Oct".
function rangeLabel(from, to) {
  if (!from || !to) return "";
  const f = parse(from), t = parse(to);
  const sameMonth = f.getMonth() === t.getMonth() && f.getFullYear() === t.getFullYear();
  if (f.getDate() === 1 && isMonthEnd(t)) return sameMonth ? monShort(f) : `${monShort(f)} – ${monShort(t)}`;
  if (sameMonth) return `${f.getDate()}–${t.getDate()} ${monShort(f)}`;
  return `${f.getDate()} ${monShort(f)} – ${t.getDate()} ${monShort(t)}`;
}

// The period before, like for like (the IM dashboard's rule): a range from
// the 1st compares with the same days of the month(s) before — "this month
// so far" (1–2 Nov) with 1–2 Oct, October with September; any other range
// with the same number of days just before it. Measured to today only.
function prevSpan(from, to) {
  const f = parse(from);
  const today = parse(iso(new Date()));
  let t = parse(to);
  if (t > today) t = today < f ? f : today;
  if (f.getDate() === 1) {
    const months = (t.getFullYear() - f.getFullYear()) * 12 + t.getMonth() - f.getMonth() + 1;
    const pf = new Date(f.getFullYear(), f.getMonth() - months, 1);
    const lastOfPt = new Date(t.getFullYear(), t.getMonth() - months + 1, 0);
    const pt = isMonthEnd(t) ? lastOfPt : new Date(lastOfPt.getFullYear(), lastOfPt.getMonth(), Math.min(t.getDate(), lastOfPt.getDate()));
    return { from: iso(pf), to: iso(pt) };
  }
  const days = Math.round((t - f) / 86400000) + 1;
  return { from: iso(new Date(f.getFullYear(), f.getMonth(), f.getDate() - days)), to: iso(new Date(f.getFullYear(), f.getMonth(), f.getDate() - 1)) };
}

export default function ExecutiveDashboard() {
  const navigate = useNavigate();
  const [range, setRange] = useState(defaultRange);
  const [cmd, setCmd] = useState(null);
  const [prev, setPrev] = useState(null);
  const [extras, setExtras] = useState(null);
  const [prevExtras, setPrevExtras] = useState(null);
  const [teamRows, setTeamRows] = useState(null);
  const [com, setCom] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);

  // The range's Command payload gates the page; the period before (for the
  // "vs" lines), the extras and the team report fill in as they land.
  useEffect(() => {
    let cancelled = false;
    const { from, to } = range;
    const p = prevSpan(from, to);
    setLoading(true);
    setError(null);
    setPrev(null);
    setExtras(null);
    setPrevExtras(null);
    setTeamRows(null);
    pmApi.getCommandDashboard({ from_date: from, to_date: to })
      .then((d) => { if (!cancelled) setCmd(d); })
      .catch((e) => { if (!cancelled) { setCmd(null); setError(e?.message || "Could not load the dashboard."); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    pmApi.getCommandDashboard({ from_date: p.from, to_date: p.to })
      .then((d) => { if (!cancelled) setPrev(d); }).catch(() => {});
    pmApi.getExecutiveExtras({ from_date: from, to_date: to })
      .then((d) => { if (!cancelled) setExtras(d); }).catch(() => { if (!cancelled) setExtras({}); });
    pmApi.getExecutiveExtras({ from_date: p.from, to_date: p.to })
      .then((d) => { if (!cancelled) setPrevExtras(d); }).catch(() => {});
    // Every team in the range (cost is charged up to today), so best and
    // worst by profit are both real.
    pmApi.reportTopTeams({ from_date: from, to_date: to })
      .then((r) => { if (!cancelled) setTeamRows(r?.data || []); }).catch(() => { if (!cancelled) setTeamRows([]); });
    return () => { cancelled = true; };
  }, [range.from, range.to, reload]);

  useEffect(() => {
    let cancelled = false;
    pmApi.getCommercialDashboard().then((d) => { if (!cancelled) setCom(d); }).catch(() => {});
    return () => { cancelled = true; };
  }, [reload]);

  const mon = rangeLabel(range.from, range.to);
  const span = prevSpan(range.from, range.to);
  const prevLabel = rangeLabel(span.from, span.to);
  const c = cmd?.company || {};
  const inet = cmd?.inet || {};
  const sub = cmd?.subcon || {};
  const kpi = com?.kpi || {};
  const book = com?.order_book || {};
  const inv = extras?.invoiced || {};
  const po = extras?.po_received || {};

  const revenue = n(c.total_revenue);
  const deltaOf = (now, before, money = true) => {
    if (before == null) return undefined;
    const was = money ? sar(before) : fmt(before, "int");
    if (!n(before)) return { text: `${was} in ${prevLabel}`, dir: "flat" };
    const ch = ((n(now) - n(before)) / n(before)) * 100;
    return { text: `${ch >= 0 ? "▲" : "▼"} ${Math.abs(ch).toFixed(0)}% vs ${prevLabel} (${was})`, dir: Math.abs(ch) < 0.5 ? "flat" : ch > 0 ? "up" : "down" };
  };
  // Targets to date, so the three bars and the gap use one basis.
  const subTargetToday = n(sub.sub_target_today);
  const gapToDate = n(c.company_gap_today);
  const shortcutInet = n(cmd?.direct_close?.inet_revenue) + n(cmd?.backend?.close_inet_revenue);
  const paidOut = n(c.deduction_paid_out);
  const toCommand = () => navigate("/dashboard", { state: { range: { from: range.from, to: range.to } } });
  const go = (path) => () => navigate(path);

  // Teams paid in the range that did no work at all.
  const idlePaid = useMemo(() => (teamRows || [])
    .filter((t) => n(t.team_cost) > 0 && !n(t.revenue) && !n(t.assigned_lines))
    .sort((a, b) => n(b.team_cost) - n(a.team_cost)), [teamRows]);

  // Command's watchlist, plus the teams paid with no work. Its Subcontractor
  // gap is to date now, like the INET gap beside it.
  const watch = useMemo(() => {
    const out = [...(cmd?.watchlist || [])];
    if (idlePaid.length) {
      out.push({
        indicator: `Teams paid with no work · ${idlePaid.length}`, unit: "sar", status: "Behind",
        current: idlePaid.reduce((a, t) => a + n(t.team_cost), 0),
        names: idlePaid.slice(0, 4).map((t) => t.team_name).join(", ") + (idlePaid.length > 4 ? ` +${idlePaid.length - 4}` : ""),
        onClick: go(`/reports?tab=top_teams&from=${range.from}&to=${range.to}`),
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cmd, idlePaid, range.from, range.to]);

  const donut = useMemo(() => ({
    kind: "donut", title: "Who earns the invoiced value", format: "money", x: "label", centerLabel: "SAR invoiced", sub: mon,
    data: [
      { label: "INET keeps", value: n(inv.inet_total), color: "#1d5fd1" },
      { label: "Paid to subcontractors", value: n(inv.subcon_total), color: "#e08a2c" },
    ],
    series: [{ key: "value", label: "SAR" }],
    note: `MS1 ${sar(inv.total_ms1)} · MS2 ${sar(inv.total_ms2)} · customer invoices dated in the range`,
  }), [inv, mon]);

  const teamProfit = useMemo(() => {
    const rows = (teamRows || []).filter((t) => n(t.revenue) || n(t.team_cost))
      .map((t) => ({ label: t.team_name, profit: n(t.profit) }))
      .sort((a, b) => b.profit - a.profit);
    if (rows.length <= 10) return rows;
    return [...rows.slice(0, 5), ...rows.slice(-5)];
  }, [teamRows]);
  const losing = (teamRows || []).filter((t) => n(t.profit) < 0).length;
  const activeTeams = (teamRows || []).filter((t) => n(t.revenue) || n(t.team_cost)).length;

  // Command's Revenue and Cost split by IM: the rows add up to the tiles.
  const ims = useMemo(() => {
    const rows = (extras?.revenue_by_im || []).map((r) => ({
      ...r, key: r.im || "-", margin_pct: n(r.revenue) ? pct(n(r.profit), n(r.revenue)) : 0,
    }));
    if (!rows.length) return rows;
    const tot = rows.reduce((a, r) => ({ revenue: a.revenue + n(r.revenue), cost: a.cost + n(r.cost), profit: a.profit + n(r.profit) }), { revenue: 0, cost: 0, profit: 0 });
    return [...rows, { key: "__total", im_full_name: "Total", ...tot, margin_pct: tot.revenue ? pct(tot.profit, tot.revenue) : 0, total: true }];
  }, [extras]);

  const projects = useMemo(() => (com?.per_project || []).slice(0, 10).map((p) => ({
    ...p, project: p.project_code, billed_pct: pct(n(p.invoiced), n(p.invoiced) + n(p.backlog)),
  })), [com]);
  const byIm = useMemo(() => (com?.per_im || []).slice(0, 10).map((r) => ({ ...r, im: r.im_full_name || r.im })), [com]);
  // INET's own contracts are not subcontracts; they were three of the top rows.
  const subs = useMemo(() => (com?.per_subcontract || []).filter((r) => r.type !== "INET").slice(0, 10), [com]);

  return (
    <div className="nd-dashboard">
      <DashboardSwitcher />
      <DashHeader title="Executive" hint="Is the business earning, billing and collecting — and who is driving it" lastUpdated={cmd?.last_updated}>
        <DateRangePicker value={range} onChange={(r) => setRange({ from: r.from, to: r.to })} />
        <button type="button" className="btn-secondary" disabled={loading} onClick={() => setReload((k) => k + 1)}>{loading ? "Loading…" : "Refresh"}</button>
      </DashHeader>

      {error && <div className="notice error"><span>⚠</span> {error}</div>}
      {!cmd && !error && <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Loading…</div>}

      {cmd && (
        <div className="rdash">
          <div className="rdash-tiles">
            <Tile icon="money" tone="green" label={`Revenue (SAR) · ${mon}`} value={fmt(revenue, "int")} sub="INET + subcontracted work"
              delta={prev ? deltaOf(revenue, n(prev.company?.total_revenue)) : undefined} onClick={toCommand} title="Open the Command dashboard on this range" />
            <Tile icon="clock" tone="amber" label={`Cost to date (SAR) · ${mon}`} value={fmt(c.total_cost_today, "int")} onClick={toCommand}
              sub={`INET teams ${fmt(inet.inet_cost_today, "int")} · subcon ${fmt(sub.sub_expense, "int")}${paidOut ? ` · paid out ${fmt(paidOut, "int")}` : ""}`} />
            <Tile icon={n(c.profit_loss) < 0 ? "down" : "up"} tone={n(c.profit_loss) < 0 ? "red" : "green"} label={`Net profit (SAR) · ${mon}`} value={fmt(c.profit_loss, "int")}
              sub={`margin ${fmt(pct(n(c.profit_loss), revenue), "pct")}`} onClick={toCommand} />
            <Tile icon="target" tone="blue" label={`Target coverage · ${mon}`} value={fmt(c.coverage_pct, "pct")} onClick={toCommand}
              sub={`of ${sar(c.company_target)} · ${fmt(c.day_progress_pct, "int")}% of the range gone`} />
            <Tile icon="doc" tone="blue" label={`Invoiced (SAR) · ${mon}`} value={extras ? fmt(n(inv.total), "int") : "…"}
              sub="customer invoices dated in the range"
              delta={extras && prevExtras ? deltaOf(inv.total, n(prevExtras.invoiced?.total)) : undefined} />
            <Tile icon="folder" tone="grey" label={`PO received (SAR) · ${mon}`} value={extras ? fmt(n(po.value), "int") : "…"}
              sub={extras ? `${fmt(n(po.lines), "int")} lines published` : ""}
              delta={extras && prevExtras ? deltaOf(po.value, n(prevExtras.po_received?.value)) : undefined} />
          </div>

          <div className="rdash-row rdash-row-2">
            <Card title={`${mon} vs target`} aside={<span className="rdash-muted">target to date</span>}>
              <div style={{ padding: "6px 16px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
                <Bar3 label="Company" done={c.total_revenue} target={c.total_target_today} />
                <Bar3 label="INET teams" done={inet.inet_achieved} target={inet.inet_target_today} />
                <Bar3 label="Subcontractors" done={sub.sub_revenue} target={subTargetToday} />
                <div className="rdash-muted">
                  + Direct Close &amp; Backend, INET side {sar(shortcutInet)} (no separate target) — the three add up to the Company figure.
                </div>
                <div className="rdash-muted">
                  {gapToDate > 0 ? `Gap to date ${sar(gapToDate)}` : `Ahead of target to date by ${sar(-gapToDate)}`}
                  {" · "}whole-range target {sar(c.company_target)}
                  {" · "}{fmt(inet.inet_cost_teams, "int")} INET teams on payroll, {fmt(sub.active_sub_teams, "int")} active subcontracts
                </div>
              </div>
            </Card>
            {extras ? <ChartCard chart={donut} /> : <Card title="Who earns the invoiced value"><div className="rdash-muted" style={{ padding: 14 }}>Loading…</div></Card>}
          </div>

          <div className="rdash-row rdash-row-3">
            <Card title={`Revenue & profit by IM · ${mon}`} aside={<span className="rdash-muted">adds up to the tiles</span>}>
              {!extras ? <div className="rdash-muted" style={{ padding: 14 }}>Loading…</div> : (
                <TopTable rowKey="key" rows={ims} empty="No IM activity" cols={[
                  { key: "im_full_name", label: "IM", render: (r) => (r.total ? <b>Total</b> : <span title={`INET teams ${fmt(r.inet_work, "int")} · Direct/Backend ${fmt(r.shortcut_inet, "int")} · Subcon ${fmt(r.subcon, "int")} · Salary ${fmt(r.salary, "int")} · Payout ${fmt(r.payout, "int")}`}>{r.im_full_name}</span>) },
                  { key: "revenue", label: "Revenue", num: true },
                  { key: "cost", label: "Cost", num: true },
                  { key: "profit", label: "Profit", render: (r) => <span style={{ color: n(r.profit) < 0 ? "#b42318" : "#15803d", fontWeight: 700 }}>{fmt(r.profit, "int")}</span> },
                ]} />
              )}
            </Card>
            <Card title={`Team profit · ${mon}`} aside={<button type="button" className="rdash-link" onClick={go(`/reports?tab=top_teams&from=${range.from}&to=${range.to}`)}>Top Teams →</button>}>
              <div className="rdash-muted" style={{ padding: "0 14px" }}>
                {teamRows == null ? "Loading…" : `Best 5 and worst 5 · ${losing} of ${activeTeams} teams made a loss`}
              </div>
              {teamRows != null && <TeamProfitBars data={teamProfit} />}
            </Card>
            <Card title="Needs attention" aside={<span className="rdash-muted">{mon} · idle teams are today</span>}>
              <div style={{ padding: "4px 14px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
                {watch.length === 0 && <div className="rdash-muted">Nothing flagged.</div>}
                {watch.map((w) => {
                  const st = STATUS[w.status] || STATUS.Behind;
                  const Tag = w.onClick ? "button" : "div";
                  return (
                    <Tag key={w.indicator} type={w.onClick ? "button" : undefined} onClick={w.onClick}
                      style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "9px 12px", border: `1px solid ${st.bd}`, background: "#fff", borderRadius: 9, font: "inherit", textAlign: "left", cursor: w.onClick ? "pointer" : "default" }}>
                      <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                        <b style={{ fontSize: "0.8rem" }}>{w.indicator}</b>
                        <span className="rdash-muted">{watchValue(w)}{w.names ? ` · ${w.names}` : ""}</span>
                      </span>
                      <span style={{ background: st.bg, color: st.fg, fontSize: "0.68rem", fontWeight: 700, padding: "3px 9px", borderRadius: 999, whiteSpace: "nowrap" }}>{w.status}</span>
                    </Tag>
                  );
                })}
              </div>
            </Card>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginTop: 6, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 800, color: "#0f1e36" }}>Commercial · as of today</h2>
            <span className="rdash-muted">order book and invoicing position — these have no date to filter on</span>
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
        </div>
      )}
    </div>
  );
}
