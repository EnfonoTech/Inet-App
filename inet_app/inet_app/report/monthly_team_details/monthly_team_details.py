import frappe
from frappe.utils import get_first_day, get_last_day, nowdate, add_days, getdate


WEEKS = ("w1", "w2", "w3", "w4", "w5")


def _columns():
    return [
        {"label": "Team No.", "fieldname": "team_id", "fieldtype": "Data", "width": 110},
        {"label": "Team Lead", "fieldname": "team_name", "fieldtype": "Data", "width": 180},
        {"label": "INET IM", "fieldname": "im_name", "fieldtype": "Data", "width": 160},
        {"label": "W-1 %", "fieldname": "w1", "fieldtype": "Float", "width": 80},
        {"label": "W-2 %", "fieldname": "w2", "fieldtype": "Float", "width": 80},
        {"label": "W-3 %", "fieldname": "w3", "fieldtype": "Float", "width": 80},
        {"label": "W-4 %", "fieldname": "w4", "fieldtype": "Float", "width": 80},
        {"label": "W-5 %", "fieldname": "w5", "fieldtype": "Float", "width": 80},
        {"label": "Total Planned", "fieldname": "total_planned", "fieldtype": "Int", "width": 120},
        {"label": "Completed", "fieldname": "total_completed", "fieldtype": "Int", "width": 110},
        {"label": "Monthly Utilization %", "fieldname": "utilization_pct", "fieldtype": "Percent", "width": 160},
    ]


