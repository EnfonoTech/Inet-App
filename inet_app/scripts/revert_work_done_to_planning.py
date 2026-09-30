"""Pull a PO line back out of Work Done and return it to Rollout Planning.

There is no such route in the app, on purpose: Work Done is the end of the
rollout track, and ``reschedule_rollout_plan`` refuses outright once a Work
Done exists. When a line reaches it by mistake the only way back is to undo
the chain, and doing that by hand across four doctypes is how a line ends up
half-reverted — closed on one screen and open on another.

Rollout Planning lists ``dispatch_status = 'Dispatched'`` (RolloutPlanning.jsx),
so that is the target state. Reaching it means undoing, in order:

    Work Done  →  Daily Execution  →  Rollout Plan  →  PO Dispatch

Two modes, because "this was a mistake" has two meanings:

``cancel`` (default)
    Delete the Work Done, cancel the executions and the plan, put the line
    back to Dispatched. What happened stays on the record, and the next plan
    is visit 2. A cancelled plan is invisible to ``_require_no_rollout_track``
    and to the planning gate, so the line is fully plannable again.

``purge``
    Also delete the executions and the plan, so the line looks untouched and
    the next plan is visit 1 again. Use only when the plan itself should
    never have existed.

Run it:

    bench --site <site> execute inet_app.scripts.revert_work_done_to_planning.execute \
        --kwargs "{'poids': '<POID>,<POID>'}"                       # dry run
    bench --site <site> execute inet_app.scripts.revert_work_done_to_planning.execute \
        --kwargs "{'poids': '<POID>,<POID>', 'dry_run': 0}"

A Work Done cannot be un-deleted, so every one removed is written out as JSON
first; the path is printed. Lines that are invoiced, that have moved past PIC,
or that carry a closed milestone or a partial-closure ledger are refused
rather than reverted — those carry money and need a decision, not a script.
"""

import json
import os

import frappe
from frappe.utils import cstr, flt, now_datetime

from inet_app.scripts import bench_safe

# pic_status values that mean the line is blank / bounced back, and so is safe
# to unwind. Everything else means PIC has taken it somewhere. Blank is a real
# value here — it renders as "Work Not Done" (see pic.py), and is what a PIC
# rejection leaves behind.
_PIC_SAFE = ("", "Work Not Done", "PO Line Canceled")


def _resolve(poids):
	if isinstance(poids, str):
		try:
			parsed = frappe.parse_json(poids)
			poids = parsed if isinstance(parsed, (list, tuple)) else poids.split(",")
		except Exception:
			poids = poids.split(",")
	return [cstr(p).strip() for p in (poids or []) if cstr(p).strip()]


def _blockers(pd, wds):
	"""Reasons this line must not be reverted by a script. Worst first."""
	out = []
	if flt(pd.get("ms1_invoiced")) or flt(pd.get("ms2_invoiced")):
		out.append(f"already invoiced (MS1 {flt(pd.get('ms1_invoiced')):,.2f}, "
				   f"MS2 {flt(pd.get('ms2_invoiced')):,.2f})")
	for f, label in (("pic_status", "MS1"), ("pic_status_ms2", "MS2")):
		v = cstr(pd.get(f) or "").strip()
		if v not in _PIC_SAFE:
			out.append(f"{label} is with PIC ({v!r})")
	for w in wds:
		if w.get("ms1_closed") or w.get("ms2_closed"):
			out.append(f"{w['name']} has a closed milestone")
		if frappe.db.exists("Work Done Closure", {"parent": w["name"]}):
			out.append(f"{w['name']} has a partial-closure ledger")
	if frappe.db.has_column("Sales Invoice Item", "poid"):
		si = frappe.db.sql(
			"""SELECT sii.parent FROM `tabSales Invoice Item` sii
			   JOIN `tabSales Invoice` si ON si.name = sii.parent
			   WHERE sii.poid = %s AND si.docstatus < 2 LIMIT 1""",
			(pd["poid"],),
		)
		if si:
			out.append(f"a Sales Invoice exists ({si[0][0]})")
	return out


