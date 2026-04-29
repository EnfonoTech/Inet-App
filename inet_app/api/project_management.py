import frappe
from frappe import _
from frappe.utils import cint, flt


def _as_dict(doc):
    if isinstance(doc, str):
        return frappe._dict(frappe.parse_json(doc))
    return frappe._dict(doc or {})


def _make_poid(po_no, po_line_no, shipment_number):
    """Build POID: PO No - PO Line No - Shipment No (omits shipment part if blank)."""
    parts = [str(po_no or "").strip(), str(cint(po_line_no) if po_line_no else 0)]
    if shipment_number:
        parts.append(str(shipment_number).strip())
    return "-".join(parts)


@frappe.whitelist()
def list_projects(
    limit=20,
    offset=0,
    search=None,
    status=None,
    domain=None,
    area=None,
    implementation_manager=None,
):
    """List projects; ``limit=0`` loads all rows (no cap). Other limits are clamped to 1..10000."""
    filters = {}
    if status:
        filters["project_status"] = status
    if domain:
        filters["project_domain"] = domain
    if area:
        filters["center_area"] = area
    im = (implementation_manager or "").strip()
    if im:
        filters["implementation_manager"] = im

    or_filters = []
    if search:
        like = f"%{search}%"
        or_filters = [
            ["project_code", "like", like],
            ["project_name", "like", like],
            ["customer", "like", like],
        ]

    proj_fields = [
        "name",
        "project_code",
        "project_name",
        "project_domain",
        "project_status",
        "implementation_manager",
        "center_area",
        "budget_amount",
        "actual_cost",
        "completion_percentage",
        "modified",
    ]
    if frappe.db.has_column("Project Control Center", "region_type"):
        proj_fields.insert(proj_fields.index("center_area") + 1, "region_type")
    page_len = cint(limit) if limit is not None else 20
    if page_len < 0:
        page_len = 20
    elif page_len == 0:
        page_len = 0
    elif page_len > 10000:
        page_len = 10000

    gl_kwargs = dict(
        filters=filters,
        or_filters=or_filters,
        fields=proj_fields,
        order_by="modified desc",
        start=cint(offset),
    )
    if page_len:
        gl_kwargs["page_length"] = page_len
    rows = frappe.get_list("Project Control Center", **gl_kwargs)
    return rows


@frappe.whitelist()
def get_project_detail(name):
    doc = frappe.get_doc("Project Control Center", name)
    return doc.as_dict()


@frappe.whitelist()
def upsert_project(payload):
    data = _as_dict(payload)
    name = data.get("name")
    if name:
        doc = frappe.get_doc("Project Control Center", name)
        doc.update(data)
        doc.save()
    else:
        doc = frappe.get_doc({"doctype": "Project Control Center", **data})
        doc.insert()
    return {"name": doc.name}


@frappe.whitelist()
def get_project_kpis():
    rows = frappe.get_all(
        "Project Control Center",
        fields=["name", "project_status", "budget_amount", "actual_cost"],
        limit_page_length=0,
    )
    total = len(rows)
    active = len([r for r in rows if r.project_status == "Active"])
    at_risk = len([r for r in rows if r.project_status == "At Risk"])
    overdue = len([r for r in rows if r.project_status == "On Hold"])
    budget = sum(flt(r.budget_amount) for r in rows)
    actual = sum(flt(r.actual_cost) for r in rows)
    utilization = (actual / budget * 100) if budget else 0
    return {
        "total_projects": total,
        "active_projects": active,
        "projects_at_risk": at_risk,
        "overdue_projects": overdue,
        "total_budget": budget,
        "actual_spent": actual,
        "budget_utilization": round(utilization, 2),
    }


@frappe.whitelist()
def get_pms_overview():
    """Operational snapshot used by PMS dashboard widgets."""
    update_status = frappe.db.sql(
        """
        SELECT status, COUNT(*) AS count
        FROM `tabDaily Work Update`
        GROUP BY status
        """,
        as_dict=True,
    )
    assignment_status = frappe.db.sql(
        """
        SELECT status, COUNT(*) AS count
        FROM `tabTeam Assignment`
        GROUP BY status
        """,
        as_dict=True,
    )
    recent_updates = frappe.get_all(
        "Daily Work Update",
        fields=["name", "project", "team", "update_date", "status"],
        order_by="modified desc",
        limit_page_length=10,
    )
    return {
        "workflow_stages": [
            "PO Intake",
            "Planning & Dispatch",
            "Execution",
            "QC",
            "Completion Ledger",
            "Dashboard",
        ],
        "daily_update_status": update_status,
        "team_assignment_status": assignment_status,
        "recent_updates": recent_updates,
    }


