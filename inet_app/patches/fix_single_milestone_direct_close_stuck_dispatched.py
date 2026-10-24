"""
One-time repair: a single-milestone line closed by Direct Close was left at
`dispatch_status = 'Dispatched'` forever.

The bug
-------
`_direct_close_one`'s milestone path only advanced the line to Completed when
BOTH milestone flags were set:

    both_closed = ms1_closed AND ms2_closed

A single-milestone line carries `ms2_amount = 0` and has no MS2 to close, so
that AND could never become true. The line kept whatever dispatch_status it
arrived with — 'Dispatched' for a line handed to an IM and direct-closed
without ever being planned. 22 lines on the production copy, SAR 14,971,
closed on MS1 and already sitting with PIC.

Why it mattered: Rollout Planning's To Plan list is
`dispatch_status = 'Dispatched'`, and `create_rollout_plans` has no guard
against a line that already has a Work Done — so finished work was still being
offered for planning. The IM dashboard's "pending to plan" tile counts the same
raw status. The lines did escape eventually, but only from the other side, when
PIC reached Commercial Invoice Submitted/Closed and
`_compute_dispatch_status_from_pic` overwrote the status.

Fixed in `_direct_close_one` — `both_closed` now reads "nothing left to close",
treating `ms2_amount = 0` as no MS2. This patch repairs the lines closed before
that fix.

Scope
-----
Deliberately narrow — the shape this one bug produces, and nothing else:

  * dispatch_status is still literally 'Dispatched'
  * a Work Done exists with source 'Direct Close', ms1_closed = 1, ms2_closed = 0
  * ms2_amount <= 0, i.e. there is genuinely no MS2

**Lines that DO have an MS2 are left alone.** They are not finished — MS2 is
still open, real work and real money — so 'Dispatched' understates them but
'Completed' would overstate them. That is a separate decision, not this repair.

The new status is re-derived through `_compute_dispatch_status_from_pic` rather
than hardcoded to 'Completed', so a line PIC has already moved to Commercial
Invoice Submitted/Closed in the meantime lands on Submitted/Closed instead of
being dragged backwards.

Safe to re-run: a repaired line no longer reads 'Dispatched' and stops
matching. Registered in patches.txt, so `bench --site <site> migrate` applies
it. To look before it runs:

    bench --site <site> execute \
      "inet_app.patches.fix_single_milestone_direct_close_stuck_dispatched.execute" \
      --kwargs "{'dry_run': 1}"
"""
import frappe

_STUCK_SQL = """
    SELECT pd.name, pd.poid, pd.line_amount, pd.im, pd.po_intake, pd.po_line_no,
           pd.pic_status, pd.pic_status_ms2, pd.ms2_amount
      FROM `tabPO Dispatch` pd
     WHERE pd.dispatch_status = 'Dispatched'
       AND IFNULL(pd.ms2_amount, 0) <= 0
       AND IFNULL(pd.is_dummy_po, 0) = 0
       AND EXISTS (SELECT 1 FROM `tabWork Done` wd
                    WHERE wd.system_id = pd.name
                      AND IFNULL(wd.source, '') = 'Direct Close'
                      AND IFNULL(wd.ms1_closed, 0) = 1
                      AND IFNULL(wd.ms2_closed, 0) = 0)
     ORDER BY pd.poid
"""


def execute(dry_run=0):
    from inet_app.api.pic import _compute_dispatch_status_from_pic
    from inet_app.api.status_log import set_dispatch_status

    dry_run = int(dry_run)
    rows = frappe.db.sql(_STUCK_SQL, as_dict=True)
    if not rows:
        print("fix_single_milestone_direct_close_stuck_dispatched: nothing stuck")
        return

    fixed = 0
    total = 0.0
    breakdown = {}
    for r in rows:
        # 'Completed' is the baseline — what the close itself should have
        # written. Only PIC having already moved past it overrides that.
        new_status = _compute_dispatch_status_from_pic(
            r.pic_status, r.pic_status_ms2, r.ms2_amount, "Completed"
        ) or "Completed"
        total += float(r.line_amount or 0)
        breakdown[new_status] = breakdown.get(new_status, 0) + 1
        fixed += 1
        if dry_run:
            continue
        # Through set_dispatch_status so the transition reaches the event log
        # and stage_entered_at, exactly as the close path does.
        set_dispatch_status(
            r.name, new_status,
            remark="single-milestone direct close; line had no MS2 to close",
        )
        # The close path marks the intake line too — it was skipped for the
        # same reason the status was.
        if r.po_intake and r.po_line_no:
            intake_line = frappe.db.exists(
                "PO Intake Line", {"parent": r.po_intake, "po_line_no": r.po_line_no})
            if intake_line and isinstance(intake_line, str):
                frappe.db.set_value("PO Intake Line", intake_line,
                                    "po_line_status", "Completed")

    if not dry_run:
        frappe.db.commit()

    print("fix_single_milestone_direct_close_stuck_dispatched (%s): %d line(s), SAR %s"
          % ("DRY RUN" if dry_run else "APPLIED", fixed, f"{total:,.2f}"))
    for status, count in sorted(breakdown.items()):
        print("  Dispatched -> %-22s %d" % (status, count))
    print("  POIDs %s:" % ("that WOULD change" if dry_run else "changed"))
    for r in rows:
        print("    %s" % r.poid)
    if dry_run:
        print("  Nothing was written.")
