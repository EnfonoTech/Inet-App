import frappe
from frappe.utils import getdate


def execute(filters=None):
    columns = _get_columns()
    data = _get_data(filters or {})
    return columns, data


def _get_columns():
    return [
        {"label": "Date",           "fieldname": "execution_date",  "fieldtype": "Date",    "width": 100},
        {"label": "Execution",      "fieldname": "execution",       "fieldtype": "Link",    "options": "Daily Execution", "width": 150},
        {"label": "POID",           "fieldname": "poid",            "fieldtype": "Data",    "width": 160},
        {"label": "DUID",           "fieldname": "duid",            "fieldtype": "Data",    "width": 160},
        {"label": "Project",        "fieldname": "project",         "fieldtype": "Data",    "width": 120},
        {"label": "Visit #",        "fieldname": "visit_number",    "fieldtype": "Int",     "width": 70},
        {"label": "Visit Type",     "fieldname": "visit_type",      "fieldtype": "Data",    "width": 100},
        {"label": "Team",           "fieldname": "team",            "fieldtype": "Link",    "options": "INET Team", "width": 130},
        {"label": "Team Name",      "fieldname": "team_name",       "fieldtype": "Data",    "width": 140},
        {"label": "Employee",       "fieldname": "employee",        "fieldtype": "Link",    "options": "Employee", "width": 130},
        {"label": "Employee Name",  "fieldname": "employee_name",   "fieldtype": "Data",    "width": 160},
        {"label": "Designation",    "fieldname": "designation",     "fieldtype": "Data",    "width": 120},
        {"label": "Team Lead",      "fieldname": "is_team_lead",    "fieldtype": "Check",   "width": 80},
        {"label": "Present",        "fieldname": "is_present",      "fieldtype": "Check",   "width": 70},
        {"label": "Field Status",   "fieldname": "tl_status",       "fieldtype": "Data",    "width": 110},
        {"label": "IM Status",      "fieldname": "execution_status","fieldtype": "Data",    "width": 110},
        {"label": "Hours Worked",   "fieldname": "total_hours",     "fieldtype": "Float",   "width": 100, "precision": 2},
    ]


def _get_data(filters):
    conditions, values = _build_conditions(filters)

    rows = frappe.db.sql(
        f"""
        SELECT
            de.name        AS execution,
            de.execution_date,
            pod.poid,
            pod.site_code  AS duid,
            pod.project_code AS project,
            rp.visit_number,
            rp.visit_type,
            de.team,
            it.team_name,
            etm.employee,
            COALESCE(emp.employee_name, etm.employee) AS employee_name,
            etm.designation,
            etm.is_team_lead,
            etm.is_present,
            de.tl_status,
            de.execution_status,
            COALESCE(SUM(etl.duration_hours), 0) AS total_hours
        FROM `tabDaily Execution` de
        LEFT JOIN `tabExecution Team Member` etm ON etm.parent = de.name
        LEFT JOIN `tabPO Dispatch` pod         ON pod.name  = de.system_id
        LEFT JOIN `tabINET Team` it            ON it.name   = de.team
        LEFT JOIN `tabRollout Plan` rp         ON rp.name   = de.rollout_plan
        LEFT JOIN `tabEmployee` emp            ON emp.name  = etm.employee
        LEFT JOIN `tabExecution Time Log` etl  ON etl.rollout_plan = de.rollout_plan
                                               AND etl.team_id     = de.team
                                               AND etl.user        = emp.user_id
        WHERE de.docstatus < 2
        {conditions}
        GROUP BY de.name, etm.name
        ORDER BY de.execution_date DESC, pod.poid, de.team, etm.employee
        """,
        values,
        as_dict=True,
    )
    return rows


def _build_conditions(f):
    conds = []
    vals = []

    if f.get("date_from"):
        conds.append("AND de.execution_date >= %s")
        vals.append(getdate(f["date_from"]))
    if f.get("date_to"):
        conds.append("AND de.execution_date <= %s")
        vals.append(getdate(f["date_to"]))
    if f.get("team"):
        conds.append("AND de.team = %s")
        vals.append(f["team"])
    if f.get("employee"):
        conds.append("AND etm.employee = %s")
        vals.append(f["employee"])
    if f.get("execution_status"):
        conds.append("AND de.execution_status = %s")
        vals.append(f["execution_status"])
    if f.get("poid"):
        conds.append("AND pod.poid LIKE %s")
        vals.append(f"%{f['poid']}%")
    if f.get("duid"):
        conds.append("AND pod.site_code LIKE %s")
        vals.append(f"%{f['duid']}%")
    if f.get("project"):
        conds.append("AND pod.project_code = %s")
        vals.append(f["project"])

    return " ".join(conds), vals
