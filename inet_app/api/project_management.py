import frappe
from frappe import _
from frappe.utils import cint, flt


def _as_dict(doc):
    if isinstance(doc, str):
        return frappe._dict(frappe.parse_json(doc))
    return frappe._dict(doc or {})


@frappe.whitelist()
def list_projects(limit=20, offset=0, search=None, status=None, domain=None, area=None):
    filters = {}
    if status:
        filters["project_status"] = status
    if domain:
        filters["project_domain"] = domain
    if area:
        filters["center_area"] = area

    or_filters = []
    if search:
        like = f"%{search}%"
        or_filters = [["project_code", "like", like], ["project_name", "like", like]]

    rows = frappe.get_list(
        "Project Control Center",
        filters=filters,
        or_filters=or_filters,
        fields=[
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
        ],
        order_by="modified desc",
        start=cint(offset),
        page_length=min(cint(limit) or 20, 100),
    )
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


def on_purchase_order_submit(doc, method=None):
    if not getattr(doc, "project", None):
        return
    if not frappe.db.exists("Project Control Center", doc.project):
        return
    project = frappe.get_doc("Project Control Center", doc.project)
    project.actual_cost = flt(project.actual_cost) + flt(doc.grand_total)
    project.save(ignore_permissions=True)
