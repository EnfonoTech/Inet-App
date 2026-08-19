"""Backfill PO Dispatch.sub_po_status for every existing line.

The field is a stored rollup of sub_po_status_ms1 / sub_po_status_ms2 (the same
pattern pic_status -> dispatch_status already uses). New and edited rows get it
from the PO Dispatch validate hook; this fills in the rows that existed before
the field did, so Desk list views and the portal never show a blank rollup.
"""

import frappe

from inet_app.api.subcon_po import _compute_overall_status


def execute():
    if not frappe.db.has_column("PO Dispatch", "sub_po_status"):
        return

    rows = frappe.db.sql(
        """
        SELECT name, sub_po_status_ms1, sub_po_status_ms2, ms1_amount, ms2_amount,
               sub_po_status
        FROM `tabPO Dispatch`
        """,
        as_dict=True,
    )
    changed = 0
    for r in rows:
        want = _compute_overall_status(
            r.sub_po_status_ms1, r.sub_po_status_ms2, r.ms1_amount, r.ms2_amount
        )
        if (r.sub_po_status or "") != want:
            # update_modified=False: this is a derived column catching up, not a
            # business change, and 17k bumped timestamps would reorder every
            # list sorted by `modified`.
            frappe.db.set_value(
                "PO Dispatch", r.name, "sub_po_status", want,
                update_modified=False,
            )
            changed += 1
    frappe.db.commit()
    print(f"sub_po_status backfilled on {changed} of {len(rows)} PO Dispatch rows")
