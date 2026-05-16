"""Material Management API — Huawei Outbound Import, Material Requests, Stock Entries."""
import os
import re
from datetime import datetime

import frappe
from frappe.utils import flt, cint, getdate, nowdate


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
def import_huawei_outbound(file_url=None):
    """Import Huawei Outbound Plan from uploaded Excel file.

    Reads sheet ``orderQuery``, parses 9 columns, inserts Huawei Outbound Plan
    documents skipping duplicates by bill_no.  Returns summary counts.
    """
    roles = set(frappe.get_roles(frappe.session.user))
    if not roles & {"Administrator", "System Manager", "Stock Manager"}:
        frappe.throw("Only Stock Manager, System Manager, or Administrator can import.", frappe.PermissionError)

    if not file_url:
        frappe.throw("file_url is required")

    # Frappe's FileUploader returns file_url like "/private/files/filename.xlsx"
    # or "/files/filename.xlsx". Convert to absolute site path.
    file_path = file_url
    if file_url.startswith("/private/files/"):
        file_path = os.path.join(frappe.get_site_path("private", "files"), file_url[len("/private/files/"):])
    elif file_url.startswith("/files/"):
        file_path = os.path.join(frappe.get_site_path("public", "files"), file_url[len("/files/"):])
    elif not os.path.isabs(file_url):
        file_path = frappe.get_site_path(file_url.lstrip("/"))

    if not os.path.exists(file_path):
        frappe.throw(f"File not found: {file_path}")

    filename = os.path.basename(file_path)
    outbound_date = _parse_outbound_date(filename)

    try:
        import openpyxl
    except ImportError:
        frappe.throw("openpyxl is required. Run: pip install openpyxl")

    wb = openpyxl.load_workbook(file_path, data_only=True)
    if "orderQuery" not in wb.sheetnames:
        frappe.throw(f"Sheet 'orderQuery' not found. Available sheets: {', '.join(wb.sheetnames)}")

    ws = wb["orderQuery"]
    if ws.max_row < 2:
        frappe.throw("File has no data rows (only header).")

    # Map header row to column indices
    header = {}
    for col in range(1, ws.max_column + 1):
        val = str(ws.cell(1, col).value or "").strip()
        if val:
            header[val] = col

    required = ["Bill No.", "Request No.", "Project Name", "Subcon"]
    for req in required:
        if req not in header:
            frappe.throw(f"Required column '{req}' not found in Excel. Found: {list(header.keys())}")

    def _cell(row, name):
        c = header.get(name)
        if c is None:
            return ""
        v = ws.cell(row, c).value
        return str(v).strip() if v is not None else ""

    # Build import batch identifier
    import_batch = f"{filename} ({nowdate()})"

    total_rows = 0
    new_rows = 0
    duplicates = 0
    inet_count = 0
    inet_bills = []

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

        # Ensure Huawei Subcon Master record exists
        subcon_link = None
        if subcon_name:
            if not frappe.db.exists("Huawei Subcon Master", subcon_name):
                try:
                    frappe.get_doc({
                        "doctype": "Huawei Subcon Master",
                        "subcon_name": subcon_name,
                        "status": "Active",
                    }).insert(ignore_permissions=True)
                except Exception:
                    pass
            subcon_link = subcon_name

        # Ensure DU ID in DUID Master
        duid_link = None
        if du_id:
            if not frappe.db.exists("DUID Master", du_id):
                try:
                    frappe.get_doc({
                        "doctype": "DUID Master",
                        "duid": du_id,
                    }).insert(ignore_permissions=True)
                except Exception:
                    pass
            duid_link = du_id

        # Look up Project Control Center by name (project_code) or project_name field
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

        doc = frappe.get_doc({
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
            "import_file": file_url,
        })
        doc.insert(ignore_permissions=True)
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
        "outbound_date": outbound_date,
        "filename": filename,
        "import_batch": import_batch,
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
    """When a Stock Entry (Material Receipt) is submitted, find matching
    Huawei Outbound Plan records by duid and link + update status."""
    if doc.stock_entry_type != "Material Receipt":
        return

    # Collect DU IDs from the Stock Entry items
    du_ids = set()
    for item in doc.items:
        d = (item.get("duid") or "").strip()
        if d:
            du_ids.add(d)

    if not du_ids:
        return

    # Find Outbound Plan records that match these DU IDs and aren't linked yet
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
