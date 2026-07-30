"""
Add the (po_intake, po_line_no) composite index on PO Dispatch.

This is the join key used by list_po_intake_lines (admin PO Dispatch page)
every time a search/filter is active — PO Dispatch is always LEFT JOINed on
``pd.po_intake = pil.parent AND pd.po_line_no = pil.po_line_no``. Without an
index on these columns, MySQL falls back to a block-nested-loop join between
two ~16k-row tables (PO Intake Line x PO Dispatch), which measured at over a
minute per search on the live site. add_pic_indexes.py added several other
PO Dispatch indexes but missed this one, which is the actual bottleneck for
the toolbar search/filter box, not just PIC-specific list views.

Follows the same idempotent pattern as add_pic_indexes.py — safe to re-run.
"""
import frappe


def _index_already_covers(doctype, columns):
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
    doctype = "PO Dispatch"
    name = "idx_pd_po_intake_line"
    cols = ("po_intake", "po_line_no")

    if not frappe.db.table_exists(doctype):
        print(f"add_po_dispatch_intake_line_index: skipped, no {doctype} table")
        return
    if not all(_column_exists(doctype, c) for c in cols):
        print("add_po_dispatch_intake_line_index: skipped, missing column(s)")
        return
    if _index_already_covers(doctype, cols):
        print("add_po_dispatch_intake_line_index: already covered, skipped")
        return

    col_sql = ", ".join(f"`{c}`" for c in cols)
    try:
        frappe.db.sql_ddl(f"ALTER TABLE `tab{doctype}` ADD INDEX `{name}` ({col_sql})")
        frappe.db.commit()
        print(f"add_po_dispatch_intake_line_index: created index {name} on {doctype}({col_sql})")
    except Exception:
        frappe.log_error(
            frappe.get_traceback(),
            "add_po_dispatch_intake_line_index: failed",
        )
        print("add_po_dispatch_intake_line_index: FAILED, see error log")
