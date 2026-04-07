import { useEffect, useState, useCallback } from "react";
import { pmApi } from "../../services/api";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });
const fmtAmt = new Intl.NumberFormat("en", { maximumFractionDigits: 2, minimumFractionDigits: 2 });

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
  const [activeTab, setActiveTab] = useState("New");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [teams, setTeams] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [tableSearch, setTableSearch] = useState("");

  // Dispatch modal state
  const [showDispatchModal, setShowDispatchModal] = useState(false);
  const [team, setTeam] = useState("");
  const [targetMonth, setTargetMonth] = useState(todayMonth());
  const [dispatching, setDispatching] = useState(false);

  // Convert modal state
  const [converting, setConverting] = useState(false);
  const [convertTeam, setConvertTeam] = useState("");
  const [showConvertModal, setShowConvertModal] = useState(false);
  const [convertScope, setConvertScope] = useState(null);

  const [successMsg, setSuccessMsg] = useState(null);
  const [errMsg, setErrMsg] = useState(null);

  const showNotice = useCallback((type, msg) => {
    if (type === "ok") { setSuccessMsg(msg); setErrMsg(null); }
    else { setErrMsg(msg); setSuccessMsg(null); }
    setTimeout(() => { setSuccessMsg(null); setErrMsg(null); }, 5000);
  }, []);

  async function loadData(tab) {
    setLoading(true);
    setError(null);
    setSelected(new Set());
    setTableSearch("");
    try {
      const status = tab ?? activeTab;
      const [poLines, teamList] = await Promise.all([
        pmApi.listPOIntakeLines(status),
        pmApi.listINETTeams(),
      ]);
      setRows(Array.isArray(poLines) ? poLines : []);
      setTeams(Array.isArray(teamList) ? teamList : []);
    } catch (err) {
      setError(err.message || "Failed to load data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(activeTab); }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  function switchTab(tab) { setActiveTab(tab); setSelected(new Set()); }

  function toggleRow(name) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  const filtered = rows.filter(r => {
    if (!tableSearch) return true;
    const q = tableSearch.toLowerCase();
    return (
      (r.poid || "").toLowerCase().includes(q) ||
      (r.po_no || "").toLowerCase().includes(q) ||
      (r.item_code || "").toLowerCase().includes(q) ||
      (r.project_code || "").toLowerCase().includes(q) ||
      (r.site_code || "").toLowerCase().includes(q)
    );
  });

  function toggleAll() {
    setSelected(selected.size === filtered.length ? new Set() : new Set(filtered.map(r => r.name)));
  }

  // ── Dispatch ─────────────────────────────────────────────────────────────
  async function handleDispatch() {
    if (!team || !targetMonth) return;
    setDispatching(true);
    try {
      const selectedLines = rows.filter(r => selected.has(r.name));
      const result = await pmApi.dispatchPOLines({ lines: selectedLines, team, target_month: targetMonth });
      const count = result?.created ?? selected.size;
      showNotice("ok", `Successfully dispatched ${count} line${count !== 1 ? "s" : ""}.`);
      setSelected(new Set());
      setShowDispatchModal(false);
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
    setConvertTeam("");
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
        new_team: convertTeam || undefined,
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
  const uniqueProjects = [...new Set(autoRows.map(r => r.project_code).filter(Boolean))];
  const showDispatched = activeTab === "Dispatched" || activeTab === "all";

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div>
      {/* ── Dispatch Modal ─────────────────────────────────── */}
      <Modal open={showDispatchModal} onClose={() => setShowDispatchModal(false)} title={`Dispatch ${selected.size} Line${selected.size !== 1 ? "s" : ""}`}>
        <div style={{ display: "grid", gap: 16, marginBottom: 24 }}>
          <div>
            <label style={labelStyle}>Assign to Team *</label>
            <select style={inputStyle} value={team} onChange={e => setTeam(e.target.value)}>
              <option value="">Select Team...</option>
              {teams.map(t => (
                <option key={t.team_id} value={t.team_id}>{t.team_name || t.team_id}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Target Month *</label>
            <input
              type="month" style={inputStyle}
              value={targetMonth} onChange={e => setTargetMonth(e.target.value)}
            />
          </div>
          <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 14px", fontSize: "0.82rem", color: "#64748b" }}>
            Selected lines: <strong>{selected.size}</strong>
            {team && (
              <span style={{ marginLeft: 10 }}>→ Team: <strong>{teams.find(t => t.team_id === team)?.team_name || team}</strong></span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button className="btn-secondary" onClick={() => setShowDispatchModal(false)}>Cancel</button>
          <button
            className="btn-primary"
            onClick={handleDispatch}
            disabled={dispatching || !team || !targetMonth}
          >
            {dispatching ? "Dispatching..." : "Confirm Dispatch"}
          </button>
        </div>
      </Modal>

      {/* ── Convert Modal ──────────────────────────────────── */}
      <Modal open={showConvertModal} onClose={() => setShowConvertModal(false)} title="Convert to Manual Dispatch">
        <p style={{ margin: "0 0 16px", color: "#64748b", fontSize: "0.88rem" }}>
          {convertScope?.scope === "project"
            ? `All Auto-dispatched lines for project "${convertScope.project_code}" will be converted to Manual.`
            : `${convertScope?.line_names?.length} selected line${convertScope?.line_names?.length !== 1 ? "s" : ""} will be converted to Manual dispatch.`}
        </p>
        <div style={{ marginBottom: 20 }}>
          <label style={labelStyle}>Re-assign to Team (optional)</label>
          <select style={inputStyle} value={convertTeam} onChange={e => setConvertTeam(e.target.value)}>
            <option value="">Keep current team</option>
            {teams.map(t => <option key={t.team_id} value={t.team_id}>{t.team_name || t.team_id}</option>)}
          </select>
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button className="btn-secondary" onClick={() => setShowConvertModal(false)}>Cancel</button>
          <button className="btn-primary" onClick={handleConvert}>Convert to Manual</button>
        </div>
      </Modal>

      {/* ── Header ─────────────────────────────────────────── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">PO Dispatch</h1>
          <div className="page-subtitle">Manage PO line dispatch to field teams</div>
        </div>
        <div className="page-actions">
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
        {/* Search filter */}
        <input
          type="search"
          placeholder="Filter by POID, PO No, Item, Project, DUID..."
          value={tableSearch}
          onChange={e => setTableSearch(e.target.value)}
          style={{ padding: "7px 12px", borderRadius: 7, border: "1px solid #e2e8f0", fontSize: "0.84rem", minWidth: 280 }}
        />

        <div style={{ flex: 1 }} />

        {/* Dispatched tab: auto-convert buttons */}
        {activeTab === "Dispatched" && autoRows.length > 0 && (
          <>
            {uniqueProjects.map(proj => (
              <button key={proj} className="btn-secondary" style={{ fontSize: "0.8rem" }}
                onClick={() => openConvertModal("project", [], proj)} disabled={converting}>
                Convert All "{proj}" → Manual
              </button>
            ))}
            {selected.size > 0 && (
              <button className="btn-secondary" style={{ fontSize: "0.8rem", borderColor: "#8b5cf6", color: "#7c3aed" }}
                onClick={() => openConvertModal("lines", [...selected], null)} disabled={converting}>
                Convert {selected.size} → Manual
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
              onClick={() => setShowDispatchModal(true)}
              disabled={selected.size === 0}
            >
              Dispatch Selected ({selected.size})
            </button>
          </>
        )}
      </div>

      {/* Table */}
      <div className="page-content">
        {error && <div className="notice error" style={{ marginBottom: 16 }}><span>!</span> {error}</div>}

        <div className="data-table-wrapper">
          {loading ? (
            <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)" }}>Loading PO lines...</div>
          ) : filtered.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📋</div>
              <h3>{tableSearch ? "No results match filter" : activeTab === "New" ? "No lines pending dispatch" : "No records"}</h3>
              <p>{tableSearch ? "Try a different search term." : activeTab === "New" ? "All PO lines have been dispatched." : "No records in this view."}</p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}>
                    <input type="checkbox"
                      checked={selected.size === filtered.length && filtered.length > 0}
                      onChange={toggleAll}
                    />
                  </th>
                  <th>POID</th>
                  <th>PO No</th>
                  <th>Shipment No</th>
                  <th>Item Code</th>
                  <th>Description</th>
                  <th style={{ textAlign: "right" }}>Qty</th>
                  <th style={{ textAlign: "right" }}>Rate</th>
                  <th style={{ textAlign: "right" }}>Amount</th>
                  <th>Project</th>
                  <th>DUID</th>
                  <th>Area</th>
                  {showDispatched && (
                    <>
                      <th>Mode</th>
                      <th>IM</th>
                      <th>Team</th>
                      <th>Target Month</th>
                    </>
                  )}
                  {activeTab === "Dispatched" && <th>Action</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map(row => {
                  const isAuto = row.dispatch_mode === "Auto";
                  return (
                    <tr key={row.name}
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
                      <td style={{ whiteSpace: "nowrap" }}>{row.po_no}</td>
                      <td>{row.shipment_number}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{row.item_code}</td>
                      <td style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.item_description}</td>
                      <td style={{ textAlign: "right" }}>{row.qty}</td>
                      <td style={{ textAlign: "right" }}>{fmt.format(row.rate || 0)}</td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{fmtAmt.format(row.line_amount || 0)}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{row.project_code}</td>
                      <td>{row.site_code}</td>
                      <td>{row.area}</td>
                      {showDispatched && (
                        <>
                          <td><DispatchModeBadge mode={row.dispatch_mode} /></td>
                          <td style={{ fontSize: "0.82rem", whiteSpace: "nowrap" }}>{row.dispatched_im || "—"}</td>
                          <td style={{ fontSize: "0.82rem", whiteSpace: "nowrap" }}>{row.dispatched_team || "—"}</td>
                          <td style={{ fontSize: "0.82rem", whiteSpace: "nowrap" }}>
                            {row.dispatch_target_month
                              ? new Date(row.dispatch_target_month).toLocaleDateString("en", { month: "short", year: "numeric" })
                              : "—"}
                          </td>
                        </>
                      )}
                      {activeTab === "Dispatched" && (
                        <td onClick={e => e.stopPropagation()}>
                          {isAuto && (
                            <button className="btn-secondary"
                              style={{ fontSize: "0.73rem", padding: "3px 10px", whiteSpace: "nowrap" }}
                              onClick={() => openConvertModal("lines", [row.name], row.project_code)}
                              disabled={converting}>
                              → Manual
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={showDispatched ? (activeTab === "Dispatched" ? 17 : 16) : 13}
                    style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", fontSize: "0.8rem", color: "#64748b" }}>
                    <strong>{filtered.length}</strong> row{filtered.length !== 1 ? "s" : ""}
                    {tableSearch && rows.length !== filtered.length && ` (filtered from ${rows.length})`}
                    {activeTab === "Dispatched" && autoRows.length > 0 && (
                      <span style={{ marginLeft: 16, color: "#6366f1", fontWeight: 600 }}>
                        Auto: {autoRows.length} · Manual: {rows.length - autoRows.length}
                      </span>
                    )}
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
