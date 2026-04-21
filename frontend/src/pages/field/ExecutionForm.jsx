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
import { EXECUTION_STATUS_OPTIONS } from "../../constants/executionStatuses";

function parsePhotoList(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean).map((v) => String(v).trim()).filter(Boolean);
  const text = String(raw).trim();
  if (!text) return [];
  if (text.startsWith("[")) {
    try {
      const arr = JSON.parse(text);
      if (Array.isArray(arr)) return arr.filter(Boolean).map((v) => String(v).trim()).filter(Boolean);
    } catch { /* fallthrough */ }
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

function statusBadgeClass(s) {
  const v = (s || "").toLowerCase().replace(/\s+/g, "-");
  if (v === "planned") return "planned";
  if (v === "in-execution" || v === "in-progress") return "in-progress";
  if (v === "completed") return "completed";
  if (v === "cancelled") return "cancelled";
  return "new";
}

/* ── Icons ─────────────────────────────────────────────────── */
const IconBack = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18">
    <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
  </svg>
);

const IconPlay = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18">
    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
  </svg>
);

const IconStop = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18">
    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" clipRule="evenodd" />
  </svg>
);

const IconPin = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
    <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
  </svg>
);

const IconCamera = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" width="20" height="20">
    <path fillRule="evenodd" d="M4 5a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2V7a2 2 0 00-2-2h-1.586a1 1 0 01-.707-.293l-1.121-1.121A2 2 0 0011.172 3H8.828a2 2 0 00-1.414.586L6.293 4.707A1 1 0 015.586 5H4zm6 9a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
  </svg>
);

const IconCheck = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
  </svg>
);

const IconWarn = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
  </svg>
);

