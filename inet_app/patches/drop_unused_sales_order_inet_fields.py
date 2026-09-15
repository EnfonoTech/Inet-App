"""Drop the abandoned Sales Order import-mapping custom fields.

Eighteen `inet_*` fields were added to Sales Order / Sales Order Item for an
import-mapping experiment that was never finished. Nothing in the app reads or
writes any of them — verified across inet_app/ and frontend/src, zero
references — and they were never shipped: absent from fixtures/custom_field.json
and never created by setup.py, so only the site they were hand-made on has them.

They mattered because that mismatch is what hid a real bug. Comparing the
custom fields on a site against what the app ships is how
`Sales Invoice Item.milestone` was found missing on production (invoicing 500'd
with "Unknown column 'sii.milestone'"), and eighteen dead entries in that same
comparison is noise that makes the next such check harder to read.

Scoped on all three of dt, the `inet_` prefix and module, rather than by
fieldname alone — Sales Order has plenty of core fields, and a loose delete here
would take real ones with it.

Frappe does not drop the underlying column, so nothing is destroyed even if a
site turns out to hold data (the site this was written against has zero Sales
Orders). Idempotent: a site without them deletes nothing.
"""

import frappe

DOCTYPES = ("Sales Order", "Sales Order Item")


def execute():
    # The prefix is matched in Python, not with a LIKE. Frappe's `like` does
    # not take the backslash escape (`inet\_%` matches nothing here), and an
    # unescaped `inet_%` leans on `_` being a single-character wildcard — too
    # loose for a delete. dt + module already select exactly this set; the
    # startswith is a guard that can only narrow it further.
    rows = frappe.get_all(
        "Custom Field",
        filters={"dt": ["in", DOCTYPES], "module": "Inet App"},
        fields=["name", "fieldname"],
        ignore_permissions=True,
    )
    names = [r.name for r in rows if (r.fieldname or "").startswith("inet_")]
    if not names:
        return

    for name in names:
        try:
            frappe.delete_doc("Custom Field", name, ignore_permissions=True, force=True)
        except Exception:
            frappe.log_error(frappe.get_traceback(), f"Could not drop Custom Field {name}")

    frappe.db.commit()
    print(f"dropped {len(names)} unused Sales Order inet_* custom fields")
