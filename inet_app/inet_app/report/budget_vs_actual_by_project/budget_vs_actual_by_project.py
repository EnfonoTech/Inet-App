import frappe


def execute(filters=None):
    columns = [
        {"label": "Project", "fieldname": "project", "fieldtype": "Link", "options": "Project Control Center", "width": 180},
        {"label": "Project Code", "fieldname": "project_code", "fieldtype": "Data", "width": 130},
        {"label": "Budget", "fieldname": "budget_amount", "fieldtype": "Currency", "width": 120},
        {"label": "Actual", "fieldname": "actual_cost", "fieldtype": "Currency", "width": 120},
        {"label": "Variance", "fieldname": "variance", "fieldtype": "Currency", "width": 120},
    ]
    data = frappe.db.sql(
        """
        SELECT
            name AS project,
            project_code,
            budget_amount,
            actual_cost,
            (IFNULL(budget_amount, 0) - IFNULL(actual_cost, 0)) AS variance
        FROM `tabProject Control Center`
        ORDER BY modified DESC
        """,
        as_dict=True,
    )
    return columns, data
