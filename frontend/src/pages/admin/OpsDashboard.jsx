import { useEffect, useState } from "react";
import DashboardSwitcher from "../../components/DashboardSwitcher";
import { AreaChart, Area, PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { pmApi } from "../../services/api";

const fmt = new Intl.NumberFormat("en-US");
const C = { blue: "#1565C0", green: "#2E7D32", amber: "#F57C00", red: "#C62828" };

export default function OpsDashboard() {
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cmd = await pmApi.getCommandDashboard({ from_date: "", to_date: "" });
        if (!cancelled) setData(cmd);
      } catch { if (!cancelled) setData(null); }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!data) return <div className="nd-dashboard"><DashboardSwitcher /><div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Loading…</div></div>;

  const { operational = {}, inet = {}, subcon = {}, backend = {}, company = {}, top_teams = [], im_performance = [], team_status = {} } = data;

  const totalRevenue = company.total_achieved ?? 0;
  const dailyAvg = totalRevenue > 0 ? Math.round(totalRevenue / 30) : 0;
  const jobsCompleted = operational.closed_activities ?? 0;
  const openOrders = operational.total_open_po_lines ?? 0;
  const coveragePct = Number(company.coverage_pct ?? 0).toFixed(1);

  const jobBreakdown = [
    { n: "INET", v: inet.active_inet_teams || 0, c: C.blue },
    { n: "Subcon", v: subcon.active_sub_teams || 0, c: C.amber },
    { n: "Backend", v: backend.active_teams || 0, c: C.red },
  ];

  const costs = [
    { l: "INET Cost", v: inet.inet_monthly_cost || 0, bc: C.blue },
    { l: "Subcon Cost", v: subcon.sub_expense || 0, bc: C.green },
    { l: "Backend", v: (backend.active_teams || 0) * 10000, bc: C.amber },
  ];
  const maxCost = Math.max(...costs.map((c) => c.v), 1);

  const techs = (top_teams || []).slice(0, 3).map((t) => ({
    n: t.team_name || t.team || "—",
    j: t.achieved || 0,
    r: t.revenue || t.achieved || 0,
  }));

  const billingPct = company.company_target > 0 ? Math.round((totalRevenue / company.company_target) * 100) : 0;
  const unbilledMs1 = data.picKpi?.unbilled_ms1 || operational.total_open_po_line_value || 0;
  const unbilledMs2 = data.picKpi?.unbilled_ms2 || 0;

  return (
    <div className="nd-dashboard">
      <DashboardSwitcher />
      <div className="nd-header">
        <div className="nd-header-left"><h1>Operational Revenue – INet Telecom</h1><span>Field operations & teams</span></div>
      </div>

      <div className="nd-kpi-row">
        {[{ l: "Total Revenue", v: `SAR ${fmt.format(totalRevenue)}` }, { l: "Avg Daily Rev", v: `SAR ${fmt.format(dailyAvg)}` },
          { l: "Jobs Completed", v: jobsCompleted, cl: C.green }, { l: "Open Orders", v: openOrders, cl: C.amber },
          { l: "Rev vs Target", v: `${coveragePct}%`, cl: Number(coveragePct) >= 50 ? C.green : C.amber }].map((k) => (
          <div className="nd-kpi-card" key={k.l}><div className="nd-kpi-label">{k.l}</div><div className="nd-kpi-value" style={k.cl ? { color: k.cl } : {}}>{k.v}</div></div>
        ))}
      </div>

      <div className="nd-grid col2">
        <div className="nd-panel"><div className="nd-panel-header"><h3>IM Revenue</h3></div><div className="nd-panel-body"><div className="nd-chart-h170"><ResponsiveContainer><BarChart data={(im_performance || []).slice(0, 7).map((im) => ({ n: im.im || "—", v: (im.revenue || 0) / 1000000 }))}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" /><XAxis dataKey="n" tick={{ fontSize: 9 }} /><Tooltip formatter={(v) => `SAR ${v}M`} /><Bar dataKey="v" fill={C.blue} radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div></div></div>
        <div className="nd-panel"><div className="nd-panel-header"><h3>Team Distribution</h3></div><div className="nd-panel-body" style={{ textAlign: "center" }}><div className="nd-chart-h170"><ResponsiveContainer><PieChart><Pie data={jobBreakdown} dataKey="v" innerRadius={55} outerRadius={80} paddingAngle={2}>{jobBreakdown.map((d) => <Cell key={d.n} fill={d.c} />)}</Pie></PieChart></ResponsiveContainer></div><div style={{ fontSize: 18, fontWeight: 800, marginTop: -32 }}>{(team_status.active || 0) + (team_status.idle || 0)}</div><div style={{ display: "flex", justifyContent: "center", gap: 12, fontSize: 11, fontWeight: 600, marginTop: 4 }}>{jobBreakdown.map((d) => <span key={d.n} style={{ color: d.c }}>{d.n}: {d.v}</span>)}</div></div></div>
      </div>

      <div className="nd-grid col3">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="nd-panel"><div className="nd-panel-header"><h3>Operational Costs</h3></div><div className="nd-panel-body">
            {costs.map((c) => (<div key={c.l} style={{ marginBottom: 6 }}><div className="nd-row-xs"><span style={{ fontSize: 12 }}>{c.l}</span><span style={{ fontWeight: 700, fontSize: 12 }}>SAR {fmt.format(c.v)}</span></div><div className="nd-progress thin"><div className="nd-progress-bar" style={{ width: (c.v / maxCost) * 100 + "%", background: c.bc }} /></div></div>))}
          </div></div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="nd-panel"><div className="nd-panel-header"><h3>Billing Overview</h3></div><div className="nd-panel-body">
            <div className="nd-donut-row">
              <div style={{ position: "relative", width: 90, height: 90, flexShrink: 0 }}><ResponsiveContainer><PieChart><Pie data={[{ v: billingPct }, { v: 100 - billingPct }]} dataKey="v" innerRadius={30} outerRadius={40} startAngle={90} endAngle={-270}><Cell fill={C.green} /><Cell fill="#e2e8f0" /></Pie></PieChart></ResponsiveContainer><div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 800, color: C.green }}>{billingPct}%</div></div>
              <div><div style={{ fontSize: 18, fontWeight: 700 }}>SAR {fmt.format(totalRevenue)}</div><div style={{ fontSize: 11, color: "#64748b" }}>Revenue Achieved</div><div style={{ fontSize: 11, color: C.amber, marginTop: 2 }}>Unbilled: SAR {fmt.format(unbilledMs1)}</div></div>
            </div>
          </div></div>
          <div className="nd-panel"><div className="nd-panel-header"><h3>Team Performance</h3></div><div className="nd-panel-body">
            <table className="nd-table"><thead><tr><th>Team</th><th style={{ textAlign: "right" }}>Achieved</th><th style={{ textAlign: "right" }}>Revenue</th></tr></thead><tbody>
              {techs.map((t) => (<tr key={t.n}><td><strong>{t.n}</strong></td><td style={{ textAlign: "right" }}>{t.j}</td><td style={{ textAlign: "right" }}>SAR {fmt.format(t.r)}</td></tr>))}
            </tbody></table>
          </div></div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="nd-panel"><div className="nd-panel-header"><h3>IM Performance</h3></div><div className="nd-panel-body">
            <table className="nd-table"><thead><tr><th>IM</th><th style={{ textAlign: "right" }}>Revenue</th><th style={{ textAlign: "right" }}>Profit</th></tr></thead><tbody>
              {(im_performance || []).slice(0, 4).map((im) => (<tr key={im.im}><td><strong>{im.im || "—"}</strong></td><td style={{ textAlign: "right" }}>SAR {fmt.format(im.revenue || 0)}</td><td style={{ textAlign: "right", color: (im.profit || 0) >= 0 ? C.green : C.red }}>SAR {fmt.format(im.profit || 0)}</td></tr>))}
            </tbody></table>
          </div></div>
        </div>
      </div>
    </div>
  );
}
