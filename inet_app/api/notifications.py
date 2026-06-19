import frappe


# ---------------------------------------------------------------------------
# Public API for the React PWA bell
# ---------------------------------------------------------------------------

@frappe.whitelist()
def get_my_notifications(limit=50):
	"""Return the current user's INET notification logs.

	Uses ignore_permissions so portal-only users (INET Field Team etc.) can
	always read their own notifications regardless of Desk role permissions.
	"""
	user = frappe.session.user
	logs = frappe.db.get_all(
		"Notification Log",
		filters={"for_user": user},
		fields=["name", "subject", "link", "read", "document_type",
		        "document_name", "creation", "modified"],
		order_by="creation desc",
		limit=int(limit),
		ignore_permissions=True,
	)
	return {"notification_logs": logs}


@frappe.whitelist()
def mark_notification_read(name):
	"""Mark one notification as read."""
	user = frappe.session.user
	if name and frappe.db.get_value("Notification Log", name, "for_user",
	                                ignore_permissions=True) == user:
		frappe.db.set_value("Notification Log", name, "read", 1,
		                    update_modified=False, for_update=False)


@frappe.whitelist()
def mark_all_notifications_read():
	"""Mark all of the current user's notifications as read."""
	user = frappe.session.user
	frappe.db.sql(
		"UPDATE `tabNotification Log` SET `read`=1 WHERE for_user=%s AND `read`=0",
		user,
	)


# ---------------------------------------------------------------------------
# Core helpers
# ---------------------------------------------------------------------------

def _make_notification(for_user, subject, doctype=None, docname=None, link=None):
	"""Create a Notification Log entry for one user + fire Frappe push if enabled."""
	if not for_user or not frappe.db.exists("User", for_user):
		return

	frappe.get_doc({
		"doctype": "Notification Log",
		"for_user": for_user,
		"from_user": frappe.session.user or "Administrator",
		"subject": subject,
		"type": "Alert",
		"document_type": doctype,
		"document_name": docname,
		"link": link,
	}).insert(ignore_permissions=True)

	display = (
		subject
		.replace("[CRITICAL] ", "")
		.replace("[ALERT] ", "")
		.replace("[INFO] ", "")
	)
	try:
		from frappe.push_notification import PushNotification
		push = PushNotification("inet_app")
		if push.is_enabled():
			push.send_notification_to_user(
				user_id=for_user,
				title="INET",
				body=display,
				link=link or "",
			)
	except Exception:
		pass


def _users_by_role(role):
	return frappe.db.get_all(
		"Has Role",
		filters={"role": role, "parenttype": "User"},
		pluck="parent",
	)


def _notify_role(role, subject, doctype=None, docname=None, link=None):
	for user in _users_by_role(role):
		_make_notification(user, subject, doctype, docname, link)


def _im_user_from_team(team_id):
	im_id = frappe.db.get_value("INET Team", team_id, "im")
	if not im_id:
		return None
	return frappe.db.get_value("IM Master", im_id, "user")


def _tl_user_from_team(team_id):
	return frappe.db.get_value("INET Team", team_id, "field_user")


# ---------------------------------------------------------------------------
# PO Dispatch helpers — resolve POID / DUID for readable messages
# ---------------------------------------------------------------------------

def _po_info(po_dispatch_name):
	"""Return {poid, site_code} for a PO Dispatch doc."""
	if not po_dispatch_name:
		return {}
	row = frappe.db.get_value(
		"PO Dispatch", po_dispatch_name, ["poid", "site_code"], as_dict=True
	)
	return row or {}


def _po_from_rollout_plan(rp_name):
	po_name = frappe.db.get_value("Rollout Plan", rp_name, "po_dispatch") if rp_name else None
	return _po_info(po_name)


def _po_from_daily_execution(de_name):
	rp_name = frappe.db.get_value("Daily Execution", de_name, "rollout_plan") if de_name else None
	return _po_from_rollout_plan(rp_name)


def _po_from_work_done(wd_name):
	de_name = frappe.db.get_value("Work Done", wd_name, "execution") if wd_name else None
	return _po_from_daily_execution(de_name)


def _po_label(po_info):
	"""Format as 'POID xxx · DUID yyy' — whichever fields exist."""
	parts = []
	if po_info.get("poid"):
		parts.append(f"POID {po_info['poid']}")
	if po_info.get("site_code"):
		parts.append(f"DUID {po_info['site_code']}")
	return " · ".join(parts)


# ---------------------------------------------------------------------------
# Execution workflow — Daily Work Update (DWU in /app desk)
# ---------------------------------------------------------------------------

