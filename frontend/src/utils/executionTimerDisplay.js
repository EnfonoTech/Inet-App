/**
 * Server sends start_time_ms / server_time_ms (UTC epoch ms from site timezone).
 * skewMs = server_time_ms - Date.now() at receive time → estimated server "now" on each tick.
 */

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
  const serverNow = Date.now() + (skewMs || 0);
  return Math.max(0, Math.floor((serverNow - startTimeMs) / 1000));
}
