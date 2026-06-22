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
	if not name:
		return
	owner = frappe.db.sql(
		"SELECT for_user FROM `tabNotification Log` WHERE name=%s LIMIT 1", name
	)
	if owner and owner[0][0] == user:
		frappe.db.sql(
			"UPDATE `tabNotification Log` SET `read`=1 WHERE name=%s AND for_user=%s",
			(name, user),
		)


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


def notify_pic_work_done_submitted(work_done_name):
	"""Called directly from command_center.update_work_done_submission() when IM
	sets Confirmation Done. db.set_value() does not fire Frappe doc hooks."""
	po = _po_from_work_done(work_done_name)
	label = _po_label(po) or work_done_name
	subject = f"[ALERT] Work Done confirmed by IM — {label}"
	for user in _users_by_role("INET PIC"):
		_make_notification(
			user,
			subject,
			"Work Done", work_done_name,
			link="/pms/pic-tracker",
		)


def notify_im_pic_rejected(po_dispatch_name):
	"""Called directly from pic.reject_pic_line(). Notifies the IM that owns
	the PO Dispatch so they can resubmit or rectify the Work Done."""
	if not po_dispatch_name:
		return
	pd = frappe.db.get_value(
		"PO Dispatch", po_dispatch_name, ["im", "poid", "site_code"], as_dict=True
	)
	if not pd:
		return
	im_user = frappe.db.get_value("IM Master", pd.im, "user") if pd.im else None
	parts = []
	if pd.poid:
		parts.append(f"POID {pd.poid}")
	if pd.site_code:
		parts.append(f"DUID {pd.site_code}")
	label = " · ".join(parts) or po_dispatch_name
	_make_notification(
		im_user,
		f"[CRITICAL] Work Done rejected by PIC — {label}",
		"PO Dispatch", po_dispatch_name,
		link="/pms/im-work-done",
	)


# ---------------------------------------------------------------------------
# Planning workflow — Rollout Plan
# ---------------------------------------------------------------------------

def on_rollout_plan_insert(doc, method=None):
	# Teams are synced AFTER insert via _sync_plan_teams() in command_center.
	# Notification is sent explicitly from there via notify_plan_assigned_to_tls().
	pass


