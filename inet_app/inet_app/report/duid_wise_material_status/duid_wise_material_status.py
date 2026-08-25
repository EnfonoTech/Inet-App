import frappe
from frappe import _


def execute(filters=None):
    from inet_app.api.material_management import get_duid_stock_balance

    columns = [
        {"label": _("DUID"), "fieldname": "duid", "fieldtype": "Link", "options": "DUID Master", "width": 180},
        {"label": _("Project Name"), "fieldname": "project_name", "fieldtype": "Data", "width": 200},
        {"label": _("Item Code"), "fieldname": "item_code", "fieldtype": "Link", "options": "Item", "width": 120},
        {"label": _("Item Name"), "fieldname": "item_name", "fieldtype": "Data", "width": 220},
        {"label": _("Warehouse"), "fieldname": "warehouse", "fieldtype": "Link", "options": "Warehouse", "width": 150},
        {"label": _("Qty"), "fieldname": "qty", "fieldtype": "Float", "width": 90},
        {"label": _("UOM"), "fieldname": "uom", "fieldtype": "Data", "width": 80},
    ]

    data = get_duid_stock_balance()
    f = filters or {}
    duid = f.get("duid")
    item_code = f.get("item_code")
    warehouse = f.get("warehouse")
    show_company_items = f.get("show_company_items")

    # Only DUID-tagged rows — an untagged ("No DUID") row has nothing to do
    # with any specific DUID, so it's just noise in a report named for one.
    # Company items aren't DUID-scoped in the first place (they're generic
    # team stock), so they're excluded by default too unless asked for.
    data = [r for r in data if r["duid"]]
    if not show_company_items:
        data = [r for r in data if r["item_type"] == "customer"]
    if duid:
        data = [r for r in data if r["duid"] == duid]
    if item_code:
        data = [r for r in data if r["item_code"] == item_code]
    if warehouse:
        data = [r for r in data if r["warehouse"] == warehouse]
    return columns, data
