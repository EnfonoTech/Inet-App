import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { pmApi } from "../services/api";
import {
  elapsedSecondsFromServerEpoch,
  formatElapsedSeconds,
  makeSkewMs,
} from "../utils/executionTimerDisplay";

function SingleTimerStrip({ timer, onStop }) {
  const navigate = useNavigate();
  const [stopping, setStopping] = useState(false);
  const skewRef = useRef(0);
  const [, tick] = useState(0);

  useEffect(() => {
    if (timer?.server_time_ms != null) skewRef.current = makeSkewMs(timer.server_time_ms);
  }, [timer?.log_name, timer?.server_time_ms]);

  useEffect(() => {
    if (!timer?.log_name) return;
    const id = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, [timer?.log_name]);

  async function handleStop(e) {
    e.stopPropagation();
    if (stopping) return;
    setStopping(true);
    try {
      await pmApi.stopExecutionTimer(timer.log_name);
      onStop(timer.log_name);
      window.dispatchEvent(new Event("inet-timer-changed"));
    } catch { /* ignore */ }
    finally { setStopping(false); }
  }

  const sec = timer?.start_time_ms != null
    ? elapsedSecondsFromServerEpoch(timer.start_time_ms, skewRef.current)
    : (timer?.elapsed_seconds ?? 0);

  const label = timer.item_description || timer.rollout_plan || "";

  return (
    <div
      className="field-timer-strip"
      onClick={() => navigate(`/field-execute/${encodeURIComponent(timer.rollout_plan)}`)}
      title={`Go to execution · ${label}`}
    >
      <span className="field-timer-dot" />
      <span className="field-timer-clock">{formatElapsedSeconds(sec)}</span>
      {label && <span className="field-timer-label">{label}</span>}
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

export default function FieldGlobalTimerBar({ role }) {
  const [timers, setTimers] = useState([]);

  useEffect(() => {
    if (role !== "field") return;
    let cancelled = false;

    async function poll() {
      try {
        const res = await pmApi.getRunningExecutionTimer();
        if (!cancelled) setTimers(Array.isArray(res) ? res : (res?.log_name ? [res] : []));
      } catch {
        if (!cancelled) setTimers([]);
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

  function handleStop(logName) {
    setTimers((prev) => prev.filter((t) => t.log_name !== logName));
  }

  if (role !== "field" || timers.length === 0) return null;

  return (
    <>
      {timers.map((t) => (
        <SingleTimerStrip key={t.log_name} timer={t} onStop={handleStop} />
      ))}
    </>
  );
}
