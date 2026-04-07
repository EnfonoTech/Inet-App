import { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { pmApi } from "../../services/api";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

export default function IMExecution() {
  const { imName } = useAuth();
  const [executions, setExecutions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [reopenFor, setReopenFor] = useState(null);
  const [issueCategory, setIssueCategory] = useState("");
  const [planningRoute, setPlanningRoute] = useState("standard");
  const [reopenBusy, setReopenBusy] = useState(false);
  const [reopenErr, setReopenErr] = useState(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await pmApi.listIMDailyExecutions(imName, statusFilter || undefined);
        setExecutions(Array.isArray(res) ? res : []);
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
      (e.execution_date || "").toLowerCase().includes(q) ||
      (e.site_code || "").toLowerCase().includes(q) ||
      (e.po_no || "").toLowerCase().includes(q)
    );
  });

  const hasFilters = statusFilter || search;
  const totalAchieved = filtered.reduce((s, e) => s + (e.achieved_qty || 0), 0);

  async function submitReopen() {
    if (!reopenFor) return;
    setReopenBusy(true);
    setReopenErr(null);
    try {
      await pmApi.reopenRolloutForRevisit(reopenFor, issueCategory, planningRoute);
      setReopenFor(null);
      setIssueCategory("");
      const res = await pmApi.listIMDailyExecutions(imName, statusFilter || undefined);
      setExecutions(Array.isArray(res) ? res : []);
    } catch (err) {
      setReopenErr(err.message || "Failed");
    } finally {
      setReopenBusy(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Execution Monitor</h1>
          <div className="page-subtitle">Field execution progress with QC and CIAG status.</div>
        </div>
      </div>

      {reopenFor && (
        <div style={{ margin: "0 28px 16px", padding: 20, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12 }}>
          <h4 style={{ margin: "0 0 12px" }}>Return rollout to planning: {reopenFor}</h4>
          {reopenErr && <div className="notice error" style={{ marginBottom: 10 }}>{reopenErr}</div>}
          <div className="form-group" style={{ marginBottom: 10 }}>
            <label>Issue category</label>
            <input value={issueCategory} onChange={(e) => setIssueCategory(e.target.value)} placeholder="e.g. PAT Rejection, QC Rejection" style={{ width: "100%", maxWidth: 400, padding: 8 }} />
          </div>
          <div className="form-group" style={{ marginBottom: 12 }}>
            <label>Route</label>
            <select value={planningRoute} onChange={(e) => setPlanningRoute(e.target.value)} style={{ padding: 8 }}>
              <option value="standard">Planning (standard)</option>
              <option value="with_issue">Planning with Issue</option>
            </select>
          </div>
          <button className="btn-primary" disabled={reopenBusy} onClick={submitReopen}>{reopenBusy ? "…" : "Confirm"}</button>
          <button type="button" className="btn-secondary" style={{ marginLeft: 8 }} onClick={() => setReopenFor(null)}>Cancel</button>
        </div>
      )}

      <div className="toolbar">
        <input
          type="search"
          placeholder="Search Execution ID, Plan, DUID, PO, Team…"
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
          <option value="Cancelled">Cancelled</option>
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
                  : "Executions appear after teams log work against planned rollouts."}
              </p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Execution</th>
                  <th>Rollout Plan</th>
                  <th>DUID</th>
                  <th>PO</th>
                  <th>Team</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th>QC</th>
                  <th>CIAG</th>
                  <th style={{ textAlign: "right" }}>Qty</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <tr key={e.name}>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{e.name}</td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{e.rollout_plan}</td>
                    <td>{e.site_code || "—"}</td>
                    <td>{e.po_no || "—"}</td>
                    <td>{e.team}</td>
                    <td>{e.execution_date}</td>
                    <td>
                      <span className={`status-badge ${(e.execution_status || "").toLowerCase().replace(/\s/g, "-")}`}>
                        <span className="status-dot" />
                        {e.execution_status}
                      </span>
                    </td>
                    <td>{e.qc_status || "—"}</td>
                    <td>{e.ciag_status || "—"}</td>
                    <td style={{ textAlign: "right" }}>{e.achieved_qty || 0}</td>
                    <td>
                      <button
                        type="button"
                        className="btn-secondary"
                        style={{ fontSize: "0.72rem", padding: "4px 8px" }}
                        onClick={() => setReopenFor(e.rollout_plan)}
                      >
                        Re-plan
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={9} style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", fontWeight: 700, fontSize: "0.78rem" }}>
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
