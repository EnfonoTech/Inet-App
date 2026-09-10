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
              AND IFNULL(dispatch_status, '') NOT IN ('Cancelled')
            GROUP BY project_code
        ) pv ON pv.project_code = pcc.name
        -- Revenue is the value of the project's DONE lines, not the sum of
        -- its Work Done records. Only 61 Work Done rows exist against 12,000+
        -- done lines (the rest were imported already completed, often already
        -- invoiced, with no plan or execution), so summing Work Done read
        -- SAR 46,552 company-wide against SAR 9,428,121 actually delivered.
        -- Same definition as the portal's Project Profitability report and
        -- _project_value_revenue, so the three cannot disagree.
        LEFT JOIN (
            SELECT project_code, SUM(line_amount) AS revenue
            FROM `tabPO Dispatch`
            WHERE IFNULL(is_internal_work, 0) = 0
              AND IFNULL(dispatch_status, '') NOT IN ('Cancelled')
              AND dispatch_status IN ('Completed', 'Partially Submitted',
                                      'Submitted', 'Partially Closed', 'Closed')
            GROUP BY project_code
        ) rv ON rv.project_code = pcc.name
        ORDER BY pcc.modified DESC
        """,
        as_dict=True,
    )
    return columns, data
