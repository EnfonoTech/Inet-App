"""
Recalculate achieved_amount on Daily Execution records where it is zero
but achieved_qty > 0, using the billing rate from PO Dispatch (line_amount / qty).
Then resync each affected Rollout Plan's achieved_amount and completion_pct.
"""
import frappe
from frappe.utils import flt


def execute():
    # Step 1: Find all DEs with achieved_qty > 0 but achieved_amount = 0,
    # and fetch the billing rate from the linked PO Dispatch.
    rows = frappe.db.sql(
        """
        SELECT de.name, de.achieved_qty, de.rollout_plan,
               pd.line_amount, IFNULL(pd.qty, 1) AS pd_qty
        FROM `tabDaily Execution` de
        JOIN `tabRollout Plan` rp ON rp.name = de.rollout_plan
        JOIN `tabPO Dispatch` pd ON pd.name = rp.po_dispatch
        WHERE de.achieved_qty > 0
        AND IFNULL(de.achieved_amount, 0) = 0
        """,
        as_dict=True,
    )

    if not rows:
        print("fix_daily_execution_achieved_amount: nothing to fix")
        return

    affected_plans = set()
    updated = 0

    for row in rows:
        qty = flt(row.pd_qty) or 1.0
        rate = flt(row.line_amount) / qty
        achieved_amount = flt(row.achieved_qty) * rate

        frappe.db.set_value(
            "Daily Execution",
            row.name,
            "achieved_amount",
            achieved_amount,
            update_modified=False,
        )
        if row.rollout_plan:
            affected_plans.add(row.rollout_plan)
        updated += 1

    frappe.db.commit()
    print(f"fix_daily_execution_achieved_amount: updated {updated} Daily Execution records")

    # Step 2: Resync achieved_amount and completion_pct on every affected Rollout Plan.
    resynced = 0
    for plan_name in affected_plans:
        total = frappe.db.sql(
            """
            SELECT COALESCE(SUM(achieved_amount), 0) AS total
            FROM `tabDaily Execution`
            WHERE rollout_plan = %s AND execution_status = 'Completed'
            """,
            plan_name,
            as_dict=True,
        )
        achieved = flt(total[0].total if total else 0)
        target = flt(frappe.db.get_value("Rollout Plan", plan_name, "target_amount") or 0)
        completion_pct = round(achieved / target * 100, 2) if target > 0 else 0.0
        plan_status = "Completed" if completion_pct >= 100 else frappe.db.get_value("Rollout Plan", plan_name, "plan_status")

        frappe.db.set_value(
            "Rollout Plan",
            plan_name,
            {
                "achieved_amount": achieved,
                "completion_pct": completion_pct,
                "plan_status": plan_status,
            },
            update_modified=False,
        )
        resynced += 1

    frappe.db.commit()
    print(f"fix_daily_execution_achieved_amount: resynced {resynced} Rollout Plans")