@frappe.whitelist()
def list_daily_work_updates(limit=20, offset=0, project=None, team=None, status=None, from_date=None, to_date=None):
    filters = {}
    if project:
        filters["project"] = project
    if team:
        filters["team"] = team
    if status:
        filters["status"] = status
    if from_date and to_date:
        filters["update_date"] = ["between", [from_date, to_date]]
    elif from_date:
        filters["update_date"] = [">=", from_date]
    elif to_date:
        filters["update_date"] = ["<=", to_date]

    return frappe.get_list(
        "Daily Work Update",
        filters=filters,
        fields=["name", "project", "team", "update_date", "status", "approval_status", "gps_location", "modified"],
        order_by="update_date desc, modified desc",
        start=cint(offset),
        page_length=min(cint(limit) or 20, 100),
    )


@frappe.whitelist()
def upsert_daily_work_update(payload):
    data = _as_dict(payload)
    name = data.get("name")
    if name:
        doc = frappe.get_doc("Daily Work Update", name)
        doc.update(data)
        doc.save()
    else:
        doc = frappe.get_doc({"doctype": "Daily Work Update", **data})
        doc.insert()
    return {"name": doc.name}


@frappe.whitelist()
def submit_work_update(work_update_id):
    doc = frappe.get_doc("Daily Work Update", work_update_id)
    doc.status = "Submitted"
    doc.approval_status = "Pending"
    doc.save()
    return {"name": doc.name, "status": doc.status, "approval_status": doc.approval_status}


@frappe.whitelist()
def approve_work_update(work_update_id, approved_by=None):
    doc = frappe.get_doc("Daily Work Update", work_update_id)
    doc.status = "Approved"
    doc.approval_status = "Approved"
    if approved_by:
        doc.remarks = f"{doc.remarks or ''}\nApproved By: {approved_by}".strip()
    doc.save()
    return {"name": doc.name, "status": doc.status, "approval_status": doc.approval_status}


@frappe.whitelist()
def upload_work_photos(work_update_id, photos):
    doc = frappe.get_doc("Daily Work Update", work_update_id)
    doc.photos = photos
    doc.save()
    return {"name": doc.name, "photos": doc.photos}


@frappe.whitelist()
def capture_gps_location(lat=None, lng=None):
    if lat is None or lng is None:
        frappe.throw(_("Latitude and Longitude are required."))
    lat = flt(lat)
    lng = flt(lng)
    if lat < -90 or lat > 90 or lng < -180 or lng > 180:
        frappe.throw(_("GPS coordinates are out of valid range."))
    return f"{lat},{lng}"


@frappe.whitelist()
def list_team_assignments(limit=20, offset=0, project=None, team_id=None, status=None, from_date=None, to_date=None):
    filters = {}
    if project:
        filters["project"] = project
    if team_id:
        filters["team_id"] = team_id
    if status:
        filters["status"] = status
    if from_date and to_date:
        filters["assignment_date"] = ["between", [from_date, to_date]]
    elif from_date:
        filters["assignment_date"] = [">=", from_date]
    elif to_date:
        filters["assignment_date"] = ["<=", to_date]

    return frappe.get_list(
        "Team Assignment",
        filters=filters,
        fields=["name", "team_id", "project", "assignment_date", "end_date", "role_in_project", "daily_cost", "utilization_percentage", "status", "modified"],
        order_by="assignment_date desc, modified desc",
        start=cint(offset),
        page_length=min(cint(limit) or 20, 100),
    )


@frappe.whitelist()
def upsert_team_assignment(payload):
    data = _as_dict(payload)
    name = data.get("name")
    if name:
        doc = frappe.get_doc("Team Assignment", name)
        doc.update(data)
        doc.save()
    else:
        doc = frappe.get_doc({"doctype": "Team Assignment", **data})
        doc.insert()
    return {"name": doc.name}


