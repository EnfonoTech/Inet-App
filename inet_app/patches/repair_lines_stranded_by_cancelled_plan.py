"""
Not a migration patch — do NOT add this to patches.txt. Run it yourself,
once per site, dry run first:

    bench --site <site> execute "inet_app.patches.repair_lines_stranded_by_cancelled_plan.execute"
    bench --site <site> execute "inet_app.patches.repair_lines_stranded_by_cancelled_plan.execute" --kwargs "{'dry_run': 0}"

The lines this repairs
----------------------
`PO Dispatch.dispatch_status` reads "Planned" while every Rollout Plan on
the line is Cancelled and no Work Done exists. The line is then invisible:
To Plan skips it because it believes a plan is already running, and the
Execution Monitor shows only a cancelled plan. Reported by the client as
"this line does not show anywhere for planning".

How they got there: a cancelled Daily Execution used to drive its plan to
Cancelled through `_sync_rollout_plan_from_daily_execution`, and that route
— unlike `pm_decide_cancel_plan` — never told the line. The rule has been
fixed (a cancelled execution now sends the plan back to Planned), so this
script is for the lines already stranded, not for new ones.

What it does, per line
----------------------
  dispatch_status  "Planned" -> "Dispatched"   (a fresh plan can be made)
  resync_dispatch_contract      — drop the cancelled team's subcontractor
  resync_dispatch_allocations   — and its allocation rows

The two resyncs are not optional. `pm_decide_cancel_plan` runs both for the
same reason, recorded there: leaving a cancelled team's subcontractor on the
line "is what put wrong names on the reports".

`set_dispatch_status` writes a PO Status Event and `resync_dispatch_contract`
writes one too, so those two are auditable afterwards.
`resync_dispatch_allocations` writes nothing, so this script counts the
allocation rows per line before and after and reports the difference — the
run leaves a record instead of leaving you to diff a restored backup.

The already-cancelled PLANS are deliberately left alone. Reviving 213 of
them would drop that backlog on the IMs in one morning, and the work is
re-planned from the line, not from the corpse of the old plan.

Guards
------
  * at least one Rollout Plan exists — a line that was never planned is a
    different problem and not this script's business
  * NO plan on the line is anything other than Cancelled. One live plan and
    the line is legitimately "Planned"; flipping it would offer the line for
    planning while a team is still on site
  * no Work Done — a line with a Work Done is past planning
  * dummy POs skipped

Safe to re-run: a repaired line reads "Dispatched" and no longer matches.
"""
import frappe


# Every plan on the line is Cancelled, nothing was ever delivered, and the
# line still claims to be under a plan.
_STRANDED_SQL = """
    SELECT pd.name, pd.poid, pd.line_amount, pd.im,
           (SELECT COUNT(*) FROM `tabRollout Plan` rp3
             WHERE rp3.po_dispatch = pd.name) AS plans
      FROM `tabPO Dispatch` pd
     WHERE pd.dispatch_status = 'Planned'
       AND IFNULL(pd.is_dummy_po, 0) = 0
       AND EXISTS (SELECT 1 FROM `tabRollout Plan` rp
                    WHERE rp.po_dispatch = pd.name)
       AND NOT EXISTS (SELECT 1 FROM `tabRollout Plan` rp2
                        WHERE rp2.po_dispatch = pd.name
                          AND IFNULL(rp2.plan_status, '') <> 'Cancelled')
       AND NOT EXISTS (SELECT 1 FROM `tabWork Done` wd
                        WHERE wd.system_id = pd.name)
     ORDER BY pd.poid
"""


def _alloc_count(po_dispatch):
    if not frappe.db.exists("DocType", "PO Subcontract Allocation"):
        return 0
    return frappe.db.count("PO Subcontract Allocation",
                           {"parent": po_dispatch, "parenttype": "PO Dispatch"})


def execute(dry_run=1):
    from inet_app.api.status_log import set_dispatch_status
    from inet_app.api.subcontractor_sync import (resync_dispatch_allocations,
                                                 resync_dispatch_contract)

    dry_run = int(dry_run)
    rows = frappe.db.sql(_STRANDED_SQL, as_dict=True)
    if not rows:
        print("  nothing stranded — no line is at 'Planned' with every plan cancelled")
        return

    fixed = failed = 0
    total = 0.0
    contracts_cleared = allocs_removed = 0
    for r in rows:
        total += float(r.line_amount or 0)
        # Snapshotted per line, because resync_dispatch_allocations writes no
        # audit trail of its own. Without this the only way to know whether a
        # row was dropped is to diff a restored backup.
        before_contract = frappe.db.get_value("PO Dispatch", r.name, "contract") or ""
        before_allocs = _alloc_count(r.name)
        note = "  contract %s, %d allocation row(s)" % (
            before_contract or "(none)", before_allocs)
        print("  %-26s %-10s %10.2f  %d cancelled plan(s)%s"
              % (r.poid, r.im or "(no IM)", float(r.line_amount or 0), r.plans, note))
        if dry_run:
            fixed += 1
            if before_contract:
                contracts_cleared += 1
            allocs_removed += before_allocs
            continue
        try:
            set_dispatch_status(r.name, "Dispatched",
                                remark="plan cancelled; line released for re-planning")
            # Same pair pm_decide_cancel_plan runs, and for the same reason.
            resync_dispatch_contract(r.name, reason="plan cancelled")
            resync_dispatch_allocations(r.name, reason="plan cancelled")
            frappe.db.commit()
            after_contract = frappe.db.get_value("PO Dispatch", r.name, "contract") or ""
            after_allocs = _alloc_count(r.name)
            if before_contract and not after_contract:
                contracts_cleared += 1
                print("     contract cleared: %s" % before_contract)
            if after_allocs != before_allocs:
                allocs_removed += (before_allocs - after_allocs)
                print("     allocation rows %d -> %d" % (before_allocs, after_allocs))
            fixed += 1
        except Exception as exc:
            frappe.db.rollback()
            failed += 1
            print("     REFUSED: %s" % str(exc)[:160])

    print("repair_lines_stranded_by_cancelled_plan (%s): %d line(s), SAR %s%s"
          % ("DRY RUN" if dry_run else "APPLIED", fixed, f"{total:,.2f}",
             ", %d refused" % failed if failed else ""))
    print("  dispatch_status Planned -> Dispatched : %d" % fixed)
    print("  contract snapshot cleared             : %d" % contracts_cleared)
    print("  allocation rows removed               : %d" % allocs_removed)
    # A plain list to copy out: the dry run is the only chance to review
    # these before anything moves, and reading them back out of the table
    # above means picking POIDs out of five other columns.
    print("  POIDs %s:" % ("that WOULD change" if dry_run else "changed"))
    for r in rows:
        print("    %s" % r.poid)
    if dry_run:
        print("  Nothing was written. Re-run with dry_run=0 to apply.")
