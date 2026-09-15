"""Material Management API — Huawei Outbound Import, Material Requests, Stock Entries."""
import os
import re

import frappe
from frappe.utils import cint, flt, now, nowdate

from inet_app.setup import ACCOUNTING_DUID_FIELDNAME


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


def _existing_material_receipt_for_bill(bill_no):
    """Any non-cancelled Material Receipt Stock Entry already linked to this
    bill — via the item-level Batch (batch = bill, see
    _get_or_create_huawei_batch), not a header field. A Draft receipt
    already sitting there still counts as "existing" (not just a submitted
    one) — otherwise it would look "not yet received" and let a second,
    duplicate receipt get created alongside it.
    """
    rows = frappe.db.sql(
        """SELECT se.name
           FROM `tabStock Entry` se
           JOIN `tabStock Entry Detail` sed ON sed.parent = se.name
           JOIN `tabBatch` b ON b.name = sed.batch_no
           WHERE se.stock_entry_type = 'Material Receipt'
             AND se.docstatus != 2
             AND b.reference_doctype = 'Huawei Outbound Plan'
             AND b.reference_name = %s
           LIMIT 1""",
        (bill_no,), as_dict=True,
    )
    return rows[0]["name"] if rows else None


@frappe.whitelist()
def create_material_receipt_from_outbound(bill_no):
    """Open a new Stock Entry (Material Receipt) for a Huawei Outbound Plan.

    Returns a redirect URL to the new Stock Entry form. Items and qty are
    entered manually by the user; DUID auto-fill and per-item batch tagging
    (batch = bill, via get_or_create_batch_for_bill_item) are driven
    client-side (stock_entry.js) off `frm.doc.bill_no_hint` — a virtual,
    never-persisted field that exists only to survive Frappe's own
    route-options/URL clearing on page load. There's no stored field
    carrying the bill onto the Stock Entry itself, only each item's own
    Batch does that.
    """
    roles = set(frappe.get_roles(frappe.session.user))
    if not roles & {"Administrator", "System Manager", "Stock Manager"}:
        frappe.throw("Only Stock Manager or Administrator can create material receipts.", frappe.PermissionError)

    if not frappe.db.exists("Huawei Outbound Plan", bill_no):
        frappe.throw(f"Huawei Outbound Plan {bill_no} not found.")

    plan = frappe.get_doc("Huawei Outbound Plan", bill_no)
    if (plan.subcon or "").strip().upper() != "INET":
        frappe.throw("Material Receipt can only be created for INET items.")

    existing = _existing_material_receipt_for_bill(bill_no)
    if existing:
        frappe.throw(f"Material Receipt already exists: {existing}")

    # Prefer the Link field (duid_master) over the Data field (du_id); the Link
    # field is always the canonical DUID Master record name. Fall back to du_id
    # for plans imported before duid_master was populated.
    du_id = (plan.duid_master or plan.du_id or "").strip()

    # bill_no_hint matches a real (if virtual/hidden) field name, so
    # Frappe's own get_new_doc() copies it onto the new doc's in-memory
    # object before clearing route_options — see Stock Entry-bill_no_hint
    # in setup.py for why a plain `?bill_no=` URL param doesn't survive.
    new_se_url = (
        f"/app/stock-entry/new-stock-entry"
        f"?stock_entry_type=Material Receipt"
        f"&bill_no_hint={bill_no}"
    )
    return {
        "redirect_url": new_se_url,
        "du_id": du_id,
    }


_HUAWEI_ITEM_GROUP = "Huawei Materials"


def _ensure_huawei_item_group():
    """Create the dedicated Item Group for Huawei-supplied stock, once."""
    if frappe.db.exists("Item Group", _HUAWEI_ITEM_GROUP):
        return _HUAWEI_ITEM_GROUP
    root = frappe.db.get_value("Item Group", {"is_group": 1, "parent_item_group": ""}, "name")
    frappe.get_doc({
        "doctype": "Item Group",
        "item_group_name": _HUAWEI_ITEM_GROUP,
        "parent_item_group": root,
        "is_group": 0,
    }).insert(ignore_permissions=True)
    return _HUAWEI_ITEM_GROUP


def _ensure_uom(unit):
    """Create the UOM if the Excel's unit text doesn't already exist as one."""
    unit = (unit or "Nos").strip() or "Nos"
    if not frappe.db.exists("UOM", unit):
        try:
            frappe.get_doc({"doctype": "UOM", "uom_name": unit}).insert(ignore_permissions=True)
        except Exception:
            if not frappe.db.exists("UOM", unit):
                raise
    return unit


def _get_or_create_huawei_item(item_code, description="", unit=""):
    """Return an existing Item code as-is, or create a new customer-provided
    stock Item for Huawei-supplied material. Never touches an Item that
    already exists — this only fills in items missing from the system.

    The Huawei customer record is never hardcoded (it may be named
    differently on another site) — it comes from INET Settings, and creation
    is refused with a clear message if that isn't configured yet.
    """
    item_code = str(item_code).strip()
    if item_code.endswith(".0") and item_code[:-2].isdigit():
        item_code = item_code[:-2]  # openpyxl reads a bare numeric code as a float
    if not item_code:
        frappe.throw("Item Code is required in the import file.")

    if frappe.db.exists("Item", item_code):
        return item_code

    customer = frappe.db.get_single_value("INET Settings", "huawei_customer")
    if not customer:
        frappe.throw(
            f"Item {item_code} does not exist and INET Settings has no Huawei Customer "
            "configured to create it against. Set 'Huawei Customer' in INET Settings, "
            "or create the Item manually first."
        )

    item_group = _ensure_huawei_item_group()
    stock_uom = _ensure_uom(unit)
    description = (description or item_code).strip()
    frappe.get_doc({
        "doctype": "Item",
        "item_code": item_code,
        "item_name": description[:140],
        "description": description,
        "item_group": item_group,
        "stock_uom": stock_uom,
        "is_stock_item": 1,
        "is_customer_provided_item": 1,
        "is_purchase_item": 0,  # ERPNext forbids a customer-provided item from also being purchasable
        "customer": customer,
        "has_batch_no": 1,  # one Batch per (bill, item) — see _get_or_create_huawei_batch
    }).insert(ignore_permissions=True)
    return item_code


def _get_or_create_huawei_batch(bill_no, item_code):
    """One Batch per (bill, item) — the batch IS the bill, for that item.
    Batch.item is required and batch_id must be globally unique, so a single
    bill spanning several items needs one Batch per item, not one per bill.
    reference_doctype/reference_name (already on core Batch, unused by core
    ERPNext) is the formal, queryable link back to the bill.
    """
    batch_id = f"{bill_no}::{item_code}"
    if frappe.db.exists("Batch", batch_id):
        return batch_id
    frappe.get_doc({
        "doctype": "Batch",
        "batch_id": batch_id,
        "item": item_code,
        "reference_doctype": "Huawei Outbound Plan",
        "reference_name": bill_no,
    }).insert(ignore_permissions=True)
    return batch_id


def _batch_row_fields(bill_no, item_code):
    """Stock Entry Detail fields to attach when this item is batch-tracked —
    {} if not (e.g. Company/Additional items, which are never bill-tracked).
    """
    if not frappe.get_cached_value("Item", item_code, "has_batch_no"):
        return {}
    return {
        "batch_no": _get_or_create_huawei_batch(bill_no, item_code),
        "use_serial_batch_fields": 1,
    }


@frappe.whitelist()
def get_or_create_batch_for_bill_item(bill_no, item_code):
    """Client-side helper for the manual "Create Material Receipt" form
    (stock_entry.js) — resolves/creates the same (bill, item) Batch the
    automated Huawei MR Import path uses, so a manually-added item row gets
    the identical batch tagging. Returns None for a non-batch-tracked item
    (e.g. a Company/Additional item added by mistake on a Huawei receipt).
    """
    frappe.only_for(["System Manager", "Stock Manager"])
    if not frappe.db.exists("Huawei Outbound Plan", bill_no):
        frappe.throw(f"Huawei Outbound Plan {bill_no} not found.")
    if not frappe.get_cached_value("Item", item_code, "has_batch_no"):
        return None
    return _get_or_create_huawei_batch(bill_no, item_code)


def parse_mr_import_excel(file_path):
    """Parse a Huawei MR-configuration Excel (packing-list shape: Item Code,
    Item Description, Unit, Config. Qty., Ship Qty, C/L No., Box No., Remark).

    Returns a list of dicts, one per non-blank data row, in file order.
    """
    try:
        import openpyxl
    except ImportError:
        raise ImportError("openpyxl is required. Run: pip install openpyxl")

    if not file_path or not os.path.exists(file_path):
        raise FileNotFoundError(f"File not found: {file_path}")

    wb = openpyxl.load_workbook(file_path, data_only=True)
    ws = wb[wb.sheetnames[0]]
    if ws.max_row < 2:
        raise ValueError("File has no data rows")

    header = {}
    for col in range(1, ws.max_column + 1):
        val = str(ws.cell(1, col).value or "").strip()
        if val:
            header[val] = col

    required = ["Item Code", "Ship Qty"]
    missing = [r for r in required if r not in header]
    if missing:
        raise ValueError(f"Required column(s) not found in Excel: {', '.join(missing)}. Found: {list(header.keys())}")

    def _cell(row, name):
        col = header.get(name)
        return ws.cell(row, col).value if col is not None else None

    def _s(v):
        # Source Excel uses \xa0 (non-breaking space) as its word separator
        # in descriptions, not a plain space — a browser never wraps text at
        # one, so a long description renders as a single unbreakable run
        # that overflows its container instead of wrapping normally.
        return str(v).replace("\xa0", " ").strip() if v is not None else ""

    rows = []
    for row in range(2, ws.max_row + 1):
        item_code = _cell(row, "Item Code")
        if item_code is None or _s(item_code) == "":
            continue
        rows.append({
            "item_code": _s(item_code),
            "item_description": _s(_cell(row, "Item Description")),
            "unit": _s(_cell(row, "Unit")) or "Nos",
            "config_qty": flt(_cell(row, "Config. Qty.")),
            "ship_qty": flt(_cell(row, "Ship Qty")),
            "cl_no": _s(_cell(row, "C/L No.")),
            "box_no": _s(_cell(row, "Box No.")),
            "remark": _s(_cell(row, "Remark")),
        })

    if not rows:
        raise ValueError("No data rows with an Item Code were found in the file.")
    return rows


def _check_bill_eligible(bill_no):
    """Eligibility checks for auto-creating a Material Receipt against this
    bill — the same rules the manual create_material_receipt_from_outbound
    flow already uses (INET subcon only, not already received).

    Returns (plan_doc, None) if eligible, or (None, skip_message).
    """
    if not frappe.db.exists("Huawei Outbound Plan", bill_no):
        return None, f"No Huawei Outbound Plan found for bill '{bill_no}'. Import the header-level Outbound Import first."

    plan = frappe.get_doc("Huawei Outbound Plan", bill_no)
    if (plan.subcon or "").strip().upper() != "INET":
        return None, f"Bill '{bill_no}' is not an INET subcon bill — skipped."
    existing = _existing_material_receipt_for_bill(bill_no)
    if existing:
        return None, f"Material Receipt already exists: {existing}"
    return plan, None


def _build_receipt_rows_for_bill(plan, bill_rows, to_warehouse):
    """Aggregate one bill's rows by item code (summing Ship Qty), resolve or
    create each Item, and tag every row with its (bill, item) Batch — the
    Batch is what carries the bill-linkage now (no header field), so several
    bills' rows can be safely combined into one shared Stock Entry by the
    caller without losing which bill each item came from.

    Returns (se_items, combined_notice) — doesn't touch Stock Entry itself.
    """
    bill_no = plan.name
    agg = {}
    for r in bill_rows:
        a = agg.setdefault(r["item_code"], {
            "qty": 0.0, "unit": r["unit"], "item_description": r["item_description"], "rows": 0,
        })
        a["qty"] += flt(r["ship_qty"])
        a["rows"] += 1

    combined = [
        f"{code} ({a['rows']} rows → qty {a['qty']:g})"
        for code, a in agg.items() if a["rows"] > 1
    ]
    combined_notice = ("Combined from multiple rows: " + ", ".join(combined)) if combined else "No rows were combined."

    # Same priority the manual create_material_receipt_from_outbound flow
    # uses: the Link field (duid_master) is the canonical DUID Master record
    # name, du_id is only a fallback for plans imported before duid_master
    # was populated.
    du_id = (plan.duid_master or plan.du_id or "").strip()

    se_items = []
    for code, a in agg.items():
        resolved_code = _get_or_create_huawei_item(code, a["item_description"], a["unit"])
        item_uom = frappe.db.get_value("Item", resolved_code, "stock_uom") or a["unit"] or "Nos"
        row = {
            "item_code": resolved_code,
            "qty": a["qty"],
            "uom": item_uom,
            "t_warehouse": to_warehouse,
        }
        if du_id:
            row["to_duid"] = du_id
        row.update(_batch_row_fields(bill_no, resolved_code))
        se_items.append(row)

    return se_items, combined_notice


@frappe.whitelist()
def preview_huawei_mr_import(name):
    """Parse a Huawei MR Import's Excel WITHOUT creating anything, and report
    which bills (C/L No.) have no matching Huawei Outbound Plan, already
    have a receipt, or aren't an INET bill — so the caller can warn the user
    BEFORE any Material Receipt is auto-created, not just after the fact.
    """
    frappe.only_for(["System Manager", "Stock Manager"])
    doc = frappe.get_doc("Huawei MR Import", name)
    if not doc.file:
        frappe.throw("Attach the Excel file first.")

    file_path = _resolve_file_path(doc.file)
    rows = parse_mr_import_excel(file_path)

    by_bill = {}
    blank_cl_rows = 0
    for r in rows:
        bill_no = r["cl_no"]
        if not bill_no:
            blank_cl_rows += 1
            continue
        by_bill.setdefault(bill_no, []).append(r)

    eligible, missing, already_received, wrong_subcon = [], [], [], []
    for bill_no in by_bill:
        if not frappe.db.exists("Huawei Outbound Plan", bill_no):
            missing.append(bill_no)
            continue
        plan = frappe.db.get_value(
            "Huawei Outbound Plan", bill_no, ["subcon"], as_dict=True
        )
        if (plan.subcon or "").strip().upper() != "INET":
            wrong_subcon.append(bill_no)
        elif _existing_material_receipt_for_bill(bill_no):
            already_received.append(bill_no)
        else:
            eligible.append(bill_no)

    return {
        "bill_count": len(by_bill),
        "eligible": eligible,
        "missing": missing,
        "already_received": already_received,
        "wrong_subcon": wrong_subcon,
        "blank_cl_rows": blank_cl_rows,
    }


@frappe.whitelist()
def start_huawei_mr_import(name):
    """Parse a Huawei MR Import's Excel and auto-create a Material Receipt
    for EVERY distinct bill found in the file — the Excel's C/L No. is the
    same bill identifier as Huawei Outbound Plan.bill_no, and one packing-
    list file commonly covers several bills/shipments at once.

    Each bill is processed independently: a problem with one (no matching
    Plan, wrong subcon, already received, item-creation failure, ...) is
    recorded as that bill's own result and never stops the others.
    """
    frappe.only_for(["System Manager", "Stock Manager"])
    doc = frappe.get_doc("Huawei MR Import", name)
    if doc.status not in ("Draft", "Failed", "No Receipts Created", "Partially Completed"):
        frappe.throw(f"Cannot start import in status '{doc.status}'.")

    # Clear any child rows left over from a previous run BEFORE this first
    # save, not after — a retry's leftover `results` rows can point to a
    # Material Receipt that's since been deleted, and Frappe validates every
    # Link field on save (untouched rows included), so saving with the old
    # rows still in place throws "Could not find Row #N: Material Receipt: ..."
    # before this function ever gets a chance to rebuild them.
    doc.set("items", [])
    doc.set("results", [])
    doc.status = "Processing"
    doc.flags.ignore_permissions = True
    doc.save()
    frappe.db.commit()

    try:
        file_path = _resolve_file_path(doc.file)
        rows = parse_mr_import_excel(file_path)

        # Preserve every raw row for audit before touching Items/Stock
        # Entries, so the data survives even if a later step fails.
        doc.set("items", [])
        for r in rows:
            doc.append("items", r)
        doc.save()
        frappe.db.commit()

        # Group by C/L No. — the Excel's bill identifier, matched 1:1
        # against Huawei Outbound Plan.bill_no.
        by_bill = {}
        blank_cl_rows = 0
        for r in rows:
            bill_no = r["cl_no"]
            if not bill_no:
                blank_cl_rows += 1
                continue
            by_bill.setdefault(bill_no, []).append(r)

        to_warehouse = frappe.db.get_single_value("INET Settings", "source_warehouse") or ""
        if not to_warehouse:
            frappe.throw("Configure the Main Store Warehouse in INET Settings before importing.")

        results = []
        created_count = 0
        skipped_count = 0
        combined_se_items = []
        eligible_bills = []  # bills that passed eligibility, pending the one shared Stock Entry

        for bill_no, bill_rows in by_bill.items():
            row_count = len(bill_rows)
            ship_qty_total = sum(flt(r["ship_qty"]) for r in bill_rows)
            try:
                plan, skip_message = _check_bill_eligible(bill_no)
                if not plan:
                    skipped_count += 1
                    results.append({
                        "bill_no": bill_no, "status": "Skipped", "row_count": row_count,
                        "ship_qty_total": ship_qty_total, "message": skip_message,
                    })
                    continue
                se_items, combined_notice = _build_receipt_rows_for_bill(plan, bill_rows, to_warehouse)
                combined_se_items.extend(se_items)
                eligible_bills.append({
                    "bill_no": bill_no, "row_count": row_count,
                    "ship_qty_total": ship_qty_total, "message": combined_notice,
                })
            except Exception as e:
                skipped_count += 1
                results.append({
                    "bill_no": bill_no, "status": "Failed", "row_count": row_count,
                    "ship_qty_total": ship_qty_total, "message": str(e)[:500],
                })

        # One combined Material Receipt for every eligible bill in this run —
        # each item row already carries its own (bill, item) Batch, so a
        # separate Stock Entry per bill would just be redundant documents
        # tracking the exact same information the batch already carries.
        if combined_se_items:
            try:
                se = frappe.get_doc({
                    "doctype": "Stock Entry",
                    "stock_entry_type": "Material Receipt",
                    "to_warehouse": to_warehouse,
                    "items": combined_se_items,
                })
                se.insert(ignore_permissions=True)
                if frappe.db.get_single_value("INET Settings", "auto_submit_huawei_material_receipt"):
                    se.submit()
                frappe.db.commit()
                material_receipt = se.name
                status, extra_message = "Created", None
            except Exception as e:
                material_receipt = None
                status, extra_message = "Failed", str(e)[:500]

            for b in eligible_bills:
                if status == "Created":
                    created_count += 1
                else:
                    skipped_count += 1
                results.append({
                    "bill_no": b["bill_no"], "status": status, "row_count": b["row_count"],
                    "ship_qty_total": b["ship_qty_total"], "material_receipt": material_receipt,
                    "message": extra_message or b["message"],
                })

        if blank_cl_rows:
            skipped_count += 1
            results.append({
                "bill_no": "(blank)",
                "status": "Skipped",
                "row_count": blank_cl_rows,
                "ship_qty_total": 0,
                "message": "Row has no C/L No. — cannot tell which bill it belongs to.",
            })

        doc.set("results", [])
        for res in results:
            doc.append("results", res)
        # "Completed" must mean EVERY bill actually got a receipt — a run
        # with any skips is only partial (and must stay retriable, e.g. once
        # the missing Outbound Plan is imported), not indistinguishable from
        # full success just because something got created.
        if created_count > 0 and skipped_count == 0:
            doc.status = "Completed"
        elif created_count > 0:
            doc.status = "Partially Completed"
        else:
            doc.status = "No Receipts Created"
        doc.bill_count = len(by_bill)
        doc.created_count = created_count
        doc.skipped_count = skipped_count
        doc.save()
        frappe.db.commit()

        summary = f"Bills found: {len(by_bill)} | Receipts created: {created_count} | Skipped: {skipped_count}"
        frappe.msgprint(summary, title="Import Summary", indicator="green" if created_count else "orange")

        return {
            "status": doc.status,
            "bill_count": len(by_bill),
            "created_count": created_count,
            "skipped_count": skipped_count,
        }

    except Exception as e:
        doc.status = "Failed"
        doc.error_message = str(e)[:5000]
        doc.save()
        frappe.db.commit()
        frappe.log_error(frappe.get_traceback(), "Huawei MR Import failed")
        raise


def stock_entry_has_permission(doc, ptype=None, user=None, debug=False):
    """Controller permission hook (see hooks.py `has_permission`) — DENIES
    submit/cancel of an outbound (main → team) Material Transfer to anyone
    except the receiving team's Team Lead or an Administrator/System Manager.

    Stock Manager needs broad submit/cancel on Stock Entry for Material
    Receipts and for confirming Returns (confirm_material_return), so that
    grant can't simply be removed. This hook is what actually stops a
    Warehouse Manager from bypassing the team's confirmation step by opening
    the staged Draft Stock Entry directly in Desk and clicking Submit —
    unlike the checks inside confirm_material_transfer()/
    reject_material_transfer_confirmation(), which only apply to that one
    code path, `has_permission` hooks are consulted by Frappe's core
    permission engine everywhere (Desk, REST API, bulk actions, ...).

    Per Frappe's contract, controllers can only DENY on top of the
    role-based grant, never grant beyond it — so returning None here always
    means "defer to normal rules" and this never affects read/write/create,
    Material Receipts, or Returns (t_warehouse = main warehouse).

    On denial this raises frappe.throw() with a plain-business-language
    message (instead of returning False) — a plain False here would surface
    as Frappe's generic "You need the 'submit' permission..." message, which
    doesn't explain WHY to a Warehouse Manager who normally does have that
    permission. Raising here propagates straight through Frappe's permission
    check (nothing downstream catches it), so this message is what the user
    actually sees.
    """
    if ptype not in ("submit", "cancel"):
        return None
    if doc.get("stock_entry_type") != "Material Transfer":
        return None

    source_wh = frappe.db.get_single_value("INET Settings", "source_warehouse") or ""
    team_warehouses = {
        i.t_warehouse for i in doc.items
        if i.t_warehouse and i.t_warehouse != source_wh
        and frappe.db.exists("INET Team", {"warehouse": i.t_warehouse})
    }
    if not team_warehouses:
        return None  # not an outbound-to-team transfer (e.g. a return into main)

    user = user or frappe.session.user
    roles = set(frappe.get_roles(user))
    if roles & {"Administrator", "System Manager"}:
        return None

    for wh in team_warehouses:
        field_user = frappe.db.get_value("INET Team", {"warehouse": wh}, "field_user")
        if field_user and field_user == user:
            return None  # the correct Team Lead — don't override

    team_names = ", ".join(
        frappe.db.get_value("INET Team", {"warehouse": wh}, "team_name") or wh
        for wh in team_warehouses
    )
    action = "submitted" if ptype == "submit" else "cancelled"
    frappe.throw(
        f"This transfer is staged and awaiting confirmation from {team_names}'s Team Lead — "
        f"it can only be {action} once they confirm receipt from the Field app. "
        f"If something needs to change, reject it back to Pending Approval instead of submitting it here.",
        frappe.PermissionError,
        title="Awaiting Team Confirmation",
    )


