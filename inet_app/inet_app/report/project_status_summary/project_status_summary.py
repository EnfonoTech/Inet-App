import frappe


def execute(filters=None):
    # completion_percentage/budget_amount/actual_cost are dead fields —
    # nothing in the app ever writes them (manual Desk entry only),
    # meaningless for a customer project. Replaced with real figures: total
    # contracted value, revenue actually realized, and completion % as their
    # ratio — same logic as the Projects list pages.
    columns = [
        {"label": "Project", "fieldname": "project", "fieldtype": "Link", "options": "Project Control Center", "width": 180},
        {"label": "Project Code", "fieldname": "project_code", "fieldtype": "Data", "width": 130},
        {"label": "Domain", "fieldname": "project_domain", "fieldtype": "Data", "width": 140},
        {"label": "Status", "fieldname": "project_status", "fieldtype": "Data", "width": 110},
        {"label": "Total Value", "fieldname": "total_value", "fieldtype": "Currency", "width": 130},
        {"label": "Revenue", "fieldname": "revenue", "fieldtype": "Currency", "width": 130},
        {"label": "Completion %", "fieldname": "completion_pct", "fieldtype": "Percent", "width": 120},
    ]
    conditions = _get_filters(filters)
    where = "1=1"
    params = []
    if conditions.get("project_status"):
        where += " AND pcc.project_status = %s"
        params.append(conditions["project_status"])
    if conditions.get("project_domain"):
        where += " AND pcc.project_domain = %s"
        params.append(conditions["project_domain"])

    data = frappe.db.sql(
        f"""
        SELECT
            pcc.name AS project,
            pcc.project_code AS project_code,
            pcc.project_domain AS project_domain,
            pcc.project_status AS project_status,
            IFNULL(pv.total_value, 0) AS total_value,
            IFNULL(rv.revenue, 0) AS revenue,
            IFNULL(ROUND(IFNULL(rv.revenue, 0) / NULLIF(pv.total_value, 0) * 100, 1), 0) AS completion_pct
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
        WHERE {where}
        ORDER BY pcc.modified DESC
        LIMIT 500
        """,
        params,
        as_dict=True,
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
