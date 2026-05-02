import frappe


def after_migrate():
    # Ensure child table doctype remains available for Project Control Center.
    frappe.reload_doc("inet_app", "doctype", "project_kpi_slab")
    _ensure_inet_roles()
    _ensure_item_activity_type_field()
    _hide_unused_activity_type_fields()
    _drop_unused_customer_activity_type_doctype()
    _resync_pms_workspace()


def _resync_pms_workspace():
    """Frappe only re-imports a workspace JSON when its `modified` is
    newer than the DB row. Editors often touch the JSON without bumping
    the timestamp, so the DB silently stays stale. Force a re-import on
    every migrate by clearing the row and re-loading the file."""
    try:
        from frappe.modules.import_file import import_file_by_path
    except Exception:
        return
    workspace_json = frappe.get_app_path(
        "inet_app", "inet_app", "workspace", "pms", "pms.json",
    )
    try:
        frappe.db.sql("DELETE FROM `tabWorkspace Shortcut` WHERE parent = 'PMS'")
        frappe.db.sql("DELETE FROM `tabWorkspace Link` WHERE parent = 'PMS'")
        frappe.db.sql("DELETE FROM `tabWorkspace` WHERE name = 'PMS'")
        frappe.db.commit()
        import_file_by_path(workspace_json, force=True)
        frappe.db.commit()
        frappe.clear_cache()
    except Exception:
        pass


def _drop_unused_customer_activity_type_doctype():
    """The 'Customer Activity Type' doctype is unused — Item.activity_type
    and Customer Item Master.customer_activity_type both Link to ERPNext's
    'Activity Type'. Drop the orphan DocType record (and its table) on
    sites that still have it from an earlier install."""
    name = "Customer Activity Type"
    try:
        if frappe.db.exists("DocType", name):
            frappe.delete_doc("DocType", name, ignore_missing=True, force=True)
            frappe.db.commit()
    except Exception:
        # Best-effort — don't break migrate if the delete fails.
        pass


def _hide_unused_activity_type_fields():
    """Hide ERPNext Activity Type fields that this app doesn't use:
    Default Costing Rate, Default Billing Rate, Disabled. Leaves only
    the activity_type (name) field visible on the form / list.

    Done via Property Setter (Frappe-idiomatic) so we never touch the
    ERPNext source doctype JSON.
    """
    try:
        from frappe.custom.doctype.property_setter.property_setter import (
            make_property_setter,
        )
    except Exception:
        return
    for fieldname in ("costing_rate", "billing_rate", "disabled"):
        try:
            make_property_setter(
                "Activity Type", fieldname, "hidden", 1, "Check",
                for_doctype=False, validate_fields_for_doctype=False,
            )
        except Exception:
            # Best-effort — don't break migrate if Frappe internals shift.
            pass


def _ensure_item_activity_type_field():
    """Add an ``activity_type`` Link field on the standard ERPNext Item
    doctype so activity type is keyed per-item (it doesn't vary by
    customer). Reads should prefer this column over the older
    Customer Item Master.customer_activity_type mapping."""
    try:
        from frappe.custom.doctype.custom_field.custom_field import (
            create_custom_field,
        )
    except Exception:
        return
    try:
        create_custom_field(
            "Item",
            {
                "fieldname": "activity_type",
                "fieldtype": "Link",
                "options": "Activity Type",
                "label": "Activity Type",
                "insert_after": "item_group",
                "translatable": 0,
            },
        )
    except Exception:
        # Best-effort — don't break migrate if Frappe internals shift.
        pass


def _ensure_inet_roles():
    """Create the INET application roles if they aren't already present.

    Frappe stores roles in the ``Role`` doctype. Re-running ``bench migrate``
    should be idempotent — we only insert when missing.
    """
    inet_roles = ["INET Admin", "INET IM", "INET Field Team", "INET PIC"]
    for role_name in inet_roles:
        if frappe.db.exists("Role", role_name):
            continue
        try:
            doc = frappe.get_doc({
                "doctype": "Role",
                "role_name": role_name,
                "desk_access": 0,
            })
            doc.insert(ignore_permissions=True)
        except Exception:
            # Best-effort: don't fail migrate if a role can't be created.
            pass
    frappe.db.commit()
