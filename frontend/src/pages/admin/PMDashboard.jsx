import { useEffect, useState } from "react";
import DashboardSwitcher from "../../components/DashboardSwitcher";
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { pmApi } from "../../services/api";
import { money } from "../../utils/numberFormat";

const fmt = new Intl.NumberFormat("en-US");
const C = { blue: "#1565C0", green: "#2E7D32", amber: "#F57C00", red: "#C62828" };

export default function PMDashboard() {
  const [kpis, setKpis] = useState(null);
  const [charts, setCharts] = useState(null);
  // Project Profitability report (the workbook sheet of that name). Reused
  // here rather than recomputed, so this panel and the Reports page can
  // never disagree. Project Performance is the separate rollout-target
  // report — it lives on the Reports page with its own chart.
  const [projPerf, setProjPerf] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [pk, ch, pp] = await Promise.all([
          pmApi.projectKpis().catch(() => null),
          pmApi.charts().catch(() => null),
          pmApi.reportProjectProfitability({}).catch(() => null),
        ]);
        if (!cancelled) { setKpis(pk); setCharts(ch); setProjPerf(pp); }
      } catch { if (!cancelled) { setKpis(null); setCharts(null); } }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!kpis && !charts && !projPerf) return <div className="nd-dashboard"><DashboardSwitcher /><div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Loading…</div></div>;

  const active = kpis?.active_projects ?? 0;
  const atRisk = kpis?.projects_at_risk ?? 0;
  const overdue = kpis?.overdue_projects ?? 0;
  const onTrack = Math.max(active - atRisk - overdue, 0);
  // total_budget/actual_spent/budget_utilization used to come from
  // budget_amount/actual_cost — dead fields, nothing writes them. Replaced
  // with real company-wide totals: contracted value and revenue realized.
  const totalValue = kpis?.total_value ?? 0;
  const totalRevenue = kpis?.total_revenue ?? 0;
  const revenuePct = kpis?.revenue_pct ?? 0;

  const health = [
    { n: "On Track", v: active > 0 ? Math.round((onTrack / active) * 100) : 0, c: C.green },
    { n: "At Risk", v: active > 0 ? Math.round((atRisk / active) * 100) : 0, c: C.amber },
    { n: "Delayed", v: active > 0 ? Math.round((overdue / active) * 100) : 0, c: C.red },
  ];

  const statusData = charts?.projects_by_status || [];
  const valueData = (charts?.value_vs_revenue || []).slice(0, 5).map((p) => ({
    n: p.project_code || "—",
    p: p.total_value > 0 ? Math.round((p.revenue / p.total_value) * 100) : 0,
    s: p.revenue >= p.total_value && p.total_value > 0 ? "Complete" : "In Progress",
    c: p.revenue >= p.total_value && p.total_value > 0 ? "green" : "amber",
  }));

  // Line-based completion, ranked by contracted value. Cancelled and
  // internal lines are excluded server-side.
  /* Project Profitability — contracted PO value vs revenue delivered,
     straight from the report so the numbers match it exactly. */
  const ppRows = (projPerf?.data || []).slice(0, 8);
  const ppTotals = projPerf?.totals || {};
  // Revenue Achieved = line value of the done lines (submitted / invoiced /
  // closed are all already work done). Not Work Done revenue: only 53 of
  // 11,439 done lines carry a Work Done record here, so that would plot flat.
  const ppChart = ppRows.slice(0, 6).map((r) => ({
    n: r.project_code,
    po: (r.po_value || 0) / 1000,
    rev: (r.achieved || 0) / 1000,
  }));
  const ratingColor = (r) =>
    r === "Excellent" ? C.green : r === "Good" ? C.blue
      : r === "Need Improvement" ? C.amber : "#94a3b8";

  const topProjects = (charts?.top_projects || []).slice(0, 5).map((p) => ({
    code: p.project_code || "—",
    total: p.total || 0,
    completed: p.completed || 0,
    value: p.value || 0,
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
          { l: "Total Value", v: `SAR ${money.format(totalValue)}`, cl: C.blue }, { l: "Revenue Realized", v: `${Number(revenuePct).toFixed(1)}%`, cl: C.green }].map((k) => (
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
          <div className="nd-panel"><div className="nd-panel-header"><h3>Value vs Revenue</h3></div><div className="nd-panel-body">
            <table className="nd-table"><thead><tr><th>Project</th><th>Progress</th><th>Status</th></tr></thead><tbody>
              {valueData.map((p) => (<tr key={p.n}><td><strong>{p.n}</strong></td><td style={{ width: "22%" }}><div className="nd-progress"><div className={"nd-progress-bar " + p.c} style={{ width: p.p + "%" }} /></div></td><td><span className={"nd-badge " + p.c}>{p.s}</span></td></tr>))}
            </tbody></table>
          </div></div>
          <div className="nd-panel" style={{ flex: 1 }}><div className="nd-panel-header"><h3>Financial Overview</h3></div><div className="nd-panel-body">
            {[{ l: "Revenue Realized", v: `SAR ${money.format(totalRevenue)}`, p: revenuePct, c: C.blue },
              { l: "Outstanding", v: `SAR ${money.format(Math.max(totalValue - totalRevenue, 0))}`, p: 100 - revenuePct, c: C.green },
              { l: "Total Value", v: `SAR ${money.format(totalValue)}`, p: 100, c: C.blue }].map((f) => (
              <div key={f.l} style={{ marginBottom: 8 }}><div className="nd-row-xs"><span style={{ fontSize: 12 }}>{f.l}</span><span style={{ fontWeight: 700, fontSize: 12 }}>{f.v}</span></div><div className="nd-progress thin"><div className="nd-progress-bar" style={{ width: f.p + "%", background: f.c }} /></div></div>
            ))}
          </div></div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, height: "100%" }}>
          <div className="nd-panel"><div className="nd-panel-header"><h3>Top Projects</h3><span style={{ fontSize: 10, color: "#94a3b8" }}>by value · PO lines done</span></div><div className="nd-panel-body">
            <table className="nd-table compact"><thead><tr><th>Project</th><th style={{ textAlign: "right" }}>Value</th><th style={{ textAlign: "right" }}>Lines</th><th style={{ textAlign: "right" }}>%</th></tr></thead><tbody>
              {topProjects.length ? topProjects.map((p) => (
                <tr key={p.code}>
                  <td><strong>{p.code}</strong></td>
                  <td style={{ textAlign: "right" }}>{money.format(p.value)}</td>
                  <td style={{ textAlign: "right" }}>{p.completed}/{p.total}</td>
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

      {/* ── Project Performance (from the report of the same name) ──────
             Chart + table both read the report endpoint directly, so this
             panel and the Reports page cannot drift apart. */}
      <div className="nd-grid col2" style={{ marginTop: 10 }}>
        <div className="nd-panel">
          <div className="nd-panel-header">
            <h3>PO Value vs Revenue Achieved</h3>
            <span style={{ fontSize: 10, color: "#94a3b8" }}>top 6 projects · SAR thousands</span>
          </div>
          <div className="nd-panel-body">
            <div className="nd-chart-h170">
              <ResponsiveContainer>
                <BarChart data={ppChart.length ? ppChart : [{ n: "—", po: 0, rev: 0 }]}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="n" tick={{ fontSize: 9 }} />
                  <YAxis tick={{ fontSize: 9 }} />
                  <Tooltip formatter={(v, k) => [`SAR ${money.format(Math.round(v))}k`, k === "po" ? "PO value" : "Achieved"]} />
                  <Bar dataKey="po" fill="#cbd5e1" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="rev" fill={C.green} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div style={{ display: "flex", justifyContent: "center", gap: 14, fontSize: 10, fontWeight: 600, marginTop: 2 }}>
              <span style={{ color: "#94a3b8" }}>PO value</span>
              <span style={{ color: C.green }}>Revenue achieved</span>
            </div>
          </div>
        </div>

        <div className="nd-panel">
          <div className="nd-panel-header">
            <h3>Project Profitability</h3>
            <span style={{ fontSize: 10, color: "#94a3b8" }}>
              {ppTotals.project_code || ""} · delivery {ppTotals.delivery_pct ?? 0}%
            </span>
          </div>
          <div className="nd-panel-body">
            <table className="nd-table compact">
              <thead>
                <tr>
                  <th>Project</th>
                  <th style={{ textAlign: "right" }}>PO Value</th>
                  <th style={{ textAlign: "right" }}>Achieved</th>
                  <th style={{ textAlign: "right" }}>Lines</th>
                  <th style={{ textAlign: "right" }}>Delivery</th>
                  <th>Rating</th>
                </tr>
              </thead>
              <tbody>
                {ppRows.length ? ppRows.map((r) => (
                  <tr key={r.project_code}>
                    <td><strong title={r.project_name}>{r.project_code}</strong></td>
                    <td style={{ textAlign: "right" }}>{money.format(r.po_value || 0)}</td>
                    <td style={{ textAlign: "right" }}>{money.format(r.achieved || 0)}</td>
                    <td style={{ textAlign: "right" }}>{r.completed_lines}/{r.assigned_lines}</td>
                    <td style={{ textAlign: "right" }}>{r.delivery_pct}%</td>
                    <td><span style={{ fontSize: 10, fontWeight: 700, color: ratingColor(r.kpi_rating) }}>{r.kpi_rating}</span></td>
                  </tr>
                )) : <tr><td colSpan={6} style={{ textAlign: "center", color: "#94a3b8" }}>No data</td></tr>}
              </tbody>
              {ppRows.length > 0 && (
                <tfoot>
                  <tr>
                    <td><strong>Total</strong></td>
                    <td style={{ textAlign: "right" }}><strong>{money.format(ppTotals.po_value || 0)}</strong></td>
                    <td style={{ textAlign: "right" }}><strong>{money.format(ppTotals.achieved || 0)}</strong></td>
                    <td style={{ textAlign: "right" }}><strong>{ppTotals.completed_lines}/{ppTotals.assigned_lines}</strong></td>
                    <td style={{ textAlign: "right" }}><strong>{ppTotals.delivery_pct}%</strong></td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      </div>

    </div>
  );
}
