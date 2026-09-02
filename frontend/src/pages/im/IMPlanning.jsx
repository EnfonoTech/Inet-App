import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DataTableWrapper from "../../components/DataTableWrapper";
import PageSummary from "../../components/PageSummary";
import { usePublishedQuery } from "../../hooks/usePublishedQuery";
import { useAuth } from "../../context/AuthContext";
import { useTableRowLimit, TABLE_ROW_LIMIT_ALL } from "../../context/TableRowLimitContext";
import TableRowsLimitFooter from "../../components/TableRowsLimitFooter";
import { useDebounced } from "../../hooks/useDebounced";
import { pmApi } from "../../services/api";
import IMPlanningExecutionModal from "./IMPlanningExecutionModal";
import useFilterOptions from "../../hooks/useFilterOptions";
import SearchableSelect from "../../components/SearchableSelect";
import { handleSearchPaste } from "../../utils/searchPaste";
import { useProgressiveRows } from "../../hooks/useProgressiveRows";
import RecordDetailView from "../../components/RecordDetailView";
import PlanTeamsBreakdown from "../../components/PlanTeamsBreakdown";
import DispatchVisitHistory from "../../components/DispatchVisitHistory";
import PoidMaterialsDispatched from "../../components/PoidMaterialsDispatched";
import DateRangePicker from "../../components/DateRangePicker";
import RemarksCell from "../../components/RemarksCell";
import ExportExcelButton from "../../components/ExportExcelButton";
import IMNoteCallout from "../../components/IMNoteCallout";
import RescheduleModal from "../../components/RescheduleModal";
import { accessTimeBadge } from "../../utils/executionTimerDisplay";
import AttachmentsSection, { parseFileList } from "../../components/AttachmentsSection";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

function statusTone(value) {
  const s = String(value || "").toLowerCase();
  if (s.includes("complete") || s.includes("approved") || s.includes("dispatched")) return { bg: "#ecfdf5", fg: "#047857" };
  if (s.includes("cancel") || s.includes("reject") || s.includes("fail")) return { bg: "#fef2f2", fg: "#b91c1c" };
  if (s.includes("progress") || s.includes("planned") || s.includes("auto")) return { bg: "#eff6ff", fg: "#1d4ed8" };
  return { bg: "#fffbeb", fg: "#b45309" };
}

function DetailItem({ label, value }) {
  const isStatus = /status|mode/i.test(label);
  const tone = statusTone(value);
  return (
    <div style={{ background: "#fff", borderRadius: 8, padding: "8px 10px" }}>
      <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>{label}</div>
      {isStatus ? (
        <span style={{ display: "inline-block", borderRadius: 999, padding: "3px 10px", fontSize: 12, fontWeight: 700, background: tone.bg, color: tone.fg }}>
          {value == null || value === "" ? "—" : String(value)}
        </span>
      ) : (
        <div style={{ fontSize: 13, color: "#0f172a", fontWeight: 500 }}>{value == null || value === "" ? "—" : String(value)}</div>
      )}
    </div>
  );
}

function canImExecuteFromPlan(status) {
  const s = (status || "").trim();
  return ["Planned", "In Execution", "Planning with Issue", "Ready for Execution", "Overdue", "Not Attended", "Extended"].includes(s);
}

/** All selected plans that are in an executable status. */
function selectedExecutablePlans(planList, selected) {
  if (!selected || selected.size === 0) return [];
  return planList.filter((p) => selected.has(p.name) && canImExecuteFromPlan(p.plan_status));
}

