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
            GROUP BY project_code
        ) pv ON pv.project_code = pcc.name
        LEFT JOIN (
            SELECT pd.project_code, SUM(wd.revenue_sar) AS revenue
            FROM `tabWork Done` wd
            JOIN `tabPO Dispatch` pd ON pd.name = wd.system_id
            GROUP BY pd.project_code
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