export default function ExecutionForm() {
  const { id: idParam } = useParams();
  const id = idParam ? decodeURIComponent(idParam) : undefined;
  const navigate = useNavigate();
  const { teamId, role } = useAuth();
  const isFieldPortal = role === "field";

  const [inExecPlans, setInExecPlans] = useState([]);
  const [loadingInExec, setLoadingInExec] = useState(false);

  const [plan, setPlan] = useState(null);
  const [loadingPlan, setLoadingPlan] = useState(true);
  const [planError, setPlanError] = useState(null);

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
  const [attachments, setAttachments] = useState([]);        // uploaded URLs
  const [pendingUploads, setPendingUploads] = useState([]);  // [{id, preview}] in-flight
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [attachmentErr, setAttachmentErr] = useState(null);
  // map uploaded URL → local blob URL for preview
  const previewMapRef = useRef({});

  useEffect(() => {
    const iv = setInterval(() => timerTick((x) => x + 1), 1000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    const src = runningHere || runningElsewhere;
    if (src?.server_time_ms != null) timerSkewMsRef.current = makeSkewMs(src.server_time_ms);
  }, [runningHere?.log_name, runningElsewhere?.log_name, runningHere?.server_time_ms, runningElsewhere?.server_time_ms]);

  useEffect(() => {
    if (!id || !isFieldPortal || !teamId) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await pmApi.getRunningExecutionTimer();
        if (cancelled) return;
        if (!r?.log_name) { setRunningHere(null); setRunningElsewhere(null); return; }
        if (r.rollout_plan === id) { setRunningHere(r); setRunningElsewhere(null); }
        else { setRunningHere(null); setRunningElsewhere(r); }
      } catch { if (!cancelled) { setRunningHere(null); setRunningElsewhere(null); } }
    })();
    return () => { cancelled = true; };
  }, [id, teamId, success, isFieldPortal]);

  useEffect(() => {
    if (!id) { setPlan(null); setLoadingPlan(false); return; }
    setLoadingPlan(true);
    (async () => {
      try {
        const list = await pmApi.listRolloutPlans({ name: id });
        const found = Array.isArray(list) && list.length > 0 ? list[0] : null;
        if (!found) throw new Error("Plan not found");
        setPlan(found);
      } catch (err) {
        setPlanError(err.message || "Could not load plan details");
      } finally { setLoadingPlan(false); }
    })();
  }, [id]);

  useEffect(() => {
    if (id) return;
    setLoadingInExec(true);
    (async () => {
      try {
        const list = teamId ? await pmApi.listRolloutPlans({ team: teamId, plan_status: "In Execution" }) : [];
        setInExecPlans(Array.isArray(list) ? list : []);
      } catch { setInExecPlans([]); }
      finally { setLoadingInExec(false); }
    })();
  }, [teamId, id]);

  useEffect(() => {
    pmApi.listActivityCosts().then((res) => setActivities(res || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!id || success || (isFieldPortal && !teamId)) { setExistingExec(null); return; }
    let cancelled = false;
    pmApi.getFieldExecutionForRollout(id).then((ex) => {
      if (cancelled) return;
      setExistingExec(ex || null);
      if (ex) setAttachments(parsePhotoList(ex.photos));
    }).catch(() => { if (!cancelled) setExistingExec(null); });
    return () => { cancelled = true; };
  }, [id, teamId, success, isFieldPortal]);

  useEffect(() => { setAchievedQty(""); }, [id]);

  useEffect(() => {
    if (!plan || success) return;
    if (String(plan.name || "") !== String(id || "")) return;
    if (String(achievedQty || "").trim() !== "") return;
    setAchievedQty(defaultAchievedQtyFromPlan(plan));
  }, [plan, achievedQty, success, id]);

  function handleActivityChange(code) {
    setActivityCode(code);
    const found = activities.find((a) => a.name === code);
    setActivityCost(found ? found.base_cost_sar : null);
  }

  async function uploadAttachment(file) {
    if (!file) return;
    setAttachmentErr(null);

    // Immediate local preview while uploading
    const previewUrl = URL.createObjectURL(file);
    const pendingId = `p-${Date.now()}-${Math.random()}`;
    setPendingUploads((prev) => [...prev, { id: pendingId, preview: previewUrl }]);
    setAttachmentBusy(true);

    try {
      await fetchPortalSession().catch(() => {});
      let token = getCsrf();
      const doFetch = (body) =>
        fetch("/api/method/upload_file", {
          method: "POST", credentials: "include",
          headers: { "X-Frappe-CSRF-Token": token }, body,
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
      if (!res.ok || json.exc) throw new Error(json.message || "Upload failed");
      const fileUrl = json.message?.file_url;
      if (!fileUrl) throw new Error("No file URL received");
      // Keep the blob URL as a local preview for this uploaded file
      previewMapRef.current[fileUrl] = previewUrl;
      setAttachments((prev) => [...prev, fileUrl]);
    } catch (err) {
      URL.revokeObjectURL(previewUrl);
      setAttachmentErr(err.message || "Upload failed");
    } finally {
      setPendingUploads((prev) => prev.filter((p) => p.id !== pendingId));
      setAttachmentBusy(false);
    }
  }

  function removePhoto(idx) {
    setAttachments((prev) => {
      const url = prev[idx];
      if (previewMapRef.current[url]) {
        URL.revokeObjectURL(previewMapRef.current[url]);
        delete previewMapRef.current[url];
      }
      return prev.filter((_, i) => i !== idx);
    });
  }

  // Revoke all blob URLs on unmount
  useEffect(() => () => {
    Object.values(previewMapRef.current).forEach((u) => URL.revokeObjectURL(u));
  }, []);

  async function handleStartTimer() {
    if (!id || !isFieldPortal) return;
    setTimerBusy(true); setTimerError(null);
    try {
      await pmApi.startExecutionTimer(id);
      window.dispatchEvent(new Event("inet-timer-changed"));
      const r = await pmApi.getRunningExecutionTimer();
      if (r?.rollout_plan === id) { setRunningHere(r); setRunningElsewhere(null); }
    } catch (e) { setTimerError(e.message || "Could not start timer"); }
    finally { setTimerBusy(false); }
  }

  async function handleStopTimer(logName) {
    if (!logName) return;
    setTimerBusy(true); setTimerError(null);
    try {
      await pmApi.stopExecutionTimer(logName);
      setRunningHere(null); setRunningElsewhere(null);
      window.dispatchEvent(new Event("inet-timer-changed"));
    } catch (e) { setTimerError(e.message || "Could not stop timer"); }
    finally { setTimerBusy(false); }
  }

  function captureGPS() {
    if (!navigator.geolocation) { setGpsLocation("GPS not supported"); return; }
    setCapturingGps(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords: { latitude, longitude, accuracy } }) => {
        setGpsLocation(`${latitude.toFixed(6)}, ${longitude.toFixed(6)} (\u00B1${Math.round(accuracy)}m)`);
        setCapturingGps(false);
      },
      (err) => { setGpsLocation(`GPS error: ${err.message}`); setCapturingGps(false); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!id) { setSubmitError("No rollout plan selected."); return; }
    setSubmitting(true); setSubmitError(null);
    try {
      await pmApi.updateExecution({
        rollout_plan: id,
        // Field (Team Lead) sets tl_status. Execution status is the IM's
        // confirmation and is edited from the IM Execution screen.
        tl_status: execStatus,
        achieved_qty: parseFloat(achievedQty) || 0,
        gps_location: gpsLocation,
        remarks,
        activity_code: activityCode || undefined,
        photos: attachments.length ? attachments.join("\n") : undefined,
      });
      try {
        const plist = await pmApi.listRolloutPlans({ name: id });
        setSubmittedPlanStatus((Array.isArray(plist) && plist[0])?.plan_status || null);
      } catch { setSubmittedPlanStatus(null); }
      setSuccess(true);
    } catch (err) {
      setSubmitError(err.message || "Submission failed");
    } finally { setSubmitting(false); }
  }

  /* ── No-ID state: pick an in-execution plan ─────────────── */
  if (!id) {
    return (
      <div className="exec-page">
        <div className="page-header">
          <div>
            <h1 className="page-title">Execute</h1>
            <div className="page-subtitle">Select an In Execution plan to continue</div>
          </div>
        </div>
        <div className="exec-body">
          <div className="exec-section">
            <div className="exec-section-title">In Execution Plans</div>
            {loadingInExec ? (
              <div style={{ color: "var(--text-muted)", fontSize: "0.85rem", padding: "8px 0" }}>Loading…</div>
            ) : inExecPlans.length === 0 ? (
              <div className="empty-state" style={{ padding: "24px 0" }}>
                <div className="empty-icon">🔧</div>
                <h3>No active executions</h3>
                <p>Go to Today's Work to start a new execution.</p>
              </div>
            ) : (
              <div className="exec-field">
                <label>Select Rollout Plan</label>
                <select
                  className="exec-field select"
                  value=""
                  onChange={(e) => { if (e.target.value) navigate(`/field-execute/${encodeURIComponent(e.target.value)}`); }}
                >
                  <option value="">— Select —</option>
                  {inExecPlans.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name} · {p.site_name || p.project_code || p.visit_type || "In Execution"}
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

  /* ── Loading plan ────────────────────────────────────────── */
  if (loadingPlan) {
    return (
      <div className="exec-page">
        <div className="exec-mobile-header field-mobile-only">
          <button className="exec-mobile-back" onClick={() => navigate(-1)}>
            <IconBack />
          </button>
          <div className="exec-mobile-title">
            <h2>Execution Form</h2>
          </div>
        </div>
        <div style={{ padding: "48px 24px", textAlign: "center", color: "var(--text-muted)" }}>
          Loading plan…
        </div>
      </div>
    );
  }

  /* ── Success screen ─────────────────────────────────────── */
  if (success) {
    return (
      <div className="exec-page">
        <div className="exec-success-screen">
          <div className="exec-success-icon">✅</div>
          <div className="exec-success-title">Execution Submitted!</div>
          <div className="exec-success-msg">
            Your update has been recorded.
            {execStatus === "Completed" && " The IM will review QC and create the Work Done record when QC passes."}
          </div>
          {submittedPlanStatus && (
            <div className="exec-success-status">
              <IconCheck /> Plan status: {submittedPlanStatus}
            </div>
          )}
          <button className="btn-primary" style={{ minWidth: 200 }} onClick={() => navigate("/today")}>
            Back to Today's Work
          </button>
        </div>
      </div>
    );
  }

  const planCompleted = ["Completed", "Cancelled"].includes(plan?.plan_status);
  const showTimer = isFieldPortal && teamId && plan && !planCompleted;
  const elapsedSec = runningHere
    ? elapsedSecondsFromServerEpoch(runningHere.start_time_ms, timerSkewMsRef.current)
    : 0;

  /* ── Main execution form ─────────────────────────────────── */
  return (
    <div className="exec-page">

      {/* ── Mobile header (hidden on desktop via CSS) ─────── */}
      <div className="exec-mobile-header field-mobile-only">
        <button className="exec-mobile-back" onClick={() => navigate(-1)}>
          <IconBack />
        </button>
        <div className="exec-mobile-title">
          <h2>Execution</h2>
          <span className="exec-plan-id">{id}</span>
        </div>
        {plan?.plan_status && (
          <span className={`status-badge ${statusBadgeClass(plan.plan_status)}`} style={{ flexShrink: 0 }}>
            <span className="status-dot" />
            {plan.plan_status}
          </span>
        )}
      </div>

      {/* ── Desktop header (hidden on mobile) ──────────────── */}
      <div className="page-header field-desktop-only">
        <div>
          <h1 className="page-title">Execution Form</h1>
          <div className="page-subtitle" style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{id}</div>
        </div>
        <div className="page-actions">
          <button className="btn-secondary" onClick={() => navigate(-1)}>← Back</button>
        </div>
      </div>

      {/* ── Body ────────────────────────────────────────────── */}
      <form onSubmit={handleSubmit}>
        <div className="exec-body">

          {planError && (
            <div className="notice error" style={{ display: "flex", gap: 8 }}>
              <IconWarn />{planError}
            </div>
          )}

          {/* ── Timer block ─────────────────────────────────── */}
          {showTimer && (
            <div className="exec-timer-block">
              {runningHere ? (
                <>
                  <div className="exec-timer-label">
                    <span className="exec-timer-label-dot" />
                    Time on this execution
                  </div>
                  <div className="exec-timer-clock">
                    {formatElapsedSeconds(elapsedSec)}
                  </div>
                  {timerError && <div className="exec-timer-elsewhere" style={{ marginBottom: 10 }}>{timerError}</div>}
                  <div className="exec-timer-actions">
                    <button
                      type="button"
                      className="exec-timer-stop-btn"
                      disabled={timerBusy}
                      onClick={() => handleStopTimer(runningHere.log_name)}
                    >
                      <IconStop /> {timerBusy ? "Stopping…" : "Stop Timer"}
                    </button>
                  </div>
                </>
              ) : runningElsewhere ? (
                <>
                  <div className="exec-timer-label">Timer</div>
                  <div className="exec-timer-elsewhere">
                    A timer is running on plan{" "}
                    <span style={{ fontFamily: "monospace" }}>{runningElsewhere.rollout_plan}</span>.
                  </div>
                  <div className="exec-timer-actions">
                    <button
                      type="button"
                      className="exec-timer-stop-btn"
                      disabled={timerBusy}
                      onClick={() => handleStopTimer(runningElsewhere.log_name)}
                    >
                      <IconStop /> Stop that timer
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="exec-timer-label">Start tracking time on this plan</div>
                  {timerError && <div className="exec-timer-elsewhere" style={{ marginBottom: 10 }}>{timerError}</div>}
                  <div className="exec-timer-actions">
                    <button
                      type="button"
                      className="exec-timer-start-btn"
                      disabled={timerBusy}
                      onClick={handleStartTimer}
                    >
                      <IconPlay /> {timerBusy ? "Please wait…" : "Start Timer"}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Plan details ────────────────────────────────── */}
          {plan && (
            <div className="exec-section">
              <div className="exec-section-title">Plan Details</div>
              <div className="exec-plan-chip-row">
                {plan.site_name && (
                  <div className="exec-plan-chip">
                    <IconPin />
                    <span>{plan.site_name}</span>
                  </div>
                )}
                {plan.project_code && (
                  <div className="exec-plan-chip">
                    <svg viewBox="0 0 20 20" fill="currentColor"><path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z"/><path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd"/></svg>
                    <span><strong>{plan.project_code}</strong></span>
                  </div>
                )}
                {plan.visit_type && (
                  <div className="exec-plan-chip">
                    <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd"/></svg>
                    <span>{plan.visit_type}</span>
                  </div>
                )}
                {plan.plan_date && (
                  <div className="exec-plan-chip">
                    <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd"/></svg>
                    <span>{plan.plan_date}</span>
                  </div>
                )}
                {plan.item_code && (
                  <div className="exec-plan-chip">
                    <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M17.707 9.293a1 1 0 010 1.414l-7 7a1 1 0 01-1.414 0l-7-7A.997.997 0 012 10V5a3 3 0 013-3h5c.256 0 .512.098.707.293l7 7zM5 6a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd"/></svg>
                    <span>{plan.item_code}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Execution fields ─────────────────────────────── */}
          <div className="exec-section">
            <div className="exec-section-title">Execution Update</div>

            <div className="exec-field">
              <label>TL Status *</label>
              <select
                value={execStatus}
                onChange={(e) => setExecStatus(e.target.value)}
                required
              >
                {EXECUTION_STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            <div className="exec-field">
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

            <div className="exec-field">
              <label>Activity Code</label>
              <select value={activityCode} onChange={(e) => handleActivityChange(e.target.value)}>
                <option value="">— No Activity —</option>
                {activities.map((a) => (
                  <option key={a.name} value={a.name}>
                    {a.activity_code} — {a.standard_activity}
                  </option>
                ))}
              </select>
            </div>

            {activityCost != null && (
              <div className="exec-field">
                <label>Activity Cost (SAR)</label>
                <div className="exec-field-readonly">
                  SAR {Number(activityCost).toLocaleString()}
                </div>
              </div>
            )}
          </div>

          {/* ── Location ─────────────────────────────────────── */}
          <div className="exec-section">
            <div className="exec-section-title">Location</div>
            <button
              type="button"
              className="gps-capture-btn"
              onClick={captureGPS}
              disabled={capturingGps}
            >
              <IconPin />
              {capturingGps ? "Getting GPS location…" : "Capture GPS Location"}
            </button>
            {gpsLocation && (
              <div className="gps-result-box">
                <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg>
                {gpsLocation}
              </div>
            )}
          </div>

          {/* ── Remarks ──────────────────────────────────────── */}
          <div className="exec-section">
            <div className="exec-section-title">Notes & Remarks</div>
            <div className="exec-field" style={{ marginBottom: 0 }}>
              <textarea
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Any notes about this execution…"
                rows={4}
              />
            </div>
          </div>

          {/* ── Photos ───────────────────────────────────────── */}
          <div className="exec-section">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div className="exec-section-title" style={{ marginBottom: 0 }}>Photos</div>
              {(attachments.length + pendingUploads.length) > 0 && (
                <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", fontWeight: 600 }}>
                  {attachments.length + pendingUploads.length} photo{(attachments.length + pendingUploads.length) !== 1 ? "s" : ""}
                </span>
              )}
            </div>

            {/* Camera + Gallery buttons */}
            <div className="photo-action-row">
              <label className="photo-add-btn photo-add-btn--camera" title="Take a photo with camera">
                <IconCamera />
                <span>Camera</span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => { uploadAttachment(e.target.files?.[0]); e.target.value = ""; }}
                  disabled={attachmentBusy}
                />
              </label>
              <label className="photo-add-btn photo-add-btn--gallery" title="Choose from gallery">
                <svg viewBox="0 0 20 20" fill="currentColor" width="20" height="20">
                  <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
                </svg>
                <span>Gallery</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => { uploadAttachment(e.target.files?.[0]); e.target.value = ""; }}
                  disabled={attachmentBusy}
                />
              </label>
            </div>

            {/* Upload error */}
            {attachmentErr && (
              <div className="notice error" style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
                <IconWarn /> {attachmentErr}
              </div>
            )}

            {/* Photo grid: pending + uploaded */}
            {(pendingUploads.length > 0 || attachments.length > 0) && (
              <div className="photo-thumb-grid" style={{ marginTop: 12 }}>
                {/* In-flight uploads with spinner overlay */}
                {pendingUploads.map((p) => (
                  <div key={p.id} className="photo-thumb photo-thumb--uploading">
                    <img src={p.preview} alt="uploading" />
                    <div className="photo-upload-overlay">
                      <div className="photo-upload-spinner" />
                    </div>
                  </div>
                ))}
                {/* Uploaded photos with actual previews */}
                {attachments.map((url, idx) => (
                  <div key={`${url}-${idx}`} className="photo-thumb">
                    <img
                      src={previewMapRef.current[url] || url}
                      alt={`Photo ${idx + 1}`}
                      onError={(e) => { e.target.style.display = "none"; e.target.nextSibling.style.display = "flex"; }}
                    />
                    <span className="photo-thumb-fallback">{url.split("/").pop()}</span>
                    <button
                      type="button"
                      className="photo-thumb-remove"
                      onClick={() => removePhoto(idx)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Notices */}
          {submitError && (
            <div className="notice error" style={{ display: "flex", gap: 8 }}>
              <IconWarn /> {submitError}
            </div>
          )}
          {execStatus === "Completed" && (
            <div className="notice info">
              After submitting as Completed, the IM reviews QC and creates the Work Done record when QC passes.
            </div>
          )}

          {/* Desktop buttons (mobile uses sticky footer) */}
          <div className="field-desktop-only" style={{ display: "flex", gap: 10 }}>
            <button type="button" className="btn-secondary" onClick={() => navigate(-1)}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? "Submitting…" : "Submit Execution"}
            </button>
          </div>
        </div>

        {/* ── Sticky submit footer (mobile only) ───────────── */}
        <div className="exec-sticky-footer field-mobile-only flex">
          <button type="button" className="btn-secondary" onClick={() => navigate(-1)}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? "Submitting…" : "Submit"}
          </button>
        </div>
      </form>
    </div>
  );
}
