import { useCallback, useEffect, useMemo, useState } from "react";
import DataTableWrapper from "../../components/DataTableWrapper";
import { pmApi } from "../../services/api";
import { useTableRowLimit, useResetOnRowLimitChange, TABLE_ROW_LIMIT_ALL } from "../../context/TableRowLimitContext";
import TableRowsLimitFooter from "../../components/TableRowsLimitFooter";
import { useDebounced } from "../../hooks/useDebounced";
import useFilterOptions from "../../hooks/useFilterOptions";
import SearchableSelect from "../../components/SearchableSelect";
import RecordDetailView, { DetailHero, DetailStatTile } from "../../components/RecordDetailView";
import DateRangePicker from "../../components/DateRangePicker";
import ExportExcelButton from "../../components/ExportExcelButton";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

const VISIT_TYPES = ["Execution", "Re-Visit", "Extra Visit"];

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

/* ── Modal ──────────────────────────────────────────────────────── */
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
          <button
            type="button"
            onClick={onClose}
            style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8", lineHeight: 1 }}
          >
            &times;
          </button>
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

const fieldStyle = {
  width: "100%", padding: "9px 12px",
  border: "1px solid #e2e8f0", borderRadius: 7,
  fontSize: "0.88rem", background: "#f8fafc",
  boxSizing: "border-box",
};
const labelStyle = { display: "block", fontSize: "0.78rem", fontWeight: 600, marginBottom: 5, color: "#475569" };
function DetailItem({ label, value }) {
  const txt = String(value || "");
  const isStatus = /status/i.test(label) || /mode/i.test(label);
  const tone = txt.toLowerCase().includes("planned") || txt.toLowerCase().includes("auto")
    ? { bg: "#eff6ff", fg: "#1d4ed8" }
    : txt.toLowerCase().includes("dispatch")
      ? { bg: "#ecfdf5", fg: "#047857" }
      : txt.toLowerCase().includes("cancel")
        ? { bg: "#fef2f2", fg: "#b91c1c" }
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

export default function RolloutPlanning() {
  const { rowLimit } = useTableRowLimit();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const searchDebounced = useDebounced(search, 300);
  const [metaRows, setMetaRows] = useState([]);
  const [projectFilter, setProjectFilter] = useState([]);
  const [imFilter, setImFilter] = useState([]);
  const [duidFilter, setDuidFilter] = useState([]);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  // Workflow #2: "Unplanned" shows POIDs that haven't been planned yet
  // (dispatch_status = Dispatched). "All Visits" lifts that filter so
  // the IM can pick a POID that already has a plan and create the next
  // sequential visit (visit_number auto-increments).
  const [planScope, setPlanScope] = useState("unplanned"); // "unplanned" | "all"

  const [selected, setSelected] = useState(new Set());
  const [showModal, setShowModal] = useState(false);
  const [planDate, setPlanDate] = useState(todayDate());
  const [planEndDate, setPlanEndDate] = useState(todayDate());
  const [planTeam, setPlanTeam] = useState("");
  // Multi-team assignment: list of {team, assigned_qty}. Empty rows are
  // ignored on submit. Single-team plans send teams = [{team: planTeam, ...}]
  // automatically (back-compat).
  const [planTeams, setPlanTeams] = useState([]);
  const [accessTime, setAccessTime] = useState("");
  const [accessPeriod, setAccessPeriod] = useState("");
  const [qcRequired, setQcRequired] = useState(true);
  const [ciagRequired, setCiagRequired] = useState(true);
  const [teamsList, setTeamsList] = useState([]);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [visitType, setVisitType] = useState("Execution");
  const [creating, setCreating] = useState(false);
  const [successMsg, setSuccessMsg] = useState(null);
  const [createError, setCreateError] = useState(null);
  const [detailRow, setDetailRow] = useState(null);
  const [managerRemark, setManagerRemark] = useState("");

  useResetOnRowLimitChange(() => {
    setRows([]);
    setLoading(true);
  });

  const loadMeta = useCallback(async () => {
    try {
      const list = await pmApi.listPODispatches({ dispatch_status: "Dispatched" }, TABLE_ROW_LIMIT_ALL, {});
      setMetaRows(Array.isArray(list) ? list : []);
    } catch {
      setMetaRows([]);
    }
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const portal = {};
      if (searchDebounced.trim()) portal.search = searchDebounced.trim();
      if (projectFilter.length) portal.project_code = projectFilter;
      if (imFilter.length) portal.im = imFilter;
      if (duidFilter.length) portal.site_code = duidFilter;
      if (fromDate) portal.from_date = fromDate;
      if (toDate) portal.to_date = toDate;
      // "all" scope drops the dispatch_status filter so the IM can pick
      // a POID with an existing plan and create the next visit.
      const filters = planScope === "all" ? {} : { dispatch_status: "Dispatched" };
      const list = await pmApi.listPODispatches(filters, rowLimit, portal);
      setRows(Array.isArray(list) ? list : []);
    } catch (err) {
      setError(err.message || "Failed to load dispatches");
    } finally {
      setLoading(false);
    }
  }, [rowLimit, searchDebounced, projectFilter, imFilter, duidFilter, fromDate, toDate, planScope]);

  useEffect(() => { loadMeta(); }, [loadMeta]);
  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (!showModal) return;
    let cancelled = false;
    (async () => {
      setTeamsLoading(true);
      try {
        const list = await pmApi.listINETTeams({ status: "Active" });
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
  }, [showModal]);

  function toggleRow(name) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  // Filter options come from distinct values in the master tables so dropdowns
  // stay complete regardless of the current row-limited slice.
  const { options: dispOpts } = useFilterOptions("PO Dispatch", ["project_code", "site_code", "im"]);
  const projectOptions = dispOpts.project_code || [];
  const duidOptions = dispOpts.site_code || [];
  // Keep { im, im_full_name } shape so existing code/JSX unchanged; enrich
  // plain-ID list from dispatch with full names found in the current slice.
  const imOptionRows = useMemo(() => {
    const ids = dispOpts.im || [];
    const labelById = {};
    for (const r of metaRows) {
      if (r.im && r.im_full_name) labelById[r.im] = r.im_full_name;
    }
    return ids.map((id) => ({ im: id, im_full_name: labelById[id] || id }));
  }, [dispOpts.im, metaRows]);
  const hasFilters = !!(search || projectFilter.length || imFilter.length || duidFilter.length || fromDate || toDate);
  const filterActiveForFooter = !!(searchDebounced.trim() || projectFilter.length || imFilter.length || duidFilter.length || fromDate || toDate);

  function toggleAll() {
    if (selected.size === rows.length && rows.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(rows.map((r) => r.name)));
    }
  }

  function openCreateModal() {
    setCreateError(null);
    // Team is always chosen by IM at planning (not copied from dispatch / project).
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

  async function handleCreate() {
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
      // When the IM has added extra teams in the table, send the full
      // list. Otherwise send a one-row list using planTeam (back-compat).
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
      const count = result?.created ?? selected.size;
      setSuccessMsg(`Created ${count} rollout plan${count !== 1 ? "s" : ""} successfully.`);
      setSelected(new Set());
      setShowModal(false);
      await Promise.all([loadData(), loadMeta()]);
    } catch (err) {
      setCreateError(err.message || "Failed to create plans");
    } finally {
      setCreating(false);
    }
  }

  const totalAmt = rows.reduce((s, r) => s + (r.line_amount || 0), 0);
  const selectedAmt = rows
    .filter((r) => selected.has(r.name))
    .reduce((s, r) => s + (r.line_amount || 0), 0);

  const createPlanSelRows = rows.filter((r) => selected.has(r.name));
  const createPlanDuids = [...new Set(createPlanSelRows.map((r) => r.site_code || r.name).filter(Boolean))];
  const createPlanIms = [...new Set(createPlanSelRows.map((r) => r.im).filter(Boolean))];
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
          <div className="page-subtitle">
            Create execution plans from dispatched PO lines. PO Dispatch carries the IM only; choose the field team here — it is stored on the Rollout Plan.
          </div>
        </div>
        <div className="page-actions">
          <ExportExcelButton
            filename="rollout-planning"
            rows={rows}
            columns={[
              { key: "poid",        label: "POID" },
              { key: "item_code",   label: "Item" },
              { key: "item_description", label: "Description" },
              { key: "customer_activity_type", label: "Activity Type" },
              { key: "project_code", label: "Project" },
              { key: "site_code",   label: "DUID" },
              { key: "center_area", label: "Center Area" },
              { key: "region_type", label: "Region" },
              { key: "im_full_name", label: "IM" },
              { key: "qty",         label: "Qty" },
              { key: "line_amount", label: "Line Amount" },
              { key: "target_month", label: "Target Month" },
              { key: "dispatch_status", label: "Status" },
            ]}
          />
          <button
            className="btn-secondary"
            onClick={() => { void loadMeta(); void loadData(); }}
            disabled={loading}
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* ── Toolbar (scope toggle inlined to save a row) ──────── */}
      <div className="toolbar">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {/* Scope toggle — clearly clickable: solid blue for active,
              hover background for inactive. */}
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
          <input
            type="search"
            placeholder="Search POID, Item, Project, IM, DUID, Center area, Region…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              padding: "7px 14px",
              borderRadius: 8,
              border: "1px solid #e2e8f0",
              fontSize: "0.84rem",
              minWidth: 300,
            }}
          />
          <SearchableSelect multi value={projectFilter} onChange={setProjectFilter} options={projectOptions} placeholder="All Projects" minWidth={170} />
          <SearchableSelect multi value={imFilter} onChange={setImFilter} options={imOptionRows.map((r) => ({ id: r.im, label: r.im_full_name || r.im }))} placeholder="All IMs" minWidth={170} />
          <SearchableSelect multi value={duidFilter} onChange={setDuidFilter} options={duidOptions} placeholder="All DUIDs" minWidth={150} />
          <DateRangePicker value={{ from: fromDate, to: toDate }} onChange={({ from, to }) => { setFromDate(from); setToDate(to); }} />
          {hasFilters && (
            <button
              className="btn-secondary"
              style={{ fontSize: "0.78rem", padding: "5px 12px" }}
              onClick={() => { setSearch(""); setProjectFilter([]); setImFilter([]); setDuidFilter([]); setFromDate(""); setToDate(""); }}
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
          <button
            className="btn-primary"
            onClick={openCreateModal}
            disabled={selected.size === 0}
          >
            Create Plans ({selected.size})
          </button>
        </div>
      </div>

      {/* ── Notices ─────────────────────────────────────────── */}
      {successMsg && (
        <div className="notice success" style={{ margin: "0 28px 16px" }}>
          <span>✅</span> {successMsg}
        </div>
      )}
      {createError && (
        <div className="notice error" style={{ margin: "0 28px 16px" }}>
          <span>⚠</span> {createError}
        </div>
      )}

      {/* ── Table ───────────────────────────────────────────── */}
      <div className="page-content">
        {error && (
          <div className="notice error" style={{ marginBottom: 16 }}>
            <span>⚠</span> {error}
          </div>
        )}

        <DataTableWrapper>
          {loading ? (
            <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)" }}>
              Loading dispatches…
            </div>
          ) : rows.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📦</div>
              <h3>{searchDebounced.trim() ? "No results match your search" : "No dispatched lines ready for planning"}</h3>
              <p>
                {searchDebounced.trim()
                  ? "Try a different search term."
                  : "Dispatch PO Intake lines first before creating rollout plans."}
              </p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={selected.size === rows.length && rows.length > 0}
                      onChange={toggleAll}
                    />
                  </th>
                  <th>POID</th>
                  <th>Item Code</th>
                  <th>Description</th>
                  <th>Activity Type</th>
                  <th>Project</th>
                  <th>DUID</th>
                  <th>Center area</th>
                  <th>Region</th>
                  <th>IM</th>
                  <th>Target Month</th>
                  <th style={{ textAlign: "right" }}>Line Amount</th>
                  <th>Open</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.name}
                    className={selected.has(row.name) ? "row-selected" : ""}
                    onClick={() => toggleRow(row.name)}
                    style={{ cursor: "pointer" }}
                  >
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(row.name)}
                        onChange={() => toggleRow(row.name)}
                      />
                    </td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>
                      <span>{row.poid || row.name}</span>
                      {(row.dispatch_status || "").toLowerCase() === "planned" && (
                        <span
                          title="A rollout plan already exists for this POID. Selecting will create a new visit (visit_number auto-increments)."
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
                    <td>{row.item_code}</td>
                    <td style={{ fontSize: "0.82rem", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.item_description || ""}>{row.item_description || "—"}</td>
                    <td style={{ fontSize: "0.82rem" }}>{row.customer_activity_type || "—"}</td>
                    <td>{row.project_code}</td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{row.site_code || "—"}</td>
                    <td style={{ fontSize: "0.82rem", maxWidth: 140 }} title={row.center_area || ""}>
                      {row.center_area || "—"}
                    </td>
                    <td style={{ fontSize: "0.82rem" }}>{row.region_type || "—"}</td>
                    <td>{row.im_full_name || row.im || "—"}</td>
                    <td style={{ fontSize: "0.82rem" }}>
                      {row.target_month
                        ? new Date(row.target_month).toLocaleDateString("en", { month: "short", year: "numeric" })
                        : "—"}
                    </td>
                    <td style={{ textAlign: "right" }}>{fmt.format(row.line_amount || 0)}</td>
                    <td onClick={(e) => e.stopPropagation()}>
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
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={9} style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0" }}>
                    <strong>{rows.length}</strong>
                    {" "}row{rows.length !== 1 ? "s" : ""}
                    {selected.size > 0 && (
                      <span style={{ marginLeft: 16, color: "#6366f1", fontWeight: 600, fontSize: "0.82rem" }}>
                        {selected.size} selected
                      </span>
                    )}
                  </td>
                  <td style={{ textAlign: "right", padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", fontWeight: 700 }}>
                    {fmt.format(totalAmt)}
                  </td>
                  <td style={{ background: "#f8fafc", borderTop: "1px solid #e2e8f0" }} />
                </tr>
              </tfoot>
            </table>
          )}
        </DataTableWrapper>
        <TableRowsLimitFooter
          placement="tableCard"
          loadedCount={rows.length}
          filteredCount={rows.length}
          filterActive={filterActiveForFooter}
        />
      </div>

      {/* ── Create Plans Modal ────────────────────────────────── */}
      <Modal
        open={showModal}
        onClose={() => !creating && setShowModal(false)}
        title="Create rollout plans for selected DUIDs"
        width={840}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setShowModal(false)} disabled={creating}>
              Cancel
            </button>
            <button
              className="btn-primary"
              onClick={handleCreate}
              disabled={creating || !planDate || !planEndDate || !visitType || !planTeam}
            >
              {creating ? "Creating…" : `Create ${selected.size} plan${selected.size !== 1 ? "s" : ""}`}
            </button>
          </>
        }
      >
        <>
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
                <div style={{ fontSize: "0.78rem", color: "#64748b", marginTop: 8 }}>
                  {selected.size} dispatch line{selected.size !== 1 ? "s" : ""} · Qty <strong style={{ color: "#0f172a" }}>{fmt.format(createPlanTotalQty)}</strong> · SAR {fmt.format(selectedAmt)}
                  {createPlanIms.length > 0 && (
                    <span style={{ marginLeft: 10 }}>
                      IM:
                      {" "}
                      {createPlanIms.length === 1
                        ? (rows.find((x) => x.im === createPlanIms[0])?.im_full_name || createPlanIms[0])
                        : `${createPlanIms.length} IMs`}
                    </span>
                  )}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px 16px", marginBottom: 16 }}>
                <div>
                  <label style={labelStyle}>Lead team</label>
                  <select
                    value={planTeam}
                    onChange={(e) => setPlanTeam(e.target.value)}
                    style={fieldStyle}
                    disabled={teamsLoading}
                  >
                    <option value="">{teamsLoading ? "Loading teams…" : "Select team"}</option>
                    {teamsList.map((t) => (
                      <option key={t.team_id} value={t.team_id}>{t.team_name || t.team_id}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Visit type</label>
                  <select
                    value={visitType}
                    onChange={(e) => setVisitType(e.target.value)}
                    style={fieldStyle}
                  >
                    {VISIT_TYPES.map((vt) => (
                      <option key={vt} value={vt}>{vt}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Multi-team split (optional). Lead team is selected
                  above; add extra teams here with their assigned qty.
                  Single-line POIDs may use just the lead team. */}
              <div style={{
                background: "#fafbfc", border: "1px solid #e5e7eb",
                borderRadius: 8, padding: 12, marginBottom: 16,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ fontSize: "0.74rem", fontWeight: 700, color: "#475569" }}>
                    ADDITIONAL TEAMS (optional)
                  </div>
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
                    <span style={{ marginLeft: 8, color: "#b91c1c", fontWeight: 700 }}>
                      ⚠ over total
                    </span>
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
                          style={{ ...fieldStyle, flex: 2, padding: "6px 10px" }}
                        >
                          <option value="">Select team</option>
                          {teamsList
                            .filter((t) => t.team_id !== planTeam || row.team === t.team_id)
                            .map((t) => (
                              <option key={t.team_id} value={t.team_id}>{t.team_name || t.team_id}</option>
                            ))}
                        </select>
                        <input
                          // Chrome's <input type="number"> wipes the value to ""
                          // mid-decimal-entry (e.g. typing "0." returns "" via
                          // e.target.value), which breaks the controlled input.
                          // type=text + inputMode=decimal keeps the numeric
                          // keyboard on mobile and lets every intermediate
                          // string flow through naturally.
                          type="text"
                          inputMode="decimal"
                          pattern="[0-9]*\.?[0-9]*"
                          value={row.assigned_qty ?? ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            // Allow only digits + a single dot; preserves
                            // partial entries like "0." or "1.5".
                            if (v !== "" && !/^\d*\.?\d*$/.test(v)) return;
                            setPlanTeams((arr) => arr.map((x, j) => j === i ? { ...x, assigned_qty: v } : x));
                          }}
                          placeholder="Qty"
                          style={{ ...fieldStyle, flex: 1, padding: "6px 10px" }}
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

              <div style={{ fontSize: "0.72rem", fontWeight: 600, color: "#94a3b8", letterSpacing: "0.06em", marginBottom: 12 }}>ACCESS DETAILS</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px 16px", marginBottom: 20 }}>
                <div>
                  <label style={labelStyle}>Planned start date</label>
                  <input
                    type="date"
                    value={planDate}
                    onChange={(e) => {
                      const v = e.target.value;
                      setPlanDate(v);
                      setPlanEndDate((ed) => (ed < v ? v : ed));
                    }}
                    style={fieldStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Planned end date</label>
                  <input
                    type="date"
                    value={planEndDate}
                    min={planDate}
                    onChange={(e) => setPlanEndDate(e.target.value)}
                    style={fieldStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Access time</label>
                  <input
                    type="text"
                    value={accessTime}
                    onChange={(e) => setAccessTime(e.target.value)}
                    placeholder="e.g. 08:00 or hours"
                    style={fieldStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Access period</label>
                  <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", padding: "9px 0" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.86rem", cursor: "pointer" }}>
                      <input type="radio" name="access_period_rp" checked={accessPeriod === ""} onChange={() => setAccessPeriod("")} />
                      Not set
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.86rem", cursor: "pointer" }}>
                      <input type="radio" name="access_period_rp" checked={accessPeriod === "Day"} onChange={() => setAccessPeriod("Day")} />
                      Day
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.86rem", cursor: "pointer" }}>
                      <input type="radio" name="access_period_rp" checked={accessPeriod === "Night"} onChange={() => setAccessPeriod("Night")} />
                      Night
                    </label>
                  </div>
                </div>
              </div>

              {/* Per-plan workflow toggles. When unchecked, the field
                  team isn't asked for that step and the IM can close
                  the plan to Work Done without recording it. */}
              <div style={{
                display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap",
                padding: "10px 12px", background: "#f8fafc",
                border: "1px solid #e2e8f0", borderRadius: 6,
                marginTop: 12, marginBottom: 12,
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

              {/* Single remark — saved as the Manager remark on every
                  selected POID. Planning is normally done by the IM, so we
                  collapse the 3-way panel into one Manager-tone textarea. */}
              <div className="form-group">
                <label>Remark</label>
                <textarea
                  rows={3}
                  value={managerRemark}
                  onChange={(e) => setManagerRemark(e.target.value)}
                  placeholder="Remark for these rollout plans…"
                  style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", fontSize: "0.86rem", border: "1px solid #e2e8f0", borderRadius: 6, resize: "vertical", minHeight: 60 }}
                />
              </div>
        </>

        {createError && (
          <div className="notice error" style={{ marginBottom: 14 }}>
            <span>⚠</span> {createError}
          </div>
        )}
      </Modal>

      <Modal
        open={!!detailRow}
        onClose={() => setDetailRow(null)}
        title={`PO Dispatch Details${detailRow?.name ? ` - ${detailRow.name}` : ""}`}
        width={720}
      >
        {detailRow && (
          <RecordDetailView
            row={detailRow}
            pills={[
              { label: "POID", value: detailRow.poid || detailRow.name || "—", tone: "blue" },
              { label: "Project", value: detailRow.project_code || "—", tone: "amber" },
              detailRow.im_full_name || detailRow.im ? { label: "IM", value: detailRow.im_full_name || detailRow.im, tone: "green" } : null,
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
                    tone={/complete|dispatched/i.test(detailRow.dispatch_status) ? "green" : /cancel|reject/i.test(detailRow.dispatch_status) ? "rose" : /progress|planned/i.test(detailRow.dispatch_status) ? "blue" : "amber"}
                  />
                )}
              </DetailHero>
            }
            hiddenFields={[
              "project_code", "im", "im_full_name",
              "item_code", "qty", "rate", "line_amount",
              "dispatch_status", "dispatch_mode",
            ]}
            keyOrder={[
              "item_description",
              "name", "po_no", "system_id", "po_dispatch",
              "site_code", "site_name", "area", "center_area", "region_type",
              "planning_mode", "target_month",
              "customer",
            ]}
          />
        )}
      </Modal>
    </div>
  );
}
