import frappe


def after_migrate():
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
    _ensure_project_accounting_dimension()
    _ensure_duid_accounting_dimension()
    _ensure_material_permissions()
    _ensure_material_return_field()
    _ensure_material_confirmation_fields()
    _declutter_stock_entry_list_view()
    _ensure_certificate_tracker_setup()
    _ensure_certificate_expiry_notifications()
    _ensure_hr_workspace_shortcut()
    _backfill_certificate_validity_months()


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


def _declutter_stock_entry_list_view():
    """Pin the Stock Entry list view's default columns to what the
    Warehouse Manager actually needs: Stock Entry Type, (Status — Frappe's
    automatic docstatus indicator, always shown), Default Source/Target
    Warehouse, and our own Confirmation Stage. "Purpose" and "Is Return"
    aren't used by this app's flow (warehouses are always set per-item,
    never at the header level) and are hidden, along with the less useful
    Huawei Outbound Plan / Per Transferred columns. Done via Property
    Setter (Frappe-idiomatic) so we never touch the ERPNext source doctype
    JSON.
    """
    try:
        from frappe.custom.doctype.property_setter.property_setter import (
            make_property_setter,
        )
    except Exception:
        return

    show = ("stock_entry_type", "from_warehouse", "to_warehouse")
    hide = ("purpose", "is_return", "per_transferred")
    for fieldname in show:
        try:
            make_property_setter(
                "Stock Entry", fieldname, "in_list_view", 1, "Check",
                for_doctype=False, validate_fields_for_doctype=False,
            )
        except Exception:
            # Best-effort — don't break migrate if Frappe internals shift.
            pass
    for fieldname in hide:
        try:
            make_property_setter(
                "Stock Entry", fieldname, "in_list_view", 0, "Check",
                for_doctype=False, validate_fields_for_doctype=False,
            )
        except Exception:
            pass

    if frappe.db.exists("Custom Field", "Stock Entry-huawei_outbound_plan"):
        frappe.db.set_value("Custom Field", "Stock Entry-huawei_outbound_plan", "in_list_view", 0)


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
    inet_roles = ["INET Admin", "INET IM", "INET Field Team", "INET PIC", "INET HR"]
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
        # delete/cancel: PIC needs to remove a stray/duplicate draft invoice
        # and cancel an already-submitted one (e.g. to correct a mistake)
        # without going through an Administrator.
        ("Sales Invoice",                  {"read": 1, "write": 1, "create": 1, "delete": 1, "cancel": 1}),
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

    # Visible on the Stock Entry itself — plain "Draft" doesn't tell a Desk
    # user (e.g. the Warehouse Manager) that a transfer is specifically
    # staged and awaiting the OTHER side's confirmation, not just an
    # ordinary unfinished draft they can submit themselves.
    CONFIRMATION_STAGE_OPTIONS = (
        "\nAwaiting Team Confirmation\nAwaiting Warehouse Confirmation\nConfirmed\nRejected"
    )
    _add_field("Stock Entry", "Stock Entry-confirmation_stage", {
        "fieldname": "confirmation_stage",
        "label": "Confirmation Stage",
        "fieldtype": "Select",
        "options": CONFIRMATION_STAGE_OPTIONS,
        "insert_after": "stock_entry_type",
        "read_only": 1,
        "in_standard_filter": 1,
        "in_list_view": 1,
        "module": "Inet App",
    })
    # _add_field() only sets fields on first creation — retrofit in_list_view
    # and the expanded option list for sites where this custom field already
    # existed before those were added.
    if frappe.db.exists("Custom Field", "Stock Entry-confirmation_stage"):
        frappe.db.set_value("Custom Field", "Stock Entry-confirmation_stage", {
            "in_list_view": 1,
            "options": CONFIRMATION_STAGE_OPTIONS,
        })

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


def _ensure_project_accounting_dimension():
    """Create the Project Control Center Accounting Dimension if it does not exist.

    Lets general (non-POID) project expenses carry the project on GL entries.
    Fields are created synchronously — after_insert only enqueues them, and the
    expense API needs the `project_control_center` column right after migrate.
    """
    if not frappe.db.exists("DocType", "Accounting Dimension"):
        return
    if frappe.db.exists("Accounting Dimension", {"document_type": "Project Control Center"}):
        return
    if not frappe.db.exists("DocType", "Project Control Center"):
        return
    try:
        dim = frappe.get_doc({
            "doctype": "Accounting Dimension",
            "document_type": "Project Control Center",
            "label": "Project Control Center",
            "fieldname": "project_control_center",
            "disabled": 0,
        })
        dim.insert(ignore_permissions=True)

        from erpnext.accounts.doctype.accounting_dimension.accounting_dimension import (
            make_dimension_in_accounting_doctypes,
        )
        make_dimension_in_accounting_doctypes(doc=dim)
        frappe.db.commit()
    except Exception:
        frappe.log_error(frappe.get_traceback(), "Project Accounting Dimension setup failed")


