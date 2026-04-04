import { useEffect, useRef, useState } from "react";
import { pmApi } from "../../services/api";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

function statusBadgeClass(status) {
  if (!status) return "";
  const s = status.toLowerCase().replace(/\s+/g, "-");
  if (s === "planned") return "planned";
  if (s === "in-execution" || s === "in-progress") return "in-progress";
  if (s === "completed") return "completed";
  if (s === "cancelled") return "cancelled";
  return "new";
}

export default function ExecutionMonitor() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const intervalRef = useRef(null);

  async function loadData() {
    setError(null);
    try {
      const list = await pmApi.listRolloutPlans({
        plan_status: ["in", ["Planned", "In Execution"]],
      });
      setRows(Array.isArray(list) ? list : []);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err.message || "Failed to load execution data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    intervalRef.current = setInterval(loadData, 30_000);
    return () => clearInterval(intervalRef.current);
  }, []);

  function formatTime(d) {
    if (!d) return "";
    return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Execution Monitor</h1>
          <div className="page-subtitle">
            Today's live execution status
            {lastRefresh && (
              <span style={{ marginLeft: 8, color: "var(--text-muted)" }}>
                · Last refreshed {formatTime(lastRefresh)} · Auto-refreshes every 30s
              </span>
            )}
          </div>
        </div>
        <div className="page-actions">
          <span className="live-dot" style={{ marginRight: 4 }} />
          <button className="btn-secondary" onClick={loadData} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      <div className="page-content">
        {error && (
          <div className="notice error" style={{ marginBottom: 16 }}>
            <span>⚠</span> {error}
          </div>
        )}

        <div className="data-table-wrapper">
          {loading && rows.length === 0 ? (
            <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)" }}>
              Loading execution data…
            </div>
          ) : rows.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📊</div>
              <h3>No active executions</h3>
              <p>No plans are currently Planned or In Execution.</p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>System ID</th>
                  <th>Team</th>
                  <th>Plan Date</th>
                  <th>Visit Type</th>
                  <th style={{ textAlign: "right" }}>Target</th>
                  <th style={{ textAlign: "right" }}>Achieved</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const pct = row.target > 0
                    ? Math.round((row.achieved / row.target) * 100)
                    : 0;
                  return (
                    <tr key={row.name}>
                      <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{row.name}</td>
                      <td>{row.team}</td>
                      <td>{row.plan_date}</td>
                      <td>{row.visit_type}</td>
                      <td style={{ textAlign: "right" }}>{fmt.format(row.target || 0)}</td>
                      <td style={{ textAlign: "right" }}>
                        <span style={{ color: pct >= 80 ? "var(--green)" : pct >= 40 ? "var(--amber)" : "var(--red)" }}>
                          {fmt.format(row.achieved || 0)}
                        </span>
                        <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginLeft: 4 }}>
                          ({pct}%)
                        </span>
                      </td>
                      <td>
                        <span className={`status-badge ${statusBadgeClass(row.plan_status)}`}>
                          <span className="status-dot" />
                          {row.plan_status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
