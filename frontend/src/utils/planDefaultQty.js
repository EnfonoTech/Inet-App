/**
 * Default achieved quantity from a Rollout Plan row (get_list or merged shape).
 */
export function defaultAchievedQtyFromPlan(plan) {
  if (!plan || typeof plan !== "object") return "1";
  const tryNum = (v) => {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  for (const key of ["qty", "requested_qty", "target_qty", "due_qty"]) {
    const n = tryNum(plan[key]);
    if (n != null) return String(n);
  }
  const vm = tryNum(plan.visit_multiplier);
  if (vm != null && vm > 0) return String(vm);
  return "1";
}