def _week_of(plan_date, month_start):
    """W1 = days 1-7, W2 = 8-14, W3 = 15-21, W4 = 22-28, W5 = 29 to month end."""
    return WEEKS[min((getdate(plan_date) - month_start).days // 7, 4)]


def _pct(done, planned):
    return round(done / planned * 100, 1) if planned else 0.0


def execute(filters=None):
    columns, data, _summary = build(filters)
    return columns, data


def build(filters=None):
    """(columns, rows, summary) for one month.

    A plan is counted for EVERY team on it — the lead team on Rollout Plan and
    each Rollout Plan Team split row — because each of those teams did the
    work. This is a team report, so the tiles and the Total row count the
    same way — they are the sum of the team rows, and a two-team plan counts
    twice there too.

    Cancelled plans are left out entirely: a cancelled visit is not work a
    team was given, and counting it as "planned, not completed" marked teams
    down for plans someone else took off them.
    """
    filters = filters or {}
    today = nowdate()
    month_start = getdate(filters.get("from_date") or get_first_day(today))
    month_end = getdate(filters.get("to_date") or get_last_day(today))

    has_pd_im = frappe.db.has_column("PO Dispatch", "im")
    plan_im = "COALESCE(NULLIF(rp.im, ''), NULLIF(pd.im, ''), '')" if has_pd_im else "IFNULL(rp.im, '')"

    wheres = [
        "rp.plan_date BETWEEN %s AND %s",
        "IFNULL(rp.plan_status, '') <> 'Cancelled'",
    ]
    params = [month_start, month_end]

    team_vals = filters.get("team") or []
    if isinstance(team_vals, str):
        team_vals = [team_vals]
    if team_vals:
        wheres.append(f"rpteam.team IN ({', '.join(['%s'] * len(team_vals))})")
        params.extend(team_vals)

    im_vals = filters.get("im") or []
    if isinstance(im_vals, str):
        im_vals = [im_vals]
    if im_vals:
        ph = ", ".join(["%s"] * len(im_vals))
        im_clause = f"IFNULL(rp.im, '') IN ({ph})"
        if has_pd_im:
            im_clause = f"({im_clause} OR IFNULL(pd.im, '') IN ({ph}))"
            params.extend(im_vals)
        wheres.append(im_clause)
        params.extend(im_vals)

    rows = frappe.db.sql(
        f"""
        SELECT
            rp.name AS plan,
            rp.plan_date,
            IF(rp.plan_status = 'Completed', 1, 0) AS done,
            EXISTS (SELECT 1 FROM `tabDaily Execution` de
                    WHERE de.rollout_plan = rp.name) AS started,
            rpteam.team,
            it.team_id,
            COALESCE(NULLIF(it.team_name, ''), rpteam.team) AS team_name,
            {plan_im} AS im
        FROM `tabRollout Plan` rp
        -- rpteam unions rp.team (lead) with every Rollout Plan Team split
        -- row, so a multi-team plan counts for EVERY team it's split across.
        JOIN (
            SELECT rp2.name AS plan, rp2.team AS team FROM `tabRollout Plan` rp2
            UNION
            SELECT rpt.parent AS plan, rpt.team AS team FROM `tabRollout Plan Team` rpt
        ) rpteam ON rpteam.plan = rp.name
        LEFT JOIN `tabINET Team` it ON it.name = rpteam.team
        {"LEFT JOIN `tabPO Dispatch` pd ON pd.name = rp.po_dispatch" if has_pd_im else ""}
        WHERE {" AND ".join(wheres)}
        """,
        tuple(params),
        as_dict=True,
    )

    im_names = dict(frappe.db.sql("SELECT name, full_name FROM `tabIM Master`")) \
        if frappe.db.exists("DocType", "IM Master") else {}

    teams = {}
    shares = {}
    for r in rows:
        if not r.team:
            continue
        wk = _week_of(r.plan_date, month_start)
        t = teams.setdefault(r.team, {
            "team": r.team, "team_id": r.team_id or r.team, "team_name": r.team_name,
            "total_planned": 0, "total_completed": 0, "ims": {},
            **{f"{w}_planned": 0 for w in WEEKS}, **{f"{w}_completed": 0 for w in WEEKS},
        })
        t["total_planned"] += 1
        t["total_completed"] += r.done
        t[f"{wk}_planned"] += 1
        t[f"{wk}_completed"] += r.done
        if r.im:
            t["ims"][r.im] = t["ims"].get(r.im, 0) + 1
        shares[(r.plan, r.team)] = (wk, r.done, r.started)

    data = []
    for t in teams.values():
        # The IM with most of this team's plans; the rest are named in im_others
        # so the cell can say "+1" rather than silently picking one.
        ranked = sorted(t.pop("ims").items(), key=lambda kv: (-kv[1], kv[0]))
        names = [im_names.get(code) or code for code, _n in ranked]
        t["im_name"] = names[0] if names else ""
        t["im_others"] = names[1:]
        for w in WEEKS:
            t[w] = _pct(t[f"{w}_completed"], t[f"{w}_planned"])
        t["utilization_pct"] = _pct(t["total_completed"], t["total_planned"])
        data.append(t)
    data.sort(key=lambda t: (t["team_id"] or ""))

    summary = {
        "teams": len(data),
        "planned": len(shares),
        "completed": sum(1 for _w, done, _s in shares.values() if done),
        "pending": sum(1 for _w, done, started in shares.values() if not done and started),
        "not_started": sum(1 for _w, done, started in shares.values() if not done and not started),
        "weeks": [],
    }
    summary["completion_pct"] = _pct(summary["completed"], summary["planned"])
    for i, w in enumerate(WEEKS):
        start = add_days(month_start, i * 7)
        end = month_end if i == 4 else min(getdate(add_days(start, 6)), month_end)
        planned = sum(1 for wk, _d, _s in shares.values() if wk == w)
        done = sum(1 for wk, d, _s in shares.values() if wk == w and d)
        summary["weeks"].append({
            "key": w, "label": f"W-{i + 1}", "from": str(start), "to": str(end),
            "planned": planned, "completed": done, "pct": _pct(done, planned),
            "in_month": getdate(start) <= month_end,
        })

    return _columns(), data, summary


def report_totals(summary):
    """The Total row — the same figures as the tiles."""
    out = {
        "total_planned": summary["planned"],
        "total_completed": summary["completed"],
        "utilization_pct": summary["completion_pct"],
    }
    for wk in summary["weeks"]:
        out[wk["key"]] = wk["pct"]
    return out
