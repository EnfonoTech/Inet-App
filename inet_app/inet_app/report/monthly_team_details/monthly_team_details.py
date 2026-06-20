import frappe
from frappe.utils import get_first_day, get_last_day, nowdate, add_days, flt


def execute(filters=None):
    filters = filters or {}

    today = nowdate()
    month_start = filters.get("from_date") or str(get_first_day(today))
    month_end = filters.get("to_date") or str(get_last_day(today))

    # Week boundaries within the selected month
    w1_start = month_start
    w1_end = str(add_days(month_start, 6))
    w2_start = str(add_days(month_start, 7))
    w2_end = str(add_days(month_start, 13))
    w3_start = str(add_days(month_start, 14))
    w3_end = str(add_days(month_start, 20))
    w4_start = str(add_days(month_start, 21))
    w4_end = str(add_days(month_start, 27))
    w5_start = str(add_days(month_start, 28))
    w5_end = month_end

    columns = [
        {"label": "Team No.", "fieldname": "team_id", "fieldtype": "Data", "width": 110},
        {"label": "Teams Assigned", "fieldname": "team_name", "fieldtype": "Data", "width": 160},
        {"label": "INet IM", "fieldname": "im_name", "fieldtype": "Data", "width": 140},
        {"label": "W-1 %", "fieldname": "w1", "fieldtype": "Float", "width": 80},
        {"label": "W-2 %", "fieldname": "w2", "fieldtype": "Float", "width": 80},
        {"label": "W-3 %", "fieldname": "w3", "fieldtype": "Float", "width": 80},
        {"label": "W-4 %", "fieldname": "w4", "fieldtype": "Float", "width": 80},
        {"label": "W-5 %", "fieldname": "w5", "fieldtype": "Float", "width": 80},
        {"label": "Total Planned", "fieldname": "total_planned", "fieldtype": "Int", "width": 120},
        {"label": "Completed", "fieldname": "total_completed", "fieldtype": "Int", "width": 110},
        {"label": "Monthly Utilization %", "fieldname": "utilization_pct", "fieldtype": "Percent", "width": 160},
    ]

    has_rp_im = frappe.db.has_column("Rollout Plan", "im")
    has_pd_im = frappe.db.has_column("PO Dispatch", "im")

    im_col = (
        "COALESCE(rim.full_name, rp.im, rim_pd.full_name, pd.im)"
        if has_rp_im and has_pd_im
        else ("COALESCE(rim.full_name, rp.im)" if has_rp_im else "COALESCE(rim_pd.full_name, pd.im)" if has_pd_im else "NULL")
    )
    rp_im_join = "LEFT JOIN `tabIM Master` rim ON rim.name = rp.im" if has_rp_im else ""
    pd_im_join = "LEFT JOIN `tabIM Master` rim_pd ON rim_pd.name = pd.im" if has_pd_im else ""
    pd_join = "LEFT JOIN `tabPO Dispatch` pd ON pd.name = rp.po_dispatch" if has_pd_im else ""

    wheres = ["rp.plan_date BETWEEN %s AND %s"]
    params = [month_start, month_end]

    team_vals = filters.get("team") or []
    if isinstance(team_vals, str):
        team_vals = [team_vals]
    if team_vals:
        ph = ", ".join(["%s"] * len(team_vals))
        wheres.append(f"rp.team IN ({ph})")
        params.extend(team_vals)

    im_vals = filters.get("im") or []
    if isinstance(im_vals, str):
        im_vals = [im_vals]
    if im_vals:
        ph = ", ".join(["%s"] * len(im_vals))
        wheres.append(f"(IFNULL(rp.im, '') IN ({ph}) OR IFNULL(pd.im, '') IN ({ph}))")
        params.extend(im_vals + im_vals)

    # 10 bounds × 2 (planned + completed per week) = 20 week params
    week_bounds = [w1_start, w1_end, w2_start, w2_end, w3_start, w3_end,
                   w4_start, w4_end, w5_start, w5_end]

    data = frappe.db.sql(
        """
        SELECT
            it.team_id,
            COALESCE(it.team_name, rp.team) AS team_name,
            {im_col} AS im_name,
            SUM(CASE WHEN rp.plan_date BETWEEN %s AND %s THEN 1 ELSE 0 END) AS w1_planned,
            SUM(CASE WHEN rp.plan_date BETWEEN %s AND %s THEN 1 ELSE 0 END) AS w2_planned,
            SUM(CASE WHEN rp.plan_date BETWEEN %s AND %s THEN 1 ELSE 0 END) AS w3_planned,
            SUM(CASE WHEN rp.plan_date BETWEEN %s AND %s THEN 1 ELSE 0 END) AS w4_planned,
            SUM(CASE WHEN rp.plan_date BETWEEN %s AND %s THEN 1 ELSE 0 END) AS w5_planned,
            SUM(CASE WHEN rp.plan_date BETWEEN %s AND %s AND rp.plan_status = 'Completed' THEN 1 ELSE 0 END) AS w1_completed,
            SUM(CASE WHEN rp.plan_date BETWEEN %s AND %s AND rp.plan_status = 'Completed' THEN 1 ELSE 0 END) AS w2_completed,
            SUM(CASE WHEN rp.plan_date BETWEEN %s AND %s AND rp.plan_status = 'Completed' THEN 1 ELSE 0 END) AS w3_completed,
            SUM(CASE WHEN rp.plan_date BETWEEN %s AND %s AND rp.plan_status = 'Completed' THEN 1 ELSE 0 END) AS w4_completed,
            SUM(CASE WHEN rp.plan_date BETWEEN %s AND %s AND rp.plan_status = 'Completed' THEN 1 ELSE 0 END) AS w5_completed,
            COUNT(rp.name) AS total_planned,
            SUM(CASE WHEN rp.plan_status = 'Completed' THEN 1 ELSE 0 END) AS total_completed,
            ROUND(
                CASE WHEN COUNT(rp.name) > 0
                THEN SUM(CASE WHEN rp.plan_status = 'Completed' THEN 1 ELSE 0 END)
                     / COUNT(rp.name) * 100
                ELSE 0 END, 1
            ) AS utilization_pct
        FROM `tabRollout Plan` rp
        LEFT JOIN `tabINET Team` it ON it.name = rp.team
        {pd_join}
        {rp_im_join}
        {pd_im_join}
        WHERE {wheres}
        GROUP BY rp.team
        ORDER BY it.team_name
        """.format(
            im_col=im_col,
            pd_join=pd_join,
            rp_im_join=rp_im_join,
            pd_im_join=pd_im_join,
            wheres=" AND ".join(wheres),
        ),
        tuple(week_bounds * 2 + params),
        as_dict=True,
    )

    # Convert per-week planned+completed into utilization %
    for row in data:
        for wk in ["w1", "w2", "w3", "w4", "w5"]:
            planned = flt(row.get(f"{wk}_planned") or 0)
            completed = flt(row.get(f"{wk}_completed") or 0)
            row[wk] = round(completed / planned * 100, 1) if planned > 0 else 0.0
            row.pop(f"{wk}_planned", None)
            row.pop(f"{wk}_completed", None)

    return columns, data
