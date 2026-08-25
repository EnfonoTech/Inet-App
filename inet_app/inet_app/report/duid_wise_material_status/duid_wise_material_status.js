frappe.query_reports["DUID Wise Material Status"] = {
	"filters": [
		{
			"fieldname": "duid",
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
		{
			"fieldname": "show_company_items",
			"label": __("Show Company Items"),
			"fieldtype": "Check",
			"default": 0,
		},
	],
};
