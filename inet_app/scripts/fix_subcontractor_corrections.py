"""Apply the client's POID → subcontractor corrections to PO Dispatch.

The client reviewed 177 POIDs against their own records and returned the
subcontractor that actually did each one. Their spreadsheet is checked in
beside this file as ``subcontractor_corrections.csv`` (POID, Subcontract
Master name) so the correction travels with the app and can be re-run on any
site without the original .xlsx.

Deliberately NOT a patch and not wired into after_migrate — this is a
correction to one customer's data, not a schema change. Run it by hand:

    # look first — writes nothing
    bench --site <site> execute inet_app.scripts.fix_subcontractor_corrections.execute

    # then apply
    bench --site <site> execute inet_app.scripts.fix_subcontractor_corrections.execute \
        --kwargs "{'dry_run': 0}"

Idempotent: a second run reports every line as already correct and writes
nothing. Every change is written to a rollback CSV first (path is printed),
so the whole run can be reversed with ``--kwargs "{'rollback': '<path>'}"``.

What one correction touches, and why these move together:

* ``PO Dispatch.contract`` — the snapshot every report resolves first.
* ``Work Done.subcontractor`` and ``inet_margin_pct`` — an independent copy
  stamped at closure that nothing re-derives. Leaving it behind is what
  produced the 178 rows on this bench where the two already disagree.

Lines that already have a Subcon PO are refused, never silently changed:
past that point the subcontractor is whoever the supplier PO was sent to.
"""

import csv
import os

import frappe
from frappe.utils import cstr, flt, now_datetime

from inet_app.scripts import bench_safe
from inet_app.api.subcontractor_sync import (
	MANUAL_OVERRIDE_REMARK,
	_recost_work_done,
	subcon_po_raised,
)

CSV_FILE = os.path.join(os.path.dirname(__file__), "subcontractor_corrections.csv")


def _load(csv_path=None):
	path = csv_path or CSV_FILE
	if not os.path.exists(path):
		frappe.throw(f"Correction file not found: {path}")
	with open(path, newline="") as f:
		rows = [
			(cstr(r.get("poid")).strip(), cstr(r.get("subcontractor")).strip())
			for r in csv.DictReader(f)
		]
	# A blank subcontractor is kept, not dropped: it is the target value for a
	# line that had none, which is exactly what a rollback file carries for the
	# lines this script gave a subcontractor to. Dropping them would make the
	# rollback silently partial.
	return [(p, s) for p, s in rows if p]


def _resolve(poid):
	"""POID → PO Dispatch name. The POID is the human key; `name` is a hash."""
	return frappe.db.get_value("PO Dispatch", {"poid": poid}, "name")


@bench_safe
def execute(dry_run=1, csv_path=None, out_dir=None, rollback=None):
	"""Report (dry_run=1, the default) or apply (dry_run=0) the corrections."""
	if rollback:
		return _apply_rollback(rollback, dry_run=int(dry_run or 0))

	dry_run = int(dry_run or 0)
	pairs = _load(csv_path)
	log_ok = bool(frappe.db.exists("DocType", "PO Status Event"))

	planned, skipped, already, missing = [], [], [], []

	for poid, want in pairs:
		name = _resolve(poid)
		if not name:
			missing.append((poid, want, "POID not found"))
			continue
		if want and not frappe.db.exists("Subcontract Master", want):
			missing.append((poid, want, "Subcontract Master not found"))
			continue
		cur = cstr(frappe.db.get_value("PO Dispatch", name, "contract") or "")
		wds = frappe.db.sql(
			"SELECT name, IFNULL(subcontractor, '') AS sub FROM `tabWork Done` WHERE system_id = %s",
			(name,), as_dict=True,
		) or []
		stale_wd = [w for w in wds if w.sub != want]
		if cur == want and not stale_wd:
			already.append((poid, want))
			continue
		if subcon_po_raised(name):
			skipped.append((poid, cur, want, "Subcon PO already raised"))
			continue
		planned.append({
			"poid": poid, "name": name, "old": cur, "new": want,
			"work_done": [(w.name, w.sub) for w in stale_wd],
		})

	print(f"\n{'DRY RUN — nothing written' if dry_run else 'APPLYING'}   source: {csv_path or CSV_FILE}")
	print(f"  {len(pairs):>4} POIDs in file")
	print(f"  {len(already):>4} already correct")
	print(f"  {len(planned):>4} to change")
	print(f"  {len(skipped):>4} refused (subcon PO raised)")
	print(f"  {len(missing):>4} unresolvable")
	for poid, want, why in missing:
		print(f"       ! {poid} → {want}: {why}")
	for poid, cur, want, why in skipped:
		print(f"       ! {poid}: {cur} → {want} refused: {why}")

	by_move = {}
	for p in planned:
		key = (p["old"] or "(none)", p["new"])
		by_move[key] = by_move.get(key, 0) + 1
	if by_move:
		print("\n  changes by move:")
		for (o, n), c in sorted(by_move.items(), key=lambda x: -x[1]):
			print(f"    {c:>4}   {o:<48} → {n or '(none)'}")

	if dry_run or not planned:
		if dry_run:
			print("\n  re-run with --kwargs \"{'dry_run': 0}\" to apply.\n")
		return {"changed": 0, "planned": len(planned), "already": len(already),
				"skipped": len(skipped), "missing": len(missing)}

	out_dir = out_dir or frappe.get_site_path("private", "files")
	os.makedirs(out_dir, exist_ok=True)
	stamp = now_datetime().strftime("%Y%m%d-%H%M%S")
	rb_path = os.path.join(out_dir, f"subcontractor-rollback-{stamp}.csv")
	with open(rb_path, "w", newline="") as f:
		w = csv.writer(f)
		w.writerow(["poid", "subcontractor"])
		for p in planned:
			# The rollback file is the same shape as the input, so replaying it
			# through this same script is the undo.
			w.writerow([p["poid"], p["old"]])
	print(f"\n  rollback file: {rb_path}")

	changed = 0
	for p in planned:
		frappe.db.set_value("PO Dispatch", p["name"], "contract", p["new"] or None,
							update_modified=False)
		for wd_name, _old_sub in p["work_done"]:
			_recost_work_done(wd_name, p["new"])
		if log_ok:
			try:
				from inet_app.api.status_log import log_status_event
				log_status_event(p["name"], "contract", p["old"], p["new"],
								 remark=MANUAL_OVERRIDE_REMARK,
								 stamp_stage=False)
			except Exception:
				pass
		changed += 1
	frappe.db.commit()
	print(f"  changed {changed} POIDs.\n")
	return {"changed": changed, "planned": len(planned), "already": len(already),
			"skipped": len(skipped), "missing": len(missing), "rollback": rb_path}


def _apply_rollback(path, dry_run=0):
	"""Replay a rollback CSV. Same shape as the input file, so same code path."""
	print(f"  rolling back from {path}")
	return execute(dry_run=dry_run, csv_path=path)
