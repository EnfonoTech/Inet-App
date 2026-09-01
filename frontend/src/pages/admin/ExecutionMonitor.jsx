import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useDebounced } from "../../hooks/useDebounced";
import DataTableWrapper from "../../components/DataTableWrapper";
import { pmApi } from "../../services/api";
import { useTableRowLimit, TABLE_ROW_LIMIT_ALL, TABLE_ROW_LIMIT_DEFAULT } from "../../context/TableRowLimitContext";
import TableRowsLimitFooter from "../../components/TableRowsLimitFooter";
import { EXECUTION_STATUS_OPTIONS, ISSUE_CATEGORY_OPTIONS } from "../../constants/executionStatuses";
import useFilterOptions from "../../hooks/useFilterOptions";
import SearchableSelect from "../../components/SearchableSelect";
import RecordDetailView, { DetailHero, DetailStatTile } from "../../components/RecordDetailView";
import IMNoteCallout from "../../components/IMNoteCallout";
import RemarksPanel from "../../components/RemarksPanel";
import PlanTeamsBreakdown from "../../components/PlanTeamsBreakdown";
import DispatchVisitHistory from "../../components/DispatchVisitHistory";
import { isNotRequired } from "../../utils/qcCiagFlags";
import RemarksCell from "../../components/RemarksCell";
import DateRangePicker from "../../components/DateRangePicker";
import ExportExcelButton from "../../components/ExportExcelButton";
import { accessTimeBadge } from "../../utils/executionTimerDisplay";
import { handleSearchPaste } from "../../utils/searchPaste";
import { useProgressiveRows } from "../../hooks/useProgressiveRows";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

const PLAN_STATUS_OPTIONS = ["", "Planned", "Planning with Issue", "In Execution", "Overdue", "Not Attended", "Extended", "Completed", "Cancelled"];

