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
    _ensure_poid_accounting_dimension()
    _ensure_material_permissions()


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
    """Create or fully rebuild the Warehouse Management workspace.

    Both the content JSON and the shortcuts child table must match —
    content references shortcuts by label, child table holds link_to.
    """
    import json

    workspace_name = "Warehouse Management"

    _shortcuts = [
        # (label, link_to, color)
        ("Huawei Outbound Plan",   "Huawei Outbound Plan",   "Blue"),
        ("Huawei Outbound Import", "Huawei Outbound Import", "Blue"),
        ("Material Request",       "Material Request",       "Green"),
        ("Stock Entry",            "Stock Entry",            "Green"),
        ("Item",                   "Item",                   "Grey"),
        ("Warehouse",              "Warehouse",              "Grey"),
        ("DUID Master",            "DUID Master",            "Orange"),
        ("Huawei Subcon Master",   "Huawei Subcon Master",   "Orange"),
        ("INET Team",              "INET Team",              "Purple"),
        ("INET Settings",          "INET Settings",          "Red"),
    ]

    content = [
        {"id": "h-inbound", "type": "header", "data": {"text": '<span class="h4">Inbound</span>', "col": 12}},
    ]
    for i, (lbl, _link, _color) in enumerate(_shortcuts[:2], 1):
        content.append({"id": f"s{i}", "type": "shortcut", "data": {"shortcut_name": lbl, "col": 3}})

    content.append({"id": "h-stock", "type": "header", "data": {"text": '<span class="h4">Stock</span>', "col": 12}})
    for i, (lbl, _link, _color) in enumerate(_shortcuts[2:6], 3):
        content.append({"id": f"s{i}", "type": "shortcut", "data": {"shortcut_name": lbl, "col": 3}})

    content.append({"id": "h-masters", "type": "header", "data": {"text": '<span class="h4">Masters</span>', "col": 12}})
    for i, (lbl, _link, _color) in enumerate(_shortcuts[6:], 7):
        content.append({"id": f"s{i}", "type": "shortcut", "data": {"shortcut_name": lbl, "col": 3}})

    shortcut_rows = [
        {
            "doctype": "Workspace Shortcut",
            "type": "DocType",
            "link_to": link,
            "label": lbl,
            "color": color,
            "doc_view": "List",
        }
        for lbl, link, color in _shortcuts
    ]

    if frappe.db.exists("Workspace", workspace_name):
        doc = frappe.get_doc("Workspace", workspace_name)
        doc.content = json.dumps(content)
        doc.shortcuts = []
        for row in shortcut_rows:
            doc.append("shortcuts", row)
        doc.save(ignore_permissions=True)
    else:
        try:
            frappe.get_doc({
                "doctype": "Workspace",
                "name": workspace_name,
                "label": workspace_name,
                "title": workspace_name,
                "module": "Inet App",
                "icon": "package",
                "public": 1,
                "content": json.dumps(content),
                "roles": [],
                "shortcuts": shortcut_rows,
                "links": [],
            }).insert(ignore_permissions=True)
        except Exception:
            frappe.log_error(frappe.get_traceback(), "Workspace creation failed")
    frappe.db.commit()


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
    """Grant INET PIC role the permissions needed for invoice creation.

    Frappe uses Custom DocPerm mode for a doctype the moment ANY Custom DocPerm
    row exists — it then ignores all standard DocPerm entries completely. To
    avoid wiping other roles' access we first migrate existing standard DocPerm
    rows to Custom DocPerm, then add the INET PIC entry.
    """
    role = "INET PIC"
    if not frappe.db.exists("Role", role):
        return

    # Doctypes PIC needs and the flags it requires (permlevel 0)
    doctypes = [
        ("Sales Invoice",                  {"read": 1, "write": 1, "create": 1}),
        ("Sales Invoice Item",             {"read": 1, "write": 1, "create": 1}),
        ("Sales Taxes and Charges",        {"read": 1}),
        ("Sales Taxes and Charges Template", {"read": 1}),
        ("Customer",                       {"read": 1}),
        ("Item",                           {"read": 1}),
    ]

    for dt_name, perm_map in doctypes:
        if not frappe.db.exists("DocType", dt_name):
            continue

        # If no Custom DocPerm exists yet for this doctype, copy all standard
        # DocPerm rows first so other roles keep their access after we flip the
        # doctype into Custom DocPerm mode.
        if not frappe.db.count("Custom DocPerm", {"parent": dt_name}):
            for ep in frappe.db.get_all(
                "DocPerm",
                filters={"parent": dt_name},
                fields=["role", "permlevel", "read", "write", "create",
                        "delete", "submit", "cancel", "amend", "report",
                        "export", "import", "share", "print", "email"],
            ):
                if frappe.db.exists("Custom DocPerm",
                                    {"parent": dt_name, "role": ep.role,
                                     "permlevel": ep.permlevel}):
                    continue
                try:
                    frappe.get_doc({
                        "doctype": "Custom DocPerm",
                        "parent": dt_name,
                        **{k: v for k, v in ep.items() if k != "name"},
                    }).insert(ignore_permissions=True)
                except Exception:
                    pass

        # Now add or update the INET PIC row
        existing = frappe.db.get_value(
            "Custom DocPerm", {"parent": dt_name, "role": role, "permlevel": 0}, "name"
        )
        if existing:
            frappe.db.set_value("Custom DocPerm", existing, perm_map)
        else:
            try:
                frappe.get_doc({
                    "doctype": "Custom DocPerm",
                    "parent": dt_name,
                    "role": role,
                    "permlevel": 0,
                    **perm_map,
                }).insert(ignore_permissions=True)
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
    """Add custom fields on Stock Entry and Material Request doctypes (idempotent)."""
    from frappe.custom.doctype.custom_field.custom_field import create_custom_field

    _add_field("Stock Entry", "Stock Entry-huawei_outbound_plan", {
        "fieldname": "huawei_outbound_plan",
        "fieldtype": "Link",
        "label": "Huawei Outbound Plan",
        "options": "Huawei Outbound Plan",
        "insert_after": "stock_entry_type",
        "module": "Inet App",
    })

    # IM, POID and DUID on Material Request header for INET tracking
    _add_field("Material Request", "Material Request-im", {
        "fieldname": "im",
        "fieldtype": "Link",
        "label": "IM",
        "options": "IM Master",
        "insert_after": "company",
        "module": "Inet App",
    })
    _add_field("Material Request", "Material Request-poid", {
        "fieldname": "poid",
        "fieldtype": "Link",
        "label": "POID",
        "options": "PO Dispatch",
        "insert_after": "im",
        "module": "Inet App",
    })
    _add_field("Material Request", "Material Request-duid", {
        "fieldname": "duid",
        "fieldtype": "Data",
        "label": "DUID",
        "insert_after": "poid",
        "module": "Inet App",
    })
    _add_field("Material Request", "Material Request-rejection_reason", {
        "fieldname": "rejection_reason",
        "fieldtype": "Small Text",
        "label": "Rejection Reason",
        "insert_after": "duid",
        "read_only": 1,
        "module": "Inet App",
    })

    frappe.db.commit()

    # Drop stale duid field on Material Request Item if it was added previously
    if frappe.db.exists("Custom Field", "Material Request Item-duid"):
        frappe.delete_doc("Custom Field", "Material Request Item-duid", ignore_missing=True, force=True)
        frappe.db.commit()


