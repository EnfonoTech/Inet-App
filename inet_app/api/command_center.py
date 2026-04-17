"""
Command Center API — Pipeline Operations & Dashboard Aggregation
for inet_app (Frappe 15)
"""

import calendar
import csv
import json
import os

import frappe
from inet_app.inet_app.doctype.po_intake.po_intake import normalize_po_intake_status as _normalize_po_intake_status
from inet_app.region_type import is_hard_region, region_type_from_center_area
from frappe.utils import (
    add_days,
    cint,
    flt,
    get_datetime,
    get_first_day,
    get_last_day,
    getdate,
    now_datetime,
    nowdate,
    time_diff_in_seconds,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _parse_rows(rows):
    """Accept a JSON string or a Python list/dict and always return a list."""
    if isinstance(rows, str):
        rows = frappe.parse_json(rows)
    if isinstance(rows, dict):
        rows = [rows]
    return rows or []


def _make_poid(po_no, po_line_no, shipment_number):
    """Build POID: PO No - PO Line No - Shipment No."""
    parts = [str(po_no or "").strip(), str(cint(po_line_no) if po_line_no else 0)]
    if shipment_number:
        parts.append(str(shipment_number).strip())
    return "-".join(parts)


def _resolve_line_poid(po_no, po_line_no, shipment_number, fallback=None):
    """Prefer explicit POID from intake line; otherwise rebuild from line metadata."""
    poid = (fallback or "").strip()
    return poid or _make_poid(po_no, po_line_no, shipment_number)


def _resolve_customer_link_name(customer_input):
    """Resolve Excel/UI label to Customer.name for Link fields."""
    c = (customer_input or "").strip()
    if not c:
        return None
    if frappe.db.exists("Customer", c):
        return c
    return frappe.db.get_value("Customer", {"customer_name": c}, "name")


def ensure_item_master(item_code_input, item_name=None):
    """
    Create a minimal Item if missing (for PO import). Requires ERPNext Item / Item Group.
    """
    code = (item_code_input or "").strip()
    if not code:
        return False, "item_code is required"
    if frappe.db.exists("Item", code):
        return True, None
    if not frappe.db.exists("DocType", "Item"):
        return False, "Item master is not available (install ERPNext Stock or create Item manually)"
    ig = frappe.db.get_value("Item Group", {"is_group": 0}, "name")
    if not ig:
        ig = frappe.db.sql_list("SELECT name FROM `tabItem Group` LIMIT 1")
        ig = ig[0] if ig else None
    if not ig:
        return False, "No Item Group found — create one under Stock"
    uom = frappe.db.get_single_value("Stock Settings", "stock_uom") or "Nos"
    try:
        it = frappe.new_doc("Item")
        it.item_code = code
        it.item_name = (item_name or code)[:140]
        it.item_group = ig
        it.stock_uom = uom
        if hasattr(it, "is_stock_item"):
            it.is_stock_item = 0
        it.insert(ignore_permissions=True)
    except Exception as e:
        if frappe.db.exists("Item", code):
            return True, None
        return False, str(e)
    return True, None


def ensure_project_control_center(project_code, customer_input, project_name=None, center_area=None):
    """Create Project Control Center when missing (PO import)."""
    pc = (project_code or "").strip()
    if not pc:
        return False, "project_code is required"
    if frappe.db.exists("Project Control Center", pc):
        return True, None
    cust = _resolve_customer_link_name(customer_input)
    if not cust:
        return False, "Customer is required to auto-create project"
    try:
        doc = frappe.new_doc("Project Control Center")
        doc.project_code = pc
        doc.project_name = ((project_name or pc) or "").strip()[:140] or pc
        doc.customer = cust
        if center_area:
            doc.center_area = str(center_area).strip()
        if hasattr(doc, "region_type"):
            doc.region_type = region_type_from_center_area(doc.center_area)
        doc.active_flag = "Yes"
        doc.project_status = "Active"
        doc.insert(ignore_permissions=True)
    except Exception as e:
        return False, str(e)
    return True, None


def ensure_customer_item_master(customer_input, item_code_input):
    """
    Ensure an active Customer Item Master exists for this customer and Item.
    Creates one with zero rates if missing; reactivates if an inactive row exists.

    Returns
    -------
    (ok: bool, err: str|None)
    """
    customer = _resolve_customer_link_name(customer_input)
    item_code = (item_code_input or "").strip()
    if not customer:
        return False, "Customer not found in Customer master"
    if not item_code:
        return False, "item_code is required"
    ok_item, err_item = ensure_item_master(item_code)
    if not ok_item:
        return False, err_item

    existing = frappe.db.get_value(
        "Customer Item Master",
        {"customer": customer, "item_code": item_code},
        ["name", "active_flag"],
        as_dict=True,
    )
    if existing:
        if not cint(existing.active_flag):
            frappe.db.set_value(
                "Customer Item Master",
                existing.name,
                "active_flag",
                1,
                update_modified=True,
            )
        return True, None

    try:
        doc = frappe.new_doc("Customer Item Master")
        doc.customer = customer
        doc.item_code = item_code
        doc.active_flag = 1
        doc.standard_rate_sar = 0
        doc.hard_rate_sar = 0
        doc.insert(ignore_permissions=True)
    except Exception as e:
        if frappe.db.exists(
            "Customer Item Master", {"customer": customer, "item_code": item_code}
        ):
            return True, None
        return False, str(e)

    return True, None


def ensure_duid_master(duid_input, site_name=None, center_area=None):
    """Ensure DUID Master exists for site_code; DUID and site_code are same."""
    duid = str(duid_input or "").strip()
    if not duid:
        return True, None
    if not frappe.db.exists("DocType", "DUID Master"):
        return True, None

    existing = frappe.db.get_value(
        "DUID Master",
        duid,
        ["name", "site_name", "center_area"],
        as_dict=True,
    )
    if existing:
        updates = {}
        if site_name and not existing.get("site_name"):
            updates["site_name"] = str(site_name).strip()
        if center_area and not existing.get("center_area"):
            updates["center_area"] = str(center_area).strip()
        if updates:
            frappe.db.set_value("DUID Master", duid, updates, update_modified=False)
        return True, None

    try:
        doc = frappe.new_doc("DUID Master")
        doc.duid = duid
        doc.site_name = (site_name or "")[:140]
        doc.center_area = (center_area or "")[:140]
        doc.insert(ignore_permissions=True)
    except Exception as e:
        if frappe.db.exists("DUID Master", duid):
            return True, None
        return False, str(e)
    return True, None


def _sanitize_table_pref_config(config):
    """Sanitize table personalization payload."""
    if isinstance(config, str):
        config = frappe.parse_json(config)
    config = config or {}
    if not isinstance(config, dict):
        return {}

    out = {}

    order = config.get("order")
    if isinstance(order, list):
        out["order"] = [str(x) for x in order if str(x).strip()][:200]

    hidden = config.get("hidden")
    if isinstance(hidden, list):
        out["hidden"] = [str(x) for x in hidden if str(x).strip()][:200]

    widths = config.get("widths")
    if isinstance(widths, dict):
        clean_widths = {}
        for k, v in widths.items():
            key = str(k).strip()
            if not key:
                continue
            px = cint(v)
            # Guardrails
            px = max(60, min(px, 1200))
            clean_widths[key] = px
        out["widths"] = clean_widths

    filters = config.get("filters")
    if isinstance(filters, dict):
        clean_filters = {}
        for k, v in filters.items():
            key = str(k).strip()
            if not key:
                continue
            clean_filters[key] = str(v or "")[:200]
        out["filters"] = clean_filters

    out["show_filters"] = 1 if cint(config.get("show_filters")) else 0

    dyn = config.get("dynamic_fields")
    if isinstance(dyn, list):
        clean_dyn = []
        for item in dyn[:40]:
            if not isinstance(item, dict):
                continue
            key = str(item.get("key") or "").strip()[:120]
            if not key or not key.startswith("dyn_"):
                continue
            dt = str(item.get("doctype") or "").strip()[:120]
            fn = str(item.get("fieldname") or "").strip()[:120]
            sk = str(item.get("source_key") or "").strip()[:120]
            if not dt or not fn or not sk:
                continue
            clean_dyn.append(
                {
                    "key": key,
                    "doctype": dt,
                    "fieldname": fn,
                    "source_key": sk,
                    "label": str(item.get("label") or fn)[:200],
                }
            )
        out["dynamic_fields"] = clean_dyn

    return out


# Frappe stores list-view prefs in `__UserSettings` (user, doctype, data) — not on `tabUser`.
# Use a dedicated synthetic doctype key so portal table layouts persist reliably.
_PORTAL_TABLE_PREFS_DOCTYPE = "INET PMS Table Prefs"


def _get_all_table_prefs_for_user(user):
    if not user or user == "Guest":
        return {}
    try:
        rows = frappe.db.sql(
            "select `data` from `__UserSettings` where `user`=%s and `doctype`=%s",
            (user, _PORTAL_TABLE_PREFS_DOCTYPE),
        )
    except Exception:
        rows = None
    if rows and rows[0] and rows[0][0]:
        try:
            blob = rows[0][0]
            parsed = frappe.parse_json(blob) if isinstance(blob, str) else blob
        except Exception:
            parsed = {}
        if isinstance(parsed, dict):
            inner = parsed.get("inet_table_preferences")
            if isinstance(inner, dict):
                return inner
    # Legacy: some sites may still have JSON on User (if column exists)
    if frappe.db.has_column("User", "user_settings"):
        try:
            raw = frappe.db.get_value("User", user, "user_settings")
        except Exception:
            raw = None
        if raw:
            try:
                parsed = frappe.parse_json(raw) if isinstance(raw, str) else raw
            except Exception:
                parsed = {}
            if isinstance(parsed, dict):
                inner = parsed.get("inet_table_preferences") or {}
                if isinstance(inner, dict):
                    return inner
    return {}


def _save_all_table_prefs_for_user(user, prefs):
    """Persist portal table prefs for the session user (same mechanism as Desk __UserSettings)."""
    if not user or user == "Guest":
        frappe.throw("Not permitted", frappe.PermissionError)
    if user != frappe.session.user:
        frappe.throw("Not permitted", frappe.PermissionError)
    payload = json.dumps({"inet_table_preferences": prefs})
    frappe.db.multisql(
        {
            "mariadb": (
                "INSERT INTO `__UserSettings`(`user`, `doctype`, `data`) "
                "VALUES (%s, %s, %s) ON DUPLICATE KEY UPDATE `data`=%s"
            ),
            "postgres": (
                'INSERT INTO "__UserSettings" ("user", "doctype", "data") '
                'VALUES (%s, %s, %s) ON CONFLICT ("user", "doctype") DO UPDATE SET "data"=%s'
            ),
        },
        (user, _PORTAL_TABLE_PREFS_DOCTYPE, payload, payload),
    )
    try:
        frappe.cache.hset("_user_settings", f"{_PORTAL_TABLE_PREFS_DOCTYPE}::{user}", None)
    except Exception:
        pass


@frappe.whitelist()
def get_table_preferences(table_id):
    """Read per-user table preferences for a page/table id."""
    table_id = str(table_id or "").strip()
    if not table_id:
        frappe.throw("table_id is required")
    user = frappe.session.user
    prefs = _get_all_table_prefs_for_user(user)
    config = prefs.get(table_id) or {}
    return _sanitize_table_pref_config(config)


@frappe.whitelist()
def save_table_preferences(table_id, config=None):
    """Save per-user table preferences for a page/table id."""
    table_id = str(table_id or "").strip()
    if not table_id:
        frappe.throw("table_id is required")
    if len(table_id) > 400:
        frappe.throw("table_id is too long")

    if isinstance(config, str):
        try:
            config = frappe.parse_json(config) if (config or "").strip() else {}
        except Exception:
            config = {}

    user = frappe.session.user
    prefs = _get_all_table_prefs_for_user(user)
    prefs[table_id] = _sanitize_table_pref_config(config)
    _save_all_table_prefs_for_user(user, prefs)
    return {"ok": True}


@frappe.whitelist()
def get_table_field_values(doctype, fieldname, names):
    """
    Fetch one field for a list of document names.
    Used by table personalization to add doctype-backed columns dynamically.
    """
    doctype = str(doctype or "").strip()
    fieldname = str(fieldname or "").strip()
    if isinstance(names, str):
        names = frappe.parse_json(names)
    names = names or []

    if not doctype or not fieldname:
        frappe.throw("doctype and fieldname are required")
    if not isinstance(names, list):
        frappe.throw("names must be a list")

    meta = frappe.get_meta(doctype)
    if not meta.has_field(fieldname) and fieldname != "name":
        frappe.throw(f"Field '{fieldname}' not found in {doctype}")

    rows = frappe.get_all(
        doctype,
        filters={"name": ["in", [str(n) for n in names if str(n).strip()]]},
        fields=["name", fieldname],
        limit_page_length=max(1, len(names)),
        ignore_permissions=True,
    )
    out = {r.get("name"): r.get(fieldname) for r in rows}
    return {"values": out}


@frappe.whitelist()
def get_doctype_fields(doctype):
    """Return selectable fields for a doctype as {label, fieldname}."""
    doctype = str(doctype or "").strip()
    if not doctype:
        frappe.throw("doctype is required")
    meta = frappe.get_meta(doctype)
    fields = [{"label": "Name", "fieldname": "name"}]
    for df in meta.fields:
        if not getattr(df, "fieldname", None):
            continue
        if df.fieldtype in ("Section Break", "Column Break", "Tab Break", "Button", "Fold", "Heading", "HTML"):
            continue
        fields.append({
            "label": (df.label or df.fieldname),
            "fieldname": df.fieldname,
        })
    return {"fields": fields}


def _insert_po_dispatch_with_poid(dispatch_doc, poid):
    """
    Insert PO Dispatch then optionally rename document name to POID.

    `system_id` stays the immutable naming-series id assigned at insert (e.g. SYS-2026-00001).
    Document `name` becomes the business POID when rename succeeds, so links and POID stay on `name`.
    """
    dispatch_doc.insert(ignore_permissions=True)
    internal_ref = dispatch_doc.name
    final_name = dispatch_doc.name
    poid = (poid or "").strip()
    if poid and poid != internal_ref:
        if not frappe.db.exists("PO Dispatch", poid):
            frappe.rename_doc("PO Dispatch", internal_ref, poid, force=True, merge=False)
            final_name = poid
        else:
            # Avoid accidental duplicate rename collisions; keep existing doc name.
            final_name = internal_ref

    frappe.db.set_value("PO Dispatch", final_name, "system_id", internal_ref, update_modified=False)
    return final_name


def _upsert_po_dispatch_for_line(
    po_intake_name,
    po_no,
    line_dict,
    *,
    customer=None,
    im=None,
    target_month=None,
    planning_mode="Plan",
    dispatch_status="Pending",
    dispatch_mode="Manual",
):
    """Create or update PO Dispatch for a line while preserving immutable system_id."""
    po_line_no = cint(line_dict.get("po_line_no") or 0)
    project_code = line_dict.get("project_code")
    center_area = line_dict.get("center_area") or line_dict.get("area")
    site_code = (line_dict.get("site_code") or "").strip()
    site_name = line_dict.get("site_name")
    ok_duid, err_duid = ensure_duid_master(site_code, site_name, center_area)
    if not ok_duid:
        frappe.throw(err_duid or f"Could not create DUID Master for {site_code}")
    poid = _resolve_line_poid(
        po_no=po_no,
        po_line_no=po_line_no,
        shipment_number=line_dict.get("shipment_number"),
        fallback=line_dict.get("poid"),
    )
    payload = {
        "po_intake": po_intake_name,
        "po_no": po_no,
        "po_line_no": po_line_no,
        "item_code": line_dict.get("item_code"),
        "item_description": line_dict.get("item_description"),
        "qty": flt(line_dict.get("qty", 0)),
        "rate": flt(line_dict.get("rate", 0)),
        "line_amount": flt(line_dict.get("line_amount", 0)),
        "customer": customer,
        "im": im,
        "target_month": target_month,
        "planning_mode": planning_mode,
        "dispatch_status": dispatch_status,
        "dispatch_mode": dispatch_mode,
        "center_area": center_area,
        "region_type": region_type_from_center_area(center_area),
        "site_code": site_code,
        "site_name": site_name,
    }
    if project_code and frappe.db.exists("Project Control Center", project_code):
        payload["project_code"] = project_code

    existing_name = frappe.db.get_value(
        "PO Dispatch", {"po_intake": po_intake_name, "po_line_no": po_line_no}, "name"
    )
    if existing_name:
        frappe.db.set_value("PO Dispatch", existing_name, payload, update_modified=False)
        system_id = frappe.db.get_value("PO Dispatch", existing_name, "system_id")
        if not system_id:
            frappe.db.set_value("PO Dispatch", existing_name, "system_id", existing_name, update_modified=False)
        return existing_name

    doc = frappe.new_doc("PO Dispatch")
    for key, value in payload.items():
        if value is not None and value != "":
            setattr(doc, key, value)
    return _insert_po_dispatch_with_poid(doc, poid)


def _try_auto_dispatch(doc_name, po_no, child_rows):
    """
    After PO Intake save, auto-dispatch lines whose project has an IM assigned.

    Field team is chosen later by the IM at rollout planning (not on PO Dispatch).

    child_rows: list of (child_doc_name, line_dict) tuples
    Returns count of auto-dispatched lines.
    """
    count = 0
    for child_doc_name, line_dict in child_rows:
        project_code = line_dict.get("project_code")
        if not project_code:
            continue

        # Resolve IM from Project Control Center
        im_name = frappe.db.get_value(
            "Project Control Center", project_code, "implementation_manager"
        )
        if not im_name:
            continue

        # Resolve customer
        customer = frappe.db.get_value(
            "Project Control Center", project_code, "customer"
        )

        _upsert_po_dispatch_for_line(
            doc_name,
            po_no,
            line_dict,
            customer=customer,
            im=im_name,
            target_month=None,
            planning_mode="Plan",
            dispatch_status="Dispatched",
            dispatch_mode="Auto",
        )

        frappe.db.set_value(
            "PO Intake Line",
            child_doc_name,
            {"po_line_status": "Dispatched", "dispatch_mode": "Auto"},
            update_modified=False,
        )
        count += 1

    return count


@frappe.whitelist()
def backfill_po_dispatch_id_to_poid(limit=500):
    """
    One-time maintenance:
    Rename PO Dispatch docs to the PO Intake Line POID when possible.
    Returns summary counters.
    """
    limit = cint(limit or 500)
    rows = frappe.get_all(
        "PO Dispatch",
        fields=["name", "po_intake", "po_line_no", "po_no"],
        order_by="modified desc",
        limit_page_length=limit,
    )

    renamed = 0
    skipped = 0
    failed = []

    for d in rows:
        line = frappe.db.get_value(
            "PO Intake Line",
            {"parent": d.po_intake, "po_line_no": d.po_line_no},
            ["poid", "shipment_number"],
            as_dict=True,
        )
        poid = _resolve_line_poid(
            po_no=d.po_no,
            po_line_no=d.po_line_no,
            shipment_number=(line or {}).get("shipment_number"),
            fallback=(line or {}).get("poid"),
        )
        if not poid or d.name == poid:
            skipped += 1
            continue
        if frappe.db.exists("PO Dispatch", poid):
            skipped += 1
            continue
        try:
            old_name = d.name
            frappe.rename_doc("PO Dispatch", old_name, poid, force=True, merge=False)
            frappe.db.set_value("PO Dispatch", poid, "system_id", old_name, update_modified=False)
            renamed += 1
        except Exception:
            failed.append({"from": d.name, "to": poid})

    frappe.db.commit()
    return {"checked": len(rows), "renamed": renamed, "skipped": skipped, "failed": failed}


# ---------------------------------------------------------------------------
# Task 12 — Pipeline Operations
# ---------------------------------------------------------------------------


@frappe.whitelist()
def export_po_dump(from_date=None, to_date=None, unique_inet_uid=1):
    """
    Export PO Intake lines whose parent PO was created in the date range (upload date).
    Returns uploaded PO lines in source column order for audit/export.
    """
    fd = getdate(from_date) if from_date else add_days(getdate(), -30)
    td = getdate(to_date) if to_date else getdate()
    if td < fd:
        frappe.throw("to_date must be on or after from_date")

    parents = frappe.db.sql(
        """
        SELECT name, po_no, status, DATE(creation) AS upload_date
        FROM `tabPO Intake`
        WHERE DATE(creation) BETWEEN %s AND %s
        ORDER BY creation DESC
        """,
        (fd, td),
        as_dict=True,
    )
    parent_map = {p.name: p for p in parents}
    parent_names = list(parent_map.keys())
    rows_out = []
    if not parent_names:
        return {
            "from_date": str(fd),
            "to_date": str(td),
            "rows": rows_out,
        }

    fields = [
        "name",
        "parent",
        "source_id",
        "poid",
        "po_line_no",
        "shipment_number",
        "site_name",
        "site_code",
        "project_code",
        "project_name",
        "item_code",
        "item_description",
        "uom",
        "qty",
        "due_qty",
        "billed_quantity",
        "quantity_cancel",
        "start_date",
        "end_date",
        "sub_contract_no",
        "currency",
        "rate",
        "line_amount",
        "tax_rate",
        "payment_terms",
        "center_area",
        "publish_date",
    ]

    lines = frappe.get_all(
        "PO Intake Line",
        filters={"parent": ["in", parent_names]},
        fields=fields,
        order_by="parent desc, idx asc",
        limit_page_length=10000,
    )
    for ln in lines:
        par = parent_map.get(ln.parent) or {}
        rows_out.append(
            {
                "id": ln.get("source_id") or "",
                "po_status": (par.get("status") or "OPEN"),
                "po_no": par.get("po_no") or "",
                "po_line_no": ln.get("po_line_no"),
                "shipment_no": ln.get("shipment_number") or "",
                "site_name": ln.get("site_name") or "",
                "site_code": ln.get("site_code") or "",
                "item_code": ln.get("item_code") or "",
                "item_description": ln.get("item_description") or "",
                "unit": ln.get("uom") or "",
                "requested_qty": ln.get("qty"),
                "due_qty": ln.get("due_qty"),
                "billed_quantity": ln.get("billed_quantity"),
                "quantity_cancel": ln.get("quantity_cancel"),
                "start_date": ln.get("start_date"),
                "end_date": ln.get("end_date"),
                "sub_contract_no": ln.get("sub_contract_no") or "",
                "currency": ln.get("currency") or "",
                "unit_price": ln.get("rate"),
                "line_amount": ln.get("line_amount"),
                "tax_rate": ln.get("tax_rate") or "",
                "payment_terms": ln.get("payment_terms") or "",
                "poid": ln.get("poid") or "",
                "project_code": ln.get("project_code") or "",
                "project_name": ln.get("project_name") or "",
                "center_area": ln.get("center_area") or "",
                "publish_date": ln.get("publish_date"),
                "upload_date": str(par.get("upload_date") or ""),
            }
        )

    return {
        "from_date": str(fd),
        "to_date": str(td),
        "rows": rows_out,
    }


@frappe.whitelist()
def upload_po_file(file_url, customer=None):
    """
    Parse an uploaded Huawei PO export (.xlsx/.csv) and return validated / error rows.

    Returns
    -------
    {"valid_rows": [...], "error_rows": [...], "total": N}
    """
    # ---- Resolve the physical file path --------------------------------
    if file_url.startswith("/private/files/"):
        file_path = frappe.get_site_path("private", "files", file_url[len("/private/files/"):])
    elif file_url.startswith("/files/"):
        file_path = frappe.get_site_path("public", "files", file_url[len("/files/"):])
    else:
        # Fall back to Frappe File document
        try:
            file_doc = frappe.get_doc("File", {"file_url": file_url})
            file_path = file_doc.get_full_path()
        except Exception:
            frappe.throw(f"Cannot resolve file path for: {file_url}")

    # ---- Column alias map ----------------------------------------------
    ALIAS = {
        "ID": "source_id",
        "PO Status": "po_status",
        "PO STATUS": "po_status",
        "Status": "po_status",
        "PO status": "po_status",
        "PO NO.": "po_no",
        "PO Line NO.": "po_line_no",
        "Shipment NO.": "shipment_no",
        "Site Name": "site_name",
        "Site Code": "site_code",
        "Item Code": "item_code",
        "Item Description": "item_description",
        "Unit": "unit",
        "Requested Qty": "qty",
        "Due Qty": "due_qty",
        "Billed Quantity": "billed_quantity",
        "Quantity Cancel": "quantity_cancel",
        "Start Date": "start_date",
        "End Date": "end_date",
        "Sub Contract NO.": "sub_contract_no",
        "Currency": "currency",
        "Unit Price": "rate",
        "Line Amount": "line_amount",
        "Tax Rate": "tax_rate",
        "Payment Terms": "payment_terms",
        "Project Code": "project_code",
        "Project Name": "project_name",
        "Center Area": "center_area",
        "Publish Date": "publish_date",
    }

    ext = os.path.splitext(file_path)[1].lower()
    if ext == ".csv":
        with open(file_path, "r", encoding="utf-8-sig", newline="") as f:
            csv_rows = list(csv.reader(f))
        if not csv_rows:
            frappe.throw("The uploaded file appears to be empty.")
        raw_headers = csv_rows[0]
        rows_iter = iter(csv_rows[1:])
    else:
        try:
            import openpyxl
        except ImportError:
            frappe.throw("openpyxl is not installed. Run `bench pip install openpyxl`.")
        wb = openpyxl.load_workbook(file_path, data_only=True)
        ws = wb.active
        rows_iter = ws.iter_rows(values_only=True)
        raw_headers = next(rows_iter, None)

    # First row = headers
    if not raw_headers:
        frappe.throw("The uploaded file appears to be empty.")

    headers = [str(h).strip() if h is not None else "" for h in raw_headers]

    valid_rows = []
    error_rows = []
    cim_ensured_keys = set()

    for row_idx, raw_row in enumerate(rows_iter, start=2):
        row_dict = {}
        for col_idx, cell_val in enumerate(raw_row):
            raw_header = headers[col_idx] if col_idx < len(headers) else ""
            std_key = ALIAS.get(raw_header)
            if std_key:
                row_dict[std_key] = cell_val

        row_dict["po_status"] = _normalize_po_intake_status(row_dict.get("po_status"))

        # ---- Validation ------------------------------------------------
        errors = []
        if not row_dict.get("po_no"):
            errors.append("po_no is required")
        if not row_dict.get("item_code"):
            errors.append("item_code is required")
        if not row_dict.get("project_code"):
            errors.append("project_code is required")
        qty = flt(row_dict.get("qty", 0))
        rate = flt(row_dict.get("rate", 0))
        if qty <= 0:
            errors.append("qty must be > 0")
        if rate <= 0:
            errors.append("rate must be > 0")

        project_code = str(row_dict.get("project_code") or "").strip()
        if project_code and not frappe.db.exists("Project Control Center", project_code):
            cust_for_proj = (customer or "").strip() or str(row_dict.get("customer") or "").strip()
            if cust_for_proj:
                ok_p, err_p = ensure_project_control_center(
                    project_code,
                    cust_for_proj,
                    row_dict.get("project_name"),
                    row_dict.get("center_area"),
                )
                if not ok_p:
                    errors.append(err_p or "Could not create Project Control Center")
            else:
                errors.append(
                    "project_code not found in Project Control Center (select customer on upload to auto-create project)"
                )

        item_code = str(row_dict.get("item_code") or "").strip()
        if item_code:
            ok_i, err_i = ensure_item_master(item_code, row_dict.get("item_description"))
            if not ok_i:
                errors.append(err_i or "Could not create Item")
        if customer and item_code:
            ck = (customer.strip(), item_code)
            if ck not in cim_ensured_keys:
                ok_cim, cim_err = ensure_customer_item_master(customer, item_code)
                if ok_cim:
                    cim_ensured_keys.add(ck)
                else:
                    errors.append(cim_err or "Could not create Customer Item Master")
        elif item_code:
            cim_filters = {"item_code": item_code, "active_flag": 1}
            if not frappe.db.exists("Customer Item Master", cim_filters):
                errors.append(
                    "item_code not found in Customer Item Master (pick a customer in upload to auto-create per customer)"
                )

        if errors:
            row_dict["_row"] = row_idx
            row_dict["_errors"] = errors
            error_rows.append(row_dict)
        else:
            row_dict["qty"] = qty
            row_dict["rate"] = rate
            line_amount = flt(row_dict.get("line_amount", 0))
            row_dict["line_amount"] = line_amount if line_amount > 0 else (qty * rate)
            row_dict["item_exists"] = True
            row_dict["project_exists"] = True
            valid_rows.append(row_dict)

    return {
        "valid_rows": valid_rows,
        "error_rows": error_rows,
        "total": len(valid_rows) + len(error_rows),
    }


def _poid_for_upload_line(po_no, line):
    """Stable POID for de-duplication (matches PO Intake Line / dispatch conventions)."""
    return _make_poid(po_no, line.get("po_line_no"), line.get("shipment_no"))


def _existing_poids_on_intake_doc(doc):
    seen = set()
    for row in doc.po_lines:
        pid = (row.poid or "").strip()
        if not pid:
            pid = _make_poid(doc.po_no, row.po_line_no, row.shipment_number)
        seen.add(pid)
    return seen


@frappe.whitelist()
def confirm_po_upload(rows):
    """
    Take validated rows (JSON string or list), group by po_no, and create or extend PO Intake.

    New PO numbers create a PO Intake document. If the PO already exists, new lines are appended
    when their POID is not already on the document (same PO No + line + shipment).

    Returns
    -------
    {
        "created": new PO Intake documents created,
        "lines_imported": child lines inserted,
        "lines_skipped_duplicate": rows skipped because POID already exists,
        "names": names of newly created PO Intake docs (append-only POs omitted),
    }
    """
    rows = _parse_rows(rows)

    # Group by po_no (normalize key for DB lookup)
    po_groups = {}
    for row in rows:
        po_no = row.get("po_no")
        if po_no is None or str(po_no).strip() == "":
            continue
        key = str(po_no).strip()
        po_groups.setdefault(key, []).append(row)

    created = 0
    names = []
    lines_imported = 0
    lines_skipped_duplicate = 0
    auto_dispatched = 0

    for po_no, lines in po_groups.items():
        first = lines[0]

        # Resolve customer (same rules for new + existing intake)
        row_customer = first.get("customer")
        doc_customer = row_customer
        if not doc_customer:
            project_code_hdr = first.get("project_code")
            if project_code_hdr:
                doc_customer = frappe.db.get_value(
                    "Project Control Center", project_code_hdr, "customer"
                )
        if not doc_customer:
            frappe.throw(f"Customer is required for PO {po_no}")
        resolved_cust = _resolve_customer_link_name(doc_customer)
        if not resolved_cust:
            frappe.throw(f"Customer does not exist: {doc_customer}")

        existing_name = frappe.db.get_value("PO Intake", {"po_no": po_no}, "name")
        existing_poids = set()
        if existing_name:
            existing_doc = frappe.get_doc("PO Intake", existing_name)
            if existing_doc.customer != resolved_cust:
                frappe.throw(
                    f"PO {po_no} already exists for customer {existing_doc.customer}; "
                    f"upload uses {resolved_cust}. Use the same customer or a different PO number."
                )
            existing_poids = _existing_poids_on_intake_doc(existing_doc)

        cim_pairs_done = set()
        new_entries = []  # (source_line_dict, append_row_dict)

        for line in lines:
            poid = _poid_for_upload_line(po_no, line)
            if poid in existing_poids:
                lines_skipped_duplicate += 1
                continue

            item_code = str(line.get("item_code") or "").strip()
            qty = flt(line.get("qty", 0))
            rate = flt(line.get("rate", 0))
            if qty <= 0 or rate <= 0:
                frappe.throw(f"Invalid qty/rate in PO {po_no} for item {item_code}")
            project_code = line.get("project_code")
            if project_code and not frappe.db.exists("Project Control Center", project_code):
                ok_p, err_p = ensure_project_control_center(
                    project_code,
                    resolved_cust,
                    line.get("project_name") or first.get("project_name"),
                    line.get("center_area") or first.get("center_area"),
                )
                if not ok_p:
                    frappe.throw(err_p or f"Project code not found: {project_code}")
            cim_key = (resolved_cust, item_code)
            if cim_key not in cim_pairs_done:
                ok_cim, cim_err = ensure_customer_item_master(resolved_cust, item_code)
                if not ok_cim:
                    frappe.throw(
                        cim_err
                        or f"Customer Item Master could not be created for customer {resolved_cust} and item {item_code}"
                    )
                cim_pairs_done.add(cim_key)

            line_center_area = line.get("center_area") or first.get("center_area")
            line_region = region_type_from_center_area(line_center_area)
            site_code = str(line.get("site_code") or "").strip()
            ok_duid, err_duid = ensure_duid_master(
                site_code,
                line.get("site_name"),
                line_center_area,
            )
            if not ok_duid:
                frappe.throw(err_duid or f"Could not create DUID Master for {site_code}")

            append_row = {
                "source_id": line.get("source_id"),
                    "po_line_no": cint(line.get("po_line_no") or 0),
                    "shipment_number": line.get("shipment_no"),
                "poid": poid,
                "site_code": site_code,
                    "site_name": line.get("site_name"),
                    "item_code": item_code,
                    "item_description": line.get("item_description"),
                "uom": line.get("unit"),
                "qty": qty,
                "due_qty": flt(line.get("due_qty", 0)),
                "billed_quantity": flt(line.get("billed_quantity", 0)),
                "quantity_cancel": flt(line.get("quantity_cancel", 0)),
                "start_date": line.get("start_date"),
                "end_date": line.get("end_date"),
                "sub_contract_no": line.get("sub_contract_no"),
                "currency": line.get("currency"),
                "rate": rate,
                "line_amount": flt(line.get("line_amount", 0)) or (qty * rate),
                "tax_rate": line.get("tax_rate"),
                "payment_terms": line.get("payment_terms"),
                    "project_code": line.get("project_code"),
                "project_name": line.get("project_name"),
                "center_area": line_center_area,
                "region_type": line_region,
                "publish_date": line.get("publish_date"),
            }
            new_entries.append((line, append_row))
            existing_poids.add(poid)

        if not new_entries:
            continue

        hdr_status = first.get("po_status") or first.get("status") or first.get("po_intake_status")

        if existing_name:
            doc = frappe.get_doc("PO Intake", existing_name)
            doc.status = _normalize_po_intake_status(hdr_status)
            for _src, append_row in new_entries:
                doc.append("po_lines", append_row)
            doc.save(ignore_permissions=True, ignore_links=True)
        else:
            doc = frappe.new_doc("PO Intake")
            doc.po_no = po_no
            doc.customer = resolved_cust
            doc.status = _normalize_po_intake_status(hdr_status)
            doc.publish_date = first.get("publish_date")
            doc.center_area = first.get("center_area")
            for _src, append_row in new_entries:
                doc.append("po_lines", append_row)
            doc.insert(ignore_permissions=True, ignore_links=True)
            created += 1
            names.append(doc.name)

        frappe.db.commit()
        lines_imported += len(new_entries)

        doc.reload()
        child_rows = []
        for _src, append_row in new_entries:
            pln = cint(append_row.get("po_line_no") or 0)
            want_poid = (append_row.get("poid") or "").strip() or _make_poid(
                po_no, pln, append_row.get("shipment_number")
            )
            for row in doc.po_lines:
                if cint(row.po_line_no or 0) != pln:
                    continue
                got_poid = (row.poid or "").strip() or _make_poid(
                    po_no, pln, row.shipment_number
                )
                if got_poid == want_poid:
                    child_rows.append((row.name, row.as_dict()))
                    break

        # Ensure each new line has a PO Dispatch row + immutable system_id even before dispatch.
        for _child_name, line_dict in child_rows:
            _upsert_po_dispatch_for_line(
                doc.name,
                po_no,
                line_dict,
                customer=resolved_cust,
                dispatch_status="Pending",
                dispatch_mode="Manual",
            )
        auto_dispatched += _try_auto_dispatch(doc.name, po_no, child_rows)

    return {
        "created": created,
        "lines_imported": lines_imported,
        "lines_skipped_duplicate": lines_skipped_duplicate,
        "auto_dispatched": auto_dispatched,
        "names": names,
    }


def _get_dispatch_for_intake_line(parent_name, po_line_no):
    """Load dispatch row for a PO Intake line; tolerate DB missing `region_type` before migrate."""
    filters = {"po_intake": parent_name, "po_line_no": po_line_no}
    fields_full = [
        "name", "system_id", "im", "dispatch_mode", "target_month", "region_type", "center_area",
    ]
    try:
        return frappe.db.get_value("PO Dispatch", filters, fields_full, as_dict=True) or {}
    except frappe.db.OperationalError as e:
        if not frappe.db.is_missing_column(e):
            raise
        row = frappe.db.get_value(
            "PO Dispatch",
            filters,
            ["name", "system_id", "im", "dispatch_mode", "target_month", "center_area"],
            as_dict=True,
        ) or {}
        row["region_type"] = region_type_from_center_area(row.get("center_area"))
        return row


@frappe.whitelist()
def list_po_intake_lines(status="New"):
    """
    Return PO Intake child lines that match given po_line_status (or all when status='all').
    Each row is enriched with parent PO Intake fields and, for dispatched lines, dispatch info.
    """
    filters = {}
    if status and status.lower() != "all":
        filters["po_line_status"] = status

    line_fields_full = [
        "name", "parent", "po_line_no", "poid", "shipment_number",
        "item_code", "item_description", "qty", "rate", "line_amount",
        "project_code", "site_code", "site_name", "area", "center_area", "region_type",
        "po_line_status", "activity_code", "dispatch_mode",
    ]
    line_fields_base = [
        "name", "parent", "po_line_no", "poid", "shipment_number",
        "item_code", "item_description", "qty", "rate", "line_amount",
        "project_code", "site_code", "site_name", "area",
        "po_line_status", "activity_code", "dispatch_mode",
    ]
    try:
        lines = frappe.get_all(
            "PO Intake Line",
            filters=filters,
            fields=line_fields_full,
            order_by="parent desc, idx asc",
            limit_page_length=500,
        )
    except frappe.db.OperationalError as e:
        if not frappe.db.is_missing_column(e):
            raise
        lines = frappe.get_all(
            "PO Intake Line",
            filters=filters,
            fields=line_fields_base,
            order_by="parent desc, idx asc",
            limit_page_length=500,
        )
        for row in lines:
            row.setdefault("center_area", None)
            row.setdefault("region_type", None)

    # Enrich each line with PO-level info and dispatch assignment info
    parent_cache = {}
    for line in lines:
        parent_name = line.get("parent")
        if parent_name not in parent_cache:
            parent_cache[parent_name] = frappe.db.get_value(
                "PO Intake", parent_name, ["po_no", "customer", "center_area"], as_dict=True
            ) or {}
        pdata = parent_cache[parent_name]
        line["po_no"] = pdata.get("po_no", "")
        line["customer"] = pdata.get("customer", "")
        line["po_intake"] = parent_name
        line["center_area"] = line.get("center_area") or pdata.get("center_area")

        dispatch_data = _get_dispatch_for_intake_line(parent_name, line.get("po_line_no"))
        if dispatch_data:
            line["dispatch_name"] = dispatch_data.get("name")
            line["system_id"] = dispatch_data.get("system_id")
        if line.get("po_line_status") == "Dispatched" and dispatch_data:
            line["dispatched_im"] = dispatch_data.get("im")
            line["dispatch_target_month"] = dispatch_data.get("target_month")
            if not line.get("dispatch_mode"):
                line["dispatch_mode"] = dispatch_data.get("dispatch_mode")
            if dispatch_data.get("region_type"):
                line["region_type"] = dispatch_data.get("region_type")
            elif not line.get("region_type"):
                line["region_type"] = region_type_from_center_area(
                    dispatch_data.get("center_area") or line.get("center_area")
                )

        if not line.get("region_type"):
            line["region_type"] = region_type_from_center_area(line.get("center_area"))

    return lines


def _require_inet_im_session():
    user = frappe.session.user
    if not user or user == "Guest":
        frappe.throw("Not permitted", frappe.PermissionError)
    roles = set(frappe.get_roles(user))
    if (
        "INET IM" not in roles
        and "Administrator" not in roles
        and "System Manager" not in roles
    ):
        frappe.throw(
            "Only Implementation Managers can use this action.",
            frappe.PermissionError,
        )
    _im_resolved, im_identifiers, _ = resolve_im_for_session()
    if not im_identifiers:
        frappe.throw(
            "Could not resolve IM from your user profile.",
            frappe.ValidationError,
        )
    return _im_resolved, im_identifiers


def _pcc_im_allows_project(project_code, im_identifiers):
    if not project_code or not frappe.db.exists("Project Control Center", project_code):
        return False
    im_on = frappe.db.get_value(
        "Project Control Center", project_code, "implementation_manager"
    )
    if not im_on:
        return False
    return im_on in set(im_identifiers)


@frappe.whitelist()
def create_im_dummy_po_dispatch(payload=None):
    """
    Dummy PO Dispatch: only project is required at create time.

    Placeholder DUID / item / qty are set; real details are applied in map_im_dummy_po_to_intake_line.

    payload: {"project_code": required}
    """
    if isinstance(payload, str):
        payload = frappe.parse_json(payload)
    payload = payload or {}

    _im_resolved, im_identifiers = _require_inet_im_session()

    project_code = (payload.get("project_code") or "").strip()
    if not project_code:
        frappe.throw("project_code is required")
    if not _pcc_im_allows_project(project_code, im_identifiers):
        frappe.throw("You are not the Implementation Manager for this project.")

    site_code = None
    for _attempt in range(40):
        candidate = f"DUMMY-{frappe.generate_hash(length=14)}"
        if not frappe.db.exists("DUID Master", candidate):
            site_code = candidate
            break
    if not site_code:
        frappe.throw("Could not allocate a placeholder DUID — retry.")

    site_name = "Pending — map to PO line"
    ok_duid, err_duid = ensure_duid_master(site_code, site_name=site_name, center_area=None)
    if not ok_duid:
        frappe.throw(err_duid or f"Could not create DUID Master for {site_code}")

    customer = frappe.db.get_value("Project Control Center", project_code, "customer")

    item_code = "PENDING"
    item_description = "Fill by mapping to PO Intake line"
    qty = flt(1)
    rate = flt(0)
    line_amount = flt(0)
    center_area = None

    # Placeholder PO until map: DUMMY-yymmdd-XXXXXX (6 hex) → short POID e.g. DUMMY-260416-A3B4C5-1
    dt = now_datetime()
    for _attempt in range(30):
        po_no = f"DUMMY-{dt.strftime('%y%m%d')}-{frappe.generate_hash(length=6).upper()}"
        if not frappe.db.exists("PO Dispatch", {"po_no": po_no}):
            break
    else:
        frappe.throw("Could not allocate a unique dummy PO number — retry.")

    poid = _make_poid(po_no, 1, None)

    doc = frappe.new_doc("PO Dispatch")
    doc.project_code = project_code
    doc.customer = customer
    doc.im = _im_resolved
    doc.po_no = po_no
    doc.po_line_no = 1
    doc.item_code = item_code
    if item_description:
        doc.item_description = item_description
    doc.qty = qty
    doc.rate = rate
    doc.line_amount = line_amount
    doc.site_code = site_code
    doc.site_name = site_name
    doc.center_area = center_area
    doc.region_type = region_type_from_center_area(center_area)
    doc.planning_mode = "Plan"
    doc.dispatch_status = "Dispatched"
    doc.dispatch_mode = "Manual"
    if frappe.db.has_column("PO Dispatch", "is_dummy_po"):
        doc.is_dummy_po = 1

    final_name = _insert_po_dispatch_with_poid(doc, poid)
    stamp = {}
    if frappe.db.has_column("PO Dispatch", "original_dummy_poid"):
        stamp["original_dummy_poid"] = final_name
    if frappe.db.has_column("PO Dispatch", "was_dummy_po"):
        stamp["was_dummy_po"] = 1
    if stamp:
        frappe.db.set_value("PO Dispatch", final_name, stamp, update_modified=False)
    frappe.db.commit()
    return {"name": final_name, "po_no": po_no, "poid": final_name}


@frappe.whitelist()
def list_po_dispatches(filters=None, order_by="modified desc", limit_page_length=100):
    """
    List PO Dispatch rows using only columns that exist in the database.

    ``frappe.client.get_list(..., fields=[\"*\"])`` expands ``*`` from DocType meta, so new
    fields in the JSON that are not yet migrated into MySQL cause OperationalError 1054.
    This endpoint avoids that by selecting physical table columns only.
    """
    if isinstance(filters, str):
        filters = frappe.parse_json(filters) if filters else {}
    filters = filters or {}
    limit_page_length = cint(limit_page_length) or 100
    fields = list(frappe.db.get_table_columns("PO Dispatch"))
    return frappe.get_list(
        "PO Dispatch",
        filters=filters,
        fields=fields,
        order_by=order_by or "modified desc",
        limit_page_length=limit_page_length,
    )


@frappe.whitelist()
def list_po_intake_lines_for_im_map(project_code=None):
    """
    PO Intake lines for a project — IM only, for mapping a dummy dispatch to a real line.
    """
    project_code = (project_code or "").strip()
    if not project_code:
        frappe.throw("project_code is required")

    _im_resolved, im_identifiers = _require_inet_im_session()
    if not _pcc_im_allows_project(project_code, im_identifiers):
        frappe.throw("Not permitted for this project.")

    line_fields = [
        "name",
        "parent",
        "po_line_no",
        "poid",
        "shipment_number",
        "item_code",
        "item_description",
        "qty",
        "rate",
        "line_amount",
        "project_code",
        "site_code",
        "site_name",
        "center_area",
        "region_type",
        "po_line_status",
    ]
    try:
        lines = frappe.get_all(
            "PO Intake Line",
            filters={"project_code": project_code, "po_line_status": ["!=", "Completed"]},
            fields=line_fields,
            order_by="modified desc",
            limit_page_length=400,
        )
    except frappe.db.OperationalError as e:
        if not frappe.db.is_missing_column(e):
            raise
        line_fields.remove("center_area")
        line_fields.remove("region_type")
        lines = frappe.get_all(
            "PO Intake Line",
            filters={"project_code": project_code, "po_line_status": ["!=", "Completed"]},
            fields=line_fields,
            order_by="modified desc",
            limit_page_length=400,
        )
        for row in lines:
            row["center_area"] = None
            row["region_type"] = None

    parents = {}
    for row in lines:
        pn = row.get("parent")
        if pn and pn not in parents:
            parents[pn] = frappe.db.get_value(
                "PO Intake", pn, ["po_no", "customer"], as_dict=True
            ) or {}
        pdata = parents.get(row.get("parent")) or {}
        row["po_no"] = pdata.get("po_no", "")
        row["customer"] = pdata.get("customer", "")
        row["po_intake"] = row.get("parent")
        drow = _get_dispatch_for_intake_line(row.get("parent"), row.get("po_line_no"))
        if drow:
            row["existing_dispatch"] = drow.get("name")
            row["existing_dispatch_status"] = frappe.db.get_value(
                "PO Dispatch", drow.get("name"), "dispatch_status"
            )
        else:
            row["existing_dispatch"] = None
            row["existing_dispatch_status"] = None

    return lines


@frappe.whitelist()
def map_im_dummy_po_to_intake_line(payload=None):
    """
    Link a dummy PO Dispatch to a real PO Intake line and rename to business POID.

    payload: {
        "dummy_po_dispatch": "PO Dispatch name (current POID)",
        "po_intake_line": "PO Intake Line child row name",
    }

    If the intake line already has another dispatch from intake/PM dispatch (often Pending or
    Dispatched) with **no** rollout plans and **no** executions on that dispatch, it is removed
    so the dummy can take the real POID. If that dispatch has rollouts/executions or is
    Completed, mapping is blocked.
    """
    if isinstance(payload, str):
        payload = frappe.parse_json(payload)
    payload = payload or {}

    dummy_name = (payload.get("dummy_po_dispatch") or "").strip()
    line_name = (payload.get("po_intake_line") or "").strip()
    if not dummy_name or not line_name:
        frappe.throw("dummy_po_dispatch and po_intake_line are required")

    _im_resolved, im_identifiers = _require_inet_im_session()

    if not frappe.db.exists("PO Dispatch", dummy_name):
        frappe.throw("PO Dispatch not found.")

    d_im = frappe.db.get_value("PO Dispatch", dummy_name, "im")
    if d_im not in set(im_identifiers):
        frappe.throw("Not permitted for this dispatch.")

    if frappe.db.has_column("PO Dispatch", "is_dummy_po"):
        if not cint(frappe.db.get_value("PO Dispatch", dummy_name, "is_dummy_po")):
            frappe.throw("This dispatch is not marked as dummy PO.")

    if not frappe.db.exists("PO Intake Line", line_name):
        frappe.throw("PO Intake Line not found.")

    line_row = frappe.db.get_value("PO Intake Line", line_name, "*", as_dict=True)
    parent_intake = line_row.get("parent")
    project_line = (line_row.get("project_code") or "").strip()
    if not parent_intake or not frappe.db.exists("PO Intake", parent_intake):
        frappe.throw("Invalid PO Intake Line parent.")

    if not _pcc_im_allows_project(project_line, im_identifiers):
        frappe.throw("Not permitted for this PO line’s project.")

    d_proj = (frappe.db.get_value("PO Dispatch", dummy_name, "project_code") or "").strip()
    if project_line != d_proj:
        frappe.throw(
            "Project on the PO line must match the dummy dispatch project."
        )

    parent_po_no = frappe.db.get_value("PO Intake", parent_intake, "po_no") or ""
    customer = frappe.db.get_value("PO Intake", parent_intake, "customer")

    po_line_no = cint(line_row.get("po_line_no") or 0)
    shipment_number = line_row.get("shipment_number")
    poid_target = (line_row.get("poid") or "").strip() or _resolve_line_poid(
        parent_po_no,
        po_line_no,
        shipment_number,
    )

    stub = _get_dispatch_for_intake_line(parent_intake, po_line_no)
    stub_name = stub.get("name")
    if stub_name and stub_name != dummy_name:
        rp_count = frappe.db.count("Rollout Plan", {"po_dispatch": stub_name})
        ex_count = frappe.db.sql(
            """
            SELECT COUNT(*) FROM `tabDaily Execution` de
            INNER JOIN `tabRollout Plan` rp ON rp.name = de.rollout_plan
            WHERE rp.po_dispatch = %s
            """,
            (stub_name,),
        )[0][0]
        if rp_count or ex_count:
            frappe.throw(
                f"PO line already has dispatch {stub_name} with rollout or execution activity. "
                "Finish or cancel that work before mapping this dummy PO."
            )
        stub_status = (frappe.db.get_value("PO Dispatch", stub_name, "dispatch_status") or "").strip()
        if stub_status == "Completed":
            frappe.throw(
                f"This PO line is linked to a completed dispatch ({stub_name}). Mapping is not allowed."
            )
        frappe.delete_doc("PO Dispatch", stub_name, force=True, ignore_permissions=True)

    center_area = line_row.get("center_area") or line_row.get("area")
    site_code = (line_row.get("site_code") or "").strip()
    site_name = line_row.get("site_name")
    if site_code:
        ok_duid, err_duid = ensure_duid_master(site_code, site_name, center_area)
        if not ok_duid:
            frappe.throw(err_duid or f"Could not ensure DUID Master for {site_code}")

    update_vals = {
        "po_intake": parent_intake,
        "po_no": parent_po_no,
        "po_line_no": po_line_no,
        "item_code": line_row.get("item_code"),
        "item_description": line_row.get("item_description"),
        "qty": flt(line_row.get("qty", 0)),
        "rate": flt(line_row.get("rate", 0)),
        "line_amount": flt(line_row.get("line_amount", 0)),
        "project_code": project_line,
        "customer": customer or frappe.db.get_value(
            "Project Control Center", project_line, "customer"
        ),
        "center_area": center_area,
        "region_type": line_row.get("region_type")
        or region_type_from_center_area(center_area),
        "site_code": site_code or None,
        "site_name": site_name,
    }
    if frappe.db.has_column("PO Dispatch", "is_dummy_po"):
        update_vals["is_dummy_po"] = 0
    if frappe.db.has_column("PO Dispatch", "was_dummy_po"):
        update_vals["was_dummy_po"] = 1
    if frappe.db.has_column("PO Dispatch", "original_dummy_poid"):
        ex_orig = (
            frappe.db.get_value("PO Dispatch", dummy_name, "original_dummy_poid") or ""
        ).strip()
        if not ex_orig:
            update_vals["original_dummy_poid"] = dummy_name

    frappe.db.set_value("PO Dispatch", dummy_name, update_vals, update_modified=True)

    final_name = dummy_name
    if poid_target and poid_target != dummy_name:
        if frappe.db.exists("PO Dispatch", poid_target):
            frappe.throw(
                f"POID {poid_target} already exists — resolve duplicate PO dispatches first."
            )
        frappe.rename_doc(
            "PO Dispatch",
            dummy_name,
            poid_target,
            force=True,
            merge=False,
            show_alert=False,
        )
        final_name = poid_target

    frappe.db.set_value(
        "PO Intake Line",
        line_name,
        {"po_line_status": "Dispatched", "dispatch_mode": "Manual"},
        update_modified=True,
    )

    frappe.db.commit()
    gv_fields = ["po_no", "po_line_no"]
    if frappe.db.has_column("PO Dispatch", "original_dummy_poid"):
        gv_fields.append("original_dummy_poid")
    if frappe.db.has_column("PO Dispatch", "was_dummy_po"):
        gv_fields.append("was_dummy_po")
    meta = frappe.db.get_value("PO Dispatch", final_name, gv_fields, as_dict=True) or {}
    return {
        "name": final_name,
        "poid": final_name,
        "po_intake": parent_intake,
        "po_intake_line": line_name,
        "original_dummy_poid": (meta.get("original_dummy_poid") or "").strip(),
        "was_dummy_po": cint(meta.get("was_dummy_po")),
        "po_no": meta.get("po_no") or parent_po_no,
        "po_line_no": cint(meta.get("po_line_no") or po_line_no),
    }


@frappe.whitelist()
def dispatch_po_lines(payload):
    """
    Dispatch PO lines to an Implementation Manager for a target month.

    payload = {
        "lines": [{"po_intake": "PIP-...", "item_code": "...", ...}],
        "im": "IM Master document name",  # required (or legacy "team" to derive im)
        "target_month": "2026-04",
        "planning_mode": "Plan",
    }

    Returns
    -------
    {"created": N, "poids": [...]}
    """
    if isinstance(payload, str):
        payload = frappe.parse_json(payload)

    lines = payload.get("lines") or []
    im = (payload.get("im") or "").strip() or None
    team_id = payload.get("team")  # deprecated: derive IM from team if im not sent
    raw_month = payload.get("target_month") or ""
    # Handle "2026-04" from HTML month input -> "2026-04-01"
    if raw_month and len(raw_month) == 7:
        target_month = raw_month + "-01"
    else:
        target_month = raw_month
    planning_mode = payload.get("planning_mode", "Plan")

    if not im and team_id:
        team_doc = frappe.db.get_value("INET Team", team_id, ["im"], as_dict=True)
        if team_doc:
            im = team_doc.im

    if not im:
        frappe.throw(
            frappe._("Implementation Manager (im) is required to dispatch PO lines.")
        )

    created = 0
    poids = []

    for line in lines:
        po_intake_name = line.get("po_intake") or line.get("parent")
        po_line_no = cint(line.get("po_line_no") or 0)
        item_code = line.get("item_code")
        item_description = line.get("item_description")
        qty = flt(line.get("qty", 0))
        rate = flt(line.get("rate", 0))
        line_amount = flt(line.get("line_amount", 0))
        project_code = line.get("project_code")
        center_area = line.get("center_area") or line.get("area")
        site_code = line.get("site_code")
        site_name = line.get("site_name")
        po_no = line.get("po_no")
        line_child_name = line.get("name")  # child table row name
        poid = _resolve_line_poid(
            po_no=po_no,
            po_line_no=po_line_no,
            shipment_number=line.get("shipment_number"),
            fallback=line.get("poid"),
        )

        # Resolve customer from PO Intake parent
        customer = line.get("customer")
        if not customer and project_code:
            customer = frappe.db.get_value(
                "Project Control Center", project_code, "customer"
            )

        final_dispatch_name = _upsert_po_dispatch_for_line(
            po_intake_name,
            po_no,
            {
                "po_line_no": po_line_no,
                "item_code": item_code,
                "item_description": item_description,
                "qty": qty,
                "rate": rate,
                "line_amount": line_amount,
                "project_code": project_code,
                "center_area": center_area,
                "site_code": site_code,
                "site_name": site_name,
                "shipment_number": line.get("shipment_number"),
                "poid": poid,
            },
            customer=customer,
            im=im,
            target_month=target_month,
            planning_mode=planning_mode,
            dispatch_status="Dispatched",
            dispatch_mode="Manual",
        )

        # Mark the PO Intake Line as "Dispatched"
        if line_child_name:
            frappe.db.set_value(
                "PO Intake Line", line_child_name,
                {"po_line_status": "Dispatched", "dispatch_mode": "Manual"},
                update_modified=False,
            )

        frappe.db.commit()
        created += 1
        poids.append(final_dispatch_name)

    return {"created": created, "poids": poids}


@frappe.whitelist()
def convert_dispatch_mode(payload):
    """
    Convert Auto-dispatched lines to Manual (or vice-versa).

    payload = {
        "scope": "lines" | "project",
        "line_names": [...],        # PO Intake Line child row names (for scope=lines)
        "project_code": "...",      # required when scope=project
        "new_im": "im_name",        # optional — re-assign IM (IM Master name)
        "target_mode": "Manual",    # "Manual" or "Auto" (default "Manual")
    }

    Returns {"converted": N}
    """
    if isinstance(payload, str):
        payload = frappe.parse_json(payload)

    scope = payload.get("scope", "lines")
    project_code = payload.get("project_code")
    line_names = payload.get("line_names") or []
    new_im = payload.get("new_im")
    target_mode = payload.get("target_mode", "Manual")

    if scope == "project" and project_code:
        line_names = frappe.get_all(
            "PO Intake Line",
            filters={"project_code": project_code, "po_line_status": "Dispatched"},
            pluck="name",
        )

    count = 0
    for line_name in line_names:
        frappe.db.set_value(
            "PO Intake Line", line_name, "dispatch_mode", target_mode,
            update_modified=False,
        )

        line_data = frappe.db.get_value(
            "PO Intake Line", line_name, ["parent", "po_line_no"], as_dict=True
        )
        if line_data:
            dispatch_names = frappe.get_all(
                "PO Dispatch",
                filters={"po_intake": line_data.parent, "po_line_no": line_data.po_line_no},
                pluck="name",
            )
            for dispatch_name in dispatch_names:
                update_vals = {"dispatch_mode": target_mode}
                if new_im:
                    update_vals["im"] = new_im
                frappe.db.set_value(
                    "PO Dispatch", dispatch_name, update_vals, update_modified=False
                )
            count += len(dispatch_names)

        frappe.db.commit()

    return {"converted": count}


@frappe.whitelist()
def create_rollout_plans(payload):
    """
    Create Rollout Plans for a list of PO Dispatch system IDs.

    payload = {
        "dispatches": ["SYS-2026-00001", ...],
        "plan_date": "2026-04-04",
        "plan_end_date": "2026-04-05",  # optional; defaults to plan_date
        "team": "TEAM-001",  # required INET Team name (IM chooses at planning; stored on Rollout Plan only)
        "access_time": "",  # optional
        "access_period": "Day" | "Night" | "",  # optional
        "visit_type": "Work Done",
    }

    Returns
    -------
    {"created": N, "names": [...]}
    """
    if isinstance(payload, str):
        payload = frappe.parse_json(payload)

    dispatches = payload.get("dispatches") or []
    plan_date = payload.get("plan_date") or nowdate()
    plan_end_date = payload.get("plan_end_date") or plan_date
    team_override = (payload.get("team") or "").strip()
    access_time = (payload.get("access_time") or "").strip()
    access_period = (payload.get("access_period") or "").strip()
    if access_period and access_period not in ("Day", "Night"):
        access_period = ""
    visit_type = payload.get("visit_type", "Work Done")

    pd = getdate(plan_date)
    ped = getdate(plan_end_date)
    if ped < pd:
        frappe.throw(frappe._("Planned end date cannot be before plan start date"))

    if not team_override:
        frappe.throw(
            frappe._(
                "Select a field team for this rollout. Team is stored on the Rollout Plan (not on PO Dispatch)."
            )
        )

    if not frappe.db.exists("INET Team", team_override):
        frappe.throw(frappe._("Invalid team selected"))

    # Look up multiplier
    visit_multiplier = flt(
        frappe.db.get_value("Visit Multiplier Master", visit_type, "multiplier") or 1.0
    )

    created = 0
    names = []

    for dispatch_name in dispatches:
        dispatch = frappe.db.get_value(
            "PO Dispatch",
            dispatch_name,
            ["name", "line_amount", "im", "region_type", "center_area"],
            as_dict=True,
        )
        if not dispatch:
            continue

        target_team = team_override

        doc = frappe.new_doc("Rollout Plan")
        doc.po_dispatch = dispatch_name
        doc.team = target_team
        if dispatch.im and hasattr(doc, "im"):
            doc.im = dispatch.im
        doc.plan_date = plan_date
        doc.plan_end_date = plan_end_date
        doc.access_time = access_time
        doc.access_period = access_period or None
        doc.visit_type = visit_type
        doc.visit_multiplier = visit_multiplier
        doc.target_amount = flt(dispatch.line_amount) * visit_multiplier
        doc.plan_status = "Planned"
        if hasattr(doc, "region_type"):
            doc.region_type = dispatch.get("region_type") or region_type_from_center_area(
                dispatch.get("center_area")
            )

        doc.insert(ignore_permissions=True)
        frappe.db.commit()

        frappe.db.set_value(
            "PO Dispatch",
            dispatch_name,
            {"dispatch_status": "Planned"},
            update_modified=False,
        )

        created += 1
        names.append(doc.name)

    return {"created": created, "names": names}


def _sync_rollout_plan_from_daily_execution(rollout_plan, exec_doc):
    """
    Keep Rollout Plan plan_status (and optional amounts) in sync with Daily Execution.
    Options: Planned, Planning with Issue, In Execution, Completed, Cancelled.
    """
    if not rollout_plan or not exec_doc:
        return
    st = exec_doc.execution_status
    updates = {}

    if st == "In Progress":
        cur = frappe.db.get_value("Rollout Plan", rollout_plan, "plan_status")
        if cur == "Planned":
            updates["plan_status"] = "In Execution"

    elif st == "Completed":
        qc = str(getattr(exec_doc, "qc_status", None) or "")
        ach_amt = flt(getattr(exec_doc, "achieved_amount", None) or 0)
        tgt = flt(frappe.db.get_value("Rollout Plan", rollout_plan, "target_amount") or 0)
        if qc == "Fail":
            # QC failure returns work to planning; do not close the original plan as Completed.
            updates["plan_status"] = "Planning with Issue"
        else:
            # Completed execution should reflect as Completed in planning monitor.
            # QC/CIAG is a follow-up review step and should not revert plan to In Execution.
            updates["plan_status"] = "Completed"
        if ach_amt > 0:
            updates["achieved_amount"] = ach_amt
        if tgt > 0 and ach_amt >= 0:
            updates["completion_pct"] = min(100.0, (ach_amt / tgt) * 100.0)

    elif st == "Cancelled":
        updates["plan_status"] = "Cancelled"

    elif st == "Postponed":
        updates["plan_status"] = "Planned"

    # Hold: keep current plan status (still on site / in progress)

    if updates:
        frappe.db.set_value("Rollout Plan", rollout_plan, updates)


def _normalize_execution_status(value):
    s = str(value or "").strip()
    if not s:
        return s
    sl = s.lower()
    if sl in ("in progress", "inprogress"):
        return "In Progress"
    if sl in ("complete", "completed"):
        return "Completed"
    if sl in ("cancel", "cancelled", "canceled"):
        return "Cancelled"
    if sl in ("postpone", "postponed"):
        return "Postponed"
    return s


def _get_rollout_billing_rate(rollout_plan):
    if not rollout_plan:
        return 0.0

    rp = frappe.db.get_value("Rollout Plan", rollout_plan, ["po_dispatch"], as_dict=True)
    if not rp or not rp.po_dispatch:
        return 0.0

    dispatch = frappe.db.get_value(
        "PO Dispatch",
        rp.po_dispatch,
        ["item_code", "center_area", "region_type", "customer"],
        as_dict=True,
    )
    if not dispatch or not dispatch.item_code:
        return 0.0

    is_hard = is_hard_region(dispatch.region_type, dispatch.center_area)
    cim_filters = {"item_code": dispatch.item_code, "active_flag": 1}
    if dispatch.customer:
        cim_filters["customer"] = dispatch.customer
    cim = frappe.db.get_value(
        "Customer Item Master",
        cim_filters,
        ["standard_rate_sar", "hard_rate_sar"],
        as_dict=True,
    )
    if not cim:
        cim = frappe.db.get_value(
            "Customer Item Master",
            {"item_code": dispatch.item_code, "active_flag": 1},
            ["standard_rate_sar", "hard_rate_sar"],
            as_dict=True,
        )
    if not cim:
        return 0.0
    return flt(cim.hard_rate_sar if is_hard else cim.standard_rate_sar)


def _user_execution_update_mode(user, doc):
    """
    IM/Admin: full update. INET Field Team members (team lead + roster): qc_status / ciag_status only.
    """
    if not user or user == "Guest":
        return None
    roles = set(frappe.get_roles(user))
    if (
        "Administrator" in roles
        or "System Manager" in roles
        or "INET Admin" in roles
        or "INET IM" in roles
    ):
        return "full"
    if "INET Field Team" not in roles:
        return None
    team_id = getattr(doc, "team", None)
    if not team_id or not frappe.db.exists("INET Team", team_id):
        return None
    td = frappe.get_doc("INET Team", team_id)
    members = set()
    if td.field_user:
        members.add(td.field_user)
    for r in td.team_members or []:
        emp = getattr(r, "employee", None)
        if not emp:
            continue
        uid = frappe.db.get_value("Employee", emp, "user_id")
        if uid:
            members.add(uid)
    if user in members:
        return "qc_ciag"
    return None


@frappe.whitelist()
def get_field_execution_for_rollout(rollout_plan):
    """Latest Daily Execution for this rollout.

    Field team: scoped to the logged-in user's INET team (QC/CIAG flow).
    IM / desk admin: any team on that rollout so IM can record execution without a field_user.
    """
    rollout_plan = (rollout_plan or "").strip()
    if not rollout_plan:
        return None
    user = frappe.session.user
    roles = set(frappe.get_roles(user))
    im_scope = (
        "Administrator" in roles
        or "System Manager" in roles
        or "INET Admin" in roles
        or "INET IM" in roles
    )
    if im_scope:
        rows = frappe.get_all(
            "Daily Execution",
            filters={"rollout_plan": rollout_plan},
            fields=["name", "qc_status", "ciag_status", "execution_status", "photos"],
            order_by="modified desc",
            limit_page_length=1,
        )
        return rows[0] if rows else None
    team_id = _session_inet_field_team_id()
    if not team_id:
        return None
    rows = frappe.get_all(
        "Daily Execution",
        filters={"rollout_plan": rollout_plan, "team": team_id},
        fields=["name", "qc_status", "ciag_status", "execution_status", "photos"],
        order_by="modified desc",
        limit_page_length=1,
    )
    return rows[0] if rows else None


@frappe.whitelist()
def update_execution(payload):
    """
    Create or update a Daily Execution record.

    payload keys:
        name            — existing Execution name (to update)
        rollout_plan    — required when creating
        execution_date
        execution_status
        achieved_qty
        achieved_amount
        gps_location
        qc_status
        ciag_status
        revisit_flag
        remarks

    Returns
    -------
    {"name": ..., "status": ...}
    """
    if isinstance(payload, str):
        payload = frappe.parse_json(payload)

    exec_name = payload.get("name")

    if exec_name:
        # Update existing
        doc = frappe.get_doc("Daily Execution", exec_name)
        mode = _user_execution_update_mode(frappe.session.user, doc)
        if mode is None:
            frappe.throw("Not permitted", frappe.PermissionError)
        if mode == "qc_ciag":
            slim = {}
            if "qc_status" in payload:
                slim["qc_status"] = payload.get("qc_status")
            if "ciag_status" in payload:
                slim["ciag_status"] = payload.get("ciag_status")
            payload = slim
    else:
        # Upsert by rollout_plan: only ONE Daily Execution per plan.
        rollout_plan = payload.get("rollout_plan")
        if not rollout_plan:
            frappe.throw("rollout_plan is required when creating a new Daily Execution.")

        existing_exec = frappe.db.get_value(
            "Daily Execution",
            {"rollout_plan": rollout_plan},
            "name",
            order_by="modified desc",
        )
        if existing_exec:
            doc = frappe.get_doc("Daily Execution", existing_exec)
        else:
            rp = frappe.db.get_value(
                "Rollout Plan", rollout_plan, ["po_dispatch", "team", "region_type"], as_dict=True
            )

            doc = frappe.new_doc("Daily Execution")
            doc.rollout_plan = rollout_plan
            doc.system_id = rp.po_dispatch if rp else None
            doc.team = rp.team if rp else None
            pd_name = rp.po_dispatch if rp else None
            im_v = None
            if pd_name:
                im_v = frappe.db.get_value("PO Dispatch", pd_name, "im")
            if im_v and hasattr(doc, "im"):
                doc.im = im_v

            if hasattr(doc, "region_type"):
                doc.region_type = (rp.get("region_type") if rp else None) or None
                if not doc.region_type and pd_name:
                    pd_row = frappe.db.get_value(
                        "PO Dispatch", pd_name, ["region_type", "center_area"], as_dict=True
                    )
                    if pd_row:
                        doc.region_type = pd_row.get("region_type") or region_type_from_center_area(
                            pd_row.get("center_area")
                        )
                if not doc.region_type:
                    doc.region_type = "Standard"

    # Apply updatable fields
    for field in [
        "execution_date",
        "execution_status",
        "achieved_qty",
        "achieved_amount",
        "gps_location",
        "photos",
        "qc_status",
        "issue_category",
        "ciag_status",
        "revisit_flag",
        "remarks",
    ]:
        if field in payload and hasattr(doc, field):
            setattr(doc, field, payload[field])

    if hasattr(doc, "execution_status"):
        doc.execution_status = _normalize_execution_status(doc.execution_status)

    # QC / CIAG is only allowed once execution is completed.
    if ("qc_status" in payload or "ciag_status" in payload) and doc.execution_status != "Completed":
        frappe.throw("QC and CIAG can only be updated when execution status is Completed.")

    # Keep achieved amount server-driven from achieved qty * billing rate.
    if hasattr(doc, "achieved_qty") and hasattr(doc, "achieved_amount"):
        if "achieved_qty" in payload or "achieved_amount" not in payload:
            rate = _get_rollout_billing_rate(doc.rollout_plan)
            doc.achieved_amount = flt(doc.achieved_qty or 0) * flt(rate)

    if payload.get("activity_code") and hasattr(doc, "activity_code"):
        doc.activity_code = payload["activity_code"]
        if hasattr(doc, "activity_cost_sar"):
            acm_cost = frappe.db.get_value(
                "Activity Cost Master", payload["activity_code"], "base_cost_sar"
            )
            doc.activity_cost_sar = flt(acm_cost or 0)

    if doc.is_new():
        doc.insert(ignore_permissions=True)
    else:
        doc.save(ignore_permissions=True)

    _sync_rollout_plan_from_daily_execution(doc.rollout_plan, doc)
    qc = str(getattr(doc, "qc_status", None) or "")

    # Stage 6: QC fail should return work to planning and create a new revisit plan.
    if (doc.execution_status == "Completed") and (qc == "Fail") and doc.rollout_plan:
        reopen_rollout_for_revisit(
            doc.rollout_plan,
            issue_category=(payload.get("issue_category") or "QC Rejection"),
            planning_route="with_issue",
        )

    frappe.db.commit()
    return {"name": doc.name, "status": doc.execution_status}


@frappe.whitelist()
def generate_work_done(execution_name):
    """
    Create a Work Done record from a completed Daily Execution.

    Returns
    -------
    {"name": ...}
    """
    roles = set(frappe.get_roles(frappe.session.user))
    if not (
        "Administrator" in roles
        or "System Manager" in roles
        or "INET Admin" in roles
        or "INET IM" in roles
    ):
        frappe.throw(
            "Only an Implementation Manager or administrator can create Work Done.",
            frappe.PermissionError,
        )

    exec_doc = frappe.get_doc("Daily Execution", execution_name)

    if exec_doc.execution_status != "Completed":
        frappe.throw(
            f"Execution {execution_name} is not Completed (status: {exec_doc.execution_status})."
        )

    qc = str(getattr(exec_doc, "qc_status", None) or "")
    if qc != "Pass":
        frappe.throw("QC must be Pass before creating Work Done.")

    # Check if Work Done already exists
    existing = frappe.db.get_value("Work Done", {"execution": execution_name}, "name")
    if existing:
        frappe.throw(f"Work Done already exists for execution {execution_name}: {existing}")

    # Trace back chain: execution → rollout_plan → po_dispatch
    rp_name = exec_doc.rollout_plan
    rp = frappe.db.get_value(
        "Rollout Plan", rp_name, ["po_dispatch", "visit_multiplier", "team"], as_dict=True
    )
    if not rp:
        frappe.throw(f"Rollout Plan {rp_name} not found.")

    dispatch_name = rp.po_dispatch
    dispatch = frappe.db.get_value(
        "PO Dispatch",
        dispatch_name,
        ["item_code", "center_area", "region_type", "project_code", "customer"],
        as_dict=True,
    )
    if not dispatch:
        frappe.throw(f"PO Dispatch {dispatch_name} not found.")

    item_code = dispatch.item_code
    center_area = dispatch.center_area or ""
    team_id = rp.team

    # Determine billing_rate from Customer Item Master
    is_hard = is_hard_region(dispatch.region_type, center_area)
    billing_rate = 0.0
    cim_filters = {"item_code": item_code, "active_flag": 1}
    if dispatch.customer:
        cim_filters["customer"] = dispatch.customer
    cim = frappe.db.get_value(
        "Customer Item Master",
        cim_filters,
        ["standard_rate_sar", "hard_rate_sar"],
        as_dict=True,
    )
    if not cim:
        cim = frappe.db.get_value(
            "Customer Item Master",
            {"item_code": item_code, "active_flag": 1},
            ["standard_rate_sar", "hard_rate_sar"],
            as_dict=True,
        )
    if cim:
        billing_rate = flt(cim.hard_rate_sar if is_hard else cim.standard_rate_sar)

    executed_qty = flt(exec_doc.achieved_qty or 0)
    revenue = billing_rate * executed_qty

    # Team cost from INET Team
    team_cost = 0.0
    team_type = None
    subcontractor = None
    if team_id:
        team_info = frappe.db.get_value(
            "INET Team",
            team_id,
            ["daily_cost", "team_type", "subcontractor", "daily_cost_applies"],
            as_dict=True,
        )
        if team_info:
            team_type = team_info.team_type
            subcontractor = team_info.subcontractor
            if team_info.daily_cost_applies:
                team_cost = flt(team_info.daily_cost)

    # Subcontract cost (only for SUB teams)
    subcontract_cost = 0.0
    inet_margin_pct = 0.0
    if team_type == "SUB" and subcontractor:
        scc = frappe.db.get_value(
            "Subcontract Cost Master",
            {"subcontractor": subcontractor, "active_flag": 1},
            "expected_cost_sar",
            as_dict=False,
        )
        subcontract_cost = flt(scc or 0)

        # INET margin % from Subcontractor Master
        margin_pct = frappe.db.get_value(
            "Subcontractor Master", subcontractor, "inet_margin_pct"
        )
        inet_margin_pct = flt(margin_pct or 0)

    # Activity cost from Activity Cost Master (linked via execution)
    activity_cost = 0.0
    if getattr(exec_doc, "activity_code", None):
        acm_cost = frappe.db.get_value(
            "Activity Cost Master", exec_doc.activity_code, "base_cost_sar"
        )
        activity_cost = flt(acm_cost or 0)

    visit_multiplier = flt(rp.visit_multiplier or 1.0)
    subcontract_cost = subcontract_cost * visit_multiplier
    total_cost = team_cost + subcontract_cost + activity_cost
    margin = revenue - total_cost

    wd = frappe.new_doc("Work Done")
    wd.execution = execution_name
    wd.system_id = exec_doc.system_id
    wd.region_type = dispatch.get("region_type") or region_type_from_center_area(center_area)
    wd.item_code = item_code
    wd.executed_qty = executed_qty
    wd.billing_rate_sar = billing_rate
    wd.revenue_sar = revenue
    wd.team_cost_sar = team_cost
    wd.subcontract_cost_sar = subcontract_cost
    wd.activity_cost_sar = activity_cost
    wd.total_cost_sar = total_cost
    wd.margin_sar = margin
    wd.inet_margin_pct = inet_margin_pct
    wd.billing_status = "Pending"

    wd.insert(ignore_permissions=True)
    frappe.db.commit()

    return {"name": wd.name}


def _ensure_work_done_for_execution(execution_name):
    if not execution_name:
        return None
    existing = frappe.db.get_value("Work Done", {"execution": execution_name}, "name")
    if existing:
        return existing
    exec_status = frappe.db.get_value("Daily Execution", execution_name, "execution_status")
    if exec_status != "Completed":
        return None
    try:
        result = generate_work_done(execution_name)
        return result.get("name")
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Admin list APIs — Execution monitor / Work Done
# ---------------------------------------------------------------------------


@frappe.whitelist()
def list_execution_monitor_rows(filters=None):
    """
    Rich rows for PM Execution Monitor (Rollout + latest execution + dispatch context).

    filters:
      {
        "status": "Planned|In Execution|Completed|Cancelled|Planning with Issue",
        "visit_type": "...",
        "team": "...",
        "from_date": "YYYY-MM-DD",
        "to_date": "YYYY-MM-DD",
      }
    """
    if isinstance(filters, str):
        filters = frappe.parse_json(filters)
    filters = filters or {}

    rp_filters = {}
    if filters.get("status"):
        rp_filters["plan_status"] = filters["status"]
    if filters.get("visit_type"):
        rp_filters["visit_type"] = filters["visit_type"]
    if filters.get("team"):
        rp_filters["team"] = filters["team"]
    if filters.get("from_date") and filters.get("to_date"):
        rp_filters["plan_date"] = ["between", [filters["from_date"], filters["to_date"]]]
    elif filters.get("from_date"):
        rp_filters["plan_date"] = [">=", filters["from_date"]]
    elif filters.get("to_date"):
        rp_filters["plan_date"] = ["<=", filters["to_date"]]

    rp_fields = [
        "name",
        "po_dispatch",
        "team",
        "plan_date",
        "visit_type",
        "target_amount",
        "achieved_amount",
        "completion_pct",
        "plan_status",
        "modified",
    ]
    if frappe.db.has_column("Rollout Plan", "region_type"):
        rp_fields.append("region_type")
    plans = frappe.get_all(
        "Rollout Plan",
        filters=rp_filters,
        fields=rp_fields,
        order_by="modified desc",
        limit_page_length=500,
    )
    if not plans:
        return []

    plan_names = [p.name for p in plans]
    dispatch_names = [p.po_dispatch for p in plans if p.po_dispatch]

    execution_rows = frappe.get_all(
        "Daily Execution",
        filters={"rollout_plan": ["in", plan_names]},
        fields=[
            "name",
            "rollout_plan",
            "execution_date",
            "execution_status",
            "achieved_qty",
            "achieved_amount",
            "qc_status",
            "ciag_status",
            "photos",
            "gps_location",
            "modified",
        ],
        order_by="modified desc",
        limit_page_length=2000,
    )
    latest_exec_by_plan = {}
    for ex in execution_rows:
        if ex.rollout_plan not in latest_exec_by_plan:
            latest_exec_by_plan[ex.rollout_plan] = ex

    dispatch_map = {}
    if dispatch_names:
        d_fields = [
            "name", "po_no", "item_code", "item_description", "project_code", "site_name", "site_code",
        ]
        if frappe.db.has_column("PO Dispatch", "center_area"):
            d_fields.append("center_area")
        if frappe.db.has_column("PO Dispatch", "region_type"):
            d_fields.append("region_type")
        if frappe.db.has_column("PO Dispatch", "original_dummy_poid"):
            d_fields.append("original_dummy_poid")
        drows = frappe.get_all(
            "PO Dispatch",
            filters={"name": ["in", dispatch_names]},
            fields=d_fields,
            limit_page_length=1000,
        )
        dispatch_map = {d.name: d for d in drows}

    out = []
    for p in plans:
        ex = latest_exec_by_plan.get(p.name)
        d = dispatch_map.get(p.po_dispatch) if p.po_dispatch else None
        out.append(
            {
                "name": p.name,
                "system_id": p.po_dispatch or p.name,
                "po_dispatch": p.po_dispatch,
                "po_no": d.po_no if d else None,
                "item_code": d.item_code if d else None,
                "item_description": d.item_description if d else None,
                "project_code": d.project_code if d else None,
                "site_name": d.site_name if d else None,
                "site_code": d.site_code if d else None,
                "center_area": (d.get("center_area") if d else None),
                "region_type": (p.get("region_type") or (d.get("region_type") if d else None)),
                "team": p.team,
                "plan_date": p.plan_date,
                "visit_type": p.visit_type,
                "target_amount": flt(p.target_amount or 0),
                "achieved_amount": flt(p.achieved_amount or 0),
                "completion_pct": flt(p.completion_pct or 0),
                "plan_status": p.plan_status,
                "execution_name": ex.name if ex else None,
                "execution_date": ex.execution_date if ex else None,
                "execution_status": ex.execution_status if ex else None,
                "execution_achieved_qty": flt(ex.achieved_qty or 0) if ex else 0,
                "execution_achieved_amount": flt(ex.achieved_amount or 0) if ex else 0,
                "qc_status": ex.qc_status if ex else None,
                "ciag_status": ex.ciag_status if ex else None,
                "photos": ex.photos if ex else None,
                "gps_location": ex.gps_location if ex else None,
                "modified": p.modified,
                "original_dummy_poid": (
                    (d.get("original_dummy_poid") or "").strip()
                    if d and frappe.db.has_column("PO Dispatch", "original_dummy_poid")
                    else None
                ),
            }
        )
    return out


@frappe.whitelist()
def list_work_done_rows(filters=None):
    """
    Rich Work Done rows for PM page.
    filters: { billing_status, from_date, to_date, team, project_code, im }
    """
    if isinstance(filters, str):
        filters = frappe.parse_json(filters)
    filters = filters or {}

    wd_filters = {}
    if filters.get("billing_status"):
        wd_filters["billing_status"] = filters["billing_status"]

    wd_fields = [
        "name",
        "execution",
        "system_id",
        "item_code",
        "executed_qty",
        "billing_rate_sar",
        "revenue_sar",
        "team_cost_sar",
        "subcontract_cost_sar",
        "total_cost_sar",
        "margin_sar",
        "billing_status",
        "modified",
    ]
    if frappe.db.has_column("Work Done", "region_type"):
        wd_fields.append("region_type")
    rows = frappe.get_all(
        "Work Done",
        filters=wd_filters,
        fields=wd_fields,
        order_by="modified desc",
        limit_page_length=500,
    )
    if not rows:
        return []

    exec_names = [r.execution for r in rows if r.execution]
    ex_map = {}
    if exec_names:
        ex_rows = frappe.get_all(
            "Daily Execution",
            filters={"name": ["in", exec_names]},
            fields=["name", "rollout_plan", "execution_date", "execution_status", "team"],
            limit_page_length=1000,
        )
        ex_map = {e.name: e for e in ex_rows}

    plan_names = [e.rollout_plan for e in ex_map.values() if e.rollout_plan]
    rp_map = {}
    if plan_names:
        rp_fields_wd = ["name", "po_dispatch", "plan_date", "visit_type", "team"]
        if frappe.db.has_column("Rollout Plan", "region_type"):
            rp_fields_wd.append("region_type")
        rp_rows = frappe.get_all(
            "Rollout Plan",
            filters={"name": ["in", plan_names]},
            fields=rp_fields_wd,
            limit_page_length=1000,
        )
        rp_map = {r.name: r for r in rp_rows}

    dispatch_names = [r.po_dispatch for r in rp_map.values() if r.po_dispatch]
    pd_map = {}
    if dispatch_names:
        pd_fields_wd = ["name", "po_no", "project_code", "site_name", "site_code", "item_description", "im"]
        if frappe.db.has_column("PO Dispatch", "center_area"):
            pd_fields_wd.append("center_area")
        if frappe.db.has_column("PO Dispatch", "region_type"):
            pd_fields_wd.append("region_type")
        if frappe.db.has_column("PO Dispatch", "original_dummy_poid"):
            pd_fields_wd.append("original_dummy_poid")
        pd_rows = frappe.get_all(
            "PO Dispatch",
            filters={"name": ["in", dispatch_names]},
            fields=pd_fields_wd,
            limit_page_length=1000,
        )
        pd_map = {p.name: p for p in pd_rows}

    out = []
    for r in rows:
        ex = ex_map.get(r.execution)
        rp = rp_map.get(ex.rollout_plan) if ex and ex.rollout_plan else None
        pd = pd_map.get(rp.po_dispatch) if rp and rp.po_dispatch else None
        team = (rp.team if rp else None) or (ex.team if ex else None)
        project_code = pd.project_code if pd else None
        if filters.get("team") and team != filters["team"]:
            continue
        if filters.get("project_code") and project_code != filters["project_code"]:
            continue
        if filters.get("im"):
            pd_im = (pd.im if pd and hasattr(pd, "im") else None)
            if (pd_im or "") != (filters.get("im") or ""):
                continue
        ex_date = ex.execution_date if ex else None
        if filters.get("from_date") and ex_date and str(ex_date) < str(filters["from_date"]):
            continue
        if filters.get("to_date") and ex_date and str(ex_date) > str(filters["to_date"]):
            continue
        out.append(
            {
                **r,
                "po_dispatch": rp.po_dispatch if rp else None,
                "po_no": pd.po_no if pd else None,
                "project_code": project_code,
                "site_name": pd.site_name if pd else None,
                "site_code": pd.site_code if pd else None,
                "center_area": pd.get("center_area") if pd else None,
                "region_type": r.get("region_type")
                or (rp.get("region_type") if rp else None)
                or (pd.get("region_type") if pd else None),
                "team": team,
                "item_description": pd.item_description if pd else None,
                "execution_date": ex_date,
                "execution_status": ex.execution_status if ex else None,
                "plan_date": rp.plan_date if rp else None,
                "visit_type": rp.visit_type if rp else None,
                "original_dummy_poid": (
                    (pd.get("original_dummy_poid") or "").strip()
                    if pd and frappe.db.has_column("PO Dispatch", "original_dummy_poid")
                    else None
                ),
            }
        )
    return out


@frappe.whitelist()
def list_issue_risk_rows(im=None):
    """
    Issue & Risk rows from rollout plans that are in issue state or carry an issue category.
    - Admin roles can view all rows (or filter by im argument).
    - IM role is restricted to its own dispatches.
    """
    user = frappe.session.user
    roles = set(frappe.get_roles(user))

    is_admin = (
        "Administrator" in roles
        or "System Manager" in roles
        or "INET Admin" in roles
    )
    is_im = "INET IM" in roles
    if not (is_admin or is_im):
        frappe.throw("Not permitted", frappe.PermissionError)

    im_filter_value = (im or "").strip()
    if is_im:
        im_filter_value, _, _ = resolve_im_for_session(im_filter_value)
        if not im_filter_value:
            return []

    rows = frappe.db.sql(
        """
        SELECT
            rp.name AS rollout_plan,
            rp.po_dispatch,
            rp.plan_status,
            rp.issue_category,
            rp.plan_date,
            rp.visit_type,
            rp.team,
            rp.modified,
            pd.im,
            pd.po_no,
            pd.project_code,
            pd.site_code,
            pd.site_name,
            pd.center_area,
            pd.region_type,
            de.name AS execution_name,
            de.execution_status,
            de.qc_status,
            de.ciag_status
        FROM `tabRollout Plan` rp
        LEFT JOIN `tabPO Dispatch` pd ON pd.name = rp.po_dispatch
        LEFT JOIN `tabDaily Execution` de ON de.rollout_plan = rp.name
        WHERE rp.plan_status = 'Planning with Issue'
        ORDER BY rp.modified DESC
        LIMIT 1000
        """,
        as_dict=True,
    )

    out = []
    seen_plans = set()
    for r in rows or []:
        rp_name = r.get("rollout_plan")
        if not rp_name or rp_name in seen_plans:
            continue
        if im_filter_value and (r.get("im") or "") != im_filter_value:
            continue
        seen_plans.add(rp_name)
        out.append(
            {
                "rollout_plan": rp_name,
                "po_dispatch": r.get("po_dispatch"),
                "plan_status": r.get("plan_status"),
                "issue_category": r.get("issue_category"),
                "plan_date": r.get("plan_date"),
                "visit_type": r.get("visit_type"),
                "team": r.get("team"),
                "im": r.get("im"),
                "po_no": r.get("po_no"),
                "project_code": r.get("project_code"),
                "site_code": r.get("site_code"),
                "site_name": r.get("site_name"),
                "center_area": r.get("center_area"),
                "region_type": r.get("region_type"),
                "execution_name": r.get("execution_name"),
                "execution_status": r.get("execution_status"),
                "qc_status": r.get("qc_status"),
                "ciag_status": r.get("ciag_status"),
                "modified": r.get("modified"),
            }
        )
    return out


# ---------------------------------------------------------------------------
# Task 13 — Dashboard Aggregation
# ---------------------------------------------------------------------------


def _month_bounds():
    """Return (first_day_str, last_day_str, today_str) for current month."""
    today = getdate(nowdate())
    first = get_first_day(today)
    last = get_last_day(today)
    return str(first), str(last), str(today)


def _days_in_month(today=None):
    today = getdate(today or nowdate())
    return calendar.monthrange(today.year, today.month)[1]


@frappe.whitelist()
def get_command_dashboard():
    """
    Return ALL data for the admin Command Dashboard in a single API call.
    """
    today_str = nowdate()
    today = getdate(today_str)
    first_day, last_day, _ = _month_bounds()
    days_in_month = _days_in_month(today)
    day_of_month = today.day

    # ---- Operational KPIs --------------------------------------------------
    open_po_result = frappe.db.sql(
        """
        SELECT COALESCE(SUM(line_amount), 0) AS total
        FROM `tabPO Dispatch`
        WHERE dispatch_status NOT IN ('Completed', 'Cancelled')
        """,
        as_dict=True,
    )
    total_open_po = flt(open_po_result[0].total if open_po_result else 0)

    # Teams with at least one execution today
    active_team_rows = frappe.db.sql(
        """
        SELECT DISTINCT team FROM `tabDaily Execution`
        WHERE execution_date = %s
        AND execution_status NOT IN ('Cancelled')
        """,
        (today_str,),
        as_dict=True,
    )
    active_teams_count = len(active_team_rows)
    active_team_ids = {r.team for r in active_team_rows}

    total_teams = frappe.db.count("INET Team", {"status": "Active"})
    idle_teams_count = max(0, total_teams - active_teams_count)

    planned_activities = frappe.db.count("Rollout Plan", {"plan_status": "Planned"})

    closed_activities = frappe.db.sql(
        """
        SELECT COUNT(*) AS cnt FROM `tabDaily Execution`
        WHERE execution_status = 'Completed'
        AND execution_date BETWEEN %s AND %s
        """,
        (first_day, last_day),
        as_dict=True,
    )[0].cnt or 0

    revisits = frappe.db.sql(
        """
        SELECT COUNT(*) AS cnt FROM `tabRollout Plan`
        WHERE visit_type = 'Re-Visit'
        AND plan_date BETWEEN %s AND %s
        """,
        (first_day, last_day),
        as_dict=True,
    )[0].cnt or 0

    # ---- INET KPIs ---------------------------------------------------------
    inet_teams = frappe.get_all(
        "INET Team",
        filters={"team_type": "INET", "status": "Active"},
        fields=["name", "team_id", "daily_cost", "im"],
    )
    active_inet_teams = len(inet_teams)

    inet_monthly_cost = sum(flt(t.daily_cost) * 26 for t in inet_teams)

    # Monthly target from Project Control Center
    pcc_targets = frappe.db.sql(
        "SELECT COALESCE(SUM(monthly_target), 0) AS total FROM `tabProject Control Center` WHERE active_flag = 'Yes'",
        as_dict=True,
    )
    inet_monthly_target = flt(pcc_targets[0].total if pcc_targets else 0)

    inet_target_today = (
        (inet_monthly_target * day_of_month) / days_in_month if days_in_month else 0.0
    )

    inet_achieved_rows = frappe.db.sql(
        """
        SELECT COALESCE(SUM(wd.revenue_sar), 0) AS total
        FROM `tabWork Done` wd
        JOIN `tabDaily Execution` exe ON exe.name = wd.execution
        JOIN `tabINET Team` it ON it.name = exe.team
        WHERE it.team_type = 'INET'
        AND exe.execution_date BETWEEN %s AND %s
        """,
        (first_day, last_day),
        as_dict=True,
    )
    inet_achieved = flt(inet_achieved_rows[0].total if inet_achieved_rows else 0)
    inet_gap_today = inet_target_today - inet_achieved

    # ---- Subcontractor KPIs ------------------------------------------------
    sub_teams = frappe.get_all(
        "INET Team",
        filters={"team_type": "SUB", "status": "Active"},
        fields=["name", "team_id"],
    )
    active_sub_teams = len(sub_teams)
    # Real MTD target: sum of rollout plan target_amount for active SUB teams this month
    sub_target = 0.0
    if sub_teams:
        sub_names = [t.name for t in sub_teams]
        sub_ph = ", ".join(["%s"] * len(sub_names))
        sub_tgt_rows = frappe.db.sql(
            f"""
            SELECT COALESCE(SUM(rp.target_amount), 0) AS total
            FROM `tabRollout Plan` rp
            WHERE rp.team IN ({sub_ph})
            AND rp.plan_date BETWEEN %s AND %s
            """,
            tuple(sub_names) + (first_day, last_day),
            as_dict=True,
        )
        sub_target = flt(sub_tgt_rows[0].total if sub_tgt_rows else 0)

    sub_revenue_rows = frappe.db.sql(
        """
        SELECT COALESCE(SUM(wd.revenue_sar), 0) AS rev,
               COALESCE(SUM(wd.total_cost_sar), 0) AS cost,
               COALESCE(AVG(wd.inet_margin_pct), 0) AS avg_margin
        FROM `tabWork Done` wd
        JOIN `tabDaily Execution` exe ON exe.name = wd.execution
        JOIN `tabINET Team` it ON it.name = exe.team
        WHERE it.team_type = 'SUB'
        AND exe.execution_date BETWEEN %s AND %s
        """,
        (first_day, last_day),
        as_dict=True,
    )
    sub_revenue = flt(sub_revenue_rows[0].rev if sub_revenue_rows else 0)
    sub_expense = flt(sub_revenue_rows[0].cost if sub_revenue_rows else 0)
    avg_margin_pct = flt(sub_revenue_rows[0].avg_margin if sub_revenue_rows else 0)
    inet_margin_sub = sub_revenue * (avg_margin_pct / 100.0)
    sub_gap = sub_target - sub_revenue

    # ---- Company-level KPIs ------------------------------------------------
    company_target = inet_monthly_target + sub_target
    total_achieved = inet_achieved + sub_revenue
    total_cost = inet_monthly_cost + sub_expense
    company_gap = company_target - total_achieved
    profit_loss = total_achieved - total_cost
    coverage_pct = (total_achieved / company_target * 100.0) if company_target else 0.0

    # ---- Top 5 teams by revenue this month ---------------------------------
    top_teams = frappe.db.sql(
        """
        SELECT exe.team AS team, COALESCE(SUM(wd.revenue_sar), 0) AS revenue
        FROM `tabWork Done` wd
        JOIN `tabDaily Execution` exe ON exe.name = wd.execution
        WHERE exe.execution_date BETWEEN %s AND %s
        AND exe.team IS NOT NULL AND exe.team != ''
        GROUP BY exe.team
        ORDER BY revenue DESC
        LIMIT 5
        """,
        (first_day, last_day),
        as_dict=True,
    )
    team_rollout_targets = frappe.db.sql(
        """
        SELECT team AS team, COALESCE(SUM(target_amount), 0) AS target
        FROM `tabRollout Plan`
        WHERE plan_date BETWEEN %s AND %s
        AND team IS NOT NULL AND team != ''
        GROUP BY team
        """,
        (first_day, last_day),
        as_dict=True,
    )
    target_by_team = {r.team: flt(r.target) for r in (team_rollout_targets or [])}
    for _row in top_teams:
        tid = _row.get("team")
        _row["team_name"] = frappe.db.get_value("INET Team", tid, "team_name") or tid or "—"
        _row["achieved"] = flt(_row.get("revenue", 0))
        _row["target"] = target_by_team.get(tid, 0.0)

    # ---- IM performance ----------------------------------------------------
    im_perf = frappe.db.sql(
        """
        SELECT pd.im AS im,
               COUNT(DISTINCT exe.team) AS team_count,
               COALESCE(SUM(wd.revenue_sar), 0) AS revenue,
               COALESCE(SUM(wd.total_cost_sar), 0) AS cost
        FROM `tabWork Done` wd
        JOIN `tabDaily Execution` exe ON exe.name = wd.execution
        JOIN `tabRollout Plan` rp ON rp.name = exe.rollout_plan
        JOIN `tabPO Dispatch` pd ON pd.name = rp.po_dispatch
        WHERE exe.execution_date BETWEEN %s AND %s
        AND pd.im IS NOT NULL AND pd.im != ''
        GROUP BY pd.im
        """,
        (first_day, last_day),
        as_dict=True,
    )
    for row in im_perf:
        row["profit"] = flt(row.revenue) - flt(row.cost)
        row["teams"] = cint(row.get("team_count") or 0)
        row["team_cost"] = flt(row.get("cost") or 0)

    # ---- Team status summary -----------------------------------------------
    in_progress_count = frappe.db.sql(
        """
        SELECT COUNT(DISTINCT team) AS cnt FROM `tabDaily Execution`
        WHERE execution_date = %s AND execution_status = 'In Progress'
        """,
        (today_str,),
        as_dict=True,
    )[0].cnt or 0

    planned_today = frappe.db.sql(
        """
        SELECT COUNT(DISTINCT team) AS cnt FROM `tabRollout Plan`
        WHERE plan_date = %s AND plan_status = 'Planned'
        """,
        (today_str,),
        as_dict=True,
    )[0].cnt or 0

    team_status = {
        "active": active_teams_count,
        "idle": idle_teams_count,
        "planned": planned_today,
        "in_progress": in_progress_count,
    }

    # ---- Watchlist (action items) — shape matches CommandDashboard.jsx ------
    watchlist = []
    issue_rows = frappe.db.sql(
        """
        SELECT COALESCE(rp.issue_category, 'Uncategorized') AS issue_category, COUNT(*) AS cnt
        FROM `tabDaily Execution` de
        JOIN `tabRollout Plan` rp ON rp.name = de.rollout_plan
        WHERE de.qc_status = 'Fail'
        AND de.execution_date BETWEEN %s AND %s
        GROUP BY COALESCE(rp.issue_category, 'Uncategorized')
        ORDER BY cnt DESC
        LIMIT 5
        """,
        (first_day, last_day),
        as_dict=True,
    )
    for row in issue_rows:
        cnt = cint(row.cnt)
        watchlist.append(
            {
                "indicator": f"QC open issues — {row.issue_category}",
                "current": cnt,
                "target": None,
                "status": "Recover",
            }
        )

    if idle_teams_count > 0:
        watchlist.append(
            {
                "indicator": "Idle teams today",
                "current": idle_teams_count,
                "target": None,
                "status": "Behind",
            }
        )
    if inet_gap_today > 0:
        watchlist.append(
            {
                "indicator": "INET revenue gap (month-to-date vs prorated target)",
                "current": inet_gap_today,
                "target": None,
                "status": "Recover",
            }
        )
    if sub_gap > 0:
        watchlist.append(
            {
                "indicator": "Subcontractor revenue gap",
                "current": sub_gap,
                "target": None,
                "status": "Recover",
            }
        )
    if not watchlist:
        watchlist.append(
            {
                "indicator": "Operational health",
                "current": 0,
                "target": None,
                "status": "Optimized",
            }
        )

    return {
        "operational": {
            "total_open_po": total_open_po,
            "active_teams": active_teams_count,
            "idle_teams": idle_teams_count,
            "planned_activities": planned_activities,
            "closed_activities": closed_activities,
            "revisits": revisits,
        },
        "inet": {
            "active_inet_teams": active_inet_teams,
            "inet_monthly_cost": inet_monthly_cost,
            "inet_monthly_target": inet_monthly_target,
            "inet_target_today": inet_target_today,
            "inet_achieved": inet_achieved,
            "inet_gap_today": inet_gap_today,
        },
        "subcon": {
            "active_sub_teams": active_sub_teams,
            "sub_target": sub_target,
            "sub_revenue": sub_revenue,
            "sub_expense": sub_expense,
            "inet_margin_sub": inet_margin_sub,
            "sub_gap": sub_gap,
        },
        "company": {
            "company_target": company_target,
            "total_achieved": total_achieved,
            "company_gap": company_gap,
            "total_cost": total_cost,
            "profit_loss": profit_loss,
            "coverage_pct": coverage_pct,
        },
        "top_teams": top_teams,
        "im_performance": im_perf,
        "team_status": team_status,
        "watchlist": watchlist,
        "last_updated": frappe.utils.now(),
    }


def resolve_im_for_session(im=None):
    """
    Resolve IM Master document name + all identifier strings usable in PO Dispatch.im
    and similar Link fields. Shared by IM dashboard, pipeline lists, and overview APIs.
    """
    session_user = frappe.session.user
    user_full_name = frappe.db.get_value("User", session_user, "full_name") or ""
    im_rec = None

    def _find_im_rec(filters):
        if not frappe.db.exists("DocType", "IM Master"):
            return None
        try:
            rows = frappe.get_all(
                "IM Master", filters=filters,
                fields=["name", "full_name", "email"], limit=1,
                ignore_permissions=True,
            )
            return rows[0] if rows else None
        except Exception:
            return None

    if im and frappe.db.exists("IM Master", im):
        im_rec = _find_im_rec({"name": im})
    if not im_rec and im:
        im_rec = _find_im_rec({"full_name": im})
    if not im_rec and im:
        im_rec = _find_im_rec({"email": im})
    if not im_rec:
        im_rec = _find_im_rec({"user": session_user})
    if not im_rec and user_full_name:
        im_rec = _find_im_rec({"full_name": user_full_name})

    if im_rec:
        im_identifiers = list({
            v for v in [im_rec.name, im_rec.full_name, im_rec.email, im, user_full_name]
            if v
        })
        im_resolved = im_rec.name
    else:
        im_resolved = im or user_full_name or None
        im_identifiers = list({v for v in [im, user_full_name] if v})

    if not im_identifiers:
        return None, [], {}
    return im_resolved, im_identifiers, {"session_user": session_user, "user_full_name": user_full_name}


def im_action_counts(im_identifiers):
    """Counts for IM dashboard action strip (PM→IM→execution workflow)."""
    if not im_identifiers:
        return {"pending_plan_dispatches": 0, "qc_fail_needs_action": 0, "planned_ready_execution": 0}
    ph = ", ".join(["%s"] * len(im_identifiers))
    params = tuple(im_identifiers)
    pending = frappe.db.sql(
        f"""
        SELECT COUNT(*) AS c FROM `tabPO Dispatch`
        WHERE im IN ({ph}) AND dispatch_status = 'Dispatched'
        """,
        params,
        as_dict=True,
    )[0].c
    qc_open = frappe.db.sql(
        f"""
        SELECT COUNT(*) AS c FROM `tabDaily Execution` de
        INNER JOIN `tabRollout Plan` rp ON rp.name = de.rollout_plan
        INNER JOIN `tabPO Dispatch` pd ON pd.name = rp.po_dispatch
        WHERE pd.im IN ({ph}) AND de.qc_status = 'Fail'
        AND de.execution_status NOT IN ('Cancelled')
        """,
        params,
        as_dict=True,
    )[0].c
    planned_exec = frappe.db.sql(
        f"""
        SELECT COUNT(*) AS c FROM `tabRollout Plan` rp
        INNER JOIN `tabPO Dispatch` pd ON pd.name = rp.po_dispatch
        WHERE pd.im IN ({ph}) AND rp.plan_status = 'Planned'
        """,
        params,
        as_dict=True,
    )[0].c
    return {
        "pending_plan_dispatches": cint(pending),
        "qc_fail_needs_action": cint(qc_open),
        "planned_ready_execution": cint(planned_exec),
    }


@frappe.whitelist()
def list_im_rollout_plans(im=None, plan_status=None):
    """Rollout plans for this IM (join PO Dispatch — works before im backfill on Rollout Plan)."""
    im_resolved, im_identifiers, _ = resolve_im_for_session(im)
    if not im_identifiers:
        return []
    ph = ", ".join(["%s"] * len(im_identifiers))
    params = list(im_identifiers)
    status_clause = ""
    if plan_status:
        status_clause = " AND rp.plan_status = %s"
        params.append(plan_status)
    im_plan_extras = []
    if frappe.db.has_column("Rollout Plan", "region_type"):
        im_plan_extras.append("rp.region_type AS region_type")
    else:
        im_plan_extras.append("NULL AS region_type")
    if frappe.db.has_column("PO Dispatch", "center_area"):
        im_plan_extras.append("pd.center_area AS center_area")
    else:
        im_plan_extras.append("NULL AS center_area")
    im_plan_extra_sql = ", " + ", ".join(im_plan_extras)
    rows = frappe.db.sql(
        f"""
        SELECT rp.name, rp.po_dispatch AS system_id, rp.po_dispatch, rp.team, rp.plan_date, rp.visit_type,
               rp.visit_number, rp.visit_multiplier, rp.target_amount, rp.achieved_amount,
               rp.completion_pct, rp.plan_status,
               pd.im AS dispatch_im, pd.site_code, pd.po_no, pd.project_code, pd.item_code
               {im_plan_extra_sql}
        FROM `tabRollout Plan` rp
        INNER JOIN `tabPO Dispatch` pd ON pd.name = rp.po_dispatch
        WHERE pd.im IN ({ph}){status_clause}
        ORDER BY rp.plan_date DESC, rp.modified DESC
        LIMIT 500
        """,
        tuple(params),
        as_dict=True,
    )
    return rows or []


@frappe.whitelist()
def list_im_daily_executions(im=None, execution_status=None):
    """Daily executions for this IM's dispatches."""
    im_resolved, im_identifiers, _ = resolve_im_for_session(im)
    if not im_identifiers:
        return []
    ph = ", ".join(["%s"] * len(im_identifiers))
    params = list(im_identifiers)
    status_clause = ""
    if execution_status:
        status_clause = " AND de.execution_status = %s"
        params.append(_normalize_execution_status(execution_status))
    ciag_sel = "de.ciag_status" if frappe.db.has_column("Daily Execution", "ciag_status") else "NULL"
    im_ex_extras = []
    if frappe.db.has_column("Daily Execution", "region_type"):
        im_ex_extras.append("de.region_type AS region_type")
    else:
        im_ex_extras.append("NULL AS region_type")
    if frappe.db.has_column("PO Dispatch", "center_area"):
        im_ex_extras.append("pd.center_area AS center_area")
    else:
        im_ex_extras.append("NULL AS center_area")
    if frappe.db.has_column("PO Dispatch", "original_dummy_poid"):
        im_ex_extras.append("pd.original_dummy_poid AS original_dummy_poid")
    else:
        im_ex_extras.append("NULL AS original_dummy_poid")
    im_ex_extra_sql = ", " + ", ".join(im_ex_extras)
    rows = frappe.db.sql(
        f"""
        SELECT de.name, rp.po_dispatch AS system_id, de.rollout_plan, de.team, de.execution_date,
               de.execution_status, de.achieved_qty, de.achieved_amount, de.gps_location,
               de.qc_status, {ciag_sel} AS ciag_status, de.revisit_flag, de.photos,
               pd.im AS dispatch_im, pd.site_code, pd.site_name, pd.po_no, pd.project_code, pd.item_code, pd.item_description,
               (SELECT wd.name FROM `tabWork Done` wd WHERE wd.execution = de.name LIMIT 1) AS work_done
               {im_ex_extra_sql}
        FROM `tabDaily Execution` de
        INNER JOIN `tabRollout Plan` rp ON rp.name = de.rollout_plan
        INNER JOIN `tabPO Dispatch` pd ON pd.name = rp.po_dispatch
        WHERE pd.im IN ({ph}){status_clause}
        ORDER BY de.execution_date DESC, de.modified DESC
        LIMIT 500
        """,
        tuple(params),
        as_dict=True,
    )
    return rows or []


@frappe.whitelist()
def get_duid_overview(duid=None, po_no=None):
    """
    DUID-wise (site_code) rollout view: PO line, plans, executions.
    Optional po_no narrows dispatch rows. Expenses / acceptance: placeholders for Phase 2.

    PM / desk admin only — not for INET IM / field roles.
    """
    user = frappe.session.user
    if not user or user == "Guest":
        frappe.throw("Not permitted", frappe.PermissionError)
    roles = set(frappe.get_roles(user))
    if not (
        "Administrator" in roles
        or "System Manager" in roles
        or "INET Admin" in roles
    ):
        frappe.throw("Not permitted", frappe.PermissionError)

    duid = (duid or "").strip()
    po_no = (po_no or "").strip()
    if not duid and not po_no:
        frappe.throw("Provide duid (site / DUID) and/or po_no")

    dfilters = {}
    if duid:
        dfilters["site_code"] = duid
    if po_no:
        dfilters["po_no"] = po_no

    dispatches = frappe.get_all(
        "PO Dispatch",
        filters=dfilters,
        fields=["*"],
        order_by="modified desc",
        limit_page_length=50,
    )
    dispatch_names = [d.name for d in dispatches]
    plans = []
    executions = []
    if dispatch_names:
        plans = frappe.get_all(
            "Rollout Plan",
            filters={"po_dispatch": ["in", dispatch_names]},
            fields=["*"],
            order_by="plan_date desc",
            limit_page_length=200,
        )
        plan_names = [p.name for p in plans]
        if plan_names:
            executions = frappe.get_all(
                "Daily Execution",
                filters={"rollout_plan": ["in", plan_names]},
                fields=["*"],
                order_by="execution_date desc",
                limit_page_length=200,
            )

    return {
        "duid": duid or None,
        "po_no": po_no or None,
        "dispatches": dispatches,
        "rollout_plans": plans,
        "executions": executions,
        "additional_activities": [],
        "expenses": [],
        "acceptance": [],
        "notes": "Additional activities, expenses, and acceptance lines can be linked in a later phase.",
    }


@frappe.whitelist()
def reopen_rollout_for_revisit(rollout_plan, issue_category=None, planning_route=None):
    """
    Re-visit workflow: move job back to planning with issue.
    Non-completed executions for this plan are cancelled.
    """
    if not rollout_plan or not frappe.db.exists("Rollout Plan", rollout_plan):
        frappe.throw("Invalid Rollout Plan")

    # Route selection removed: all re-plans are tracked as issue/risk.
    new_status = "Planning with Issue"

    source = frappe.get_doc("Rollout Plan", rollout_plan)
    existing_revisit = frappe.db.get_value(
        "Rollout Plan",
        {
            "po_dispatch": source.po_dispatch,
            "visit_type": "Re-Visit",
            "plan_status": ["in", ["Planned", "Planning with Issue", "In Execution"]],
        },
        "name",
    )

    if existing_revisit and existing_revisit != rollout_plan:
        revisit_name = existing_revisit
    else:
        revisit = frappe.new_doc("Rollout Plan")
        revisit.po_dispatch = source.po_dispatch
        revisit.im = source.im
        revisit.team = source.team
        revisit.plan_date = nowdate()
        if hasattr(revisit, "plan_end_date"):
            revisit.plan_end_date = nowdate()
        if hasattr(revisit, "access_time"):
            revisit.access_time = getattr(source, "access_time", None)
        if hasattr(revisit, "access_period"):
            revisit.access_period = getattr(source, "access_period", None)
        revisit.visit_type = "Re-Visit"
        pd_reg = frappe.db.get_value(
            "PO Dispatch", source.po_dispatch, ["region_type", "center_area"], as_dict=True
        ) or {}
        if hasattr(revisit, "region_type"):
            revisit.region_type = pd_reg.get("region_type") or region_type_from_center_area(
                pd_reg.get("center_area")
            )
        rev_mult = flt(
            frappe.db.get_value("Visit Multiplier Master", "Re-Visit", "multiplier") or 0.5
        )
        revisit.visit_multiplier = rev_mult
        tgt_src = flt(source.target_amount or 0)
        revisit.target_amount = tgt_src * rev_mult if tgt_src > 0 else 0
        revisit.plan_status = new_status
        revisit.issue_category = (issue_category or "")[:140]
        if hasattr(revisit, "source_rollout_plan"):
            revisit.source_rollout_plan = rollout_plan
        revisit.insert(ignore_permissions=True)
        revisit_name = revisit.name

    # Keep source plan as historical record; do not overwrite to Re-Visit.
    frappe.db.set_value(
        "Rollout Plan",
        rollout_plan,
        {"issue_category": (issue_category or "")[:140]},
        update_modified=True,
    )

    for row in frappe.get_all(
        "Daily Execution",
        filters={"rollout_plan": rollout_plan, "execution_status": ["not in", ["Completed", "Cancelled"]]},
        pluck="name",
    ):
        frappe.db.set_value("Daily Execution", row, "execution_status", "Cancelled", update_modified=True)

    frappe.db.commit()
    return {
        "ok": True,
        "source_rollout_plan": rollout_plan,
        "revisit_rollout_plan": revisit_name,
        "plan_status": new_status,
    }


@frappe.whitelist()
def backfill_rollout_and_execution_im():
    """One-shot: set Rollout Plan.im and Daily Execution.im from PO Dispatch (Administrator)."""
    frappe.only_for("System Manager")
    updated_rp = 0
    updated_de = 0
    for rp in frappe.get_all("Rollout Plan", filters={"po_dispatch": ["!=", ""]}, fields=["name", "po_dispatch"]):
        im_v = frappe.db.get_value("PO Dispatch", rp.po_dispatch, "im")
        if im_v:
            frappe.db.set_value("Rollout Plan", rp.name, "im", im_v, update_modified=False)
            updated_rp += 1
    for de in frappe.get_all("Daily Execution", filters={"rollout_plan": ["!=", ""]}, fields=["name", "rollout_plan"]):
        pd = frappe.db.get_value("Rollout Plan", de.rollout_plan, "po_dispatch")
        if not pd:
            continue
        im_v = frappe.db.get_value("PO Dispatch", pd, "im")
        if im_v:
            frappe.db.set_value("Daily Execution", de.name, "im", im_v, update_modified=False)
            updated_de += 1
    frappe.db.commit()
    return {"rollout_plans_updated": updated_rp, "executions_updated": updated_de}


@frappe.whitelist()
def get_im_dashboard(im=None):
    """
    Filtered dashboard for a single IM.
    Resolves the IM Master record name in multiple ways so mismatched
    im/full_name values don't silently return empty data.
    """
    im_resolved, im_identifiers, _ = resolve_im_for_session(im)
    if not im_identifiers:
        return {
            "im": None,
            "teams": [],
            "projects": [],
            "kpi": {},
            "action_items": {"pending_plan_dispatches": 0, "qc_fail_needs_action": 0, "planned_ready_execution": 0},
            "debug": {"error": "Could not resolve IM from session or parameter"},
        }

    im = im_resolved
    action_items = im_action_counts(im_identifiers)

    today_str = nowdate()
    today = getdate(today_str)
    first_day, last_day, _ = _month_bounds()
    days_in_month = _days_in_month(today)
    day_of_month = today.day

    # Teams belonging to this IM — match any known identifier value
    teams = frappe.get_all(
        "INET Team",
        filters={"im": ["in", im_identifiers], "status": "Active"},
        fields=["name", "team_id", "team_name", "team_type", "daily_cost", "status"],
    )
    team_ids = [t.name for t in teams]

    # Projects assigned to this IM — match any known identifier value
    projects = frappe.get_all(
        "Project Control Center",
        filters={"implementation_manager": ["in", im_identifiers]},
        fields=["name", "project_code", "project_name", "project_status",
                "completion_percentage", "budget_amount", "customer"],
        order_by="modified desc",
        limit=50,
    )
    # Normalize field names for frontend
    for p in projects:
        p["completion_pct"] = p.pop("completion_percentage", 0) or 0
        p["budget"] = p.pop("budget_amount", 0) or 0
        p["status"] = p.pop("project_status", "Active") or "Active"

    debug_info = {
        "im_resolved": im_resolved,
        "im_identifiers": im_identifiers,
        "teams_found": len(team_ids),
        "projects_found": len(projects),
        "action_items": action_items,
    }

    if not team_ids:
        return {
            "im": im_resolved,
            "teams": [],
            "projects": projects,
            "kpi": {"team_count": 0, "revenue": 0, "cost": 0, "profit": 0},
            "action_items": action_items,
            "message": (
                f"No active INET Teams found for this IM "
                f"(searched: {', '.join(im_identifiers)}). "
                f"In INET Team master set 'Implementation Manager' to one of those values."
            ),
            "debug": debug_info,
            "last_updated": frappe.utils.now(),
        }

    placeholders = ", ".join(["%s"] * len(team_ids))

    # Revenue this month
    revenue_rows = frappe.db.sql(
        f"""
        SELECT COALESCE(SUM(wd.revenue_sar), 0) AS revenue,
               COALESCE(SUM(wd.total_cost_sar), 0) AS cost
        FROM `tabWork Done` wd
        JOIN `tabDaily Execution` exe ON exe.name = wd.execution
        JOIN `tabRollout Plan` rp ON rp.name = exe.rollout_plan
        WHERE rp.team IN ({placeholders})
        AND exe.execution_date BETWEEN %s AND %s
        """,
        tuple(team_ids) + (first_day, last_day),
        as_dict=True,
    )
    revenue = flt(revenue_rows[0].revenue if revenue_rows else 0)
    cost = flt(revenue_rows[0].cost if revenue_rows else 0)

    # Monthly target — projects where this IM is implementation_manager
    im_ph = ", ".join(["%s"] * len(im_identifiers))
    monthly_target_rows = frappe.db.sql(
        f"""
        SELECT COALESCE(SUM(pcc.monthly_target), 0) AS total
        FROM `tabProject Control Center` pcc
        WHERE pcc.implementation_manager IN ({im_ph})
        AND pcc.active_flag = 'Yes'
        """,
        tuple(im_identifiers),
        as_dict=True,
    )
    monthly_target = flt(monthly_target_rows[0].total if monthly_target_rows else 0)
    target_today = (
        (monthly_target * day_of_month) / days_in_month if days_in_month else 0.0
    )
    gap_today = target_today - revenue

    # Active teams today
    active_today_rows = frappe.db.sql(
        f"""
        SELECT COUNT(DISTINCT team) AS cnt FROM `tabDaily Execution`
        WHERE team IN ({placeholders})
        AND execution_date = %s
        """,
        tuple(team_ids) + (today_str,),
        as_dict=True,
    )
    active_today = cint(active_today_rows[0].cnt if active_today_rows else 0)

    # Planned activities
    planned_rows = frappe.db.sql(
        f"""
        SELECT COUNT(*) AS cnt FROM `tabRollout Plan` rp
        WHERE rp.team IN ({placeholders})
        AND rp.plan_status = 'Planned'
        """,
        tuple(team_ids),
        as_dict=True,
    )
    planned_activities = cint(planned_rows[0].cnt if planned_rows else 0)

    return {
        "im": im_resolved,
        "teams": teams,
        "projects": projects,
        "action_items": action_items,
        "kpi": {
            "monthly_target": monthly_target,
            "target_today": target_today,
            "revenue": revenue,
            "cost": cost,
            "profit": revenue - cost,
            "gap_today": gap_today,
            "active_teams_today": active_today,
            "total_teams": len(teams),
            "team_count": len(teams),
            "planned_activities": planned_activities,
        },
        "debug": debug_info,
        "last_updated": frappe.utils.now(),
    }


@frappe.whitelist()
def get_im_reports():
    """
    IM-scoped report bundle for the portal (single round-trip).
    Same IM resolution as get_im_dashboard; no hardcoded placeholders.
    """
    im_resolved, im_identifiers = _require_inet_im_session()
    first_day, last_day, _today_str = _month_bounds()
    im_ph = ", ".join(["%s"] * len(im_identifiers))

    disp_rows = frappe.db.sql(
        f"""
        SELECT dispatch_status, COALESCE(project_code, '') AS project_code,
               COALESCE(line_amount, 0) AS line_amount, dispatch_mode
        FROM `tabPO Dispatch`
        WHERE im IN ({im_ph})
        LIMIT 2000
        """,
        tuple(im_identifiers),
        as_dict=True,
    ) or []
    total_lines = len(disp_rows)
    total_amount = sum(flt(r.get("line_amount")) for r in disp_rows)
    by_status = {}
    by_project = {}
    by_mode = {}
    for r in disp_rows:
        st = (r.get("dispatch_status") or "").strip() or "(No status)"
        by_status[st] = by_status.get(st, 0) + 1
        pk = (r.get("project_code") or "").strip() or "(No project)"
        by_project[pk] = by_project.get(pk, 0) + flt(r.get("line_amount"))
        md = (r.get("dispatch_mode") or "").strip() or "(No mode)"
        by_mode[md] = by_mode.get(md, 0) + 1

    teams = frappe.get_all(
        "INET Team",
        filters={"im": ["in", im_identifiers], "status": "Active"},
        fields=["name", "team_id", "team_name"],
    )
    team_ids = [t.name for t in teams]

    rollout_status_counts = []
    rollouts_recent = []
    exec_status_counts = []
    executions_recent = []
    wd_mtd = {"count": 0, "revenue_sar": 0.0, "by_billing": {}}

    if team_ids:
        tph = ", ".join(["%s"] * len(team_ids))
        rollout_status_counts = (
            frappe.db.sql(
                f"""
                SELECT rp.plan_status AS status_key, COUNT(*) AS cnt
                FROM `tabRollout Plan` rp
                WHERE rp.team IN ({tph})
                GROUP BY rp.plan_status
                ORDER BY cnt DESC
                """,
                tuple(team_ids),
                as_dict=True,
            )
            or []
        )

        rollouts_recent = (
            frappe.db.sql(
                f"""
                SELECT rp.name, rp.plan_date, rp.plan_status, rp.team, rp.po_dispatch,
                       rp.visit_type, rp.target_amount
                FROM `tabRollout Plan` rp
                WHERE rp.team IN ({tph})
                ORDER BY rp.modified DESC
                LIMIT 80
                """,
                tuple(team_ids),
                as_dict=True,
            )
            or []
        )
        for r in rollouts_recent:
            tid = r.get("team")
            r["team_name"] = frappe.db.get_value("INET Team", tid, "team_name") or tid

        exec_status_counts = (
            frappe.db.sql(
                f"""
                SELECT de.execution_status AS status_key, COUNT(*) AS cnt
                FROM `tabDaily Execution` de
                WHERE de.team IN ({tph})
                AND de.execution_date BETWEEN %s AND %s
                GROUP BY de.execution_status
                ORDER BY cnt DESC
                """,
                tuple(team_ids) + (first_day, last_day),
                as_dict=True,
            )
            or []
        )

        executions_recent = (
            frappe.db.sql(
                f"""
                SELECT de.name, de.rollout_plan, de.execution_date, de.execution_status,
                       de.qc_status, de.team, rp.po_dispatch
                FROM `tabDaily Execution` de
                LEFT JOIN `tabRollout Plan` rp ON rp.name = de.rollout_plan
                WHERE de.team IN ({tph})
                AND de.execution_date BETWEEN %s AND %s
                ORDER BY de.modified DESC
                LIMIT 60
                """,
                tuple(team_ids) + (first_day, last_day),
                as_dict=True,
            )
            or []
        )

        wd_rows = (
            frappe.db.sql(
                f"""
                SELECT wd.billing_status AS billing_status,
                       COUNT(*) AS c,
                       COALESCE(SUM(wd.revenue_sar), 0) AS rev
                FROM `tabWork Done` wd
                INNER JOIN `tabDaily Execution` exe ON exe.name = wd.execution
                WHERE exe.team IN ({tph})
                AND exe.execution_date BETWEEN %s AND %s
                GROUP BY wd.billing_status
                """,
                tuple(team_ids) + (first_day, last_day),
                as_dict=True,
            )
            or []
        )
        by_billing = {}
        total_rev = 0.0
        total_cnt = 0
        for w in wd_rows:
            bs = (w.get("billing_status") or "").strip() or "Pending"
            c = cint(w.get("c"))
            rev = flt(w.get("rev"))
            by_billing[bs] = {"count": c, "revenue_sar": rev}
            total_cnt += c
            total_rev += rev
        wd_mtd = {"count": total_cnt, "revenue_sar": total_rev, "by_billing": by_billing}

    projects = frappe.get_all(
        "Project Control Center",
        filters={"implementation_manager": ["in", im_identifiers]},
        fields=[
            "name",
            "project_code",
            "project_name",
            "project_status",
            "completion_percentage",
            "budget_amount",
            "actual_cost",
        ],
        order_by="modified desc",
        limit_page_length=50,
    )
    for p in projects:
        p["completion_pct"] = p.get("completion_percentage") or 0
        p["budget"] = flt(p.get("budget_amount"))
        p["status"] = p.get("project_status") or "Active"

    return {
        "im": im_resolved,
        "last_updated": frappe.utils.now(),
        "period": {"from": first_day, "to": last_day},
        "dispatch_summary": {
            "total_lines": total_lines,
            "total_amount": total_amount,
            "by_status": by_status,
            "by_project": by_project,
            "by_dispatch_mode": by_mode,
        },
        "rollout_status_counts": rollout_status_counts,
        "rollouts_recent": rollouts_recent,
        "execution_status_counts": exec_status_counts,
        "executions_recent": executions_recent,
        "work_done_mtd": wd_mtd,
        "projects": projects,
        "teams": teams,
    }


@frappe.whitelist()
def get_field_team_dashboard(team_id=None):
    """
    Return today's planned work for a specific team.
    Enriches rollout plan data with dispatch info (item_code, item_description,
    project_code, site_name).

    Returns
    -------
    {
        "team": team_id,
        "today": "YYYY-MM-DD",
        "planned": [...],
        "last_updated": ...,
    }
    """
    today_str = nowdate()

    if not team_id:
        return {"team": None, "today": today_str, "planned": [], "last_updated": frappe.utils.now()}

    # Rollout Plans for this team today
    plans = frappe.db.sql(
        """
        SELECT rp.name, rp.po_dispatch, rp.plan_date, rp.visit_type,
               rp.visit_number, rp.visit_multiplier, rp.target_amount,
               rp.achieved_amount, rp.completion_pct, rp.plan_status
        FROM `tabRollout Plan` rp
        WHERE rp.team = %s
        AND rp.plan_date = %s
        AND rp.plan_status IN ('Planned', 'Ready for Execution', 'In Execution', 'Planning with Issue')
        ORDER BY rp.name
        """,
        (team_id, today_str),
        as_dict=True,
    )

    if not plans:
        return {
            "team": team_id,
            "today": today_str,
            "planned": [],
            "last_updated": frappe.utils.now(),
        }

    dispatch_names = [p.po_dispatch for p in plans if p.po_dispatch]
    dispatch_map = {}

    if dispatch_names:
        placeholders = ", ".join(["%s"] * len(dispatch_names))
        dispatch_rows = frappe.db.sql(
            f"""
            SELECT name, item_code, item_description, project_code, site_name, site_code, center_area, region_type
            FROM `tabPO Dispatch`
            WHERE name IN ({placeholders})
            """,
            tuple(dispatch_names),
            as_dict=True,
        )
        dispatch_map = {d.name: d for d in dispatch_rows}

    # Merge dispatch data into plan records
    enriched = []
    for plan in plans:
        dispatch_info = dispatch_map.get(plan.po_dispatch) or {}
        enriched.append(
            {
                "name": plan.name,
                "po_dispatch": plan.po_dispatch,
                "plan_date": plan.plan_date,
                "visit_type": plan.visit_type,
                "visit_number": plan.visit_number,
                "visit_multiplier": plan.visit_multiplier,
                "target_amount": plan.target_amount,
                "achieved_amount": plan.achieved_amount,
                "completion_pct": plan.completion_pct,
                "plan_status": plan.plan_status,
                "item_code": dispatch_info.get("item_code"),
                "item_description": dispatch_info.get("item_description"),
                "project_code": dispatch_info.get("project_code"),
                "site_name": dispatch_info.get("site_name"),
                "site_code": dispatch_info.get("site_code"),
                "center_area": dispatch_info.get("center_area"),
                "region_type": dispatch_info.get("region_type")
                or region_type_from_center_area(dispatch_info.get("center_area")),
            }
        )

    return {
        "team": team_id,
        "today": today_str,
        "planned": enriched,
        "last_updated": frappe.utils.now(),
    }


# ---------------------------------------------------------------------------
# Project Detail — Full project summary with related records
# ---------------------------------------------------------------------------

def _normalize_duid_site(site_code):
    """Group key for site / DUID; empty becomes a single bucket."""
    s = (site_code or "").strip()
    return s if s else "(No DUID)"


def _build_rollout_by_duid_groups(dispatches, plans, executions, work_done):
    """
    Rollout view grouped by DUID (PO Dispatch.site_code).
    Planned activity = Rollout Plan with visit_type Work Done (default path).
    Additional = Extra Visit, Re-Visit.
    Expenses = Work Done cost lines for executions under those plans.
    Time logs = Execution Time Log rows linked to rollout plans in the group.
    """
    dispatch_by_name = {d.name: d for d in dispatches}

    def new_group(duid_label):
        return {
            "duid_label": duid_label,
            "site_code": "",
            "site_name": "",
            "po_lines": [],
            "planned_activities": [],
            "additional_activities": [],
            "expenses": [],
            "time_logs": [],
        }

    groups = {}

    def ensure_group(duid_label):
        if duid_label not in groups:
            groups[duid_label] = new_group(duid_label)
        return groups[duid_label]

    plan_to_dispatch = {p.name: p.get("po_dispatch") for p in plans}
    exec_to_plan = {e.name: e.get("rollout_plan") for e in executions}

    def duid_for_dispatch_name(dname):
        row = dispatch_by_name.get(dname)
        if not row:
            return "(Unknown dispatch)"
        return _normalize_duid_site(row.get("site_code"))

    def duid_for_plan_name(pname):
        pd = plan_to_dispatch.get(pname)
        if not pd:
            return "(Unknown dispatch)"
        return duid_for_dispatch_name(pd)

    for d in dispatches:
        key = _normalize_duid_site(d.get("site_code"))
        g = ensure_group(key)
        if not g.get("site_code") and d.get("site_code"):
            g["site_code"] = (d.get("site_code") or "").strip()
        if not g.get("site_name") and d.get("site_name"):
            g["site_name"] = (d.get("site_name") or "").strip()
        g["po_lines"].append(d)

    additional_visit_types = frozenset({"Extra Visit", "Re-Visit"})

    for p in plans:
        key = duid_for_plan_name(p.name)
        g = ensure_group(key)
        vt = (p.get("visit_type") or "Work Done").strip()
        if vt in additional_visit_types:
            g["additional_activities"].append(p)
        else:
            g["planned_activities"].append(p)

    for wd in work_done:
        ex = wd.get("execution")
        if not ex:
            continue
        rplan = exec_to_plan.get(ex)
        if not rplan:
            continue
        key = duid_for_plan_name(rplan)
        ensure_group(key)["expenses"].append(wd)

    plan_names = [p.name for p in plans]
    time_logs = []
    if plan_names and frappe.db.exists("DocType", "Execution Time Log"):
        time_logs = frappe.get_all(
            "Execution Time Log",
            filters={"rollout_plan": ["in", plan_names]},
            fields=["*"],
            order_by="start_time desc",
            limit_page_length=2000,
        )
    for tl in time_logs:
        rp = tl.get("rollout_plan")
        if not rp:
            continue
        key = duid_for_plan_name(rp)
        ensure_group(key)["time_logs"].append(tl)

    def sort_key(k):
        if k == "(No DUID)":
            return (2, k)
        if k == "(Unknown dispatch)":
            return (1, k)
        return (0, k)

    ordered = [groups[k] for k in sorted(groups.keys(), key=sort_key)]
    for g in ordered:
        poids = sorted({r.get("name") for r in g["po_lines"] if r.get("name")})
        g["poid_list"] = poids
    return ordered


@frappe.whitelist()
def get_project_summary(project_code):
    """Get complete project summary with all related records."""
    if not project_code:
        frappe.throw("project_code is required")

    project = frappe.get_doc("Project Control Center", project_code).as_dict()

    # PO Dispatches for this project (full rows for detail / rollout grouping)
    dispatches = frappe.get_all(
        "PO Dispatch",
        filters={"project_code": project_code},
        fields=["*"],
        order_by="site_code asc, modified desc",
        limit_page_length=500,
    )

    # Get dispatch names for downstream queries
    dispatch_names = [d.name for d in dispatches]

    # Rollout Plans
    plans = []
    if dispatch_names:
        plans = frappe.get_all(
            "Rollout Plan",
            filters={"po_dispatch": ["in", dispatch_names]},
            fields=["*"],
            order_by="plan_date desc",
            limit_page_length=500,
        )

    # Daily Executions
    plan_names = [p.name for p in plans]
    executions = []
    if plan_names:
        executions = frappe.get_all(
            "Daily Execution",
            filters={"rollout_plan": ["in", plan_names]},
            fields=["*"],
            order_by="execution_date desc",
            limit_page_length=500,
        )
        plan_poid_map = {p.name: p.po_dispatch for p in plans}
        for e in executions:
            e["system_id"] = plan_poid_map.get(e.rollout_plan)

    # Work Done
    execution_names = [e.name for e in executions]
    work_done = []
    if execution_names:
        work_done = frappe.get_all(
            "Work Done",
            filters={"execution": ["in", execution_names]},
            fields=["*"],
            limit_page_length=500,
        )
        exec_poid_map = {e.name: e.get("system_id") for e in executions}
        for wd in work_done:
            wd["system_id"] = exec_poid_map.get(wd.execution)

    # Teams involved — from rollout plans + Team Assignment doctype
    dispatch_teams = set(p.team for p in plans if p.get("team"))

    # Team Assignments for this project
    team_assignments = frappe.get_all("Team Assignment",
        filters={"project": project_code},
        fields=["name", "team_id", "assignment_date", "end_date", "role_in_project",
                "daily_cost", "utilization_percentage", "status"],
        order_by="assignment_date desc",
        limit_page_length=200)
    assigned_teams = set(ta.team_id for ta in team_assignments if ta.team_id)

    all_team_ids = list(dispatch_teams | assigned_teams)
    team_details = []
    if all_team_ids:
        team_details = frappe.get_all("INET Team",
            filters={"team_id": ["in", all_team_ids]},
            fields=["team_id", "team_name", "im", "team_type", "status", "daily_cost"])
        # Enrich with assignment info
        assignment_map = {ta.team_id: ta for ta in team_assignments}
        for t in team_details:
            ta = assignment_map.get(t.team_id)
            if ta:
                t["assignment_name"] = ta.name
                t["role_in_project"] = ta.role_in_project
                t["assignment_date"] = str(ta.assignment_date) if ta.assignment_date else None
                t["end_date"] = str(ta.end_date) if ta.end_date else None
                t["assignment_status"] = ta.status
                t["utilization_percentage"] = ta.utilization_percentage

    # Financial summary
    total_po_value = sum(flt(d.line_amount) for d in dispatches)
    total_revenue = sum(flt(w.revenue_sar) for w in work_done)
    total_cost = sum(flt(w.total_cost_sar) for w in work_done)
    total_margin = sum(flt(w.margin_sar) for w in work_done)

    rollout_by_duid = _build_rollout_by_duid_groups(dispatches, plans, executions, work_done)

    return {
        "project": project,
        "dispatches": dispatches,
        "plans": plans,
        "executions": executions,
        "work_done": work_done,
        "teams": team_details,
        "team_assignments": team_assignments,
        "rollout_by_duid": rollout_by_duid,
        "financial_summary": {
            "total_po_value": total_po_value,
            "total_revenue": total_revenue,
            "total_cost": total_cost,
            "total_margin": total_margin,
            "dispatch_count": len(dispatches),
            "plan_count": len(plans),
            "execution_count": len(executions),
            "work_done_count": len(work_done),
        },
    }


# ---------------------------------------------------------------------------
# Activity Cost Master — List API
# ---------------------------------------------------------------------------

@frappe.whitelist()
def list_activity_costs():
    """Return all active Activity Cost Master records."""
    return frappe.get_all(
        "Activity Cost Master",
        filters={"active_flag": 1},
        fields=["name", "activity_code", "standard_activity", "category", "base_cost_sar"],
        order_by="activity_code asc",
        limit_page_length=500,
    )


# ---------------------------------------------------------------------------
# Execution Time Log — field time on rollout (Next PMS–style; not ERPNext Timesheet)
# ---------------------------------------------------------------------------


def _frappe_dt_to_epoch_ms(value):
    """
    Convert Frappe DB datetime (wall time in site timezone) to UTC epoch milliseconds.
    Used so portal timers stay correct for users in any region (vs parsing strings in local JS).
    """
    if value is None:
        return None
    dt = get_datetime(value)
    if not dt:
        return None
    try:
        from zoneinfo import ZoneInfo

        tzname = frappe.db.get_single_value("System Settings", "time_zone")
        if tzname and getattr(dt, "tzinfo", None) is None:
            dt = dt.replace(tzinfo=ZoneInfo(tzname))
            return int(dt.timestamp() * 1000)
    except Exception:
        pass
    return int(get_datetime(value).timestamp() * 1000)


def _session_inet_field_team_id():
    """INET Team.team_id for the logged-in field user, if any."""
    user = frappe.session.user
    if not user or user == "Guest":
        return None
    ft = frappe.get_all(
        "INET Team",
        filters={"field_user": user, "status": "Active"},
        fields=["team_id"],
        limit=1,
    )
    if ft and ft[0].team_id:
        return ft[0].team_id
    first = (frappe.db.get_value("User", user, "full_name") or "").split()[0]
    if first:
        ft2 = frappe.get_all(
            "INET Team",
            filters={"team_name": ["like", f"%{first}%"], "status": "Active"},
            fields=["team_id"],
            limit=1,
        )
        if ft2 and ft2[0].team_id:
            return ft2[0].team_id
    return None


def _assert_rollout_plan_access_field_team(team_id, rollout_plan):
    if not team_id or not rollout_plan:
        frappe.throw("Team or plan missing", frappe.PermissionError)
    if not frappe.db.exists("Rollout Plan", rollout_plan):
        frappe.throw("Rollout Plan not found")
    plan_team = frappe.db.get_value("Rollout Plan", rollout_plan, "team")
    if plan_team != team_id:
        frappe.throw("Not permitted", frappe.PermissionError)


def _im_team_ids_for_filter(im_filter=None):
    """team_id values for teams managed by the resolved IM."""
    _im_r, im_ids, _meta = resolve_im_for_session(im_filter)
    if not im_ids:
        return []
    teams = frappe.get_all(
        "INET Team",
        filters={"im": ["in", im_ids], "status": "Active"},
        fields=["team_id"],
        limit_page_length=500,
    )
    return [t.team_id for t in teams if t.team_id]


@frappe.whitelist()
def start_execution_timer(rollout_plan):
    """
    Start a timer for the given Rollout Plan (field user). One running log per user.
    """
    rollout_plan = (rollout_plan or "").strip()
    if not rollout_plan:
        frappe.throw("rollout_plan is required")

    user = frappe.session.user
    roles = set(frappe.get_roles(user))
    if "INET Field Team" not in roles and "Administrator" not in roles:
        frappe.throw("Only field team users can start execution timers", frappe.PermissionError)

    team_id = _session_inet_field_team_id()
    if not team_id:
        frappe.throw("No active field team linked to your user")

    _assert_rollout_plan_access_field_team(team_id, rollout_plan)

    plan_status = frappe.db.get_value("Rollout Plan", rollout_plan, "plan_status")
    if plan_status in ("Completed", "Cancelled"):
        frappe.throw("Cannot start a timer on a completed or cancelled plan.")

    existing = frappe.get_all(
        "Execution Time Log",
        filters={"user": user, "is_running": 1},
        fields=["name", "rollout_plan"],
        limit=1,
        ignore_permissions=True,
    )
    if existing:
        frappe.throw(
            f"You already have a running timer ({existing[0].name}). Stop it first."
        )

    log = frappe.new_doc("Execution Time Log")
    log.rollout_plan = rollout_plan
    log.team_id = team_id
    log.user = user
    log.start_time = now_datetime()
    log.is_running = 1
    log.insert(ignore_permissions=True)
    frappe.db.commit()

    server_now = now_datetime()
    return {
        "log_name": log.name,
        "rollout_plan": rollout_plan,
        "start_time": str(log.start_time),
        "server_time": str(server_now),
        "start_time_ms": _frappe_dt_to_epoch_ms(log.start_time),
        "server_time_ms": _frappe_dt_to_epoch_ms(server_now),
        "user": user,
    }


@frappe.whitelist()
def stop_execution_timer(log_name):
    """Stop a running execution timer and persist duration."""
    log_name = (log_name or "").strip()
    if not log_name:
        frappe.throw("log_name is required")

    log = frappe.get_doc("Execution Time Log", log_name)
    if not log.is_running:
        frappe.throw("This timer is not running.")

    user = frappe.session.user
    roles = set(frappe.get_roles(user))
    can_stop = log.user == user or "Administrator" in roles or "System Manager" in roles or "INET Admin" in roles
    if not can_stop:
        frappe.throw("You can only stop your own timers.", frappe.PermissionError)

    log.end_time = now_datetime()
    log.is_running = 0
    start = get_datetime(log.start_time)
    end = get_datetime(log.end_time)
    diff_seconds = time_diff_in_seconds(end, start)
    log.duration_minutes = int(diff_seconds / 60)
    log.duration_hours = round(diff_seconds / 3600, 2)
    log.save(ignore_permissions=True)
    frappe.db.commit()

    return {
        "log_name": log.name,
        "rollout_plan": log.rollout_plan,
        "duration_minutes": log.duration_minutes,
        "duration_hours": log.duration_hours,
    }


@frappe.whitelist()
def get_running_execution_timer():
    """Current user's running Execution Time Log, if any."""
    user = frappe.session.user
    if not user or user == "Guest":
        return None

    running = frappe.get_all(
        "Execution Time Log",
        filters={"user": user, "is_running": 1},
        fields=["name", "rollout_plan", "start_time", "team_id"],
        limit=1,
        ignore_permissions=True,
    )
    if not running:
        return None
    r = running[0]
    desc = frappe.db.get_value(
        "Rollout Plan",
        r.rollout_plan,
        ["po_dispatch"],
        as_dict=True,
    )
    item_hint = ""
    if desc and desc.po_dispatch:
        item_hint = frappe.db.get_value("PO Dispatch", desc.po_dispatch, "item_description") or ""

    server_now = now_datetime()
    elapsed_seconds = None
    try:
        now_ms = _frappe_dt_to_epoch_ms(server_now)
        st_ms = _frappe_dt_to_epoch_ms(r.start_time)
        if now_ms is not None and st_ms is not None:
            elapsed_seconds = int(max(0, (now_ms - st_ms) // 1000))
    except Exception:
        elapsed_seconds = None
    return {
        "log_name": r.name,
        "rollout_plan": r.rollout_plan,
        "start_time": str(r.start_time) if r.start_time else None,
        "server_time": str(server_now),
        "start_time_ms": _frappe_dt_to_epoch_ms(r.start_time),
        "server_time_ms": _frappe_dt_to_epoch_ms(server_now),
        "elapsed_seconds": elapsed_seconds,
        "team_id": r.team_id,
        "item_description": item_hint,
    }


@frappe.whitelist()
def save_execution_time_log_manual(rollout_plan, start_time, end_time, notes=None):
    """
    Create a completed time log without using the live timer (field user).
    start_time / end_time: ISO or Frappe datetime strings.
    """
    rollout_plan = (rollout_plan or "").strip()
    if not rollout_plan or not start_time or not end_time:
        frappe.throw("rollout_plan, start_time, and end_time are required")

    user = frappe.session.user
    roles = set(frappe.get_roles(user))
    if "INET Field Team" not in roles and "Administrator" not in roles:
        frappe.throw("Not permitted", frappe.PermissionError)

    team_id = _session_inet_field_team_id()
    if not team_id:
        frappe.throw("No active field team linked to your user")

    _assert_rollout_plan_access_field_team(team_id, rollout_plan)

    st = get_datetime(start_time)
    et = get_datetime(end_time)
    if et < st:
        frappe.throw("End time cannot be before start time")

    diff_seconds = time_diff_in_seconds(et, st)
    log = frappe.new_doc("Execution Time Log")
    log.rollout_plan = rollout_plan
    log.team_id = team_id
    log.user = user
    log.start_time = st
    log.end_time = et
    log.is_running = 0
    log.duration_minutes = int(diff_seconds / 60)
    log.duration_hours = round(diff_seconds / 3600, 2)
    log.notes = notes or ""
    log.insert(ignore_permissions=True)
    frappe.db.commit()
    return {"name": log.name, "duration_hours": log.duration_hours}


@frappe.whitelist()
def list_execution_time_logs(filters=None, limit=100, offset=0):
    """
    List execution time logs with role-based scoping.
    filters (JSON): team_id, im, user, rollout_plan, from_date, to_date, is_running
    """
    if isinstance(filters, str):
        filters = frappe.parse_json(filters or "{}")
    if not filters:
        filters = {}

    user = frappe.session.user
    roles = set(frappe.get_roles(user))
    is_desk_admin = (
        "Administrator" in roles or "System Manager" in roles or "INET Admin" in roles
    )
    is_im = "INET IM" in roles
    is_field = "INET Field Team" in roles

    db_filters = {}

    if filters.get("rollout_plan"):
        db_filters["rollout_plan"] = filters["rollout_plan"]
    if filters.get("is_running") is not None and filters.get("is_running") != "":
        db_filters["is_running"] = cint(filters["is_running"])

    # Role scoping
    if is_desk_admin:
        if filters.get("team_id"):
            db_filters["team_id"] = filters["team_id"]
        if filters.get("user"):
            db_filters["user"] = filters["user"]
    elif is_im:
        team_ids = _im_team_ids_for_filter(filters.get("im"))
        if filters.get("team_id"):
            if filters["team_id"] not in team_ids:
                return {"logs": [], "total": 0}
            db_filters["team_id"] = filters["team_id"]
        else:
            if not team_ids:
                return {"logs": [], "total": 0}
            db_filters["team_id"] = ["in", team_ids]
        if filters.get("user"):
            db_filters["user"] = filters["user"]
    elif is_field:
        db_filters["user"] = user
        ft_team = _session_inet_field_team_id()
        if ft_team:
            db_filters["team_id"] = ft_team
    else:
        frappe.throw("Not permitted", frappe.PermissionError)

    from_date = filters.get("from_date")
    to_date = filters.get("to_date")
    if from_date and to_date:
        db_filters["start_time"] = ["between", [f"{from_date} 00:00:00", f"{to_date} 23:59:59"]]
    elif from_date:
        db_filters["start_time"] = [">=", f"{from_date} 00:00:00"]
    elif to_date:
        db_filters["start_time"] = ["<=", f"{to_date} 23:59:59"]

    total = frappe.db.count("Execution Time Log", db_filters)

    logs = frappe.get_all(
        "Execution Time Log",
        filters=db_filters,
        fields=[
            "name",
            "rollout_plan",
            "team_id",
            "user",
            "start_time",
            "end_time",
            "duration_hours",
            "duration_minutes",
            "is_running",
            "notes",
        ],
        order_by="start_time desc",
        limit_page_length=min(cint(limit) or 100, 500),
        limit_start=cint(offset),
        ignore_permissions=True,
    )

    for row in logs:
        raw_start = row.get("start_time")
        raw_end = row.get("end_time")
        if row.get("is_running") and raw_start:
            now_ms = _frappe_dt_to_epoch_ms(now_datetime())
            st_ms = _frappe_dt_to_epoch_ms(raw_start)
            if now_ms is not None and st_ms is not None:
                row["elapsed_seconds"] = int(max(0, (now_ms - st_ms) // 1000))
        row["start_time"] = str(raw_start) if raw_start else None
        row["end_time"] = str(raw_end) if raw_end else None
        row["user_full_name"] = (
            frappe.get_cached_value("User", row.get("user"), "full_name") or row.get("user")
        )
        pd = frappe.db.get_value(
            "Rollout Plan",
            row.get("rollout_plan"),
            ["po_dispatch", "plan_date", "visit_type", "plan_status"],
            as_dict=True,
        )
        if pd:
            row["plan_date"] = str(pd.plan_date) if pd.plan_date else None
            row["visit_type"] = pd.visit_type
            row["plan_status"] = pd.plan_status
            if pd.po_dispatch:
                disp = frappe.db.get_value(
                    "PO Dispatch",
                    pd.po_dispatch,
                    ["item_description", "project_code", "site_name"],
                    as_dict=True,
                )
                if disp:
                    row["item_description"] = disp.item_description
                    row["project_code"] = disp.project_code
                    row["site_name"] = disp.site_name

    return {"logs": logs, "total": total}


# ---------------------------------------------------------------------------
# Timesheet APIs — ERPNext Timesheet (legacy; portal uses Execution Time Log)
# ---------------------------------------------------------------------------

@frappe.whitelist()
def create_timesheet(payload):
    """
    Create an ERPNext Timesheet with time_logs.

    payload = {
        "employee": "HR-EMP-00001" or team name,
        "team": "Team-01",
        "time_logs": [
            {
                "activity_type": "...",
                "from_time": "2026-04-05 08:00:00",
                "to_time": "2026-04-05 17:00:00",
                "hours": 9,
                "project": "PRJ-001",
                "description": "..."
            }
        ]
    }
    """
    if isinstance(payload, str):
        payload = frappe.parse_json(payload)

    team = payload.get("team")
    time_logs = payload.get("time_logs") or []

    if not time_logs:
        frappe.throw("At least one time log is required.")

    doc = frappe.new_doc("Timesheet")
    doc.company = frappe.defaults.get_global_default("company") or "INET"

    # Try to resolve employee from team
    employee = payload.get("employee")
    if not employee and frappe.db.exists("DocType", "Employee"):
        employee = frappe.db.get_value("Employee", {"user_id": frappe.session.user}, "name")
    if not employee and team:
        # Look up employee linked to this team (if any)
        emp = frappe.db.get_value("Employee", {"employee_name": ["like", f"%{team}%"]}, "name")
        if emp:
            employee = emp

    if employee:
        doc.employee = employee

    # Custom field to track which INET team submitted
    if hasattr(doc, "custom_inet_team"):
        doc.custom_inet_team = team

    for log in time_logs:
        doc.append("time_logs", {
            "activity_type": log.get("activity_type", "Execution"),
            "from_time": log.get("from_time"),
            "to_time": log.get("to_time"),
            "hours": flt(log.get("hours", 0)),
            "project": log.get("project"),
            "description": log.get("description", ""),
        })

    doc.insert(ignore_permissions=True)
    frappe.db.commit()

    return {"name": doc.name, "status": doc.status}


@frappe.whitelist()
def list_timesheets(filters=None):
    """
    List timesheets with optional filters.

    filters = {
        "team": "Team-01",
        "im": "Ajmal",
        "from_date": "2026-04-01",
        "to_date": "2026-04-30",
        "status": "Draft",
    }
    """
    if isinstance(filters, str):
        filters = frappe.parse_json(filters)
    if not filters:
        filters = {}

    db_filters = {}
    if filters.get("status"):
        db_filters["docstatus"] = 1 if filters["status"] == "Submitted" else 0

    include_bounds = filters.pop("include_log_bounds", None) or filters.pop("include_log_times", None)

    timesheets = frappe.get_all(
        "Timesheet",
        filters=db_filters,
        fields=[
            "name", "employee", "employee_name", "company",
            "total_hours", "total_billable_hours", "total_billed_hours",
            "status", "start_date", "end_date", "creation", "modified",
        ],
        order_by="modified desc",
        limit_page_length=200,
    )

    if include_bounds and timesheets and frappe.db.exists("DocType", "Timesheet Detail"):
        names = [t.name for t in timesheets]
        try:
            ph = ", ".join(["%s"] * len(names))
            bounds = frappe.db.sql(
                f"""
                SELECT parent, MIN(from_time) AS log_start, MAX(to_time) AS log_end
                FROM `tabTimesheet Detail`
                WHERE parent IN ({ph}) AND parenttype = 'Timesheet'
                GROUP BY parent
                """,
                tuple(names),
                as_dict=True,
            )
            bmap = {b.parent: b for b in (bounds or [])}
            for ts in timesheets:
                b = bmap.get(ts.name)
                if b:
                    ts["log_start"] = b.log_start
                    ts["log_end"] = b.log_end
        except Exception:
            pass

    # Filter by date range if provided
    from_date = filters.get("from_date")
    to_date = filters.get("to_date")

    if from_date or to_date:
        filtered = []
        for ts in timesheets:
            sd = str(ts.start_date) if ts.start_date else ""
            if from_date and sd < from_date:
                continue
            if to_date and sd > to_date:
                continue
            filtered.append(ts)
        timesheets = filtered

    # If team filter, fetch time_logs for each and check project/team link
    team_filter = filters.get("team")
    im_filter = filters.get("im")

    if team_filter or im_filter:
        team_ids = set()
        if im_filter:
            _im_r, im_ids, _ = resolve_im_for_session(im_filter)
            lookup = im_ids or [im_filter]
            im_teams = frappe.get_all(
                "INET Team",
                filters={"im": ["in", lookup], "status": "Active"},
                fields=["team_id", "team_name"],
            )
            for t in im_teams:
                if t.get("team_id"):
                    team_ids.add(t["team_id"])
                if t.get("team_name"):
                    team_ids.add(t["team_name"])
        if team_filter:
            team_ids.add(team_filter)

        if im_filter and not team_ids:
            return []

        if team_ids:
            filtered = []
            for ts in timesheets:
                emp_name = (ts.employee_name or "").lower()
                if any(str(tid).lower() in emp_name for tid in team_ids if tid):
                    filtered.append(ts)
            timesheets = filtered

    return timesheets


@frappe.whitelist()
def approve_timesheet(name):
    """Submit/approve a timesheet."""
    doc = frappe.get_doc("Timesheet", name)
    if doc.docstatus == 0:
        doc.submit()
        frappe.db.commit()
    return {"name": doc.name, "status": "Submitted"}


@frappe.whitelist()
def get_timesheet_detail(name):
    """Get full timesheet with time_logs."""
    doc = frappe.get_doc("Timesheet", name)
    return doc.as_dict()
