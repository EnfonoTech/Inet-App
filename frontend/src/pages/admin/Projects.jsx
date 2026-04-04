import { useEffect, useState } from "react";
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
      {status || "—"}
    </span>
  );
}

export default function Projects() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [domainFilter, setDomainFilter] = useState("");

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

  useEffect(() => { loadProjects(); }, [search, statusFilter, domainFilter]);

  // Get unique domains for filter
  const domains = [...new Set(projects.map(p => p.project_domain).filter(Boolean))].sort();

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Projects</h1>
          <div className="page-subtitle">Manage all INET telecom projects ({projects.length} total)</div>
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
          {domains.map(d => <option key={d} value={d}>{d}</option>)}
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
                <th style={{ textAlign: "right" }}>Budget</th>
                <th style={{ textAlign: "right" }}>Actual Cost</th>
                <th style={{ textAlign: "right" }}>Progress</th>
              </tr>
            </thead>
            <tbody>
              {projects.map(p => (
                <tr key={p.name}>
                  <td style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 600, fontSize: 12 }}>{p.project_code}</td>
                  <td style={{ fontWeight: 600, maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.project_name}</td>
                  <td>{p.project_domain || "—"}</td>
                  <td><StatusBadge status={p.project_status} /></td>
                  <td style={{ fontSize: 13 }}>{p.implementation_manager || "—"}</td>
                  <td style={{ fontSize: 13 }}>{p.center_area || "—"}</td>
                  <td style={{ textAlign: "right", fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>
                    {p.budget_amount ? fmt.format(p.budget_amount) : "—"}
                  </td>
                  <td style={{ textAlign: "right", fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>
                    {p.actual_cost ? fmt.format(p.actual_cost) : "—"}
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
    </div>
  );
}
