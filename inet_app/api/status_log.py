"""Status transition log — when a PO line changed stage, and how long it sat.

Why this exists rather than Frappe's own versioning: ``save_version()`` is
called from exactly one place, ``Document.save()``. Almost every status write in
this app goes through ``frappe.db.set_value()``, which runs a raw UPDATE and
never reaches the document layer — its own docstring says it "will not call
Document events". The ``update_modified`` argument only controls whether the
``modified`` column is written; it has nothing to do with versioning, so no flag
change would produce a history.

Moving those writes to ``doc.save()`` was rejected: a PO Dispatch save runs
``_ensure_duid_master()``, the payment-terms regex, ``_compute_ms_amounts()``
and fires ``_cascade_im_on_dispatch`` from ``on_update``, so a PIC bulk update
of 47 rows would become 47 document loads and saves instead of 47 UPDATEs. And
``tabVersion`` stores one JSON blob per save with no indexed column for field,
old value or new value — unusable as a reporting source.

So the log is written explicitly, beside each ``set_value``. Every writer here
is best-effort: an audit write must never block the user's primary action, which
is the same stance ``_write_pic_activity_log`` in ``pic.py`` already takes.
"""

import frappe
from frappe.utils import cstr, flt, now_datetime, time_diff_in_seconds

# Fields worth logging. Anything not listed still logs if passed explicitly —
# this is documentation of intent, not a filter.
TRACKED_FIELDS = (
    # PO Dispatch
    "dispatch_status",
    "pic_status",
    "pic_status_ms2",
    "subcon_submission_status",
    "subcon_status",
    "cancel_request_status",
    "confirmed_qty",
    "remaining_qty_action",
    # Work Done
    "submission_status",
    # Rollout Plan
    "plan_status",
    # Daily Execution — the execution chain, which is where most of the
    # waiting actually happens (QC and CIAG in particular).
    "execution_status",
    "tl_status",
    "qc_status",
    "ciag_status",
)

_SECONDS_PER_DAY = 86400.0


# Which stamp each submission_status writes. "" (not set) writes none of
# them -- a line that has never been submitted has no submission date.
_SUBMISSION_DATE_FIELDS = {
    "Ready for Confirmation": "ready_for_confirmation_at",
    "Confirmation Done": "confirmed_at",
    "PIC Rejected": "pic_rejected_at",
}


def stamp_submission_status_dates(work_done, new_status, when=None):
    """Record WHEN a Work Done reached this submission status.

    Called from every place submission_status is written, so a date can
    never disagree with the status beside it. Derived answers were tried
    first and both failed: `modified` moves on any edit, and PO Status Event
    covered 49 of 936 operational rows because the PIC rejection path never
    logged.

    ``submission_status_changed_at`` is the ageing anchor -- "how long has
    this line been sitting here" is today minus that, whatever the status.
    The per-status stamps answer "when did this happen", and record the
    LATEST occurrence: a line confirmed, rejected, then confirmed again
    carries the second confirmation, because that is the one still true.

    Never raises. A missing stamp must not fail the transition that was the
    point of the call.
    """
    if not work_done:
        return
    try:
        when = when or now_datetime()
        updates = {"submission_status_changed_at": when}
        field = _SUBMISSION_DATE_FIELDS.get((new_status or "").strip())
        if field:
            updates[field] = when
        updates = {k: v for k, v in updates.items()
                   if frappe.db.has_column("Work Done", k)}
        if updates:
            frappe.db.set_value("Work Done", work_done, updates,
                                update_modified=False)
    except Exception:
        frappe.log_error(frappe.get_traceback(),
                         "stamp_submission_status_dates failed")


def _previous_event(po_dispatch, field_changed):
    """The most recent event for this line and field, or None."""
    rows = frappe.db.sql(
        """
        SELECT name, new_value, changed_at
        FROM `tabPO Status Event`
        WHERE po_dispatch = %s AND field_changed = %s
        ORDER BY changed_at DESC, creation DESC
        LIMIT 1
        """,
        (po_dispatch, field_changed),
        as_dict=True,
    )
    return rows[0] if rows else None