def before_stock_entry_insert(doc, method=None):
    """Auto-stage a Material Transfer Stock Entry that links back to a
    submitted (outbound or return) Material Request, regardless of how it
    was created.

    approve_material_request()/approve_material_return_request() already
    set confirmation_stage explicitly before insert — this only fires for
    Stock Entries created some OTHER way, e.g. a Warehouse Manager using
    ERPNext's own native "Create > Stock Entry" button directly on the
    Material Request form. Without this, such a Stock Entry would still be
    correctly blocked from submission by stock_entry_has_permission() (that
    check is structural, not dependent on this bookkeeping) but would never
    show up for the team to confirm and would carry no visible indication
    of why it's stuck — see the confirmation_stage banner in stock_entry.js.

    Also backstops DUID-aware batch selection for this same "created some
    other way" case. This MUST happen here, before insert, not at
    before_submit: ERPNext's own core validate() auto-creates a Serial and
    Batch Bundle for any batch-tracked row that still has an empty batch_no
    the very first time the doc is saved (i.e. during this insert) — using
    its own non-DUID-aware default pick. By before_submit that bundle
    already exists, and setting batch_no on top of it corrupts the row
    (confirmed by testing: wrong batch selected, submit fails/partially
    applies). Setting batch_no here, before that first validate() runs,
    is what approve_material_request() already does structurally (it sets
    batch_no on the in-memory doc before calling insert() at all) — this
    just does the same for a doc we didn't build ourselves.
    """
    if doc.stock_entry_type != "Material Transfer" or doc.get("confirmation_stage"):
        return

    mr_names = list({i.get("material_request") for i in doc.items if i.get("material_request")})
    if len(mr_names) != 1:
        return  # only handle the single-MR shape our flow always produces

    mr = frappe.db.get_value(
        "Material Request", mr_names[0],
        ["docstatus", "is_return_request", "pending_transfer_se", "duid", "poid"],
        as_dict=True,
    )
    if not mr or mr.docstatus != 1 or mr.pending_transfer_se:
        return

    doc.confirmation_stage = (
        "Awaiting Warehouse Confirmation" if mr.is_return_request else "Awaiting Team Confirmation"
    )
    doc.flags._inet_stage_mr = mr_names[0]

    duid = (mr.get("duid") or "").strip()
    if not duid and mr.get("poid"):
        duid = (frappe.db.get_value("PO Dispatch", mr.poid, "site_code") or "").strip()

    extra_rows = []
    for item in doc.items:
        if duid and not item.get("duid"):
            item.duid = duid
        if item.get("batch_no") or not item.get("s_warehouse"):
            continue
        extra_rows.extend(_auto_select_batch_for_row(item))
    for row in extra_rows:
        doc.append("items", row)


def after_stock_entry_insert(doc, method=None):
    """Companion to before_stock_entry_insert — backfill the Material
    Request's pending_transfer_se once the Stock Entry has its final name."""
    mr_name = doc.flags.get("_inet_stage_mr")
    if mr_name:
        frappe.db.set_value("Material Request", mr_name, "pending_transfer_se", doc.name)
        frappe.db.commit()


def before_stock_entry_submit(doc, method=None):
    """Fill DUID inventory dimension on Stock Entry items following the
    correct direction per entry type:

    - Material Receipt  → to_duid only   (stock arriving at a location)
    - Material Transfer → duid + to_duid (stock moving between locations)
    - Material Issue    → duid only      (stock leaving a location)

    Source is the linked Material Request's duid field, falling back to
    the PO Dispatch site_code via mr.poid.
    """
    se_type = doc.stock_entry_type
    if se_type not in ("Material Receipt", "Material Transfer", "Material Issue"):
        return

    set_source = se_type in ("Material Transfer", "Material Issue")
    set_target = se_type in ("Material Receipt", "Material Transfer")

    # Batch-resolve MR → DUID to avoid N+1 queries
    mr_names = list({item.get("material_request") for item in doc.items if item.get("material_request")})
    mr_duid_map = {}
    if mr_names:
        for mr_row in frappe.db.get_all(
            "Material Request",
            filters={"name": ["in", mr_names]},
            fields=["name", "duid", "poid"],
            ignore_permissions=True,
        ):
            duid = (mr_row.get("duid") or "").strip()
            if not duid:
                poid = mr_row.get("poid")
                if poid:
                    duid = (frappe.db.get_value("PO Dispatch", poid, "site_code") or "").strip()
            mr_duid_map[mr_row["name"]] = duid

    # For Material Receipt from Huawei Outbound Plan, use plan's DUID
    plan_duid = ""
    if se_type == "Material Receipt" and doc.get("huawei_outbound_plan"):
        plan = frappe.db.get_value(
            "Huawei Outbound Plan",
            doc.huawei_outbound_plan,
            ["duid_master", "du_id"],
            as_dict=True,
        ) or {}
        plan_duid = (plan.get("duid_master") or plan.get("du_id") or "").strip()

    for item in doc.items:
        mr_name = item.get("material_request")
        duid = mr_duid_map.get(mr_name) or plan_duid or ""
        if not duid:
            continue
        if set_source and not item.get("duid"):
            item.duid = duid
        if set_target and not item.get("to_duid"):
            item.to_duid = duid


def _clear_stale_confirmation_bookkeeping(doc):
    """A staged Material Transfer normally gets submitted through
    confirm_material_transfer()/confirm_material_return(), which clear
    confirmation_stage on the Stock Entry and pending_transfer_se on the
    Material Request as part of that same call. But Administrator/System
    Manager is allowed to submit a staged transfer directly (see the
    override in stock_entry_has_permission), bypassing that cleanup —
    leaving both fields stuck showing "awaiting confirmation" on a
    transfer that actually already completed. Clean up here so the state
    is correct regardless of which path did the submit.
    """
    if not doc.get("confirmation_stage"):
        return
    frappe.db.set_value("Stock Entry", doc.name, "confirmation_stage", "Confirmed")
    mr_names = {i.get("material_request") for i in doc.items if i.get("material_request")}
    for mr_name in mr_names:
        if frappe.db.get_value("Material Request", mr_name, "pending_transfer_se") == doc.name:
            frappe.db.set_value("Material Request", mr_name, "pending_transfer_se", "")
    frappe.db.commit()


def on_stock_entry_submit(doc, method=None):
    """When a Material Receipt is submitted, link the Huawei Outbound Plan(s)
    it covers and set their status to Received.

    Primary: derives the bill from each item's own Batch (batch = bill, see
    _get_or_create_huawei_batch) — both the automated Huawei MR Import and
    the manual "Create Material Receipt" form tag items this way; there is
    no header-level field carrying the bill anymore.
    Fallback: matches by duid field on items, for a receipt with no
    batch-tracked items at all (e.g. predates batch tracking, or is a fully
    ad-hoc Stock Entry).
    """
    if doc.stock_entry_type == "Material Transfer":
        _clear_stale_confirmation_bookkeeping(doc)

    if doc.stock_entry_type != "Material Receipt":
        return

    batch_nos = {item.batch_no for item in doc.items if item.get("batch_no")}
    bill_nos = set()
    if batch_nos:
        bill_nos = {
            r["reference_name"] for r in frappe.db.get_all(
                "Batch",
                filters={"name": ["in", list(batch_nos)], "reference_doctype": "Huawei Outbound Plan"},
                fields=["reference_name"],
            ) if r.get("reference_name")
        }

    if bill_nos:
        for plan_name in bill_nos:
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


def on_stock_entry_cancel(doc, method=None):
    """Reverse on_stock_entry_submit's Huawei Outbound Plan linkage when a
    Material Receipt is cancelled — status must follow the document
    automatically, not be left stuck at "Received" pointing at a cancelled
    entry. Frappe runs on_cancel BEFORE its own back-link check
    (Document.run_post_save_methods calls on_cancel first, then
    check_no_back_links_exist) — clearing the Plan's reference here is what
    lets the cancel itself go through instead of being blocked by that check.

    Matches by material_receipt = doc.name rather than re-deriving via
    huawei_outbound_plan/duid, so it correctly reverses whichever path
    (header link or DUID fallback) actually set it.
    """
    if doc.stock_entry_type != "Material Receipt":
        return

    plans = frappe.db.get_all("Huawei Outbound Plan",
        filters={"material_receipt": doc.name}, pluck="name")
    for plan_name in plans:
        frappe.db.set_value("Huawei Outbound Plan", plan_name, {
            "material_receipt": "",
            "outbound_status": "Prepared",
        })
    if plans:
        frappe.db.commit()


def on_stock_entry_trash(doc, method=None):
    """Deleting a staged Draft Transfer/Return directly (bypassing the
    formal reject flow, which already clears this itself) must not leave
    the originating Material Request's pending_transfer_se pointing at a
    document that no longer exists. Frappe runs on_trash BEFORE its own
    back-link check (delete_doc.delete_doc calls on_trash first, then
    check_if_doc_is_linked) — clearing the reference here is what lets the
    delete go through instead of being blocked by that check.
    """
    mr_names = frappe.db.get_all(
        "Material Request", filters={"pending_transfer_se": doc.name}, pluck="name")
    for mr_name in mr_names:
        frappe.db.set_value("Material Request", mr_name, "pending_transfer_se", "")
    if mr_names:
        frappe.db.commit()


# ─── Phase 2: Material Request — uses standard ERPNext Material Request ───────

def _request_status(status, transfer_status, has_pending_se=False, is_return=False):
    """Map ERPNext status + transfer_status to a portal-friendly label.

    A staged-but-unconfirmed transfer (pending_transfer_se set on the
    Material Request) sits between "Pending Approval" and "Transferred":
    the Stock Entry exists as a Draft, so transfer_status is still
    "Not Started" until the receiving side confirms and it gets submitted.
    """
    if status == "Cancelled":
        return "Rejected"
    if transfer_status == "Completed":
        return "Transferred"
    if has_pending_se:
        return "Pending Warehouse Confirmation" if is_return else "Pending Team Confirmation"
    if status in ("Submitted", "Pending") and transfer_status in ("Not Started", "", None):
        return "Pending Approval"
    return status or "Draft"


# Direct col_key -> Material Request field mappings, shared by the two column
# filter loops. Deliberately partial: "poid", "team" and "im" resolve through
# another doctype (dispatch names / warehouses) rather than a field on this
# one, so excel_orm_filter cannot express them and they stay substring-only.
def mr_column_options(col_key, base_filters=None, search=None, limit=500):
    """Excel-filter option list for a Material Request column.

    Handles the columns whose displayed value is not a field on this doctype:
    the linked POID / team name / IM full name, and the Python-computed
    Status label. Anything else falls through to the plain ORM path.
    """
    from inet_app.api.command_center import (
        _sql_like_pattern,
        excel_options_from_orm,
    )

    empty = {"values": [], "has_blanks": False, "total": 0, "supported": False}
    base = dict(base_filters or {})
    # The column being edited must not constrain its own option list.
    pat = _sql_like_pattern(search)
    lim = max(1, min(int(limit or 500), 2000))

    def _wrap(labels, has_blanks=False):
        labels = sorted({str(l) for l in labels if str(l or "").strip()})
        if pat:
            needle = str(search).strip().lower()
            labels = [l for l in labels if needle in l.lower()]
        return {
            "values": [{"value": l, "label": l} for l in labels[:lim]],
            "has_blanks": has_blanks,
            "total": len(labels),
            "supported": True,
        }

    def _mr_field_values(field):
        """Distinct values of a raw MR field under the caller's own filters."""
        return set(frappe.get_all(
            "Material Request", filters=base, pluck=field, distinct=True,
            limit_page_length=0,
        ) or [])

    if col_key in ("poid", "team", "im", "status"):
        # These four are shown as something other than what MR stores, so map
        # the stored keys (already scoped by `base`) to their display labels.
        if col_key == "poid":
            keys = {k for k in _mr_field_values("poid") if k}
            if not keys:
                return _wrap([])
            return _wrap(frappe.get_all(
                "PO Dispatch", filters=[["name", "in", list(keys)]],
                pluck="poid", distinct=True, limit_page_length=0) or [])
        if col_key == "team":
            whs = {w for w in _mr_field_values("set_warehouse") if w}
            if not whs:
                return _wrap([])
            return _wrap(frappe.get_all(
                "INET Team", filters=[["warehouse", "in", list(whs)]],
                pluck="team_name", distinct=True, limit_page_length=0) or [])
        if col_key == "im":
            ims = {i for i in _mr_field_values("im") if i}
            if not ims:
                return _wrap([])
            rows = frappe.get_all(
                "IM Master", filters=[["name", "in", list(ims)]],
                fields=["name", "user"], limit_page_length=0) or []
            names = {r["user"]: r["name"] for r in rows if r.get("user")}
            full = {}
            if names:
                for u in frappe.get_all("User", filters=[["name", "in", list(names)]],
                                        fields=["name", "full_name"], limit_page_length=0) or []:
                    full[names[u["name"]]] = u.get("full_name") or names[u["name"]]
            return _wrap([full.get(i, i) for i in ims])
        # status: _request_status() over the scoped rows — not a column, so
        # derive the labels exactly as the list function does.
        rows = frappe.get_all(
            "Material Request", filters=base,
            fields=["status", "transfer_status", "pending_transfer_se"],
            limit_page_length=0) or []
        return _wrap({
            _request_status(r.get("status"), r.get("transfer_status"),
                            has_pending_se=bool(r.get("pending_transfer_se")))
            for r in rows
        })

    fld = _MR_COL_FIELD.get(col_key)
    if not fld:
        return empty
    return excel_options_from_orm("Material Request", base, fld, search, limit)


def mr_apply_excel_link_filter(col_key, raw_val, filters):
    """Apply an Excel-style dict filter for a Material Request column whose
    displayed value lives on ANOTHER doctype.

    MR stores the PO Dispatch docname in `poid`, a warehouse in
    `set_warehouse` and an IM code in `im`, while the table shows the POID,
    the team name and the IM's full name. Resolve the picked labels back to
    the keys actually stored, mirroring the substring branches below.
    Returns True when it handled the column.
    """
    from inet_app.api.command_center import _sql_like_pattern

    vals = [str(x) for x in (raw_val.get("values") or []) if str(x or "").strip()]
    cpat = _sql_like_pattern(raw_val.get("contains"))
    if not vals and not cpat:
        return col_key in ("poid", "team", "im")

    def _resolve(sql_in, sql_like, field):
        out = set()
        if vals:
            ph = ", ".join(["%s"] * len(vals))
            out |= set(frappe.db.sql_list(sql_in.format(ph=ph), tuple(vals)) or [])
        if cpat:
            out |= set(frappe.db.sql_list(sql_like, (cpat,)) or [])
        filters[field] = ["in", list(out) or ["__none__"]]

    if col_key == "poid":
        _resolve("SELECT name FROM `tabPO Dispatch` WHERE poid IN ({ph})",
                 "SELECT name FROM `tabPO Dispatch` WHERE poid LIKE %s", "poid")
        return True
    if col_key == "team":
        _resolve("SELECT warehouse FROM `tabINET Team` WHERE team_name IN ({ph}) AND IFNULL(warehouse,'') != ''",
                 "SELECT warehouse FROM `tabINET Team` WHERE team_name LIKE %s AND IFNULL(warehouse,'') != ''",
                 "set_warehouse")
        return True
    if col_key == "im":
        existing = filters.get("im")
        tmp = {}
        _resolve("SELECT imm.name FROM `tabIM Master` imm INNER JOIN `tabUser` u ON u.name = imm.user WHERE u.full_name IN ({ph})",
                 "SELECT imm.name FROM `tabIM Master` imm INNER JOIN `tabUser` u ON u.name = imm.user WHERE u.full_name LIKE %s",
                 "im")
        tmp["im"] = filters["im"]
        if existing and not isinstance(existing, (list, tuple)):
            # Non-admin callers are already scoped to one IM — never widen it.
            filters["im"] = existing if existing in set(tmp["im"][1]) else ["in", ["__none__"]]
        return True
    return False


# ── Assembled-aggregate column filters ──────────────────────────────────
# The three stock tabs are built in Python (Bin lookups per warehouse, then
# enrichment), not by one SQL statement, so there is no WHERE to attach a
# clause to. Filtering therefore happens on the assembled rows — server-side,
# so the dropdown and the row payload both shrink, and so the option list is
# derived from the complete aggregate rather than whatever the page holds.
_STOCK_COL_FIELD = {
    "duid_stock": {
        "duid": "duid", "project": "project_name", "pending": "prepared_count",
        "received": "received_count", "transferred": "transferred_count",
        "completed": "completed_count", "volume_m": "total_volume",
        "latest_date": "latest_date",
    },
    "stock_balance": {
        "duid": "duid", "project": "project_name", "warehouse": "warehouse_label",
        # Item Code and Item Name are separate columns, so each filters on its own.
        "item_code": "item_code", "item_name": "item_name",
        "item": "item_code",   # legacy key, kept so saved filters still resolve
        "type": "warehouse_type", "qty": "qty", "uom": "uom",
    },
    "bill_wise": {
        "bill_no": "bill_no", "duid": "du_id", "project": "project_name",
        "item_code": "item_code", "item_name": "item_name",
        "item": "item_code",   # legacy key, kept so saved filters still resolve
        "warehouse": "warehouse", "current_qty": "current_qty",
        "received": "received_qty", "transferred": "transferred_qty",
        # The "Used" column renders issued_qty.
        "used": "issued_qty", "remaining": "remaining_qty",
        "uom": "uom", "outbound_date": "outbound_date",
        "status": "status",
    },
}


def _stock_limit_suffix(limit):
    """LIMIT clause for an aggregate query. 0 / None = no cap."""
    try:
        lim = int(limit)
    except (TypeError, ValueError):
        return ""
    return "" if lim <= 0 else f"LIMIT {lim}"


def stock_summary(rows, metrics):
    """Headline figures for an assembled (non-SQL) stock table.

    The three stock tables build their rows in Python, so unlike every other
    source there is no WHERE to hand to summary_from_query(). Feed this the
    rows AFTER filter_stock_rows() but BEFORE _stock_apply_limit(), and the
    figures describe the full filtered set no matter what the row limit is —
    the same guarantee the SQL-backed sources give.

    Each metric is {key, label, field?, agg: "count"|"sum"|"distinct"|"count_if",
    test?} plus the usual format/tone/group/hide_if_zero passed straight through.
    """
    out = []
    for m in metrics:
        agg = m.get("agg", "count")
        field = m.get("field")
        if agg == "count":
            val = len(rows)
        elif agg == "distinct":
            val = len({str(r.get(field)) for r in rows if str(r.get(field) or "").strip()})
        elif agg == "count_if":
            test = m.get("test") or (lambda r: False)
            val = sum(1 for r in rows if test(r))
        else:  # sum
            total = 0.0
            for r in rows:
                try:
                    total += float(r.get(field) or 0)
                except (TypeError, ValueError):
                    pass
            val = total
        fmt = m.get("format", "int")
        out.append({
            "key": m["key"], "label": m.get("label") or m["key"],
            "value": int(val) if fmt == "int" else float(val),
            "format": fmt, "tone": m.get("tone", "default"),
            "hint": m.get("hint", ""), "group": m.get("group", ""),
            "hide_if_zero": bool(m.get("hide_if_zero")),
        })
    return {"metrics": out, "supported": True}


def _stock_apply_limit(rows, limit):
    """Row-limit an assembled aggregate. Applied AFTER filtering so the
    selector means the same thing here as on every SQL-backed page: how many
    of the MATCHING rows to return. 0 / None = no cap.
    """
    try:
        lim = int(limit)
    except (TypeError, ValueError):
        return rows
    return rows if lim <= 0 else rows[:lim]


def _stock_row_matches(row, field, raw_val):
    """True when one assembled row passes one column filter."""
    val = "" if row.get(field) is None else str(row.get(field))
    if isinstance(raw_val, dict):
        vals = [str(x) for x in (raw_val.get("values") or []) if str(x or "").strip()]
        blanks = bool(raw_val.get("blanks"))
        contains = str(raw_val.get("contains") or "").strip().lower()
        if not vals and not blanks and not contains:
            return True
        if not val.strip():
            return blanks
        if vals and val in vals:
            return True
        if contains and contains in val.lower():
            return True
        return False
    term = str(raw_val or "").strip().lower()
    return (term in val.lower()) if term else True


def filter_stock_rows(rows, table, column_filters):
    """Apply per-column filters to assembled aggregate rows."""
    col_map = _STOCK_COL_FIELD.get(table) or {}
    if isinstance(column_filters, str):
        try:
            column_filters = frappe.parse_json(column_filters)
        except Exception:
            column_filters = None
    if not isinstance(column_filters, dict) or not column_filters:
        return rows
    active = [(col_map[k], v) for k, v in column_filters.items() if col_map.get(k)]
    if not active:
        return rows
    return [r for r in rows if all(_stock_row_matches(r, f, v) for f, v in active)]


def stock_column_options(rows, table, col_key, search=None, limit=500):
    """Option list for an assembled aggregate column."""
    field = (_STOCK_COL_FIELD.get(table) or {}).get(col_key)
    if not field:
        return {"values": [], "has_blanks": False, "total": 0, "supported": False}
    labels, has_blanks = set(), False
    for r in rows:
        v = r.get(field)
        v = "" if v is None else str(v)
        if not v.strip():
            has_blanks = True
        else:
            labels.add(v)
    out = sorted(labels)
    needle = str(search or "").strip().lower()
    if needle:
        out = [l for l in out if needle in l.lower()]
    total = len(out)
    lim = max(1, min(int(limit or 500), 2000))
    return {
        "values": [{"value": l, "label": l} for l in out[:lim]],
        "has_blanks": has_blanks, "total": total, "supported": True,
    }


_MR_COL_FIELD = {
    "request_no": "name",
    "name": "name",
    "date": "transaction_date",
    "duid": "duid",
    "reason": "return_reason",
}


def _apply_material_request_column_filters(filters, column_filters):
    """Per-column "Manage Table" filters for list_material_requests /
    list_return_requests — see list_im_rollout_plans (in command_center.py)
    for the rationale. Mutates ``filters`` (a plain ORM filter dict) in place
    so callers only need to pass the result to ``frappe.db.get_all``.

    Several displayed columns are resolved from a raw link to another
    doctype's display name (POID via PO Dispatch, Team via INET Team's
    warehouse, IM via IM Master's linked User's full_name) rather than being
    stored directly on Material Request — those are matched by first
    resolving the set of matching raw IDs, then filtering on that set (an
    ORM "in" filter), so no raw-SQL rewrite of this ORM-based query is
    needed. "Status" is a Python-computed label (_request_status, combining
    3 raw fields with custom logic) with no simple SQL equivalent — left
    client-side only, same graceful-degradation approach used for other
    genuinely-computed columns elsewhere.
    """
    from inet_app.api.command_center import _sql_like_pattern, excel_orm_filter

    if isinstance(column_filters, str):
        try:
            column_filters = frappe.parse_json(column_filters)
        except Exception:
            column_filters = None
    if not isinstance(column_filters, dict):
        return

    for col_key, raw_val in column_filters.items():
        # ORM filter list, not SQL — see excel_orm_filter(). These loops map
        # each col_key to its field inline below, so resolve the dict against
        # that same field rather than duplicating the mapping here.
        if isinstance(raw_val, dict):
            if mr_apply_excel_link_filter(col_key, raw_val, filters):
                continue
            _f = _MR_COL_FIELD.get(col_key)
            _entry = excel_orm_filter(_f, raw_val) if _f else None
            if _entry:
                filters[_entry[0]] = [_entry[1], _entry[2]]
            continue
        val = str(raw_val or "").strip()
        if not val:
            continue
        pat = _sql_like_pattern(val)
        if col_key in ("request_no", "name"):
            filters["name"] = ["like", pat]
        elif col_key == "date":
            filters["transaction_date"] = ["like", pat]
        elif col_key == "duid":
            filters["duid"] = ["like", pat]
        elif col_key == "poid":
            # Material Request.poid is a Link storing the PO Dispatch docname
            # (system id); the displayed POID is PO Dispatch's own `poid`
            # field — resolve matching dispatch names first, then filter on
            # that set.
            dispatch_names = frappe.db.sql_list(
                "SELECT name FROM `tabPO Dispatch` WHERE poid LIKE %s", (pat,)
            )
            filters["poid"] = ["in", list(set(dispatch_names or [])) or ["__none__"]]
        elif col_key == "team":
            warehouses = frappe.db.sql_list(
                "SELECT warehouse FROM `tabINET Team` WHERE team_name LIKE %s AND IFNULL(warehouse,'') != ''",
                (pat,),
            )
            filters["set_warehouse"] = ["in", list(set(warehouses or [])) or ["__none__"]]
        elif col_key == "im":
            im_names = set(frappe.db.sql_list(
                """
                SELECT imm.name FROM `tabIM Master` imm
                INNER JOIN `tabUser` u ON u.name = imm.user
                WHERE u.full_name LIKE %s
                """,
                (pat,),
            ) or [])
            existing_im = filters.get("im")
            if existing_im and not isinstance(existing_im, (list, tuple)):
                # Non-admin callers are already scoped to their own single IM
                # above — never replace/widen that with a broader "in" list;
                # just confirm it still matches, or force zero rows.
                if existing_im not in im_names:
                    filters["im"] = ["in", ["__none__"]]
            else:
                filters["im"] = ["in", list(im_names) or ["__none__"]]


