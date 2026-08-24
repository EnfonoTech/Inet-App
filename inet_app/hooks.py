app_name = "inet_app"
app_title = "Inet App"
app_publisher = "enfono"
app_description = "custom app for inet"
app_email = "ramees@enfono.com"
app_license = "mit"

website_route_rules = [
	{"from_route": "/pms", "to_route": "pms"},
	{"from_route": "/pms/<path:app_path>", "to_route": "pms"},
]

# Send the bare site root to the Frappe / ERPNext Desk so a "blank" / no
# longer surprises users. (PMS portal users still land on /pms via
# role_home_page below after login.)
website_redirects = [
	{"source": r"^/$", "target": "/app", "redirect_http_status": 302},
]

fixtures = [
	{
		"dt": "Custom Field",
		"filters": [["module", "=", "Inet App"]],
	},
	{
		"dt": "Role",
		"filters": [["name", "in", ["INET Admin", "INET IM", "INET Field Team", "INET PIC", "INET HR"]]],
	},
	{"dt": "Report", "filters": [["name", "=", "Huawei Outbound Analytics"]]},
	{
		"dt": "Notification",
		"filters": [["name", "like", "INET Certificate%"]],
	},
	{
		# Sales Invoice: allow manual rename of the auto-generated ID before
		# submit (Desk menu -> Rename). Core ERPNext doctype, so this is a
		# Property Setter rather than an inet_app-owned Custom Field.
		"dt": "Property Setter",
		"filters": [["name", "=", "Sales Invoice-main-allow_rename"]],
	},
]

after_migrate = "inet_app.setup.after_migrate"

# Apps
# ------------------

# required_apps = []

# Each item in the list will be shown as an app in the apps page
# add_to_apps_screen = [
# 	{
# 		"name": "inet_app",
# 		"logo": "/assets/inet_app/logo.png",
# 		"title": "Inet App",
# 		"route": "/inet_app",
# 		"has_permission": "inet_app.api.permission.has_app_permission"
# 	}
# ]

# Includes in <head>
# ------------------

# include js, css files in header of desk.html
# app_include_css = "/assets/inet_app/css/inet_app.css"
doctype_js = {
	"Stock Entry": "public/js/stock_entry.js",
}

# app_include_js = "/assets/inet_app/js/inet_app.js"

# include js, css files in header of web template
# web_include_css = "/assets/inet_app/css/inet_app.css"
# web_include_js = "/assets/inet_app/js/inet_app.js"

# include custom scss in every website theme (without file extension ".scss")
# website_theme_scss = "inet_app/public/scss/website"

# include js, css files in header of web form
# webform_include_js = {"doctype": "public/js/doctype.js"}
# webform_include_css = {"doctype": "public/css/doctype.css"}

# include js in page
# page_js = {"page" : "public/js/file.js"}

# include js in doctype views
# doctype_js = {"doctype" : "public/js/doctype.js"}
# doctype_list_js = {"doctype" : "public/js/doctype_list.js"}
# doctype_tree_js = {"doctype" : "public/js/doctype_tree.js"}
# doctype_calendar_js = {"doctype" : "public/js/doctype_calendar.js"}

# Svg Icons
# ------------------
# include app icons in desk
# app_include_icons = "inet_app/public/icons.svg"

# Home Pages
# ----------

# application home page (will override Website Settings)
# home_page = "login"

# Landing page per role. Frappe uses the FIRST matching role in this map for
# the logged-in user. Without this, field/IM users get Desk's "No App" page
# because they lack Desk / System Manager permissions.
role_home_page = {
	"INET Field Team": "pms/today",
	"INET IM": "pms/im-dashboard",
	"INET Admin": "pms/dashboard",
	"INET PIC": "pms/pic-dashboard",
	# Warehouse Manager — lands straight on Material Requests, their actual
	# job, rather than Desk's "No App" page or (before this) the Field
	# portal (get_logged_user() had no branch for Stock Manager either).
	"Stock Manager": "pms/im-material-request",
	# Standalone page, deliberately NOT under /pms — separate from the PMS
	# portal in login flow, UI, and UX. Any user holding INET HR lands here
	# straight from Frappe's own /login, no PMS involved.
	"INET HR": "hr-certificates",
}

