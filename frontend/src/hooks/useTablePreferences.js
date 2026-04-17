import { useMemo, useRef } from "react";
import { pmApi } from "../services/api";

export default function useTablePreferences() {
  const cacheRef = useRef(new Map());
  const timersRef = useRef(new Map());

  const api = useMemo(() => ({
    async load(tableId) {
      if (!tableId) return {};
      if (cacheRef.current.has(tableId)) return cacheRef.current.get(tableId) || {};
      try {
        const data = await pmApi.getTablePreferences(tableId);
        const safe = data && typeof data === "object" ? data : {};
        cacheRef.current.set(tableId, safe);
        return safe;
      } catch {
        return {};
      }
    },

    saveDebounced(tableId, config, delay = 450) {
      if (!tableId) return;
      cacheRef.current.set(tableId, config || {});
      const old = timersRef.current.get(tableId);
      if (old) clearTimeout(old);
      const timer = setTimeout(async () => {
        try {
          await pmApi.saveTablePreferences(tableId, config || {});
        } catch {
          // non-blocking for UX
        }
      }, delay);
      timersRef.current.set(tableId, timer);
    },

    /** Persist now (e.g. column resize) so a quick refresh does not lose widths. */
    saveImmediate(tableId, config) {
      if (!tableId) return Promise.resolve();
      const old = timersRef.current.get(tableId);
      if (old) clearTimeout(old);
      timersRef.current.delete(tableId);
      const payload = config || {};
      cacheRef.current.set(tableId, payload);
      return pmApi.saveTablePreferences(tableId, payload).catch(() => {});
    },
  }), []);

  return api;
}
