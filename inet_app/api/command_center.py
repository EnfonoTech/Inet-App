"""
Command Center API — Pipeline Operations & Dashboard Aggregation
for inet_app (Frappe 15)
"""

import calendar
import csv
import json
import os

import frappe
from frappe.utils import (
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
    return out


def _get_all_table_prefs_for_user(user):
    raw = frappe.db.get_value("User", user, "user_settings")
    if not raw:
        return {}
    try:
        parsed = frappe.parse_json(raw) if isinstance(raw, str) else raw
    except Exception:
        return {}
    if not isinstance(parsed, dict):
        return {}
    prefs = parsed.get("inet_table_preferences") or {}
    return prefs if isinstance(prefs, dict) else {}


def _save_all_table_prefs_for_user(user, prefs):
    raw = frappe.db.get_value("User", user, "user_settings")
    try:
        parsed = frappe.parse_json(raw) if raw else {}
    except Exception:
        parsed = {}
    if not isinstance(parsed, dict):
        parsed = {}
    parsed["inet_table_preferences"] = prefs
    frappe.db.set_value("User", user, "user_settings", json.dumps(parsed), update_modified=False)


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
    if len(table_id) > 180:
        frappe.throw("table_id is too long")

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
    Insert PO Dispatch then enforce canonical name = POID.
    Returns final dispatch name.
    """
    dispatch_doc.insert(ignore_permissions=True)
    final_name = dispatch_doc.name
    poid = (poid or "").strip()
    if poid and poid != dispatch_doc.name:
        if not frappe.db.exists("PO Dispatch", poid):
            frappe.rename_doc("PO Dispatch", dispatch_doc.name, poid, force=True, merge=False)
            final_name = poid
        else:
            # Avoid accidental duplicate rename collisions; keep existing doc name.
            final_name = dispatch_doc.name

    frappe.db.set_value("PO Dispatch", final_name, "system_id", final_name, update_modified=False)
    return final_name


def _try_auto_dispatch(doc_name, po_no, child_rows):
    """
    After PO Intake insert, auto-dispatch lines whose project has an IM+team assigned.

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

        # Find active INET Team for this IM
        team_doc = frappe.db.get_value(
            "INET Team",
            {"im": im_name, "status": "Active"},
            ["name", "team_type"],
            as_dict=True,
        )
        if not team_doc:
            continue

        team_id = team_doc.name

        # Resolve customer
        customer = frappe.db.get_value(
            "Project Control Center", project_code, "customer"
        )

        dispatch = frappe.new_doc("PO Dispatch")
        dispatch.po_intake = doc_name
        dispatch.po_no = po_no
        dispatch.po_line_no = cint(line_dict.get("po_line_no") or 0)
        dispatch.item_code = line_dict.get("item_code")
        dispatch.item_description = line_dict.get("item_description")
        dispatch.qty = flt(line_dict.get("qty", 0))
        dispatch.rate = flt(line_dict.get("rate", 0))
        dispatch.line_amount = flt(line_dict.get("line_amount", 0))
        dispatch.project_code = project_code
        dispatch.customer = customer
        dispatch.im = im_name
        dispatch.team = team_id
        dispatch.target_month = None
        dispatch.planning_mode = "Plan"
        dispatch.dispatch_status = "Dispatched"
        dispatch.dispatch_mode = "Auto"
        dispatch.site_code = line_dict.get("site_code")
        dispatch.site_name = line_dict.get("site_name")
        dispatch.center_area = line_dict.get("center_area")
        poid = _resolve_line_poid(
            po_no=po_no,
            po_line_no=line_dict.get("po_line_no"),
            shipment_number=line_dict.get("shipment_number"),
            fallback=line_dict.get("poid"),
        )
        _insert_po_dispatch_with_poid(dispatch, poid)

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
            frappe.rename_doc("PO Dispatch", d.name, poid, force=True, merge=False)
            frappe.db.set_value("PO Dispatch", poid, "system_id", poid, update_modified=False)
            renamed += 1
        except Exception:
            failed.append({"from": d.name, "to": poid})

    frappe.db.commit()
    return {"checked": len(rows), "renamed": renamed, "skipped": skipped, "failed": failed}


# ---------------------------------------------------------------------------
# Task 12 — Pipeline Operations
# ---------------------------------------------------------------------------


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
        "PO NO.": "po_no",
        "PO Line NO.": "po_line_no",
        "Shipment NO.": "shipment_no",
        "Site Name": "site_name",
        "Site Code": "site_code",
        "Item Code": "item_code",
        "Item Description": "item_description",
        "Unit": "unit",
        "Requested Qty": "qty",
        "Unit Price": "rate",
        "Line Amount": "line_amount",
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

    for row_idx, raw_row in enumerate(rows_iter, start=2):
        row_dict = {}
        for col_idx, cell_val in enumerate(raw_row):
            raw_header = headers[col_idx] if col_idx < len(headers) else ""
            std_key = ALIAS.get(raw_header)
            if std_key:
                row_dict[std_key] = cell_val

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
            errors.append("project_code not found in Project Control Center")

        item_code = str(row_dict.get("item_code") or "").strip()
        cim_filters = {"item_code": item_code, "active_flag": 1}
        if customer:
            cim_filters["customer"] = customer
        item_exists = bool(item_code and frappe.db.exists("Customer Item Master", cim_filters))
        if not item_exists:
            if customer:
                errors.append(f"item_code not found in Customer Item Master for customer {customer}")
            else:
                errors.append("item_code not found in Customer Item Master")

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


@frappe.whitelist()
def confirm_po_upload(rows):
    """
    Take validated rows (JSON string or list), group by po_no, and create PO Intake records.

    Returns
    -------
    {"created": N, "names": [...]}
    """
    rows = _parse_rows(rows)

    # Group by po_no
    po_groups = {}
    for row in rows:
        po_no = row.get("po_no")
        if not po_no:
            continue
        po_groups.setdefault(po_no, []).append(row)

    created = 0
    names = []

    for po_no, lines in po_groups.items():
        # Skip if already exists
        if frappe.db.exists("PO Intake", {"po_no": po_no}):
            continue

        # Use first line for header-level data
        first = lines[0]

        doc = frappe.new_doc("PO Intake")
        doc.po_no = po_no
        doc.publish_date = first.get("publish_date")
        doc.center_area = first.get("center_area")

        # Use customer from the uploaded row (selected by user in frontend)
        row_customer = first.get("customer")
        if row_customer:
            doc.customer = row_customer
        else:
            # Fallback: try project_code lookup
            project_code = first.get("project_code")
            if project_code:
                customer_name = frappe.db.get_value(
                    "Project Control Center", project_code, "customer"
                )
                if customer_name:
                    doc.customer = customer_name

        if not doc.customer:
            frappe.throw(f"Customer is required for PO {po_no}")
        if not frappe.db.exists("Customer", {"customer_name": doc.customer}) and not frappe.db.exists("Customer", doc.customer):
            frappe.throw(f"Customer does not exist: {doc.customer}")

        for line in lines:
            item_code = line.get("item_code")
            qty = flt(line.get("qty", 0))
            rate = flt(line.get("rate", 0))
            if qty <= 0 or rate <= 0:
                frappe.throw(f"Invalid qty/rate in PO {po_no} for item {item_code}")
            project_code = line.get("project_code")
            if project_code and not frappe.db.exists("Project Control Center", project_code):
                frappe.throw(f"Project code not found: {project_code}")
            cim_exists = frappe.db.exists(
                "Customer Item Master",
                {"item_code": item_code, "customer": doc.customer, "active_flag": 1},
            )
            if not cim_exists:
                frappe.throw(f"Customer Item Master missing for customer {doc.customer} and item {item_code}")

            doc.append(
                "po_lines",
                {
                    "po_line_no": cint(line.get("po_line_no") or 0),
                    "shipment_number": line.get("shipment_no"),
                    "poid": _make_poid(po_no, line.get("po_line_no"), line.get("shipment_no")),
                    "site_code": line.get("site_code"),
                    "site_name": line.get("site_name"),
                    "item_code": item_code,
                    "item_description": line.get("item_description"),
                    "qty": qty,
                    "rate": rate,
                    "line_amount": flt(line.get("line_amount", 0)) or (qty * rate),
                    "project_code": line.get("project_code"),
                },
            )

        doc.insert(ignore_permissions=True, ignore_links=True)
        frappe.db.commit()
        created += 1
        names.append(doc.name)

        # Auto-dispatch lines whose project has a team/IM assigned
        # Build (child_row_name, line_dict) pairs from the inserted doc
        child_pairs = []
        for child_row, src_line in zip(doc.po_lines, lines):
            child_pairs.append((child_row.name, src_line))
        auto_count = _try_auto_dispatch(doc.name, po_no, child_pairs)
        if auto_count:
            frappe.db.commit()

    return {"created": created, "names": names}


@frappe.whitelist()
def list_po_intake_lines(status="New"):
    """
    Return PO Intake child lines that match given po_line_status (or all when status='all').
    Each row is enriched with parent PO Intake fields and, for dispatched lines, dispatch info.
    """
    filters = {}
    if status and status.lower() != "all":
        filters["po_line_status"] = status

    lines = frappe.get_all(
        "PO Intake Line",
        filters=filters,
        fields=[
            "name", "parent", "po_line_no", "poid", "shipment_number",
            "item_code", "item_description", "qty", "rate", "line_amount",
            "project_code", "site_code", "site_name", "area",
            "po_line_status", "activity_code", "dispatch_mode",
        ],
        order_by="parent desc, idx asc",
        limit_page_length=500,
    )

    # Enrich each line with PO-level info and dispatch assignment info
    parent_cache = {}
    for line in lines:
        parent_name = line.get("parent")
        if parent_name not in parent_cache:
            parent_cache[parent_name] = frappe.db.get_value(
                "PO Intake", parent_name, ["po_no", "customer"], as_dict=True
            ) or {}
        pdata = parent_cache[parent_name]
        line["po_no"] = pdata.get("po_no", "")
        line["customer"] = pdata.get("customer", "")
        line["po_intake"] = parent_name

        if line.get("po_line_status") == "Dispatched":
            dispatch_data = frappe.db.get_value(
                "PO Dispatch",
                {"po_intake": parent_name, "po_line_no": line.get("po_line_no")},
                ["name", "im", "team", "dispatch_mode", "target_month"],
                as_dict=True,
            ) or {}
            line["dispatch_name"] = dispatch_data.get("name")
            line["dispatched_im"] = dispatch_data.get("im")
            line["dispatched_team"] = dispatch_data.get("team")
            line["dispatch_target_month"] = dispatch_data.get("target_month")
            if not line.get("dispatch_mode"):
                line["dispatch_mode"] = dispatch_data.get("dispatch_mode")

    return lines


@frappe.whitelist()
def dispatch_po_lines(payload):
    """
    Dispatch PO lines to a team for a target month.

    payload = {
        "lines": [{"po_intake": "PIP-...", "item_code": "...", ...}],
        "team": "Team-01",
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
    team_id = payload.get("team")
    raw_month = payload.get("target_month") or ""
    # Handle "2026-04" from HTML month input -> "2026-04-01"
    if raw_month and len(raw_month) == 7:
        target_month = raw_month + "-01"
    else:
        target_month = raw_month
    planning_mode = payload.get("planning_mode", "Plan")

    # Resolve IM from INET Team master
    im = None
    team_type = None
    if team_id:
        team_doc = frappe.db.get_value(
            "INET Team", team_id, ["im", "team_type"], as_dict=True
        )
        if team_doc:
            im = team_doc.im
            team_type = team_doc.team_type

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

        # Validate project_code link exists — skip if not found
        if project_code and not frappe.db.exists("Project Control Center", project_code):
            project_code = None

        doc = frappe.new_doc("PO Dispatch")
        doc.po_intake = po_intake_name
        doc.po_no = po_no
        doc.po_line_no = po_line_no
        doc.item_code = item_code
        doc.item_description = item_description
        doc.qty = qty
        doc.rate = rate
        doc.line_amount = line_amount
        if project_code:
            doc.project_code = project_code
        doc.customer = customer
        doc.im = im
        doc.team = team_id
        doc.target_month = target_month
        doc.planning_mode = planning_mode
        doc.dispatch_status = "Dispatched"
        doc.dispatch_mode = "Manual"
        doc.center_area = center_area
        doc.site_code = site_code
        doc.site_name = site_name

        final_dispatch_name = _insert_po_dispatch_with_poid(doc, poid)

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
        "new_team": "team_id",      # optional — re-assign team
        "new_im": "im_name",        # optional — re-assign IM
        "target_mode": "Manual",    # "Manual" or "Auto" (default "Manual")
    }

    Returns {"converted": N}
    """
    if isinstance(payload, str):
        payload = frappe.parse_json(payload)

    scope = payload.get("scope", "lines")
    project_code = payload.get("project_code")
    line_names = payload.get("line_names") or []
    new_team = payload.get("new_team")
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
                if new_team:
                    update_vals["team"] = new_team
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
        "team": "TEAM-001",  # optional INET Team name (team_id); else uses dispatch.team
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

    if team_override and not frappe.db.exists("INET Team", team_override):
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
            ["name", "team", "line_amount", "im"],
            as_dict=True,
        )
        if not dispatch:
            continue

        target_team = team_override or dispatch.team
        if target_team and not frappe.db.exists("INET Team", target_team):
            frappe.throw(frappe._("Team {0} is not a valid INET Team").format(target_team))

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

        doc.insert(ignore_permissions=True)
        frappe.db.commit()

        # Update dispatch status (and team when explicitly chosen for planning)
        dispatch_updates = {"dispatch_status": "Planned"}
        if team_override:
            dispatch_updates["team"] = team_override
        frappe.db.set_value("PO Dispatch", dispatch_name, dispatch_updates, update_modified=False)

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
        elif qc == "Pass":
            updates["plan_status"] = "Completed"
        else:
            # Completed execution but QC still pending IM review.
            updates["plan_status"] = "In Execution"
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
    if s.lower() == "in progress":
        return "In Progress"
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
        ["item_code", "center_area"],
        as_dict=True,
    )
    if not dispatch or not dispatch.item_code:
        return 0.0

    is_hard = "hard" in (dispatch.center_area or "").lower()
    cim = frappe.db.get_value(
        "Customer Item Master",
        {"item_code": dispatch.item_code, "active_flag": 1},
        ["standard_rate_sar", "hard_rate_sar"],
        as_dict=True,
    )
    if not cim:
        return 0.0
    return flt(cim.hard_rate_sar if is_hard else cim.standard_rate_sar)


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
    else:
        # Create new
        rollout_plan = payload.get("rollout_plan")
        if not rollout_plan:
            frappe.throw("rollout_plan is required when creating a new Daily Execution.")

        rp = frappe.db.get_value(
            "Rollout Plan", rollout_plan, ["po_dispatch", "team"], as_dict=True
        )

        doc = frappe.new_doc("Daily Execution")
        doc.rollout_plan = rollout_plan
        doc.system_id = rp.po_dispatch if rp else None
        doc.team = rp.team if rp else None
        pd_name = frappe.db.get_value("Rollout Plan", rollout_plan, "po_dispatch")
        im_v = None
        if pd_name:
            im_v = frappe.db.get_value("PO Dispatch", pd_name, "im")
        if im_v and hasattr(doc, "im"):
            doc.im = im_v

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
    elif (doc.execution_status == "Completed") and (qc == "Pass"):
        _ensure_work_done_for_execution(doc.name)

    frappe.db.commit()
    return {"name": doc.name, "status": doc.execution_status}