# Generators
# ----------

# automatically create page for each record of this doctype
# website_generators = ["Web Page"]

# Jinja
# ----------

# add methods and filters to jinja environment
# jinja = {
# 	"methods": "inet_app.utils.jinja_methods",
# 	"filters": "inet_app.utils.jinja_filters"
# }

# Installation
# ------------

# before_install = "inet_app.install.before_install"
# after_install = "inet_app.install.after_install"

# Uninstallation
# ------------

# before_uninstall = "inet_app.uninstall.before_uninstall"
# after_uninstall = "inet_app.uninstall.after_uninstall"

# Integration Setup
# ------------------
# To set up dependencies/integrations with other apps
# Name of the app being installed is passed as an argument

# before_app_install = "inet_app.utils.before_app_install"
# after_app_install = "inet_app.utils.after_app_install"

# Integration Cleanup
# -------------------
# To clean up dependencies/integrations with other apps
# Name of the app being uninstalled is passed as an argument

# before_app_uninstall = "inet_app.utils.before_app_uninstall"
# after_app_uninstall = "inet_app.utils.after_app_uninstall"

# Desk Notifications
# ------------------
# See frappe.core.notifications.get_notification_config

# notification_config = "inet_app.notifications.get_notification_config"

# Permissions
# -----------
# Permissions evaluated in scripted ways

# permission_query_conditions = {
# 	"Event": "frappe.desk.doctype.event.event.get_permission_query_conditions",
# }
#
# has_permission = {
# 	"Event": "frappe.desk.doctype.event.event.has_permission",
# }

# DocType Class
# ---------------
# Override standard doctype classes

# override_doctype_class = {
# 	"ToDo": "custom_app.overrides.CustomToDo"
# }

# Document Events
# ---------------
# Hook on document methods and events

doc_events = {
	"Sales Invoice": {
		"before_submit": "inet_app.api.pic.before_sales_invoice_submit",
		"on_submit": "inet_app.api.pic.on_sales_invoice_submit",
		"on_cancel": "inet_app.api.pic.on_sales_invoice_cancel"
	},
	# Supplier side (Subcon PO). PIC raises these; the Purchase Invoice is
	# submitted by Accounts, so the status has to follow the document rather
	# than a button click — see inet_app/api/subcon_po.py.
	"Purchase Order": {
		"on_submit": "inet_app.api.subcon_po.on_purchase_order_submit",
		"on_cancel": "inet_app.api.subcon_po.on_purchase_order_cancel",
		# Without on_trash a deleted draft PO would leave its PIC line stuck
		# at "PO Created" — never orderable again, never on the To Order tab.
		"on_trash": "inet_app.api.subcon_po.on_purchase_order_trash",
	},
	"Purchase Invoice": {
		"on_submit": "inet_app.api.subcon_po.on_purchase_invoice_submit",
		"on_cancel": "inet_app.api.subcon_po.on_purchase_invoice_cancel",
		# A draft invoice is deleted, not cancelled, so on_cancel never fires —
		# without this the line stays at "Invoice Received" for a bill that no
		# longer exists.
		"on_trash": "inet_app.api.subcon_po.on_purchase_invoice_trash",
	},
	# One Payment Entry can settle either side, so both handlers run: the pic
	# one walks Sales Invoice references (customer receipts), the subcon_po one
	# walks Purchase Invoice references (supplier payments). Each ignores the
	# other's reference type.
	"Payment Entry": {
		"on_submit": [
			"inet_app.api.pic.on_payment_entry_submit",
			"inet_app.api.subcon_po.on_payment_entry_submit",
		],
		"on_cancel": [
			"inet_app.api.pic.on_payment_entry_cancel",
			"inet_app.api.subcon_po.on_payment_entry_cancel",
		],
	},
	# Keeps the stored Subcon PO rollup correct even for a hand edit in Desk
	# that never goes through inet_app.api.subcon_po. Mirrors how pic_status
	# rolls up into dispatch_status.
	"PO Dispatch": {
		"validate": "inet_app.api.subcon_po.set_overall_status",
	},
	"Stock Entry": {
		"before_insert": "inet_app.api.material_management.before_stock_entry_insert",
		"after_insert": "inet_app.api.material_management.after_stock_entry_insert",
		"before_submit": "inet_app.api.material_management.before_stock_entry_submit",
		"on_submit": [
			"inet_app.api.material_management.on_stock_entry_submit",
			"inet_app.api.notifications.on_stock_entry_submit_notification",
		],
		"on_cancel": "inet_app.api.material_management.on_stock_entry_cancel",
		"on_trash": "inet_app.api.material_management.on_stock_entry_trash",
	},
	"Daily Execution": {
		"after_insert": "inet_app.api.notifications.on_daily_execution_insert",
		"on_update": "inet_app.api.notifications.on_daily_execution_update",
	},
	"Rollout Plan": {
		"after_insert": "inet_app.api.notifications.on_rollout_plan_insert",
		"on_update": "inet_app.api.notifications.on_rollout_plan_update",
	},
	"Material Request": {
		"on_submit": "inet_app.api.notifications.on_material_request_submit",
		"on_cancel": "inet_app.api.notifications.on_material_request_cancel",
	},
	"Expense Claim": {
		"on_submit": "inet_app.api.notifications.on_expense_claim_submit",
		"on_update": "inet_app.api.notifications.on_expense_claim_update",
	},
	"Huawei Outbound Plan": {
		"after_insert": "inet_app.api.notifications.on_huawei_plan_insert",
	},
}