@frappe.whitelist()
def dashboard_charts():
    project_status = frappe.db.sql(
        """
        SELECT project_status AS label, COUNT(*) AS value
        FROM `tabProject Control Center`
        GROUP BY project_status
    """,
        as_dict=True,
    )
    budget_vs_actual = frappe.get_all(
        "Project Control Center",
        fields=["project_code", "budget_amount", "actual_cost"],
        order_by="modified desc",
        limit_page_length=20,
    )
    domain_distribution = frappe.db.sql(
        """
        SELECT project_domain AS label, COUNT(*) AS value
        FROM `tabProject Control Center`
        WHERE IFNULL(project_domain, '') != ''
        GROUP BY project_domain
    """,
        as_dict=True,
    )
    completion_timeline = frappe.get_all(
        "Project Control Center",
        fields=["project_code", "completion_percentage", "modified"],
        order_by="modified desc",
        limit_page_length=50,
    )
    return {
        "projects_by_status": project_status,
        "budget_vs_actual": budget_vs_actual,
        "project_distribution_by_domain": domain_distribution,
        "completion_timeline": completion_timeline,
    }


def _get_item_amount(item):
    # ERPNext item amount field name differs by doctype/version.
    # Prefer `amount` and fallback to `line_amount` when present.
    return flt(getattr(item, "amount", None) or getattr(item, "line_amount", None) or 0)


def on_purchase_order_submit(doc, method=None):
    """
    PM-006 linkage system:
    On PO submission -> update Project Control Center actual_cost.
    Budget alerts are shown when actual_cost exceeds budget_amount.
    """

    project_totals = {}
    missing_project_lines = []

    # Prefer project_code from each PO item line for accurate allocation.
    for it in getattr(doc, "items", []) or []:
        pc = getattr(it, "project_code", None)
        if not pc:
            missing_project_lines.append(getattr(it, "item_code", None) or "line")
            continue
        project_totals[pc] = flt(project_totals.get(pc, 0)) + _get_item_amount(it)

    header_project_code = getattr(doc, "project_code", None) or getattr(doc, "project", None)

    if missing_project_lines:
        if not header_project_code:
            frappe.throw(
                _(
                    "Purchase Order submission requires `project_code` on all items (missing: {0})."
                ).format(", ".join(missing_project_lines[:20]))
            )
        # Fallback: use header project_code for lines missing it.
        project_totals[header_project_code] = flt(project_totals.get(header_project_code, 0)) + flt(getattr(doc, "grand_total", 0))

    if not project_totals and header_project_code:
        project_totals[header_project_code] = flt(getattr(doc, "grand_total", 0))

    if not project_totals:
        return

    exceeded = []
    for project_code, total in project_totals.items():
        if not frappe.db.exists("Project Control Center", project_code):
            continue
        project = frappe.get_doc("Project Control Center", project_code)
        project.actual_cost = flt(project.actual_cost) + flt(total)
        project.save(ignore_permissions=True)
        if flt(project.budget_amount) and flt(project.actual_cost) > flt(project.budget_amount):
            exceeded.append(project_code)

    if exceeded:
        frappe.msgprint(
            _("Budget exceeded for project(s): {0}").format(", ".join(exceeded[:10]))
        )


@frappe.whitelist()
def list_purchase_orders(limit=20, offset=0, search=None):
    filters = {}
    or_filters = []
    if search:
        like = f"%{search}%"
        # Use common header fields; custom `project_code` is included after fixtures apply.
        or_filters = [
            ["name", "like", like],
            ["supplier", "like", like],
            ["project_code", "like", like],
            ["grand_total", "like", like],
        ]

    return frappe.get_list(
        "Purchase Order",
        filters=filters,
        or_filters=or_filters,
        fields=[
            "name",
            "supplier",
            "transaction_date",
            "schedule_date",
            "grand_total",
            "docstatus",
            "status",
            "project_code",
        ],
        order_by="modified desc",
        start=cint(offset),
        page_length=min(cint(limit) or 20, 100),
    )


def _item_meta_for_uom(item_code):
    return frappe.db.get_value(
        "Item",
        item_code,
        ["item_name", "stock_uom", "description"],
        as_dict=True,
    )


