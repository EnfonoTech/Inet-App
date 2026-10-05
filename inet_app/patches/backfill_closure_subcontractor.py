"""Stamp ``subcontractor`` onto the Work Done closure rows that predate it.

The closure ledger is the record of what each subcontractor is owed — one row
per closing event, carrying its own quantity, amount, milestone and route. It
did not carry *who*, so every row written before this needs the line's
subcontractor filled in once.

Resolved with the same precedence every other reader uses: the stamped
``pd.contract`` wins, else the last live visit's team. Stored, not derived on
read — a closure is a historical event, and re-deriving it later would move a
supplier that may already have been paid when a team is reassigned. That drift
is exactly what left 208 lines disagreeing with their executing team.

Idempotent: only fills rows where the field is empty, so a re-run is a no-op
and a row corrected by hand afterwards is never overwritten.
"""

import frappe
from frappe.utils import cstr


def execute():
    if not frappe.db.has_column("Work Done Closure", "subcontractor"):
        print("backfill_closure_subcontractor: column absent, nothing to do")
        return

    rows = frappe.db.sql(
        """
        SELECT c.name, wd.system_id
        FROM `tabWork Done Closure` c
        JOIN `tabWork Done` wd ON wd.name = c.parent
        WHERE IFNULL(c.subcontractor, '') = ''
          AND IFNULL(wd.system_id, '') != ''
        """,
        as_dict=True,
    )
    if not rows:
        print("backfill_closure_subcontractor: no closure rows need a subcontractor")
        return

    from inet_app.api.command_center import _closure_subcontractor

    # One resolve per LINE, not per row: a line closed in three events resolves
    # to the same supplier three times otherwise, and _closure_subcontractor
    # hits the database twice each call.
    resolved = {}
    filled = 0
    for r in rows:
        sid = r["system_id"]
        if sid not in resolved:
            resolved[sid] = _closure_subcontractor(sid)
        sub = resolved[sid]
        if not sub:
            continue
        frappe.db.set_value(
            "Work Done Closure", r["name"], "subcontractor", sub,
            update_modified=False,
        )
        filled += 1

    frappe.db.commit()
    blank = len(rows) - filled
    print(
        f"backfill_closure_subcontractor: {len(rows)} rows scanned across "
        f"{len(resolved)} lines — {filled} stamped, {blank} left blank "
        f"(line has no resolvable subcontractor)"
    )
