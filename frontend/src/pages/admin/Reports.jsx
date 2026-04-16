import { useEffect, useMemo, useState } from "react";
import { pmApi } from "../../services/api";

const REPORTS = [
  {
    key: "project_status_summary",
    title: "Project Status Summary",
    api: "reportProjectStatusSummary",
    description: "Overview of all projects by status",
  },
  {
    key: "budget_vs_actual_by_project",
    title: "Budget vs Actual",
    api: "reportBudgetVsActualByProject",
    description: "Budget vs actual spend by project",
  },
  {
    key: "team_utilization_report",
    title: "Team Utilization",
    api: "reportTeamUtilizationReport",
    description: "Team activity and utilization rates",
  },
  {
    key: "daily_work_progress_report",
    title: "Daily Work Progress",
    api: "reportDailyWorkProgressReport",
    description: "Daily progress across all activities",
  },
];

export default function Reports() {
  const [activeKey, setActiveKey] = useState(REPORTS[0].key);
  const [columns, setColumns] = useState([]);
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const active = useMemo(
    () => REPORTS.find((r) => r.key === activeKey) || REPORTS[0],
    [activeKey]
  );

  async function loadReport() {
    setLoading(true);
    setError(null);
    try {
      const fn = pmApi[active.api];
      const result = await fn({});
      setColumns(result?.columns || []);
      setData(result?.data || []);
    } catch (err) {
      setColumns([]);
      setData([]);
      setError(err?.message || "Failed to load report.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Reports</h1>
          <div className="page-subtitle">{active.description}</div>
        </div>
        <div className="page-actions">
          <button className="btn-secondary" onClick={loadReport} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* ── Report Selector Tabs ──────────────────────────────── */}
      <div className="tabs">
        {REPORTS.map((r) => (
          <button
            key={r.key}
            type="button"
            className={`tab ${r.key === activeKey ? "active" : ""}`}
            onClick={() => setActiveKey(r.key)}
          >
            {r.title}
          </button>
        ))}
      </div>

      <div className="page-content">
        {error && (
          <div className="notice error" style={{ marginBottom: 16 }}>
            <span>⚠</span> {error}
          </div>
        )}

        <div className="data-table-wrapper">
          {loading ? (
            <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)" }}>
              Loading report…
            </div>
          ) : columns.length === 0 && data.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📈</div>
              <h3>No data available</h3>
              <p>No report data was returned from the server.</p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  {(columns || []).map((col) => (
                    <th key={col.fieldname || col.label}>
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(data || []).map((row, idx) => (
                  <tr key={idx}>
                    {(columns || []).map((col) => (
                      <td key={col.fieldname || col.label}>
                        {row?.[col.fieldname || col.name] ?? "—"}
                      </td>
                    ))}
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
