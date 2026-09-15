/**
 * Pre-submit check for "this form must be complete before it can be sent".
 *
 * Planning and Direct Close both write records that nothing downstream fills
 * in later — a plan with no access window, or a close with no subcontractor or
 * closing date, stays incomplete forever. The server refuses these too; this
 * exists so the user is told which fields are missing by name, before the
 * round-trip, instead of the submit button quietly doing nothing.
 */

/**
 * Labels of the blank entries in `spec`, in the order given.
 * `spec` maps the label the user sees to the current value:
 *   missingFields({ "Access Time": accessTime, "Access Period": accessPeriod })
 */
export function missingFields(spec) {
  return Object.entries(spec || {})
    .filter(([, v]) => !String(v ?? "").trim())
    .map(([label]) => label);
}

/** `action` completes "Cannot ___:" — e.g. "plan", "direct close". */
export function missingFieldsMessage(labels, action) {
  const list = labels || [];
  return `Cannot ${action}: ${list.join(", ")} ${list.length === 1 ? "is" : "are"} required.`;
}
