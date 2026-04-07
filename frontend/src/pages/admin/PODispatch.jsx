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
      display: "inline-block",
      padding: "2px 10px",
      borderRadius: 12,
      fontSize: "0.72rem",
      fontWeight: 600,
      letterSpacing: "0.02em",
      background: isAuto ? "linear-gradient(90deg,#6366f1 0%,#8b5cf6 100%)" : "linear-gradient(90deg,#0ea5e9 0%,#06b6d4 100%)",
      color: "#fff",
      boxShadow: isAuto ? "0 1px 4px rgba(99,102,241,0.28)" : "0 1px 4px rgba(14,165,233,0.22)",
    }}>
      {isAuto ? "Auto" : "Manual"}
    </span>
  );
}

const TABS = [
  { key: "New",        label: "Pending Dispatch" },
  { key: "Dispatched", label: "Dispatched" },
  { key: "all",        label: "All Lines" },
];

export default function PODispatch() {
  const [activeTab, setActiveTab] = useState("New");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [teams, setTeams] = useState([]);

  // Manual dispatch form state
  const [selected, setSelected] = useState(new Set());
  const [team, setTeam] = useState("");
  const [targetMonth, setTargetMonth] = useState(todayMonth());
  const [dispatching, setDispatching] = useState(false);

  // Convert state
  const [converting, setConverting] = useState(false);
  const [convertProject, setConvertProject] = useState(null); // project_code being converted (project scope)
  const [convertTeam, setConvertTeam] = useState("");
  const [showConvertModal, setShowConvertModal] = useState(false);
  const [convertScope, setConvertScope] = useState(null); // { scope, line_names, project_code }

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

  function switchTab(tab) {
    setActiveTab(tab);
    setSelected(new Set());
  }

  // ── Pending tab: toggle selection ──────────────────────────────────────
  function toggleRow(name) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }
  function toggleAll() {
    setSelected(selected.size === rows.length ? new Set() : new Set(rows.map((r) => r.name)));
  }

  async function handleDispatch() {
    if (selected.size === 0 || !team || !targetMonth) return;
    setDispatching(true);
    try {
      const selectedLines = rows.filter((r) => selected.has(r.name));
      const result = await pmApi.dispatchPOLines({ lines: selectedLines, team, target_month: targetMonth });
      const count = result?.created ?? selected.size;
      showNotice("ok", `Successfully dispatched ${count} line${count !== 1 ? "s" : ""}.`);
      setSelected(new Set());
      loadData("New");
    } catch (err) {
      showNotice("err", err.message || "Dispatch failed");
    } finally {
      setDispatching(false);
    }
  }

  // ── Convert dispatch mode ───────────────────────────────────────────────
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
      const payload = {
        scope: convertScope.scope,
        line_names: convertScope.line_names,
        project_code: convertScope.project_code,
        target_mode: "Manual",
        new_team: convertTeam || undefined,
      };
      const res = await pmApi.convertDispatchMode(payload);
      const count = res?.converted ?? convertScope.line_names.length;
      showNotice("ok", `Converted ${count} dispatch record${count !== 1 ? "s" : ""} to Manual.`);
      loadData(activeTab);
    } catch (err) {
      showNotice("err", err.message || "Convert failed");
    } finally {
      setConverting(false);
    }
  }

  // ── Dispatch details per line ───────────────────────────────────────────
  const autoRows = rows.filter((r) => r.dispatch_mode === "Auto");
  const uniqueProjects = [...new Set(autoRows.map((r) => r.project_code).filter(Boolean))];

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Convert Modal */}
      {showConvertModal && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 9999,
          background: "rgba(15,23,42,0.55)", display: "flex",
          alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
            background: "#fff", borderRadius: 14, padding: "32px 36px",
            width: 440, boxShadow: "0 20px 60px rgba(0,0,0,0.22)",
          }}>
            <h3 style={{ margin: "0 0 8px", fontSize: "1.1rem", fontWeight: 700 }}>
              Convert to Manual Dispatch
            </h3>
            <p style={{ margin: "0 0 20px", color: "#64748b", fontSize: "0.88rem" }}>
              {convertScope?.scope === "project"
                ? `All Auto-dispatched lines for project "${convertScope.project_code}" will be converted to Manual.`
                : `${convertScope?.line_names?.length} selected line${convertScope?.line_names?.length !== 1 ? "s" : ""} will be converted to Manual dispatch.`}
            </p>

            <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, marginBottom: 6, color: "#374151" }}>
              Re-assign to Team (optional)
            </label>
            <select
              value={convertTeam}
              onChange={(e) => setConvertTeam(e.target.value)}
              style={{ width: "100%", marginBottom: 24, padding: "8px 12px", borderRadius: 7, border: "1px solid #e2e8f0", fontSize: "0.88rem" }}
            >
              <option value="">Keep current team</option>
              {teams.map((t) => (
                <option key={t.team_id} value={t.team_id}>
                  {t.team_name || t.team_id}
                </option>
              ))}
            </select>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="btn-secondary" onClick={() => setShowConvertModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleConvert}>Convert to Manual</button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
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
      {successMsg && (
        <div className="notice success" style={{ margin: "0 28px 12px" }}>
          <span>✓</span> {successMsg}
        </div>
      )}
      {errMsg && (
        <div className="notice error" style={{ margin: "0 28px 12px" }}>
          <span>!</span> {errMsg}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", gap: 0, margin: "0 28px 0", borderBottom: "2px solid #e2e8f0" }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => switchTab(t.key)}
            style={{
              padding: "10px 22px",
              background: "none",
              border: "none",
              borderBottom: activeTab === t.key ? "2px solid #6366f1" : "2px solid transparent",
              marginBottom: -2,
              fontWeight: activeTab === t.key ? 700 : 500,
              color: activeTab === t.key ? "#6366f1" : "#64748b",
              fontSize: "0.88rem",
              cursor: "pointer",
              transition: "color 0.15s",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Pending Tab Toolbar ─────────────────────────────── */}
      {activeTab === "New" && (
        <div className="toolbar">
          <select value={team} onChange={(e) => setTeam(e.target.value)} style={{ minWidth: 180 }}>
            <option value="">Select Team...</option>
            {teams.map((t) => (
              <option key={t.team_id} value={t.team_id}>{t.team_name || t.team_id}</option>
            ))}
          </select>

          <input
            type="month"
            value={targetMonth}
            onChange={(e) => setTargetMonth(e.target.value)}
            style={{
              background: "var(--bg-input,#f6f8fb)", border: "1px solid var(--border-medium,#e2e8f0)",
              borderRadius: "var(--radius-sm,6px)", color: "var(--text,#1e293b)",
              padding: "7px 12px", fontSize: "0.82rem",
            }}
          />
          <div style={{ flex: 1 }} />
          {selected.size > 0 && (
            <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>{selected.size} selected</span>
          )}
          <button
            className="btn-primary"
            onClick={handleDispatch}
            disabled={dispatching || selected.size === 0 || !team || !targetMonth}
          >
            {dispatching ? "Dispatching..." : "Dispatch Selected"}
          </button>
        </div>
      )}

      {/* ── Auto-Dispatched Tab Toolbar ────────────────────── */}
      {activeTab === "Dispatched" && autoRows.length > 0 && (
        <div className="toolbar" style={{ flexWrap: "wrap", gap: 10 }}>
          <span style={{ fontWeight: 600, fontSize: "0.84rem", color: "#6366f1" }}>
            {autoRows.length} Auto-dispatched line{autoRows.length !== 1 ? "s" : ""}
          </span>
          <div style={{ flex: 1 }} />
          {uniqueProjects.map((proj) => (
            <button
              key={proj}
              className="btn-secondary"
              style={{ fontSize: "0.8rem" }}
              onClick={() => openConvertModal("project", [], proj)}
              disabled={converting}
            >
              Convert All "{proj}" → Manual
            </button>
          ))}
          {selected.size > 0 && (
            <button
              className="btn-secondary"
              style={{ fontSize: "0.8rem", borderColor: "#8b5cf6", color: "#7c3aed" }}
              onClick={() => openConvertModal("lines", [...selected], null)}
              disabled={converting}
            >
              Convert {selected.size} Selected → Manual
            </button>
          )}
        </div>
      )}

      {/* Table */}
      <div className="page-content">
        {error && (
          <div className="notice error" style={{ marginBottom: 16 }}>
            <span>!</span> {error}
          </div>
        )}

        <div className="data-table-wrapper">
          {loading ? (
            <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)" }}>
              Loading PO lines...
            </div>
          ) : rows.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📋</div>
              <h3>
                {activeTab === "New" ? "No lines pending dispatch" :
                 activeTab === "Dispatched" ? "No dispatched lines" : "No PO lines found"}
              </h3>
              <p>
                {activeTab === "New"
                  ? "All PO Intake lines have been dispatched or there are no new entries."
                  : "No records match this view."}
              </p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}>
                    <input
                      type="checkbox"
                      checked={selected.size === rows.length && rows.length > 0}
                      onChange={toggleAll}
                    />
                  </th>
                  <th>POID</th>
                  <th>PO No</th>
                  <th>Shipment No</th>
                  <th>Item Code</th>
                  <th>Item Description</th>
                  <th style={{ textAlign: "right" }}>Qty</th>
                  <th style={{ textAlign: "right" }}>Rate</th>
                  <th style={{ textAlign: "right" }}>Amount</th>
                  <th>Project</th>
                  <th>DUID</th>
                  <th>Area</th>
                  {(activeTab === "Dispatched" || activeTab === "all") && (
                    <>
                      <th>Dispatch Mode</th>
                      <th>IM</th>
                      <th>Team</th>
                      <th>Target Month</th>
                    </>
                  )}
                  {activeTab === "Dispatched" && <th>Action</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const isAuto = row.dispatch_mode === "Auto";
                  return (
                    <tr
                      key={row.name}
                      className={selected.has(row.name) ? "row-selected" : ""}
                      onClick={() => toggleRow(row.name)}
                      style={{
                        cursor: "pointer",
                        background: isAuto && activeTab === "Dispatched"
                          ? "rgba(99,102,241,0.04)"
                          : undefined,
                      }}
                    >
                      <td onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selected.has(row.name)}
                          onChange={() => toggleRow(row.name)}
                        />
                      </td>
                      <td style={{ fontFamily: "monospace", fontSize: "0.8rem" }}>{row.poid}</td>
                      <td>{row.po_no}</td>
                      <td>{row.shipment_number}</td>
                      <td>{row.item_code}</td>
                      <td style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {row.item_description}
                      </td>
                      <td style={{ textAlign: "right" }}>{row.qty}</td>
                      <td style={{ textAlign: "right" }}>{fmt.format(row.rate || 0)}</td>
                      <td style={{ textAlign: "right" }}>{fmtAmt.format(row.line_amount || 0)}</td>
                      <td>{row.project_code}</td>
                      <td>{row.site_code}</td>
                      <td>{row.area}</td>
                      {(activeTab === "Dispatched" || activeTab === "all") && (
                        <>
                          <td><DispatchModeBadge mode={row.dispatch_mode} /></td>
                          <td style={{ fontSize: "0.82rem" }}>{row.dispatched_im || "—"}</td>
                          <td style={{ fontSize: "0.82rem" }}>{row.dispatched_team || "—"}</td>
                          <td style={{ fontSize: "0.82rem" }}>
                            {row.dispatch_target_month
                              ? new Date(row.dispatch_target_month).toLocaleDateString("en", { month: "short", year: "numeric" })
                              : "—"}
                          </td>
                        </>
                      )}
                      {activeTab === "Dispatched" && (
                        <td onClick={(e) => e.stopPropagation()}>
                          {isAuto && (
                            <button
                              className="btn-secondary"
                              style={{ fontSize: "0.73rem", padding: "3px 10px", whiteSpace: "nowrap" }}
                              onClick={() => openConvertModal("lines", [row.name], row.project_code)}
                              disabled={converting}
                            >
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
                  <td colSpan={activeTab === "Dispatched" ? 14 : (activeTab === "all" ? 13 : 9)}
                    style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0" }}>
                    <strong>{rows.length} row{rows.length !== 1 ? "s" : ""}</strong>
                    {activeTab === "Dispatched" && autoRows.length > 0 && (
                      <span style={{ marginLeft: 16, color: "#6366f1", fontWeight: 600, fontSize: "0.82rem" }}>
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