def on_daily_work_update_update(doc, method=None):
	before = doc.get_doc_before_save()
	if not before:
		return

	im_user = _im_user_from_team(doc.team)
	tl_user = _tl_user_from_team(doc.team)

	if doc.status != before.status and doc.status == "Submitted":
		_make_notification(
			im_user,
			f"[ALERT] Daily update submitted — team {doc.team}, {doc.update_date}",
			"Daily Work Update", doc.name,
			link="/pms/im-execution",
		)

	if doc.approval_status != before.approval_status:
		if doc.approval_status == "Approved":
			_make_notification(
				tl_user,
				f"[INFO] Daily update approved — {doc.update_date}",
				"Daily Work Update", doc.name,
				link="/pms/today",
			)
		elif doc.approval_status == "Rejected":
			_make_notification(
				tl_user,
				f"[CRITICAL] Daily update rejected — {doc.update_date}",
				"Daily Work Update", doc.name,
				link="/pms/today",
			)


# ---------------------------------------------------------------------------
# Execution workflow — Daily Execution (TL submits from /pms)
# ---------------------------------------------------------------------------

def _notify_im_execution_completed(doc):
	"""Shared logic: notify IM when a Daily Execution reaches tl_status=Completed."""
	im_user = frappe.db.get_value("IM Master", doc.im, "user") if doc.im else None
	po = _po_from_rollout_plan(doc.rollout_plan)
	label = _po_label(po) or f"team {doc.team}"
	_make_notification(
		im_user,
		f"[ALERT] Work submitted — {label}",
		"Daily Execution", doc.name,
		link="/pms/im-execution",
	)


def on_daily_execution_insert(doc, method=None):
	"""Fires after_insert — catches first-time submissions where tl_status=Completed on insert."""
	if doc.tl_status == "Completed":
		_notify_im_execution_completed(doc)


def on_daily_execution_update(doc, method=None):
	"""Fires on_update — catches subsequent saves where tl_status changes to Completed."""
	before = doc.get_doc_before_save()
	if not before:
		return
	if doc.tl_status != "Completed" or getattr(before, "tl_status", None) == "Completed":
		return
	_notify_im_execution_completed(doc)


def notify_tl_work_done_confirmed(work_done_name):
	"""Called directly from command_center.update_work_done_submission() because
	db.set_value() does not fire Frappe doc hooks."""
	row = frappe.db.sql(
		"""
		SELECT de.team
		FROM `tabWork Done` wd
		JOIN `tabDaily Execution` de ON de.name = wd.execution
		WHERE wd.name = %s
		LIMIT 1
		""",
		work_done_name,
		as_dict=True,
	)
	team = row[0].team if row else None
	tl_user = _tl_user_from_team(team) if team else None
	po = _po_from_work_done(work_done_name)
	label = _po_label(po) or work_done_name
	_make_notification(
		tl_user,
		f"[INFO] Work confirmed by IM — {label}",
		"Work Done", work_done_name,
		link="/pms/today",
	)


# ---------------------------------------------------------------------------
# Planning workflow — Rollout Plan
# ---------------------------------------------------------------------------

def on_rollout_plan_insert(doc, method=None):
	im_user = frappe.db.get_value("IM Master", doc.im, "user") if doc.im else None
	po = _po_info(doc.po_dispatch) if getattr(doc, "po_dispatch", None) else {}
	label = _po_label(po) or doc.name
	_make_notification(
		im_user,
		f"[INFO] Plan assigned — {label}",
		"Rollout Plan", doc.name,
		link="/pms/im-planning",
	)


def on_rollout_plan_update(doc, method=None):
	before = doc.get_doc_before_save()
	if not before or doc.cancel_request_status == before.cancel_request_status:
		return

	po = _po_info(doc.po_dispatch) if getattr(doc, "po_dispatch", None) else {}
	label = _po_label(po) or doc.name

	if doc.cancel_request_status == "Pending PM Approval":
		_notify_role(
			"INET Admin",
			f"[ALERT] Cancel requested — {label}",
			"Rollout Plan", doc.name,
			link="/pms/dashboard",
		)
	elif doc.cancel_request_status in ("Approved", "Rejected"):
		decided = doc.cancel_request_status.lower()
		_make_notification(
			doc.cancel_requested_by,
			f"[CRITICAL] Cancel request {decided} — {label}",
			"Rollout Plan", doc.name,
			link="/pms/im-planning",
		)


# ---------------------------------------------------------------------------
# Material workflow
# ---------------------------------------------------------------------------

