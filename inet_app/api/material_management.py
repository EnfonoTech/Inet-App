"""Material Management API — Huawei Outbound Import, Material Requests, Stock Entries."""
import os
import re

import frappe
from frappe.utils import flt, now, nowdate


# Regex: "JDL Outbound Plan of HUAWEI CWH For 10th_May_2026.xlsx"
_FILENAME_DATE_RE = re.compile(
    r"For\s+(\d{1,2})(?:st|nd|rd|th)?[_\s]+(\w+)[_\s]+(\d{4})",
    re.IGNORECASE,
)

_MONTH_MAP = {
    "january": 1, "february": 2, "march": 3, "april": 4,
    "may": 5, "june": 6, "july": 7, "august": 8,
    "september": 9, "october": 10, "november": 11, "december": 12,
}


def _parse_outbound_date(filename):
    """Extract outbound date from filename like '...For 10th_May_2026.xlsx'."""
    m = _FILENAME_DATE_RE.search(filename)
    if not m:
        return nowdate()
    day = int(m.group(1))
    month_name = m.group(2).lower()
    year = int(m.group(3))
    month = _MONTH_MAP.get(month_name, 1)
    return f"{year}-{month:02d}-{day:02d}"


def _resolve_file_path(file_url):
    """Resolve a Frappe file_url to an absolute filesystem path."""
    from frappe.utils.file_manager import get_file_path
    try:
        path = get_file_path(file_url)
        if path and os.path.exists(path):
            return path
    except Exception:
        pass
    if file_url.startswith("/private/files/"):
        return os.path.join(frappe.get_site_path("private", "files"), file_url[len("/private/files/"):])
    elif file_url.startswith("/files/"):
        return os.path.join(frappe.get_site_path("public", "files"), file_url[len("/files/"):])
    return file_url


@frappe.whitelist()
def start_huawei_outbound_import(name):
    """Start processing a Huawei Outbound Import record (called from form button)."""
    frappe.only_for(["System Manager", "Stock Manager"])
    doc = frappe.get_doc("Huawei Outbound Import", name)
    if doc.status not in ("Draft", "Failed"):
        frappe.throw(f"Cannot start import in status '{doc.status}'.")

    frappe.db.set_value("Huawei Outbound Import", name, "status", "Processing")
    frappe.db.commit()

    try:
        file_path = _resolve_file_path(doc.file)
        result = import_huawei_outbound_from_doc(file_path, doc.outbound_date)

        inet_bills = result.get("inet_bills", [])
        frappe.db.set_value("Huawei Outbound Import", name, {
            "status": "Completed",
            "total_rows": result.get("total_rows", 0),
            "new_rows": result.get("new_rows", 0),
            "inet_count": result.get("inet_count", 0),
            "duplicates_skipped": result.get("duplicates_skipped", 0),
        })
        frappe.db.commit()

        summary = f"Total: {result.get('total_rows', 0)} | New: {result.get('new_rows', 0)} | INET: {result.get('inet_count', 0)} | Dups: {result.get('duplicates_skipped', 0)}"
        summary += f"\nProjects: {result.get('project_matched', 0)} matched, {result.get('project_missing', 0)} not found"
        frappe.msgprint(summary, title="Import Summary", indicator="green")

        if inet_bills:
            lines = "\n".join(f"{b['bill_no']} | {b['du_id']} | Vol: {b['total_volume']}" for b in inet_bills[:50])
            frappe.msgprint(f"<pre>INET Bills ({len(inet_bills)}):\n{lines}</pre>", title="INET Bills in This Import")

        return {"status": "Completed", "inet_count": len(inet_bills)}

    except Exception as e:
        frappe.db.set_value("Huawei Outbound Import", name, {
            "status": "Failed",
            "error_message": str(e)[:5000],
        })
        frappe.db.commit()
        frappe.log_error(frappe.get_traceback(), "Huawei Outbound Import failed")
        raise


