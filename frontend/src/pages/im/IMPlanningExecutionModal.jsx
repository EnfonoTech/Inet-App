import { useEffect, useState } from "react";
import { pmApi } from "../../services/api";
import { fetchPortalSession, getCsrf } from "../../services/api";
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
    } catch {
      /* newline fallback */
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

export default function IMPlanningExecutionModal({ open, onClose, selectedPlan, onSubmitted }) {
  const rolloutPlan = selectedPlan?.name || "";
  const [execStatus, setExecStatus] = useState("In Progress");
  const [achievedQty, setAchievedQty] = useState("");
  const [gpsLocation, setGpsLocation] = useState("");
  const [remarks, setRemarks] = useState("");
  const [activityCode, setActivityCode] = useState("");
  const [activityCost, setActivityCost] = useState(null);
  const [activities, setActivities] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [attachmentErr, setAttachmentErr] = useState(null);
  const [capturingGps, setCapturingGps] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  useEffect(() => {
    if (!open) return;
    pmApi.listActivityCosts().then((res) => setActivities(res || [])).catch(() => setActivities([]));
  }, [open]);

  useEffect(() => {
    if (!open) {
      setExecStatus("In Progress");
      setAchievedQty("");
      setGpsLocation("");
      setRemarks("");
      setActivityCode("");
      setActivityCost(null);
      setAttachments([]);
      setAttachmentErr(null);
      setSubmitError(null);
      return;
    }
    setSubmitError(null);
  }, [open]);

  useEffect(() => {
    if (!open || !rolloutPlan) return;
    let cancelled = false;
    pmApi.getFieldExecutionForRollout(rolloutPlan).then((ex) => {
      if (cancelled) return;
      setAttachments(ex ? parsePhotoList(ex.photos) : []);
    }).catch(() => {
      if (!cancelled) setAttachments([]);
    });
    return () => { cancelled = true; };
  }, [open, rolloutPlan]);

  /** Merge list row with full Rollout Plan (get_list) so qty-style fields exist for auto achieved qty. */
  useEffect(() => {
    if (!open || !selectedPlan?.name) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await pmApi.listRolloutPlans({ name: selectedPlan.name });
        const full = Array.isArray(list) && list.length > 0 ? list[0] : null;
        if (cancelled) return;
        const merged = full ? { ...selectedPlan, ...full } : selectedPlan;
        setAchievedQty(defaultAchievedQtyFromPlan(merged));
      } catch {
        if (!cancelled) setAchievedQty(defaultAchievedQtyFromPlan(selectedPlan));
      }
    })();
    return () => { cancelled = true; };
  }, [open, selectedPlan?.name]);

  function handleActivityChange(code) {
    setActivityCode(code);
    if (code) {
      const found = activities.find((a) => a.name === code);
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
    if (!rolloutPlan) {
      setSubmitError("No plan selected. Close and select a row in the table.");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const payload = {
        rollout_plan: rolloutPlan,
        execution_status: execStatus,
        achieved_qty: parseFloat(achievedQty) || 0,
        gps_location: gpsLocation,
        remarks,
        activity_code: activityCode || undefined,
        photos: attachments.length ? attachments.join("\n") : undefined,
      };
      await pmApi.updateExecution(payload);
      onSubmitted?.();
      onClose();
    } catch (err) {
      setSubmitError(err.message || "Failed to submit execution update");
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
      onClick={onClose}
      onKeyDown={(ev) => ev.key === "Escape" && onClose()}
      role="presentation"
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 12,
          padding: 20,
          width: "min(560px, 100%)",
          maxHeight: "90vh",
          overflow: "auto",
          boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)",
        }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="im-exec-modal-title"
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 id="im-exec-modal-title" style={{ margin: 0, fontSize: "1.05rem" }}>
            Record execution
          </h3>
          <button type="button" onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#94a3b8", lineHeight: 1 }} aria-label="Close">
            &times;
          </button>
        </div>

        {!selectedPlan?.name ? (
          <div className="notice info" style={{ marginBottom: 12 }}>
            <span>&#x2139;</span> No plan selected. Close, select exactly one eligible plan with the checkboxes, then open Record execution again.
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div style={{ fontSize: "0.8rem", color: "#334155", marginBottom: 14, padding: "10px 12px", background: "#f1f5f9", borderRadius: 8, border: "1px solid #e2e8f0" }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Selected plan</div>
              <div style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{selectedPlan.name}</div>
              <div style={{ marginTop: 6, color: "#64748b" }}>
                {selectedPlan.po_dispatch || "—"} · {selectedPlan.team || "—"} · {selectedPlan.site_code || "—"} · {selectedPlan.plan_status}
              </div>
              <div style={{ marginTop: 6 }}>
                {selectedPlan.visit_type || "—"} · {selectedPlan.plan_date || "—"} · PO {selectedPlan.po_no || "—"}
              </div>
            </div>

            <div className="form-grid two-col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 14px" }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label>Execution status *</label>
                <select value={execStatus} onChange={(e) => setExecStatus(e.target.value)} required>
                  {EXECUTION_STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label>Achieved qty</label>
                <input type="number" min="0" step="0.01" value={achievedQty} onChange={(e) => setAchievedQty(e.target.value)} placeholder="0" />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label>Activity code</label>
                <select value={activityCode} onChange={(e) => handleActivityChange(e.target.value)}>
                  <option value="">— None —</option>
                  {activities.map((a) => (
                    <option key={a.name} value={a.name}>
                      {a.activity_code} — {a.standard_activity}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label>Activity cost (SAR)</label>
                <input
                  type="text"
                  readOnly
                  value={activityCost != null ? `SAR ${Number(activityCost).toLocaleString()}` : "N/A"}
                  style={{ background: "#f1f5f9", color: "#64748b" }}
                />
              </div>
            </div>

            <div className="form-group" style={{ marginTop: 12 }}>
              <label>GPS location</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="text"
                  value={gpsLocation}
                  onChange={(e) => setGpsLocation(e.target.value)}
                  placeholder="lat, lng — or capture"
                  style={{ flex: 1 }}
                />
                <button type="button" className="btn-secondary" onClick={captureGPS} disabled={capturingGps}>
                  {capturingGps ? "…" : "Capture GPS"}
                </button>
              </div>
            </div>

            <div className="form-group">
              <label>Remarks</label>
              <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={3} placeholder="Notes…" />
            </div>

            <div className="form-group">
              <label>Attachments</label>
              <input type="file" onChange={(e) => uploadAttachment(e.target.files?.[0])} disabled={attachmentBusy} />
              {attachmentBusy && <span style={{ fontSize: "0.82rem", color: "#64748b", marginLeft: 8 }}>Uploading…</span>}
              {attachmentErr && <div style={{ marginTop: 6, fontSize: "0.82rem", color: "#b91c1c" }}>{attachmentErr}</div>}
              {attachments.length > 0 && (
                <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: "0.82rem" }}>
                  {attachments.map((url, idx) => (
                    <li key={`${url}-${idx}`} style={{ marginBottom: 4 }}>
                      <a href={url} target="_blank" rel="noreferrer">{url}</a>
                      {" "}
                      <button type="button" className="btn-secondary" style={{ fontSize: "0.7rem", padding: "2px 6px" }} onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== idx))}>
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {execStatus === "Completed" && (
              <div className="notice info" style={{ marginBottom: 12, fontSize: "0.82rem" }}>
                After Completed, set QC from the Execution screen when the team is ready.
              </div>
            )}

            {submitError && (
              <div className="notice error" style={{ marginBottom: 12 }}>
                <span>⊕</span> {submitError}
              </div>
            )}

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
              <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={submitting || !rolloutPlan}>
                {submitting ? "Submitting…" : "Submit execution"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
