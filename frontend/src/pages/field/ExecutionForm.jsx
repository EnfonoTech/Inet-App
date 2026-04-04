import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { pmApi } from "../../services/api";

const EXECUTION_STATUSES = [
  "In Progress",
  "Completed",
  "Hold",
  "Cancelled",
  "Postponed",
];

function DetailRow({ label, value }) {
  if (!value) return null;
  return (
    <div className="detail-row">
      <div className="detail-label">{label}</div>
      <div className="detail-value">{value}</div>
    </div>
  );
}

export default function ExecutionForm() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [plan, setPlan] = useState(null);
  const [loadingPlan, setLoadingPlan] = useState(true);
  const [planError, setPlanError] = useState(null);

  // Form state
  const [execStatus, setExecStatus] = useState("In Progress");
  const [achievedQty, setAchievedQty] = useState("");
  const [gpsLocation, setGpsLocation] = useState("");
  const [remarks, setRemarks] = useState("");
  const [capturingGps, setCapturingGps] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    async function loadPlan() {
      setPlanError(null);
      try {
        // Load from rollout plans list filtered by name
        const list = await pmApi.listRolloutPlans({ name: id });
        const found = Array.isArray(list) && list.length > 0 ? list[0] : null;
        if (!found) throw new Error("Plan not found");
        setPlan(found);
      } catch (err) {
        setPlanError(err.message || "Could not load plan details");
      } finally {
        setLoadingPlan(false);
      }
    }
    if (id) loadPlan();
  }, [id]);

  function captureGPS() {
    if (!navigator.geolocation) {
      setGpsLocation("GPS not supported on this device");
      return;
    }
    setCapturingGps(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        setGpsLocation(`${latitude.toFixed(6)}, ${longitude.toFixed(6)} (±${Math.round(accuracy)}m)`);
        setCapturingGps(false);
      },
      (err) => {
        setGpsLocation(`GPS error: ${err.message}`);
        setCapturingGps(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError(null);

    try {
      const payload = {
        rollout_plan: id,
        execution_status: execStatus,
        achieved_qty: parseFloat(achievedQty) || 0,
        gps_location: gpsLocation,
        remarks,
      };

      const execResult = await pmApi.updateExecution(payload);
      const executionName = execResult?.name || execResult;

      // If completed, generate Work Done record
      if (execStatus === "Completed" && executionName) {
        try {
          await pmApi.generateWorkDone(executionName);
        } catch (wdErr) {
          console.warn("Work Done generation failed:", wdErr);
          // Don't fail the whole submission for this
        }
      }

      setSuccess(true);
    } catch (err) {
      setSubmitError(err.message || "Failed to submit execution update");
    } finally {
      setSubmitting(false);
    }
  }

  if (loadingPlan) {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-title">Execution Form</h1>
        </div>
        <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)" }}>
          Loading plan details…
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-title">Execution Submitted</h1>
        </div>
        <div className="page-content">
          <div className="notice success" style={{ marginBottom: 20 }}>
            <span>✅</span> Execution update submitted successfully!
            {execStatus === "Completed" && " Work Done record has been generated."}
          </div>
          <button className="btn-primary" onClick={() => navigate("/today")}>
            Back to Today's Work
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Execution Form</h1>
          <div className="page-subtitle" style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>
            {id}
          </div>
        </div>
        <div className="page-actions">
          <button className="btn-secondary" onClick={() => navigate("/today")}>
            ← Back
          </button>
        </div>
      </div>

      <div className="page-content" style={{ maxWidth: 720 }}>
        {planError && (
          <div className="notice error" style={{ marginBottom: 16 }}>
            <span>⚠</span> {planError}
          </div>
        )}

        {/* Plan Details */}
        {plan && (
          <div className="detail-panel" style={{ marginBottom: 20 }}>
            <div style={{
              fontSize: "0.72rem",
              fontWeight: 700,
              color: "var(--text-label)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 12,
            }}>
              Plan Details
            </div>
            <DetailRow label="Plan Date" value={plan.plan_date} />
            <DetailRow label="Visit Type" value={plan.visit_type} />
            <DetailRow label="Team" value={plan.team} />
            <DetailRow label="Project" value={plan.project_code} />
            <DetailRow label="Item Code" value={plan.item_code} />
            <DetailRow label="Status" value={plan.plan_status} />
          </div>
        )}

        {/* Execution Form */}
        <form onSubmit={handleSubmit}>
          <div className="form-grid two-col">
            {/* Execution Status */}
            <div className="form-group">
              <label>Execution Status *</label>
              <select
                value={execStatus}
                onChange={(e) => setExecStatus(e.target.value)}
                required
              >
                {EXECUTION_STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            {/* Achieved Qty */}
            <div className="form-group">
              <label>Achieved Qty</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={achievedQty}
                onChange={(e) => setAchievedQty(e.target.value)}
                placeholder="0"
              />
            </div>

            {/* GPS Location */}
            <div className="form-group" style={{ gridColumn: "1 / -1" }}>
              <label>GPS Location</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="text"
                  value={gpsLocation}
                  onChange={(e) => setGpsLocation(e.target.value)}
                  placeholder="lat, lng — or click Capture GPS"
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={captureGPS}
                  disabled={capturingGps}
                  style={{ whiteSpace: "nowrap" }}
                >
                  {capturingGps ? "Getting GPS…" : "Capture GPS"}
                </button>
              </div>
            </div>

            {/* Remarks */}
            <div className="form-group" style={{ gridColumn: "1 / -1" }}>
              <label>Remarks</label>
              <textarea
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Any notes about this execution…"
                rows={3}
              />
            </div>
          </div>

          {submitError && (
            <div className="notice error" style={{ marginBottom: 12 }}>
              <span>⚠</span> {submitError}
            </div>
          )}

          {execStatus === "Completed" && (
            <div className="notice info" style={{ marginBottom: 12 }}>
              <span>ℹ</span> Submitting as Completed will automatically generate a Work Done record.
            </div>
          )}

          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => navigate("/today")}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={submitting}
            >
              {submitting ? "Submitting…" : "Submit Execution"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