def import_huawei_outbound_from_doc(file_path=None, outbound_date=None):
    """Import from a local file path (called from Huawei Outbound Import doctype).

    Returns dict with counts — does NOT throw on duplicate rows, just skips them.
    """
    # Resolve file path: Frappe stores file_url like "/private/files/x.xlsx"
    if file_path and (file_path.startswith("/private/files/") or file_path.startswith("/files/")):
        if file_path.startswith("/private/files/"):
            file_path = os.path.join(frappe.get_site_path("private", "files"), file_path[len("/private/files/"):])
        else:
            file_path = os.path.join(frappe.get_site_path("public", "files"), file_path[len("/files/"):])

    if not file_path or not os.path.exists(file_path):
        raise FileNotFoundError(f"File not found: {file_path}")

    filename = os.path.basename(file_path)
    if not outbound_date:
        outbound_date = _parse_outbound_date(filename)

    try:
        import openpyxl
    except ImportError:
        raise ImportError("openpyxl is required. Run: pip install openpyxl")

    wb = openpyxl.load_workbook(file_path, data_only=True)
    if "orderQuery" not in wb.sheetnames:
        raise ValueError(f"Sheet 'orderQuery' not found. Available: {', '.join(wb.sheetnames)}")

    ws = wb["orderQuery"]
    if ws.max_row < 2:
        raise ValueError("File has no data rows")

    header = {}
    for col in range(1, ws.max_column + 1):
        val = str(ws.cell(1, col).value or "").strip()
        if val:
            header[val] = col

    required = ["Bill No.", "Request No.", "Subcon"]
    for req in required:
        if req not in header:
            raise ValueError(f"Required column '{req}' not found in Excel. Found: {list(header.keys())}")

    # Warn if optional columns are missing
    optional = ["Project Name", "DU ID", "Customer Site ID", "Delivery Purpose", "Status"]
    missing_optional = [c for c in optional if c not in header]
    if missing_optional:
        frappe.msgprint(f"Optional columns not found in Excel: {', '.join(missing_optional)}. These fields will be empty.", title="Missing Columns", indicator="blue")

    def _cell(row, name):
        c = header.get(name)
        if c is None:
            return ""
        v = ws.cell(row, c).value
        return str(v).strip() if v is not None else ""

    import_batch = f"{filename} ({frappe.utils.nowdate()})"
    total_rows = 0
    new_rows = 0
    duplicates = 0
    inet_count = 0
    inet_bills = []
    project_matched = 0
    project_missing = 0

    for row in range(2, ws.max_row + 1):
        bill_no = _cell(row, "Bill No.")
        if not bill_no:
            continue
        total_rows += 1

        if frappe.db.exists("Huawei Outbound Plan", bill_no):
            duplicates += 1
            continue

        subcon_name = _cell(row, "Subcon")
        du_id = _cell(row, "DU ID")
        project = _cell(row, "Project Name")
        row_status = _cell(row, "Status") or "Prepared"

        # Ensure Subcon Master
        if subcon_name and not frappe.db.exists("Huawei Subcon Master", subcon_name):
            try:
                frappe.get_doc({
                    "doctype": "Huawei Subcon Master",
                    "subcon_name": subcon_name,
                    "status": "Active",
                }).insert(ignore_permissions=True)
            except Exception:
                pass

        # Ensure DUID Master
        if du_id and not frappe.db.exists("DUID Master", du_id):
            try:
                frappe.get_doc({
                    "doctype": "DUID Master",
                    "duid": du_id,
                }).insert(ignore_permissions=True)
            except Exception:
                pass

        # Look up Project Control Center — first by name (project_code), then by project_name field
        project_link = None
        if project:
            if frappe.db.exists("Project Control Center", project):
                project_link = project
                project_matched += 1
            elif frappe.db.exists("Project Control Center", {"project_name": project}):
                project_link = frappe.db.get_value("Project Control Center", {"project_name": project}, "name")
                project_matched += 1
            else:
                project_missing += 1
        else:
            project_missing += 1

        # Look up DUID Master
        duid_link = None
        if du_id and frappe.db.exists("DUID Master", du_id):
            duid_link = du_id

        is_inet = subcon_name.strip().upper() == "INET"

        frappe.get_doc({
            "doctype": "Huawei Outbound Plan",
            "bill_no": bill_no,
            "request_no": _cell(row, "Request No."),
            "outbound_date": outbound_date,
            "project_name": project or "",
            "project": project_link or None,
            "subcon": subcon_name if subcon_name else None,
            "outbound_status": row_status,
            "du_id": du_id or "",
            "duid_master": duid_link or None,
            "customer_site_id": _cell(row, "Customer Site ID"),
            "delivery_purpose": _cell(row, "Delivery Purpose"),
            "total_volume": flt(_cell(row, "Total Volume")),
            "import_batch": import_batch,
        }).insert(ignore_permissions=True)
        new_rows += 1
        if is_inet:
            inet_count += 1
            inet_bills.append({
                "bill_no": bill_no,
                "request_no": _cell(row, "Request No."),
                "du_id": du_id,
                "total_volume": _cell(row, "Total Volume"),
            })

    frappe.db.commit()
    return {
        "total_rows": total_rows,
        "new_rows": new_rows,
        "duplicates_skipped": duplicates,
        "inet_count": inet_count,
        "inet_bills": inet_bills,
        "project_matched": project_matched,
        "project_missing": project_missing,
        "outbound_date": str(outbound_date),
        "filename": filename,
    }


