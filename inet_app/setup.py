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
    _ensure_subcon_po_fields()
    _separate_duid_dimensions()
    _ensure_material_permissions()
    _ensure_material_return_field()
    _ensure_material_confirmation_fields()
    _ensure_preferred_batch_field()
    _ensure_pickup_time_field()
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
    This function owns the workspace outright: it rewrites it on every
    migrate, so the on-disk workspace JSON is not the source of truth —
    edit `_groups` below instead, or changes there will just get clobbered
    back on the next migrate.
    """
    import json

    workspace_name = "Warehouse Management"

    # (heading, [(label, link_to, color, shortcut_type), ...])
    _groups = [
        ("Inbound", [
            ("Huawei Outbound Plan",   "Huawei Outbound Plan",   "Blue", "DocType"),
            ("Huawei Outbound Import", "Huawei Outbound Import", "Blue", "DocType"),
        ]),
        ("Stock", [
            ("Material Request", "Material Request", "Green", "DocType"),
            ("Stock Entry",      "Stock Entry",       "Green", "DocType"),
            ("Item",             "Item",              "Grey",  "DocType"),
            ("Warehouse",        "Warehouse",         "Grey",  "DocType"),
        ]),
        ("Masters", [
            ("DUID Master",          "DUID Master",          "Orange", "DocType"),
            ("Huawei Subcon Master", "Huawei Subcon Master", "Orange", "DocType"),
            ("INET Team",            "INET Team",            "Purple", "DocType"),
            ("INET Settings",        "INET Settings",        "Red",    "DocType"),
        ]),
        ("Reports", [
            ("Bill Wise Material Status", "Bill Wise Material Status", "Yellow", "Report"),
            ("DUID Wise Material Status", "DUID Wise Material Status", "Yellow", "Report"),
            ("Huawei Outbound Analytics", "Huawei Outbound Analytics", "Yellow", "Report"),
        ]),
    ]

    content = []
    shortcut_rows = []
    idx = 0
    for heading, items in _groups:
        content.append({
            "id": f"h-{heading.lower()}", "type": "header",
            "data": {"text": f'<span class="h4">{heading}</span>', "col": 12},
        })
        for lbl, link, color, shortcut_type in items:
            idx += 1
            content.append({"id": f"s{idx}", "type": "shortcut", "data": {"shortcut_name": lbl, "col": 3}})
            row = {
                "doctype": "Workspace Shortcut",
                "type": shortcut_type,
                "link_to": link,
                "label": lbl,
                "color": color,
            }
            if shortcut_type == "DocType":
                row["doc_view"] = "List"
            shortcut_rows.append(row)

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

    # Every permission checkbox Custom DocPerm has, for the three documents PIC
    # owns end to end. `if_owner` is deliberately 0: it is a RESTRICTION (limit
    # the row to documents the user created), not a grant — setting it would cut
    # PIC off from colleagues' invoices.
    full_perms = {
        "select": 1, "read": 1, "write": 1, "create": 1, "delete": 1,
        "submit": 1, "cancel": 1, "amend": 1, "report": 1,
        "export": 1, "import": 1, "share": 1, "print": 1, "email": 1,
        "if_owner": 0,
    }

    # Doctypes PIC needs and the flags it requires (permlevel 0)
    doctypes = [
        # Full permissions on the three documents PIC raises: they are PIC's own
        # outbound paperwork and PIC was blocked on the two flags that actually
        # matter for that — `print` and `email` were both missing, so the
        # Purchase Order could not be produced for the subcontractor at all.
        # Granted wholesale ("all permissions for now") at the client's request
        # rather than flag-by-flag; see full_perms above for what that includes.
        ("Sales Invoice",                  dict(full_perms)),
        ("Sales Invoice Item",             {"read": 1, "write": 1, "create": 1}),
        ("Sales Taxes and Charges",        {"read": 1}),
        ("Sales Taxes and Charges Template", {"read": 1}),
        ("Customer",                       {"read": 1}),
        ("Item",                           {"read": 1}),
        # Subcon PO (supplier side). The Purchase Order is PIC's own outbound
        # document — it gets printed and emailed to the subcontractor, and a
        # draft can't be sent, so PIC needs submit, print and email here.
        ("Purchase Order",                 dict(full_perms)),
        ("Purchase Order Item",            {"read": 1, "write": 1, "create": 1}),
        # Purchase Invoice previously had NO submit on purpose — submitting posts
        # a supplier payable to the GL, which is Accounts' call — but it is now
        # included in the blanket grant above at the client's request. The status
        # flow is unaffected either way: on_purchase_invoice_submit advances the
        # line whoever submits the document.
        ("Purchase Invoice",               dict(full_perms)),
        ("Purchase Invoice Item",          {"read": 1, "write": 1, "create": 1}),
        ("Purchase Taxes and Charges",     {"read": 1}),
        ("Purchase Taxes and Charges Template", {"read": 1}),
        ("Supplier",                       {"read": 1}),
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

    # Superseded by item-level Batch tracking (batch = bill, via
    # _get_or_create_huawei_batch) — a header-level bill link duplicated what
    # each item's own batch already says, and only the Huawei-import paths
    # ever populated it. Actively removed, not just stopped-being-created,
    # since sites that ran an earlier version already have the column.
    if frappe.db.exists("Custom Field", "Stock Entry-huawei_outbound_plan"):
        frappe.delete_doc("Custom Field", "Stock Entry-huawei_outbound_plan", ignore_permissions=True)

    # Purely a client-side carrier for the "Create Material Receipt" button
    # on Huawei Outbound Plan — is_virtual means it never gets a DB column
    # and never persists, so it's not a second stored source of truth for
    # the bill (that's still only ever the item-level Batch). It exists only
    # because frappe.route_options and the URL query string both get wiped
    # by Frappe's own router (create_new.js's get_new_doc(), then
    # router.js's push_state()) before a form's refresh handler ever runs —
    # but a route_options value matching a REAL field name (even a virtual,
    # hidden one) gets copied onto the new doc's in-memory object first,
    # which survives because it's now just normal (if virtual) doc data.
    # no_copy is deliberately NOT set here — Frappe's own get_new_doc()
    # (model/create_new.js) checks that exact flag to decide whether to
    # copy a route_options value onto the new doc at all
    # (`if (df && !df.no_copy) doc[fieldname] = value`), which is the ONE
    # thing this field exists to receive. is_virtual already guarantees it
    # never persists, so no_copy would only ever break the one job this
    # field has, for no actual benefit.
    _add_field("Stock Entry", "Stock Entry-bill_no_hint", {
        "fieldname": "bill_no_hint",
        "fieldtype": "Data",
        "label": "Bill No. Hint",
        "hidden": 1,
        "is_virtual": 1,
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
    expense API needs the column right after migrate. The fieldname is
    ACCOUNTING_DUID_FIELDNAME (`duid_acc`), not `duid` — the inventory DUID
    dimension owns the bare name. See _separate_duid_dimensions.
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
            "fieldname": ACCOUNTING_DUID_FIELDNAME,
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


def _ensure_preferred_batch_field():
    """Optional manual override for which bill's batch a Transfer request
    item is drawn from, when the automatic FIFO pick
    (material_management._auto_select_batch_for_row) would otherwise have
    to choose between 2+ bills for the same item+DUID+warehouse. Left blank
    in the overwhelming majority of requests (single bill, or FIFO is fine)
    — the portal only shows this control when it detects a genuine choice
    exists, so the automated flow is unaffected when it's blank.

    Not needed on the Return side — a return request never knows its DUID
    (and therefore which bills are even candidates) until approval time, so
    that override is passed as a transient parameter to
    approve_material_return_request instead of stored here."""
    _add_field("Material Request Item", "Material Request Item-preferred_batch_no", {
        "fieldname": "preferred_batch_no",
        "label": "Preferred Batch (Bill)",
        "fieldtype": "Link",
        "options": "Batch",
        "insert_after": "warehouse",
        "print_hide": 1,
    })
    frappe.db.commit()


def _ensure_pickup_time_field():
    """Material Request already has a native `schedule_date` (Date only) —
    add the matching time-of-day so the IM can tell the Team Lead exactly
    when to go to the warehouse and collect the material, not just which
    day. Surfaced on the Field portal's Incoming Transfers card."""
    _add_field("Material Request", "Material Request-pickup_time", {
        "fieldname": "pickup_time",
        "label": "Pickup Time",
        "fieldtype": "Time",
        "insert_after": "schedule_date",
        "print_hide": 1,
    })
    frappe.db.commit()


