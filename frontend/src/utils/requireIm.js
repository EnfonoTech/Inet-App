/**
 * A PO line with no IM must not be planned, direct closed, or assigned to a
 * backend team.
 *
 * A Rollout Plan copies its `im` from the dispatch once, at creation, and
 * nothing back-fills it — so a line actioned before it was assigned is
 * recorded against nobody, permanently, and drops out of every IM-scoped
 * queue and report. The backend refuses these too (_require_dispatch_im in
 * command_center.py); this check exists so the user is told which POIDs to fix
 * before the round-trip, the same way each page already pre-checks dispatch
 * status.
 */

/** Selected rows that carry no IM. `key` is the row's id field. */
export function missingImRows(rows, selected, key = "name") {
  return (rows || []).filter(
    (r) => selected?.has?.(r?.[key]) && !String(r?.im || "").trim(),
  );
}

/**
 * Message for those rows. `action` completes "Cannot ___:" — e.g. "plan".
 * Names POIDs, capped at five, because the point is to say which lines to fix.
 */
export function imRequiredMessage(blocked, action) {
  const labels = (blocked || []).map((r) => r?.poid || r?.name).filter(Boolean);
  const shown = labels.slice(0, 5).join(", ");
  const more = labels.length > 5 ? ` and ${labels.length - 5} more` : "";
  return (
    `Cannot ${action}: ${labels.length} POID${labels.length !== 1 ? "s have" : " has"}` +
    ` no IM assigned — ${shown}${more}. Assign an IM first.`
  );
}
