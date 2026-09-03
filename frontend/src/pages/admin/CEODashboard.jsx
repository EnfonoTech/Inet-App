import { useEffect, useState } from "react";
import { AreaChart, Area, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import DashboardSwitcher from "../../components/DashboardSwitcher";
import { pmApi } from "../../services/api";

const fmt = new Intl.NumberFormat("en-US");
const C = { blue: "#1565C0", green: "#2E7D32", amber: "#F57C00", red: "#C62828" };

export default function CEODashboard() {
  const [data, setData] = useState(null);
  const [projKpis, setProjKpis] = useState(null);
  const [picKpi, setPicKpi] = useState(null);
  const [trend, setTrend] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cmd, pk, pic, tr] = await Promise.all([
          pmApi.getCommandDashboard({ from_date: "", to_date: "" }),
          pmApi.projectKpis().catch(() => null),
          pmApi.getPicDashboard(null, null, "").catch(() => null),
          // Real monthly spine. The chart used to fake one by taking the
          // first 4 IMs and labelling them Jan/Feb/Mar/Apr.
          pmApi.getPoVsInvoiceTrend({ months: 6 }).catch(() => null),
        ]);
        if (!cancelled) {
          setData(cmd); setProjKpis(pk); setPicKpi(pic?.kpi || null);
          setTrend(Array.isArray(tr?.series) ? tr.series : []);
        }
      } catch { if (!cancelled) setData(null); }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!data) return <div className="nd-dashboard"><DashboardSwitcher /><div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Loading…</div></div>;

  const { operational = {}, inet = {}, subcon = {}, backend = {}, company = {}, top_teams = [], im_performance = [], watchlist = [] } = data;

  const totalRevenue = company.total_achieved ?? 0;
  const netProfit = company.profit_loss ?? 0;
  const activeProjects = projKpis?.active_projects ?? 0;
  const pendingInv = (picKpi?.unbilled_ms1 || 0) + (picKpi?.unbilled_ms2 || 0);
  const coveragePct = Number(company.coverage_pct ?? 0).toFixed(1);

  // Real trailing-6-month series: PO published value vs invoiced value, in
  // millions. Replaces a chart that plotted the first 4 IMs' revenue under
  // hardcoded Jan/Feb/Mar/Apr labels, against an invented "last year" line
  // that was just the same number × 0.8.
  const revTrend = (trend || []).map((r) => ({
    m: r.label || r.m,
    po: (r.po_value || 0) / 1000000,
    inv: (r.invoiced || 0) / 1000000,
  }));

  // top_teams rows are {team, team_name, revenue, team_cost, profit} — there
  // is no `achieved`/`target`, so the old mapping compared undefined against
  // undefined: every team showed a 0% bar and the "Delayed" badge. Bar is now
  // each team's revenue relative to the strongest team; status is whether the
  // team covered its own cost.
  const maxTeamRev = Math.max(...(top_teams || []).map((t) => t.revenue || 0), 1);
  const topTeams = (top_teams || []).slice(0, 5).map((t, i) => ({
    name: t.team_name || t.team || `Team ${i + 1}`,
    progress: Math.min(Math.round(((t.revenue || 0) / maxTeamRev) * 100), 100),
    status: (t.profit || 0) >= 0 ? "Profitable" : "At Loss",
    color: (t.profit || 0) >= 0 ? "green" : "red",
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
                <div style={{ position: "relative", width: 90, height: 90, flexShrink: 0 }}>
                  <ResponsiveContainer><PieChart><Pie data={[{ v: Number(coveragePct) || 0 }, { v: Math.max(100 - (Number(coveragePct) || 0), 0) }]} dataKey="v" innerRadius={28} outerRadius={40} startAngle={90} endAngle={-270}><Cell fill={C.green} /><Cell fill="#e2e8f0" /></Pie></PieChart></ResponsiveContainer>
                  <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800, color: C.green }}>{coveragePct}%</div>
                </div>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>SAR {fmt.format(totalRevenue)}</div>
                  <div style={{ fontSize: 11, color: "#64748b" }}>Target: SAR {fmt.format(company.company_target || 0)}</div>
                </div>
              </div>
            </div></div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, height: "100%" }}>
          <div className="nd-panel" style={{ flex: 1 }}><div className="nd-panel-header"><h3>PO Published vs Invoiced</h3><span style={{ fontSize: 11, color: "#64748b" }}>last 6 months, SAR M</span></div>
            <div className="nd-panel-body nd-chart-h160">
              <ResponsiveContainer><AreaChart data={revTrend.length ? revTrend : [{ m: "—", po: 0, inv: 0 }]}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" /><XAxis dataKey="m" tick={{ fontSize: 11 }} /><Tooltip formatter={(v, n) => [`SAR ${Number(v).toFixed(2)}M`, n === "po" ? "PO published" : "Invoiced"]} /><Area type="monotone" dataKey="po" stroke="#94a3b8" fill="#e2e8f0" /><Area type="monotone" dataKey="inv" stroke={C.green} fill="#c8e6c9" /></AreaChart></ResponsiveContainer>
            </div></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div className="nd-panel"><div className="nd-panel-header"><h3>Top Teams</h3></div><div className="nd-panel-body">
              <table className="nd-table"><tbody>{topTeams.map((p) => (
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
            <div key={i.l} className="nd-metric"><div className="nd-metric-info"><span style={{ fontSize: 12 }}>{i.l}</span><span className={"nd-badge " + i.c} style={{ marginLeft: 8 }}>{i.n}</span></div></div>
          )) : <div style={{ fontSize: 12, color: "#94a3b8", textAlign: "center", padding: 12 }}>No active alerts</div>}
        </div></div>
      </div>
    </div>
  );
}
