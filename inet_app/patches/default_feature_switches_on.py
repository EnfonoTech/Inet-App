"""Turn the INET Settings feature switches ON for sites that already exist.

A Check added to a Single that already has a saved document does not pick up
its JSON default: the stored doc simply has no value for it. The settings form
then renders the box UNCHECKED, and the first time anyone opens and saves that
page — for any reason at all — Frappe writes an explicit 0 and the route goes
dark for everyone.

`feature_enabled` treats a missing row as ON, which covers the never-saved
case. This covers the other one: it writes an explicit 1 so the form shows the
switch the way it actually behaves, and saving the page changes nothing.

Only ever writes where there is no value. A switch somebody has deliberately
turned off stays off.
"""

import frappe


def execute():
    from inet_app.api.features import FEATURES

    if not frappe.db.exists("DocType", "INET Settings"):
        return

    existing = {
        r[0] for r in frappe.db.sql(
            """SELECT field FROM `tabSingles`
               WHERE doctype = 'INET Settings' AND field IN %(f)s
                 AND IFNULL(value, '') != ''""",
            {"f": list(FEATURES)},
        )
    }
    turned_on = []
    for fieldname in FEATURES:
        if fieldname in existing:
            continue
        frappe.db.set_single_value("INET Settings", fieldname, 1)
        turned_on.append(fieldname)

    if turned_on:
        frappe.db.commit()
        frappe.clear_cache(doctype="INET Settings")
        print(f"INET Settings: switched on {', '.join(turned_on)}")
