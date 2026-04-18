import { useEffect, useRef, useState } from "react";
import { pmApi } from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { useTableRowLimit, useResetOnRowLimitChange } from "../../context/TableRowLimitContext";
import TableRowsLimitFooter from "../../components/TableRowsLimitFooter";
import DataTableWrapper from "../../components/DataTableWrapper";
import {
  elapsedSecondsFromServerEpoch,
  formatElapsedSeconds,
  makeSkewMs,
} from "../../utils/executionTimerDisplay";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });

function shortDt(v) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch { return String(v); }
}

function timeOnly(v) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch { return String(v); }
}

function dateOnly(v) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch { return String(v); }
}

/* Mobile time log card */
function TimelogCard({ row }) {
  return (
    <div className="timelog-card">
      <div className="timelog-card-header">
        <div>
          <div className="timelog-duration" style={row.is_running ? { color: "var(--amber)" } : {}}>
            {row.is_running ? "Running…" : `${fmt.format(row.duration_hours || 0)} h`}
          </div>
          <div className="timelog-rollout">{row.rollout_plan || "—"}</div>
        </div>
        <span style={{
          display: "inline-block",
          padding: "3px 10px",
          borderRadius: 999,
          fontSize: "0.68rem",
          fontWeight: 700,
          textTransform: "uppercase",
          background: row.is_running ? "var(--amber-bg)" : "var(--green-bg)",
          color: row.is_running ? "var(--amber)" : "var(--green)",
          border: `1px solid ${row.is_running ? "var(--amber-border)" : "var(--green-border)"}`,
          flexShrink: 0,
        }}>
          {row.is_running ? "Running" : "Done"}
        </span>
      </div>
      {(row.item_description || row.project_code) && (
        <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)", marginTop: 4 }}>
          {row.item_description || row.project_code}
        </div>
      )}
      <div className="timelog-range">
        <svg viewBox="0 0 20 20" fill="currentColor" width="12" height="12" style={{ opacity: 0.4, flexShrink: 0 }}>
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd"/>
        </svg>
        <span style={{ fontSize: "0.72rem" }}>
          {dateOnly(row.start_time)} · {timeOnly(row.start_time)}
          {!row.is_running && <> → {timeOnly(row.end_time)}</>}
        </span>
      </div>
    </div>
  );
}

