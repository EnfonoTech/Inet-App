"""
Add the compound index behind the Weekly Forecast horizon query.

``get_rollout_forecast_dashboard`` scans PO Dispatch by ``target_week`` within
an IM scope, so ``(im, target_week)`` is the shape that matters — the scope
clause puts ``pd.im IN (...)`` first and the horizon range follows.

Only the COMPOUND index lives here. Single-column indexes must be declared as
``"search_index": 1`` in the doctype JSON instead: Frappe's schema sync drops
any single-column index on a field whose meta lacks that flag, which is what
silently reverted seven of the nine indexes in ``add_pic_indexes`` (they were
created, then removed by the next ``bench migrate``). Compound indexes are
invisible to that logic and survive, which is why this one is safe as a patch.

``target_week`` itself is indexed via the doctype JSON, and this compound index
covers ``im`` as a leading column — the standalone ``im`` index (also declared
in the JSON) stays because plenty of queries filter on ``im`` alone.

Idempotent: checks information_schema for an existing index with the same
leading columns before creating, so re-runs are no-ops.
"""
import frappe


_INDEX_SPEC = [
    ("PO Dispatch", "idx_pd_im_target_week", ("im", "target_week")),
]


def _index_already_covers(doctype, columns):
    """True if any existing index already starts with the same column list."""
    rows = frappe.db.sql(
        """
        SELECT INDEX_NAME, SEQ_IN_INDEX, COLUMN_NAME
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s
        ORDER BY INDEX_NAME, SEQ_IN_INDEX
        """,
        (f"tab{doctype}",),
        as_dict=True,
    )
    by_index = {}
    for r in rows:
        by_index.setdefault(r["INDEX_NAME"], []).append(r["COLUMN_NAME"])
    target = list(columns)
    for cols in by_index.values():
        if cols[: len(target)] == target:
            return True
    return False


def _column_exists(doctype, column):
    rows = frappe.db.sql(
        """
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s AND COLUMN_NAME = %s
        """,
        (f"tab{doctype}", column),
    )
    return bool(rows)


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
                f"add_po_dispatch_forecast_indexes: failed on {doctype}.{name}",
            )
            skipped += 1
    frappe.db.commit()
    print(
        f"add_po_dispatch_forecast_indexes: created={created} "
        f"skipped={skipped} total={len(_INDEX_SPEC)}"
    )
