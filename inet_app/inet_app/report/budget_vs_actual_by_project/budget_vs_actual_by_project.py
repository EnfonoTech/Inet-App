import frappe


def execute(filters=None):
    # budget_amount/actual_cost are dead fields — nothing in the app ever
    # writes them (manual Desk entry only), meaningless for a customer
    # project. Replaced with real figures: total contracted value (PO
    # Dispatch), revenue actually realized (Work Done, including Direct
    # Close/Backend closes via wd.system_id -> pd), and the outstanding gap
    # between them.
    columns = [
        {"label": "Project", "fieldname": "project", "fieldtype": "Link", "options": "Project Control Center", "width": 180},
        {"label": "Project Code", "fieldname": "project_code", "fieldtype": "Data", "width": 130},
        {"label": "Total Value", "fieldname": "total_value", "fieldtype": "Currency", "width": 130},
        {"label": "Revenue", "fieldname": "revenue", "fieldtype": "Currency", "width": 130},
        {"label": "Outstanding", "fieldname": "outstanding", "fieldtype": "Currency", "width": 130},
    ]
    data = frappe.db.sql(
        """
        SELECT
            pcc.name AS project,
            pcc.project_code AS project_code,
            IFNULL(pv.total_value, 0) AS total_value,
            IFNULL(rv.revenue, 0) AS revenue,
            (IFNULL(pv.total_value, 0) - IFNULL(rv.revenue, 0)) AS outstanding
        FROM `tabProject Control Center` pcc
        LEFT JOIN (
            SELECT project_code, SUM(line_amount) AS total_value
            FROM `tabPO Dispatch`
            WHERE IFNULL(is_internal_work, 0) = 0
            GROUP BY project_code
        ) pv ON pv.project_code = pcc.name
        LEFT JOIN (
            SELECT pd.project_code, SUM(wd.revenue_sar) AS revenue
            FROM `tabWork Done` wd
            JOIN `tabPO Dispatch` pd ON pd.name = wd.system_id
            GROUP BY pd.project_code
        ) rv ON rv.project_code = pcc.name
        ORDER BY pcc.modified DESC
        """,
        as_dict=True,
    )
    return columns, data
