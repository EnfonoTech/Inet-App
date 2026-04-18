import { useEffect, useState } from "react";
import DataTableWrapper from "../../components/DataTableWrapper";
import { useAuth } from "../../context/AuthContext";
import { useTableRowLimit, useResetOnRowLimitChange } from "../../context/TableRowLimitContext";
import TableRowsLimitFooter from "../../components/TableRowsLimitFooter";
import { useDebounced } from "../../hooks/useDebounced";
import { pmApi } from "../../services/api";

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

export default function IMIssuesRisks() {
  const { imName } = useAuth();
  const { rowLimit } = useTableRowLimit();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const searchDebounced = useDebounced(search, 300);
  const [selected, setSelected] = useState(new Set());
  const [showModal, setShowModal] = useState(false);
  const [planDate, setPlanDate] = useState(todayDate());
  const [planEndDate, setPlanEndDate] = useState(todayDate());
  const [planTeam, setPlanTeam] = useState("");
  const [accessTime, setAccessTime] = useState("");
  const [accessPeriod, setAccessPeriod] = useState("");
  const [visitType, setVisitType] = useState("Re-Visit");
  const [teamsList, setTeamsList] = useState([]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);

  useResetOnRowLimitChange(() => {
    setRows([]);
    setLoading(true);
  });

  async function loadData() {
    setLoading(true);
    try {
      const res = await pmApi.listIssueRiskRows(
        imName || "",
        rowLimit,
        searchDebounced.trim() || undefined,
      );
      setRows(Array.isArray(res) ? res : []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, [imName, rowLimit, searchDebounced]);

  useEffect(() => {
    if (!showModal || !imName) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await pmApi.listINETTeams({ status: "Active", im: imName });
        if (!cancelled) setTeamsList(Array.isArray(list) ? list : []);
      } catch {
        if (!cancelled) setTeamsList([]);
      }
    })();
    return () => { cancelled = true; };
  }, [showModal, imName]);

  function toggleRow(name) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function toggleAll() {
    if (rows.length > 0 && rows.every((r) => selected.has(r.rollout_plan))) {
      setSelected(new Set());
    } else {
      setSelected(new Set(rows.map((r) => r.rollout_plan)));
    }
  }

  async function createPlansFromIssues() {
    if (selected.size === 0 || !planTeam || !planDate || !planEndDate) return;
    setCreating(true);
    setCreateError(null);
    try {
      const selectedRows = rows.filter((r) => selected.has(r.rollout_plan));
      const dispatches = [...new Set(selectedRows.map((r) => r.po_dispatch).filter(Boolean))];
      if (dispatches.length === 0) throw new Error("No POIDs found in selected issue rows.");
      await pmApi.createRolloutPlans({
        dispatches,
        plan_date: planDate,
        plan_end_date: planEndDate,
        team: planTeam,
        access_time: accessTime,
        access_period: accessPeriod,
        visit_type: visitType || "Re-Visit",
      });
      setSelected(new Set());
      setShowModal(false);
      await loadData();
    } catch (e) {
      setCreateError(e.message || "Failed to create plans");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Issues & Risks</h1>
          <div className="page-subtitle">Your replanned rollout plans with issue categories.</div>
        </div>
        <div className="page-actions">
          <button className="btn-secondary" onClick={loadData} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
        </div>
      </div>
      <div className="toolbar">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input
            type="search"
            placeholder="Search POID, Plan, Issue, Project, DUID, Team…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem", minWidth: 300 }}
          />
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          {selected.size > 0 && <span style={{ fontSize: "0.78rem", color: "#64748b" }}>{selected.size} selected</span>}
          <button className="btn-primary" disabled={selected.size === 0} onClick={() => setShowModal(true)}>
            Create Plans ({selected.size})
          </button>
        </div>
      </div>
      <div className="page-content">
        <DataTableWrapper>
          {loading ? (
            <div style={{ padding: 32, textAlign: "center", color: "#94a3b8" }}>Loading issues…</div>
          ) : rows.length === 0 ? (
            <div className="empty-state"><h3>No issue/risk rows</h3></div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}>
                    <input
                      type="checkbox"
                      checked={rows.length > 0 && rows.every((r) => selected.has(r.rollout_plan))}
                      onChange={toggleAll}
                    />
                  </th>
                  <th>POID</th><th>Plan</th><th>Issue Category</th><th>Status</th><th>Team</th><th>Project</th><th>DUID</th><th>Execution</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.rollout_plan}-${r.execution_name || ""}`}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(r.rollout_plan)}
                        onChange={() => toggleRow(r.rollout_plan)}
                      />
                    </td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{r.po_dispatch || "—"}</td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{r.rollout_plan || "—"}</td>
                    <td>{r.issue_category || "Uncategorized"}</td>
                    <td>{r.plan_status || "—"}</td>
                    <td>{r.team || "—"}</td>
                    <td>{r.project_code || "—"}</td>
                    <td>{r.site_code || "—"}</td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{r.execution_name || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </DataTableWrapper>
        <TableRowsLimitFooter
          placement="tableCard"
          loadedCount={rows.length}
          filteredCount={rows.length}
          filterActive={!!search}
        />
      </div>
      {showModal && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setShowModal(false)}>
          <div style={{ width: "min(620px, 95vw)", background: "#fff", borderRadius: 12, padding: 20 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 12px" }}>Create Plans from Issues & Risks</h3>
            <div className="form-grid two-col">
              <div className="form-group"><label>Plan Date</label><input type="date" value={planDate} onChange={(e) => setPlanDate(e.target.value)} /></div>
              <div className="form-group"><label>Plan End Date</label><input type="date" value={planEndDate} onChange={(e) => setPlanEndDate(e.target.value)} /></div>
              <div className="form-group">
                <label>Team</label>
                <select value={planTeam} onChange={(e) => setPlanTeam(e.target.value)}>
                  <option value="">Select Team</option>
                  {teamsList.map((t) => <option key={t.team_id} value={t.team_id}>{t.team_id} — {t.team_name}</option>)}
                </select>
              </div>
              <div className="form-group"><label>Visit Type</label><input value={visitType} onChange={(e) => setVisitType(e.target.value)} /></div>
              <div className="form-group"><label>Access Time</label><input value={accessTime} onChange={(e) => setAccessTime(e.target.value)} placeholder="e.g. 08:00-12:00" /></div>
              <div className="form-group">
                <label>Access Period</label>
                <select value={accessPeriod} onChange={(e) => setAccessPeriod(e.target.value)}>
                  <option value="">--</option><option value="Day">Day</option><option value="Night">Night</option>
                </select>
              </div>
            </div>
            {createError && <div className="notice error" style={{ marginTop: 10 }}>{createError}</div>}
            <div style={{ marginTop: 14 }}>
              <button className="btn-primary" disabled={creating} onClick={createPlansFromIssues}>{creating ? "Creating..." : "Create"}</button>
              <button className="btn-secondary" style={{ marginLeft: 8 }} onClick={() => setShowModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
