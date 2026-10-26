"""
Move the master-data history that already exists into the one event log.

Why
---
Reports read master fields HISTORICALLY — a team's status decides whether it
was available on a given day, its daily_cost what it cost, a subcontract's
monthly_target what the IM was measured against. Re-running September in
December has to give September's answer.

Until now, that history lived in two places and neither was complete:

  * `tabVersion`, written automatically by Frappe on any ORM save — so it
    held Desk edits only. On the production copy: 24 `im` changes, 26
    `status` changes across 15 teams, 54 `daily_cost` changes.
  * `Team Allocation Request`, 92 approved rows, which records that a
    transfer was asked for and approved.

Portal edits (`admin_update_team`, `update_im_team`,
`pm_decide_team_allocation`) wrote through `frappe.db.set_value` and landed in
neither, which is how three teams — 13, 14 and 27 — came to read Active while
their last recorded change said Inactive.

Going forward everything lands in `PO Status Event`: an `on_update` hook for
ORM saves, explicit calls on the three `set_value` paths. This patch moves
what already exists into the same table so a reader has ONE source instead of
three, which is the whole point — every time this codebase has kept two
copies of the same history they have drifted.

What it writes
--------------
One event per recorded change, with the original timestamp and author:

  * every `tabVersion` change to a field in TRACKED_MASTER_FIELDS, for each
    tracked doctype
  * every APPROVED `Team Allocation Request` as an `im` change, since those
    transfers were applied with set_value and so are absent from Version

`days_in_previous` is left at 0 for backfilled rows rather than invented —
the gaps between historical edits are real but were never measured, and a
computed-looking number that nobody can source is worse than a zero.

Idempotent: an event matching entity + name + field + timestamp is not
written twice, so a re-run adds nothing.
"""
import frappe

from inet_app.api.status_log import TRACKED_MASTER_FIELDS


def _already(entity, name, field, changed_at):
    return frappe.db.exists("PO Status Event", {
        "entity": entity, "entity_name": name,
        "field_changed": field, "changed_at": changed_at,
    })


def _write(entity, name, field, old, new, changed_at, user, remark):
    old_s, new_s = frappe.utils.cstr(old or ""), frappe.utils.cstr(new or "")
    if old_s == new_s or _already(entity, name, field, changed_at):
        return False
    doc = frappe.get_doc({
        "doctype": "PO Status Event",
        "entity": entity,
        "entity_name": name,
        "field_changed": field,
        "old_value": old_s[:140],
        "new_value": new_s[:140],
        "changed_by": user,
        "changed_by_full_name": (
            frappe.db.get_value("User", user, "full_name") if user else None) or user,
        "changed_at": changed_at,
        # Not computed — see the module docstring.
        "days_in_previous": 0,
        "remark": remark,
    })
    doc.flags.ignore_permissions = True
    doc.insert(ignore_permissions=True)
    return True


def execute(dry_run=0):
    dry_run = int(dry_run)
    written = {}

    for doctype, fields in TRACKED_MASTER_FIELDS.items():
        tracked = set(fields)
        for v in frappe.db.sql(
            """SELECT docname, creation, owner, data FROM `tabVersion`
                WHERE ref_doctype = %s ORDER BY creation""",
            (doctype,), as_dict=True,
        ):
            try:
                changed = (frappe.parse_json(v.data or "{}") or {}).get("changed") or []
            except Exception:
                continue
            for ch in changed:
                if not ch or ch[0] not in tracked:
                    continue
                if dry_run:
                    written[doctype] = written.get(doctype, 0) + 1
                    continue
                if _write(doctype, v.docname, ch[0], ch[1], ch[2],
                          v.creation, v.owner, "backfilled from Version"):
                    written[doctype] = written.get(doctype, 0) + 1

    # Approved transfers were applied with set_value, so Version never saw
    # them — without these the custody replay loses every proper handover.
    for r in frappe.db.sql(
        """SELECT name, team, from_im, to_im, approved_at, approved_by
             FROM `tabTeam Allocation Request`
            WHERE request_status = 'Approved' AND approved_at IS NOT NULL
            ORDER BY approved_at""", as_dict=True,
    ):
        if dry_run:
            written["Team Allocation Request"] = written.get("Team Allocation Request", 0) + 1
            continue
        if _write("INET Team", r.team, "im", r.from_im, r.to_im,
                  r.approved_at, r.approved_by, f"Team Allocation Request {r.name}"):
            written["Team Allocation Request"] = written.get("Team Allocation Request", 0) + 1

    if not dry_run:
        frappe.db.commit()
    total = sum(written.values())
    print("backfill_master_history_events (%s): %d event(s)"
          % ("DRY RUN" if dry_run else "APPLIED", total))
    for src, n in sorted(written.items()):
        print("  from %-26s %d" % (src, n))
    if dry_run:
        print("  Nothing was written.")
