"""Where each role lands, in an order we control.

Frappe's ``role_home_page`` hook reads like a priority list and is not one.
``get_home_page_via_hooks`` walks ``frappe.get_roles()`` — the *user's* roles,
in whatever order the query returns them — and takes the first one that
appears in the map. Administrator holds nearly every role, so that query
order, not the map, decided the landing page; it returned ``INET HR`` first,
which is why the site root and the portal login opened the Certificate
Tracker.

``get_website_user_home_page`` is consulted before ``role_home_page`` and is a
plain function, so the order below is the real one. It is the only landing
hook this app registers — ``role_home_page`` is deliberately gone, because a
second map would silently take over for anyone this one returns ``None`` for.

Most specific job wins, and desk roles outrank portal roles: someone given
``INET Admin`` on top of a portal role is an admin who also does that job.

Everyone who matches is sent to ``/inet-home``, which 302s on to their real
destination (see ``inet_app/www/inet_home.py``). Handing Frappe the
destination directly does not work: it *renders* that page at whatever URL was
asked for, and both shells refuse to run anywhere but their own path. The desk
router reads ``window.location.pathname``, and the PMS bundle is mounted with
``basename="/pms"`` and bails out to ``/app`` when it finds itself elsewhere —
so a portal user opening the bare site root used to be bounced into the desk
and met with a permission error.
"""

import frappe

#: The one page every matching user is sent to. It redirects; it is not a
#: destination. Kept out of LANDING_ORDER so the two can never be confused.
LANDING_PAGE = "inet-home"

#: ``(role, destination)``, highest priority first. The first of these roles
#: the user holds decides where they end up. Paths are relative, no leading
#: "/", which is what ``get_home_page()`` returns everywhere else.
LANDING_ORDER = (
	("Administrator", "app"),
	("System Manager", "app"),
	("INET Admin", "pms/dashboard"),
	# Same portal as INET Admin, minus the desk/masters/certificate entries
	# the sidebar hides — see inet_app.roles / get_logged_user.
	("INET PM", "pms/dashboard"),
	("INET PIC", "pms/pic-dashboard"),
	("INET IM", "pms/im-dashboard"),
	("INET Field Team", "pms/today"),
	# Warehouse Manager — lands straight on Material Requests, their actual
	# job, rather than Desk's "No App" page or (before this) the Field portal.
	("Stock Manager", "pms/im-material-request"),
	# Last, and on purpose. HR is an ordinary desk user: the Certificate
	# Tracker is a page they open, not the place they start. Anyone holding
	# INET HR *and* an operational role lands on that role's page instead.
	("INET HR", "app"),
)


def destination_for(user=None):
	"""The path this user should end up on, or ``None`` if we have no opinion."""
	roles = set(frappe.get_roles(user or frappe.session.user))
	for role, destination in LANDING_ORDER:
		if role in roles:
			return destination
	return None


def get_landing_page(user=None):
	"""``get_website_user_home_page`` hook — the redirector, or ``None``.

	``None`` is the honest answer for someone holding none of the roles above:
	Frappe then falls back to Website Settings' home page, as it would if this
	app were not installed. Claiming them too would send a roleless Website
	User to the desk, which throws ``PermissionError`` at them by name.
	"""
	return LANDING_PAGE if destination_for(user) else None