def _ensure_subcon_po_fields():
    """Subcon PO: line-level tagging on Purchase Order Item / Purchase Invoice Item.

    ``poid`` already exists on both (the POID Accounting Dimension adds it to
    every financial document — see _ensure_poid_accounting_dimension). These
    three add the milestone plus the commercial terms the PO was priced from,
    so a Desk user can reconcile a supplier PO line back to the PIC line
    without a join.

    All three are ``print_hide = 1`` on purpose. The supplier PO is printed
    and emailed to the subcontractor, and ``payout_pct`` next to a net rate
    would let them back out INET's own customer rate. They must also stay
    ``no_copy = 0`` — that's what lets Frappe's mapper carry them from the
    Purchase Order to the Purchase Invoice for free (frappe/model/mapper.py
    copies same-named target fields), so make_purchase_invoice needs no
    custom field_map.
    """
    for dt, after in (
        ("Purchase Order Item", "poid"),
        ("Purchase Invoice Item", "poid"),
    ):
        if not frappe.db.exists("DocType", dt):
            continue
        _add_field(dt, f"{dt}-milestone", {
            "fieldname": "milestone",
            "label": "Milestone",
            "fieldtype": "Select",
            "options": "\nMS1\nMS2",
            "insert_after": after,
            "print_hide": 1,
            "no_copy": 0,
            "module": "Inet App",
        })
        _add_field(dt, f"{dt}-subcontract", {
            "fieldname": "subcontract",
            "label": "Subcontract",
            "fieldtype": "Link",
            "options": "Subcontract Master",
            "insert_after": "milestone",
            "print_hide": 1,
            "no_copy": 0,
            "module": "Inet App",
        })
        _add_field(dt, f"{dt}-payout_pct", {
            "fieldname": "payout_pct",
            "label": "Subcon Payout %",
            "fieldtype": "Percent",
            "insert_after": "subcontract",
            "print_hide": 1,
            "no_copy": 0,
            "module": "Inet App",
        })

    # Retrofit print_hide/no_copy on sites where these already exist from an
    # earlier migrate — _add_field only applies its definition on creation.
    for dt in ("Purchase Order Item", "Purchase Invoice Item"):
        for fn in ("milestone", "subcontract", "payout_pct"):
            cf = f"{dt}-{fn}"
            if frappe.db.exists("Custom Field", cf):
                frappe.db.set_value("Custom Field", cf, {"print_hide": 1, "no_copy": 0})

    frappe.db.commit()


