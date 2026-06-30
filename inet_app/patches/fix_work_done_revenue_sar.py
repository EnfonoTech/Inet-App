"""
Fix Work Done records where revenue_sar differs from the linked PO Dispatch line_amount.
This happened because generate_work_done previously multiplied billing_rate by achieved_qty
instead of using the contracted qty/line_amount directly.
"""
import frappe
from frappe.utils import flt


def execute():
    rows = frappe.db.sql(
        """
        SELECT wd.name, wd.revenue_sar, pd.line_amount
        FROM `tabWork Done` wd
        JOIN `tabPO Dispatch` pd ON pd.name = wd.system_id
        WHERE ABS(IFNULL(wd.revenue_sar, 0) - IFNULL(pd.line_amount, 0)) > 0.001
        """,
        as_dict=True,
    )

    if not rows:
        print("fix_work_done_revenue_sar: nothing to fix")
        return

    for row in rows:
        frappe.db.set_value(
            "Work Done",
            row.name,
            "revenue_sar",
            flt(row.line_amount),
            update_modified=False,
        )

    frappe.db.commit()
    print(f"fix_work_done_revenue_sar: corrected {len(rows)} Work Done records")
