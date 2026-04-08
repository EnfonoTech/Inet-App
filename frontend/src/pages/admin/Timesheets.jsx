import { useEffect, useState } from "react";
import { pmApi } from "../../services/api";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });

function shortDt(v) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(v);
  }
}

export default function Timesheets() {
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");
  const [teamFilter, setTeamFilter] = useState("");

  async function loadLogs() {
    setLoading(true);
    try {
      const filters = {};
      if (dateFrom) filters.from_date = dateFrom;
      if (dateTo) filters.to_date = dateTo;
      if (teamFilter.trim()) filters.team_id = teamFilter.trim();
      const res = await pmApi.listExecutionTimeLogs(filters, 500, 0);
      setLogs(res?.logs || []);
      setTotal(res?.total ?? (res?.logs || []).length);
    } catch {
      setLogs([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadLogs();
  }, [dateFrom, dateTo, teamFilter]);

  const filtered = logs.filter((row) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (row.name || "").toLowerCase().includes(q) ||
      (row.user_full_name || "").toLowerCase().includes(q) ||
      (row.rollout_plan || "").toLowerCase().includes(q) ||
      (row.team_id || "").toLowerCase().includes(q) ||
      (row.project_code || "").toLowerCase().includes(q) ||
      (row.item_description || "").toLowerCase().includes(q)
    );
  });

  const totalHours = filtered.reduce((sum, row) => sum + (parseFloat(row.duration_hours) || 0), 0);
  const hasFilters = dateFrom || dateTo || teamFilter || search;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Execution time logs</h1>
          <div className="page-subtitle">
            Field time on rollouts · {filtered.length} rows · {fmt.format(totalHours)} h
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14, margin: "0 28px 20px" }}>
        <div className="summary-card accent-blue">
          <div className="card-label">Log lines</div>
          <div className="card-value">{filtered.length}</div>
        </div>
        <div className="summary-card accent-green">
          <div className="card-label">Total hours</div>
          <div className="card-value">{fmt.format(totalHours)}</div>
        </div>
      </div>

      <div className="toolbar">
        <input
          type="search"
          placeholder="Search user, plan, team, project…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: "7px 14px",
            borderRadius: 8,
            border: "1px solid #e2e8f0",
            fontSize: "0.84rem",
            minWidth: 200,
          }}
        />
        <input
          type="text"
          placeholder="Team ID filter"
          value={teamFilter}
          onChange={(e) => setTeamFilter(e.target.value)}
          style={{
            padding: "7px 12px",
            borderRadius: 8,
            border: "1px solid #e2e8f0",
            fontSize: "0.84rem",
            width: 140,
          }}
        />
        <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-muted)", whiteSpace: "nowrap" }}>From:</label>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem" }}
        />
        <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-muted)", whiteSpace: "nowrap" }}>To:</label>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem" }}
        />
        {hasFilters && (
          <button
            className="btn-secondary"
            style={{ fontSize: "0.78rem", padding: "5px 12px" }}
            onClick={() => {
              setDateFrom("");
              setDateTo("");
              setTeamFilter("");
              setSearch("");
            }}
          >
            Clear
          </button>
        )}
      </div>

      <div className="page-content">
        <div className="data-table-wrapper">
          {loading ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="empty-state" style={{ marginTop: 20 }}>
              <div className="empty-icon">&#x1F553;</div>
              <h3>{hasFilters ? "No results" : "No execution time logs"}</h3>
              <p>Logs appear when field users start/stop timers or add manual entries on rollouts.</p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>User</th>
                  <th>Team</th>
                  <th>Rollout</th>
                  <th>Work / project</th>
                  <th>Start</th>
                  <th>End</th>
                  <th style={{ textAlign: "right" }}>Hours</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.name}>
                    <td style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>{row.name}</td>
                    <td>{row.user_full_name || row.user}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 12 }}>{row.team_id || "—"}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 11 }}>{row.rollout_plan}</td>
                    <td style={{ fontSize: "0.78rem", maxWidth: 220 }}>
                      {row.item_description || row.project_code || "—"}
                    </td>
                    <td style={{ fontSize: "0.78rem" }}>{shortDt(row.start_time)}</td>
                    <td style={{ fontSize: "0.78rem" }}>{row.is_running ? "—" : shortDt(row.end_time)}</td>
                    <td style={{ textAlign: "right", fontFamily: "'JetBrains Mono', monospace" }}>
                      {row.is_running ? "—" : fmt.format(row.duration_hours || 0)}
                    </td>
                    <td>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "3px 10px",
                          borderRadius: 12,
                          fontSize: 11,
                          fontWeight: 700,
                          textTransform: "uppercase",
                          background: row.is_running ? "#fef3c7" : "#ecfdf5",
                          color: row.is_running ? "#92400e" : "#065f46",
                        }}
                      >
                        {row.is_running ? "Running" : "Done"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td
                    colSpan={7}
                    style={{
                      padding: "10px 16px",
                      background: "#f8fafc",
                      borderTop: "1px solid #e2e8f0",
                      fontWeight: 700,
                      fontSize: "0.78rem",
                    }}
                  >
                    TOTALS ({filtered.length}
                    {hasFilters && ` of ${logs.length}`} / {total} in range)
                  </td>
                  <td
                    style={{
                      textAlign: "right",
                      fontWeight: 700,
                      padding: "10px 16px",
                      background: "#f8fafc",
                      borderTop: "1px solid #e2e8f0",
                    }}
                  >
                    {fmt.format(totalHours)}
                  </td>
                  <td style={{ background: "#f8fafc", borderTop: "1px solid #e2e8f0" }} />
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
