/* Shared number formatters.
 *
 * Money must never be rounded to whole SAR. Pages used to declare
 * `new Intl.NumberFormat("en", { maximumFractionDigits: 0 })` and put money
 * through it, which does not round to cents — it discards the decimals
 * entirely. That hid real amounts: ms2_amount alone is fractional on 1,550 of
 * 1,983 dispatches, because a milestone split of an odd line amount almost
 * always produces decimals, so a cell displayed a number that did not
 * reconcile against the line it came from.
 *
 * `money` therefore carries min 2 / max 4 decimals. Four is not arbitrary: it
 * is the deepest precision the data actually holds (275.1684, 251.2805,
 * 702.462 — nothing anywhere exceeds 4dp), so every stored amount renders
 * exactly while a clean figure still reads as 3,250.00 rather than
 * 3,250.0000.
 *
 * The others exist so a sweep to `money` cannot leak decimals onto things
 * that are not money — a row count must never read "29.00".
 */

/** Money. Exact to the data's real precision; never rounded away. */
export const money = new Intl.NumberFormat("en", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

/** Whole things — line counts, row counts, team counts. */
export const count = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

/** Quantities, which are fractional but not money, so no forced decimals:
 *  a qty of 1 reads "1", not "1.000000".
 *
 *  Six decimals, not two. PO Dispatch.qty carries up to 4dp (0.1076 on 205
 *  lines) and a milestone split of one goes deeper still (0.1076 x 70% =
 *  0.07532), so capping at 2 displayed a quantity that was not the stored
 *  one — 0.1076 read as "0.11", which then did not reconcile against the
 *  line amount beside it. Six matches the qty field precision set by
 *  _ensure_qty_precision in setup.py. minimumFractionDigits stays unset, so
 *  trailing zeros are still trimmed and a whole qty reads as a whole number. */
export const qty = new Intl.NumberFormat("en", { maximumFractionDigits: 6 });

/** Percentages — one decimal, matching how the reports already state them. */
export const pct = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });
