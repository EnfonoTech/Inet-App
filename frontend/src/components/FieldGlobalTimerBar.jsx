import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { pmApi } from "../services/api";
import {
  elapsedSecondsFromServerEpoch,
  formatElapsedSeconds,
  makeSkewMs,
} from "../utils/executionTimerDisplay";

export default function FieldGlobalTimerBar({ role }) {
  const navigate = useNavigate();
  const [running, setRunning] = useState(null);
  const [stopping, setStopping] = useState(false);
  const skewRef = useRef(0);
  const [, tick] = useState(0);
  const baseElapsedRef = useRef(0);
  const baseAtRef = useRef(0);

  useEffect(() => {
    if (role !== "field") return;
    let cancelled = false;

    async function poll() {
      try {
        const r = await pmApi.getRunningExecutionTimer();
        if (cancelled) return;
        if (r?.log_name) {
          if (r.server_time_ms != null) skewRef.current = makeSkewMs(r.server_time_ms);
          if (typeof r.elapsed_seconds === "number") {
            baseElapsedRef.current = r.elapsed_seconds;
            baseAtRef.current = Date.now();
          } else {
            baseElapsedRef.current = 0;
            baseAtRef.current = Date.now();
          }
          setRunning(r);
        } else {
          setRunning(null);
        }
      } catch {
        if (!cancelled) setRunning(null);
      }
    }

    poll();
    const iv = setInterval(poll, 30000);
    const onChanged = () => poll();
    const onVis = () => { if (document.visibilityState === "visible") poll(); };
    window.addEventListener("inet-timer-changed", onChanged);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      clearInterval(iv);
      window.removeEventListener("inet-timer-changed", onChanged);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [role]);

  useEffect(() => {
    if (!running?.log_name) return;
    const id = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, [running?.log_name]);

  async function handleStop(e) {
    e.stopPropagation();
    if (!running?.log_name || stopping) return;
    setStopping(true);
    try {
      await pmApi.stopExecutionTimer(running.log_name);
      setRunning(null);
      window.dispatchEvent(new Event("inet-timer-changed"));
    } catch { /* ignore */ }
    finally { setStopping(false); }
  }

  if (role !== "field" || !running?.log_name) return null;

  const sec =
    running?.start_time_ms != null
      ? elapsedSecondsFromServerEpoch(running.start_time_ms, skewRef.current)
      : baseElapsedRef.current + Math.max(0, Math.floor((Date.now() - baseAtRef.current) / 1000));

  const label = running.item_description || running.rollout_plan || "";

  return (
    <div
      className="field-timer-strip"
      onClick={() => navigate(`/field-execute/${encodeURIComponent(running.rollout_plan)}`)}
      title={`Go to execution · ${label}`}
    >
      {/* Pulsing live dot */}
      <span className="field-timer-dot" />

      {/* Clock */}
      <span className="field-timer-clock">{formatElapsedSeconds(sec)}</span>

      {/* Description — fills available space */}
      {label && (
        <span className="field-timer-label">{label}</span>
      )}

      {/* Stop button */}
      <button
        type="button"
        className="field-timer-stop"
        onClick={handleStop}
        disabled={stopping}
        title="Stop timer"
      >
        {stopping ? (
          <svg viewBox="0 0 20 20" fill="currentColor" width="12" height="12" style={{ animation: "spin 0.7s linear infinite" }}>
            <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1z" clipRule="evenodd" />
          </svg>
        ) : (
          <svg viewBox="0 0 20 20" fill="currentColor" width="12" height="12">
            <rect x="4" y="4" width="12" height="12" rx="2" />
          </svg>
        )}
      </button>
    </div>
  );
}
