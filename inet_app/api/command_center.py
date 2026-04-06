"""
Command Center API — Pipeline Operations & Dashboard Aggregation
for inet_app (Frappe 15)
"""

import calendar
import json

import frappe
from frappe.utils import (
    cint,
    flt,
    get_first_day,
    get_last_day,
    getdate,
    nowdate,
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
        dispatch.insert(ignore_permissions=True)
        dispatch.db_set("system_id", dispatch.name, update_modified=False)

        frappe.db.set_value(
            "PO Intake Line",
            child_doc_name,
            {"po_line_status": "Dispatched", "dispatch_mode": "Auto"},
            update_modified=False,
        )
        count += 1

    return count


# ---------------------------------------------------------------------------
# Task 12 — Pipeline Operations
# ---------------------------------------------------------------------------


@frappe.whitelist()
def upload_po_file(file_url):
    """
    Parse an uploaded Huawei PO export (.xlsx) and return validated / error rows.

    Returns
    -------
    {"valid_rows": [...], "error_rows": [...], "total": N}
    """
    try:
        import openpyxl
    except ImportError:
        frappe.throw("openpyxl is not installed. Run `bench pip install openpyxl`.")

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

    wb = openpyxl.load_workbook(file_path, data_only=True)
    ws = wb.active

    rows_iter = ws.iter_rows(values_only=True)

    # First row = headers
    raw_headers = next(rows_iter, None)
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
        if qty <= 0:
            errors.append("qty must be > 0")

        if errors:
            row_dict["_row"] = row_idx
            row_dict["_errors"] = errors
            error_rows.append(row_dict)
        else:
            row_dict["qty"] = qty
            row_dict["rate"] = flt(row_dict.get("rate", 0))
            row_dict["line_amount"] = flt(row_dict.get("line_amount", 0))
            # Check if item exists in the Item master
            item_code = str(row_dict.get("item_code") or "").strip()
            row_dict["item_exists"] = bool(
                item_code and frappe.db.exists("Item", item_code)
            )
            # Check if project exists in Project Control Center
            project_code = str(row_dict.get("project_code") or "").strip()
            row_dict["project_exists"] = bool(
                project_code and frappe.db.exists("Project Control Center", project_code)
            )
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
            doc.customer = frappe.db.get_value("Customer", {}, "name") or "Unknown"

        for line in lines:
            item_code = line.get("item_code")
            # Auto-create item if it doesn't exist in Item master
            if item_code and not frappe.db.exists("Item", str(item_code)):
                if not frappe.db.exists("Item Group", "Telecom Services"):
                    frappe.get_doc({"doctype": "Item Group", "item_group_name": "Telecom Services", "parent_item_group": "All Item Groups"}).insert(ignore_permissions=True)
                frappe.get_doc({
                    "doctype": "Item",
                    "item_code": str(item_code),
                    "item_name": str(line.get("item_description") or item_code)[:140],
                    "item_group": "Telecom Services",
                    "stock_uom": "Nos",
                    "is_stock_item": 0,
                    "description": str(line.get("item_description") or ""),
                }).insert(ignore_permissions=True)

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
                    "qty": flt(line.get("qty", 0)),
                    "rate": flt(line.get("rate", 0)),
                    "line_amount": flt(line.get("line_amount", 0)),
                    "project_code": line.get("project_code"),
                },
            )

        # Auto-create customer if it doesn't exist
        if doc.customer and not frappe.db.exists("Customer", {"customer_name": doc.customer}):
            frappe.get_doc({"doctype": "Customer", "customer_name": doc.customer, "customer_type": "Company"}).insert(ignore_permissions=True)

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
    {"created": N, "system_ids": [...]}
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
    system_ids = []

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

        doc.insert(ignore_permissions=True)
        doc.db_set("system_id", doc.name, update_modified=False)

        # Mark the PO Intake Line as "Dispatched"
        if line_child_name:
            frappe.db.set_value(
                "PO Intake Line", line_child_name,
                {"po_line_status": "Dispatched", "dispatch_mode": "Manual"},
                update_modified=False,
            )

        frappe.db.commit()
        created += 1
        system_ids.append(doc.name)

    return {"created": created, "system_ids": system_ids}


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
    visit_type = payload.get("visit_type", "Work Done")

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
            ["name", "system_id", "team", "line_amount"],
            as_dict=True,
        )
        if not dispatch:
            continue

        doc = frappe.new_doc("Rollout Plan")
        doc.po_dispatch = dispatch_name
        doc.system_id = dispatch.system_id or dispatch_name
        doc.team = dispatch.team
        doc.plan_date = plan_date
        doc.visit_type = visit_type
        doc.visit_multiplier = visit_multiplier
        doc.target_amount = flt(dispatch.line_amount) * visit_multiplier
        doc.plan_status = "Planned"

        doc.insert(ignore_permissions=True)
        frappe.db.commit()

        # Update dispatch status
        frappe.db.set_value("PO Dispatch", dispatch_name, "dispatch_status", "Planned")

        created += 1
        names.append(doc.name)

    return {"created": created, "names": names}


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
            "Rollout Plan", rollout_plan, ["system_id", "team"], as_dict=True
        )

        doc = frappe.new_doc("Daily Execution")
        doc.rollout_plan = rollout_plan
        doc.system_id = rp.system_id if rp else None
        doc.team = rp.team if rp else None

    # Apply updatable fields
    for field in [
        "execution_date",
        "execution_status",
        "achieved_qty",
        "achieved_amount",
        "gps_location",
        "qc_status",
        "revisit_flag",
        "remarks",
        "activity_code",
    ]:
        if field in payload:
            setattr(doc, field, payload[field])

    # Auto-fetch activity cost when activity_code is set
    if payload.get("activity_code"):
        acm_cost = frappe.db.get_value(
            "Activity Cost Master", payload["activity_code"], "base_cost_sar"
        )
        doc.activity_cost_sar = flt(acm_cost or 0)

    if doc.is_new():
        doc.insert(ignore_permissions=True)
    else:
        doc.save(ignore_permissions=True)

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

    # ---- Watchlist (action items) ------------------------------------------
    watchlist = []
    if idle_teams_count > 0:
        watchlist.append(
            {"type": "warning", "message": f"{idle_teams_count} team(s) have no activity today."}
        )
    if inet_gap_today > 0:
        watchlist.append(
            {"type": "danger", "message": f"INET gap today: SAR {inet_gap_today:,.0f}"}
        )
    if sub_gap > 0:
        watchlist.append(
            {"type": "danger", "message": f"Subcon gap: SAR {sub_gap:,.0f}"}
        )
    if not watchlist:
        watchlist.append({"type": "success", "message": "All targets on track."})

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


