"""
Stamp an IM on a line that has been WORKED but carries none.

Why it matters
--------------
Every per-IM figure is scoped by `PO Dispatch.im`. A line with an execution
but no IM belongs to nobody, so its team-day cost cannot be charged to anyone
— the IM Performance report reports it as `unattributed` rather than guessing
or dropping it, which is honest but is not an answer. Two lines, SAR 105 of a
single Team-03 day, on the production copy.

Only lines with an execution are touched. 10,660 PO Dispatch rows have no IM
and no work; those are undispatched lines, which is a normal state and not
this patch's business.

Where the answer comes from, in order
-------------------------------------
  1. `Rollout Plan.im`      — the IM stamped when the line was planned
  2. `Daily Execution.im`   — the IM stamped when it was executed
  3. `Project Control Center.implementation_manager` — the project's own IM

The first two are the historical stamps the rest of the app scopes on
(CLAUDE.md: IM scoping reads the `im` stamped on the record, never a master's
current value). The third is a fallback and genuinely weaker — it is the
project's IM *today*, not necessarily who ran the line — so it is used only
when the first two are empty, and the run prints which source each line took
so a wrong one can be spotted and corrected by hand.

On the production copy both lines fell to the project fallback, since their
plan and execution carry no IM either.

Safe to re-run: a line with an IM no longer matches. Registered in
patches.txt. To look first:

    bench --site <site> execute \
      "inet_app.patches.backfill_missing_im_on_worked_lines.execute" \
      --kwargs "{'dry_run': 1}"
"""
import frappe

_SQL = """
    SELECT pd.name, pd.poid, pd.dispatch_status, pd.line_amount,
           (SELECT MAX(NULLIF(IFNULL(rp.im, ''), ''))
              FROM `tabRollout Plan` rp WHERE rp.po_dispatch = pd.name) AS plan_im,
           (SELECT MAX(NULLIF(IFNULL(de2.im, ''), ''))
              FROM `tabDaily Execution` de2 WHERE de2.system_id = pd.name) AS exec_im,
           (SELECT MAX(NULLIF(IFNULL(pcc.implementation_manager, ''), ''))
              FROM `tabProject Control Center` pcc
             WHERE pcc.name = pd.project_code) AS project_im
      FROM `tabPO Dispatch` pd
     WHERE IFNULL(pd.im, '') = ''
       AND EXISTS (SELECT 1 FROM `tabDaily Execution` de WHERE de.system_id = pd.name)
     ORDER BY pd.poid
"""


def execute(dry_run=0):
    dry_run = int(dry_run)
    rows = frappe.db.sql(_SQL, as_dict=True)
    if not rows:
        print("backfill_missing_im_on_worked_lines: nothing to stamp")
        return

    fixed = 0
    unresolved = []
    by_source = {}
    for r in rows:
        im, source = None, None
        for candidate, label in ((r.plan_im, "Rollout Plan"),
                                 (r.exec_im, "Daily Execution"),
                                 (r.project_im, "project (fallback)")):
            if candidate and frappe.db.exists("IM Master", candidate):
                im, source = candidate, label
                break
        if not im:
            unresolved.append(r)
            print("  %-26s %-18s NO SOURCE — left alone" % (r.poid, r.dispatch_status))
            continue
        print("  %-26s %-18s -> %-16s from %s"
              % (r.poid, r.dispatch_status, im, source))
        by_source[source] = by_source.get(source, 0) + 1
        fixed += 1
        if not dry_run:
            # update_modified stays False: this fills in a missing stamp, it
            # is not someone editing the line.
            frappe.db.set_value("PO Dispatch", r.name, "im", im, update_modified=False)

    if not dry_run:
        frappe.db.commit()

    print("backfill_missing_im_on_worked_lines (%s): %d of %d stamped"
          % ("DRY RUN" if dry_run else "APPLIED", fixed, len(rows)))
    for src, n in sorted(by_source.items()):
        print("  from %-20s %d" % (src, n))
    if unresolved:
        print("  %d line(s) had no source at all and need an IM set by hand:"
              % len(unresolved))
        for r in unresolved:
            print("    %s" % r.poid)
    if dry_run:
        print("  Nothing was written.")