export default function IMPlanning() {
  const { imName } = useAuth();
  const { rowLimit } = useTableRowLimit();
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState(["Planned", "Overdue", "Not Attended", "Extended"]);
  const [visitFilter, setVisitFilter] = useState([]);
  const [search, setSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState([]);
  const [teamFilter, setTeamFilter] = useState([]);
  const [duidFilter, setDuidFilter] = useState([]);
  const [dummyFilter, setDummyFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const searchDebounced = useDebounced(search, 300);
  const [detailRow, setDetailRow] = useState(null);
  const [executionModalOpen, setExecutionModalOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [mapForRow, setMapForRow] = useState(null);
  const [mapLines, setMapLines] = useState([]);
  const [mapLineId, setMapLineId] = useState("");
  const [mapBusy, setMapBusy] = useState(false);
  const [mapErr, setMapErr] = useState(null);
  const [mapLinesLoading, setMapLinesLoading] = useState(false);
  const [mapSuccessMsg, setMapSuccessMsg] = useState(null);

  const [rescheduleModalOpen, setRescheduleModalOpen] = useState(false);
  const [rescheduleSuccessMsg, setRescheduleSuccessMsg] = useState(null);
  const [rescheduleLogs, setRescheduleLogs] = useState(null);
  const [rescheduleLogsLoading, setRescheduleLogsLoading] = useState(false);

  const [extendModalRow, setExtendModalRow] = useState(null);
  const [extendNewDate, setExtendNewDate] = useState("");
  const [extendNote, setExtendNote] = useState("");
  const [extendBusy, setExtendBusy] = useState(false);
  const [extendError, setExtendError] = useState(null);

  const [planDocUrls, setPlanDocUrls] = useState([]);
  const [planDocSaving, setPlanDocSaving] = useState(false);

  const [refreshKey, setRefreshKey] = useState(0);

  // ── Record Execution capability check ────────────────────────────────
  // Gated by IM Master.can_record_execution — only some IMs may bulk-record
  // execution from this page; PM/admin always can.
  const [canRecordExecution, setCanRecordExecution] = useState(false);
  useEffect(() => {
    let cancelled = false;
    pmApi.getMyRecordExecutionCapability().then((res) => {
      if (!cancelled) setCanRecordExecution(!!res?.can_record_execution);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const loadPlans = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    if (!detailRow) { setRescheduleLogs(null); return; }
    let cancelled = false;
    setRescheduleLogsLoading(true);
    pmApi.getRescheduleLogs(detailRow.name).then((res) => {
      if (!cancelled) setRescheduleLogs(Array.isArray(res?.logs) ? res.logs : []);
    }).catch(() => {
      if (!cancelled) setRescheduleLogs([]);
    }).finally(() => {
      if (!cancelled) setRescheduleLogsLoading(false);
    });
    return () => { cancelled = true; };
  }, [detailRow]);

  useEffect(() => {
    setPlanDocUrls(parseFileList(detailRow?.plan_documents));
  }, [detailRow]);

  // ── Manage Table column filters ──────────────────────────────────────
  // Per-column filter boxes — each column's typed value is matched only
  // against that column's own value on the backend (see column_filters /
  // col_filter_map in list_im_rollout_plans), not blended into the top
  // search box's wide multi-column search.
  const [columnFilters, setColumnFilters] = useState({});
  useEffect(() => {
    const onFiltersChanged = (e) => {
      if (e.detail?.tableKey !== "im-planning-rollout") return;
      setColumnFilters(e.detail.filters || {});
    };
    document.addEventListener("tablepro:filters-changed", onFiltersChanged);
    return () => document.removeEventListener("tablepro:filters-changed", onFiltersChanged);
  }, []);
  // Excel column-filter dropdowns cascade off exactly the query the rows
  // were fetched with (recorded by the fetch effect below).
  // Published for the header summary — see usePublishedQuery.
  const [summaryQuery, publishSummaryQuery] = usePublishedQuery();
  const queryArgsRef = useRef({});
  useEffect(() => {
    const onRequestOptions = (e) => {
      if (e.detail?.tableKey !== "im-planning-rollout") return;
      e.detail.respond(pmApi.getColumnFilterOptions({
        source: "im_rollout_plans",
        col_key: e.detail.colKey,
        bucket: e.detail.bucket,
        search: e.detail.search,
        limit: e.detail.limit,
        portal_filters: queryArgsRef.current.portal,
        extra: { im: queryArgsRef.current.im, plan_status: queryArgsRef.current.status },
        exclude_column: e.detail.colKey,
      }));
    };
    document.addEventListener("tablepro:request-column-options", onRequestOptions);
    return () => document.removeEventListener("tablepro:request-column-options", onRequestOptions);
  }, []);
  // Either a legacy substring string or the Excel-style { values, blanks,
  // contains } object. String(obj) is "[object Object]" — always truthy.
  const activeColumnFilters = Object.fromEntries(
    Object.entries(columnFilters).filter(([, v]) => (
      v && typeof v === "object"
        ? (Array.isArray(v.values) && v.values.some((x) => String(x ?? "").trim()))
          || !!v.blanks || !!String(v.contains || "").trim()
        : String(v || "").trim()
    ))
  );
  const columnFiltersKey = JSON.stringify(activeColumnFilters);
  const columnFiltersDebounced = useDebounced(columnFiltersKey, 300);

  // Remembers what the LAST real server fetch actually returned, and under
  // what limit + filters. Shrinking the row limit (e.g. All -> 20, or
  // 2500 -> 20) never needs another round-trip — whatever's being asked for
  // is already sitting in memory from the larger fetch; just show fewer of
  // the same rows. Only growing the limit, or any OTHER filter actually
  // changing, hits the server. See PICTracker.jsx for the reference
  // implementation of this pattern.
  const lastFetchRef = useRef({ signature: null, limit: null, rows: [] });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const portal = {};
      if (searchDebounced.trim()) portal.search = searchDebounced.trim();
      const colFilters = JSON.parse(columnFiltersDebounced);
      if (Object.keys(colFilters).length) portal.column_filters = colFilters;
      if (visitFilter.length) portal.visit_type = visitFilter;
      if (projectFilter.length) portal.project_code = projectFilter;
      if (teamFilter.length) portal.team = teamFilter;
      if (duidFilter.length) portal.site_code = duidFilter;
      if (fromDate) portal.from_date = fromDate;
      if (toDate) portal.to_date = toDate;
      if (dummyFilter) portal.dummy_preset = "dummy";
      const portalArg = Object.keys(portal).length ? portal : undefined;
      const signature = JSON.stringify([imName, statusFilter, portal, refreshKey]);

      const prev = lastFetchRef.current;
      const alreadyHaveEnough = prev.signature === signature && (
        prev.limit === TABLE_ROW_LIMIT_ALL
        || (rowLimit !== TABLE_ROW_LIMIT_ALL && rowLimit <= prev.limit)
      );
      if (alreadyHaveEnough) {
        // Deliberately NOT calling setPlans() here — leave `plans` (and
        // whatever's already mounted in the DOM) exactly as-is. Slicing it
        // down would still force React to unmount however many rows that
        // drops. The render below just hides anything beyond the new limit
        // via CSS instead — see displayLimit.
        return;
      }

      setLoading(true);
      try {
        queryArgsRef.current = { portal: portalArg || {}, im: imName, status: statusFilter.length ? statusFilter : undefined };
        publishSummaryQuery(portalArg || {});
        const res = await pmApi.listIMRolloutPlans(imName, statusFilter.length ? statusFilter : undefined, rowLimit, portalArg);
        if (cancelled) return;
        const fetchedRows = Array.isArray(res) ? res : [];
        setPlans(fetchedRows);
        lastFetchRef.current = { signature, limit: rowLimit, rows: fetchedRows };
      } catch {
        if (!cancelled) setPlans([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    imName,
    statusFilter,
    rowLimit,
    searchDebounced,
    visitFilter,
    projectFilter,
    teamFilter,
    duidFilter,
    fromDate,
    toDate,
    refreshKey,
    columnFiltersDebounced,
    dummyFilter,
  ]);

  // Distinct master values so dropdowns show all options regardless of row limit.
  const { options: planOpts } = useFilterOptions("Rollout Plan", ["visit_type"]);
  const { options: dispOpts } = useFilterOptions("PO Dispatch", ["project_code", "site_code"]);
  const visitTypes = planOpts.visit_type || [];
  const projectOptions = dispOpts.project_code || [];
  const [teamEntries, setTeamEntries] = useState([]);
  useEffect(() => {
    pmApi.getTeamOptions().then((opts) => {
      if (Array.isArray(opts)) setTeamEntries(opts.map((o) => [o.id, o.label]));
    }).catch(() => {});
  }, []);
  const duidOptions = dispOpts.site_code || [];

  const filteredPlans = useMemo(() => {
    if (!dummyFilter) return plans;
    return plans.filter((p) => dummyFilter === "Dummy Only" ? !!p.is_dummy_po : !p.is_dummy_po);
  }, [plans, dummyFilter]);

  const visibleNames = useMemo(() => new Set(filteredPlans.map((p) => p.name)), [filteredPlans]);
  // See useProgressiveRows — mounts large row sets in chunks so the browser
  // doesn't show "Page Unresponsive" on tables with "All" rows loaded.
  const visiblePlans = useProgressiveRows(filteredPlans, { paused: loading });
  // How many of `visiblePlans` to actually show — anything beyond this is
  // hidden via CSS in the render below rather than removed from `plans`.
  // `plans` itself may hold MORE than this (see the skip-fetch logic above).
  const displayLimit = rowLimit === TABLE_ROW_LIMIT_ALL ? Infinity : rowLimit;
  const displayedCount = Math.min(filteredPlans.length, displayLimit);

  useEffect(() => {
    setSelected((prev) => {
      const next = new Set([...prev].filter((n) => visibleNames.has(n)));
      if (next.size === prev.size && [...next].every((n) => prev.has(n))) return prev;
      return next;
    });
  }, [visibleNames]);

  function toggleRow(name) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function toggleAll() {
    const dtpHidden = new Set(Array.from(document.querySelectorAll("tbody tr[data-tablepro-filtered]")).map((tr) => tr.dataset.docName).filter(Boolean));
    // Only rows within the current display limit — anything beyond it is
    // hidden via CSS (see displayLimit above), not a real filter, but
    // "select all" should still only ever act on what's actually shown.
    const visible = filteredPlans.slice(0, displayedCount).filter((p) => !dtpHidden.has(p.name));
    if (visible.length > 0 && visible.every((p) => selected.has(p.name))) {
      setSelected(new Set());
    } else {
      setSelected(new Set(visible.map((p) => p.name)));
    }
  }

  const hasFilters = !!(visitFilter.length || search || projectFilter.length || teamFilter.length || duidFilter.length || fromDate || toDate || dummyFilter);
  const totalAmt = plans.reduce((s, p) => s + (p.target_amount || 0), 0);
  const selectedAmt = plans
    .filter((p) => selected.has(p.name))
    .reduce((s, p) => s + (p.target_amount || 0), 0);

  const eligiblePlans = useMemo(() => selectedExecutablePlans(plans, selected), [plans, selected]);
  const executionSelectionOk = eligiblePlans.length > 0;
  const skippedCount = selected.size - eligiblePlans.length;

  const reschedulablePlans = useMemo(
    () => plans.filter((p) => selected.has(p.name) && ["Overdue", "Not Attended"].includes(p.plan_status)),
    [plans, selected]
  );
  const rescheduleDefaultReason = reschedulablePlans.some((p) => p.plan_status === "Not Attended")
    ? "TL Not Attended"
    : "Plan Overdue";

  const extendablePlans = useMemo(
    () => plans.filter((p) => selected.has(p.name) && !["Completed", "Cancelled"].includes(p.plan_status)),
    [plans, selected]
  );

  function recordExecutionTitle() {
    if (selected.size === 0) return "Select plans using the checkboxes";
    if (eligiblePlans.length === 0) return "None of the selected plans are in an executable status";
    if (skippedCount > 0) return `${eligiblePlans.length} of ${selected.size} plans are eligible — others will be skipped`;
    return undefined;
  }

  function canCancelPlan(p) {
    return ["Planned", "In Execution", "Planning with Issue", "Extended"].includes(p.plan_status || "")
      && (!p.cancel_request_status || p.cancel_request_status === "None" || p.cancel_request_status === "Rejected");
  }

  useEffect(() => {
    if (!mapForRow?.project_code) { setMapLines([]); setMapLineId(""); return; }
    let cancelled = false;
    setMapLinesLoading(true);
    setMapErr(null);
    pmApi.listPoIntakeLinesForIMMap(mapForRow.project_code).then((list) => {
      if (!cancelled) { setMapLines(Array.isArray(list) ? list : []); setMapLineId(""); }
    }).catch((e) => {
      if (!cancelled) setMapErr(e.message || "Failed to load PO lines");
    }).finally(() => { if (!cancelled) setMapLinesLoading(false); });
    return () => { cancelled = true; };
  }, [mapForRow]);

  async function submitMapDummy() {
    if (!mapForRow || !mapLineId) return;
    setMapBusy(true);
    setMapErr(null);
    try {
      const res = await pmApi.mapIMDummyPoToIntakeLine({
        dummy_po_dispatch: mapForRow.po_dispatch_name,
        po_intake_line: mapLineId,
      });
      setMapForRow(null);
      const pid = (res?.poid || res?.name || "").trim();
      const oid = (res?.original_dummy_poid || "").trim();
      setMapSuccessMsg(oid ? `Mapped. New POID: ${pid}. Original dummy POID: ${oid}.` : "Dummy PO mapped successfully.");
      loadPlans();
    } catch (e) {
      setMapErr(e.message || "Map failed");
    } finally {
      setMapBusy(false);
    }
  }

  function openCancelModal(p) {
    setCancelError(null);
    setCancelReason("");
    setCancelTarget(p);
  }

  async function handlePlanDocsChange(newUrls) {
    setPlanDocUrls(newUrls);
    if (!detailRow) return;
    setPlanDocSaving(true);
    try {
      await pmApi.saveRolloutPlanDocuments(detailRow.name, newUrls);
    } catch { /* non-fatal */ }
    finally { setPlanDocSaving(false); }
  }

  async function submitCancelPlan() {
    if (!cancelTarget) return;
    setCancelBusy(true);
    setCancelError(null);
    try {
      await pmApi.requestCancelPlan(cancelTarget.name, cancelReason || undefined);
      setCancelTarget(null);
      loadPlans();
      window.dispatchEvent(new Event("inet:approvals-changed"));
      window.dispatchEvent(new CustomEvent("inet:notifications-changed"));
    } catch (e) {
      setCancelError(e?.message || "Failed to request cancellation");
    } finally {
      setCancelBusy(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Rollout Execution</h1>
        </div>
        <PageSummary source="im_rollout_plans" filters={summaryQuery}
          extra={{ im: imName, plan_status: statusFilter.length ? statusFilter : undefined }} />
        <div className="page-actions">
          <ExportExcelButton filename="im-planning" rows={filteredPlans.slice(0, displayedCount)} />
          <button type="button" className="btn-secondary" onClick={() => loadPlans()} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {mapSuccessMsg && (
        <div style={{ background: "#dcfce7", border: "1px solid #86efac", borderRadius: 8, padding: "10px 16px", margin: "0 0 12px", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.84rem", color: "#166534" }}>
          <span>{mapSuccessMsg}</span>
          <button type="button" onClick={() => setMapSuccessMsg(null)} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "#166534", lineHeight: 1, marginLeft: 12 }}>&times;</button>
        </div>
      )}
      {rescheduleSuccessMsg && (
        <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, padding: "10px 16px", margin: "0 0 12px", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.84rem", color: "#1d4ed8" }}>
          <span>{rescheduleSuccessMsg}</span>
          <button type="button" onClick={() => setRescheduleSuccessMsg(null)} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "#1d4ed8", lineHeight: 1, marginLeft: 12 }}>&times;</button>
        </div>
      )}

      <div className="toolbar">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input
            type="search"
            placeholder="Search Plan ID, POID, DUID, PO, Team, Center area, Region…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onPaste={(e) => handleSearchPaste(e, setSearch)}
            style={{
              padding: "7px 14px", borderRadius: 8,
              border: "1px solid #e2e8f0", fontSize: "0.84rem", minWidth: 260,
            }}
          />
          <SearchableSelect multi value={statusFilter} onChange={setStatusFilter} options={["Planned", "Planning with Issue", "In Execution", "Overdue", "Not Attended", "Extended", "Completed", "Cancelled"]} placeholder="All Statuses" minWidth={150} />
          <SearchableSelect multi value={visitFilter} onChange={setVisitFilter} options={visitTypes} placeholder="All Visit Types" minWidth={160} />
          <SearchableSelect multi value={projectFilter} onChange={setProjectFilter} options={projectOptions} placeholder="All Projects" minWidth={170} />
          <SearchableSelect multi value={teamFilter} onChange={setTeamFilter} options={teamEntries.map(([id, label]) => ({ id, label }))} placeholder="All Teams" minWidth={150} />
          <SearchableSelect multi value={duidFilter} onChange={setDuidFilter} options={duidOptions} placeholder="All DUIDs" minWidth={150} />
          <button
            type="button"
            style={{
              fontSize: "0.78rem", padding: "5px 12px", borderRadius: 8, cursor: "pointer",
              border: dummyFilter ? "1px solid #f59e0b" : "1px solid #e2e8f0",
              background: dummyFilter ? "#fffbeb" : "#fff",
              color: dummyFilter ? "#92400e" : "#64748b",
            }}
            onClick={() => setDummyFilter(dummyFilter ? "" : "Dummy Only")}
          >
            {dummyFilter ? "Dummy PO ×" : "Dummy PO"}
          </button>
          <DateRangePicker value={{ from: fromDate, to: toDate }} onChange={({ from, to }) => { setFromDate(from); setToDate(to); }} />
          {(hasFilters) && (
            <button
              className="btn-secondary"
              style={{ fontSize: "0.78rem", padding: "5px 12px" }}
              onClick={() => { setSearch(""); setVisitFilter([]); setProjectFilter([]); setTeamFilter([]); setDuidFilter([]); setDummyFilter(""); setFromDate(""); setToDate(""); }}
            >
              Clear
            </button>
          )}
        </div>
        <div className="toolbar-actions">
          {selected.size > 0 && (
            <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
              {selected.size} selected · SAR {fmt.format(selectedAmt)}
            </span>
          )}
          {reschedulablePlans.length > 0 && (
            <button
              type="button"
              style={{ fontSize: "0.84rem", padding: "6px 14px", background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}
              onClick={() => setRescheduleModalOpen(true)}
            >
              Reschedule ({reschedulablePlans.length})
            </button>
          )}
          {extendablePlans.length > 0 && (
            <button
              type="button"
              style={{ fontSize: "0.84rem", padding: "6px 14px", background: "#faf5ff", color: "#6d28d9", border: "1px solid #ddd6fe", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}
              onClick={() => { setExtendModalRow({ _plans: extendablePlans, poid: `${extendablePlans.length} plan(s)`, plan_end_date: extendablePlans[0]?.plan_end_date || "" }); setExtendNewDate(extendablePlans[0]?.plan_end_date || ""); setExtendNote(""); setExtendError(null); }}
            >
              Extend End Date ({extendablePlans.length})
            </button>
          )}
          {canRecordExecution && (
            <button
              type="button"
              className="btn-primary"
              disabled={!executionSelectionOk}
              title={recordExecutionTitle()}
              onClick={() => setExecutionModalOpen(true)}
            >
              Record execution ({eligiblePlans.length}{skippedCount > 0 ? ` / ${selected.size}` : ""})
            </button>
          )}
        </div>
      </div>

      <div className="page-content">
        <DataTableWrapper loading={loading && plans.length > 0}>
          <>
            <table className="data-table" data-excel-filter-all="1" data-table-key="im-planning-rollout">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={displayedCount > 0 && filteredPlans.slice(0, displayedCount).every((p) => selected.has(p.name))}
                      onChange={toggleAll}
                    />
                  </th>
                  <th>Plan ID</th>
                  <th>POID</th>
                  <th>Dummy POID</th>
                  <th>Description</th>
                  <th>Activity Type</th>
                  <th>DUID</th>
                  <th>Domain</th>
                  <th>Huawei IM</th>
                  <th>Center area</th>
                  <th>Region</th>
                  <th>PO</th>
                  <th>Team</th>
                  <th>IM</th>
                  <th>Plan Date</th>
                  <th style={{ whiteSpace: "nowrap" }}>Access Time</th>
                  <th style={{ whiteSpace: "nowrap" }} data-excel-filter="0">Access</th>
                  <th>End Date</th>
                  <th>Visit</th>
                  <th style={{ textAlign: "right" }} title="Which visit this plan is (1, 2, 3…)">Visit No</th>
                  <th>Status</th>
                  <th style={{ textAlign: "right" }}>Target (SAR)</th>
                  <th title="Remark set by PM">General</th>
                  <th title="Remark set by IM">Manager</th>
                  <th title="Remark set by Field Team Lead">Team Lead</th>
                  <th>Cancel</th>
                  <th style={{ minWidth: 175, width: 175, whiteSpace: "nowrap" }} data-default-width="175">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visiblePlans.map((p, idx) => (
                  <tr
                    key={p.name}
                    data-doc-name={p.name}
                    data-modified={p.modified}
                    className={selected.has(p.name) ? "row-selected" : ""}
                    onClick={() => toggleRow(p.name)}
                    style={idx >= displayLimit ? { display: "none" } : { cursor: "pointer", ...(p.is_dummy_po ? { background: "#fffbeb" } : Number(p.is_internal_work || 0) ? { background: "#f0fdfa" } : {}) }}
                  >
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(p.name)}
                        onChange={() => toggleRow(p.name)}
                      />
                    </td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{p.name}</td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{p.poid || p.po_dispatch || "—"}</td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.72rem", maxWidth: 140 }} title={(p.original_dummy_poid || "").trim() ? `Dummy POID: ${p.original_dummy_poid}` : ""}>
                      {Number(p.is_internal_work || 0) ? (
                        <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, fontWeight: 700, fontFamily: "inherit", background: "#ccfbf1", color: "#0f766e", border: "1px solid #99f6e4" }}
                          title={p.internal_work_type ? `Internal work — ${p.internal_work_type}${p.internal_domain ? ` (${p.internal_domain})` : ""}` : "Internal work"}>
                          Internal
                        </span>
                      ) : ((p.original_dummy_poid || "").trim() || "—")}
                    </td>
                    <td style={{ fontSize: "0.82rem", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.item_description || ""}>{p.item_description || "—"}</td>
                    <td style={{ fontSize: "0.82rem" }}>{p.activity_type || "—"}</td>
                    <td>{p.site_code || "—"}</td>
                    <td>{p.project_domain || p.internal_domain || "—"}</td>
                    <td>{p.huawei_im || "—"}</td>
                    <td style={{ fontSize: "0.82rem", maxWidth: 120 }} title={p.center_area || ""}>
                      {p.center_area || "—"}
                    </td>
                    <td style={{ fontSize: "0.82rem" }}>{p.region_type || "—"}</td>
                    <td>{p.po_no || "—"}</td>
                    <td style={{ fontSize: "0.82rem" }}>{p.team_name || p.team || "—"}</td>
                    <td style={{ fontSize: "0.82rem" }}>{p.im_full_name || p.dispatch_im || "—"}</td>
                    <td>{p.plan_date}</td>
                    <td style={{ fontSize: "0.78rem", whiteSpace: "nowrap" }}>
                      {p.access_time || p.access_period ? `${p.access_time ? p.access_time.slice(0, 5) : "—"}${p.access_period ? ` · ${p.access_period}` : ""}` : "—"}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {(() => {
                        const badge = accessTimeBadge(p.access_time, p.access_period, p.timer_start_ms, p.tl_status, p.plan_date);
                        if (!badge) return <span style={{ color: "#94a3b8" }}>—</span>;
                        return (
                          <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: "0.75rem", fontWeight: 700, background: badge.bg, color: badge.color }}>
                            {badge.label}
                          </span>
                        );
                      })()}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {p.plan_end_date || "—"}
                    </td>
                    <td>{p.visit_type}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{p.visit_number != null ? p.visit_number : "—"}</td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "nowrap" }}>
                        <span className={`status-badge ${(p.plan_status || "").toLowerCase().replace(/\s/g, "-")}`}>
                          <span className="status-dot" />
                          {p.plan_status}
                        </span>
                        {p.reschedule_count > 0 && (
                          <span title={`Rescheduled ${p.reschedule_count} time${p.reschedule_count !== 1 ? "s" : ""}`} style={{ fontSize: "0.66rem", fontWeight: 700, color: "#7c3aed", background: "#ede9fe", border: "1px solid #c4b5fd", borderRadius: 999, padding: "1px 6px", whiteSpace: "nowrap" }}>
                            ↺ {p.reschedule_count}
                          </span>
                        )}
                      </div>
                    </td>
                    <td style={{ textAlign: "right" }}>{fmt.format(p.target_amount || 0)}</td>
                    <td onClick={(e) => e.stopPropagation()}><RemarksCell value={p.general_remark} tone="general" poDispatch={p.po_dispatch || p.poid} poid={p.poid || p.po_dispatch} onSaved={(v) => { p.general_remark = v; }} /></td>
                    <td onClick={(e) => e.stopPropagation()}><RemarksCell value={p.manager_remark} tone="manager" poDispatch={p.po_dispatch || p.poid} poid={p.poid || p.po_dispatch} onSaved={(v) => { p.manager_remark = v; }} /></td>
                    <td onClick={(e) => e.stopPropagation()}><RemarksCell value={p.team_lead_remark} tone="team_lead" poDispatch={p.po_dispatch || p.poid} poid={p.poid || p.po_dispatch} onSaved={(v) => { p.team_lead_remark = v; }} /></td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {canCancelPlan(p) ? (
                        <button
                          type="button"
                          className="btn-secondary"
                          style={{ fontSize: "0.72rem", padding: "4px 10px", color: "#b91c1c" }}
                          onClick={() => openCancelModal(p)}
                        >Cancel</button>
                      ) : (p.cancel_request_status && p.cancel_request_status !== "None") ? (
                        <span style={{
                          display: "inline-block", padding: "3px 8px", borderRadius: 999,
                          fontSize: "0.66rem", fontWeight: 700,
                          background: p.cancel_request_status === "Approved" ? "#ecfdf5" : p.cancel_request_status === "Rejected" ? "#fef2f2" : "#eff6ff",
                          color: p.cancel_request_status === "Approved" ? "#047857" : p.cancel_request_status === "Rejected" ? "#b91c1c" : "#1d4ed8",
                          border: `1px solid ${p.cancel_request_status === "Approved" ? "#a7f3d0" : p.cancel_request_status === "Rejected" ? "#fecaca" : "#bfdbfe"}`,
                          whiteSpace: "nowrap",
                        }}>{p.cancel_request_status}</span>
                      ) : (
                        <span style={{ color: "#cbd5e1", fontSize: "0.72rem" }}>—</span>
                      )}
                    </td>
                    <td onClick={(e) => e.stopPropagation()} style={{ minWidth: 200, width: 200, whiteSpace: "nowrap" }}>
                      <div style={{ display: "flex", gap: 4, flexWrap: "nowrap" }}>
                        <button
                          type="button"
                          className="btn-secondary"
                          style={{ fontSize: "0.72rem", padding: "4px 10px" }}
                          onClick={() => {
                            setRescheduleLogs(null);
                            setDetailRow(p);
                          }}
                        >
                          View
                        </button>
                        {p.is_dummy_po ? (
                          <button
                            type="button"
                            style={{ fontSize: "0.72rem", padding: "4px 10px", whiteSpace: "nowrap", background: "#fffbeb", color: "#92400e", border: "1px solid #f59e0b", borderRadius: 8, cursor: "pointer" }}
                            onClick={() => { setMapErr(null); setMapForRow({ po_dispatch_name: p.po_dispatch, project_code: p.project_code, poid: p.poid || p.po_dispatch, site_code: p.site_code }); }}
                          >
                            Map PO
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              {filteredPlans.length > 0 && (
                <tfoot>
                  <tr style={{ borderTop: "2px solid #e2e8f0", background: "#f8fafc" }}>
                    <td style={{ padding: "8px 16px", fontSize: "0.75rem", fontWeight: 700, color: "#64748b", whiteSpace: "nowrap" }}>
                      {displayedCount} plan{displayedCount !== 1 ? "s" : ""}
                      {selected.size > 0 && (
                        <span style={{ marginLeft: 12, color: "#6366f1", fontWeight: 600 }}>
                          {selected.size} selected
                        </span>
                      )}
                    </td>
                    <td /><td /><td /><td /><td /><td /><td /><td /><td /><td /><td /><td /><td /><td /><td /><td /><td /><td /><td /><td />
                    <td style={{ textAlign: "right", fontWeight: 700, padding: "8px 16px", color: "#0f172a" }}>
                      {fmt.format(totalAmt)}
                    </td>
                    <td /><td /><td /><td /><td />
                  </tr>
                </tfoot>
              )}
            </table>
            {loading && plans.length === 0 ? (
              <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Loading...</div>
            ) : !loading && filteredPlans.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">📅</div>
                <h3>{hasFilters ? "No results match your filters" : "No rollout plans yet"}</h3>
                <p>
                  {hasFilters
                    ? "Try adjusting your search or filter criteria."
                    : "No plans found for your current data."}
                </p>
              </div>
            ) : null}
          </>
        </DataTableWrapper>
        <TableRowsLimitFooter
          placement="tableCard"
          loadedCount={displayedCount}
          filteredCount={displayedCount}
          filterActive={!!hasFilters}
        />
      </div>
      <IMPlanningExecutionModal
        open={executionModalOpen}
        onClose={() => setExecutionModalOpen(false)}
        selectedPlans={executionSelectionOk ? eligiblePlans : []}
        onSubmitted={async () => {
          await loadPlans();
        }}
      />

      {cancelTarget && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={() => !cancelBusy && setCancelTarget(null)}
        >
          <div
            style={{ background: "#fff", borderRadius: 12, padding: 24, width: "min(440px, 96vw)", boxShadow: "0 20px 60px rgba(0,0,0,0.22)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 14px", fontSize: "1.05rem" }}>Cancel Rollout Plan</h3>
            {cancelError && (
              <div className="notice error" style={{ marginBottom: 12 }}>
                {cancelError}
              </div>
            )}
            <p style={{ fontSize: "0.84rem", color: "#475569", margin: "0 0 12px" }}>
              <strong>{cancelTarget.poid || cancelTarget.po_dispatch || cancelTarget.name}</strong>
              {" — "}{cancelTarget.plan_status || "—"}
              <br />
              <span style={{ fontSize: "0.78rem", color: "#94a3b8" }}>This will be sent to a PM for approval. If approved, the dispatch reverts to Dispatched.</span>
            </p>
            <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, marginBottom: 6, color: "#475569" }}>
              Reason
            </label>
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              rows={3}
              placeholder="e.g. site not ready, duplicate plan, wrong team…"
              style={{
                width: "100%", padding: 10, borderRadius: 8,
                border: "1px solid #e2e8f0", fontSize: "0.84rem",
                boxSizing: "border-box", resize: "vertical",
                fontFamily: "inherit",
              }}
            />
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
              <button type="button" className="btn-secondary" disabled={cancelBusy} onClick={() => setCancelTarget(null)}>Back</button>
              <button type="button" className="btn-primary" disabled={cancelBusy} onClick={submitCancelPlan} style={{ background: "#b91c1c" }}>
                {cancelBusy ? "Submitting…" : "Request cancellation"}
              </button>
            </div>
          </div>
        </div>
      )}

      {mapForRow && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={() => !mapBusy && setMapForRow(null)}
        >
          <div
            style={{ background: "#fff", borderRadius: 12, padding: 24, width: "min(680px, 96vw)", boxShadow: "0 20px 60px rgba(0,0,0,0.22)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 6px", fontSize: "1.05rem" }}>Map Dummy PO</h3>
            <p style={{ fontSize: "0.82rem", color: "#64748b", margin: "0 0 16px" }}>
              POID: <strong>{mapForRow.poid}</strong>
            </p>
            {mapErr && <div className="notice error" style={{ marginBottom: 12 }}>{mapErr}</div>}
            <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, marginBottom: 6, color: "#475569" }}>
              Select Real PO Intake Line
            </label>
            {mapLinesLoading ? (
              <p style={{ fontSize: "0.82rem", color: "#94a3b8" }}>Loading…</p>
            ) : (() => {
              const duidLines = mapForRow?.site_code ? mapLines.filter((l) => l.site_code === mapForRow.site_code) : mapLines;
              const optionLines = duidLines.length > 0 ? duidLines : mapLines;
              const fallback = mapForRow?.site_code && duidLines.length === 0 && mapLines.length > 0;
              return (
                <>
                  {mapForRow?.site_code && (
                    <div style={{ fontSize: "0.75rem", marginBottom: 6, color: fallback ? "#b45309" : "#047857" }}>
                      {fallback
                        ? `No intake lines for DUID ${mapForRow.site_code} — showing all lines`
                        : `Filtered by DUID: ${mapForRow.site_code} (${duidLines.length} line${duidLines.length !== 1 ? "s" : ""})`}
                    </div>
                  )}
                  <SearchableSelect
                    value={mapLineId}
                    onChange={(id) => setMapLineId(id)}
                    options={optionLines.map((l) => ({
                      id: l.name,
                      label: [
                        l.site_code || null,
                        l.item_description || l.item_code || null,
                        l.existing_dispatch ? `dispatched (${l.existing_dispatch_status || "?"})` : null,
                      ].filter(Boolean).join(" · "),
                    }))}
                    wrap
                    placeholder={optionLines.length ? "— search by DUID or description —" : "No open lines for this project"}
                    style={{ display: "block", width: "100%" }}
                    panelStyle={{ zIndex: 10001 }}
                  />
                </>
              );
            })()}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
              <button type="button" className="btn-secondary" disabled={mapBusy} onClick={() => setMapForRow(null)}>Cancel</button>
              <button type="button" className="btn-primary" disabled={mapBusy || !mapLineId} onClick={submitMapDummy}>
                {mapBusy ? "Mapping…" : "Map PO"}
              </button>
            </div>
          </div>
        </div>
      )}

      {detailRow && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={() => setDetailRow(null)}>
          <div style={{
            background: "#fff", borderRadius: 12,
            width: "min(840px, 96vw)",
            maxHeight: "calc(100dvh - 32px)",
            display: "flex", flexDirection: "column", overflow: "hidden",
            boxShadow: "0 24px 48px -16px rgba(0,0,0,0.3)",
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px", borderBottom: "1px solid #e2e8f0", flexShrink: 0 }}>
              <h3 style={{ margin: 0, fontSize: "1rem" }}>Plan Details</h3>
              <button type="button" onClick={() => setDetailRow(null)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#94a3b8", lineHeight: 1 }}>&times;</button>
            </div>
            <div style={{ padding: 20, overflowY: "auto", flex: "1 1 auto", minHeight: 0 }}>
              <RecordDetailView
                row={detailRow}
                pills={[
                  { label: "POID", value: detailRow.poid || detailRow.po_dispatch || "—", tone: "blue" },
                  { label: "Team", value: detailRow.team_name || detailRow.team || "—", tone: "amber" },
                  { label: "DUID", value: detailRow.site_code || "—", tone: "green" },
                  detailRow.plan_status ? { label: "Status", value: detailRow.plan_status, tone: /complete/i.test(detailRow.plan_status) ? "green" : /cancel/i.test(detailRow.plan_status) ? "rose" : /issue/i.test(detailRow.plan_status) ? "amber" : "slate" } : null,
                ].filter(Boolean)}
              />
              <IMNoteCallout note={detailRow.manager_remark} />
              <PlanTeamsBreakdown rolloutPlan={detailRow.name} />
              <DispatchVisitHistory
                poDispatch={detailRow.po_dispatch}
                rolloutPlan={detailRow.name}
                currentPlanName={detailRow.name}
              />
              <PoidMaterialsDispatched poDispatch={detailRow.po_dispatch} />
              <AttachmentsSection
                urls={planDocUrls}
                onChange={handlePlanDocsChange}
                title={planDocSaving ? "Planning Documents (saving…)" : "Planning Documents"}
                noCamera
              />
              <div style={{ marginTop: 20 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "#334155", textTransform: "uppercase", letterSpacing: "0.05em" }}>Reschedule History</span>
                  {detailRow.reschedule_count > 0 && (
                    <span style={{ fontSize: "0.66rem", fontWeight: 700, color: "#7c3aed", background: "#ede9fe", border: "1px solid #c4b5fd", borderRadius: 999, padding: "1px 7px" }}>
                      ↺ {detailRow.reschedule_count}
                    </span>
                  )}
                </div>
                {rescheduleLogsLoading ? (
                  <div style={{ color: "#94a3b8", fontSize: "0.82rem" }}>Loading…</div>
                ) : !rescheduleLogs || rescheduleLogs.length === 0 ? (
                  <div style={{ color: "#94a3b8", fontSize: "0.82rem" }}>No reschedules recorded.</div>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid #e2e8f0" }}>
                          <th style={{ textAlign: "left", padding: "4px 8px", color: "#64748b", fontWeight: 600 }}>From</th>
                          <th style={{ textAlign: "left", padding: "4px 8px", color: "#64748b", fontWeight: 600 }}>To</th>
                          <th style={{ textAlign: "left", padding: "4px 8px", color: "#64748b", fontWeight: 600 }}>Reason</th>
                          <th style={{ textAlign: "left", padding: "4px 8px", color: "#64748b", fontWeight: 600 }}>TL Status</th>
                          <th style={{ textAlign: "left", padding: "4px 8px", color: "#64748b", fontWeight: 600 }}>IM Note</th>
                          <th style={{ textAlign: "left", padding: "4px 8px", color: "#64748b", fontWeight: 600 }}>By / At</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rescheduleLogs.map((log, i) => (
                          <tr key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
                            <td style={{ padding: "5px 8px", color: "#64748b" }}>{log.original_date || "—"}</td>
                            <td style={{ padding: "5px 8px", fontWeight: 600, color: "#0f172a" }}>{log.new_date || "—"}</td>
                            <td style={{ padding: "5px 8px" }}>{log.reason || "—"}</td>
                            <td style={{ padding: "5px 8px", color: "#64748b" }}>{log.tl_status_at_time || "—"}</td>
                            <td style={{ padding: "5px 8px", color: "#475569", maxWidth: 160, wordBreak: "break-word" }}>{log.im_note || "—"}</td>
                            <td style={{ padding: "5px 8px", color: "#64748b", whiteSpace: "nowrap" }}>
                              {(log.rescheduled_by || "").split("@")[0] || "—"}
                              {log.rescheduled_at ? <><br /><span style={{ fontSize: "0.7rem" }}>{log.rescheduled_at.split(" ")[0]}</span></> : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {rescheduleModalOpen && reschedulablePlans.length > 0 && (
        <RescheduleModal
          rolloutPlans={reschedulablePlans.map((p) => p.name)}
          defaultReason={rescheduleDefaultReason}
          onClose={() => setRescheduleModalOpen(false)}
          onSuccess={(results) => {
            setRescheduleModalOpen(false);
            const ok = results.filter((r) => r.ok).length;
            const fail = results.filter((r) => !r.ok).length;
            setRescheduleSuccessMsg(
              fail
                ? `${ok} rescheduled, ${fail} failed.`
                : `${ok} plan${ok !== 1 ? "s" : ""} rescheduled.`
            );
            loadPlans();
          }}
        />
      )}

      {/* ── Extend End Date modal ─────────────────────────────── */}
      {extendModalRow && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1200, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={(e) => { if (e.target === e.currentTarget) { setExtendModalRow(null); setExtendError(null); } }}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 28, width: 380, maxWidth: "92vw", boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}>
            <div style={{ fontWeight: 700, fontSize: "1rem", marginBottom: 4 }}>Extend End Date</div>
            <div style={{ fontSize: "0.78rem", color: "#64748b", marginBottom: 20 }}>
              {extendModalRow.poid || extendModalRow.name} · current end: <strong>{extendModalRow.plan_end_date || extendModalRow.plan_date}</strong>
            </div>
            <label style={{ fontSize: "0.82rem", fontWeight: 600, display: "block", marginBottom: 4 }}>New End Date *</label>
            <input
              type="date"
              value={extendNewDate}
              min={extendModalRow.plan_end_date || extendModalRow.plan_date}
              onChange={(e) => setExtendNewDate(e.target.value)}
              style={{ width: "100%", padding: "8px 10px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: "0.88rem", marginBottom: 14, boxSizing: "border-box" }}
            />
            <label style={{ fontSize: "0.82rem", fontWeight: 600, display: "block", marginBottom: 4 }}>Note (optional)</label>
            <textarea
              value={extendNote}
              onChange={(e) => setExtendNote(e.target.value)}
              placeholder="Reason for extension…"
              rows={2}
              style={{ width: "100%", padding: "8px 10px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: "0.84rem", resize: "vertical", boxSizing: "border-box", marginBottom: 16 }}
            />
            {extendError && <div style={{ color: "#b91c1c", fontSize: "0.8rem", marginBottom: 10 }}>{extendError}</div>}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button type="button" className="btn-secondary" onClick={() => { setExtendModalRow(null); setExtendError(null); }}>Cancel</button>
              <button
                type="button"
                className="btn-primary"
                disabled={extendBusy || !extendNewDate}
                onClick={async () => {
                  if (!extendNewDate) { setExtendError("Please pick a new end date."); return; }
                  setExtendBusy(true); setExtendError(null);
                  try {
                    const plans = extendModalRow._plans || [extendModalRow];
                    for (const p of plans) {
                      await pmApi.extendPlanEndDate(p.name, extendNewDate, extendNote);
                    }
                    setExtendModalRow(null); setExtendNote(""); setExtendNewDate("");
                    setRescheduleSuccessMsg(`End date extended to ${extendNewDate} for ${plans.length} plan${plans.length !== 1 ? "s" : ""}.`);
                    loadPlans();
                  } catch (err) {
                    setExtendError(err.message || "Extension failed.");
                  } finally {
                    setExtendBusy(false);
                  }
                }}
              >{extendBusy ? "Saving…" : "Confirm Extension"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