@frappe.whitelist()
def create_material_receipt_from_outbound(bill_no):
    """Open a new Stock Entry (Material Receipt) linked to a Huawei Outbound Plan.

    Returns a redirect URL to the new Stock Entry form. Items and qty are entered
    manually by the user. The Outbound Plan link is pre-filled on the Stock Entry.
    """
    roles = set(frappe.get_roles(frappe.session.user))
    if not roles & {"Administrator", "System Manager", "Stock Manager"}:
        frappe.throw("Only Stock Manager or Administrator can create material receipts.", frappe.PermissionError)

    if not frappe.db.exists("Huawei Outbound Plan", bill_no):
        frappe.throw(f"Huawei Outbound Plan {bill_no} not found.")

    plan = frappe.get_doc("Huawei Outbound Plan", bill_no)
    if (plan.subcon or "").strip().upper() != "INET":
        frappe.throw("Material Receipt can only be created for INET items.")

    if plan.material_receipt:
        frappe.throw(f"Material Receipt already exists: {plan.material_receipt}")

    du_id = plan.du_id or ""

    new_se_url = (
        f"/app/stock-entry/new-stock-entry"
        f"?stock_entry_type=Material Receipt"
        f"&huawei_outbound_plan={bill_no}"
        f"&duid={du_id}"
    )
    return {
        "redirect_url": new_se_url,
        "du_id": du_id,
    }


def on_stock_entry_submit(doc, method=None):
    """When a Material Receipt is submitted, link the Huawei Outbound Plan
    and set its status to Received.

    Primary: uses huawei_outbound_plan field on the Stock Entry header.
    Fallback: matches by duid field on items for receipts without a header link.
    """
    if doc.stock_entry_type != "Material Receipt":
        return

    plan_name = (doc.get("huawei_outbound_plan") or "").strip()
    if plan_name and frappe.db.exists("Huawei Outbound Plan", plan_name):
        subcon = frappe.db.get_value("Huawei Outbound Plan", plan_name, "subcon")
        if (subcon or "").strip().upper() == "INET":
            frappe.db.set_value("Huawei Outbound Plan", plan_name, {
                "material_receipt": doc.name,
                "outbound_status": "Received",
            })
            frappe.db.commit()
        return

    # Fallback: match unlinked INET plans by duid on items
    du_ids = {(item.duid or "").strip() for item in doc.items if (item.duid or "").strip()}
    if not du_ids:
        return

    for du_id in du_ids:
        plans = frappe.db.get_all("Huawei Outbound Plan",
            filters={
                "du_id": du_id,
                "subcon": "INET",
                "material_receipt": ["in", ["", None]],
            },
            pluck="name",
        )
        for plan_name in plans:
            frappe.db.set_value("Huawei Outbound Plan", plan_name, {
                "material_receipt": doc.name,
                "outbound_status": "Received",
            })

    frappe.db.commit()


