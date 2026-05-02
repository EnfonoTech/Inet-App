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

// Treat 0/false/"0"/"false" as the not-required signal. null/undefined
// (legacy plans without the flag) defaults to required.
function isNotRequired(v) {
  if (v === 0 || v === false || v === "0") return true;
  if (typeof v === "string" && v.toLowerCase() === "false") return true;
  return false;
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

/**
 * Searchable single-pick remark picker. Type to filter the existing
 * templates; if the typed text doesn't match any (case-insensitive)
 * template, a "+ Add new …" row appears at the end of the list and
 * tapping it creates the template + picks it.
 */
function TlRemarkPicker({ templates, picked, creating, onPick, onCreate }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  const q = query.trim().toLowerCase();
  const filtered = (templates || [])
    .filter((t) => !picked.has(t.remark_text))
    .filter((t) => !q || (t.remark_text || "").toLowerCase().includes(q));
  const exactMatch = (templates || []).some(
    (t) => (t.remark_text || "").trim().toLowerCase() === q && q.length > 0
  );
  const trimmedQuery = query.trim();
  const showAddNew = trimmedQuery.length > 0 && !exactMatch;
  const placeholder = picked.size > 0 ? "+ Add another remark" : "Select a remark…";

  function handlePick(text) {
    onPick(text);
    setQuery("");
    setOpen(false);
  }

  async function handleAddNew() {
    const txt = trimmedQuery;
    if (!txt) return;
    await onCreate(txt);
    setQuery("");
    setOpen(false);
  }

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%", textAlign: "left",
          padding: "10px 36px 10px 12px", borderRadius: 8,
          border: "1px solid #e2e8f0", fontSize: "0.86rem",
          background: "#fff", boxSizing: "border-box",
          color: "var(--text)", cursor: "pointer", position: "relative",
        }}
      >
        {placeholder}
        <span style={{
          position: "absolute", right: 12, top: "50%",
          transform: "translateY(-50%)", color: "#94a3b8", fontSize: "0.72rem",
          pointerEvents: "none",
        }}>{open ? "▲" : "▾"}</span>
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
          zIndex: 60, background: "#fff",
          border: "1px solid #e2e8f0", borderRadius: 8,
          boxShadow: "0 10px 25px rgba(15,23,42,0.15)",
          overflow: "hidden",
        }}>
          <div style={{ padding: 8, borderBottom: "1px solid #f1f5f9" }}>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search or type a new remark…"
              maxLength={140}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (filtered.length === 1) handlePick(filtered[0].remark_text);
                  else if (showAddNew) handleAddNew();
                }
              }}
              style={{
                width: "100%", padding: "8px 10px",
                border: "1px solid #e2e8f0", borderRadius: 6,
                fontSize: "0.84rem", boxSizing: "border-box", outline: "none",
              }}
            />
          </div>
          <div style={{ maxHeight: 260, overflowY: "auto", padding: "4px 0" }}>
            {filtered.length === 0 && !showAddNew && (
              <div style={{ padding: "10px 12px", fontSize: "0.78rem", color: "var(--text-muted)", textAlign: "center" }}>
                No matches
              </div>
            )}
            {filtered.map((t) => (
              <div
                key={t.name}
                onClick={() => handlePick(t.remark_text)}
                style={{
                  padding: "8px 12px", cursor: "pointer", fontSize: "0.84rem",
                  color: "var(--text)",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(100,116,139,0.08)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = ""; }}
              >
                {t.remark_text}
              </div>
            ))}
            {showAddNew && (
              <div
                onClick={() => { if (!creating) handleAddNew(); }}
                style={{
                  padding: "10px 12px", cursor: creating ? "wait" : "pointer",
                  fontSize: "0.84rem", color: "var(--blue, #2563eb)",
                  fontWeight: 600,
                  background: "#eff6ff",
                  borderTop: filtered.length > 0 ? "1px solid #f1f5f9" : "none",
                  display: "flex", alignItems: "center", gap: 8,
                }}
              >
                <span style={{
                  width: 22, height: 22, borderRadius: 999,
                  background: "#2563eb", color: "#fff",
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  fontSize: 14, fontWeight: 700,
                }}>+</span>
                {creating ? `Saving "${trimmedQuery}"…` : `Add "${trimmedQuery}" as new remark`}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

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
  const [qcStatus, setQcStatus] = useState("Pending");
  const [ciagStatus, setCiagStatus] = useState("Open");
  const [capturingGps, setCapturingGps] = useState(false);

  // Team Lead Remark — checklist picker over saved templates plus a free
  // text textarea. The combined value goes to PO Dispatch.team_lead_remark
  // so IM and PM views see it in their remarks column.
  const [tlRemarkTemplates, setTlRemarkTemplates] = useState([]);
  const [tlRemarkPicked, setTlRemarkPicked] = useState(new Set()); // Set<remark_text>
  const [tlRemarkExtra, setTlRemarkExtra] = useState("");
  const [tlRemarkAdding, setTlRemarkAdding] = useState(false);
  const [newTemplateText, setNewTemplateText] = useState("");
  const [newTemplateBusy, setNewTemplateBusy] = useState(false);
  const [newTemplateErr, setNewTemplateErr] = useState(null);

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
        // Use the enriched endpoint so we get item description, qty,
        // activity type, DUID, POID, plus the IM-confirmed
        // execution_status (read-only badge for the field user).
        const found = await pmApi.getRolloutPlanDetails(id);
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
        // Includes Planned, In Execution, Planning with Issue — i.e. any
        // plan the team can still act on. Previously this fetched only
        // "In Execution" plans, so a team with planned-but-not-started
        // work saw "No active executions" even with valid jobs queued.
        const list = teamId ? await pmApi.listFieldTeamActionablePlans(teamId) : [];
        setInExecPlans(Array.isArray(list) ? list : []);
      } catch { setInExecPlans([]); }
      finally { setLoadingInExec(false); }
    })();
  }, [teamId, id]);

  useEffect(() => {
    if (!id || success || (isFieldPortal && !teamId)) { setExistingExec(null); return; }
    let cancelled = false;
    pmApi.getFieldExecutionForRollout(id).then((ex) => {
      if (cancelled) return;
      setExistingExec(ex || null);
      if (ex) {
        setAttachments(parsePhotoList(ex.photos));
        // Pre-fill QC / CIAG selects from existing execution so a return
        // visit doesn't overwrite values silently.
        if (ex.qc_status) setQcStatus(ex.qc_status);
        if (ex.ciag_status) setCiagStatus(ex.ciag_status);
      }
    }).catch(() => { if (!cancelled) setExistingExec(null); });
    return () => { cancelled = true; };
  }, [id, teamId, success, isFieldPortal]);

  // Load saved remark templates once the page mounts.
  useEffect(() => {
    let cancelled = false;
    pmApi.listFieldRemarkTemplates()
      .then((res) => { if (!cancelled) setTlRemarkTemplates(Array.isArray(res) ? res : []); })
      .catch(() => { if (!cancelled) setTlRemarkTemplates([]); });
    return () => { cancelled = true; };
  }, []);

  // Pre-populate the picked checklist + extra textarea from the
  // existing PO Dispatch.team_lead_remark so a follow-up edit doesn't
  // lose what the previous TL wrote.
  useEffect(() => {
    const existing = (plan?.team_lead_remark || "").trim();
    if (!existing) return;
    const lines = existing.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const tplSet = new Set(tlRemarkTemplates.map((t) => t.remark_text));
    const picked = new Set();
    const extra = [];
    for (const ln of lines) {
      if (tplSet.has(ln)) picked.add(ln);
      else extra.push(ln);
    }
    setTlRemarkPicked(picked);
    setTlRemarkExtra(extra.join("\n"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan?.team_lead_remark, tlRemarkTemplates.length]);

  function toggleTlRemark(text) {
    setTlRemarkPicked((prev) => {
      const next = new Set(prev);
      if (next.has(text)) next.delete(text);
      else next.add(text);
      return next;
    });
  }

  async function handleCreateTemplate() {
    const txt = newTemplateText.trim();
    if (!txt) { setNewTemplateErr("Remark text is required."); return; }
    setNewTemplateBusy(true); setNewTemplateErr(null);
    try {
      const created = await pmApi.createFieldRemarkTemplate(txt);
      const list = await pmApi.listFieldRemarkTemplates();
      setTlRemarkTemplates(Array.isArray(list) ? list : []);
      // Auto-pick the just-created template so it goes into the next save.
      const key = (created && created.remark_text) || txt;
      setTlRemarkPicked((prev) => { const next = new Set(prev); next.add(key); return next; });
      setNewTemplateText("");
      setTlRemarkAdding(false);
    } catch (err) {
      setNewTemplateErr(err.message || "Could not create template.");
    } finally {
      setNewTemplateBusy(false);
    }
  }

  // Build the final TL remark string: checked templates joined with
  // newlines, then the free-text extras appended.
  function buildTlRemark() {
    const picked = Array.from(tlRemarkPicked);
    const extra = (tlRemarkExtra || "").trim();
    const parts = [];
    if (picked.length) parts.push(picked.join("\n"));
    if (extra) parts.push(extra);
    return parts.join("\n").trim();
  }

  useEffect(() => { setAchievedQty(""); }, [id]);

  useEffect(() => {
    if (!plan || success) return;
    if (String(plan.name || "") !== String(id || "")) return;
    if (String(achievedQty || "").trim() !== "") return;
    setAchievedQty(defaultAchievedQtyFromPlan(plan));
  }, [plan, achievedQty, success, id]);

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
      // Field (Team Lead) submits tl_status, achieved qty, GPS, photos,
      // remarks, and — when marking Completed — QC + CIAG in one shot.
      // The IM's confirmation is a separate edit (sets execution_status)
      // and is read-only here.
      const tlRemark = buildTlRemark();
      const payload = {
        rollout_plan: id,
        tl_status: execStatus,
        achieved_qty: parseFloat(achievedQty) || 0,
        gps_location: gpsLocation,
        // team_lead_remark goes to PO Dispatch.team_lead_remark via the
        // backend so it surfaces in IM / PM remarks columns. Empty
        // string is fine — we don't want stale remarks lingering after
        // a TL clears them.
        team_lead_remark: tlRemark,
        photos: attachments.length ? attachments.join("\n") : undefined,
      };
      if (execStatus === "Completed") {
        if (!isNotRequired(plan?.qc_required)) payload.qc_status = qcStatus;
        if (!isNotRequired(plan?.ciag_required)) payload.ciag_status = ciagStatus;
      }
      await pmApi.updateExecution(payload);
      // Bump usage_count for picked templates so frequently-used items
      // surface to the top of the list next time. Fire-and-forget.
      if (tlRemarkPicked.size > 0) {
        pmApi.bumpFieldRemarkTemplateUsage(Array.from(tlRemarkPicked)).catch(() => {});
      }
      try {
        const refreshed = await pmApi.getRolloutPlanDetails(id);
        setSubmittedPlanStatus(refreshed?.plan_status || null);
      } catch { setSubmittedPlanStatus(null); }
      setSuccess(true);
    } catch (err) {
      setSubmitError(err.message || "Submission failed");
    } finally { setSubmitting(false); }
  }

  /* ── No-ID state: pick a plan to execute ─────────────────── */
  if (!id) {
    return (
      <div className="exec-page">
        <div className="page-header">
          <div>
            <h1 className="page-title">Execute</h1>
            <div className="page-subtitle">Pick a planned or in-progress job to continue</div>
          </div>
        </div>
        <div className="exec-body">
          <div className="exec-section">
            <div className="exec-section-title">
              Open Plans for Your Team
              {!loadingInExec && inExecPlans.length > 0 && (
                <span style={{ fontSize: "0.74rem", color: "var(--text-muted)", marginLeft: 8, fontWeight: 500 }}>
                  · {inExecPlans.length} open
                </span>
              )}
            </div>
            {loadingInExec ? (
              <div style={{ color: "var(--text-muted)", fontSize: "0.85rem", padding: "8px 0" }}>Loading…</div>
            ) : inExecPlans.length === 0 ? (
              <div className="empty-state" style={{ padding: "24px 0" }}>
                <div className="empty-icon">🔧</div>
                <h3>Nothing open right now</h3>
                <p>Your team has no Planned or In-Execution rollouts. New work appears here once an IM dispatches it.</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {inExecPlans.map((p) => {
                  const isInExec = p.plan_status === "In Execution";
                  const accent = isInExec ? "#f59e0b" : "#3b82f6";
                  return (
                    <button
                      key={p.name}
                      type="button"
                      onClick={() => navigate(`/field-execute/${encodeURIComponent(p.name)}`)}
                      style={{
                        textAlign: "left", width: "100%", padding: 14,
                        borderRadius: 12, border: "1px solid #e2e8f0",
                        borderLeft: `4px solid ${accent}`,
                        background: "#fff", cursor: "pointer",
                        boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
                        transition: "transform 0.05s ease, box-shadow 0.15s ease",
                      }}
                      onMouseDown={(e) => { e.currentTarget.style.transform = "scale(0.99)"; }}
                      onMouseUp={(e) => { e.currentTarget.style.transform = ""; }}
                      onMouseLeave={(e) => { e.currentTarget.style.transform = ""; }}
                    >
                      {/* Header row: POID + status pill */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 6 }}>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontWeight: 700, fontSize: "0.88rem", color: "var(--text)", fontFamily: "monospace" }}>
                            {p.poid || p.name}
                          </div>
                          {p.item_description && (
                            <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)", marginTop: 2, lineHeight: 1.35, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                              {p.item_description}
                            </div>
                          )}
                        </div>
                        <span style={{
                          flexShrink: 0, fontSize: "0.66rem", fontWeight: 700,
                          padding: "3px 8px", borderRadius: 999,
                          background: isInExec ? "rgba(245,158,11,0.12)" : "rgba(59,130,246,0.12)",
                          color: isInExec ? "#b45309" : "#1d4ed8",
                          textTransform: "uppercase", letterSpacing: 0.4,
                        }}>
                          {p.plan_status}
                        </span>
                      </div>

                      {/* Meta chips */}
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", fontSize: "0.74rem", color: "var(--text-muted)" }}>
                        {p.project_code && (
                          <span>Project: <strong style={{ color: "var(--text)" }}>{p.project_code}</strong></span>
                        )}
                        {p.site_code && (
                          <span>DUID: <strong style={{ color: "var(--text)" }}>{p.site_code}</strong></span>
                        )}
                        {p.item_code && (
                          <span>Item: <strong style={{ color: "var(--text)" }}>{p.item_code}</strong></span>
                        )}
                        {p.qty != null && (
                          <span>Qty: <strong style={{ color: "var(--text)" }}>{Number(p.qty)}</strong></span>
                        )}
                        {p.visit_type && <span>{p.visit_type}</span>}
                        {p.plan_date && <span>{p.plan_date}</span>}
                      </div>

                      {p.customer_activity_type && (
                        <div style={{ marginTop: 6, fontSize: "0.72rem", color: "#475569" }}>
                          Activity: <strong>{p.customer_activity_type}</strong>
                        </div>
                      )}
                    </button>
                  );
                })}
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
                {plan.poid && (
                  <div className="exec-plan-chip" title="POID (PO Dispatch identifier)">
                    <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M17.707 9.293a1 1 0 010 1.414l-7 7a1 1 0 01-1.414 0l-7-7A.997.997 0 012 10V5a3 3 0 013-3h5c.256 0 .512.098.707.293l7 7zM5 6a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd"/></svg>
                    <span><strong>{plan.poid}</strong></span>
                  </div>
                )}
                {plan.project_code && (
                  <div className="exec-plan-chip" title="Project">
                    <svg viewBox="0 0 20 20" fill="currentColor"><path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z"/><path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd"/></svg>
                    <span><strong>{plan.project_code}</strong></span>
                  </div>
                )}
                {plan.site_code && (
                  <div className="exec-plan-chip" title="DUID">
                    <IconPin />
                    <span>{plan.site_code}{plan.site_name ? ` · ${plan.site_name}` : ""}</span>
                  </div>
                )}
                {plan.visit_type && (
                  <div className="exec-plan-chip" title="Visit type">
                    <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd"/></svg>
                    <span>{plan.visit_type}</span>
                  </div>
                )}
                {plan.plan_date && (
                  <div className="exec-plan-chip" title="Plan date">
                    <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd"/></svg>
                    <span>{plan.plan_date}</span>
                  </div>
                )}
                {plan.qty != null && (
                  <div className="exec-plan-chip" title="Planned qty">
                    <svg viewBox="0 0 20 20" fill="currentColor"><path d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 16a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z"/></svg>
                    <span>Qty {Number(plan.qty)}</span>
                  </div>
                )}
                {plan.customer_activity_type && (
                  <div className="exec-plan-chip" title="Activity type">
                    <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M2 5a2 2 0 012-2h7a2 2 0 012 2v4a2 2 0 01-2 2H9l-3 3v-3H4a2 2 0 01-2-2V5z" clipRule="evenodd"/></svg>
                    <span>{plan.customer_activity_type}</span>
                  </div>
                )}
                {plan.item_code && (
                  <div className="exec-plan-chip" title="Item">
                    <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 2L3 6v8l7 4 7-4V6l-7-4zM5 7.5l5-2.857L15 7.5v.001l-5 2.857-5-2.857V7.5z" clipRule="evenodd"/></svg>
                    <span>{plan.item_code}</span>
                  </div>
                )}
                {(plan.access_time || plan.access_period) && (
                  <div className="exec-plan-chip" title="Planned access window">
                    <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-13a.75.75 0 00-1.5 0v5c0 .2.08.39.22.53l3 3a.75.75 0 101.06-1.06l-2.78-2.78V5z" clipRule="evenodd"/></svg>
                    <span>
                      Access: {plan.access_time || "—"}
                      {plan.access_period ? ` (${plan.access_period})` : ""}
                    </span>
                  </div>
                )}
                {isNotRequired(plan.qc_required) && (
                  <div className="exec-plan-chip" title="QC not required for this plan" style={{ background: "#fef3c7", color: "#92400e" }}>
                    <span>QC Not Required</span>
                  </div>
                )}
                {isNotRequired(plan.ciag_required) && (
                  <div className="exec-plan-chip" title="CIAG not required for this plan" style={{ background: "#fef3c7", color: "#92400e" }}>
                    <span>CIAG Not Required</span>
                  </div>
                )}
              </div>
              {plan.item_description && (
                <div style={{ fontSize: "0.84rem", color: "var(--text-secondary)", marginTop: 8, lineHeight: 1.4 }}>
                  {plan.item_description}
                </div>
              )}
              {/* IM-confirmed status — read-only badge so the field user
                  knows whether the IM has signed off or not. */}
              <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, fontSize: "0.78rem" }}>
                <span style={{ color: "var(--text-muted)" }}>IM Confirmation:</span>
                {plan.execution_status ? (
                  <span className={`status-badge ${statusBadgeClass(plan.execution_status)}`}>
                    <span className="status-dot" />{plan.execution_status}
                  </span>
                ) : (
                  <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>
                    Awaiting IM
                  </span>
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
                step="0.0001"
                value={achievedQty}
                onChange={(e) => setAchievedQty(e.target.value)}
                placeholder="0"
              />
            </div>

            {/* QC + CIAG inline — visible when marking the work Completed
                so the field user can record the full closing state in one
                form. Backend accepts these as long as tl_status is
                Completed (no need to wait for IM confirmation). When the
                plan has the corresponding _required flag turned off (set
                by IM/PM at planning), we omit that control entirely. */}
            {execStatus === "Completed" && (
              <>
                {!isNotRequired(plan?.qc_required) && (
                  <div className="exec-field">
                    <label>QC Status *</label>
                    <select value={qcStatus} onChange={(e) => setQcStatus(e.target.value)} required>
                      {["Pending", "Pass", "Fail"].map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                )}
                {!isNotRequired(plan?.ciag_required) && (
                  <div className="exec-field">
                    <label>CIAG Status *</label>
                    <select value={ciagStatus} onChange={(e) => setCiagStatus(e.target.value)} required>
                      {["Open", "In Progress", "Submitted", "Approved", "Rejected", "N/A"].map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                )}
              </>
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

          {/* ── Team Lead Remark ─────────────────────────────── */}
          <div className="exec-section">
            <div className="exec-section-title">Team Lead Remark</div>

            {/* Selected remarks render as chips above the picker.
                Each chip is removable so a wrong pick is one tap to undo. */}
            {tlRemarkPicked.size > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                {Array.from(tlRemarkPicked).map((txt) => (
                  <span
                    key={txt}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 6,
                      padding: "5px 10px", borderRadius: 999,
                      background: "rgba(37,99,235,0.1)", color: "#1d4ed8",
                      border: "1px solid #bfdbfe",
                      fontSize: "0.78rem", fontWeight: 600,
                    }}
                  >
                    {txt}
                    <button
                      type="button"
                      onClick={() => toggleTlRemark(txt)}
                      title="Remove"
                      style={{
                        background: "none", border: "none", padding: 0,
                        cursor: "pointer", color: "#1d4ed8", fontSize: 16,
                        lineHeight: 1, marginLeft: 2,
                      }}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Searchable picker. Type to filter. If no template matches
                the typed text, a "+ Add" row appears at the end of the
                list and tapping it creates a new template + auto-picks
                it. Picked templates are hidden from the dropdown. */}
            <TlRemarkPicker
              templates={tlRemarkTemplates}
              picked={tlRemarkPicked}
              creating={newTemplateBusy}
              onPick={(text) => toggleTlRemark(text)}
              onCreate={async (text) => {
                setNewTemplateText(text);
                setNewTemplateBusy(true); setNewTemplateErr(null);
                try {
                  const created = await pmApi.createFieldRemarkTemplate(text);
                  const list = await pmApi.listFieldRemarkTemplates();
                  setTlRemarkTemplates(Array.isArray(list) ? list : []);
                  const key = (created && created.remark_text) || text;
                  setTlRemarkPicked((prev) => { const n = new Set(prev); n.add(key); return n; });
                } catch (err) {
                  setNewTemplateErr(err.message || "Could not create template.");
                } finally {
                  setNewTemplateBusy(false);
                }
              }}
            />
            {newTemplateErr && (
              <div style={{ color: "#b91c1c", fontSize: "0.74rem", marginTop: 6 }}>{newTemplateErr}</div>
            )}

            {/* Free-text extras for anything not in the list */}
            <div className="exec-field" style={{ marginTop: 12, marginBottom: 0 }}>
              <label style={{ fontSize: "0.74rem", color: "var(--text-muted)" }}>Extra notes (optional)</label>
              <textarea
                value={tlRemarkExtra}
                onChange={(e) => setTlRemarkExtra(e.target.value)}
                placeholder="Anything specific not in the list…"
                rows={2}
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
                  multiple
                  onChange={(e) => {
                    Array.from(e.target.files || []).forEach((f) => uploadAttachment(f));
                    e.target.value = "";
                  }}
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
