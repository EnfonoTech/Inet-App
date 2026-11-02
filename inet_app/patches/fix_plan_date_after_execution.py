"""Move a completed plan's date back to the month its work was actually done.

A Rollout Plan's date is when the work is planned. On a completed plan whose
team executed in an EARLIER MONTH than that date, every plan-dated report puts
the work in the wrong month. On the production copy (2 Nov 2026) 29 completed
plans were like this — most of them made on 3-4 Oct and dated 3-5 Nov (the
month picked wrong), executed on 3-6 Oct, which showed SAR 8,619 of Attaullah
Khan's October work in November's Top Teams report.

Only plans that cross a month are touched (agreed 2 Nov 2026). A team starting
a day early inside the same month (246 more on the copy) reports in the right
month already, so those dates are left as the IM set them.

Only COMPLETED plans are corrected. Cancelled ones are not reported on, and a
plan still open (Planning with Issue, Overdue, In Execution, Extended) may have
been moved forward on purpose after an early attempt, so its date is left
alone.

  plan_date     -> the first execution date
  plan_end_date -> the earlier of the old end and the last day worked
                   (never before the new start), so a plan finished early
                   ends when the work ended, and one that overran keeps its
                   planned end.

Each corrected plan gets an Info comment with the old and new dates.
Idempotent: a corrected plan no longer has work in an earlier month.
"""

import frappe
from frappe.utils import getdate


def _candidates():
    return frappe.db.sql(
        """
        SELECT rp.name, rp.plan_date, rp.plan_end_date,
               MIN(de.execution_date) AS first_exec,
               MAX(GREATEST(de.execution_date,
                            IFNULL(de.last_progress_date, de.execution_date))) AS last_exec
        FROM `tabRollout Plan` rp
        JOIN `tabDaily Execution` de ON de.rollout_plan = rp.name
        WHERE rp.plan_status = 'Completed'
          AND de.execution_date IS NOT NULL
          AND IFNULL(de.execution_status, '') <> 'Cancelled'
        GROUP BY rp.name, rp.plan_date, rp.plan_end_date
        HAVING MIN(de.execution_date) < rp.plan_date
           AND DATE_FORMAT(MIN(de.execution_date), '%Y-%m') <> DATE_FORMAT(rp.plan_date, '%Y-%m')
        """,
        as_dict=True,
    )


def execute():
    if not frappe.db.has_column("Rollout Plan", "plan_date"):
        return
    has_end = frappe.db.has_column("Rollout Plan", "plan_end_date")
    fixed = 0
    for r in _candidates():
        new_start = getdate(r.first_exec)
        old_end = getdate(r.plan_end_date) if r.plan_end_date else getdate(r.plan_date)
        new_end = max(new_start, min(old_end, getdate(r.last_exec)))
        values = {"plan_date": new_start}
        if has_end:
            values["plan_end_date"] = new_end
        frappe.db.set_value("Rollout Plan", r.name, values, update_modified=False)
        frappe.get_doc({
            "doctype": "Comment",
            "comment_type": "Info",
            "reference_doctype": "Rollout Plan",
            "reference_name": r.name,
            "content": (
                f"Plan date corrected from {getdate(r.plan_date)}"
                f"{f' – {old_end}' if old_end != getdate(r.plan_date) else ''}"
                f" to {new_start}{f' – {new_end}' if new_end != new_start else ''}:"
                f" the work was executed from {getdate(r.first_exec)}, before the planned date."
            ),
        }).insert(ignore_permissions=True)
        fixed += 1
    frappe.db.commit()
    print(f"fix_plan_date_after_execution: {fixed} completed plans re-dated")