# ─── Phase 2: Material Request (INET) ────────────────────────────────────────

@frappe.whitelist()
def list_material_requests(im=None, status=None, limit=50):
    """List Material Request INET records.

    IM users see only their own requests. Stock Manager / Admin see all.
    """
    roles = set(frappe.get_roles(frappe.session.user))
    is_admin = bool(roles & {"Administrator", "System Manager", "Stock Manager", "INET Admin"})

    filters = {}
    if not is_admin:
        im_name = frappe.db.get_value("IM Master", {"user": frappe.session.user}, "name")
        if im_name:
            filters["im"] = im_name
        else:
            return []

    if im:
        filters["im"] = im
    if status:
        filters["request_status"] = status

    rows = frappe.db.get_all(
        "Material Request INET",
        filters=filters,
        fields=[
            "name", "request_date", "requested_by", "im", "poid", "duid",
            "request_status", "team", "team_warehouse", "source_warehouse",
            "approved_by", "approved_on", "stock_entry_transfer",
            "stock_entry_issue", "remark", "rejection_reason",
        ],
        order_by="request_date desc, creation desc",
        limit=int(limit),
    )
    return rows


@frappe.whitelist()
def get_material_request(name):
    """Get a single Material Request INET with its items."""
    roles = set(frappe.get_roles(frappe.session.user))
    doc = frappe.get_doc("Material Request INET", name)

    is_admin = bool(roles & {"Administrator", "System Manager", "Stock Manager", "INET Admin"})
    if not is_admin:
        im_name = frappe.db.get_value("IM Master", {"user": frappe.session.user}, "name")
        if doc.im != im_name:
            frappe.throw("Not permitted.", frappe.PermissionError)

    return {
        "name": doc.name,
        "request_date": str(doc.request_date or ""),
        "requested_by": doc.requested_by,
        "im": doc.im,
        "poid": doc.poid,
        "duid": doc.duid,
        "request_status": doc.request_status,
        "team": doc.team,
        "team_warehouse": doc.team_warehouse,
        "source_warehouse": doc.source_warehouse,
        "remark": doc.remark,
        "rejection_reason": doc.rejection_reason,
        "approved_by": doc.approved_by,
        "approved_on": str(doc.approved_on or ""),
        "stock_entry_transfer": doc.stock_entry_transfer,
        "stock_entry_issue": doc.stock_entry_issue,
        "items": [
            {
                "item_code": i.item_code,
                "item_name": i.item_name,
                "qty": i.qty,
                "uom": i.uom,
                "valuation_rate": i.valuation_rate,
            }
            for i in doc.items
        ],
    }


@frappe.whitelist()
def get_poid_details(poid):
    """Fetch PO Dispatch details for auto-fill in new request form."""
    if not frappe.db.exists("PO Dispatch", poid):
        frappe.throw(f"PO Dispatch {poid} not found.")
    row = frappe.db.get_value(
        "PO Dispatch", poid,
        ["poid", "site_code", "im", "project_code"],
        as_dict=True,
    )
    return row


@frappe.whitelist()
def create_material_request(payload):
    """Create a new Material Request INET. Called by IM from the portal."""
    import json
    roles = set(frappe.get_roles(frappe.session.user))
    if not roles & {"Administrator", "System Manager", "Stock Manager", "INET Admin", "INET IM"}:
        frappe.throw("Not permitted to create material requests.", frappe.PermissionError)

    data = json.loads(payload) if isinstance(payload, str) else payload

    items = data.get("items") or []
    if not items:
        frappe.throw("At least one item is required.")

    if not data.get("team_warehouse"):
        frappe.throw("Team Warehouse is required.")

    im = data.get("im") or frappe.db.get_value("IM Master", {"user": frappe.session.user}, "name")

    doc = frappe.get_doc({
        "doctype": "Material Request INET",
        "request_date": data.get("request_date") or nowdate(),
        "requested_by": frappe.session.user,
        "im": im,
        "poid": data.get("poid"),
        "duid": data.get("duid") or "",
        "team": data.get("team"),
        "team_warehouse": data["team_warehouse"],
        "source_warehouse": data.get("source_warehouse") or "Stores - INET",
        "request_status": "Pending Approval",
        "remark": data.get("remark") or "",
        "items": [
            {
                "item_code": i["item_code"],
                "qty": flt(i.get("qty", 0)),
                "uom": i.get("uom") or "",
                "valuation_rate": flt(i.get("valuation_rate", 0)),
            }
            for i in items
        ],
    })
    doc.insert(ignore_permissions=True)
    frappe.db.commit()
    return {"name": doc.name, "status": doc.request_status}