def _ensure_poid_accounting_dimension():
    """Create the POID Accounting Dimension (linked to PO Dispatch) if it does not exist.

    ERPNext Accounting Dimension fields: name, document_type, label, fieldname, disabled.
    When created, ERPNext auto-adds the poid field to financial documents.
    """
    if not frappe.db.exists("DocType", "Accounting Dimension"):
        return
    if frappe.db.exists("Accounting Dimension", "POID"):
        return
    if not frappe.db.exists("DocType", "PO Dispatch"):
        return
    try:
        frappe.get_doc({
            "doctype": "Accounting Dimension",
            "name": "POID",
            "document_type": "PO Dispatch",
            "label": "POID",
            "fieldname": "poid",
            "disabled": 0,
        }).insert(ignore_permissions=True)
        frappe.db.commit()
    except Exception:
        frappe.log_error(frappe.get_traceback(), "POID Accounting Dimension setup failed")


def _ensure_material_permissions():
    """Grant Stock Manager role the permissions needed for material management.

    Frappe uses Custom DocPerm mode for a doctype the moment ANY Custom DocPerm
    row exists — it then ignores all standard DocPerm entries completely. To
    avoid wiping other roles' access we first migrate existing standard DocPerm
    rows to Custom DocPerm, then add the Stock Manager entry.
    """
    role = "Stock Manager"
    if not frappe.db.exists("Role", role):
        return

    doctypes = [
        ("Material Request",      {"read": 1, "write": 1, "create": 1, "submit": 1, "cancel": 1, "amend": 1}),
        ("Stock Entry",           {"read": 1, "write": 1, "create": 1, "submit": 1, "cancel": 1, "amend": 1}),
        ("Item",                  {"read": 1}),
        ("Warehouse",             {"read": 1, "write": 1, "create": 1}),
        ("Huawei Outbound Plan",  {"read": 1, "write": 1, "create": 1, "delete": 1}),
    ]

    for dt_name, perm_map in doctypes:
        if not frappe.db.exists("DocType", dt_name):
            continue

        # If no Custom DocPerm exists yet for this doctype, copy all standard
        # DocPerm rows first so other roles keep their access after we flip the
        # doctype into Custom DocPerm mode.
        if not frappe.db.count("Custom DocPerm", {"parent": dt_name}):
            for ep in frappe.db.get_all(
                "DocPerm",
                filters={"parent": dt_name},
                fields=["role", "permlevel", "read", "write", "create",
                        "delete", "submit", "cancel", "amend", "report",
                        "export", "import", "share", "print", "email"],
            ):
                if frappe.db.exists("Custom DocPerm",
                                    {"parent": dt_name, "role": ep.role,
                                     "permlevel": ep.permlevel}):
                    continue
                try:
                    frappe.get_doc({
                        "doctype": "Custom DocPerm",
                        "parent": dt_name,
                        **{k: v for k, v in ep.items() if k != "name"},
                    }).insert(ignore_permissions=True)
                except Exception:
                    pass

        # Now add or update the Stock Manager row
        existing = frappe.db.get_value(
            "Custom DocPerm", {"parent": dt_name, "role": role, "permlevel": 0}, "name"
        )
        if existing:
            frappe.db.set_value("Custom DocPerm", existing, perm_map)
        else:
            try:
                frappe.get_doc({
                    "doctype": "Custom DocPerm",
                    "parent": dt_name,
                    "role": role,
                    "permlevel": 0,
                    **perm_map,
                }).insert(ignore_permissions=True)
            except Exception:
                pass

    frappe.db.commit()


def _add_field(dt, cf_name, definition):
    from frappe.custom.doctype.custom_field.custom_field import create_custom_field
    if frappe.db.exists("Custom Field", cf_name):
        return
    try:
        create_custom_field(dt, definition)
    except Exception:
        frappe.log_error(frappe.get_traceback(), f"Custom field {cf_name} setup failed")


