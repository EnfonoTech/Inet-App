import frappe


def execute(filters=None):
    columns = [
        {"label": "Team ID", "fieldname": "team_id", "fieldtype": "Data", "width": 140},
        {"label": "Project", "fieldname": "project", "fieldtype": "Link", "options": "Project Control Center", "width": 180},
        {"label": "Assignment Date", "fieldname": "assignment_date", "fieldtype": "Date", "width": 120},
        {"label": "End Date", "fieldname": "end_date", "fieldtype": "Date", "width": 120},
        {"label": "Utilization %", "fieldname": "utilization_percentage", "fieldtype": "Percent", "width": 120},
        {"label": "Status", "fieldname": "status", "fieldtype": "Data", "width": 100},
    ]
    data = frappe.get_all(
        "Team Assignment",
        fields=["team_id", "project", "assignment_date", "end_date", "utilization_percentage", "status"],
        order_by="assignment_date desc",
        limit_page_length=1000,
    )
    return columns, data
