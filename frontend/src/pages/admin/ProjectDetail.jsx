import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { pmApi } from "../../services/api";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });
const fmtDec = new Intl.NumberFormat("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const STATUS_COLORS = {
  Active: { bg: "#ecfdf5", color: "#065f46", border: "#a7f3d0" },
  "On Hold": { bg: "#fffbeb", color: "#92400e", border: "#fde68a" },
  "At Risk": { bg: "#fef2f2", color: "#991b1b", border: "#fecaca" },
  Completed: { bg: "#eff6ff", color: "#1e40af", border: "#bfdbfe" },
  Dispatched: { bg: "#ecfdf5", color: "#065f46", border: "#a7f3d0" },
  Pending: { bg: "#fffbeb", color: "#92400e", border: "#fde68a" },
  Planned: { bg: "#eff6ff", color: "#1e40af", border: "#bfdbfe" },
  Executed: { bg: "#ecfdf5", color: "#065f46", border: "#a7f3d0" },
  Billed: { bg: "#f0fdf4", color: "#166534", border: "#86efac" },
  Unbilled: { bg: "#fef2f2", color: "#991b1b", border: "#fecaca" },
};

function Badge({ value }) {
  const s = STATUS_COLORS[value] || { bg: "#f1f5f9", color: "#64748b", border: "#e2e8f0" };
  return (
    <span style={{
      display: "inline-block", padding: "3px 10px", borderRadius: 12,
      fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3,
      background: s.bg, color: s.color, border: `1px solid ${s.border}`,
    }}>
      {value || "\u2014"}
    </span>
  );
}

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "dispatches", label: "PO Lines", countKey: "dispatch_count" },
  { key: "plans", label: "Planning", countKey: "plan_count" },
  { key: "executions", label: "Execution", countKey: "execution_count" },
  { key: "work_done", label: "Work Done", countKey: "work_done_count" },
  { key: "teams", label: "Teams", countKey: null },
];

