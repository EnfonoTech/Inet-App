import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { pmApi } from "../../services/api";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

const STATUS_COLORS = {
  Active: { bg: "#ecfdf5", color: "#065f46", border: "#a7f3d0" },
  "On Hold": { bg: "#fffbeb", color: "#92400e", border: "#fde68a" },
  "At Risk": { bg: "#fef2f2", color: "#991b1b", border: "#fecaca" },
  Completed: { bg: "#eff6ff", color: "#1e40af", border: "#bfdbfe" },
};

function StatusBadge({ status }) {
  const s = STATUS_COLORS[status] || { bg: "#f1f5f9", color: "#64748b", border: "#e2e8f0" };
  return (
    <span style={{
      display: "inline-block", padding: "3px 10px", borderRadius: 12,
      fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3,
      background: s.bg, color: s.color, border: `1px solid ${s.border}`,
    }}>
      {status || "\u2014"}
    </span>
  );
}

const INITIAL_FORM = {
  project_code: "",
  project_name: "",
  customer: "",
  implementation_manager: "",
  huawei_im: "",
  center_area: "",
  project_domain: "",
  budget_amount: "",
  project_status: "Active",
};

function CreateProjectModal({ open, onClose, onCreated }) {
  const [form, setForm] = useState({ ...INITIAL_FORM });
  const [customers, setCustomers] = useState([]);
  const [ims, setIms] = useState([]);
  const [domains, setDomains] = useState([]);
  const [huaweiIms, setHuaweiIms] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setForm({ ...INITIAL_FORM });
    setError(null);
    pmApi.listCustomers({ limit: 200 }).then(res => setCustomers(res || [])).catch(() => {});
    pmApi.listIMMasters({ status: "Active" }).then(res => setIms(res || [])).catch(() => {});
    pmApi.listProjectDomains().then(res => setDomains(res || [])).catch(() => {});
    pmApi.listHuaweiIMs().then(res => setHuaweiIms(res || [])).catch(() => {});
  }, [open]);

  if (!open) return null;

  function setField(key, val) {
    setForm(prev => ({ ...prev, [key]: val }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.project_code.trim() || !form.project_name.trim()) {
      setError("Project Code and Project Name are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        project_code: form.project_code.trim(),
        project_name: form.project_name.trim(),
        customer: form.customer || undefined,
        implementation_manager: form.implementation_manager || undefined,
        huawei_im: form.huawei_im || undefined,
        center_area: form.center_area || undefined,
        project_domain: form.project_domain || undefined,
        budget_amount: form.budget_amount ? parseFloat(form.budget_amount) : undefined,
        project_status: form.project_status,
        active_flag: "Yes",
      };
      await pmApi.upsertProject(payload);
      onCreated();
      onClose();
    } catch (err) {
      setError(err.message || "Failed to create project");
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
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)",
    }} onClick={onClose}>
      <div style={{
        background: "var(--bg-white)", borderRadius: 12, width: 560, maxHeight: "90vh", overflow: "auto",
        boxShadow: "0 20px 60px rgba(0,0,0,0.2)", padding: "28px 32px",
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>Create New Project</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "var(--text-muted)" }}>&times;</button>
        </div>

        {error && (
          <div className="notice error" style={{ marginBottom: 14 }}>
            <span>&oplus;</span> {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              <label style={labelStyle}>Project Code *</label>
              <input style={inputStyle} value={form.project_code} onChange={e => setField("project_code", e.target.value)} placeholder="e.g. PRJ-2026-001" required />
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
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={labelStyle}>Project Name *</label>
              <input style={inputStyle} value={form.project_name} onChange={e => setField("project_name", e.target.value)} placeholder="Project name" required />
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
              <input style={inputStyle} value={form.center_area} onChange={e => setField("center_area", e.target.value)} placeholder="e.g. Central" />
            </div>
            <div>
              <label style={labelStyle}>Project Domain</label>
              <select style={inputStyle} value={form.project_domain} onChange={e => setField("project_domain", e.target.value)}>
                <option value="">-- Select Domain --</option>
                {domains.map(d => (
                  <option key={d.name} value={d.name}>{d.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Huawei IM</label>
              <select style={inputStyle} value={form.huawei_im} onChange={e => setField("huawei_im", e.target.value)}>
                <option value="">-- Select Huawei IM --</option>
                {huaweiIms.map(h => (
                  <option key={h.name} value={h.name}>
                    {h.full_name}{h.email ? ` (${h.email})` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Budget Amount (SAR)</label>
              <input style={inputStyle} type="number" min="0" step="0.01" value={form.budget_amount} onChange={e => setField("budget_amount", e.target.value)} placeholder="0" />
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 22 }}>
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? "Creating..." : "Create Project"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Projects() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [domainFilter, setDomainFilter] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [allDomains, setAllDomains] = useState([]);

  useEffect(() => {
    pmApi.listProjectDomains().then(res => setAllDomains(res || [])).catch(() => {});
  }, []);

  async function loadProjects() {
    setLoading(true);
    try {
      const res = await pmApi.listProjects({
        limit: 200,
        search: search || undefined,
        status: statusFilter || undefined,
        domain: domainFilter || undefined,
      });
      setProjects(res || []);
    } catch {
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadProjects(); }, [search, statusFilter, domainFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Projects</h1>
          <div className="page-subtitle">Manage all INET telecom projects ({projects.length} total)</div>
        </div>
        <div className="page-actions">
          <button className="btn-primary" onClick={() => setShowCreate(true)}>+ New Project</button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        <input
          type="text"
          placeholder="Search by code or name..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            padding: "9px 14px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
            background: "var(--bg-white)", fontSize: 13, width: 260, color: "var(--text)",
          }}
        />
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          style={{
            padding: "9px 14px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
            background: "var(--bg-white)", fontSize: 13, color: "var(--text)",
          }}
        >
          <option value="">All Status</option>
          <option value="Active">Active</option>
          <option value="On Hold">On Hold</option>
          <option value="At Risk">At Risk</option>
          <option value="Completed">Completed</option>
        </select>
        <select
          value={domainFilter}
          onChange={e => setDomainFilter(e.target.value)}
          style={{
            padding: "9px 14px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
            background: "var(--bg-white)", fontSize: 13, color: "var(--text)",
          }}
        >
          <option value="">All Domains</option>
          {allDomains.map(d => <option key={d.name} value={d.name}>{d.name}</option>)}
        </select>
      </div>

      {/* Table */}
      <div style={{ background: "var(--bg-white)", border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "hidden", boxShadow: "var(--shadow-sm)" }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Loading projects...</div>
        ) : projects.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>No projects found.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Project Name</th>
                <th>Domain</th>
                <th>Status</th>
                <th>IM</th>
                <th>Area</th>
                <th>Region</th>
                <th style={{ textAlign: "right" }}>Budget</th>
                <th style={{ textAlign: "right" }}>Actual Cost</th>
                <th style={{ textAlign: "right" }}>Progress</th>
              </tr>
            </thead>
            <tbody>
              {projects.map(p => (
                <tr key={p.name} onClick={() => navigate("/projects/" + p.project_code)} style={{ cursor: "pointer" }}>
                  <td style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, fontSize: 12 }}>{p.project_code}</td>
                  <td style={{ fontWeight: 600, maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.project_name}</td>
                  <td>{p.project_domain || "\u2014"}</td>
                  <td><StatusBadge status={p.project_status} /></td>
                  <td style={{ fontSize: 13 }}>{p.implementation_manager || "\u2014"}</td>
                  <td style={{ fontSize: 13 }}>{p.center_area || "\u2014"}</td>
                  <td style={{ fontSize: 13 }}>{p.region_type || "\u2014"}</td>
                  <td style={{ textAlign: "right", fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>
                    {p.budget_amount ? fmt.format(p.budget_amount) : "\u2014"}
                  </td>
                  <td style={{ textAlign: "right", fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>
                    {p.actual_cost ? fmt.format(p.actual_cost) : "\u2014"}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
                      <div style={{ width: 60, height: 6, borderRadius: 3, background: "#e2e8f0", overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${Math.min(p.completion_percentage || 0, 100)}%`, borderRadius: 3, background: (p.completion_percentage || 0) >= 80 ? "#10b981" : (p.completion_percentage || 0) >= 40 ? "#3b82f6" : "#f59e0b" }} />
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", minWidth: 36, textAlign: "right" }}>
                        {p.completion_percentage || 0}%
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <CreateProjectModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={loadProjects}
      />
    </div>
  );
}
