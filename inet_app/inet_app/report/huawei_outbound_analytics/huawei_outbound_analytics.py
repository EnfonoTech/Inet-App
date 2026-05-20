import frappe
from frappe import _


def execute(filters=None):
    f = filters or {}
    from_date = f.get("from_date")
    to_date = f.get("to_date")

    columns = [
        {"label": _("Subcontractor"), "fieldname": "subcon", "fieldtype": "Data", "width": 160},
        {"label": _("Shipments"), "fieldname": "shipments", "fieldtype": "Int", "width": 100},
        {"label": _("Total Volume (m³)"), "fieldname": "total_volume", "fieldtype": "Float", "width": 140},
        {"label": _("% of Total"), "fieldname": "pct", "fieldtype": "Percent", "width": 100},
    ]

    where = "1=1"
    params = []
    if from_date:
        where += " AND outbound_date >= %s"
        params.append(from_date)
    if to_date:
        where += " AND outbound_date <= %s"
        params.append(to_date)

    rows = frappe.db.sql(f"""
        SELECT subcon, COUNT(*) AS shipments, COALESCE(SUM(total_volume),0) AS total_volume
        FROM `tabHuawei Outbound Plan`
        WHERE {where}
        GROUP BY subcon
        ORDER BY total_volume DESC
    """, params, as_dict=True)

    total_vol = sum(r.total_volume for r in rows) or 1
    data = []
    for r in rows:
        data.append({
            "subcon": r.subcon or "(blank)",
            "shipments": r.shipments,
            "total_volume": round(r.total_volume, 2),
            "pct": round(r.total_volume / total_vol * 100, 1),
        })

    chart = {
        "data": {
            "labels": [r["subcon"] for r in data],
            "datasets": [{"name": "Volume (m³)", "values": [r["total_volume"] for r in data]}]
        },
        "type": "bar",
        "colors": ["#1565C0"],
    }
    return columns, data, None, chart