# The accounting DUID dimension deliberately does NOT use the fieldname `duid`.
# See _separate_duid_dimensions for why.
ACCOUNTING_DUID_FIELDNAME = "duid_acc"


def _separate_duid_dimensions():
    """Give the accounting and inventory DUID dimensions their own fieldnames.

    DUID is registered twice — as an Accounting Dimension and as an Inventory
    Dimension (apply_to_all_doctypes) — and both derive the same fieldname
    ``duid`` from the name. A doctype can only carry one field with that name,
    and ERPNext's accounting-dimension creator skips any doctype where the
    fieldname already exists:

        if df["fieldname"] not in fieldnames:      # accounting_dimension.py
            create_custom_field(doctype, df, ...)

    So on the 16 stock-bearing child doctypes the inventory dimension won and
    the accounting dimension silently got nothing. That left one field serving
    two purposes, which is no good: the accounting dimension is what gives you a
    DUID column and filter in the **General Ledger**, and the inventory
    dimension is what gives you one in the **Stock Ledger**. They need to be
    separate to both work.

    The inventory side cannot be renamed — ``do_not_update_document`` throws
    DoNotChangeError once stock transactions exist against it, and 34 Stock
    Ledger Entries already reference its ``duid_master`` target field. So the
    accounting side moves instead, to ``duid_acc``. Its label stays "DUID", so
    the GL report still shows and filters on "DUID".

    Renamed in place rather than deleted and recreated on purpose:
    ``delete_accounting_dimension`` runs a blanket
    ``DELETE FROM tabCustom Field WHERE fieldname='duid' AND dt IN (...)``,
    which would take the inventory dimension's fields with it.
    """
    if not frappe.db.exists("Accounting Dimension", "DUID"):
        return

    dim = frappe.get_doc("Accounting Dimension", "DUID")
    from erpnext.accounts.doctype.accounting_dimension.accounting_dimension import (
        make_dimension_in_accounting_doctypes,
    )
    if dim.fieldname != ACCOUNTING_DUID_FIELDNAME:
        dim.fieldname = ACCOUNTING_DUID_FIELDNAME
        dim.label = "DUID"
        # on_update -> make_dimension_in_accounting_doctypes creates the new
        # field across every accounting doctype. Nothing is deleted here.
        dim.save(ignore_permissions=True)
        frappe.db.commit()
    elif not frappe.db.exists("Custom Field", {"fieldname": ACCOUNTING_DUID_FIELDNAME}):
        # The rename itself already happened in an earlier, interrupted run
        # (dim.fieldname is already duid_acc here) but the fields were never
        # actually created — e.g. GL Entry still only has the old `duid`
        # column. Create them now instead of assuming "renamed" means "done".
        make_dimension_in_accounting_doctypes(doc=dim)
        frappe.db.commit()

    # Put the inventory dimension's field back in its own section. An earlier
    # pass had moved it into Accounting Dimensions as a stand-in for the missing
    # accounting field; now that a real one exists, leaving it there would show
    # two DUID fields side by side.
    if frappe.db.exists("Custom Field", "Purchase Invoice Item-duid"):
        frappe.db.set_value("Custom Field", "Purchase Invoice Item-duid", {
            "insert_after": "inventory_dimension",
            "label": "Target DUID",
        })
    if frappe.db.exists("Custom Field", "Purchase Invoice Item-rejected_duid"):
        frappe.db.set_value("Custom Field", "Purchase Invoice Item-rejected_duid",
                            "insert_after", "duid")

    # Drop the `duid` fields the accounting dimension had created, but ONLY on
    # doctypes the inventory dimension does not own — a doctype carrying an
    # `inventory_dimension` section break is inventory territory and its `duid`
    # must stay. (Frappe does not drop the underlying column, so no data is
    # lost either way.)
    # Two independent sources for "the inventory dimension owns this doctype",
    # unioned. The Custom Field section-break heuristic alone is not enough: it
    # only holds for doctypes ERPNext actually gave an `inventory_dimension`
    # section to, and a site missing one of those would have its live inventory
    # field swept. get_inventory_documents() is ERPNext's own definition of the
    # set (children with a Batch/Serial DocField, plus Putaway Rule).
    inventory_dts = set(frappe.db.get_all(
        "Custom Field", filters={"fieldname": "inventory_dimension"}, pluck="dt"))
    try:
        from erpnext.stock.doctype.inventory_dimension.inventory_dimension import (
            get_inventory_documents,
        )
        inventory_dts |= {r[0] for r in get_inventory_documents()}
    except Exception:
        frappe.log_error(frappe.get_traceback(), "DUID sweep: inventory doctype list failed")

    # Scoped hard, on three axes, because an earlier unscoped version of this
    # ("every Custom Field named duid on a doctype without an inventory_dimension
    # section") also deleted `Material Request.duid` — a plain Data field this app
    # creates itself in _ensure_outbound_custom_fields, nothing to do with any
    # dimension. Only a Link-to-DUID-Master field that no app owns can be a
    # leftover from the accounting dimension.
    orphans = [
        r.name for r in frappe.db.get_all(
            "Custom Field",
            filters={
                "fieldname": "duid",
                "fieldtype": "Link",
                "options": "DUID Master",
                "module": ["not in", ["Inet App"]],
            },
            fields=["name", "dt"])
        if r.dt not in inventory_dts
    ]
    for name in orphans:
        frappe.db.delete("Custom Field", {"name": name})
    if orphans:
        frappe.db.commit()
        frappe.clear_cache()

    frappe.db.commit()

    # Must run AFTER the sweep above, in the same pass. Deleting a Custom Field
    # does not drop its column, so every value the accounting dimension had
    # written under the old fieldname is now stranded where nothing reads it.
    # This deliberately does not live in a patch: post_model_sync patches run
    # before after_migrate hooks, so on a site whose rename happens during this
    # very migrate a patch would run first, find nothing to do, and be marked
    # executed forever — leaving the data stranded permanently.
    _migrate_stranded_duid_values(inventory_dts)
    _dedupe_budget_against_options()