def on_material_request_submit(doc, method=None):
	im_id = doc.get("im")
	if not im_id:
		return
	im_user = frappe.db.get_value("IM Master", im_id, "user")
	_make_notification(
		im_user,
		f"[ALERT] Material request raised by {doc.owner}",
		"Material Request", doc.name,
		link="/pms/im-dashboard",
	)


def on_material_request_cancel(doc, method=None):
	_make_notification(
		doc.owner,
		f"[CRITICAL] Material request cancelled — {doc.name}",
		"Material Request", doc.name,
		link="/pms/today",
	)


def on_stock_entry_submit_notification(doc, method=None):
	if doc.stock_entry_type != "Material Transfer":
		return
	mr_name = doc.get("material_request")
	if not mr_name:
		for item in doc.items:
			mr_name = item.get("material_request")
			if mr_name:
				break
	if not mr_name:
		return
	mr_owner = frappe.db.get_value("Material Request", mr_name, "owner")
	_make_notification(
		mr_owner,
		f"[INFO] Materials issued for your request",
		"Stock Entry", doc.name,
		link="/pms/today",
	)


def on_huawei_plan_insert(doc, method=None):
	_notify_role("INET IM",
		f"[INFO] Huawei plan imported — review warehouse",
		"Huawei Outbound Plan", doc.name,
		link="/pms/im-dashboard")
	_notify_role("INET Admin",
		f"[INFO] Huawei plan imported — review warehouse",
		"Huawei Outbound Plan", doc.name,
		link="/pms/dashboard")


# ---------------------------------------------------------------------------
# Expense workflow
# ---------------------------------------------------------------------------

def on_expense_claim_submit(doc, method=None):
	_make_notification(
		doc.expense_approver,
		f"[ALERT] Expense claim from {doc.employee_name} — {doc.total_claimed_amount}",
		"Expense Claim", doc.name,
		link="/pms/im-expense",
	)


def on_expense_claim_update(doc, method=None):
	before = doc.get_doc_before_save()
	if not before or doc.status == before.status:
		return
	submitter = frappe.db.get_value("Employee", doc.employee, "user_id")
	if doc.status == "Approved":
		_make_notification(
			submitter,
			f"[INFO] Expense claim approved — {doc.total_claimed_amount}",
			"Expense Claim", doc.name,
			link="/pms/field-expense",
		)
	elif doc.status == "Rejected":
		_make_notification(
			submitter,
			f"[CRITICAL] Expense claim rejected — check remarks",
			"Expense Claim", doc.name,
			link="/pms/field-expense",
		)


# ---------------------------------------------------------------------------
# Scheduled tasks
# ---------------------------------------------------------------------------

def send_missed_dwu_alert():
	"""Run at 18:00 daily — notify TL + IM for teams with no DWU today."""
	today = frappe.utils.today()

	planned_teams = frappe.db.sql("""
		SELECT DISTINCT team FROM `tabRollout Plan`
		WHERE plan_date <= %(today)s
		  AND (plan_end_date IS NULL OR plan_end_date >= %(today)s)
		  AND plan_status NOT IN ('Cancelled', 'Completed')
	""", {"today": today}, as_dict=True)

	if not planned_teams:
		return

	submitted_teams = set(frappe.db.get_all(
		"Daily Work Update",
		filters={"update_date": today, "status": ("!=", "Draft")},
		pluck="team",
	))

	for row in planned_teams:
		team = row.team
		if not team or team in submitted_teams:
			continue
		tl_user = _tl_user_from_team(team)
		im_user = _im_user_from_team(team)
		_make_notification(
			tl_user,
			f"[ALERT] Submit today's work update — team {team}",
			"INET Team", team,
			link="/pms/today",
		)
		_make_notification(
			im_user,
			f"[ALERT] Team {team} missing today's work update",
			"INET Team", team,
			link="/pms/im-execution",
		)


def send_dummy_po_reminder():
	"""Run at 08:00 daily — notify each IM about unmapped dummy PO dispatches."""
	rows = frappe.db.sql("""
		SELECT im, COUNT(*) AS cnt
		FROM `tabPO Dispatch`
		WHERE is_dummy_po = 1
		  AND (was_dummy_po = 0 OR was_dummy_po IS NULL)
		  AND dispatch_status NOT IN ('Cancelled', 'Closed')
		GROUP BY im
	""", as_dict=True)

	for row in rows:
		if not row.im:
			continue
		im_user = frappe.db.get_value("IM Master", row.im, "user")
		_make_notification(
			im_user,
			f"[ALERT] {row.cnt} dummy PO(s) need real PO mapping",
			None, None,
			link="/pms/im-dashboard",
		)