@frappe.whitelist()
def create_purchase_order(payload):
    data = _as_dict(payload)
    items = data.get("items") or []
    if not items:
        frappe.throw(_("At least one item is required to create Purchase Order."))

    supplier = data.get("supplier")
    if not supplier:
        frappe.throw(_("Supplier is required for Purchase Order."))

    # Prepare items with at least item_code/qty/rate + uom (from Item master).
    prepared_items = []
    for it in items:
        item_code = it.get("item_code") or it.get("item")
        if not item_code:
            frappe.throw(_("Each PO item must have item_code."))
        qty = flt(it.get("qty") or 0)
        if qty <= 0:
            frappe.throw(_("PO item qty must be > 0 for item {0}.").format(item_code))
        rate = flt(it.get("rate") or 0)
        uom = it.get("uom")
        if not uom:
            meta = _item_meta_for_uom(item_code) or {}
            uom = meta.get("stock_uom")
        if not uom:
            frappe.throw(_("UOM not found for item {0}.").format(item_code))
        prepared_items.append(
            {
                "item_code": item_code,
                "qty": qty,
                "rate": rate,
                "uom": uom,
                "description": it.get("description") or it.get("item_name") or "",
                # INET linkage fields (header + item allocation).
                "project_code": it.get("project_code") or data.get("project_code"),
                "activity_code": it.get("activity_code") or data.get("activity_code"),
                "area": it.get("area") or data.get("area"),
                "inet_cost_center": it.get("cost_center") or data.get("cost_center"),
            }
        )

    doc = frappe.get_doc(
        {
            "doctype": "Purchase Order",
            "supplier": supplier,
            "transaction_date": data.get("transaction_date"),
            "schedule_date": data.get("schedule_date") or data.get("delivery_date"),
            "project_code": data.get("project_code"),
            "activity_code": data.get("activity_code"),
            "area": data.get("area"),
            "inet_cost_center": data.get("cost_center"),
            "items": prepared_items,
        }
    )
    doc.insert()
    if cint(data.get("submit")):
        doc.submit()
    return {"name": doc.name}


@frappe.whitelist()
def import_purchase_orders(rows):
    """
    PO import (PO Intake).
    Expected row keys from frontend CSV parser:
      - po_no, supplier, transaction_date, schedule_date, project_code, activity_code, area, cost_center
      - item_code, qty, rate
    """

    parsed = frappe.parse_json(rows) if isinstance(rows, str) else rows
    if not parsed:
        frappe.throw(_("No rows provided for import."))

    # Group by PO No.
    grouped = {}
    validation_errors = []
    for idx, row in enumerate(parsed):
        po_no = row.get("po_no") if isinstance(row, dict) else None
        supplier = row.get("supplier") if isinstance(row, dict) else None
        item_code = row.get("item_code") if isinstance(row, dict) else None

        if not po_no:
            validation_errors.append({"row": idx, "error": "Missing po_no"})
            continue
        if not supplier:
            validation_errors.append({"row": idx, "po_no": po_no, "error": "Missing supplier"})
            continue
        if not item_code:
            validation_errors.append({"row": idx, "po_no": po_no, "error": "Missing item_code"})
            continue

        group = grouped.setdefault(
            po_no,
            {
                "po_no": po_no,
                "supplier": supplier,
                "transaction_date": row.get("transaction_date"),
                "schedule_date": row.get("schedule_date"),
                "project_code": row.get("project_code"),
                "activity_code": row.get("activity_code"),
                "area": row.get("area"),
                "cost_center": row.get("cost_center"),
                "items": [],
            },
        )

        group["items"].append(
            {
                "item_code": item_code,
                "qty": row.get("qty"),
                "rate": row.get("rate"),
                "project_code": row.get("project_code"),
                "activity_code": row.get("activity_code"),
                "area": row.get("area"),
                "cost_center": row.get("cost_center"),
            }
        )

    created = []
    for _, payload_base in grouped.items():
        if not payload_base["items"]:
            continue
        payload = payload_base
        # Keep import as Draft by default.
        payload["submit"] = payload_base.get("submit") or 0
        payload["transaction_date"] = payload["transaction_date"] or frappe.utils.nowdate()
        payload["schedule_date"] = payload["schedule_date"] or payload["transaction_date"]
        result = create_purchase_order(payload)
        created.append(result["name"])

    return {
        "created_count": len(created),
        "names": created,
        "validation_errors": validation_errors[:200],
    }


