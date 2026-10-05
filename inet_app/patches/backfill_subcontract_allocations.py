"""Build the per-subcontractor allocation rows for every existing PO line.

``PO Subcontract Allocation`` holds each subcontractor's share of a line, so a
line worked 5 units by one supplier and 1 by another can finally be ordered as
two POs instead of one wrong one. The rows are DERIVED — from the closure
ledger once work is confirmed, else from Rollout Plan Team, else from the
line's own subcontractor — so this patch is a catch-up, not an import.

Idempotent by construction: ``resync_dispatch_allocations`` writes only when
the derived shares differ from what is stored, and it writes the child rows
directly rather than saving the parent, so re-running it cannot disturb a PO
Dispatch field.

A line with one supplier — the overwhelming majority — produces exactly one
row carrying today's values, which is what lets the flat ``sub_po_*`` columns
and every reader of them stay untouched.
"""

import frappe


def execute():
    if not frappe.db.exists("DocType", "PO Subcontract Allocation"):
        print("backfill_subcontract_allocations: doctype absent, nothing to do")
        return

    from inet_app.api.subcontractor_sync import resync_dispatch_allocations

    names = frappe.db.sql_list(
        """SELECT name FROM `tabPO Dispatch`
           WHERE IFNULL(is_internal_work, 0) = 0 AND IFNULL(is_dummy_po, 0) = 0"""
    )
    written = multi = 0
    for idx, name in enumerate(names, start=1):
        try:
            changed, rows = resync_dispatch_allocations(name, reason="patch: backfill")
        except Exception:
            # One bad line must not strand the rest; the next migrate retries
            # it, since the resync only ever writes a difference.
            frappe.log_error(frappe.get_traceback(), f"backfill_subcontract_allocations {name}")
            continue
        if changed:
            written += 1
        if len(rows) > 1:
            multi += 1
        if idx % 2000 == 0:
            frappe.db.commit()

    frappe.db.commit()
    print(
        f"backfill_subcontract_allocations: {len(names):,} lines scanned, "
        f"{written:,} given allocation rows, {multi:,} span more than one subcontractor"
    )