@frappe.whitelist()
def list_material_requests(im=None, status=None, limit=50, column_filters=None, _options=None,
                            team_id=None, duid=None, from_date=None, to_date=None, _summary=None):
    """List Material Requests (type: Material Transfer) created via INET portal.

    IM users see only their own requests (filtered by im custom field).
    Stock Manager / Admin see all.
    """
    roles = set(frappe.get_roles(frappe.session.user))
    is_admin = bool(roles & {"Administrator", "System Manager", "Stock Manager", "INET Admin"})

    filters = {"material_request_type": "Material Transfer"}
    try:
        if frappe.db.has_column("Material Request", "is_return_request"):
            filters["is_return_request"] = ["!=", 1]
    except Exception:
        pass
    if not is_admin:
        im_name = frappe.db.get_value("IM Master", {"user": frappe.session.user}, "name")
        if im_name:
            filters["im"] = im_name
        else:
            return []

    if im and is_admin:
        filters["im"] = im

    if team_id:
        team_wh = frappe.db.get_value("INET Team", team_id, "warehouse") or ""
        filters["set_warehouse"] = team_wh or "__none__"
    if duid:
        filters["duid"] = duid
    if from_date and to_date:
        filters["transaction_date"] = ["between", [from_date, to_date]]
    elif from_date:
        filters["transaction_date"] = [">=", from_date]
    elif to_date:
        filters["transaction_date"] = ["<=", to_date]

    # "Status" is _request_status(), computed after the query — a dict filter
    # on it cannot become an ORM condition, so pull it out and apply it to the
    # enriched rows below.
    _wanted_status = None
    _cf_parsed = column_filters
    if isinstance(_cf_parsed, str):
        try:
            _cf_parsed = frappe.parse_json(_cf_parsed)
        except Exception:
            _cf_parsed = None
    if isinstance(_cf_parsed, dict):
        _sv = _cf_parsed.get("status")
        if isinstance(_sv, dict):
            _wanted_status = {str(x) for x in (_sv.get("values") or []) if str(x or "").strip()}
            _sc = str(_sv.get("contains") or "").strip().lower()
            if not _wanted_status and _sc:
                _wanted_status = ("~", _sc)

    _apply_material_request_column_filters(filters, column_filters)

    if _options:
        # Answer from the filters THIS function assembled, so the option list
        # can never offer a value the row query would return nothing for.
        return mr_column_options(
            _options.get("col_key"), filters,
            _options.get("search"), _options.get("limit"),
        )

    if _summary:
        # Both request lists share one doctype and one filter dict, so the
        # summary is a plain ORM count against the SAME filters the row query
        # runs — no row limit involved.
        def _n(extra=None):
            f = dict(filters)
            if extra:
                f.update(extra)
            try:
                return frappe.db.count("Material Request", filters=f) or 0
            except Exception:
                return 0
        def _m(key, label, value, tone="default", group="", hide=False, hint=""):
            return {"key": key, "label": label, "value": value, "format": "int",
                    "tone": tone, "hint": hint, "group": group, "hide_if_zero": hide}
        return {"supported": True, "metrics": [
            _m("requests", "Requests", _n()),
            _m("pending", "Pending", _n({"status": "Pending"}), "warn", "Status", True,
               "Awaiting action"),
            _m("draft", "Draft", _n({"status": "Draft"}), "default", "Status", True),
            _m("transferred", "Transferred", _n({"status": "Transferred"}), "good", "Status", True),
            _m("cancelled", "Cancelled", _n({"status": "Cancelled"}), "bad", "Status", True),
        ]}

    rows = frappe.db.get_all(
        "Material Request",
        filters=filters,
        fields=[
            "name", "transaction_date", "owner", "im", "poid", "duid",
            "status", "transfer_status", "set_warehouse", "set_from_warehouse",
            "pending_transfer_se",
        ],
        order_by="`tabMaterial Request`.transaction_date desc, `tabMaterial Request`.creation desc",
        limit=int(limit),
    )
    # Batch: POID system-name → business POID
    poid_links = list({r["poid"] for r in rows if r.get("poid")})
    poid_map = {}
    if poid_links:
        for row in frappe.db.get_all(
            "PO Dispatch", filters={"name": ["in", poid_links]}, fields=["name", "poid"],
        ):
            poid_map[row["name"]] = row["poid"]

    # Batch: IM Master name → user full_name
    im_names = list({r["im"] for r in rows if r.get("im")})
    im_fullname_map = {}
    if im_names:
        for im_row in frappe.db.get_all("IM Master", filters={"name": ["in", im_names]}, fields=["name", "user"]):
            if im_row.get("user"):
                im_fullname_map[im_row["name"]] = (
                    frappe.db.get_value("User", im_row["user"], "full_name") or im_row["user"]
                )

    # Batch: warehouse → INET Team name
    warehouses = list({r.get("set_warehouse") for r in rows if r.get("set_warehouse")})
    wh_team_map = {}
    if warehouses:
        for t in frappe.db.get_all(
            "INET Team", filters={"warehouse": ["in", warehouses]}, fields=["warehouse", "team_name"],
        ):
            wh_team_map[t["warehouse"]] = t["team_name"]

    for r in rows:
        r["request_date"] = str(r.pop("transaction_date", "") or "")
        r["request_status"] = _request_status(
            r["status"], r["transfer_status"], has_pending_se=bool(r.get("pending_transfer_se")),
        )
        wh = r.pop("set_warehouse", "")
        r["team_warehouse"] = wh
        r["team_name"] = wh_team_map.get(wh) or wh
        r["source_warehouse"] = r.pop("set_from_warehouse", "")
        r["im_full_name"] = im_fullname_map.get(r.get("im") or "", r.get("im") or "")
        if r.get("poid"):
            r["poid"] = poid_map.get(r["poid"], r["poid"])

    if _wanted_status:
        if isinstance(_wanted_status, tuple):
            rows = [r for r in rows if _wanted_status[1] in (r["request_status"] or "").lower()]
        else:
            rows = [r for r in rows if r["request_status"] in _wanted_status]

    if _wanted_status:
        if isinstance(_wanted_status, tuple):
            rows = [r for r in rows if _wanted_status[1] in (r["request_status"] or "").lower()]
        else:
            rows = [r for r in rows if r["request_status"] in _wanted_status]

    if status:
        rows = [r for r in rows if r["request_status"] == status]
    return rows


@frappe.whitelist()
def get_material_request(name):
    """Get a single Material Request with its items (permission-aware)."""
    roles = set(frappe.get_roles(frappe.session.user))
    doc = frappe.get_doc("Material Request", name)

    is_admin = bool(roles & {"Administrator", "System Manager", "Stock Manager", "INET Admin"})
    if not is_admin:
        im_name = frappe.db.get_value("IM Master", {"user": frappe.session.user}, "name")
        if doc.get("im") != im_name and doc.owner != frappe.session.user:
            frappe.throw("Not permitted.", frappe.PermissionError)

    # Find linked Stock Entries (transfer and issue)
    ses = frappe.db.get_all(
        "Stock Entry",
        filters={"material_request": name},
        fields=["name", "stock_entry_type"],
        order_by="`tabStock Entry`.creation asc",
    )
    transfer_se = next((s["name"] for s in ses if s["stock_entry_type"] == "Material Transfer"), None)
    issue_se = next((s["name"] for s in ses if s["stock_entry_type"] == "Material Issue"), None)

    # Resolve Link value (system name) → business POID
    poid_link = doc.get("poid") or ""
    poid_display = frappe.db.get_value("PO Dispatch", poid_link, "poid") if poid_link else ""

    # Item.is_customer_provided_item classification — the JSX badge logic
    # used to key off a `valuation_rate` field that was never included in
    # this response (always undefined, so every item showed as Huawei).
    item_type_map = _classify_item_types(list({i.item_code for i in doc.items}))

    # A return doesn't know which bill/DUID it's returning stock from at
    # request time (a team's warehouse pools stock across bills) — that's
    # only decided once approved, when ERPNext auto-picks a batch for the
    # staged transfer Stock Entry. Surface it once it exists; blank before
    # that ("if exists").
    # Resolve IM Master link → user's display name (the raw Link value, e.g.
    # "456", is meaningless to a human reading the request detail popup).
    im_link = doc.get("im")
    im_display = im_link
    if im_link:
        im_user = frappe.db.get_value("IM Master", im_link, "user")
        if im_user:
            im_display = frappe.db.get_value("User", im_user, "full_name") or im_user

    return_trace = {}
    if doc.get("is_return_request") and transfer_se:
        se_rows = frappe.db.get_all(
            "Stock Entry Detail",
            filters={"parent": transfer_se},
            fields=["item_code", "batch_no", "duid", "to_duid"],
        )
        for r in se_rows:
            if not r.item_code:
                continue
            entry = return_trace.setdefault(r.item_code, {"duid": "", "bill_nos": set()})
            d = r.duid or r.to_duid or ""
            if d and not entry["duid"]:
                entry["duid"] = d
            if r.batch_no and "::" in r.batch_no:
                entry["bill_nos"].add(r.batch_no.split("::")[0])

    return {
        "name": doc.name,
        "request_date": str(doc.transaction_date or ""),
        "pickup_date": str(doc.schedule_date or ""),
        "pickup_time": str(doc.get("pickup_time") or ""),
        "owner": doc.owner,
        "im": im_display,
        "im_full_name": im_display,
        "poid": poid_display or poid_link,
        "duid": doc.get("duid"),
        "request_status": _request_status(
            doc.status, doc.transfer_status,
            has_pending_se=bool(doc.get("pending_transfer_se")),
            is_return=bool(doc.get("is_return_request")),
        ),
        "status": doc.status,
        "transfer_status": doc.transfer_status,
        "team_warehouse": doc.set_warehouse,
        "source_warehouse": doc.set_from_warehouse,
        "rejection_reason": doc.get("rejection_reason"),
        "pending_transfer_se": doc.get("pending_transfer_se"),
        "confirm_rejection_reason": doc.get("confirm_rejection_reason"),
        "stock_entry_transfer": transfer_se,
        "stock_entry_issue": issue_se,
        "items": [
            {
                "item_code": i.item_code,
                "item_name": i.item_name,
                "qty": i.qty,
                "uom": i.uom or i.stock_uom,
                "duid": i.get("duid") or return_trace.get(i.item_code, {}).get("duid", ""),
                "poid": i.get("poid"),
                "item_type": item_type_map.get(i.item_code, "company"),
                "bill_no": ", ".join(sorted(return_trace.get(i.item_code, {}).get("bill_nos", set()))),
            }
            for i in doc.items
        ],
    }


def _resolve_po_dispatch(poid_input):
    """Return the PO Dispatch system name given a business POID or system name.

    PO Dispatch uses system-generated names (SYS-…) while business users
    always reference the ``poid`` field (e.g. W-4178-ATN-01-REL-01).
    Try business poid first, fall back to document name.
    """
    name = frappe.db.get_value("PO Dispatch", {"poid": poid_input}, "name")
    if not name and frappe.db.exists("PO Dispatch", poid_input):
        name = poid_input
    return name


@frappe.whitelist()
def get_poid_details(poid):
    """Fetch PO Dispatch details for auto-fill in new request form.

    Accepts the business POID (poid field) or the system document name.
    Also returns the team from the latest Rollout Plan and the source
    warehouse from INET Settings.
    """
    name = _resolve_po_dispatch(poid)
    if not name:
        frappe.throw(f"PO Dispatch with POID '{poid}' not found.")
    row = frappe.db.get_value(
        "PO Dispatch", name,
        ["name", "poid", "site_code", "im", "project_code"],
        as_dict=True,
    )
    row["doc_name"] = row.pop("name")  # system name for Link field storage
    # Team from latest non-cancelled Rollout Plan for this POID
    plans = frappe.db.get_all(
        "Rollout Plan",
        filters={"po_dispatch": row["doc_name"], "plan_status": ["!=", "Cancelled"]},
        fields=["team"],
        order_by="creation desc",
        limit=1,
    )
    team = plans[0]["team"] if plans else ""

    # Fallback: any rollout plan (including cancelled) if nothing found above
    if not team:
        plans_any = frappe.db.get_all(
            "Rollout Plan",
            filters={"po_dispatch": row["doc_name"]},
            fields=["team"],
            order_by="creation desc",
            limit=1,
        )
        team = plans_any[0]["team"] if plans_any else ""

    row["team"] = team or ""
    row["team_warehouse"] = frappe.db.get_value("INET Team", team, "warehouse") or "" if team else ""
    # Source warehouse from INET Settings
    row["source_warehouse"] = frappe.db.get_single_value("INET Settings", "source_warehouse") or ""
    return row


@frappe.whitelist()
def get_source_warehouse():
    """Return the configured main store warehouse from INET Settings."""
    return frappe.db.get_single_value("INET Settings", "source_warehouse") or ""


@frappe.whitelist()
def get_duid_received_items(duid):
    """Return customer-provided items still available to request for a DUID.

    Totals received qty across all Material Receipts for the DUID, then
    subtracts qty already covered by active (non-cancelled) Material Requests.
    Only items with remaining qty > 0 are returned.
    """
    if not duid:
        return []
    plans = frappe.db.get_all(
        "Huawei Outbound Plan",
        filters={"du_id": duid, "subcon": "INET", "material_receipt": ["is", "set"]},
        fields=["name", "material_receipt"],
    )
    if not plans:
        return []

    # Sum received qty per item across all receipts for this DUID
    received = {}   # item_code → {item_name, qty, uom, material_receipt}
    for plan in plans:
        # A Material Receipt can be a combined Stock Entry covering several
        # bills at once (on_stock_entry_submit tags each bill's Huawei
        # Outbound Plan with the same material_receipt when that happens) —
        # so pulling every row on the Stock Entry would attribute another
        # bill's (and possibly another DUID's) items to this one. Restrict
        # to rows whose own batch is actually tied to *this* bill; a row
        # with no batch at all (legacy, predates batch tracking) is still
        # trusted as before, since there's no better signal for it.
        rows = frappe.db.sql(
            """SELECT sed.item_code, sed.item_name, sed.qty, sed.uom
               FROM `tabStock Entry Detail` sed
               LEFT JOIN `tabBatch` b ON b.name = sed.batch_no
               WHERE sed.parent = %(receipt)s
                 AND (
                   IFNULL(sed.batch_no, '') = ''
                   OR (b.reference_doctype = 'Huawei Outbound Plan' AND b.reference_name = %(bill)s)
                 )""",
            {"receipt": plan["material_receipt"], "bill": plan["name"]}, as_dict=True,
        )
        for r in rows:
            ic = r["item_code"]
            if not frappe.db.get_value("Item", ic, "is_customer_provided_item"):
                continue
            if ic not in received:
                received[ic] = {
                    "item_code": ic,
                    "item_name": r["item_name"] or ic,
                    "qty": flt(r["qty"]),
                    "uom": r["uom"] or "Nos",
                    "material_receipt": plan["material_receipt"],
                }
            else:
                received[ic]["qty"] += flt(r["qty"])

    if not received:
        return []

    # Subtract qty already covered by active (non-cancelled) Material Requests
    item_codes = list(received)
    ph = ", ".join(["%s"] * len(item_codes))
    requested_rows = frappe.db.sql(
        f"""
        SELECT mri.item_code, SUM(mri.qty) AS requested_qty
        FROM `tabMaterial Request Item` mri
        JOIN `tabMaterial Request` mr ON mr.name = mri.parent
        WHERE mr.docstatus != 2
          AND mr.duid = %s
          AND mr.material_request_type = 'Material Transfer'
          AND mri.item_code IN ({ph})
        GROUP BY mri.item_code
        """,
        [duid, *item_codes],
        as_dict=True,
    ) or []
    requested_map = {r.item_code: flt(r.requested_qty) for r in requested_rows}

    result = []
    for ic, info in received.items():
        remaining = info["qty"] - requested_map.get(ic, 0)
        if remaining <= 0:
            continue
        result.append({
            "item_code": ic,
            "item_name": info["item_name"],
            "qty": remaining,
            "uom": info["uom"],
            "is_huawei": True,
            "material_receipt": info["material_receipt"],
        })
    return result


@frappe.whitelist()
def get_duid_bill_materials(duid):
    """Per-bill item breakdown for a DUID, for the "click a DUID to see its
    bills" popup — bill_no, and for each item: how much came in (received
    at the main warehouse), how much has been transferred out to a team
    (net of any returns back), how much has actually been used/issued on
    site, and how much of the received qty is still sitting in the main
    warehouse un-transferred. Also whether the bill's Material Receipt is
    still Draft ("incoming", not yet actually in the warehouse) or
    Received (submitted).

    A bill's items live on its Material Receipt's Stock Entry Detail rows
    (each item row tagged with a Batch whose reference_name is the bill —
    see Batch = bill), not on the Huawei Outbound Plan itself. Joining via
    Batch rather than Huawei Outbound Plan.material_receipt is what lets a
    still-Draft receipt show up here at all: that link field is only ever
    set at submit time (on_stock_entry_submit), so a bill whose receipt
    hasn't been submitted yet would otherwise be invisible.
    """
    if not duid:
        return []
    bills = frappe.db.sql(
        """SELECT bill_no, outbound_date, outbound_status
           FROM `tabHuawei Outbound Plan`
           WHERE subcon = 'INET' AND (du_id = %s OR duid_master = %s)
           ORDER BY outbound_date DESC""",
        (duid, duid), as_dict=True,
    )
    if not bills:
        return []

    bill_nos = [b.bill_no for b in bills]
    placeholders = ", ".join(["%s"] * len(bill_nos))

    # Received — includes a still-Draft receipt (docstatus != 2) so an
    # incoming bill shows up before it's even been confirmed.
    receipt_rows = frappe.db.sql(
        f"""SELECT b.reference_name AS bill_no, sed.item_code, sed.uom,
                   SUM(sed.qty) AS received_qty,
                   MAX(se.docstatus) AS docstatus,
                   MAX(se.name) AS stock_entry
            FROM `tabBatch` b
            JOIN `tabStock Entry Detail` sed ON sed.batch_no = b.name
            JOIN `tabStock Entry` se ON se.name = sed.parent
            WHERE b.reference_doctype = 'Huawei Outbound Plan'
              AND b.reference_name IN ({placeholders})
              AND se.stock_entry_type = 'Material Receipt'
              AND se.docstatus != 2
            GROUP BY b.reference_name, sed.item_code""",
        bill_nos, as_dict=True,
    )

    # Transferred (net of returns back to main) and Issued — only actually
    # SUBMITTED moves count; a staged Draft transfer hasn't moved anything.
    source_wh = frappe.db.get_single_value("INET Settings", "source_warehouse") or ""
    moved_rows = frappe.db.sql(
        f"""SELECT b.reference_name AS bill_no, sed.item_code,
                   SUM(CASE
                         WHEN se.stock_entry_type = 'Material Transfer' AND sed.s_warehouse = %s THEN sed.qty
                         WHEN se.stock_entry_type = 'Material Transfer' AND sed.t_warehouse = %s THEN -sed.qty
                         ELSE 0
                       END) AS transferred_qty,
                   SUM(CASE WHEN se.stock_entry_type = 'Material Issue' THEN sed.qty ELSE 0 END) AS issued_qty
            FROM `tabBatch` b
            JOIN `tabStock Entry Detail` sed ON sed.batch_no = b.name
            JOIN `tabStock Entry` se ON se.name = sed.parent
            WHERE b.reference_doctype = 'Huawei Outbound Plan'
              AND b.reference_name IN ({placeholders})
              AND se.stock_entry_type IN ('Material Transfer', 'Material Issue')
              AND se.docstatus = 1
            GROUP BY b.reference_name, sed.item_code""",
        [source_wh, source_wh, *bill_nos], as_dict=True,
    )
    moved_map = {(r.bill_no, r.item_code): r for r in moved_rows}

    item_names = {}
    if receipt_rows:
        item_names = {
            r["name"]: r["item_name"] for r in frappe.db.get_all(
                "Item",
                filters={"name": ["in", list({r.item_code for r in receipt_rows})]},
                fields=["name", "item_name"],
            )
        }

    by_bill = {
        b.bill_no: {
            "bill_no": b.bill_no,
            "outbound_date": str(b.outbound_date or ""),
            "outbound_status": b.outbound_status,
            "receipt_status": None,  # "Draft" | "Received" | None (no receipt yet)
            "stock_entry": None,
            "items": [],
        }
        for b in bills
    }
    for r in receipt_rows:
        g = by_bill.get(r.bill_no)
        if not g:
            continue
        g["stock_entry"] = r.stock_entry
        g["receipt_status"] = "Received" if r.docstatus == 1 else "Draft"
        moved = moved_map.get((r.bill_no, r.item_code))
        received = flt(r.received_qty)
        transferred = flt(moved.transferred_qty) if moved else 0.0
        issued = flt(moved.issued_qty) if moved else 0.0
        g["items"].append({
            "item_code": r.item_code,
            "item_name": item_names.get(r.item_code, r.item_code),
            "uom": r.uom,
            "received_qty": received,
            "transferred_qty": transferred,
            "issued_qty": issued,
            "remaining_main_qty": received - transferred,
        })
    return list(by_bill.values())


@frappe.whitelist()
def search_items(query="", warehouse=None, limit=20):
    """Search Item master for company-owned items.

    If warehouse is given, also returns actual_qty from Bin for that warehouse.
    """
    q = (query or "").strip()
    filters = [
        ["disabled", "=", 0],
        ["is_stock_item", "=", 1],
        ["is_purchase_item", "=", 1],
        ["is_customer_provided_item", "=", 0],
    ]
    if q:
        filters.append(["item_code", "like", f"%{q}%"])

    items = frappe.db.get_all(
        "Item",
        filters=filters,
        fields=["item_code", "item_name", "stock_uom", "item_group"],
        order_by="item_code asc",
        limit=int(limit),
    )

    if not items and q:
        # fallback: search by item_name too
        name_filters = [
            ["disabled", "=", 0], ["is_stock_item", "=", 1],
            ["is_purchase_item", "=", 1], ["is_customer_provided_item", "=", 0],
            ["item_name", "like", f"%{q}%"],
        ]
        items = frappe.db.get_all("Item",
            filters=name_filters,
            fields=["item_code", "item_name", "stock_uom", "item_group"],
            order_by="item_code asc", limit=int(limit),
        )

    if warehouse and items:
        codes = [i["item_code"] for i in items]
        bins = {b["item_code"]: b["actual_qty"] for b in frappe.db.get_all(
            "Bin",
            filters={"item_code": ["in", codes], "warehouse": warehouse},
            fields=["item_code", "actual_qty"],
        )}
        for item in items:
            item["actual_qty"] = bins.get(item["item_code"], 0)

    return items


@frappe.whitelist()
def search_po_dispatches(query="", im=None, duid=None, limit=20):
    """Search PO Dispatches by business POID field for the current IM.

    When duid is given, results are restricted to that site (site_code) —
    used by the New Material Request form's DUID-first flow.
    """
    conditions = [["docstatus", "!=", 2]]
    if im:
        conditions.append(["im", "=", im])
    if duid:
        conditions.append(["site_code", "=", duid])
    if (query or "").strip():
        conditions.append(["poid", "like", f"%{query.strip()}%"])
    return frappe.db.get_all(
        "PO Dispatch",
        filters=conditions,
        fields=["name", "poid", "site_code", "project_code"],
        order_by="poid asc",
        limit=int(limit),
    )


