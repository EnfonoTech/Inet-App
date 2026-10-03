"""Repair the amounts left at zero on lines that were mapped from a dummy PO.

A dummy PO is created with ``line_amount = 0``. Everything planned or executed
against it is stamped from that zero, and ``map_im_dummy_po_to_intake_line``
reloads and saves the PO Dispatch — which fixes the dispatch and nothing else.

Measured on the production copy, across the 168 dummies already mapped:

    Rollout Plan.target_amount      = 0 while the line has value : 199 of 218
    Daily Execution.achieved_amount = 0 while the line has value :  57 of 221

Those 199 plans understate their target by the line's entire value, which
feeds the rollout burn-down and every target-vs-achieved figure.

It is specific to mapping: of 3,230 plans belonging to ordinary lines, zero
are stale.

Mapping now calls ``resync_dispatch_values`` itself, so this is the one-off
catch-up for lines mapped before that existed. Scoped to ``was_dummy_po`` —
no other population has the problem, and the helper repairs zeros only, so
re-running it is harmless.
"""

import frappe

from inet_app.api.dispatch_value_sync import resync_dispatch_values


def execute():
    if not frappe.db.has_column("PO Dispatch", "was_dummy_po"):
        print("resync_mapped_dummy_values: was_dummy_po column absent, nothing to do")
        return

    names = [
        r[0] for r in frappe.db.sql(
            """SELECT name FROM `tabPO Dispatch`
               WHERE IFNULL(was_dummy_po, 0) = 1 AND IFNULL(line_amount, 0) > 0"""
        )
    ]
    if not names:
        print("resync_mapped_dummy_values: no mapped dummies with value")
        return

    totals = {"plans": 0, "executions": 0, "work_done": 0}
    for name in names:
        try:
            got = resync_dispatch_values(name, reason="patch: mapped dummy catch-up")
        except Exception:
            # One bad line must not strand the rest — the next migrate retries
            # it, since the patch only ever repairs zeros.
            frappe.log_error(frappe.get_traceback(), f"resync_mapped_dummy_values {name}")
            continue
        for k in totals:
            totals[k] += got.get(k, 0)

    frappe.db.commit()
    print(
        f"resync_mapped_dummy_values: scanned {len(names)} mapped dummies — "
        f"repaired {totals['plans']} plan targets, {totals['executions']} execution "
        f"amounts, {totals['work_done']} work done records"
    )