@frappe.whitelist()
def approve_material_request(name):
    """Stock Manager approves a Material Request → creates Material Transfer Stock Entry."""
    frappe.only_for(["System Manager", "Stock Manager"])

    doc = frappe.get_doc("Material Request INET", name)
    if doc.request_status != "Pending Approval":
        frappe.throw(f"Cannot approve a request in status '{doc.request_status}'.")

    if not doc.items:
        frappe.throw("No items on this request.")

    se_items = []
    for item in doc.items:
        se_items.append({
            "item_code": item.item_code,
            "qty": item.qty,
            "uom": item.uom or frappe.db.get_value("Item", item.item_code, "stock_uom"),
            "s_warehouse": doc.source_warehouse,
            "t_warehouse": doc.team_warehouse,
            "duid": doc.duid or "",
            "valuation_rate": item.valuation_rate or 0,
        })

    se = frappe.get_doc({
        "doctype": "Stock Entry",
        "stock_entry_type": "Material Transfer",
        "purpose": "Material Transfer",
        "from_warehouse": doc.source_warehouse,
        "to_warehouse": doc.team_warehouse,
        "poid": doc.poid or "",
        "items": se_items,
    })
    se.insert(ignore_permissions=True)
    se.submit()

    frappe.db.set_value("Material Request INET", name, {
        "request_status": "Approved",
        "approved_by": frappe.session.user,
        "approved_on": now(),
        "stock_entry_transfer": se.name,
    })
    frappe.db.commit()
    return {"name": name, "stock_entry": se.name, "status": "Approved"}


@frappe.whitelist()
def reject_material_request(name, reason=None):
    """Stock Manager rejects a Material Request."""
    frappe.only_for(["System Manager", "Stock Manager"])

    doc = frappe.get_doc("Material Request INET", name)
    if doc.request_status != "Pending Approval":
        frappe.throw(f"Cannot reject a request in status '{doc.request_status}'.")

    frappe.db.set_value("Material Request INET", name, {
        "request_status": "Rejected",
        "approved_by": frappe.session.user,
        "approved_on": now(),
        "rejection_reason": reason or "",
    })
    frappe.db.commit()
    return {"name": name, "status": "Rejected"}


@frappe.whitelist()
def issue_materials_for_work_done(name):
    """Create Material Issue Stock Entry when work is done for a request."""
    frappe.only_for(["System Manager", "Stock Manager"])

    doc = frappe.get_doc("Material Request INET", name)
    if doc.request_status != "Approved":
        frappe.throw(f"Cannot issue materials for a request in status '{doc.request_status}'.")
    if not doc.stock_entry_transfer:
        frappe.throw("No Material Transfer found. Approve the request first.")

    se_items = []
    for item in doc.items:
        se_items.append({
            "item_code": item.item_code,
            "qty": item.qty,
            "uom": item.uom or frappe.db.get_value("Item", item.item_code, "stock_uom"),
            "s_warehouse": doc.team_warehouse,
            "duid": doc.duid or "",
            "valuation_rate": item.valuation_rate or 0,
        })

    se = frappe.get_doc({
        "doctype": "Stock Entry",
        "stock_entry_type": "Material Issue",
        "purpose": "Material Issue",
        "from_warehouse": doc.team_warehouse,
        "poid": doc.poid or "",
        "items": se_items,
    })
    se.insert(ignore_permissions=True)
    se.submit()

    frappe.db.set_value("Material Request INET", name, {
        "request_status": "Issued",
        "stock_entry_issue": se.name,
    })
    frappe.db.commit()
    return {"name": name, "stock_entry": se.name, "status": "Issued"}