@frappe.whitelist()
def search_duids(query="", im=None, limit=20):
    """Search DUIDs (site codes) that have at least one non-cancelled PO
    Dispatch — the first step of the New Material Request form (DUID, then
    POID filtered by that DUID).
    """
    conditions = ["pd.docstatus != 2", "pd.site_code IS NOT NULL", "pd.site_code != ''"]
    values = []
    if im:
        conditions.append("pd.im = %s")
        values.append(im)
    q = (query or "").strip()
    if q:
        conditions.append("(pd.site_code LIKE %s OR dm.site_name LIKE %s)")
        values.extend([f"%{q}%", f"%{q}%"])
    where = " AND ".join(conditions)
    return frappe.db.sql(
        f"""
        SELECT pd.site_code AS duid, MAX(dm.site_name) AS site_name, COUNT(*) AS poid_count
        FROM `tabPO Dispatch` pd
        LEFT JOIN `tabDUID Master` dm ON dm.name = pd.site_code
        WHERE {where}
        GROUP BY pd.site_code
        ORDER BY pd.site_code ASC
        LIMIT {int(limit)}
        """,
        values, as_dict=True,
    )


@frappe.whitelist()
def get_im_teams(im=None):
    """Return teams for the current IM with their warehouse info.

    When called by an admin (System Manager / INET Admin) who has no IM record,
    returns all active teams so the material request popup can pre-select one.
    """
    if not im:
        im = frappe.db.get_value("IM Master", {"user": frappe.session.user}, "name")
    if not im:
        roles = set(frappe.get_roles(frappe.session.user))
        if roles & {"System Manager", "INET Admin", "Administrator", "Stock Manager"}:
            return frappe.db.get_all(
                "INET Team",
                filters={"status": "Active"},
                fields=["team_id", "team_name", "warehouse"],
                order_by="team_name asc",
            )
        return []
    return frappe.db.get_all(
        "INET Team",
        filters={"im": im, "status": "Active"},
        fields=["team_id", "team_name", "warehouse"],
        order_by="team_name asc",
    )


@frappe.whitelist()
def get_duid_stock_summary(column_filters=None, limit=None, _options=None, _summary=None):
    """DUID-wise summary of INET Huawei Outbound materials in the main warehouse.

    Groups all INET Huawei Outbound Plan rows by DUID, showing
    how many shipments arrived (Received) vs. are expected (Prepared).
    DUIDs whose net stock in the source warehouse is zero (fully transferred out) are excluded.
    """
    # A summary describes the whole filtered set, so it must never run against
    # the capped SQL below — with limit=1 it would report one DUID and call it
    # the total. Drop the cap here rather than trusting every caller to.
    if _summary:
        limit = 0
    # Grouped in SQL, and — once the exclusion set below is known — filtered
    # and capped there too, so the DB returns only the rows the page shows.
    # This is what makes the row limit real: without it the server builds the
    # whole aggregate and throws the tail away.
    def _grouped_duids(exclude, col_filters, lim):
        from inet_app.api.command_center import _sql_like_pattern, excel_filter_clause
        where = ["subcon = 'INET'", "IFNULL(du_id, '') != ''"]
        params = []
        if exclude:
            ph = ", ".join(["%s"] * len(exclude))
            where.append(f"du_id NOT IN ({ph})")
            params.extend(list(exclude))
        # Raw columns filter in WHERE, aggregates in HAVING.
        raw = {"duid": "du_id", "project": "IFNULL(project_name,'')"}
        agg = {
            "received": "SUM(CASE WHEN outbound_status = 'Received' THEN 1 ELSE 0 END)",
            "pending": "SUM(CASE WHEN outbound_status = 'Received' THEN 0 ELSE 1 END)",
            "volume_m": "ROUND(SUM(IFNULL(total_volume,0)), 4)",
            "latest_date": "IFNULL(MAX(outbound_date), '')",
        }
        having = []
        if isinstance(col_filters, str):
            try:
                col_filters = frappe.parse_json(col_filters)
            except Exception:
                col_filters = None
        if isinstance(col_filters, dict):
            for ck, cv in col_filters.items():
                expr = raw.get(ck) or agg.get(ck)
                if not expr:
                    continue
                if isinstance(cv, dict):
                    clause, p = excel_filter_clause(f"CAST({expr} AS CHAR)", cv)
                else:
                    pat = _sql_like_pattern(cv)
                    clause, p = (f"CAST({expr} AS CHAR) LIKE %s", [pat]) if pat else (None, [])
                if not clause:
                    continue
                (where if ck in raw else having).append(clause)
                params.extend(p)
        sql = f"""
            SELECT du_id AS duid,
                   ROUND(SUM(IFNULL(total_volume, 0)), 4) AS total_volume,
                   SUM(CASE WHEN outbound_status = 'Received' THEN 1 ELSE 0 END) AS received_count,
                   SUM(CASE WHEN outbound_status = 'Received' THEN 0 ELSE 1 END) AS prepared_count,
                   IFNULL(MAX(outbound_date), '') AS latest_date,
                   SUBSTRING_INDEX(
                       GROUP_CONCAT(IFNULL(project_name, '')
                                    ORDER BY outbound_date DESC SEPARATOR '\x1f'),
                       '\x1f', 1) AS project_name
            FROM `tabHuawei Outbound Plan`
            WHERE {" AND ".join(where)}
            GROUP BY du_id
            {("HAVING " + " AND ".join(having)) if having else ""}
            ORDER BY received_count DESC, latest_date ASC, du_id ASC
            {_stock_limit_suffix(lim)}
        """
        return frappe.db.sql(sql, tuple(params), as_dict=True) or []

    # Only the material_receipt -> duid mapping still needs the plan rows, and
    # only for receipts, so fetch that narrow slice rather than every column.
    plans = frappe.db.get_all(
        "Huawei Outbound Plan",
        filters={"subcon": "INET"},
        fields=["du_id", "material_receipt"],
        limit_page_length=0,
    )

    # Build set of DUIDs that are fully transferred out of source warehouse.
    # Two checks — either is sufficient to mark a DUID as fully transferred:
    #
    #  1. SE balance: received_qty (to_duid OR duid on Receipt) - transferred_qty
    #     (duid on Transfer) - issued_qty (duid on Issue) <= 0
    #     Note: legacy SEs may have the wrong DUID column set (duid instead of
    #     to_duid on a Receipt), so we COALESCE both columns for receipts.
    #
    #  2. MR status fallback: all submitted MRs for this DUID are Transferred/
    #     Issued and none are Pending Approval — catches cases where the
    #     Transfer SE was created without the DUID dimension being set.
    fully_transferred = set()
    source_wh = frappe.db.get_single_value("INET Settings", "source_warehouse") or ""
    if source_wh:
        # Received: prefer to_duid; fall back to duid (legacy SEs had wrong direction)
        receipt_rows = frappe.db.sql("""
            SELECT COALESCE(NULLIF(sed.to_duid,''), NULLIF(sed.duid,'')) AS duid,
                   SUM(sed.qty) AS qty
            FROM `tabStock Entry Detail` sed
            JOIN `tabStock Entry` se ON se.name = sed.parent
            WHERE se.docstatus = 1
              AND se.stock_entry_type = 'Material Receipt'
              AND sed.t_warehouse = %s
              AND (NULLIF(sed.to_duid,'') IS NOT NULL OR NULLIF(sed.duid,'') IS NOT NULL)
            GROUP BY COALESCE(NULLIF(sed.to_duid,''), NULLIF(sed.duid,''))
        """, (source_wh,), as_dict=True)

        transfer_rows = frappe.db.sql("""
            SELECT sed.duid, SUM(sed.qty) AS qty
            FROM `tabStock Entry Detail` sed
            JOIN `tabStock Entry` se ON se.name = sed.parent
            WHERE se.docstatus = 1
              AND se.stock_entry_type = 'Material Transfer'
              AND sed.s_warehouse = %s
              AND sed.duid IS NOT NULL AND sed.duid != ''
            GROUP BY sed.duid
        """, (source_wh,), as_dict=True)

        issue_rows = frappe.db.sql("""
            SELECT sed.duid, SUM(sed.qty) AS qty
            FROM `tabStock Entry Detail` sed
            JOIN `tabStock Entry` se ON se.name = sed.parent
            WHERE se.docstatus = 1
              AND se.stock_entry_type = 'Material Issue'
              AND sed.s_warehouse = %s
              AND sed.duid IS NOT NULL AND sed.duid != ''
            GROUP BY sed.duid
        """, (source_wh,), as_dict=True)

        received   = {r.duid: flt(r.qty) for r in receipt_rows}
        transferred = {r.duid: flt(r.qty) for r in transfer_rows}
        issued     = {r.duid: flt(r.qty) for r in issue_rows}

        for duid, recv_qty in received.items():
            out_qty = transferred.get(duid, 0) + issued.get(duid, 0)
            if recv_qty > 0 and (recv_qty - out_qty) <= 0:
                fully_transferred.add(duid)

    # MR status fallback: DUIDs where all submitted MRs are done and none pending.
    # This catches SEs that were submitted without DUID dimension set.
    try:
        mr_rows = frappe.db.get_all(
            "Material Request",
            filters={"docstatus": 1},
            fields=["duid", "request_status"],
        )
        from collections import defaultdict
        mr_counts = defaultdict(lambda: {"done": 0, "pending": 0})
        for mr in mr_rows:
            d = (mr.get("duid") or "").strip()
            if not d:
                continue
            s = mr.get("request_status") or ""
            if s in ("Transferred", "Issued"):
                mr_counts[d]["done"] += 1
            elif s == "Pending Approval":
                mr_counts[d]["pending"] += 1
        for d, counts in mr_counts.items():
            if counts["done"] > 0 and counts["pending"] == 0:
                fully_transferred.add(d)
    except Exception:
        pass

    # Compute has_requestable_items: DUIDs that have at least one item with
    # remaining qty (received total minus active MR requested total) > 0.
    # Options must describe the COMPLETE aggregate, so they ignore the page's
    # filters and limit; the row path pushes both into the query.
    grouped = _grouped_duids(fully_transferred, None if _options else column_filters,
                             0 if _options else limit)
    by_duid = {
        g["duid"]: {
            "duid": g["duid"],
            "total_volume": flt(g["total_volume"]),
            "received_count": cint(g["received_count"]),
            "prepared_count": cint(g["prepared_count"]),
            "latest_date": str(g["latest_date"] or ""),
            "project_name": g["project_name"] or "",
        }
        for g in grouped
    }

    receipt_to_duid = {}
    for p in plans:
        if p.get("material_receipt") and (p["du_id"] or "").strip():
            receipt_to_duid[p["material_receipt"]] = (p["du_id"] or "").strip()

    received_duid_set = {d for d, v in by_duid.items() if v["received_count"] > 0 and d not in fully_transferred}
    if receipt_to_duid and received_duid_set:
        mr_names = [mr for mr, d in receipt_to_duid.items() if d in received_duid_set]
        ph_mr = ", ".join(["%s"] * len(mr_names))
        recv_rows = frappe.db.sql(
            f"SELECT parent AS mr, item_code, SUM(qty) AS qty "
            f"FROM `tabStock Entry Detail` WHERE parent IN ({ph_mr}) GROUP BY parent, item_code",
            mr_names, as_dict=True,
        ) or []

        recv_by_duid = {}   # {duid: {item_code: total_received_qty}}
        for r in recv_rows:
            d = receipt_to_duid.get(r.mr, "")
            if not d:
                continue
            recv_by_duid.setdefault(d, {}).setdefault(r.item_code, 0)
            recv_by_duid[d][r.item_code] += flt(r.qty)

        ph_d = ", ".join(["%s"] * len(received_duid_set))
        req_rows = frappe.db.sql(
            f"""
            SELECT mr.duid, mri.item_code, SUM(mri.qty) AS requested_qty
            FROM `tabMaterial Request Item` mri
            JOIN `tabMaterial Request` mr ON mr.name = mri.parent
            WHERE mr.docstatus != 2
              AND mr.duid IN ({ph_d})
              AND mr.material_request_type = 'Material Transfer'
            GROUP BY mr.duid, mri.item_code
            """,
            list(received_duid_set), as_dict=True,
        ) or []
        req_by_duid = {}
        for r in req_rows:
            req_by_duid.setdefault(r.duid, {})[r.item_code] = flt(r.requested_qty)

        for d in received_duid_set:
            items_recv = recv_by_duid.get(d, {})
            items_req = req_by_duid.get(d, {})
            by_duid[d]["has_requestable_items"] = any(
                (items_recv[ic] - items_req.get(ic, 0)) > 0
                for ic in items_recv
            ) if items_recv else False

    for d, data in by_duid.items():
        if "has_requestable_items" not in data:
            data["has_requestable_items"] = False

    # Per-bill Transferred/Completed counts, alongside the existing
    # Received/Pending bill counts. A bill counts as Completed once every
    # item in it has been fully used (issued >= received, everywhere);
    # Transferred once every item has fully left the main warehouse
    # (nothing remaining there) but isn't fully used yet. Reuses
    # get_bill_wise_status's already-computed per-item
    # received/issued/remaining_main rather than requerying from scratch.
    for v in by_duid.values():
        v["transferred_count"] = 0
        v["completed_count"] = 0

    bills_by_duid = {}
    for r in get_bill_wise_status():
        bills_by_duid.setdefault(r["du_id"], {}).setdefault(r["bill_no"], []).append(r)

    for duid, bill_map in bills_by_duid.items():
        g = by_duid.get(duid)
        if not g:
            continue
        for items in bill_map.values():
            if not items:
                continue
            bill_fully_completed = all((it["received_qty"] - it["issued_qty"]) <= 0.0001 for it in items)
            bill_fully_transferred = all(it["remaining_main_qty"] <= 0.0001 for it in items)
            if bill_fully_completed:
                g["completed_count"] += 1
            elif bill_fully_transferred:
                g["transferred_count"] += 1

    # Already excluded, filtered, ordered and capped by _grouped_duids.
    result = list(by_duid.values())
    if _options:
        return stock_column_options(result, "duid_stock", _options.get("col_key"),
                                    _options.get("search"), _options.get("limit"))
    if _summary:
        _rows = filter_stock_rows(result, "duid_stock", column_filters)
        return stock_summary(_rows, [
            {"key": "duids", "label": "DUIDs", "agg": "count"},
            {"key": "projects", "label": "Projects", "agg": "distinct", "field": "project_name"},
            {"key": "volume", "label": "Volume", "agg": "sum", "field": "total_volume",
             "format": "qty", "tone": "good"},
            {"key": "pending", "label": "Pending", "agg": "sum", "field": "prepared_count",
             "group": "Movement", "tone": "warn", "hide_if_zero": True,
             "hint": "Requested, not yet received on site"},
            {"key": "received", "label": "Received", "agg": "sum", "field": "received_count",
             "group": "Movement", "tone": "info", "hide_if_zero": True},
            {"key": "transferred", "label": "Transferred", "agg": "sum",
             "field": "transferred_count", "group": "Movement", "hide_if_zero": True},
            {"key": "completed", "label": "Completed", "agg": "sum", "field": "completed_count",
             "group": "Movement", "tone": "good", "hide_if_zero": True},
        ])
    return result


@frappe.whitelist()
def create_material_request(payload):
    """Create and submit a Material Request (type: Material Transfer) from the portal."""
    import json
    roles = set(frappe.get_roles(frappe.session.user))
    if not roles & {"Administrator", "System Manager", "Stock Manager", "INET Admin", "INET IM"}:
        frappe.throw("Not permitted to create material requests.", frappe.PermissionError)

    data = json.loads(payload) if isinstance(payload, str) else payload

    items = data.get("items") or []
    if not items:
        frappe.throw("At least one item is required.")
    if not (data.get("team") or "").strip():
        frappe.throw("Please select a team.")

    im = data.get("im") or frappe.db.get_value("IM Master", {"user": frappe.session.user}, "name")
    req_date = data.get("request_date") or nowdate()
    duid = data.get("duid") or ""
    company = frappe.defaults.get_global_default("company")

    # When the TL should go to the warehouse and collect this — defaults to
    # the request date with no specific time if the IM doesn't set one, same
    # as before this was ever exposed as its own concept.
    pickup_date = (data.get("pickup_date") or "").strip() or req_date
    pickup_time = (data.get("pickup_time") or "").strip() or None

    # Resolve business POID → system document name for the Link field
    poid_input = (data.get("poid") or "").strip()
    poid = _resolve_po_dispatch(poid_input) if poid_input else ""

    # Source warehouse always comes from INET Settings (not user input)
    source_wh = frappe.db.get_single_value("INET Settings", "source_warehouse") or ""

    # Team warehouse auto-filled from INET Team record
    team = (data.get("team") or "").strip()
    target_wh = ""
    if team:
        target_wh = frappe.db.get_value("INET Team", team, "warehouse") or ""
    if not target_wh:
        frappe.throw("Team Warehouse not configured. Please set a Warehouse on the selected team in INET Team.")

    # Warn (don't block) when an item already has net-positive stock in the
    # team warehouse for this DUID. This used to hard-block the whole
    # request, but a team legitimately needing MORE than what's already
    # on hand (e.g. have 5, need 10 for the job) would be blocked outright
    # with no way through except cancelling/consuming the old stock first.
    # Surface it as a heads-up instead and let the requester decide —
    # they may well know they need the extra on top of what's already there.
    stock_warning = None
    if duid and target_wh:
        item_codes = list({i["item_code"] for i in items if i.get("item_code")})
        if item_codes:
            ph = ", ".join(["%s"] * len(item_codes))
            already_stocked = frappe.db.sql(
                f"""
                SELECT sed.item_code,
                       SUM(CASE WHEN se.stock_entry_type = 'Material Transfer'
                                 AND sed.t_warehouse = %s THEN sed.qty ELSE 0 END)
                     - SUM(CASE WHEN se.stock_entry_type = 'Material Issue'
                                 AND sed.s_warehouse = %s THEN sed.qty ELSE 0 END)
                       AS net_qty
                FROM `tabStock Entry Detail` sed
                JOIN `tabStock Entry` se ON se.name = sed.parent
                WHERE se.docstatus = 1
                  AND sed.item_code IN ({ph})
                  AND sed.duid = %s
                  AND (
                    (se.stock_entry_type = 'Material Transfer' AND sed.t_warehouse = %s)
                    OR
                    (se.stock_entry_type = 'Material Issue' AND sed.s_warehouse = %s)
                  )
                GROUP BY sed.item_code
                HAVING net_qty > 0
                """,
                [target_wh, target_wh, *item_codes, duid, target_wh, target_wh],
                as_dict=True,
            )
            if already_stocked:
                dupes = ", ".join(f"{r['item_code']} ({flt(r['net_qty'])} already in stock)" for r in already_stocked)
                stock_warning = (
                    f"Note: the following already have unconsumed stock in the team warehouse for DUID {duid}: "
                    f"{dupes}. Consume or cancel it first if this request wasn't meant to add more on top."
                )

    doc = frappe.get_doc({
        "doctype": "Material Request",
        "material_request_type": "Material Transfer",
        "transaction_date": req_date,
        "schedule_date": pickup_date,
        "pickup_time": pickup_time,
        "company": company,
        "set_warehouse": target_wh,
        "set_from_warehouse": source_wh,
        "im": im,
        "poid": poid,
        "duid": duid,
        "items": [
            {
                "item_code": i["item_code"],
                "qty": flt(i.get("qty", 0)),
                "uom": i.get("uom") or frappe.db.get_value("Item", i["item_code"], "stock_uom") or "",
                "warehouse": target_wh,
                "from_warehouse": source_wh,
                "schedule_date": pickup_date,
                "poid": poid,
                "duid": duid,
                "preferred_batch_no": i.get("preferred_batch_no") or _default_preferred_batch(i["item_code"], duid, source_wh),
            }
            for i in items
        ],
    })
    doc.insert(ignore_permissions=True)
    doc.submit()
    frappe.db.commit()
    return {"name": doc.name, "status": "Pending Approval", "stock_warning": stock_warning}


def _check_team_lead_for_warehouse(warehouse):
    """Only the Team Lead (INET Team.field_user) of the team that owns this
    warehouse — or an Administrator/System Manager override — may confirm or
    reject a transfer staged into that team's warehouse."""
    roles = set(frappe.get_roles(frappe.session.user))
    if roles & {"Administrator", "System Manager"}:
        return
    field_user = frappe.db.get_value("INET Team", {"warehouse": warehouse}, "field_user")
    if not field_user or field_user != frappe.session.user:
        frappe.throw("Only the team's Team Lead can confirm or reject this transfer.", frappe.PermissionError)


def _bill_candidates_for_item(item_code, duid, warehouse):
    """Core lookup shared by get_bill_candidates and get_bill_candidates_bulk
    — see get_bill_candidates for what this returns and why.

    Each batch's real ledger balance is reduced by whatever's already
    earmarked for it via another active request's own preferred_batch_no —
    a Material Request that hasn't been transferred yet doesn't show up in
    the ledger, so without this a second IM requesting the same item+DUID
    would still see (and could pick) a bill another IM already claimed.
    Only requests that haven't actually moved the stock yet count as a
    claim — once transferred, the ledger balance above already reflects it,
    so double-subtracting would under-report real availability.
    """
    if not (item_code and duid and warehouse):
        return []
    if not frappe.get_cached_value("Item", item_code, "has_batch_no"):
        return []

    matching_batches = frappe.db.sql(
        """SELECT b.name FROM `tabBatch` b
           JOIN `tabHuawei Outbound Plan` hop ON hop.name = b.reference_name
           WHERE b.item = %s AND b.reference_doctype = 'Huawei Outbound Plan'
             AND (hop.duid_master = %s OR hop.du_id = %s)""",
        (item_code, duid, duid), pluck="name",
    )
    if not matching_batches:
        return []

    from erpnext.stock.doctype.serial_and_batch_bundle.serial_and_batch_bundle import get_available_batches

    rows = get_available_batches(frappe._dict({
        "item_code": item_code, "warehouse": warehouse, "batch_no": matching_batches,
    })) or []
    if not rows:
        return []

    batch_names = [r.batch_no for r in rows]
    ph = ", ".join(["%s"] * len(batch_names))
    reserved_rows = frappe.db.sql(
        f"""SELECT mri.preferred_batch_no AS batch_no, SUM(mri.qty) AS qty
            FROM `tabMaterial Request Item` mri
            JOIN `tabMaterial Request` mr ON mr.name = mri.parent
            WHERE mri.preferred_batch_no IN ({ph})
              AND mr.docstatus = 1
              AND IFNULL(mr.is_return_request, 0) != 1
              AND IFNULL(mr.transfer_status, '') != 'Completed'
            GROUP BY mri.preferred_batch_no""",
        batch_names, as_dict=True,
    )
    reserved = {r.batch_no: flt(r.qty) for r in reserved_rows}

    out = []
    for r in rows:
        available = flt(r.qty) - reserved.get(r.batch_no, 0)
        if available <= 0.0001:
            continue
        bill_no = r.batch_no.split("::")[0] if "::" in r.batch_no else r.batch_no
        out.append({"batch_no": r.batch_no, "bill_no": bill_no, "available_qty": available})
    return out


@frappe.whitelist()
def get_bill_candidates(item_code, duid, warehouse):
    """Bills (batches) of `item_code` tagged to `duid` that currently have
    stock in `warehouse`, oldest-first, net of whatever's already reserved
    by another pending request — the same order/scope
    _auto_select_batch_for_row would draw from automatically.

    Powers the "which bill would this draw from" tracking: the caller
    should always stamp preferred_batch_no from the first entry (so every
    request is traceable to a real bill from the moment it's created, and a
    bill another IM already claimed is never handed out again), and only
    show a picker UI when this comes back with 2+ rows.
    """
    return _bill_candidates_for_item(item_code, duid, warehouse)


@frappe.whitelist()
def get_bill_candidates_bulk(item_codes, duid, warehouse=None, team_id=None):
    """Same as get_bill_candidates, for several items sharing one DUID +
    warehouse (e.g. every Huawei item on one request, or one Daily
    Execution) — one call instead of N. Returns {item_code: [...]} for
    every item that has at least one bill to draw from (including a single
    entry when there's only one, so the caller can always stamp
    preferred_batch_no — only show a picker UI for entries with 2+ rows).

    Callers that only know a team (not its warehouse directly, e.g. the
    Field execution form) can pass team_id instead of warehouse."""
    if isinstance(item_codes, str):
        item_codes = frappe.parse_json(item_codes) or []
    if not warehouse and team_id:
        warehouse = frappe.db.get_value("INET Team", team_id, "warehouse")
    out = {}
    for item_code in item_codes or []:
        candidates = _bill_candidates_for_item(item_code, duid, warehouse)
        if candidates:
            out[item_code] = candidates
    return out


