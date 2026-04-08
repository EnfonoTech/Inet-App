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
  { key: "plans", label: "Planning", countKey: "plan_count" },
  { key: "executions", label: "Execution", countKey: "execution_count" },
  { key: "work_done", label: "Work Done", countKey: "work_done_count" },
  { key: "teams", label: "Teams", countKey: null },
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

/* ── Assign Team Modal ─────────────────────────────────── */
function AssignTeamModal({ projectCode, existingTeamIds, onClose, onSaved }) {
  const [allTeams, setAllTeams] = useState([]);
  const [form, setForm] = useState({
    team_id: "",
    role_in_project: "",
    assignment_date: new Date().toISOString().split("T")[0],
    end_date: "",
    daily_cost: "",
    utilization_percentage: "100",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    pmApi.listINETTeams({ status: "Active" }).then(teams => {
      setAllTeams(teams || []);
    }).catch(() => {});
  }, []);

  const availableTeams = allTeams.filter(t => !existingTeamIds.includes(t.team_id));

  function setField(key, val) { setForm(prev => ({ ...prev, [key]: val })); }

  function handleTeamChange(teamId) {
    setField("team_id", teamId);
    const team = allTeams.find(t => t.team_id === teamId);
    if (team && team.daily_cost) {
      setField("daily_cost", String(team.daily_cost));
    }
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.team_id) { setError("Please select a team"); return; }
    setSaving(true);
    setError(null);
    try {
      await pmApi.upsertAssignment({
        team_id: form.team_id,
        project: projectCode,
        role_in_project: form.role_in_project || undefined,
        assignment_date: form.assignment_date,
        end_date: form.end_date || undefined,
        daily_cost: form.daily_cost ? parseFloat(form.daily_cost) : undefined,
        utilization_percentage: form.utilization_percentage ? parseFloat(form.utilization_percentage) : 100,
        status: "Active",
      });
      onSaved();
    } catch (err) {
      setError(err.message || "Failed to assign team");
    } finally {
      setSaving(false);
    }
  }

  const inputStyle = {
    width: "100%", padding: "9px 12px", border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)", fontSize: 13, background: "var(--bg-white)", color: "var(--text)",
  };
  const labelStyle = { display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4, color: "var(--text-label)" };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Assign Team to Project</h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          {error && <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", borderRadius: 6, padding: "8px 12px", fontSize: 13, marginBottom: 14 }}>{error}</div>}
          <form onSubmit={handleSave}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={labelStyle}>Team *</label>
                <select style={inputStyle} value={form.team_id} onChange={e => handleTeamChange(e.target.value)} required>
                  <option value="">-- Select a Team --</option>
                  {availableTeams.map(t => (
                    <option key={t.team_id} value={t.team_id}>
                      {t.team_id} — {t.team_name} ({t.im || "No IM"}) [{t.team_type}]
                    </option>
                  ))}
                </select>
                {availableTeams.length === 0 && allTeams.length > 0 && (
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>All active teams are already assigned.</div>
                )}
              </div>
              <div>
                <label style={labelStyle}>Role in Project</label>
                <select style={inputStyle} value={form.role_in_project} onChange={e => setField("role_in_project", e.target.value)}>
                  <option value="">-- Select --</option>
                  <option value="Installation">Installation</option>
                  <option value="Commissioning">Commissioning</option>
                  <option value="Survey">Survey</option>
                  <option value="Maintenance">Maintenance</option>
                  <option value="Support">Support</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>Daily Cost (SAR)</label>
                <input style={inputStyle} type="number" min="0" step="0.01" value={form.daily_cost} onChange={e => setField("daily_cost", e.target.value)} />
              </div>
              <div>
                <label style={labelStyle}>Assignment Date *</label>
                <input style={inputStyle} type="date" value={form.assignment_date} onChange={e => setField("assignment_date", e.target.value)} required />
              </div>
              <div>
                <label style={labelStyle}>End Date</label>
                <input style={inputStyle} type="date" value={form.end_date} onChange={e => setField("end_date", e.target.value)} />
              </div>
              <div>
                <label style={labelStyle}>Utilization %</label>
                <input style={inputStyle} type="number" min="0" max="100" value={form.utilization_percentage} onChange={e => setField("utilization_percentage", e.target.value)} />
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
              <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={saving}>{saving ? "Assigning..." : "Assign Team"}</button>
            </div>
          </form>
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    pmApi.listIMMasters({ status: "Active" }).then(res => {
      setIms(res || []);
    }).catch(() => {});
    pmApi.listCustomers({ limit: 200 }).then(res => setCustomers(res || [])).catch(() => {});
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
          </div>
          <div>
            <label style={labelStyle}>Domain</label>
            <input style={inputStyle} value={form.project_domain} onChange={e => setField("project_domain", e.target.value)} />
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
  const [showAssignTeam, setShowAssignTeam] = useState(false);
  const [detailModal, setDetailModal] = useState(null);

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

  const { project, dispatches, plans, executions, work_done, teams, financial_summary: fin } = data;

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
    { key: "_open", label: "View", render: (_, row) => <button type="button" className="btn-secondary" style={{ fontSize: "0.72rem", padding: "4px 8px" }} onClick={() => setDetailModal({ title: "PO Dispatch Details", row })}>View</button> },
  ];

  const planColumns = [
    { key: "po_dispatch", label: "POID", mono: true },
    { key: "team", label: "Team" },
    { key: "plan_date", label: "Plan Date" },
    { key: "visit_type", label: "Visit Type" },
    { key: "visit_multiplier", label: "Multiplier", align: "right" },
    { key: "target_amount", label: "Target", align: "right", render: v => v != null ? fmt.format(v) : "\u2014" },
    { key: "achieved_amount", label: "Achieved", align: "right", render: v => v != null ? fmt.format(v) : "\u2014" },
    { key: "completion_pct", label: "Completion", align: "right", render: v => v != null ? `${v}%` : "\u2014" },
    { key: "plan_status", label: "Status", render: v => <Badge value={v} /> },
    { key: "_open", label: "View", render: (_, row) => <button type="button" className="btn-secondary" style={{ fontSize: "0.72rem", padding: "4px 8px" }} onClick={() => setDetailModal({ title: "Rollout Plan Details", row })}>View</button> },
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
    { key: "_open", label: "View", render: (_, row) => <button type="button" className="btn-secondary" style={{ fontSize: "0.72rem", padding: "4px 8px" }} onClick={() => setDetailModal({ title: "Execution Details", row })}>View</button> },
  ];

  const workDoneColumns = [
    { key: "system_id", label: "POID", mono: true },
    { key: "execution", label: "Execution", mono: true },
    { key: "item_code", label: "Item Code" },
    { key: "executed_qty", label: "Qty", align: "right", render: v => v != null ? fmt.format(v) : "\u2014" },
    { key: "billing_rate_sar", label: "Rate (SAR)", align: "right", render: v => v != null ? fmtDec.format(v) : "\u2014" },
    { key: "revenue_sar", label: "Revenue", align: "right", render: v => v != null ? fmt.format(v) : "\u2014" },
    { key: "total_cost_sar", label: "Cost", align: "right", render: v => v != null ? fmt.format(v) : "\u2014" },
    { key: "margin_sar", label: "Margin", align: "right", render: (v) => v != null ? <span style={{ color: v >= 0 ? "#065f46" : "#991b1b", fontWeight: 600 }}>{fmt.format(v)}</span> : "\u2014" },
    { key: "billing_status", label: "Billing", render: v => <Badge value={v} /> },
    { key: "_open", label: "View", render: (_, row) => <button type="button" className="btn-secondary" style={{ fontSize: "0.72rem", padding: "4px 8px" }} onClick={() => setDetailModal({ title: "Work Done Details", row })}>View</button> },
  ];

  const teamColumns = [
    { key: "team_id", label: "Team ID", mono: true },
    { key: "team_name", label: "Team Name" },
    { key: "im", label: "IM" },
    { key: "team_type", label: "Type" },
    { key: "role_in_project", label: "Role" },
    { key: "assignment_date", label: "Assigned" },
    { key: "status", label: "Status", render: v => <Badge value={v} /> },
    { key: "daily_cost", label: "Daily Cost (SAR)", align: "right", render: v => v != null ? fmt.format(v) : "\u2014" },
  ];

  const teamCount = teams ? teams.length : 0;
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
          const count = tab.countKey ? fin[tab.countKey] : (tab.key === "teams" ? teamCount : null);
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
      {activeTab === "plans" && <DataTable columns={planColumns} rows={plans} emptyMsg="No rollout plans created for this project yet." />}
      {activeTab === "executions" && <DataTable columns={executionColumns} rows={executions} emptyMsg="No execution records for this project yet." />}
      {activeTab === "work_done" && <DataTable columns={workDoneColumns} rows={work_done} emptyMsg="No work done records for this project yet." />}
      {activeTab === "teams" && (
        <div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
            <button className="btn-primary" onClick={() => setShowAssignTeam(true)} style={{ fontSize: 13 }}>
              + Assign Team
            </button>
          </div>
          <DataTable columns={teamColumns} rows={teams} emptyMsg="No teams assigned to this project yet." />
          {showAssignTeam && (
            <AssignTeamModal
              projectCode={project.project_code}
              existingTeamIds={(teams || []).map(t => t.team_id)}
              onClose={() => setShowAssignTeam(false)}
              onSaved={() => { setShowAssignTeam(false); loadData(); }}
            />
          )}
        </div>
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
