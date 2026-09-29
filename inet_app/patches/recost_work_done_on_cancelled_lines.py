"""
Zero the revenue on Work Done rows whose PO line has been cancelled.

A cancelled line will never be invoiced, so its Work Done is worth nothing —
but the revenue column kept whatever it held at the time, and every report
that sums ``wd.revenue_sar`` went on counting it. Measured on this site when
the rule was introduced: 1 row, SAR 569.00 of revenue that no longer exists.

``WorkDone._line_revenue()`` now returns 0 for a cancelled line, so the fix is
simply to re-save the affected rows and let the document recompute itself —
total_cost_sar and margin_sar follow in the same before_save. The record is
kept: the work did happen, the closure ledger and the status log still say so,
and undoing a cancel restores the value on the next save.

Idempotent: re-running finds nothing left to do.
"""
import frappe


def execute():
    if not frappe.db.has_column("PO Dispatch", "dispatch_status"):
        return
    names = frappe.db.sql_list(
        """
        SELECT wd.name
        FROM `tabWork Done` wd
        JOIN `tabPO Dispatch` pd ON pd.name = wd.system_id
        WHERE IFNULL(pd.dispatch_status, '') = 'Cancelled'
          AND IFNULL(wd.revenue_sar, 0) <> 0
        """
    ) or []
    fixed = 0
    reclaimed = 0.0
    for name in names:
        try:
            before = frappe.db.get_value("Work Done", name, "revenue_sar") or 0
            frappe.get_doc("Work Done", name).save(ignore_permissions=True)
            after = frappe.db.get_value("Work Done", name, "revenue_sar") or 0
            reclaimed += float(before) - float(after)
            fixed += 1
        except Exception:
            frappe.log_error(
                frappe.get_traceback(),
                f"recost_work_done_on_cancelled_lines: {name}",
            )
    frappe.db.commit()
    print(
        f"recost_work_done_on_cancelled_lines: candidates={len(names)} "
        f"re-costed={fixed} revenue_removed={reclaimed:,.2f}"
    )
