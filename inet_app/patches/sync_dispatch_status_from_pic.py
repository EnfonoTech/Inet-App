"""
One-time sync: recompute PO Dispatch.dispatch_status for every line already
in the Completed..Closed range, using the new stricter Closed / Partially
Closed / Submitted / Partially Submitted rules (see
inet_app.api.pic._compute_dispatch_status_from_pic).

Needed because the old rule treated a milestone reaching "Commercial
Invoice Submitted" as good enough to close the whole dispatch — under the
new rule only a literal "Commercial Invoice Closed" counts as closed on
that milestone, so any line auto-closed under the old rule (or any
Completed line whose PIC status already progressed further than the old
code ever recognized) needs re-evaluating against its real MS1/MS2 status.
"""
import frappe

from inet_app.api.pic import _PIC_AUTO_MANAGED_DISPATCH_STATUSES, _compute_dispatch_status_from_pic


def execute():
    statuses = tuple({"Completed"} | _PIC_AUTO_MANAGED_DISPATCH_STATUSES)
    placeholders = ", ".join(["%s"] * len(statuses))
    rows = frappe.db.sql(
        f"""
        SELECT name, pic_status, pic_status_ms2, ms2_amount, dispatch_status
        FROM `tabPO Dispatch`
        WHERE dispatch_status IN ({placeholders})
          AND IFNULL(is_internal_work, 0) = 0
          AND IFNULL(is_dummy_po, 0) = 0
        """,
        statuses,
        as_dict=True,
    )

    if not rows:
        print("sync_dispatch_status_from_pic: nothing to sync")
        return

    changed = 0
    breakdown = {}
    for row in rows:
        new_status = _compute_dispatch_status_from_pic(
            row.pic_status, row.pic_status_ms2, row.ms2_amount, row.dispatch_status
        )
        if new_status and new_status != row.dispatch_status:
            frappe.db.set_value(
                "PO Dispatch", row.name, "dispatch_status", new_status, update_modified=False
            )
            key = f"{row.dispatch_status} -> {new_status}"
            breakdown[key] = breakdown.get(key, 0) + 1
            changed += 1

    frappe.db.commit()
    print(f"sync_dispatch_status_from_pic: checked {len(rows)} lines, updated {changed}")
    for key, count in sorted(breakdown.items()):
        print(f"  {key}: {count}")