def on_daily_execution_update(doc, method=None):
    """
    Hook guard: ensure Work Done exists for completed executions
    even when updates bypass portal APIs.
    """
    if not doc or not getattr(doc, "name", None):
        return
    if str(getattr(doc, "execution_status", "") or "") != "Completed":
        return
    qc = str(getattr(doc, "qc_status", "") or "")
    if qc != "Pass":
        return
    _ensure_work_done_for_execution(doc.name)


def on_daily_execution_after_insert(doc, method=None):
    """Same as on_update for first-time inserts submitted as Completed."""
    on_daily_execution_update(doc, method=method)


@frappe.whitelist()
def generate_work_done(execution_name):
    """
    Create a Work Done record from a completed Daily Execution.

    Returns
    -------
    {"name": ...}
    """
    exec_doc = frappe.get_doc("Daily Execution", execution_name)

    if exec_doc.execution_status != "Completed":
        frappe.throw(
            f"Execution {execution_name} is not Completed (status: {exec_doc.execution_status})."
        )

    # Check if Work Done already exists
    existing = frappe.db.get_value("Work Done", {"execution": execution_name}, "name")
    if existing:
        frappe.throw(f"Work Done already exists for execution {execution_name}: {existing}")

    # Trace back chain: execution → rollout_plan → po_dispatch
    rp_name = exec_doc.rollout_plan
    rp = frappe.db.get_value(
        "Rollout Plan", rp_name, ["po_dispatch", "visit_multiplier"], as_dict=True
    )
    if not rp:
        frappe.throw(f"Rollout Plan {rp_name} not found.")

    dispatch_name = rp.po_dispatch
    dispatch = frappe.db.get_value(
        "PO Dispatch",
        dispatch_name,
        ["item_code", "center_area", "project_code", "customer", "team"],
        as_dict=True,
    )
    if not dispatch:
        frappe.throw(f"PO Dispatch {dispatch_name} not found.")

    item_code = dispatch.item_code
    center_area = dispatch.center_area or ""
    team_id = dispatch.team

    # Determine billing_rate from Customer Item Master
    is_hard = "hard" in center_area.lower() if center_area else False
    billing_rate = 0.0
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

    plans = frappe.get_all(
        "Rollout Plan",
        filters=rp_filters,
        fields=[
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
        ],
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
        drows = frappe.get_all(
            "PO Dispatch",
            filters={"name": ["in", dispatch_names]},
            fields=["name", "po_no", "item_code", "item_description", "project_code", "site_name", "site_code"],
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
                "gps_location": ex.gps_location if ex else None,
                "modified": p.modified,
            }
        )
    return out


