import { useCallback, useEffect, useState } from "react";
import DataTableWrapper from "../../components/DataTableWrapper";
import { useAuth } from "../../context/AuthContext";
import { useTableRowLimit } from "../../context/TableRowLimitContext";
import TableRowsLimitFooter from "../../components/TableRowsLimitFooter";
import { useDebounced } from "../../hooks/useDebounced";
import { pmApi } from "../../services/api";
import useFilterOptions from "../../hooks/useFilterOptions";
import SearchableSelect from "../../components/SearchableSelect";
import RecordDetailView, { DetailHero, DetailStatTile } from "../../components/RecordDetailView";
import DateRangePicker from "../../components/DateRangePicker";
import ExportExcelButton from "../../components/ExportExcelButton";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const VISIT_TYPES = ["Execution", "Re-Visit", "Extra Visit"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];
function todayMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
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
const HIDDEN_DETAIL_FIELDS = new Set([
  "owner", "creation", "modified", "modified_by", "docstatus", "idx",
  "original_dummy_poid", "was_dummy_po",
]);

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function Modal({ open, onClose, title, children, width = 460, footer = null }) {
  if (!open) return null;
  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(15,23,42,0.5)", display: "flex",
        alignItems: "center", justifyContent: "center", padding: 20,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#fff", borderRadius: 14,
          width, maxWidth: "calc(100vw - 40px)",
          maxHeight: "calc(100dvh - 40px)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.22)",
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 28px", borderBottom: "1px solid #e2e8f0", flexShrink: 0 }}>
          <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700 }}>{title}</h3>
          <button type="button" onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8" }}>&times;</button>
        </div>
        <div style={{ padding: "20px 28px", overflowY: "auto", flex: "1 1 auto", minHeight: 0 }}>
          {children}
        </div>
        {footer && (
          <div style={{ padding: "14px 28px", borderTop: "1px solid #e2e8f0", display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap", flexShrink: 0, background: "#fff" }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

function DispatchModeBadge({ mode }) {
  const isAuto = mode === "Auto";
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 5,
      padding: "3px 11px",
      borderRadius: 12,
      fontSize: "0.72rem",
      fontWeight: 700,
      background: isAuto
        ? "linear-gradient(90deg,#6366f1 0%,#8b5cf6 100%)"
        : "linear-gradient(90deg,#0ea5e9 0%,#06b6d4 100%)",
      color: "#fff",
      boxShadow: isAuto
        ? "0 1px 6px rgba(99,102,241,0.3)"
        : "0 1px 6px rgba(14,165,233,0.25)",
    }}>
      {isAuto ? "Auto Dispatched" : "Manual Dispatch"}
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

function DummyMappingBanner({ row }) {
  const orig = (row.original_dummy_poid || "").trim();
  const current = (row.poid || row.name || "").trim();
  const open = !!Number(row.is_dummy_po);
  const was = !!Number(row.was_dummy_po);
  if (!open && !was && !orig) return null;
  return (
    <div style={{
      marginBottom: 12,
      padding: "12px 14px",
      borderRadius: 10,
      background: open ? "#fffbeb" : "#eef2ff",
      border: `1px solid ${open ? "#fcd34d" : "#c7d2fe"}`,
    }}
    >
      <div style={{ fontSize: "0.68rem", fontWeight: 700, color: open ? "#92400e" : "#3730a3", letterSpacing: "0.04em", marginBottom: 6 }}>
        {open ? "OPEN DUMMY PO" : "MAPPED FROM DUMMY PO"}
      </div>
      {orig ? (
        <div style={{ fontSize: "0.82rem", color: "#0f172a", marginBottom: 4 }}>
          <span style={{ color: "#64748b" }}>Original dummy POID: </span>
          <code style={{ fontSize: "0.8rem", background: "#fff", padding: "2px 6px", borderRadius: 4, border: "1px solid #e2e8f0" }}>{orig}</code>
        </div>
      ) : null}
      {!open && orig && current && orig !== current ? (
        <div style={{ fontSize: "0.78rem", color: "#475569" }}>
          Current POID (after map): <code style={{ fontSize: "0.76rem" }}>{current}</code>
        </div>
      ) : null}
      {row.po_intake ? (
        <div style={{ fontSize: "0.76rem", color: "#64748b", marginTop: 6 }}>
          PO Intake: <span style={{ fontWeight: 600, color: "#334155" }}>{row.po_intake}</span>
        </div>
      ) : null}
    </div>
  );
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

export default function IMDispatch() {
  const { imName } = useAuth();
  const { rowLimit } = useTableRowLimit();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modeFilter, setModeFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState([]);
  const [teamFilter, setTeamFilter] = useState([]);
  const [duidFilter, setDuidFilter] = useState([]);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  // Workflow #2: "Unplanned" hides POIDs that already have a plan (default).
  // "All POIDs (re-plan)" shows them so the IM can pick one and create the
  // next sequential visit (visit_number auto-increments).
  const [planScope, setPlanScope] = useState("unplanned"); // "unplanned" | "all"
  const searchDebounced = useDebounced(search, 300);
  const [selected, setSelected] = useState(new Set());
  const [showModal, setShowModal] = useState(false);
  const [planDate, setPlanDate] = useState(todayDate());
  const [planEndDate, setPlanEndDate] = useState(todayDate());
  const [planTeam, setPlanTeam] = useState("");
  // Multi-team assignment (lead team + extras with per-team qty).
  const [planTeams, setPlanTeams] = useState([]);
  const [accessTime, setAccessTime] = useState("");
  const [accessPeriod, setAccessPeriod] = useState("");
  const [qcRequired, setQcRequired] = useState(true);
  const [ciagRequired, setCiagRequired] = useState(true);
  const [teamsList, setTeamsList] = useState([]);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [visitType, setVisitType] = useState("Execution");
  const [managerRemark, setManagerRemark] = useState("");
  const [creating, setCreating] = useState(false);
  const [successMsg, setSuccessMsg] = useState(null);
  const [createError, setCreateError] = useState(null);
  const [detailRow, setDetailRow] = useState(null);
  const [dummyFilter, setDummyFilter] = useState("all");
  const [showDummyModal, setShowDummyModal] = useState(false);
  const [dummyBusy, setDummyBusy] = useState(false);
  const [dummyErr, setDummyErr] = useState(null);
  const [projectsForDummy, setProjectsForDummy] = useState([]);
  const [duidsForDummy, setDuidsForDummy] = useState([]);
  const [duidSearch, setDuidSearch] = useState("");
  const [dummyForm, setDummyForm] = useState({ project_code: "", target_month: "", site_code: "", manager_remark: "" });
  const [mapForRow, setMapForRow] = useState(null);
  const [mapLines, setMapLines] = useState([]);
  const [mapLineId, setMapLineId] = useState("");
  const [mapBusy, setMapBusy] = useState(false);
  const [mapErr, setMapErr] = useState(null);
  const [mapLinesLoading, setMapLinesLoading] = useState(false);

  // Aggregate KPI counts — computed server-side so the cards never
  // change when the user picks a different row-limit preset.
  const [stats, setStats] = useState({ total: 0, auto: 0, manual: 0, dispatched: 0 });

  // ── Backend assignment ─────────────────────────────────────────────────
  const [canBackend, setCanBackend] = useState(false);
  const [showBackendModal, setShowBackendModal] = useState(false);
  const [backendTeams, setBackendTeams] = useState([]);
  const [backendTeamsLoading, setBackendTeamsLoading] = useState(false);
  const [backendTeamId, setBackendTeamId] = useState("");
  const [backendRemark, setBackendRemark] = useState("");
  const [backendBusy, setBackendBusy] = useState(false);
  const [backendError, setBackendError] = useState(null);

  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    if (!imName) {
      setRows([]);
      setStats({ total: 0, auto: 0, manual: 0, dispatched: 0 });
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const filters = [["im", "=", imName]];
        // Only rows the IM has scheduled (target_month set) — un-scheduled
        // dispatches appear in the new PO Intake page instead.
        const portal = { has_target_month: "yes" };
        if (searchDebounced.trim()) portal.search = searchDebounced.trim();
        if (modeFilter !== "all") portal.dispatch_mode = modeFilter;
        if (dummyFilter !== "all") portal.dummy_preset = dummyFilter;
        if (projectFilter.length) portal.project_code = projectFilter;
        if (teamFilter.length) portal.team = teamFilter;
        if (duidFilter.length) portal.site_code = duidFilter;
        if (fromDate) portal.from_date = fromDate;
        if (toDate) portal.to_date = toDate;
        const portalArg = Object.keys(portal).length ? portal : undefined;
        const [res, agg] = await Promise.all([
          pmApi.listPODispatches(filters, rowLimit, portalArg),
          pmApi.getPODispatchStats(filters, portalArg).catch(() => null),
        ]);
        if (!cancelled) {
          setRows(Array.isArray(res) ? res : []);
          if (agg && typeof agg === "object") {
            setStats({
              total: Number(agg.total) || 0,
              auto: Number(agg.auto) || 0,
              manual: Number(agg.manual) || 0,
              dispatched: Number(agg.dispatched) || 0,
            });
          }
        }
      } catch (err) {
        if (!cancelled) setError(err.message || "Failed to load dispatches");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [
    imName,
    rowLimit,
    searchDebounced,
    modeFilter,
    dummyFilter,
    projectFilter,
    teamFilter,
    duidFilter,
    fromDate,
    toDate,
    refreshKey,
  ]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await pmApi.getMyBackendCapability();
        if (!cancelled) setCanBackend(!!res?.can_assign_backend);
      } catch {
        if (!cancelled) setCanBackend(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!showModal || !imName) return;
    let cancelled = false;
    (async () => {
      setTeamsLoading(true);
      try {
        const list = await pmApi.listINETTeams({ im: imName, status: "Active" });
        const fieldOnly = (Array.isArray(list) ? list : []).filter(
          (t) => (t.team_category || "Field Team") !== "Backend Team"
        );
        if (!cancelled) setTeamsList(fieldOnly);
      } catch {
        if (!cancelled) setTeamsList([]);
      } finally {
        if (!cancelled) setTeamsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [showModal, imName]);

  useEffect(() => {
    if (!mapForRow?.project_code) {
      setMapLines([]);
      setMapLineId("");
      return undefined;
    }
    let cancelled = false;
    (async () => {
      setMapLinesLoading(true);
      setMapErr(null);
      try {
        const list = await pmApi.listPoIntakeLinesForIMMap(mapForRow.project_code);
        if (!cancelled) {
          setMapLines(Array.isArray(list) ? list : []);
          setMapLineId("");
        }
      } catch (e) {
        if (!cancelled) {
          setMapLines([]);
          setMapErr(e.message || "Failed to load PO lines");
        }
      } finally {
        if (!cancelled) setMapLinesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [mapForRow]);

  async function openDummyPoModal() {
    setDummyErr(null);
    setDummyForm({
      project_code: Array.isArray(projectFilter) ? (projectFilter[0] || "") : (projectFilter || ""),
      target_month: todayMonth(),
      site_code: "",
      manager_remark: "",
    });
    setDuidsForDummy([]);
    setDuidSearch("");
    setShowDummyModal(true);
    if (!imName) {
      setProjectsForDummy([]);
      return;
    }
    try {
      const fields = JSON.stringify([
        "name", "project_code", "project_name", "implementation_manager",
      ]);
      const filters = JSON.stringify([["implementation_manager", "=", imName]]);
      const res = await fetch(
        `/api/resource/Project Control Center?filters=${encodeURIComponent(filters)}` +
        `&fields=${encodeURIComponent(fields)}&limit_page_length=200&order_by=modified+desc`,
        { credentials: "include" },
      );
      const json = await res.json();
      setProjectsForDummy(Array.isArray(json?.data) ? json.data : []);
    } catch {
      setProjectsForDummy([]);
    }
  }

  // Server-side DUID search for the dummy modal. When the user types
  // we search across ALL DUID Master rows, not just the first 500.
  useEffect(() => {
    if (!showDummyModal) return undefined;
    let cancelled = false;
    const q = (duidSearch || "").trim();
    (async () => {
      try {
        const fields = JSON.stringify(["name", "site_name", "center_area"]);
        let url = `/api/resource/DUID Master?fields=${encodeURIComponent(fields)}` +
          `&limit_page_length=200&order_by=modified+desc`;
        if (q) {
          url += `&filters=${encodeURIComponent(JSON.stringify([["name", "like", `%${q}%`]]))}`;
        }
        const res = await fetch(url, { credentials: "include" });
        const json = await res.json();
        if (!cancelled) setDuidsForDummy(Array.isArray(json?.data) ? json.data : []);
      } catch {
        if (!cancelled) setDuidsForDummy([]);
      }
    })();
    return () => { cancelled = true; };
  }, [showDummyModal, duidSearch]);

  async function submitDummyPo() {
    if (!dummyForm.project_code) {
      setDummyErr("Select a project.");
      return;
    }
    setDummyBusy(true);
    setDummyErr(null);
    try {
      await pmApi.createIMDummyPODispatch({
        project_code: dummyForm.project_code,
        target_month: dummyForm.target_month || undefined,
        site_code: dummyForm.site_code || undefined,
        manager_remark: dummyForm.manager_remark || undefined,
      });
      setShowDummyModal(false);
      setSuccessMsg("Dummy PO created.");
      await load();
    } catch (e) {
      setDummyErr(e.message || "Could not create dummy PO");
    } finally {
      setDummyBusy(false);
    }
  }

  async function submitMapDummy() {
    if (!mapForRow || !mapLineId) return;
    setMapBusy(true);
    setMapErr(null);
    try {
      const res = await pmApi.mapIMDummyPoToIntakeLine({
        dummy_po_dispatch: mapForRow.name,
        po_intake_line: mapLineId,
      });
      setMapForRow(null);
      setDetailRow(null);
      const oid = (res?.original_dummy_poid || "").trim();
      const pid = (res?.poid || res?.name || "").trim();
      const pint = (res?.po_intake || "").trim();
      setSuccessMsg(
        oid
          ? `Mapped. POID ${pid}. Original dummy POID: ${oid}${pint ? `. Intake: ${pint}` : ""}.`
          : "Dummy PO mapped. POID updated.",
      );
      await load();
    } catch (e) {
      setMapErr(e.message || "Map failed");
    } finally {
      setMapBusy(false);
    }
  }

  // In "all" scope, planned rows are also planable (re-plan creates next visit).
  const planable = (r) => {
    const s = (r.dispatch_status || "");
    if (s === "Dispatched") return true;
    if (planScope === "all" && s === "Planned") return true;
    return false;
  };

  // Hide rows that are already planned — except unmapped Dummy POs (still
  // need mapping) and when the user explicitly opted into "all" scope.
  const isUnmappedDummy = (r) =>
    Number(r.is_dummy_po) === 1
    && (!r.po_no || String(r.po_no).startsWith("DUMMY-"));
  const openDummyCount = rows.filter((r) => Number(r.is_dummy_po) === 1).length;
  const visibleRows = rows.filter((r) => {
    if (planScope === "all") return true;
    return (r.dispatch_status || "") === "Dispatched";
  });

  const planableRows = visibleRows.filter(planable);
  // Distinct values across ALL dispatches — so dropdowns stay complete under any row limit.
  const { options: dispOpts } = useFilterOptions("PO Dispatch", ["project_code", "site_code"]);
  const { options: teamOpts } = useFilterOptions("INET Team", ["team_id"]);
  const projectOptions = dispOpts.project_code || [];
  const duidOptions = dispOpts.site_code || [];
  const teamOptions = teamOpts.team_id || [];
  const hasFilters = !!(search || modeFilter !== "all" || dummyFilter !== "all" || projectFilter.length || teamFilter.length || duidFilter.length || fromDate || toDate);

  function toggleRow(name) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function toggleAllPlanable() {
    if (selected.size === planableRows.length && planableRows.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(planableRows.map((r) => r.name)));
    }
  }

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
      const statuses = [...new Set(blocked.map((r) => r.dispatch_status))].join(", ");
      setBackendError(`Cannot assign: ${blocked.length} POID${blocked.length !== 1 ? "s have" : " has"} status ${statuses}. Deselect to continue.`);
      return;
    }
    setBackendBusy(true);
    setBackendError(null);
    try {
      const res = await pmApi.assignBackend(ids, backendTeamId, backendRemark);
      const summary = res?.summary || {};
      const okN = summary.updated_count ?? 0;
      const errN = summary.error_count ?? 0;
      const teamLbl = summary.subcon_team_name || backendTeamId;
      if (errN === 0) {
        setShowBackendModal(false);
        setSuccessMsg(`Assigned ${okN} POID${okN !== 1 ? "s" : ""} to backend team ${teamLbl}.`);
        setTimeout(() => setSuccessMsg(null), 4500);
        setSelected(new Set());
        load();
      } else {
        const firstErr = (res?.errors || [])[0];
        const tail = firstErr ? `${firstErr.poid || firstErr.po_dispatch}: ${firstErr.error}` : "see errors";
        setBackendError(`${okN} assigned, ${errN} failed (${tail})`);
        if (okN > 0) load();
      }
    } catch (err) {
      setBackendError(err.message || "Failed to assign to backend");
    } finally {
      setBackendBusy(false);
    }
  }

  function openCreatePlanModal() {
    setCreateError(null);
    setPlanTeam("");
    setPlanTeams([]);
    setPlanEndDate(planDate);
    setAccessTime("");
    setAccessPeriod("");
    setQcRequired(true);
    setCiagRequired(true);
    setManagerRemark("");
    setShowModal(true);
  }

  async function handleCreatePlans() {
    if (selected.size === 0 || !planDate || !planEndDate || !visitType || !planTeam) return;
    if (planEndDate < planDate) {
      setCreateError("Planned end date cannot be before start date.");
      return;
    }
    const blocked = rows.filter((r) => selected.has(r.name) && ["Closed", "Completed"].includes(r.dispatch_status));
    if (blocked.length > 0) {
      const statuses = [...new Set(blocked.map((r) => r.dispatch_status))].join(", ");
      setCreateError(`Cannot plan: ${blocked.length} POID${blocked.length !== 1 ? "s have" : " has"} status ${statuses}. Deselect to continue.`);
      return;
    }
    setCreating(true);
    setCreateError(null);
    setSuccessMsg(null);
    try {
      const dispatches = Array.from(selected);
      const validExtras = (planTeams || []).filter((r) => r.team);
      const teamsPayload = validExtras.length > 0
        ? [
            ...(validExtras.some((r) => r.team === planTeam)
              ? []
              : [{ team: planTeam, assigned_qty: 0 }]),
            ...validExtras.map((r) => ({
              team: r.team,
              assigned_qty: Number(r.assigned_qty) || 0,
            })),
          ]
        : [];
      const result = await pmApi.createRolloutPlans({
        dispatches,
        plan_date: planDate,
        plan_end_date: planEndDate,
        team: planTeam,
        teams: teamsPayload,
        access_time: accessTime,
        access_period: accessPeriod,
        qc_required: qcRequired ? 1 : 0,
        ciag_required: ciagRequired ? 1 : 0,
        visit_type: visitType,
        manager_remark: managerRemark || undefined,
      });
      const count = result?.created ?? dispatches.length;
      setSuccessMsg(`Created ${count} rollout plan${count !== 1 ? "s" : ""}. View them under Planning.`);
      setSelected(new Set());
      setShowModal(false);
      await load();
    } catch (err) {
      setCreateError(err.message || "Failed to create plans");
    } finally {
      setCreating(false);
    }
  }

  // KPI card counts come from the server aggregate (stats) so they
  // reflect the full dataset regardless of the row-limit preset.
  const autoCount = stats.auto;
  const manualCount = stats.manual;
  const dispatchedCount = stats.dispatched;
  const hasAnyDispatches = stats.total > 0 || rows.length > 0;

  const selectedAmt = rows
    .filter((r) => selected.has(r.name))
    .reduce((s, r) => s + (r.line_amount || 0), 0);

  const createPlanSelRows = rows.filter((r) => selected.has(r.name));
  const selectedBackendRows = createPlanSelRows;
  const createPlanDuids = [...new Set(createPlanSelRows.map((r) => r.site_code || r.name).filter(Boolean))];
  const createPlanTotalQty = createPlanSelRows.reduce((s, r) => s + Number(r.qty || 0), 0);
  const planTeamsAssignedQty = (planTeams || [])
    .filter((r) => r.team)
    .reduce((s, r) => s + (Number(r.assigned_qty) || 0), 0);
  const planTeamsRemaining = createPlanTotalQty - planTeamsAssignedQty;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Rollout Planning</h1>
          <div className="page-subtitle">Dispatch lines assigned to your IM.</div>
        </div>
        <div className="page-actions" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={openDummyPoModal}
            disabled={!imName}
            style={{
              border: "none",
              borderRadius: 10,
              padding: "10px 18px",
              fontSize: "0.88rem",
              fontWeight: 700,
              color: "#fff",
              cursor: !imName ? "not-allowed" : "pointer",
              opacity: !imName ? 0.55 : 1,
              background: "linear-gradient(135deg,#6366f1 0%,#7c3aed 100%)",
              boxShadow: "0 4px 14px rgba(99,102,241,0.28)",
            }}
          >
            Dummy PO
          </button>
          <ExportExcelButton filename="im-dispatch" rows={visibleRows} />
          <button className="btn-secondary" onClick={load} disabled={loading}>
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
      </div>

      {successMsg && (
        <div className="notice success" style={{ margin: "0 28px 16px" }}>
          <span>✓</span> {successMsg}
        </div>
      )}

      {/* KPI row + scope toggle share the same line to save vertical
          space. Toggle uses a stronger active state so it reads as a
          clickable tab control, not a label. */}
      {!loading && hasAnyDispatches && (
        <div style={{ display: "flex", gap: 8, margin: "0 16px 6px", flexWrap: "wrap", alignItems: "center" }}>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "3px 10px", borderRadius: 999,
            background: "#fff7ed", color: "#c2410c",
            border: "1px solid #fed7aa", fontSize: "0.74rem", fontWeight: 700,
          }}>
            <span style={{ opacity: 0.85 }}>Ready</span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{dispatchedCount}</span>
          </div>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "3px 10px", borderRadius: 999,
            background: "#eef2ff", color: "#4338ca",
            border: "1px solid #c7d2fe", fontSize: "0.74rem", fontWeight: 700,
          }}>
            <span style={{ opacity: 0.85 }}>Auto</span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{autoCount}</span>
          </div>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "3px 10px", borderRadius: 999,
            background: "#ecfeff", color: "#0e7490",
            border: "1px solid #a5f3fc", fontSize: "0.74rem", fontWeight: 700,
          }}>
            <span style={{ opacity: 0.85 }}>Manual</span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{manualCount}</span>
          </div>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "3px 10px", borderRadius: 999,
            background: "#eef2ff", color: "#4338ca",
            border: "1px solid #c7d2fe", fontSize: "0.74rem", fontWeight: 700,
          }}>
            <span style={{ opacity: 0.85 }}>Dummy</span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{openDummyCount}</span>
          </div>

          <div style={{ flex: 1 }} />

          {/* Scope toggle — visible "tabs" with a clearly active blue pill
              and a subtle hover hint on the inactive button. */}
          <div role="tablist" aria-label="Plan scope" style={{
            display: "inline-flex", padding: 3,
            background: "#f1f5f9", borderRadius: 8,
            border: "1px solid #e2e8f0",
          }}>
            {[
              { id: "unplanned", label: "Unplanned" },
              { id: "all",       label: "All POIDs (re-plan)" },
            ].map((tab) => {
              const active = planScope === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => { setSelected(new Set()); setPlanScope(tab.id); }}
                  onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "#e2e8f0"; }}
                  onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
                  style={{
                    padding: "5px 14px", fontSize: "0.78rem", fontWeight: 700,
                    border: "none", borderRadius: 6, cursor: "pointer",
                    background: active ? "#1d4ed8" : "transparent",
                    color: active ? "#fff" : "#475569",
                    boxShadow: active ? "0 1px 3px rgba(29,78,216,0.3)" : "none",
                    transition: "background 120ms",
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="toolbar">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select
            value={dummyFilter}
            onChange={(e) => setDummyFilter(e.target.value)}
            style={{ minWidth: 120, padding: "7px 10px", borderRadius: 8, border: "1px solid #dbe3ef", fontSize: "0.84rem", background: "#fff" }}
          >
            <option value="all">All lines</option>
            <option value="dummy">Open dummy only</option>
            <option value="mapped_dummy">Mapped from dummy</option>
            <option value="standard">Exclude open dummy</option>
          </select>
          <select
            value={modeFilter}
            onChange={(e) => setModeFilter(e.target.value)}
            style={{ minWidth: 86, padding: "7px 10px", borderRadius: 8, border: "1px solid #dbe3ef", fontSize: "0.84rem", background: "#fff" }}
          >
            <option value="all">All</option>
            <option value="Auto">Auto</option>
            <option value="Manual">Manual</option>
          </select>
          <input
            type="search"
            placeholder="Search PO, DUID, POID, Project, Center area, Region…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              padding: "7px 14px",
              borderRadius: 8,
              border: "1px solid #e2e8f0",
              fontSize: "0.84rem",
              minWidth: 220,
            }}
          />
          <SearchableSelect multi value={projectFilter} onChange={setProjectFilter} options={projectOptions} placeholder="All Projects" minWidth={170} />
          <SearchableSelect multi value={teamFilter} onChange={setTeamFilter} options={teamOptions} placeholder="All Teams" minWidth={150} />
          <SearchableSelect multi value={duidFilter} onChange={setDuidFilter} options={duidOptions} placeholder="All DUIDs" minWidth={150} />
          <DateRangePicker value={{ from: fromDate, to: toDate }} onChange={({ from, to }) => { setFromDate(from); setToDate(to); }} />
          {hasFilters && (
            <button className="btn-secondary" style={{ fontSize: "0.78rem", padding: "5px 12px" }} onClick={() => { setSearch(""); setModeFilter("all"); setDummyFilter("all"); setProjectFilter([]); setTeamFilter([]); setDuidFilter([]); setFromDate(""); setToDate(""); }}>
              Clear
            </button>
          )}
        </div>
        <div className="toolbar-actions">
          {selected.size > 0 && (
            <span style={{ fontSize: "0.78rem", color: "#64748b", whiteSpace: "nowrap" }}>
              {selected.size} selected · SAR {fmt.format(selectedAmt)}
            </span>
          )}
          <button
            type="button"
            className="btn-primary"
            onClick={openCreatePlanModal}
            disabled={selected.size === 0}
          >
            Create rollout plans ({selected.size})
          </button>
          {canBackend && (
            <button
              type="button"
              className="btn-secondary"
              onClick={openBackendModal}
              disabled={selected.size === 0}
              style={{ borderColor: "#a78bfa", color: "#7c3aed" }}
            >
              Assign to Backend ({selected.size})
            </button>
          )}
        </div>
      </div>

      <Modal
        open={showModal}
        onClose={() => !creating && setShowModal(false)}
        title="Create rollout plans for selected DUIDs"
        width={840}
        footer={
          <>
            <button type="button" className="btn-secondary" disabled={creating} onClick={() => setShowModal(false)}>Cancel</button>
            <button type="button" className="btn-primary" disabled={creating || !planDate || !planEndDate || !visitType || !planTeam} onClick={handleCreatePlans}>
              {creating ? "Creating…" : "Create"}
            </button>
          </>
        }
      >
        {createError && <div className="notice error" style={{ marginBottom: 12 }}>{createError}</div>}
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: "0.72rem", fontWeight: 600, color: "#94a3b8", letterSpacing: "0.06em", marginBottom: 8 }}>SELECTED DUIDs</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, maxHeight: 120, overflowY: "auto", padding: 4 }}>
            {createPlanDuids.map((d) => (
              <span
                key={d}
                style={{
                  display: "inline-block",
                  maxWidth: "100%",
                  padding: "6px 10px",
                  borderRadius: 8,
                  background: "#f1f5f9",
                  border: "1px solid #e2e8f0",
                  fontSize: "0.78rem",
                  fontWeight: 600,
                  color: "#334155",
                  fontFamily: "ui-monospace, monospace",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                title={d}
              >
                {d}
              </span>
            ))}
          </div>
          <p style={{ fontSize: "0.78rem", color: "#64748b", margin: "8px 0 0" }}>
            IM <strong>{imName || "—"}</strong> · {selected.size} line{selected.size !== 1 ? "s" : ""} · Qty <strong style={{ color: "#0f172a" }}>{fmt.format(createPlanTotalQty)}</strong> → <strong>Planned</strong> · SAR {fmt.format(selectedAmt)}
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px 16px", marginBottom: 14 }}>
          <div>
            <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, marginBottom: 6, color: "#475569" }}>Lead team</label>
            <select
              value={planTeam}
              onChange={(e) => setPlanTeam(e.target.value)}
              disabled={teamsLoading || !imName}
              style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e2e8f0", boxSizing: "border-box" }}
            >
              <option value="">{teamsLoading ? "Loading teams…" : !imName ? "Link IM to load teams" : "Select team"}</option>
              {teamsList.map((t) => (
                <option key={t.team_id} value={t.team_id}>{t.team_name || t.team_id}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, marginBottom: 6, color: "#475569" }}>Visit type</label>
            <select value={visitType} onChange={(e) => setVisitType(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e2e8f0", boxSizing: "border-box" }}>
              {VISIT_TYPES.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
        </div>

        {/* Optional multi-team split */}
        <div style={{ background: "#fafbfc", border: "1px solid #e5e7eb", borderRadius: 8, padding: 12, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontSize: "0.74rem", fontWeight: 700, color: "#475569" }}>ADDITIONAL TEAMS (optional)</div>
            <button
              type="button"
              onClick={() => setPlanTeams((arr) => [...arr, { team: "", assigned_qty: 0 }])}
              style={{ fontSize: "0.74rem", padding: "4px 10px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer", fontWeight: 600, color: "#1d4ed8" }}
            >
              + Add team
            </button>
          </div>
          <div style={{
            fontSize: "0.74rem", color: "#475569", marginBottom: 8,
            padding: "6px 8px", borderRadius: 6,
            background: planTeamsRemaining < 0 ? "#fef2f2" : "#eef2ff",
            border: planTeamsRemaining < 0 ? "1px solid #fecaca" : "1px solid #c7d2fe",
          }}>
            Total qty <strong>{fmt.format(createPlanTotalQty)}</strong>
            {" · Assigned to extras "}
            <strong>{fmt.format(planTeamsAssignedQty)}</strong>
            {" · Remaining for lead team "}
            <strong style={{ color: planTeamsRemaining < 0 ? "#b91c1c" : "#1d4ed8" }}>
              {fmt.format(planTeamsRemaining)}
            </strong>
            {planTeamsRemaining < 0 && (
              <span style={{ marginLeft: 8, color: "#b91c1c", fontWeight: 700 }}>⚠ over total</span>
            )}
          </div>
          {planTeams.length === 0 ? (
            <div style={{ fontSize: "0.74rem", color: "#94a3b8" }}>
              Single-team plan. Add another team to split the line.
            </div>
          ) : (
            <div>
              {planTeams.map((row, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                  <select
                    value={row.team || ""}
                    onChange={(e) => setPlanTeams((arr) => arr.map((x, j) => j === i ? { ...x, team: e.target.value } : x))}
                    style={{ flex: 2, padding: "6px 10px", borderRadius: 6, border: "1px solid #e2e8f0" }}
                  >
                    <option value="">Select team</option>
                    {teamsList.filter((t) => t.team_id !== planTeam || row.team === t.team_id).map((t) => (
                      <option key={t.team_id} value={t.team_id}>{t.team_name || t.team_id}</option>
                    ))}
                  </select>
                  <input
                    // type=text + inputMode=decimal — type=number breaks
                    // mid-decimal entry in Chrome (it reports "" while the
                    // user is typing "0.", which clears the controlled input).
                    type="text"
                    inputMode="decimal"
                    pattern="[0-9]*\.?[0-9]*"
                    value={row.assigned_qty ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v !== "" && !/^\d*\.?\d*$/.test(v)) return;
                      setPlanTeams((arr) => arr.map((x, j) => j === i ? { ...x, assigned_qty: v } : x));
                    }}
                    placeholder="Qty"
                    style={{ flex: 1, padding: "6px 10px", borderRadius: 6, border: "1px solid #e2e8f0" }}
                  />
                  <button
                    type="button"
                    onClick={() => setPlanTeams((arr) => arr.filter((_, j) => j !== i))}
                    style={{ fontSize: "0.78rem", padding: "4px 8px", borderRadius: 6, border: "1px solid #fecaca", background: "#fff", cursor: "pointer", color: "#b91c1c" }}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <div style={{ fontSize: "0.7rem", color: "#64748b", marginTop: 4 }}>
                Lead team gets the remaining qty if you leave it blank.
              </div>
            </div>
          )}
        </div>

        <div style={{ fontSize: "0.72rem", fontWeight: 600, color: "#94a3b8", letterSpacing: "0.06em", marginBottom: 10 }}>ACCESS DETAILS</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px 16px", marginBottom: 16 }}>
          <div>
            <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, marginBottom: 6, color: "#475569" }}>Planned start date</label>
            <input
              type="date"
              value={planDate}
              onChange={(e) => {
                const v = e.target.value;
                setPlanDate(v);
                setPlanEndDate((ed) => (ed < v ? v : ed));
              }}
              style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e2e8f0", boxSizing: "border-box" }}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, marginBottom: 6, color: "#475569" }}>Planned end date</label>
            <input type="date" value={planEndDate} min={planDate} onChange={(e) => setPlanEndDate(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e2e8f0", boxSizing: "border-box" }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, marginBottom: 6, color: "#475569" }}>Access time</label>
            <input type="text" value={accessTime} onChange={(e) => setAccessTime(e.target.value)} placeholder="e.g. 08:00 or hours" style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e2e8f0", boxSizing: "border-box" }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, marginBottom: 6, color: "#475569" }}>Access period</label>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", padding: "9px 0" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.86rem", cursor: "pointer" }}>
                <input type="radio" name="access_period_im" checked={accessPeriod === ""} onChange={() => setAccessPeriod("")} />
                Not set
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.86rem", cursor: "pointer" }}>
                <input type="radio" name="access_period_im" checked={accessPeriod === "Day"} onChange={() => setAccessPeriod("Day")} />
                Day
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.86rem", cursor: "pointer" }}>
                <input type="radio" name="access_period_im" checked={accessPeriod === "Night"} onChange={() => setAccessPeriod("Night")} />
                Night
              </label>
            </div>
          </div>
        </div>

        {/* Per-plan workflow toggles. When unchecked, the field
            team isn't asked for that step and the IM can close the
            plan to Work Done without recording it. */}
        <div style={{
          display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap",
          padding: "10px 12px", background: "#f8fafc",
          border: "1px solid #e2e8f0", borderRadius: 6, marginBottom: 16,
        }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.86rem", cursor: "pointer", fontWeight: 600 }}>
            <input type="checkbox" checked={qcRequired} onChange={(e) => setQcRequired(e.target.checked)} />
            QC Required
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.86rem", cursor: "pointer", fontWeight: 600 }}>
            <input type="checkbox" checked={ciagRequired} onChange={(e) => setCiagRequired(e.target.checked)} />
            CIAG Required
          </label>
        </div>

        <div className="form-group" style={{ marginBottom: 16 }}>
          <label>Remark</label>
          <textarea
            rows={3}
            value={managerRemark}
            onChange={(e) => setManagerRemark(e.target.value)}
            placeholder="Remark for these rollout plans…"
            style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", fontSize: "0.86rem", border: "1px solid #e2e8f0", borderRadius: 6, resize: "vertical", minHeight: 60 }}
          />
        </div>
      </Modal>

      <Modal open={!!detailRow} onClose={() => setDetailRow(null)} title={`PO Dispatch Details${detailRow?.poid ? ` · ${detailRow.poid}` : detailRow?.name ? ` · ${detailRow.name}` : ""}`} width={760}>
        {detailRow && (
          <>
            <DummyMappingBanner row={detailRow} />
            {!!Number(detailRow.is_dummy_po) && (
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
                <button
                  type="button"
                  className="btn-primary"
                  style={{ fontSize: "0.78rem", padding: "8px 14px" }}
                  onClick={() => {
                    const r = detailRow;
                    setDetailRow(null);
                    setMapErr(null);
                    setMapForRow(r);
                  }}
                >
                  Map PO
                </button>
              </div>
            )}
            <RecordDetailView
              row={detailRow}
              pills={[
                { label: "POID", value: detailRow.poid || detailRow.name || "—", tone: "blue" },
                { label: "Project", value: detailRow.project_code || "—", tone: "amber" },
                { label: "IM", value: detailRow.im_full_name || detailRow.im || "—", tone: "green" },
                detailRow.dispatch_mode ? { label: "Mode", value: detailRow.dispatch_mode, tone: detailRow.dispatch_mode === "Auto" ? "violet" : "slate" } : null,
              ].filter(Boolean)}
              hero={
                <DetailHero>
                  <DetailStatTile label="Item Code" value={detailRow.item_code || "—"} />
                  <DetailStatTile label="Qty" value={detailRow.qty != null ? fmt.format(detailRow.qty) : "—"} tone="blue" />
                  <DetailStatTile label="Rate (SAR)" value={detailRow.rate != null ? fmt.format(detailRow.rate) : "—"} />
                  <DetailStatTile label="Line Amount (SAR)" value={detailRow.line_amount != null ? fmt.format(detailRow.line_amount) : "—"} tone="green" />
                  {detailRow.dispatch_status && (
                    <DetailStatTile
                      label="Status"
                      value={detailRow.dispatch_status}
                      tone={/complete|dispatched/i.test(detailRow.dispatch_status) ? "green" : /cancel|reject/i.test(detailRow.dispatch_status) ? "rose" : /progress/i.test(detailRow.dispatch_status) ? "blue" : "amber"}
                    />
                  )}
                </DetailHero>
              }
              hiddenFields={[
                ...HIDDEN_DETAIL_FIELDS,
                "project_code", "im", "im_full_name",
                "item_code", "qty", "rate", "line_amount",
                "dispatch_status", "dispatch_mode",
              ]}
              keyOrder={[
                "item_description",
                "name", "system_id", "poid", "po_no", "po_intake",
                "po_line_no", "shipment_number",
                "site_code", "site_name", "area", "center_area", "region_type",
                "target_month", "planning_mode",
                "is_dummy_po", "was_dummy_po", "original_dummy_poid",
                "customer",
              ]}
            />
          </>
        )}
      </Modal>

      <Modal
        open={showDummyModal}
        onClose={() => !dummyBusy && setShowDummyModal(false)}
        title="Dummy PO"
        width={620}
      >
        {dummyErr && <div className="notice error" style={{ marginBottom: 12 }}>{dummyErr}</div>}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, marginBottom: 6, color: "#475569" }}>Project</label>
          <select
            value={dummyForm.project_code}
            onChange={(e) => setDummyForm((f) => ({ ...f, project_code: e.target.value }))}
            style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e2e8f0", boxSizing: "border-box" }}
          >
            <option value="">{projectsForDummy.length ? "Select project" : "No projects (check IM link)"}</option>
            {projectsForDummy.map((p) => (
              <option key={p.name} value={p.project_code || p.name}>
                {p.project_code || p.name}{p.project_name ? ` — ${p.project_name}` : ""}
              </option>
            ))}
          </select>
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, marginBottom: 6, color: "#475569" }}>Target month</label>
          <select
            value={dummyForm.target_month || ""}
            onChange={(e) => setDummyForm((f) => ({ ...f, target_month: e.target.value }))}
            style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e2e8f0", boxSizing: "border-box" }}
          >
            {monthOptions().map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, marginBottom: 6, color: "#475569" }}>
            DUID
          </label>
          <SearchableSelect
            value={dummyForm.site_code || ""}
            onChange={(v) => setDummyForm((f) => ({ ...f, site_code: v || "" }))}
            onSearch={setDuidSearch}
            options={duidsForDummy.map((d) => ({
              id: d.name,
              label: d.site_name && d.site_name !== d.name ? `${d.name} — ${d.site_name}` : d.name,
            }))}
            placeholder="Auto placeholder (DUMMY-…)"
            allLabel="Auto placeholder (DUMMY-…)"
            style={{ display: "block", width: "100%" }}
            minWidth={0}
            triggerStyle={{
              width: "100%", borderRadius: 8, fontSize: "0.88rem",
            }}
            panelStyle={{
              width: "100%", minWidth: 0, maxWidth: "none", right: 0,
            }}
          />
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, marginBottom: 6, color: "#475569" }}>
            Note for field team
          </label>
          <textarea
            value={dummyForm.manager_remark || ""}
            onChange={(e) => setDummyForm((f) => ({ ...f, manager_remark: e.target.value }))}
            rows={3}
            style={{
              width: "100%", padding: 10, borderRadius: 8,
              border: "1px solid #e2e8f0", boxSizing: "border-box",
              fontFamily: "inherit", fontSize: "0.84rem", resize: "vertical",
            }}
          />
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button type="button" className="btn-secondary" disabled={dummyBusy} onClick={() => setShowDummyModal(false)}>Cancel</button>
          <button type="button" className="btn-primary" disabled={dummyBusy} onClick={submitDummyPo}>
            {dummyBusy ? "Creating…" : "Create"}
          </button>
        </div>
      </Modal>

      {mapForRow && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={() => !mapBusy && setMapForRow(null)}
        >
          <div
            style={{ background: "#fff", borderRadius: 12, padding: 24, width: "min(480px, 96vw)", boxShadow: "0 20px 60px rgba(0,0,0,0.22)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 6px", fontSize: "1.05rem" }}>Map Dummy PO</h3>
            <p style={{ fontSize: "0.82rem", color: "#64748b", margin: "0 0 16px" }}>
              POID: <strong>{mapForRow.poid || mapForRow.name}</strong>
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

      <div className="page-content">
        {error && (
          <div className="notice error" style={{ marginBottom: 16 }}>
            <span>!</span> {error}
          </div>
        )}

        <DataTableWrapper>
          {loading && rows.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
              Loading dispatches...
            </div>
          ) : visibleRows.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📋</div>
              <h3>{!imName ? "IM account not linked" : "No dispatch records found"}</h3>
              <p>
                {!imName
                  ? "Link your user to IM Master so dispatches can load."
                  : hasFilters
                    ? "No rows match your search or filters (they apply across all dispatches, not only loaded rows)."
                    : "No PO lines have been dispatched to you yet."}
              </p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 40 }}>
                    <input
                      type="checkbox"
                      aria-label="Select all planable"
                      checked={planableRows.length > 0 && planableRows.every((r) => selected.has(r.name))}
                      onChange={toggleAllPlanable}
                    />
                  </th>
                  <th>POID</th>
                  <th>Mode</th>
                  <th>Dummy POID</th>
                  <th>PO No</th>
                  <th>Project</th>
                  <th>Item</th>
                  <th>Description</th>
                  <th>Activity Type</th>
                  <th style={{ textAlign: "right" }}>Qty</th>
                  <th style={{ textAlign: "right" }}>Amount</th>
                  <th>IM</th>
                  <th>DUID</th>
                  <th>Center area</th>
                  <th>Region</th>
                  <th>Status</th>
                  <th style={{ minWidth: 160, width: 160, whiteSpace: "nowrap" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => {
                  const canPlan = planable(row);
                  const wasDf = row.was_dummy_po == 1 || row.was_dummy_po === true || String(row.was_dummy_po || "") === "1";
                  const origCell = (row.original_dummy_poid || "").trim();
                  // Compare against the business POID, not the SYS- doc name.
                  const nameCell = (row.poid || row.name || "").trim();
                  return (
                    <tr
                      key={row.name}
                      style={{
                        background: !!Number(row.is_dummy_po) ? "#fffbeb" : row.dispatch_mode === "Auto" ? "rgba(99,102,241,0.04)" : undefined,
                        opacity: canPlan ? 1 : 0.85,
                      }}
                    >
                      <td>
                        <input
                          type="checkbox"
                          checked={selected.has(row.name)}
                          disabled={!canPlan}
                          onChange={() => toggleRow(row.name)}
                          title={canPlan ? "" : "Only Dispatched lines can be planned"}
                        />
                      </td>
                      <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>
                        <span>{row.poid || row.name}</span>
                        {(row.dispatch_status || "").toLowerCase() === "planned" && (
                          <span
                            title="A rollout plan already exists. Selecting will create a new visit (visit_number auto-increments)."
                            style={{
                              display: "inline-block", marginLeft: 6,
                              padding: "1px 7px", borderRadius: 999,
                              fontSize: "0.62rem", fontWeight: 700,
                              background: "#eff6ff", color: "#1d4ed8",
                              border: "1px solid #bfdbfe",
                              verticalAlign: "middle",
                            }}
                          >
                            PLANNED
                          </span>
                        )}
                      </td>
                      <td><DispatchModeBadge mode={row.dispatch_mode || "Manual"} /></td>
                      <td style={{ fontSize: "0.72rem", maxWidth: 160 }}>
                        {!!Number(row.is_dummy_po) ? (
                          <span style={{
                            display: "inline-block",
                            padding: "2px 8px",
                            borderRadius: 999,
                            fontWeight: 700,
                            background: "#fff7ed",
                            color: "#c2410c",
                            border: "1px solid #fed7aa",
                          }}
                          >
                            Open
                          </span>
                        ) : origCell && origCell !== nameCell ? (
                          <span style={{ fontFamily: "ui-monospace, monospace", color: "#334155", wordBreak: "break-all" }}>
                            {origCell}
                          </span>
                        ) : wasDf && !Number(row.is_dummy_po) ? (
                          <span style={{
                            display: "inline-block",
                            padding: "2px 8px",
                            borderRadius: 999,
                            fontWeight: 700,
                            fontSize: "0.68rem",
                            color: "#fff",
                            background: "linear-gradient(135deg,#6366f1 0%,#4f46e5 100%)",
                            border: "1px solid #6366f1",
                          }}
                            title={origCell || "Mapped from dummy PO"}
                          >
                            Mapped
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>{row.po_no}</td>
                      <td>{row.project_code}</td>
                      <td style={{ fontSize: "0.82rem" }}>{row.item_code}</td>
                      <td style={{ fontSize: "0.82rem", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.item_description || ""}>{row.item_description || "—"}</td>
                      <td style={{ fontSize: "0.82rem" }}>{row.activity_type || "—"}</td>
                      <td style={{ textAlign: "right" }}>{row.qty}</td>
                      <td style={{ textAlign: "right" }}>{fmt.format(row.line_amount || 0)}</td>
                      <td style={{ fontSize: "0.82rem", whiteSpace: "nowrap" }}>{row.im_full_name || row.im || "—"}</td>
                      <td>{row.site_code}</td>
                      <td style={{ fontSize: "0.82rem", maxWidth: 120 }} title={row.center_area || ""}>
                        {row.center_area || "—"}
                      </td>
                      <td style={{ fontSize: "0.82rem" }}>{row.region_type || "—"}</td>
                      <td>
                        <span className={`status-badge ${(row.dispatch_status || "pending").toLowerCase()}`}>
                          <span className="status-dot" />
                          {row.dispatch_status || "Pending"}
                        </span>
                      </td>
                      <td style={{ minWidth: 175, width: 175, whiteSpace: "nowrap" }}>
                        <div style={{ display: "flex", gap: 4, flexWrap: "nowrap" }}>
                          <button
                            type="button"
                            className="btn-secondary"
                            style={{ fontSize: "0.7rem", padding: "3px 8px", whiteSpace: "nowrap", flexShrink: 0 }}
                            onClick={() => setDetailRow(row)}
                          >
                            View
                          </button>
                          {!!Number(row.is_dummy_po) && (
                            <button
                              type="button"
                              style={{ fontSize: "0.7rem", padding: "3px 8px", whiteSpace: "nowrap", flexShrink: 0, background: "#fffbeb", color: "#92400e", border: "1px solid #f59e0b", borderRadius: 8, cursor: "pointer" }}
                              onClick={() => { setMapErr(null); setMapForRow(row); }}
                            >
                              Map PO
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={15} style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0" }}>
                    <strong>{visibleRows.length} row{visibleRows.length !== 1 ? "s" : ""}</strong>
                    {planScope !== "all" && visibleRows.length !== rows.length && (
                      <span style={{ marginLeft: 8, fontSize: "0.78rem", color: "#94a3b8" }}>
                        ({rows.length - visibleRows.length} planned hidden)
                      </span>
                    )}
                    <span style={{ marginLeft: 16, fontSize: "0.82rem", color: "#64748b" }}>
                      {planScope === "all"
                        ? <>Re-plan mode: select any row (PLANNED rows create the next visit).</>
                        : <>Select rows with status <strong>Dispatched</strong> to create rollout plans.</>}
                    </span>
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </DataTableWrapper>
        <TableRowsLimitFooter
          placement="tableCard"
          loadedCount={rows.length}
          filteredCount={visibleRows.length}
          filterActive={!!hasFilters || visibleRows.length !== rows.length}
        />
      </div>

      {showBackendModal && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={backendBusy ? undefined : () => setShowBackendModal(false)}
        >
          <div
            style={{ background: "#fff", borderRadius: 12, padding: 20, width: "min(520px, 100%)", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: "1rem" }}>
                Assign to Backend <span style={{ color: "#64748b", fontWeight: 500 }}>· {selected.size} POID{selected.size !== 1 ? "s" : ""}</span>
              </h3>
              <button type="button" onClick={() => setShowBackendModal(false)} disabled={backendBusy} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#94a3b8", lineHeight: 1 }}>&times;</button>
            </div>
            {selectedBackendRows.length > 0 && (
              <div style={{ fontSize: "0.76rem", color: "#475569", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", marginBottom: 12, maxHeight: 140, overflowY: "auto" }}>
                {selectedBackendRows.map((r) => (
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
                {backendTeams.map((t) => (
                  <option key={t.name} value={t.name}>{t.team_name || t.team_id}{t.team_id && t.team_name ? ` (${t.team_id})` : ""}</option>
                ))}
              </select>
              {!backendTeamsLoading && backendTeams.length === 0 && (
                <div style={{ fontSize: "0.74rem", color: "#94a3b8", marginTop: 4 }}>No active teams with category "Backend Team".</div>
              )}
            </div>
            <div className="form-group" style={{ marginBottom: 10 }}>
              <label>Note (optional)</label>
              <textarea rows={3} value={backendRemark} onChange={(e) => setBackendRemark(e.target.value)} placeholder="Any reference / scope notes for this backend assignment…" disabled={backendBusy} style={{ width: "100%", boxSizing: "border-box", padding: "6px 8px", fontSize: "0.85rem", border: "1px solid #e2e8f0", borderRadius: 6, resize: "vertical" }} />
            </div>
            {backendError && (
              <div className="notice error" style={{ marginBottom: 10, fontSize: "0.82rem" }}><span>!</span> {backendError}</div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button type="button" className="btn-secondary" onClick={() => setShowBackendModal(false)} disabled={backendBusy}>Cancel</button>
              <button type="button" className="btn-primary" onClick={submitBackend} disabled={backendBusy || !backendTeamId} style={{ background: "#7c3aed", borderColor: "#7c3aed" }}>
                {backendBusy ? "Assigning…" : `Assign ${selected.size} POID${selected.size !== 1 ? "s" : ""}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
