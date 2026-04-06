import { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

export default function IMPlanning() {
  const { imName } = useAuth();
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("Planned");

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const filters = [["im", "=", imName || ""]];
        if (filter) filters.push(["plan_status", "=", filter]);
        const res = await fetch(
          `/api/resource/Rollout Plan?filters=${encodeURIComponent(JSON.stringify(filters))}` +
          `&fields=${encodeURIComponent(JSON.stringify(["name","system_id","team","plan_date","visit_type","plan_status","target_amount"]))}` +
          `&limit_page_length=200&order_by=plan_date+desc`,
          { credentials: "include" }
        );
        const json = await res.json();
        setPlans(json?.data || []);
      } catch { setPlans([]); }
      setLoading(false);
    }
    load();
  }, [imName, filter]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Planning</h1>
          <div className="page-subtitle">Rollout plans for your teams</div>
        </div>
        <div className="page-actions">
          <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ minWidth: 140 }}>
            <option value="">All Statuses</option>
            <option value="Planned">Planned</option>
            <option value="In Progress">In Progress</option>
            <option value="Completed">Completed</option>
          </select>
        </div>
      </div>
      <div className="page-content">
        <div className="data-table-wrapper">
          {loading ? (
            <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Loading...</div>
          ) : plans.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📅</div>
              <h3>No rollout plans found</h3>
              <p>No plans match the current filter.</p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Plan ID</th>
                  <th>System ID</th>
                  <th>Team</th>
                  <th>Plan Date</th>
                  <th>Visit Type</th>
                  <th>Status</th>
                  <th style={{ textAlign: "right" }}>Target Amount</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((p) => (
                  <tr key={p.name}>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{p.name}</td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{p.system_id}</td>
                    <td>{p.team}</td>
                    <td>{p.plan_date}</td>
                    <td>{p.visit_type}</td>
                    <td>
                      <span className={`status-badge ${(p.plan_status || "").toLowerCase().replace(/\s/g,"-")}`}>
                        <span className="status-dot" />
                        {p.plan_status}
                      </span>
                    </td>
                    <td style={{ textAlign: "right" }}>{fmt.format(p.target_amount || 0)}</td>
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
