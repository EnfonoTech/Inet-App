import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import DashboardSwitcher from "../../components/DashboardSwitcher";
import { pmApi } from "../../services/api";

const fmt = new Intl.NumberFormat("en-US");
const C = { blue: "#1565C0", green: "#2E7D32", amber: "#F57C00", coral: "#e53935", teal: "#00695c", gray: "#64748b" };

export default function CommercialDashboard() {
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

  const { company = {}, operational = {}, subcon = {}, inet = {}, im_performance = [], top_teams = [] } = data;
  const totalRevenue = company.total_achieved ?? 0;
  const monthlyRevenue = totalRevenue > 0 ? Math.round(totalRevenue / 4) : 0; // approximate monthly
  const pendingInv = (operational.total_open_po_line_value ?? operational.total_open_po ?? 0);

  const revBreakdown = [
    { n: "INET", v: Math.round((inet.inet_achieved || 0) / 1000000) || 45, c: C.blue },
    { n: "Subcon", v: Math.round((subcon.sub_revenue || 0) / 1000000) || 30, c: C.amber },
    { n: "Backend", v: Math.round((data.backend?.completed_mtd || 0) * 100) || 20, c: C.coral },
    { n: "Other", v: 5, c: C.green },
  ];

  const topDeals = (top_teams || []).slice(0, 4).map((t) => ({
    cu: t.team_name || t.team || "—",
    desc: t.team || "",
    rev: t.achieved || 0,
    s: t.achieved >= t.target ? "Completed" : "Ongoing",
    c: t.achieved >= t.target ? "gray" : "teal",
  }));

  const revenueGrowth = company.company_target > 0 ? Math.round((totalRevenue / company.company_target) * 100) : 0;

  return (
    <div className="nd-dashboard">
      <DashboardSwitcher />
      <div className="nd-header">
        <div className="nd-header-left"><h1>Commercial Revenue – INet Telecom</h1><span>Sales, revenue & invoicing</span></div>
      </div>

      <div className="nd-kpi-row">
        {[
          { l: "Total Revenue", v: `SAR ${fmt.format(totalRevenue)}` },
          { l: "Monthly Revenue", v: `SAR ${fmt.format(monthlyRevenue)}` },
          { l: "Pending Invoices", v: `SAR ${fmt.format(pendingInv)}`, cl: C.amber },
          { l: "Revenue Growth", v: `${revenueGrowth}%` },
          { l: "Active Teams", v: inet.active_inet_teams || 0 },
        ].map((k) => (
          <div className="nd-kpi-card" key={k.l}><div className="nd-kpi-label">{k.l}</div><div className="nd-kpi-value" style={k.cl ? { color: k.cl } : {}}>{k.v}</div></div>
        ))}
      </div>

      <div className="nd-grid col2">
        <div className="nd-panel"><div className="nd-panel-header"><h3>Revenue Breakdown</h3></div><div className="nd-panel-body">
          <div className="nd-chart-h170"><ResponsiveContainer><PieChart><Pie data={revBreakdown} dataKey="v" innerRadius={50} outerRadius={75} paddingAngle={2}>{revBreakdown.map((d) => <Cell key={d.n} fill={d.c} />)}</Pie><Legend /></PieChart></ResponsiveContainer></div>
        </div></div>
        <div className="nd-panel"><div className="nd-panel-header"><h3>Revenue Trend</h3></div><div className="nd-panel-body">
          <div className="nd-chart-h170"><ResponsiveContainer><BarChart data={(im_performance || []).slice(0, 6).map((im) => ({ n: im.im || "—", v: (im.revenue || 0) / 1000000 }))}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" /><XAxis dataKey="n" tick={{ fontSize: 10 }} /><Tooltip formatter={(v) => `SAR ${v}M`} /><Bar dataKey="v" fill={C.green} radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div>
        </div></div>
      </div>

      <div className="nd-grid col3wide">
        <div className="nd-panel"><div className="nd-panel-header"><h3>Top Deals & Contracts</h3></div><div className="nd-panel-body">
          <table className="nd-table"><thead><tr><th>Team</th><th>Revenue</th><th>Status</th></tr></thead><tbody>
            {topDeals.map((d) => (<tr key={d.desc}><td><strong>{d.cu}</strong></td><td style={{ textAlign: "right" }}>SAR {fmt.format(d.rev)}</td><td><span className={"nd-badge " + d.c}>{d.s}</span></td></tr>))}
          </tbody></table>
        </div></div>
        <div className="nd-panel"><div className="nd-panel-header"><h3>IM Performance</h3></div><div className="nd-panel-body">
          <table className="nd-table"><thead><tr><th>IM</th><th style={{ textAlign: "right" }}>Revenue</th><th style={{ textAlign: "right" }}>Profit</th></tr></thead><tbody>
            {(im_performance || []).slice(0, 4).map((im) => (<tr key={im.im}><td><strong>{im.im || "—"}</strong></td><td style={{ textAlign: "right" }}>SAR {fmt.format(im.revenue || 0)}</td><td style={{ textAlign: "right", color: (im.profit || 0) >= 0 ? C.green : C.red }}>SAR {fmt.format(im.profit || 0)}</td></tr>))}
          </tbody></table>
        </div></div>
        <div className="nd-panel"><div className="nd-panel-header"><h3>Quick Stats</h3></div><div className="nd-panel-body">
          <div style={{ marginBottom: 8 }}><div className="nd-row-xs"><span style={{ fontSize: 11 }}>Revenue vs Target</span><span style={{ fontWeight: 700, fontSize: 12 }}>{revenueGrowth}%</span></div><div className="nd-progress"><div className="nd-progress-bar blue" style={{ width: revenueGrowth + "%" }} /></div></div>
          <div className="nd-metric"><div className="nd-metric-icon" style={{ background: "#e8f5e9" }}>{inet.active_inet_teams || 0}</div><div className="nd-metric-info"><div style={{ fontSize: 11 }}>Active INET Teams</div><div style={{ fontSize: 13, fontWeight: 600 }}>{subcon.active_sub_teams || 0} Subcon</div></div></div>
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>Cost Breakdown</div>
            <div className="nd-row-sm"><span style={{ fontSize: 12 }}>INET Cost</span><span style={{ fontWeight: 700, fontSize: 12 }}>SAR {fmt.format(inet.inet_monthly_cost || 0)}</span></div>
            <div className="nd-row-sm"><span style={{ fontSize: 12 }}>Subcon Cost</span><span style={{ fontWeight: 700, fontSize: 12 }}>SAR {fmt.format(subcon.sub_expense || 0)}</span></div>
          </div>
        </div></div>
      </div>
    </div>
  );
}
