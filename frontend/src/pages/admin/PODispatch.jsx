import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import DataTableWrapper from "../../components/DataTableWrapper";
import { pmApi } from "../../services/api";
import { useTableRowLimit, TABLE_ROW_LIMIT_ALL, TABLE_ROW_LIMIT_DEFAULT } from "../../context/TableRowLimitContext";
import TableRowsLimitFooter from "../../components/TableRowsLimitFooter";
import { useDebounced } from "../../hooks/useDebounced";
import PageSummary from "../../components/PageSummary";
import useFilterOptions from "../../hooks/useFilterOptions";
import SearchableSelect from "../../components/SearchableSelect";
import RecordDetailView, { DetailHero, DetailStatTile } from "../../components/RecordDetailView";
import DateRangePicker from "../../components/DateRangePicker";
import ExportExcelButton from "../../components/ExportExcelButton";
import { handleSearchPaste } from "../../utils/searchPaste";
import { useProgressiveRows } from "../../hooks/useProgressiveRows";
import { PicStatusBadge } from "../pic/picShared";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });
const fmtAmt = new Intl.NumberFormat("en", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const HIDDEN_DETAIL_FIELDS = new Set(["owner", "creation", "modified", "modified_by", "docstatus", "idx"]);

function todayMonth() {
  return new Date().toISOString().slice(0, 7);
}

function DispatchModeBadge({ mode }) {
  if (!mode) return null;
  const isAuto = mode === "Auto";
  return (
    <span style={{
      display: "inline-block", padding: "2px 10px", borderRadius: 12,
      fontSize: "0.72rem", fontWeight: 600, letterSpacing: "0.02em",
      background: isAuto ? "linear-gradient(90deg,#6366f1,#8b5cf6)" : "linear-gradient(90deg,#0ea5e9,#06b6d4)",
      color: "#fff",
    }}>
      {isAuto ? "Auto" : "Manual"}
    </span>
  );
}

function statusTone(value) {
  const s = String(value || "").toLowerCase();
  // Exact matches for PO Dispatch's own dispatch_status range (Completed ->
  // Closed) ahead of the generic substring buckets below — these are
  // dispatch_status-specific values, not a general "status" concept, so they
  // need their own distinct colors rather than falling into "complete"/
  // "progress"'s broad grouping.
  if (s === "submitted") return { bg: "#eef2ff", fg: "#4338ca" };
  if (s === "partially closed") return { bg: "#ecfeff", fg: "#0e7490" };
  if (s === "closed") return { bg: "#f1f5f9", fg: "#475569" };
  if (s.includes("complete") || s.includes("approved") || s.includes("dispatched")) return { bg: "#ecfdf5", fg: "#047857" };
  if (s.includes("cancel") || s.includes("reject") || s.includes("fail")) return { bg: "#fef2f2", fg: "#b91c1c" };
  if (s.includes("progress") || s.includes("planned") || s.includes("auto")) return { bg: "#eff6ff", fg: "#1d4ed8" };
  // "partially submitted" also lands here (amber) — consistent with this
  // function's own "not yet resolved" bucket, same as its existing default.
  return { bg: "#fffbeb", fg: "#b45309" };
}

// Dedicated per-status colors for the "Status" column (po_line_status) — one
// distinct color per value, unlike statusTone() above which deliberately
// groups several unrelated statuses/modes into the same "success" bucket.
function poLineStatusTone(value) {
  const s = String(value || "").toLowerCase();
  if (s === "new") return { bg: "#fffbeb", fg: "#b45309" };
  if (s === "dispatched") return { bg: "#eff6ff", fg: "#1d4ed8" };
  if (s === "completed") return { bg: "#ecfdf5", fg: "#047857" };
  if (s === "closed") return { bg: "#f1f5f9", fg: "#475569" };
  if (s === "cancelled") return { bg: "#fef2f2", fg: "#b91c1c" };
  return { bg: "#f1f5f9", fg: "#475569" };
}

// Colors for the "Plan Status" column (Rollout Plan.plan_status) — same
// mapping the old collapsed "Current Stage" column used for these same
// values, just no longer merged together with PIC/Work Done into one string.
function planStatusTone(value) {
  const sl = String(value || "").toLowerCase();
  if (sl === "in execution" || sl === "planned") return { bg: "#eff6ff", fg: "#1d4ed8" };
  if (sl === "planning with issue" || sl === "overdue" || sl === "not attended" || sl === "extended") return { bg: "#fffbeb", fg: "#b45309" };
  if (sl === "completed") return { bg: "#ecfdf5", fg: "#047857" };
  if (sl === "cancelled") return { bg: "#fef2f2", fg: "#b91c1c" };
  return { bg: "#f1f5f9", fg: "#475569" };
}

// Colors for the "Work Type" column (Work Done.source).
function workTypeTone(value) {
  const s = String(value || "").toLowerCase();
  if (s === "direct close") return { bg: "#f5f3ff", fg: "#6d28d9" };
  if (s === "backend") return { bg: "#faf5ff", fg: "#7c3aed" };
  if (s === "rollout execution") return { bg: "#eff6ff", fg: "#1d4ed8" };
  return { bg: "#f1f5f9", fg: "#94a3b8" };
}

// Colors for the "Subcon Status" column (PO Dispatch.subcon_status).
function subconStatusTone(value) {
  const s = String(value || "").toLowerCase();
  if (s === "work done") return { bg: "#ecfdf5", fg: "#047857" };
  if (s === "pending") return { bg: "#fffbeb", fg: "#b45309" };
  return { bg: "#f1f5f9", fg: "#94a3b8" };
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

/* ── Modal overlay helper ────────────────────────────────────────── */
function Modal({ open, onClose, title, children, width = 480 }) {
  if (!open) return null;
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: "rgba(15,23,42,0.5)", display: "flex",
      alignItems: "center", justifyContent: "center",
    }} onClick={onClose}>
      <div style={{
        background: "#fff", borderRadius: 14, padding: "28px 32px",
        width, maxWidth: "95vw", boxShadow: "0 20px 60px rgba(0,0,0,0.22)",
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700 }}>{title}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8", lineHeight: 1 }}>&times;</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const TABS = [
  { key: "New",        label: "Pending Dispatch" },
  { key: "Dispatched", label: "Dispatched" },
  { key: "all",        label: "All Lines" },
  { key: "integrity_completed_no_evidence", label: "Completed, No Evidence" },
  { key: "integrity_closed_unresolved",     label: "Closed, Unresolved Milestone" },
];

// Data Integrity tabs — PO Dispatch status mismatches that need a PM
// decision. Each has its own backend category + one or more fix actions;
// see list_data_integrity_issues / fix_data_integrity_* in command_center.py.
const INTEGRITY_TABS = {
  integrity_completed_no_evidence: {
    category: "completed_no_evidence",
    blurb: "PO Status is \"Completed\" but neither milestone has progressed and there's no Work Done record behind it at all — no evidence the work actually happened.",
    actions: [
      {
        label: "Reopen as Pending",
        fixFn: "fixDataIntegrityCompletedNoEvidence",
        note: "Reverts PO Status to Pending (or Dispatched if an IM is already assigned) so it re-enters the normal dispatch workflow.",
      },
    ],
  },
  integrity_closed_unresolved: {
    category: "closed_unresolved_milestone",
    blurb: "PO Status is \"Closed\" but MS1 or MS2 has a nonzero amount that was never actually invoiced or cancelled.",
    actions: [
      {
        label: "Reopen to Completed",
        fixFn: "fixDataIntegrityReopenClosed",
        note: "Reverts PO Status from Closed back to Completed so the line falls back into PIC Tracker's normal workflow — PIC decides the real invoicing outcome there; PM doesn't set PIC status directly.",
        // Only useful when the stuck milestone already has a real PIC status
        // (something to send back into PIC Tracker for). A milestone with no
        // status at all is already sitting on PIC's own Pending page
        // regardless of PO Status, so there's nothing for PM to do here —
        // PIC already has full visibility and the normal tools to resolve it.
        visibleWhen: (selectedRows) => selectedRows.some((r) =>
          (r.ms1_stuck && r.pic_status) || (r.ms2_stuck && r.pic_status_ms2)
        ),
      },
    ],
  },
};

