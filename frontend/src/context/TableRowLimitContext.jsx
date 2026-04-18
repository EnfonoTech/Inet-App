import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

/** Sentinel: no server row cap (API uses 0 as unlimited). */
export const TABLE_ROW_LIMIT_ALL = 0;
export const TABLE_ROW_LIMIT_PRESETS = [20, 100, 500, 2500, TABLE_ROW_LIMIT_ALL];

const STORAGE_KEY = "inet_pms_table_row_limit";

const TableRowLimitContext = createContext(null);

function normalizeStored(n) {
  const v = Number(n);
  if (v === 10000) return TABLE_ROW_LIMIT_ALL;
  return TABLE_ROW_LIMIT_PRESETS.includes(v) ? v : 20;
}

export function TableRowLimitProvider({ children }) {
  const [rowLimit, setRowLimitState] = useState(() => {
    try {
      return normalizeStored(localStorage.getItem(STORAGE_KEY));
    } catch {
      return 20;
    }
  });

  const setRowLimit = useCallback((next) => {
    const v = normalizeStored(next);
    setRowLimitState(v);
    try {
      localStorage.setItem(STORAGE_KEY, String(v));
    } catch {
      /* ignore */
    }
  }, []);

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
 * Run a reset callback synchronously during render whenever the global
 * row limit changes. Using the "setState during render" pattern lets
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
