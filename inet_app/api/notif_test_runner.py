"""
Notification verification runner for inet_app.
Run with:  bench --site inet execute inet_app.api.notif_test_runner.run
"""
import frappe


def run():
	results = []

	# ---------------------------------------------------------------------------
	# Discover real users from existing data
	# ---------------------------------------------------------------------------
	teams = frappe.db.get_all(
		"INET Team", fields=["name", "im", "field_user"], limit=5
	)
	if not teams:
		print("❌ No INET Team records found — aborting")
		return

	team = None
	im_user = None
	tl_user = None
	for t in teams:
		tl_candidate = t.field_user
		im_candidate = frappe.db.get_value("IM Master", t.im, "user") if t.im else None
		if tl_candidate and im_candidate:
			team = t.name
			tl_user = tl_candidate
			im_user = im_candidate
			break

	if not team:
		print("❌ Could not resolve a team with both TL and IM users — aborting")
		return

	print(f"\nUsing team={team}  TL={tl_user}  IM={im_user}\n")

	# ---------------------------------------------------------------------------
	# Helper
	# ---------------------------------------------------------------------------
	def count_inet(user):
		return frappe.db.count(
			"Notification Log",
			filters={"for_user": user, "subject": ["like", "[%]%"]},
		)

	def check(label, user, before):
		after = count_inet(user)
		ok = after > before
		results.append(f"{'✅' if ok else '❌'} {label} → {user} (+{after - before} new)")

	# ---------------------------------------------------------------------------
	# TEST 1 — Daily Execution on_update: tl_status → Completed notifies IM
	# ---------------------------------------------------------------------------
	before_im = count_inet(im_user)

	# Need a minimal Daily Execution; find any existing rollout plan
	rp_name = frappe.db.get_value("Rollout Plan", {"plan_status": "Active"}, "name")
	if not rp_name:
		rp_name = frappe.db.get_value("Rollout Plan", {}, "name")

	de = frappe.get_doc({
		"doctype": "Daily Execution",
		"team": team,
		"rollout_plan": rp_name,
		"execution_date": frappe.utils.today(),
		"tl_status": "In Progress",
		"im": frappe.db.get_value("INET Team", team, "im"),
	})
	de.insert(ignore_permissions=True)
	frappe.db.commit()

	de.reload()
	de.tl_status = "Completed"
	de.save(ignore_permissions=True)
	frappe.db.commit()
	check("Daily Execution tl_status→Completed notifies IM", im_user, before_im)

	# ---------------------------------------------------------------------------
	# TEST 2 — notify_tl_work_done_confirmed: IM approves Work Done → TL notified
	# ---------------------------------------------------------------------------
	before_tl = count_inet(tl_user)

	# Create a minimal Work Done linked to our Daily Execution
	wd = frappe.get_doc({
		"doctype": "Work Done",
		"execution": de.name,
		"submission_status": "Ready for Confirmation",
	})
	wd.insert(ignore_permissions=True)
	frappe.db.commit()

	# Simulate IM confirmation (the path used in command_center)
	frappe.db.set_value("Work Done", wd.name, "submission_status", "Confirmation Done")
	from inet_app.api.notifications import notify_tl_work_done_confirmed
	notify_tl_work_done_confirmed(wd.name)
	frappe.db.commit()
	check("Work Done Confirmation Done notifies TL", tl_user, before_tl)

	# ---------------------------------------------------------------------------
	# TEST 3 — DWU on_update still works (status → Submitted notifies IM)
	# ---------------------------------------------------------------------------
	before_im2 = count_inet(im_user)
	dwu = frappe.get_doc({
		"doctype": "Daily Work Update",
		"team": team,
		"update_date": frappe.utils.today(),
		"status": "Draft",
		"approval_status": "Pending",
		"work_description": "NOTIF-TEST",
	})
	dwu.flags.ignore_mandatory = True
	dwu.insert(ignore_permissions=True)
	dwu.status = "Submitted"
	dwu.save(ignore_permissions=True)
	frappe.db.commit()
	check("DWU status→Submitted still notifies IM", im_user, before_im2)

	# ---------------------------------------------------------------------------
	# Cleanup
	# ---------------------------------------------------------------------------
	wd.delete(ignore_permissions=True)
	de.delete(ignore_permissions=True)
	dwu.delete(ignore_permissions=True)
	frappe.db.commit()

	# ---------------------------------------------------------------------------
	# Summary
	# ---------------------------------------------------------------------------
	print("=== NOTIFICATION TEST RESULTS ===")
	for r in results:
		print(r)

	print("\n=== RECENT INET NOTIFICATION LOGS ===")
	logs = frappe.db.get_all(
		"Notification Log",
		filters=[["subject", "like", "[%]%"]],
		fields=["for_user", "subject", "creation"],
		order_by="creation desc",
		limit=10,
	)
	for l in logs:
		print(f"  [{l.for_user}] {l.subject[:70]}")
