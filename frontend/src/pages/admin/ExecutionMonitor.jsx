import { useCallback, useEffect, useRef, useState } from "react";
import DataTableWrapper from "../../components/DataTableWrapper";
import { pmApi } from "../../services/api";
import { useTableRowLimit, useResetOnRowLimitChange } from "../../context/TableRowLimitContext";
import TableRowsLimitFooter from "../../components/TableRowsLimitFooter";
import { EXECUTION_STATUS_OPTIONS, ISSUE_CATEGORY_OPTIONS } from "../../constants/executionStatuses";
import useFilterOptions from "../../hooks/useFilterOptions";
import SearchableSelect from "../../components/SearchableSelect";
import RecordDetailView, { DetailHero, DetailStatTile } from "../../components/RecordDetailView";
import DateRangePicker from "../../components/DateRangePicker";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

const PLAN_STATUS_OPTIONS = ["", "Planned", "In Execution", "Completed", "Cancelled", "Planning with Issue"];

function badgeTone(value) {
  const s = String(value || "").toLowerCase();
  if (!s) return { bg: "#f1f5f9", fg: "#334155", dot: "#64748b" };
  const tones = {
    "in progress": { bg: "#eff6ff", fg: "#1d4ed8", dot: "#3b82f6" },
    completed: { bg: "#ecfdf5", fg: "#047857", dot: "#10b981" },
    hold: { bg: "#fffbeb", fg: "#b45309", dot: "#f59e0b" },
    cancelled: { bg: "#fef2f2", fg: "#b91c1c", dot: "#ef4444" },
    postponed: { bg: "#fefce8", fg: "#a16207", dot: "#eab308" },
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

function statusBadgeClass(status) {
  if (!status) return "";
  const s = status.toLowerCase().replace(/\s+/g, "-");
  if (s === "planned") return "planned";
  if (s === "in-execution" || s === "in-progress") return "in-progress";
  if (s === "completed") return "completed";
  if (s === "cancelled") return "cancelled";
  if (s === "hold" || s === "postponed") return "new";
  if (s === "pod-pending" || s === "po-required" || s === "span-loss" || s === "spare-parts") return "in-progress";
  if (s === "extra-visit" || s === "late-arrival" || s === "quality-issue" || s === "travel") return "in-progress";
  return "new";
}

function DetailItem({ label, value }) {
  const txt = String(value || "");
  const isStatus = /status/i.test(label);
  const tone = txt.toLowerCase().includes("complete") || txt.toLowerCase().includes("pass")
    ? { bg: "#ecfdf5", fg: "#047857" }
    : txt.toLowerCase().includes("cancel") || txt.toLowerCase().includes("fail")
      ? { bg: "#fef2f2", fg: "#b91c1c" }
      : txt.toLowerCase().includes("progress") || txt.toLowerCase().includes("execution")
        ? { bg: "#eff6ff", fg: "#1d4ed8" }
        : { bg: "#fffbeb", fg: "#b45309" };
  return (
    <div style={{ padding: "8px 10px" }}>
      <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>{label}</div>
      {isStatus ? (
        <span style={{ display: "inline-block", borderRadius: 999, padding: "3px 10px", fontSize: 12, fontWeight: 700, background: tone.bg, color: tone.fg }}>
          {value || "—"}
        </span>
      ) : (
        <div style={{ fontSize: 13, color: "#0f172a", fontWeight: 500 }}>{value || "—"}</div>
      )}
    </div>
  );
}

function Pill({ label, value, tone = "blue" }) {
  const palette = {
    blue: { bg: "#eff6ff", fg: "#1d4ed8", bd: "#bfdbfe" },
    green: { bg: "#ecfdf5", fg: "#047857", bd: "#a7f3d0" },
    amber: { bg: "#fffbeb", fg: "#b45309", bd: "#fde68a" },
  }[tone];
  return (
    <div style={{ border: `1px solid ${palette.bd}`, background: palette.bg, color: palette.fg, borderRadius: 999, padding: "4px 10px", fontSize: 12, fontWeight: 700 }}>
      {label}: {value || "—"}
    </div>
  );
}

function parseAttachments(raw) {
  if (!raw) return [];
  const text = String(raw).trim();
  if (!text) return [];
  if (text.startsWith("[")) {
    try {
      const arr = JSON.parse(text);
      if (Array.isArray(arr)) return arr.map((v) => String(v || "").trim()).filter(Boolean);
    } catch {
      // ignore and fallback
    }
  }
  return text.split(/\r?\n|,/).map((v) => v.trim()).filter(Boolean);
}

export default function ExecutionMonitor() {
  const { rowLimit } = useTableRowLimit();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const intervalRef = useRef(null);

  const [search, setSearch] = useState("");
  const [planStatusFilter, setPlanStatusFilter] = useState([]);
  const [executionStatusFilter, setExecutionStatusFilter] = useState([]);
  const [visitFilter, setVisitFilter] = useState([]);
  const [projectFilter, setProjectFilter] = useState([]);
  const [teamFilter, setTeamFilter] = useState([]);
  const [duidFilter, setDuidFilter] = useState([]);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [detailRow, setDetailRow] = useState(null);
  const [tlStatusFor, setTlStatusFor] = useState(null);
  const [tlStatusPick, setTlStatusPick] = useState("In Progress");
  const [tlStatusBusy, setTlStatusBusy] = useState(false);
  const [tlStatusErr, setTlStatusErr] = useState(null);
  const [issueCatFor, setIssueCatFor] = useState(null);
  const [issueCatPick, setIssueCatPick] = useState("");
  const [issueCatBusy, setIssueCatBusy] = useState(false);
  const [issueCatErr, setIssueCatErr] = useState(null);

  async function submitTlStatus() {
    if (!tlStatusFor?.execution_name) return;
    setTlStatusBusy(true);
    setTlStatusErr(null);
    try {
      await pmApi.updateExecution({ name: tlStatusFor.execution_name, tl_status: tlStatusPick });
      setTlStatusFor(null);
      loadData();
    } catch (err) {
      setTlStatusErr(err.message || "Failed to update TL status");
    } finally {
      setTlStatusBusy(false);
    }
  }

  async function submitIssueCat() {
    if (!issueCatFor?.execution_name) return;
    setIssueCatBusy(true);
    setIssueCatErr(null);
    try {
      await pmApi.updateExecution({ name: issueCatFor.execution_name, issue_category: issueCatPick || "" });
      setIssueCatFor(null);
      loadData();
    } catch (err) {
      setIssueCatErr(err.message || "Failed to update issue category");
    } finally {
      setIssueCatBusy(false);
    }
  }

  useResetOnRowLimitChange(() => {
    setRows([]);
    setLoading(true);
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const filters = {};
      if (planStatusFilter.length) filters.status = planStatusFilter;
      if (executionStatusFilter.length) filters.execution_status = executionStatusFilter;
      if (visitFilter.length) filters.visit_type = visitFilter;
      if (teamFilter.length) filters.team = teamFilter;
      if (projectFilter.length) filters.project_code = projectFilter;
      if (duidFilter.length) filters.site_code = duidFilter;
      if (fromDate) filters.from_date = fromDate;
      if (toDate) filters.to_date = toDate;
      if (search.trim()) filters.search = search.trim();
      const list = await pmApi.listExecutionMonitorRows(filters, rowLimit);
      setRows(Array.isArray(list) ? list : []);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err.message || "Failed to load execution data");
    } finally {
      setLoading(false);
    }
  }, [rowLimit, search, planStatusFilter, executionStatusFilter, visitFilter, projectFilter, teamFilter, duidFilter, fromDate, toDate]);

  useEffect(() => {
    loadData();
    intervalRef.current = setInterval(loadData, 30_000);
    return () => clearInterval(intervalRef.current);
  }, [loadData]);

  function formatTime(d) {
    if (!d) return "";
    return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  }

  // Distinct values across ALL Rollout Plans / PO Dispatches — not row-limited.
  const { options: planOpts } = useFilterOptions("Rollout Plan", ["visit_type"]);
  const { options: dispOpts } = useFilterOptions("PO Dispatch", ["project_code", "site_code"]);
  const { options: teamOpts } = useFilterOptions("INET Team", ["team_id", "team_name"]);
  const visitTypes = planOpts.visit_type || [];
  const projectOptions = dispOpts.project_code || [];
  const duidOptions = dispOpts.site_code || [];
  // Preserve { id, label } shape so existing JSX doesn't need to change
  const teamOptions = (teamOpts.team_id || []).map((tid) => {
    const hit = rows.find((r) => r.team === tid);
    return { id: tid, label: hit?.team_name || tid };
  });

  const hasFilters = !!(search || planStatusFilter.length || executionStatusFilter.length || visitFilter.length || projectFilter.length || teamFilter.length || duidFilter.length || fromDate || toDate);

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

      {/* ── Toolbar ─────────────────────────────────────────── */}
      <div className="toolbar">
        <input
          type="search"
          placeholder="Search POID, dummy POID, Plan, Team, IM, Date, Center area, Region…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: "7px 14px", borderRadius: 8,
            border: "1px solid #e2e8f0", fontSize: "0.84rem", minWidth: 240,
          }}
        />
        <SearchableSelect multi value={planStatusFilter} onChange={setPlanStatusFilter} options={PLAN_STATUS_OPTIONS.filter(Boolean)} placeholder="All Plan Status" minWidth={150} />
        <SearchableSelect multi value={executionStatusFilter} onChange={setExecutionStatusFilter} options={EXECUTION_STATUS_OPTIONS} placeholder="All Exec Status" minWidth={150} />
        <SearchableSelect multi value={visitFilter} onChange={setVisitFilter} options={visitTypes} placeholder="All Visit Types" minWidth={160} />
        <SearchableSelect multi value={projectFilter} onChange={setProjectFilter} options={projectOptions} placeholder="All Projects" minWidth={170} />
        <SearchableSelect multi value={teamFilter} onChange={setTeamFilter} options={teamOptions} placeholder="All Teams" minWidth={150} />
        <SearchableSelect multi value={duidFilter} onChange={setDuidFilter} options={duidOptions} placeholder="All DUIDs" minWidth={150} />
        <DateRangePicker value={{ from: fromDate, to: toDate }} onChange={({ from, to }) => { setFromDate(from); setToDate(to); }} />
        {hasFilters && (
          <button
            className="btn-secondary"
            style={{ fontSize: "0.78rem", padding: "5px 12px" }}
            onClick={() => {
              setSearch("");
              setPlanStatusFilter([]);
              setExecutionStatusFilter([]);
              setVisitFilter([]);
              setProjectFilter([]);
              setTeamFilter([]);
              setDuidFilter([]);
              setFromDate("");
              setToDate("");
            }}
          >
            Clear
          </button>
        )}
      </div>

      <div className="page-content">
        {error && (
          <div className="notice error" style={{ marginBottom: 16 }}>
            <span>⚠</span> {error}
          </div>
        )}

        <DataTableWrapper>
          {loading ? (
            <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)" }}>
              Loading execution data…
            </div>
          ) : rows.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📊</div>
              <h3>{hasFilters ? "No results match your filters" : "No active executions"}</h3>
              <p>
                {hasFilters
                  ? "Try adjusting your search or filter criteria."
                  : "No plans are currently Planned or In Execution."}
              </p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Plan</th>
                  <th>POID</th>
                  <th>Dummy POID</th>
                  <th>Item code</th>
                  <th>Description</th>
                  <th>Activity Type</th>
                  <th>Project</th>
                  <th>DUID</th>
                  <th>Center area</th>
                  <th>Region</th>
                  <th>Team</th>
                  <th>IM</th>
                  <th>Plan Date</th>
                  <th>Visit Type</th>
                  <th style={{ textAlign: "right" }} title="Which visit this plan is (1, 2, 3…)">Visit #</th>
                  <th style={{ textAlign: "right" }}>Target</th>
                  <th style={{ textAlign: "right" }}>Achieved</th>
                  <th>Plan Status</th>
                  <th>TL Status</th>
                  <th>Exec Status</th>
                  <th>QC</th>
                  <th>CIAG</th>
                  <th>Issue Category</th>
                  <th>Open</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const target = row.target_amount || 0;
                  const achieved = row.execution_achieved_amount || row.achieved_amount || 0;
                  const pct = target > 0
                    ? Math.round((achieved / target) * 100)
                    : 0;
                  return (
                    <tr key={row.name}>
                      <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{row.name}</td>
                      <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{row.poid || row.po_dispatch || "—"}</td>
                      <td style={{ fontFamily: "monospace", fontSize: "0.72rem", maxWidth: 140 }} title={(row.original_dummy_poid || "").trim() ? `Dummy POID: ${row.original_dummy_poid}` : ""}>
                        {(row.original_dummy_poid || "").trim() || "—"}
                      </td>
                      <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{row.item_code || "—"}</td>
                      <td style={{ fontSize: "0.82rem", maxWidth: 220 }}>{row.item_description || "—"}</td>
                      <td style={{ fontSize: "0.82rem" }}>{row.customer_activity_type || "—"}</td>
                      <td>{row.project_code || "—"}</td>
                      <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }} title={row.site_name || ""}>{row.site_code || "—"}</td>
                      <td style={{ fontSize: "0.78rem", maxWidth: 120 }} title={row.center_area || ""}>
                        {row.center_area || "—"}
                      </td>
                      <td style={{ fontSize: "0.78rem" }}>{row.region_type || "—"}</td>
                      <td>{row.team_name || row.team || "—"}</td>
                      <td>{row.im_full_name || row.im || "—"}</td>
                      <td>{row.plan_date}</td>
                      <td>{row.visit_type}</td>
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{row.visit_number != null ? row.visit_number : "—"}</td>
                      <td style={{ textAlign: "right" }}>{fmt.format(target)}</td>
                      <td style={{ textAlign: "right" }}>
                        <span style={{ color: pct >= 80 ? "var(--green)" : pct >= 40 ? "var(--amber)" : "var(--red)" }}>
                          {fmt.format(achieved)}
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
                      <td>
                        {row.execution_name ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setTlStatusErr(null);
                              setTlStatusPick(row.tl_status || "In Progress");
                              setTlStatusFor(row);
                            }}
                            style={{ border: "none", background: "none", padding: 0, cursor: "pointer" }}
                            title="Click to change TL status"
                          >
                            <StatusPill value={row.tl_status} />
                          </button>
                        ) : <span style={{ color: "#94a3b8", fontSize: "0.78rem" }}>—</span>}
                      </td>
                      <td><StatusPill value={row.execution_status} /></td>
                      <td>{row.execution_name ? <StatusPill value={row.qc_status} /> : <span style={{ color: "#94a3b8", fontSize: "0.78rem" }}>—</span>}</td>
                      <td>{row.execution_name ? <StatusPill value={row.ciag_status} /> : <span style={{ color: "#94a3b8", fontSize: "0.78rem" }}>—</span>}</td>
                      <td>
                        {row.execution_name ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setIssueCatErr(null);
                              setIssueCatPick(row.issue_category || "");
                              setIssueCatFor(row);
                            }}
                            style={{ border: "none", background: "none", padding: 0, cursor: "pointer", fontSize: "0.78rem", color: row.issue_category ? "#b45309" : "#94a3b8", fontWeight: row.issue_category ? 600 : 500 }}
                            title="Click to set issue category"
                          >
                            {row.issue_category || "— Set —"}
                          </button>
                        ) : <span style={{ color: "#94a3b8", fontSize: "0.78rem" }}>—</span>}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn-secondary"
                          style={{ fontSize: "0.72rem", padding: "4px 10px" }}
                          onClick={() => setDetailRow(row)}
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={24} style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0" }}>
                    <strong>{rows.length}</strong>
                    {" "}record{rows.length !== 1 ? "s" : ""}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </DataTableWrapper>
        <TableRowsLimitFooter
          placement="tableCard"
          loadedCount={rows.length}
          filteredCount={rows.length}
          filterActive={hasFilters}
        />
      </div>

      {tlStatusFor && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setTlStatusFor(null)}>
          <div style={{ width: "min(520px, 94vw)", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 20 }} onClick={(e) => e.stopPropagation()}>
            <h4 style={{ margin: "0 0 12px" }}>TL status: {tlStatusFor.execution_name}</h4>
            {tlStatusErr && <div className="notice error" style={{ marginBottom: 10 }}>{tlStatusErr}</div>}
            <div className="form-group" style={{ marginBottom: 12 }}>
              <label>Status (set by Team Lead — editable here)</label>
              <select value={tlStatusPick} onChange={(e) => setTlStatusPick(e.target.value)} style={{ padding: 8, minWidth: 280, width: "100%" }}>
                {EXECUTION_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <button className="btn-primary" disabled={tlStatusBusy} onClick={submitTlStatus}>{tlStatusBusy ? "…" : "Save"}</button>
            <button type="button" className="btn-secondary" style={{ marginLeft: 8 }} onClick={() => setTlStatusFor(null)}>Cancel</button>
          </div>
        </div>
      )}

      {issueCatFor && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setIssueCatFor(null)}>
          <div style={{ width: "min(520px, 94vw)", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 20 }} onClick={(e) => e.stopPropagation()}>
            <h4 style={{ margin: "0 0 12px" }}>Issue category: {issueCatFor.execution_name}</h4>
            {issueCatErr && <div className="notice error" style={{ marginBottom: 10 }}>{issueCatErr}</div>}
            <div className="form-group" style={{ marginBottom: 12 }}>
              <label>Category</label>
              <select value={issueCatPick} onChange={(e) => setIssueCatPick(e.target.value)} style={{ padding: 8, minWidth: 280, width: "100%" }}>
                <option value="">— None —</option>
                {ISSUE_CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <button className="btn-primary" disabled={issueCatBusy} onClick={submitIssueCat}>{issueCatBusy ? "…" : "Save"}</button>
            <button type="button" className="btn-secondary" style={{ marginLeft: 8 }} onClick={() => setIssueCatFor(null)}>Cancel</button>
          </div>
        </div>
      )}

      {detailRow && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setDetailRow(null)}
        >
          <div
            style={{ background: "#fff", borderRadius: 12, padding: 20, width: "min(860px, 94vw)", maxHeight: "78vh", overflow: "auto" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ margin: 0, fontSize: "1rem" }}>Execution Details</h3>
              <button type="button" onClick={() => setDetailRow(null)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8" }}>&times;</button>
            </div>
            <RecordDetailView
              row={{
                ...detailRow,
                target_sar: detailRow.target_amount,
                achieved_sar: detailRow.execution_achieved_amount || detailRow.achieved_amount,
                // Hide duplicate dummy POID when it matches the current POID
                original_dummy_poid: (detailRow.original_dummy_poid || "").trim() && String(detailRow.original_dummy_poid).trim() !== String(detailRow.po_dispatch || "").trim()
                  ? detailRow.original_dummy_poid
                  : null,
              }}
              pills={[
                { label: "POID", value: detailRow.poid || detailRow.po_dispatch || "—", tone: "blue" },
                { label: "Plan", value: detailRow.name || "—", tone: "amber" },
                detailRow.execution_name ? { label: "Exec", value: detailRow.execution_name, tone: "green" } : null,
                detailRow.visit_type ? { label: "Visit", value: detailRow.visit_type, tone: "slate" } : null,
              ].filter(Boolean)}
              hero={
                <DetailHero>
                  <DetailStatTile label="Item Code" value={detailRow.item_code || "—"} />
                  <DetailStatTile label="Target (SAR)" value={fmt.format(detailRow.target_amount || 0)} tone="slate" />
                  <DetailStatTile label="Achieved (SAR)" value={fmt.format(detailRow.execution_achieved_amount || detailRow.achieved_amount || 0)} tone="green" />
                  {detailRow.plan_status && (
                    <DetailStatTile
                      label="Plan Status"
                      value={detailRow.plan_status}
                      tone={/complete/i.test(detailRow.plan_status) ? "green" : /cancel/i.test(detailRow.plan_status) ? "rose" : /progress|execution/i.test(detailRow.plan_status) ? "blue" : /issue/i.test(detailRow.plan_status) ? "amber" : "slate"}
                    />
                  )}
                  {detailRow.execution_status && (
                    <DetailStatTile
                      label="Execution Status"
                      value={detailRow.execution_status}
                      tone={/complete|done/i.test(detailRow.execution_status) ? "green" : /cancel|fail/i.test(detailRow.execution_status) ? "rose" : /progress|running/i.test(detailRow.execution_status) ? "blue" : "amber"}
                    />
                  )}
                </DetailHero>
              }
              hiddenFields={[
                "item_code",
                "target_amount", "target_sar", "achieved_sar",
                "execution_achieved_amount", "achieved_amount",
                "plan_status", "execution_status",
                "po_dispatch",
                // hide duplicates — already in pills / hero
                "im", "im_full_name",
              ]}
              keyOrder={[
                "item_description",
                "name", "execution_name", "original_dummy_poid",
                "project_code", "site_code", "site_name",
                "center_area", "region_type", "area",
                "team", "team_name",
                "visit_type", "plan_date", "execution_date",
                "qc_status", "ciag_status",
                "gps_location",
              ]}
            />
            {parseAttachments(detailRow.photos).length > 0 && (
              <div style={{ marginTop: 12, background: "#fff", borderRadius: 10, padding: 12, border: "1px solid #eef2f7" }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Attachments</div>
                {parseAttachments(detailRow.photos).map((url, idx) => (
                  <div key={`${url}-${idx}`} style={{ marginBottom: 4, fontSize: 13 }}>
                    <a href={url} target="_blank" rel="noreferrer" style={{ color: "#2563eb", wordBreak: "break-all" }}>{url}</a>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
