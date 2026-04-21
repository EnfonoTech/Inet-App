import { useEffect, useMemo, useState } from "react";
import DataTableWrapper from "../../components/DataTableWrapper";
import { useAuth } from "../../context/AuthContext";
import { useTableRowLimit, useResetOnRowLimitChange } from "../../context/TableRowLimitContext";
import TableRowsLimitFooter from "../../components/TableRowsLimitFooter";
import { useDebounced } from "../../hooks/useDebounced";
import { pmApi } from "../../services/api";
import { EXECUTION_STATUS_OPTIONS, ISSUE_CATEGORY_OPTIONS } from "../../constants/executionStatuses";
import SearchableSelect from "../../components/SearchableSelect";
import DateRangePicker from "../../components/DateRangePicker";
import useFilterOptions from "../../hooks/useFilterOptions";

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function badgeTone(value) {
  const s = String(value || "").toLowerCase();
  if (!s) return { bg: "#f1f5f9", fg: "#334155", dot: "#64748b" };
  const tones = {
    "in progress": { bg: "#eff6ff", fg: "#1d4ed8", dot: "#3b82f6" },
    completed: { bg: "#ecfdf5", fg: "#047857", dot: "#10b981" },
    hold: { bg: "#fffbeb", fg: "#b45309", dot: "#f59e0b" },
    cancelled: { bg: "#fef2f2", fg: "#b91c1c", dot: "#ef4444" },
    postponed: { bg: "#fefce8", fg: "#a16207", dot: "#eab308" },
    "pod pending": { bg: "#fff7ed", fg: "#c2410c", dot: "#f97316" },
    "po required": { bg: "#fff7ed", fg: "#9a3412", dot: "#ea580c" },
    "span loss": { bg: "#fef2f2", fg: "#991b1b", dot: "#dc2626" },
    "spare parts": { bg: "#ecfeff", fg: "#0e7490", dot: "#06b6d4" },
    "extra visit": { bg: "#f5f3ff", fg: "#6d28d9", dot: "#8b5cf6" },
    "late arrival": { bg: "#fff7ed", fg: "#9a3412", dot: "#f97316" },
    "quality issue": { bg: "#fef2f2", fg: "#991b1b", dot: "#ef4444" },
    travel: { bg: "#eef2ff", fg: "#3730a3", dot: "#6366f1" },
  };
  if (tones[s]) return tones[s];
  if (s.includes("complete") || s.includes("approved") || s.includes("done") || s.includes("pass")) return { bg: "#ecfdf5", fg: "#047857", dot: "#10b981" };
  if (s.includes("cancel") || s.includes("reject") || s.includes("fail")) return { bg: "#fef2f2", fg: "#b91c1c", dot: "#ef4444" };
  if (s.includes("progress") || s.includes("review") || s.includes("open")) return { bg: "#eff6ff", fg: "#1d4ed8", dot: "#3b82f6" };
  if (s.includes("hold") || s.includes("pending") || s.includes("wait") || s.includes("postponed")) return { bg: "#fffbeb", fg: "#b45309", dot: "#f59e0b" };
  return { bg: "#f8fafc", fg: "#334155", dot: "#64748b" };
}

function StatusPill({ value }) {
  if (!value) return <span style={{ color: "#94a3b8" }}>—</span>;
  const tone = badgeTone(value);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 10px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.03em",
        background: tone.bg,
        color: tone.fg,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 999, background: tone.dot }} />
      {value}
    </span>
  );
}

