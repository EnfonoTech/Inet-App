"""Collapse duplicate Work Done records to one per PO line.

Runs in [pre_model_sync] on purpose: the duplicates have to be gone BEFORE
the model sync applies the new unique key on Work Done.system_id, or migrate
aborts while building the index and leaves the site half-migrated.

Nothing is discarded — see inet_app.wd_dedupe for the merge rules. The patch
is idempotent: with no duplicates left it finds nothing and returns.
"""

import frappe

from inet_app.wd_dedupe import run


def execute():
    print(run(apply=1))

    # Fail loudly and early if anything survived. Without this, migrate would
    # carry on and die later inside the index creation with an error that says
    # nothing about which line is at fault.
    left = frappe.db.sql(
        """
        SELECT system_id, COUNT(*) AS copies
        FROM `tabWork Done`
        WHERE system_id IS NOT NULL
        GROUP BY system_id
        HAVING COUNT(*) > 1
        """,
        as_dict=True,
    )
    if left:
        frappe.throw(
            "Cannot apply the unique key on Work Done.system_id — these PO lines "
            "still hold more than one Work Done: "
            + ", ".join(f"{r.system_id} ({r.copies})" for r in left)
        )
