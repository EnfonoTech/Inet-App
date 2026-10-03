"""``/inet-home`` — a 302 to wherever this user actually belongs.

Every role in ``inet_app.home_page.LANDING_ORDER`` lands here first, and here
is where the real destination is chosen. The hop exists because Frappe's home
page is *rendered*, not redirected to: name ``pms/im-dashboard`` as a home
page and the PMS shell is served at the bare site root, where its router
(``basename="/pms"`` in frontend/src/main.jsx) refuses to match and sends the
browser to ``/app`` instead — a permission error for a portal user. The desk
is no better off at ``/``; its router reads ``window.location.pathname``.

One redirect and both shells get the URL they were built for.

The ``.html`` beside this is required — ``TemplatePage.can_render`` refuses a
page that is only a ``.py`` — and is only ever seen if the redirect fails.
This cannot live in ``www/index.py`` (where a dead copy used to sit):
``resolve_path`` swaps "index" for ``get_home_page()`` before any template is
looked up, so that file was unreachable by design.
"""

import frappe

from inet_app.home_page import destination_for


def get_context(context):
	frappe.local.flags.redirect_location = "/" + (destination_for() or "app")
	# 302, not Frappe's default 301. Where a role lands is a thing we change,
	# and a permanent redirect on the site root would outlive the change in
	# every browser that saw it.
	raise frappe.Redirect(302)
