import { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

function statusTone(value) {
  const s = String(value || "").toLowerCase();
  if (s.includes("complete") || s.includes("approved") || s.includes("active")) return { bg: "#ecfdf5", fg: "#047857" };
  if (s.includes("cancel") || s.includes("reject") || s.includes("risk")) return { bg: "#fef2f2", fg: "#b91c1c" };
  if (s.includes("progress") || s.includes("planned")) return { bg: "#eff6ff", fg: "#1d4ed8" };
  return { bg: "#fffbeb", fg: "#b45309" };
}

function DetailItem({ label, value }) {
  const isStatus = /status|mode/i.test(label);
  const tone = statusTone(value);
  return (
    <div style={{ background: "#fff", borderRadius: 8, padding: "8px 10px" }}>
      <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>{label}</div>
      {isStatus ? (
        <span style={{ display: "inline-block", borderRadius: 999, padding: "3px 10px", fontSize: 12, fontWeight: 700, background: tone.bg, color: tone.fg }}>
          {value == null || value === "" ? "—" : String(value)}
        </span>
      ) : (
        <div style={{ fontSize: 13, color: "#0f172a", fontWeight: 500 }}>{value == null || value === "" ? "—" : String(value)}</div>
      )}
    </div>
  );
}

function statusStyle(status) {
  const s = String(status || "").toLowerCase();
  if (s.includes("risk")) {
    return { bg: "#fef2f2", fg: "#991b1b", bd: "#fecaca" };
  }
  if (s.includes("hold")) {
    return { bg: "#fffbeb", fg: "#92400e", bd: "#fde68a" };
  }
  if (s.includes("active")) {
    return { bg: "#ecfdf5", fg: "#065f46", bd: "#a7f3d0" };
  }
  if (s.includes("complete")) {
    return { bg: "#eff6ff", fg: "#1d4ed8", bd: "#bfdbfe" };
  }
  return { bg: "#f8fafc", fg: "#334155", bd: "#cbd5e1" };
}

export default function IMProjects() {
  const { imName } = useAuth();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [domainFilter, setDomainFilter] = useState("");
  const [detailRow, setDetailRow] = useState(null);

  useEffect(() => {
    async function load() {
      if (!imName) { setLoading(false); return; }
      setLoading(true);
      try {
        const fields = JSON.stringify([
          "name", "project_code", "project_name", "customer",
          "project_status", "project_domain", "completion_percentage",
          "budget_amount", "implementation_manager",
        ]);
        const filters = JSON.stringify([["implementation_manager", "=", imName]]);
        const res = await fetch(
          `/api/resource/Project Control Center?filters=${encodeURIComponent(filters)}` +
          `&fields=${encodeURIComponent(fields)}&limit_page_length=200&order_by=modified+desc`,
          { credentials: "include" }
        );
        const json = await res.json();
        setProjects(json?.data || []);
      } catch {
        setProjects([]);
      }
      setLoading(false);
    }
    load();
  }, [imName]);

  const filtered = projects.filter((p) => {
    if (statusFilter && (p.project_status || "") !== statusFilter) return false;
    if (domainFilter && (p.project_domain || "") !== domainFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (p.project_code || "").toLowerCase().includes(q) ||
      (p.project_name || "").toLowerCase().includes(q) ||
      (p.customer     || "").toLowerCase().includes(q)
    );
  });

  const statuses = [...new Set(projects.map((p) => p.project_status).filter(Boolean))].sort();
  const domains = [...new Set(projects.map((p) => p.project_domain).filter(Boolean))].sort();
  const hasFilters = search || statusFilter || domainFilter;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">My Projects</h1>
          <div className="page-subtitle">
            Projects where Implementation Manager = <strong>{imName || "—"}</strong>
          </div>
        </div>
        <div className="page-actions">
          <span style={{ fontSize: "0.8rem", color: "#64748b" }}>
            {filtered.length} project{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* Toolbar */}
      <div className="toolbar">
        <input
          type="search"
          placeholder="Search project code, name, customer…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: "7px 14px", borderRadius: 8,
            border: "1px solid #e2e8f0", fontSize: "0.84rem", minWidth: 280,
          }}
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem" }}
        >
          <option value="">All Status</option>
          {statuses.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select
          value={domainFilter}
          onChange={(e) => setDomainFilter(e.target.value)}
          style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem" }}
        >
          <option value="">All Domains</option>
          {domains.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        {hasFilters && (
          <button
            className="btn-secondary"
            style={{ fontSize: "0.78rem", padding: "5px 12px" }}
            onClick={() => { setSearch(""); setStatusFilter(""); setDomainFilter(""); }}
          >
            Clear
          </button>
        )}
        <div style={{ flex: 1 }} />
        {!loading && projects.length === 0 && imName && (
          <span style={{ fontSize: "0.78rem", color: "#f59e0b" }}>
            No records found — set Implementation Manager = <strong>{imName}</strong> in Project Control Center
          </span>
        )}
      </div>

      <div className="page-content">
        <div className="data-table-wrapper">
          {loading ? (
            <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Loading...</div>
          ) : !imName ? (
            <div className="empty-state">
              <div className="empty-icon">👤</div>
              <h3>IM account not set up</h3>
              <p>Your user is not linked to an IM Master record. Link IM Master → User Account to your login, and set Implementation Manager on INET Teams and projects.</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📋</div>
              <h3>{search ? "No results" : "No projects assigned"}</h3>
              <p>
                {search
                  ? "Try a different search."
                  : <>Open each project in <a href="/app/project-control-center" target="_blank" rel="noreferrer">Project Control Center</a> and set <strong>Implementation Manager</strong> = <code>{imName}</code></>}
              </p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Project Code</th>
                  <th>Project Name</th>
                  <th>Customer</th>
                  <th>Domain</th>
                  <th>Status</th>
                  <th style={{ textAlign: "right" }}>Completion</th>
                  <th style={{ textAlign: "right" }}>Budget</th>
                  <th>View</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.name}>
                    <td style={{ fontFamily: "monospace", fontSize: "0.8rem" }}>{p.project_code}</td>
                    <td style={{ fontWeight: 600 }}>{p.project_name}</td>
                    <td>{p.customer}</td>
                    <td>{p.project_domain}</td>
                    <td>
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "3px 10px",
                          borderRadius: 999,
                          fontSize: 11,
                          fontWeight: 800,
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                          background: statusStyle(p.project_status).bg,
                          color: statusStyle(p.project_status).fg,
                          border: `1px solid ${statusStyle(p.project_status).bd}`,
                        }}
                      >
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: 999,
                            background: statusStyle(p.project_status).fg,
                            opacity: 0.75,
                          }}
                        />
                        {p.project_status || "Active"}
                      </span>
                    </td>
                    <td style={{ textAlign: "right" }}>{p.completion_percentage ?? 0}%</td>
                    <td style={{ textAlign: "right" }}>{fmt.format(p.budget_amount || 0)}</td>
                    <td>
                      <button type="button" className="btn-secondary" style={{ fontSize: "0.72rem", padding: "4px 10px" }} onClick={() => setDetailRow(p)}>
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={8} style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", fontSize: "0.78rem" }}>
                    <strong>{filtered.length}</strong>{search && ` of ${projects.length}`} project{filtered.length !== 1 ? "s" : ""}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
      {detailRow && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setDetailRow(null)}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 20, width: "min(860px, 94vw)", maxHeight: "78vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ margin: 0, fontSize: "1rem" }}>Project Details</h3>
              <button type="button" onClick={() => setDetailRow(null)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8" }}>&times;</button>
            </div>
            <div style={{ maxHeight: "65vh", overflow: "auto", background: "#f8fafc", borderRadius: 8, padding: 12 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                <div style={{ border: "1px solid #bfdbfe", background: "#eff6ff", color: "#1d4ed8", borderRadius: 999, padding: "4px 10px", fontSize: 12, fontWeight: 700 }}>
                  Project: {detailRow.project_code || "—"}
                </div>
                <div style={{ border: "1px solid #fde68a", background: "#fffbeb", color: "#b45309", borderRadius: 999, padding: "4px 10px", fontSize: 12, fontWeight: 700 }}>
                  Customer: {detailRow.customer || "—"}
                </div>
                <div style={{ border: "1px solid #a7f3d0", background: "#ecfdf5", color: "#047857", borderRadius: 999, padding: "4px 10px", fontSize: 12, fontWeight: 700 }}>
                  IM: {detailRow.implementation_manager || "—"}
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                {Object.entries(detailRow).map(([k, v]) => (
                  <DetailItem
                    key={k}
                    label={String(k).toLowerCase() === "system_id" ? "POID" : k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                    value={v}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
