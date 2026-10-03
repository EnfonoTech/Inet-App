"""Re-derive the money a line's downstream records copied from its PO Dispatch.

Rollout Plan, Daily Execution and Work Done each stamp an amount derived from
the dispatch at the moment they are written. That is fine while the dispatch is
real from the start — on 3,230 plans belonging to ordinary lines, not one has a
stale target. It breaks for a dummy PO, which is created with
``line_amount = 0``: everything planned or executed against it is stamped zero,
and mapping it to the real PO line fixes only the dispatch.

Measured on the production copy before this existed, across the 168 dummies
already mapped:

    Rollout Plan.target_amount      = 0 while the line has value : 199 of 218
    Daily Execution.achieved_amount = 0 while the line has value :  57 of 221

**Only zeros are repaired.** A non-zero figure is never overwritten, however
wrong it might look. The plan writer scales ``target_amount`` by the
*outstanding* quantity at the time the plan is made, so re-deriving a plan that
already carries a value would quietly re-scale it against today's remainder and
contradict a number some other flow set on purpose. Repairing zeros is strictly
additive and cannot regress a line that was already right.
"""

import frappe
from frappe.utils import cstr, flt


def _dispatch_money(po_dispatch):
    """``qty``/``rate``/``line_amount`` etc. for the line, or ``None``."""
    row = frappe.db.get_value(
        "PO Dispatch", po_dispatch,
        ["name", "qty", "rate", "line_amount", "confirmed_qty", "confirmed_amount"],
        as_dict=True,
    )
    return row or None


def resync_dispatch_values(po_dispatch, *, reason=None):
    """Fill in the zeros left behind on a line's plans, executions and Work Done.

    Returns a dict of counts. Safe to call on any line and from any flow — it
    writes only where the stored figure is 0 and the dispatch now has value, so
    calling it on a healthy line is a no-op.
    """
    po_dispatch = cstr(po_dispatch or "").strip()
    out = {"plans": 0, "executions": 0, "work_done": 0}
    if not po_dispatch:
        return out

    pd = _dispatch_money(po_dispatch)
    if not pd:
        return out

    line_amount = flt(pd.get("line_amount"))
    if line_amount <= 0:
        # Nothing to spread. A dummy that is still a dummy, or a genuinely
        # zero-value line — in both cases the stored zeros are correct.
        return out

    pd_qty = flt(pd.get("qty")) or 1.0
    unit_rate = line_amount / pd_qty

    plans = frappe.get_all(
        "Rollout Plan",
        filters={"po_dispatch": po_dispatch},
        fields=["name", "target_amount", "plan_status"],
        limit_page_length=0,
    )
    plan_names = [p.name for p in plans]

    # 1. Plan target. Cancelled plans are left alone: their target is history,
    #    and nothing measures completion against a plan nobody will execute.
    for p in plans:
        if flt(p.get("target_amount")) > 0 or p.get("plan_status") == "Cancelled":
            continue
        frappe.db.set_value("Rollout Plan", p.name, "target_amount",
                            line_amount, update_modified=False)
        out["plans"] += 1

    # 2. Execution amount — achieved_qty x the line's unit rate, the same rule
    #    patches/fix_daily_execution_achieved_amount.py established.
    executions = frappe.get_all(
        "Daily Execution",
        filters={"rollout_plan": ["in", plan_names]},
        fields=["name", "rollout_plan", "achieved_qty", "achieved_amount"],
        limit_page_length=0,
    ) if plan_names else []
    touched_plans = set()
    for e in executions:
        if flt(e.get("achieved_amount")) > 0 or flt(e.get("achieved_qty")) <= 0:
            continue
        frappe.db.set_value("Daily Execution", e.name, "achieved_amount",
                            round(flt(e.achieved_qty) * unit_rate, 4),
                            update_modified=False)
        touched_plans.add(e.rollout_plan)
        out["executions"] += 1

    # 3. Roll the repaired executions back up into their plan, exactly as
    #    _sync_rollout_plan_from_daily_execution does: completed rows only.
    for plan_name in touched_plans:
        achieved = flt(frappe.db.sql(
            """SELECT COALESCE(SUM(achieved_amount), 0) FROM `tabDaily Execution`
               WHERE rollout_plan = %s AND execution_status = 'Completed'""",
            plan_name,
        )[0][0])
        target = flt(frappe.db.get_value("Rollout Plan", plan_name, "target_amount"))
        vals = {"achieved_amount": achieved}
        if target > 0:
            vals["completion_pct"] = min(100.0, round(achieved / target * 100, 2))
        frappe.db.set_value("Rollout Plan", plan_name, vals, update_modified=False)

    # 4. Work Done. Same derivation generate_work_done uses — the confirmed
    #    figures win when the IM has settled a short delivery, else the whole
    #    line. Cost is deliberately NOT touched: team_cost_sar is a team's
    #    whole daily cost charged to every POID it touched that day, which is
    #    why the roll-up built on it was removed outright (see
    #    patches/drop_work_done_cost_rollup.py).
    confirmed_qty = flt(pd.get("confirmed_qty"))
    rate = flt(pd.get("rate"))
    for wd in frappe.get_all(
        "Work Done",
        filters={"system_id": po_dispatch},
        fields=["name", "revenue_sar", "billing_rate_sar", "executed_qty"],
        limit_page_length=0,
    ):
        if flt(wd.get("revenue_sar")) > 0:
            continue
        if confirmed_qty > 0:
            qty = confirmed_qty
            revenue = flt(pd.get("confirmed_amount")) or (rate * qty)
        else:
            qty = flt(pd.get("qty")) or 1.0
            revenue = line_amount or (rate * qty)
        frappe.db.set_value("Work Done", wd.name, {
            "billing_rate_sar": rate,
            "executed_qty": qty,
            "revenue_sar": round(flt(revenue), 4),
        }, update_modified=False)
        out["work_done"] += 1

    if any(out.values()):
        frappe.logger().info(
            f"resync_dispatch_values {po_dispatch}: {out}" + (f" ({reason})" if reason else "")
        )
    return out
