import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { pmApi } from "../../services/api";
import { fetchPortalSession, getCsrf } from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import {
  elapsedSecondsFromServerEpoch,
  formatElapsedSeconds,
  makeSkewMs,
} from "../../utils/executionTimerDisplay";
import { defaultAchievedQtyFromPlan } from "../../utils/planDefaultQty";

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

function parsePhotoList(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean).map((v) => String(v).trim()).filter(Boolean);
  const text = String(raw).trim();
  if (!text) return [];
  if (text.startsWith("[")) {
    try {
      const arr = JSON.parse(text);
      if (Array.isArray(arr)) return arr.filter(Boolean).map((v) => String(v).trim()).filter(Boolean);
    } catch {
      // fallback to newline parsing
    }
  }
  return text.split(/\r?\n|,/).map((v) => v.trim()).filter(Boolean);
}

function buildUploadForm(file) {
  const form = new FormData();
  form.append("file", file, file.name);
  form.append("is_private", "1");
  form.append("folder", "Home");
  return form;
}

export default function ExecutionForm() {
  const { id: idParam } = useParams();
  const id = idParam ? decodeURIComponent(idParam) : undefined;
  const navigate = useNavigate();
  const { teamId, role } = useAuth();
  const isFieldPortal = role === "field";

  const [inExecPlans, setInExecPlans] = useState([]);
  const [loadingInExec, setLoadingInExec] = useState(false);
  const [inExecError, setInExecError] = useState(null);

  const [plan, setPlan] = useState(null);
  const [loadingPlan, setLoadingPlan] = useState(true);
  const [planError, setPlanError] = useState(null);

  // Form state
  const [execStatus, setExecStatus] = useState("In Progress");
  const [achievedQty, setAchievedQty] = useState("");
  const [gpsLocation, setGpsLocation] = useState("");
  const [remarks, setRemarks] = useState("");
  const [activityCode, setActivityCode] = useState("");
  const [activityCost, setActivityCost] = useState(null);
  const [activities, setActivities] = useState([]);
  const [capturingGps, setCapturingGps] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [submittedPlanStatus, setSubmittedPlanStatus] = useState(null);

  const [runningHere, setRunningHere] = useState(null);
  const [runningElsewhere, setRunningElsewhere] = useState(null);
  const [timerBusy, setTimerBusy] = useState(false);
  const [timerError, setTimerError] = useState(null);
  const [, timerTick] = useState(0);
  const timerSkewMsRef = useRef(0);

  const [existingExec, setExistingExec] = useState(null);
  const [attachments, setAttachments] = useState([]);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [attachmentErr, setAttachmentErr] = useState(null);

  useEffect(() => {
    const iv = setInterval(() => timerTick((x) => x + 1), 1000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    const src = runningHere || runningElsewhere;
    if (src?.server_time_ms != null) {
      timerSkewMsRef.current = makeSkewMs(src.server_time_ms);
    }
  }, [runningHere?.log_name, runningElsewhere?.log_name, runningHere?.server_time_ms, runningElsewhere?.server_time_ms]);

  useEffect(() => {
    if (!id || !isFieldPortal || !teamId) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await pmApi.getRunningExecutionTimer();
        if (cancelled) return;
        if (!r?.log_name) {
          setRunningHere(null);
          setRunningElsewhere(null);
          return;
        }
        if (r.rollout_plan === id) {
          setRunningHere(r);
          setRunningElsewhere(null);
        } else {
          setRunningHere(null);
          setRunningElsewhere(r);
        }
      } catch {
        if (!cancelled) {
          setRunningHere(null);
          setRunningElsewhere(null);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [id, teamId, success, isFieldPortal]);

  useEffect(() => {
    async function loadPlan() {
      setPlanError(null);
      try {
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
    if (id) {
      setLoadingPlan(true);
      loadPlan();
    } else {
      setPlan(null);
      setLoadingPlan(false);
      setPlanError(null);
    }
  }, [id]);

  useEffect(() => {
    async function loadInExecution() {
      if (id) return;
      setLoadingInExec(true);
      setInExecError(null);
      try {
        let list = [];
        if (teamId) {
          list = await pmApi.listRolloutPlans({
            team: teamId,
            plan_status: "In Execution",
          });
        }
        setInExecPlans(Array.isArray(list) ? list : []);
      } catch (e) {
        setInExecPlans([]);
        setInExecError(e.message || "Could not load In Execution plans");
      } finally {
        setLoadingInExec(false);
      }
    }
    loadInExecution();
  }, [teamId, id]);

  // Load activity costs
  useEffect(() => {
    pmApi.listActivityCosts().then(res => {
      setActivities(res || []);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!id || success) {
      setExistingExec(null);
      return;
    }
    if (isFieldPortal && !teamId) {
      setExistingExec(null);
      return;
    }
    let cancelled = false;
    pmApi.getFieldExecutionForRollout(id).then((ex) => {
      if (cancelled) return;
      setExistingExec(ex || null);
      if (ex) setAttachments(parsePhotoList(ex.photos));
    }).catch(() => {
      if (!cancelled) setExistingExec(null);
    });
    return () => { cancelled = true; };
  }, [id, teamId, success, isFieldPortal]);

  useEffect(() => {
    setAchievedQty("");
  }, [id]);

  useEffect(() => {
    if (!plan || success) return;
    if (String(plan.name || "") !== String(id || "")) return;
    if (String(achievedQty || "").trim() !== "") return;
    setAchievedQty(defaultAchievedQtyFromPlan(plan));
  }, [plan, achievedQty, success, id]);

  function handleActivityChange(code) {
    setActivityCode(code);
    if (code) {
      const found = activities.find(a => a.name === code);
      setActivityCost(found ? found.base_cost_sar : null);
    } else {
      setActivityCost(null);
    }
  }

  async function uploadAttachment(file) {
    if (!file) return;
    setAttachmentBusy(true);
    setAttachmentErr(null);
    try {
      await fetchPortalSession().catch(() => {});
      let token = getCsrf();
      const doFetch = (formBody) =>
        fetch("/api/method/upload_file", {
          method: "POST",
          credentials: "include",
          headers: { "X-Frappe-CSRF-Token": token },
          body: formBody,
        });

      let res = await doFetch(buildUploadForm(file));
      let json = await res.json();
      const errText = `${json.message || ""} ${json.exc || ""}`.toLowerCase();
      if ((!res.ok || json.exc) && (errText.includes("invalid request") || errText.includes("csrf"))) {
        await fetchPortalSession().catch(() => {});
        token = getCsrf();
        res = await doFetch(buildUploadForm(file));
        json = await res.json();
      }
      if (!res.ok || json.exc) throw new Error(json.message || "Attachment upload failed");
      const fileUrl = json.message?.file_url;
      if (!fileUrl) throw new Error("No uploaded file URL received");
      setAttachments((prev) => [...prev, fileUrl]);
    } catch (err) {
      setAttachmentErr(err.message || "Attachment upload failed");
    } finally {
      setAttachmentBusy(false);
    }
  }

  async function handleStartTimer() {
    if (!id || !isFieldPortal) return;
    setTimerBusy(true);
    setTimerError(null);
    try {
      await pmApi.startExecutionTimer(id);
      window.dispatchEvent(new Event("inet-timer-changed"));
      const r = await pmApi.getRunningExecutionTimer();
      if (r?.rollout_plan === id) {
        setRunningHere(r);
        setRunningElsewhere(null);
      }
    } catch (e) {
      setTimerError(e.message || "Could not start timer");
    } finally {
      setTimerBusy(false);
    }
  }

  async function handleStopTimer(logName) {
    if (!logName) return;
    setTimerBusy(true);
    setTimerError(null);
    try {
      await pmApi.stopExecutionTimer(logName);
      setRunningHere(null);
      setRunningElsewhere(null);
      window.dispatchEvent(new Event("inet-timer-changed"));
    } catch (e) {
      setTimerError(e.message || "Could not stop timer");
    } finally {
      setTimerBusy(false);
    }
  }

  function captureGPS() {
    if (!navigator.geolocation) {
      setGpsLocation("GPS not supported on this device");
      return;
    }
    setCapturingGps(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        setGpsLocation(`${latitude.toFixed(6)}, ${longitude.toFixed(6)} (\u00B1${Math.round(accuracy)}m)`);
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
    if (!id) {
      setSubmitError("No rollout plan selected. Open an item from Today's Work.");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);

    try {
      const payload = {
        rollout_plan: id,
        execution_status: execStatus,
        achieved_qty: parseFloat(achievedQty) || 0,
        gps_location: gpsLocation,
        remarks,
        activity_code: activityCode || undefined,
        photos: attachments.length ? attachments.join("\n") : undefined,
      };

      await pmApi.updateExecution(payload);

      try {
        const plist = await pmApi.listRolloutPlans({ name: id });
        const p = Array.isArray(plist) && plist.length > 0 ? plist[0] : null;
        setSubmittedPlanStatus(p?.plan_status || null);
      } catch {
        setSubmittedPlanStatus(null);
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
          Loading plan details...
        </div>
      </div>
    );
  }

  if (!id) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1 className="page-title">Execute</h1>
            <div className="page-subtitle">
              Open an <strong>In Execution</strong> rollout plan to continue work
            </div>
          </div>
        </div>

        <div className="page-content" style={{ maxWidth: 720 }}>
          {inExecError && (
            <div className="notice error" style={{ marginBottom: 16 }}>
              <span>&oplus;</span> {inExecError}
            </div>
          )}

          <div className="detail-panel" style={{ marginBottom: 20 }}>
            <div style={{
              fontSize: "0.72rem",
              fontWeight: 700,
              color: "var(--text-label)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 12,
            }}>
              In Execution
            </div>

            {loadingInExec ? (
              <div style={{ padding: 16, color: "var(--text-muted)" }}>Loading…</div>
            ) : inExecPlans.length === 0 ? (
              <div style={{ padding: 16, color: "var(--text-muted)" }}>
                No rollout plans are currently <strong>In Execution</strong> for your team.
                <div style={{ marginTop: 10 }}>
                  Go to <strong>Today&apos;s Work</strong> to start a new execution.
                </div>
              </div>
            ) : (
              <div className="form-group" style={{ margin: 0 }}>
                <label>Select Rollout Plan</label>
                <select
                  value=""
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v) navigate(`/field-execute/${encodeURIComponent(v)}`);
                  }}
                >
                  <option value="">— Select —</option>
                  {inExecPlans.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name} · {p.site_name || p.project_code || p.po_dispatch || p.visit_type || "In Execution"}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
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
            <span>&#x2705;</span> Execution update submitted successfully!
            {execStatus === "Completed" && " IM will set QC and create Work Done from the IM portal when ready."}
            {submittedPlanStatus && (
              <div style={{ marginTop: 10, fontSize: "0.88rem" }}>
                Rollout plan status is now: <strong>{submittedPlanStatus}</strong>
              </div>
            )}
          </div>
          <button className="btn-primary" onClick={() => navigate("/today")}>
            Back to Today&apos;s Work
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
          <button className="btn-secondary" onClick={() => navigate(-1)}>
            &larr; Back
          </button>
        </div>
      </div>

      <div className="page-content" style={{ maxWidth: 720 }}>
        {planError && (
          <div className="notice error" style={{ marginBottom: 16 }}>
            <span>&oplus;</span> {planError}
          </div>
        )}

        {/* Plan Details */}
        {isFieldPortal && teamId && plan && !["Completed", "Cancelled"].includes(plan.plan_status) && (
          <div
            style={{
              marginBottom: 20,
              padding: "16px 18px",
              borderRadius: "var(--radius)",
              border: "1px solid rgba(99,102,241,0.35)",
              background: "linear-gradient(135deg,#0f172a 0%,#1e293b 100%)",
            }}
          >
            <div style={{ fontSize: "0.72rem", color: "#94a3b8", fontWeight: 600, marginBottom: 8 }}>
              TIME ON THIS EXECUTION
            </div>
            {timerError && (
              <div className="notice error" style={{ marginBottom: 10, fontSize: "0.8rem" }}>
                {timerError}
              </div>
            )}
            {runningElsewhere && (
              <div style={{ marginBottom: 12, fontSize: "0.82rem", color: "#fecaca" }}>
                Another timer is running on plan{" "}
                <span style={{ fontFamily: "monospace" }}>{runningElsewhere.rollout_plan}</span>
                {runningElsewhere.item_description ? ` — ${runningElsewhere.item_description}` : ""}.
                <div style={{ marginTop: 8 }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={timerBusy}
                    onClick={() => handleStopTimer(runningElsewhere.log_name)}
                  >
                    Stop that timer
                  </button>
                </div>
              </div>
            )}
            {runningHere && (
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14 }}>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "1.5rem", fontWeight: 700, color: "#7dd3fc" }}>
                  {formatElapsedSeconds(
                    elapsedSecondsFromServerEpoch(runningHere.start_time_ms, timerSkewMsRef.current)
                  )}
                </div>
                <button
                  type="button"
                  className="btn-primary"
                  style={{ background: "#dc2626", borderColor: "#dc2626" }}
                  disabled={timerBusy}
                  onClick={() => handleStopTimer(runningHere.log_name)}
                >
                  Stop timer
                </button>
              </div>
            )}
            {!runningHere && !runningElsewhere && (
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <button type="button" className="btn-primary" disabled={timerBusy} onClick={handleStartTimer}>
                  {timerBusy ? "Please wait…" : "Start timer"}
                </button>
                <span style={{ fontSize: "0.78rem", color: "#94a3b8" }}>
                  Tracks time on this rollout while you work (saved when you stop).
                </span>
              </div>
            )}
          </div>
        )}


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

            {/* Activity Code */}
            <div className="form-group">
              <label>Activity Code</label>
              <select
                value={activityCode}
                onChange={(e) => handleActivityChange(e.target.value)}
              >
                <option value="">-- No Activity --</option>
                {activities.map((a) => (
                  <option key={a.name} value={a.name}>
                    {a.activity_code} - {a.standard_activity}
                  </option>
                ))}
              </select>
            </div>

            {/* Activity Cost Display */}
            <div className="form-group">
              <label>Activity Cost (SAR)</label>
              <input
                type="text"
                value={activityCost != null ? `SAR ${Number(activityCost).toLocaleString()}` : "N/A"}
                readOnly
                style={{ background: "var(--bg)", color: "var(--text-muted)" }}
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
                  placeholder="lat, lng \u2014 or click Capture GPS"
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={captureGPS}
                  disabled={capturingGps}
                  style={{ whiteSpace: "nowrap" }}
                >
                  {capturingGps ? "Getting GPS..." : "Capture GPS"}
                </button>
              </div>
            </div>

            {/* Remarks */}
            <div className="form-group" style={{ gridColumn: "1 / -1" }}>
              <label>Remarks</label>
              <textarea
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Any notes about this execution..."
                rows={3}
              />
            </div>

            {/* Attachments */}
            <div className="form-group" style={{ gridColumn: "1 / -1" }}>
              <label>Attachments</label>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input
                  type="file"
                  onChange={(e) => uploadAttachment(e.target.files?.[0])}
                  disabled={attachmentBusy}
                />
                {attachmentBusy && <span style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>Uploading...</span>}
              </div>
              {attachmentErr && <div style={{ marginTop: 8, fontSize: "0.82rem", color: "#b91c1c" }}>{attachmentErr}</div>}
              {attachments.length > 0 && (
                <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                  {attachments.map((url, idx) => (
                    <div key={`${url}-${idx}`} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <a href={url} target="_blank" rel="noreferrer" style={{ fontSize: "0.82rem" }}>{url}</a>
                      <button
                        type="button"
                        className="btn-secondary"
                        style={{ fontSize: "0.72rem", padding: "2px 8px" }}
                        onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== idx))}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {submitError && (
            <div className="notice error" style={{ marginBottom: 12 }}>
              <span>&oplus;</span> {submitError}
            </div>
          )}

          {execStatus === "Completed" && (
            <div className="notice info" style={{ marginBottom: 12 }}>
              <span>&#x2139;</span> After you submit as Completed, the IM reviews QC and creates the Work Done record manually when QC is Pass.
            </div>
          )}

          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => navigate(-1)}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={submitting}
            >
              {submitting ? "Submitting..." : "Submit Execution"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
