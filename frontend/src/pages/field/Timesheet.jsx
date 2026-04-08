import { useEffect, useRef, useState } from "react";
import { pmApi } from "../../services/api";
import { useAuth } from "../../context/AuthContext";
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
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(v);
  }
}

export default function Timesheet() {
  const { teamId } = useAuth();
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

  useEffect(() => {
    if (!running?.log_name) return undefined;
    const id = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, [running?.log_name]);

  useEffect(() => {
    if (running?.server_time_ms != null) {
      timerSkewMsRef.current = makeSkewMs(running.server_time_ms);
    }
  }, [running?.log_name, running?.server_time_ms]);

  async function refreshRunning() {
    try {
      const r = await pmApi.getRunningExecutionTimer();
      if (r && r.log_name && r.start_time_ms != null && r.server_time_ms != null) {
        timerSkewMsRef.current = makeSkewMs(r.server_time_ms);
        setRunning(r);
      } else {
        setRunning(null);
      }
    } catch {
      setRunning(null);
    }
  }

  async function loadLogs() {
    setLoading(true);
    try {
      const res = await pmApi.listExecutionTimeLogs({}, 200, 0);
      setLogs(res?.logs || []);
      setTotal(res?.total ?? (res?.logs || []).length);
    } catch {
      setLogs([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadLogs();
    refreshRunning();
  }, [teamId]);

  useEffect(() => {
    if (!showManual) return;
    if (manualDate) return;
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
    } catch (e) {
      setError(e.message || "Stop failed");
    }
  }

  async function handleManualSubmit(e) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (!manualPlan || !manualDate || !manualStart || !manualEnd) {
      setError("Choose a rollout plan, date, start time, and end time.");
      return;
    }
    setSubmitting(true);
    try {
      const st = `${manualDate} ${manualStart}:00`;
      const et = `${manualDate} ${manualEnd}:00`;
      await pmApi.saveExecutionTimeLogManual(manualPlan, st, et, manualNotes);
      setSuccess("Time log saved.");
      setManualDate("");
      setManualStart("");
      setManualEnd("");
      setManualNotes("");
      setManualPlan("");
      setShowManual(false);
      loadLogs();
    } catch (err) {
      setError(err.message || "Save failed");
    } finally {
      setSubmitting(false);
    }
  }

  const totalHours = logs.reduce((s, r) => s + (parseFloat(r.duration_hours) || 0), 0);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Time log</h1>
          <div className="page-subtitle">Time tracked per rollout / execution</div>
        </div>
        <div className="page-actions">
          <button className="btn-primary" type="button" onClick={() => { setShowManual(true); setError(null); setSuccess(null); }}>
            + Manual entry
          </button>
        </div>
      </div>

      {success && (
        <div className="notice success" style={{ margin: "0 0 16px" }}>
          <span>&#x2705;</span> {success}
        </div>
      )}

      {running && (
        <div
          style={{
            background: "linear-gradient(135deg,#0f172a 0%,#1e293b 100%)",
            borderRadius: "var(--radius)",
            padding: "18px 22px",
            marginBottom: 20,
            border: "1px solid rgba(99,102,241,0.35)",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 16,
          }}
        >
          <div>
            <div style={{ fontSize: "0.72rem", color: "#94a3b8", fontWeight: 600, marginBottom: 4 }}>RUNNING TIMER</div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "1.65rem", fontWeight: 700, color: "#7dd3fc" }}>
              {formatElapsedSeconds(
                elapsedSecondsFromServerEpoch(running.start_time_ms, timerSkewMsRef.current)
              )}
            </div>
            <div style={{ fontSize: "0.78rem", color: "#94a3b8", marginTop: 6 }}>
              {running.rollout_plan}
              {running.item_description ? ` · ${running.item_description}` : ""}
            </div>
          </div>
          <button type="button" className="btn-primary" style={{ background: "#dc2626", borderColor: "#dc2626" }} onClick={stopRunning}>
            Stop timer
          </button>
        </div>
      )}

      {!teamId && (
        <div className="notice error" style={{ marginBottom: 16 }}>
          No team linked to your user — time logs cannot be created until your account is assigned to a field team.
        </div>
      )}

      {showManual && teamId && (
        <div
          style={{
            background: "var(--bg-white)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            padding: 24,
            marginBottom: 20,
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700 }}>Manual time entry</h3>
            <button type="button" onClick={() => setShowManual(false)} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "var(--text-muted)" }}>&times;</button>
          </div>
          {error && <div className="notice error" style={{ marginBottom: 12 }}>{error}</div>}
          <form onSubmit={handleManualSubmit}>
            <div className="form-grid two-col">
              <div className="form-group" style={{ gridColumn: "1 / -1" }}>
                <label>Rollout plan *</label>
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
                    No plans for today — open a plan from Today&apos;s Work first, or enter time from the execution screen.
                  </p>
                )}
              </div>
              <div className="form-group">
                <label>Date *</label>
                <input type="date" value={manualDate} onChange={(e) => setManualDate(e.target.value)} required />
              </div>
              <div className="form-group">
                <label>Start time *</label>
                <input type="time" value={manualStart} onChange={(e) => setManualStart(e.target.value)} required />
              </div>
              <div className="form-group">
                <label>End time *</label>
                <input type="time" value={manualEnd} onChange={(e) => setManualEnd(e.target.value)} required />
              </div>
              <div className="form-group" style={{ gridColumn: "1 / -1" }}>
                <label>Notes</label>
                <textarea value={manualNotes} onChange={(e) => setManualNotes(e.target.value)} rows={2} placeholder="Optional" />
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <button type="button" className="btn-secondary" onClick={() => setShowManual(false)}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={submitting}>
                {submitting ? "Saving…" : "Save log"}
              </button>
            </div>
          </form>
        </div>
      )}

      <div style={{ background: "var(--bg-white)", border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "hidden", boxShadow: "var(--shadow-sm)" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", fontSize: "0.82rem", color: "var(--text-muted)" }}>
          {loading ? "Loading…" : `${logs.length} of ${total} log(s) · ${fmt.format(totalHours)} h total`}
        </div>
        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Loading time logs…</div>
        ) : logs.length === 0 ? (
          <div className="empty-state" style={{ marginTop: 20 }}>
            <div className="empty-icon">&#x1F553;</div>
            <h3>No time logs yet</h3>
            <p>Use Start timer on an execution, or add a manual entry for today&apos;s rollout.</p>
          </div>
        ) : (
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
                  <td style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>{row.name}</td>
                  <td style={{ fontFamily: "monospace", fontSize: 11 }}>{row.rollout_plan}</td>
                  <td style={{ fontSize: "0.78rem", maxWidth: 200 }}>{row.item_description || row.project_code || "—"}</td>
                  <td style={{ fontSize: "0.78rem" }}>{shortDt(row.start_time)}</td>
                  <td style={{ fontSize: "0.78rem" }}>{row.is_running ? "…" : shortDt(row.end_time)}</td>
                  <td style={{ textAlign: "right", fontFamily: "'JetBrains Mono', monospace" }}>
                    {row.is_running ? "—" : fmt.format(row.duration_hours || 0)}
                  </td>
                  <td>
                    <span style={{
                      display: "inline-block",
                      padding: "3px 10px",
                      borderRadius: 12,
                      fontSize: 11,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      background: row.is_running ? "#fef3c7" : "#ecfdf5",
                      color: row.is_running ? "#92400e" : "#065f46",
                    }}
                    >
                      {row.is_running ? "Running" : "Done"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
