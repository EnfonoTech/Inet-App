import frappe
from frappe import _


def execute(filters=None):
    from inet_app.api.material_management import get_bill_wise_status_by_warehouse

    columns = [
        {"label": _("Bill No."), "fieldname": "bill_no", "fieldtype": "Link", "options": "Huawei Outbound Plan", "width": 160},
        {"label": _("Project Name"), "fieldname": "project_name", "fieldtype": "Data", "width": 180},
        {"label": _("DU ID"), "fieldname": "du_id", "fieldtype": "Link", "options": "DUID Master", "width": 150},
        {"label": _("Item Code"), "fieldname": "item_code", "fieldtype": "Link", "options": "Item", "width": 120},
        {"label": _("Item Name"), "fieldname": "item_name", "fieldtype": "Data", "width": 180},
        {"label": _("Warehouse"), "fieldname": "warehouse", "fieldtype": "Link", "options": "Warehouse", "width": 150},
        {"label": _("Current Qty"), "fieldname": "current_qty", "fieldtype": "Float", "width": 100},
        {"label": _("Received Qty"), "fieldname": "received_qty", "fieldtype": "Float", "width": 100},
        {"label": _("Transferred Qty"), "fieldname": "transferred_qty", "fieldtype": "Float", "width": 110},
        {"label": _("Used Qty"), "fieldname": "issued_qty", "fieldtype": "Float", "width": 90},
        {"label": _("Remaining Qty"), "fieldname": "remaining_qty", "fieldtype": "Float", "width": 110},
        {"label": _("UOM"), "fieldname": "uom", "fieldtype": "Data", "width": 70},
        {"label": _("Outbound Date"), "fieldname": "outbound_date", "fieldtype": "Date", "width": 110},
        {"label": _("Status"), "fieldname": "status", "fieldtype": "Data", "width": 100},
    ]
    return columns, get_bill_wise_status_by_warehouse(filters)
