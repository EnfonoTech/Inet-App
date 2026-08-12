"""INET HR — Certificate Tracker.

Standalone page, deliberately separate from the PMS portal (/pms/*) in
login flow, UI, and UX — same spirit/theme as the reference tracker tool,
wired to real Frappe data instead of a hardcoded/localStorage dataset.

Access: any user holding the INET HR role (or INET Admin / System Manager
for oversight) — no separate login, just Frappe's own session/login page.
"""

import frappe
from frappe.sessions import get_csrf_token

ALLOWED_ROLES = {"INET HR", "INET Admin", "System Manager"}

no_cache = 1


def get_context(context):
	context.no_cache = 1
	context.show_sidebar = False
	context.full_width = True

	user = frappe.session.user
	context.is_guest = not user or user == "Guest"
	if context.is_guest:
		context.access_denied = True
		context.full_name = ""
		context.csrf_token = ""
		return context

	roles = set(frappe.get_roles(user))
	context.access_denied = not (roles & ALLOWED_ROLES)
	context.full_name = frappe.utils.get_fullname(user)
	context.csrf_token = get_csrf_token()
	return context
