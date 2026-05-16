import frappe


def after_migrate():
    # Ensure child table doctype remains available for Project Control Center.
    frappe.reload_doc("inet_app", "doctype", "project_kpi_slab")
    # Multi-team plan support — child table on Rollout Plan.
    try:
        frappe.reload_doc("inet_app", "doctype", "rollout_plan_team")
    except Exception:
        pass
    # Team Allocation Request — IM-to-IM transfer with PM approval.
    try:
        frappe.reload_doc("inet_app", "doctype", "team_allocation_request")
    except Exception:
        pass
    _ensure_inet_roles()
    _ensure_item_activity_type_field()
    _hide_unused_activity_type_fields()
    _drop_unused_customer_activity_type_doctype()
    _resync_pms_workspace()
    _resync_warehouse_workspace()
    _ensure_stock_manager_role()
    _ensure_duid_inventory_dimension()
    _ensure_outbound_custom_fields()


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
        "inet_app", "workspace", "pms", "pms.json",
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


def _resync_warehouse_workspace():
    """Create Warehouse Management workspace programmatically."""
    import json

    workspace_name = "Warehouse Management"
    content = [
        {"id": "H1", "type": "header", "data": {"text": '<span class="h4">Inventory</span>', "col": 12}},
        {"id": "S1", "type": "shortcut", "data": {"shortcut_name": "Huawei Outbound Plan", "col": 3}},
        {"id": "S2", "type": "shortcut", "data": {"shortcut_name": "Stock Entry", "col": 3}},
        {"id": "S3", "type": "shortcut", "data": {"shortcut_name": "Item", "col": 3}},
        {"id": "S4", "type": "shortcut", "data": {"shortcut_name": "Warehouse", "col": 3}},
        {"id": "H2", "type": "header", "data": {"text": '<span class="h4">Masters</span>', "col": 12}},
        {"id": "S5", "type": "shortcut", "data": {"shortcut_name": "DUID Master", "col": 3}},
        {"id": "S6", "type": "shortcut", "data": {"shortcut_name": "Huawei Subcon Master", "col": 3}},
    ]

    if frappe.db.exists("Workspace", workspace_name):
        frappe.db.set_value("Workspace", workspace_name, "content", json.dumps(content))
        frappe.db.commit()
    else:
        try:
            frappe.get_doc({
                "doctype": "Workspace",
                "name": workspace_name,
                "label": workspace_name,
                "title": workspace_name,
                "module": "Inet App",
                "icon": "project-2",
                "public": 1,
                "content": json.dumps(content),
                "roles": [],
                "shortcuts": [],
                "links": [],
            }).insert(ignore_permissions=True)
            frappe.db.commit()
        except Exception:
            frappe.log_error(frappe.get_traceback(), "Workspace creation failed")


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
                "desk_access": 1 if role_name == "INET PIC" else 0,
            })
            doc.insert(ignore_permissions=True)
        except Exception:
            # Best-effort: don't fail migrate if a role can't be created.
            pass
    frappe.db.commit()

    # Grant desk access to existing PIC role
    frappe.db.set_value("Role", "INET PIC", "desk_access", 1)

    # Grant INET PIC role access to Sales Invoice doctype for invoicing
    _ensure_pic_permissions()


def _ensure_pic_permissions():
    """Grant INET PIC role the permissions needed for invoice creation."""
    role = "INET PIC"
    if not frappe.db.exists("Role", role):
        return

    # Doctypes PIC needs access to
    doctypes = [
        ("Sales Invoice", ("read", "write", "create")),
        ("Sales Invoice Item", ("read", "write", "create")),
        ("Sales Taxes and Charges", ("read",)),
        ("Sales Taxes and Charges Template", ("read",)),
        ("Customer", ("read",)),
        ("Item", ("read",)),
    ]

    for dt_name, perms in doctypes:
        if not frappe.db.exists("DocType", dt_name):
            continue
        for perm_level in perms:
            if frappe.db.exists("Custom DocPerm", {"parent": dt_name, "role": role}):
                frappe.db.set_value("Custom DocPerm", {"parent": dt_name, "role": role}, perm_level, 1)
            else:
                try:
                    dp = frappe.get_doc({
                        "doctype": "Custom DocPerm",
                        "parent": dt_name,
                        "role": role,
                        perm_level: 1,
                    })
                    dp.insert(ignore_permissions=True)
                except Exception:
                    pass
    frappe.db.commit()


def _ensure_stock_manager_role():
    """Create Stock Manager role if not present."""
    if not frappe.db.exists("Role", "Stock Manager"):
        try:
            frappe.get_doc({"doctype": "Role", "role_name": "Stock Manager", "desk_access": 1}).insert(ignore_permissions=True)
            frappe.db.commit()
        except Exception:
            pass


def _ensure_duid_inventory_dimension():
    """Set up DUID as an ERPNext Inventory Dimension for stock tracking by site."""
    if not frappe.db.exists("DocType", "Inventory Dimension"):
        return
    if frappe.db.exists("Inventory Dimension", "DUID"):
        return
    try:
        ref_doc = frappe.db.exists("DocType", "DUID Master")
        doc = frappe.get_doc({
            "doctype": "Inventory Dimension",
            "dimension_name": "DUID",
            "reference_document": "DUID Master" if ref_doc else None,
            "apply_to_all_doctypes": 1,
        })
        doc.insert(ignore_permissions=True)
        frappe.db.commit()
    except Exception:
        frappe.log_error(frappe.get_traceback(), "DUID Inventory Dimension setup failed")


def _ensure_outbound_custom_fields():
    """Add huawei_outbound_plan Link field on Stock Entry (idempotent)."""
    from frappe.custom.doctype.custom_field.custom_field import create_custom_field
    if frappe.db.exists("Custom Field", "Stock Entry-huawei_outbound_plan"):
        return
    try:
        create_custom_field("Stock Entry", {
            "fieldname": "huawei_outbound_plan",
            "fieldtype": "Link",
            "label": "Huawei Outbound Plan",
            "options": "Huawei Outbound Plan",
            "insert_after": "stock_entry_type",
            "module": "Inet App",
        })
        frappe.db.commit()
    except Exception:
        frappe.log_error(frappe.get_traceback(), "huawei_outbound_plan custom field setup failed")