function SummaryCard({ label, value, sub, color }) {
  return (
    <div style={{
      flex: "1 1 200px", background: "var(--bg-white)", border: "1px solid var(--border)",
      borderRadius: "var(--radius)", padding: "18px 20px", boxShadow: "var(--shadow-sm)",
    }}>
      <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color: color || "var(--text)" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function DetailGrid({ items }) {
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0,
      background: "var(--bg-white)", border: "1px solid var(--border)", borderRadius: "var(--radius)",
      overflow: "hidden",
    }}>
      {items.map(([label, value], i) => (
        <div key={i} style={{
          padding: "12px 18px",
          borderBottom: i < items.length - 2 ? "1px solid var(--border)" : "none",
          borderRight: i % 2 === 0 ? "1px solid var(--border)" : "none",
        }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>{label}</div>
          <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text)" }}>{value || "\u2014"}</div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ message }) {
  return (
    <div style={{ padding: 48, textAlign: "center", color: "var(--text-muted)", background: "var(--bg-white)", border: "1px solid var(--border)", borderRadius: "var(--radius)" }}>
      {message}
    </div>
  );
}

function DataTable({ columns, rows, emptyMsg }) {
  if (!rows || rows.length === 0) return <EmptyState message={emptyMsg} />;
  return (
    <div style={{ background: "var(--bg-white)", border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "auto", boxShadow: "var(--shadow-sm)" }}>
      <table className="data-table">
        <thead>
          <tr>
            {columns.map(c => (
              <th key={c.key} style={c.align === "right" ? { textAlign: "right" } : {}}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.name || i}>
              {columns.map(c => (
                <td key={c.key} style={{
                  ...(c.align === "right" ? { textAlign: "right", fontFamily: "'JetBrains Mono', monospace", fontSize: 12 } : {}),
                  ...(c.mono ? { fontFamily: "'JetBrains Mono', monospace", fontSize: 12 } : {}),
                }}>
                  {c.render ? c.render(row[c.key], row) : (row[c.key] ?? "\u2014")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ProjectDetail() {
  const { projectCode } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");

  useEffect(() => {
    setLoading(true);
    setError(null);
    pmApi.getProjectSummary(projectCode)
      .then(res => { setData(res); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  }, [projectCode]);

  if (loading) {
    return (
      <div style={{ padding: 60, textAlign: "center", color: "var(--text-muted)" }}>Loading project details...</div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 60, textAlign: "center" }}>
        <div style={{ color: "#991b1b", marginBottom: 16 }}>Failed to load project: {error}</div>
        <button onClick={() => navigate("/projects")} style={{ padding: "8px 20px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", background: "var(--bg-white)", cursor: "pointer", fontSize: 13 }}>
          Back to Projects
        </button>
      </div>
    );
  }

  const { project, dispatches, plans, executions, work_done, teams, financial_summary: fin } = data;

  const dispatchColumns = [
    { key: "system_id", label: "System ID", mono: true },
    { key: "po_no", label: "PO No", mono: true },
    { key: "po_line_no", label: "Line", mono: true },
    { key: "item_code", label: "Item Code" },
    { key: "item_description", label: "Description" },
    { key: "qty", label: "Qty", align: "right", render: v => v != null ? fmt.format(v) : "\u2014" },
    { key: "rate", label: "Rate", align: "right", render: v => v != null ? fmtDec.format(v) : "\u2014" },
    { key: "line_amount", label: "Amount", align: "right", render: v => v != null ? fmt.format(v) : "\u2014" },
    { key: "team", label: "Team" },
    { key: "im", label: "IM" },
    { key: "dispatch_status", label: "Status", render: v => <Badge value={v} /> },
  ];

  const planColumns = [
    { key: "system_id", label: "System ID", mono: true },
    { key: "po_dispatch", label: "Dispatch", mono: true },
    { key: "team", label: "Team" },
    { key: "plan_date", label: "Plan Date" },
    { key: "visit_type", label: "Visit Type" },
    { key: "visit_multiplier", label: "Multiplier", align: "right" },
    { key: "target_amount", label: "Target", align: "right", render: v => v != null ? fmt.format(v) : "\u2014" },
    { key: "achieved_amount", label: "Achieved", align: "right", render: v => v != null ? fmt.format(v) : "\u2014" },
    { key: "completion_pct", label: "Completion", align: "right", render: v => v != null ? `${v}%` : "\u2014" },
    { key: "plan_status", label: "Status", render: v => <Badge value={v} /> },
  ];

  const executionColumns = [
    { key: "system_id", label: "System ID", mono: true },
    { key: "rollout_plan", label: "Plan", mono: true },
    { key: "team", label: "Team" },
    { key: "execution_date", label: "Date" },
    { key: "achieved_qty", label: "Achieved Qty", align: "right", render: v => v != null ? fmt.format(v) : "\u2014" },
    { key: "achieved_amount", label: "Achieved Amt", align: "right", render: v => v != null ? fmt.format(v) : "\u2014" },
    { key: "execution_status", label: "Status", render: v => <Badge value={v} /> },
    { key: "qc_status", label: "QC", render: v => <Badge value={v} /> },
  ];

  const workDoneColumns = [
    { key: "system_id", label: "System ID", mono: true },
    { key: "execution", label: "Execution", mono: true },
    { key: "item_code", label: "Item Code" },
    { key: "executed_qty", label: "Qty", align: "right", render: v => v != null ? fmt.format(v) : "\u2014" },
    { key: "billing_rate_sar", label: "Rate (SAR)", align: "right", render: v => v != null ? fmtDec.format(v) : "\u2014" },
    { key: "revenue_sar", label: "Revenue", align: "right", render: v => v != null ? fmt.format(v) : "\u2014" },
    { key: "total_cost_sar", label: "Cost", align: "right", render: v => v != null ? fmt.format(v) : "\u2014" },
    { key: "margin_sar", label: "Margin", align: "right", render: (v) => v != null ? <span style={{ color: v >= 0 ? "#065f46" : "#991b1b", fontWeight: 600 }}>{fmt.format(v)}</span> : "\u2014" },
    { key: "billing_status", label: "Billing", render: v => <Badge value={v} /> },
  ];

  const teamColumns = [
    { key: "team_id", label: "Team ID", mono: true },
    { key: "team_name", label: "Team Name" },
    { key: "im", label: "IM" },
    { key: "team_type", label: "Type" },
    { key: "status", label: "Status", render: v => <Badge value={v} /> },
    { key: "daily_cost", label: "Daily Cost (SAR)", align: "right", render: v => v != null ? fmt.format(v) : "\u2014" },
  ];

  const teamCount = teams ? teams.length : 0;

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <button
          onClick={() => navigate("/projects")}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 14px",
            border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
            background: "var(--bg-white)", cursor: "pointer", fontSize: 13, color: "var(--text-muted)",
            marginBottom: 16,
          }}
        >
          <span style={{ fontSize: 16 }}>&larr;</span> Back to Projects
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
            {project.project_code}
          </h1>
          <Badge value={project.project_status} />
          {project.project_domain && (
            <span style={{
              display: "inline-block", padding: "3px 10px", borderRadius: 12,
              fontSize: 11, fontWeight: 600, background: "#f1f5f9", color: "#475569", border: "1px solid #e2e8f0",
            }}>
              {project.project_domain}
            </span>
          )}
        </div>
        <div style={{ fontSize: 15, color: "var(--text-muted)", marginTop: 6 }}>{project.project_name}</div>
      </div>

      {/* Financial Summary Cards */}
      <div style={{ display: "flex", gap: 14, marginBottom: 24, flexWrap: "wrap" }}>
        <SummaryCard label="Total PO Value" value={`SAR ${fmt.format(fin.total_po_value)}`} sub={`${fin.dispatch_count} dispatch lines`} />
        <SummaryCard label="Revenue" value={`SAR ${fmt.format(fin.total_revenue)}`} sub={`${fin.work_done_count} work done records`} />
        <SummaryCard label="Cost" value={`SAR ${fmt.format(fin.total_cost)}`} sub={`${fin.execution_count} executions`} />
        <SummaryCard
          label="Margin"
          value={`SAR ${fmt.format(fin.total_margin)}`}
          color={fin.total_margin >= 0 ? "#065f46" : "#991b1b"}
          sub={fin.total_revenue > 0 ? `${((fin.total_margin / fin.total_revenue) * 100).toFixed(1)}% margin` : "No revenue yet"}
        />
      </div>

      {/* Tabs */}
      <div style={{
        display: "flex", gap: 0, borderBottom: "2px solid var(--border)", marginBottom: 20,
      }}>
        {TABS.map(tab => {
          const count = tab.countKey ? fin[tab.countKey] : (tab.key === "teams" ? teamCount : null);
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                padding: "10px 20px", border: "none", background: "none", cursor: "pointer",
                fontSize: 13, fontWeight: 600, color: isActive ? "#2563eb" : "var(--text-muted)",
                borderBottom: isActive ? "2px solid #2563eb" : "2px solid transparent",
                marginBottom: -2, transition: "all 0.15s",
                display: "flex", alignItems: "center", gap: 6,
              }}
            >
              {tab.label}
              {count != null && (
                <span style={{
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  minWidth: 20, height: 20, padding: "0 6px", borderRadius: 10,
                  fontSize: 11, fontWeight: 700,
                  background: isActive ? "#dbeafe" : "#f1f5f9",
                  color: isActive ? "#2563eb" : "#64748b",
                }}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      {activeTab === "overview" && (
        <DetailGrid items={[
          ["Project Code", project.project_code],
          ["Project Name", project.project_name],
          ["Domain", project.project_domain],
          ["Customer", project.customer],
          ["Huawei IM", project.huawei_im],
          ["Implementation Manager", project.implementation_manager],
          ["Center / Area", project.center_area],
          ["Active", project.active_flag ? "Yes" : "No"],
          ["Budget Amount", project.budget_amount ? `SAR ${fmt.format(project.budget_amount)}` : null],
          ["Actual Cost", project.actual_cost ? `SAR ${fmt.format(project.actual_cost)}` : null],
          ["Completion", project.completion_percentage != null ? `${project.completion_percentage}%` : null],
          ["Status", project.project_status],
        ]} />
      )}

      {activeTab === "dispatches" && (
        <DataTable columns={dispatchColumns} rows={dispatches} emptyMsg="No PO lines dispatched for this project yet." />
      )}

      {activeTab === "plans" && (
        <DataTable columns={planColumns} rows={plans} emptyMsg="No rollout plans created for this project yet." />
      )}

      {activeTab === "executions" && (
        <DataTable columns={executionColumns} rows={executions} emptyMsg="No execution records for this project yet." />
      )}

      {activeTab === "work_done" && (
        <DataTable columns={workDoneColumns} rows={work_done} emptyMsg="No work done records for this project yet." />
      )}

      {activeTab === "teams" && (
        <DataTable columns={teamColumns} rows={teams} emptyMsg="No teams assigned to this project yet." />
      )}
    </div>
  );
}
