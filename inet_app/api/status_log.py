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
