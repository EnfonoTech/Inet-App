import { useEffect, useMemo, useState } from "react";
import { pmApi } from "../../services/api";
import { EXECUTION_STATUS_OPTIONS } from "../../constants/executionStatuses";
import { defaultAchievedQtyFromPlan } from "../../utils/planDefaultQty";

/**
 * Minimal bulk-execution modal. Only two fields — status (required) and
 * remarks (optional). Submits the same status to every selected eligible
 * plan. No per-plan list, no achieved qty, no GPS/photos — those belong to
 * the detailed field Execution screen.
 */
export default function IMPlanningExecutionModal({ open, onClose, selectedPlans, onSubmitted }) {
  const plans = useMemo(() => Array.isArray(selectedPlans) ? selectedPlans : [], [selectedPlans]);

  const [execStatus, setExecStatus] = useState("In Progress");
  const [remarks, setRemarks] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [progress, setProgress] = useState({ done: 0, total: 0, failed: 0 });

  useEffect(() => {
    if (!open) {
      setExecStatus("In Progress");
      setRemarks("");
      setSubmitError(null);
      setProgress({ done: 0, total: 0, failed: 0 });
    }
  }, [open]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (plans.length === 0) {
      setSubmitError("No plans selected.");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    setProgress({ done: 0, total: plans.length, failed: 0 });
    const failures = [];
    try {
      for (let i = 0; i < plans.length; i += 1) {
        const p = plans[i];
        // Auto-fill achieved qty from the plan's own data so the execution
        // isn't recorded at 0 just because this popup doesn't collect a qty.
        const defaultQty = parseFloat(defaultAchievedQtyFromPlan(p)) || 0;
        try {
          await pmApi.updateExecution({
            rollout_plan: p.name,
            execution_status: execStatus,
            achieved_qty: defaultQty,
            remarks: remarks || undefined,
          });
        } catch (err) {
          failures.push({ plan: p.name, error: err?.message || "Failed" });
        }
        setProgress({ done: i + 1, total: plans.length, failed: failures.length });
      }
      if (failures.length === 0) {
        onSubmitted?.();
        onClose();
      } else {
        const sample = failures.slice(0, 3).map((f) => `${f.plan}: ${f.error}`).join(" · ");
        setSubmitError(
          `${failures.length} of ${plans.length} plan(s) failed. ${sample}${failures.length > 3 ? " …" : ""}`,
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        background: "rgba(15,23,42,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={submitting ? undefined : onClose}
      onKeyDown={(ev) => ev.key === "Escape" && !submitting && onClose()}
      role="presentation"
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 12,
          padding: 18,
          width: "min(440px, 100%)",
          boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)",
        }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="im-exec-modal-title"
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 id="im-exec-modal-title" style={{ margin: 0, fontSize: "1rem" }}>
            Record execution <span style={{ color: "#64748b", fontWeight: 500 }}>· {plans.length} plan{plans.length !== 1 ? "s" : ""}</span>
          </h3>
          <button type="button" onClick={onClose} disabled={submitting} style={{ background: "none", border: "none", fontSize: 22, cursor: submitting ? "not-allowed" : "pointer", color: "#94a3b8", lineHeight: 1 }} aria-label="Close">
            &times;
          </button>
        </div>

        {plans.length === 0 ? (
          <div className="notice info">
            <span>ℹ</span> No eligible plans selected.
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="form-group" style={{ marginBottom: 10 }}>
              <label>New status *</label>
              <select value={execStatus} onChange={(e) => setExecStatus(e.target.value)} required disabled={submitting}>
                {EXECUTION_STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 10 }}>
              <label>Remarks (optional)</label>
              <input type="text" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Shared note across all plans…" disabled={submitting} />
            </div>

            {submitting && (
              <div style={{ fontSize: "0.82rem", color: "#64748b", marginBottom: 10 }}>
                Saving {progress.done} / {progress.total}{progress.failed > 0 ? ` · ${progress.failed} failed` : ""}
              </div>
            )}

            {submitError && (
              <div className="notice error" style={{ marginBottom: 10, fontSize: "0.82rem" }}>
                <span>!</span> {submitError}
              </div>
            )}

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={submitting}>
                {submitting ? `Saving… ${progress.done}/${progress.total}` : `Record execution (${plans.length})`}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
