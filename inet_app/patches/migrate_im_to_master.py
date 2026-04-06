"""
Populate IM Master from existing IM text values in INET Team, PO Dispatch,
and Project Control Center.
"""
import frappe


def execute():
    # Skip if IM Master table doesn't exist yet
    if not frappe.db.table_exists("tabIM Master"):
        return

    im_names = set()

    # 1. Collect from INET Team
    team_ims = frappe.db.sql(
        "SELECT DISTINCT im FROM `tabINET Team` WHERE im IS NOT NULL AND im != ''",
        as_dict=True,
    )
    for row in team_ims:
        name = (row.im or "").strip()
        if name:
            im_names.add(name)

    # 2. Collect from PO Dispatch
    dispatch_ims = frappe.db.sql(
        "SELECT DISTINCT im FROM `tabPO Dispatch` WHERE im IS NOT NULL AND im != ''",
        as_dict=True,
    )
    for row in dispatch_ims:
        name = (row.im or "").strip()
        if name:
            im_names.add(name)

    # 3. Collect from Project Control Center
    project_ims = frappe.db.sql(
        "SELECT DISTINCT implementation_manager FROM `tabProject Control Center` WHERE implementation_manager IS NOT NULL AND implementation_manager != ''",
        as_dict=True,
    )
    for row in project_ims:
        name = (row.implementation_manager or "").strip()
        if name:
            im_names.add(name)

    created = 0
    skipped = 0
    for im_name in sorted(im_names):
        if frappe.db.exists("IM Master", im_name):
            skipped += 1
            continue

        doc = frappe.get_doc({
            "doctype": "IM Master",
            "im_id": im_name,
            "full_name": im_name,
            "status": "Active",
        })
        doc.insert(ignore_permissions=True)
        created += 1

    frappe.db.commit()
    print(f"IM Master migration: {created} created, {skipped} already existed, from {len(im_names)} unique IM names")
