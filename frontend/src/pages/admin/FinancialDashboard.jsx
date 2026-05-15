import { useEffect, useState } from "react";
import DashboardSwitcher from "../../components/DashboardSwitcher";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { pmApi } from "../../services/api";

const fmt = new Intl.NumberFormat("en-US");
const C = { blue: "#1565C0", green: "#2E7D32", amber: "#F57C00", red: "#C62828" };

export default function FinancialDashboard() {
  const [data, setData] = useState(null);
  const [picData, setPicData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cmd, pic] = await Promise.all([
          pmApi.getCommandDashboard({ from_date: "", to_date: "" }),
          pmApi.getPicDashboard("", "", "").catch(() => null),
        ]);
        if (!cancelled) { setData(cmd); setPicData(pic); }
      } catch { if (!cancelled) setData(null); }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!data) return <div className="nd-dashboard"><DashboardSwitcher /><div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Loading…</div></div>;

  const { company = {}, inet = {}, subcon = {}, backend = {}, im_performance = [] } = data;
  const totalRevenue = company.total_achieved ?? 0;
  const totalCost = company.total_cost ?? 0;
  const netProfit = company.profit_loss ?? 0;
  const margin = totalRevenue > 0 ? ((netProfit / totalRevenue) * 100).toFixed(1) : "0.0";
  const outstanding = (picData?.kpi?.unbilled_ms1 || 0) + (picData?.kpi?.unbilled_ms2 || 0);

  const costBD = [
    { n: "INET", v: inet.inet_monthly_cost || 0, c: C.blue },
    { n: "Subcon", v: subcon.sub_expense || 0, c: C.amber },
    { n: "Backend", v: (backend.active_teams || 0) * 10000, c: C.green },
    { n: "Other", v: Math.max(totalCost - (inet.inet_monthly_cost || 0) - (subcon.sub_expense || 0) - ((backend.active_teams || 0) * 10000), 0), c: "#94a3b8" },
  ];

  const pnl = (picData?.monthly || []).slice(-4).map((m) => ({
    m: m.invoice_month ? m.invoice_month.slice(5, 7) : "—",
    r: m.total || 0,
    c: Math.round((m.total || 0) * 0.65),
  }));

  const agingData = [
    { r: "MS1 Unbilled", v: picData?.kpi?.unbilled_ms1 || 0, c: C.green },
    { r: "MS2 Unbilled", v: picData?.kpi?.unbilled_ms2 || 0, c: C.amber },
    { r: "Total Invoiced", v: picData?.kpi?.total_invoiced || 0, c: C.blue },
  ];
  const maxAging = Math.max(...agingData.map((a) => a.v), 1);

  return (
    <div className="nd-dashboard">
      <DashboardSwitcher />
      <div className="nd-header">
        <div className="nd-header-left"><h1>Financial Dashboard – INet Telecom</h1><span>Revenue, costs & margins</span></div>
      </div>

      <div className="nd-kpi-row">
        {[{ l: "Total Revenue", v: `SAR ${fmt.format(totalRevenue)}` }, { l: "Total Cost", v: `SAR ${fmt.format(totalCost)}`, cl: C.amber },
          { l: "Net Profit", v: `SAR ${fmt.format(netProfit)}`, cl: netProfit >= 0 ? C.green : C.red },
          { l: "Margin", v: `${margin}%`, cl: Number(margin) >= 15 ? C.green : C.amber },
          { l: "Outstanding", v: `SAR ${fmt.format(outstanding)}`, cl: C.amber }].map((k) => (
          <div className="nd-kpi-card" key={k.l}><div className="nd-kpi-label">{k.l}</div><div className="nd-kpi-value" style={k.cl ? { color: k.cl } : {}}>{k.v}</div></div>
        ))}
      </div>

      <div className="nd-grid col3wide">
        <div className="nd-panel"><div className="nd-panel-header"><h3>Monthly P&L</h3></div><div className="nd-panel-body"><div className="nd-chart-h170"><ResponsiveContainer><BarChart data={pnl.length ? pnl : [{ m: "—", r: 0, c: 0 }]}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" /><XAxis dataKey="m" tick={{ fontSize: 10 }} /><Tooltip formatter={(v) => `SAR ${fmt.format(v)}`} /><Bar dataKey="r" fill={C.blue} radius={[3, 3, 0, 0]} name="Revenue" /><Bar dataKey="c" fill={C.amber} radius={[3, 3, 0, 0]} name="Cost" /></BarChart></ResponsiveContainer></div></div></div>
        <div className="nd-panel"><div className="nd-panel-header"><h3>Cost Breakdown</h3></div><div className="nd-panel-body"><div className="nd-chart-h170"><ResponsiveContainer><PieChart><Pie data={costBD} dataKey="v" innerRadius={45} outerRadius={70} paddingAngle={2}>{costBD.map((d) => <Cell key={d.n} fill={d.c} />)}</Pie></PieChart></ResponsiveContainer></div><div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", justifyContent: "center", fontSize: 10, fontWeight: 600 }}>{costBD.map((d) => <span key={d.n} style={{ color: d.c }}>{d.n}: SAR {fmt.format(d.v)}</span>)}</div></div></div>
        <div className="nd-panel"><div className="nd-panel-header"><h3>Invoicing Pipeline</h3></div><div className="nd-panel-body">
          {agingData.map((a) => (<div key={a.r} style={{ marginBottom: 8 }}><div className="nd-row-xs"><span style={{ fontSize: 12 }}>{a.r}</span><span style={{ fontWeight: 700, fontSize: 12 }}>SAR {fmt.format(a.v)}</span></div><div className="nd-progress thin"><div className="nd-progress-bar" style={{ width: (a.v / maxAging) * 100 + "%", background: a.c }} /></div></div>))}
          <div style={{ marginTop: 4, fontSize: 12, fontWeight: 700, color: C.green }}>Line Count: {picData?.kpi?.line_count || 0}</div>
        </div></div>
      </div>
    </div>
  );
}