export default function Timesheet() {
  const { teamId } = useAuth();
  const { rowLimit } = useTableRowLimit();
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(null);
  const [, tick] = useState(0);
  const timerSkewMsRef = useRef(0);

  const [planned, setPlanned] = useState([]);
  const [manualPlan, setManualPlan] = useState("");
  const [manualDate, setManualDate] = useState("");
  const [manualStart, setManualStart] = useState("");
  const [manualEnd, setManualEnd] = useState("");
  const [manualNotes, setManualNotes] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  useResetOnRowLimitChange(() => { setLogs([]); setLoading(true); });

  useEffect(() => {
    if (!running?.log_name) return;
    const id = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, [running?.log_name]);

  useEffect(() => {
    if (running?.server_time_ms != null) timerSkewMsRef.current = makeSkewMs(running.server_time_ms);
  }, [running?.log_name, running?.server_time_ms]);

  async function refreshRunning() {
    try {
      const r = await pmApi.getRunningExecutionTimer();
      if (r?.log_name && r.start_time_ms != null && r.server_time_ms != null) {
        timerSkewMsRef.current = makeSkewMs(r.server_time_ms);
        setRunning(r);
      } else { setRunning(null); }
    } catch { setRunning(null); }
  }

  async function loadLogs() {
    setLoading(true);
    try {
      const res = await pmApi.listExecutionTimeLogs({}, rowLimit, 0);
      setLogs(res?.logs || []);
      setTotal(res?.total ?? (res?.logs || []).length);
    } catch { setLogs([]); setTotal(0); }
    finally { setLoading(false); }
  }

  useEffect(() => { loadLogs(); refreshRunning(); }, [teamId, rowLimit]);

  useEffect(() => {
    if (!showManual || manualDate) return;
    const today = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    setManualDate(`${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`);
  }, [showManual, manualDate]);

  useEffect(() => {
    if (!teamId) return;
    pmApi.getFieldTeamDashboard(teamId).then((r) => {
      const items = r?.planned ?? r?.plans ?? [];
      setPlanned(Array.isArray(items) ? items : []);
    }).catch(() => setPlanned([]));
  }, [teamId]);

  async function stopRunning() {
    if (!running?.log_name) return;
    setError(null);
    try {
      await pmApi.stopExecutionTimer(running.log_name);
      setRunning(null);
      window.dispatchEvent(new Event("inet-timer-changed"));
      loadLogs();
    } catch (e) { setError(e.message || "Stop failed"); }
  }

  async function handleManualSubmit(e) {
    e.preventDefault();
    setError(null); setSuccess(null);
    if (!manualPlan || !manualDate || !manualStart || !manualEnd) {
      setError("Choose a rollout plan, date, start time, and end time.");
      return;
    }
    setSubmitting(true);
    try {
      await pmApi.saveExecutionTimeLogManual(
        manualPlan,
        `${manualDate} ${manualStart}:00`,
        `${manualDate} ${manualEnd}:00`,
        manualNotes
      );
      setSuccess("Time log saved.");
      setManualDate(""); setManualStart(""); setManualEnd("");
      setManualNotes(""); setManualPlan(""); setShowManual(false);
      loadLogs();
    } catch (err) { setError(err.message || "Save failed"); }
    finally { setSubmitting(false); }
  }

  const totalHours = logs.reduce((s, r) => s + (parseFloat(r.duration_hours) || 0), 0);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Time Log</h1>
          <div className="page-subtitle">Time tracked per rollout / execution</div>
        </div>
        <div className="page-actions">
          <button className="btn-primary btn-sm" type="button" onClick={() => { setShowManual(true); setError(null); setSuccess(null); }}>
            + Manual entry
          </button>
        </div>
      </div>

      {success && (
        <div className="notice success" style={{ margin: "0 16px 12px", display: "flex", gap: 8 }}>
          <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg>
          {success}
        </div>
      )}

      {!teamId && (
        <div className="notice error" style={{ margin: "0 16px 12px" }}>
          No team linked — time logs cannot be created until your account is assigned to a field team.
        </div>
      )}

      {/* ── Running timer card ──────────────────────────────── */}
      {running && (
        <div style={{ padding: "0 14px 12px" }}>
          <div className="field-running-timer-card">
            <div className="field-running-timer-info">
              <div className="field-running-timer-label">
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#ef4444", animation: "timer-pulse 1.2s ease-in-out infinite", display: "inline-block" }} />
                Running Timer
              </div>
              <div className="field-running-timer-clock">
                {formatElapsedSeconds(
                  elapsedSecondsFromServerEpoch(running.start_time_ms, timerSkewMsRef.current)
                )}
              </div>
              <div className="field-running-timer-plan">
                {running.rollout_plan}
                {running.item_description ? ` · ${running.item_description}` : ""}
              </div>
            </div>
            <button
              type="button"
              style={{
                background: "#dc2626", border: "none", borderRadius: "var(--radius)",
                color: "#fff", padding: "10px 16px", fontWeight: 700, fontSize: "0.85rem",
                cursor: "pointer", flexShrink: 0,
              }}
              onClick={stopRunning}
            >
              Stop
            </button>
          </div>
        </div>
      )}

      {/* ── Manual entry form ───────────────────────────────── */}
      {showManual && teamId && (
        <div style={{ padding: "0 14px 12px" }}>
          <div className="exec-section">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div className="exec-section-title" style={{ marginBottom: 0 }}>Manual Time Entry</div>
              <button
                type="button"
                onClick={() => setShowManual(false)}
                style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "var(--text-muted)", lineHeight: 1, padding: 0 }}
              >
                ×
              </button>
            </div>
            {error && <div className="notice error" style={{ marginBottom: 12 }}>{error}</div>}
            <form onSubmit={handleManualSubmit}>
              <div className="exec-field">
                <label>Rollout Plan *</label>
                <select value={manualPlan} onChange={(e) => setManualPlan(e.target.value)} required>
                  <option value="">— Select —</option>
                  {planned.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name} · {p.item_description || p.item_code || "Work"}
                    </option>
                  ))}
                </select>
                {planned.length === 0 && (
                  <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: 6 }}>
                    No plans for today — open a plan from Today's Work first.
                  </p>
                )}
              </div>
              <div className="exec-field">
                <label>Date *</label>
                <input type="date" value={manualDate} onChange={(e) => setManualDate(e.target.value)} required />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div className="exec-field">
                  <label>Start Time *</label>
                  <input type="time" value={manualStart} onChange={(e) => setManualStart(e.target.value)} required />
                </div>
                <div className="exec-field">
                  <label>End Time *</label>
                  <input type="time" value={manualEnd} onChange={(e) => setManualEnd(e.target.value)} required />
                </div>
              </div>
              <div className="exec-field">
                <label>Notes</label>
                <textarea value={manualNotes} onChange={(e) => setManualNotes(e.target.value)} rows={2} placeholder="Optional" />
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button type="button" className="btn-secondary" style={{ flex: 1, minHeight: 44 }} onClick={() => setShowManual(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" style={{ flex: 2, minHeight: 44 }} disabled={submitting}>
                  {submitting ? "Saving…" : "Save Log"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Log summary header ──────────────────────────────── */}
      {!loading && logs.length > 0 && (
        <div style={{ padding: "0 14px 8px" }}>
          <div style={{
            padding: "10px 14px",
            background: "var(--bg-white)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: "0.8rem",
          }}>
            <span style={{ color: "var(--text-muted)" }}>{logs.length} of {total} log{total !== 1 ? "s" : ""}</span>
            <span style={{ fontFamily: "monospace", fontWeight: 700, color: "var(--blue)" }}>
              {fmt.format(totalHours)} h total
            </span>
          </div>
        </div>
      )}

      {/* ── Mobile card list ──────────────────────────────────── */}
      <div className="field-mobile-only">
        {loading ? (
          <div className="field-card-list">
            {[1, 2, 3].map((i) => (
              <div key={i} className="timelog-card">
                <div className="skeleton-line" style={{ width: "30%", height: 20, marginBottom: 6 }} />
                <div className="skeleton-line" style={{ width: "60%", height: 11, marginBottom: 10 }} />
                <div className="skeleton-line" style={{ width: "50%", height: 10 }} />
              </div>
            ))}
          </div>
        ) : logs.length === 0 ? (
          <div className="empty-state" style={{ marginTop: 20 }}>
            <div className="empty-icon">⏱</div>
            <h3>No time logs yet</h3>
            <p>Use Start Timer on an execution, or add a manual entry.</p>
          </div>
        ) : (
          <div className="field-card-list">
            {logs.map((row) => <TimelogCard key={row.name} row={row} />)}
          </div>
        )}
      </div>

      {/* ── Desktop table ─────────────────────────────────────── */}
      <div className="page-content field-desktop-only">
        <div style={{ background: "var(--bg-white)", border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "hidden", boxShadow: "var(--shadow-sm)" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", fontSize: "0.82rem", color: "var(--text-muted)" }}>
            {loading ? "Loading…" : `${logs.length} of ${total} log(s) · ${fmt.format(totalHours)} h total`}
          </div>
          {loading ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Loading time logs…</div>
          ) : logs.length === 0 ? (
            <div className="empty-state" style={{ marginTop: 20 }}>
              <div className="empty-icon">⏱</div>
              <h3>No time logs yet</h3>
              <p>Use Start timer on an execution, or add a manual entry.</p>
            </div>
          ) : (
            <DataTableWrapper className="data-table-wrapper--nested">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Rollout</th>
                    <th>Work</th>
                    <th>Start</th>
                    <th>End</th>
                    <th style={{ textAlign: "right" }}>Hours</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((row) => (
                    <tr key={row.name}>
                      <td style={{ fontFamily: "monospace", fontSize: 11 }}>{row.name}</td>
                      <td style={{ fontFamily: "monospace", fontSize: 11 }}>{row.rollout_plan}</td>
                      <td style={{ fontSize: "0.78rem", maxWidth: 200 }}>{row.item_description || row.project_code || "—"}</td>
                      <td style={{ fontSize: "0.78rem" }}>{shortDt(row.start_time)}</td>
                      <td style={{ fontSize: "0.78rem" }}>{row.is_running ? "…" : shortDt(row.end_time)}</td>
                      <td style={{ textAlign: "right", fontFamily: "monospace" }}>
                        {row.is_running ? "—" : fmt.format(row.duration_hours || 0)}
                      </td>
                      <td>
                        <span style={{
                          display: "inline-block", padding: "3px 10px", borderRadius: 12,
                          fontSize: 11, fontWeight: 700, textTransform: "uppercase",
                          background: row.is_running ? "var(--amber-bg)" : "var(--green-bg)",
                          color: row.is_running ? "var(--amber)" : "var(--green)",
                        }}>
                          {row.is_running ? "Running" : "Done"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DataTableWrapper>
          )}
          <TableRowsLimitFooter placement="tableCard" loadedCount={logs.length} />
        </div>
      </div>
    </div>
  );
}
