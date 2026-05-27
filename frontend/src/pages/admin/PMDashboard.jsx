import { useEffect, useState } from "react";
import DashboardSwitcher from "../../components/DashboardSwitcher";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { pmApi } from "../../services/api";

const fmt = new Intl.NumberFormat("en-US");
const C = { blue: "#1565C0", green: "#2E7D32", amber: "#F57C00", red: "#C62828" };

export default function PMDashboard() {
  const [kpis, setKpis] = useState(null);
  const [charts, setCharts] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [pk, ch] = await Promise.all([
          pmApi.projectKpis().catch(() => null),
          pmApi.charts().catch(() => null),
        ]);
        if (!cancelled) { setKpis(pk); setCharts(ch); }
      } catch { if (!cancelled) { setKpis(null); setCharts(null); } }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!kpis && !charts) return <div className="nd-dashboard"><DashboardSwitcher /><div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Loading…</div></div>;

  const active = kpis?.active_projects ?? 0;
  const atRisk = kpis?.projects_at_risk ?? 0;
  const overdue = kpis?.overdue_projects ?? 0;
  const onTrack = Math.max(active - atRisk - overdue, 0);
  const totalBudget = kpis?.total_budget ?? 0;
  const actualSpent = kpis?.actual_spent ?? 0;
  const utilization = kpis?.budget_utilization ?? 0;

  const health = [
    { n: "On Track", v: active > 0 ? Math.round((onTrack / active) * 100) : 0, c: C.green },
    { n: "At Risk", v: active > 0 ? Math.round((atRisk / active) * 100) : 0, c: C.amber },
    { n: "Delayed", v: active > 0 ? Math.round((overdue / active) * 100) : 0, c: C.red },
  ];

  const statusData = charts?.projects_by_status || [];
  const budgetData = (charts?.budget_vs_actual || []).slice(0, 5).map((p) => ({
    n: p.project_code || "—",
    p: p.budget_amount > 0 ? Math.round((p.actual_cost / p.budget_amount) * 100) : 0,
    s: p.actual_cost > p.budget_amount ? "Over" : "On Track",
    c: p.actual_cost > p.budget_amount ? "red" : "green",
  }));

  const topProjects = (charts?.top_projects || []).slice(0, 5).map((p) => ({
    code: p.project_code || "—",
    total: p.total || 0,
    completed: p.completed || 0,
    pct: p.completion_pct || 0,
  }));

  return (
    <div className="nd-dashboard">
      <DashboardSwitcher />
      <div className="nd-header">
        <div className="nd-header-left"><h1>PM Dashboard – INet Telecom</h1><span>Project management & team oversight</span></div>
      </div>

      <div className="nd-kpi-row col6">
        {[{ l: "Active Projects", v: active, cl: C.blue }, { l: "On Track", v: onTrack, cl: C.green },
          { l: "At Risk", v: atRisk, cl: C.amber }, { l: "Delayed", v: overdue, cl: C.red },
          { l: "Total Budget", v: `SAR ${fmt.format(totalBudget)}`, cl: C.blue }, { l: "Utilization", v: `${Number(utilization).toFixed(1)}%`, cl: C.green }].map((k) => (
          <div className="nd-kpi-card" key={k.l}><div className="nd-kpi-label">{k.l}</div><div className="nd-kpi-value" style={{ color: k.cl }}>{k.v}</div></div>
        ))}
      </div>

      <div className="nd-grid col3 stretch">
        <div style={{ display: "flex", flexDirection: "column", gap: 10, height: "100%" }}>
          <div className="nd-panel"><div className="nd-panel-header"><h3>Project Health</h3></div>
            <div className="nd-panel-body" style={{ textAlign: "center" }}>
              <div style={{ width: 120, height: 120, margin: "0 auto" }}><ResponsiveContainer><PieChart><Pie data={health} dataKey="v" innerRadius={38} outerRadius={52} paddingAngle={2}>{health.map((d) => <Cell key={d.n} fill={d.c} />)}</Pie></PieChart></ResponsiveContainer></div>
              <div style={{ display: "flex", justifyContent: "center", gap: 12, fontSize: 11, fontWeight: 600, marginTop: -4 }}>{health.map((d) => <span key={d.n} style={{ color: d.c }}>{d.n}: {d.v}%</span>)}</div>
            </div></div>
          <div className="nd-panel" style={{ flex: 1 }}><div className="nd-panel-header"><h3>Project Status Distribution</h3></div><div className="nd-panel-body" style={{ textAlign: "center" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {(statusData.length ? statusData : [{ label: "No data", value: 0 }]).slice(0, 4).map((s) => (
                <div key={s.label} style={{ textAlign: "center", padding: "8px 6px", borderRadius: 6, background: "#f8fafc", height: 56 }}><div style={{ fontSize: 22, fontWeight: 800, color: C.blue }}>{s.value}</div><div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>{s.label}</div></div>
              ))}
            </div>
          </div></div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, height: "100%" }}>
          <div className="nd-panel"><div className="nd-panel-header"><h3>Budget vs Actual</h3></div><div className="nd-panel-body">
            <table className="nd-table"><thead><tr><th>Project</th><th>Progress</th><th>Status</th></tr></thead><tbody>
              {budgetData.map((p) => (<tr key={p.n}><td><strong>{p.n}</strong></td><td style={{ width: "22%" }}><div className="nd-progress"><div className={"nd-progress-bar " + p.c} style={{ width: p.p + "%" }} /></div></td><td><span className={"nd-badge " + p.c}>{p.s}</span></td></tr>))}
            </tbody></table>
          </div></div>
          <div className="nd-panel" style={{ flex: 1 }}><div className="nd-panel-header"><h3>Financial Overview</h3></div><div className="nd-panel-body">
            {[{ l: "Budget Spent", v: `SAR ${fmt.format(actualSpent)}`, p: utilization, c: C.blue },
              { l: "Remaining", v: `SAR ${fmt.format(Math.max(totalBudget - actualSpent, 0))}`, p: 100 - utilization, c: C.green },
              { l: "Total Budget", v: `SAR ${fmt.format(totalBudget)}`, p: 100, c: C.blue }].map((f) => (
              <div key={f.l} style={{ marginBottom: 8 }}><div className="nd-row-xs"><span style={{ fontSize: 12 }}>{f.l}</span><span style={{ fontWeight: 700, fontSize: 12 }}>{f.v}</span></div><div className="nd-progress thin"><div className="nd-progress-bar" style={{ width: f.p + "%", background: f.c }} /></div></div>
            ))}
          </div></div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, height: "100%" }}>
          <div className="nd-panel"><div className="nd-panel-header"><h3>Top Projects</h3></div><div className="nd-panel-body">
            <table className="nd-table compact"><thead><tr><th>Project</th><th style={{ textAlign: "right" }}>Done</th><th style={{ textAlign: "right" }}>Total</th><th style={{ textAlign: "right" }}>%</th></tr></thead><tbody>
              {topProjects.length ? topProjects.map((p) => (
                <tr key={p.code}>
                  <td><strong>{p.code}</strong></td>
                  <td style={{ textAlign: "right" }}>{p.completed}</td>
                  <td style={{ textAlign: "right" }}>{p.total}</td>
                  <td style={{ textAlign: "right" }}><span className={"nd-badge " + (p.pct >= 50 ? "green" : "amber")}>{p.pct}%</span></td>
                </tr>
              )) : <tr><td colSpan={4} style={{ textAlign: "center", color: "#94a3b8" }}>No data</td></tr>}
            </tbody></table>
          </div></div>
          <div className="nd-panel" style={{ flex: 1 }}><div className="nd-panel-header"><h3>Project Domain Distribution</h3></div><div className="nd-panel-body">
            {(charts?.project_distribution_by_domain || []).slice(0, 4).map((d) => (
              <div key={d.label} style={{ marginBottom: 8 }}><div className="nd-row-xs"><span style={{ fontSize: 12 }}>{d.label}</span><span style={{ fontWeight: 700, fontSize: 12 }}>{d.value}</span></div></div>
            ))}
          </div></div>
        </div>
      </div>
    </div>
  );
}