export default function IMIssuesRisks() {
  const { imName } = useAuth();
  const { rowLimit } = useTableRowLimit();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const searchDebounced = useDebounced(search, 300);
  const [issueCatFilter, setIssueCatFilter] = useState("");
  const [execStatusFilter, setExecStatusFilter] = useState("");
  const [tlStatusFilter, setTlStatusFilter] = useState("");
  const [qcFilter, setQcFilter] = useState("");
  const [ciagFilter, setCiagFilter] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [teamFilter, setTeamFilter] = useState("");
  const [duidFilter, setDuidFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [selected, setSelected] = useState(new Set());
  const [showModal, setShowModal] = useState(false);
  const [planDate, setPlanDate] = useState(todayDate());
  const [planEndDate, setPlanEndDate] = useState(todayDate());
  const [planTeam, setPlanTeam] = useState("");
  const [accessTime, setAccessTime] = useState("");
  const [accessPeriod, setAccessPeriod] = useState("");
  const [visitType, setVisitType] = useState("Re-Visit");
  const [issueRemarks, setIssueRemarks] = useState("");
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
      const portal = {};
      if (projectFilter) portal.project_code = projectFilter;
      if (teamFilter) portal.team = teamFilter;
      if (duidFilter) portal.site_code = duidFilter;
      const portalArg = Object.keys(portal).length ? portal : undefined;
      const res = await pmApi.listIssueRiskRows(
        imName || "",
        rowLimit,
        searchDebounced.trim() || undefined,
        portalArg,
      );
      setRows(Array.isArray(res) ? res : []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, [imName, rowLimit, searchDebounced, projectFilter, teamFilter, duidFilter]);

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (issueCatFilter && (r.issue_category || "") !== issueCatFilter) return false;
      if (execStatusFilter && (r.execution_status || "") !== execStatusFilter) return false;
      if (tlStatusFilter && (r.tl_status || "") !== tlStatusFilter) return false;
      if (qcFilter && (r.qc_status || "") !== qcFilter) return false;
      if (ciagFilter && (r.ciag_status || "") !== ciagFilter) return false;
      if (fromDate && (!r.plan_date || r.plan_date < fromDate)) return false;
      if (toDate && (!r.plan_date || r.plan_date > toDate)) return false;
      return true;
    });
  }, [rows, issueCatFilter, execStatusFilter, tlStatusFilter, qcFilter, ciagFilter, fromDate, toDate]);

  const qcOptions = useMemo(() => [...new Set(rows.map((r) => r.qc_status).filter(Boolean))].sort(), [rows]);
  const ciagOptions = useMemo(() => [...new Set(rows.map((r) => r.ciag_status).filter(Boolean))].sort(), [rows]);
  const { options: dispOpts } = useFilterOptions("PO Dispatch", ["project_code", "site_code"]);
  const projectOptions = dispOpts.project_code || [];
  const duidOptions = dispOpts.site_code || [];
  const teamEntries = useMemo(() => {
    const m = new Map();
    rows.forEach((r) => { if (r.team) m.set(r.team, r.team_name || r.team); });
    return [...m.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1]), undefined, { sensitivity: "base" }));
  }, [rows]);
  const hasFilters = search || issueCatFilter || execStatusFilter || tlStatusFilter || qcFilter || ciagFilter || projectFilter || teamFilter || duidFilter || fromDate || toDate;

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
    if (filteredRows.length > 0 && filteredRows.every((r) => selected.has(r.rollout_plan))) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filteredRows.map((r) => r.rollout_plan)));
    }
  }

  async function createPlansFromIssues() {
    if (selected.size === 0 || !planTeam || !planDate || !planEndDate) return;
    setCreating(true);
    setCreateError(null);
    try {
      const selectedRows = filteredRows.filter((r) => selected.has(r.rollout_plan));
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
        issue_remarks: issueRemarks || undefined,
      });
      setSelected(new Set());
      setShowModal(false);
      setIssueRemarks("");
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
        <input
          type="search"
          placeholder="Search POID, Plan, Project, DUID, Team…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem", minWidth: 240 }}
        />
        <select value={issueCatFilter} onChange={(e) => setIssueCatFilter(e.target.value)} style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem" }}>
          <option value="">All Categories</option>
          {ISSUE_CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={execStatusFilter} onChange={(e) => setExecStatusFilter(e.target.value)} style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem" }}>
          <option value="">All Exec Status</option>
          {EXECUTION_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <SearchableSelect value={projectFilter} onChange={setProjectFilter} options={projectOptions} placeholder="All Projects" minWidth={170} />
        <SearchableSelect value={teamFilter} onChange={setTeamFilter} options={teamEntries.map(([id, label]) => ({ id, label }))} placeholder="All Teams" minWidth={150} />
        <SearchableSelect value={duidFilter} onChange={setDuidFilter} options={duidOptions} placeholder="All DUIDs" minWidth={150} />
        <DateRangePicker value={{ from: fromDate, to: toDate }} onChange={({ from, to }) => { setFromDate(from); setToDate(to); }} />
        {hasFilters && (
          <button
            className="btn-secondary"
            style={{ fontSize: "0.78rem", padding: "5px 12px" }}
            onClick={() => { setSearch(""); setIssueCatFilter(""); setExecStatusFilter(""); setTlStatusFilter(""); setQcFilter(""); setCiagFilter(""); setProjectFilter(""); setTeamFilter(""); setDuidFilter(""); setFromDate(""); setToDate(""); }}
          >
            Clear
          </button>
        )}
        <div className="toolbar-actions">
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
          ) : filteredRows.length === 0 ? (
            <div className="empty-state"><h3>{hasFilters ? "No results match your filters" : "No issue/risk rows"}</h3></div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}>
                    <input
                      type="checkbox"
                      checked={filteredRows.length > 0 && filteredRows.every((r) => selected.has(r.rollout_plan))}
                      onChange={toggleAll}
                    />
                  </th>
                  <th>POID</th>
                  <th>Plan</th>
                  <th>Item Code</th>
                  <th>Description</th>
                  <th>Project</th>
                  <th>DUID</th>
                  <th>Team</th>
                  <th>Plan Date</th>
                  <th>Exec Date</th>
                  <th style={{ textAlign: "right" }} title="Attempt / visit number for this POID">Attempt #</th>
                  <th style={{ textAlign: "right" }}>Line Amount</th>
                  <th>Region</th>
                  <th>Exec Status</th>
                  <th>TL Status</th>
                  <th>QC</th>
                  <th>CIAG</th>
                  <th>Issue Category</th>
                  <th>Issue Remarks</th>
                  <th>Execution Remarks</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r) => (
                  <tr key={`${r.rollout_plan}-${r.execution_name || ""}`}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(r.rollout_plan)}
                        onChange={() => toggleRow(r.rollout_plan)}
                      />
                    </td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{r.poid || r.po_dispatch || "—"}</td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{r.rollout_plan || "—"}</td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{r.item_code || "—"}</td>
                    <td style={{ fontSize: "0.82rem", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.item_description || ""}>{r.item_description || "—"}</td>
                    <td>{r.project_code || "—"}</td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{r.site_code || "—"}</td>
                    <td>{r.team_name || r.team || "—"}</td>
                    <td>{r.plan_date || "—"}</td>
                    <td>{r.execution_date || "—"}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{r.visit_number != null ? r.visit_number : "—"}</td>
                    <td style={{ textAlign: "right" }}>{r.line_amount != null ? Number(r.line_amount).toLocaleString() : "—"}</td>
                    <td><StatusPill value={r.region_type} /></td>
                    <td><StatusPill value={r.execution_status} /></td>
                    <td><StatusPill value={r.tl_status} /></td>
                    <td><StatusPill value={r.qc_status} /></td>
                    <td><StatusPill value={r.ciag_status} /></td>
                    <td><StatusPill value={r.issue_category} /></td>
                    <td style={{ fontSize: "0.82rem", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.issue_remarks || ""}>{r.issue_remarks || "—"}</td>
                    <td style={{ fontSize: "0.82rem", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.execution_remarks || ""}>{r.execution_remarks || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </DataTableWrapper>
        <TableRowsLimitFooter
          placement="tableCard"
          loadedCount={rows.length}
          filteredCount={filteredRows.length}
          filterActive={!!hasFilters}
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
            <div className="form-group" style={{ marginTop: 10 }}>
              <label>Issue Remarks (optional — shared across all created plans)</label>
              <textarea
                value={issueRemarks}
                onChange={(e) => setIssueRemarks(e.target.value)}
                rows={3}
                placeholder="Why is this re-plan needed? Will show up on every created plan and in Issues & Risks."
                style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid #e2e8f0", fontSize: "0.84rem", resize: "vertical" }}
              />
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
