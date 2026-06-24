/**
 * Sync server time once at login so accessTimeBadge uses KSA wall-clock regardless
 * of the browser's local timezone (e.g. browser in IST, server in KSA/UTC+3).
 *
 * _skewMs      = server_now_ms - Date.now() at sync time
 * _utcOffsetMs = server's UTC offset in ms (e.g. +10800000 for UTC+3)
 */

let _skewMs = 0;
let _utcOffsetMs = 0;

export async function syncServerTime(api) {
  try {
    const res = await api.getServerNow();
    if (res && res.server_now_ms != null) {
      _skewMs = res.server_now_ms - Date.now();
    }
    if (res && res.utc_offset_ms != null) {
      _utcOffsetMs = res.utc_offset_ms;
    }
  } catch (_) {
    // Non-fatal: badge falls back to browser time
  }
}

/** Server's current UTC epoch ms (corrected for clock skew). */
export function serverNow() {
  return Date.now() + _skewMs;
}

/** Server's UTC offset in ms (e.g. 10800000 for UTC+3 / KSA). */
export function serverUtcOffsetMs() {
  return _utcOffsetMs;
}
