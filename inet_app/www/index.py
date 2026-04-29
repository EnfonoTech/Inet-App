"""Site root handler.

Sends ``/`` to the Frappe / ERPNext Desk so logged-in users always land on
something useful instead of the bare PMS portal page. PMS users will still
hit ``/pms`` directly via the role_home_page mapping after login.
"""

import frappe


def get_context(context):
    frappe.local.flags.redirect_location = "/app"
    raise frappe.Redirect
