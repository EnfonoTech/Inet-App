import { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { pmApi } from "../../services/api";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const VISIT_TYPES = ["Work Done", "Re-Visit", "Extra Visit"];
const HIDDEN_DETAIL_FIELDS = new Set([
  "owner", "creation", "modified", "modified_by", "docstatus", "idx",
  "original_dummy_poid", "was_dummy_po",
]);

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function Modal({ open, onClose, title, children, width = 460 }) {
  if (!open) return null;
  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(15,23,42,0.5)", display: "flex",
        alignItems: "center", justifyContent: "center",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#fff", borderRadius: 14, padding: "28px 32px",
          width, maxWidth: "95vw", boxShadow: "0 20px 60px rgba(0,0,0,0.22)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700 }}>{title}</h3>
          <button type="button" onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8" }}>&times;</button>
        </div>
        {children}
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
  const current = (row.name || "").trim();
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
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modeFilter, setModeFilter] = useState("all");
  const [search, setSearch] = useState("");
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
  const [teamsList, setTeamsList] = useState([]);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [visitType, setVisitType] = useState("Work Done");
  const [creating, setCreating] = useState(false);
  const [successMsg, setSuccessMsg] = useState(null);
  const [createError, setCreateError] = useState(null);
  const [detailRow, setDetailRow] = useState(null);
  const [dummyFilter, setDummyFilter] = useState("all");
  const [showDummyModal, setShowDummyModal] = useState(false);
  const [dummyBusy, setDummyBusy] = useState(false);
  const [dummyErr, setDummyErr] = useState(null);
  const [projectsForDummy, setProjectsForDummy] = useState([]);
  const [dummyForm, setDummyForm] = useState({ project_code: "" });
  const [mapForRow, setMapForRow] = useState(null);
  const [mapLines, setMapLines] = useState([]);
  const [mapLineId, setMapLineId] = useState("");
  const [mapBusy, setMapBusy] = useState(false);
  const [mapErr, setMapErr] = useState(null);
  const [mapLinesLoading, setMapLinesLoading] = useState(false);

  useEffect(() => {
    load();
  }, [imName]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!showModal || !imName) return;
    let cancelled = false;
    (async () => {
      setTeamsLoading(true);
      try {
        const list = await pmApi.listINETTeams({ im: imName, status: "Active" });
        if (!cancelled) setTeamsList(Array.isArray(list) ? list : []);
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

  async function load() {
    setLoading(true);
    setError(null);
    try {
      if (!imName) {
        setRows([]);
        setLoading(false);
        return;
      }
      const filters = [["im", "=", imName]];
      const res = await pmApi.listPODispatches(filters);
      setRows(Array.isArray(res) ? res : []);
    } catch (err) {
      setError(err.message || "Failed to load dispatches");
    } finally {
      setLoading(false);
    }
  }

  async function openDummyPoModal() {
    setDummyErr(null);
    setDummyForm({ project_code: projectFilter || "" });
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

  async function submitDummyPo() {
    if (!dummyForm.project_code) {
      setDummyErr("Select a project.");
      return;
    }
    setDummyBusy(true);
    setDummyErr(null);
    try {
      await pmApi.createIMDummyPODispatch({ project_code: dummyForm.project_code });
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

  const planable = (r) => (r.dispatch_status || "") === "Dispatched";

  const filtered = rows.filter((r) => {
    const isOpenDummy = !!Number(r.is_dummy_po);
    const orig = (r.original_dummy_poid || "").trim();
    const currentPoid = (r.name || "").trim();
    const wasDummyFlag = r.was_dummy_po == 1 || r.was_dummy_po === true || String(r.was_dummy_po || "") === "1";
    const mappedFromDummy =
      (wasDummyFlag && !isOpenDummy) || (!!orig && orig !== currentPoid);
    if (dummyFilter === "dummy" && !isOpenDummy) return false;
    if (dummyFilter === "mapped_dummy" && !mappedFromDummy) return false;
    if (dummyFilter === "standard" && isOpenDummy) return false;
    if (modeFilter !== "all" && r.dispatch_mode !== modeFilter) return false;
    if (projectFilter && (r.project_code || "") !== projectFilter) return false;
    if (teamFilter && (r.team || "") !== teamFilter) return false;
    if (duidFilter && (r.site_code || "") !== duidFilter) return false;
    if (fromDate && (r.target_month || "").slice(0, 10) < fromDate) return false;
    if (toDate && (r.target_month || "").slice(0, 10) > toDate) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        (r.po_no || "").toLowerCase().includes(q) ||
        (r.project_code || "").toLowerCase().includes(q) ||
        (r.item_code || "").toLowerCase().includes(q) ||
        (r.site_code || "").toLowerCase().includes(q) ||
        (r.name || "").toLowerCase().includes(q) ||
        (r.original_dummy_poid || "").toLowerCase().includes(q) ||
        (r.center_area || "").toLowerCase().includes(q) ||
        (r.region_type || "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  const planableRows = filtered.filter(planable);
  const projectOptions = [...new Set(rows.map((r) => r.project_code).filter(Boolean))].sort();
  const teamOptions = [...new Set(rows.map((r) => r.team).filter(Boolean))].sort();
  const duidOptions = [...new Set(rows.map((r) => r.site_code).filter(Boolean))].sort();
  const hasFilters = search || modeFilter !== "all" || dummyFilter !== "all" || projectFilter || teamFilter || duidFilter || fromDate || toDate;

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

  function openCreatePlanModal() {
    setCreateError(null);
    setPlanTeam("");
    setPlanEndDate(planDate);
    setAccessTime("");
    setAccessPeriod("");
    setShowModal(true);
  }

  async function handleCreatePlans() {
    if (selected.size === 0 || !planDate || !planEndDate || !visitType || !planTeam) return;
    if (planEndDate < planDate) {
      setCreateError("Planned end date cannot be before start date.");
      return;
    }
    setCreating(true);
    setCreateError(null);
    setSuccessMsg(null);
    try {
      const dispatches = Array.from(selected);
      const result = await pmApi.createRolloutPlans({
        dispatches,
        plan_date: planDate,
        plan_end_date: planEndDate,
        team: planTeam,
        access_time: accessTime,
        access_period: accessPeriod,
        visit_type: visitType,
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

  const autoCount = rows.filter((r) => r.dispatch_mode === "Auto").length;
  const manualCount = rows.filter((r) => r.dispatch_mode === "Manual").length;
  const dispatchedCount = rows.filter((r) => planable(r)).length;

  const selectedAmt = filtered
    .filter((r) => selected.has(r.name))
    .reduce((s, r) => s + (r.line_amount || 0), 0);

  const createPlanSelRows = filtered.filter((r) => selected.has(r.name));
  const createPlanDuids = [...new Set(createPlanSelRows.map((r) => r.site_code || r.name).filter(Boolean))];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">My Dispatches</h1>
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

      {!loading && rows.length > 0 && (
        <div style={{ display: "flex", gap: 10, margin: "0 28px 14px", flexWrap: "wrap" }}>
          <div style={{
            flex: "0 1 180px", minWidth: 140, padding: "10px 12px", borderRadius: 10,
            background: "linear-gradient(135deg,#f59e0b 0%,#d97706 100%)",
            color: "#fff", boxShadow: "0 4px 16px rgba(245,158,11,0.25)",
          }}>
            <div style={{ fontSize: "0.68rem", fontWeight: 600, opacity: 0.9, marginBottom: 3 }}>Ready to plan</div>
            <div style={{ fontSize: "1.35rem", fontWeight: 800, lineHeight: 1.1 }}>{dispatchedCount}</div>
            <div style={{ fontSize: "0.62rem", opacity: 0.85, marginTop: 2 }}>Status = Dispatched</div>
          </div>
          <div style={{
            flex: "0 1 180px", minWidth: 140, padding: "10px 12px", borderRadius: 10,
            background: "linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%)",
            color: "#fff", boxShadow: "0 4px 16px rgba(99,102,241,0.2)",
          }}>
            <div style={{ fontSize: "0.68rem", fontWeight: 600, opacity: 0.85, marginBottom: 3 }}>Auto Dispatched</div>
            <div style={{ fontSize: "1.35rem", fontWeight: 800, lineHeight: 1.1 }}>{autoCount}</div>
          </div>
          <div style={{
            flex: "0 1 180px", minWidth: 140, padding: "10px 12px", borderRadius: 10,
            background: "linear-gradient(135deg,#0ea5e9 0%,#06b6d4 100%)",
            color: "#fff", boxShadow: "0 4px 16px rgba(14,165,233,0.2)",
          }}>
            <div style={{ fontSize: "0.68rem", fontWeight: 600, opacity: 0.85, marginBottom: 3 }}>Manual Dispatch</div>
            <div style={{ fontSize: "1.35rem", fontWeight: 800, lineHeight: 1.1 }}>{manualCount}</div>
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
          <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem" }}>
            <option value="">All Projects</option>
            {projectOptions.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem" }}>
            <option value="">All Teams</option>
            {teamOptions.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select
            value={duidFilter}
            onChange={(e) => setDuidFilter(e.target.value)}
            style={{ maxWidth: 200, padding: "7px 10px", borderRadius: 8, border: "1px solid #dbe3ef", fontSize: "0.84rem", background: "#fff" }}
          >
            <option value="">All DUIDs</option>
            {duidOptions.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem" }} />
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem" }} />
          {hasFilters && (
            <button className="btn-secondary" style={{ fontSize: "0.78rem", padding: "5px 12px" }} onClick={() => { setSearch(""); setModeFilter("all"); setDummyFilter("all"); setProjectFilter(""); setTeamFilter(""); setDuidFilter(""); setFromDate(""); setToDate(""); }}>
              Clear
            </button>
          )}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
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
        </div>
      </div>

      <Modal open={showModal} onClose={() => !creating && setShowModal(false)} title="Create rollout plans for selected DUIDs" width={560}>
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
            IM <strong>{imName || "—"}</strong> · {selected.size} line{selected.size !== 1 ? "s" : ""} → <strong>Planned</strong> · SAR {fmt.format(selectedAmt)}
          </p>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, marginBottom: 6, color: "#475569" }}>Assigned team</label>
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

        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, marginBottom: 6, color: "#475569" }}>Visit type</label>
          <select value={visitType} onChange={(e) => setVisitType(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e2e8f0", boxSizing: "border-box" }}>
            {VISIT_TYPES.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>

        <div style={{ fontSize: "0.72rem", fontWeight: 600, color: "#94a3b8", letterSpacing: "0.06em", marginBottom: 10 }}>ACCESS DETAILS</div>
        <div style={{ marginBottom: 14 }}>
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
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, marginBottom: 6, color: "#475569" }}>Planned end date</label>
          <input type="date" value={planEndDate} min={planDate} onChange={(e) => setPlanEndDate(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e2e8f0", boxSizing: "border-box" }} />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, marginBottom: 6, color: "#475569" }}>Access time</label>
          <input type="text" value={accessTime} onChange={(e) => setAccessTime(e.target.value)} placeholder="e.g. 08:00 or hours" style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e2e8f0", boxSizing: "border-box" }} />
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, marginBottom: 6, color: "#475569" }}>Access period</label>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.88rem", cursor: "pointer" }}>
              <input type="radio" name="access_period_im" checked={accessPeriod === ""} onChange={() => setAccessPeriod("")} />
              Not set
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.88rem", cursor: "pointer" }}>
              <input type="radio" name="access_period_im" checked={accessPeriod === "Day"} onChange={() => setAccessPeriod("Day")} />
              Day
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.88rem", cursor: "pointer" }}>
              <input type="radio" name="access_period_im" checked={accessPeriod === "Night"} onChange={() => setAccessPeriod("Night")} />
              Night
            </label>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button type="button" className="btn-secondary" disabled={creating} onClick={() => setShowModal(false)}>Cancel</button>
          <button type="button" className="btn-primary" disabled={creating || !planDate || !planEndDate || !visitType || !planTeam} onClick={handleCreatePlans}>
            {creating ? "Creating…" : "Create"}
          </button>
        </div>
      </Modal>

      <Modal open={!!detailRow} onClose={() => setDetailRow(null)} title={`PO Dispatch Details${detailRow?.name ? ` - ${detailRow.name}` : ""}`} width={760}>
        {detailRow && (
          <div style={{ maxHeight: "65vh", overflow: "auto", background: "#f8fafc", borderRadius: 8, padding: 12 }}>
            <DummyMappingBanner row={detailRow} />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 10 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", flex: "1 1 auto" }}>
                <div style={{ border: "1px solid #bfdbfe", background: "#eff6ff", color: "#1d4ed8", borderRadius: 999, padding: "4px 10px", fontSize: 12, fontWeight: 700 }}>
                  POID: {detailRow.name || "—"}
                </div>
                <div style={{ border: "1px solid #fde68a", background: "#fffbeb", color: "#b45309", borderRadius: 999, padding: "4px 10px", fontSize: 12, fontWeight: 700 }}>
                  Project: {detailRow.project_code || "—"}
                </div>
                <div style={{ border: "1px solid #a7f3d0", background: "#ecfdf5", color: "#047857", borderRadius: 999, padding: "4px 10px", fontSize: 12, fontWeight: 700 }}>
                  IM: {detailRow.im || "—"}
                </div>
              </div>
              {!!Number(detailRow.is_dummy_po) && (
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
              )}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {Object.entries(detailRow)
                .filter(([k]) => !HIDDEN_DETAIL_FIELDS.has(String(k).toLowerCase()))
                .map(([k, v]) => (
                <DetailItem
                  key={k}
                  label={String(k).toLowerCase() === "system_id" ? "POID" : k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                  value={v}
                />
              ))}
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={showDummyModal}
        onClose={() => !dummyBusy && setShowDummyModal(false)}
        title="Dummy PO"
        width={420}
      >
        {dummyErr && <div className="notice error" style={{ marginBottom: 12 }}>{dummyErr}</div>}
        <div style={{ marginBottom: 20 }}>
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
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button type="button" className="btn-secondary" disabled={dummyBusy} onClick={() => setShowDummyModal(false)}>Cancel</button>
          <button type="button" className="btn-primary" disabled={dummyBusy} onClick={submitDummyPo}>
            {dummyBusy ? "Creating…" : "Create"}
          </button>
        </div>
      </Modal>

      <Modal
        open={!!mapForRow}
        onClose={() => !mapBusy && setMapForRow(null)}
        title={`Map dummy PO — ${mapForRow?.name || ""}`}
        width={560}
      >
        {mapErr && <div className="notice error" style={{ marginBottom: 12 }}>{mapErr}</div>}
        {mapLinesLoading ? (
          <div style={{ padding: 20, textAlign: "center", color: "#64748b" }}>Loading PO lines…</div>
        ) : (
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, marginBottom: 6, color: "#475569" }}>PO Intake line</label>
            <select
              value={mapLineId}
              onChange={(e) => setMapLineId(e.target.value)}
              style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e2e8f0", boxSizing: "border-box" }}
            >
              <option value="">{mapLines.length ? "Select line" : "No open lines for this project"}</option>
              {mapLines.map((l) => (
                <option key={l.name} value={l.name}>
                  {(l.po_no || l.po_intake || "").slice(0, 40)} · L{l.po_line_no} · {l.item_code || "—"} · {l.po_line_status || ""}
                  {l.existing_dispatch ? ` · existing ${l.existing_dispatch}` : ""}
                </option>
              ))}
            </select>
          </div>
        )}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button type="button" className="btn-secondary" disabled={mapBusy} onClick={() => setMapForRow(null)}>Cancel</button>
          <button type="button" className="btn-primary" disabled={mapBusy || !mapLineId || mapLinesLoading} onClick={submitMapDummy}>
            {mapBusy ? "Mapping…" : "Confirm map"}
          </button>
        </div>
      </Modal>

      <div className="page-content">
        {error && (
          <div className="notice error" style={{ marginBottom: 16 }}>
            <span>!</span> {error}
          </div>
        )}

        <div className="data-table-wrapper">
          {loading ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
              Loading dispatches...
            </div>
          ) : filtered.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📋</div>
              <h3>{!imName ? "IM account not linked" : "No dispatch records found"}</h3>
              <p>
                {!imName
                  ? "Link your user to IM Master so dispatches can load."
                  : modeFilter !== "all"
                    ? `No ${modeFilter} dispatch records match.`
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
                  <th style={{ textAlign: "right" }}>Qty</th>
                  <th style={{ textAlign: "right" }}>Amount</th>
                  <th>IM</th>
                  <th>DUID</th>
                  <th>Center area</th>
                  <th>Region</th>
                  <th>Status</th>
                  <th>View</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const canPlan = planable(row);
                  const wasDf = row.was_dummy_po == 1 || row.was_dummy_po === true || String(row.was_dummy_po || "") === "1";
                  const origCell = (row.original_dummy_poid || "").trim();
                  const nameCell = (row.name || "").trim();
                  return (
                    <tr
                      key={row.name}
                      style={{
                        background: row.dispatch_mode === "Auto" ? "rgba(99,102,241,0.04)" : undefined,
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
                      <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{row.name}</td>
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
                      <td style={{ textAlign: "right" }}>{row.qty}</td>
                      <td style={{ textAlign: "right" }}>{fmt.format(row.line_amount || 0)}</td>
                      <td style={{ fontSize: "0.82rem", whiteSpace: "nowrap" }}>{row.im || "—"}</td>
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
                      <td>
                        <button type="button" className="btn-secondary" style={{ fontSize: "0.72rem", padding: "4px 10px" }} onClick={() => setDetailRow(row)}>
                          View
                        </button>
                        {!!Number(row.is_dummy_po) && (
                          <button
                            type="button"
                            className="btn-secondary"
                            style={{ fontSize: "0.72rem", padding: "4px 10px", marginLeft: 6 }}
                            onClick={() => { setMapErr(null); setMapForRow(row); }}
                          >
                            Map PO
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={15} style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0" }}>
                    <strong>{filtered.length} row{filtered.length !== 1 ? "s" : ""}</strong>
                    <span style={{ marginLeft: 16, fontSize: "0.82rem", color: "#64748b" }}>
                      Select rows with status <strong>Dispatched</strong> to create rollout plans.
                    </span>
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
