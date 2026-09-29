"""
Seed PO Status Event from the existing PIC Activity Log.

PIC Activity Log already holds every ``pic_status`` / ``pic_status_ms2``
transition PIC has made — the only status history the app has ever kept. Rather
than start the new log empty, those rows are copied across so ageing reports
have something to read from day one.

The old table is left in place and keeps receiving nothing new; ``pic.py`` is
switched over to the shared writer separately. Nothing reads PO Status Event
yet, so a re-run that duplicated rows would corrupt the ageing maths — hence the
guard below keys on (po_dispatch, field_changed, changed_at) and skips anything
already present.

``days_in_previous`` is computed here rather than trusted from the source,
because the source never stored it: rows are grouped by (po_dispatch,
field_changed), ordered by performed_at, and each row measures the gap back to
its predecessor. The first row of every chain carries 0.

Rows where old_value == new_value are skipped, matching what the live writer
does: PIC bulk setters routinely re-apply a value a row already holds, and those
are actions rather than transitions. They do not advance the duration clock
either — a line that sat at "Ready for Invoice" from T0, was re-stamped at T1
and moved at T2 was at that value for T2-T0, not T2-T1. The full record of every
action stays in PIC Activity Log, which is left untouched.

Note on the data this produces: most of the source rows are blank -> final-state
jumps (1,437 of them land straight on "PO Line Canceled", 755 on "Commercial
Invoice Closed"), so the backfilled durations are mostly first-events with no
predecessor. That is a fair reflection of how the ladder has actually been used
— the log is honest about it rather than inventing intermediate stages.
"""
import frappe
from frappe.utils import cstr, flt, time_diff_in_seconds

_SECONDS_PER_DAY = 86400.0
_COMMIT_EVERY = 500


def _existing_keys():
    rows = frappe.db.sql(
        "SELECT po_dispatch, field_changed, changed_at FROM `tabPO Status Event`"
    )
    return {(r[0], r[1], cstr(r[2])) for r in rows}


def execute():
    if not frappe.db.table_exists("PIC Activity Log"):
        print("backfill_po_status_event_from_pic_log: no source table, skipped")
        return
    if not frappe.db.table_exists("PO Status Event"):
        print("backfill_po_status_event_from_pic_log: no target table, skipped")
        return

    src = frappe.db.sql(
        """
        SELECT po_dispatch, field_changed, old_value, new_value, milestone,
               user, user_full_name, performed_at, batch_id, row_count, remark
        FROM `tabPIC Activity Log`
        WHERE IFNULL(po_dispatch, '') <> ''
          AND IFNULL(field_changed, '') <> ''
          AND performed_at IS NOT NULL
        ORDER BY po_dispatch, field_changed, performed_at, creation
        """,
        as_dict=True,
    ) or []

    # A source row whose PO Dispatch has since been deleted would fail the Link
    # validation one row at a time; filter them out up front instead.
    dispatches = {r["po_dispatch"] for r in src}
    live = set()
    if dispatches:
        d = list(dispatches)
        for i in range(0, len(d), 5000):
            chunk = d[i:i + 5000]
            live.update(frappe.db.sql_list(
                "SELECT name FROM `tabPO Dispatch` WHERE name IN %s", (tuple(chunk),)
            ))

    seen = _existing_keys()
    prev_key = None
    prev_at = None
    written = 0
    skipped_dupe = 0
    skipped_missing = 0
    skipped_noop = 0

    for r in src:
        key = (r["po_dispatch"], r["field_changed"])
        if key != prev_key:
            prev_key, prev_at = key, None

        # Not a transition, and it must not advance prev_at — see the module
        # docstring on why the clock keeps running through a re-stamp.
        if cstr(r["old_value"] or "").strip() == cstr(r["new_value"] or "").strip():
            skipped_noop += 1
            continue

        days = 0.0
        if prev_at is not None:
            secs = time_diff_in_seconds(r["performed_at"], prev_at)
            days = round(flt(secs) / _SECONDS_PER_DAY, 4)
            if days < 0:
                days = 0.0
        prev_at = r["performed_at"]

        if r["po_dispatch"] not in live:
            skipped_missing += 1
            continue
        if (r["po_dispatch"], r["field_changed"], cstr(r["performed_at"])) in seen:
            skipped_dupe += 1
            continue

        doc = frappe.get_doc({
            "doctype": "PO Status Event",
            "po_dispatch": r["po_dispatch"],
            "entity": "PO Dispatch",
            "entity_name": r["po_dispatch"],
            "field_changed": r["field_changed"],
            "old_value": cstr(r["old_value"] or "")[:140],
            "new_value": cstr(r["new_value"] or "")[:140],
            "milestone": r["milestone"] or None,
            "changed_by": r["user"],
            "changed_by_full_name": r["user_full_name"],
            "changed_at": r["performed_at"],
            "days_in_previous": days,
            "batch_id": r["batch_id"],
            "row_count": r["row_count"] or 1,
            "remark": cstr(r["remark"])[:1000] if r["remark"] else None,
        })
        doc.flags.ignore_permissions = True
        doc.insert(ignore_permissions=True)
        written += 1
        if written % _COMMIT_EVERY == 0:
            frappe.db.commit()

    frappe.db.commit()
    print(
        f"backfill_po_status_event_from_pic_log: source={len(src)} written={written} "
        f"skipped_existing={skipped_dupe} skipped_deleted_dispatch={skipped_missing} "
        f"skipped_noop={skipped_noop}"
    )