def log_status_event(
    po_dispatch,
    field_changed,
    old_value,
    new_value,
    *,
    entity="PO Dispatch",
    entity_name=None,
    milestone=None,
    remark=None,
    batch_id=None,
    row_count=1,
    changed_at=None,
    user=None,
    stamp_stage=True,
):
    """Record one status transition. Returns the event name, or None if skipped.

    A no-op change (old == new) is not logged — bulk setters routinely re-apply
    the value a row already holds, and logging those would bury the real
    transitions and corrupt the ageing maths.
    """
    try:
        po_dispatch = cstr(po_dispatch or "").strip()
        field_changed = cstr(field_changed or "").strip()
        if not po_dispatch or not field_changed:
            return None

        old_s = cstr(old_value or "").strip()
        new_s = cstr(new_value or "").strip()
        if old_s == new_s:
            return None

        changed_at = changed_at or now_datetime()
        user = user or frappe.session.user

        # Days spent at the previous value. The first event for a field has no
        # predecessor, so it carries 0 rather than a made-up duration.
        days = 0.0
        prev = _previous_event(po_dispatch, field_changed)
        if prev and prev.get("changed_at"):
            secs = time_diff_in_seconds(changed_at, prev["changed_at"])
            days = round(flt(secs) / _SECONDS_PER_DAY, 4)
            if days < 0:
                days = 0.0

        doc = frappe.get_doc({
            "doctype": "PO Status Event",
            "po_dispatch": po_dispatch,
            "entity": entity,
            "entity_name": entity_name or po_dispatch,
            "field_changed": field_changed,
            "old_value": old_s[:140],
            "new_value": new_s[:140],
            "milestone": milestone or None,
            "changed_by": user,
            "changed_by_full_name": (
                frappe.db.get_value("User", user, "full_name") if user else None
            ) or user or "Guest",
            "changed_at": changed_at,
            "days_in_previous": days,
            "batch_id": batch_id,
            "row_count": row_count or 1,
            "remark": (cstr(remark)[:1000] if remark else None),
        })
        doc.flags.ignore_permissions = True
        doc.insert(ignore_permissions=True)

        # Denormalised so list views can age a line without joining this table.
        if stamp_stage and frappe.db.has_column("PO Dispatch", "stage_entered_at"):
            frappe.db.set_value(
                "PO Dispatch", po_dispatch, "stage_entered_at", changed_at,
                update_modified=False,
            )
        return doc.name
    except Exception:
        frappe.log_error(frappe.get_traceback(), "PO Status Event write failed")
        return None


def log_status_events(entries, *, batch_id=None, **shared):
    """Log a batch of transitions under one batch_id.

    ``entries`` is a list of dicts carrying at least ``po_dispatch``,
    ``field_changed``, ``old_value`` and ``new_value``. Anything in ``shared``
    is applied to every entry unless the entry overrides it.
    """
    entries = [e for e in (entries or []) if e]
    if not entries:
        return []
    batch_id = batch_id or frappe.generate_hash(length=10)
    changed_at = shared.pop("changed_at", None) or now_datetime()
    written = []
    for entry in entries:
        kwargs = dict(shared)
        kwargs.update({k: v for k, v in entry.items()
                       if k not in ("po_dispatch", "field_changed", "old_value", "new_value")})
        name = log_status_event(
            entry.get("po_dispatch"),
            entry.get("field_changed"),
            entry.get("old_value"),
            entry.get("new_value"),
            batch_id=batch_id,
            row_count=len(entries),
            changed_at=changed_at,
            **kwargs,
        )
        if name:
            written.append(name)
    return written


def set_dispatch_status(po_dispatch, new_status, *, remark=None, batch_id=None,
                        row_count=1, extra=None, update_modified=False):
    """Set ``PO Dispatch.dispatch_status`` and log the transition in one step.

    Prefer this over a bare ``frappe.db.set_value`` for dispatch_status so the
    stage clock and the event log cannot drift from the value. ``extra`` is a
    dict of other columns to write in the same update.

    Returns True when the status actually changed.
    """
    po_dispatch = cstr(po_dispatch or "").strip()
    if not po_dispatch:
        return False
    old = frappe.db.get_value("PO Dispatch", po_dispatch, "dispatch_status") or ""
    new = cstr(new_status or "").strip()

    updates = dict(extra or {})
    updates["dispatch_status"] = new
    frappe.db.set_value("PO Dispatch", po_dispatch, updates, update_modified=update_modified)

    if cstr(old).strip() == new:
        return False
    log_status_event(
        po_dispatch, "dispatch_status", old, new,
        remark=remark, batch_id=batch_id, row_count=row_count,
    )
    return True


