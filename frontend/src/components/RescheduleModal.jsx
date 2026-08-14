import { useState } from "react";
import { pmApi } from "../services/api";

const REASONS = [
  "TL Not Attended",
  "Execution Cancelled",
  "Execution Postponed",
  "Execution on Hold",
  "Plan Overdue",
  "Other",
];

function tomorrowStr() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split("T")[0];
}

/**
 * rolloutPlans: string[]  — one or more Rollout Plan names to reschedule
 * defaultReason: string   — pre-selected reason (auto-derived from status)
 * onSuccess(results): called with array of {plan, ok, error} after all complete
 * onClose(): called on cancel
 */
export default function RescheduleModal({ rolloutPlans, defaultReason = "", onSuccess, onClose }) {
  const plans = Array.isArray(rolloutPlans) ? rolloutPlans : [rolloutPlans].filter(Boolean);
  const minDate = tomorrowStr();
  const [newDate, setNewDate] = useState(minDate);
  // Defaults to New Date (single-day reschedule, the common case) and keeps
  // following it as long as the IM hasn't explicitly touched End Date. Once
  // touched, it stops auto-following so a deliberate multi-day span sticks.
  const [newEndDate, setNewEndDate] = useState(minDate);
  const [endDateTouched, setEndDateTouched] = useState(false);
  const [reason, setReason] = useState(defaultReason || "");
  const [imNote, setImNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  function handleNewDateChange(v) {
    setNewDate(v);
    if (!endDateTouched) setNewEndDate(v);
  }

  async function submit() {
    if (!newDate) { setErr("Please select a new date."); return; }
    if (newEndDate && newEndDate < newDate) { setErr("New end date cannot be before the new date."); return; }
    if (!reason) { setErr("Please select a reason."); return; }
    setBusy(true);
    setErr(null);
    const results = [];
    for (const plan of plans) {
      try {
        const res = await pmApi.rescheduleRolloutPlan(plan, newDate, reason, imNote, newEndDate || newDate);
        results.push({ plan, ok: true, reschedule_count: res?.reschedule_count });
      } catch (e) {
        results.push({ plan, ok: false, error: e.message || "Failed" });
      }
    }
    setBusy(false);
    onSuccess && onSuccess(results);
  }

  const title = plans.length > 1 ? `Reschedule ${plans.length} Plans` : "Reschedule Plan";

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={() => !busy && onClose()}
    >
      <div
        style={{ background: "#fff", borderRadius: 12, padding: 24, width: "min(440px, 96vw)", boxShadow: "0 20px 60px rgba(0,0,0,0.22)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: "0 0 4px", fontSize: "1rem" }}>{title}</h3>
        {plans.length > 1 && (
          <p style={{ margin: "0 0 12px", fontSize: "0.75rem", color: "#64748b" }}>
            All selected plans will be moved to the same new date.
          </p>
        )}
        {plans.length === 1 && (
          <p style={{ margin: "0 0 12px", fontSize: "0.8rem", color: "#64748b" }}>{plans[0]}</p>
        )}

        {err && <div className="notice error" style={{ marginBottom: 12 }}>{err}</div>}

        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: "0.78rem", fontWeight: 600, color: "#475569", display: "block", marginBottom: 4 }}>New Date *</label>
          <input
            type="date"
            value={newDate}
            min={minDate}
            onChange={(e) => handleNewDateChange(e.target.value)}
            style={{ width: "100%", padding: "7px 10px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem", boxSizing: "border-box" }}
          />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: "0.78rem", fontWeight: 600, color: "#475569", display: "block", marginBottom: 4 }}>New End Date</label>
          <input
            type="date"
            value={newEndDate}
            min={newDate || minDate}
            onChange={(e) => { setEndDateTouched(true); setNewEndDate(e.target.value); }}
            style={{ width: "100%", padding: "7px 10px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem", boxSizing: "border-box" }}
          />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: "0.78rem", fontWeight: 600, color: "#475569", display: "block", marginBottom: 4 }}>Reason *</label>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            style={{ width: "100%", padding: "7px 10px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem" }}
          >
            <option value="">— Select reason —</option>
            {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: "0.78rem", fontWeight: 600, color: "#475569", display: "block", marginBottom: 4 }}>IM Note (optional)</label>
          <textarea
            value={imNote}
            onChange={(e) => setImNote(e.target.value)}
            rows={3}
            placeholder="Any additional notes…"
            style={{ width: "100%", padding: "7px 10px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem", resize: "vertical", boxSizing: "border-box", fontFamily: "inherit" }}
          />
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" disabled={busy} onClick={submit} style={{ background: "#2563eb" }}>
            {busy ? "Rescheduling…" : plans.length > 1 ? `Reschedule All (${plans.length})` : "Confirm Reschedule"}
          </button>
        </div>
      </div>
    </div>
  );
}