def _default_preferred_batch(item_code, duid, warehouse):
    """Best bill to stamp on a new item row when the caller didn't pick one
    explicitly — the same first (oldest, non-reserved) candidate
    _auto_select_batch_for_row would land on anyway, resolved up front so
    the request is traceable to a real bill from the moment it's created."""
    if not duid:
        return ""
    candidates = _bill_candidates_for_item(item_code, duid, warehouse)
    return candidates[0]["batch_no"] if candidates else ""


def _auto_select_batch_for_row(item_row):
    """For an OUTGOING Stock Entry Detail row (drawing from item_row.s_warehouse),
    auto-pick which batch(es) to draw from via ERPNext's own
    get_auto_batch_nos (oldest-first) — the same mechanism the Desk "Fetch
    Batch No" button uses, just called server-side so no one has to pick
    manually.

    get_auto_batch_nos has no concept of DUID — left unscoped, several
    bills' batches for the same item can sit in the same warehouse, and it
    would happily pick whichever is oldest regardless of DUID, silently
    misattributing the movement to the wrong bill. When item_row carries a
    duid, this restricts selection to batches whose bill actually matches
    it first, only topping up from any other batch if the matching one(s)
    don't cover the full qty (a real DUID-level shortage should still let
    the item move — this is about traceability, not a new hard block).

    Updates item_row in place for the first (or only) batch, and returns a
    list of extra row dicts for the caller to append if the qty had to
    split across more than one batch.
    """
    if not frappe.get_cached_value("Item", item_row.item_code, "has_batch_no"):
        return []

    from erpnext.stock.doctype.serial_and_batch_bundle.serial_and_batch_bundle import get_auto_batch_nos

    base = {"item_code": item_row.item_code, "warehouse": item_row.s_warehouse}
    qty_needed = flt(item_row.qty)
    duid = item_row.get("duid")
    preferred = item_row.get("preferred_batch_no")

    picks = []
    # A human explicitly chose a bill (only possible when the portal detected
    # a genuine choice between 2+ bills and surfaced it) — draw from it
    # first. Any shortfall still tops up from the normal DUID-scoped /
    # unscoped fallback below, same as the no-preference path.
    if preferred:
        picks = list(get_auto_batch_nos(frappe._dict({
            **base, "qty": qty_needed, "batch_no": [preferred],
        })) or [])

    if duid:
        remaining = qty_needed - sum(flt(p.qty) for p in picks)
        if remaining > 0.0001:
            already_picked = {p.batch_no for p in picks}
            matching_batches = frappe.db.sql(
                """SELECT b.name FROM `tabBatch` b
                   JOIN `tabHuawei Outbound Plan` hop ON hop.name = b.reference_name
                   WHERE b.item = %s AND b.reference_doctype = 'Huawei Outbound Plan'
                     AND (hop.duid_master = %s OR hop.du_id = %s)""",
                (item_row.item_code, duid, duid), pluck="name",
            )
            matching_batches = [b for b in matching_batches if b not in already_picked]
            if matching_batches:
                picks += list(get_auto_batch_nos(frappe._dict({
                    **base, "qty": remaining, "batch_no": matching_batches,
                })) or [])

    remaining = qty_needed - sum(flt(p.qty) for p in picks)
    if remaining > 0.0001:
        already_picked = {p.batch_no for p in picks}
        more = get_auto_batch_nos(frappe._dict({**base, "qty": remaining})) or []
        picks += [p for p in more if p.batch_no not in already_picked]

    if not picks:
        return []

    item_row.batch_no = picks[0].batch_no
    item_row.qty = picks[0].qty
    item_row.use_serial_batch_fields = 1

    extra_rows = []
    for pick in picks[1:]:
        extra_rows.append({
            "item_code": item_row.item_code,
            "qty": pick.qty,
            "uom": item_row.uom,
            "s_warehouse": item_row.s_warehouse,
            "t_warehouse": item_row.t_warehouse,
            "duid": item_row.get("duid"),
            "material_request": item_row.get("material_request"),
            "material_request_item": item_row.get("material_request_item"),
            "batch_no": pick.batch_no,
            "use_serial_batch_fields": 1,
        })
    return extra_rows


@frappe.whitelist()
def approve_material_request(name):
    """Stock Manager stages a Material Transfer via ERPNext make_stock_entry
    (duid + poid set on it), but does NOT submit it — stock does not move
    yet. The receiving team's Team Lead must confirm receipt via
    confirm_material_transfer() before the Stock Entry is submitted."""
    frappe.only_for(["System Manager", "Stock Manager"])

    mr = frappe.get_doc("Material Request", name)
    if mr.docstatus == 2:
        frappe.throw("This request has been cancelled.")
    if mr.transfer_status == "Completed":
        frappe.throw("Material Transfer already completed for this request.")
    if mr.get("pending_transfer_se"):
        frappe.throw("A transfer is already staged for this request, awaiting team confirmation.")
    if mr.docstatus != 1:
        frappe.throw(f"Cannot approve a request in status '{mr.status}'. Submit it first.")

    from erpnext.stock.doctype.material_request.material_request import make_stock_entry
    se = make_stock_entry(name)

    # Inject INET custom dimensions
    duid = mr.get("duid") or ""
    poid_val = mr.get("poid") or ""
    se.poid = poid_val
    se.confirmation_stage = "Awaiting Team Confirmation"
    preferred_map = {i.name: i.get("preferred_batch_no") for i in mr.items if i.get("preferred_batch_no")}
    extra_rows = []
    resolved_batches = {}  # material_request_item name -> batch_no, for tracking
    for item in se.items:
        item.duid = duid
        mri_name = item.get("material_request_item")
        preferred = preferred_map.get(mri_name)
        if not preferred and duid:
            # Defense-in-depth: a request created without the picker
            # stamping a bill (older data, or created directly in Desk)
            # still gets one resolved here, so every transfer is traceable
            # to a real bill from this point on, not just the ones the
            # portal explicitly picked.
            auto_candidates = get_bill_candidates(item.item_code, duid, item.s_warehouse)
            if auto_candidates:
                preferred = auto_candidates[0]["batch_no"]
        if preferred:
            item.preferred_batch_no = preferred
            if mri_name:
                resolved_batches[mri_name] = preferred
        extra_rows.extend(_auto_select_batch_for_row(item))
    for row in extra_rows:
        se.append("items", row)

    se.insert(ignore_permissions=True)
    frappe.db.set_value("Material Request", name, "pending_transfer_se", se.name)
    for mri_name, batch_no in resolved_batches.items():
        frappe.db.set_value("Material Request Item", mri_name, "preferred_batch_no", batch_no, update_modified=False)
    frappe.db.commit()
    return {"name": name, "stock_entry": se.name, "status": "Pending Team Confirmation"}


@frappe.whitelist()
def confirm_material_transfer(name):
    """Team Lead confirms receipt of a staged outbound transfer. This is what
    actually submits the Stock Entry and moves stock into the team warehouse."""
    mr = frappe.get_doc("Material Request", name)
    se_name = mr.get("pending_transfer_se")
    if not se_name:
        frappe.throw("No transfer is staged for this request.")

    _check_team_lead_for_warehouse(mr.set_warehouse)

    se = frappe.get_doc("Stock Entry", se_name)
    if se.docstatus != 0:
        frappe.throw("This transfer is no longer awaiting confirmation.")
    # _check_team_lead_for_warehouse() above is the real authorization gate —
    # the Team Lead role has no base Stock Entry permission at all (they're
    # not meant to touch Stock Entry via Desk), so submit() would otherwise
    # fail with a permission error even for the correct, authorized user.
    se.confirmation_stage = "Confirmed"
    se.flags.ignore_permissions = True
    se.submit()
    frappe.db.set_value("Material Request", name, "pending_transfer_se", "")
    frappe.db.commit()
    return {"name": name, "stock_entry": se.name, "status": "Transferred"}


@frappe.whitelist()
def reject_material_transfer_confirmation(name, reason=None):
    """Team Lead declines a staged outbound transfer. The Stock Entry is kept
    (marked Rejected, never submitted) rather than deleted, so there's a
    visible record of the attempt; the request goes back to Pending Approval
    so the Warehouse Manager can re-stage it (e.g. after fixing quantities),
    which creates a fresh Stock Entry for the new attempt."""
    mr = frappe.get_doc("Material Request", name)
    se_name = mr.get("pending_transfer_se")
    if not se_name:
        frappe.throw("No transfer is staged for this request.")

    _check_team_lead_for_warehouse(mr.set_warehouse)

    se = frappe.get_doc("Stock Entry", se_name)
    if se.docstatus != 0:
        frappe.throw("This transfer is no longer awaiting confirmation.")
    frappe.db.set_value("Stock Entry", se_name, "confirmation_stage", "Rejected")
    frappe.db.set_value("Material Request", name, {
        "pending_transfer_se": "",
        "confirm_rejection_reason": reason or "",
    })
    frappe.db.commit()
    return {"name": name, "status": "Pending Approval"}


@frappe.whitelist()
def list_pending_team_confirmations():
    """Outbound transfers staged (Warehouse Manager already approved) and
    awaiting this Team Lead's confirmation — powers the Field portal's
    "Incoming Transfers" tab. Only the exact INET Team.field_user for a
    warehouse resolves anything here (Administrator/System Manager see
    nothing since they don't own a team warehouse)."""
    team = frappe.db.get_value(
        "INET Team", {"field_user": frappe.session.user, "status": "Active"},
        ["name", "warehouse", "team_name"], as_dict=True,
    )
    if not team or not team.warehouse:
        return []

    rows = frappe.db.get_all(
        "Material Request",
        filters={
            "material_request_type": "Material Transfer",
            "is_return_request": ["!=", 1],
            "set_warehouse": team.warehouse,
            "docstatus": 1,
            "pending_transfer_se": ["not in", ["", None]],
        },
        fields=["name", "transaction_date", "schedule_date", "pickup_time", "poid", "duid", "pending_transfer_se"],
        order_by="creation asc",
    )
    if not rows:
        return []

    poid_links = list({r["poid"] for r in rows if r.get("poid")})
    poid_map = {}
    if poid_links:
        for row in frappe.db.get_all("PO Dispatch", filters={"name": ["in", poid_links]}, fields=["name", "poid"]):
            poid_map[row["name"]] = row["poid"]

    for r in rows:
        r["request_date"] = str(r.pop("transaction_date", "") or "")
        r["pickup_date"] = str(r.pop("schedule_date", "") or "")
        r["pickup_time"] = str(r.get("pickup_time") or "")
        if r.get("poid"):
            r["poid"] = poid_map.get(r["poid"], r["poid"])
        r["items"] = frappe.db.get_all(
            "Stock Entry Detail",
            filters={"parent": r["pending_transfer_se"]},
            fields=["item_code", "item_name", "qty", "uom"],
        )
    return rows


@frappe.whitelist()
def list_team_requests_awaiting_approval():
    """Material Requests submitted for this Team Lead's team warehouse that
    are still sitting at Pending Approval — the Warehouse Manager hasn't
    staged a transfer yet, so there's nothing to confirm or act on. FYI-only
    heads-up for the Field portal's Incoming Transfers tab (a separate,
    non-actionable section from list_pending_team_confirmations above), so
    a TL isn't blindsided by material appearing with no warning once it's
    finally staged. Deliberately not shown as "incoming" — nothing has been
    approved, decided, or batch-picked yet; the Warehouse Manager could
    still reject it or change quantities.
    """
    team = frappe.db.get_value(
        "INET Team", {"field_user": frappe.session.user, "status": "Active"},
        ["name", "warehouse"], as_dict=True,
    )
    if not team or not team.warehouse:
        return []

    rows = frappe.db.get_all(
        "Material Request",
        filters={
            "material_request_type": "Material Transfer",
            "is_return_request": ["!=", 1],
            "set_warehouse": team.warehouse,
            "docstatus": 1,
            "pending_transfer_se": ["in", ["", None]],
            "transfer_status": ["!=", "Completed"],
        },
        fields=["name", "transaction_date", "schedule_date", "pickup_time", "poid", "duid"],
        order_by="creation asc",
    )
    if not rows:
        return []

    poid_links = list({r["poid"] for r in rows if r.get("poid")})
    poid_map = {}
    if poid_links:
        for row in frappe.db.get_all("PO Dispatch", filters={"name": ["in", poid_links]}, fields=["name", "poid"]):
            poid_map[row["name"]] = row["poid"]

    names = [r["name"] for r in rows]
    items_by_mr = {}
    for it in frappe.db.get_all(
        "Material Request Item",
        filters={"parent": ["in", names]},
        fields=["parent", "item_code", "item_name", "qty", "uom"],
    ):
        items_by_mr.setdefault(it["parent"], []).append(
            {"item_code": it["item_code"], "item_name": it["item_name"], "qty": it["qty"], "uom": it["uom"]}
        )

    for r in rows:
        r["request_date"] = str(r.pop("transaction_date", "") or "")
        r["pickup_date"] = str(r.pop("schedule_date", "") or "")
        r["pickup_time"] = str(r.get("pickup_time") or "")
        if r.get("poid"):
            r["poid"] = poid_map.get(r["poid"], r["poid"])
        r["items"] = items_by_mr.get(r["name"], [])
    return rows


@frappe.whitelist()
def reject_material_request(name, reason=None):
    """Stock Manager rejects: stores reason then cancels the Material Request.

    Exception: a direct return initiated by IM (is_direct_return_by_im) is
    awaiting the source team's Team Lead approval at this stage, not Stock
    Manager's — so that Team Lead may reject it here too.

    If a transfer was already staged (approved but not yet confirmed by the
    receiving side), its Draft Stock Entry is removed first so nothing is
    left dangling against the now-cancelled request.
    """
    mr = frappe.get_doc("Material Request", name)

    if mr.get("is_direct_return_by_im"):
        roles = set(frappe.get_roles(frappe.session.user))
        if not roles & {"Administrator", "System Manager"}:
            field_user = frappe.db.get_value("INET Team", {"warehouse": mr.set_from_warehouse}, "field_user")
            if not field_user or field_user != frappe.session.user:
                frappe.throw("Only the team's Team Lead can reject this.", frappe.PermissionError)
    else:
        frappe.only_for(["System Manager", "Stock Manager"])

    # ERPNext's actual status string for a submitted-but-unfulfilled Material
    # Transfer request is "Pending", not "Submitted" — matches the same set
    # _request_status() already treats as "Pending Approval".
    if mr.status not in ("Draft", "Submitted", "Pending"):
        frappe.throw(f"Cannot reject a request in status '{mr.status}'.")

    # Set every field change on the already-loaded `mr` object rather than
    # via frappe.db.set_value() — that writes straight to the DB and bumps
    # `modified` out from under this in-memory doc, so the mr.cancel() below
    # would fail with "Document has been modified" (TimestampMismatchError)
    # every time a reason was given, since cancel()/save() checks that the
    # in-memory `modified` still matches the DB.
    se_name = mr.get("pending_transfer_se")
    if se_name and frappe.db.get_value("Stock Entry", se_name, "docstatus") == 0:
        frappe.delete_doc("Stock Entry", se_name, ignore_permissions=True, force=True)
        # on_stock_entry_trash (the Stock Entry's own delete hook) just
        # cleared pending_transfer_se via frappe.db.set_value as a safety
        # net for a Stock Entry deleted some other way — which bumps this
        # doc's `modified` out from under us the same way a direct
        # db.set_value here would have. Reload so mr.cancel()/save() below
        # checks against the current timestamp instead of a stale one.
        mr.reload()
        mr.pending_transfer_se = ""

    if reason:
        mr.rejection_reason = reason

    if mr.docstatus == 1:
        # The role checks above are the real authorization gate — a Team
        # Lead rejecting their own team's direct return has no base
        # Material Request permission at all (same reasoning as
        # confirm_material_transfer's ignore_permissions).
        mr.flags.ignore_permissions = True
        mr.cancel()
    elif se_name or reason:
        mr.flags.ignore_permissions = True
        mr.save()
    frappe.db.commit()
    return {"name": name, "status": "Rejected"}


# ─── Phase 3: Stock Balance & POID Material APIs ─────────────────────────────

def _classify_item_types(item_codes):
    """Return {item_code: 'customer'|'company'} — customer = Huawei-supplied
    (Item.is_customer_provided_item=1), company = purchased by INET."""
    if not item_codes:
        return {}
    ph = ", ".join(["%s"] * len(item_codes))
    cust_items = frappe.db.sql(
        f"""SELECT name FROM `tabItem`
            WHERE name IN ({ph})
              AND is_customer_provided_item = 1""",
        item_codes, as_list=True,
    )
    customer_set = {r[0] for r in cust_items}
    return {ic: ("customer" if ic in customer_set else "company") for ic in item_codes}


@frappe.whitelist()
def get_team_material_stock(team_id=None):
    """Return current warehouse stock for one or more INET teams.

    - Field team user: their own team's stock (team_id auto-resolved from session).
    - IM: all active teams under their supervision.
    - Admin / System Manager: all active INET teams (or specific team_id if provided).

    Returns a list of:
      { team_id, team_name, warehouse, items: [{ item_code, item_name, qty, uom }] }
    """
    roles = set(frappe.get_roles(frappe.session.user))
    is_admin = bool(roles & {"System Manager", "INET Admin", "Administrator", "Stock Manager"})
    is_im = "INET IM" in roles

    # Determine which teams to fetch
    if team_id:
        teams = frappe.db.get_all(
            "INET Team", filters={"name": team_id, "status": "Active"},
            fields=["name as team_id", "team_name", "warehouse"],
            ignore_permissions=True,
        )
    elif is_admin:
        teams = frappe.db.get_all(
            "INET Team", filters={"status": "Active"},
            fields=["name as team_id", "team_name", "warehouse"],
            order_by="team_name asc", ignore_permissions=True,
        )
    elif is_im:
        im = frappe.db.get_value("IM Master", {"user": frappe.session.user}, "name")
        if not im:
            return []
        teams = frappe.db.get_all(
            "INET Team", filters={"im": im, "status": "Active"},
            fields=["name as team_id", "team_name", "warehouse"],
            order_by="team_name asc", ignore_permissions=True,
        )
    else:
        # Field user — resolve their team.
        # Primary: field_user field on INET Team matches the session user.
        # Fallback: find via team member employee → user_id link.
        resolved_team = frappe.db.get_value(
            "INET Team", {"field_user": frappe.session.user, "status": "Active"}, "name"
        )
        if not resolved_team:
            emp = frappe.db.get_value("Employee", {"user_id": frappe.session.user, "status": "Active"}, "name")
            if emp:
                member_parent = frappe.db.get_value("INET Team Member", {"employee": emp}, "parent")
                if member_parent:
                    team_status = frappe.db.get_value("INET Team", member_parent, "status")
                    if team_status == "Active":
                        resolved_team = member_parent
        if not resolved_team:
            return []
        teams = frappe.db.get_all(
            "INET Team", filters={"name": resolved_team},
            fields=["name as team_id", "team_name", "warehouse"],
            ignore_permissions=True,
        )

    # Batched across every team warehouse rather than 3 queries per team:
    # with 20-100 active teams that was 60-300 round trips on one page load.
    # Same data, same per-team logic below — only the fetch is hoisted.
    _all_whs = [t.get("warehouse") for t in teams if t.get("warehouse")]
    _bins_by_wh, _in_by_wh, _out_by_wh = {}, {}, {}
    if _all_whs:
        _ph_wh = ", ".join(["%s"] * len(_all_whs))
        for r in frappe.db.sql(
            f"""SELECT b.warehouse, b.item_code,
                       IFNULL(i.item_name, b.item_code) AS item_name,
                       b.actual_qty                     AS qty,
                       IFNULL(i.stock_uom, '')          AS uom
                FROM `tabBin` b
                LEFT JOIN `tabItem` i ON i.name = b.item_code
                WHERE b.warehouse IN ({_ph_wh}) AND b.actual_qty > 0
                ORDER BY i.item_name""",
            tuple(_all_whs), as_dict=True,
        ) or []:
            _bins_by_wh.setdefault(r["warehouse"], []).append(r)
        for r in frappe.db.sql(
            f"""SELECT sed.t_warehouse AS wh, sed.item_code, sed.to_duid AS duid,
                       SUM(sed.qty) AS qty
                FROM `tabStock Entry Detail` sed
                JOIN `tabStock Entry` se ON se.name = sed.parent
                WHERE se.docstatus = 1
                  AND se.stock_entry_type = 'Material Transfer'
                  AND sed.t_warehouse IN ({_ph_wh})
                  AND sed.to_duid IS NOT NULL AND sed.to_duid != ''
                GROUP BY sed.t_warehouse, sed.item_code, sed.to_duid""",
            tuple(_all_whs), as_dict=True,
        ) or []:
            _in_by_wh.setdefault(r["wh"], []).append(r)
        for r in frappe.db.sql(
            f"""SELECT sed.s_warehouse AS wh, sed.item_code, sed.duid,
                       SUM(sed.qty) AS qty
                FROM `tabStock Entry Detail` sed
                JOIN `tabStock Entry` se ON se.name = sed.parent
                WHERE se.docstatus = 1
                  AND se.stock_entry_type = 'Material Issue'
                  AND sed.s_warehouse IN ({_ph_wh})
                  AND sed.duid IS NOT NULL AND sed.duid != ''
                GROUP BY sed.s_warehouse, sed.item_code, sed.duid""",
            tuple(_all_whs), as_dict=True,
        ) or []:
            _out_by_wh.setdefault(r["wh"], []).append(r)

    out = []
    for team in teams:
        wh = team.get("warehouse") or ""
        items = []
        if wh:
            bins = _bins_by_wh.get(wh, [])

            # ── Step 2: per-DUID balance from SE Detail ──
            # SLE does not carry the duid inventory dimension column in this
            # installation. Reconstruct per-DUID balance from Stock Entry Detail:
            #   Transfer SE  → items arriving  (t_warehouse=team, to_duid set)
            #   Issue SE     → items consumed  (s_warehouse=team, duid set)
            duid_balance = {}   # (item_code, duid) → net qty
            if bins:
                _ics = {r["item_code"] for r in bins}
                for r in _in_by_wh.get(wh, []):
                    if r["item_code"] not in _ics:
                        continue
                    key = (r["item_code"], r["duid"])
                    duid_balance[key] = duid_balance.get(key, 0.0) + flt(r["qty"])
                for r in _out_by_wh.get(wh, []):
                    if r["item_code"] not in _ics:
                        continue
                    key = (r["item_code"], r["duid"])
                    duid_balance[key] = duid_balance.get(key, 0.0) - flt(r["qty"])

            # ── Step 3: build item_map with per-DUID sources ──
            item_map = {}
            for r in bins:
                ic = r["item_code"]
                uom = r["uom"] or ""
                sources = [
                    {"duid": duid, "qty": round(qty, 4), "uom": uom, "poid": "", "material_request": ""}
                    for (item_code, duid), qty in duid_balance.items()
                    if item_code == ic and qty > 0
                ]
                item_map[ic] = {
                    "item_code": ic,
                    "item_name": r["item_name"] or ic,
                    "uom": uom,
                    "qty": flt(r["qty"]),
                    "sources": sources,
                }

            # ── Step 3: enrich sources with POID from Material Request ──
            # Join MR → PO Dispatch to get the business POID for each DUID.
            if item_map:
                ic_list = list(item_map.keys())
                placeholders = ", ".join(["%s"] * len(ic_list))
                mr_rows = frappe.db.sql(
                    f"""SELECT mri.item_code,
                               IFNULL(pd.poid, '') AS poid,
                               IFNULL(mr.duid, '') AS duid,
                               mr.name             AS material_request
                        FROM `tabMaterial Request Item` mri
                        JOIN `tabMaterial Request` mr ON mr.name = mri.parent
                        LEFT JOIN `tabPO Dispatch` pd ON pd.name = mr.poid
                        WHERE mr.set_warehouse          = %s
                          AND mr.material_request_type  = 'Material Transfer'
                          AND mr.docstatus              = 1
                          AND mri.item_code IN ({placeholders})
                        ORDER BY mr.creation DESC""",
                    (wh, *ic_list), as_dict=True,
                )
                # (item_code, duid) → first matching MR with a POID
                mr_lookup = {}
                for r in mr_rows:
                    key = (r["item_code"], r["duid"])
                    if key not in mr_lookup and r["poid"]:
                        mr_lookup[key] = {"poid": r["poid"], "material_request": r["material_request"]}

                for ic, item in item_map.items():
                    for s in item["sources"]:
                        info = mr_lookup.get((ic, s["duid"])) or {}
                        s["poid"] = info.get("poid", "")
                        s["material_request"] = info.get("material_request", "")

            # ── Step 4: classify item_type from Item master, build final list ──
            type_map = _classify_item_types(list(item_map.keys()))
            for item in item_map.values():
                item["item_type"] = type_map.get(item["item_code"], "company")
                items.append(item)

        out.append({
            "team_id": team["team_id"],
            "team_name": team.get("team_name") or team["team_id"],
            "warehouse": wh,
            "items": items,
        })
    return out


