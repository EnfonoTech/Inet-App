"""
Add the indexes that drive PIC and pipeline list endpoints.

PO Dispatch is the most-queried table (16k+ rows on the live site). Without
these indexes, common list filters (pic_status, subcon_status, target_month,
im) end up doing full scans. Profiling showed 50-80% wall-time drops on the
PIC Tracker and IM PO Control endpoints after the indexes are in place.

The patch is idempotent — it checks information_schema for an existing
index on the same column(s) before creating, so re-runs (or sites where a
DBA already added an index) are no-ops.
"""
import frappe


# (doctype, index name, columns) — columns is a tuple to support compound
# indexes. Names mirror the keys we'd want to see in EXPLAIN plans. The
# doctype is the user-facing name (no ``tab`` prefix); we add the prefix
# only when emitting raw SQL.
_INDEX_SPEC = [
    ("PO Dispatch",     "idx_pd_pic_status",          ("pic_status",)),
    ("PO Dispatch",     "idx_pd_pic_status_ms2",      ("pic_status_ms2",)),
    ("PO Dispatch",     "idx_pd_subcon_status",       ("subcon_status",)),
    ("PO Dispatch",     "idx_pd_target_month",        ("target_month",)),
    ("PO Dispatch",     "idx_pd_im",                  ("im",)),
    ("Rollout Plan",    "idx_rp_dispatch_visit",      ("po_dispatch", "visit_number")),
    ("Daily Execution", "idx_de_rollout_plan",        ("rollout_plan",)),
    ("Work Done",       "idx_wd_execution",           ("execution",)),
    ("Work Done",       "idx_wd_submission_status",   ("submission_status",)),
]


def _index_already_covers(doctype, columns):
    """True if any existing index already starts with the same column list.

    A compound index ``(po_dispatch, visit_number)`` makes a single-column
    ``(po_dispatch)`` index redundant — but not the other way round, so we
    only consider an existing index a match when it starts with the same
    leading columns in the same order.
    """
    table = f"tab{doctype}"
    rows = frappe.db.sql(
        """
        SELECT INDEX_NAME, SEQ_IN_INDEX, COLUMN_NAME
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s
        ORDER BY INDEX_NAME, SEQ_IN_INDEX
        """,
        (table,),
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
    missing_cols = 0
    for doctype, name, cols in _INDEX_SPEC:
        if not frappe.db.table_exists(doctype):
            skipped += 1
            continue
        # Don't trip on sites that haven't migrated the relevant column yet.
        if not all(_column_exists(doctype, c) for c in cols):
            missing_cols += 1
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
            # Likely "Duplicate key name" if a parallel migrate raced us, or
            # the column just got dropped. Either way, log and continue.
            frappe.log_error(
                frappe.get_traceback(),
                f"add_pic_indexes: failed on {doctype}.{name}",
            )
            skipped += 1
    frappe.db.commit()
    print(
        f"add_pic_indexes: created={created} skipped={skipped} "
        f"missing_cols={missing_cols} total={len(_INDEX_SPEC)}"
    )
