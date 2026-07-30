import { useEffect, useState, useCallback, useMemo } from "react";
import DataTableWrapper from "../../components/DataTableWrapper";
import { pmApi } from "../../services/api";
import { useTableRowLimit } from "../../context/TableRowLimitContext";
import TableRowsLimitFooter from "../../components/TableRowsLimitFooter";
import { useDebounced } from "../../hooks/useDebounced";
import useFilterOptions from "../../hooks/useFilterOptions";
import SearchableSelect from "../../components/SearchableSelect";
import RecordDetailView, { DetailHero, DetailStatTile } from "../../components/RecordDetailView";
import DateRangePicker from "../../components/DateRangePicker";
import ExportExcelButton from "../../components/ExportExcelButton";
import { handleSearchPaste } from "../../utils/searchPaste";

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
  if (s.includes("complete") || s.includes("approved") || s.includes("dispatched")) return { bg: "#ecfdf5", fg: "#047857" };
  if (s.includes("cancel") || s.includes("reject") || s.includes("fail")) return { bg: "#fef2f2", fg: "#b91c1c" };
  if (s.includes("progress") || s.includes("planned") || s.includes("auto")) return { bg: "#eff6ff", fg: "#1d4ed8" };
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

// Colors for the richer "Current Stage" column (current_stage) - covers PIC
// sub-statuses and Rollout Plan statuses in addition to the plain
// po_line_status values already handled by poLineStatusTone above.
function currentStageTone(value) {
  const s = String(value || "");
  if (s.startsWith("PIC:")) return { bg: "#f5f3ff", fg: "#6d28d9" };
  if (s === "Work Done") return { bg: "#ecfeff", fg: "#0e7490" };
  const sl = s.toLowerCase();
  if (sl === "in execution") return { bg: "#eff6ff", fg: "#1d4ed8" };
  if (sl === "planned") return { bg: "#eff6ff", fg: "#1d4ed8" };
  if (sl === "planning with issue" || sl === "overdue" || sl === "not attended") return { bg: "#fffbeb", fg: "#b45309" };
  if (sl === "completed") return { bg: "#ecfdf5", fg: "#047857" };
  return poLineStatusTone(value);
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
];

const inputStyle = {
  width: "100%", padding: "9px 12px",
  border: "1px solid #e2e8f0", borderRadius: 7,
  fontSize: "0.88rem", background: "#f8fafc",
};
const labelStyle = { display: "block", fontSize: "0.78rem", fontWeight: 600, marginBottom: 5, color: "#475569" };

