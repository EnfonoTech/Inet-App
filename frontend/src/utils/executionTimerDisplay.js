/**
 * Server sends start_time_ms / server_time_ms (UTC epoch ms from site timezone).
 * skewMs = server_time_ms - Date.now() at receive time → estimated server "now" on each tick.
 */

import { serverNow, serverUtcOffsetMs } from "./serverTime";

export function formatElapsedSeconds(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const x = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}`;
}

export function makeSkewMs(serverTimeMs) {
  if (serverTimeMs == null || Number.isNaN(serverTimeMs)) return 0;
  return serverTimeMs - Date.now();
}

export function elapsedSecondsFromServerEpoch(startTimeMs, skewMs) {
  if (startTimeMs == null || Number.isNaN(startTimeMs)) return 0;
  const serverNowMs = Date.now() + (skewMs || 0);
  return Math.max(0, Math.floor((serverNowMs - startTimeMs) / 1000));
}

/**
 * Compute access status badge for PM/IM monitors.
 *
 * access_time   – "HH:MM:SS" from Frappe Time field (or null)
 * access_period – "Day" | "Night" | null
 * timer_start_ms – epoch ms of earliest TL timer today (or null/undefined); must be
 *                  a server-epoch number, NOT a raw datetime string.
 * tl_status     – current tl_status string from Daily Execution
 *
 * Returns { label, color, bg } or null if no access_time set.
 *
 * Uses serverNow() + serverUtcOffsetMs() so the badge is always in the server's
 * timezone (KSA/UTC+3) regardless of where the browser is (e.g. IST/UTC+5:30).
 */
export function accessTimeBadge(access_time, access_period, timer_start_ms, tl_status, plan_date) {
  if (!access_time) return null;

  const [h, m] = access_time.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return null;

  const nowMs = serverNow();
  const offsetMs = serverUtcOffsetMs();

  // Midnight in server timezone expressed as UTC epoch ms
  const midnightMs = Math.floor((nowMs + offsetMs) / 86400000) * 86400000 - offsetMs;
  const scheduledMs = midnightMs + h * 3600000 + m * 60000;

  const periodSuffix = access_period ? ` · ${access_period}` : "";
  const schedLabel = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}${periodSuffix}`;

  function fmtMins(mins) {
    if (mins >= 60) return `${Math.floor(mins / 60)}h ${mins % 60}m`;
    return `${mins}m`;
  }

  // Only show "Not on site" / "Due now" for today's plans.
  // Past and future plans just show the grey scheduled time.
  if (plan_date) {
    const todayStr = new Date(nowMs + offsetMs).toISOString().slice(0, 10);
    if (plan_date !== todayStr) return { label: schedLabel, bg: "#f8fafc", color: "#64748b" };
  }

  // Has TL started? — exact start from timer (epoch ms), or inferred from tl_status
  const tlStarted = timer_start_ms != null || ["In Progress", "Completed"].includes(tl_status);

  if (tlStarted) {
    if (timer_start_ms != null) {
      const lateMs = timer_start_ms - scheduledMs;
      const lateMins = Math.round(lateMs / 60000);
      if (lateMins <= 5) return { label: `On Site ✓${periodSuffix}`, bg: "#ecfdf5", color: "#047857" };
      return { label: `Arrived · ${fmtMins(lateMins)} late${periodSuffix}`, bg: "#fffbeb", color: "#b45309" };
    }
    return { label: `On Site${periodSuffix}`, bg: "#ecfdf5", color: "#047857" };
  }

  // Not started — compare server now vs scheduled time (both in same UTC epoch space)
  const diffMins = Math.round((nowMs - scheduledMs) / 60000);
  if (diffMins < -1) return { label: schedLabel, bg: "#f8fafc", color: "#64748b" };
  if (diffMins <= 5) return { label: `Due now${periodSuffix}`, bg: "#fef3c7", color: "#d97706" };
  return { label: `Not on site · ${fmtMins(diffMins)}${periodSuffix}`, bg: "#fef2f2", color: "#b91c1c" };
}
