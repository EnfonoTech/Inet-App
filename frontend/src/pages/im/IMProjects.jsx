import { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

export default function IMProjects() {
  const { imName } = useAuth();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(
          `/api/resource/Project Control Center?filters=${encodeURIComponent(JSON.stringify([["implementation_manager","=",imName]]))}` +
          `&fields=${encodeURIComponent(JSON.stringify(["name","project_code","project_name","customer","project_status","domain","completion_pct","total_revenue"]))}` +
          `&limit_page_length=100&order_by=modified+desc`,
          { credentials: "include" }
        );
        const json = await res.json();
        setProjects(json?.data || []);
      } catch { setProjects([]); }
      setLoading(false);
    }
    if (imName) load();
  }, [imName]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">My Projects</h1>
          <div className="page-subtitle">Projects assigned to {imName}</div>
        </div>
        <div className="page-actions">
          <span style={{ fontSize: "0.8rem", color: "#64748b" }}>{projects.length} projects</span>
        </div>
      </div>
      <div className="page-content">
        <div className="data-table-wrapper">
          {loading ? (
            <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Loading...</div>
          ) : projects.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📋</div>
              <h3>No projects assigned</h3>
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
                  <th style={{ textAlign: "right" }}>Revenue</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.name}>
                    <td style={{ fontFamily: "monospace", fontSize: "0.8rem" }}>{p.project_code}</td>
                    <td>{p.project_name}</td>
                    <td>{p.customer}</td>
                    <td>{p.domain}</td>
                    <td>
                      <span className={`status-badge ${(p.project_status || "").toLowerCase().replace(/\s/g,"-")}`}>
                        <span className="status-dot" />
                        {p.project_status || "Active"}
                      </span>
                    </td>
                    <td style={{ textAlign: "right" }}>{p.completion_pct ?? 0}%</td>
                    <td style={{ textAlign: "right" }}>{fmt.format(p.total_revenue || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