def _dedupe_budget_against_options():
    """Drop duplicate entries from Budget's "Budget Against" dropdown.

    make_dimension_in_accounting_doctypes appends the dimension's document_type
    to that Select unconditionally, with no dedupe:

        property_setter_doc.value = property_setter_doc.value + "\n" + doc.document_type

    so every save of an existing dimension adds another copy of its name.
    Renaming the DUID dimension is a save, hence a second "DUID Master".
    Purely cosmetic, but it shows in a user-facing dropdown.

    Order is preserved, including the leading blank + Cost Center + Project —
    ERPNext's delete_accounting_dimension does ``value.split("\n")[3:]`` and
    would mangle the list if that prefix moved.
    """
    if not frappe.db.exists("Property Setter", "Budget-budget_against-options"):
        return
    value = frappe.db.get_value("Property Setter", "Budget-budget_against-options", "value") or ""
    seen, kept = set(), []
    for entry in value.split("\n"):
        key = entry.strip()
        if key and key in seen:
            continue
        seen.add(key)
        kept.append(entry)
    deduped = "\n".join(kept)
    if deduped != value:
        frappe.db.set_value("Property Setter", "Budget-budget_against-options", "value", deduped)
        frappe.clear_cache(doctype="Budget")
        frappe.db.commit()
        print(f"  DUID repair: deduped Budget Against options ({len(value.split(chr(10)))} -> {len(kept)})")


