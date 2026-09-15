"""IM report catalog — the PM's reports, each one narrowed to the IM's own work.

Every endpoint here is the IM-side twin of a report on the PM's Reports page,
and every one of them is scoped SERVER-SIDE from the session. Nothing in the
request body decides whose numbers come back: `_im_session_scope()` resolves
the IM from `frappe.session.user` and the endpoints below never pass a browser
value into `resolve_im_for_session()`. An IM editing `im=` into a request gets
their own rows back, not the other IM's.

Where the scope comes from, per report
--------------------------------------
Scoping is historical — the `im` STAMPED on the record, not the IM who happens
to own the team today. `INET Team.im` is a team's CURRENT manager, so reading
scope off it would move a team's whole back-catalogue between IMs the moment
the team is reassigned. `Rollout Plan.im` and `Daily Execution.im` are stamped
when the work is created and never move, so the months an IM actually ran stay
with that IM.

  * Rollout Plan.im     — Team Utilization, Monthly Team Details, Team PVA,
                          Weekly Performance, Top Teams
  * Daily Execution.im  — the execution/revenue half of those same reports,
                          and Site Verify Status
  * PO Dispatch.im      — Project Performance, Rollout Burn-Down,
                          PO Dispatch Status, PO Milestone Status
  * the IM's team roster — Team Idle by Domain ONLY, because there the row axis
                          IS the team: "was my team idle that day" has to count
                          every day the team worked, including days it spent on
                          another IM's plan. That roster is deliberately
                          status-agnostic (see _im_team_ids_all).
  * DUID / project set  — Site Sign Status, Bill Wise Material Status, Huawei
                          Outbound Analytics. Huawei Outbound Plan carries no
                          IM and no team at all, so these are reached
                          indirectly; _im_duid_scope() documents the limits of
                          that, which are real.

Admin callers: _require_inet_im_session() also admits System Manager /
Administrator. Such a user usually has no IM Master record, so the scope
resolves to their own name, matches nothing, and every report here comes back
empty. That is the safe direction — the company-wide numbers live on the PM
page, which is where an admin should read them.
"""

import json

import frappe
from frappe.utils import flt

from inet_app.api import command_center as cc
from inet_app.api import material_management as mm


# ---------------------------------------------------------------- scope ----

def _im_session_scope():
    """(im_name, im_identifiers, team_ids) for the CURRENT SESSION only.

    Never takes an argument. Every caller in this module goes through here, so
    there is exactly one place where an IM's identity is decided and it reads
    the session, not the request.
    """
    im_name, im_ids = cc._require_inet_im_session()
    if not im_ids:
        # _require_inet_im_session already throws on this, but an empty scope
        # would splice in an EMPTY sql condition further down and hand back
        # company-wide numbers — the exact failure this module exists to
        # prevent. Fail loudly instead of quietly returning everything.
        frappe.throw("Could not resolve your IM record.", frappe.PermissionError)
    return im_name, list(im_ids), cc._im_team_ids_all()


def _filters(filters=None):
    if isinstance(filters, str):
        try:
            filters = json.loads(filters)
        except Exception:
            filters = {}
    return dict(filters or {})


def _range(f):
    return f.get("from_date") or None, f.get("to_date") or None


def _safe_teams(f, allowed):
    """The team narrowing the browser asked for, INTERSECTED with the IM's own.

    A team filter is a convenience, never a scope: whatever arrives, the result
    can only ever be a subset of `allowed`. Asking for another IM's team yields
    an empty list, and the IM's full team set is used only when the browser
    sent no team at all.
    """
    want = f.get("team") or []
    if isinstance(want, str):
        try:
            want = json.loads(want)
        except Exception:
            want = [want] if want else []
    if not want:
        return list(allowed)
    allowed_set = set(allowed)
    return [t for t in want if t in allowed_set]


def _script_report(execute, filters):
    """Run a Frappe query report's execute() and unpack it defensively.

    A query report may return (columns, data), or add (message) and (chart) on
    the end. team_utilization_report has grown and lost a message more than
    once; unpacking to a fixed pair breaks the moment it does. The message has
    to reach the page too — it is how a report says its own row cap trimmed the
    oldest days off the range, and a truncation warning nothing displays is the
    silently-wrong total the cap exists to prevent.
    """
    result = execute(filters)
    columns, data = result[0], result[1]
    message = result[2] if len(result) > 2 else None
    return columns, data, message


