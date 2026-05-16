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


# ─── Phase 2: Material Request — uses standard ERPNext Material Request ───────

def _request_status(status, transfer_status):
    """Map ERPNext status + transfer_status to a portal-friendly label."""
    if status == "Cancelled":
        return "Rejected"
    if transfer_status == "Completed":
        return "Transferred"
    if status in ("Submitted", "Pending") and transfer_status in ("Not Started", "", None):
        return "Pending Approval"
    return status or "Draft"


@frappe.whitelist()
def list_material_requests(im=None, status=None, limit=50):
    """List Material Requests (type: Material Transfer) created via INET portal.

    IM users see only their own requests (filtered by im custom field).
    Stock Manager / Admin see all.
    """
    roles = set(frappe.get_roles(frappe.session.user))
    is_admin = bool(roles & {"Administrator", "System Manager", "Stock Manager", "INET Admin"})

    filters = {"material_request_type": "Material Transfer"}
    if not is_admin:
        im_name = frappe.db.get_value("IM Master", {"user": frappe.session.user}, "name")
        if im_name:
            filters["im"] = im_name
        else:
            return []

    if im:
        filters["im"] = im

    rows = frappe.db.get_all(
        "Material Request",
        filters=filters,
        fields=[
            "name", "transaction_date", "owner", "im", "poid", "duid",
            "status", "transfer_status", "set_warehouse", "set_from_warehouse",
        ],
        order_by="`tabMaterial Request`.transaction_date desc, `tabMaterial Request`.creation desc",
        limit=int(limit),
    )
    # Collect unique system-name poids and resolve to business POIDs in one batch
    poid_links = list({r["poid"] for r in rows if r.get("poid")})
    poid_map = {}
    if poid_links:
        for row in frappe.db.get_all(
            "PO Dispatch",
            filters={"name": ["in", poid_links]},
            fields=["name", "poid"],
        ):
            poid_map[row["name"]] = row["poid"]

    for r in rows:
        r["request_status"] = _request_status(r["status"], r["transfer_status"])
        r["team_warehouse"] = r.pop("set_warehouse", "")
        r["source_warehouse"] = r.pop("set_from_warehouse", "")
        if r.get("poid"):
            r["poid"] = poid_map.get(r["poid"], r["poid"])

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

    return {
        "name": doc.name,
        "request_date": str(doc.transaction_date or ""),
        "owner": doc.owner,
        "im": doc.get("im"),
        "poid": poid_display or poid_link,
        "duid": doc.get("duid"),
        "request_status": _request_status(doc.status, doc.transfer_status),
        "status": doc.status,
        "transfer_status": doc.transfer_status,
        "team_warehouse": doc.set_warehouse,
        "source_warehouse": doc.set_from_warehouse,
        "rejection_reason": doc.get("rejection_reason"),
        "stock_entry_transfer": transfer_se,
        "stock_entry_issue": issue_se,
        "items": [
            {
                "item_code": i.item_code,
                "item_name": i.item_name,
                "qty": i.qty,
                "uom": i.uom or i.stock_uom,
                "duid": i.get("duid"),
                "poid": i.get("poid"),
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
    """Return items received in the main warehouse for a DUID.

    Looks up Huawei Outbound Plans (INET, Received) for this DUID,
    then reads the Stock Entry Detail rows from each Material Receipt.
    These are customer-provided (Huawei) items — valuation_rate is 0.
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

    items = []
    seen = set()
    for plan in plans:
        rows = frappe.db.get_all(
            "Stock Entry Detail",
            filters={"parent": plan["material_receipt"]},
            fields=["item_code", "item_name", "qty", "uom", "t_warehouse"],
        )
        for r in rows:
            key = r["item_code"]
            if key in seen:
                continue
            # Only include items flagged as customer-provided on the Item master
            if not frappe.db.get_value("Item", r["item_code"], "is_customer_provided_item"):
                continue
            seen.add(key)
            items.append({
                "item_code": r["item_code"],
                "item_name": r["item_name"] or r["item_code"],
                "qty": r["qty"],
                "uom": r["uom"] or "Nos",
                "is_huawei": True,
                "material_receipt": plan["material_receipt"],
            })
    return items


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
def search_po_dispatches(query="", im=None, limit=20):
    """Search PO Dispatches by business POID field for the current IM."""
    conditions = [["docstatus", "!=", 2]]
    if im:
        conditions.append(["im", "=", im])
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
def get_im_teams(im=None):
    """Return teams for the current IM with their warehouse info."""
    if not im:
        im = frappe.db.get_value("IM Master", {"user": frappe.session.user}, "name")
    if not im:
        return []
    return frappe.db.get_all(
        "INET Team",
        filters={"im": im, "status": "Active"},
        fields=["team_id", "team_name", "warehouse"],
        order_by="team_name asc",
    )


@frappe.whitelist()
def get_duid_stock_summary():
    """DUID-wise summary of INET Huawei Outbound materials in the main warehouse.

    Groups all INET Huawei Outbound Plan rows by DUID, showing
    how many shipments arrived (Received) vs. are expected (Prepared).
    """
    plans = frappe.db.get_all(
        "Huawei Outbound Plan",
        filters={"subcon": "INET"},
        fields=["du_id", "bill_no", "outbound_status", "material_receipt",
                "total_volume", "outbound_date", "project_name"],
        order_by="outbound_date desc",
        limit=5000,
    )
    by_duid = {}
    for p in plans:
        duid = (p["du_id"] or "").strip()
        if not duid:
            continue
        if duid not in by_duid:
            by_duid[duid] = {
                "duid": duid,
                "total_volume": 0.0,
                "received_count": 0,
                "prepared_count": 0,
                "latest_date": str(p["outbound_date"] or ""),
                "project_name": p["project_name"] or "",
            }
        g = by_duid[duid]
        g["total_volume"] = round(g["total_volume"] + flt(p["total_volume"]), 4)
        if p["outbound_status"] == "Received":
            g["received_count"] += 1
        else:
            g["prepared_count"] += 1
        if str(p["outbound_date"] or "") > g["latest_date"]:
            g["latest_date"] = str(p["outbound_date"])
    # Sort: received first, then by latest date
    result = sorted(
        by_duid.values(),
        key=lambda x: (-x["received_count"], x["latest_date"]),
        reverse=False,
    )
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

    doc = frappe.get_doc({
        "doctype": "Material Request",
        "material_request_type": "Material Transfer",
        "transaction_date": req_date,
        "schedule_date": req_date,
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
                "schedule_date": req_date,
                "poid": poid,
                "duid": duid,
            }
            for i in items
        ],
    })
    doc.insert(ignore_permissions=True)
    doc.submit()
    frappe.db.commit()
    return {"name": doc.name, "status": "Pending Approval"}


@frappe.whitelist()
def approve_material_request(name):
    """Stock Manager approves: creates Material Transfer via ERPNext make_stock_entry,
    then sets duid + poid on the generated Stock Entry before submitting."""
    frappe.only_for(["System Manager", "Stock Manager"])

    mr = frappe.get_doc("Material Request", name)
    if mr.status == "Cancelled":
        frappe.throw("This request has been cancelled.")
    if mr.transfer_status == "Completed":
        frappe.throw("Material Transfer already completed for this request.")
    if mr.status != "Submitted":
        frappe.throw(f"Cannot approve a request in status '{mr.status}'. Submit it first.")

    from erpnext.stock.doctype.material_request.material_request import make_stock_entry
    se = make_stock_entry(name)

    # Inject INET custom dimensions
    duid = mr.get("duid") or ""
    poid_val = mr.get("poid") or ""
    se.poid = poid_val
    for item in se.items:
        item.duid = duid

    se.insert(ignore_permissions=True)
    se.submit()
    frappe.db.commit()
    return {"name": name, "stock_entry": se.name, "status": "Approved"}


@frappe.whitelist()
def reject_material_request(name, reason=None):
    """Stock Manager rejects: stores reason then cancels the Material Request."""
    frappe.only_for(["System Manager", "Stock Manager"])

    mr = frappe.get_doc("Material Request", name)
    if mr.status not in ("Draft", "Submitted"):
        frappe.throw(f"Cannot reject a request in status '{mr.status}'.")

    if reason:
        frappe.db.set_value("Material Request", name, "rejection_reason", reason)

    if mr.docstatus == 1:
        mr.cancel()
    frappe.db.commit()
    return {"name": name, "status": "Rejected"}


@frappe.whitelist()
def issue_materials_for_work_done(name):
    """Create Material Issue Stock Entry from team warehouse when work is done."""
    frappe.only_for(["System Manager", "Stock Manager"])

    mr = frappe.get_doc("Material Request", name)
    if mr.transfer_status != "Completed":
        frappe.throw("Material Transfer must be completed before issuing materials.")

    duid = mr.get("duid") or ""
    poid_val = mr.get("poid") or ""
    team_wh = mr.set_warehouse

    se_items = []
    for item in mr.items:
        se_items.append({
            "item_code": item.item_code,
            "qty": item.qty,
            "uom": item.uom or item.stock_uom,
            "s_warehouse": team_wh,
            "duid": duid,
            "material_request": name,
            "material_request_item": item.name,
        })

    se = frappe.get_doc({
        "doctype": "Stock Entry",
        "stock_entry_type": "Material Issue",
        "purpose": "Material Issue",
        "from_warehouse": team_wh,
        "material_request": name,
        "poid": poid_val,
        "items": se_items,
    })
    se.insert(ignore_permissions=True)
    se.submit()
    frappe.db.commit()
    return {"name": name, "stock_entry": se.name, "status": "Issued"}
