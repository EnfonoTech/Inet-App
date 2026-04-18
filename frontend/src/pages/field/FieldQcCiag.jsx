import { useEffect, useState } from "react";
import DataTableWrapper from "../../components/DataTableWrapper";
import { useAuth } from "../../context/AuthContext";
import { useTableRowLimit, useResetOnRowLimitChange } from "../../context/TableRowLimitContext";
import TableRowsLimitFooter from "../../components/TableRowsLimitFooter";
import { useDebounced } from "../../hooks/useDebounced";
import { pmApi } from "../../services/api";

const TEAM_QC_OPTIONS = ["Pending", "Pass", "Fail"];
const TEAM_CIAG_OPTIONS = ["Open", "In Progress", "Submitted", "Approved", "Rejected", "N/A"];

function statusBadgeClass(status) {
  const s = String(status || "").toLowerCase();
  if (s === "pass" || s === "approved") return "completed";
  if (s === "fail" || s === "rejected") return "cancelled";
  if (s === "pending" || s === "open" || s.includes("progress") || s === "submitted") return "in-progress";
  return "new";
}

/* QC/CIAG edit modal — shared by mobile and desktop */
function QcEditModal({ row, onClose, onSaved }) {
  const [executionName, setExecutionName] = useState("");
  const [qcStatus, setQcStatus] = useState("Pending");
  const [ciagStatus, setCiagStatus] = useState("Open");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    if (!row) return;
    setMsg(null); setLoadError(null);
    pmApi.getFieldExecutionForRollout(row.name).then((ex) => {
      if (!ex?.name) { setLoadError("No execution record found for this plan."); return; }
      setExecutionName(ex.name);
      setQcStatus(ex.qc_status || "Pending");
      setCiagStatus(ex.ciag_status || "Open");
    }).catch(() => setLoadError("Could not load execution details."));
  }, [row?.name]);

  async function save() {
    if (!executionName) return;
    setSaving(true); setMsg(null);
    try {
      await pmApi.updateExecution({ name: executionName, qc_status: qcStatus, ciag_status: ciagStatus });
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
            <div style={{ fontFamily: "monospace", fontSize: "0.72rem", color: "var(--text-muted)", marginTop: 2 }}>{row.name}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, color: "var(--text-muted)", cursor: "pointer", padding: 0, lineHeight: 1 }}>×</button>
        </div>

        <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: 14, display: "flex", flexDirection: "column", gap: 3 }}>
          {row.project_code && <span>Project: <strong>{row.project_code}</strong></span>}
          {row.site_name && <span>Site: <strong>{row.site_name}</strong></span>}
          {row.plan_date && <span>Date: <strong>{row.plan_date}</strong> · {row.visit_type || ""}</span>}
        </div>

        {loadError ? (
          <div className="notice error" style={{ marginBottom: 14 }}>{loadError}</div>
        ) : (
          <>
            <div className="exec-field" style={{ marginBottom: 12 }}>
              <label>QC Status</label>
              <select value={qcStatus} onChange={(e) => setQcStatus(e.target.value)}>
                {TEAM_QC_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="exec-field" style={{ marginBottom: 16 }}>
              <label>CIAG Status</label>
              <select value={ciagStatus} onChange={(e) => setCiagStatus(e.target.value)}>
                {TEAM_CIAG_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
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
function QcCard({ row, selected, onToggle, onOpen }) {
  return (
    <div className="qc-card field-list-card" onClick={() => onOpen(row)}>
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
            <div className="qc-card-id">{row.name}</div>
          </div>
          {row.po_dispatch && <div className="qc-card-poid">POID: {row.po_dispatch}</div>}
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
        <span className={`status-badge ${statusBadgeClass(row.qc_status || "Pending")}`}>
          <span className="status-dot" />{row.qc_status || "Pending"}
        </span>
        <span className="qc-badge-label" style={{ marginLeft: 6 }}>CIAG</span>
        <span className={`status-badge ${statusBadgeClass(row.ciag_status || "Open")}`}>
          <span className="status-dot" />{row.ciag_status || "Open"}
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
  const [search, setSearch] = useState("");
  const searchDebounced = useDebounced(search, 300);
  const [selectedPlans, setSelectedPlans] = useState(new Set());
  const [editRow, setEditRow] = useState(null);

  useResetOnRowLimitChange(() => { setRows([]); setLoading(true); });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!teamId) return;
      setLoading(true);
      try {
        const filters = { status: "Completed", team: teamId };
        if (searchDebounced.trim()) filters.search = searchDebounced.trim();
        const list = await pmApi.listExecutionMonitorRows(filters, rowLimit);
        if (!cancelled) setRows(Array.isArray(list) ? list : []);
      } catch { if (!cancelled) setRows([]); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [teamId, rowLimit, searchDebounced]);

  function toggleRow(name) {
    setSelectedPlans((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }

  function toggleAll() {
    if (rows.length > 0 && rows.every((r) => selectedPlans.has(r.name))) {
      setSelectedPlans(new Set());
    } else {
      setSelectedPlans(new Set(rows.map((r) => r.name)));
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
        {loading ? (
          <div className="field-card-list">
            {[1, 2, 3].map((i) => (
              <div key={i} className="qc-card">
                <div className="skeleton-line" style={{ width: "55%", height: 13, marginBottom: 6 }} />
                <div className="skeleton-line" style={{ width: "35%", height: 10, marginBottom: 10 }} />
                <div className="skeleton-line" style={{ width: "80%", height: 10 }} />
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="empty-state" style={{ marginTop: 40 }}>
            <div className="empty-icon">✅</div>
            <h3>No completed plans</h3>
            <p>Completed executions pending QC review will appear here.</p>
          </div>
        ) : (
          <div className="field-card-list">
            {/* Select-all bar */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 0" }}>
              <input
                type="checkbox"
                checked={rows.length > 0 && rows.every((r) => selectedPlans.has(r.name))}
                onChange={toggleAll}
                style={{ width: 16, height: 16, accentColor: "var(--blue)", cursor: "pointer" }}
              />
              <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
                {rows.length} plan{rows.length !== 1 ? "s" : ""}
              </span>
            </div>
            {rows.map((r) => (
              <QcCard
                key={r.name}
                row={r}
                selected={selectedPlans.has(r.name)}
                onToggle={toggleRow}
                onOpen={setEditRow}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Desktop table ────────────────────────────────── */}
      <div className="page-content field-desktop-only">
        <DataTableWrapper>
          {loading ? (
            <div style={{ padding: 32, textAlign: "center", color: "var(--text-muted)" }}>Loading completed plans...</div>
          ) : rows.length === 0 ? (
            <div className="empty-state"><h3>No completed plans found</h3></div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}>
                    <input
                      type="checkbox"
                      checked={rows.length > 0 && rows.every((r) => selectedPlans.has(r.name))}
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
                {rows.map((r) => (
                  <tr key={r.name} className="row-link" onClick={() => setEditRow(r)}>
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedPlans.has(r.name)}
                        onChange={() => toggleRow(r.name)}
                      />
                    </td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{r.name}</td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{r.po_dispatch || "—"}</td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.72rem", maxWidth: 140 }}>
                      {(r.original_dummy_poid || "").trim() && String(r.original_dummy_poid) !== String(r.po_dispatch || "")
                        ? (r.original_dummy_poid || "").trim() : "—"}
                    </td>
                    <td>{r.project_code || "—"}</td>
                    <td>{r.site_code || "—"}</td>
                    <td>{r.plan_date || "—"}</td>
                    <td>{r.visit_type || "—"}</td>
                    <td style={{ fontSize: "0.82rem", maxWidth: 120 }}>{r.center_area || "—"}</td>
                    <td>{r.region_type || "—"}</td>
                    <td>
                      <span className={`status-badge ${statusBadgeClass(r.qc_status || "Pending")}`}>
                        <span className="status-dot" />{r.qc_status || "Pending"}
                      </span>
                    </td>
                    <td>
                      <span className={`status-badge ${statusBadgeClass(r.ciag_status || "Open")}`}>
                        <span className="status-dot" />{r.ciag_status || "Open"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </DataTableWrapper>
        <TableRowsLimitFooter placement="tableCard" loadedCount={rows.length} filteredCount={rows.length} filterActive={!!search} />
      </div>

      {/* ── Edit modal ───────────────────────────────────── */}
      {editRow && (
        <QcEditModal
          row={editRow}
          onClose={() => setEditRow(null)}
          onSaved={() => {
            setEditRow(null);
            // refresh rows
            const filters = { status: "Completed", team: teamId };
            if (searchDebounced.trim()) filters.search = searchDebounced.trim();
            pmApi.listExecutionMonitorRows(filters, rowLimit)
              .then((list) => setRows(Array.isArray(list) ? list : []))
              .catch(() => {});
          }}
        />
      )}
    </div>
  );
}