def _im_duid_scope(im_ids):
    """(duids, projects) reachable from this IM's own work.

    Huawei Outbound Plan — behind Site Sign Status, Bill Wise Material Status
    and Huawei Outbound Analytics — has no `im` and no `team` field. Its only
    handles are du_id/duid_master and project. So an IM's material is reached
    the long way round: every site and project touched by a PO line stamped to
    them, or by a plan or execution stamped to them.

    Two honest limits, because these reports cannot do better on this schema:
      * A DUID worked by two IMs appears for BOTH. The site is genuinely
        shared; the bill sitting on it is not divisible by IM.
      * A bill for a site with no PO line, plan or execution under this IM
        reaches nobody's catalog. That is the safe direction to fail.
    """
    if not im_ids:
        return [], []
    ph = ", ".join(["%s"] * len(im_ids))
    rows = frappe.db.sql(
        f"""
        SELECT DISTINCT pd.site_code AS duid, pd.project_code AS project
        FROM `tabPO Dispatch` pd
        WHERE pd.im IN ({ph})
        UNION
        SELECT DISTINCT pd.site_code, pd.project_code
        FROM `tabRollout Plan` rp
        JOIN `tabPO Dispatch` pd ON pd.name = rp.po_dispatch
        WHERE rp.im IN ({ph})
        UNION
        SELECT DISTINCT pd.site_code, pd.project_code
        FROM `tabDaily Execution` de
        JOIN `tabPO Dispatch` pd ON pd.name = de.system_id
        WHERE de.im IN ({ph})
        """,
        tuple(im_ids) * 3, as_dict=True,
    ) or []
    duids = sorted({r.duid for r in rows if r.duid})
    projects = sorted({r.project for r in rows if r.project})
    return duids, projects


# ------------------------------------------------------- page-level info ----

@frappe.whitelist()
def get_im_report_scope():
    """What the catalog header shows: who the IM is and which teams are in scope.

    Teams are listed with their status so an IM can see at a glance that a
    Disbanded team is still contributing rows — the reports deliberately do not
    hide it, and the header should not imply otherwise.
    """
    im_name, im_ids, team_ids = _im_session_scope()
    teams = []
    if team_ids:
        teams = frappe.get_all(
            "INET Team",
            filters={"team_id": ["in", team_ids]},
            fields=["team_id", "team_name", "status", "team_category"],
            order_by="team_id asc",
            limit_page_length=500,
        )
    return {
        "im": im_name,
        "im_name": frappe.db.get_value("IM Master", im_name, "full_name") or im_name,
        "teams": teams,
        "team_count": len(teams),
        "active_team_count": sum(1 for t in teams if t.status == "Active"),
    }


@frappe.whitelist()
def get_im_team_options():
    """Team options for the catalog's own Team filter — every team the IM
    manages, whatever its status, with the status in the label so picking an
    Inactive team is a deliberate act rather than a surprise."""
    _im_name, _im_ids, team_ids = _im_session_scope()
    if not team_ids:
        return []
    rows = frappe.get_all(
        "INET Team",
        filters={"team_id": ["in", team_ids]},
        fields=["team_id", "team_name", "status"],
        order_by="team_id asc",
        limit_page_length=500,
    )
    out = []
    for r in rows:
        label = f"{r.team_id} — {r.team_name}" if r.team_name else r.team_id
        if r.status and r.status != "Active":
            label = f"{label} ({r.status})"
        out.append({"id": r.team_id, "label": label})
    return out