def notify_plan_assigned_to_tls(rollout_plan_name, team_ids, po_dispatch_name=None):
	"""Send 'Plan assigned' notification to TL of each team. Called after teams are synced."""
	po = _po_info(po_dispatch_name) if po_dispatch_name else {}
	label = _po_label(po) or rollout_plan_name
	notified = set()
	for team_id in (team_ids or []):
		if not team_id:
			continue
		tl_user = _tl_user_from_team(team_id)
		if tl_user and tl_user not in notified:
			notified.add(tl_user)
			_make_notification(
				tl_user,
				f"[INFO] Plan assigned — {label}",
				"Rollout Plan", rollout_plan_name,
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
# Team Allocation Request — IM-to-IM transfer with PM approval
# Direct injection (db.set_value never fires hooks)
# ---------------------------------------------------------------------------

def _im_label(im_master_name):
	"""Return a human-readable display name for an IM Master."""
	if not im_master_name:
		return im_master_name or ""
	return frappe.db.get_value("IM Master", im_master_name, "full_name") or im_master_name


def notify_source_im_allocation_requested(request_name):
	"""Notify source (from) IM when another IM requests their team."""
	req = frappe.db.get_value(
		"Team Allocation Request", request_name,
		["from_im", "to_im", "team"], as_dict=True,
	)
	if not req:
		return
	from_user = frappe.db.get_value("IM Master", req.from_im, "user") if req.from_im else None
	to_label = _im_label(req.to_im)
	_make_notification(
		from_user,
		f"[ALERT] Team transfer request — team {req.team} requested by {to_label}",
		"Team Allocation Request", request_name,
		link="/pms/im-teams",
	)


def notify_pm_allocation_pending(request_name):
	"""Notify all PM when source IM accepts → Pending PM Approval."""
	req = frappe.db.get_value(
		"Team Allocation Request", request_name,
		["from_im", "to_im", "team"], as_dict=True,
	)
	if not req:
		return
	from_label = _im_label(req.from_im)
	to_label = _im_label(req.to_im)
	subject = f"[ALERT] Team transfer awaiting approval — team {req.team} from {from_label} to {to_label}"
	for user in _users_by_role("INET Admin"):
		_make_notification(user, subject, "Team Allocation Request", request_name, link="/pms/approvals")


def notify_to_im_allocation_source_rejected(request_name):
	"""Notify requesting (to) IM when source IM rejects the transfer."""
	req = frappe.db.get_value(
		"Team Allocation Request", request_name,
		["from_im", "to_im", "team"], as_dict=True,
	)
	if not req:
		return
	to_user = frappe.db.get_value("IM Master", req.to_im, "user") if req.to_im else None
	from_label = _im_label(req.from_im)
	_make_notification(
		to_user,
		f"[CRITICAL] Team transfer rejected by {from_label} — team {req.team}",
		"Team Allocation Request", request_name,
		link="/pms/im-teams",
	)


def notify_ims_allocation_pm_decided(request_name, action):
	"""Notify both IMs when PM approves; only requesting IM when PM rejects."""
	req = frappe.db.get_value(
		"Team Allocation Request", request_name,
		["from_im", "to_im", "team"], as_dict=True,
	)
	if not req:
		return
	to_user = frappe.db.get_value("IM Master", req.to_im, "user") if req.to_im else None
	from_user = frappe.db.get_value("IM Master", req.from_im, "user") if req.from_im else None
	if action == "approve":
		_make_notification(
			to_user,
			f"[INFO] Team transfer approved — team {req.team} is now yours",
			"Team Allocation Request", request_name,
			link="/pms/im-teams",
		)
		_make_notification(
			from_user,
			f"[INFO] Team transfer approved — team {req.team} moved to {_im_label(req.to_im)}",
			"Team Allocation Request", request_name,
			link="/pms/im-teams",
		)
	else:
		_make_notification(
			to_user,
			f"[CRITICAL] Team transfer rejected by PM — team {req.team}",
			"Team Allocation Request", request_name,
			link="/pms/im-teams",
		)


# ---------------------------------------------------------------------------
# Rollout Plan Cancel Request — IM requests PM approval to cancel
# Direct injection (db.set_value never fires hooks; on_rollout_plan_update
# hook exists but is unreachable via the API functions)
# ---------------------------------------------------------------------------

def notify_pm_cancel_plan_requested(rollout_plan_name):
	"""Notify all PM when IM requests cancellation of a Rollout Plan."""
	po = _po_from_rollout_plan(rollout_plan_name)
	label = _po_label(po) or rollout_plan_name
	subject = f"[ALERT] Plan cancel requested — {label}"
	for user in _users_by_role("INET Admin"):
		_make_notification(user, subject, "Rollout Plan", rollout_plan_name, link="/pms/approvals")


def notify_im_cancel_plan_decided(rollout_plan_name, action):
	"""Notify requesting IM when PM approves or rejects the cancel request."""
	plan = frappe.db.get_value(
		"Rollout Plan", rollout_plan_name,
		["cancel_requested_by", "po_dispatch"], as_dict=True,
	)
	if not plan or not plan.cancel_requested_by:
		return
	po = _po_info(plan.po_dispatch) if plan.po_dispatch else {}
	label = _po_label(po) or rollout_plan_name
	if action == "approve":
		subject = f"[INFO] Plan cancel approved — {label}"
	else:
		subject = f"[CRITICAL] Plan cancel rejected by PM — {label}"
	_make_notification(
		plan.cancel_requested_by, subject,
		"Rollout Plan", rollout_plan_name,
		link="/pms/im-planning",
	)


# ---------------------------------------------------------------------------
# Scheduled tasks
# ---------------------------------------------------------------------------

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