function IntegrityTable({ rows, loading, selected, toggleRow, toggleAll, tabKey, showMs, fmt }) {
  const colCount = showMs ? 10 : 9;
  return (
    <table className="data-table" data-excel-filter-all="1" data-table-key={`admin-po-dispatch-${tabKey}`}>
      <thead>
        <tr>
          <th style={{ width: 36 }}>
            <input type="checkbox" checked={rows.length > 0 && selected.size === rows.length} onChange={toggleAll} />
          </th>
          <th>POID</th>
          <th>PO No</th>
          <th>Project</th>
          <th>DUID</th>
          <th>PO Status</th>
          <th>PIC Status (MS1)</th>
          <th>PIC Status (MS2)</th>
          {showMs ? (
            <>
              <th style={{ textAlign: "right" }}>MS1 Unbilled</th>
              <th style={{ textAlign: "right" }}>MS2 Unbilled</th>
            </>
          ) : (
            <th style={{ textAlign: "right" }}>Line Amount</th>
          )}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={colCount} style={{ padding: 0 }}>
              {loading ? (
                <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Loading…</div>
              ) : (
                <div className="empty-state">
                  <div className="empty-icon">✓</div>
                  <h3>No mismatches found</h3>
                  <p>Nothing in this category right now.</p>
                </div>
              )}
            </td>
          </tr>
        ) : rows.map((r) => (
          <tr key={r.name}
              data-doc-name={r.name}
              className={selected.has(r.name) ? "row-selected" : ""}
              onClick={() => toggleRow(r.name)}
              style={{ cursor: "pointer" }}>
            <td onClick={(e) => e.stopPropagation()}>
              <input type="checkbox" checked={selected.has(r.name)} onChange={() => toggleRow(r.name)} />
            </td>
            <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{r.poid || r.name}</td>
            <td>{r.po_no || "—"}</td>
            <td title={r.project_name || ""}>{r.project_code || "—"}</td>
            <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{r.site_code || "—"}</td>
            <td>{r.dispatch_status || "—"}</td>
            <td style={{ color: showMs && r.ms1_stuck ? "#b91c1c" : undefined, fontWeight: showMs && r.ms1_stuck ? 700 : undefined }}>{r.pic_status || "—"}</td>
            <td style={{ color: showMs && r.ms2_stuck ? "#b91c1c" : undefined, fontWeight: showMs && r.ms2_stuck ? 700 : undefined }}>{r.pic_status_ms2 || "—"}</td>
            {showMs ? (
              <>
                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: r.ms1_stuck ? "#b45309" : "#94a3b8" }}>{fmt.format(r.ms1_unbilled || 0)}</td>
                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: r.ms2_stuck ? "#b45309" : "#94a3b8" }}>{fmt.format(r.ms2_unbilled || 0)}</td>
              </>
            ) : (
              <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt.format(r.line_amount || 0)}</td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const inputStyle = {
  width: "100%", padding: "9px 12px",
  border: "1px solid #e2e8f0", borderRadius: 7,
  fontSize: "0.88rem", background: "#f8fafc",
};
const labelStyle = { display: "block", fontSize: "0.78rem", fontWeight: 600, marginBottom: 5, color: "#475569" };