@frappe.whitelist()
def list_customers(limit=200, search=None):
    filters = {}
    or_filters = []
    if search:
        like = f"%{search}%"
        or_filters = [["name", "like", like], ["customer_name", "like", like]]
    return frappe.get_list(
        "Customer",
        filters=filters,
        or_filters=or_filters,
        fields=["name", "customer_name"],
        order_by="modified desc",
        page_length=min(cint(limit) or 200, 500),
    )


@frappe.whitelist()
def list_item_catalog(limit=500, search=None):
    filters = {"disabled": 0}
    or_filters = []
    if search:
        like = f"%{search}%"
        or_filters = [["item_code", "like", like], ["item_name", "like", like]]
    items = frappe.get_list(
        "Item",
        filters=filters,
        or_filters=or_filters,
        fields=["name", "item_code", "item_name", "stock_uom", "description"],
        order_by="modified desc",
        page_length=min(cint(limit) or 500, 1000),
    )
    item_codes = [d.item_code for d in items if d.item_code]
    prices = {}
    if item_codes:
        rows = frappe.get_all(
            "Item Price",
            filters={"item_code": ["in", item_codes], "selling": 1},
            fields=["item_code", "price_list_rate"],
            order_by="valid_from desc, modified desc",
            limit_page_length=5000,
        )
        for row in rows:
            if row.item_code not in prices:
                prices[row.item_code] = flt(row.price_list_rate)

    return [
        {
            "item_code": d.item_code,
            "item_name": d.item_name,
            "uom": d.stock_uom,
            "description": d.description,
            "rate": prices.get(d.item_code, 0),
        }
        for d in items
    ]


@frappe.whitelist()
def create_customer(payload):
    data = _as_dict(payload)
    customer_name = data.get("customer_name") or data.get("customer") or data.get("name")
    if not customer_name:
        frappe.throw(_("customer_name is required"))

    customer_type = data.get("customer_type") or data.get("type") or ""

    fields = {"customer_name": customer_name}
    if customer_type:
        fields["customer_type"] = customer_type

    doc = frappe.get_doc({"doctype": "Customer", **fields})
    doc.insert(ignore_permissions=True)
    return {"name": doc.name, "customer_name": doc.customer_name}


@frappe.whitelist(allow_guest=True)
def get_logged_user():
    user = frappe.session.user
    if not user or user == "Guest":
        return {"user": "Guest", "full_name": "", "authenticated": False, "app_role": "field"}

    full_name = frappe.db.get_value("User", user, "full_name") or user.split("@")[0]
    user_roles = frappe.get_roles(user)

    app_role = "field"
    im_name = None
    team_id = None

    if user == "Administrator" or "System Manager" in user_roles or "INET Admin" in user_roles:
        app_role = "admin"
    elif "INET PIC" in user_roles:
        app_role = "pic"
    elif "INET IM" in user_roles:
        app_role = "im"
        try:
            # ignore_permissions: session-init lookup must not be blocked by
            # role/user permissions. Use DocType existence check (registry)
            # instead of table_exists() which uses a stale table cache.
            if frappe.db.exists("DocType", "IM Master"):
                im_rec = frappe.get_all(
                    "IM Master", filters={"user": user},
                    fields=["name", "full_name"], limit=1,
                    ignore_permissions=True,
                )
                if not im_rec:
                    im_rec = frappe.get_all(
                        "IM Master", filters={"full_name": full_name},
                        fields=["name", "full_name"], limit=1,
                        ignore_permissions=True,
                    )
                if im_rec:
                    im_name = im_rec[0].name
        except Exception:
            pass
        if not im_name:
            im_name = full_name  # last-resort fallback
        im_teams = frappe.get_all(
            "INET Team",
            filters={"im": ["in", [im_name, full_name]]},
            fields=["team_id"],
            limit=100,
        )
        if im_teams:
            team_id = im_teams[0].team_id
    elif "INET Field Team" in user_roles:
        app_role = "field"
        # Primary: exact match by field_user (User link on INET Team)
        ft = frappe.get_all(
            "INET Team",
            filters={"field_user": user, "status": "Active"},
            fields=["team_id"],
            limit=1,
        )
        if ft:
            team_id = ft[0].team_id
        else:
            # Fallback: match by first name in team_name (legacy behaviour)
            first = (full_name or "").split()[0] if full_name else ""
            if first:
                ft2 = frappe.get_all(
                    "INET Team",
                    filters={"team_name": ["like", f"%{first}%"]},
                    fields=["team_id"],
                    limit=1,
                )
                if ft2:
                    team_id = ft2[0].team_id

    out = {
        "user": user,
        "full_name": full_name,
        "authenticated": True,
        "app_role": app_role,
        "im_name": im_name,
        "team_id": team_id,
    }
    # SPA uses this on every POST; Desk /app load also calls get_csrf_token() and rotates it —
    # the portal must refresh via GET get_logged_user (no CSRF) after switching tabs.
    out["csrf_token"] = frappe.sessions.get_csrf_token()
    return out