def _ensure_duid_accounting_dimension():
    """Create the DUID Accounting Dimension (linked to DUID Master) if it does not exist.

    Expense claims key directly on DUID (the site), not on POID — a site can carry
    several POIDs over time and the client wants expenses tracked per site.
    The POID dimension is left untouched; other doctypes/reports still use it.
    Fields are created synchronously — after_insert only enqueues them, and the
    expense API needs the `duid` column right after migrate.
    """
    if not frappe.db.exists("DocType", "Accounting Dimension"):
        return
    if frappe.db.exists("Accounting Dimension", "DUID"):
        return
    if not frappe.db.exists("DocType", "DUID Master"):
        return
    try:
        dim = frappe.get_doc({
            "doctype": "Accounting Dimension",
            "name": "DUID",
            "document_type": "DUID Master",
            "label": "DUID",
            "fieldname": "duid",
            "disabled": 0,
        })
        dim.insert(ignore_permissions=True)

        from erpnext.accounts.doctype.accounting_dimension.accounting_dimension import (
            make_dimension_in_accounting_doctypes,
        )
        make_dimension_in_accounting_doctypes(doc=dim)
        frappe.db.commit()
    except Exception:
        frappe.log_error(frappe.get_traceback(), "DUID Accounting Dimension setup failed")


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


def _ensure_material_return_field():
    """Add is_return_request flag and return_reason to Material Request."""
    _add_field("Material Request", "Material Request-is_return_request", {
        "fieldname": "is_return_request",
        "label": "Is Return Request",
        "fieldtype": "Check",
        "default": "0",
        "insert_after": "set_from_warehouse",
        "hidden": 1,
    })
    _add_field("Material Request", "Material Request-return_reason", {
        "fieldname": "return_reason",
        "label": "Return Reason",
        "fieldtype": "Small Text",
        "insert_after": "is_return_request",
        "hidden": 1,
    })
    # IM initiated this return on the team's behalf, without them requesting
    # it themselves — the source team's Team Lead must explicitly approve
    # releasing the stock (see material_management.approve_material_return_request)
    # before anything gets staged, otherwise IM could pull materials out of a
    # team's declared stock without their knowledge.
    _add_field("Material Request", "Material Request-is_direct_return_by_im", {
        "fieldname": "is_direct_return_by_im",
        "label": "Is Direct Return By IM",
        "fieldtype": "Check",
        "default": "0",
        "insert_after": "return_reason",
        "hidden": 1,
    })
    frappe.db.commit()


def _ensure_material_confirmation_fields():
    """Track the staged (not-yet-submitted) transfer awaiting confirmation
    from the receiving side — Team Lead for an outbound transfer, Warehouse
    Manager for a return. See material_management.approve_material_request /
    approve_material_return_request / confirm_material_transfer /
    confirm_material_return."""
    _add_field("Material Request", "Material Request-pending_transfer_se", {
        "fieldname": "pending_transfer_se",
        "label": "Pending Transfer (awaiting confirmation)",
        "fieldtype": "Link",
        "options": "Stock Entry",
        "insert_after": "return_reason",
        "read_only": 1,
        "hidden": 1,
    })
    _add_field("Material Request", "Material Request-confirm_rejection_reason", {
        "fieldname": "confirm_rejection_reason",
        "label": "Confirmation Rejection Reason",
        "fieldtype": "Small Text",
        "insert_after": "pending_transfer_se",
        "read_only": 1,
        "hidden": 1,
    })
    frappe.db.commit()


def _add_field(dt, cf_name, definition):
    from frappe.custom.doctype.custom_field.custom_field import create_custom_field
    if frappe.db.exists("Custom Field", cf_name):
        return
    try:
        create_custom_field(dt, definition)
    except Exception:
        frappe.log_error(frappe.get_traceback(), f"Custom field {cf_name} setup failed")


