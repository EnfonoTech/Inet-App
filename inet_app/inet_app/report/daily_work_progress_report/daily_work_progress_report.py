import frappe


def execute(filters=None):
    columns = [
        {"label": "Work Update", "fieldname": "name", "fieldtype": "Link", "options": "Daily Work Update", "width": 170},
        {"label": "Project", "fieldname": "project", "fieldtype": "Link", "options": "Project Control Center", "width": 180},
        {"label": "Team", "fieldname": "team", "fieldtype": "Data", "width": 140},
        {"label": "Update Date", "fieldname": "update_date", "fieldtype": "Date", "width": 120},
        {"label": "Status", "fieldname": "status", "fieldtype": "Data", "width": 100},
        {"label": "Approval", "fieldname": "approval_status", "fieldtype": "Data", "width": 100},
    ]
    data = frappe.get_all(
        "Daily Work Update",
        fields=["name", "project", "team", "update_date", "status", "approval_status"],
        order_by="update_date desc, modified desc",
        limit_page_length=1000,
    )
    return columns, data
