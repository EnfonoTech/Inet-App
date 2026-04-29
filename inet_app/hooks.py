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
		"filters": [["name", "in", ["INET Admin", "INET IM", "INET Field Team"]]],
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
	"Purchase Order": {
		"on_submit": "inet_app.api.project_management.on_purchase_order_submit"
	},
}

# Scheduled Tasks
# ---------------

# scheduler_events = {
# 	"all": [
# 		"inet_app.tasks.all"
# 	],
# 	"daily": [
# 		"inet_app.tasks.daily"
# 	],
# 	"hourly": [
# 		"inet_app.tasks.hourly"
# 	],
# 	"weekly": [
# 		"inet_app.tasks.weekly"
# 	],
# 	"monthly": [
# 		"inet_app.tasks.monthly"
# 	],
# }

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

# ignore_links_on_delete = ["Communication", "ToDo"]

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

