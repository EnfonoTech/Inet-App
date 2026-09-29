"""
Add the compound index behind the status-log lookups.

``log_status_event`` reads the previous event for a line and field on every
write — ``WHERE po_dispatch = %s AND field_changed = %s ORDER BY changed_at
DESC`` — so ``(po_dispatch, field_changed, changed_at)`` is the shape that
matters. Without it every write scans the line's whole event history.

The ageing reports run the same leading columns with an ``old_value`` filter
("days spent under I-BUY"), which this index also serves.

Only the COMPOUND index lives here. Single-column indexes must be declared as
``"search_index": 1`` in the doctype JSON instead — Frappe's schema sync drops
any single-column index on a field whose meta lacks that flag. The same note on
``add_po_dispatch_forecast_indexes`` explains the history behind that rule.

Idempotent: checks information_schema for an existing index with the same
leading columns before creating, so re-runs are no-ops.
"""
import frappe

from inet_app.patches.v1_0.add_po_dispatch_forecast_indexes import (
    _column_exists,
    _index_already_covers,
)

_INDEX_SPEC = [
    (
        "PO Status Event",
        "idx_pse_dispatch_field_at",
        ("po_dispatch", "field_changed", "changed_at"),
    ),
]


def execute():
    created = 0
    skipped = 0
    for doctype, name, cols in _INDEX_SPEC:
        if not frappe.db.table_exists(doctype):
            skipped += 1
            continue
        if not all(_column_exists(doctype, c) for c in cols):
            skipped += 1
            continue
        if _index_already_covers(doctype, cols):
            skipped += 1
            continue
        col_sql = ", ".join(f"`{c}`" for c in cols)
        try:
            frappe.db.sql_ddl(
                f"ALTER TABLE `tab{doctype}` ADD INDEX `{name}` ({col_sql})"
            )
            created += 1
        except Exception:
            frappe.log_error(
                frappe.get_traceback(),
                f"add_po_status_event_indexes: failed on {doctype}.{name}",
            )
            skipped += 1
    frappe.db.commit()
    print(
        f"add_po_status_event_indexes: created={created} "
        f"skipped={skipped} total={len(_INDEX_SPEC)}"
    )
