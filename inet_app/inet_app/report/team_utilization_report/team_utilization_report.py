import frappe
from frappe.utils import get_first_day, get_last_day, nowdate

# Rows are team x day, so this is really a date-range ceiling: at a 31-team
# roster it is ~1.7 years, where the previous 3000 was ~97 days.
ROW_CAP = 20000


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
        wheres.append(f"rpteam.team IN ({ph})")
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
            COALESCE(it.team_name, rpteam.team) AS team_name,
            {im_col} AS im_name,
            rp.plan_date,
            COUNT(DISTINCT rp.name) AS planned_activities,
            -- COUNT(DISTINCT ... rp.name) and not SUM(CASE ... THEN 1): the
            -- LEFT JOIN to Daily Execution multiplies rows, so a team with two
            -- execution rows against one Completed plan counted that plan
            -- twice while planned_activities (already DISTINCT) stayed at one
            -- — reproduced at planned=1, completed=2, achievement of 200.
            -- Keep literal percent signs out of this SQL, comments included:
            -- the string goes through pymysql parameter binding, which reads
            -- one as a format placeholder and raises before the query runs.
            COUNT(DISTINCT CASE WHEN rp.plan_status = 'Completed' THEN rp.name END)
                AS completed_activities,
            COALESCE(SUM(de.achieved_qty), 0) AS achieved_qty,
            ROUND(
                CASE
                    WHEN COUNT(DISTINCT rp.name) > 0
                    THEN COUNT(DISTINCT CASE WHEN rp.plan_status = 'Completed' THEN rp.name END)
                         / COUNT(DISTINCT rp.name) * 100
                    ELSE 0
                END, 1
            ) AS achievement_pct,
            COALESCE(SUM(de.achieved_amount), 0) AS achieved_amount
        FROM `tabRollout Plan` rp
        -- rpteam unions rp.team (lead) with every Rollout Plan Team split
        -- row, so a multi-team plan is counted for EVERY team it's split
        -- across, not just the lead — and de.team = rpteam.team (not just
        -- de.rollout_plan = rp.name) keeps each team's achieved qty/amount
        -- to its OWN Daily Execution rows, not the whole plan's total.
        JOIN (
            SELECT rp2.name AS plan, rp2.team AS team FROM `tabRollout Plan` rp2
            UNION
            SELECT rpt.parent AS plan, rpt.team AS team FROM `tabRollout Plan Team` rpt
        ) rpteam ON rpteam.plan = rp.name
        LEFT JOIN `tabINET Team` it ON it.name = rpteam.team
        LEFT JOIN `tabDaily Execution` de ON de.rollout_plan = rp.name
            -- IFNULL, not `!=`: in SQL `NULL != 'Cancelled'` is NULL, not
            -- true, so an execution row with no status set was dropped from
            -- achieved qty/amount instead of counted.
            AND IFNULL(de.execution_status, '') <> 'Cancelled'
            AND de.team = rpteam.team
        {pd_join}
        {rp_im_join}
        {pd_im_join}
        WHERE {wheres}
        GROUP BY rpteam.team, rp.plan_date
        ORDER BY rp.plan_date DESC, it.team_name
        LIMIT {row_cap_plus_one}
        """.format(
            im_col=im_col,
            pd_join=pd_join,
            rp_im_join=rp_im_join,
            pd_im_join=pd_im_join,
            wheres=" AND ".join(wheres),
            row_cap_plus_one=ROW_CAP + 1,
        ),
        tuple(params),
        as_dict=True,
    )

    # One row per team per day, so the cap is reached by widening the date
    # range, not by anything the user can see. It used to be a bare LIMIT 3000
    # — about 97 days across a 31-team roster — and because the ORDER BY is
    # plan_date DESC, going over silently dropped the OLDEST days while the
    # totals row still looked like a complete period. Fetch one row past the
    # cap purely to detect that and say so.
    message = None
    if len(data) > ROW_CAP:
        data = data[:ROW_CAP]
        message = (
            f"Showing the most recent {ROW_CAP:,} rows only — the date range is too "
            "wide for this report and the earliest days have been left out. "
            "Narrow the dates, or filter to fewer teams, for a complete picture."
        )

    return columns, data, message