@frappe.whitelist()
def get_main_warehouse_stock():
    """DUID-wise item stock currently sitting in the main/source warehouse.

    Mirrors get_team_material_stock's per-DUID reconstruction from Stock Entry
    Detail, but for the single source warehouse. Inbound sources are Material
    Receipts (to_duid, with legacy duid fallback) plus return Material
    Transfers arriving from a team warehouse (duid = the returning team's
    DUID). Outbound is the normal team-bound Material Transfer (duid).
    """
    source_wh = frappe.db.get_single_value("INET Settings", "source_warehouse") or ""
    if not source_wh:
        return {"warehouse": "", "items": []}

    bins = frappe.db.sql(
        """SELECT b.item_code,
                  IFNULL(i.item_name, b.item_code) AS item_name,
                  b.actual_qty                     AS qty,
                  IFNULL(i.stock_uom, '')          AS uom
           FROM `tabBin` b
           LEFT JOIN `tabItem` i ON i.name = b.item_code
           WHERE b.warehouse = %s AND b.actual_qty > 0
           ORDER BY i.item_name""",
        (source_wh,), as_dict=True,
    )
    if not bins:
        return {"warehouse": source_wh, "items": []}

    ic_list = [r["item_code"] for r in bins]
    placeholders = ", ".join(["%s"] * len(ic_list))

    # IN: Material Receipts arriving at the main warehouse
    in_receipt_rows = frappe.db.sql(
        f"""SELECT sed.item_code,
                   COALESCE(NULLIF(sed.to_duid,''), NULLIF(sed.duid,'')) AS duid,
                   SUM(sed.qty) AS qty
            FROM `tabStock Entry Detail` sed
            JOIN `tabStock Entry` se ON se.name = sed.parent
            WHERE se.docstatus = 1
              AND se.stock_entry_type = 'Material Receipt'
              AND sed.t_warehouse = %s
              AND (NULLIF(sed.to_duid,'') IS NOT NULL OR NULLIF(sed.duid,'') IS NOT NULL)
              AND sed.item_code IN ({placeholders})
            GROUP BY sed.item_code, duid""",
        (source_wh, *ic_list), as_dict=True,
    )

    # IN: Return transfers arriving back from a team warehouse
    in_return_rows = frappe.db.sql(
        f"""SELECT sed.item_code, sed.duid, SUM(sed.qty) AS qty
            FROM `tabStock Entry Detail` sed
            JOIN `tabStock Entry` se ON se.name = sed.parent
            WHERE se.docstatus = 1
              AND se.stock_entry_type = 'Material Transfer'
              AND sed.t_warehouse = %s
              AND sed.duid IS NOT NULL AND sed.duid != ''
              AND sed.item_code IN ({placeholders})
            GROUP BY sed.item_code, sed.duid""",
        (source_wh, *ic_list), as_dict=True,
    )

    # OUT: outbound transfers leaving the main warehouse to a team
    out_rows = frappe.db.sql(
        f"""SELECT sed.item_code, sed.duid, SUM(sed.qty) AS qty
            FROM `tabStock Entry Detail` sed
            JOIN `tabStock Entry` se ON se.name = sed.parent
            WHERE se.docstatus = 1
              AND se.stock_entry_type = 'Material Transfer'
              AND sed.s_warehouse = %s
              AND sed.duid IS NOT NULL AND sed.duid != ''
              AND sed.item_code IN ({placeholders})
            GROUP BY sed.item_code, sed.duid""",
        (source_wh, *ic_list), as_dict=True,
    )

    duid_balance = {}
    for r in in_receipt_rows:
        key = (r["item_code"], r["duid"])
        duid_balance[key] = duid_balance.get(key, 0.0) + flt(r["qty"])
    for r in in_return_rows:
        key = (r["item_code"], r["duid"])
        duid_balance[key] = duid_balance.get(key, 0.0) + flt(r["qty"])
    for r in out_rows:
        key = (r["item_code"], r["duid"])
        duid_balance[key] = duid_balance.get(key, 0.0) - flt(r["qty"])

    type_map = _classify_item_types(ic_list)

    items = []
    for r in bins:
        ic = r["item_code"]
        uom = r["uom"] or ""
        sources = [
            {"duid": duid, "qty": round(qty, 4)}
            for (item_code, duid), qty in duid_balance.items()
            if item_code == ic and qty > 0
        ]
        items.append({
            "item_code": ic,
            "item_name": r["item_name"] or ic,
            "uom": uom,
            "qty": flt(r["qty"]),
            "item_type": type_map.get(ic, "company"),
            "sources": sources,
        })

    return {"warehouse": source_wh, "items": items}


def _append_stock_rows(rows, items, warehouse_type, warehouse_label, warehouse, team_id=""):
    """Append one row per (item, duid) source, plus one "No DUID" row for
    whatever qty isn't attributed to any DUID.

    Company-owned items are usually bought via Purchase Receipt with no site
    tagging, so most of their qty has no DUID — that's expected, not a data
    gap, and needs to stay visible rather than being silently dropped.
    """
    for item in items:
        tagged_qty = 0.0
        for src in item.get("sources", []):
            if not src.get("duid"):
                continue
            tagged_qty += flt(src["qty"])
            rows.append({
                "duid": src["duid"],
                "warehouse_type": warehouse_type,
                "warehouse_label": warehouse_label,
                "warehouse": warehouse,
                "team_id": team_id,
                "item_code": item["item_code"],
                "item_name": item["item_name"],
                "item_type": item["item_type"],
                "qty": src["qty"],
                "uom": item["uom"],
            })

        remaining = round(flt(item["qty"]) - tagged_qty, 4)
        if remaining > 0:
            rows.append({
                "duid": "",
                "warehouse_type": warehouse_type,
                "warehouse_label": warehouse_label,
                "warehouse": warehouse,
                "team_id": team_id,
                "item_code": item["item_code"],
                "item_name": item["item_name"],
                "item_type": item["item_type"],
                "qty": remaining,
                "uom": item["uom"],
            })


@frappe.whitelist()
def get_duid_stock_balance(column_filters=None, limit=None, _options=None, _summary=None):
    """Flattened DUID-wise stock balance across the main warehouse and every
    (permission-scoped) team warehouse — powers the Material Requests
    "Stock Balance" tab for IM and PM.

    Admin / Stock Manager / System Manager: all teams.
    IM: only their own teams (same scoping as get_team_material_stock).
    One row per (duid, warehouse, item); untagged qty is grouped under a
    "No DUID" row rather than dropped (see _append_stock_rows).
    """
    rows = []

    main = get_main_warehouse_stock()
    main_wh = main.get("warehouse") or ""
    _append_stock_rows(rows, main.get("items", []), "Main", "Main Warehouse", main_wh)

    for team in get_team_material_stock():
        _append_stock_rows(
            rows, team.get("items", []), "Team",
            team.get("team_name") or team.get("warehouse"),
            team.get("warehouse"), team.get("team_id"),
        )

    duids = list({r["duid"] for r in rows if r["duid"]})
    project_map = {}
    if duids:
        ph = ", ".join(["%s"] * len(duids))
        for r in frappe.db.sql(
            f"""SELECT du_id, MAX(project_name) AS project_name
                FROM `tabHuawei Outbound Plan`
                WHERE du_id IN ({ph}) AND project_name != ''
                GROUP BY du_id""",
            duids, as_dict=True,
        ):
            project_map[r["du_id"]] = r["project_name"]

    for r in rows:
        r["project_name"] = project_map.get(r["duid"], "")

    # Untagged ("No DUID") rows sort after every real DUID, per warehouse.
    rows.sort(key=lambda r: (r["duid"] or "￿", r["warehouse_type"], r["item_code"]))
    if _options:
        return stock_column_options(rows, "stock_balance", _options.get("col_key"),
                                    _options.get("search"), _options.get("limit"))
    if _summary:
        _rows = filter_stock_rows(rows, "stock_balance", column_filters)
        return stock_summary(_rows, [
            {"key": "lines", "label": "Lines", "agg": "count"},
            {"key": "items", "label": "Items", "agg": "distinct", "field": "item_code"},
            {"key": "duids", "label": "DUIDs", "agg": "distinct", "field": "duid"},
            {"key": "warehouses", "label": "Warehouses", "agg": "distinct", "field": "warehouse_label"},
            {"key": "qty", "label": "Qty", "agg": "sum", "field": "qty",
             "format": "qty", "tone": "good"},
        ])
    return _stock_apply_limit(filter_stock_rows(rows, "stock_balance", column_filters), limit)


@frappe.whitelist()
def get_available_stock(item_code, warehouse=None):
    """Return available qty for an item, optionally scoped to a warehouse."""
    if not item_code:
        return []
    if warehouse:
        qty = frappe.db.get_value("Bin", {"item_code": item_code, "warehouse": warehouse}, "actual_qty") or 0
        return [{"warehouse": warehouse, "qty": flt(qty)}]
    rows = frappe.db.get_all("Bin", filters={"item_code": item_code, "actual_qty": [">", 0]},
                              fields=["warehouse", "actual_qty"])
    return [{"warehouse": r.warehouse, "qty": flt(r.actual_qty)} for r in rows]


def _poid_material_rows(mrs, duid_level):
    """Shared per-MR expansion for get_poid_materials: either the actual
    transferred qty (from Stock Entry Detail, if a transfer SE exists) or
    the still-pending requested qty. `duid_level` just tags where the row
    came from for the frontend to badge differently — it doesn't change how
    a row is computed.
    """
    rows = []
    for mr in mrs:
        team_wh = mr.set_warehouse or ""

        # Sum actual transferred qty per item from Stock Entry Detail rows
        # that reference this MR. material_request lives on SED, not SE header.
        se_items = frappe.db.sql(
            """SELECT sed.item_code,
                      IFNULL(MAX(sed.item_name), sed.item_code) AS item_name,
                      SUM(sed.qty)                               AS qty_transferred,
                      IFNULL(MAX(sed.uom), MAX(sed.stock_uom))  AS uom
               FROM `tabStock Entry`        se
               JOIN `tabStock Entry Detail` sed ON sed.parent = se.name
               WHERE se.docstatus              = 1
                 AND se.stock_entry_type       = 'Material Transfer'
                 AND sed.material_request      = %s
               GROUP BY sed.item_code""",
            (mr.name,), as_dict=True,
        )

        if se_items:
            for row in se_items:
                rows.append({
                    "material_request": mr.name,
                    "transferred": True,
                    "duid_level": duid_level,
                    "item_code": row.item_code,
                    "item_name": row.item_name or row.item_code,
                    "qty_transferred": flt(row.qty_transferred),
                    "qty_used": flt(row.qty_transferred),
                    "uom": row.uom or "Nos",
                    "team_warehouse": team_wh,
                })
        else:
            # SE not yet created — show MR items as Pending
            mr_items = frappe.get_all("Material Request Item",
                filters={"parent": mr.name},
                fields=["item_code", "item_name", "qty", "uom", "stock_uom"],
                ignore_permissions=True)
            for it in mr_items:
                rows.append({
                    "material_request": mr.name,
                    "transferred": False,
                    "duid_level": duid_level,
                    "item_code": it.item_code,
                    "item_name": it.item_name or it.item_code,
                    "qty_transferred": flt(it.qty),
                    "qty_used": flt(it.qty),
                    "uom": it.uom or it.stock_uom or "Nos",
                    "team_warehouse": team_wh,
                })

    if rows:
        is_huawei_map = {
            r["name"]: bool(r["is_customer_provided_item"])
            for r in frappe.db.get_all(
                "Item",
                filters={"name": ["in", list({r["item_code"] for r in rows})]},
                fields=["name", "is_customer_provided_item"],
            )
        }
        for row in rows:
            row["is_huawei"] = is_huawei_map.get(row["item_code"], False)
    return rows


@frappe.whitelist()
def get_poid_materials(po_dispatch):
    """Return material items available for a POID's field execution: items
    requested against this exact POID, PLUS items requested at the DUID
    level with no POID picked — material management is DUID-scoped (a DUID's
    stock is usable on any of its POIDs), and the request form allows POID
    to be left blank for exactly that reason, so a DUID-only request must
    still be visible here rather than disappearing because it names no POID.
    """
    pd_name = _resolve_po_dispatch(po_dispatch) if po_dispatch else None
    if not pd_name:
        return []

    site_duid = frappe.db.get_value("PO Dispatch", pd_name, "site_code") or ""

    mrs = frappe.get_all("Material Request",
        filters={"poid": pd_name, "material_request_type": "Material Transfer", "docstatus": 1},
        fields=["name", "set_warehouse"],
        ignore_permissions=True)

    duid_mrs = []
    if site_duid:
        duid_mrs = frappe.get_all("Material Request",
            filters={
                "duid": site_duid,
                "poid": ["in", ["", None]],
                "material_request_type": "Material Transfer",
                "is_return_request": ["!=", 1],
                "docstatus": 1,
            },
            fields=["name", "set_warehouse"],
            ignore_permissions=True)

    if not mrs and not duid_mrs:
        return []

    return _poid_material_rows(mrs, duid_level=False) + _poid_material_rows(duid_mrs, duid_level=True)


def _duid_item_total_available(duid, item_code):
    """Total qty of item_code still unconsumed for this DUID, anywhere —
    main warehouse or any team warehouse. Moving material between
    warehouses (a Transfer) doesn't change this: it's still the same
    DUID's material, just relocated. Only a Material Receipt (arriving)
    or a Material Issue (actually consumed on site) change the total.
    COALESCEs to_duid/duid on receipts for legacy rows, matching the
    convention already used in get_duid_stock_summary.
    """
    received = flt((frappe.db.sql(
        """SELECT SUM(sed.qty) FROM `tabStock Entry Detail` sed
           JOIN `tabStock Entry` se ON se.name = sed.parent
           WHERE se.docstatus = 1 AND se.stock_entry_type = 'Material Receipt'
             AND sed.item_code = %s AND (sed.to_duid = %s OR sed.duid = %s)""",
        (item_code, duid, duid),
    ) or [[0]])[0][0])
    issued = flt((frappe.db.sql(
        """SELECT SUM(sed.qty) FROM `tabStock Entry Detail` sed
           JOIN `tabStock Entry` se ON se.name = sed.parent
           WHERE se.docstatus = 1 AND se.stock_entry_type = 'Material Issue'
             AND sed.item_code = %s AND sed.duid = %s""",
        (item_code, duid),
    ) or [[0]])[0][0])
    return received - issued


@frappe.whitelist()
def get_duid_huawei_availability(duid, team_id=None):
    """Huawei/customer-provided items relevant to a DUID, for the "select
    and add" Huawei materials picker on the Execution form — gives the TL
    both numbers they actually need: how much of this item exists for the
    DUID overall (duid_available, any warehouse) vs. how much is sitting
    at their own team's warehouse right now, ready to use
    (team_available). Candidate items come from Batch (batch = bill), the
    same mechanism the DUID Stock bill-breakdown popup uses, so it only
    ever lists items this DUID's bills actually contained.
    """
    if not duid:
        return []
    item_codes = frappe.db.sql(
        """SELECT DISTINCT b.item
           FROM `tabBatch` b
           JOIN `tabHuawei Outbound Plan` hop ON hop.name = b.reference_name
           WHERE b.reference_doctype = 'Huawei Outbound Plan'
             AND (hop.du_id = %s OR hop.duid_master = %s)""",
        (duid, duid), pluck="item",
    )
    if not item_codes:
        return []

    team_wh = frappe.db.get_value("INET Team", team_id, "warehouse") if team_id else ""
    items = frappe.db.get_all(
        "Item", filters={"name": ["in", item_codes]},
        fields=["name as item_code", "item_name", "stock_uom as uom"],
    )
    out = []
    for it in items:
        duid_available = _duid_item_total_available(duid, it.item_code)
        team_available = _team_duid_item_balance(team_wh, duid, it.item_code) if team_wh else 0
        if duid_available <= 0 and team_available <= 0:
            continue
        out.append({
            "item_code": it.item_code,
            "item_name": it.item_name or it.item_code,
            "uom": it.uom or "Nos",
            "duid_available": duid_available,
            "team_available": team_available,
        })
    return out


# ─── CIAG Site Sign & Verify Status Report ─────────────────────────────────────
# Mirrors the client-facing "CIAG - Site Sign & Verify Status" email report.
# SLA thresholds (client-defined): 0-3 days Normal, 4-6 Warning, 7+ Overdue.

def _sla_status(pending_days):
    if pending_days <= 3:
        return "NORMAL"
    if pending_days <= 6:
        return "WARNING"
    return "OVERDUE"


@frappe.whitelist()
def get_site_sign_status(duids=None):
    """Bills received but not yet fully consumed (used/"signed") at their
    site. Pending Days = days since the bill's outbound (dispatch) date.

    `duids`, when given, keeps only bills whose site is in that set — how the
    IM report catalog scopes this to one IM. Huawei Outbound Plan carries
    neither an IM nor a team (its only site handle is du_id/duid_master), so
    an IM's DUID set has to be reached through their PO Dispatch lines and
    executions instead; see _im_duid_scope in api/im_reports.py, which also
    documents what that indirection does and does not guarantee.

    A bill's received/issued qty is reconstructed from Batch (batch = bill)
    — the same mechanism the DUID Stock "Bills" popup uses — so this only
    covers bills that went through the batch-tracked flow. Bills received
    before that existed (or via some other path) have no batch rows and
    can't be measured here.
    """
    plans = frappe.db.get_all(
        "Huawei Outbound Plan",
        filters={"subcon": "INET", "outbound_status": "Received"},
        fields=["bill_no", "project_name", "du_id", "duid_master", "outbound_date"],
    )
    # Filtered here rather than in the query: the site can sit in either
    # du_id or duid_master, and the rest of this function already resolves
    # the two the same way.
    if duids is not None:
        _want = set(duids)
        plans = [p for p in plans if (p.du_id or p.duid_master) in _want]
    if not plans:
        return []

    bill_nos = [p.bill_no for p in plans]
    placeholders = ", ".join(["%s"] * len(bill_nos))
    rows = frappe.db.sql(
        f"""SELECT b.reference_name AS bill_no,
                   SUM(CASE WHEN se.stock_entry_type = 'Material Receipt' THEN sed.qty ELSE 0 END) AS received_qty,
                   SUM(CASE WHEN se.stock_entry_type = 'Material Issue' THEN sed.qty ELSE 0 END) AS issued_qty
            FROM `tabBatch` b
            JOIN `tabStock Entry Detail` sed ON sed.batch_no = b.name
            JOIN `tabStock Entry` se ON se.name = sed.parent
            WHERE b.reference_doctype = 'Huawei Outbound Plan'
              AND b.reference_name IN ({placeholders})
              AND se.docstatus = 1
            GROUP BY b.reference_name""",
        bill_nos, as_dict=True,
    )
    balance_map = {r.bill_no: (flt(r.received_qty), flt(r.issued_qty)) for r in rows}

    # DUID Master.site_id is the client's actual site code (e.g. "ER_0016",
    # "708-14-000") — a genuine dedicated field, unlike Huawei Outbound
    # Plan.customer_site_id which turned out to hold something else
    # entirely. Sparsely populated on this install (~3% of DUID Master
    # records), so a lot of rows will still show a blank Site ID — that's
    # a data-completeness gap in DUID Master, not a lookup bug.
    duid_values = list({(p.du_id or p.duid_master) for p in plans if (p.du_id or p.duid_master)})
    site_id_map = {}
    if duid_values:
        site_id_map = {
            r["duid"]: r["site_id"]
            for r in frappe.db.get_all("DUID Master", filters={"duid": ["in", duid_values]}, fields=["duid", "site_id"])
        }

    today = frappe.utils.getdate()
    out = []
    for p in plans:
        received, issued = balance_map.get(p.bill_no, (0.0, 0.0))
        if received <= 0 or issued >= received:
            continue
        pending_days = (today - frappe.utils.getdate(p.outbound_date)).days if p.outbound_date else 0
        duid = p.du_id or p.duid_master or ""
        out.append({
            "bill_no": p.bill_no,
            "project_name": p.project_name or "",
            "site_id": site_id_map.get(duid, "") or "",
            "du_id": duid,
            "pending_days": pending_days,
            "status": _sla_status(pending_days),
        })
    out.sort(key=lambda r: -r["pending_days"])
    return out


@frappe.whitelist()
def get_site_verify_status(im_ids=None):
    """Sites where the TL has completed work (material used) but the
    client hasn't yet approved CIAG. Pending Days = days since
    ciag_status_date; falls back to execution_date for older records
    saved before that field existed.

    Unlike the two bill reports either side of it, this one sits on Daily
    Execution, which carries its own `im` stamp — so `im_ids` scopes it
    directly and exactly, with no DUID indirection.
    """
    _scope, _params = "", []
    if im_ids:
        _ph = ", ".join(["%s"] * len(im_ids))
        # de.im is the stamp on the execution itself; pd.im is the one on the
        # PO line. Either identifying the IM is enough, matching how the
        # Team Utilization script report already resolves an IM filter.
        _scope = f" AND (de.im IN ({_ph}) OR pd.im IN ({_ph}))"
        _params = list(im_ids) * 2
    rows = frappe.db.sql(
        f"""SELECT de.name, de.system_id, de.execution_date, de.ciag_status_date,
                  pd.project_code, pd.site_code
           FROM `tabDaily Execution` de
           JOIN `tabPO Dispatch` pd ON pd.name = de.system_id
           WHERE de.tl_status = 'Completed' AND de.ciag_status = 'Open'
             {_scope}""",
        tuple(_params), as_dict=True,
    )
    if not rows:
        return []

    project_codes = list({r.project_code for r in rows if r.project_code})
    project_names = {}
    if project_codes:
        project_names = {
            r["project_code"]: r["project_name"]
            for r in frappe.db.get_all(
                "Project Control Center",
                filters={"project_code": ["in", project_codes]},
                fields=["project_code", "project_name"],
            )
        }

    duids = list({r.site_code for r in rows if r.site_code})
    site_id_map = {}
    if duids:
        site_id_map = {
            r["duid"]: r["site_id"]
            for r in frappe.db.get_all("DUID Master", filters={"duid": ["in", duids]}, fields=["duid", "site_id"])
        }

    today = frappe.utils.getdate()
    # One row per site (DUID) — the latest pending execution wins if there
    # happen to be more than one (e.g. a revisit).
    by_duid = {}
    for r in rows:
        ref_date = r.ciag_status_date or r.execution_date
        pending_days = (today - frappe.utils.getdate(ref_date)).days if ref_date else 0
        existing = by_duid.get(r.site_code)
        if existing and existing["pending_days"] >= pending_days:
            continue
        by_duid[r.site_code] = {
            "project_name": project_names.get(r.project_code, ""),
            "site_id": site_id_map.get(r.site_code, ""),
            "du_id": r.site_code or "",
            "pending_days": pending_days,
            "status": _sla_status(pending_days),
        }

    out = list(by_duid.values())
    out.sort(key=lambda r: -r["pending_days"])
    return out


_SIGN_STATUS_COLUMNS = [
    {"fieldname": "bill_no", "label": "Bill No."},
    {"fieldname": "project_name", "label": "Project Name"},
    {"fieldname": "site_id", "label": "Site ID"},
    {"fieldname": "du_id", "label": "DU ID"},
    {"fieldname": "status", "label": "Status"},
    {"fieldname": "pending_days", "label": "Pending Days"},
]

