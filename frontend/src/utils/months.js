/**
 * Calendar-month helpers for the dashboards' month pickers. Local dates only —
 * never toISOString(), which shifts Riyadh midnight into the previous day.
 */

export function isoMonth(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** "2026-10" -> { from: "2026-10-01", to: "2026-10-31" } */
export function monthBounds(ym) {
  const [y, m] = ym.split("-").map(Number);
  return { from: `${ym}-01`, to: `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}` };
}

export function prevMonth(ym) {
  const [y, m] = ym.split("-").map(Number);
  return isoMonth(new Date(y, m - 2, 1));
}

/** "2026-10" -> "Oct" */
export function shortMonth(ym) {
  return new Date(`${ym}-01T00:00:00`).toLocaleString("en", { month: "short" });
}

/** The last 24 months, newest first, as SearchableSelect options. */
export const MONTH_OPTIONS = (() => {
  const now = new Date();
  return Array.from({ length: 24 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return { id: isoMonth(d), label: d.toLocaleString("en", { month: "long", year: "numeric" }) };
  });
})();