def _migrate_stranded_duid_values(protected_dts=None):
    """Move values left in an orphaned `duid` column into ACCOUNTING_DUID_FIELDNAME.

    Scoped to doctypes that (a) still have a `duid` column, (b) have a
    `duid_acc` field, and (c) no longer have a `duid` Custom Field. That last
    condition keeps the inventory dimension out of it: on Stock Entry Detail,
    Purchase Invoice Item and friends `duid` is a live field holding a
    different value (the target DUID), so copying it into the accounting column
    would be corruption, not repair.

    Idempotent — only fills a `duid_acc` that is still empty, so it never
    overwrites a value written after the split.
    """
    acc = ACCOUNTING_DUID_FIELDNAME
    if acc == "duid":
        return 0

    owned_duid = set(frappe.db.get_all("Custom Field", filters={"fieldname": "duid"}, pluck="dt"))
    owned_duid |= set(protected_dts or [])
    has_acc = set(frappe.db.get_all("Custom Field", filters={"fieldname": acc}, pluck="dt"))
    if not has_acc:
        return 0

    # information_schema, not frappe.db.has_column — that reads a cached column
    # list and is unreliable right after a migrate has reshaped tables.
    columns = {}
    for c in frappe.db.sql(
        """
        SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME IN ('duid', %s)
        """,
        (acc,),
        as_dict=True,
    ):
        columns.setdefault(c.TABLE_NAME[3:], set()).add(c.COLUMN_NAME)

    total = 0
    for dt in sorted(has_acc):
        present = columns.get(dt, set())
        if "duid" not in present or acc not in present or dt in owned_duid:
            continue
        pending = frappe.db.sql(
            f"SELECT COUNT(*) FROM `tab{dt}` WHERE IFNULL(`duid`, '') <> '' AND IFNULL(`{acc}`, '') = ''"
        )[0][0]
        if not pending:
            continue
        frappe.db.sql(
            f"UPDATE `tab{dt}` SET `{acc}` = `duid` "
            f"WHERE IFNULL(`duid`, '') <> '' AND IFNULL(`{acc}`, '') = ''"
        )
        total += pending
        print(f"  DUID repair: {dt} — moved {pending} value(s) to {acc}")

    if total:
        frappe.db.commit()
    return total


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
    _add_field("Employee", "Employee-tracker_company", {
        "fieldname": "tracker_company",
        "label": "Tracker Company",
        "fieldtype": "Link",
        "options": "Certificate Tracker Company",
        "insert_after": "certification_domain",
        "in_standard_filter": 1,
        "module": "Inet App",
    })
    _ensure_certification_domains()
    _ensure_certificate_types()
    _ensure_certificate_tracker_designations()
    _ensure_tracker_companies()
    _backfill_employment_type_from_tracker_company()
    _backfill_employee_number_from_iqama()


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


