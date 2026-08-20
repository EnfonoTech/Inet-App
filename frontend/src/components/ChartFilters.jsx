/**
 * Filters that belong to a single chart, sitting in that chart's own header.
 *
 * Deliberately NOT the shared `DateRangePicker`: these charts are bucketed by
 * month, and a day-granularity picker ("Yesterday", "Last 7 Days") offers
 * ranges that collapse to one bar or none. Each chart owns its filter so
 * changing one never re-scopes the other.
 */

const BTN = {
  padding: "4px 9px",
  borderRadius: 6,
  border: "1px solid #e2e8f0",
  background: "#fff",
  color: "#64748b",
  fontSize: "0.72rem",
  fontWeight: 700,
  cursor: "pointer",
  whiteSpace: "nowrap",
  lineHeight: 1.5,
};

const BTN_ON = {
  ...BTN,
  background: "#e8f0fe",
  borderColor: "#c3d9f7",
  color: "#1565C0",
  cursor: "default",
};

/** "2026-08" -> "2026-08-01"; the backend snaps the end bound to month-end. */
function ymToDate(ym) {
  return ym ? `${ym}-01` : "";
}

/** "2026-08-01" -> "2026-08" */
function dateToYm(d) {
  return d ? String(d).slice(0, 7) : "";
}

/** N months back from the current month, as YYYY-MM. */
function ymBack(n) {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Trailing-span filter emitting a date range, for a multi-year monthly chart.
 *
 * Spans only — no free-form month inputs. A trailing window is the question
 * being asked of a trend ("how do the last 6 months look"), and every span is
 * one click instead of two date pickers.
 *
 * value    — { from, to } as ISO dates (empty strings = all time)
 * onChange — ({ from, to }) => void
 */
export function MonthRangeFilter({ value, onChange, spans = [3, 6, 9, 12, 18, 24] }) {
  const from = dateToYm(value?.from);
  const to = dateToYm(value?.to);
  const isAll = !from && !to;
  const activeSpan = spans.find((n) => from === ymBack(n - 1) && !to);

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
      <button type="button" style={isAll ? BTN_ON : BTN} disabled={isAll}
        onClick={() => onChange?.({ from: "", to: "" })}>
        All time
      </button>
      {spans.map((n) => (
        <button key={n} type="button"
          style={activeSpan === n ? BTN_ON : BTN}
          disabled={activeSpan === n}
          onClick={() => onChange?.({ from: ymToDate(ymBack(n - 1)), to: "" })}>
          {n}M
        </button>
      ))}
    </div>
  );
}

/**
 * "Trailing N months" filter — the natural control for a rolling-window chart,
 * where an arbitrary start month isn't the question being asked.
 *
 * value    — number of months; 0 means all time (the backend treats months=0
 *            with no date range as the full history)
 * onChange — (months) => void
 */
export function MonthsBackFilter({ value, onChange, options = [3, 6, 9, 12, 18, 24] }) {
  const isAll = !Number(value);
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
      <button type="button" style={isAll ? BTN_ON : BTN} disabled={isAll}
        onClick={() => onChange?.(0)}>
        All time
      </button>
      {options.map((n) => (
        <button key={n} type="button"
          style={Number(value) === n ? BTN_ON : BTN}
          disabled={Number(value) === n}
          onClick={() => onChange?.(n)}>
          {n}M
        </button>
      ))}
    </div>
  );
}
