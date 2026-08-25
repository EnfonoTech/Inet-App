frappe.query_reports["Bill Wise Material Status"] = {
	"filters": [
		{
			"fieldname": "from_date",
			"label": __("From Date"),
			"fieldtype": "Date",
		},
		{
			"fieldname": "to_date",
			"label": __("To Date"),
			"fieldtype": "Date",
		},
		{
			"fieldname": "bill_no",
			"label": __("Bill No."),
			"fieldtype": "Link",
			"options": "Huawei Outbound Plan",
		},
		{
			"fieldname": "du_id",
			"label": __("DUID"),
			"fieldtype": "Link",
			"options": "DUID Master",
		},
		{
			"fieldname": "item_code",
			"label": __("Item"),
			"fieldtype": "Link",
			"options": "Item",
		},
		{
			"fieldname": "warehouse",
			"label": __("Warehouse"),
			"fieldtype": "Link",
			"options": "Warehouse",
		},
	],
};
