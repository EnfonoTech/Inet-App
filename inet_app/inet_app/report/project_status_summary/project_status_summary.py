import frappe


def execute(filters=None):
    columns = [
        {"label": "Project", "fieldname": "project", "fieldtype": "Link", "options": "Project Control Center", "width": 180},
        {"label": "Project Code", "fieldname": "project_code", "fieldtype": "Data", "width": 130},
        {"label": "Domain", "fieldname": "project_domain", "fieldtype": "Data", "width": 140},
        {"label": "Status", "fieldname": "project_status", "fieldtype": "Data", "width": 110},
        {"label": "Completion %", "fieldname": "completion_percentage", "fieldtype": "Percent", "width": 120},
        {"label": "Budget", "fieldname": "budget_amount", "fieldtype": "Currency", "width": 120},
        {"label": "Actual", "fieldname": "actual_cost", "fieldtype": "Currency", "width": 120},
    ]
    data = frappe.get_all(
        "Project Control Center",
        fields=["name as project", "project_code", "project_domain", "project_status", "completion_percentage", "budget_amount", "actual_cost"],
        filters=_get_filters(filters),
        order_by="modified desc",
        limit_page_length=500,
    )
    return columns, data


def _get_filters(filters):
    f = filters or {}
    out = {}
    if f.get("project_status"):
        out["project_status"] = f["project_status"]
    if f.get("project_domain"):
        out["project_domain"] = f["project_domain"]
    return out
