import { useCallback, useEffect, useMemo, useState } from "react";
import DataTableWrapper from "../../components/DataTableWrapper";
import { useAuth } from "../../context/AuthContext";
import { useTableRowLimit } from "../../context/TableRowLimitContext";
import TableRowsLimitFooter from "../../components/TableRowsLimitFooter";
import { useDebounced } from "../../hooks/useDebounced";
import { pmApi } from "../../services/api";
import useFilterOptions from "../../hooks/useFilterOptions";
import SearchableSelect from "../../components/SearchableSelect";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 2, minimumFractionDigits: 2 });

function todayMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

/** Current month + next 11 = 12 rolling months the IM can pick. */
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

export default function IMPOIntake() {
  const { imName } = useAuth();
  const { rowLimit } = useTableRowLimit();

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

  // ── Backend-team assignment flow ───────────────────────────────────────
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

  // One useEffect, one fetch, scoped cancellation. Replaces the older
  // useResetOnRowLimitChange + separate-load pattern that left the table
  // blank when going from a higher to a lower row limit (the smaller fetch
  // could finish before the reset commits).
  useEffect(() => {
    if (!imName) { setRows([]); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const TERMINAL_STATUSES = [
          "Sub-Contracted", "Closed", "Cancelled", "Cancelled (in System)", "Completed",
        ];
        const filters = [
          ["im", "=", imName],
          ["dispatch_status", "not in", TERMINAL_STATUSES],
        ];
        const portal = { has_target_month: "no" };
        if (searchDebounced.trim()) portal.search = searchDebounced.trim();
        if (modeFilter !== "all") portal.dispatch_mode = modeFilter;
        if (projectFilter.length) portal.project_code = projectFilter;
        if (duidFilter.length) portal.site_code = duidFilter;
        const res = await pmApi.listPODispatches(filters, rowLimit, portal);
        if (cancelled) return;
        const arr = Array.isArray(res) ? res : [];
        // Server-side filter is the primary; this client-side guard catches
        // anything that slips through (e.g. an older bundle on the server).
        const TERMINAL = new Set(TERMINAL_STATUSES);
        const visible = arr.filter((r) => !TERMINAL.has(r.dispatch_status || ""));
        setRows(visible);
        setSelected(new Set());
      } catch (err) {
        if (!cancelled) setError(err.message || "Failed to load PO intake");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [imName, rowLimit, searchDebounced, modeFilter, projectFilter, duidFilter, refreshKey]);

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
        setToastMsg(`Assigned ${okN} POID${okN !== 1 ? "s" : ""} to backend team ${teamLbl}.`);
        setTimeout(() => setToastMsg(null), 4500);
        setSelected(new Set());
        await load();
      } else {
        const firstErr = (res?.errors || [])[0];
        const tail = firstErr ? `${firstErr.poid || firstErr.po_dispatch}: ${firstErr.error}` : "see errors";
        setBackendError(`${okN} assigned to backend, ${errN} failed (${tail})`);
        if (okN > 0) {
          await load();
          // keep modal open so user can see errors
        }
      }
    } catch (err) {
      setBackendError(err.message || "Failed to assign to backend");
    } finally {
      setBackendBusy(false);
    }
  }

  const { options: dispOpts } = useFilterOptions("PO Dispatch", ["project_code", "site_code"]);
  const projectOptions = dispOpts.project_code || [];
  const duidOptions = dispOpts.site_code || [];

  const hasFilters = !!(search || projectFilter.length || duidFilter.length || modeFilter !== "all");

  function toggleRow(name) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === rows.length && rows.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(rows.map((r) => r.name)));
    }
  }

  const selectedRows = useMemo(
    () => rows.filter((r) => selected.has(r.name)),
    [rows, selected],
  );
  const selectedAmount = selectedRows.reduce((s, r) => s + (Number(r.line_amount) || 0), 0);

  async function submitAssign() {
    if (!assignMonth || selected.size === 0) return;
    setAssigning(true);
    setAssignError(null);
    try {
      const res = await pmApi.assignIMTargetMonth({
        dispatches: Array.from(selected),
        target_month: assignMonth,
      });
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

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">PO Control</h1>
          <div className="page-subtitle">
            Lines dispatched to you (auto or manual) that still need a target month. Pick lines and assign a month to move them to My Dispatches.
          </div>
        </div>
        <div className="page-actions">
          <button type="button" className="btn-secondary" onClick={load} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {toastMsg && (
        <div className="notice success" style={{ margin: "0 16px 8px" }}>
          <span>✓</span> {toastMsg}
        </div>
      )}

      <div className="toolbar">
        <input
          type="search"
          placeholder="Search POID, PO, Item, Project, DUID…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={modeFilter} onChange={(e) => setModeFilter(e.target.value)}>
          <option value="all">All modes</option>
          <option value="Auto">Auto</option>
          <option value="Manual">Manual</option>
        </select>
        <SearchableSelect multi value={projectFilter} onChange={setProjectFilter} options={projectOptions} placeholder="All Projects" minWidth={170} />
        <SearchableSelect multi value={duidFilter} onChange={setDuidFilter} options={duidOptions} placeholder="All DUIDs" minWidth={150} />
        {hasFilters && (
          <button
            className="btn-secondary"
            onClick={() => { setSearch(""); setModeFilter("all"); setProjectFilter([]); setDuidFilter([]); }}
          >
            Clear
          </button>
        )}
        <div className="toolbar-actions">
          {selected.size > 0 && (
            <span style={{ fontSize: "0.78rem", color: "#64748b", whiteSpace: "nowrap" }}>
              {selected.size} selected · SAR {fmt.format(selectedAmount)}
            </span>
          )}
          <button
            type="button"
            className="btn-primary"
            disabled={selected.size === 0}
            onClick={() => { setAssignError(null); setShowAssignModal(true); }}
          >
            Dispatch ({selected.size})
          </button>
          {canBackend && (
            <button
              type="button"
              className="btn-secondary"
              disabled={selected.size < 1}
              title={selected.size < 1 ? "Select one or more POIDs to assign" : "Assign the selected POIDs to a backend team"}
              onClick={openBackendModal}
              style={{ borderColor: "#a78bfa", color: "#7c3aed" }}
            >
              Assign to Backend ({selected.size})
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="notice error" style={{ margin: "0 16px 8px" }}>
          <span>!</span> {error}
        </div>
      )}

      <div className="page-content">
        <DataTableWrapper>
          {loading ? (
            <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Loading…</div>
          ) : rows.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📥</div>
              <h3>{hasFilters ? "No matching intake lines" : "PO Intake is empty"}</h3>
              <p>
                {hasFilters
                  ? "Try adjusting your search or filters."
                  : "When the PM dispatches new PO lines to you, they'll land here first. Assign a target month to move them to My Dispatches."}
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
                  <th>Mode</th>
                  <th>PO No</th>
                  <th>Project</th>
                  <th>Item</th>
                  <th>Description</th>
                  <th>Activity Type</th>
                  <th style={{ textAlign: "right" }}>Qty</th>
                  <th style={{ textAlign: "right" }}>Amount (SAR)</th>
                  <th>DUID</th>
                  <th>Center area</th>
                  <th>Dispatched On</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.name}
                      className={selected.has(row.name) ? "row-selected" : ""}
                      onClick={() => toggleRow(row.name)}
                      style={{ cursor: "pointer", background: row.dispatch_mode === "Auto" ? "rgba(99,102,241,0.04)" : undefined }}>
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(row.name)}
                        onChange={() => toggleRow(row.name)}
                      />
                    </td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{row.poid || row.name}</td>
                    <td>
                      <span style={{
                        display: "inline-block", padding: "2px 8px", borderRadius: 999,
                        fontSize: "0.72rem", fontWeight: 700,
                        background: row.dispatch_mode === "Auto" ? "rgba(99,102,241,0.12)" : "rgba(100,116,139,0.12)",
                        color: row.dispatch_mode === "Auto" ? "#6366f1" : "#475569",
                      }}>
                        {row.dispatch_mode || "Manual"}
                      </span>
                    </td>
                    <td>{row.po_no || "—"}</td>
                    <td>{row.project_code || "—"}</td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{row.item_code || "—"}</td>
                    <td style={{ fontSize: "0.82rem", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.item_description || ""}>
                      {row.item_description || "—"}
                    </td>
                    <td style={{ fontSize: "0.82rem" }}>{row.customer_activity_type || "—"}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{row.qty != null ? fmt.format(row.qty) : "—"}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt.format(row.line_amount || 0)}</td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }} title={row.site_name || ""}>{row.site_code || "—"}</td>
                    <td style={{ fontSize: "0.82rem", maxWidth: 140 }} title={row.center_area || ""}>{row.center_area || "—"}</td>
                    <td style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>{row.modified ? String(row.modified).slice(0, 10) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </DataTableWrapper>
        <TableRowsLimitFooter
          placement="tableCard"
          loadedCount={rows.length}
          filteredCount={rows.length}
          filterActive={!!hasFilters}
        />
      </div>

      {showBackendModal && (
        <div style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
             onClick={backendBusy ? undefined : () => setShowBackendModal(false)}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 20, width: "min(520px, 100%)", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)" }}
               onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: "1rem" }}>
                Assign to Backend <span style={{ color: "#64748b", fontWeight: 500 }}>· {selected.size} POID{selected.size !== 1 ? "s" : ""}</span>
              </h3>
              <button type="button" onClick={() => setShowBackendModal(false)} disabled={backendBusy} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#94a3b8", lineHeight: 1 }}>&times;</button>
            </div>
            {selectedRows.length > 0 && (
              <div style={{
                fontSize: "0.76rem", color: "#475569",
                background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8,
                padding: "8px 10px", marginBottom: 12,
                maxHeight: 140, overflowY: "auto",
              }}>
                {selectedRows.map((r) => (
                  <div key={r.name} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "2px 0" }}>
                    <span style={{ fontFamily: "monospace", fontWeight: 700, color: "#0f172a" }}>{r.poid || r.name}</span>
                    <span style={{ color: "#64748b" }}>
                      {r.po_no || "—"} · {r.item_code || "—"} · {r.site_code || "—"}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="form-group" style={{ marginBottom: 10 }}>
              <label>Backend Team *</label>
              <select
                value={backendTeamId}
                onChange={(e) => setBackendTeamId(e.target.value)}
                disabled={backendBusy || backendTeamsLoading}
                required
              >
                <option value="">{backendTeamsLoading ? "Loading teams…" : "— Select a backend team —"}</option>
                {backendTeams.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.team_name || t.team_id}{t.team_id && t.team_name ? ` (${t.team_id})` : ""}
                  </option>
                ))}
              </select>
              {!backendTeamsLoading && backendTeams.length === 0 && (
                <div style={{ fontSize: "0.74rem", color: "#94a3b8", marginTop: 4 }}>
                  No active teams with category "Backend Team". Add one in the Teams master.
                </div>
              )}
            </div>
            <div className="form-group" style={{ marginBottom: 10 }}>
              <label>Note (optional)</label>
              <textarea
                rows={3}
                value={backendRemark}
                onChange={(e) => setBackendRemark(e.target.value)}
                placeholder="Any reference / scope notes for this backend assignment…"
                disabled={backendBusy}
                style={{ width: "100%", boxSizing: "border-box", padding: "6px 8px", fontSize: "0.85rem", border: "1px solid #e2e8f0", borderRadius: 6, resize: "vertical" }}
              />
            </div>
            {backendError && (
              <div className="notice error" style={{ marginBottom: 10, fontSize: "0.82rem" }}>
                <span>!</span> {backendError}
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button type="button" className="btn-secondary" onClick={() => setShowBackendModal(false)} disabled={backendBusy}>Cancel</button>
              <button
                type="button"
                className="btn-primary"
                onClick={submitBackend}
                disabled={backendBusy || !backendTeamId}
                style={{ background: "#7c3aed", borderColor: "#7c3aed" }}
              >
                {backendBusy ? "Assigning…" : `Assign ${selected.size} POID${selected.size !== 1 ? "s" : ""}`}
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
                {monthOptions().map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </div>
            {assignError && (
              <div className="notice error" style={{ marginBottom: 10, fontSize: "0.82rem" }}>
                <span>!</span> {assignError}
              </div>
            )}
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
