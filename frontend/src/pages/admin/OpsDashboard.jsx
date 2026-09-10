import { useEffect, useState } from "react";
import DashboardSwitcher from "../../components/DashboardSwitcher";
import { AreaChart, Area, PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { pmApi } from "../../services/api";
import { money } from "../../utils/numberFormat";

const fmt = new Intl.NumberFormat("en-US");
const C = { blue: "#1565C0", green: "#2E7D32", amber: "#F57C00", red: "#C62828" };

export default function OpsDashboard() {
  const [data, setData] = useState(null);
  // get_command_dashboard never returned a `picKpi` key, so the unbilled
  // figures below silently fell back to open-PO value and were labelled
  // "Unbilled". PIC numbers come from the PIC dashboard, same as the
  // Financial dashboard does it.
  const [picKpi, setPicKpi] = useState(null);
  // Straight off the PO Dispatch Status report, so this panel and that report
  // are the same numbers rather than two queries free to drift apart.
  const [dispatchRows, setDispatchRows] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Awaited alone so the page paints at command-dashboard speed; the
        // PIC figures fill in a few tiles afterwards and already have a null
        // path. Awaiting both together held the whole screen on "Loading…"
        // until the slower of the two finished.
        const cmd = await pmApi.getCommandDashboard({ from_date: "", to_date: "" });
        if (cancelled) return;
        setData(cmd);
        pmApi.getPicDashboard("", "", "")
          .then((pic) => { if (!cancelled) setPicKpi(pic?.kpi || null); }).catch(() => {});
        pmApi.reportPoDispatchStatus()
          .then((r) => { if (!cancelled) setDispatchRows(Array.isArray(r?.data) ? r.data : []); })
          .catch(() => {});
      } catch { if (!cancelled) setData(null); }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!data) return <div className="nd-dashboard"><DashboardSwitcher /><div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Loading…</div></div>;

  const { operational = {}, inet = {}, subcon = {}, backend = {}, company = {}, top_teams = [], im_performance = [], team_status = {} } = data;

  const totalRevenue = company.total_achieved ?? 0;
  const jobsCompleted = operational.closed_activities ?? 0;
  const openOrders = operational.total_open_po_lines ?? 0;
  const coveragePct = Number(company.coverage_pct ?? 0).toFixed(1);
  // Was revenue / 30 regardless of the period actually fetched (which is
  // all-time here), so "avg daily" was all-time revenue over a fixed 30.
  // day_progress_pct is the elapsed fraction of the period the backend used.
  const elapsedDays = Math.max(Math.round(((company.day_progress_pct ?? 0) / 100) * 30), 1);
  const dailyAvg = totalRevenue > 0 ? totalRevenue / elapsedDays : 0;

  const jobBreakdown = [
    { n: "INET", v: inet.active_inet_teams || 0, c: C.blue },
    { n: "Subcon", v: subcon.active_sub_teams || 0, c: C.amber },
    { n: "Backend", v: backend.active_teams || 0, c: C.red },
  ];

  // Rolled up to STAGE rather than charting all 10 statuses: the book is
  // heavily skewed (10,590 Closed against 2 Backend Assigned), so on one
  // linear axis half the statuses would be invisible slivers. Six stages
  // stay readable, and the report itself carries the per-status detail.
  // Order comes from the rows, which the backend returns in pipeline order —
  // sorting by size would scramble the flow this is meant to show.
  const STAGE_COLOR = {
    "Not Started": C.amber,
    "In Rollout":  C.blue,
    "Work Done":   "#00897B",
    "Invoicing":   "#6A1B9A",
    "Closed":      C.green,
    "Cancelled":   C.red,
    "Other":       "#78909C",
  };
  const pipelineStages = (() => {
    const order = [];
    const acc = {};
    for (const r of dispatchRows) {
      const st = r.stage || "Other";
      if (!(st in acc)) { acc[st] = { n: st, lines: 0, value: 0 }; order.push(st); }
      acc[st].lines += Number(r.lines_count) || 0;
      acc[st].value += Number(r.value) || 0;
    }
    return order.map((st) => ({ ...acc[st], c: STAGE_COLOR[st] || STAGE_COLOR.Other }));
  })();
  const pipelineTotal = pipelineStages.reduce((s, x) => s + x.lines, 0);

  // "Backend" used to be invented here as active_teams × SAR 10,000 — a
  // hardcoded rate that exists nowhere in the data. Dropped: only the two
  // cost streams the backend actually reports are shown.
  const costs = [
    { l: "INET Cost", v: inet.inet_monthly_cost || 0, bc: C.blue },
    { l: "Subcon Cost", v: subcon.sub_expense || 0, bc: C.green },
  ];
  const maxCost = Math.max(...costs.map((c) => c.v), 1);

  // top_teams rows are {team, team_name, revenue, team_cost, profit} — there
  // is no `achieved` key, so the old `t.achieved` / `t.revenue || t.achieved`
  // mapping printed the same value under two differently-named columns.
  const techs = (top_teams || []).slice(0, 5).map((t) => ({
    n: t.team_name || t.team || "—",
    r: t.revenue || 0,
    cost: t.team_cost || 0,
    profit: t.profit || 0,
  }));

  const billingPct = company.company_target > 0 ? Math.round((totalRevenue / company.company_target) * 100) : 0;
  const unbilledMs1 = picKpi?.unbilled_ms1 || 0;
  const unbilledMs2 = picKpi?.unbilled_ms2 || 0;

  return (
    <div className="nd-dashboard">
      <DashboardSwitcher />
      <div className="nd-header">
        <div className="nd-header-left"><h1>Operational Revenue – INet Telecom</h1><span>Field operations & teams</span></div>
      </div>

      <div className="nd-kpi-row">
        {[{ l: "Total Revenue", v: `SAR ${money.format(totalRevenue)}` }, { l: "Avg Daily Rev", v: `SAR ${money.format(dailyAvg)}` },
          { l: "Jobs Completed", v: jobsCompleted, cl: C.green }, { l: "Open Orders", v: openOrders, cl: C.amber },
          { l: "Rev vs Target", v: `${coveragePct}%`, cl: Number(coveragePct) >= 50 ? C.green : C.amber }].map((k) => (
          <div className="nd-kpi-card" key={k.l}><div className="nd-kpi-label">{k.l}</div><div className="nd-kpi-value" style={k.cl ? { color: k.cl } : {}}>{k.v}</div></div>
        ))}
      </div>

      <div className="nd-panel" style={{ marginBottom: 16 }}>
        <div className="nd-panel-header">
          <h3>PO Dispatch Pipeline</h3>
          {pipelineTotal > 0 && (
            <span style={{ fontSize: 12, color: "#64748b" }}>
              {fmt.format(pipelineTotal)} lines
            </span>
          )}
        </div>
        <div className="nd-panel-body">
          {pipelineStages.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
              Loading pipeline…
            </div>
          ) : (
            <>
              <div className="nd-chart-h170">
                <ResponsiveContainer>
                  <BarChart data={pipelineStages} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="n" tick={{ fontSize: 10 }} interval={0} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip
                      formatter={(v, _k, p) => [
                        `${fmt.format(v)} lines · SAR ${money.format(p?.payload?.value || 0)}`,
                        p?.payload?.n,
                      ]}
                    />
                    <Bar dataKey="lines" radius={[3, 3, 0, 0]}>
                      {pipelineStages.map((d) => <Cell key={d.n} fill={d.c} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", marginTop: 8 }}>
                {pipelineStages.map((d) => (
                  <span key={d.n} style={{ fontSize: 11, color: "#475569", display: "flex", alignItems: "center", gap: 5 }}>
                    <i style={{ width: 8, height: 8, borderRadius: 2, background: d.c, display: "inline-block" }} />
                    {d.n} · <strong>{fmt.format(d.lines)}</strong>
                    <span style={{ color: "#94a3b8" }}>
                      ({pipelineTotal ? ((d.lines / pipelineTotal) * 100).toFixed(1) : 0}%)
                    </span>
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="nd-grid col2">
        <div className="nd-panel"><div className="nd-panel-header"><h3>IM Revenue</h3></div><div className="nd-panel-body"><div className="nd-chart-h170"><ResponsiveContainer><BarChart data={(im_performance || []).slice(0, 7).map((im) => ({ n: im.im || "—", v: (im.revenue || 0) / 1000000 }))}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" /><XAxis dataKey="n" tick={{ fontSize: 9 }} /><Tooltip formatter={(v) => `SAR ${v}M`} /><Bar dataKey="v" fill={C.blue} radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div></div></div>
        <div className="nd-panel"><div className="nd-panel-header"><h3>Team Distribution</h3></div><div className="nd-panel-body" style={{ textAlign: "center" }}><div className="nd-chart-h170"><ResponsiveContainer><PieChart><Pie data={jobBreakdown} dataKey="v" innerRadius={55} outerRadius={80} paddingAngle={2}>{jobBreakdown.map((d) => <Cell key={d.n} fill={d.c} />)}</Pie></PieChart></ResponsiveContainer></div>{/* Sum of the slices actually drawn — this used to print
    team_status.active + team_status.idle, a different total that
    need not equal the three team-type counts in the pie. */}
              <div style={{ fontSize: 18, fontWeight: 800, marginTop: -32 }}>{jobBreakdown.reduce((s, d) => s + (d.v || 0), 0)}</div><div style={{ display: "flex", justifyContent: "center", gap: 12, fontSize: 11, fontWeight: 600, marginTop: 4 }}>{jobBreakdown.map((d) => <span key={d.n} style={{ color: d.c }}>{d.n}: {d.v}</span>)}</div></div></div>
      </div>

      <div className="nd-grid col3 stretch">
        <div style={{ display: "flex", flexDirection: "column", gap: 10, height: "100%" }}>
          <div className="nd-panel" style={{ flex: 1 }}><div className="nd-panel-header"><h3>Operational Costs</h3></div><div className="nd-panel-body">
            {costs.map((c) => (<div key={c.l} style={{ marginBottom: 6 }}><div className="nd-row-xs"><span style={{ fontSize: 12 }}>{c.l}</span><span style={{ fontWeight: 700, fontSize: 12 }}>SAR {money.format(c.v)}</span></div><div className="nd-progress thin"><div className="nd-progress-bar" style={{ width: (c.v / maxCost) * 100 + "%", background: c.bc }} /></div></div>))}
          </div></div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="nd-panel"><div className="nd-panel-header"><h3>Billing Overview</h3></div><div className="nd-panel-body">
            <div className="nd-donut-row">
              <div style={{ position: "relative", width: 90, height: 90, flexShrink: 0 }}><ResponsiveContainer><PieChart><Pie data={[{ v: billingPct }, { v: 100 - billingPct }]} dataKey="v" innerRadius={30} outerRadius={40} startAngle={90} endAngle={-270}><Cell fill={C.green} /><Cell fill="#e2e8f0" /></Pie></PieChart></ResponsiveContainer><div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 800, color: C.green }}>{billingPct}%</div></div>
              <div><div style={{ fontSize: 18, fontWeight: 700 }}>SAR {money.format(totalRevenue)}</div><div style={{ fontSize: 11, color: "#64748b" }}>Revenue Achieved</div><div style={{ fontSize: 11, color: C.amber, marginTop: 2 }}>Unbilled MS1: SAR {money.format(unbilledMs1)}</div><div style={{ fontSize: 11, color: C.amber }}>Unbilled MS2: SAR {money.format(unbilledMs2)}</div></div>
            </div>
          </div></div>
          <div className="nd-panel"><div className="nd-panel-header"><h3>Team Performance</h3></div><div className="nd-panel-body">
            <table className="nd-table"><thead><tr><th>Team</th><th style={{ textAlign: "right" }}>Revenue</th><th style={{ textAlign: "right" }}>Cost</th><th style={{ textAlign: "right" }}>Profit</th></tr></thead><tbody>
              {techs.map((t) => (<tr key={t.n}><td><strong>{t.n}</strong></td><td style={{ textAlign: "right" }}>SAR {money.format(t.r)}</td><td style={{ textAlign: "right" }}>SAR {money.format(t.cost)}</td><td style={{ textAlign: "right", color: t.profit >= 0 ? C.green : C.red }}>SAR {money.format(t.profit)}</td></tr>))}
            </tbody></table>
          </div></div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, height: "100%" }}>
          <div className="nd-panel" style={{ flex: 1 }}><div className="nd-panel-header"><h3>IM Performance</h3></div><div className="nd-panel-body">
            <table className="nd-table"><thead><tr><th>IM</th><th style={{ textAlign: "right" }}>Revenue</th><th style={{ textAlign: "right" }}>Profit</th></tr></thead><tbody>
              {(im_performance || []).slice(0, 5).map((im) => (<tr key={im.im}><td><strong>{im.im || "—"}</strong></td><td style={{ textAlign: "right" }}>SAR {money.format(im.revenue || 0)}</td><td style={{ textAlign: "right", color: (im.profit || 0) >= 0 ? C.green : C.red }}>SAR {money.format(im.profit || 0)}</td></tr>))}
            </tbody></table>
          </div></div>
        </div>
      </div>
    </div>
  );
}