# ─── Master-data history ────────────────────────────────────────────────────
# Reports read master fields HISTORICALLY: re-running September in December
# must give September's answer. A team's status decides whether it was
# available, its daily_cost what it cost, a subcontract's monthly_target what
# the IM was measured against. All of those are editable, and until now only
# the ones living on a PO line were ever logged.
#
# The rule is simply: track what the reporting depends on. These are the
# fields the IM Performance report reads (docs/IM_PERFORMANCE_REPORT.md);
# anything a future report starts reading historically belongs here too.
#
# This is why `PO Dispatch` is no longer required on PO Status Event — the
# doctype already carried `entity` / `entity_name`, so it only ever needed
# that one field relaxed to become the general log it reads like.
TRACKED_MASTER_FIELDS = {
    "INET Team": ("im", "status", "daily_cost", "daily_cost_applies",
                  "team_type", "team_category", "start_date", "end_date"),
    "Subcontract Master": ("monthly_target", "sub_payout_pct", "inet_margin_pct",
                           "status", "contract_model"),
    "IM Master": ("status", "full_name"),
    "Inet Settings": ("inet_target_margin_pct",),
}


def log_entity_change(entity, entity_name, field_changed, old_value, new_value,
                      *, remark=None, changed_at=None, user=None):
    """One field change on a record that is NOT a PO line.

    Same table and same shape as a PO event, so a reader does not have to know
    which kind it is — only `entity` differs, and `po_dispatch` is empty.
    `days_in_previous` is measured against this entity's own previous event.

    Never raises: history that fails to write must not fail the edit.
    """
    try:
        entity = cstr(entity or "").strip()
        entity_name = cstr(entity_name or "").strip()
        field_changed = cstr(field_changed or "").strip()
        if not entity or not entity_name or not field_changed:
            return None
        old_s, new_s = cstr(old_value or "").strip(), cstr(new_value or "").strip()
        if old_s == new_s:
            return None

        changed_at = changed_at or now_datetime()
        user = user or frappe.session.user
        days = 0.0
        prev = frappe.db.sql(
            """SELECT changed_at FROM `tabPO Status Event`
                WHERE entity = %s AND entity_name = %s AND field_changed = %s
                ORDER BY changed_at DESC LIMIT 1""",
            (entity, entity_name, field_changed), as_dict=True,
        )
        if prev and prev[0].get("changed_at"):
            secs = time_diff_in_seconds(changed_at, prev[0]["changed_at"])
            days = max(round(flt(secs) / _SECONDS_PER_DAY, 4), 0.0)

        doc = frappe.get_doc({
            "doctype": "PO Status Event",
            "entity": entity,
            "entity_name": entity_name,
            "field_changed": field_changed,
            "old_value": old_s[:140],
            "new_value": new_s[:140],
            "changed_by": user,
            "changed_by_full_name": (
                frappe.db.get_value("User", user, "full_name") if user else None
            ) or user or "Guest",
            "changed_at": changed_at,
            "days_in_previous": days,
            "remark": (cstr(remark)[:1000] if remark else None),
        })
        doc.flags.ignore_permissions = True
        doc.insert(ignore_permissions=True)
        return doc.name
    except Exception:
        frappe.log_error(frappe.get_traceback(),
                         f"entity event write failed: {entity} {entity_name}")
        return None


def log_master_changes(doc, method=None):
    """`on_update` hook — catches every ORM save, in Desk or in code.

    It does NOT catch `frappe.db.set_value`, which bypasses the document
    entirely. The portal endpoints that use it call `log_master_set_value`
    themselves; this covers everything else without each path remembering to.
    """
    fields = TRACKED_MASTER_FIELDS.get(doc.doctype)
    if not fields:
        return
    before = doc.get_doc_before_save()
    if not before:
        return
    name = doc.name if doc.doctype != "Inet Settings" else "Inet Settings"
    for f in fields:
        log_entity_change(doc.doctype, name, f,
                          before.get(f), doc.get(f))


def log_master_set_value(doctype, name, before, updates, *, remark=None):
    """The `frappe.db.set_value` counterpart of the hook above.

    `before` is whatever the row held before the write — read it BEFORE
    writing, or there is nothing to compare against.
    """
    fields = TRACKED_MASTER_FIELDS.get(doctype)
    if not fields or not updates:
        return
    for f in fields:
        if f in updates:
            log_entity_change(doctype, name, f, (before or {}).get(f),
                              updates.get(f), remark=remark)
