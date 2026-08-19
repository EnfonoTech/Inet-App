"""Rename the Subcon PO status columns so the names say what they hold.

Before                          After
------                          -----
sub_po_status          (MS1)    sub_po_status_ms1
sub_po_status_ms2      (MS2)    sub_po_status_ms2      (unchanged)
sub_po_status_overall  (roll)   sub_po_status

The original scheme copied the customer side's legacy quirk, where `pic_status`
silently means MS1 and only MS2 carries a suffix. That made `sub_po_status` the
one name a reader would expect to be the single line status while it actually
held one milestone. Now the bare name IS the single status and both milestones
are suffixed.

Runs in [pre_model_sync] so the columns are renamed BEFORE the doctype JSON is
applied — otherwise the sync would add empty columns under the new names and
leave the data stranded in the old ones.
"""

import frappe


def _column_exists(column):
    """Live check against information_schema.

    Deliberately NOT frappe.db.has_column: that reads a cached column list, and
    this patch renames one column and then asks about the name it just freed —
    the cache still reports the pre-ALTER layout, which sent the second rename
    down the merge branch and made it UPDATE a column that no longer existed.
    """
    return bool(frappe.db.sql(
        """SELECT 1 FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tabPO Dispatch'
             AND COLUMN_NAME = %s""",
        (column,),
    ))

# (old, new) in an order that never collides: MS1 moves out of the way first,
# then the rollup takes the freed name.
_RENAMES = (
    ("sub_po_status", "sub_po_status_ms1"),
    ("sub_po_status_overall", "sub_po_status"),
)


def execute():
    table = "tabPO Dispatch"
    for old, new in _RENAMES:
        has_old = _column_exists(old)
        has_new = _column_exists(new)
        if not has_old:
            continue                     # already renamed on this site
        if has_new:
            # Target exists too (a half-applied run, or the sync got there
            # first). Move any values across, then drop the stale source.
            frappe.db.sql(
                f"UPDATE `{table}` SET `{new}` = `{old}` "
                f"WHERE IFNULL(`{old}`, '') != '' AND IFNULL(`{new}`, '') = ''"
            )
            frappe.db.sql(f"ALTER TABLE `{table}` DROP COLUMN `{old}`")
        else:
            frappe.db.sql(
                f"ALTER TABLE `{table}` CHANGE `{old}` `{new}` varchar(140)"
            )
        frappe.db.commit()
        print(f"PO Dispatch: {old} -> {new}")

    # DocField rows are replaced wholesale by the model sync that follows, but
    # the property setters / user settings keyed on the old fieldname are not.
    for old, new in _RENAMES:
        frappe.db.sql(
            "UPDATE `tabProperty Setter` SET field_name = %s "
            "WHERE doc_type = 'PO Dispatch' AND field_name = %s",
            (new, old),
        )
    frappe.db.commit()
    frappe.clear_cache(doctype="PO Dispatch")