@frappe.whitelist()
def list_work_done_rows(filters=None):
    """
    Rich Work Done rows for PM page.
    filters: { billing_status, from_date, to_date, team, project_code }
    """
    if isinstance(filters, str):
        filters = frappe.parse_json(filters)
    filters = filters or {}

    wd_filters = {}
    if filters.get("billing_status"):
        wd_filters["billing_status"] = filters["billing_status"]

    rows = frappe.get_all(
        "Work Done",
        filters=wd_filters,
        fields=[
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
        ],
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
        rp_rows = frappe.get_all(
            "Rollout Plan",
            filters={"name": ["in", plan_names]},
            fields=["name", "po_dispatch", "plan_date", "visit_type"],
            limit_page_length=1000,
        )
        rp_map = {r.name: r for r in rp_rows}

    dispatch_names = [r.po_dispatch for r in rp_map.values() if r.po_dispatch]
    pd_map = {}
    if dispatch_names:
        pd_rows = frappe.get_all(
            "PO Dispatch",
            filters={"name": ["in", dispatch_names]},
            fields=["name", "po_no", "project_code", "site_name", "team", "item_description"],
            limit_page_length=1000,
        )
        pd_map = {p.name: p for p in pd_rows}

    out = []
    for r in rows:
        ex = ex_map.get(r.execution)
        rp = rp_map.get(ex.rollout_plan) if ex and ex.rollout_plan else None
        pd = pd_map.get(rp.po_dispatch) if rp and rp.po_dispatch else None
        team = (pd.team if pd else None) or (ex.team if ex else None)
        project_code = pd.project_code if pd else None
        if filters.get("team") and team != filters["team"]:
            continue
        if filters.get("project_code") and project_code != filters["project_code"]:
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
                "team": team,
                "item_description": pd.item_description if pd else None,
                "execution_date": ex_date,
                "execution_status": ex.execution_status if ex else None,
                "plan_date": rp.plan_date if rp else None,
                "visit_type": rp.visit_type if rp else None,
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
    inet_monthly_target = flt(pcc_targets[0].total if pcc_targets else 0) or 465000.0

    inet_target_today = (inet_monthly_target * day_of_month) / days_in_month

    inet_achieved_rows = frappe.db.sql(
        """
        SELECT COALESCE(SUM(wd.revenue_sar), 0) AS total
        FROM `tabWork Done` wd
        JOIN `tabDaily Execution` exe ON exe.name = wd.execution
        JOIN `tabRollout Plan` rp ON rp.name = exe.rollout_plan
        JOIN `tabPO Dispatch` pd ON pd.name = rp.po_dispatch
        JOIN `tabINET Team` it ON it.name = pd.team
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
    sub_target = 354000.0  # default from Excel

    sub_revenue_rows = frappe.db.sql(
        """
        SELECT COALESCE(SUM(wd.revenue_sar), 0) AS rev,
               COALESCE(SUM(wd.total_cost_sar), 0) AS cost,
               COALESCE(AVG(wd.inet_margin_pct), 0) AS avg_margin
        FROM `tabWork Done` wd
        JOIN `tabDaily Execution` exe ON exe.name = wd.execution
        JOIN `tabRollout Plan` rp ON rp.name = exe.rollout_plan
        JOIN `tabPO Dispatch` pd ON pd.name = rp.po_dispatch
        JOIN `tabINET Team` it ON it.name = pd.team
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
        SELECT pd.team, COALESCE(SUM(wd.revenue_sar), 0) AS revenue
        FROM `tabWork Done` wd
        JOIN `tabDaily Execution` exe ON exe.name = wd.execution
        JOIN `tabRollout Plan` rp ON rp.name = exe.rollout_plan
        JOIN `tabPO Dispatch` pd ON pd.name = rp.po_dispatch
        WHERE exe.execution_date BETWEEN %s AND %s
        GROUP BY pd.team
        ORDER BY revenue DESC
        LIMIT 5
        """,
        (first_day, last_day),
        as_dict=True,
    )

    # ---- IM performance ----------------------------------------------------
    im_perf = frappe.db.sql(
        """
        SELECT it.im,
               COUNT(DISTINCT pd.team) AS team_count,
               COALESCE(SUM(wd.revenue_sar), 0) AS revenue,
               COALESCE(SUM(wd.total_cost_sar), 0) AS cost
        FROM `tabWork Done` wd
        JOIN `tabDaily Execution` exe ON exe.name = wd.execution
        JOIN `tabRollout Plan` rp ON rp.name = exe.rollout_plan
        JOIN `tabPO Dispatch` pd ON pd.name = rp.po_dispatch
        JOIN `tabINET Team` it ON it.name = pd.team
        WHERE exe.execution_date BETWEEN %s AND %s
        AND it.im IS NOT NULL
        GROUP BY it.im
        """,
        (first_day, last_day),
        as_dict=True,
    )
    for row in im_perf:
        row["profit"] = flt(row.revenue) - flt(row.cost)

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
    rows = frappe.db.sql(
        f"""
        SELECT rp.name, rp.po_dispatch AS system_id, rp.po_dispatch, rp.team, rp.plan_date, rp.visit_type,
               rp.visit_number, rp.visit_multiplier, rp.target_amount, rp.achieved_amount,
               rp.completion_pct, rp.plan_status,
               pd.im AS dispatch_im, pd.site_code, pd.po_no, pd.project_code, pd.item_code
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
    rows = frappe.db.sql(
        f"""
        SELECT de.name, rp.po_dispatch AS system_id, de.rollout_plan, de.team, de.execution_date,
               de.execution_status, de.achieved_qty, de.achieved_amount, de.gps_location,
               de.qc_status, {ciag_sel} AS ciag_status, de.revisit_flag,
               pd.im AS dispatch_im, pd.site_code, pd.po_no
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
def reopen_rollout_for_revisit(rollout_plan, issue_category=None, planning_route="standard"):
    """
    Re-visit workflow: move job back to planning. planning_route:
    'standard' -> plan_status Planned; 'with_issue' -> Planning with Issue.
    Non-completed executions for this plan are cancelled.
    """
    if not rollout_plan or not frappe.db.exists("Rollout Plan", rollout_plan):
        frappe.throw("Invalid Rollout Plan")

    route = (planning_route or "standard").lower().replace(" ", "_")
    if route in ("with_issue", "planning_with_issue", "issue"):
        new_status = "Planning with Issue"
    else:
        new_status = "Planned"

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
        JOIN `tabPO Dispatch` pd ON pd.name = rp.po_dispatch
        WHERE pd.team IN ({placeholders})
        AND exe.execution_date BETWEEN %s AND %s
        """,
        tuple(team_ids) + (first_day, last_day),
        as_dict=True,
    )
    revenue = flt(revenue_rows[0].revenue if revenue_rows else 0)
    cost = flt(revenue_rows[0].cost if revenue_rows else 0)

    # Monthly target — sum from projects assigned to this IM's teams
    monthly_target_rows = frappe.db.sql(
        f"""
        SELECT COALESCE(SUM(pcc.monthly_target), 0) AS total
        FROM `tabProject Control Center` pcc
        JOIN `tabPO Dispatch` pd ON pd.project_code = pcc.name
        WHERE pd.team IN ({placeholders})
        AND pcc.active_flag = 'Yes'
        """,
        tuple(team_ids),
        as_dict=True,
    )
    monthly_target = flt(monthly_target_rows[0].total if monthly_target_rows else 0) or 465000.0
    target_today = (monthly_target * day_of_month) / days_in_month
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
        JOIN `tabPO Dispatch` pd ON pd.name = rp.po_dispatch
        WHERE pd.team IN ({placeholders})
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
            SELECT name, item_code, item_description, project_code, site_name, site_code, center_area
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

@frappe.whitelist()
def get_project_summary(project_code):
    """Get complete project summary with all related records."""
    if not project_code:
        frappe.throw("project_code is required")

    project = frappe.get_doc("Project Control Center", project_code).as_dict()

    # PO Dispatches for this project
    dispatches = frappe.get_all("PO Dispatch",
        filters={"project_code": project_code},
        fields=["name", "po_no", "po_line_no", "item_code", "item_description",
                "qty", "rate", "line_amount", "team", "im", "dispatch_status", "center_area"],
        order_by="modified desc",
        limit_page_length=500)

    # Get dispatch names for downstream queries
    dispatch_names = [d.name for d in dispatches]

    # Rollout Plans
    plans = []
    if dispatch_names:
        plans = frappe.get_all("Rollout Plan",
            filters={"po_dispatch": ["in", dispatch_names]},
            fields=["name", "po_dispatch", "team", "plan_date", "visit_type",
                    "visit_multiplier", "target_amount", "achieved_amount", "completion_pct", "plan_status"],
            order_by="plan_date desc",
            limit_page_length=500)

    # Daily Executions
    plan_names = [p.name for p in plans]
    executions = []
    if plan_names:
        executions = frappe.get_all("Daily Execution",
            filters={"rollout_plan": ["in", plan_names]},
            fields=["name", "rollout_plan", "team", "execution_date",
                    "execution_status", "achieved_qty", "achieved_amount", "qc_status"],
            order_by="execution_date desc",
            limit_page_length=500)
        plan_poid_map = {p.name: p.po_dispatch for p in plans}
        for e in executions:
            e["system_id"] = plan_poid_map.get(e.rollout_plan)

    # Work Done
    execution_names = [e.name for e in executions]
    work_done = []
    if execution_names:
        work_done = frappe.get_all("Work Done",
            filters={"execution": ["in", execution_names]},
            fields=["name", "execution", "item_code", "executed_qty",
                    "billing_rate_sar", "revenue_sar", "team_cost_sar", "subcontract_cost_sar",
                    "total_cost_sar", "margin_sar", "billing_status"],
            limit_page_length=500)
        exec_poid_map = {e.name: e.get("system_id") for e in executions}
        for wd in work_done:
            wd["system_id"] = exec_poid_map.get(wd.execution)

    # Teams involved — merge from dispatches + Team Assignment doctype
    dispatch_teams = set(d.team for d in dispatches if d.team)

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

    return {
        "project": project,
        "dispatches": dispatches,
        "plans": plans,
        "executions": executions,
        "work_done": work_done,
        "teams": team_details,
        "team_assignments": team_assignments,
        "financial_summary": {
            "total_po_value": total_po_value,
            "total_revenue": total_revenue,
            "total_cost": total_cost,
            "total_margin": total_margin,
            "dispatch_count": len(dispatches),
            "plan_count": len(plans),
            "execution_count": len(executions),
            "work_done_count": len(work_done),
        }
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
