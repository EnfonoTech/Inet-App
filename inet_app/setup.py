import frappe


def after_migrate():
    # Ensure child table doctype remains available for Project Control Center.
    frappe.reload_doc("inet_app", "doctype", "project_kpi_slab")
    _ensure_inet_roles()
    _ensure_item_activity_type_field()
    _hide_unused_activity_type_fields()


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
