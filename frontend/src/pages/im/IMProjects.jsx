import { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

export default function IMProjects() {
  const { imName } = useAuth();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState("");

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
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (p.project_code || "").toLowerCase().includes(q) ||
      (p.project_name || "").toLowerCase().includes(q) ||
      (p.customer     || "").toLowerCase().includes(q)
    );
  });

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
        {search && (
          <button className="btn-secondary" style={{ fontSize: "0.78rem", padding: "5px 12px" }}
            onClick={() => setSearch("")}>Clear</button>
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
              <p>Your user is not linked to an IM Master record. See dashboard for setup guide.</p>
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
                      <span className={`status-badge ${(p.project_status || "").toLowerCase().replace(/\s/g, "-")}`}>
                        <span className="status-dot" />
                        {p.project_status || "Active"}
                      </span>
                    </td>
                    <td style={{ textAlign: "right" }}>{p.completion_percentage ?? 0}%</td>
                    <td style={{ textAlign: "right" }}>{fmt.format(p.budget_amount || 0)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={7} style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", fontSize: "0.78rem" }}>
                    <strong>{filtered.length}</strong>{search && ` of ${projects.length}`} project{filtered.length !== 1 ? "s" : ""}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