@frappe.whitelist()
def report_project_status_summary(filters=None):
    from inet_app.inet_app.report.project_status_summary.project_status_summary import execute

    columns, data = execute(_as_dict(filters or {}))
    return {"columns": columns, "data": data}


@frappe.whitelist()
def report_budget_vs_actual_by_project(filters=None):
    from inet_app.inet_app.report.budget_vs_actual_by_project.budget_vs_actual_by_project import execute

    columns, data = execute(_as_dict(filters or {}))
    return {"columns": columns, "data": data}


@frappe.whitelist()
def report_team_utilization_report(filters=None):
    from inet_app.inet_app.report.team_utilization_report.team_utilization_report import execute

    columns, data = execute(_as_dict(filters or {}))
    return {"columns": columns, "data": data}


@frappe.whitelist()
def report_daily_work_progress_report(filters=None):
    from inet_app.inet_app.report.daily_work_progress_report.daily_work_progress_report import execute

    columns, data = execute(_as_dict(filters or {}))
    return {"columns": columns, "data": data}


def _item_meta(item_code):
    meta = frappe.db.get_value(
        "Item",
        item_code,
        ["item_name", "stock_uom", "description"],
        as_dict=True,
    )
    return meta or {}


@frappe.whitelist()
def list_po_intake(limit=20, offset=0, search=None, status=None):
    filters = {}
    if status:
        filters["status"] = status

    or_filters = []
    if search:
        like = f"%{search}%"
        or_filters = [["po_no", "like", like], ["customer", "like", like]]

    return frappe.get_list(
        "PO Intake",
        filters=filters,
        or_filters=or_filters,
        fields=["name", "po_no", "customer", "transaction_date", "schedule_date", "status", "grand_total"],
        order_by="modified desc",
        start=cint(offset),
        page_length=min(cint(limit) or 20, 100),
    )


@frappe.whitelist()
def create_po_intake(payload):
    data = _as_dict(payload)
    po_lines = data.get("po_lines") or data.get("items") or []
    if not po_lines:
        frappe.throw(_("At least one PO line is required to create PO Intake."))

    if not data.get("po_no"):
        frappe.throw(_("PO No is required."))
    if not data.get("customer"):
        frappe.throw(_("Customer is required."))

    doc = frappe.get_doc(
        {
            "doctype": "PO Intake",
            "po_no": data.get("po_no"),
            "customer": data.get("customer"),
            "transaction_date": data.get("transaction_date"),
            "schedule_date": data.get("schedule_date"),
            "status": data.get("status") or "Active",
        }
    )

    # Build child rows.
    for i, row in enumerate(po_lines, start=1):
        item_code = row.get("item_code") or row.get("item")
        if not item_code:
            frappe.throw(_("PO line item_code is required (row {0}).").format(i))

        qty = flt(row.get("qty") or 0)
        if qty <= 0:
            frappe.throw(_("PO line qty must be > 0 for item {0}.").format(item_code))

        rate = flt(row.get("rate") or 0)
        line_amount = flt(row.get("line_amount") or 0)
        if rate <= 0 and line_amount > 0:
            rate = line_amount / qty

        meta = _item_meta(item_code)
        uom = row.get("uom") or meta.get("stock_uom")
        item_description = row.get("item_description") or meta.get("description") or meta.get("item_name")

        doc.append(
            "po_lines",
            {
                "po_line_no": row.get("po_line_no") or i,
                "shipment_number": row.get("shipment_number") or row.get("shipment_no") or "",
                "poid": _make_poid(data.get("po_no"), row.get("po_line_no") or i, row.get("shipment_number") or row.get("shipment_no")),
                "site_code": row.get("site_code") or row.get("site") or "",
                "item_code": item_code,
                "item_description": item_description,
                "qty": qty,
                "uom": uom,
                "rate": rate,
                "project_code": row.get("project_code") or data.get("project_code"),
                "activity_code": row.get("activity_code") or data.get("activity_code"),
                "area": row.get("area") or data.get("area"),
                "line_status": data.get("status") or "Active",
            },
        )

    # Ensure required linkage fields exist for every line (Project is required by DocType).
    for row in doc.po_lines:
        if not row.project_code:
            frappe.throw(_("PO line project_code is required (PO {0}, line {1}).").format(data.get("po_no"), row.po_line_no))

    doc.insert()
    if cint(data.get("submit")):
        doc.submit()
    return {"name": doc.name}