export default function PODispatch() {
  const { rowLimit, setRowLimit } = useTableRowLimit();
  const [activeTab, setActiveTab] = useState("New");
  // "All" is stored per-path, not per-tab, so without this it silently
  // carries over to whichever tab you switch to next — re-triggering an
  // unlimited fetch+render for a tab the user never asked "All" for on this
  // occasion. Track which tab "All" was actually confirmed for (either just
  // clicked, or already the active tab when clicked); any OTHER tab falls
  // back to the normal default limit until the user explicitly picks "All"
  // again while on it. Switching back to the confirmed tab still honors it.
  const confirmedAllTabRef = useRef(rowLimit === TABLE_ROW_LIMIT_ALL ? activeTab : null);
  const effectiveRowLimit = rowLimit === TABLE_ROW_LIMIT_ALL && confirmedAllTabRef.current !== activeTab
    ? TABLE_ROW_LIMIT_DEFAULT
    : rowLimit;
  const confirmRowLimit = useCallback((n) => {
    confirmedAllTabRef.current = activeTab;
    setRowLimit(n);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, setRowLimit]);
  const integrityDef = INTEGRITY_TABS[activeTab] || null;
  const isIntegrityTab = !!integrityDef;
  const [fixBusy, setFixBusy] = useState(false);
  // Counts for both integrity categories, independent of which tab is
  // active — the tab bar needs to know whether to show a tab it's not
  // currently on. undefined (not yet loaded) is treated as "hide" so an
  // empty tab never flashes before the real count arrives.
  const [integrityCounts, setIntegrityCounts] = useState({});
  const refreshIntegrityCounts = useCallback(() => {
    Object.values(INTEGRITY_TABS).forEach((def) => {
      pmApi.listDataIntegrityIssues(def.category)
        .then((res) => setIntegrityCounts((prev) => ({ ...prev, [def.category]: Array.isArray(res) ? res.length : 0 })))
        .catch(() => {});
    });
  }, []);
  useEffect(() => { refreshIntegrityCounts(); }, [refreshIntegrityCounts]);
  const visibleTabs = TABS.filter((t) => {
    const def = INTEGRITY_TABS[t.key];
    return !def || (integrityCounts[def.category] ?? 0) > 0;
  });
  // If the tab PM is currently on empties out (e.g. they just fixed the
  // last line in it), it drops out of visibleTabs above — follow them
  // somewhere still visible instead of stranding them on a hidden tab.
  useEffect(() => {
    if (integrityDef && integrityCounts[integrityDef.category] === 0) {
      setActiveTab("New");
      setSelected(new Set());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [integrityCounts, activeTab]);
  const showDispatched = activeTab === "Dispatched" || activeTab === "all";
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  // See useProgressiveRows — mounts large row sets (e.g. "All Lines" with
  // 19k+ rows) in chunks so the browser doesn't show "Page Unresponsive".
  // paused:loading skips growing/shrinking a tab's own render while a NEW
  // tab's fetch is already in flight, so we don't waste frames growing a
  // table we're about to switch away from anyway.
  const visibleRows = useProgressiveRows(rows, { paused: loading });
  // How many of `visibleRows` to actually show — anything beyond this is
  // hidden via CSS in the render below rather than removed from `rows`. See
  // the skip-fetch logic in the fetch effect below / PICTracker.jsx. Doesn't
  // apply to integrity tabs — those never use the row-limit selector at all.
  const displayLimit = effectiveRowLimit === TABLE_ROW_LIMIT_ALL ? Infinity : effectiveRowLimit;
  const displayedCount = isIntegrityTab ? rows.length : Math.min(rows.length, displayLimit);
  // Remembers what the LAST real server fetch actually returned, and under
  // what limit + filters. Shrinking the row limit (e.g. All -> 20) never
  // needs another round-trip — the rows are already in memory; just show
  // fewer of them. Signature includes everything the fetch depends on
  // except the row limit, so a limit-only shrink is the only thing skipped.
  const lastFetchRef = useRef({ signature: null, limit: null, rows: [], refreshKey: null });
  const [error, setError] = useState(null);
  const [imList, setImList] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [tableSearch, setTableSearch] = useState("");
  const tableSearchDebounced = useDebounced(tableSearch, 300);
  const [integritySearch, setIntegritySearch] = useState("");
  const [projectFilter, setProjectFilter] = useState([]);
  const [imFilter, setImFilter] = useState([]);
  const [duidFilter, setDuidFilter] = useState([]);
  const [itemCodeFilter, setItemCodeFilter] = useState([]);
  const [statusFilter, setStatusFilter] = useState([]);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  // Dispatch modal state
  const [showDispatchModal, setShowDispatchModal] = useState(false);
  const [assignIm, setAssignIm] = useState("");
  const [targetMonth, setTargetMonth] = useState("");
  const [planningMode, setPlanningMode] = useState("Plan");
  const [dispatching, setDispatching] = useState(false);

  // Convert modal state
  const [converting, setConverting] = useState(false);
  const [convertIm, setConvertIm] = useState("");
  const [showConvertModal, setShowConvertModal] = useState(false);
  const [convertScope, setConvertScope] = useState(null);
  const [showProjectConvertModal, setShowProjectConvertModal] = useState(false);
  const [convertProject, setConvertProject] = useState("");
  const [convertItemCode, setConvertItemCode] = useState("");
  const [convertProjectItemCodes, setConvertProjectItemCodes] = useState([]);
  const [detailRow, setDetailRow] = useState(null);

  // Assign IM modal state (works on a mixed-status selection — routes each
  // line by its own status: pending -> dispatch, dispatched -> reassign,
  // closed/cancelled -> direct validated set. See bulk_assign_po_dispatch_im.
  const [showAssignImModal, setShowAssignImModal] = useState(false);
  const [bulkAssignIm, setBulkAssignIm] = useState("");
  const [assigningBulkIm, setAssigningBulkIm] = useState(false);
  const [skipPreview, setSkipPreview] = useState([]);
  const [loadingSkipPreview, setLoadingSkipPreview] = useState(false);
  const [assignImErrors, setAssignImErrors] = useState([]);

  const [successMsg, setSuccessMsg] = useState(null);
  const [errMsg, setErrMsg] = useState(null);

  const [refreshKey, setRefreshKey] = useState(0);

  const showNotice = useCallback((type, msg) => {
    if (type === "ok") { setSuccessMsg(msg); setErrMsg(null); }
    else { setErrMsg(msg); setSuccessMsg(null); }
    setTimeout(() => { setSuccessMsg(null); setErrMsg(null); }, 5000);
  }, []);

  function loadData(tab) {
    if (tab) setActiveTab(tab);
    setRefreshKey((k) => k + 1);
  }

  // ── Manage Table column filters ──────────────────────────────────────
  // Each column's typed value is matched only against that column's own
  // value on the backend (see column_filters / col_filter_map_intake in
  // list_po_intake_lines), not blended into the top search box's wide
  // multi-column search.
  const [columnFilters, setColumnFilters] = useState({});
  useEffect(() => {
    const key = `admin-po-dispatch-v1-${activeTab === "all" ? "all" : showDispatched ? "full" : "basic"}`;
    const onFiltersChanged = (e) => {
      if (e.detail?.tableKey !== key) return;
      setColumnFilters(e.detail.filters || {});
    };
    document.addEventListener("tablepro:filters-changed", onFiltersChanged);
    return () => document.removeEventListener("tablepro:filters-changed", onFiltersChanged);
  }, [activeTab, showDispatched]);
  const queryArgsRef = useRef({ portal: {}, status: "New" });
  useEffect(() => {
    const key = `admin-po-dispatch-v1-${activeTab === "all" ? "all" : showDispatched ? "full" : "basic"}`;
    const onRequestOptions = (e) => {
      if (e.detail?.tableKey !== key) return;
      const { portal, status } = queryArgsRef.current;
      e.detail.respond(pmApi.getColumnFilterOptions({
        source: "po_intake_line",
        col_key: e.detail.colKey,
        bucket: e.detail.bucket,
        search: e.detail.search,
        limit: e.detail.limit,
        portal_filters: portal,
        extra: { status },
        // Excel keeps a column's own selection out of its own list.
        exclude_column: e.detail.colKey,
      }));
    };
    document.addEventListener("tablepro:request-column-options", onRequestOptions);
    return () => document.removeEventListener("tablepro:request-column-options", onRequestOptions);
  }, [activeTab, showDispatched]);

  // "New" (basic columns) and "Dispatched"/"all" (full columns) are now
  // distinct table identities (see data-table-key above) - don't carry a
  // typed column filter across that boundary.
  // Dispatched and All Lines share one data-table-key (same columns, so they
  // share a saved layout), which means a filter set on one carried straight
  // over to the other and silently narrowed it. Clear on every tab change,
  // and tell DataTablePro to clear its own filter row too — otherwise the
  // header keeps showing "2 selected" for a filter the page no longer applies.
  useEffect(() => {
    setColumnFilters({});
    document.dispatchEvent(new CustomEvent("tablepro:clear-filters", {
      detail: { tableKey: `admin-po-dispatch-v1-${showDispatched ? "full" : "basic"}` },
    }));
  }, [activeTab, showDispatched]);
  // Either a legacy substring string or the Excel-style { values, blanks,
  // contains } object. String(obj) is "[object Object]" — always truthy — so
  // an emptied Excel selection would never clear without this.
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

  // One definition of "what this tab is showing", shared by the row fetch and
  // the header summary — they must describe the same set or the chips
  // contradict the table underneath them.
  const queryPortal = useMemo(() => {
    const portal = { intake_tab: String(activeTab || "").toLowerCase() };
    if (tableSearchDebounced.trim()) portal.search = tableSearchDebounced.trim();
    if (projectFilter.length) portal.project_code = projectFilter;
    if (imFilter.length) portal.dispatched_im = imFilter;
    if (duidFilter.length) portal.site_code = duidFilter;
    if (itemCodeFilter.length) portal.item_code = itemCodeFilter;
    // Only meaningful on "All Lines" - the other 2 tabs already imply a
    // status via the tab itself, and combining that with a leftover
    // dropdown selection from testing "All Lines" would silently AND
    // together into a contradiction (e.g. tab=New + dropdown=Dispatched
    // = 0 rows, looking like "no lines pending dispatch" for no
    // apparent reason).
    if (activeTab === "all" && statusFilter.length) portal.line_status = statusFilter;
    if (fromDate) portal.from_date = fromDate;
    if (toDate) portal.to_date = toDate;
    const colFilters = JSON.parse(columnFiltersDebounced);
    if (Object.keys(colFilters).length) portal.column_filters = colFilters;
    return portal;
  }, [activeTab, tableSearchDebounced, projectFilter, imFilter, duidFilter,
      itemCodeFilter, statusFilter, fromDate, toDate, columnFiltersDebounced]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setSelected(new Set());
    (async () => {
      try {
        if (integrityDef) {
          setLoading(true);
          const res = await pmApi.listDataIntegrityIssues(integrityDef.category);
          if (!cancelled) setRows(Array.isArray(res) ? res : []);
          // This tab overwrites `rows` with a completely different dataset but
          // never touches lastFetchRef. Without clearing it, returning to the
          // tab we came from matches its old signature, hits the
          // "already have enough" skip, and leaves the integrity rows on
          // screen as if they were that tab's data.
          lastFetchRef.current = { signature: null, limit: null, rows: [], refreshKey: null };
          return;
        }
        const status = activeTab;
        const portal = queryPortal;
        // Excel column-filter dropdowns cascade off exactly this query.
        queryArgsRef.current = { portal, status };
        const signature = JSON.stringify([portal]);

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
          // Same tab + filters, and we already have at least this many rows
          // from a larger (or equal) fetch — just show fewer via the
          // CSS-hide render below, no re-fetch, no state mutation.
          return;
        }

        setLoading(true);
        const [poLines, ims] = await Promise.all([
          pmApi.listPOIntakeLines(status, effectiveRowLimit, portal),
          pmApi.listIMMasters({ status: "Active" }),
        ]);
        const fetchedRows = Array.isArray(poLines) ? poLines : [];
        if (!cancelled) setRows(fetchedRows);
        if (!cancelled) lastFetchRef.current = { signature, limit: effectiveRowLimit, rows: fetchedRows, refreshKey };
        if (!cancelled) setImList(Array.isArray(ims) ? ims : []);
      } catch (err) {
        if (!cancelled) setError(err.message || "Failed to load data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeTab, effectiveRowLimit, queryPortal, refreshKey]);

  useEffect(() => {
    if (!convertProject) { setConvertProjectItemCodes([]); return; }
    pmApi.getItemCodesForProject(convertProject)
      .then((codes) => setConvertProjectItemCodes(Array.isArray(codes) ? codes : []))
      .catch(() => setConvertProjectItemCodes([]));
  }, [convertProject]);

  function switchTab(tab) { setActiveTab(tab); setSelected(new Set()); setIntegritySearch(""); }

  function toggleRow(name) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  // Filter options come from distinct values across ALL PO Intake Lines, not
  // just the row-limited slice — so dropdowns stay complete regardless of limit.
  const { options: filterOpts } = useFilterOptions("PO Intake Line", ["project_code", "site_code", "item_code"]);
  const projectOptions = filterOpts.project_code || [];
  const duidOptions = filterOpts.site_code || [];
  const itemCodeOptions = filterOpts.item_code || [];
  const imLabelById = useMemo(() => {
    const m = {};
    for (const im of imList) {
      if (im?.name) m[im.name] = im.full_name || im.im_id || im.name;
    }
    return m;
  }, [imList]);
  const imSelectOptions = useMemo(
    () => [...imList].sort((a, b) =>
      String(a.full_name || a.name || "").localeCompare(String(b.full_name || b.name || ""), undefined, { sensitivity: "base" }),
    ),
    [imList],
  );
  const hasFilters = !!(tableSearch || projectFilter.length || imFilter.length || duidFilter.length || statusFilter.length || fromDate || toDate);
  const STATUS_OPTIONS = ["New", "Dispatched", "Completed", "Closed", "Cancelled"].map((s) => ({ id: s, label: s }));

  function toggleAll() {
    const dtpHidden = new Set(Array.from(document.querySelectorAll("tbody tr[data-tablepro-filtered]")).map((tr) => tr.dataset.docName).filter(Boolean));
    // displayedCount is rows.length on integrity tabs (no row-limit there),
    // so this only actually narrows anything on the main New/Dispatched/all tabs.
    const visible = integrityRowsFiltered.slice(0, displayedCount).filter((r) => !dtpHidden.has(r.name));
    if (visible.length > 0 && visible.every((r) => selected.has(r.name))) {
      setSelected(new Set());
    } else {
      setSelected(new Set(visible.map((r) => r.name)));
    }
  }

  // ── Dispatch ─────────────────────────────────────────────────────────────
  async function handleDispatch() {
    if (!assignIm || !planningMode) return;
    setDispatching(true);
    try {
      const selectedLines = rows.filter(r => selected.has(r.name));
      const result = await pmApi.dispatchPOLines({
        lines: selectedLines,
        im: assignIm,
        target_month: targetMonth || undefined,
        planning_mode: planningMode,
      });
      const count = result?.created ?? selected.size;
      showNotice("ok", `Successfully dispatched ${count} line${count !== 1 ? "s" : ""}.`);
      setSelected(new Set());
      setShowDispatchModal(false);
      setPlanningMode("Plan");
      loadData("New");
    } catch (err) {
      showNotice("err", err.message || "Dispatch failed");
    } finally {
      setDispatching(false);
    }
  }

  // ── Convert ──────────────────────────────────────────────────────────────
  function openConvertModal(scope, line_names, project_code) {
    setConvertScope({ scope, line_names: line_names || [], project_code: project_code || null });
    setConvertIm("");
    setShowConvertModal(true);
  }

  async function handleConvert() {
    if (!convertScope) return;
    setConverting(true);
    setShowConvertModal(false);
    try {
      const res = await pmApi.convertDispatchMode({
        scope: convertScope.scope,
        line_names: convertScope.line_names,
        project_code: convertScope.project_code,
        target_mode: "Manual",
        new_im: convertIm || undefined,
      });
      const count = res?.converted ?? convertScope.line_names.length;
      showNotice("ok", `Converted ${count} record${count !== 1 ? "s" : ""} to Manual.`);
      loadData(activeTab);
    } catch (err) {
      showNotice("err", err.message || "Convert failed");
    } finally {
      setConverting(false);
    }
  }

  const autoRows = rows.slice(0, displayedCount).filter(r => r.dispatch_mode === "Auto");
  // All projects that have any Auto-mode PO Dispatch, not just ones in the loaded slice.
  const { options: dispatchFilterOpts } = useFilterOptions("PO Dispatch", ["project_code"]);
  const uniqueProjects = dispatchFilterOpts.project_code || [];

  async function handleConvertByProject() {
    if (!convertProject) return;
    setConverting(true);
    setShowProjectConvertModal(false);
    try {
      const res = await pmApi.convertDispatchMode({
        scope: "project",
        project_code: convertProject,
        item_code: convertItemCode || undefined,
        target_mode: "Manual",
        new_im: convertIm || undefined,
      });
      const count = res?.converted ?? 0;
      showNotice("ok", `Converted ${count} record${count !== 1 ? "s" : ""} to Manual.`);
      setConvertProject("");
      setConvertItemCode("");
      setConvertIm("");
      loadData(activeTab);
    } catch (err) {
      showNotice("err", err.message || "Convert failed");
    } finally {
      setConverting(false);
    }
  }

  // ── Assign IM (mixed-status selection) ────────────────────────────────
  async function openAssignImModal() {
    setBulkAssignIm("");
    setSkipPreview([]);
    setAssignImErrors([]);
    setShowAssignImModal(true);
    const selectedLines = rows.filter((r) => selected.has(r.name));
    const dispatchNames = selectedLines.map((r) => r.dispatch_name).filter(Boolean);
    if (!dispatchNames.length) return;
    setLoadingSkipPreview(true);
    try {
      const skippedNames = await pmApi.checkWorkDoneForDispatches(dispatchNames);
      const skippedSet = new Set(skippedNames || []);
      setSkipPreview(selectedLines.filter((r) => skippedSet.has(r.dispatch_name)));
    } catch {
      setSkipPreview([]);
    } finally {
      setLoadingSkipPreview(false);
    }
  }

  async function handleBulkAssignIm() {
    if (!bulkAssignIm || selected.size === 0) return;
    setAssigningBulkIm(true);
    setAssignImErrors([]);
    try {
      const selectedLines = rows.filter((r) => selected.has(r.name));
      const res = await pmApi.bulkAssignPODispatchIm({ lines: selectedLines, im: bulkAssignIm });
      const parts = [];
      if (res?.dispatched) parts.push(`${res.dispatched} dispatched`);
      if (res?.reassigned) parts.push(`${res.reassigned} reassigned`);
      if (res?.updated_closed) parts.push(`${res.updated_closed} closed/cancelled updated`);
      if (res?.skipped_work_done) parts.push(`${res.skipped_work_done} skipped (already has Work Done)`);
      const errCount = res?.errors?.length || 0;
      const summary = parts.length ? parts.join(", ") : "No lines updated";
      showNotice(
        errCount ? "err" : "ok",
        `${summary}.${errCount ? ` ${errCount} error${errCount !== 1 ? "s" : ""} — see details below.` : ""}`,
      );
      loadData(activeTab);
      if (errCount) {
        // Keep the modal open and show the actual error text (deduped) so
        // the user doesn't just see a bare count with no way to diagnose it.
        console.error("bulkAssignPODispatchIm errors:", res.errors);
        setAssignImErrors(res.errors);
      } else {
        setSelected(new Set());
        setShowAssignImModal(false);
        setBulkAssignIm("");
      }
    } catch (err) {
      showNotice("err", err.message || "Assign IM failed");
    } finally {
      setAssigningBulkIm(false);
    }
  }

  // ── Data Integrity fix (Completed/No Evidence, Closed/Unresolved tabs) ──
  async function submitIntegrityFix(fixFn) {
    if (!selected.size) return;
    setFixBusy(true);
    try {
      const res = await pmApi[fixFn](Array.from(selected));
      const n = res?.count ?? 0;
      showNotice("ok", `Fixed ${n} line${n !== 1 ? "s" : ""}.`);
      setSelected(new Set());
      loadData(activeTab);
      refreshIntegrityCounts();
    } catch (err) {
      showNotice("err", err.message || "Fix failed");
    } finally {
      setFixBusy(false);
    }
  }

  const selectedIntegrityRows = isIntegrityTab ? rows.filter((r) => selected.has(r.name)) : [];
  const integritySearchNorm = integritySearch.trim().toLowerCase();
  const integrityRowsFiltered = !isIntegrityTab || !integritySearchNorm
    ? rows
    : rows.filter((r) => [r.poid, r.po_no, r.project_code, r.project_name, r.site_code, r.name]
        .some((v) => String(v || "").toLowerCase().includes(integritySearchNorm)));

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div>
      {/* ── Dispatch Modal ─────────────────────────────────── */}
      <Modal open={showDispatchModal} onClose={() => setShowDispatchModal(false)} title={`Dispatch ${selected.size} Line${selected.size !== 1 ? "s" : ""}`}>
        <div style={{ display: "grid", gap: 16, marginBottom: 24 }}>
          <div>
            <label style={labelStyle}>Assign IM *</label>
            <select style={inputStyle} value={assignIm} onChange={e => setAssignIm(e.target.value)}>
              <option value="">Select Implementation Manager...</option>
              {imList.map((im) => (
                <option key={im.name} value={im.name}>{im.full_name || im.im_id || im.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Planning Mode *</label>
            <select style={inputStyle} value={planningMode} onChange={e => setPlanningMode(e.target.value)}>
              <option value="Plan">Plan</option>
              <option value="Direct">Direct</option>
            </select>
          </div>
          <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 14px", fontSize: "0.82rem", color: "#64748b" }}>
            Selected lines: <strong>{selected.size}</strong>
            {assignIm && (
              <span style={{ marginLeft: 10 }}>→ IM: <strong>{imList.find((i) => i.name === assignIm)?.full_name || assignIm}</strong></span>
            )}
            {planningMode && (
              <span style={{ marginLeft: 10 }}>→ Mode: <strong>{planningMode}</strong></span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button className="btn-secondary" onClick={() => setShowDispatchModal(false)}>Cancel</button>
          <button
            className="btn-primary"
            onClick={handleDispatch}
            disabled={dispatching || !assignIm || !planningMode}
          >
            {dispatching ? "Dispatching..." : "Confirm Dispatch"}
          </button>
        </div>
      </Modal>

      {/* ── Convert Modal ──────────────────────────────────── */}
      <Modal open={showConvertModal} onClose={() => setShowConvertModal(false)} title="Convert to Manual / Re-assign IM">
        <p style={{ margin: "0 0 16px", color: "#64748b", fontSize: "0.84rem" }}>
          {convertScope?.line_names?.length} selected line{convertScope?.line_names?.length !== 1 ? "s" : ""} will be set to Manual dispatch. You can also re-assign the IM at the same time.
        </p>
        <div style={{ marginBottom: 20 }}>
          <label style={labelStyle}>Re-assign IM (optional)</label>
          <select style={inputStyle} value={convertIm} onChange={(e) => setConvertIm(e.target.value)}>
            <option value="">Keep current IM</option>
            {imList.map((im) => (
              <option key={im.name} value={im.name}>{im.full_name || im.im_id || im.name}</option>
            ))}
          </select>
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button className="btn-secondary" onClick={() => setShowConvertModal(false)}>Cancel</button>
          <button className="btn-primary" onClick={handleConvert}>Apply</button>
        </div>
      </Modal>

      <Modal open={showProjectConvertModal} onClose={() => setShowProjectConvertModal(false)} title="Convert to Manual / Re-assign IM">
        <p style={{ margin: "0 0 16px", color: "#64748b", fontSize: "0.84rem" }}>
          Applies to all dispatched lines in the project. Item code is optional. Can be done multiple times to re-assign IM.
        </p>
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>Project *</label>
          <SearchableSelect
            value={convertProject}
            onChange={(v) => { setConvertProject(v || ""); setConvertItemCode(""); }}
            options={uniqueProjects.map((p) => ({ id: p, label: p }))}
            placeholder="Select project..."
            style={{ display: "block", width: "100%" }}
          />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>Item Code (optional)</label>
          <SearchableSelect
            value={convertItemCode}
            onChange={(v) => setConvertItemCode(v || "")}
            options={convertProjectItemCodes.map((c) => ({ id: c, label: c }))}
            placeholder="All item codes"
            disabled={!convertProject}
            style={{ display: "block", width: "100%" }}
          />
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={labelStyle}>Re-assign IM (optional)</label>
          <select style={inputStyle} value={convertIm} onChange={(e) => setConvertIm(e.target.value)}>
            <option value="">Keep current IM</option>
            {imList.map((im) => (
              <option key={im.name} value={im.name}>{im.full_name || im.im_id || im.name}</option>
            ))}
          </select>
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button className="btn-secondary" onClick={() => setShowProjectConvertModal(false)}>Cancel</button>
          <button className="btn-primary" onClick={handleConvertByProject} disabled={!convertProject || converting}>
            {converting ? "Converting..." : `Convert${convertItemCode ? ` · ${convertItemCode}` : " All"}`}
          </button>
        </div>
      </Modal>

      {/* ── Assign IM Modal (mixed-status selection) ──────────────────── */}
      <Modal open={showAssignImModal} onClose={() => setShowAssignImModal(false)} title={`Assign IM — ${selected.size} Line${selected.size !== 1 ? "s" : ""}`}>
        {loadingSkipPreview ? (
          <p style={{ margin: "0 0 16px", color: "#94a3b8", fontSize: "0.82rem" }}>Checking for existing Work Done records...</p>
        ) : skipPreview.length > 0 ? (
          <div style={{ margin: "0 0 16px", padding: "10px 14px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8 }}>
            <div style={{ fontSize: "0.82rem", fontWeight: 700, color: "#92400e", marginBottom: 6 }}>
              {skipPreview.length} line{skipPreview.length !== 1 ? "s" : ""} already have Work Done and will be skipped:
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {skipPreview.map((r) => (
                <span key={r.name} style={{ fontFamily: "monospace", fontSize: "0.74rem", padding: "2px 8px", borderRadius: 6, background: "#fff", border: "1px solid #fde68a", color: "#92400e" }}>
                  {r.poid || r.name}
                </span>
              ))}
            </div>
          </div>
        ) : null}
        <div style={{ marginBottom: 20 }}>
          <label style={labelStyle}>Assign IM *</label>
          <select style={inputStyle} value={bulkAssignIm} onChange={(e) => setBulkAssignIm(e.target.value)}>
            <option value="">Select Implementation Manager...</option>
            {imList.map((im) => (
              <option key={im.name} value={im.name}>{im.full_name || im.im_id || im.name}</option>
            ))}
          </select>
        </div>
        {assignImErrors.length > 0 && (() => {
          const byMessage = {};
          for (const e of assignImErrors) {
            const msg = e.error || "Unknown error";
            (byMessage[msg] = byMessage[msg] || []).push(e.name);
          }
          const groups = Object.entries(byMessage).sort((a, b) => b[1].length - a[1].length);
          return (
            <div style={{ margin: "0 0 16px", padding: "10px 14px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, maxHeight: 220, overflowY: "auto" }}>
              <div style={{ fontSize: "0.82rem", fontWeight: 700, color: "#991b1b", marginBottom: 8 }}>
                {assignImErrors.length} line{assignImErrors.length !== 1 ? "s" : ""} failed:
              </div>
              {groups.map(([msg, names]) => (
                <div key={msg} style={{ marginBottom: 8, fontSize: "0.78rem" }}>
                  <div style={{ color: "#991b1b", fontWeight: 600 }}>{names.length}× — {msg}</div>
                  <div style={{ color: "#7f1d1d", fontFamily: "monospace", fontSize: "0.72rem", marginTop: 2 }}>
                    {names.slice(0, 8).join(", ")}{names.length > 8 ? ` … +${names.length - 8} more` : ""}
                  </div>
                </div>
              ))}
            </div>
          );
        })()}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button className="btn-secondary" onClick={() => setShowAssignImModal(false)}>Cancel</button>
          <button className="btn-primary" onClick={handleBulkAssignIm} disabled={assigningBulkIm || !bulkAssignIm}>
            {assigningBulkIm ? "Assigning..." : "Assign IM"}
          </button>
        </div>
      </Modal>

      <Modal open={!!detailRow} onClose={() => setDetailRow(null)} title={`PO Dispatch Details${detailRow?.poid ? ` · ${detailRow.poid}` : ""}`} width={860}>
        {detailRow && (
          <RecordDetailView
            row={detailRow}
            pills={[
              { label: "POID", value: detailRow.poid || "—", tone: "blue" },
              { label: "Project", value: detailRow.project_code || "—", tone: "amber" },
              { label: "IM", value: detailRow.dispatched_im_full_name || imLabelById[detailRow.dispatched_im] || detailRow.dispatched_im || "—", tone: "green" },
              detailRow.dispatch_mode ? { label: "Mode", value: detailRow.dispatch_mode, tone: detailRow.dispatch_mode === "Auto" ? "violet" : "slate" } : null,
            ].filter(Boolean)}
            hero={
              <DetailHero>
                <DetailStatTile label="Item Code" value={detailRow.item_code || "—"} tone="slate" />
                <DetailStatTile label="Qty" value={detailRow.qty != null ? fmt.format(detailRow.qty) : "—"} tone="blue" />
                <DetailStatTile label="Rate (SAR)" value={detailRow.rate != null ? fmtAmt.format(detailRow.rate) : "—"} tone="slate" />
                <DetailStatTile
                  label="Line Amount (SAR)"
                  value={detailRow.line_amount != null ? fmtAmt.format(detailRow.line_amount) : "—"}
                  tone="green"
                />
                {detailRow.po_line_status && (
                  <DetailStatTile
                    label="Status"
                    value={detailRow.po_line_status}
                    tone={
                      /complete|dispatched/i.test(detailRow.po_line_status) ? "green"
                      : /cancel|reject/i.test(detailRow.po_line_status) ? "rose"
                      : /progress|planned/i.test(detailRow.po_line_status) ? "blue"
                      : "amber"
                    }
                  />
                )}
              </DetailHero>
            }
            hiddenFields={[
              ...HIDDEN_DETAIL_FIELDS,
              // Already surfaced in pills / hero — hide to reduce noise.
              // item_description stays — it renders as its own full-width tile below.
              "poid", "project_code", "dispatched_im", "dispatched_im_full_name",
              "item_code", "qty", "rate", "line_amount",
              "po_line_status",
            ]}
            keyOrder={[
              "item_description",
              // Pipeline detail — same fields shown as their own columns on
              // the All Lines tab, surfaced here too regardless of which
              // tab the row was opened from.
              "dispatch_status", "plan_status", "plan_date", "pic_status", "pic_status_ms2",
              "work_type", "subcon_status", "subcon_completed_on", "backend_team",
              "ms1_amount", "ms2_amount", "huawei_im", "project_domain",
              "po_no", "po_intake", "parent", "name", "system_id",
              "po_line_no", "shipment_number", "dispatch_name",
              "site_code", "site_name", "area", "center_area", "region_type",
              "dispatch_mode", "dispatch_target_month",
              "uom", "due_qty", "billed_quantity", "quantity_cancel",
              "activity_code", "currency", "tax_rate", "payment_terms",
              "start_date", "end_date", "publish_date", "sub_contract_no",
              "customer",
            ]}
          />
        )}
      </Modal>

      {/* ── Header ─────────────────────────────────────────── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">PO Dispatch</h1>
          <div className="page-subtitle">Dispatch PO lines to an IM</div>
        </div>
        {/* Integrity tabs are a different dataset entirely (see the fetch
            effect) — a PO-line summary would describe rows that aren't on
            screen. */}
        {!integrityDef && (
          <PageSummary
            source="po_intake_line"
            filters={queryPortal}
            extra={{ status: activeTab }}
            refreshKey={refreshKey}
          />
        )}
        <div className="page-actions">
          <ExportExcelButton filename={`po-dispatch-${activeTab}`} rows={rows.slice(0, displayedCount)} />
          <button className="btn-secondary" onClick={() => loadData(activeTab)} disabled={loading}>
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
      </div>

      {/* Notices */}
      {successMsg && <div className="notice success" style={{ margin: "0 0 12px" }}><span>✓</span> {successMsg}</div>}
      {errMsg && <div className="notice error" style={{ margin: "0 0 12px" }}><span>!</span> {errMsg}</div>}

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "2px solid #e2e8f0", marginBottom: 0 }}>
        {visibleTabs.map(t => (
          <button key={t.key} onClick={() => switchTab(t.key)} style={{
            padding: "10px 22px", background: "none", border: "none",
            borderBottom: activeTab === t.key ? "2px solid #6366f1" : "2px solid transparent",
            marginBottom: -2, fontWeight: activeTab === t.key ? 700 : 500,
            color: activeTab === t.key ? "#6366f1" : "#64748b",
            fontSize: "0.88rem", cursor: "pointer",
          }}>
            {t.label}
            {t.key === "New" && rows.length > 0 && activeTab !== "New" ? "" : ""}
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="toolbar">
        {isIntegrityTab ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input
              type="search"
              placeholder="Filter by POID, PO No, Project, DUID..."
              value={integritySearch}
              onChange={(e) => setIntegritySearch(e.target.value)}
              onPaste={(e) => handleSearchPaste(e, setIntegritySearch)}
              style={{ padding: "7px 12px", borderRadius: 7, border: "1px solid #e2e8f0", fontSize: "0.84rem", minWidth: 280 }}
            />
            {integritySearch && (
              <button className="btn-secondary" style={{ fontSize: "0.8rem" }} onClick={() => setIntegritySearch("")}>
                Clear
              </button>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {/* Search filter */}
            <input
              type="search"
              placeholder="Filter by POID, PO No, Item, Project, DUID..."
              value={tableSearch}
              onChange={e => setTableSearch(e.target.value)}
              onPaste={(e) => handleSearchPaste(e, setTableSearch)}
              style={{ padding: "7px 12px", borderRadius: 7, border: "1px solid #e2e8f0", fontSize: "0.84rem", minWidth: 280 }}
            />
            <SearchableSelect
              allowBlank multi value={projectFilter} onChange={setProjectFilter} options={projectOptions} placeholder="All Projects" minWidth={170} />
            <SearchableSelect
              allowBlank multi value={imFilter} onChange={setImFilter} options={imSelectOptions.map((im) => ({ id: im.name, label: im.full_name || im.im_id || im.name }))} placeholder="All IMs" minWidth={170} />
            <SearchableSelect
              allowBlank multi value={duidFilter} onChange={setDuidFilter} options={duidOptions} placeholder="All DUIDs" minWidth={160} />
            <SearchableSelect
              allowBlank multi value={itemCodeFilter} onChange={setItemCodeFilter} options={itemCodeOptions} placeholder="All Item Codes" minWidth={160} />
            <SearchableSelect
              allowBlank multi value={statusFilter} onChange={setStatusFilter} options={STATUS_OPTIONS} placeholder="All Status" minWidth={150} />
            <DateRangePicker value={{ from: fromDate, to: toDate }} onChange={({ from, to }) => { setFromDate(from); setToDate(to); }} />
            {hasFilters && (
              <button className="btn-secondary" style={{ fontSize: "0.8rem" }} onClick={() => { setTableSearch(""); setProjectFilter([]); setImFilter([]); setDuidFilter([]); setItemCodeFilter([]); setStatusFilter([]); setFromDate(""); setToDate(""); }}>
                Clear
              </button>
            )}
          </div>
        )}

        <div className="toolbar-actions">
          {isIntegrityTab && integrityDef.actions
            .filter((a) => !selected.size || !a.visibleWhen || a.visibleWhen(selectedIntegrityRows))
            .map((a) => (
              <button
                key={a.fixFn}
                className="btn-primary"
                style={{ fontSize: "0.8rem" }}
                onClick={() => submitIntegrityFix(a.fixFn)}
                disabled={!selected.size || fixBusy}
              >
                {fixBusy ? "Fixing…" : `${a.label} (${selected.size})`}
              </button>
            ))}

          {/* Works across all 3 dispatch tabs on whatever's selected - routes
              each line by its own status (pending/dispatched/closed/cancelled).
              The main place this matters is "All Lines", where a selection
              can mix all of those at once. */}
          {!isIntegrityTab && selected.size > 0 && (
            <button
              className="btn-primary"
              style={{ fontSize: "0.8rem" }}
              onClick={openAssignImModal}
            >
              Assign IM ({selected.size})
            </button>
          )}

          {/* Dispatched tab: auto-convert buttons */}
          {activeTab === "Dispatched" && (
            <>
              <button className="btn-primary" style={{ fontSize: "0.8rem" }}
                onClick={() => { setConvertProject(""); setConvertItemCode(""); setConvertIm(""); setShowProjectConvertModal(true); }} disabled={converting}>
                Convert by Project
              </button>
              {selected.size > 0 && (
                <button className="btn-primary" style={{ fontSize: "0.8rem" }}
                  onClick={() => openConvertModal("lines", [...selected], null)} disabled={converting}>
                  Convert / Re-assign ({selected.size})
                </button>
              )}
            </>
          )}

          {/* Pending tab: dispatch button */}
          {activeTab === "New" && (
            <>
              {selected.size > 0 && (
                <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>{selected.size} selected</span>
              )}
              <button
                className="btn-primary"
                onClick={() => { setAssignIm(""); setShowDispatchModal(true); }}
                disabled={selected.size === 0}
              >
                Dispatch Selected ({selected.size})
              </button>
            </>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="page-content">
        {error && <div className="notice error" style={{ marginBottom: 16 }}><span>!</span> {error}</div>}

        <DataTableWrapper loading={loading && rows.length > 0}>
          {isIntegrityTab ? (
            <IntegrityTable
              rows={integrityRowsFiltered}
              loading={loading}
              selected={selected}
              toggleRow={toggleRow}
              toggleAll={toggleAll}
              tabKey={activeTab}
              showMs={activeTab === "integrity_closed_unresolved"}
              fmt={fmtAmt}
            />
          ) : (() => {
            // Plan Status / PIC Status (MS1/MS2) / Work Done Status / Work Done
            // Revenue only make sense — and are only worth the extra query
            // cost — on the "All Lines" view where a PM is looking across the
            // whole pipeline. Pending Dispatch/Dispatched don't need that
            // much detail, so those 5 columns are "all"-tab only.
            const colCount = activeTab === "all" ? 33 : showDispatched ? 23 : 20;
            const totals = rows.slice(0, displayedCount).reduce((acc, r) => ({
              qty: acc.qty + (parseFloat(r.qty) || 0),
              amount: acc.amount + (parseFloat(r.line_amount) || 0),
              ms1Amount: acc.ms1Amount + (parseFloat(r.ms1_amount) || 0),
              ms2Amount: acc.ms2Amount + (parseFloat(r.ms2_amount) || 0),
            }), { qty: 0, amount: 0, ms1Amount: 0, ms2Amount: 0 });
            return (
            <table className="data-table" data-excel-filter-all="1" data-table-key={`admin-po-dispatch-v1-${activeTab === "all" ? "all" : showDispatched ? "full" : "basic"}`}>
              <thead>
                <tr>
                  <th style={{ width: 36 }}>
                    <input type="checkbox"
                      checked={selected.size === displayedCount && displayedCount > 0}
                      onChange={toggleAll}
                    />
                  </th>
                  <th>POID</th>
                  <th>Status</th>
                  <th>PO Status</th>
                  {activeTab === "all" && (
                    <>
                      <th>Plan Status</th>
                      <th>Plan Date</th>
                      <th>PIC Status (MS1)</th>
                      <th>PIC Status (MS2)</th>
                      <th>Work Type</th>
                      <th>Subcon Status</th>
                      <th>Subcon Completed On</th>
                      <th>Backend Team</th>
                      <th style={{ textAlign: "right" }}>MS1 Amount</th>
                      <th style={{ textAlign: "right" }}>MS2 Amount</th>
                    </>
                  )}
                  <th>System ID</th>
                  <th>PO No</th>
                  <th>Shipment No</th>
                  <th>Item Code</th>
                  <th>Description</th>
                  <th>Activity Type</th>
                  <th style={{ textAlign: "right" }}>Qty</th>
                  <th style={{ textAlign: "right" }}>Rate</th>
                  <th style={{ textAlign: "right" }}>Amount</th>
                  <th>Project</th>
                  <th>Domain</th>
                  <th>Huawei IM</th>
                  <th>DUID</th>
                  <th>Center area</th>
                  <th>Region</th>
                  {showDispatched && (
                    <>
                      <th>Mode</th>
                      <th>IM</th>
                      <th>Target Month</th>
                    </>
                  )}
                  <th data-excel-filter="0">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={colCount} style={{ padding: 0 }}>
                      {loading ? (
                        <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)" }}>Loading PO lines...</div>
                      ) : (
                        <div className="empty-state">
                          <div className="empty-icon">📋</div>
                          <h3>{tableSearch || Object.keys(activeColumnFilters).length ? "No results match filter" : activeTab === "New" ? "No lines pending dispatch" : "No records"}</h3>
                          <p>{tableSearch || Object.keys(activeColumnFilters).length ? "Try a different search term." : activeTab === "New" ? "All PO lines have been dispatched." : "No records in this view."}</p>
                        </div>
                      )}
                    </td>
                  </tr>
                ) : visibleRows.map((row, idx) => {
                  const isAuto = row.dispatch_mode === "Auto";
                  return (
                    <tr key={row.name}
                      data-doc-name={row.name}
                      className={selected.has(row.name) ? "row-selected" : ""}
                      onClick={() => toggleRow(row.name)}
                      style={idx >= displayedCount ? { display: "none" } : {
                        cursor: "pointer",
                        background: isAuto && activeTab === "Dispatched" ? "rgba(99,102,241,0.04)" : undefined,
                      }}
                    >
                      <td onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={selected.has(row.name)} onChange={() => toggleRow(row.name)} />
                      </td>
                      <td style={{ fontFamily: "monospace", fontSize: "0.8rem", whiteSpace: "nowrap" }}>{row.poid}</td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {row.po_line_status ? (() => {
                          const t = poLineStatusTone(row.po_line_status);
                          return (
                            <span style={{ display: "inline-block", padding: "2px 9px", borderRadius: 999, fontSize: "0.72rem", fontWeight: 700, background: t.bg, color: t.fg }}>
                              {row.po_line_status}
                            </span>
                          );
                        })() : "—"}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }} title="PO Dispatch.dispatch_status — compare against Status (PO Intake Line.po_line_status) to spot mismatches">
                        {row.dispatch_status ? (() => {
                          const t = statusTone(row.dispatch_status);
                          return (
                            <span style={{ display: "inline-block", padding: "2px 9px", borderRadius: 999, fontSize: "0.72rem", fontWeight: 700, background: t.bg, color: t.fg }}>
                              {row.dispatch_status}
                            </span>
                          );
                        })() : "—"}
                      </td>
                      {activeTab === "all" && (
                        <>
                          <td style={{ whiteSpace: "nowrap" }}>
                            {row.plan_status ? (() => {
                              const t = planStatusTone(row.plan_status);
                              return (
                                <span style={{ display: "inline-block", padding: "2px 9px", borderRadius: 999, fontSize: "0.72rem", fontWeight: 700, background: t.bg, color: t.fg }}>
                                  {row.plan_status}
                                </span>
                              );
                            })() : "—"}
                          </td>
                          <td style={{ fontSize: "0.82rem", whiteSpace: "nowrap" }}>
                            {row.plan_date ? new Date(row.plan_date).toLocaleDateString("en", { day: "2-digit", month: "short", year: "numeric" }) : "—"}
                          </td>
                          <td style={{ whiteSpace: "nowrap" }}><PicStatusBadge value={row.pic_status} /></td>
                          <td style={{ whiteSpace: "nowrap" }}><PicStatusBadge value={row.pic_status_ms2} /></td>
                          <td style={{ whiteSpace: "nowrap" }}>
                            {row.work_type ? (() => {
                              const t = workTypeTone(row.work_type);
                              return (
                                <span style={{ display: "inline-block", padding: "2px 9px", borderRadius: 999, fontSize: "0.72rem", fontWeight: 700, background: t.bg, color: t.fg }}>
                                  {row.work_type}
                                </span>
                              );
                            })() : "—"}
                          </td>
                          <td style={{ whiteSpace: "nowrap" }}>
                            {row.subcon_status ? (() => {
                              const t = subconStatusTone(row.subcon_status);
                              return (
                                <span style={{ display: "inline-block", padding: "2px 9px", borderRadius: 999, fontSize: "0.72rem", fontWeight: 700, background: t.bg, color: t.fg }}>
                                  {row.subcon_status}
                                </span>
                              );
                            })() : "—"}
                          </td>
                          <td style={{ fontSize: "0.82rem", whiteSpace: "nowrap" }}>
                            {row.subcon_completed_on ? new Date(row.subcon_completed_on).toLocaleDateString("en", { day: "2-digit", month: "short", year: "numeric" }) : "—"}
                          </td>
                          <td style={{ whiteSpace: "nowrap", fontSize: "0.82rem" }}>{row.backend_team || "—"}</td>
                          <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                            {row.ms1_amount ? fmtAmt.format(row.ms1_amount) : "—"}
                          </td>
                          <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                            {row.ms2_amount ? fmtAmt.format(row.ms2_amount) : "—"}
                          </td>
                        </>
                      )}
                      <td style={{ fontFamily: "monospace", fontSize: "0.76rem", whiteSpace: "nowrap" }}>{row.system_id || "—"}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{row.po_no}</td>
                      <td>{row.shipment_number}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{row.item_code}</td>
                      <td style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.item_description}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{row.activity_type || "—"}</td>
                      <td style={{ textAlign: "right" }}>{row.qty}</td>
                      <td style={{ textAlign: "right" }}>{fmt.format(row.rate || 0)}</td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{fmtAmt.format(row.line_amount || 0)}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{row.project_code}</td>
                      <td>{row.project_domain || "—"}</td>
                      <td>{row.huawei_im || "—"}</td>
                      <td>{row.site_code}</td>
                      <td style={{ fontSize: "0.82rem", maxWidth: 140 }} title={row.center_area || ""}>
                        {row.center_area || "—"}
                      </td>
                      <td style={{ fontSize: "0.82rem" }}>{row.region_type || "—"}</td>
                      {showDispatched && (
                        <>
                          <td><DispatchModeBadge mode={row.dispatch_mode} /></td>
                          <td style={{ fontSize: "0.82rem", whiteSpace: "nowrap" }} title={row.dispatched_im || ""}>
                            {row.dispatched_im_full_name || imLabelById[row.dispatched_im] || row.dispatched_im || "—"}
                          </td>
                          <td style={{ fontSize: "0.82rem", whiteSpace: "nowrap" }}>
                            {row.dispatch_target_month
                              ? new Date(row.dispatch_target_month).toLocaleDateString("en", { month: "short", year: "numeric" })
                              : "—"}
                          </td>
                        </>
                      )}
                      <td onClick={e => e.stopPropagation()}>
                        <button className="btn-secondary"
                          style={{ fontSize: "0.73rem", padding: "3px 10px", whiteSpace: "nowrap" }}
                          onClick={() => setDetailRow(row)}>
                          View
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {rows.length > 0 && (
                <tfoot>
                  {/* checkbox·POID·Status·PO Status = 4 fixed columns, then (All Lines tab only)
                      Plan Status·Plan Date·PIC Status (MS1)·PIC Status (MS2)·Work Type·
                      Subcon Status·Subcon Completed On·Backend Team·MS1 Amount·MS2 Amount = 10
                      more, then System ID·PO No·Shipment No·Item Code·Description·Activity
                      Type·Qty·Rate·Amount = 9 fixed, then everything after Amount
                      (Project..Action, count varies by showDispatched) */}
                  <tr>
                    <td
                      style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", fontSize: "0.8rem", color: "#64748b" }} />
                    <td
                      style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", fontSize: "0.8rem", color: "#64748b" }}>
                      <strong>{displayedCount}</strong> row{displayedCount !== 1 ? "s" : ""}
                      {activeTab === "Dispatched" && autoRows.length > 0 && (
                        <span style={{ marginLeft: 16, color: "#6366f1", fontWeight: 600 }}>
                          Auto: {autoRows.length} · Manual: {displayedCount - autoRows.length}
                        </span>
                      )}
                    </td>
                    <td
                      style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", fontSize: "0.8rem", color: "#64748b" }} />
                    <td
                      style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", fontSize: "0.8rem", color: "#64748b" }} />
                    {activeTab === "all" && (
                      <>
                        <td style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", fontSize: "0.8rem", color: "#64748b" }} />
                        <td style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", fontSize: "0.8rem", color: "#64748b" }} />
                        <td style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", fontSize: "0.8rem", color: "#64748b" }} />
                        <td style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", fontSize: "0.8rem", color: "#64748b" }} />
                        <td style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", fontSize: "0.8rem", color: "#64748b" }} />
                        <td style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", fontSize: "0.8rem", color: "#64748b" }} />
                        <td style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", fontSize: "0.8rem", color: "#64748b" }} />
                        <td style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", fontSize: "0.8rem", color: "#64748b" }} />
                        <td style={{ textAlign: "right", fontWeight: 700, padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0" }}>{fmtAmt.format(totals.ms1Amount || 0)}</td>
                        <td style={{ textAlign: "right", fontWeight: 700, padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0" }}>{fmtAmt.format(totals.ms2Amount || 0)}</td>
                      </>
                    )}
                    <td
                      style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", fontSize: "0.8rem", color: "#64748b" }} />
                    <td
                      style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", fontSize: "0.8rem", color: "#64748b" }} />
                    <td
                      style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", fontSize: "0.8rem", color: "#64748b" }} />
                    <td
                      style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", fontSize: "0.8rem", color: "#64748b" }} />
                    <td
                      style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", fontSize: "0.8rem", color: "#64748b" }} />
                    <td
                      style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", fontSize: "0.8rem", color: "#64748b" }} />
                    <td style={{ textAlign: "right", fontWeight: 700, padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0" }}>{fmt.format(totals.qty)}</td>{/* Qty */}
                    <td style={{ background: "#f8fafc", borderTop: "1px solid #e2e8f0" }} />{/* Rate */}
                    <td style={{ textAlign: "right", fontWeight: 700, padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0" }}>{fmtAmt.format(totals.amount)}</td>{/* Amount */}
                    {/* Project..Action — one <td> per remaining column (DataTablePro's footer
                        colspan logic treats every non-first cell as exactly one real column;
                        a colSpan here would desync it from the header and misplace the row) */}
                    {Array.from({ length: colCount - 13 - (activeTab === "all" ? 10 : 0) }).map((_, i) => (
                      <td key={i} style={{ background: "#f8fafc", borderTop: "1px solid #e2e8f0" }} />
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
            );
          })()}
        </DataTableWrapper>
        <TableRowsLimitFooter
          placement="tableCard"
          loadedCount={displayedCount}
          filteredCount={displayedCount}
          filterActive={!!tableSearch || !!projectFilter.length || !!imFilter.length || !!duidFilter.length || !!itemCodeFilter.length || !!statusFilter.length || !!fromDate || !!toDate}
          value={effectiveRowLimit}
          onChange={confirmRowLimit}
        />
      </div>
    </div>
  );
}
