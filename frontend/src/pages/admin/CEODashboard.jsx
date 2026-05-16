import { useEffect, useState } from "react";
import { AreaChart, Area, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import DashboardSwitcher from "../../components/DashboardSwitcher";
import { pmApi } from "../../services/api";

const fmt = new Intl.NumberFormat("en-US");
const C = { blue: "#1565C0", green: "#2E7D32", amber: "#F57C00", red: "#C62828" };

export default function CEODashboard() {
  const [data, setData] = useState(null);
  const [projKpis, setProjKpis] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cmd, pk] = await Promise.all([
          pmApi.getCommandDashboard({ from_date: "", to_date: "" }),
          pmApi.projectKpis().catch(() => null),
        ]);
        if (!cancelled) { setData(cmd); setProjKpis(pk); }
      } catch { if (!cancelled) setData(null); }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!data) return <div className="nd-dashboard"><DashboardSwitcher /><div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Loading…</div></div>;

  const { operational = {}, inet = {}, subcon = {}, backend = {}, company = {}, top_teams = [], im_performance = [], watchlist = [] } = data;

  const totalRevenue = company.total_achieved ?? 0;
  const netProfit = company.profit_loss ?? 0;
  const activeProjects = projKpis?.active_projects ?? 0;
  const pendingInv = (data.picKpi?.unbilled_ms1 || 0) + (data.picKpi?.unbilled_ms2 || 0);
  const coveragePct = Number(company.coverage_pct ?? 0).toFixed(1);

  const revTrend = (im_performance || []).slice(0, 4).map((im, i) => ({
    m: ["Jan", "Feb", "Mar", "Apr"][i] || `M${i + 1}`,
    t: (im.revenue || 0) / 1000000,
    l: ((im.revenue || 0) * 0.8) / 1000000,
  }));

  const topProjects = (top_teams || []).slice(0, 5).map((t, i) => ({
    name: t.team_name || `Team ${i + 1}`,
    client: t.team || "",
    progress: t.target > 0 ? Math.min(Math.round((t.achieved / t.target) * 100), 100) : 0,
    status: t.achieved >= t.target ? "On Track" : t.achieved >= t.target * 0.5 ? "At Risk" : "Delayed",
    color: t.achieved >= t.target ? "green" : t.achieved >= t.target * 0.5 ? "amber" : "red",
  }));

  const alerts = (watchlist || []).slice(0, 3).map((w, i) => ({
    l: w.indicator || `Alert ${i + 1}`,
    n: typeof w.current === "number" ? w.current : 0,
    c: w.status === "optimized" ? "green" : w.status === "behind" ? "amber" : "red",
  }));

  const targets = [
    { name: "Achieved", v: company.company_target > 0 ? Math.round((totalRevenue / company.company_target) * 100) : 0, c: C.blue },
    { name: "Margin", v: totalRevenue > 0 ? Math.round((netProfit / totalRevenue) * 100) : 0, c: C.green },
    { name: "Coverage", v: Number(coveragePct) || 0, c: C.amber },
  ];

  return (
    <div className="nd-dashboard">
      <DashboardSwitcher />
      <div className="nd-header">
        <div className="nd-header-left"><h1>CEO Dashboard – INet Telecom</h1><span>Executive overview</span></div>
      </div>

      <div className="nd-kpi-row">
        {[
          { l: "Total Revenue", v: `SAR ${fmt.format(totalRevenue)}` },
          { l: "Net Profit", v: `SAR ${fmt.format(netProfit)}`, cl: netProfit < 0 ? C.red : C.green },
          { l: "Active Projects", v: activeProjects },
          { l: "Pending Invoices", v: `SAR ${fmt.format(pendingInv)}`, cl: C.amber },
          { l: "Coverage", v: `${coveragePct}%`, cl: Number(coveragePct) >= 50 ? C.green : C.amber },
        ].map((k) => (
          <div className="nd-kpi-card" key={k.l}><div className="nd-kpi-label">{k.l}</div><div className="nd-kpi-value" style={k.cl ? { color: k.cl } : {}}>{k.v}</div></div>
        ))}
      </div>

      <div className="nd-grid col2" style={{ alignItems: "stretch" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, height: "100%" }}>
          <div className="nd-panel"><div className="nd-panel-body" style={{ textAlign: "center", padding: "12px 14px" }}>
            <div className="nd-kpi-label">Operational Coverage</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: Number(coveragePct) >= 50 ? C.green : C.amber }}>{coveragePct}%</div>
            <div style={{ fontSize: 11, color: "#64748b" }}>Revenue vs Target</div>
          </div></div>
          <div className="nd-panel" style={{ flex: 1 }}><div className="nd-panel-header"><h3>Financial Overview</h3></div>
            <div className="nd-panel-body">
              <div className="nd-donut-row">
                <div style={{ position: "relative", width: 90, height: 55, flexShrink: 0, overflow: "hidden" }}>
                  <div style={{ position: "absolute", bottom: 0, width: 90, height: 90 }}>
                    <ResponsiveContainer><PieChart><Pie data={[{ v: totalRevenue }, { v: Math.max((company.company_target || totalRevenue) - totalRevenue, 0) }]} dataKey="v" innerRadius={28} outerRadius={42} startAngle={180} endAngle={0}><Cell fill={C.green} /><Cell fill="#e2e8f0" /></Pie></PieChart></ResponsiveContainer>
                  </div>
                </div>
                <div><div style={{ fontSize: 16, fontWeight: 700 }}>SAR {fmt.format(totalRevenue)}</div><div style={{ fontSize: 11, color: "#64748b" }}>Target: SAR {fmt.format(company.company_target || 0)}</div></div>
              </div>
            </div></div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, height: "100%" }}>
          <div className="nd-panel" style={{ flex: 1 }}><div className="nd-panel-header"><h3>Revenue Trend</h3><span style={{ fontSize: 11, color: C.green }}>SAR {fmt.format(totalRevenue)} YTD</span></div>
            <div className="nd-panel-body nd-chart-h160">
              <ResponsiveContainer><AreaChart data={revTrend.length ? revTrend : [{ m: "—", t: 0, l: 0 }]}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" /><XAxis dataKey="m" tick={{ fontSize: 11 }} /><Tooltip formatter={(v) => `SAR ${v}M`} /><Area type="monotone" dataKey="l" stroke="#94a3b8" fill="#e2e8f0" /><Area type="monotone" dataKey="t" stroke={C.green} fill="#c8e6c9" /></AreaChart></ResponsiveContainer>
            </div></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div className="nd-panel"><div className="nd-panel-header"><h3>Top Teams</h3></div><div className="nd-panel-body">
              <table className="nd-table"><tbody>{topProjects.map((p) => (
                <tr key={p.name}><td><strong>{p.name}</strong></td><td style={{ width: "25%" }}><div className="nd-progress"><div className={"nd-progress-bar " + p.color} style={{ width: p.progress + "%" }} /></div></td><td><span className={"nd-badge " + p.color}>{p.status}</span></td></tr>
              ))}</tbody></table>
            </div></div>
            <div className="nd-panel"><div className="nd-panel-header"><h3>Company Financial</h3></div><div className="nd-panel-body" style={{ textAlign: "center" }}>
              <div style={{ fontSize: 20, fontWeight: 800 }}>SAR {fmt.format(totalRevenue)}</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: netProfit >= 0 ? C.green : C.red }}>Profit: SAR {fmt.format(netProfit)}</div>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>Cost: SAR {fmt.format(company.total_cost || 0)}</div>
            </div></div>
          </div>
        </div>
      </div>

      <div className="nd-grid col3">
        <div className="nd-panel"><div className="nd-panel-header"><h3>IM Performance</h3></div><div className="nd-panel-body">
          <table className="nd-table"><thead><tr><th>IM</th><th>Revenue</th><th>Profit</th></tr></thead><tbody>
            {(im_performance || []).slice(0, 5).map((im) => (
              <tr key={im.im}><td><strong>{im.im || "—"}</strong></td><td style={{ textAlign: "right" }}>SAR {fmt.format(im.revenue || 0)}</td><td style={{ textAlign: "right", color: (im.profit || 0) >= 0 ? C.green : C.red }}>SAR {fmt.format(im.profit || 0)}</td></tr>
            ))}
          </tbody></table>
        </div></div>
        <div className="nd-panel"><div className="nd-panel-header"><h3>Performance vs Targets</h3></div><div className="nd-panel-body">
          {targets.map((t) => (<div key={t.name} style={{ marginBottom: 10 }}><div className="nd-row-sm"><span className="nd-metric-label">{t.name}</span><span style={{ fontWeight: 700, fontSize: 12 }}>{t.v}%</span></div><div className="nd-progress"><div className="nd-progress-bar" style={{ width: t.v + "%", background: t.c }} /></div></div>))}
        </div></div>
        <div className="nd-panel"><div className="nd-panel-header"><h3>Issues & Alerts</h3></div><div className="nd-panel-body">
          {alerts.length ? alerts.map((i) => (
            <div key={i.l} className="nd-metric" style={{ justifyContent: "space-between" }}><div className="nd-metric-info"><span style={{ fontSize: 12 }}>{i.l}</span><span className={"nd-badge " + i.c} style={{ marginLeft: 8 }}>{i.n}</span></div><button className="nd-btn primary" style={{ fontSize: 11, padding: "2px 8px" }}>Review</button></div>
          )) : <div style={{ fontSize: 12, color: "#94a3b8", textAlign: "center", padding: 12 }}>No active alerts</div>}
        </div></div>
      </div>
    </div>
  );
}