@frappe.whitelist()
def import_po_intake(rows):
    parsed = frappe.parse_json(rows) if isinstance(rows, str) else rows
    if not parsed:
        frappe.throw(_("No rows provided for import."))

    grouped = {}
    validation_errors = []
    for idx, row in enumerate(parsed):
        po_no = row.get("po_no") if isinstance(row, dict) else None
        customer = row.get("customer") if isinstance(row, dict) else None

        item_code = row.get("item_code") if isinstance(row, dict) else None
        qty = flt(row.get("qty") or 0)
        project_code = row.get("project_code") if isinstance(row, dict) else None

        if not po_no:
            validation_errors.append({"row": idx, "error": "Missing po_no"})
            continue
        if not customer:
            validation_errors.append({"row": idx, "po_no": po_no, "error": "Missing customer"})
            continue
        if not item_code:
            validation_errors.append({"row": idx, "po_no": po_no, "error": "Missing item_code"})
            continue
        if qty <= 0:
            validation_errors.append({"row": idx, "po_no": po_no, "item_code": item_code, "error": "qty must be > 0"})
            continue
        if not project_code:
            validation_errors.append({"row": idx, "po_no": po_no, "item_code": item_code, "error": "Missing project_code"})
            continue

        key = f"{po_no}|{customer}"
        group = grouped.setdefault(
            key,
            {
                "po_no": po_no,
                "customer": customer,
                "transaction_date": row.get("transaction_date"),
                "schedule_date": row.get("schedule_date"),
                "status": row.get("status") or "Active",
                "po_lines": [],
            },
        )

        group["po_lines"].append(
            {
                "po_line_no": row.get("po_line_no") or row.get("line_no") or len(group["po_lines"]) + 1,
                "shipment_number": row.get("shipment_number") or row.get("shipment_no") or "",
                "poid": _make_poid(po_no, row.get("po_line_no") or row.get("line_no") or len(group["po_lines"]) + 1, row.get("shipment_number") or row.get("shipment_no")),
                "site_code": row.get("site_code") or row.get("site") or "",
                "item_code": item_code,
                "item_description": row.get("item_description") or row.get("item_name") or "",
                "qty": qty,
                "rate": row.get("rate") or 0,
                "line_amount": row.get("line_amount") or row.get("amount") or 0,
                "uom": row.get("uom") or "",
                "project_code": project_code,
                "activity_code": row.get("activity_code") or "",
                "area": row.get("area") or "",
            }
        )

    created = []
    for _, payload in grouped.items():
        payload["transaction_date"] = payload.get("transaction_date") or frappe.utils.nowdate()
        payload["schedule_date"] = payload.get("schedule_date") or payload["transaction_date"]
        result = create_po_intake(payload)
        created.append(result["name"])

    return {
        "created_count": len(created),
        "names": created,
        "validation_errors": validation_errors[:200],
    }


@frappe.whitelist()
def list_im_masters(status=None, search=None):
    """List IM Master records with optional filters."""
    filters = {}
    if status:
        filters["status"] = status
    or_filters = []
    if search:
        like = f"%{search}%"
        or_filters = [["im_id", "like", like], ["full_name", "like", like], ["email", "like", like]]
    return frappe.get_list(
        "IM Master",
        filters=filters,
        or_filters=or_filters if or_filters else None,
        fields=["name", "im_id", "full_name", "email", "phone",
                "monthly_cost_sar", "daily_cost_sar", "status"],
        order_by="full_name asc",
        page_length=200,
    )
