"""
Not a migration patch — do NOT add this to patches.txt. Run it yourself,
once, wherever the data needs repairing:

    bench --site <site> execute "inet_app.patches.repair_pending_with_execution_history.execute"

Follow-up to repair_archive_import_pending_regression.py, same root cause
(_run_po_archive_import used to regress an already-dispatched PO Dispatch
back to "Pending"). That script only fixed the unambiguous case — im set,
no Rollout Plan, no Work Done at all. This one covers the rows that DO
have real Plan/Work Done history, where the correct status depends on
that history rather than being a flat "Dispatched" for everyone:

  - Work Done exists with submission_status "Confirmation Done"
    -> Completed (matches work_done.py's own on_submit rule: a
       confirmed Work Done means the dispatch is Completed)
  - No Work Done, latest Rollout Plan status is "Overdue" or "Not Attended"
    -> Planned (a plan exists, wasn't executed in time)
  - No Work Done, latest Rollout Plan status is "Cancelled"
    -> Dispatched (the attempt was cancelled; needs a fresh plan)

Deliberately SKIPPED (left at Pending, reported separately, not fixed
here) — these need an explicit decision, not a mechanical rule:
  - Work Done status "Ready for Confirmation" (IM hasn't confirmed yet)
  - Work Done status "PIC Rejected"
  - Work Done exists with a blank/missing submission_status
  - Latest Rollout Plan status "Completed" but no Work Done record at all

Safe to re-run: only ever touches rows still at dispatch_status="Pending"
with im set, so anything already fixed (by this script or otherwise) no
longer matches and is left alone.
"""
import frappe


def execute():
    rows = frappe.db.sql(
        """
        SELECT pd.name, pd.poid,
               (SELECT wd.submission_status FROM `tabWork Done` wd
                WHERE wd.system_id = pd.name ORDER BY wd.creation DESC LIMIT 1) AS wd_status,
               (SELECT rp.plan_status FROM `tabRollout Plan` rp
                WHERE rp.po_dispatch = pd.name ORDER BY rp.creation DESC LIMIT 1) AS plan_status
        FROM `tabPO Dispatch` pd
        WHERE pd.dispatch_status = 'Pending'
          AND IFNULL(pd.im, '') != ''
          AND (
            EXISTS (SELECT 1 FROM `tabRollout Plan` rp2 WHERE rp2.po_dispatch = pd.name)
            OR EXISTS (SELECT 1 FROM `tabWork Done` wd2 WHERE wd2.system_id = pd.name)
          )
        """,
        as_dict=True,
    )

    if not rows:
        print("repair_pending_with_execution_history: nothing to check")
        return {"checked": 0, "updated": {}, "skipped": []}

    updated = {"Completed": 0, "Planned": 0, "Dispatched": 0}
    skipped = []

    for row in rows:
        wd_status = (row.wd_status or "").strip()
        plan_status = (row.plan_status or "").strip()

        if wd_status == "Confirmation Done":
            new_status = "Completed"
        elif not wd_status and plan_status in ("Overdue", "Not Attended"):
            new_status = "Planned"
        elif not wd_status and plan_status == "Cancelled":
            new_status = "Dispatched"
        else:
            skipped.append({"name": row.name, "poid": row.poid, "wd_status": wd_status, "plan_status": plan_status})
            continue

        frappe.db.set_value("PO Dispatch", row.name, "dispatch_status", new_status, update_modified=False)
        updated[new_status] += 1

    frappe.db.commit()

    print(
        f"repair_pending_with_execution_history: {len(rows)} candidates, "
        f"{sum(updated.values())} updated ({updated}), {len(skipped)} skipped (need a manual decision)"
    )
    if skipped:
        print("  skipped rows:")
        for s in skipped:
            print(f"  - {s['name']} ({s['poid']}): wd_status={s['wd_status']!r} plan_status={s['plan_status']!r}")

    return {"checked": len(rows), "updated": updated, "skipped": skipped}
