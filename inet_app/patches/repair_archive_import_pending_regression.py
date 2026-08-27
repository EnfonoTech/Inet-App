"""
Not a migration patch — do NOT add this to patches.txt. Run it yourself,
once, wherever the data needs repairing:

    bench --site <site> execute "inet_app.patches.repair_archive_import_pending_regression.execute"

_run_po_archive_import (command_center.py) used to write dispatch_status
="Pending" onto an EXISTING PO Dispatch whenever the re-imported archive
row showed no PIC progress — even when that dispatch already had an `im`
assigned, which by itself proves it was already dispatched (dispatch_po_lines
always sets dispatch_status="Dispatched" the moment im is assigned; it's
never left at "Pending"). That regression hid the line from every IM-facing
queue (all of them filter out Pending rows), so the IM could no longer act
on it. Fixed going forward in _run_po_archive_import; this repairs the data
that was already written wrong.

Scoped ONLY to the unambiguous case: im is set, dispatch_status="Pending",
and NEITHER a Rollout Plan NOR a Work Done record exists for the dispatch
yet. For those, the correct status is simply "Dispatched" (the same value
dispatch_po_lines would have set). Deliberately excludes any dispatch that
already has a Rollout Plan or Work Done — those regressed from further
along (Planned/Completed/etc.), and plan state varies too much (Overdue,
Planning with Issue, Cancelled, MS1-only Work Done, ...) to correct
mechanically; those need a human look, not this script.

Safe to re-run: only ever touches rows still sitting at Pending with im set
and no plan/Work Done, so anything already fixed no longer matches.
"""
import frappe


def execute():
    rows = frappe.db.sql(
        """
        SELECT pd.name, pd.poid
        FROM `tabPO Dispatch` pd
        WHERE pd.dispatch_status = 'Pending'
          AND IFNULL(pd.im, '') != ''
          AND NOT EXISTS (SELECT 1 FROM `tabRollout Plan` rp WHERE rp.po_dispatch = pd.name)
          AND NOT EXISTS (SELECT 1 FROM `tabWork Done` wd WHERE wd.system_id = pd.name)
        """,
        as_dict=True,
    )

    if not rows:
        print("repair_archive_import_pending_regression: nothing to fix")
        return {"checked": 0, "updated": 0}

    for row in rows:
        frappe.db.set_value("PO Dispatch", row.name, "dispatch_status", "Dispatched", update_modified=False)

    frappe.db.commit()
    print(f"repair_archive_import_pending_regression: {len(rows)} PO Dispatch rows set to Dispatched")
    return {"checked": len(rows), "updated": len(rows)}