_VERIFY_STATUS_COLUMNS = [
    {"fieldname": "project_name", "label": "Project Name"},
    {"fieldname": "site_id", "label": "Site ID"},
    {"fieldname": "du_id", "label": "DU ID"},
    {"fieldname": "status", "label": "Status"},
    {"fieldname": "pending_days", "label": "Pending Days"},
]


@frappe.whitelist()
def report_site_sign_status(filters=None):
    """Standard {columns, data} wrapper over get_site_sign_status for the
    admin Reports catalog — plain table + DataTablePro's own column
    filters, same as every other report there."""
    return {"columns": _SIGN_STATUS_COLUMNS, "data": get_site_sign_status()}


@frappe.whitelist()
def report_site_verify_status(filters=None):
    """Standard {columns, data} wrapper over get_site_verify_status for the
    admin Reports catalog."""
    return {"columns": _VERIFY_STATUS_COLUMNS, "data": get_site_verify_status()}


@frappe.whitelist()
def get_bill_wise_status(duids=None):
    """Per (bill, item) received/issued/remaining — the detailed bill-level
    breakdown PM/IM asked for: how much of each item in a bill actually
    reached site vs. what's still sitting unconsumed. One row per bill+item
    (a multi-item bill produces several rows).

    Same batch-reconstruction limitation as get_site_sign_status: only
    bills that actually went through the batch-tracked Receipt flow have
    rows here — a bill with outbound_status still Prepared/Pending has no
    item-level data anywhere in the system yet (Huawei Outbound Plan
    itself carries no item/qty fields; those only exist once a Receipt
    creates the bill's batches).
    """
    plans = frappe.db.get_all(
        "Huawei Outbound Plan",
        filters={"subcon": "INET"},
        fields=["bill_no", "project_name", "du_id", "duid_master", "outbound_date", "outbound_status"],
    )
    # `duids` scopes this to one IM's sites — same mechanism and same caveats
    # as get_site_sign_status above.
    if duids is not None:
        _want = set(duids)
        plans = [p for p in plans if (p.du_id or p.duid_master) in _want]
    if not plans:
        return []

    bill_nos = [p.bill_no for p in plans]
    placeholders = ", ".join(["%s"] * len(bill_nos))
    source_wh = frappe.db.get_single_value("INET Settings", "source_warehouse") or ""
    rows = frappe.db.sql(
        f"""SELECT b.reference_name AS bill_no, b.item AS item_code,
                   IFNULL(MAX(i.item_name), b.item) AS item_name,
                   IFNULL(MAX(sed.uom), '') AS uom,
                   SUM(CASE WHEN se.stock_entry_type = 'Material Receipt' THEN sed.qty ELSE 0 END) AS received_qty,
                   SUM(CASE WHEN se.stock_entry_type = 'Material Issue' THEN sed.qty ELSE 0 END) AS issued_qty,
                   SUM(CASE
                         WHEN se.stock_entry_type = 'Material Transfer' AND sed.s_warehouse = %s THEN sed.qty
                         WHEN se.stock_entry_type = 'Material Transfer' AND sed.t_warehouse = %s THEN -sed.qty
                         ELSE 0
                       END) AS transferred_qty
            FROM `tabBatch` b
            JOIN `tabStock Entry Detail` sed ON sed.batch_no = b.name
            JOIN `tabStock Entry` se ON se.name = sed.parent
            LEFT JOIN `tabItem` i ON i.name = b.item
            WHERE b.reference_doctype = 'Huawei Outbound Plan'
              AND b.reference_name IN ({placeholders})
              AND se.docstatus = 1
            GROUP BY b.reference_name, b.item""",
        [source_wh, source_wh, *bill_nos], as_dict=True,
    )

    plan_map = {p.bill_no: p for p in plans}
    today = frappe.utils.getdate()
    out = []
    for r in rows:
        plan = plan_map.get(r.bill_no)
        if not plan:
            continue
        received = flt(r.received_qty)
        issued = flt(r.issued_qty)
        transferred = flt(r.transferred_qty)
        remaining = received - issued
        pending_days = (today - frappe.utils.getdate(plan.outbound_date)).days if plan.outbound_date else 0
        out.append({
            "bill_no": r.bill_no,
            "project_name": plan.project_name or "",
            "du_id": plan.du_id or plan.duid_master or "",
            "item_code": r.item_code,
            "item_name": r.item_name or r.item_code,
            "uom": r.uom or "Nos",
            "received_qty": received,
            "transferred_qty": transferred,
            "issued_qty": issued,
            "remaining_qty": remaining,
            "remaining_main_qty": received - transferred,
            "outbound_date": str(plan.outbound_date or ""),
            "status": _sla_status(pending_days) if remaining > 0.0001 else "COMPLETE",
        })
    out.sort(key=lambda r: (r["du_id"], r["bill_no"], r["item_code"]))
    return out


_BILL_WISE_COLUMNS = [
    {"fieldname": "bill_no", "label": "Bill No."},
    {"fieldname": "project_name", "label": "Project Name"},
    {"fieldname": "du_id", "label": "DU ID"},
    {"fieldname": "item_code", "label": "Item Code"},
    {"fieldname": "item_name", "label": "Item Name"},
    {"fieldname": "received_qty", "label": "Received Qty"},
    {"fieldname": "transferred_qty", "label": "Transferred Qty"},
    {"fieldname": "issued_qty", "label": "Used Qty"},
    {"fieldname": "remaining_qty", "label": "Remaining Qty"},
    {"fieldname": "uom", "label": "UOM"},
    {"fieldname": "outbound_date", "label": "Outbound Date"},
    {"fieldname": "status", "label": "Status"},
]

@frappe.whitelist()
def report_bill_wise_status(filters=None):
    """Standard {columns, data} wrapper over get_bill_wise_status for the
    admin Reports catalog."""
    return {"columns": _BILL_WISE_COLUMNS, "data": get_bill_wise_status()}


def _bill_warehouse_balances(bill_nos):
    """Current per-warehouse balance for each (bill, item), via ERPNext's own
    Stock Ledger Entry — the ground truth for "where is this batch's stock
    right now", instead of hand-reconstructing it from Receipt/Transfer/Issue.

    This install books batches through Serial and Batch Bundle, so
    `Stock Ledger Entry.batch_no` itself is never populated — only
    `serial_and_batch_bundle` is. The reliable link back to a specific
    batch is `sle.voucher_detail_no = sed.name` (the exact Stock Entry
    Detail row that produced the ledger entry), since `sed.batch_no` is
    always set directly on that row.
    """
    if not bill_nos:
        return {}
    bill_nos = list(bill_nos)
    placeholders = ", ".join(["%s"] * len(bill_nos))
    rows = frappe.db.sql(
        f"""SELECT b.reference_name AS bill_no, sle.item_code AS item_code,
                   sle.warehouse AS warehouse, SUM(sle.actual_qty) AS current_qty
            FROM `tabBatch` b
            JOIN `tabStock Entry Detail` sed ON sed.batch_no = b.name
            JOIN `tabStock Ledger Entry` sle ON sle.voucher_detail_no = sed.name
            WHERE b.reference_doctype = 'Huawei Outbound Plan'
              AND b.reference_name IN ({placeholders})
              AND sle.is_cancelled = 0
            GROUP BY b.reference_name, sle.item_code, sle.warehouse
            HAVING SUM(sle.actual_qty) > 0.0001""",
        bill_nos, as_dict=True,
    )
    wh_map = {}
    for r in rows:
        key = (r.bill_no, r.item_code)
        wh_map.setdefault(key, []).append({"warehouse": r.warehouse, "current_qty": flt(r.current_qty)})
    return wh_map


def get_bill_wise_status_by_warehouse(filters=None):
    """Bill-wise status exploded by current per-warehouse balance — same
    per-(bill,item) rows as get_bill_wise_status, but one row per warehouse
    that still holds some of that batch's stock (so you can see whether
    what's "remaining" is sitting in the main warehouse or has already
    moved to a team). Shared by the Desk "Bill Wise Material Status" report
    and the portal Material Management "Bill Wise Material" tab.

    filters (all optional): bill_no, du_id, item_code, warehouse,
    from_date/to_date (against outbound_date).
    """
    base_rows = get_bill_wise_status()
    f = filters or {}
    bill_no = f.get("bill_no")
    du_id = f.get("du_id") or f.get("duid")
    item_code = f.get("item_code")
    warehouse = f.get("warehouse")
    from_date = f.get("from_date")
    to_date = f.get("to_date")

    if bill_no:
        base_rows = [r for r in base_rows if r["bill_no"] == bill_no]
    if du_id:
        base_rows = [r for r in base_rows if r["du_id"] == du_id]
    if item_code:
        base_rows = [r for r in base_rows if r["item_code"] == item_code]
    if from_date:
        base_rows = [r for r in base_rows if r["outbound_date"] and r["outbound_date"] >= from_date]
    if to_date:
        base_rows = [r for r in base_rows if r["outbound_date"] and r["outbound_date"] <= to_date]

    if not base_rows:
        return []

    wh_map = _bill_warehouse_balances({r["bill_no"] for r in base_rows})

    data = []
    for r in base_rows:
        wh_rows = wh_map.get((r["bill_no"], r["item_code"]), [])
        if not wh_rows:
            wh_rows = [{"warehouse": "", "current_qty": 0.0}]
        for wh in wh_rows:
            if warehouse and wh["warehouse"] != warehouse:
                continue
            row = dict(r)
            row["warehouse"] = wh["warehouse"]
            row["current_qty"] = wh["current_qty"]
            data.append(row)

    data.sort(key=lambda r: (r["warehouse"] or "￿", r["du_id"], r["bill_no"], r["item_code"]))
    return data


@frappe.whitelist()
def get_bill_wise_material(filters=None, column_filters=None, limit=None, _options=None, _summary=None):
    """Portal wrapper over get_bill_wise_status_by_warehouse — powers the
    "Bill Wise Material" tab in Material Management (IM + PM)."""
    if isinstance(filters, str):
        filters = frappe.parse_json(filters) or {}
    rows = get_bill_wise_status_by_warehouse(filters)
    if _options:
        return stock_column_options(rows, "bill_wise", _options.get("col_key"),
                                    _options.get("search"), _options.get("limit"))
    if _summary:
        _rows = filter_stock_rows(rows, "bill_wise", column_filters)
        return stock_summary(_rows, [
            {"key": "lines", "label": "Lines", "agg": "count"},
            {"key": "bills", "label": "Bills", "agg": "distinct", "field": "bill_no"},
            {"key": "items", "label": "Items", "agg": "distinct", "field": "item_code"},
            {"key": "duids", "label": "DUIDs", "agg": "distinct", "field": "du_id"},
            {"key": "received", "label": "Received", "agg": "sum", "field": "received_qty",
             "group": "Qty", "format": "qty"},
            {"key": "used", "label": "Used", "agg": "sum", "field": "issued_qty",
             "group": "Qty", "format": "qty", "tone": "good"},
            {"key": "remaining", "label": "Remaining", "agg": "sum", "field": "remaining_qty",
             "group": "Qty", "format": "qty", "tone": "warn",
             "hint": "Received but not yet consumed"},
        ])
    return _stock_apply_limit(filter_stock_rows(rows, "bill_wise", column_filters), limit)


@frappe.whitelist()
def report_huawei_outbound_analytics(filters=None):
    """Standard {columns, data, chart} wrapper over the Huawei Outbound
    Analytics Script Report — one row per (Project, Subcontractor) pair, so
    the PM portal can filter to one project/domain/subcontractor and see
    exactly who/how much within it, not just Desk. The chart payload
    previously got dropped here (only columns/data were unpacked) —
    ReportChart.jsx on the portal side expects the same frappe-charts
    {labels, datasets} shape Desk already renders natively, so no
    conversion needed."""
    from inet_app.inet_app.report.huawei_outbound_analytics.huawei_outbound_analytics import execute

    if isinstance(filters, str):
        filters = frappe.parse_json(filters)
    columns, data, _msg, chart = execute(filters or {})
    # "% of Total" is already a share-of-the-whole figure (unlike a report
    # like Top Teams' Completion %), so — unusually — summing it back up IS
    # the correct total: it should land at ~100% given rounding, which
    # doubles as a quick sanity check that every row got counted.
    totals = {"pct": round(sum(r.get("pct") or 0 for r in data), 1)} if data else {}
    return {"columns": columns, "data": data, "chart": chart, "totals": totals}


@frappe.whitelist()
def get_huawei_outbound_project_domain_options():
    """{id, label} options for the Project / Domain filters on the Huawei
    Outbound Analytics report — only projects/domains that actually appear
    in Huawei Outbound Plan data (mirrors how the existing Subcontractor
    filter is scoped), with the project's real name as the label rather
    than its code."""
    rows = frappe.db.sql(
        """
        SELECT DISTINCT hop.project, pcc.project_name, pcc.project_domain
        FROM `tabHuawei Outbound Plan` hop
        LEFT JOIN `tabProject Control Center` pcc ON pcc.project_code = hop.project
        WHERE IFNULL(hop.project, '') != ''
        """,
        as_dict=True,
    )
    projects = sorted(
        ({"id": r.project, "label": r.project_name or r.project} for r in rows),
        key=lambda o: o["label"],
    )
    domains = sorted(
        {(r.project_domain or "").strip() for r in rows if (r.project_domain or "").strip()}
    )
    return {
        "projects": projects,
        "domains": [{"id": d, "label": d} for d in domains],
    }


# ─── Material Return Flow ──────────────────────────────────────────────────────


def _get_team_duid_per_item(team_wh, item_codes):
    """Return {item_code: duid} for items in a team warehouse.

    Uses the Transfer SE Detail to_duid (the DUID items arrived under).
    Returns the DUID with the highest transferred qty per item, which is the
    primary source DUID to tag on the return SE.
    """
    if not item_codes or not team_wh:
        return {}
    placeholders = ", ".join(["%s"] * len(item_codes))
    rows = frappe.db.sql(
        f"""SELECT sed.item_code, sed.to_duid, SUM(sed.qty) AS total_qty
            FROM `tabStock Entry Detail` sed
            JOIN `tabStock Entry` se ON se.name = sed.parent
            WHERE se.docstatus = 1
              AND se.stock_entry_type = 'Material Transfer'
              AND sed.t_warehouse = %s
              AND sed.to_duid IS NOT NULL AND sed.to_duid != ''
              AND sed.item_code IN ({placeholders})
            GROUP BY sed.item_code, sed.to_duid
            ORDER BY total_qty DESC""",
        (team_wh, *item_codes), as_dict=True,
    )
    result = {}
    for r in rows:
        if r["item_code"] not in result:   # highest-qty DUID wins
            result[r["item_code"]] = r["to_duid"]
    return result


def _team_duid_item_balance(team_wh, duid, item_code):
    """Current net qty of item_code, for this DUID, at team_wh — the exact
    same reconstruction get_team_material_stock() uses (Transfer-in via
    to_duid, minus Issue-out via duid), so this check never disagrees with
    what the team-stock view already shows as "available". SLE doesn't
    carry the DUID dimension on this installation, hence reconstructing
    from Stock Entry Detail rather than reading Bin/SLE directly.
    """
    in_qty = flt((frappe.db.sql(
        """SELECT SUM(sed.qty) FROM `tabStock Entry Detail` sed
           JOIN `tabStock Entry` se ON se.name = sed.parent
           WHERE se.docstatus = 1 AND se.stock_entry_type = 'Material Transfer'
             AND sed.t_warehouse = %s AND sed.to_duid = %s AND sed.item_code = %s""",
        (team_wh, duid, item_code),
    ) or [[0]])[0][0])
    out_qty = flt((frappe.db.sql(
        """SELECT SUM(sed.qty) FROM `tabStock Entry Detail` sed
           JOIN `tabStock Entry` se ON se.name = sed.parent
           WHERE se.docstatus = 1 AND se.stock_entry_type = 'Material Issue'
             AND sed.s_warehouse = %s AND sed.duid = %s AND sed.item_code = %s""",
        (team_wh, duid, item_code),
    ) or [[0]])[0][0])
    return in_qty - out_qty


def _huawei_item_map(item_codes):
    if not item_codes:
        return {}
    return {
        r["name"]: bool(r["is_customer_provided_item"])
        for r in frappe.db.get_all("Item", filters={"name": ["in", item_codes]}, fields=["name", "is_customer_provided_item"])
    }


def _material_issue_available(team_wh, duid, item_code, is_huawei):
    # Additional (company-owned) items aren't DUID-tracked — they're general
    # team stock, not tied to any one site's bill — so their availability is
    # the warehouse's plain Bin balance, not the DUID-scoped reconstruction
    # Huawei/customer-provided items use. Without this split, an Additional
    # item the TL genuinely has in stock would always show 0 available and
    # block the save, since it never carries a to_duid on its transfer in.
    if is_huawei:
        return _team_duid_item_balance(team_wh, duid, item_code)
    return flt(frappe.db.get_value("Bin", {"item_code": item_code, "warehouse": team_wh}, "actual_qty") or 0)


def _throw_insufficient_stock(row, balance):
    item_label = row.get("item_name") or row.item_code
    frappe.throw(
        f"Only {balance:g} {row.uom or ''} of \"{item_label}\" is in your stock for "
        f"this site — a transfer may still be pending approval. Check Incoming, or "
        f"adjust Used Qty."
    )


def _build_issue_se_item(row, qty, team_wh, duid, expense_account):
    preferred_batch_no = row.get("preferred_batch_no")
    if not preferred_batch_no and duid:
        # Defense-in-depth, same as the Transfer/Return flows: always
        # resolve a real bill for tracking even if the TL's form didn't
        # explicitly stamp one — get_bill_candidates already excludes
        # anything another pending request reserved.
        auto_candidates = get_bill_candidates(row.item_code, duid, team_wh)
        if auto_candidates:
            preferred_batch_no = auto_candidates[0]["batch_no"]
            if row.get("name"):
                frappe.db.set_value("Daily Execution Material", row.name, "preferred_batch_no", preferred_batch_no, update_modified=False)
    item_row = frappe._dict({
        "item_code": row.item_code,
        "qty": qty,
        "uom": row.uom or "Nos",
        "s_warehouse": team_wh,
        "duid": duid,
        "preferred_batch_no": preferred_batch_no,
        # Deliberately NOT carrying material_request through onto the Issue
        # row: ERPNext's own validate_with_material_request() looks up a
        # Material Request Item by (material_request_item, material_request)
        # whenever material_request is truthy, and crashes with
        # AttributeError on a None result if material_request_item isn't
        # also set to a matching child row — which it never was here. A
        # Material Issue also doesn't correspond 1:1 with the original
        # transfer request anyway (a TL can use partial/combined qty from
        # it), so there's nothing meaningful to link back to; traceability
        # already comes from the DUID + batch stamped below, not from this.
    })
    extra_rows = _auto_select_batch_for_row(item_row)
    items = [dict(item_row)] + extra_rows
    for it in items:
        if expense_account:
            it["expense_account"] = expense_account
        it[ACCOUNTING_DUID_FIELDNAME] = duid
    return items


def _flush_material_usage(rows):
    """Persist qty_issued/material_issue directly to each already-existing
    Daily Execution Material row. Mutating row.qty_issued/row.material_issue
    on the in-memory doc object alone does nothing — update_execution
    already called doc.save() before invoking issue_material_for_execution,
    and nothing calls it again afterward (calling it a second time would
    double-fire the Daily Execution on_update notification hook). Each
    child row already has a real name by this point (it was inserted as
    part of that earlier save), so writing straight to it is safe and
    doesn't need the parent doc touched at all.
    """
    for row in rows:
        if not row.get("name"):
            continue
        frappe.db.set_value(
            "Daily Execution Material", row.name,
            {"qty_issued": flt(row.get("qty_issued") or 0), "material_issue": row.get("material_issue") or None},
            update_modified=False,
        )


def issue_material_for_execution(doc):
    """Reflects doc.material_usage into stock, in two phases:

    - While the TL is still working (tl_status != "Completed"): maintain a
      single DRAFT Material Issue Stock Entry for this execution, rebuilt
      from the current qty_used values every time this runs. Nothing
      actually leaves the warehouse yet — the TL is still adjusting
      numbers, so nothing should move until the work is genuinely done.
      This still validates against real stock so a TL entering more than
      the team has gets caught immediately, not just at completion.
    - The moment tl_status becomes "Completed": that draft (creating one
      first if this is the very first save already marked Completed) is
      submitted, actually moving stock. qty_issued is only ever set to
      match qty_used at this point — before that it stays 0, since nothing
      has really moved.
    - If material_usage changes again AFTER the issue was already
      submitted (a post-completion correction), the old draft can no
      longer be edited (submitted Stock Entries are immutable) — any
      further increase is issued immediately as a separate correction
      entry, same as this function always worked before drafting existed.
      A decrease is never auto-reversed.

    Raises on insufficient stock — a real business-rule violation the
    caller should let block the save so the TL corrects the number. Any
    other error is the caller's call whether to swallow.

    Returns the (draft or submitted) Stock Entry name, or None if there
    was nothing to do.
    """
    if not doc.get("material_usage") or not doc.get("team") or not doc.get("system_id"):
        return None

    team_wh = frappe.db.get_value("INET Team", doc.team, "warehouse")
    duid = frappe.db.get_value("PO Dispatch", doc.system_id, "site_code")
    if not team_wh or not duid:
        return None

    is_completed = doc.get("tl_status") == "Completed"
    expense_account = frappe.db.get_single_value("INET Settings", "material_issue_expense_account")

    draft_name = next((r.get("material_issue") for r in doc.material_usage if r.get("material_issue")), None)
    draft_docstatus = frappe.db.get_value("Stock Entry", draft_name, "docstatus") if draft_name else None

    if draft_docstatus == 1:
        # Already submitted from a previous Completed save — any further
        # increase is a post-completion correction, issued immediately
        # (there's no draft phase left to fold it into).
        to_issue = [
            (row, flt(row.qty_used) - flt(row.get("qty_issued") or 0))
            for row in doc.material_usage
        ]
        to_issue = [(row, delta) for row, delta in to_issue if delta > 0]
        if not to_issue:
            return draft_name

        is_huawei_map = _huawei_item_map(list({row.item_code for row, _ in to_issue}))
        se_items = []
        for row, delta in to_issue:
            balance = _material_issue_available(team_wh, duid, row.item_code, is_huawei_map.get(row.item_code))
            if delta > balance:
                _throw_insufficient_stock(row, balance)
            se_items.extend(_build_issue_se_item(row, delta, team_wh, duid, expense_account))

        se = frappe.get_doc({"doctype": "Stock Entry", "stock_entry_type": "Material Issue", "items": se_items})
        se.insert(ignore_permissions=True)
        se.submit()
        for row, delta in to_issue:
            row.qty_issued = flt(row.qty_used)
            row.material_issue = se.name
        _flush_material_usage([row for row, _ in to_issue])
        frappe.db.commit()
        return se.name

    # Pre-completion: maintain one draft, rebuilt from current qty_used.
    rows = [r for r in doc.material_usage if flt(r.qty_used) > 0]

    if not rows:
        if draft_name and draft_docstatus == 0:
            frappe.delete_doc("Stock Entry", draft_name, ignore_permissions=True, force=True)
        for row in doc.material_usage:
            row.material_issue = None
            row.qty_issued = 0
        _flush_material_usage(doc.material_usage)
        frappe.db.commit()
        return None

    is_huawei_map = _huawei_item_map(list({row.item_code for row in rows}))
    se_items = []
    for row in rows:
        balance = _material_issue_available(team_wh, duid, row.item_code, is_huawei_map.get(row.item_code))
        if flt(row.qty_used) > balance:
            _throw_insufficient_stock(row, balance)
        se_items.extend(_build_issue_se_item(row, flt(row.qty_used), team_wh, duid, expense_account))

    if draft_name and draft_docstatus == 0:
        draft = frappe.get_doc("Stock Entry", draft_name)
        draft.set("items", [])
        for it in se_items:
            draft.append("items", it)
        draft.save(ignore_permissions=True)
    else:
        draft = frappe.get_doc({"doctype": "Stock Entry", "stock_entry_type": "Material Issue", "items": se_items})
        draft.insert(ignore_permissions=True)

    used_codes = {row.item_code for row in rows}
    for row in doc.material_usage:
        row.material_issue = draft.name if row.item_code in used_codes else None
        row.qty_issued = 0

    if is_completed:
        draft.reload()
        draft.submit()
        for row in doc.material_usage:
            if row.item_code in used_codes:
                row.qty_issued = flt(row.qty_used)

    _flush_material_usage(doc.material_usage)
    frappe.db.commit()
    return draft.name