function badgeTone(value) {
  const s = String(value || "").toLowerCase();
  if (!s) return { bg: "#f1f5f9", fg: "#334155", dot: "#64748b" };
  const tones = {
    "in progress": { bg: "#eff6ff", fg: "#1d4ed8", dot: "#3b82f6" },
    completed: { bg: "#ecfdf5", fg: "#047857", dot: "#10b981" },
    hold: { bg: "#fffbeb", fg: "#b45309", dot: "#f59e0b" },
    cancelled: { bg: "#fef2f2", fg: "#b91c1c", dot: "#ef4444" },
    postponed: { bg: "#fefce8", fg: "#a16207", dot: "#eab308" },
    "not applicable": { bg: "#f1f5f9", fg: "#475569", dot: "#94a3b8" },
    "n/a": { bg: "#f1f5f9", fg: "#475569", dot: "#94a3b8" },
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
  if (s === "extended") return "extended";
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
  const { rowLimit, setRowLimit } = useTableRowLimit();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const intervalRef = useRef(null);

  const location = useLocation();
  const _navExec = location.state?.execFilters;

  const [search, setSearch] = useState("");
  const searchDebounced = useDebounced(search, 300);
  const [planStatusFilter, setPlanStatusFilter] = useState(_navExec?.planStatusFilter ?? ["Planned", "In Execution", "Completed", "Planning with Issue"]);
  const [executionStatusFilter, setExecutionStatusFilter] = useState([]);
  const [visitFilter, setVisitFilter] = useState([]);
  const [imFilter, setImFilter] = useState([]);
  const [projectFilter, setProjectFilter] = useState([]);
  const [teamFilter, setTeamFilter] = useState([]);
  const [duidFilter, setDuidFilter] = useState([]);
  const [fromDate, setFromDate] = useState(_navExec?.fromDate ?? "");
  const [toDate, setToDate] = useState(_navExec?.toDate ?? "");
  const [tab, setTab] = useState("all"); // "all" | "internal_done"
  // "All" is stored per-path, not per-tab — the backend fetch is tab-scoped
  // (filters.tab below), so switching tabs is a genuinely different,
  // separately-limited fetch. Without this, picking "All" on one tab and
  // switching to the other would silently re-trigger an unlimited fetch for
  // a tab the user never asked "All" for on this occasion.
  const confirmedAllTabRef = useRef(rowLimit === TABLE_ROW_LIMIT_ALL ? tab : null);
  const effectiveRowLimit = rowLimit === TABLE_ROW_LIMIT_ALL && confirmedAllTabRef.current !== tab
    ? TABLE_ROW_LIMIT_DEFAULT
    : rowLimit;
  const confirmRowLimit = useCallback((n) => {
    confirmedAllTabRef.current = tab;
    setRowLimit(n);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, setRowLimit]);
  // Remembers what the LAST real server fetch actually returned, and under
  // what limit + filters + tab. Shrinking the row limit (e.g. All -> 20) on
  // the SAME tab never needs another round-trip. See PICTracker.jsx for the
  // reference implementation.
  const lastFetchRef = useRef({ signature: null, limit: null, rows: [], refreshKey: null });
  const [internalSearch, setInternalSearch] = useState("");
  const [internalImFilter, setInternalImFilter] = useState([]);
  const [internalTeamFilter, setInternalTeamFilter] = useState([]);
  const [internalDomainFilter, setInternalDomainFilter] = useState([]);
  const [internalTypeFilter, setInternalTypeFilter] = useState([]);
  const [internalFromDate, setInternalFromDate] = useState("");
  const [internalToDate, setInternalToDate] = useState("");
  const internalSearchDebounced = useDebounced(internalSearch, 300);

  // ── Manage Table column filters ──────────────────────────────────────
  // Both the main and internal-done tables load from the SAME backend call
  // (split client-side afterward), so their column filters are merged into
  // one `column_filters` payload sent together. Each column's typed value is
  // matched only against that column's own value on the backend (see
  // column_filters / col_filter_map in list_execution_monitor_rows), not
  // blended into the top search box's wide multi-column search.
  const [columnFiltersByTable, setColumnFiltersByTable] = useState({});
  useEffect(() => {
    const onFiltersChanged = (e) => {
      const k = e.detail?.tableKey;
      if (k !== "execution-monitor-main" && k !== "execution-monitor-internal-done") return;
      setColumnFiltersByTable((prev) => ({ ...prev, [k]: e.detail.filters || {} }));
    };
    document.addEventListener("tablepro:filters-changed", onFiltersChanged);
    return () => document.removeEventListener("tablepro:filters-changed", onFiltersChanged);
  }, []);
  // Now that the backend query itself is scoped to the active tab (see
  // `filters.tab` below), only that tab's own column filters should be
  // sent - merging in the other (inactive) tab's filters would narrow this
  // tab's results using a value the user typed somewhere else entirely.
  // Excel column-filter dropdowns cascade off exactly the query the rows were
  // fetched with. Both tables share one query (scoped by filters.tab), so one
  // ref serves both keys.
  const queryArgsRef = useRef({});
  useEffect(() => {
    const onRequestOptions = (e) => {
      const k = e.detail?.tableKey;
      if (k !== "execution-monitor-main" && k !== "execution-monitor-internal-done") return;
      e.detail.respond(pmApi.getColumnFilterOptions({
        source: "execution_monitor",
        col_key: e.detail.colKey,
        bucket: e.detail.bucket,
        search: e.detail.search,
        limit: e.detail.limit,
        portal_filters: queryArgsRef.current,
        exclude_column: e.detail.colKey,
      }));
    };
    document.addEventListener("tablepro:request-column-options", onRequestOptions);
    return () => document.removeEventListener("tablepro:request-column-options", onRequestOptions);
  }, []);
  // Either a legacy substring string or the Excel-style { values, blanks,
  // contains } object. String(obj) is "[object Object]" — always truthy — so
  // an emptied Excel selection would never clear without this.
  const activeColumnFilters = Object.fromEntries(
    Object.entries(
      columnFiltersByTable[tab === "internal_done" ? "execution-monitor-internal-done" : "execution-monitor-main"] || {}
    ).filter(([, v]) => (
      v && typeof v === "object"
        ? (Array.isArray(v.values) && v.values.some((x) => String(x ?? "").trim()))
          || !!v.blanks || !!String(v.contains || "").trim()
        : String(v || "").trim()
    ))
  );
  const columnFiltersKey = JSON.stringify(activeColumnFilters);
  const columnFiltersDebounced = useDebounced(columnFiltersKey, 300);
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

  const [refreshKey, setRefreshKey] = useState(0);
  const loadData = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Single useEffect with cancellation guard. Replaces the older
  // useResetOnRowLimitChange + separate-load pattern that left the table
  // blank when going from a higher to a lower row limit.
  useEffect(() => {
    let cancelled = false;
    setError(null);
    (async () => {
      try {
        const filters = {};
        // Main and Internal Work Done are two tabs sharing one fetch -
        // without this, one row-limited batch had to cover both, so
        // whichever tab wasn't the majority of that batch lost rows.
        filters.tab = tab === "internal_done" ? "internal_done" : "main";
        if (planStatusFilter.length) filters.status = planStatusFilter;
        if (executionStatusFilter.length) filters.execution_status = executionStatusFilter;
        if (visitFilter.length) filters.visit_type = visitFilter;
        if (imFilter.length) filters.im = imFilter;
        if (teamFilter.length) filters.team = teamFilter;
        if (projectFilter.length) filters.project_code = projectFilter;
        if (duidFilter.length) filters.site_code = duidFilter;
        if (fromDate) filters.from_date = fromDate;
        if (toDate) filters.to_date = toDate;
        if (searchDebounced.trim()) filters.search = searchDebounced.trim();
        if (internalImFilter.length) filters.internal_im = internalImFilter;
        if (internalTeamFilter.length) filters.internal_team = internalTeamFilter;
        if (internalDomainFilter.length) filters.internal_domain = internalDomainFilter;
        if (internalTypeFilter.length) filters.internal_work_type = internalTypeFilter;
        if (internalFromDate) filters.internal_from_date = internalFromDate;
        if (internalToDate) filters.internal_to_date = internalToDate;
        const colFilters = JSON.parse(columnFiltersDebounced);
        if (Object.keys(colFilters).length) filters.column_filters = colFilters;
        queryArgsRef.current = filters;
        const signature = JSON.stringify([filters]);

        const prev = lastFetchRef.current;
        // refreshKey must match too — a post-action reload bumps refreshKey
        // with filters unchanged, so a signature-only check would wrongly
        // treat that as "same filters, already have enough" and skip the
        // refetch, leaving the table showing stale data until a reload.
        const alreadyHaveEnough = prev.signature === signature && prev.refreshKey === refreshKey && (
          prev.limit === TABLE_ROW_LIMIT_ALL
          || (effectiveRowLimit !== TABLE_ROW_LIMIT_ALL && effectiveRowLimit <= prev.limit)
        );
        if (alreadyHaveEnough) {
          // Same tab + filters, already have at least this many rows from a
          // larger (or equal) fetch — show fewer via the CSS-hide render
          // below, no re-fetch and no state mutation.
          return;
        }

        setLoading(true);
        const list = await pmApi.listExecutionMonitorRows(filters, effectiveRowLimit);
        if (cancelled) return;
        const fetchedRows = Array.isArray(list) ? list : [];
        setRows(fetchedRows);
        lastFetchRef.current = { signature, limit: effectiveRowLimit, rows: fetchedRows, refreshKey };
        setLastRefresh(new Date());
      } catch (err) {
        if (!cancelled) setError(err.message || "Failed to load execution data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    // Auto-refresh removed — the page reloads only when filters change or
    // when the user clicks Refresh. Avoids surprising re-fetches on long
    // edit sessions. Keep intervalRef cleanup for safety on remount.
    return () => {
      cancelled = true;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [effectiveRowLimit, searchDebounced, planStatusFilter, executionStatusFilter, visitFilter, imFilter, projectFilter, teamFilter, duidFilter, fromDate, toDate, refreshKey, columnFiltersDebounced, internalImFilter, internalTeamFilter, internalDomainFilter, internalTypeFilter, internalFromDate, internalToDate, tab]);

  function formatTime(d) {
    if (!d) return "";
    return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  }

  // Distinct values across ALL Rollout Plans / PO Dispatches — not row-limited.
  const { options: planOpts } = useFilterOptions("Rollout Plan", ["visit_type"]);
  const { options: dispOpts } = useFilterOptions("PO Dispatch", ["project_code", "site_code"]);
  const visitTypes = planOpts.visit_type || [];
  const projectOptions = dispOpts.project_code || [];
  const duidOptions = dispOpts.site_code || [];
  const [teamOptions, setTeamOptions] = useState([]);
  useEffect(() => {
    pmApi.getTeamOptions().then((opts) => {
      if (Array.isArray(opts)) setTeamOptions(opts);
    }).catch(() => {});
  }, []);
  const [knownImOptions, setKnownImOptions] = useState([]);
  useEffect(() => {
    if (!rows.length) return;
    setKnownImOptions((prev) => {
      const seen = new Map(prev.map((o) => [o.id, o.label]));
      for (const r of rows) { if (r.im) seen.set(r.im, r.im_full_name || r.im); }
      return Array.from(seen.entries()).map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
    });
  }, [rows]);

  const hasFilters = !!(searchDebounced || planStatusFilter.length || executionStatusFilter.length || visitFilter.length || imFilter.length || projectFilter.length || teamFilter.length || duidFilter.length || fromDate || toDate);

  // Internal work has no Work Done record — once its Execution Status is
  // Completed it moves out of the main table and into its own archive tab,
  // mirroring the IM's Rollout Work Done page.
  const mainRows = useMemo(
    () => rows.filter((r) => !(Number(r.is_internal_work || 0) && r.execution_status === "Completed")),
    [rows],
  );
  const internalDoneRows = useMemo(
    () => rows.filter((r) => !!Number(r.is_internal_work || 0) && r.execution_status === "Completed"),
    [rows],
  );

  const internalTeamOptions = useMemo(() => {
    const seen = new Map();
    internalDoneRows.forEach((r) => { if (r.team && !seen.has(r.team)) seen.set(r.team, r.team_name || r.team); });
    return [...seen.entries()].map(([id, label]) => ({ id, label }));
  }, [internalDoneRows]);
  const internalImOptions = useMemo(() => {
    const seen = new Map();
    internalDoneRows.forEach((r) => { if (r.im && !seen.has(r.im)) seen.set(r.im, r.im_full_name || r.im); });
    return [...seen.entries()].map(([id, label]) => ({ id, label }));
  }, [internalDoneRows]);
  const internalDomainOptions = useMemo(() => {
    const seen = new Set();
    internalDoneRows.forEach((r) => { if (r.internal_domain) seen.add(r.internal_domain); });
    return [...seen].sort().map((d) => ({ id: d, label: d }));
  }, [internalDoneRows]);

  const filteredInternalDone = useMemo(() => {
    let out = internalDoneRows;
    const q = internalSearchDebounced.trim().toLowerCase();
    if (q) {
      out = out.filter((r) =>
        [r.name, r.poid, r.item_code, r.item_description, r.team_name, r.team, r.im_full_name, r.im]
          .some((v) => (v || "").toString().toLowerCase().includes(q)));
    }
    if (internalImFilter.length) out = out.filter((r) => internalImFilter.includes(r.im));
    if (internalTeamFilter.length) out = out.filter((r) => internalTeamFilter.includes(r.team));
    if (internalDomainFilter.length) out = out.filter((r) => internalDomainFilter.includes(r.internal_domain));
    if (internalTypeFilter.length) out = out.filter((r) => internalTypeFilter.includes(r.internal_work_type));
    if (internalFromDate) out = out.filter((r) => (r.execution_date || "") >= internalFromDate);
    if (internalToDate) out = out.filter((r) => (r.execution_date || "") <= internalToDate);
    return out;
  }, [internalDoneRows, internalSearchDebounced, internalImFilter, internalTeamFilter, internalDomainFilter, internalTypeFilter, internalFromDate, internalToDate]);

  const hasInternalFilters = !!(
    internalSearch || internalImFilter.length || internalTeamFilter.length ||
    internalDomainFilter.length || internalTypeFilter.length || internalFromDate || internalToDate
  );

  // See useProgressiveRows — mounts large row sets in chunks so the browser
  // doesn't show "Page Unresponsive" on tables with "All" rows loaded.
  const visibleMainRows = useProgressiveRows(mainRows, { paused: loading });
  const visibleInternalDone = useProgressiveRows(filteredInternalDone, { paused: loading });
  // How many of each visible* array to actually show — anything beyond this
  // is hidden via CSS in the render below rather than removed from `rows`
  // (see the skip-fetch cache in the fetch effect above / PICTracker.jsx).
  const displayLimit = effectiveRowLimit === TABLE_ROW_LIMIT_ALL ? Infinity : effectiveRowLimit;
  const displayedMainCount = Math.min(mainRows.length, displayLimit);
  const displayedInternalCount = Math.min(filteredInternalDone.length, displayLimit);

  const totals = mainRows.slice(0, displayedMainCount).reduce(
    (acc, r) => ({
      target: acc.target + (parseFloat(r.target_amount) || 0),
    }),
    { target: 0 }
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Execution Monitor</h1>
          <div className="page-subtitle">
            Today's live execution status
            {lastRefresh && (
              <span style={{ marginLeft: 8, color: "var(--text-muted)" }}>
                · Last refreshed {formatTime(lastRefresh)}
              </span>
            )}
          </div>
        </div>
        <div className="page-actions">
          <ExportExcelButton filename="execution-monitor" rows={tab === "internal_done" ? filteredInternalDone.slice(0, displayedInternalCount) : mainRows.slice(0, displayedMainCount)} />
          <button className="btn-secondary" onClick={loadData} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      <div role="tablist" aria-label="Work type" style={{ display: "flex", gap: 4, padding: 4, background: "#f1f5f9", borderRadius: 8, border: "1px solid #e2e8f0", margin: "0 16px 8px", width: "fit-content" }}>
        {[
          { id: "all", label: "Execution Monitor" },
          { id: "internal_done", label: "Internal Work Done", count: internalDoneRows.length },
        ].map((tt) => {
          const active = tab === tt.id;
          const teal = tt.id === "internal_done";
          return (
            <button key={tt.id} type="button" role="tab" aria-selected={active} onClick={() => setTab(tt.id)}
              style={{ padding: "5px 14px", fontSize: "0.78rem", fontWeight: 700, border: "none", borderRadius: 6, cursor: "pointer", background: active ? (teal ? "#0d9488" : "#1d4ed8") : "transparent", color: active ? "#fff" : "#475569", display: "inline-flex", alignItems: "center", gap: 6 }}>
              {tt.label}
              {!!tt.count && (
                <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 18, height: 18, padding: "0 6px", borderRadius: 999, fontSize: "0.66rem", fontWeight: 800, background: active ? "#fff" : "#14b8a6", color: active ? "#0d9488" : "#fff" }}>
                  {tt.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Toolbar ─────────────────────────────────────────── */}
      {tab === "all" && (
      <div className="toolbar">
        <input
          type="search"
          placeholder="Search POID, dummy POID, Plan, Team, IM, Date, Center area, Region…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onPaste={(e) => handleSearchPaste(e, setSearch)}
          style={{
            padding: "7px 14px", borderRadius: 8,
            border: "1px solid #e2e8f0", fontSize: "0.84rem", minWidth: 240,
          }}
        />
        <SearchableSelect multi value={planStatusFilter} onChange={setPlanStatusFilter} options={PLAN_STATUS_OPTIONS.filter(Boolean)} placeholder="All Plan Status" minWidth={150} />
        <SearchableSelect multi value={executionStatusFilter} onChange={setExecutionStatusFilter} options={EXECUTION_STATUS_OPTIONS} placeholder="All Exec Status" minWidth={150} />
        <SearchableSelect multi value={visitFilter} onChange={setVisitFilter} options={visitTypes} placeholder="All Visit Types" minWidth={160} />
        <SearchableSelect multi value={projectFilter} onChange={setProjectFilter} options={projectOptions} placeholder="All Projects" minWidth={170} />
        <SearchableSelect multi value={imFilter} onChange={setImFilter} options={knownImOptions} placeholder="All IMs" minWidth={150} />
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
              setImFilter([]);
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
      )}

      {tab === "internal_done" && (
      <div className="toolbar">
        <input
          type="search"
          placeholder="Search Plan, Item, Team, IM…"
          value={internalSearch}
          onChange={(e) => setInternalSearch(e.target.value)}
          style={{
            padding: "7px 14px", borderRadius: 8,
            border: "1px solid #e2e8f0", fontSize: "0.84rem", minWidth: 240,
          }}
        />
        <SearchableSelect multi value={internalImFilter} onChange={setInternalImFilter} options={internalImOptions} placeholder="All IMs" minWidth={150} />
        <SearchableSelect multi value={internalTeamFilter} onChange={setInternalTeamFilter} options={internalTeamOptions} placeholder="All Teams" minWidth={150} />
        <SearchableSelect multi value={internalDomainFilter} onChange={setInternalDomainFilter} options={internalDomainOptions} placeholder="All Domains" minWidth={150} />
        <SearchableSelect multi value={internalTypeFilter} onChange={setInternalTypeFilter} options={["Domain", "General"]} placeholder="All Types" minWidth={130} />
        <DateRangePicker value={{ from: internalFromDate, to: internalToDate }} onChange={({ from, to }) => { setInternalFromDate(from); setInternalToDate(to); }} />
        {hasInternalFilters && (
          <button
            className="btn-secondary"
            style={{ fontSize: "0.78rem", padding: "5px 12px" }}
            onClick={() => { setInternalSearch(""); setInternalImFilter([]); setInternalTeamFilter([]); setInternalDomainFilter([]); setInternalTypeFilter([]); setInternalFromDate(""); setInternalToDate(""); }}
          >
            Clear
          </button>
        )}
      </div>
      )}

      <div className="page-content">
        {error && (
          <div className="notice error" style={{ marginBottom: 16 }}>
            <span>⚠</span> {error}
          </div>
        )}

        <DataTableWrapper loading={loading && rows.length > 0}>
          {tab === "internal_done" ? (
            <table key="execution-monitor-internal-done" className="data-table" data-excel-filter-all="1" data-table-key="execution-monitor-internal-done">
              <thead>
                <tr>
                  <th>Plan</th>
                  <th>Execution</th>
                  <th>Item</th>
                  <th>Description</th>
                  <th>Type</th>
                  <th>Domain</th>
                  <th>Team</th>
                  <th>IM</th>
                  <th style={{ whiteSpace: "nowrap" }}>Exec Date</th>
                  <th style={{ whiteSpace: "nowrap" }}>Access Time</th>
                  <th style={{ whiteSpace: "nowrap" }} data-excel-filter="0">Access</th>
                  <th>TL Status</th>
                  <th style={{ textAlign: "right" }}>Qty</th>
                  <th title="Remark set by IM">Manager</th>
                  <th title="Remark set by Field Team Lead">Team Lead</th>
                  <th data-excel-filter="0">Open</th>
                </tr>
              </thead>
              <tbody>
                {filteredInternalDone.length === 0 ? (
                  <tr>
                    <td colSpan={16} style={{ padding: 0 }}>
                      {loading ? (
                        <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)" }}>
                          Loading execution data…
                        </div>
                      ) : (
                        <div className="empty-state">
                          <div className="empty-icon">✅</div>
                          <h3>{hasInternalFilters ? "No results match your filters" : "No internal work done yet"}</h3>
                          <p>
                            {hasInternalFilters
                              ? "Try adjusting your search or filter criteria."
                              : "Internal work moves here once its Execution Status is set to Completed."}
                          </p>
                        </div>
                      )}
                    </td>
                  </tr>
                ) : (
                  visibleInternalDone.map((row, idx) => (
                    <tr key={row.name} style={idx >= displayedInternalCount ? { display: "none" } : { background: "#f0fdfa" }}>
                      <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{row.name}</td>
                      <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{row.execution_name || "—"}</td>
                      <td style={{ fontSize: "0.82rem" }}>{row.item_code || row.site_name || "—"}</td>
                      <td style={{ fontSize: "0.82rem", maxWidth: 260 }} title={row.item_description || ""}>{row.item_description || "—"}</td>
                      <td style={{ fontSize: "0.82rem" }}>{row.internal_work_type || "—"}</td>
                      <td style={{ fontSize: "0.82rem" }}>{row.internal_domain || "—"}</td>
                      <td style={{ fontSize: "0.82rem" }}>{row.team_name || row.team || "—"}</td>
                      <td style={{ fontSize: "0.82rem" }}>{row.im_full_name || row.im || "—"}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{row.execution_date || "—"}</td>
                      <td style={{ fontSize: "0.78rem", whiteSpace: "nowrap" }}>
                        {row.access_time || row.access_period ? `${row.access_time ? row.access_time.slice(0, 5) : "—"}${row.access_period ? ` · ${row.access_period}` : ""}` : "—"}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {(() => {
                          const badge = accessTimeBadge(row.access_time, row.access_period, row.timer_start_ms, row.tl_status, row.plan_date);
                          if (!badge) return <span style={{ color: "#94a3b8" }}>—</span>;
                          return (
                            <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: "0.75rem", fontWeight: 700, background: badge.bg, color: badge.color }}>
                              {badge.label}
                            </span>
                          );
                        })()}
                      </td>
                      <td><StatusPill value={row.tl_status || "—"} /></td>
                      <td style={{ textAlign: "right" }}>{row.execution_achieved_qty ?? "—"}</td>
                      <td style={{ fontSize: "0.78rem", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.manager_remark || ""}>{row.manager_remark || "—"}</td>
                      <td style={{ fontSize: "0.78rem", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.team_lead_remark || ""}>{row.team_lead_remark || "—"}</td>
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
                  ))
                )}
              </tbody>
              {filteredInternalDone.length > 0 && (
                <tfoot>
                  <tr>
                    <td style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", fontWeight: 700, fontSize: "0.78rem" }}>
                      {displayedInternalCount} row{displayedInternalCount !== 1 ? "s" : ""} done
                      {filteredInternalDone.length !== internalDoneRows.length && (
                        <span style={{ color: "#64748b", marginLeft: 10, fontWeight: 500 }}>of {Math.min(internalDoneRows.length, displayLimit)} total</span>
                      )}
                    </td>
                    <td style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", fontWeight: 700, fontSize: "0.78rem" }} />
                    <td style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", fontWeight: 700, fontSize: "0.78rem" }} />
                    <td style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", fontWeight: 700, fontSize: "0.78rem" }} />
                    <td style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", fontWeight: 700, fontSize: "0.78rem" }} />
                    <td style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", fontWeight: 700, fontSize: "0.78rem" }} />
                    <td style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", fontWeight: 700, fontSize: "0.78rem" }} />
                    <td style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", fontWeight: 700, fontSize: "0.78rem" }} />
                    <td style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", fontWeight: 700, fontSize: "0.78rem" }} />
                    <td style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", fontWeight: 700, fontSize: "0.78rem" }} />
                    <td style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", fontWeight: 700, fontSize: "0.78rem" }} />
                    <td style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", fontWeight: 700, fontSize: "0.78rem" }} />
                    <td style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", fontWeight: 700, fontSize: "0.78rem" }} />
                    <td style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", fontWeight: 700, fontSize: "0.78rem" }} />
                    <td style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", fontWeight: 700, fontSize: "0.78rem" }} />
                    <td style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", fontWeight: 700, fontSize: "0.78rem" }} />
                  </tr>
                </tfoot>
              )}
            </table>
          ) : (
            <table key="execution-monitor-main" className="data-table" data-excel-filter-all="1" data-table-key="execution-monitor-main">
              <thead>
                <tr>
                  <th>Plan</th>
                  <th>POID</th>
                  <th>Dummy POID</th>
                  <th>Item code</th>
                  <th>Description</th>
                  <th>Activity Type</th>
                  <th>Project</th>
                  <th>Domain</th>
                  <th>Huawei IM</th>
                  <th>DUID</th>
                  <th>Center area</th>
                  <th>Region</th>
                  <th>Team</th>
                  <th>IM</th>
                  <th>Plan Date</th>
                  <th style={{ whiteSpace: "nowrap" }}>Access Time</th>
                  <th style={{ whiteSpace: "nowrap" }} data-excel-filter="0">Access</th>
                  <th>Visit Type</th>
                  <th style={{ textAlign: "right" }} title="Which visit this plan is (1, 2, 3…)">Visit No</th>
                  <th style={{ textAlign: "right" }}>Target</th>
                  <th>Plan Status</th>
                  <th>TL Status</th>
                  <th>Exec Status</th>
                  <th>QC</th>
                  <th>CIAG</th>
                  <th>Issue Category</th>
                  <th title="Remark set by PM">General</th>
                  <th title="Remark set by IM">Manager</th>
                  <th title="Remark set by Field Team Lead">Team Lead</th>
                  <th data-excel-filter="0">Open</th>
                </tr>
              </thead>
              <tbody>
                {mainRows.length === 0 ? (
                  <tr>
                    <td colSpan={30} style={{ padding: 0 }}>
                      {loading ? (
                        <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)" }}>
                          Loading execution data…
                        </div>
                      ) : (
                        <div className="empty-state">
                          <div className="empty-icon">📊</div>
                          <h3>{hasFilters ? "No results match your filters" : "No active executions"}</h3>
                          <p>
                            {hasFilters
                              ? "Try adjusting your search or filter criteria."
                              : "No plans are currently Planned or In Execution."}
                          </p>
                        </div>
                      )}
                    </td>
                  </tr>
                ) : visibleMainRows.map((row, idx) => {
                  const target = row.target_amount || 0;
                  return (
                    <tr key={row.name} style={idx >= displayedMainCount ? { display: "none" } : { ...(row.is_dummy_po ? { background: "#fffbeb" } : Number(row.is_internal_work || 0) ? { background: "#f0fdfa" } : {}) }}>
                      <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{row.name}</td>
                      <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{row.poid || row.po_dispatch || "—"}</td>
                      <td style={{ fontFamily: "monospace", fontSize: "0.72rem", maxWidth: 140 }} title={(row.original_dummy_poid || "").trim() ? `Dummy POID: ${row.original_dummy_poid}` : ""}>
                        {(row.original_dummy_poid || "").trim() || "—"}
                      </td>
                      <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{row.item_code || "—"}</td>
                      <td style={{ fontSize: "0.82rem", maxWidth: 220 }}>{row.item_description || "—"}</td>
                      <td style={{ fontSize: "0.82rem" }}>{row.activity_type || "—"}</td>
                      <td>{row.project_code || "—"}</td>
                      <td>{row.project_domain || "—"}</td>
                      <td>{row.huawei_im || "—"}</td>
                      <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }} title={row.site_name || ""}>{row.site_code || "—"}</td>
                      <td style={{ fontSize: "0.78rem", maxWidth: 120 }} title={row.center_area || ""}>
                        {row.center_area || "—"}
                      </td>
                      <td style={{ fontSize: "0.78rem" }}>{row.region_type || "—"}</td>
                      <td>{row.team_name || row.team || "—"}</td>
                      <td>{row.im_full_name || row.im || "—"}</td>
                      <td>{row.plan_date}</td>
                      <td style={{ fontSize: "0.78rem", whiteSpace: "nowrap" }}>
                        {row.access_time || row.access_period ? `${row.access_time ? row.access_time.slice(0, 5) : "—"}${row.access_period ? ` · ${row.access_period}` : ""}` : "—"}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {(() => {
                          const badge = accessTimeBadge(row.access_time, row.access_period, row.timer_start_ms, row.tl_status, row.plan_date);
                          if (!badge) return <span style={{ color: "#94a3b8" }}>—</span>;
                          return (
                            <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: "0.75rem", fontWeight: 700, background: badge.bg, color: badge.color }}>
                              {badge.label}
                            </span>
                          );
                        })()}
                      </td>
                      <td>{row.visit_type}</td>
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{row.visit_number != null ? row.visit_number : "—"}</td>
                      <td style={{ textAlign: "right" }}>{fmt.format(target)}</td>
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
                      <td>{isNotRequired(row.qc_required) ? <StatusPill value="Not Applicable" /> : row.execution_name ? <StatusPill value={row.qc_status} /> : <span style={{ color: "#94a3b8", fontSize: "0.78rem" }}>—</span>}</td>
                      <td>{isNotRequired(row.ciag_required) ? <StatusPill value="Not Applicable" /> : row.execution_name ? <StatusPill value={row.ciag_status} /> : <span style={{ color: "#94a3b8", fontSize: "0.78rem" }}>—</span>}</td>
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
                      <td><RemarksCell value={row.general_remark} tone="general" poDispatch={row.po_dispatch || row.poid} poid={row.poid || row.po_dispatch} onSaved={(v) => { row.general_remark = v; }} /></td>
                      <td><RemarksCell value={row.manager_remark} tone="manager" poDispatch={row.po_dispatch || row.poid} poid={row.poid || row.po_dispatch} onSaved={(v) => { row.manager_remark = v; }} /></td>
                      <td><RemarksCell value={row.team_lead_remark} tone="team_lead" poDispatch={row.po_dispatch || row.poid} poid={row.poid || row.po_dispatch} onSaved={(v) => { row.team_lead_remark = v; }} /></td>
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
              {mainRows.length > 0 && (
                <tfoot>
                  {/* 30 columns: Plan · POID · Dummy POID · Item code · Description · Activity Type ·
                      Project · Domain · Huawei IM · DUID · Center area · Region · Team · IM · Plan Date ·
                      Access Time · Access · Visit Type · Visit No · Target · Plan Status · TL Status ·
                      Exec Status · QC · CIAG · Issue Category · General · Manager · Team Lead · Open */}
                  <tr style={{ borderTop: "2px solid #e2e8f0", background: "#f8fafc" }}>
                    <td style={{ padding: "8px 16px", fontSize: "0.75rem", fontWeight: 700, color: "#64748b", whiteSpace: "nowrap" }}>
                      {displayedMainCount} rows
                    </td>{/* Plan */}
                    <td /><td /><td /><td /><td /><td /><td /><td /><td /><td /><td /><td /><td /><td /><td /><td /><td /><td />
                    {/* POID · Dummy POID · Item code · Description · Activity Type · Project · Domain ·
                        Huawei IM · DUID · Center area · Region · Team · IM · Plan Date · Access Time ·
                        Access · Visit Type · Visit No */}
                    <td style={{ textAlign: "right", fontWeight: 700, padding: "8px 16px", color: "#0f172a" }}>
                      {fmt.format(totals.target)}
                    </td>{/* Target */}
                    <td /><td /><td /><td /><td /><td /><td /><td /><td /><td />
                    {/* Plan Status · TL Status · Exec Status · QC · CIAG · Issue Category · General ·
                        Manager · Team Lead · Open */}
                  </tr>
                </tfoot>
              )}
            </table>
          )}
        </DataTableWrapper>
        <TableRowsLimitFooter
          placement="tableCard"
          loadedCount={tab === "internal_done" ? displayedInternalCount : displayedMainCount}
          filteredCount={tab === "internal_done" ? displayedInternalCount : displayedMainCount}
          filterActive={tab === "internal_done" ? hasInternalFilters : hasFilters}
          value={effectiveRowLimit}
          onChange={confirmRowLimit}
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
          style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={() => setDetailRow(null)}
        >
          <div
            style={{
              background: "#fff", borderRadius: 12,
              width: "min(860px, 96vw)",
              maxHeight: "calc(100dvh - 32px)",
              display: "flex", flexDirection: "column", overflow: "hidden",
              boxShadow: "0 24px 48px -16px rgba(0,0,0,0.3)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "16px 20px", borderBottom: "1px solid #e2e8f0",
              background: "#fff", flexShrink: 0,
            }}>
              <h3 style={{ margin: 0, fontSize: "1rem" }}>Execution Details</h3>
              <button type="button" onClick={() => setDetailRow(null)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#94a3b8", lineHeight: 1 }}>&times;</button>
            </div>
            <div style={{ padding: 20, overflowY: "auto", flex: "1 1 auto", minHeight: 0 }}>
            <RecordDetailView
              row={{
                ...detailRow,
                target_sar: detailRow.target_amount,
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
            <IMNoteCallout note={detailRow.manager_remark} />
            <PlanTeamsBreakdown rolloutPlan={detailRow.name} />
            <DispatchVisitHistory
              poDispatch={detailRow.po_dispatch}
              rolloutPlan={detailRow.name}
              currentPlanName={detailRow.name}
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
        </div>
      )}
    </div>
  );
}