# Permission Hooks
# ----------------
# Controllers can only DENY permission on top of the role-based grant, never
# grant beyond it. Used to stop the Warehouse Manager (Stock Manager role —
# which needs broad submit/cancel on Stock Entry for Material Receipts and
# for confirming Returns) from bypassing the receiving team's confirmation
# step by submitting a staged outbound transfer directly from the Desk UI.
has_permission = {
	"Stock Entry": "inet_app.api.material_management.stock_entry_has_permission",
}

# Scheduled Tasks
# ---------------

scheduler_events = {
	"daily": [
		"inet_app.api.command_center.auto_mark_overdue_plans",
		"inet_app.api.hr_certificates.daily_certificate_status_refresh",
	],
	"cron": {
		"0 8 * * *": ["inet_app.api.notifications.send_dummy_po_reminder"],
		"0 18 * * *": ["inet_app.api.notifications.send_daily_work_done_summary"],
	},
}

# Testing
# -------

# before_tests = "inet_app.install.before_tests"

# Overriding Methods
# ------------------------------
#
# override_whitelisted_methods = {
# 	"frappe.desk.doctype.event.event.get_events": "inet_app.event.get_events"
# }
#
# each overriding function accepts a `data` argument;
# generated from the base implementation of the doctype dashboard,
# along with any modifications made in other Frappe apps
# override_doctype_dashboards = {
# 	"Task": "inet_app.task.get_dashboard_data"
# }

# exempt linked doctypes from being automatically cancelled
#
# auto_cancel_exempted_doctypes = ["Auto Repeat"]

# Ignore links to specified DocTypes when deleting documents
# -----------------------------------------------------------

# Huawei MR Import is an audit log of an import run — it links to the
# Material Receipt it created (Huawei MR Import Result.material_receipt),
# but that's a record of what happened, not a real dependency. It must
# never block deleting/cancelling the Stock Entry it points to.
ignore_links_on_delete = ["Huawei MR Import"]

# Request Events
# ----------------
# before_request = ["inet_app.utils.before_request"]
# after_request = ["inet_app.utils.after_request"]

# Job Events
# ----------
# before_job = ["inet_app.utils.before_job"]
# after_job = ["inet_app.utils.after_job"]

# User Data Protection
# --------------------

# user_data_fields = [
# 	{
# 		"doctype": "{doctype_1}",
# 		"filter_by": "{filter_by}",
# 		"redact_fields": ["{field_1}", "{field_2}"],
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_2}",
# 		"filter_by": "{filter_by}",
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_3}",
# 		"strict": False,
# 	},
# 	{
# 		"doctype": "{doctype_4}"
# 	}
# ]

# Authentication and authorization
# --------------------------------

# auth_hooks = [
# 	"inet_app.auth.validate"
# ]

# Automatically update python controller files with type annotations for this app.
# export_python_type_annotations = True

# default_log_clearing_doctypes = {
# 	"Logging DocType Name": 30  # days to retain logs
# }