export default function PODispatch() {
  const { rowLimit } = useTableRowLimit();
  const [activeTab, setActiveTab] = useState("New");
  const showDispatched = activeTab === "Dispatched" || activeTab === "all";
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [imList, setImList] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [tableSearch, setTableSearch] = useState("");
  const tableSearchDebounced = useDebounced(tableSearch, 300);
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
    const key = `admin-po-dispatch-v1-${showDispatched ? "full" : "basic"}`;
    const onFiltersChanged = (e) => {
      if (e.detail?.tableKey !== key) return;
      setColumnFilters(e.detail.filters || {});
    };
    document.addEventListener("tablepro:filters-changed", onFiltersChanged);
    return () => document.removeEventListener("tablepro:filters-changed", onFiltersChanged);
  }, [showDispatched]);
  // "New" (basic columns) and "Dispatched"/"all" (full columns) are now
  // distinct table identities (see data-table-key above) - don't carry a
  // typed column filter across that boundary.
  useEffect(() => {
    setColumnFilters({});
  }, [showDispatched]);
  const activeColumnFilters = Object.fromEntries(
    Object.entries(columnFilters).filter(([, v]) => String(v || "").trim())
  );
  const columnFiltersKey = JSON.stringify(activeColumnFilters);
  const columnFiltersDebounced = useDebounced(columnFiltersKey, 300);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSelected(new Set());
    (async () => {
      try {
        const status = activeTab;
        const portal = { intake_tab: String(status || "").toLowerCase() };
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
        const [poLines, ims] = await Promise.all([
          pmApi.listPOIntakeLines(status, rowLimit, portal),
          pmApi.listIMMasters({ status: "Active" }),
        ]);
        if (!cancelled) setRows(Array.isArray(poLines) ? poLines : []);
        if (!cancelled) setImList(Array.isArray(ims) ? ims : []);
      } catch (err) {
        if (!cancelled) setError(err.message || "Failed to load data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeTab, rowLimit, tableSearchDebounced, projectFilter, imFilter, duidFilter, itemCodeFilter, statusFilter, fromDate, toDate, refreshKey, columnFiltersDebounced]);

  useEffect(() => {
    if (!convertProject) { setConvertProjectItemCodes([]); return; }
    pmApi.getItemCodesForProject(convertProject)
      .then((codes) => setConvertProjectItemCodes(Array.isArray(codes) ? codes : []))
      .catch(() => setConvertProjectItemCodes([]));
  }, [convertProject]);

  function switchTab(tab) { setActiveTab(tab); setSelected(new Set()); }

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
    const visible = rows.filter((r) => !dtpHidden.has(r.name));
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

  const autoRows = rows.filter(r => r.dispatch_mode === "Auto");
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
        `${summary}.${errCount ? ` ${errCount} error${errCount !== 1 ? "s" : ""} — check line data.` : ""}`,
      );
      setSelected(new Set());
      setShowAssignImModal(false);
      setBulkAssignIm("");
      loadData(activeTab);
    } catch (err) {
      showNotice("err", err.message || "Assign IM failed");
    } finally {
      setAssigningBulkIm(false);
    }
  }

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
          <div className="page-subtitle">Dispatch PO lines to an Implementation Manager; field team is chosen at rollout planning.</div>
        </div>
        <div className="page-actions">
          <ExportExcelButton filename={`po-dispatch-${activeTab}`} rows={rows} />
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
        {TABS.map(t => (
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
          <SearchableSelect multi value={projectFilter} onChange={setProjectFilter} options={projectOptions} placeholder="All Projects" minWidth={170} />
          <SearchableSelect multi value={imFilter} onChange={setImFilter} options={imSelectOptions.map((im) => ({ id: im.name, label: im.full_name || im.im_id || im.name }))} placeholder="All IMs" minWidth={170} />
          <SearchableSelect multi value={duidFilter} onChange={setDuidFilter} options={duidOptions} placeholder="All DUIDs" minWidth={160} />
          <SearchableSelect multi value={itemCodeFilter} onChange={setItemCodeFilter} options={itemCodeOptions} placeholder="All Item Codes" minWidth={160} />
          <SearchableSelect multi value={statusFilter} onChange={setStatusFilter} options={STATUS_OPTIONS} placeholder="All Status" minWidth={150} />
          <DateRangePicker value={{ from: fromDate, to: toDate }} onChange={({ from, to }) => { setFromDate(from); setToDate(to); }} />
          {hasFilters && (
            <button className="btn-secondary" style={{ fontSize: "0.8rem" }} onClick={() => { setTableSearch(""); setProjectFilter([]); setImFilter([]); setDuidFilter([]); setItemCodeFilter([]); setStatusFilter([]); setFromDate(""); setToDate(""); }}>
              Clear
            </button>
          )}
        </div>

        <div className="toolbar-actions">
          {/* Works across all 3 tabs on whatever's selected - routes each line
              by its own status (pending/dispatched/closed/cancelled). The
              main place this matters is "All Lines", where a selection can
              mix all of those at once. */}
          {selected.size > 0 && (
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

        <DataTableWrapper>
          {(() => {
            const colCount = showDispatched ? 20 : 17;
            return (
            <table className="data-table" data-table-key={`admin-po-dispatch-v1-${showDispatched ? "full" : "basic"}`}>
              <thead>
                <tr>
                  <th style={{ width: 36 }}>
                    <input type="checkbox"
                      checked={selected.size === rows.length && rows.length > 0}
                      onChange={toggleAll}
                    />
                  </th>
                  <th>POID</th>
                  <th>Status</th>
                  <th>Current Stage</th>
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
                  <th>Action</th>
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
                ) : rows.map(row => {
                  const isAuto = row.dispatch_mode === "Auto";
                  return (
                    <tr key={row.name}
                      data-doc-name={row.name}
                      className={selected.has(row.name) ? "row-selected" : ""}
                      onClick={() => toggleRow(row.name)}
                      style={{
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
                      <td style={{ whiteSpace: "nowrap" }}>
                        {row.current_stage ? (() => {
                          const t = currentStageTone(row.current_stage);
                          return (
                            <span style={{ display: "inline-block", padding: "2px 9px", borderRadius: 999, fontSize: "0.72rem", fontWeight: 700, background: t.bg, color: t.fg }}>
                              {row.current_stage}
                            </span>
                          );
                        })() : "—"}
                      </td>
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
                  <tr>
                    <td colSpan={colCount}
                      style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", fontSize: "0.8rem", color: "#64748b" }}>
                      <strong>{rows.length}</strong> row{rows.length !== 1 ? "s" : ""}
                      {activeTab === "Dispatched" && autoRows.length > 0 && (
                        <span style={{ marginLeft: 16, color: "#6366f1", fontWeight: 600 }}>
                          Auto: {autoRows.length} · Manual: {rows.length - autoRows.length}
                        </span>
                      )}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
            );
          })()}
        </DataTableWrapper>
        <TableRowsLimitFooter
          placement="tableCard"
          loadedCount={rows.length}
          filteredCount={rows.length}
          filterActive={!!tableSearch || !!projectFilter.length || !!imFilter.length || !!duidFilter.length || !!itemCodeFilter.length || !!statusFilter.length || !!fromDate || !!toDate}
        />
      </div>
    </div>
  );
}
