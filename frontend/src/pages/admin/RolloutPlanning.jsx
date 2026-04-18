import { useCallback, useEffect, useMemo, useState } from "react";
import { pmApi } from "../../services/api";
import { useTableRowLimit, useResetOnRowLimitChange, TABLE_ROW_LIMIT_ALL } from "../../context/TableRowLimitContext";
import TableRowsLimitFooter from "../../components/TableRowsLimitFooter";
import { useDebounced } from "../../hooks/useDebounced";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

const VISIT_TYPES = ["Work Done", "Re-Visit", "Extra Visit"];

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

/* ── Modal ──────────────────────────────────────────────────────── */
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
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8", lineHeight: 1 }}
          >
            &times;
          </button>
        </div>
        {children}
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
  const [projectFilter, setProjectFilter] = useState("");
  const [imFilter, setImFilter] = useState("");
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
      if (projectFilter) portal.project_code = projectFilter;
      if (imFilter) portal.im = imFilter;
      if (duidFilter) portal.site_code = duidFilter;
      if (fromDate) portal.from_date = fromDate;
      if (toDate) portal.to_date = toDate;
      const list = await pmApi.listPODispatches({ dispatch_status: "Dispatched" }, rowLimit, portal);
      setRows(Array.isArray(list) ? list : []);
    } catch (err) {
      setError(err.message || "Failed to load dispatches");
    } finally {
      setLoading(false);
    }
  }, [rowLimit, searchDebounced, projectFilter, imFilter, duidFilter, fromDate, toDate]);

  useEffect(() => { loadMeta(); }, [loadMeta]);
  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (!showModal) return;
    let cancelled = false;
    (async () => {
      setTeamsLoading(true);
      try {
        const list = await pmApi.listINETTeams({ status: "Active" });
        if (!cancelled) setTeamsList(Array.isArray(list) ? list : []);
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

  const projectOptions = useMemo(
    () => [...new Set(metaRows.map((r) => r.project_code).filter(Boolean))].sort(),
    [metaRows],
  );
  const imOptionRows = useMemo(
    () => [...new Map(metaRows.filter((r) => r.im).map((r) => [r.im, r])).values()].sort((a, b) =>
      String(a.im_full_name || a.im || "").localeCompare(String(b.im_full_name || b.im || ""), undefined, { sensitivity: "base" }),
    ),
    [metaRows],
  );
  const duidOptions = useMemo(
    () => [...new Set(metaRows.map((r) => r.site_code).filter(Boolean))].sort(),
    [metaRows],
  );
  const hasFilters = search || projectFilter || imFilter || duidFilter || fromDate || toDate;
  const filterActiveForFooter = !!(searchDebounced.trim() || projectFilter || imFilter || duidFilter || fromDate || toDate);

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
    setPlanEndDate(planDate);
    setAccessTime("");
    setAccessPeriod("");
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
      const result = await pmApi.createRolloutPlans({
        dispatches,
        plan_date: planDate,
        plan_end_date: planEndDate,
        team: planTeam,
        access_time: accessTime,
        access_period: accessPeriod,
        visit_type: visitType,
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
          <button
            className="btn-secondary"
            onClick={() => { void loadMeta(); void loadData(); }}
            disabled={loading}
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* ── Toolbar ─────────────────────────────────────────── */}
      <div className="toolbar">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
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
          <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem" }}>
            <option value="">All Projects</option>
            {projectOptions.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={imFilter} onChange={(e) => setImFilter(e.target.value)} style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem" }}>
            <option value="">All IMs</option>
            {imOptionRows.map((r) => (
              <option key={r.im} value={r.im}>{r.im_full_name || r.im}</option>
            ))}
          </select>
          <select value={duidFilter} onChange={(e) => setDuidFilter(e.target.value)} style={{ maxWidth: 200, padding: "7px 10px", borderRadius: 8, border: "1px solid #dbe3ef", fontSize: "0.84rem", background: "#fff" }}>
            <option value="">All DUIDs</option>
            {duidOptions.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem" }} />
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem" }} />
          {hasFilters && (
            <button
              className="btn-secondary"
              style={{ fontSize: "0.78rem", padding: "5px 12px" }}
              onClick={() => { setSearch(""); setProjectFilter(""); setImFilter(""); setDuidFilter(""); setFromDate(""); setToDate(""); }}
            >
              Clear
            </button>
          )}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
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

        <div className="data-table-wrapper">
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
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{row.name}</td>
                    <td>{row.item_code}</td>
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
        </div>
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
        width={560}
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
                  {selected.size} dispatch line{selected.size !== 1 ? "s" : ""} · SAR {fmt.format(selectedAmt)}
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

              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Assigned team</label>
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

              <div style={{ marginBottom: 16 }}>
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

              <div style={{ fontSize: "0.72rem", fontWeight: 600, color: "#94a3b8", letterSpacing: "0.06em", marginBottom: 12 }}>ACCESS DETAILS</div>
              <div style={{ display: "grid", gap: 16, marginBottom: 20 }}>
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
                  <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.88rem", cursor: "pointer" }}>
                      <input type="radio" name="access_period_rp" checked={accessPeriod === ""} onChange={() => setAccessPeriod("")} />
                      Not set
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.88rem", cursor: "pointer" }}>
                      <input type="radio" name="access_period_rp" checked={accessPeriod === "Day"} onChange={() => setAccessPeriod("Day")} />
                      Day
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.88rem", cursor: "pointer" }}>
                      <input type="radio" name="access_period_rp" checked={accessPeriod === "Night"} onChange={() => setAccessPeriod("Night")} />
                      Night
                    </label>
                  </div>
                </div>
              </div>
        </>

        {createError && (
          <div className="notice error" style={{ marginBottom: 14 }}>
            <span>⚠</span> {createError}
          </div>
        )}

        <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
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
        </div>
      </Modal>

      <Modal
        open={!!detailRow}
        onClose={() => setDetailRow(null)}
        title={`PO Dispatch Details${detailRow?.name ? ` - ${detailRow.name}` : ""}`}
        width={720}
      >
        {detailRow && (
          <div style={{ maxHeight: "65vh", overflow: "auto", borderRadius: 8, background: "#f8fafc", padding: 12 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              <Pill label="POID" value={detailRow.name} tone="blue" />
              <Pill label="Project" value={detailRow.project_code} tone="amber" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, borderRadius: 8, background: "#fff" }}>
              <DetailItem label="POID" value={detailRow.name} />
              <DetailItem label="PO No" value={detailRow.po_no} />
              <DetailItem label="Item Code" value={detailRow.item_code} />
              <DetailItem label="Description" value={detailRow.item_description} />
              <DetailItem label="Project" value={detailRow.project_code} />
              <DetailItem label="DUID" value={detailRow.site_code} />
              <DetailItem label="Site Name" value={detailRow.site_name} />
              <DetailItem label="IM" value={detailRow.im_full_name || detailRow.im} />
              <DetailItem label="Dispatch Status" value={detailRow.dispatch_status} />
              <DetailItem label="Planning Mode" value={detailRow.planning_mode} />
              <DetailItem label="Dispatch Mode" value={detailRow.dispatch_mode} />
              <DetailItem label="Qty" value={fmt.format(detailRow.qty || 0)} />
              <DetailItem label="Rate (SAR)" value={fmt.format(detailRow.rate || 0)} />
              <DetailItem label="Line Amount (SAR)" value={fmt.format(detailRow.line_amount || 0)} />
              <DetailItem label="Target Month" value={detailRow.target_month} />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