def _ensure_certificate_tracker_setup():
    """INET Certificate Tracker (INET HR): Employee custom fields, the
    Certification Domain / Certificate Type masters, and the field-ops
    Designations the reference tracker used. Idempotent — safe on every
    migrate. The one-off import of the ~90 real employees/certificates is a
    separate script, deliberately NOT run from here (see
    inet_app/scripts/import_certificate_tracker_data.py)."""
    _add_field("Employee", "Employee-certificate_tracker_section", {
        "fieldname": "certificate_tracker_section",
        "label": "INET Certificate Tracker",
        "fieldtype": "Section Break",
        "insert_after": "cell_number",
        "collapsible": 1,
        "module": "Inet App",
    })
    _add_field("Employee", "Employee-iqama_number", {
        "fieldname": "iqama_number",
        "label": "Iqama / National ID",
        "fieldtype": "Data",
        "insert_after": "certificate_tracker_section",
        "module": "Inet App",
    })
    _add_field("Employee", "Employee-nationality", {
        "fieldname": "nationality",
        "label": "Nationality",
        "fieldtype": "Data",
        "insert_after": "iqama_number",
        "module": "Inet App",
    })
    _add_field("Employee", "Employee-uniportal_id", {
        "fieldname": "uniportal_id",
        "label": "Huawei UniPortal ID",
        "fieldtype": "Data",
        "insert_after": "nationality",
        "module": "Inet App",
    })
    _add_field("Employee", "Employee-certification_domain", {
        "fieldname": "certification_domain",
        "label": "Certification Domain",
        "fieldtype": "Link",
        "options": "Certification Domain",
        "insert_after": "uniportal_id",
        "in_standard_filter": 1,
        "module": "Inet App",
    })
    _ensure_certification_domains()
    _ensure_certificate_types()
    _ensure_certificate_tracker_designations()


def _ensure_certification_domains():
    if not frappe.db.exists("DocType", "Certification Domain"):
        return
    for domain_name in ["Fixed Network", "WL & MW", "Core Network", "EBU Team", "Management"]:
        if frappe.db.exists("Certification Domain", domain_name):
            continue
        try:
            frappe.get_doc({
                "doctype": "Certification Domain",
                "domain_name": domain_name,
            }).insert(ignore_permissions=True)
        except Exception:
            frappe.log_error(frappe.get_traceback(), f"Certification Domain {domain_name} setup failed")
    frappe.db.commit()


def _ensure_certificate_types():
    """Seed the 11 certificate types the reference tracker used. Renewal cost
    is only known for 4 of them today (from the tracker's hardcoded
    COST_CERTS) — the rest seed at 0 and HR fills them in from the Desk."""
    if not frappe.db.exists("DocType", "Certificate Type"):
        return
    resource_only = {"Access TL", "Optical TL"}
    known_costs = {
        "Defensive Driving": 207,
        "Electrical": 207,
        "First Aid": 230,
        "WAH": 402.50,
    }
    cert_names = [
        "EHS", "First Aid", "Electrical", "Defensive Driving", "WAH",
        "Cyber Security", "Access TL", "Optical TL", "Wireless TL",
        "Microwave TL", "DL",
    ]
    for cert_name in cert_names:
        if frappe.db.exists("Certificate Type", cert_name):
            continue
        try:
            frappe.get_doc({
                "doctype": "Certificate Type",
                "certificate_name": cert_name,
                "applies_to": "Resource Team" if cert_name in resource_only else "Both",
                "renewal_cost": known_costs.get(cert_name, 0),
            }).insert(ignore_permissions=True)
        except Exception:
            frappe.log_error(frappe.get_traceback(), f"Certificate Type {cert_name} setup failed")
    frappe.db.commit()


def _ensure_certificate_expiry_notifications():
	"""4 Setup > Notification alerts on Employee Certificate.expiry_date (90 /
	30 / 7 / 0 days before) — core Frappe's own "Days Before" trigger and
	System Notification channel, per the build plan, instead of bespoke
	alert-sending code. Idempotent; once created HR can retune
	thresholds/recipients from the Desk without a code change."""
	if not frappe.db.exists("DocType", "Notification") or not frappe.db.exists("DocType", "Employee Certificate"):
		return

	for days in (90, 30, 7, 0):
		name = f"INET Certificate Expiry - {days} Days"
		if frappe.db.exists("Notification", name):
			continue
		when = "expires today" if days == 0 else f"expires in {days} day(s)"
		try:
			frappe.get_doc({
				"doctype": "Notification",
				"name": name,
				"subject": f"Certificate {when}: {{{{ doc.certificate_type }}}} — {{{{ doc.employee_name }}}}",
				"document_type": "Employee Certificate",
				"event": "Days Before",
				"date_changed": "expiry_date",
				"days_in_advance": days,
				"condition": "doc.certificate_type",
				"channel": "Email",
				"send_system_notification": 1,
				"message": (
					"<p>{{ doc.employee_name }}'s <strong>{{ doc.certificate_type }}</strong> certificate "
					f"{when} (expiry date: " "{{ doc.expiry_date }}).</p>"
					"<p>Certificate No: {{ doc.certificate_no or '—' }}<br>"
					"Employee: {{ doc.employee }}</p>"
				),
				"recipients": [
					{"receiver_by_role": "INET HR"},
					{"receiver_by_document_field": "employee_user"},
				],
			}).insert(ignore_permissions=True)
		except Exception:
			frappe.log_error(frappe.get_traceback(), f"Notification {name} setup failed")
	frappe.db.commit()


