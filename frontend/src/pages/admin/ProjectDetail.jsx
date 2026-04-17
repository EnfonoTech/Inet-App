import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { pmApi } from "../../services/api";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });
const fmtDec = new Intl.NumberFormat("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Mirrors server: Hard if center/area text contains "hard" (case-insensitive). */
function regionTypePreviewFromText(text) {
  if (!text) return "Standard";
  return String(text).toLowerCase().includes("hard") ? "Hard" : "Standard";
}

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
      display: "inline-block", padding: "4px 12px", borderRadius: 12,
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
  { key: "plans", label: "Rollout", countKey: "plan_count" },
  { key: "executions", label: "Execution", countKey: "execution_count" },
  { key: "work_done", label: "Work Done", countKey: "work_done_count" },
];

const ROLLOUT_MODAL_TABS = [
  { key: "po_lines", label: "PO lines" },
  { key: "planned", label: "Planned activity" },
  { key: "additional", label: "Additional activities" },
  { key: "expenses", label: "Expenses" },
];

function SummaryCard({ label, value, sub, color, accent }) {
  return (
    <div className={`summary-card ${accent ? `accent-${accent}` : ''}`}>
      <div className="card-label">{label}</div>
      <div className="card-value" style={color ? { color } : undefined}>{value}</div>
      {sub && <div className="card-sub">{sub}</div>}
    </div>
  );
}

