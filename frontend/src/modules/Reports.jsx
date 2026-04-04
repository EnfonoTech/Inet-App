import { useEffect, useMemo, useState } from "react";
import { pmApi } from "../services/api";

const REPORTS = [
  { key: "project_status_summary", title: "Project Status Summary", api: "reportProjectStatusSummary" },
  { key: "budget_vs_actual_by_project", title: "Budget vs Actual (By Project)", api: "reportBudgetVsActualByProject" },
  { key: "team_utilization_report", title: "Team Utilization", api: "reportTeamUtilizationReport" },
  { key: "daily_work_progress_report", title: "Daily Work Progress", api: "reportDailyWorkProgressReport" },
];

function ReportTable({ columns, data }) {
  return (
    <div className="card table-card">
      <div className="table-title">Report</div>
      <div style={{ overflow: "auto", borderRadius: 8 }}>
        <table className="data-table">
          <thead>
            <tr>
              {(columns || []).map((c) => (
                <th key={c.fieldname}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(!data || data.length === 0) && (
              <tr>
                <td colSpan={(columns || []).length} className="empty-state">
                  No data
                </td>
              </tr>
            )}
            {(data || []).map((row, idx) => (
              <tr key={idx}>
                {(columns || []).map((c) => (
                  <td key={c.fieldname}>{row?.[c.fieldname] ?? "-"}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Reports() {
  const [activeKey, setActiveKey] = useState(REPORTS[0].key);
  const [columns, setColumns] = useState([]);
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const active = useMemo(() => REPORTS.find((r) => r.key === activeKey) || REPORTS[0], [activeKey]);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const fn = pmApi[active.api];
      const result = await fn({});
      setColumns(result?.columns || []);
      setData(result?.data || []);
    } catch (e) {
      setColumns([]);
      setData([]);
      setError(e?.message || "Failed to load report.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey]);

  return (
    <div className="page-wrap">
      <div className="page-header">
        <h1 className="page-title">Reports</h1>
        <div className="toolbar">
          <button className="btn-secondary" onClick={load} disabled={loading}>
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
      </div>

      {error ? <div className="form-error">{error}</div> : null}

      <div className="grid two-col">
        {REPORTS.map((r) => (
          <button
            key={r.key}
            type="button"
            className={`report-card ${r.key === activeKey ? "active" : ""}`}
            onClick={() => setActiveKey(r.key)}
          >
            <div className="label">{r.title}</div>
            <div className="value">View</div>
          </button>
        ))}
      </div>

      <ReportTable columns={columns} data={data} />
    </div>
  );
}

