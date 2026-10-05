/**
 * Default achieved quantity from a Rollout Plan row (get_list or merged shape).
 * For multi-team plans, prefer the calling user's `my_assigned_qty` so the
 * TL is pre-filled with their share, not the full POID qty.
 */
export function defaultAchievedQtyFromPlan(plan) {
  if (!plan || typeof plan !== "object") return "1";
  const tryNum = (v) => {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  // Multi-team: backend returns my_assigned_qty for the calling user's team.
  const mine = tryNum(plan.my_assigned_qty);
  if (mine != null && mine > 0) return String(mine);
  // No per-team share? Then this is a single-team plan, or the IM's bulk
  // "Record execution", which is not a team and never has my_assigned_qty.
  // The line quantity below is right for the first case and wrong for the
  // second — it credits one team with the whole line. That is corrected
  // server-side: update_execution fans a via_im_bulk_record call out into one
  // execution per team, each carrying its own assigned_qty, and ignores the
  // quantity sent here. Deliberately not guarded again on this side, because
  // the plan rows this helper sees carry no teams_total to guard on.
  for (const key of ["qty", "requested_qty", "target_qty", "due_qty"]) {
    const n = tryNum(plan[key]);
    if (n != null) return String(n);
  }
  const vm = tryNum(plan.visit_multiplier);
  if (vm != null && vm > 0) return String(vm);
  return "1";
}
