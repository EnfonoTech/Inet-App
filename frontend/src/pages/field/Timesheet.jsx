import { useEffect, useState } from "react";
import { pmApi } from "../../services/api";
import { useAuth } from "../../context/AuthContext";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });
const TIMER_KEY = "inet_field_ts_timer";

function toLocalDatetimeValue(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function Timesheet() {
  const { teamId } = useAuth();
  const [timesheets, setTimesheets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [activityType, setActivityType] = useState("Execution");
  const [fromTime, setFromTime] = useState("");
  const [toTime, setToTime] = useState("");
  const [hours, setHours] = useState("");
  const [project, setProject] = useState("");
  const [description, setDescription] = useState("");
  const [projects, setProjects] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [timerStart, setTimerStart] = useState(() => sessionStorage.getItem(TIMER_KEY));
  const [, forceTick] = useState(0);

  useEffect(() => {
    if (!timerStart) return;
    const id = setInterval(() => forceTick((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, [timerStart]);

  function elapsedLabel() {
    if (!timerStart) return "00:00:00";
    const sec = Math.max(0, Math.floor((Date.now() - new Date(timerStart).getTime()) / 1000));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function startTimer() {
    const iso = new Date().toISOString();
    sessionStorage.setItem(TIMER_KEY, iso);
    setTimerStart(iso);
  }

  function stopTimer() {
    if (!timerStart) return;
    const start = new Date(timerStart);
    const end = new Date();
    sessionStorage.removeItem(TIMER_KEY);
    setTimerStart(null);
    setFromTime(toLocalDatetimeValue(start));
    setToTime(toLocalDatetimeValue(end));
    const diff = (end - start) / 3600000;
    if (diff > 0) setHours(diff.toFixed(1));
    setShowForm(true);
  }

  useEffect(() => {
    loadTimesheets();
    pmApi.listProjects({ limit: 100 }).then(res => {
      setProjects((res || []).map(p => p.project_code));
    }).catch(() => {});
  }, []);

  async function loadTimesheets() {
    setLoading(true);
    try {
      const res = await pmApi.listTimesheets({ team: teamId, include_log_bounds: true });
      setTimesheets(res || []);
    } catch {
      setTimesheets([]);
    } finally {
      setLoading(false);
    }
  }

  function calcHours() {
    if (fromTime && toTime) {
      const diff = (new Date(toTime) - new Date(fromTime)) / 3600000;
      if (diff > 0) setHours(diff.toFixed(1));
    }
  }

  useEffect(() => { calcHours(); }, [fromTime, toTime]);

  function resetForm() {
    setActivityType("Execution");
    setFromTime("");
    setToTime("");
    setHours("");
    setProject("");
    setDescription("");
    setError(null);
    setSuccess(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!fromTime || !toTime || !hours) {
      setError("Please fill in start time, end time, and hours.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await pmApi.createTimesheet({
        team: teamId,
        time_logs: [{
          activity_type: activityType,
          from_time: fromTime.replace("T", " ") + ":00",
          to_time: toTime.replace("T", " ") + ":00",
          hours: parseFloat(hours),
          project: project || undefined,
          description: description,
        }],
      });
      setSuccess("Timesheet submitted successfully!");
      resetForm();
      setShowForm(false);
      loadTimesheets();
    } catch (err) {
      setError(err.message || "Failed to submit timesheet");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Timesheet</h1>
          <div className="page-subtitle">Track your daily work hours</div>
        </div>
        <div className="page-actions">
          <button className="btn-primary" onClick={() => { resetForm(); setShowForm(true); }}>
            + Log Time
          </button>
        </div>
      </div>

      {success && (
        <div className="notice success" style={{ margin: "0 0 16px" }}>
          <span>&#x2705;</span> {success}
        </div>
      )}

      <div style={{
        background: "linear-gradient(135deg,#0f172a 0%,#1e293b 100%)",
        borderRadius: "var(--radius)",
        padding: "18px 22px",
        marginBottom: 20,
        border: "1px solid rgba(99,102,241,0.35)",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 16,
      }}>
        <div>
          <div style={{ fontSize: "0.72rem", color: "#94a3b8", fontWeight: 600, marginBottom: 4 }}>LIVE TIMER (this device)</div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "1.65rem", fontWeight: 700, color: "#7dd3fc", letterSpacing: "0.04em" }}>
            {elapsedLabel()}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          {!timerStart ? (
            <button type="button" className="btn-primary" onClick={startTimer}>Start</button>
          ) : (
            <button type="button" className="btn-primary" onClick={stopTimer} style={{ background: "#dc2626", borderColor: "#dc2626" }}>Stop &amp; fill entry</button>
          )}
        </div>
        <p style={{ margin: 0, fontSize: "0.78rem", color: "#94a3b8", flex: "1 1 200px" }}>
          Start when you begin work; Stop opens the form with start/end times filled. Submit to record hours for your employee profile.
        </p>
      </div>

      {/* New Timesheet Form */}
      {showForm && (
        <div style={{
          background: "var(--bg-white)", border: "1px solid var(--border)", borderRadius: "var(--radius)",
          padding: 24, marginBottom: 20, boxShadow: "var(--shadow-sm)",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700 }}>New Time Entry</h3>
            <button onClick={() => setShowForm(false)} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "var(--text-muted)" }}>&times;</button>
          </div>

          {error && <div className="notice error" style={{ marginBottom: 12 }}><span>&oplus;</span> {error}</div>}

          <form onSubmit={handleSubmit}>
            <div className="form-grid two-col">
              <div className="form-group">
                <label>Activity Type</label>
                <select value={activityType} onChange={e => setActivityType(e.target.value)}>
                  <option value="Execution">Execution</option>
                  <option value="Planning">Planning</option>
                  <option value="Travel">Travel</option>
                  <option value="QC Inspection">QC Inspection</option>
                  <option value="Meeting">Meeting</option>
                  <option value="Training">Training</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div className="form-group">
                <label>Project</label>
                <select value={project} onChange={e => setProject(e.target.value)}>
                  <option value="">-- Optional --</option>
                  {projects.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Start Time *</label>
                <input type="datetime-local" value={fromTime} onChange={e => setFromTime(e.target.value)} required />
              </div>
              <div className="form-group">
                <label>End Time *</label>
                <input type="datetime-local" value={toTime} onChange={e => setToTime(e.target.value)} required />
              </div>
              <div className="form-group">
                <label>Hours</label>
                <input type="number" min="0" step="0.1" value={hours} onChange={e => setHours(e.target.value)} placeholder="Auto-calculated" />
              </div>
              <div className="form-group" style={{ gridColumn: "1 / -1" }}>
                <label>Description</label>
                <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="What did you work on?" rows={2} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={submitting}>
                {submitting ? "Submitting..." : "Submit Timesheet"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Timesheet List */}
      <div style={{ background: "var(--bg-white)", border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "hidden", boxShadow: "var(--shadow-sm)" }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Loading timesheets...</div>
        ) : timesheets.length === 0 ? (
          <div className="empty-state" style={{ marginTop: 20 }}>
            <div className="empty-icon">&#x1F4CB;</div>
            <h3>No timesheets yet</h3>
            <p>Click "+ Log Time" to record your work hours.</p>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Employee</th>
                <th>Date</th>
                <th>Start</th>
                <th>End</th>
                <th style={{ textAlign: "right" }}>Hours</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {timesheets.map(ts => (
                <tr key={ts.name}>
                  <td style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>{ts.name}</td>
                  <td>{ts.employee_name || "\u2014"}</td>
                  <td>{ts.start_date || "\u2014"}</td>
                  <td style={{ fontSize: 12 }}>
                    {ts.log_start ? new Date(ts.log_start).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "\u2014"}
                  </td>
                  <td style={{ fontSize: 12 }}>
                    {ts.log_end ? new Date(ts.log_end).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "\u2014"}
                  </td>
                  <td style={{ textAlign: "right", fontFamily: "'JetBrains Mono', monospace" }}>
                    {ts.total_hours != null ? fmt.format(ts.total_hours) : "\u2014"}
                  </td>
                  <td>
                    <span style={{
                      display: "inline-block", padding: "3px 10px", borderRadius: 12,
                      fontSize: 11, fontWeight: 700, textTransform: "uppercase",
                      background: ts.status === "Submitted" ? "#ecfdf5" : "#eff6ff",
                      color: ts.status === "Submitted" ? "#065f46" : "#1e40af",
                    }}>
                      {ts.status || "Draft"}
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