def _ensure_hr_workspace_shortcut():
	"""Add a link from ERPNext HRMS's own "HR" workspace to the standalone
	INET Certificate Tracker page (/hr-certificates — NOT under /pms; it's
	deliberately separate from the PMS portal in login/UI/UX), so the HR
	Manager can jump into it directly from where they already work in Desk.

	ADDITIVE ONLY — this workspace belongs to the hrms app, not inet_app, so
	this only appends/updates one shortcut + one content block; it never
	rebuilds or replaces the workspace wholesale (unlike
	_resync_warehouse_workspace(), which owns that workspace outright)."""
	import json

	workspace_name = "HR"
	shortcut_label = "INET Certificate Tracker"
	shortcut_url = "/hr-certificates"

	if not frappe.db.exists("Workspace", workspace_name):
		return  # hrms not installed / HR workspace not present on this site

	try:
		doc = frappe.get_doc("Workspace", workspace_name)
		existing = next((s for s in doc.shortcuts if s.label == shortcut_label), None)
		if existing:
			if existing.url == shortcut_url:
				return  # already correct from a previous migrate
			existing.url = shortcut_url  # self-heal a stale URL (e.g. old /pms/* route)
		else:
			doc.append("shortcuts", {
				"type": "URL",
				"url": shortcut_url,
				"label": shortcut_label,
				"color": "Blue",
			})

		try:
			content = json.loads(doc.content or "[]")
		except Exception:
			content = []
		if not any(b.get("data", {}).get("shortcut_name") == shortcut_label for b in content):
			content.append({"id": "inet-cert-tracker", "type": "shortcut", "data": {"shortcut_name": shortcut_label, "col": 4}})
		doc.content = json.dumps(content)

		doc.save(ignore_permissions=True)
		frappe.db.commit()
	except Exception:
		frappe.log_error(frappe.get_traceback(), "HR workspace shortcut setup failed")


def _backfill_certificate_validity_months():
	"""Derive Certificate Type.validity_months from the actual imported
	issue/expiry date pairs (average, rounded to the nearest month) rather
	than asking anyone to type in a number nobody had handy. Used to
	auto-suggest an expiry date when a new certificate is issued. Safe to
	re-run — recomputes from whatever data exists at the time."""
	if not frappe.db.exists("DocType", "Employee Certificate"):
		return
	rows = frappe.db.sql(
		"""
		SELECT certificate_type, AVG(DATEDIFF(expiry_date, issue_date)) AS avg_days
		FROM `tabEmployee Certificate`
		WHERE issue_date IS NOT NULL AND expiry_date IS NOT NULL
		GROUP BY certificate_type
		""",
		as_dict=True,
	)
	for row in rows:
		months = round((row.avg_days or 0) / 30.44)
		if months > 0:
			frappe.db.set_value("Certificate Type", row.certificate_type, "validity_months", months)
	frappe.db.commit()


def _ensure_certificate_tracker_designations():
    """Field-ops designations used by the reference tracker's `position`
    values that don't already exist in the (generic ERPNext seed) Designation
    list. "Project Manager" already exists, so it's not listed here."""
    designations = [
        "Technician", "Team Leader", "Driver", "Rigger",
        "Rigger / Driver", "Technician / Driver", "EHS Manager",
        "Admin", "Document Controller",
    ]
    for designation_name in designations:
        if frappe.db.exists("Designation", designation_name):
            continue
        try:
            frappe.get_doc({
                "doctype": "Designation",
                "designation_name": designation_name,
            }).insert(ignore_permissions=True)
        except Exception:
            frappe.log_error(frappe.get_traceback(), f"Designation {designation_name} setup failed")
    frappe.db.commit()


