import { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

export default function IMExecution() {
  const { imName } = useAuth();
  const [executions, setExecutions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const filters = [["im", "=", imName || ""]];
        if (filter) filters.push(["execution_status", "=", filter]);
        const res = await fetch(
          `/api/resource/Daily Execution?filters=${encodeURIComponent(JSON.stringify(filters))}` +
          `&fields=${encodeURIComponent(JSON.stringify(["name","rollout_plan","team","execution_date","execution_status","achieved_qty","gps_location"]))}` +
          `&limit_page_length=200&order_by=execution_date+desc`,
          { credentials: "include" }
        );
        const json = await res.json();
        setExecutions(json?.data || []);
      } catch { setExecutions([]); }
      setLoading(false);
    }
    load();
  }, [imName, filter]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Execution Monitor</h1>
          <div className="page-subtitle">Track your teams' daily execution progress</div>
        </div>
        <div className="page-actions">
          <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ minWidth: 140 }}>
            <option value="">All Statuses</option>
            <option value="In Progress">In Progress</option>
            <option value="Completed">Completed</option>
            <option value="Hold">Hold</option>
            <option value="Postponed">Postponed</option>
          </select>
        </div>
      </div>
      <div className="page-content">
        <div className="data-table-wrapper">
          {loading ? (
            <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Loading...</div>
          ) : executions.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📊</div>
              <h3>No execution records</h3>
              <p>No field execution data available for current filters.</p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Execution ID</th>
                  <th>Rollout Plan</th>
                  <th>Team</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th style={{ textAlign: "right" }}>Achieved Qty</th>
                  <th>GPS</th>
                </tr>
              </thead>
              <tbody>
                {executions.map((e) => (
                  <tr key={e.name}>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{e.name}</td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{e.rollout_plan}</td>
                    <td>{e.team}</td>
                    <td>{e.execution_date}</td>
                    <td>
                      <span className={`status-badge ${(e.execution_status || "").toLowerCase().replace(/\s/g,"-")}`}>
                        <span className="status-dot" />
                        {e.execution_status}
                      </span>
                    </td>
                    <td style={{ textAlign: "right" }}>{e.achieved_qty || 0}</td>
                    <td style={{ fontSize: "0.72rem", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {e.gps_location || "-"}
                    </td>
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
