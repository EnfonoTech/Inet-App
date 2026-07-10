import { useCallback, useEffect, useMemo, useState } from "react";
import DataTableWrapper from "../../components/DataTableWrapper";
import { useAuth } from "../../context/AuthContext";
import { useTableRowLimit } from "../../context/TableRowLimitContext";
import { useDebounced } from "../../hooks/useDebounced";
import { pmApi } from "../../services/api";
import useFilterOptions from "../../hooks/useFilterOptions";
import SearchableSelect from "../../components/SearchableSelect";
import ExportExcelButton from "../../components/ExportExcelButton";
import DateRangePicker from "../../components/DateRangePicker";
import RecordDetailView from "../../components/RecordDetailView";
import IMNoteCallout from "../../components/IMNoteCallout";
import DispatchVisitHistory from "../../components/DispatchVisitHistory";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 2, minimumFractionDigits: 2 });

function todayMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

function monthOptions() {
  const out = [];
  const now = new Date();
  for (let i = 0; i < 12; i += 1) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
    out.push({ id: value, label });
  }
  return out;
}

function StatusBadge({ value, bg, fg, bd }) {
  if (!value) return <span style={{ color: "#94a3b8" }}>—</span>;
  const b = bg || "#f1f5f9", f = fg || "#475569", border = bd || "#e2e8f0";
  return (
    <span style={{ display: "inline-block", padding: "2px 9px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: b, color: f, border: `1px solid ${border}` }}>
      {value}
    </span>
  );
}

function fmtFileSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function billingStatusFromPicStatus(picStatus) {
  if (!picStatus) return null;
  if (["Commercial Invoice Closed", "PO Line Canceled"].includes(picStatus)) return "Closed";
  if (["Commercial Invoice Submitted", "Ready for Invoice", "Under I-BUY", "Under ISDP"].includes(picStatus)) return "Invoiced";
  return "Pending";
}

function billingStatusColor(bs) {
  if (bs === "Invoiced") return { bg: "#eff6ff", fg: "#1d4ed8", bd: "#bfdbfe" };
  if (bs === "Closed") return { bg: "#ecfdf5", fg: "#047857", bd: "#a7f3d0" };
  return { bg: "#fef9c3", fg: "#92400e", bd: "#fde68a" };
}

function issueFlagColor(flag) {
  if (!flag) return null;
  if (/commercial|billing|invoice/i.test(flag)) return { bg: "#fff1f2", fg: "#be123c", bd: "#fecdd3" };
  if (/technical|quality|qc/i.test(flag)) return { bg: "#fffbeb", fg: "#92400e", bd: "#fde68a" };
  return { bg: "#fef2f2", fg: "#dc2626", bd: "#fca5a5" };
}

function dispatchStatusColor(status) {
  const s = (status || "").toLowerCase().replace(/\s+/g, "-");
  const map = {
    "new": { bg: "#f1f5f9", fg: "#475569", bd: "#e2e8f0" },
    "pending": { bg: "#f1f5f9", fg: "#475569", bd: "#e2e8f0" },
    "dispatched": { bg: "#eff6ff", fg: "#1d4ed8", bd: "#bfdbfe" },
    "planned": { bg: "#f0f9ff", fg: "#0369a1", bd: "#bae6fd" },
    "in-execution": { bg: "#f0fdf4", fg: "#15803d", bd: "#bbf7d0" },
    "backend-assigned": { bg: "#faf5ff", fg: "#7c3aed", bd: "#ddd6fe" },
    "completed": { bg: "#ecfdf5", fg: "#047857", bd: "#a7f3d0" },
    "closed": { bg: "#f8fafc", fg: "#94a3b8", bd: "#e2e8f0" },
    "cancelled": { bg: "#fef2f2", fg: "#b91c1c", bd: "#fecaca" },
    "cancelled-(in-system)": { bg: "#fef2f2", fg: "#b91c1c", bd: "#fecaca" },
  };
  return map[s] || { bg: "#fefce8", fg: "#92400e", bd: "#fde68a" };
}

function planStatusColor(status) {
  const s = (status || "").toLowerCase();
  if (s === "completed") return { bg: "#ecfdf5", fg: "#047857", bd: "#a7f3d0" };
  if (s === "in execution") return { bg: "#eff6ff", fg: "#1d4ed8", bd: "#bfdbfe" };
  if (s === "planned") return { bg: "#f0f9ff", fg: "#0369a1", bd: "#bae6fd" };
  if (s === "cancelled") return { bg: "#fef2f2", fg: "#b91c1c", bd: "#fecaca" };
  return { bg: "#fefce8", fg: "#92400e", bd: "#fde68a" };
}

// ── Shared Modal shell ────────────────────────────────────────────────────
function Modal({ open, onClose, title, children, width = 480, footer = null }) {
  if (!open) return null;
  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
      onClick={onClose}
    >
      <div
        style={{ background: "#fff", borderRadius: 14, width, maxWidth: "calc(100vw - 40px)", maxHeight: "calc(100dvh - 40px)", boxShadow: "0 20px 60px rgba(0,0,0,0.22)", display: "flex", flexDirection: "column", overflow: "hidden" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 24px", borderBottom: "1px solid #e2e8f0", flexShrink: 0 }}>
          <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 700 }}>{title}</h3>
          <button type="button" onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8" }}>&times;</button>
        </div>
        <div style={{ padding: "20px 24px", overflowY: "auto", flex: "1 1 auto", minHeight: 0 }}>
          {children}
        </div>
        {footer && (
          <div style={{ padding: "14px 24px", borderTop: "1px solid #e2e8f0", display: "flex", gap: 10, justifyContent: "flex-end", flexShrink: 0, background: "#fff" }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Field helpers for detail popup ───────────────────────────────────────
function FieldRow({ label, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ fontSize: 13, color: "#0f172a", fontWeight: 500 }}>{children || <span style={{ color: "#cbd5e1" }}>—</span>}</div>
    </div>
  );
}

export default function IMPOIntake() {
  const { imName } = useAuth();
  const { rowLimit } = useTableRowLimit();

  // ── Tab ─────────────────────────────────────────────────────────────────
  const [tab, setTab] = useState("intake"); // "intake" | "dummy" | "overview"

  // ── Intake tab state ─────────────────────────────────────────────────
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [search, setSearch] = useState("");
  const searchDebounced = useDebounced(search, 300);
  const [projectFilter, setProjectFilter] = useState([]);
  const [duidFilter, setDuidFilter] = useState([]);
  const [modeFilter, setModeFilter] = useState("all");
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [assignMonth, setAssignMonth] = useState(todayMonth());
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState(null);
  const [toastMsg, setToastMsg] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const load = useCallback(() => setRefreshKey((k) => k + 1), []);

  // ── Backend-team assignment (intake tab) ─────────────────────────────
  const [canBackend, setCanBackend] = useState(false);
  const [showBackendModal, setShowBackendModal] = useState(false);
  const [backendTeams, setBackendTeams] = useState([]);
  const [backendTeamsLoading, setBackendTeamsLoading] = useState(false);
  const [backendTeamId, setBackendTeamId] = useState("");
  const [backendRemark, setBackendRemark] = useState("");
  const [backendBusy, setBackendBusy] = useState(false);
  const [backendError, setBackendError] = useState(null);

  // ── Direct Close (intake tab) ────────────────────────────────────────
  const [canDirectClose, setCanDirectClose] = useState(false);
  const [showDcModal, setShowDcModal] = useState(false);
  const [dcType, setDcType] = useState("INET");
  const [dcSubcontractor, setDcSubcontractor] = useState("");
  const [dcSubconOptions, setDcSubconOptions] = useState([]);
  const [dcSubconLoading, setDcSubconLoading] = useState(false);
  const [dcNote, setDcNote] = useState("");
  const [dcBusy, setDcBusy] = useState(false);
  const [dcError, setDcError] = useState(null);

  // ── Dummy tab state ──────────────────────────────────────────────────
  const [dummyRows, setDummyRows] = useState([]);
  const [dummyLoading, setDummyLoading] = useState(false);
  const [dummyError, setDummyError] = useState(null);
  const [dummySearch, setDummySearch] = useState("");
  const dummySearchDebounced = useDebounced(dummySearch, 300);
  const [dummyProjectFilter, setDummyProjectFilter] = useState([]);
  const [dummyDomainFilter, setDummyDomainFilter] = useState([]);
  const [dummyDuidFilter, setDummyDuidFilter] = useState([]);
  const [dummyFromDate, setDummyFromDate] = useState("");
  const [dummyToDate, setDummyToDate] = useState("");
  const [dummyStatusFilter, setDummyStatusFilter] = useState("open"); // "open"|"mapped"|"all"
  const [dummyRefreshKey, setDummyRefreshKey] = useState(0);
  const loadDummy = useCallback(() => setDummyRefreshKey((k) => k + 1), []);
  const [planSummaries, setPlanSummaries] = useState({});
  const [dummyTeamFilter, setDummyTeamFilter] = useState([]);

  // ── Overview tab state ───────────────────────────────────────────────
  const [ovRows, setOvRows] = useState([]);
  const [ovLoading, setOvLoading] = useState(false);
  const [ovError, setOvError] = useState(null);
  const [ovSearch, setOvSearch] = useState("");
  const ovSearchDebounced = useDebounced(ovSearch, 300);
  const [ovProjectFilter, setOvProjectFilter] = useState([]);
  const [ovDomainFilter, setOvDomainFilter] = useState([]);
  const [ovStatusFilter, setOvStatusFilter] = useState([]);
  const [ovModeFilter, setOvModeFilter] = useState("all"); // kept for API but hidden from UI
  const [ovPlanStatusFilter, setOvPlanStatusFilter] = useState([]);
  const [ovDuidFilter, setOvDuidFilter] = useState([]);
  const [ovTeamFilter, setOvTeamFilter] = useState([]);
  const [ovFromDate, setOvFromDate] = useState("");
  const [ovToDate, setOvToDate] = useState("");
  const [ovShowClosed, setOvShowClosed] = useState(true);
  const [ovDirectCloseOnly, setOvDirectCloseOnly] = useState(false);
  const [ovRefreshKey, setOvRefreshKey] = useState(0);
  const loadOv = useCallback(() => setOvRefreshKey((k) => k + 1), []);
  const [ovPlanSummaries, setOvPlanSummaries] = useState({});

  // Create dummy PO
  const [showCreateDummy, setShowCreateDummy] = useState(false);
  const [dummyBusy, setDummyBusy] = useState(false);
  const [dummyErr, setDummyErr] = useState(null);
  const [projectsForDummy, setProjectsForDummy] = useState([]);
  const [duidsForDummy, setDuidsForDummy] = useState([]);
  const [duidSearch, setDuidSearch] = useState("");
  const [itemsForDummy, setItemsForDummy] = useState([]);
  const [itemSearch, setItemSearch] = useState("");
  const [dummyForm, setDummyForm] = useState({ project_code: "", target_month: "", site_code: "", duid_text: "", item_code: "", item_description: "", manager_remark: "" });

  // Map dummy PO
  const [mapForRow, setMapForRow] = useState(null);
  const [mapLines, setMapLines] = useState([]);
  const [mapLineId, setMapLineId] = useState("");
  const [mapBusy, setMapBusy] = useState(false);
  const [mapErr, setMapErr] = useState(null);
  const [mapLinesLoading, setMapLinesLoading] = useState(false);

  // Intake tab view popup (IMPlanning-style)
  const [intakeViewRow, setIntakeViewRow] = useState(null);

  // Dummy detail popup
  const [detailRow, setDetailRow] = useState(null);
  const [detailPlans, setDetailPlans] = useState([]);
  const [detailPlansLoading, setDetailPlansLoading] = useState(false);
  const [detailExtras, setDetailExtras] = useState(null);
  const [detailExtrasLoading, setDetailExtrasLoading] = useState(false);

  // ── Intake load ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!imName) { setRows([]); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const TERMINAL_STATUSES = ["Backend Assigned", "Closed", "Cancelled", "Cancelled (in System)", "Completed"];
        const filters = [["im", "=", imName], ["dispatch_status", "not in", TERMINAL_STATUSES]];
        const portal = { has_target_month: "no" };
        if (searchDebounced.trim()) portal.search = searchDebounced.trim();
        if (modeFilter !== "all") portal.dispatch_mode = modeFilter;
        if (projectFilter.length) portal.project_code = projectFilter;
        if (duidFilter.length) portal.site_code = duidFilter;
        const res = await pmApi.listPODispatches(filters, rowLimit, portal);
        if (cancelled) return;
        const arr = Array.isArray(res) ? res : [];
        const TERMINAL = new Set(TERMINAL_STATUSES);
        setRows(arr.filter((r) => !TERMINAL.has(r.dispatch_status || "")));
        setSelected(new Set());
      } catch (err) {
        if (!cancelled) setError(err.message || "Failed to load PO intake");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [imName, rowLimit, searchDebounced, modeFilter, projectFilter, duidFilter, refreshKey]);

  // ── Dummy load ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!imName || tab !== "dummy") return;
    let cancelled = false;
    setDummyLoading(true);
    setDummyError(null);
    (async () => {
      try {
        const preset = dummyStatusFilter === "mapped" ? "mapped_dummy"
          : dummyStatusFilter === "all" ? "dummy_any"
          : "dummy";
        const portal = { dummy_preset: preset };
        if (dummySearchDebounced.trim()) portal.search = dummySearchDebounced.trim();
        if (dummyProjectFilter.length) portal.project_code = dummyProjectFilter;
        if (dummyDuidFilter.length) portal.site_code = dummyDuidFilter;
        if (dummyFromDate) portal.from_date = dummyFromDate;
        if (dummyToDate) portal.to_date = dummyToDate;
        const res = await pmApi.listPODispatches([["im", "=", imName]], rowLimit, portal);
        if (!cancelled) setDummyRows(Array.isArray(res) ? res : []);
      } catch (err) {
        if (!cancelled) setDummyError(err.message || "Failed to load dummy POs");
      } finally {
        if (!cancelled) setDummyLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [imName, tab, rowLimit, dummyStatusFilter, dummySearchDebounced, dummyProjectFilter, dummyDomainFilter, dummyDuidFilter, dummyFromDate, dummyToDate, dummyRefreshKey]);

  // ── Overview load ────────────────────────────────────────────────────
  useEffect(() => {
    if (!imName || tab !== "overview") return;
    let cancelled = false;
    setOvLoading(true);
    setOvError(null);
    (async () => {
      try {
        const filters = [["im", "=", imName]];
        const portal = { dummy_preset: "all" };
        if (ovSearchDebounced.trim()) portal.search = ovSearchDebounced.trim();
        if (ovProjectFilter.length) portal.project_code = ovProjectFilter;
        if (ovDuidFilter.length) portal.site_code = ovDuidFilter;
        if (ovFromDate) portal.from_date = ovFromDate;
        if (ovToDate) portal.to_date = ovToDate;
        const res = await pmApi.listPODispatches(filters, rowLimit, portal);
        if (!cancelled) setOvRows(Array.isArray(res) ? res : []);
      } catch (err) {
        if (!cancelled) setOvError(err.message || "Failed to load POIDs");
      } finally {
        if (!cancelled) setOvLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [imName, tab, rowLimit, ovSearchDebounced, ovProjectFilter, ovDuidFilter, ovFromDate, ovToDate, ovRefreshKey]);

  // ── Overview plan summaries ──────────────────────────────────────────
  useEffect(() => {
    if (!ovRows.length) { setOvPlanSummaries({}); return; }
    let cancelled = false;
    pmApi.getDispatchPlanSummaries(ovRows.map((r) => r.name)).then((res) => {
      if (!cancelled) setOvPlanSummaries(res && typeof res === "object" ? res : {});
    }).catch(() => { if (!cancelled) setOvPlanSummaries({}); });
    return () => { cancelled = true; };
  }, [ovRows]);

  // ── Backend capability check ─────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    pmApi.getMyBackendCapability().then((res) => {
      if (!cancelled) setCanBackend(!!res?.can_assign_backend);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // ── Direct Close capability check ────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    pmApi.getMyDirectCloseCapability().then((res) => {
      if (!cancelled) setCanDirectClose(!!res?.can_direct_close);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // ── Create dummy: load project list ─────────────────────────────────
  useEffect(() => {
    if (!showCreateDummy || !imName) return;
    const fields = JSON.stringify(["name", "project_code", "project_name", "implementation_manager"]);
    const filters = JSON.stringify([["implementation_manager", "=", imName]]);
    fetch(`/api/resource/Project Control Center?filters=${encodeURIComponent(filters)}&fields=${encodeURIComponent(fields)}&limit_page_length=200&order_by=modified+desc`, { credentials: "include" })
      .then((r) => r.json())
      .then((json) => setProjectsForDummy(Array.isArray(json?.data) ? json.data : []))
      .catch(() => setProjectsForDummy([]));
  }, [showCreateDummy, imName]);

  // ── Create dummy: DUID search ────────────────────────────────────────
  useEffect(() => {
    if (!showCreateDummy) return undefined;
    let cancelled = false;
    const q = (duidSearch || "").trim();
    (async () => {
      try {
        const fields = JSON.stringify(["name", "site_name", "center_area"]);
        let url = `/api/resource/DUID Master?fields=${encodeURIComponent(fields)}&limit_page_length=200&order_by=modified+desc`;
        if (q) url += `&filters=${encodeURIComponent(JSON.stringify([["name", "like", `%${q}%`]]))}`;
        const res = await fetch(url, { credentials: "include" });
        const json = await res.json();
        if (!cancelled) setDuidsForDummy(Array.isArray(json?.data) ? json.data : []);
      } catch {
        if (!cancelled) setDuidsForDummy([]);
      }
    })();
    return () => { cancelled = true; };
  }, [showCreateDummy, duidSearch]);

  // ── Create dummy: item search ────────────────────────────────────────
  useEffect(() => {
    if (!showCreateDummy) return undefined;
    let cancelled = false;
    pmApi.searchPOItems((itemSearch || "").trim()).then((res) => {
      if (!cancelled) setItemsForDummy(Array.isArray(res) ? res : []);
    }).catch(() => { if (!cancelled) setItemsForDummy([]); });
    return () => { cancelled = true; };
  }, [showCreateDummy, itemSearch]);

  // ── Map: load intake lines when row is set ───────────────────────────
  useEffect(() => {
    if (!mapForRow?.project_code) { setMapLines([]); setMapLineId(""); return undefined; }
    let cancelled = false;
    setMapLinesLoading(true);
    setMapErr(null);
    pmApi.listPoIntakeLinesForIMMap(mapForRow.project_code).then((list) => {
      if (!cancelled) { setMapLines(Array.isArray(list) ? list : []); setMapLineId(""); }
    }).catch((e) => {
      if (!cancelled) { setMapLines([]); setMapErr(e.message || "Failed to load PO lines"); }
    }).finally(() => { if (!cancelled) setMapLinesLoading(false); });
    return () => { cancelled = true; };
  }, [mapForRow]);

  // ── Detail: load rollout plans + extras when a row is opened ──────────
  useEffect(() => {
    if (!detailRow) { setDetailPlans([]); setDetailExtras(null); return; }
    let cancelled = false;
    setDetailPlansLoading(true);
    setDetailExtrasLoading(true);
    pmApi.listDispatchVisits(detailRow.name, "").then((res) => {
      if (!cancelled) setDetailPlans(Array.isArray(res) ? res : []);
    }).catch(() => {
      if (!cancelled) setDetailPlans([]);
    }).finally(() => { if (!cancelled) setDetailPlansLoading(false); });
    pmApi.getPoidDetailExtras(detailRow.name).then((res) => {
      if (!cancelled) setDetailExtras(res && typeof res === "object" ? res : null);
    }).catch(() => {
      if (!cancelled) setDetailExtras(null);
    }).finally(() => { if (!cancelled) setDetailExtrasLoading(false); });
  }, [detailRow]);

  // ── Bulk plan summaries for dummy tab ─────────────────────────────────
  useEffect(() => {
    if (!dummyRows.length) { setPlanSummaries({}); return; }
    let cancelled = false;
    pmApi.getDispatchPlanSummaries(dummyRows.map((r) => r.name)).then((res) => {
      if (!cancelled) setPlanSummaries(res && typeof res === "object" ? res : {});
    }).catch(() => { if (!cancelled) setPlanSummaries({}); });
    return () => { cancelled = true; };
  }, [dummyRows]);

  // ── Create dummy: open & reset ───────────────────────────────────────
  function openCreateDummy() {
    setDummyErr(null);
    setDummyForm({ project_code: "", target_month: todayMonth(), site_code: "", duid_text: "", item_code: "", item_description: "", manager_remark: "" });
    setDuidsForDummy([]);
    setDuidSearch("");
    setItemsForDummy([]);
    setItemSearch("");
    setShowCreateDummy(true);
  }

  async function submitCreateDummy() {
    if (!dummyForm.project_code) { setDummyErr("Select a project."); return; }
    setDummyBusy(true);
    setDummyErr(null);
    try {
      await pmApi.createIMDummyPODispatch({
        project_code: dummyForm.project_code,
        target_month: dummyForm.target_month || undefined,
        site_code: dummyForm.site_code || dummyForm.duid_text || undefined,
        item_code: dummyForm.item_code || undefined,
        item_description: dummyForm.item_description || undefined,
        manager_remark: dummyForm.manager_remark || undefined,
      });
      setShowCreateDummy(false);
      setToastMsg("Dummy PO created.");
      setTimeout(() => setToastMsg(null), 4000);
      loadDummy();
    } catch (e) {
      setDummyErr(e.message || "Could not create dummy PO");
    } finally {
      setDummyBusy(false);
    }
  }

  // ── Map dummy ─────────────────────────────────────────────────────────
  async function submitMapDummy() {
    if (!mapForRow || !mapLineId) return;
    setMapBusy(true);
    setMapErr(null);
    try {
      const res = await pmApi.mapIMDummyPoToIntakeLine({ dummy_po_dispatch: mapForRow.name, po_intake_line: mapLineId });
      setMapForRow(null);
      setDetailRow(null);
      const oid = (res?.original_dummy_poid || "").trim();
      const pid = (res?.poid || res?.name || "").trim();
      setToastMsg(oid ? `Mapped. POID ${pid}. Original dummy POID: ${oid}.` : "Dummy PO mapped. POID updated.");
      setTimeout(() => setToastMsg(null), 4500);
      loadDummy();
    } catch (e) {
      setMapErr(e.message || "Map failed");
    } finally {
      setMapBusy(false);
    }
  }

  // ── Intake helpers ────────────────────────────────────────────────────
  async function openBackendModal() {
    if (selected.size < 1) return;
    setBackendError(null);
    setBackendTeamId("");
    setBackendRemark("");
    setShowBackendModal(true);
    setBackendTeamsLoading(true);
    try {
      const list = await pmApi.listBackendTeamsForPicker();
      setBackendTeams(Array.isArray(list) ? list : []);
    } catch (err) {
      setBackendError(err.message || "Failed to load backend teams");
      setBackendTeams([]);
    } finally {
      setBackendTeamsLoading(false);
    }
  }

  async function submitBackend() {
    if (selected.size < 1 || !backendTeamId) return;
    const ids = Array.from(selected);
    const blocked = rows.filter((r) => selected.has(r.name) && ["Closed", "Completed"].includes(r.dispatch_status));
    if (blocked.length > 0) {
      setBackendError(`Cannot assign: ${blocked.length} POID(s) have status ${[...new Set(blocked.map((r) => r.dispatch_status))].join(", ")}. Deselect to continue.`);
      return;
    }
    setBackendBusy(true);
    setBackendError(null);
    try {
      const res = await pmApi.assignBackend(ids, backendTeamId, backendRemark);
      const summary = res?.summary || {};
      const okN = summary.updated_count ?? 0;
      const errN = summary.error_count ?? 0;
      if (errN === 0) {
        setShowBackendModal(false);
        setToastMsg(`Assigned ${okN} POID${okN !== 1 ? "s" : ""} to backend team ${summary.backend_team_name || backendTeamId}.`);
        setTimeout(() => setToastMsg(null), 4500);
        setSelected(new Set());
        await load();
      } else {
        const firstErr = (res?.errors || [])[0];
        setBackendError(`${okN} assigned, ${errN} failed (${firstErr ? `${firstErr.poid}: ${firstErr.error}` : "see errors"})`);
        if (okN > 0) await load();
      }
    } catch (err) {
      setBackendError(err.message || "Failed to assign to backend");
    } finally {
      setBackendBusy(false);
    }
  }

  // ── Direct Close helpers ─────────────────────────────────────────────
  async function loadDcSubcontractors(type) {
    setDcSubconLoading(true);
    setDcSubcontractor("");
    try {
      const opts = await pmApi.getSubcontractorsByType(type);
      setDcSubconOptions(Array.isArray(opts) ? opts.map((o) => ({ id: o.name, label: o.label })) : []);
    } catch {
      setDcSubconOptions([]);
    } finally {
      setDcSubconLoading(false);
    }
  }

  async function openDcModal() {
    if (selected.size < 1) return;
    setDcError(null);
    setDcNote("");
    setDcType("INET");
    setDcSubcontractor("");
    setShowDcModal(true);
    await loadDcSubcontractors("INET");
  }

  async function submitDirectClose() {
    if (!dcSubcontractor) return;
    setDcBusy(true);
    setDcError(null);
    try {
      const ids = Array.from(selected);
      const res = await pmApi.directCloseDispatches(ids, dcType, dcSubcontractor, dcNote);
      const upd = res?.updated?.length || 0;
      const err = res?.errors?.length || 0;
      setShowDcModal(false);
      setSelected(new Set());
      setDcNote("");
      setDcSubcontractor("");
      setToastMsg(`Direct Close: ${upd} POID${upd !== 1 ? "s" : ""} closed${err ? `, ${err} failed` : ""}.`);
      setTimeout(() => setToastMsg(null), 4500);
      await load();
    } catch (e) {
      setDcError(e.message || "Failed to direct-close");
    } finally {
      setDcBusy(false);
    }
  }

  async function submitAssign() {
    if (!assignMonth || selected.size === 0) return;
    setAssigning(true);
    setAssignError(null);
    try {
      const res = await pmApi.assignIMTargetMonth({ dispatches: Array.from(selected), target_month: assignMonth });
      setShowAssignModal(false);
      const n = res?.updated || selected.size;
      setToastMsg(`Moved ${n} line${n !== 1 ? "s" : ""} to My Dispatches (target month ${assignMonth}).`);
      setTimeout(() => setToastMsg(null), 4500);
      setSelected(new Set());
      await load();
    } catch (err) {
      setAssignError(err.message || "Failed to assign target month");
    } finally {
      setAssigning(false);
    }
  }

  const { options: dispOpts } = useFilterOptions("PO Dispatch", ["project_code", "site_code"]);
  const projectOptions = dispOpts.project_code || [];
  const duidOptions = dispOpts.site_code || [];

  const hasFilters = !!(search || projectFilter.length || duidFilter.length || modeFilter !== "all");
  const hasDummyFilters = !!(dummySearch || dummyProjectFilter.length || dummyDomainFilter.length || dummyDuidFilter.length || dummyTeamFilter.length || dummyFromDate || dummyToDate || dummyStatusFilter !== "open");
  const domainOptions = useMemo(() => {
    const seen = new Set();
    return dummyRows
      .map((r) => r.project_domain).filter(Boolean)
      .filter((d) => { if (seen.has(d)) return false; seen.add(d); return true; })
      .sort();
  }, [dummyRows]);

  const teamOptions = useMemo(() => {
    const seen = new Set();
    return Object.values(planSummaries)
      .filter((ps) => ps?.team)
      .map((ps) => ({ id: ps.team, label: ps.team_name || ps.team }))
      .filter((o) => { if (seen.has(o.id)) return false; seen.add(o.id); return true; })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [planSummaries]);

  // ── Overview computed ────────────────────────────────────────────────
  const ovDomainOptions = useMemo(() => {
    const seen = new Set();
    return ovRows.map((r) => r.project_domain).filter(Boolean)
      .filter((d) => { if (seen.has(d)) return false; seen.add(d); return true; }).sort();
  }, [ovRows]);

  const ovStatusOptions = useMemo(() => {
    const seen = new Set();
    return ovRows.map((r) => r.dispatch_status || "Pending").filter(Boolean)
      .filter((s) => { if (seen.has(s)) return false; seen.add(s); return true; }).sort()
      .map((s) => ({ id: s, label: s }));
  }, [ovRows]);

  const ovDuidOptions = useMemo(() => {
    const seen = new Set();
    return ovRows.map((r) => r.site_code).filter(Boolean)
      .filter((d) => { if (seen.has(d)) return false; seen.add(d); return true; }).sort()
      .map((d) => ({ id: d, label: d }));
  }, [ovRows]);

  const ovTeamOptions = useMemo(() => {
    const seen = new Set();
    return Object.values(ovPlanSummaries)
      .filter((ps) => ps?.team)
      .map((ps) => ({ id: ps.team, label: ps.team_name || ps.team }))
      .filter((o) => { if (seen.has(o.id)) return false; seen.add(o.id); return true; })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [ovPlanSummaries]);

  const ovPlanStatusOptions = useMemo(() => {
    const seen = new Set();
    return Object.values(ovPlanSummaries)
      .map((ps) => ps?.plan_status).filter(Boolean)
      .filter((s) => { if (seen.has(s)) return false; seen.add(s); return true; }).sort()
      .map((s) => ({ id: s, label: s }));
  }, [ovPlanSummaries]);

  const ovFilteredRows = useMemo(() => {
    let r = ovRows;
    if (ovDomainFilter.length) r = r.filter((x) => ovDomainFilter.includes(x.project_domain));
    if (ovStatusFilter.length) r = r.filter((x) => ovStatusFilter.includes(x.dispatch_status || "Pending"));
    if (ovTeamFilter.length) r = r.filter((x) => { const ps = ovPlanSummaries[x.name]; return ps && ovTeamFilter.includes(ps.team); });
    if (ovPlanStatusFilter.length) r = r.filter((x) => { const ps = ovPlanSummaries[x.name]; return ps && ovPlanStatusFilter.includes(ps.plan_status); });
    if (ovDirectCloseOnly) r = r.filter((x) => !!x.direct_close_by);
    return r;
  }, [ovRows, ovDomainFilter, ovStatusFilter, ovTeamFilter, ovPlanStatusFilter, ovPlanSummaries, ovDirectCloseOnly]);

  const hasOvFilters = !!(ovSearch || ovProjectFilter.length || ovDomainFilter.length || ovStatusFilter.length || ovDuidFilter.length || ovTeamFilter.length || ovPlanStatusFilter.length || ovFromDate || ovToDate || ovDirectCloseOnly);
  const filteredDummyRows = useMemo(() => {
    let rows_ = dummyRows;
    if (dummyDomainFilter.length) rows_ = rows_.filter((r) => dummyDomainFilter.includes(r.project_domain));
    if (dummyTeamFilter.length) rows_ = rows_.filter((r) => {
      const ps = planSummaries[r.name];
      return ps && dummyTeamFilter.includes(ps.team);
    });
    return rows_;
  }, [dummyRows, dummyDomainFilter, dummyTeamFilter, planSummaries]);

  function toggleRow(name) {
    setSelected((prev) => { const next = new Set(prev); next.has(name) ? next.delete(name) : next.add(name); return next; });
  }
  function toggleAll() {
    setSelected(selected.size === rows.length && rows.length > 0 ? new Set() : new Set(rows.map((r) => r.name)));
  }

  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.name)), [rows, selected]);
  const selectedAmount = selectedRows.reduce((s, r) => s + (Number(r.line_amount) || 0), 0);

  // ── Tab button style ─────────────────────────────────────────────────
  function tabStyle(active) {
    return {
      padding: "8px 20px", fontSize: "0.86rem", fontWeight: 700, border: "none",
      borderBottom: active ? "2px solid #1d4ed8" : "2px solid transparent",
      background: "none", cursor: "pointer", color: active ? "#1d4ed8" : "#64748b",
      transition: "color 120ms",
    };
  }

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">PO Control</h1>
          <div className="page-subtitle">
            {tab === "intake"
              ? "Lines dispatched to you that still need a target month. Assign a month to move them to My Dispatches."
              : tab === "dummy"
              ? "Create and manage dummy POs. Map them to real PO intake lines when available."
              : "All your POIDs across every status — full overview."}
          </div>
        </div>
        <div className="page-actions">
          {tab === "intake" && <ExportExcelButton filename="im-po-intake" rows={rows} />}
          {tab === "dummy" && <ExportExcelButton filename="dummy-pos" rows={filteredDummyRows} />}
          {tab === "overview" && <ExportExcelButton filename="all-poids" rows={ovFilteredRows} />}
          {tab === "dummy" && (
            <button
              type="button"
              onClick={openCreateDummy}
              disabled={!imName}
              style={{ border: "none", borderRadius: 10, padding: "10px 18px", fontSize: "0.88rem", fontWeight: 700, color: "#fff", cursor: !imName ? "not-allowed" : "pointer", opacity: !imName ? 0.55 : 1, background: "linear-gradient(135deg,#6366f1 0%,#7c3aed 100%)", boxShadow: "0 4px 14px rgba(99,102,241,0.28)" }}
            >
              + Dummy PO
            </button>
          )}
          <button type="button" className="btn-secondary"
            onClick={tab === "dummy" ? loadDummy : tab === "overview" ? loadOv : load}
            disabled={tab === "intake" ? loading : tab === "dummy" ? dummyLoading : ovLoading}>
            {(tab === "intake" ? loading : tab === "dummy" ? dummyLoading : ovLoading) ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", borderBottom: "1px solid #e2e8f0", margin: "0 0 2px", paddingLeft: 4 }}>
        <button type="button" style={tabStyle(tab === "intake")} onClick={() => setTab("intake")}>PO Intake</button>
        <button type="button" style={tabStyle(tab === "dummy")} onClick={() => setTab("dummy")}>
          Dummy POs
          {dummyRows.length > 0 && tab !== "dummy" && (
            <span style={{ marginLeft: 6, background: "#fef3c7", color: "#92400e", borderRadius: 999, padding: "0px 7px", fontSize: 11, fontWeight: 700 }}>{dummyRows.length}</span>
          )}
        </button>
        <button type="button" style={tabStyle(tab === "overview")} onClick={() => setTab("overview")}>All POIDs</button>
      </div>

      {toastMsg && (
        <div className="notice success" style={{ margin: "8px 16px" }}>
          <span>✓</span> {toastMsg}
        </div>
      )}

      {/* ── PO INTAKE TOOLBAR ─────────────────────────────────────────── */}
      {tab === "intake" && (
        <div className="toolbar">
          <input type="search" placeholder="Search POID, PO, Item, Project, DUID…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select value={modeFilter} onChange={(e) => setModeFilter(e.target.value)}>
            <option value="all">All modes</option>
            <option value="Auto">Auto</option>
            <option value="Manual">Manual</option>
          </select>
          <SearchableSelect multi value={projectFilter} onChange={setProjectFilter} options={projectOptions} placeholder="All Projects" minWidth={170} />
          <SearchableSelect multi value={duidFilter} onChange={setDuidFilter} options={duidOptions} placeholder="All DUIDs" minWidth={150} />
          {hasFilters && (
            <button className="btn-secondary" onClick={() => { setSearch(""); setModeFilter("all"); setProjectFilter([]); setDuidFilter([]); }}>Clear</button>
          )}
          <div className="toolbar-actions">
            {selected.size > 0 && (
              <span style={{ fontSize: "0.78rem", color: "#64748b", whiteSpace: "nowrap" }}>
                {selected.size} selected · SAR {fmt.format(selectedAmount)}
              </span>
            )}
            <button type="button" className="btn-primary" disabled={selected.size === 0} onClick={() => { setAssignError(null); setShowAssignModal(true); }}>
              Dispatch ({selected.size})
            </button>
            {canBackend && (
              <button type="button" className="btn-secondary" disabled={selected.size < 1} onClick={openBackendModal} style={{ borderColor: "#a78bfa", color: "#7c3aed" }}>
                Assign to Backend ({selected.size})
              </button>
            )}
            {canDirectClose && (
              <button type="button" className="btn-secondary" disabled={selected.size < 1} onClick={openDcModal} style={{ borderColor: "#0284c7", color: "#0369a1" }}>
                Direct Close ({selected.size})
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── DUMMY POs TOOLBAR ─────────────────────────────────────────── */}
      {tab === "dummy" && (
        <div className="toolbar">
          <div role="tablist" style={{ display: "inline-flex", padding: 3, background: "#f1f5f9", borderRadius: 8, border: "1px solid #e2e8f0", flexShrink: 0 }}>
            {[
              { id: "open",   label: "Open"   },
              { id: "mapped", label: "Mapped" },
              { id: "all",    label: "All"    },
            ].map((opt) => {
              const active = dummyStatusFilter === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setDummyStatusFilter(opt.id)}
                  onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "#e2e8f0"; }}
                  onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
                  style={{ padding: "5px 16px", fontSize: "0.8rem", fontWeight: 700, border: "none", borderRadius: 6, cursor: "pointer", background: active ? (opt.id === "open" ? "#c2410c" : opt.id === "mapped" ? "#4338ca" : "#0f172a") : "transparent", color: active ? "#fff" : "#475569", boxShadow: active ? "0 1px 3px rgba(0,0,0,0.2)" : "none", transition: "background 120ms" }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          <input type="search" placeholder="Search POID, PO No, Item, Project, DUID…" value={dummySearch} onChange={(e) => setDummySearch(e.target.value)} />
          <SearchableSelect multi value={dummyProjectFilter} onChange={setDummyProjectFilter} options={projectOptions} placeholder="All Projects" minWidth={160} />
          <SearchableSelect multi value={dummyDomainFilter} onChange={setDummyDomainFilter} options={domainOptions} placeholder="All Domains" minWidth={150} />
          <SearchableSelect multi value={dummyDuidFilter} onChange={setDummyDuidFilter} options={duidOptions} placeholder="All DUIDs" minWidth={140} />
          {teamOptions.length > 0 && (
            <SearchableSelect multi value={dummyTeamFilter} onChange={setDummyTeamFilter} options={teamOptions} placeholder="All Teams" minWidth={140} />
          )}
          <DateRangePicker value={{ from: dummyFromDate, to: dummyToDate }} onChange={({ from, to }) => { setDummyFromDate(from); setDummyToDate(to); }} />
          {hasDummyFilters && (
            <button className="btn-secondary" style={{ fontSize: "0.78rem", padding: "5px 12px" }}
              onClick={() => { setDummySearch(""); setDummyProjectFilter([]); setDummyDomainFilter([]); setDummyDuidFilter([]); setDummyTeamFilter([]); setDummyFromDate(""); setDummyToDate(""); setDummyStatusFilter("open"); }}>
              Clear
            </button>
          )}
        </div>
      )}

      {/* ── ALL POIDs TOOLBAR ─────────────────────────────────────────── */}
      {tab === "overview" && (
        <div className="toolbar" style={{ flexWrap: "wrap", rowGap: 6 }}>
          <input type="search" placeholder="Search POID, PO No, item, DUID…" value={ovSearch} onChange={(e) => setOvSearch(e.target.value)} style={{ minWidth: 220 }} />
          <SearchableSelect multi value={ovProjectFilter} onChange={setOvProjectFilter} options={projectOptions} placeholder="Project" minWidth={150} />
          <SearchableSelect multi value={ovDomainFilter} onChange={setOvDomainFilter} options={ovDomainOptions} placeholder="Domain" minWidth={130} />
          <SearchableSelect multi value={ovStatusFilter} onChange={setOvStatusFilter} options={ovStatusOptions} placeholder="Status" minWidth={140} />
          <SearchableSelect multi value={ovDuidFilter} onChange={setOvDuidFilter} options={ovDuidOptions} placeholder="DUID" minWidth={120} />
          {ovTeamOptions.length > 0 && (
            <SearchableSelect multi value={ovTeamFilter} onChange={setOvTeamFilter} options={ovTeamOptions} placeholder="Team" minWidth={130} />
          )}
          {ovPlanStatusOptions.length > 0 && (
            <SearchableSelect multi value={ovPlanStatusFilter} onChange={setOvPlanStatusFilter} options={ovPlanStatusOptions} placeholder="Plan Status" minWidth={140} />
          )}
          <DateRangePicker value={{ from: ovFromDate, to: ovToDate }} onChange={({ from, to }) => { setOvFromDate(from); setOvToDate(to); }} />
          <button
            type="button"
            className="btn-secondary"
            style={{ fontSize: "0.78rem", padding: "5px 12px", background: ovDirectCloseOnly ? "#dbeafe" : undefined, borderColor: ovDirectCloseOnly ? "#0369a1" : undefined, color: ovDirectCloseOnly ? "#0369a1" : undefined, fontWeight: ovDirectCloseOnly ? 700 : undefined }}
            onClick={() => setOvDirectCloseOnly((v) => !v)}
          >
            {ovDirectCloseOnly ? "Direct Close ✓" : "Direct Close"}
          </button>
          {hasOvFilters && (
            <button className="btn-secondary" style={{ fontSize: "0.78rem", padding: "5px 12px" }}
              onClick={() => { setOvSearch(""); setOvProjectFilter([]); setOvDomainFilter([]); setOvStatusFilter([]); setOvDuidFilter([]); setOvTeamFilter([]); setOvPlanStatusFilter([]); setOvFromDate(""); setOvToDate(""); setOvDirectCloseOnly(false); }}>
              Clear filters
            </button>
          )}
        </div>
      )}

      {tab === "intake" && error && <div className="notice error" style={{ margin: "0 16px 8px" }}><span>!</span> {error}</div>}
      {tab === "dummy" && dummyError && <div className="notice error" style={{ margin: "0 16px 8px" }}><span>!</span> {dummyError}</div>}
      {tab === "overview" && ovError && <div className="notice error" style={{ margin: "0 16px 8px" }}><span>!</span> {ovError}</div>}

      {/* ── ONE page-content always rendered (fixes tab-switch CSS) ────── */}
      <div className="page-content">
        <DataTableWrapper
          loadedCount={tab === "intake" ? (loading ? null : rows.length) : tab === "dummy" ? (dummyLoading ? null : dummyRows.length) : (ovLoading ? null : ovRows.length)}
          filteredCount={tab === "intake" ? rows.length : tab === "dummy" ? filteredDummyRows.length : ovFilteredRows.length}
          filterActive={tab === "intake" ? !!hasFilters : tab === "dummy" ? (hasDummyFilters || filteredDummyRows.length !== dummyRows.length) : (hasOvFilters || ovFilteredRows.length !== ovRows.length)}
        >
          {tab === "overview" ? (
            ovLoading ? (
              <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Loading…</div>
            ) : ovFilteredRows.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">📋</div>
                <h3>{hasOvFilters ? "No POIDs match your filters" : "No POIDs found"}</h3>
                <p>{ovShowClosed ? "No POIDs assigned to you." : "Try enabling 'All statuses' to include closed and cancelled POIDs."}</p>
              </div>
            ) : (
              <table className="data-table" data-table-key="im-po-overview-v2" data-tablepro-no-dynamic="true">
                <thead>
                  <tr>
                    <th>POID</th>
                    <th>Dispatch Status</th>
                    <th>Closed Via</th>
                    <th>Billing Status</th>
                    <th>Mode</th>
                    <th>PO No</th>
                    <th>Project</th>
                    <th>Domain</th>
                    <th>DUID</th>
                    <th>Center Area</th>
                    <th>Region</th>
                    <th>Item Code</th>
                    <th>Description</th>
                    <th>Activity Type</th>
                    <th style={{ textAlign: "right" }}>Qty</th>
                    <th style={{ textAlign: "right" }}>Line Amount (SAR)</th>
                    <th>Target Month</th>
                    <th>Plan Status</th>
                    <th>Plan Team</th>
                    <th>Plan Date</th>
                    <th>Issue Category</th>
                    <th>Issue Flag</th>
                    <th>PM Remark</th>
                    <th>IM Remark</th>
                    <th>TL Remark</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {ovFilteredRows.map((row) => {
                    const ps = ovPlanSummaries[row.name];
                    const sc = dispatchStatusColor(row.dispatch_status);
                    const isDummy = !!Number(row.is_dummy_po);
                    const isClosed = ["Closed", "Cancelled", "Cancelled (in System)"].includes(row.dispatch_status || "");
                    const billing = billingStatusFromPicStatus(row.pic_status);
                    const bsc = billing ? billingStatusColor(billing) : null;
                    const iflag = ps?.issue_flag || "";
                    const ifsc = iflag ? issueFlagColor(iflag) : null;
                    return (
                      <tr key={row.name} data-doc-name={row.name} style={{ opacity: isClosed ? 0.65 : 1, background: isDummy ? "#fffbeb" : undefined }}>
                        <td style={{ fontFamily: "monospace", fontSize: "0.78rem", fontWeight: 600 }}>
                          {row.poid || row.name}
                          {isDummy && <span style={{ marginLeft: 6, padding: "1px 6px", borderRadius: 999, fontSize: "0.65rem", fontWeight: 700, background: "#fed7aa", color: "#92400e" }}>Dummy</span>}
                        </td>
                        <td>
                          <StatusBadge value={row.dispatch_status || "Pending"} bg={sc.bg} fg={sc.fg} bd={sc.bd} />
                        </td>
                        <td>
                          {row.direct_close_by
                            ? <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: "0.72rem", fontWeight: 700, background: "#dbeafe", color: "#0369a1", border: "1px solid #93c5fd", whiteSpace: "nowrap" }}>Direct Close</span>
                            : <span style={{ color: "#cbd5e1", fontSize: 12 }}>—</span>}
                        </td>
                        <td>
                          {bsc
                            ? <StatusBadge value={billing} bg={bsc.bg} fg={bsc.fg} bd={bsc.bd} />
                            : <span style={{ color: "#cbd5e1", fontSize: 12 }}>—</span>}
                        </td>
                        <td>
                          <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: "0.72rem", fontWeight: 700, background: row.dispatch_mode === "Auto" ? "rgba(99,102,241,0.12)" : "rgba(100,116,139,0.12)", color: row.dispatch_mode === "Auto" ? "#6366f1" : "#475569" }}>
                            {row.dispatch_mode || "Manual"}
                          </span>
                        </td>
                        <td style={{ fontSize: "0.82rem" }}>{row.po_no || "—"}</td>
                        <td style={{ fontSize: "0.82rem" }}>{row.project_code || "—"}</td>
                        <td style={{ fontSize: "0.82rem" }}>{row.project_domain || "—"}</td>
                        <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{row.site_code || "—"}</td>
                        <td style={{ fontSize: "0.82rem", maxWidth: 120 }} title={row.center_area || ""}>{row.center_area || "—"}</td>
                        <td style={{ fontSize: "0.82rem" }}>{row.region_type || "—"}</td>
                        <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{row.item_code || "—"}</td>
                        <td style={{ fontSize: "0.82rem", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.item_description || ""}>{row.item_description || "—"}</td>
                        <td style={{ fontSize: "0.82rem" }}>{row.activity_type || "—"}</td>
                        <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{row.qty != null ? fmt.format(row.qty) : "—"}</td>
                        <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{row.line_amount != null ? fmt.format(row.line_amount) : "—"}</td>
                        <td style={{ fontSize: "0.82rem" }}>{row.target_month || "—"}</td>
                        <td>
                          {ps ? (() => { const { bg, fg, bd } = planStatusColor(ps.plan_status); return <StatusBadge value={ps.plan_status} bg={bg} fg={fg} bd={bd} />; })()
                            : <span style={{ color: "#cbd5e1", fontSize: 12 }}>—</span>}
                        </td>
                        <td style={{ fontSize: "0.82rem", color: "#334155" }}>{ps ? (ps.team_name || ps.team || "—") : <span style={{ color: "#cbd5e1", fontSize: 12 }}>—</span>}</td>
                        <td style={{ fontSize: "0.78rem", color: "#64748b" }}>{ps?.plan_date ? String(ps.plan_date).slice(0, 10) : <span style={{ color: "#cbd5e1", fontSize: 12 }}>—</span>}</td>
                        <td style={{ fontSize: "0.78rem", color: "#92400e", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={ps?.issue_category || ""}>{ps?.issue_category || <span style={{ color: "#cbd5e1" }}>—</span>}</td>
                        <td>
                          {iflag
                            ? <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: "0.7rem", fontWeight: 700, background: ifsc?.bg || "#fef2f2", color: ifsc?.fg || "#dc2626", border: `1px solid ${ifsc?.bd || "#fca5a5"}` }}>{iflag}</span>
                            : <span style={{ color: "#cbd5e1", fontSize: 12 }}>—</span>}
                        </td>
                        <td style={{ fontSize: "0.78rem", color: "#64748b", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.general_remark || ""}>{row.general_remark || <span style={{ color: "#cbd5e1" }}>—</span>}</td>
                        <td style={{ fontSize: "0.78rem", color: "#64748b", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.manager_remark || ""}>{row.manager_remark || <span style={{ color: "#cbd5e1" }}>—</span>}</td>
                        <td style={{ fontSize: "0.78rem", color: "#64748b", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.team_lead_remark || ""}>{row.team_lead_remark || <span style={{ color: "#cbd5e1" }}>—</span>}</td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          <button type="button" className="btn-secondary" style={{ fontSize: "0.7rem", padding: "3px 8px" }} onClick={() => setDetailRow(row)}>View</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )
          ) : tab === "intake" ? (
            loading ? (
              <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Loading…</div>
            ) : rows.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">📥</div>
                <h3>{hasFilters ? "No matching intake lines" : "PO Intake is empty"}</h3>
                <p>{hasFilters ? "Try adjusting your search or filters." : "When the PM dispatches new PO lines to you, they'll land here first."}</p>
              </div>
            ) : (
              <table className="data-table" data-table-key="im-po-intake-v2">
                <thead>
                  <tr>
                    <th><input type="checkbox" checked={selected.size === rows.length && rows.length > 0} onChange={toggleAll} /></th>
                    <th>POID</th>
                    <th>Mode</th>
                    <th>PO No</th>
                    <th>Project</th>
                    <th>Domain</th>
                    <th>Huawei IM</th>
                    <th>Item</th>
                    <th>Description</th>
                    <th>Activity Type</th>
                    <th style={{ textAlign: "right" }}>Qty</th>
                    <th style={{ textAlign: "right" }}>Amount (SAR)</th>
                    <th>DUID</th>
                    <th>Center area</th>
                    <th>Dispatched On</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.name} data-doc-name={row.name} className={selected.has(row.name) ? "row-selected" : ""} onClick={() => toggleRow(row.name)} style={{ cursor: "pointer", background: row.dispatch_mode === "Auto" ? "rgba(99,102,241,0.04)" : undefined }}>
                      <td onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={selected.has(row.name)} onChange={() => toggleRow(row.name)} />
                      </td>
                      <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{row.poid || row.name}</td>
                      <td>
                        <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: "0.72rem", fontWeight: 700, background: row.dispatch_mode === "Auto" ? "rgba(99,102,241,0.12)" : "rgba(100,116,139,0.12)", color: row.dispatch_mode === "Auto" ? "#6366f1" : "#475569" }}>
                          {row.dispatch_mode || "Manual"}
                        </span>
                      </td>
                      <td>{row.po_no || "—"}</td>
                      <td>{row.project_code || "—"}</td>
                      <td>{row.project_domain || "—"}</td>
                      <td>{row.huawei_im || "—"}</td>
                      <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{row.item_code || "—"}</td>
                      <td style={{ fontSize: "0.82rem", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.item_description || ""}>{row.item_description || "—"}</td>
                      <td style={{ fontSize: "0.82rem" }}>{row.activity_type || "—"}</td>
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{row.qty != null ? fmt.format(row.qty) : "—"}</td>
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt.format(row.line_amount || 0)}</td>
                      <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{row.site_code || "—"}</td>
                      <td style={{ fontSize: "0.82rem", maxWidth: 140 }} title={row.center_area || ""}>{row.center_area || "—"}</td>
                      <td style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>{row.modified ? String(row.modified).slice(0, 10) : "—"}</td>
                      <td onClick={(e) => e.stopPropagation()} style={{ whiteSpace: "nowrap" }}>
                        <button type="button" className="btn-secondary" style={{ fontSize: "0.7rem", padding: "3px 8px" }} onClick={() => setIntakeViewRow(row)}>View</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : (
            dummyLoading ? (
              <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Loading…</div>
            ) : filteredDummyRows.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">🗂</div>
                <h3>{hasDummyFilters ? "No dummy POs match your filters" : dummyStatusFilter === "mapped" ? "No mapped dummy POs" : dummyStatusFilter === "all" ? "No dummy POs found" : "No open dummy POs"}</h3>
                <p>{dummyStatusFilter === "open" ? "Create a dummy PO using the + Dummy PO button above when a real PO is not yet available." : dummyStatusFilter === "mapped" ? "Once dummy POs are mapped to real PO intake lines they appear here." : "No dummy POs have been created yet."}</p>
              </div>
            ) : (
              <table className="data-table" data-table-key="im-po-dummy-v2" data-tablepro-no-dynamic="true">
                <thead>
                  <tr>
                    <th>POID</th>
                    <th>Status</th>
                    <th>Mode</th>
                    <th>Project</th>
                    <th>Domain</th>
                    <th>DUID</th>
                    <th>Center Area</th>
                    <th>Region</th>
                    <th>Item Code</th>
                    <th>Description</th>
                    <th>Activity Type</th>
                    <th style={{ textAlign: "right" }}>Qty</th>
                    <th style={{ textAlign: "right" }}>Line Amount (SAR)</th>
                    <th>Target Month</th>
                    <th>Dispatch Status</th>
                    <th>Plan Status</th>
                    <th>Plan Team</th>
                    <th>Plan Date</th>
                    <th>Original Dummy POID</th>
                    <th>Created</th>
                    <th style={{ minWidth: 130 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDummyRows.map((row) => {
                    const isOpen = !!Number(row.is_dummy_po);
                    const ps = planSummaries[row.name];
                    return (
                      <tr key={row.name} data-doc-name={row.name} style={{ background: isOpen ? "#fffbeb" : undefined }}>
                        <td style={{ fontFamily: "monospace", fontSize: "0.78rem", fontWeight: 600 }}>{row.poid || row.name}</td>
                        <td>
                          {isOpen
                            ? <StatusBadge value="Open" bg="#fff7ed" fg="#c2410c" bd="#fed7aa" />
                            : <StatusBadge value="Mapped" bg="#eef2ff" fg="#4338ca" bd="#c7d2fe" />}
                        </td>
                        <td>
                          <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: "0.72rem", fontWeight: 700, background: row.dispatch_mode === "Auto" ? "rgba(99,102,241,0.12)" : "rgba(100,116,139,0.12)", color: row.dispatch_mode === "Auto" ? "#6366f1" : "#475569" }}>
                            {row.dispatch_mode || "Manual"}
                          </span>
                        </td>
                        <td style={{ fontSize: "0.82rem" }}>{row.project_code || "—"}</td>
                        <td style={{ fontSize: "0.82rem" }}>{row.project_domain || "—"}</td>
                        <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{row.site_code || "—"}</td>
                        <td style={{ fontSize: "0.82rem", maxWidth: 120 }} title={row.center_area || ""}>{row.center_area || "—"}</td>
                        <td style={{ fontSize: "0.82rem" }}>{row.region_type || "—"}</td>
                        <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{row.item_code || "—"}</td>
                        <td style={{ fontSize: "0.82rem", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.item_description || ""}>{row.item_description || "—"}</td>
                        <td style={{ fontSize: "0.82rem" }}>{row.activity_type || "—"}</td>
                        <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{row.qty != null ? fmt.format(row.qty) : "—"}</td>
                        <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{row.line_amount != null ? fmt.format(row.line_amount) : "—"}</td>
                        <td style={{ fontSize: "0.82rem" }}>{row.target_month || "—"}</td>
                        <td>
                          {row.dispatch_status
                            ? <span className={`status-badge ${(row.dispatch_status || "").toLowerCase()}`}><span className="status-dot" />{row.dispatch_status}</span>
                            : <span style={{ color: "#cbd5e1", fontSize: 12 }}>—</span>}
                        </td>
                        <td>
                          {ps ? (() => { const { bg, fg, bd } = planStatusColor(ps.plan_status); return <StatusBadge value={ps.plan_status} bg={bg} fg={fg} bd={bd} />; })()
                            : <span style={{ color: "#cbd5e1", fontSize: 12 }}>—</span>}
                        </td>
                        <td style={{ fontSize: "0.82rem", color: "#334155" }}>{ps ? (ps.team_name || ps.team || "—") : <span style={{ color: "#cbd5e1", fontSize: 12 }}>—</span>}</td>
                        <td style={{ fontSize: "0.78rem", color: "#64748b" }}>{ps?.plan_date ? String(ps.plan_date).slice(0, 10) : <span style={{ color: "#cbd5e1", fontSize: 12 }}>—</span>}</td>
                        <td style={{ fontFamily: "monospace", fontSize: "0.76rem", color: "#64748b" }}>{(row.original_dummy_poid || "").trim() || "—"}</td>
                        <td style={{ fontSize: "0.78rem", color: "#94a3b8" }}>{(row.creation || row.modified || "").slice(0, 10)}</td>
                        <td style={{ minWidth: 130, whiteSpace: "nowrap" }}>
                          <div style={{ display: "flex", gap: 5 }}>
                            <button type="button" className="btn-secondary" style={{ fontSize: "0.7rem", padding: "3px 8px" }} onClick={() => setDetailRow(row)}>View</button>
                            {isOpen && (
                              <button type="button" style={{ fontSize: "0.7rem", padding: "3px 8px", background: "#fff7ed", color: "#92400e", border: "1px solid #f59e0b", borderRadius: 8, cursor: "pointer", fontWeight: 700 }} onClick={() => { setMapErr(null); setMapForRow(row); }}>Map PO</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )
          )}
        </DataTableWrapper>
      </div>

      {/* ── CREATE DUMMY PO MODAL ─────────────────────────────────────── */}
      <Modal
        open={showCreateDummy}
        onClose={() => !dummyBusy && setShowCreateDummy(false)}
        title="Create Dummy PO"
        width={620}
        footer={
          <>
            <button type="button" className="btn-secondary" disabled={dummyBusy} onClick={() => setShowCreateDummy(false)}>Cancel</button>
            <button type="button" className="btn-primary" disabled={dummyBusy} onClick={submitCreateDummy}>
              {dummyBusy ? "Creating…" : "Create"}
            </button>
          </>
        }
      >
        {dummyErr && <div className="notice error" style={{ marginBottom: 12 }}>{dummyErr}</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, marginBottom: 6, color: "#475569" }}>Project *</label>
            <select value={dummyForm.project_code} onChange={(e) => setDummyForm((f) => ({ ...f, project_code: e.target.value }))} style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e2e8f0", boxSizing: "border-box" }}>
              <option value="">{projectsForDummy.length ? "Select project" : "No projects (check IM link)"}</option>
              {projectsForDummy.map((p) => (
                <option key={p.name} value={p.project_code || p.name}>{p.project_code || p.name}{p.project_name ? ` — ${p.project_name}` : ""}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, marginBottom: 6, color: "#475569" }}>Target Month</label>
            <select value={dummyForm.target_month || ""} onChange={(e) => setDummyForm((f) => ({ ...f, target_month: e.target.value }))} style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e2e8f0", boxSizing: "border-box" }}>
              {monthOptions().map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, marginBottom: 6, color: "#475569" }}>Item Code</label>
            <SearchableSelect
              value={dummyForm.item_code || ""}
              onChange={(v) => {
                const picked = itemsForDummy.find((i) => i.item_code === v);
                setDummyForm((f) => ({ ...f, item_code: v || "", item_description: picked?.description || f.item_description }));
              }}
              onSearch={setItemSearch}
              options={itemsForDummy.map((i) => ({ id: i.item_code, label: i.item_name && i.item_name !== i.item_code ? `${i.item_code} — ${i.item_name}` : i.item_code }))}
              placeholder="Search item…"
              allLabel="None"
              minWidth={0}
              triggerStyle={{ width: "100%", borderRadius: 8, fontSize: "0.88rem" }}
              panelStyle={{ width: "100%", minWidth: 0, maxWidth: "none", right: 0 }}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, marginBottom: 6, color: "#475569" }}>Item Description</label>
            <textarea value={dummyForm.item_description || ""} onChange={(e) => setDummyForm((f) => ({ ...f, item_description: e.target.value }))} rows={2} placeholder="Description of the work…" style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #e2e8f0", boxSizing: "border-box", fontFamily: "inherit", fontSize: "0.84rem", resize: "vertical" }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, marginBottom: 6, color: "#475569" }}>DUID</label>
            <SearchableSelect
              value={dummyForm.site_code || ""}
              onChange={(v) => setDummyForm((f) => ({ ...f, site_code: v || "", duid_text: "" }))}
              onSearch={setDuidSearch}
              options={duidsForDummy.map((d) => ({ id: d.name, label: d.site_name && d.site_name !== d.name ? `${d.name} — ${d.site_name}` : d.name }))}
              placeholder="Auto placeholder (DUMMY-…)"
              allLabel="Auto placeholder (DUMMY-…)"
              minWidth={0}
              triggerStyle={{ width: "100%", borderRadius: 8, fontSize: "0.88rem" }}
              panelStyle={{ width: "100%", minWidth: 0, maxWidth: "none", right: 0 }}
            />
            {!dummyForm.site_code && (
              <>
                <div style={{ fontSize: "0.72rem", color: "#94a3b8", margin: "6px 0 4px" }}>Or enter Site Code directly</div>
                <input type="text" placeholder="Site Code (e.g. TABUK-001)" value={dummyForm.duid_text || ""} onChange={(e) => setDummyForm((f) => ({ ...f, duid_text: e.target.value }))} style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #e2e8f0", boxSizing: "border-box", fontSize: "0.86rem" }} />
              </>
            )}
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, marginBottom: 6, color: "#475569" }}>Note for field team</label>
            <textarea value={dummyForm.manager_remark || ""} onChange={(e) => setDummyForm((f) => ({ ...f, manager_remark: e.target.value }))} rows={3} style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e2e8f0", boxSizing: "border-box", fontFamily: "inherit", fontSize: "0.84rem", resize: "vertical" }} />
          </div>
        </div>
      </Modal>

      {/* ── MAP DUMMY PO MODAL ───────────────────────────────────────────── */}
      {mapForRow && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
             onClick={() => !mapBusy && setMapForRow(null)}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 24, width: "min(500px, 96vw)", boxShadow: "0 20px 60px rgba(0,0,0,0.22)" }}
               onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 4px", fontSize: "1.05rem" }}>Map Dummy PO</h3>
            <p style={{ fontSize: "0.82rem", color: "#64748b", margin: "0 0 16px" }}>
              POID: <strong>{mapForRow.poid || mapForRow.name}</strong>
              {mapForRow.site_code && <> · DUID: <strong>{mapForRow.site_code}</strong></>}
              {mapForRow.project_code && <> · Project: <strong>{mapForRow.project_code}</strong></>}
            </p>
            {mapErr && <div className="notice error" style={{ marginBottom: 12 }}>{mapErr}</div>}
            <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, marginBottom: 6, color: "#475569" }}>Select Real PO Intake Line</label>
            {mapLinesLoading ? (
              <p style={{ fontSize: "0.82rem", color: "#94a3b8" }}>Loading lines…</p>
            ) : (() => {
              const duidLines = mapForRow?.site_code ? mapLines.filter((l) => l.site_code === mapForRow.site_code) : mapLines;
              const optionLines = duidLines.length > 0 ? duidLines : mapLines;
              const fallback = mapForRow?.site_code && duidLines.length === 0 && mapLines.length > 0;
              return (
                <>
                  {mapForRow?.site_code && (
                    <div style={{ fontSize: "0.75rem", marginBottom: 6, color: fallback ? "#b45309" : "#047857" }}>
                      {fallback ? `No lines for DUID ${mapForRow.site_code} — showing all` : `Filtered by DUID: ${mapForRow.site_code} (${duidLines.length} line${duidLines.length !== 1 ? "s" : ""})`}
                    </div>
                  )}
                  <SearchableSelect
                    value={mapLineId}
                    onChange={setMapLineId}
                    options={optionLines.map((l) => ({
                      id: l.name,
                      label: `${l.poid || l.po_no || l.name} · L${l.po_line_no} · ${l.item_code || "—"}${l.existing_dispatch ? ` · dispatched (${l.existing_dispatch_status || "?"})` : ""}`,
                    }))}
                    placeholder={optionLines.length ? "— search & select PO line —" : "No open lines for this project"}
                    style={{ display: "block", width: "100%" }}
                    panelStyle={{ zIndex: 10001 }}
                  />
                </>
              );
            })()}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 18 }}>
              <button type="button" className="btn-secondary" disabled={mapBusy} onClick={() => setMapForRow(null)}>Cancel</button>
              <button type="button" className="btn-primary" disabled={mapBusy || !mapLineId || mapLinesLoading} onClick={submitMapDummy}>
                {mapBusy ? "Mapping…" : "Map PO"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── INTAKE VIEW POPUP (Rollout Planning style) ──────────────────── */}
      {intakeViewRow && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={() => setIntakeViewRow(null)}
        >
          <div
            style={{ background: "#fff", borderRadius: 12, width: "min(840px, 96vw)", maxHeight: "calc(100dvh - 32px)", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 24px 48px -16px rgba(0,0,0,0.3)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px", borderBottom: "1px solid #e2e8f0", flexShrink: 0 }}>
              <h3 style={{ margin: 0, fontSize: "1rem" }}>PO Dispatch Details</h3>
              <button type="button" onClick={() => setIntakeViewRow(null)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#94a3b8", lineHeight: 1 }}>&times;</button>
            </div>
            <div style={{ padding: 20, overflowY: "auto", flex: "1 1 auto", minHeight: 0 }}>
              <RecordDetailView
                row={intakeViewRow}
                pills={[
                  { label: "POID", value: intakeViewRow.poid || intakeViewRow.name, tone: "blue" },
                  { label: "DUID", value: intakeViewRow.site_code || "—", tone: "green" },
                  { label: "Project", value: intakeViewRow.project_code || "—", tone: "violet" },
                  intakeViewRow.dispatch_status ? {
                    label: "Status",
                    value: intakeViewRow.dispatch_status,
                    tone: /complete/i.test(intakeViewRow.dispatch_status) ? "green" : /cancel/i.test(intakeViewRow.dispatch_status) ? "rose" : "slate",
                  } : null,
                ].filter(Boolean)}
                hiddenFields={[
                  "name", "poid", "site_code", "project_code", "dispatch_status", "im",
                  "manager_remark", "general_remark", "team_lead_remark",
                  "is_dummy_po", "was_dummy_po", "original_dummy_poid",
                  "pic_status", "pic_detail_remark", "payment_terms",
                  "ms1_amount", "ms2_amount", "ms1_invoiced", "ms2_invoiced",
                  "ms1_invoice_month", "ms2_invoice_month",
                  "direct_close_by", "plan_documents",
                ]}
                keyOrder={["po_no", "dispatch_mode", "project_domain", "huawei_im", "activity_type", "item_code", "item_description", "qty", "rate", "line_amount", "target_month", "center_area", "region_type"]}
              />
              <IMNoteCallout note={intakeViewRow.manager_remark} />
              <DispatchVisitHistory poDispatch={intakeViewRow.name} />
            </div>
          </div>
        </div>
      )}

      {/* ── DUMMY DETAIL POPUP ───────────────────────────────────────────── */}
      {detailRow && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
             onClick={() => setDetailRow(null)}>
          <div style={{ background: "#fff", borderRadius: 14, width: "min(1100px, 100%)", height: "90vh", display: "flex", flexDirection: "column", boxShadow: "0 25px 60px rgba(15,23,42,0.3)", overflow: "hidden" }}
               onClick={(e) => e.stopPropagation()}>

            {/* Detail header */}
            <div style={{ padding: "16px 24px", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 16, color: "#0f172a", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  {detailRow.poid || detailRow.name}
                  {!!Number(detailRow.is_dummy_po) && (
                    <span style={{ padding: "2px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: "#fff7ed", color: "#c2410c", border: "1px solid #fed7aa" }}>Open Dummy</span>
                  )}
                  {!Number(detailRow.is_dummy_po) && !!Number(detailRow.was_dummy_po) && (
                    <span style={{ padding: "2px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: "#eef2ff", color: "#4338ca", border: "1px solid #c7d2fe" }}>Was Dummy</span>
                  )}
                  {detailRow.dispatch_status && (() => { const sc = dispatchStatusColor(detailRow.dispatch_status); return <span style={{ padding: "2px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: sc.bg, color: sc.fg, border: `1px solid ${sc.bd}` }}>{detailRow.dispatch_status}</span>; })()}
                  {billingStatusFromPicStatus(detailRow.pic_status) && (() => { const bs = billingStatusFromPicStatus(detailRow.pic_status); const bsc = billingStatusColor(bs); return <span style={{ padding: "2px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: bsc.bg, color: bsc.fg, border: `1px solid ${bsc.bd}` }}>Billing: {bs}</span>; })()}
                </div>
                <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>{detailRow.project_code || "—"} · {detailRow.site_code || "—"} · {detailRow.project_domain || "—"} · {detailRow.target_month || "—"}</div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {!!Number(detailRow.is_dummy_po) && (
                  <button
                    type="button"
                    style={{ fontSize: "0.8rem", padding: "6px 14px", background: "#fff7ed", color: "#92400e", border: "1px solid #f59e0b", borderRadius: 8, cursor: "pointer", fontWeight: 700 }}
                    onClick={() => { const r = detailRow; setDetailRow(null); setMapErr(null); setMapForRow(r); }}
                  >
                    Map PO
                  </button>
                )}
                <button type="button" onClick={() => setDetailRow(null)} style={{ background: "none", border: "1px solid #e2e8f0", cursor: "pointer", padding: "4px 8px", color: "#64748b", fontSize: 15, borderRadius: 6 }}>✕</button>
              </div>
            </div>

            <div style={{ overflowY: "auto", flex: "1 1 0px", minHeight: 0 }}>
            <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>

              {/* PO Info grid */}
              <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden" }}>
                <div style={{ padding: "9px 16px", borderBottom: "1px solid #f1f5f9", fontWeight: 700, fontSize: 13, color: "#475569", background: "#f8fafc" }}>PO Dispatch Info</div>
                <div style={{ padding: 16, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px,1fr))", gap: 14 }}>
                  <FieldRow label="POID">{detailRow.poid || detailRow.name}</FieldRow>
                  <FieldRow label="PO No">{detailRow.po_no || "—"}</FieldRow>
                  <FieldRow label="Project">{detailRow.project_code || "—"}</FieldRow>
                  <FieldRow label="Domain">{detailRow.project_domain || "—"}</FieldRow>
                  <FieldRow label="DUID">{detailRow.site_code || "—"}</FieldRow>
                  <FieldRow label="Center Area">{detailRow.center_area || "—"}</FieldRow>
                  <FieldRow label="Region">{detailRow.region_type || "—"}</FieldRow>
                  <FieldRow label="Item Code">{detailRow.item_code || "—"}</FieldRow>
                  <FieldRow label="Qty">{detailRow.qty != null ? fmt.format(detailRow.qty) : "—"}</FieldRow>
                  <FieldRow label="Line Amount">{detailRow.line_amount != null ? `SAR ${fmt.format(detailRow.line_amount)}` : "—"}</FieldRow>
                  <FieldRow label="Target Month">{detailRow.target_month || "—"}</FieldRow>
                  <FieldRow label="Status">{detailRow.dispatch_status || "—"}</FieldRow>
                  {(detailRow.original_dummy_poid || "").trim() && (
                    <FieldRow label="Original Dummy POID">
                      <span style={{ fontFamily: "monospace", fontSize: 12 }}>{detailRow.original_dummy_poid}</span>
                    </FieldRow>
                  )}
                  {detailRow.item_description && (
                    <div style={{ gridColumn: "1 / -1" }}>
                      <FieldRow label="Item Description">{detailRow.item_description}</FieldRow>
                    </div>
                  )}
                </div>
              </div>

              {/* Billing & Financial */}
              <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden" }}>
                <div style={{ padding: "9px 16px", borderBottom: "1px solid #f1f5f9", fontWeight: 700, fontSize: 13, color: "#475569", background: "#f8fafc" }}>Billing & Financial</div>
                <div style={{ padding: 16, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px,1fr))", gap: 14 }}>
                  <FieldRow label="PIC Status">{detailRow.pic_status || "—"}</FieldRow>
                  <FieldRow label="Billing Status">
                    {billingStatusFromPicStatus(detailRow.pic_status)
                      ? (() => { const bs = billingStatusFromPicStatus(detailRow.pic_status); const bsc = billingStatusColor(bs); return <span style={{ padding: "2px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700, background: bsc.bg, color: bsc.fg, border: `1px solid ${bsc.bd}` }}>{bs}</span>; })()
                      : "—"}
                  </FieldRow>
                  <FieldRow label="Payment Terms">{detailRow.payment_terms || "—"}</FieldRow>
                  <FieldRow label="Rate (SAR)">{detailRow.rate != null ? fmt.format(detailRow.rate) : "—"}</FieldRow>
                  <FieldRow label="MS1 Amount">{detailRow.ms1_amount != null ? `SAR ${fmt.format(detailRow.ms1_amount)}` : "—"}</FieldRow>
                  <FieldRow label="MS1 Invoiced">{detailRow.ms1_invoiced || "—"}</FieldRow>
                  <FieldRow label="MS1 Invoice Month">{detailRow.ms1_invoice_month || "—"}</FieldRow>
                  <FieldRow label="MS2 Amount">{detailRow.ms2_amount != null ? `SAR ${fmt.format(detailRow.ms2_amount)}` : "—"}</FieldRow>
                  <FieldRow label="MS2 Invoiced">{detailRow.ms2_invoiced || "—"}</FieldRow>
                  <FieldRow label="MS2 Invoice Month">{detailRow.ms2_invoice_month || "—"}</FieldRow>
                  {detailRow.pic_detail_remark && (
                    <div style={{ gridColumn: "1 / -1" }}>
                      <FieldRow label="PIC Remark">{detailRow.pic_detail_remark}</FieldRow>
                    </div>
                  )}
                </div>
              </div>

              {/* Remarks */}
              {(detailRow.general_remark || detailRow.manager_remark || detailRow.team_lead_remark) && (
                <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden" }}>
                  <div style={{ padding: "9px 16px", borderBottom: "1px solid #f1f5f9", fontWeight: 700, fontSize: 13, color: "#475569", background: "#f8fafc" }}>Remarks</div>
                  <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
                    {detailRow.general_remark && (
                      <div>
                        <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>PM Remark</div>
                        <div style={{ fontSize: 13, color: "#0f172a", background: "#f8fafc", padding: "8px 12px", borderRadius: 6, border: "1px solid #e2e8f0", lineHeight: 1.5 }}>{detailRow.general_remark}</div>
                      </div>
                    )}
                    {detailRow.manager_remark && (
                      <div>
                        <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>IM Remark</div>
                        <div style={{ fontSize: 13, color: "#0f172a", background: "#eff6ff", padding: "8px 12px", borderRadius: 6, border: "1px solid #bfdbfe", lineHeight: 1.5 }}>{detailRow.manager_remark}</div>
                      </div>
                    )}
                    {detailRow.team_lead_remark && (
                      <div>
                        <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>TL Remark</div>
                        <div style={{ fontSize: 13, color: "#0f172a", background: "#f0fdf4", padding: "8px 12px", borderRadius: 6, border: "1px solid #bbf7d0", lineHeight: 1.5 }}>{detailRow.team_lead_remark}</div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Rollout Plans */}
              <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden" }}>
                <div style={{ padding: "9px 16px", borderBottom: "1px solid #f1f5f9", fontWeight: 700, fontSize: 13, color: "#475569", background: "#f8fafc", display: "flex", alignItems: "center", gap: 10 }}>
                  Rollout Plans
                  {!detailPlansLoading && (
                    <span style={{ padding: "1px 8px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: "#eff6ff", color: "#1d4ed8" }}>
                      {detailPlans.length}
                    </span>
                  )}
                </div>
                {detailPlansLoading ? (
                  <div style={{ padding: 24, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>Loading plans…</div>
                ) : detailPlans.length === 0 ? (
                  <div style={{ padding: 20, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>No rollout plans yet for this POID.</div>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: "#f8fafc" }}>
                          <th style={{ padding: "7px 12px", textAlign: "left", color: "#64748b", fontWeight: 600, whiteSpace: "nowrap" }}>Visit #</th>
                          <th style={{ padding: "7px 12px", textAlign: "left", color: "#64748b", fontWeight: 600 }}>Type</th>
                          <th style={{ padding: "7px 12px", textAlign: "left", color: "#64748b", fontWeight: 600 }}>Plan Date</th>
                          <th style={{ padding: "7px 12px", textAlign: "left", color: "#64748b", fontWeight: 600 }}>Team</th>
                          <th style={{ padding: "7px 12px", textAlign: "left", color: "#64748b", fontWeight: 600 }}>Status</th>
                          <th style={{ padding: "7px 12px", textAlign: "right", color: "#64748b", fontWeight: 600 }}>Completion</th>
                          <th style={{ padding: "7px 12px", textAlign: "right", color: "#64748b", fontWeight: 600 }}>Executions</th>
                          <th style={{ padding: "7px 12px", textAlign: "left", color: "#64748b", fontWeight: 600 }}>Work Done</th>
                          <th style={{ padding: "7px 12px", textAlign: "left", color: "#64748b", fontWeight: 600 }}>Issue</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailPlans.map((p) => {
                          const col = planStatusColor(p.plan_status);
                          return (
                            <tr key={p.name} style={{ borderTop: "1px solid #f1f5f9", background: p.is_current ? "#f0f9ff" : undefined }}>
                              <td style={{ padding: "8px 12px" }}>
                                <span style={{ fontWeight: 700, color: p.is_current ? "#0369a1" : "#475569" }}>V{p.visit_number}</span>
                                {p.is_current && <span style={{ marginLeft: 5, fontSize: 10, color: "#0369a1", fontWeight: 700 }}>CURRENT</span>}
                              </td>
                              <td style={{ padding: "8px 12px", color: "#475569" }}>{p.visit_type || "—"}</td>
                              <td style={{ padding: "8px 12px", color: "#475569" }}>{p.plan_date || "—"}</td>
                              <td style={{ padding: "8px 12px", color: "#0f172a", fontWeight: 500 }}>{p.team_name || p.team || "—"}</td>
                              <td style={{ padding: "8px 12px" }}>
                                <StatusBadge value={p.plan_status} bg={col.bg} fg={col.fg} bd={col.bd} />
                              </td>
                              <td style={{ padding: "8px 12px", textAlign: "right" }}>
                                <span style={{ fontWeight: 700, color: Number(p.completion_pct) >= 100 ? "#047857" : "#0369a1" }}>
                                  {Number(p.completion_pct || 0).toFixed(0)}%
                                </span>
                              </td>
                              <td style={{ padding: "8px 12px", textAlign: "right", color: "#475569" }}>{p.execution_count ?? "—"}</td>
                              <td style={{ padding: "8px 12px" }}>
                                {p.work_done
                                  ? <span style={{ fontSize: 11, fontWeight: 700, color: "#047857", background: "#ecfdf5", padding: "2px 8px", borderRadius: 999, border: "1px solid #a7f3d0" }}>Done</span>
                                  : <span style={{ color: "#cbd5e1", fontSize: 12 }}>—</span>}
                              </td>
                              <td style={{ padding: "8px 12px", fontSize: 11, color: "#64748b" }}>{p.issue_category || "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Reschedule History */}
              {detailExtrasLoading ? (
                <div style={{ padding: "10px 0", color: "#94a3b8", fontSize: 12 }}>Loading history…</div>
              ) : (detailExtras?.reschedule_history?.length > 0) && (
                <div style={{ border: "1px solid #fde68a", borderRadius: 10, overflow: "hidden" }}>
                  <div style={{ padding: "9px 16px", borderBottom: "1px solid #fef3c7", fontWeight: 700, fontSize: 13, color: "#92400e", background: "#fffbeb", display: "flex", alignItems: "center", gap: 10 }}>
                    Reschedule History
                    <span style={{ padding: "1px 8px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: "#fef3c7", color: "#92400e" }}>{detailExtras.reschedule_history.length}</span>
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: "#fffbeb" }}>
                          <th style={{ padding: "6px 12px", textAlign: "left", color: "#92400e", fontWeight: 600 }}>Visit #</th>
                          <th style={{ padding: "6px 12px", textAlign: "left", color: "#92400e", fontWeight: 600 }}>From</th>
                          <th style={{ padding: "6px 12px", textAlign: "left", color: "#92400e", fontWeight: 600 }}>To</th>
                          <th style={{ padding: "6px 12px", textAlign: "left", color: "#92400e", fontWeight: 600 }}>Reason</th>
                          <th style={{ padding: "6px 12px", textAlign: "left", color: "#92400e", fontWeight: 600 }}>TL Status</th>
                          <th style={{ padding: "6px 12px", textAlign: "left", color: "#92400e", fontWeight: 600 }}>IM Note</th>
                          <th style={{ padding: "6px 12px", textAlign: "left", color: "#92400e", fontWeight: 600 }}>By</th>
                          <th style={{ padding: "6px 12px", textAlign: "left", color: "#92400e", fontWeight: 600 }}>At</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailExtras.reschedule_history.map((r, i) => (
                          <tr key={i} style={{ borderTop: "1px solid #fef3c7" }}>
                            <td style={{ padding: "7px 12px", fontWeight: 700, color: "#92400e" }}>V{r.visit_number || "?"}</td>
                            <td style={{ padding: "7px 12px", color: "#475569" }}>{r.original_date ? String(r.original_date).slice(0, 10) : "—"}</td>
                            <td style={{ padding: "7px 12px", color: "#047857", fontWeight: 600 }}>{r.new_date ? String(r.new_date).slice(0, 10) : "—"}</td>
                            <td style={{ padding: "7px 12px", color: "#475569" }}>{r.reason || "—"}</td>
                            <td style={{ padding: "7px 12px", color: "#64748b" }}>{r.tl_status_at_time || "—"}</td>
                            <td style={{ padding: "7px 12px", color: "#64748b", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.im_note || ""}>{r.im_note || "—"}</td>
                            <td style={{ padding: "7px 12px", color: "#64748b", fontSize: 11 }}>{r.rescheduled_by || "—"}</td>
                            <td style={{ padding: "7px 12px", color: "#94a3b8", fontSize: 11 }}>{r.rescheduled_at ? String(r.rescheduled_at).slice(0, 16) : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Planning Attachments */}
              {!detailExtrasLoading && (detailExtras?.planning_attachments?.length > 0) && (
                <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden" }}>
                  <div style={{ padding: "9px 16px", borderBottom: "1px solid #f1f5f9", fontWeight: 700, fontSize: 13, color: "#475569", background: "#f8fafc", display: "flex", alignItems: "center", gap: 10 }}>
                    Planning Attachments
                    <span style={{ padding: "1px 8px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: "#eff6ff", color: "#1d4ed8" }}>{detailExtras.planning_attachments.length}</span>
                  </div>
                  <div style={{ padding: "8px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
                    {detailExtras.planning_attachments.map((f, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", borderRadius: 6, background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                        <span style={{ fontSize: 18 }}>📎</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <a href={f.file_url} target="_blank" rel="noreferrer" style={{ fontWeight: 600, fontSize: 13, color: "#1d4ed8", textDecoration: "none", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.file_name || f.file_url}</a>
                          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 1 }}>{f.attached_to}{f.file_size ? ` · ${fmtFileSize(f.file_size)}` : ""}{f.creation ? ` · ${String(f.creation).slice(0, 10)}` : ""}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Submission Attachments */}
              {!detailExtrasLoading && (detailExtras?.submission_attachments?.length > 0) && (
                <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden" }}>
                  <div style={{ padding: "9px 16px", borderBottom: "1px solid #f1f5f9", fontWeight: 700, fontSize: 13, color: "#475569", background: "#f8fafc", display: "flex", alignItems: "center", gap: 10 }}>
                    Submission Attachments
                    <span style={{ padding: "1px 8px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: "#ecfdf5", color: "#047857" }}>{detailExtras.submission_attachments.length}</span>
                  </div>
                  <div style={{ padding: "8px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
                    {detailExtras.submission_attachments.map((f, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", borderRadius: 6, background: "#f0fdf4", border: "1px solid #bbf7d0" }}>
                        <span style={{ fontSize: 18 }}>📄</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <a href={f.file_url} target="_blank" rel="noreferrer" style={{ fontWeight: 600, fontSize: 13, color: "#047857", textDecoration: "none", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.file_name || f.file_url}</a>
                          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 1 }}>{f.file_size ? fmtFileSize(f.file_size) : ""}{f.creation ? ` · ${String(f.creation).slice(0, 10)}` : ""}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </div>{/* end inner flex column */}
            </div>{/* end scroll viewport */}
          </div>
        </div>
      )}

      {/* ── INTAKE MODALS ─────────────────────────────────────────────────── */}
      {showBackendModal && (
        <div style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
             onClick={backendBusy ? undefined : () => setShowBackendModal(false)}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 20, width: "min(520px, 100%)", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)" }}
               onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: "1rem" }}>Assign to Backend <span style={{ color: "#64748b", fontWeight: 500 }}>· {selected.size} POID{selected.size !== 1 ? "s" : ""}</span></h3>
              <button type="button" onClick={() => setShowBackendModal(false)} disabled={backendBusy} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#94a3b8", lineHeight: 1 }}>&times;</button>
            </div>
            {selectedRows.length > 0 && (
              <div style={{ fontSize: "0.76rem", color: "#475569", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", marginBottom: 12, maxHeight: 140, overflowY: "auto" }}>
                {selectedRows.map((r) => (
                  <div key={r.name} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "2px 0" }}>
                    <span style={{ fontFamily: "monospace", fontWeight: 700, color: "#0f172a" }}>{r.poid || r.name}</span>
                    <span style={{ color: "#64748b" }}>{r.po_no || "—"} · {r.item_code || "—"} · {r.site_code || "—"}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="form-group" style={{ marginBottom: 10 }}>
              <label>Backend Team *</label>
              <select value={backendTeamId} onChange={(e) => setBackendTeamId(e.target.value)} disabled={backendBusy || backendTeamsLoading} required>
                <option value="">{backendTeamsLoading ? "Loading teams…" : "— Select a backend team —"}</option>
                {backendTeams.map((t) => <option key={t.name} value={t.name}>{t.team_name || t.team_id}{t.team_id && t.team_name ? ` (${t.team_id})` : ""}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 10 }}>
              <label>Note (optional)</label>
              <textarea rows={3} value={backendRemark} onChange={(e) => setBackendRemark(e.target.value)} disabled={backendBusy} style={{ width: "100%", boxSizing: "border-box", padding: "6px 8px", fontSize: "0.85rem", border: "1px solid #e2e8f0", borderRadius: 6, resize: "vertical" }} />
            </div>
            {backendError && <div className="notice error" style={{ marginBottom: 10, fontSize: "0.82rem" }}><span>!</span> {backendError}</div>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button type="button" className="btn-secondary" onClick={() => setShowBackendModal(false)} disabled={backendBusy}>Cancel</button>
              <button type="button" className="btn-primary" onClick={submitBackend} disabled={backendBusy || !backendTeamId} style={{ background: "#7c3aed", borderColor: "#7c3aed" }}>
                {backendBusy ? "Assigning…" : `Assign ${selected.size} POID${selected.size !== 1 ? "s" : ""}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── DIRECT CLOSE MODAL ───────────────────────────────────────────── */}
      {showDcModal && (
        <div style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
             onClick={dcBusy ? undefined : () => setShowDcModal(false)}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 20, width: "min(520px, 100%)", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)" }}
               onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: "1rem" }}>Direct Close <span style={{ color: "#64748b", fontWeight: 500 }}>· {selected.size} POID{selected.size !== 1 ? "s" : ""}</span></h3>
              <button type="button" onClick={() => setShowDcModal(false)} disabled={dcBusy} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#94a3b8", lineHeight: 1 }}>&times;</button>
            </div>
            {selectedRows.length > 0 && (
              <div style={{ fontSize: "0.76rem", color: "#475569", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", marginBottom: 12, maxHeight: 140, overflowY: "auto" }}>
                {selectedRows.map((r) => (
                  <div key={r.name} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "2px 0" }}>
                    <span style={{ fontFamily: "monospace", fontWeight: 700, color: "#0f172a" }}>{r.poid || r.name}</span>
                    <span style={{ color: "#64748b" }}>{r.po_no || "—"} · {r.item_code || "—"} · {r.site_code || "—"}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="form-group" style={{ marginBottom: 10 }}>
              <label>Type *</label>
              <div style={{ display: "inline-flex", gap: 0, background: "#f1f5f9", borderRadius: 8, padding: 3, border: "1px solid #e2e8f0" }}>
                {["INET", "SUB"].map((t) => (
                  <button key={t} type="button" disabled={dcBusy}
                    onClick={() => { setDcType(t); loadDcSubcontractors(t); }}
                    style={{ padding: "5px 18px", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: dcType === t ? 700 : 400, background: dcType === t ? "#0369a1" : "transparent", color: dcType === t ? "#fff" : "#64748b", transition: "all 0.15s" }}>
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <div className="form-group" style={{ marginBottom: 10 }}>
              <label>Subcontract *</label>
              <SearchableSelect
                value={dcSubcontractor}
                onChange={setDcSubcontractor}
                options={dcSubconOptions}
                placeholder={dcSubconLoading ? "Loading…" : "— Select subcontractor —"}
                disabled={dcBusy || dcSubconLoading}
              />
            </div>
            <div className="form-group" style={{ marginBottom: 10 }}>
              <label>Note (optional)</label>
              <textarea rows={2} value={dcNote} onChange={(e) => setDcNote(e.target.value)} disabled={dcBusy} style={{ width: "100%", boxSizing: "border-box", padding: "6px 8px", fontSize: "0.85rem", border: "1px solid #e2e8f0", borderRadius: 6, resize: "vertical" }} />
            </div>
            {dcError && <div className="notice error" style={{ marginBottom: 10, fontSize: "0.82rem" }}><span>!</span> {dcError}</div>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button type="button" className="btn-secondary" onClick={() => setShowDcModal(false)} disabled={dcBusy}>Cancel</button>
              <button type="button" className="btn-primary" onClick={submitDirectClose} disabled={dcBusy || !dcSubcontractor} style={{ background: "#0369a1", borderColor: "#0369a1" }}>
                {dcBusy ? "Closing…" : `Close ${selected.size} POID${selected.size !== 1 ? "s" : ""}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAssignModal && (
        <div style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
             onClick={assigning ? undefined : () => setShowAssignModal(false)}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 20, width: "min(440px, 100%)", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)" }}
               onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: "1rem" }}>Dispatch <span style={{ color: "#64748b", fontWeight: 500 }}>· {selected.size} line{selected.size !== 1 ? "s" : ""}</span></h3>
              <button type="button" onClick={() => setShowAssignModal(false)} disabled={assigning} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#94a3b8", lineHeight: 1 }}>&times;</button>
            </div>
            <div style={{ fontSize: "0.82rem", color: "#64748b", marginBottom: 12 }}>
              Pick a target month. These lines will move into <strong>My Dispatches</strong> and become available for rollout planning.
            </div>
            <div className="form-group" style={{ marginBottom: 10 }}>
              <label>Target month *</label>
              <select value={assignMonth} onChange={(e) => setAssignMonth(e.target.value)} required disabled={assigning}>
                {monthOptions().map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </div>
            {assignError && <div className="notice error" style={{ marginBottom: 10, fontSize: "0.82rem" }}><span>!</span> {assignError}</div>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button type="button" className="btn-secondary" onClick={() => setShowAssignModal(false)} disabled={assigning}>Cancel</button>
              <button type="button" className="btn-primary" onClick={submitAssign} disabled={assigning || !assignMonth}>
                {assigning ? "Dispatching…" : `Dispatch ${selected.size} line${selected.size !== 1 ? "s" : ""}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
