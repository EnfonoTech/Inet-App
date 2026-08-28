"""
Not a migration patch — do NOT add this to patches.txt. Run it yourself,
once, wherever the data needs repairing:

    bench --site <site> execute "inet_app.patches.fix_stale_subcontracted_dispatch_status.execute"

"Sub-Contracted" was a real dispatch_status value until commit c6adc9e
(2026-05-12) renamed it to "Backend Assigned" everywhere in the doctype's
Select options and the assign/mark-done code (_assign_backend_one,
_mark_backend_done_one in command_center.py). The rename only changed the
code going forward — any PO Dispatch already sitting at the old
"Sub-Contracted" value was left untouched, and nothing since has ever read
`subcon_status` to reconcile it.

Rule (matches what _mark_backend_done_one does today for a fresh
assignment): subcon_status='Work Done' -> the work is actually done ->
Completed. Anything else (blank/'Pending') -> just assigned, no work done
yet -> Backend Assigned.

Safe to re-run: only ever matches dispatch_status='Sub-Contracted', which
this patch always clears.
"""
import frappe


def execute():
    rows = frappe.db.sql(
        """
        SELECT name, poid, subcon_status
        FROM `tabPO Dispatch`
        WHERE dispatch_status = 'Sub-Contracted'
        """,
        as_dict=True,
    )

    if not rows:
        print("fix_stale_subcontracted_dispatch_status: nothing to check")
        return {"checked": 0, "updated": []}

    updated = []
    for row in rows:
        new_status = "Completed" if (row.subcon_status or "").strip() == "Work Done" else "Backend Assigned"
        frappe.db.set_value("PO Dispatch", row.name, "dispatch_status", new_status, update_modified=False)
        updated.append({"name": row.name, "poid": row.poid, "subcon_status": row.subcon_status, "to": new_status})

    frappe.db.commit()

    print(f"fix_stale_subcontracted_dispatch_status: {len(rows)} checked, {len(updated)} updated")
    for u in updated:
        print(f"  {u['name']} ({u['poid']}): subcon_status={u['subcon_status']!r} -> dispatch_status={u['to']!r}")

    return {"checked": len(rows), "updated": updated}
