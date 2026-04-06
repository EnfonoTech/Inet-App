import { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

export default function FieldHistory() {
  const { teamId } = useAuth();
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const filters = teamId ? [["team", "=", teamId]] : [];
        const res = await fetch(
          `/api/resource/Daily Execution?filters=${encodeURIComponent(JSON.stringify(filters))}` +
          `&fields=${encodeURIComponent(JSON.stringify(["name","rollout_plan","execution_date","execution_status","achieved_qty","gps_location","remarks"]))}` +
          `&limit_page_length=100&order_by=execution_date+desc`,
          { credentials: "include" }
        );
        const json = await res.json();
        setRecords(json?.data || []);
      } catch { setRecords([]); }
      setLoading(false);
    }
    load();
  }, [teamId]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Execution History</h1>
          <div className="page-subtitle">Past execution records for {teamId || "your team"}</div>
        </div>
        <div className="page-actions">
          <span style={{ fontSize: "0.8rem", color: "#64748b" }}>{records.length} records</span>
        </div>
      </div>
      <div className="page-content">
        <div className="data-table-wrapper">
          {loading ? (
            <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Loading...</div>
          ) : records.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📜</div>
              <h3>No execution history</h3>
              <p>Complete today's tasks to see history here.</p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Execution ID</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th style={{ textAlign: "right" }}>Achieved</th>
                  <th>GPS</th>
                  <th>Remarks</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.name}>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{r.name}</td>
                    <td>{r.execution_date}</td>
                    <td>
                      <span className={`status-badge ${(r.execution_status || "").toLowerCase().replace(/\s/g,"-")}`}>
                        <span className="status-dot" />
                        {r.execution_status}
                      </span>
                    </td>
                    <td style={{ textAlign: "right" }}>{r.achieved_qty || 0}</td>
                    <td style={{ fontSize: "0.72rem", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {r.gps_location || "-"}
                    </td>
                    <td style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>{r.remarks || "-"}</td>
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
