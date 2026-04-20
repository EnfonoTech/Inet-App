import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

/** Sentinel: no server row cap (API uses 0 as unlimited). */
export const TABLE_ROW_LIMIT_ALL = 0;
export const TABLE_ROW_LIMIT_PRESETS = [20, 100, 500, 2500, TABLE_ROW_LIMIT_ALL];
export const TABLE_ROW_LIMIT_DEFAULT = 20;

/**
 * Row-limit is per-path and session-scoped. First visit to any path loads the
 * smallest preset (20) so the first paint is fast. If the user bumps the limit,
 * that choice is remembered for that path for the life of the tab. A full page
 * reload resets all paths to 20 — the "load faster on first paint" bias.
 */
const STORAGE_KEY = "inet_pms_table_row_limit_by_path";
const LEGACY_GLOBAL_KEY = "inet_pms_table_row_limit";

const TableRowLimitContext = createContext(null);

function normalizeStored(n) {
  const v = Number(n);
  if (v === 10000) return TABLE_ROW_LIMIT_ALL;
  return TABLE_ROW_LIMIT_PRESETS.includes(v) ? v : TABLE_ROW_LIMIT_DEFAULT;
}

export function TableRowLimitProvider({ children }) {
  const { pathname } = useLocation();

  const [limitByPath, setLimitByPath] = useState(() => {
    // One-time cleanup of the old cross-page global key.
    try { localStorage.removeItem(LEGACY_GLOBAL_KEY); } catch { /* ignore */ }
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const obj = JSON.parse(raw);
        if (obj && typeof obj === "object") return obj;
      }
    } catch { /* ignore */ }
    return {};
  });

  const rowLimit = pathname in limitByPath
    ? normalizeStored(limitByPath[pathname])
    : TABLE_ROW_LIMIT_DEFAULT;

  const setRowLimit = useCallback((next) => {
    const v = normalizeStored(next);
    setLimitByPath((prev) => {
      const updated = { ...prev, [pathname]: v };
      try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(updated)); } catch { /* ignore */ }
      return updated;
    });
  }, [pathname]);

  const value = useMemo(() => ({ rowLimit, setRowLimit }), [rowLimit, setRowLimit]);

  return <TableRowLimitContext.Provider value={value}>{children}</TableRowLimitContext.Provider>;
}

export function useTableRowLimit() {
  const ctx = useContext(TableRowLimitContext);
  if (!ctx) {
    throw new Error("useTableRowLimit must be used within TableRowLimitProvider");
  }
  return ctx;
}

/**
 * Run a reset callback synchronously during render whenever the row limit for
 * the current path changes. Using the "setState during render" pattern lets
 * callers clear stale data + flip loading to true BEFORE the browser paints
 * the first frame with the new limit, eliminating the "old rows flash"
 * users would otherwise see before the refetch completes.
 *
 * The callback should only call plain setState updaters (never fetch here).
 */
export function useResetOnRowLimitChange(reset) {
  const { rowLimit } = useTableRowLimit();
  const prevRef = useRef(rowLimit);
  if (prevRef.current !== rowLimit) {
    const prev = prevRef.current;
    prevRef.current = rowLimit;
    try {
      reset(rowLimit, prev);
    } catch {
      /* caller's setters must never throw; ignore defensively */
    }
  }
}
