import frappe
from frappe.utils import get_first_day, get_last_day, nowdate


def execute(filters=None):
    filters = filters or {}

    columns = [
        {"label": "Team No.", "fieldname": "team_id", "fieldtype": "Data", "width": 110},
        {"label": "Teams Assigned", "fieldname": "team_name", "fieldtype": "Data", "width": 160},
        {"label": "INet IM", "fieldname": "im_name", "fieldtype": "Data", "width": 140},
        {"label": "Date", "fieldname": "plan_date", "fieldtype": "Date", "width": 110},
        {"label": "Planned Activities", "fieldname": "planned_activities", "fieldtype": "Int", "width": 140},
        {"label": "Completed Activities", "fieldname": "completed_activities", "fieldtype": "Int", "width": 150},
        {"label": "Actual Achieved Qty", "fieldname": "achieved_qty", "fieldtype": "Float", "width": 150},
        {"label": "Achievement %", "fieldname": "achievement_pct", "fieldtype": "Percent", "width": 130},
        {"label": "Achieved Amount (SAR)", "fieldname": "achieved_amount", "fieldtype": "Currency", "width": 160},
    ]

    today = nowdate()
    from_date = filters.get("from_date") or get_first_day(today)
    to_date = filters.get("to_date") or get_last_day(today)

    wheres = ["rp.plan_date BETWEEN %s AND %s"]
    params = [from_date, to_date]

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

    data = frappe.db.sql(
        """
        SELECT
            it.team_id,
            COALESCE(it.team_name, rp.team) AS team_name,
            {im_col} AS im_name,
            rp.plan_date,
            COUNT(DISTINCT rp.name) AS planned_activities,
            SUM(CASE WHEN rp.plan_status = 'Completed' THEN 1 ELSE 0 END) AS completed_activities,
            COALESCE(SUM(de.achieved_qty), 0) AS achieved_qty,
            ROUND(
                CASE
                    WHEN COUNT(DISTINCT rp.name) > 0
                    THEN SUM(CASE WHEN rp.plan_status = 'Completed' THEN 1 ELSE 0 END)
                         / COUNT(DISTINCT rp.name) * 100
                    ELSE 0
                END, 1
            ) AS achievement_pct,
            COALESCE(SUM(de.achieved_amount), 0) AS achieved_amount
        FROM `tabRollout Plan` rp
        LEFT JOIN `tabINET Team` it ON it.name = rp.team
        LEFT JOIN `tabDaily Execution` de ON de.rollout_plan = rp.name
            AND de.execution_status != 'Cancelled'
        {pd_join}
        {rp_im_join}
        {pd_im_join}
        WHERE {wheres}
        GROUP BY rp.team, rp.plan_date
        ORDER BY rp.plan_date DESC, it.team_name
        LIMIT 3000
        """.format(
            im_col=im_col,
            pd_join=pd_join,
            rp_im_join=rp_im_join,
            pd_im_join=pd_im_join,
            wheres=" AND ".join(wheres),
        ),
        tuple(params),
        as_dict=True,
    )

    return columns, data
