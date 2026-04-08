import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { pmApi } from "../services/api";
import {
  elapsedSecondsFromServerEpoch,
  formatElapsedSeconds,
  makeSkewMs,
} from "../utils/executionTimerDisplay";

/**
 * Sticky bar (Next PMS–style) when a field user has a running execution timer.
 */
export default function FieldGlobalTimerBar({ role }) {
  const navigate = useNavigate();
  const [running, setRunning] = useState(null);
  const skewRef = useRef(0);
  const [, tick] = useState(0);
  const baseElapsedRef = useRef(0);
  const baseAtRef = useRef(0);

  useEffect(() => {
    if (role !== "field") return undefined;
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
          return;
        }
        setRunning(null);
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
    if (!running?.log_name) return undefined;
    const id = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, [running?.log_name]);

  async function handleStop() {
    if (!running?.log_name) return;
    try {
      await pmApi.stopExecutionTimer(running.log_name);
      setRunning(null);
    } catch {
      /* ignore */
    }
  }

  if (role !== "field" || !running?.log_name) return null;

  const sec =
    running?.start_time_ms != null
      ? elapsedSecondsFromServerEpoch(running.start_time_ms, skewRef.current)
      : baseElapsedRef.current + Math.max(0, Math.floor((Date.now() - baseAtRef.current) / 1000));

  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 12,
        padding: "10px 20px",
        background: "linear-gradient(90deg, #0f172a 0%, #1e3a5f 50%, #0f172a 100%)",
        borderBottom: "1px solid rgba(99,102,241,0.45)",
        boxShadow: "0 4px 14px rgba(15,23,42,0.35)",
      }}
    >
      <span style={{ fontSize: "0.65rem", fontWeight: 800, color: "#94a3b8", letterSpacing: "0.12em" }}>
        TIMER
      </span>
      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "1.35rem", fontWeight: 700, color: "#7dd3fc", minWidth: "7.5ch" }}>
        {formatElapsedSeconds(sec)}
      </span>
      <span style={{ fontSize: "0.8rem", color: "#e2e8f0", flex: "1 1 160px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {running.item_description || running.rollout_plan}
      </span>
      <button
        type="button"
        className="btn-secondary"
        style={{ fontSize: "0.78rem", padding: "6px 12px", borderColor: "#64748b", color: "#e2e8f0" }}
        onClick={() => navigate(`/field-execute/${running.rollout_plan}`)}
      >
        Open execution
      </button>
      <button
        type="button"
        className="btn-primary"
        style={{ fontSize: "0.78rem", padding: "6px 14px", background: "#dc2626", borderColor: "#dc2626" }}
        onClick={handleStop}
      >
        Stop
      </button>
    </div>
  );
}
