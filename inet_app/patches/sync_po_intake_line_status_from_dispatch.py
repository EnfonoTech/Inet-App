"""
One-time fix: PO Intake Line.po_line_status was being synced from its own,
separate, looser rule than PO Dispatch.dispatch_status — update_pic_row and
bulk_update_pic_status used to compute it independently (MS1 closed AND
(MS2 closed OR *submitted* OR zero)), instead of reading the already-correct
dispatch_status (see inet_app.api.pic, both functions now consolidated onto
dispatch_status directly). That gap left po_line_status stuck at "Closed"
for lines whose real dispatch_status was later corrected to Partially
Closed / Submitted / Partially Submitted / Cancelled by the
sync_dispatch_status_from_pic patch (or by any pic.py write since) — this
backfill catches po_line_status up to match, the same way that patch did
for dispatch_status itself.
"""
import frappe


def execute():
    rows = frappe.db.sql(
        """
        SELECT il.name AS il_name, pd.dispatch_status
        FROM `tabPO Dispatch` pd
        INNER JOIN `tabPO Intake Line` il
            ON il.parent = pd.po_intake AND il.po_line_no = pd.po_line_no
        WHERE il.po_line_status = 'Closed'
          AND pd.dispatch_status != 'Closed'
          AND IFNULL(pd.is_internal_work, 0) = 0
          AND IFNULL(pd.is_dummy_po, 0) = 0
        """,
        as_dict=True,
    )

    if not rows:
        print("sync_po_intake_line_status_from_dispatch: nothing to sync")
        return

    changed = 0
    breakdown = {}
    for row in rows:
        # A cancelled dispatch reopens to Cancelled; anything else that's
        # not truly Closed (Partially Closed/Submitted/Partially Submitted/
        # Completed) reopens to Completed — po_line_status has no finer-
        # grained values of its own, matching how update_pic_row /
        # bulk_update_pic_status already reopen a stale Closed line.
        new_status = "Cancelled" if row.dispatch_status == "Cancelled" else "Completed"
        frappe.db.set_value(
            "PO Intake Line", row.il_name, "po_line_status", new_status, update_modified=False
        )
        key = f"Closed -> {new_status} (dispatch_status={row.dispatch_status})"
        breakdown[key] = breakdown.get(key, 0) + 1
        changed += 1

    frappe.db.commit()
    print(f"sync_po_intake_line_status_from_dispatch: checked {len(rows)} lines, updated {changed}")
    for key, count in sorted(breakdown.items()):
        print(f"  {key}: {count}")
