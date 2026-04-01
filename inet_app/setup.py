import frappe


def after_migrate():
    # Ensure child table doctype remains available for Project Control Center.
    frappe.reload_doc("inet_app", "doctype", "project_kpi_slab")
