import { useMemo } from "react";
import { pmApi } from "../services/api";

/**
 * Module-level singleton so every mounted DataTablePro instance shares one
 * cache + one in-flight prefetch. Without this, remounting a page would
 * refetch prefs per-table on every navigation.
 */
const _cache = new Map();          // tableId -> config
const _timers = new Map();         // tableId -> debounce timer
let _prefetchPromise = null;       // shared in-flight bulk load
let _prefetchDone = false;

function _startPrefetch() {
  if (_prefetchDone || _prefetchPromise) return _prefetchPromise;
  _prefetchPromise = pmApi.getAllTablePreferences()
    .then((all) => {
      if (all && typeof all === "object") {
        for (const [k, v] of Object.entries(all)) {
          if (typeof k === "string" && v && typeof v === "object") {
            _cache.set(k, v);
          }
        }
      }
      _prefetchDone = true;
      return _cache;
    })
    .catch(() => {
      _prefetchDone = true; // degrade gracefully — individual loads will still work
      return _cache;
    });
  return _prefetchPromise;
}

/** Kick off the bulk prefetch (call from app boot to warm the cache). */
export function prefetchTablePreferences() {
  return _startPrefetch();
}

export default function useTablePreferences() {
  const api = useMemo(() => ({
    async load(tableId) {
      if (!tableId) return {};
      // If the prefetch is still in flight, wait for it — still ONE network
      // call rather than N per-table calls.
      if (!_prefetchDone) {
        try { await _startPrefetch(); } catch { /* ignore */ }
      }
      if (_cache.has(tableId)) return _cache.get(tableId) || {};
      // Fallback: specific tableId not in bulk response (fresh save etc.)
      try {
        const data = await pmApi.getTablePreferences(tableId);
        const safe = data && typeof data === "object" ? data : {};
        _cache.set(tableId, safe);
        return safe;
      } catch {
        return {};
      }
    },

    saveDebounced(tableId, config, delay = 450) {
      if (!tableId) return;
      _cache.set(tableId, config || {});
      const old = _timers.get(tableId);
      if (old) clearTimeout(old);
      const timer = setTimeout(async () => {
        try {
          await pmApi.saveTablePreferences(tableId, config || {});
        } catch {
          // non-blocking for UX
        }
      }, delay);
      _timers.set(tableId, timer);
    },

    /** Persist now (e.g. column resize) so a quick refresh does not lose widths. */
    saveImmediate(tableId, config) {
      if (!tableId) return Promise.resolve();
      const old = _timers.get(tableId);
      if (old) clearTimeout(old);
      _timers.delete(tableId);
      const payload = config || {};
      _cache.set(tableId, payload);
      return pmApi.saveTablePreferences(tableId, payload).catch(() => {});
    },
  }), []);

  return api;
}
