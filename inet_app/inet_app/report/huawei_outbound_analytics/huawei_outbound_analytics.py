import frappe
from frappe import _

# "project" is a direct Link field on Huawei Outbound Plan (PK of Project
# Control Center) — no DUID/site_code join needed. Domain comes from
# Project Control Center.project_domain, one hop further.
_CHART_TOP_N = 12


def execute(filters=None):
    f = filters or {}
    from_date = f.get("from_date")
    to_date = f.get("to_date")
    subcon = f.get("subcon")
    project = f.get("project")
    domain = f.get("domain")
    # Default view: one row per concrete (Project, Subcontractor) pair —
    # "how many subcontractors work on this project" and "how many projects
    # does this subcontractor touch" are both just this same table filtered/
    # scanned. by_subcon=1 collapses that down to one row per subcontractor
    # (summed across every project it touched) — a plain top-line rollup,
    # for when the project/domain breakdown isn't what's wanted.
    by_subcon = bool(f.get("by_subcon"))

    where = "1=1"
    params = []
    if from_date:
        where += " AND hop.outbound_date >= %s"
        params.append(from_date)
    if to_date:
        where += " AND hop.outbound_date <= %s"
        params.append(to_date)
    if subcon:
        where += " AND hop.subcon = %s"
        params.append(subcon)
    if project:
        where += " AND hop.project = %s"
        params.append(project)
    if domain:
        where += " AND NULLIF(pcc.project_domain, '') = %s"
        params.append(domain)

    if by_subcon:
        columns = [
            {"label": _("Subcontractor"), "fieldname": "subcon_label", "fieldtype": "Data", "width": 180},
            {"label": _("Shipments"), "fieldname": "shipments", "fieldtype": "Int", "width": 100},
            {"label": _("Total Volume (m³)"), "fieldname": "total_volume", "fieldtype": "Float", "width": 140},
            {"label": _("% of Total"), "fieldname": "pct", "fieldtype": "Percent", "width": 100},
        ]
        rows = frappe.db.sql(f"""
            SELECT IFNULL(hop.subcon, '(No Subcontractor)') AS subcon_label,
                   COUNT(*) AS shipments,
                   COALESCE(SUM(hop.total_volume), 0) AS total_volume
            FROM `tabHuawei Outbound Plan` hop
            LEFT JOIN `tabProject Control Center` pcc ON pcc.project_code = hop.project
            WHERE {where}
            GROUP BY hop.subcon
            ORDER BY total_volume DESC
        """, params, as_dict=True)
    else:
        columns = [
            {"label": _("Project"), "fieldname": "project_label", "fieldtype": "Data", "width": 220},
            {"label": _("Project Domain"), "fieldname": "domain_label", "fieldtype": "Data", "width": 150},
            {"label": _("Subcontractor"), "fieldname": "subcon_label", "fieldtype": "Data", "width": 150},
            {"label": _("Shipments"), "fieldname": "shipments", "fieldtype": "Int", "width": 100},
            {"label": _("Total Volume (m³)"), "fieldname": "total_volume", "fieldtype": "Float", "width": 140},
            {"label": _("% of Total"), "fieldname": "pct", "fieldtype": "Percent", "width": 100},
        ]
        rows = frappe.db.sql(f"""
            SELECT IFNULL(pcc.project_name, '(No Project Linked)') AS project_label,
                   IFNULL(NULLIF(pcc.project_domain, ''), '(No Domain)') AS domain_label,
                   IFNULL(hop.subcon, '(No Subcontractor)') AS subcon_label,
                   COUNT(*) AS shipments,
                   COALESCE(SUM(hop.total_volume), 0) AS total_volume
            FROM `tabHuawei Outbound Plan` hop
            LEFT JOIN `tabProject Control Center` pcc ON pcc.project_code = hop.project
            WHERE {where}
            GROUP BY hop.project, hop.subcon
            ORDER BY total_volume DESC
        """, params, as_dict=True)

    total_vol = sum(r.total_volume for r in rows) or 1
    data = []
    for r in rows:
        row = {
            "subcon_label": r.subcon_label,
            "shipments": r.shipments,
            "total_volume": round(r.total_volume, 2),
            "pct": round(r.total_volume / total_vol * 100, 1),
        }
        if not by_subcon:
            row["project_label"] = r.project_label
            row["domain_label"] = r.domain_label
        data.append(row)

    # Top N by volume, not every row — a bar per row is unreadable once
    # there are dozens of them; the table below already shows every row in
    # full. In the detailed view, subcontractor name leads the label
    # (short, e.g. "REZAIK") with the project after — project names run
    # 30-40+ characters, so a project-first label just gets truncated away
    # before the more differentiating subcontractor name ever shows.
    top = data[:_CHART_TOP_N]
    chart = {
        "data": {
            "labels": (
                [r["subcon_label"] for r in top] if by_subcon
                else [f"{r['subcon_label']} · {r['project_label']}" for r in top]
            ),
            "datasets": [{"name": "Volume (m³)", "values": [r["total_volume"] for r in top]}],
        },
        "type": "bar",
        "colors": ["#1565C0"],
    }
    return columns, data, None, chart