@bench_safe
def execute(poids=None, dry_run=1, mode="cancel", out_dir=None):
	dry_run = int(dry_run or 0)
	if mode not in ("cancel", "purge"):
		frappe.throw("mode must be 'cancel' or 'purge'")
	poids = _resolve(poids)
	if not poids:
		frappe.throw("poids is required, e.g. --kwargs \"{'poids': 'A,B,C'}\"")

	plan_ok, refused, missing = [], [], []
	for poid in poids:
		pd = frappe.db.get_value(
			"PO Dispatch", {"poid": poid},
			["name", "poid", "dispatch_status", "pic_status", "pic_status_ms2",
			 "ms1_invoiced", "ms2_invoiced", "po_intake", "po_line_no", "contract"],
			as_dict=True,
		)
		if not pd:
			missing.append((poid, "POID not found"))
			continue
		wds = frappe.db.sql(
			"SELECT name, execution, ms1_closed, ms2_closed, revenue_sar, executed_qty "
			"FROM `tabWork Done` WHERE system_id = %s", (pd["name"],), as_dict=True,
		) or []
		if not wds:
			missing.append((poid, "no Work Done on this line — nothing to revert"))
			continue
		bad = _blockers(pd, wds)
		if bad:
			refused.append((poid, bad))
			continue
		plans = frappe.db.sql(
			"SELECT name, visit_number, plan_status FROM `tabRollout Plan` "
			"WHERE po_dispatch = %s ORDER BY IFNULL(visit_number, 0)",
			(pd["name"],), as_dict=True,
		) or []
		execs = frappe.db.sql(
			"""SELECT de.name, de.execution_status FROM `tabDaily Execution` de
			   JOIN `tabRollout Plan` rp ON rp.name = de.rollout_plan
			   WHERE rp.po_dispatch = %s""", (pd["name"],), as_dict=True,
		) or []
		plan_ok.append({"pd": pd, "wds": wds, "plans": plans, "execs": execs})

	verb = "would revert" if dry_run else "reverting"
	print(f"\n{'DRY RUN — nothing written' if dry_run else 'APPLYING'}   mode={mode}")
	print(f"  {len(poids):>4} POIDs asked for")
	print(f"  {len(plan_ok):>4} {verb}")
	print(f"  {len(refused):>4} refused")
	print(f"  {len(missing):>4} not applicable")
	for poid, why in missing:
		print(f"       - {poid}: {why}")
	for poid, bad in refused:
		print(f"       ! {poid}: {'; '.join(bad)}")
	for p in plan_ok:
		pd = p["pd"]
		print(f"    {pd['poid']:<24} {pd['dispatch_status']} -> Dispatched   "
			  f"WD {[w['name'] for w in p['wds']]}  "
			  f"exec {len(p['execs'])}  plan {[x['name'] for x in p['plans']]}")

	if dry_run or not plan_ok:
		if dry_run:
			print("\n  re-run with 'dry_run': 0 to apply.\n")
		return {"reverted": 0, "planned": len(plan_ok),
				"refused": len(refused), "missing": len(missing)}

	out_dir = out_dir or frappe.get_site_path("private", "files")
	os.makedirs(out_dir, exist_ok=True)
	dump_path = os.path.join(
		out_dir, f"work-done-reverted-{now_datetime().strftime('%Y%m%d-%H%M%S')}.json")
	dump = []

	from inet_app.api.command_center import _reset_linked_intake_line_status
	from inet_app.api.status_log import set_dispatch_status
	from inet_app.api.subcontractor_sync import resync_dispatch_contract

	for p in plan_ok:
		pd, name = p["pd"], p["pd"]["name"]
		for w in p["wds"]:
			dump.append(frappe.get_doc("Work Done", w["name"]).as_dict())
			frappe.delete_doc("Work Done", w["name"],
							  force=True, ignore_permissions=True, delete_permanently=True)
		for de in p["execs"]:
			if mode == "purge":
				dump.append(frappe.get_doc("Daily Execution", de["name"]).as_dict())
				frappe.delete_doc("Daily Execution", de["name"],
								  force=True, ignore_permissions=True, delete_permanently=True)
			else:
				frappe.db.set_value("Daily Execution", de["name"],
									"execution_status", "Cancelled", update_modified=True)
		for pl in p["plans"]:
			if mode == "purge":
				dump.append(frappe.get_doc("Rollout Plan", pl["name"]).as_dict())
				frappe.delete_doc("Rollout Plan", pl["name"],
								  force=True, ignore_permissions=True, delete_permanently=True)
			elif pl["plan_status"] != "Cancelled":
				# The doctype blocks a direct write to Cancelled outside the
				# request → PM-approve flow; this is the admin correction it
				# names as the exception. RolloutPlan.validate reads the global
				# frappe.flags, not doc.flags, so the flag goes there and is
				# cleared again straight away — leaving it set would silently
				# disarm the guard for the rest of the process.
				prev_flag = frappe.flags.get("allow_status_override")
				frappe.flags.allow_status_override = True
				try:
					doc = frappe.get_doc("Rollout Plan", pl["name"])
					doc.plan_status = "Cancelled"
					doc.save(ignore_permissions=True)
				finally:
					frappe.flags.allow_status_override = prev_flag
		set_dispatch_status(name, "Dispatched",
							remark=f"reverted from Work Done to planning ({mode})")
		_reset_linked_intake_line_status(name, "Dispatched")
		# No live visit remains, so the line's subcontractor is no longer
		# derivable — resync clears it rather than leaving the wrong name on
		# an unplanned line.
		resync_dispatch_contract(name, reason="reverted from Work Done to planning")

	with open(dump_path, "w") as f:
		json.dump(dump, f, indent=1, default=str)
	frappe.db.commit()
	print(f"\n  deleted documents dumped to: {dump_path}")
	print(f"  reverted {len(plan_ok)} POIDs to Dispatched.\n")
	return {"reverted": len(plan_ok), "refused": len(refused),
			"missing": len(missing), "dump": dump_path}