function DetailGrid({ items }) {
  return (
    <div className="detail-grid">
      {items.map(([label, value], i) => (
        <div
          key={i}
          className="detail-cell"
          style={{
            borderBottom: i < items.length - 2 ? "1px solid var(--border)" : "none",
            borderRight: i % 2 === 0 ? "1px solid var(--border)" : "none",
          }}
        >
          <div className="cell-label">{label}</div>
          <div className="cell-value">{value || "\u2014"}</div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ message }) {
  return (
    <div className="empty-state" style={{ background: "var(--bg-white)", border: "1px solid var(--border)", borderRadius: "var(--radius)" }}>
      {message}
    </div>
  );
}

function DataTable({ columns, rows, emptyMsg }) {
  if (!rows || rows.length === 0) return <EmptyState message={emptyMsg} />;
  return (
    <div className="table-section">
      <div className="data-table-wrapper">
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
                    ...(c.align === "right" ? { textAlign: "right", fontFamily: "'JetBrains Mono', monospace", fontSize: 13 } : {}),
                    ...(c.mono ? { fontFamily: "'JetBrains Mono', monospace", fontSize: 13 } : {}),
                  }}>
                    {c.render ? c.render(row[c.key], row) : (row[c.key] ?? "\u2014")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** DUID-grouped rollout: sub-tabs with tables + View for full row payload. */
function RolloutDuidModal({ group, onClose, onOpenDetail }) {
  const [sub, setSub] = useState("po_lines");
  useEffect(() => {
    setSub("po_lines");
  }, [group?.duid_label]);

  const openDetail = useCallback(
    (title, row) => {
      if (row && onOpenDetail) onOpenDetail({ title, row });
    },
    [onOpenDetail],
  );

  if (!group) return null;

  const viewBtn = (title, row) => (
    <button
      type="button"
      className="btn-secondary"
      style={{ fontSize: "0.72rem", padding: "4px 8px" }}
      onClick={(e) => {
        e.stopPropagation();
        openDetail(title, row);
      }}
    >
      View
    </button>
  );

  const poCols = [
    { key: "name", label: "POID", mono: true },
    { key: "po_no", label: "PO No" },
    { key: "po_line_no", label: "Line" },
    { key: "item_code", label: "Item" },
    { key: "item_description", label: "Description" },
    { key: "qty", label: "Qty", align: "right", render: (v) => (v != null ? fmt.format(v) : "\u2014") },
    { key: "rate", label: "Rate", align: "right", render: (v) => (v != null ? fmtDec.format(v) : "\u2014") },
    { key: "line_amount", label: "Amount", align: "right", render: (v) => (v != null ? fmt.format(v) : "\u2014") },
    { key: "team", label: "Team" },
    { key: "im", label: "IM" },
    { key: "dispatch_status", label: "Status", render: (v) => <Badge value={v} /> },
    { key: "site_code", label: "DUID" },
    { key: "site_name", label: "Site name" },
    { key: "center_area", label: "Center area" },
    { key: "region_type", label: "Region" },
    { key: "_open", label: "Details", render: (_, row) => viewBtn("PO dispatch details", row) },
  ];

  const planCols = [
    { key: "name", label: "Plan", mono: true },
    { key: "po_dispatch", label: "POID", mono: true },
    { key: "team", label: "Team" },
    { key: "plan_date", label: "Plan date" },
    { key: "plan_end_date", label: "End date" },
    { key: "visit_type", label: "Visit type" },
    { key: "visit_number", label: "Visit #", align: "right" },
    { key: "visit_multiplier", label: "Multiplier", align: "right" },
    { key: "target_amount", label: "Target", align: "right", render: (v) => (v != null ? fmt.format(v) : "\u2014") },
    { key: "achieved_amount", label: "Achieved", align: "right", render: (v) => (v != null ? fmt.format(v) : "\u2014") },
    { key: "completion_pct", label: "Completion", align: "right", render: (v) => (v != null ? `${v}%` : "\u2014") },
    { key: "plan_status", label: "Status", render: (v) => <Badge value={v} /> },
    { key: "access_time", label: "Access time" },
    { key: "access_period", label: "Access period" },
    { key: "region_type", label: "Region" },
    { key: "issue_category", label: "Issue" },
    { key: "source_rollout_plan", label: "Source plan" },
    { key: "_open", label: "Details", render: (_, row) => viewBtn("Rollout plan details", row) },
  ];

  const expenseCols = [
    { key: "name", label: "Work done", mono: true },
    { key: "system_id", label: "POID", mono: true },
    { key: "execution", label: "Execution", mono: true },
    { key: "item_code", label: "Item" },
    { key: "executed_qty", label: "Qty", align: "right", render: (v) => (v != null ? fmt.format(v) : "\u2014") },
    { key: "billing_rate_sar", label: "Rate", align: "right", render: (v) => (v != null ? fmtDec.format(v) : "\u2014") },
    { key: "revenue_sar", label: "Revenue", align: "right", render: (v) => (v != null ? fmt.format(v) : "\u2014") },
    { key: "team_cost_sar", label: "Team cost", align: "right", render: (v) => (v != null ? fmt.format(v) : "\u2014") },
    { key: "subcontract_cost_sar", label: "Subcontract", align: "right", render: (v) => (v != null ? fmt.format(v) : "\u2014") },
    { key: "activity_cost_sar", label: "Activity cost", align: "right", render: (v) => (v != null ? fmt.format(v) : "\u2014") },
    { key: "total_cost_sar", label: "Total cost", align: "right", render: (v) => (v != null ? fmt.format(v) : "\u2014") },
    { key: "margin_sar", label: "Margin", align: "right", render: (v) =>
      v != null ? <span style={{ color: v >= 0 ? "#065f46" : "#991b1b", fontWeight: 600 }}>{fmt.format(v)}</span> : "\u2014" },
    { key: "billing_status", label: "Billing", render: (v) => <Badge value={v} /> },
    { key: "region_type", label: "Region" },
    { key: "_open", label: "Details", render: (_, row) => viewBtn("Work done details", row) },
  ];

  const timeLogCols = [
    { key: "name", label: "Log", mono: true },
    { key: "rollout_plan", label: "Plan", mono: true },
    { key: "team_id", label: "Team" },
    { key: "user", label: "User" },
    { key: "start_time", label: "Start" },
    { key: "end_time", label: "End" },
    { key: "duration_minutes", label: "Minutes", align: "right" },
    { key: "duration_hours", label: "Hours", align: "right" },
    { key: "is_running", label: "Running", render: (v) => (v ? "Yes" : "No") },
    { key: "notes", label: "Notes" },
    { key: "_open", label: "Details", render: (_, row) => viewBtn("Time log details", row) },
  ];

  const duidDisplay = group.site_code || group.duid_label;
  const poidSummary = Array.isArray(group.poid_list) && group.poid_list.length
    ? group.poid_list.join(", ")
    : "\u2014";

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 1100, width: "96vw" }}
      >
        <div className="modal-header">
          <div>
            <h2 className="modal-title" style={{ marginBottom: 6 }}>
              Rollout — DUID {duidDisplay}
            </h2>
            <div style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 500 }}>
              PO lines (POID): {poidSummary}
            </div>
          </div>
          <button type="button" className="modal-close" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="modal-body" style={{ paddingTop: 8 }}>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", borderBottom: "2px solid var(--border)", marginBottom: 16 }}>
            {ROLLOUT_MODAL_TABS.map((t) => {
              const active = sub === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setSub(t.key)}
                  style={{
                    padding: "10px 16px",
                    background: "none",
                    border: "none",
                    borderBottom: active ? "2px solid #6366f1" : "2px solid transparent",
                    marginBottom: -2,
                    fontWeight: active ? 700 : 500,
                    color: active ? "#6366f1" : "#64748b",
                    fontSize: "0.86rem",
                    cursor: "pointer",
                  }}
                >
                  {t.label}
                  <span style={{ marginLeft: 8, fontSize: "0.78rem", opacity: 0.85 }}>
                    {t.key === "po_lines" && `(${group.po_lines?.length ?? 0})`}
                    {t.key === "planned" && `(${group.planned_activities?.length ?? 0})`}
                    {t.key === "additional" && `(${group.additional_activities?.length ?? 0})`}
                    {t.key === "expenses" &&
                      `(${group.expenses?.length ?? 0} · logs ${group.time_logs?.length ?? 0})`}
                  </span>
                </button>
              );
            })}
          </div>

          {sub === "po_lines" && (
            <DataTable
              columns={poCols}
              rows={group.po_lines || []}
              emptyMsg="No PO lines for this DUID."
            />
          )}
          {sub === "planned" && (
            <DataTable
              columns={planCols}
              rows={group.planned_activities || []}
              emptyMsg="No planned rollout activities (Work Done path) for this DUID."
            />
          )}
          {sub === "additional" && (
            <DataTable
              columns={planCols}
              rows={group.additional_activities || []}
              emptyMsg="No extra / re-visit plans for this DUID."
            />
          )}
          {sub === "expenses" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: "var(--text)" }}>
                  Work done (costs & billing)
                </div>
                <DataTable
                  columns={expenseCols}
                  rows={group.expenses || []}
                  emptyMsg="No work done / cost rows linked to this DUID."
                />
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: "var(--text)" }}>
                  Execution time logs
                </div>
                <DataTable
                  columns={timeLogCols}
                  rows={group.time_logs || []}
                  emptyMsg="No execution time logs for plans under this DUID."
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Edit Form for Overview tab ─────────────────────────── */
function EditOverview({ project, onSave, onCancel }) {
  const [form, setForm] = useState({
    project_name: project.project_name || "",
    customer: project.customer || "",
    implementation_manager: project.implementation_manager || "",
    center_area: project.center_area || "",
    project_domain: project.project_domain || "",
    budget_amount: project.budget_amount || "",
    project_status: project.project_status || "Active",
    monthly_target: project.monthly_target || "",
  });
  const [ims, setIms] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [domains, setDomains] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    pmApi.listIMMasters({ status: "Active" }).then(res => {
      setIms(res || []);
    }).catch(() => {});
    pmApi.listCustomers({ limit: 200 }).then(res => setCustomers(res || [])).catch(() => {});
    pmApi.listProjectDomains().then(res => setDomains(res || [])).catch(() => {});
  }, []);

  const inputStyle = {
    width: "100%", padding: "9px 12px", border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)", fontSize: 13, background: "var(--bg-white)", color: "var(--text)",
  };
  const labelStyle = { display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4, color: "var(--text-label)" };

  function setField(key, val) { setForm(prev => ({ ...prev, [key]: val })); }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await pmApi.upsertProject({
        name: project.project_code,
        project_name: form.project_name,
        customer: form.customer || undefined,
        implementation_manager: form.implementation_manager || undefined,
        center_area: form.center_area || undefined,
        project_domain: form.project_domain || undefined,
        budget_amount: form.budget_amount ? parseFloat(form.budget_amount) : undefined,
        project_status: form.project_status,
        monthly_target: form.monthly_target ? parseFloat(form.monthly_target) : undefined,
      });
      onSave();
    } catch (err) {
      setError(err.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ background: "var(--bg-white)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 24 }}>
      {error && <div className="notice error" style={{ marginBottom: 14 }}><span>&oplus;</span> {error}</div>}
      <form onSubmit={handleSave}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={labelStyle}>Project Name</label>
            <input style={inputStyle} value={form.project_name} onChange={e => setField("project_name", e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Customer</label>
            <select style={inputStyle} value={form.customer} onChange={e => setField("customer", e.target.value)}>
              <option value="">-- Select --</option>
              {customers.map(c => <option key={c.name} value={c.customer_name || c.name}>{c.customer_name || c.name}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Implementation Manager</label>
            <select style={inputStyle} value={form.implementation_manager} onChange={e => setField("implementation_manager", e.target.value)}>
              <option value="">-- Select --</option>
              {ims.map(im => <option key={im.name} value={im.name}>{im.full_name}{im.email ? ` (${im.email})` : ""}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Center / Area</label>
            <input style={inputStyle} value={form.center_area} onChange={e => setField("center_area", e.target.value)} />
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
              Region type (saved with project): <strong>{regionTypePreviewFromText(form.center_area)}</strong>
            </div>
          </div>
          <div>
            <label style={labelStyle}>Domain</label>
            <select style={inputStyle} value={form.project_domain} onChange={e => setField("project_domain", e.target.value)}>
              <option value="">-- Select Domain --</option>
              {form.project_domain && !domains.some((d) => d.name === form.project_domain) && (
                <option value={form.project_domain}>{form.project_domain}</option>
              )}
              {domains.map((d) => (
                <option key={d.name} value={d.name}>{d.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Budget Amount (SAR)</label>
            <input style={inputStyle} type="number" min="0" step="0.01" value={form.budget_amount} onChange={e => setField("budget_amount", e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Monthly Target (SAR)</label>
            <input style={inputStyle} type="number" min="0" step="0.01" value={form.monthly_target} onChange={e => setField("monthly_target", e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Status</label>
            <select style={inputStyle} value={form.project_status} onChange={e => setField("project_status", e.target.value)}>
              <option value="Active">Active</option>
              <option value="On Hold">On Hold</option>
              <option value="At Risk">At Risk</option>
              <option value="Completed">Completed</option>
            </select>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
          <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={saving}>{saving ? "Saving..." : "Save Changes"}</button>
        </div>
      </form>
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
  const [editing, setEditing] = useState(false);
  const [detailModal, setDetailModal] = useState(null);
  const [rolloutModalGroup, setRolloutModalGroup] = useState(null);

  function loadData() {
    setLoading(true);
    setError(null);
    pmApi.getProjectSummary(projectCode)
      .then(res => { setData(res); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  }

  useEffect(() => { loadData(); }, [projectCode]);

  if (loading) {
    return (
      <div style={{ padding: 80, textAlign: "center", color: "var(--text-muted)", fontSize: 15 }}>Loading project details...</div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 80, textAlign: "center" }}>
        <div style={{ color: "#991b1b", marginBottom: 20, fontSize: 15 }}>Failed to load project: {error}</div>
        <button className="btn-secondary" onClick={() => navigate("/projects")}>
          Back to Projects
        </button>
      </div>
    );
  }

  const {
    project,
    dispatches,
    plans,
    executions,
    work_done,
    financial_summary: fin,
    rollout_by_duid: rolloutByDuid = [],
  } = data;

  const dispatchColumns = [
    { key: "name", label: "POID", mono: true },
    { key: "po_line_no", label: "Line", mono: true },
    { key: "item_code", label: "Item Code" },
    { key: "item_description", label: "Description" },
    { key: "qty", label: "Qty", align: "right", render: v => v != null ? fmt.format(v) : "\u2014" },
    { key: "rate", label: "Rate", align: "right", render: v => v != null ? fmtDec.format(v) : "\u2014" },
    { key: "line_amount", label: "Amount", align: "right", render: v => v != null ? fmt.format(v) : "\u2014" },
    { key: "team", label: "Team" },
    { key: "im", label: "IM" },
    { key: "dispatch_status", label: "Status", render: v => <Badge value={v} /> },
    { key: "region_type", label: "Region" },
    { key: "_open", label: "View", render: (_, row) => <button type="button" className="btn-secondary" style={{ fontSize: "0.72rem", padding: "4px 8px" }} onClick={() => setDetailModal({ title: "PO Dispatch Details", row })}>View</button> },
  ];

  const executionColumns = [
    { key: "system_id", label: "POID", mono: true },
    { key: "rollout_plan", label: "Plan", mono: true },
    { key: "team", label: "Team" },
    { key: "execution_date", label: "Date" },
    { key: "achieved_qty", label: "Achieved Qty", align: "right", render: v => v != null ? fmt.format(v) : "\u2014" },
    { key: "achieved_amount", label: "Achieved Amt", align: "right", render: v => v != null ? fmt.format(v) : "\u2014" },
    { key: "execution_status", label: "Status", render: v => <Badge value={v} /> },
    { key: "qc_status", label: "QC", render: v => <Badge value={v} /> },
    { key: "region_type", label: "Region" },
    { key: "_open", label: "View", render: (_, row) => <button type="button" className="btn-secondary" style={{ fontSize: "0.72rem", padding: "4px 8px" }} onClick={() => setDetailModal({ title: "Execution Details", row })}>View</button> },
  ];

  const workDoneColumns = [
    { key: "system_id", label: "POID", mono: true },
    { key: "execution", label: "Execution", mono: true },
    { key: "item_code", label: "Item Code" },
    { key: "region_type", label: "Region" },
    { key: "executed_qty", label: "Qty", align: "right", render: v => v != null ? fmt.format(v) : "\u2014" },
    { key: "billing_rate_sar", label: "Rate (SAR)", align: "right", render: v => v != null ? fmtDec.format(v) : "\u2014" },
    { key: "revenue_sar", label: "Revenue", align: "right", render: v => v != null ? fmt.format(v) : "\u2014" },
    { key: "total_cost_sar", label: "Cost", align: "right", render: v => v != null ? fmt.format(v) : "\u2014" },
    { key: "margin_sar", label: "Margin", align: "right", render: (v) => v != null ? <span style={{ color: v >= 0 ? "#065f46" : "#991b1b", fontWeight: 600 }}>{fmt.format(v)}</span> : "\u2014" },
    { key: "billing_status", label: "Billing", render: v => <Badge value={v} /> },
    { key: "_open", label: "View", render: (_, row) => <button type="button" className="btn-secondary" style={{ fontSize: "0.72rem", padding: "4px 8px" }} onClick={() => setDetailModal({ title: "Work Done Details", row })}>View</button> },
  ];

  const marginColor = fin.total_margin >= 0 ? "#065f46" : "#991b1b";
  const marginAccent = fin.total_margin >= 0 ? "green" : "red";

  return (
    <div className="project-detail">
      {/* Header */}
      <div className="project-header">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <button className="back-btn" onClick={() => navigate("/projects")}>
            <span style={{ fontSize: 16, lineHeight: 1 }}>&larr;</span> Back to Projects
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn-secondary" onClick={() => { setActiveTab("overview"); setEditing(true); }} style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 5 }}>
              <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              Edit Project
            </button>
            <a href={`/app/project-control-center/${encodeURIComponent(project.project_code)}`} target="_blank" rel="noreferrer" className="btn-secondary" style={{ fontSize: 13, textDecoration: "none", display: "flex", alignItems: "center", gap: 5 }}>
              <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              Open in Desk
            </a>
          </div>
        </div>
        <div className="badges-row">
          <h1 className="project-code">{project.project_code}</h1>
          <Badge value={project.project_status} />
          {project.project_domain && (
            <span className="domain-badge">{project.project_domain}</span>
          )}
        </div>
        <div className="project-name">{project.project_name}</div>
        {/* Quick info: IM assignment */}
        {project.implementation_manager && (
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
            <strong>IM:</strong> {project.implementation_manager}
            {project.customer && <> &nbsp;·&nbsp; <strong>Customer:</strong> {project.customer}</>}
          </div>
        )}
      </div>

      {/* Financial Summary Cards */}
      <div className="summary-cards">
        <SummaryCard label="Total PO Value" value={`SAR ${fmt.format(fin.total_po_value)}`} sub={`${fin.dispatch_count} dispatch lines`} accent="blue" />
        <SummaryCard label="Revenue" value={`SAR ${fmt.format(fin.total_revenue)}`} sub={`${fin.work_done_count} work done records`} accent="green" />
        <SummaryCard label="Cost" value={`SAR ${fmt.format(fin.total_cost)}`} sub={`${fin.execution_count} executions`} accent="amber" />
        <SummaryCard label="Margin" value={`SAR ${fmt.format(fin.total_margin)}`} color={marginColor} accent={marginAccent} sub={fin.total_revenue > 0 ? `${((fin.total_margin / fin.total_revenue) * 100).toFixed(1)}% margin` : "No revenue yet"} />
      </div>

      {/* Tabs */}
      <div className="project-tabs">
        {TABS.map(tab => {
          const count = tab.countKey ? fin[tab.countKey] : null;
          const isActive = activeTab === tab.key;
          return (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)} className={`project-tab${isActive ? ' active' : ''}`}>
              {tab.label}
              {count != null && <span className="tab-count">{count}</span>}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      {activeTab === "overview" && (
        editing ? (
          <EditOverview
            project={project}
            onSave={() => { setEditing(false); loadData(); }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <div>
            <DetailGrid items={[
              ["Project Code", project.project_code],
              ["Project Name", project.project_name],
              ["Domain", project.project_domain],
              ["Customer", project.customer],
              ["Huawei IM", project.huawei_im],
              ["Implementation Manager", project.implementation_manager],
              ["Center / Area", project.center_area],
              ["Region type", project.region_type || regionTypePreviewFromText(project.center_area)],
              ["Active", project.active_flag ? "Yes" : "No"],
              ["Budget Amount", project.budget_amount ? `SAR ${fmt.format(project.budget_amount)}` : null],
              ["Monthly Target", project.monthly_target ? `SAR ${fmt.format(project.monthly_target)}` : null],
              ["Actual Cost", project.actual_cost ? `SAR ${fmt.format(project.actual_cost)}` : null],
              ["Completion", project.completion_percentage != null ? `${project.completion_percentage}%` : null],
              ["Status", project.project_status],
            ]} />
          </div>
        )
      )}

      {activeTab === "dispatches" && <DataTable columns={dispatchColumns} rows={dispatches} emptyMsg="No PO lines dispatched for this project yet." />}
      {activeTab === "plans" && (
        <div>
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 16px", maxWidth: 720 }}>
            Rollout is grouped by DUID (site code). PO lines that share the same DUID appear together. Open a row to see PO
            lines, planned visits, additional visits (extra / re-visit), and expenses (work done costs and field time logs) for
            that site.
          </p>
          {(!rolloutByDuid || rolloutByDuid.length === 0) ? (
            <EmptyState message="No rollout data yet. Dispatch PO lines to a project, then create rollout plans." />
          ) : (
            <DataTable
              columns={[
                {
                  key: "_d",
                  label: "DUID",
                  mono: true,
                  render: (_, g) => (g.site_code && g.site_code !== "(No DUID)" ? g.site_code : g.duid_label),
                },
                { key: "site_name", label: "Site name", render: (v) => v || "\u2014" },
                {
                  key: "_npo",
                  label: "# PO lines",
                  align: "right",
                  render: (_, g) => g.po_lines?.length ?? 0,
                },
                {
                  key: "_poids",
                  label: "POIDs (same DUID)",
                  render: (_, g) =>
                    g.poid_list?.length ? (
                      <span style={{ fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>{g.poid_list.join(", ")}</span>
                    ) : (
                      "\u2014"
                    ),
                },
                {
                  key: "_pl",
                  label: "Planned",
                  align: "right",
                  render: (_, g) => g.planned_activities?.length ?? 0,
                },
                {
                  key: "_ad",
                  label: "Additional",
                  align: "right",
                  render: (_, g) => g.additional_activities?.length ?? 0,
                },
                {
                  key: "_ex",
                  label: "WD / logs",
                  align: "right",
                  render: (_, g) =>
                    `${g.expenses?.length ?? 0} / ${g.time_logs?.length ?? 0}`,
                },
                {
                  key: "_op",
                  label: "",
                  render: (_, g) => (
                    <button
                      type="button"
                      className="btn-primary"
                      style={{ fontSize: 12, padding: "6px 14px" }}
                      onClick={() => setRolloutModalGroup(g)}
                    >
                      Open
                    </button>
                  ),
                },
              ]}
              rows={rolloutByDuid.map((g) => ({ ...g, name: g.duid_label }))}
              emptyMsg="No DUID groups."
            />
          )}
        </div>
      )}
      {activeTab === "executions" && <DataTable columns={executionColumns} rows={executions} emptyMsg="No execution records for this project yet." />}
      {activeTab === "work_done" && <DataTable columns={workDoneColumns} rows={work_done} emptyMsg="No work done records for this project yet." />}

      {rolloutModalGroup && (
        <RolloutDuidModal
          group={rolloutModalGroup}
          onClose={() => setRolloutModalGroup(null)}
          onOpenDetail={(p) => setDetailModal(p)}
        />
      )}

      {detailModal && (
        <div className="modal-overlay" onClick={() => setDetailModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">{detailModal.title}</h2>
              <button className="modal-close" onClick={() => setDetailModal(null)}>&times;</button>
            </div>
            <div className="modal-body">
              <div style={{ background: "#f8fafc", borderRadius: 8, padding: 10 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                  {["name", "po_dispatch", "rollout_plan", "execution", "team", "status", "plan_status", "execution_status", "billing_status"]
                    .filter((k) => detailModal.row && detailModal.row[k])
                    .slice(0, 4)
                    .map((k) => (
                      <div key={k} style={{ border: "1px solid #bfdbfe", background: "#eff6ff", color: "#1d4ed8", borderRadius: 999, padding: "4px 10px", fontSize: 12, fontWeight: 700 }}>
                        {k.replace(/_/g, " ").replace(/\b\w/g, (x) => x.toUpperCase())}: {String(detailModal.row[k])}
                      </div>
                    ))}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, borderRadius: 8, background: "#fff" }}>
                  {Object.entries(detailModal.row || {}).map(([k, v]) => (
                    <div key={k} style={{ padding: "8px 10px" }}>
                      <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>
                        {k.replace(/_/g, " ").replace(/\b\w/g, (x) => x.toUpperCase())}
                      </div>
                      {/(^|_)status$/i.test(k) || /status/i.test(k) ? (
                        <span style={{
                          display: "inline-block",
                          borderRadius: 999,
                          padding: "3px 10px",
                          fontSize: 12,
                          fontWeight: 700,
                          background: String(v || "").toLowerCase().includes("complete") || String(v || "").toLowerCase().includes("approved")
                            ? "#ecfdf5"
                            : String(v || "").toLowerCase().includes("cancel") || String(v || "").toLowerCase().includes("reject") || String(v || "").toLowerCase().includes("fail")
                              ? "#fef2f2"
                              : String(v || "").toLowerCase().includes("progress") || String(v || "").toLowerCase().includes("execution")
                                ? "#eff6ff"
                                : "#fffbeb",
                          color: String(v || "").toLowerCase().includes("complete") || String(v || "").toLowerCase().includes("approved")
                            ? "#047857"
                            : String(v || "").toLowerCase().includes("cancel") || String(v || "").toLowerCase().includes("reject") || String(v || "").toLowerCase().includes("fail")
                              ? "#b91c1c"
                              : String(v || "").toLowerCase().includes("progress") || String(v || "").toLowerCase().includes("execution")
                                ? "#1d4ed8"
                                : "#b45309",
                        }}>
                          {v == null || v === "" ? "—" : String(v)}
                        </span>
                      ) : (
                        <div style={{ fontSize: 13, color: "#0f172a", fontWeight: 500 }}>
                          {v == null || v === "" ? "—" : String(v)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
