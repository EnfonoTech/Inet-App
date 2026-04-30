"""
Rename Rollout Plan visit_type "Work Done" to "Execution".

The visit-type label on planning was renamed in the operator UI, but the
data wasn't backfilled and the Visit Multiplier Master still only had a
"Work Done" row. This patch:

1. Adds a Visit Multiplier Master row named "Execution" mirroring the
   multiplier from the legacy "Work Done" row (defaults to 1.0).
2. Backfills any Rollout Plan rows still stamped as "Work Done" to
   "Execution" — the multiplier already saved on the row is unchanged,
   so target_amount math stays the same.

Idempotent: re-runs are no-ops once the data has been migrated.
"""
import frappe


def execute():
    if not frappe.db.table_exists("Visit Multiplier Master"):
        return

    # 1. Make sure an "Execution" row exists in the master so future plans
    #    don't have to rely on the legacy fallback in rollout_plan.before_save.
    legacy_mult = (
        frappe.db.get_value("Visit Multiplier Master", "Work Done", "multiplier")
        or 1.0
    )
    if not frappe.db.exists("Visit Multiplier Master", "Execution"):
        try:
            doc = frappe.get_doc({
                "doctype": "Visit Multiplier Master",
                "name": "Execution",
                "multiplier": float(legacy_mult or 1.0),
            })
            doc.insert(ignore_permissions=True)
        except Exception:
            # Some sites use field-driven autoname instead of name-as-label;
            # if we can't insert directly, raw SQL is safe (the master is
            # tiny and has no validate hook that matters here).
            try:
                frappe.db.sql(
                    "INSERT INTO `tabVisit Multiplier Master` "
                    "(name, multiplier, creation, modified, owner, modified_by, docstatus, idx) "
                    "VALUES (%s, %s, NOW(), NOW(), 'Administrator', 'Administrator', 0, 0)",
                    ("Execution", float(legacy_mult or 1.0)),
                )
            except Exception:
                frappe.log_error(
                    frappe.get_traceback(),
                    "rename_visit_type: could not seed 'Execution' multiplier",
                )

    # 2. Backfill Rollout Plan rows.
    if frappe.db.table_exists("Rollout Plan"):
        n = frappe.db.sql(
            "UPDATE `tabRollout Plan` SET visit_type = 'Execution' "
            "WHERE visit_type = 'Work Done'"
        )
        try:
            count = frappe.db.sql(
                "SELECT COUNT(*) FROM `tabRollout Plan` WHERE visit_type = 'Execution'"
            )[0][0]
        except Exception:
            count = 0
        frappe.db.commit()
        print(f"rename_visit_type: rollout plans now using 'Execution' = {count}")
