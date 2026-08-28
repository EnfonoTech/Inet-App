"""
Not a migration patch — do NOT add this to patches.txt. Run it yourself,
once, wherever the data needs repairing:

    bench --site <site> execute "inet_app.patches.sync_dispatch_status_from_pic_v2.execute"

Follow-up to sync_dispatch_status_from_pic.py. That one-time patch only
scanned rows whose dispatch_status was already in ('Completed','Partially
Submitted','Submitted','Partially Closed','Closed') — a real gap, since
on_sales_invoice_submit/on_payment_entry_submit (the actual triggers that
move pic_status to Submitted/Closed) never checked dispatch_status at all,
so a line could get invoiced while still sitting at Backend Assigned/
Planned/Dispatched, invisible to that patch's WHERE clause.

Root cause fixed separately in inet_app/api/pic.py: on_sales_invoice_submit,
on_sales_invoice_cancel, on_payment_entry_submit, and on_payment_entry_cancel
now all call _compute_dispatch_status_from_pic() themselves (same recompute
update_pic_row already did on a manual PIC edit), so this class of drift
stops happening going forward. This script is the one-off backfill for
whatever already drifted before that fix landed — scanning EVERY PO
Dispatch PIC has ever touched, not just ones already past Completed.

Safe to re-run: only ever changes a row when
_compute_dispatch_status_from_pic() returns a value that differs from the
row's current dispatch_status, so a clean run afterward is a no-op.
"""
import frappe

from inet_app.api.pic import _compute_dispatch_status_from_pic


def execute():
    rows = frappe.db.sql(
        """
        SELECT name, poid, dispatch_status, pic_status, pic_status_ms2, ms2_amount
        FROM `tabPO Dispatch`
        WHERE IFNULL(is_internal_work, 0) = 0
          AND IFNULL(is_dummy_po, 0) = 0
          AND (IFNULL(pic_status, '') != '' OR IFNULL(pic_status_ms2, '') != '')
        """,
        as_dict=True,
    )

    if not rows:
        print("sync_dispatch_status_from_pic_v2: nothing to check")
        return {"checked": 0, "updated": []}

    updated = []
    for row in rows:
        new_status = _compute_dispatch_status_from_pic(
            row.pic_status, row.pic_status_ms2, row.ms2_amount, row.dispatch_status
        )
        if new_status and new_status != row.dispatch_status:
            frappe.db.set_value(
                "PO Dispatch", row.name, "dispatch_status", new_status, update_modified=False
            )
            updated.append(
                {
                    "name": row.name,
                    "poid": row.poid,
                    "from": row.dispatch_status,
                    "to": new_status,
                    "pic_status": row.pic_status,
                    "pic_status_ms2": row.pic_status_ms2,
                }
            )

    frappe.db.commit()

    print(f"sync_dispatch_status_from_pic_v2: {len(rows)} checked, {len(updated)} updated")
    for u in updated:
        print(f"  {u['name']} ({u['poid']}): {u['from']!r} -> {u['to']!r}  [ms1={u['pic_status']!r} ms2={u['pic_status_ms2']!r}]")

    return {"checked": len(rows), "updated": updated}