def _backfill_employee_number_from_iqama():
    """Production names Employees off employee_number (its Employee ID is
    the Iqama Number, not this bench's HR-EMP- series) — some employees
    there already have employee_number == iqama_number == their ID. Every
    Employee imported/synced by this app so far predates that being set
    (the sync endpoint now sets it going forward). Idempotent — only fills
    employee_number where it's currently blank."""
    frappe.db.sql(
        """
        UPDATE `tabEmployee`
        SET employee_number = iqama_number
        WHERE IFNULL(employee_number, '') = ''
          AND IFNULL(iqama_number, '') != ''
        """
    )
    frappe.db.commit()


def _ensure_tracker_companies():
    """Seed the subcontractor/company names seen in the latest reference
    tracker update's "Company Name" column, so the By Company page has
    something to show even before the first Excel sync runs. The sync
    endpoint (sync_employees_from_tracker_sheet) also auto-creates any new
    company name it encounters, so this list isn't exhaustive by design."""
    if not frappe.db.exists("DocType", "Certificate Tracker Company"):
        return
    for company_name in ["INET", "PROTECH", "MABRAN", "WABRANCO", "ALIM UR RASHEED", "SHIHAB", "SHASCO", "SOLCOM", "JEERESH"]:
        if frappe.db.exists("Certificate Tracker Company", company_name):
            continue
        try:
            frappe.get_doc({
                "doctype": "Certificate Tracker Company",
                "company_name": company_name,
            }).insert(ignore_permissions=True)
        except Exception:
            frappe.log_error(frappe.get_traceback(), f"Certificate Tracker Company {company_name} setup failed")
    frappe.db.commit()


def _backfill_employment_type_from_tracker_company():
    """HR business rule: every subcontractor firm's resource is on a
    Contract; only INET's own staff aren't. The Excel sync applies this to
    new/updated rows going forward, but the ~150 employees already synced
    before this rule existed need a one-time backfill. Idempotent — only
    touches employees whose Tracker Company says "not INET" and whose
    employment_type isn't already Contract; never touches INET employees
    (no replacement value was specified for that side of the rule)."""
    if not frappe.db.exists("DocType", "Certificate Tracker Company"):
        return
    if not frappe.db.exists("Employment Type", "Contract"):
        try:
            frappe.get_doc({"doctype": "Employment Type", "employee_type_name": "Contract"}).insert(ignore_permissions=True)
        except Exception:
            frappe.log_error(frappe.get_traceback(), "Employment Type Contract setup failed")
            return
    frappe.db.sql(
        """
        UPDATE `tabEmployee`
        SET employment_type = 'Contract'
        WHERE IFNULL(UPPER(tracker_company), '') NOT IN ('', 'INET')
          AND (employment_type IS NULL OR employment_type != 'Contract')
        """
    )
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