@frappe.whitelist()
def get_im_huawei_filter_options():
    """Project / Domain / Subcontractor options for the IM's Huawei Outbound
    Analytics filter.

    The PM's equivalent lists every project in Huawei Outbound Plan. Here the
    list is cut to the IM's own projects, so the dropdown cannot offer one that
    would only ever come back empty once the report's own scope is applied.
    """
    _im, im_ids, _teams = _im_session_scope()
    _duids, projects = _im_duid_scope(im_ids)
    if not projects:
        return {"projects": [], "domains": [], "subcons": []}
    ph = ", ".join(["%s"] * len(projects))
    rows = frappe.db.sql(
        f"""
        SELECT DISTINCT hop.project, hop.subcon, pcc.project_name, pcc.project_domain
        FROM `tabHuawei Outbound Plan` hop
        LEFT JOIN `tabProject Control Center` pcc ON pcc.project_code = hop.project
        WHERE IFNULL(hop.project, '') != ''
          AND hop.project IN ({ph})
        """,
        tuple(projects), as_dict=True,
    ) or []
    out_projects = sorted(
        ({"id": r.project, "label": r.project_name or r.project} for r in rows),
        key=lambda o: o["label"],
    )
    domains = sorted(
        {(r.project_domain or "").strip() for r in rows if (r.project_domain or "").strip()}
    )
    # Subcontractors come from the IM's own projects too, so the dropdown
    # cannot offer one that only ships on somebody else's work.
    subcons = sorted({(r.subcon or "").strip() for r in rows if (r.subcon or "").strip()})
    return {
        "projects": out_projects,
        "domains": [{"id": d, "label": d} for d in domains],
        "subcons": subcons,
    }


# ---------------------------------------------------- Teams & Utilization ----

@frappe.whitelist()
def report_team_utilization(filters=None):
    """Team Utilization, scoped to the IM's own plans."""
    from inet_app.api.project_management import _report_totals
    from inet_app.inet_app.report.team_utilization_report.team_utilization_report import execute

    _im, im_ids, team_ids = _im_session_scope()
    f = _filters(filters)
    fd, td = _range(f)
    columns, data, message = _script_report(execute, {
        "from_date": fd, "to_date": td,
        "im": im_ids,
        "team": _safe_teams(f, team_ids),
    })
    totals = _report_totals(
        columns, data,
        ratios={"achievement_pct": ("completed_activities", "planned_activities")},
    )
    out = {"columns": columns, "data": data, "totals": totals}
    if message:
        out["message"] = message
    return out


@frappe.whitelist()
def report_monthly_team_details(filters=None):
    """Monthly Team Details, scoped to the IM's own plans."""
    from inet_app.api.project_management import _report_totals
    from inet_app.inet_app.report.monthly_team_details.monthly_team_details import execute

    _im, im_ids, team_ids = _im_session_scope()
    f = _filters(filters)
    fd, td = _range(f)
    columns, data, message = _script_report(execute, {
        "from_date": fd, "to_date": td,
        "im": im_ids,
        "team": _safe_teams(f, team_ids),
    })
    totals = _report_totals(
        columns, data,
        ratios={"utilization_pct": ("total_completed", "total_planned")},
        skip=("w1", "w2", "w3", "w4", "w5"),
    )
    out = {"columns": columns, "data": data, "totals": totals}
    if message:
        out["message"] = message
    return out


@frappe.whitelist()
def report_team_pva(filters=None):
    """Team PVA — Planned vs Actual per team per day, scoped to the IM."""
    _im, im_ids, team_ids = _im_session_scope()
    f = _filters(filters)
    fd, td = _range(f)
    return cc._team_utilization_pva(fd, td, teams=_safe_teams(f, team_ids), im_ids=im_ids)


# ------------------------------------------------------------ Performance ----

@frappe.whitelist()
def report_weekly_performance(filters=None):
    """Weekly Performance, scoped to the IM's own plans and executions."""
    _im, im_ids, _teams = _im_session_scope()
    f = _filters(filters)
    fd, td = _range(f)
    return cc._weekly_performance_report(fd, td, im_ids=im_ids)


@frappe.whitelist()
def report_top_teams(filters=None):
    """Top Teams, ranked within the IM's own teams rather than company-wide."""
    _im, im_ids, _teams = _im_session_scope()
    f = _filters(filters)
    fd, td = _range(f)
    return cc._top_teams_report(fd, td, im_ids=im_ids)


# -------------------------------------------------------- Project Reports ----