@frappe.whitelist()
def get_im_dashboard(im=None):
    """
    Similar to get_command_dashboard but filtered to a single IM.
    If im is None, auto-detect from the logged-in user's full_name.

    Returns a dashboard dict scoped to that IM.
    """
    if not im:
        # Try resolving from IM Master by user account first
        if frappe.db.table_exists("tabIM Master"):
            im_rec = frappe.get_all(
                "IM Master", filters={"user": frappe.session.user, "status": "Active"},
                fields=["name"], limit=1
            )
            if im_rec:
                im = im_rec[0].name
        if not im:
            im = frappe.db.get_value("User", frappe.session.user, "full_name")
    if not im:
        frappe.throw("Could not resolve IM. Please pass im parameter.")

    today_str = nowdate()
    today = getdate(today_str)
    first_day, last_day, _ = _month_bounds()
    days_in_month = _days_in_month(today)
    day_of_month = today.day

    # Teams belonging to this IM
    teams = frappe.get_all(
        "INET Team",
        filters={"im": im, "status": "Active"},
        fields=["name", "team_id", "team_type", "daily_cost"],
    )
    team_ids = [t.name for t in teams]

    if not team_ids:
        return {
            "im": im,
            "teams": [],
            "message": "No active teams found for this IM.",
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
        "im": im,
        "teams": teams,
        "kpi": {
            "monthly_target": monthly_target,
            "target_today": target_today,
            "revenue": revenue,
            "cost": cost,
            "profit": revenue - cost,
            "gap_today": gap_today,
            "active_teams_today": active_today,
            "total_teams": len(teams),
            "planned_activities": planned_activities,
        },
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
        frappe.throw("team_id is required.")

    # Rollout Plans for this team today
    plans = frappe.db.sql(
        """
        SELECT rp.name, rp.po_dispatch, rp.plan_date, rp.visit_type,
               rp.visit_number, rp.visit_multiplier, rp.target_amount,
               rp.achieved_amount, rp.completion_pct, rp.plan_status
        FROM `tabRollout Plan` rp
        WHERE rp.team = %s
        AND rp.plan_date = %s
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
        fields=["name", "system_id", "po_no", "po_line_no", "item_code", "item_description",
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
            fields=["name", "system_id", "po_dispatch", "team", "plan_date", "visit_type",
                    "visit_multiplier", "target_amount", "achieved_amount", "completion_pct", "plan_status"],
            order_by="plan_date desc",
            limit_page_length=500)

    # Daily Executions
    plan_names = [p.name for p in plans]
    executions = []
    if plan_names:
        executions = frappe.get_all("Daily Execution",
            filters={"rollout_plan": ["in", plan_names]},
            fields=["name", "system_id", "rollout_plan", "team", "execution_date",
                    "execution_status", "achieved_qty", "achieved_amount", "qc_status"],
            order_by="execution_date desc",
            limit_page_length=500)

    # Work Done
    execution_names = [e.name for e in executions]
    work_done = []
    if execution_names:
        work_done = frappe.get_all("Work Done",
            filters={"execution": ["in", execution_names]},
            fields=["name", "system_id", "execution", "item_code", "executed_qty",
                    "billing_rate_sar", "revenue_sar", "team_cost_sar", "subcontract_cost_sar",
                    "total_cost_sar", "margin_sar", "billing_status"],
            limit_page_length=500)

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
# Timesheet APIs — leveraging ERPNext Timesheet module
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
        # Get team IDs for the IM
        team_ids = set()
        if im_filter:
            im_teams = frappe.get_all(
                "INET Team", filters={"im": im_filter}, fields=["team_id"]
            )
            team_ids = {t.team_id for t in im_teams}
        if team_filter:
            team_ids.add(team_filter)

        if team_ids:
            # For now, check if the employee_name contains team reference
            # This is a basic filter — can be enhanced with custom fields
            filtered = []
            for ts in timesheets:
                emp_name = (ts.employee_name or "").lower()
                if any(tid.lower() in emp_name for tid in team_ids):
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
