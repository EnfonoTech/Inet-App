"""Drop ``Work Done.total_cost_sar`` and ``margin_sar``.

Both were derived from ``team_cost_sar``, which is a team's whole DAILY cost
charged in full to every POID that team touched that day. A team routinely
does five POIDs in a day; a line routinely takes several days and several
teams. No arithmetic turns a team-day into a per-line cost, so the roll-up and
the margin built on it were never figures anyone could act on.

The app had already stopped showing them — ProjectDetail dropped its Cost and
Margin columns, the Work Done detail modal listed both as hidden, and
``get_im_dashboard``'s ``kpi.cost``/``kpi.profit`` were read by nothing. The
fields and their writers are now gone too.

Kept: ``team_cost_sar``, ``subcontract_cost_sar``, ``activity_cost_sar``.
Those are real inputs and are reported at team/company level, where a
team-day cost belongs.

Frappe's schema sync does not drop columns for removed fields, so this does.
"""

import frappe

COLUMNS = ("total_cost_sar", "margin_sar")


def execute():
    existing = set(frappe.db.get_table_columns("Work Done"))
    todo = [c for c in COLUMNS if c in existing]
    if not todo:
        print("drop_work_done_cost_rollup: columns already gone")
        return

    for col in todo:
        frappe.db.sql(f"ALTER TABLE `tabWork Done` DROP COLUMN `{col}`")
    frappe.db.commit()
    frappe.clear_cache(doctype="Work Done")
    print(f"drop_work_done_cost_rollup: dropped {', '.join(todo)} from tabWork Done")