@frappe.whitelist()
def report_project_performance(filters=None):
    """Project Performance across the IM's own PO lines."""
    _im, im_ids, _teams = _im_session_scope()
    return cc._project_performance_report(im_ids=im_ids)


# ------------------------------------------------------ Rollout & Delivery ----

@frappe.whitelist()
def report_rollout_burn_down(filters=None):
    """Rollout Delivery Burn-Down over the IM's own backlog."""
    _im, im_ids, _teams = _im_session_scope()
    f = _filters(filters)
    fd, td = _range(f)
    return cc._rollout_burn_down_report(fd, td, im_ids=im_ids)


@frappe.whitelist()
def report_po_dispatch_status(filters=None):
    """PO Dispatch Status for the IM's own order book."""
    _im, im_ids, _teams = _im_session_scope()
    return cc._po_dispatch_status_report(im_ids=im_ids)


@frappe.whitelist()
def report_po_milestone_status(filters=None):
    """PO Milestone Status for the IM's own order book."""
    _im, im_ids, _teams = _im_session_scope()
    return cc._po_milestone_status_report(im_ids=im_ids)


# --------------------------------------------------- Client / Domain ----

@frappe.whitelist()
def report_team_idle_domain(month=None, domains=None, include_fridays=0, etag=None):
    """Team Idle by Domain over the IM's own team roster.

    all_statuses=True on purpose: a team On Vacation this week still worked
    last month, and a monthly idle grid that quietly drops it is wrong in a way
    that looks right. Scoped by roster and not by plan IM — see the module
    docstring for why.
    """
    _im, _im_ids, team_ids = _im_session_scope()
    if not team_ids:
        return {"days": [], "rows": [], "totals": {"idle_per_day": []}, "coverage": {}}
    return cc._team_domain_utilization(
        month, domains, include_fridays, etag,
        team_ids=team_ids, all_statuses=True,
    )


# ------------------------------------------------ CIAG Site Sign & Verify ----

@frappe.whitelist()
def report_site_sign_status(filters=None):
    """Site Sign Status for sites the IM's own work touches."""
    _im, im_ids, _teams = _im_session_scope()
    duids, _projects = _im_duid_scope(im_ids)
    return {"columns": mm._SIGN_STATUS_COLUMNS, "data": mm.get_site_sign_status(duids=duids)}


@frappe.whitelist()
def report_site_verify_status(filters=None):
    """Site Verify Status for the IM's own executions."""
    _im, im_ids, _teams = _im_session_scope()
    return {"columns": mm._VERIFY_STATUS_COLUMNS, "data": mm.get_site_verify_status(im_ids=im_ids)}


# -------------------------------------------------------- Material Reports ----

@frappe.whitelist()
def report_bill_wise_status(filters=None):
    """Bill Wise Material Status for sites the IM's own work touches."""
    _im, im_ids, _teams = _im_session_scope()
    duids, _projects = _im_duid_scope(im_ids)
    return {"columns": mm._BILL_WISE_COLUMNS, "data": mm.get_bill_wise_status(duids=duids)}


@frappe.whitelist()
def report_huawei_outbound_analytics(filters=None):
    """Huawei Outbound Analytics across the IM's own projects."""
    from inet_app.inet_app.report.huawei_outbound_analytics.huawei_outbound_analytics import execute

    _im, im_ids, _teams = _im_session_scope()
    _duids, projects = _im_duid_scope(im_ids)
    f = _filters(filters)
    # `projects` is always set, even when empty — an IM with no projects must
    # see nothing here, not the whole company's shipments.
    f["projects"] = projects
    columns, data, _msg, chart = execute(f)
    totals = {}
    for col in columns or []:
        fn = col.get("fieldname")
        if fn and col.get("fieldtype") in ("Int", "Float", "Currency"):
            totals[fn] = round(sum(flt(r.get(fn)) for r in (data or [])), 2)
    if data:
        # Already a share of the whole, so it totals to 100 by construction
        # rather than by summing the rows' own percentages.
        totals["pct"] = 100.0
    return {"columns": columns, "data": data, "totals": totals, "chart": chart}
