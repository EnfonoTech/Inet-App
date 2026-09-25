import frappe

from inet_app.api.command_center import _week_start


def execute():
    """Move stored forecast weeks from a Monday anchor to Saturday.

    `PO Dispatch.target_week` holds the first day of the forecast week. It was
    written as a Monday; the working week is Saturday to Friday, so each value
    becomes the Saturday that opens the week containing it -- two days earlier.

    The days the IM meant are unchanged: a line forecast for the week of
    Monday 28 Sep belongs to Sat 26 Sep - Fri 2 Oct. Only the label of the
    week moves. Left alone, the stored Monday would snap to that same Saturday
    on every read anyway, so this simply makes the column agree with what the
    screen shows.

    Values already on a Saturday are skipped, so the patch is safe to re-run
    and a no-op on a site that has none.
    """
    if not frappe.db.has_column("PO Dispatch", "target_week"):
        return

    rows = frappe.db.sql(
        """
        SELECT name, target_week
        FROM `tabPO Dispatch`
        WHERE IFNULL(target_week, '') <> ''
          AND WEEKDAY(target_week) <> 5
        """,
        as_dict=True,
    )
    if not rows:
        print("target_week: nothing to re-anchor")
        return

    for r in rows:
        frappe.db.set_value(
            "PO Dispatch", r["name"], "target_week",
            _week_start(r["target_week"]), update_modified=False,
        )
    frappe.db.commit()

    left = frappe.db.sql(
        """
        SELECT COUNT(*) FROM `tabPO Dispatch`
        WHERE IFNULL(target_week, '') <> '' AND WEEKDAY(target_week) <> 5
        """
    )[0][0]
    print(f"target_week: re-anchored {len(rows)} row(s) to Saturday; {left} not on a Saturday")
