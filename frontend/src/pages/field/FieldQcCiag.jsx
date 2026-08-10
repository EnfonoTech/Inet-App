import { useEffect, useRef, useState } from "react";
import DataTableWrapper from "../../components/DataTableWrapper";
import { useAuth } from "../../context/AuthContext";
import { useTableRowLimit, TABLE_ROW_LIMIT_ALL } from "../../context/TableRowLimitContext";
import { useProgressiveRows } from "../../hooks/useProgressiveRows";
import TableRowsLimitFooter from "../../components/TableRowsLimitFooter";
import { useDebounced } from "../../hooks/useDebounced";
import { pmApi } from "../../services/api";
import { isNotRequired } from "../../utils/qcCiagFlags";
import { handleSearchPaste } from "../../utils/searchPaste";

const TEAM_QC_OPTIONS = ["Pending", "Pass", "Fail"];
const TEAM_CIAG_OPTIONS = ["Open", "Approved", "Not Applicable"];

function statusBadgeClass(status) {
  const s = String(status || "").toLowerCase();
  if (s === "pass" || s === "approved") return "completed";
  if (s === "fail") return "cancelled";
  if (s === "pending" || s === "open") return "in-progress";
  if (s === "not applicable" || s === "n/a") return "new";
  return "new";
}

/* QC/CIAG edit modal — shared by mobile and desktop */
function QcEditModal({ row, onClose, onSaved }) {
  // Treat 0 / "0" / false as not-required so plans created with the
  // toggle off render the "Not Applicable" pill instead of an editable
  // "Pending" / "Open" select.
  const [qcReqRaw, setQcReqRaw] = useState(row?.qc_required);
  const [ciagReqRaw, setCiagReqRaw] = useState(row?.ciag_required);
  const qcRequired = !isNotRequired(qcReqRaw);
  const ciagRequired = !isNotRequired(ciagReqRaw);
  const [executionName, setExecutionName] = useState("");
  const [qcStatus, setQcStatus] = useState("Pending");
  const [ciagStatus, setCiagStatus] = useState("Open");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    if (!row) return;
    setMsg(null); setLoadError(null);
    setQcReqRaw(row.qc_required);
    setCiagReqRaw(row.ciag_required);
    pmApi.getFieldExecutionForRollout(row.name).then((ex) => {
      if (!ex?.name) { setLoadError("No execution record found for this plan."); return; }
      setExecutionName(ex.name);
      setQcStatus(ex.qc_status || "Pending");
      setCiagStatus(ex.ciag_status || "Open");
      // Authoritative source: getFieldExecutionForRollout backstops
      // qc_required / ciag_required from Rollout Plan via raw SQL.
      if (ex.qc_required !== undefined) setQcReqRaw(ex.qc_required);
      if (ex.ciag_required !== undefined) setCiagReqRaw(ex.ciag_required);
    }).catch(() => setLoadError("Could not load execution details."));
  }, [row?.name, row?.qc_required, row?.ciag_required]);

  async function save() {
    if (!executionName) return;
    setSaving(true); setMsg(null);
    try {
      const payload = { name: executionName };
      if (qcRequired) payload.qc_status = qcStatus;
      if (ciagRequired) payload.ciag_status = ciagStatus;
      await pmApi.updateExecution(payload);
      setMsg("Saved successfully.");
      onSaved?.();
    } catch (e) { setMsg(e.message || "Could not save."); }
    finally { setSaving(false); }
  }

  if (!row) return null;

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.5)", backdropFilter: "blur(4px)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}
      onClick={onClose}
    >
      <div
        style={{ width: "min(520px, 100vw)", background: "#fff", borderRadius: "16px 16px 0 0", padding: "20px 20px calc(20px + env(safe-area-inset-bottom, 0px))", boxShadow: "0 -8px 40px rgba(0,0,0,0.15)", animation: "modal-slide-up 0.22s ease" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle bar */}
        <div style={{ width: 40, height: 4, borderRadius: 2, background: "#e2e8f0", margin: "0 auto 16px" }} />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: "0.95rem", color: "var(--text)" }}>QC / CIAG Update</div>
            <div style={{ fontFamily: "monospace", fontSize: "0.72rem", color: "var(--text-muted)", marginTop: 2 }}>
              {row.poid || row.po_dispatch || row.name}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, color: "var(--text-muted)", cursor: "pointer", padding: 0, lineHeight: 1 }}>×</button>
        </div>

        <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: 14, display: "flex", flexDirection: "column", gap: 3 }}>
          {row.project_code && <span>Project: <strong>{row.project_code}</strong></span>}
          {(row.site_code || row.site_name) && <span>Site: <strong>{row.site_code || ""}{row.site_code && row.site_name ? " · " : ""}{row.site_name || ""}</strong></span>}
          {row.item_code && <span>Item: <strong>{row.item_code}</strong>{row.item_description ? ` — ${row.item_description}` : ""}</span>}
          {row.plan_date && <span>Date: <strong>{row.plan_date}</strong> · {row.visit_type || ""}</span>}
        </div>

        {loadError ? (
          <div className="notice error" style={{ marginBottom: 14 }}>{loadError}</div>
        ) : (
          <>
            {qcRequired ? (
              <div className="exec-field" style={{ marginBottom: 12 }}>
                <label>QC Status</label>
                <select value={qcStatus} onChange={(e) => setQcStatus(e.target.value)}>
                  {TEAM_QC_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            ) : (
              <div style={{ marginBottom: 12, padding: "8px 10px", background: "#fef3c7", color: "#92400e", borderRadius: 6, fontSize: "0.78rem", fontWeight: 600 }}>
                QC not required for this plan.
              </div>
            )}
            {ciagRequired ? (
              <div className="exec-field" style={{ marginBottom: 16 }}>
                <label>CIAG Status</label>
                <select value={ciagStatus} onChange={(e) => setCiagStatus(e.target.value)}>
                  {TEAM_CIAG_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            ) : (
              <div style={{ marginBottom: 16, padding: "8px 10px", background: "#fef3c7", color: "#92400e", borderRadius: 6, fontSize: "0.78rem", fontWeight: 600 }}>
                CIAG not required for this plan.
              </div>
            )}
          </>
        )}

        {msg && (
          <div className={`notice ${msg.includes("uccess") ? "success" : "info"}`} style={{ marginBottom: 12 }}>
            {msg}
          </div>
        )}

        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn-secondary" style={{ flex: 1, minHeight: 46 }} onClick={onClose}>
            Close
          </button>
          <button
            className="btn-primary"
            style={{ flex: 2, minHeight: 46 }}
            disabled={saving || !executionName || !!loadError}
            onClick={save}
          >
            {saving ? "Saving…" : "Save QC / CIAG"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* Mobile QC card */
function QcCard({ row, selected, onToggle, onOpen, style }) {
  return (
    <div className="qc-card field-list-card" style={style} onClick={() => onOpen(row)}>
      <div className="qc-card-header">
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={selected}
              onChange={(e) => { e.stopPropagation(); onToggle(row.name); }}
              style={{ width: 16, height: 16, accentColor: "var(--blue)", cursor: "pointer", flexShrink: 0 }}
              onClick={(e) => e.stopPropagation()}
            />
            <div className="qc-card-id">{row.poid || row.po_dispatch || row.name}</div>
          </div>
          {row.po_dispatch && row.poid && row.poid !== row.po_dispatch && (
            <div className="qc-card-poid">System: {row.po_dispatch}</div>
          )}
        </div>
        <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16" style={{ color: "var(--text-muted)", flexShrink: 0, opacity: 0.4 }}>
          <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd"/>
        </svg>
      </div>

      <div className="qc-card-meta">
        {row.project_code && <span>Project: <strong style={{ color: "var(--text)" }}>{row.project_code}</strong></span>}
        {row.site_name && <span>Site: <strong style={{ color: "var(--text)" }}>{row.site_name}</strong></span>}
        {row.plan_date && <span>{row.plan_date}{row.visit_type ? ` · ${row.visit_type}` : ""}</span>}
      </div>

      <div className="qc-badge-row">
        <span className="qc-badge-label">QC</span>
        <span className={`status-badge ${statusBadgeClass(row.qc_required === 0 ? "Not Applicable" : (row.qc_status || "Pending"))}`}>
          <span className="status-dot" />
          {row.qc_required === 0 ? "Not Applicable" : (row.qc_status || "Pending")}
        </span>
        <span className="qc-badge-label" style={{ marginLeft: 6 }}>CIAG</span>
        <span className={`status-badge ${statusBadgeClass(row.ciag_required === 0 ? "Not Applicable" : (row.ciag_status || "Open"))}`}>
          <span className="status-dot" />
          {row.ciag_required === 0 ? "Not Applicable" : (row.ciag_status || "Open")}
        </span>
      </div>
    </div>
  );
}

export default function FieldQcCiag() {
  const { teamId } = useAuth();
  const { rowLimit } = useTableRowLimit();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  // See useProgressiveRows — mounts large row sets in chunks so the browser
  // doesn't show "Page Unresponsive" on tables with "All" rows loaded.
  const visibleRows = useProgressiveRows(rows, { paused: loading });
  // How many of `visibleRows` to actually show — anything beyond this is
  // hidden via CSS in the render below rather than removed from `rows`.
  const displayLimit = rowLimit === TABLE_ROW_LIMIT_ALL ? Infinity : rowLimit;
  const displayedCount = Math.min(rows.length, displayLimit);
  const [search, setSearch] = useState("");
  const searchDebounced = useDebounced(search, 300);
  const [selectedPlans, setSelectedPlans] = useState(new Set());
  const [editRow, setEditRow] = useState(null);

  // ── Manage Table column filters ──────────────────────────────────────
  // Each column's typed value is matched only against that column's own
  // value on the backend (see column_filters / col_filter_map in
  // list_execution_monitor_rows).
  const [columnFilters, setColumnFilters] = useState({});
  useEffect(() => {
    const onFiltersChanged = (e) => {
      if (e.detail?.tableKey !== "field-qc-ciag-v1") return;
      setColumnFilters(e.detail.filters || {});
    };
    document.addEventListener("tablepro:filters-changed", onFiltersChanged);
    return () => document.removeEventListener("tablepro:filters-changed", onFiltersChanged);
  }, []);
  const activeColumnFilters = Object.fromEntries(
    Object.entries(columnFilters).filter(([, v]) => String(v || "").trim())
  );
  const columnFiltersKey = JSON.stringify(activeColumnFilters);
  const columnFiltersDebounced = useDebounced(columnFiltersKey, 300);

  // Remembers what the LAST real server fetch actually returned, and under
  // what limit + filters. Shrinking the row limit (e.g. All -> 20) never
  // needs another round-trip — the rows are already in memory; just show
  // fewer of the same rows (see displayLimit/displayedCount above). Only
  // growing the limit — or any OTHER filter actually changing — hits the
  // server.
  const lastFetchRef = useRef({ signature: null, limit: null, rows: [] });

  useEffect(() => {
    if (!teamId) { setRows([]); setLoading(false); return; }

    const signature = JSON.stringify([teamId, searchDebounced, columnFiltersDebounced]);
    const prev = lastFetchRef.current;
    const alreadyHaveEnough = prev.signature === signature && (
      prev.limit === TABLE_ROW_LIMIT_ALL
      || (rowLimit !== TABLE_ROW_LIMIT_ALL && rowLimit <= prev.limit)
    );
    if (alreadyHaveEnough) {
      // Deliberately NOT calling setRows() here — leave `rows` exactly
      // as-is; the render below hides anything beyond the new limit via
      // CSS instead of unmounting rows that are already loaded.
      return;
    }

    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const filters = { status: "Completed", team: teamId };
        if (searchDebounced.trim()) filters.search = searchDebounced.trim();
        const colFilters = JSON.parse(columnFiltersDebounced);
        if (Object.keys(colFilters).length) filters.column_filters = colFilters;
        const list = await pmApi.listExecutionMonitorRows(filters, rowLimit);
        // Hide rows where the IM has already confirmed (execution_status
        // = "Completed") — at that point QC/CIAG is the IM's call, no
        // longer the field team's queue.
        const visible = (Array.isArray(list) ? list : []).filter(
          (r) =>
            String(r.execution_status || "") !== "Completed" &&
            // Drop rows where the IM/PM has disabled both QC and CIAG —
            // there's nothing for the field user to act on.
            !(r.qc_required === 0 && r.ciag_required === 0)
        );
        if (!cancelled) {
          setRows(visible);
          lastFetchRef.current = { signature, limit: rowLimit, rows: visible };
        }
      } catch { if (!cancelled) setRows([]); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [teamId, rowLimit, searchDebounced, columnFiltersDebounced]);

  function toggleRow(name) {
    setSelectedPlans((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }

  function toggleAll() {
    const dtpHidden = new Set(Array.from(document.querySelectorAll("tbody tr[data-tablepro-filtered]")).map((tr) => tr.dataset.docName).filter(Boolean));
    // Only rows within the current display limit — anything beyond it is
    // hidden via CSS (see displayLimit above), not a real filter, but
    // "select all" should still only ever act on what's actually shown.
    const visible = rows.slice(0, displayedCount).filter((r) => !dtpHidden.has(r.name));
    if (visible.length > 0 && visible.every((r) => selectedPlans.has(r.name))) {
      setSelectedPlans(new Set());
    } else {
      setSelectedPlans(new Set(visible.map((r) => r.name)));
    }
  }

  function openSelectedEditor() {
    const first = rows.find((r) => selectedPlans.has(r.name));
    if (first) setEditRow(first);
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">QC / CIAG</h1>
          <div className="page-subtitle">Completed plans pending review</div>
        </div>
      </div>

      {/* ── Search + action toolbar ───────────────────────── */}
      <div className="toolbar">
        <input
          type="search"
          className="field-toolbar-search"
          placeholder="Search plan, project, site…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onPaste={(e) => handleSearchPaste(e, setSearch)}
          style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid var(--border)", fontSize: "0.84rem", flex: 1, minWidth: 0 }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {selectedPlans.size > 0 && (
            <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>{selectedPlans.size} selected</span>
          )}
          <button
            type="button"
            className="btn-primary btn-sm"
            onClick={openSelectedEditor}
            disabled={selectedPlans.size === 0}
          >
            QC / CIAG
          </button>
        </div>
      </div>

      {/* ── Mobile card list ─────────────────────────────── */}
      <div className="field-mobile-only">
        {rows.length > 0 ? (
          <div className="field-card-list">
            {/* Select-all bar */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 0" }}>
              <input
                type="checkbox"
                checked={displayedCount > 0 && rows.slice(0, displayedCount).every((r) => selectedPlans.has(r.name))}
                onChange={toggleAll}
                style={{ width: 16, height: 16, accentColor: "var(--blue)", cursor: "pointer" }}
              />
              <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
                {displayedCount} plan{displayedCount !== 1 ? "s" : ""}
              </span>
            </div>
            {visibleRows.map((r, idx) => (
              <QcCard
                key={r.name}
                row={r}
                selected={selectedPlans.has(r.name)}
                onToggle={toggleRow}
                onOpen={setEditRow}
                style={idx >= displayLimit ? { display: "none" } : undefined}
              />
            ))}
          </div>
        ) : loading ? (
          <div className="field-card-list">
            {[1, 2, 3].map((i) => (
              <div key={i} className="qc-card">
                <div className="skeleton-line" style={{ width: "55%", height: 13, marginBottom: 6 }} />
                <div className="skeleton-line" style={{ width: "35%", height: 10, marginBottom: 10 }} />
                <div className="skeleton-line" style={{ width: "80%", height: 10 }} />
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state" style={{ marginTop: 40 }}>
            <div className="empty-icon">✅</div>
            <h3>No completed plans</h3>
            <p>Completed executions pending QC review will appear here.</p>
          </div>
        )}
      </div>

      {/* ── Desktop table ────────────────────────────────── */}
      <div className="page-content field-desktop-only">
        <DataTableWrapper loading={loading && rows.length > 0}>
          <table className="data-table" data-table-key="field-qc-ciag-v1">
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  <input
                    type="checkbox"
                    checked={displayedCount > 0 && rows.slice(0, displayedCount).every((r) => selectedPlans.has(r.name))}
                    onChange={toggleAll}
                  />
                </th>
                <th>Plan</th>
                <th>POID</th>
                <th>Dummy POID</th>
                <th>Project</th>
                <th>DUID</th>
                <th>Plan Date</th>
                <th>Visit Type</th>
                <th>Center Area</th>
                <th>Region</th>
                <th>QC</th>
                <th>CIAG</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={12} style={{ padding: 0 }}>
                    {loading ? (
                      <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)" }}>Loading completed plans...</div>
                    ) : (
                      <div className="empty-state"><h3>No completed plans found</h3></div>
                    )}
                  </td>
                </tr>
              ) : visibleRows.map((r, idx) => (
                <tr key={r.name} data-doc-name={r.name} className="row-link" onClick={() => setEditRow(r)} style={idx >= displayLimit ? { display: "none" } : undefined}>
                  <td onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedPlans.has(r.name)}
                      onChange={() => toggleRow(r.name)}
                    />
                  </td>
                  <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{r.name}</td>
                  <td style={{ fontFamily: "monospace", fontSize: "0.78rem", fontWeight: 600 }} title={r.po_dispatch ? `System ID: ${r.po_dispatch}` : ""}>
                    {r.poid || r.po_dispatch || "—"}
                  </td>
                  <td style={{ fontFamily: "monospace", fontSize: "0.72rem", maxWidth: 140 }}>
                    {(r.original_dummy_poid || "").trim() && String(r.original_dummy_poid) !== String(r.poid || r.po_dispatch || "")
                      ? (r.original_dummy_poid || "").trim() : "—"}
                  </td>
                  <td>{r.project_code || "—"}</td>
                  <td>{r.site_code || "—"}</td>
                  <td>{r.plan_date || "—"}</td>
                  <td>{r.visit_type || "—"}</td>
                  <td style={{ fontSize: "0.82rem", maxWidth: 120 }}>{r.center_area || "—"}</td>
                  <td>{r.region_type || "—"}</td>
                  <td>
                    {r.qc_required === 0 ? (
                      <span className="status-badge" style={{ background: "#f1f5f9", color: "#64748b" }}>—</span>
                    ) : (
                      <span className={`status-badge ${statusBadgeClass(r.qc_status || "Pending")}`}>
                        <span className="status-dot" />{r.qc_status || "Pending"}
                      </span>
                    )}
                  </td>
                  <td>
                    {r.ciag_required === 0 ? (
                      <span className="status-badge" style={{ background: "#f1f5f9", color: "#64748b" }}>—</span>
                    ) : (
                      <span className={`status-badge ${statusBadgeClass(r.ciag_status || "Open")}`}>
                        <span className="status-dot" />{r.ciag_status || "Open"}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataTableWrapper>
        <TableRowsLimitFooter placement="tableCard" loadedCount={displayedCount} filteredCount={displayedCount} filterActive={!!search} />
      </div>

      {/* ── Edit modal ───────────────────────────────────── */}
      {editRow && (
        <QcEditModal
          row={editRow}
          onClose={() => setEditRow(null)}
          onSaved={() => {
            setEditRow(null);
            // refresh rows; same IM-confirmed filter as the initial load.
            const filters = { status: "Completed", team: teamId };
            if (searchDebounced.trim()) filters.search = searchDebounced.trim();
            const colFilters = JSON.parse(columnFiltersDebounced);
            if (Object.keys(colFilters).length) filters.column_filters = colFilters;
            pmApi.listExecutionMonitorRows(filters, rowLimit)
              .then((list) => {
                const visible = (Array.isArray(list) ? list : []).filter(
                  (r) => String(r.execution_status || "") !== "Completed"
                );
                setRows(visible);
                // Keep the skip-fetch ref in sync with this out-of-band
                // refresh too — otherwise a later grow back to a bigger
                // limit could wrongly think it already has everything,
                // based on data from before this save.
                const signature = JSON.stringify([teamId, searchDebounced, columnFiltersDebounced]);
                lastFetchRef.current = { signature, limit: rowLimit, rows: visible };
              })
              .catch(() => {});
          }}
        />
      )}
    </div>
  );
}
