// Week maths shared by the dispatch forecast picker, the forecast grid and
// anything else that has to agree with the server's week anchor.
//
// The working week is SATURDAY to FRIDAY. The business runs in KSA, where
// Saturday opens the week and Friday is the holiday. The server anchors the
// same way (_week_start / _week_start_sql in command_center.py); these must
// not drift apart, or a line lands in one week on screen and another in the
// weekly reports.
//
// Everything here formats from LOCAL date components. Never use
// toISOString() on a locally-constructed Date: it converts to UTC first, so
// on any browser east of UTC (Riyadh +3, IST +5:30) local midnight
// serialises as the PREVIOUS day — which is exactly how the week pager used
// to shed a day per click (fixed in fdccc85 by routing it through here).

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

/**
 * Saturday that opens the working week containing `d`, at local midnight.
 *
 * getDay() is Sunday 0 .. Saturday 6, so the distance back to Saturday is
 * (getDay() + 1) % 7 — 0 on a Saturday, 6 on a Friday.
 */
export function weekStartOfLocal(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 1) % 7));
  return x;
}

/** Parse "YYYY-MM-DD" as a LOCAL date (not UTC, which `new Date(str)` gives). */
export function parseLocal(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

/** { start, end } ISO strings for the week whose Saturday is `isoStart`. */
export function weekBoundsOf(isoStart) {
  const m = parseLocal(isoStart);
  if (!m) return { start: "", end: "" };
  const s = new Date(m);
  s.setDate(s.getDate() + 6);
  return { start: isoLocal(m), end: isoLocal(s) };
}

const fmtDay = (d) => d.toLocaleDateString("en", { month: "short", day: "numeric" });

/** "Oct 3 – Oct 9" for the week starting at `isoStart`. */
export function weekRangeLabel(isoStart) {
  const m = parseLocal(isoStart);
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
 * { id (the Saturday), label, start, end }.
 *
 * Enumeration starts at the Saturday of the 1st, so W1 often begins in the
 * previous month, and includes the week containing the last day, so the final
 * week may end in the next one. The server validates by the same overlap rule
 * — requiring the start to sit inside the month would make W1 unselectable in
 * 6 months out of 7. The labels carry real dates, so "W1 · Aug 29 – Sep 4"
 * says plainly which week was picked.
 */
export function weekOptionsForMonth(ym) {
  if (!ym) return [];
  const [y, m] = String(ym).slice(0, 7).split("-").map(Number);
  if (!y || !m) return [];
  const last = new Date(y, m, 0); // local last day of the month
  const out = [];
  let cur = weekStartOfLocal(new Date(y, m - 1, 1));
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