@frappe.whitelist()
def get_execution_material_usage(execution):
    """Materials a TL reported using on a Daily Execution, for the IM/PM
    detail view — otherwise there is no visibility at all into what a TL
    submitted for material usage, or whether it was actually issued out of
    stock (issue_material_for_execution runs silently as part of
    update_execution; nothing surfaces it anywhere in the IM-facing UI)."""
    if not execution or not frappe.db.exists("Daily Execution", execution):
        return []
    rows = frappe.get_all(
        "Daily Execution Material",
        filters={"parent": execution},
        fields=["item_code", "item_name", "qty_transferred", "qty_used", "qty_issued", "uom", "material_issue", "preferred_batch_no"],
    )
    docstatus_map = {}
    se_names = list({r["material_issue"] for r in rows if r.get("material_issue")})
    if se_names:
        docstatus_map = {
            r["name"]: r["docstatus"]
            for r in frappe.db.get_all("Stock Entry", filters={"name": ["in", se_names]}, fields=["name", "docstatus"])
        }
    for r in rows:
        r["is_huawei"] = bool(frappe.get_cached_value("Item", r["item_code"], "is_customer_provided_item"))
        # 0 = still Draft (TL not yet marked Completed), 1 = actually issued.
        r["issue_docstatus"] = docstatus_map.get(r.get("material_issue"))
    return rows


def _resolve_team_for_user():
    """Resolve INET Team name for the current field user (same logic as get_team_material_stock)."""
    resolved = frappe.db.get_value(
        "INET Team", {"field_user": frappe.session.user, "status": "Active"}, "name"
    )
    if not resolved:
        emp = frappe.db.get_value("Employee", {"user_id": frappe.session.user, "status": "Active"}, "name")
        if emp:
            parent = frappe.db.get_value("INET Team Member", {"employee": emp}, "parent")
            if parent and frappe.db.get_value("INET Team", parent, "status") == "Active":
                resolved = parent
    return resolved or ""


@frappe.whitelist()
def create_material_return_request(payload):
    """Field team (or IM on behalf of a team) submits a return request:
    team warehouse → source warehouse.  Creates a Material Request with
    is_return_request=1 that the IM then approves.
    """
    import json
    roles = set(frappe.get_roles(frappe.session.user))
    allowed = roles & {"Administrator", "System Manager", "Stock Manager", "INET Admin", "INET IM", "INET Field Team"}
    if not allowed:
        frappe.throw("Not permitted.", frappe.PermissionError)

    data = json.loads(payload) if isinstance(payload, str) else payload
    items = [i for i in (data.get("items") or []) if flt(i.get("qty", 0)) > 0]
    if not items:
        frappe.throw("At least one item with quantity > 0 is required.")

    # Resolve team
    team_id = (data.get("team_id") or "").strip()
    if not team_id:
        team_id = _resolve_team_for_user()
    if not team_id:
        frappe.throw("Team not found. Your account may not be linked to an active team.")

    team_wh = frappe.db.get_value("INET Team", team_id, "warehouse") or ""
    if not team_wh:
        frappe.throw("Team Warehouse not configured on the selected team.")

    source_wh = frappe.db.get_single_value("INET Settings", "source_warehouse") or ""
    if not source_wh:
        frappe.throw("Source Warehouse not configured in INET Settings.")

    company = frappe.defaults.get_global_default("company")
    req_date = nowdate()
    im = frappe.db.get_value("INET Team", team_id, "im") or ""
    reason = (data.get("reason") or "").strip()

    doc = frappe.get_doc({
        "doctype": "Material Request",
        "material_request_type": "Material Transfer",
        "transaction_date": req_date,
        "schedule_date": req_date,
        "company": company,
        "set_from_warehouse": team_wh,
        "set_warehouse": source_wh,
        "is_return_request": 1,
        "im": im,
        **({"return_reason": reason} if reason and frappe.db.has_column("Material Request", "return_reason") else {}),
        "items": [
            {
                "item_code": i["item_code"],
                "qty": flt(i["qty"]),
                "uom": i.get("uom") or frappe.db.get_value("Item", i["item_code"], "stock_uom") or "",
                "warehouse": source_wh,
                "from_warehouse": team_wh,
                "schedule_date": req_date,
            }
            for i in items
        ],
    })
    doc.insert(ignore_permissions=True)
    doc.submit()
    frappe.db.commit()
    return {"name": doc.name, "status": "Pending Approval"}


def _apply_return_request_column_filters(filters, column_filters):
    """Per-column "Manage Table" filters for list_return_requests — see
    _apply_material_request_column_filters above for the rationale. "Team"
    resolves via set_from_warehouse (opposite field from list_material_requests'
    set_warehouse); "Status" stays client-side only (same reason as above)."""
    from inet_app.api.command_center import _sql_like_pattern, excel_orm_filter

    if isinstance(column_filters, str):
        try:
            column_filters = frappe.parse_json(column_filters)
        except Exception:
            column_filters = None
    if not isinstance(column_filters, dict):
        return

    for col_key, raw_val in column_filters.items():
        # ORM filter list, not SQL — see excel_orm_filter(). These loops map
        # each col_key to its field inline below, so resolve the dict against
        # that same field rather than duplicating the mapping here.
        if isinstance(raw_val, dict):
            if mr_apply_excel_link_filter(col_key, raw_val, filters):
                continue
            _f = _MR_COL_FIELD.get(col_key)
            _entry = excel_orm_filter(_f, raw_val) if _f else None
            if _entry:
                filters[_entry[0]] = [_entry[1], _entry[2]]
            continue
        val = str(raw_val or "").strip()
        if not val:
            continue
        pat = _sql_like_pattern(val)
        if col_key in ("request_no", "name"):
            filters["name"] = ["like", pat]
        elif col_key == "date":
            filters["transaction_date"] = ["like", pat]
        elif col_key == "reason":
            if frappe.db.has_column("Material Request", "return_reason"):
                filters["return_reason"] = ["like", pat]
        elif col_key == "team":
            warehouses = set(frappe.db.sql_list(
                "SELECT warehouse FROM `tabINET Team` WHERE team_name LIKE %s AND IFNULL(warehouse,'') != ''",
                (pat,),
            ) or [])
            existing_wh = filters.get("set_from_warehouse")
            if existing_wh and not isinstance(existing_wh, (list, tuple)):
                if existing_wh not in warehouses:
                    filters["set_from_warehouse"] = ["in", ["__none__"]]
            else:
                filters["set_from_warehouse"] = ["in", list(warehouses) or ["__none__"]]
        elif col_key == "im":
            im_names = set(frappe.db.sql_list(
                """
                SELECT imm.name FROM `tabIM Master` imm
                INNER JOIN `tabUser` u ON u.name = imm.user
                WHERE u.full_name LIKE %s
                """,
                (pat,),
            ) or [])
            existing_im = filters.get("im")
            if existing_im and not isinstance(existing_im, (list, tuple)):
                if existing_im not in im_names:
                    filters["im"] = ["in", ["__none__"]]
            else:
                filters["im"] = ["in", list(im_names) or ["__none__"]]


@frappe.whitelist()
def list_return_requests(team_id=None, status=None, limit=50, column_filters=None,
                          im=None, duid=None, from_date=None, to_date=None, _options=None, _summary=None):
    """List Material Return Requests.

    Field team: sees their team's requests.
    IM: sees all requests from teams under their supervision.
    Admin / Stock Manager: sees all.
    """
    roles = set(frappe.get_roles(frappe.session.user))
    is_admin = bool(roles & {"Administrator", "System Manager", "Stock Manager", "INET Admin"})
    is_im = "INET IM" in roles

    filters = {
        "material_request_type": "Material Transfer",
        "is_return_request": 1,
    }

    if is_admin:
        pass
    elif is_im:
        im_name = frappe.db.get_value("IM Master", {"user": frappe.session.user}, "name")
        if im_name:
            filters["im"] = im_name
        else:
            return []
    else:
        resolved = _resolve_team_for_user()
        if not resolved:
            return []
        team_wh = frappe.db.get_value("INET Team", resolved, "warehouse") or ""
        if team_wh:
            filters["set_from_warehouse"] = team_wh

    if im and is_admin:
        filters["im"] = im

    if team_id:
        team_wh_override = frappe.db.get_value("INET Team", team_id, "warehouse") or ""
        filters["set_from_warehouse"] = team_wh_override or "__none__"

    if duid:
        # Return requests don't carry a DUID at request time (a team's
        # warehouse pools stock across bills/DUIDs) — it's only decided once
        # approved, when a batch gets auto-picked for the staged transfer.
        # Match against whichever Stock Entry(s) ended up linked.
        mr_names = frappe.db.sql_list(
            """SELECT DISTINCT sed.material_request FROM `tabStock Entry Detail` sed
               WHERE (sed.duid = %s OR sed.to_duid = %s)
                 AND IFNULL(sed.material_request, '') != ''""",
            (duid, duid),
        )
        filters["name"] = ["in", list(set(mr_names or [])) or ["__none__"]]

    if from_date and to_date:
        filters["transaction_date"] = ["between", [from_date, to_date]]
    elif from_date:
        filters["transaction_date"] = [">=", from_date]
    elif to_date:
        filters["transaction_date"] = ["<=", to_date]

    # Same computed-Status handling as list_material_requests — the label is
    # _request_status(), not a column.
    _wanted_status = None
    _cf_r = column_filters
    if isinstance(_cf_r, str):
        try:
            _cf_r = frappe.parse_json(_cf_r)
        except Exception:
            _cf_r = None
    if isinstance(_cf_r, dict):
        _sv = _cf_r.get("status")
        if isinstance(_sv, dict):
            _wanted_status = {str(x) for x in (_sv.get("values") or []) if str(x or "").strip()}
            _sc = str(_sv.get("contains") or "").strip().lower()
            if not _wanted_status and _sc:
                _wanted_status = ("~", _sc)

    _apply_return_request_column_filters(filters, column_filters)

    if _options:
        return mr_column_options(
            _options.get("col_key"), filters,
            _options.get("search"), _options.get("limit"),
        )

    if _summary:
        # Both request lists share one doctype and one filter dict, so the
        # summary is a plain ORM count against the SAME filters the row query
        # runs — no row limit involved.
        def _n(extra=None):
            f = dict(filters)
            if extra:
                f.update(extra)
            try:
                return frappe.db.count("Material Request", filters=f) or 0
            except Exception:
                return 0
        def _m(key, label, value, tone="default", group="", hide=False, hint=""):
            return {"key": key, "label": label, "value": value, "format": "int",
                    "tone": tone, "hint": hint, "group": group, "hide_if_zero": hide}
        return {"supported": True, "metrics": [
            _m("requests", "Requests", _n()),
            _m("pending", "Pending", _n({"status": "Pending"}), "warn", "Status", True,
               "Awaiting action"),
            _m("draft", "Draft", _n({"status": "Draft"}), "default", "Status", True),
            _m("transferred", "Transferred", _n({"status": "Transferred"}), "good", "Status", True),
            _m("cancelled", "Cancelled", _n({"status": "Cancelled"}), "bad", "Status", True),
        ]}

    rows = frappe.db.get_all(
        "Material Request",
        filters=filters,
        fields=[
            "name", "transaction_date", "owner", "im",
            "status", "transfer_status", "set_from_warehouse", "set_warehouse",
            "pending_transfer_se", "is_direct_return_by_im",
            *( ["return_reason"] if frappe.db.has_column("Material Request", "return_reason") else [] ),
        ],
        order_by="`tabMaterial Request`.transaction_date desc, `tabMaterial Request`.creation desc",
        limit=int(limit),
    )

    # Resolve team names from warehouse reverse-lookup (batch)
    warehouses = list({r["set_from_warehouse"] for r in rows if r.get("set_from_warehouse")})
    wh_team_map = {}
    if warehouses:
        for t in frappe.db.get_all(
            "INET Team", filters={"warehouse": ["in", warehouses]},
            fields=["warehouse", "name", "team_name"],
        ):
            wh_team_map[t["warehouse"]] = {"team_id": t["name"], "team_name": t["team_name"]}

    # Batch: IM Master → user full_name
    im_names = list({r["im"] for r in rows if r.get("im")})
    im_fullname_map = {}
    if im_names:
        for im_row in frappe.db.get_all("IM Master", filters={"name": ["in", im_names]}, fields=["name", "user"]):
            if im_row.get("user"):
                im_fullname_map[im_row["name"]] = (
                    frappe.db.get_value("User", im_row["user"], "full_name") or im_row["user"]
                )

    for r in rows:
        r["request_date"] = str(r.pop("transaction_date", "") or "")
        r["request_status"] = _request_status(
            r["status"], r["transfer_status"], has_pending_se=bool(r.get("pending_transfer_se")), is_return=True,
        )
        team_info = wh_team_map.get(r.get("set_from_warehouse") or "", {})
        r["team_id"] = team_info.get("team_id", "")
        r["team_name"] = team_info.get("team_name") or r.get("set_from_warehouse", "—")
        r["team_warehouse"] = r.get("set_from_warehouse", "")
        r["im_full_name"] = im_fullname_map.get(r.get("im") or "", r.get("im") or "")
        r["reason"] = r.pop("return_reason", "") or ""

    if status:
        rows = [r for r in rows if r["request_status"] == status]

    return rows


@frappe.whitelist()
def get_return_bill_candidates(name):
    """Preview which bill each of a pending return's items would draw from
    — every item that resolves to a real bill comes back (so the approver's
    choice is always traceable, not just when there's a genuine 2+-bill
    ambiguity), keyed by item_code. Returns {} entirely when the return's
    DUID can't even be resolved yet (nothing to preview)."""
    mr = frappe.get_doc("Material Request", name)
    if not mr.get("is_return_request"):
        return {}
    team_wh = mr.set_from_warehouse
    item_codes = list({i.item_code for i in mr.items})
    if not item_codes:
        return {}
    duid_by_item = _get_team_duid_per_item(team_wh, item_codes)
    out = {}
    for item_code in item_codes:
        duid = duid_by_item.get(item_code, "")
        if not duid:
            continue
        candidates = get_bill_candidates(item_code, duid, team_wh)
        if candidates:
            out[item_code] = {"duid": duid, "candidates": candidates}
    return out


@frappe.whitelist()
def approve_material_return_request(name, preferred_batches=None):
    """IM (or Stock Manager) approves a return request — this only STAGES
    the Material Transfer (s_warehouse = team WH → t_warehouse = source WH,
    duid = team DUID per item) as a Draft Stock Entry. Stock does not move
    back yet: the Warehouse Manager must confirm receipt via
    confirm_material_return() before it is submitted.

    Exception: a direct return initiated by IM (is_direct_return_by_im) —
    since the field team never requested this themselves, THIS approval
    step must come from the source team's own Team Lead instead of IM/Stock
    Manager, otherwise IM could pull materials out of a team's declared
    stock without their knowledge or consent.

    preferred_batches: optional {item_code: batch_no} — a return request
    never knows its DUID until this exact point (see duid_by_item below), so
    unlike a Transfer request there's nowhere earlier to let a human pick a
    bill. See get_return_bill_candidates(), which the approval UI calls
    first to find out whether there's even a genuine choice to offer.
    """
    if isinstance(preferred_batches, str):
        preferred_batches = frappe.parse_json(preferred_batches) or {}
    preferred_batches = preferred_batches or {}

    mr = frappe.get_doc("Material Request", name)
    if not mr.get("is_return_request"):
        frappe.throw("This is not a return request. Use approve_material_request instead.")

    if mr.get("is_direct_return_by_im"):
        roles = set(frappe.get_roles(frappe.session.user))
        if not roles & {"Administrator", "System Manager"}:
            field_user = frappe.db.get_value("INET Team", {"warehouse": mr.set_from_warehouse}, "field_user")
            if not field_user or field_user != frappe.session.user:
                frappe.throw(
                    "Only the team's Team Lead can approve releasing this stock back to the main warehouse.",
                    frappe.PermissionError,
                )
    else:
        roles = set(frappe.get_roles(frappe.session.user))
        if not roles & {"Administrator", "System Manager", "Stock Manager", "INET Admin", "INET IM"}:
            frappe.throw("Not permitted.", frappe.PermissionError)

    if mr.docstatus == 2:
        frappe.throw("This request has been cancelled.")
    if mr.transfer_status == "Completed":
        frappe.throw("Transfer already completed for this request.")
    if mr.get("pending_transfer_se"):
        frappe.throw("A transfer is already staged for this request, awaiting warehouse confirmation.")
    if mr.docstatus != 1:
        frappe.throw(f"Cannot approve a request in status '{mr.status}'. Submit it first.")

    from erpnext.stock.doctype.material_request.material_request import make_stock_entry

    # ERPNext's make_stock_entry() checks "create" permission on Stock Entry
    # internally (via get_mapped_doc) with no way to bypass it — and a Team
    # Lead approving their own team's direct return has no base Stock Entry
    # permission at all (same reasoning as confirm_material_transfer's
    # ignore_permissions). The checks above are the real authorization gate,
    # so briefly elevate for this one call rather than widening their role's
    # actual DocType permissions.
    _caller = frappe.session.user
    frappe.set_user("Administrator")
    try:
        se = make_stock_entry(name)
    finally:
        frappe.set_user(_caller)

    # Tag each item with the team DUID (inventory dimension — source side of transfer)
    team_wh = mr.set_from_warehouse
    item_codes = [i.item_code for i in mr.items]
    duid_by_item = _get_team_duid_per_item(team_wh, item_codes)
    mri_by_item_code = {i.item_code: i.name for i in mr.items}

    extra_rows = []
    resolved_batches = {}  # material_request_item name -> batch_no, for tracking
    for item in se.items:
        duid = duid_by_item.get(item.item_code, "")
        if duid:
            # Returned Huawei/customer-provided stock re-enters the main
            # warehouse still belonging to the same DUID — it doesn't become
            # generic un-DUID'd stock just because it came back. Stamp both
            # sides so the target (to_duid) isn't left blank, relying only
            # on before_stock_entry_submit's generic backstop — that backstop
            # derives its DUID from the Material Request's own duid/poid,
            # which isn't reliably populated on a return request the way
            # duid_by_item (the item's actual DUID at the team warehouse) is.
            item.duid = duid
            item.to_duid = duid
        preferred = preferred_batches.get(item.item_code)
        if not preferred and duid:
            # Same defense-in-depth as approve_material_request: always
            # resolve a real bill for tracking, even if the approver didn't
            # explicitly pick one (the common case — get_return_bill_candidates
            # already excludes anything another pending request reserved).
            auto_candidates = get_bill_candidates(item.item_code, duid, team_wh)
            if auto_candidates:
                preferred = auto_candidates[0]["batch_no"]
        if preferred:
            item.preferred_batch_no = preferred
            mri_name = mri_by_item_code.get(item.item_code)
            if mri_name:
                resolved_batches[mri_name] = preferred
        extra_rows.extend(_auto_select_batch_for_row(item))
    for row in extra_rows:
        se.append("items", row)

    se.confirmation_stage = "Awaiting Warehouse Confirmation"
    se.insert(ignore_permissions=True)
    frappe.db.set_value("Material Request", name, "pending_transfer_se", se.name)
    for mri_name, batch_no in resolved_batches.items():
        frappe.db.set_value("Material Request Item", mri_name, "preferred_batch_no", batch_no, update_modified=False)
    frappe.db.commit()
    return {"name": name, "stock_entry": se.name, "status": "Pending Warehouse Confirmation"}


@frappe.whitelist()
def confirm_material_return(name):
    """Warehouse Manager confirms receipt of a staged return. This is what
    actually submits the Stock Entry and moves stock back into the main
    warehouse."""
    frappe.only_for(["System Manager", "Stock Manager"])

    mr = frappe.get_doc("Material Request", name)
    se_name = mr.get("pending_transfer_se")
    if not se_name:
        frappe.throw("No return transfer is staged for this request.")

    se = frappe.get_doc("Stock Entry", se_name)
    if se.docstatus != 0:
        frappe.throw("This transfer is no longer awaiting confirmation.")
    se.confirmation_stage = "Confirmed"
    se.flags.ignore_permissions = True
    se.submit()
    frappe.db.set_value("Material Request", name, "pending_transfer_se", "")
    frappe.db.commit()
    return {"name": name, "stock_entry": se.name, "status": "Transferred"}


@frappe.whitelist()
def reject_material_return_confirmation(name, reason=None):
    """Warehouse Manager declines a staged return. The Stock Entry is kept
    (marked Rejected, never submitted) rather than deleted, so there's a
    visible record of the attempt; the request goes back to Pending
    Approval."""
    frappe.only_for(["System Manager", "Stock Manager"])

    mr = frappe.get_doc("Material Request", name)
    se_name = mr.get("pending_transfer_se")
    if not se_name:
        frappe.throw("No return transfer is staged for this request.")

    se = frappe.get_doc("Stock Entry", se_name)
    if se.docstatus != 0:
        frappe.throw("This transfer is no longer awaiting confirmation.")
    frappe.db.set_value("Stock Entry", se_name, "confirmation_stage", "Rejected")
    frappe.db.set_value("Material Request", name, {
        "pending_transfer_se": "",
        "confirm_rejection_reason": reason or "",
    })
    frappe.db.commit()
    return {"name": name, "status": "Pending Approval"}


@frappe.whitelist()
def create_direct_return_transfer(payload):
    """Warehouse Manager or IM initiates a direct return (team WH → source
    WH) without waiting on a field-team request. This creates and submits a
    Material Request behind the scenes, flagged is_direct_return_by_im — but
    does NOT auto-approve/stage it. Since the field team never requested
    this themselves, the source team's own Team Lead must first approve
    releasing the stock via approve_material_return_request() (which stages
    a Draft Stock Entry only once they do); the Warehouse Manager still has
    to confirm receipt via confirm_material_return() after that.
    """
    roles = set(frappe.get_roles(frappe.session.user))
    if not roles & {"Administrator", "System Manager", "Stock Manager", "INET Admin", "INET IM"}:
        frappe.throw("Not permitted.", frappe.PermissionError)
    import json

    data = json.loads(payload) if isinstance(payload, str) else payload
    team_id = (data.get("team_id") or "").strip()
    items = [i for i in (data.get("items") or []) if flt(i.get("qty", 0)) > 0]

    if not team_id:
        frappe.throw("Team is required.")
    if not items:
        frappe.throw("At least one item with quantity > 0 is required.")

    team_wh = frappe.db.get_value("INET Team", team_id, "warehouse") or ""
    if not team_wh:
        frappe.throw("Team Warehouse not configured on the selected team.")

    source_wh = frappe.db.get_single_value("INET Settings", "source_warehouse") or ""
    if not source_wh:
        frappe.throw("Source Warehouse not configured in INET Settings.")

    company = frappe.defaults.get_global_default("company")
    req_date = nowdate()
    im = frappe.db.get_value("INET Team", team_id, "im") or ""

    mr = frappe.get_doc({
        "doctype": "Material Request",
        "material_request_type": "Material Transfer",
        "transaction_date": req_date,
        "schedule_date": req_date,
        "company": company,
        "set_from_warehouse": team_wh,
        "set_warehouse": source_wh,
        "is_return_request": 1,
        "is_direct_return_by_im": 1,
        "im": im,
        "return_reason": f"Direct return initiated by {frappe.session.user} — awaiting Team Lead approval",
        "items": [
            {
                "item_code": i["item_code"],
                "qty": flt(i["qty"]),
                "uom": i.get("uom") or frappe.db.get_value("Item", i["item_code"], "stock_uom") or "",
                "warehouse": source_wh,
                "from_warehouse": team_wh,
                "schedule_date": req_date,
            }
            for i in items
        ],
    })
    mr.insert(ignore_permissions=True)
    mr.submit()
    frappe.db.commit()

    return {"name": mr.name, "status": "Pending Approval"}
