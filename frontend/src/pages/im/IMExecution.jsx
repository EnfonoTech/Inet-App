import { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

export default function IMExecution() {
  const { imName } = useAuth();
  const [executions, setExecutions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const filters = [["im", "=", imName || ""]];
        if (statusFilter) filters.push(["execution_status", "=", statusFilter]);
        const res = await fetch(
          `/api/resource/Daily Execution?filters=${encodeURIComponent(JSON.stringify(filters))}` +
          `&fields=${encodeURIComponent(JSON.stringify(["name", "rollout_plan", "team", "execution_date", "execution_status", "achieved_qty", "gps_location"]))}` +
          `&limit_page_length=200&order_by=execution_date+desc`,
          { credentials: "include" }
        );
        const json = await res.json();
        setExecutions(json?.data || []);
      } catch {
        setExecutions([]);
      }
      setLoading(false);
    }
    load();
  }, [imName, statusFilter]);

  const filtered = executions.filter((e) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (e.name || "").toLowerCase().includes(q) ||
      (e.rollout_plan || "").toLowerCase().includes(q) ||
      (e.team || "").toLowerCase().includes(q) ||
      (e.execution_date || "").toLowerCase().includes(q)
    );
  });

  const hasFilters = statusFilter || search;
  const totalAchieved = filtered.reduce((s, e) => s + (e.achieved_qty || 0), 0);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Execution Monitor</h1>
          <div className="page-subtitle">Track your teams' daily execution progress</div>
        </div>
      </div>

      {/* ── Toolbar ─────────────────────────────────────────── */}
      <div className="toolbar">
        <input
          type="search"
          placeholder="Search Execution ID, Plan, Team, Date…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: "7px 14px", borderRadius: 8,
            border: "1px solid #e2e8f0", fontSize: "0.84rem", minWidth: 260,
          }}
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem" }}
        >
          <option value="">All Statuses</option>
          <option value="In Progress">In Progress</option>
          <option value="Completed">Completed</option>
          <option value="Hold">Hold</option>
          <option value="Postponed">Postponed</option>
        </select>
        {hasFilters && (
          <button
            className="btn-secondary"
            style={{ fontSize: "0.78rem", padding: "5px 12px" }}
            onClick={() => { setSearch(""); setStatusFilter(""); }}
          >
            Clear
          </button>
        )}
      </div>

      <div className="page-content">
        <div className="data-table-wrapper">
          {loading ? (
            <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📊</div>
              <h3>{hasFilters ? "No results match your filters" : "No execution records"}</h3>
              <p>
                {hasFilters
                  ? "Try adjusting your search or filter criteria."
                  : "No field execution data available."}
              </p>
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
                {filtered.map((e) => (
                  <tr key={e.name}>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{e.name}</td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{e.rollout_plan}</td>
                    <td>{e.team}</td>
                    <td>{e.execution_date}</td>
                    <td>
                      <span className={`status-badge ${(e.execution_status || "").toLowerCase().replace(/\s/g, "-")}`}>
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
              <tfoot>
                <tr>
                  <td colSpan={5} style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", fontWeight: 700, fontSize: "0.78rem" }}>
                    {filtered.length}{hasFilters && ` of ${executions.length}`} rows
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 700, padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0" }}>
                    {fmt.format(totalAchieved)}
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
