// Week maths shared by the dispatch forecast picker, the forecast grid and
// anything else that has to agree with the server's Monday anchor.
//
// Everything here formats from LOCAL date components. Never use
// toISOString() on a locally-constructed Date: it converts to UTC first, so
// on any browser east of UTC (Riyadh +3, IST +5:30) local midnight
// serialises as the PREVIOUS day. That is the live bug in
// RolloutWeeklyPlan.jsx's week pager, where each click drifts the anchor a
// day and the first click is a no-op — masked only because the label is
// rendered from the server's snapped bounds.

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "YYYY-MM-DD" from local components. */
export function isoLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/** Monday of the week containing `d`, at local midnight. */
export function mondayOfLocal(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

/** Parse "YYYY-MM-DD" as a LOCAL date (not UTC, which `new Date(str)` gives). */
export function parseLocal(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

/** { start, end } ISO strings for the week whose Monday is `isoMonday`. */
export function weekBoundsOf(isoMonday) {
  const m = parseLocal(isoMonday);
  if (!m) return { start: "", end: "" };
  const s = new Date(m);
  s.setDate(s.getDate() + 6);
  return { start: isoLocal(m), end: isoLocal(s) };
}

const fmtDay = (d) => d.toLocaleDateString("en", { month: "short", day: "numeric" });

/** "Oct 5 – Oct 11" for the week starting at `isoMonday`. */
export function weekRangeLabel(isoMonday) {
  const m = parseLocal(isoMonday);
  if (!m) return "";
  const s = new Date(m);
  s.setDate(s.getDate() + 6);
  return `${fmtDay(m)} – ${fmtDay(s)}`;
}

export function monthLabel(ym) {
  if (!ym) return "";
  const [y, m] = String(ym).split("-").map(Number);
  return MONTH_NAMES[m - 1] ? `${MONTH_NAMES[m - 1]} ${y}` : String(ym);
}

/**
 * Every week that OVERLAPS the given month, as
 * { id (the Monday), label, start, end }.
 *
 * Enumeration starts at the Monday of the 1st, so W1 often begins in the
 * previous month, and includes the week containing the last day, so the final
 * week may end in the next one. The server validates by the same overlap rule
 * — requiring the Monday to sit inside the month would make W1 unselectable
 * in 6 months out of 7. The labels carry real dates, so "W1 · Aug 31 – Sep 6"
 * says plainly which week was picked.
 */
export function weekOptionsForMonth(ym) {
  if (!ym) return [];
  const [y, m] = String(ym).slice(0, 7).split("-").map(Number);
  if (!y || !m) return [];
  const last = new Date(y, m, 0); // local last day of the month
  const out = [];
  let cur = mondayOfLocal(new Date(y, m - 1, 1));
  let i = 1;
  while (cur <= last) {
    const sun = new Date(cur);
    sun.setDate(sun.getDate() + 6);
    out.push({
      id: isoLocal(cur),
      label: `W${i} · ${fmtDay(cur)} – ${fmtDay(sun)}`,
      start: isoLocal(cur),
      end: isoLocal(sun),
    });
    cur = new Date(cur);
    cur.setDate(cur.getDate() + 7);
    i += 1;
  }
  return out;
}
