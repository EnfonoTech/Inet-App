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

  - A Work Done record exists at all, regardless of its own
    submission_status (Confirmation Done / Ready for Confirmation /
    PIC Rejected / blank) -> Completed. The field work happened; whatever
    submission_status says is a separate, later-stage concern (IM
    confirmation, PIC review) that dispatch_status doesn't track.
  - No Work Done, latest Rollout Plan status is "Overdue" or "Not Attended"
    -> Planned (a plan exists, wasn't executed in time)
  - No Work Done, latest Rollout Plan status is "Cancelled"
    -> Dispatched (the attempt was cancelled; needs a fresh plan)

Deliberately SKIPPED (left at Pending, reported separately, not fixed
here) — needs an explicit decision, not a mechanical rule:
  - No Work Done record at all, and the latest Rollout Plan's status
    doesn't match any of the three rules above (e.g. "Completed" with
    no Work Done ever logged for it, or an unrecognized plan_status)

Safe to re-run: only ever touches rows still at dispatch_status="Pending"
with im set, so anything already fixed (by this script or otherwise) no
longer matches and is left alone.
"""
import frappe


def execute():
    rows = frappe.db.sql(
        """
        SELECT pd.name, pd.poid,
               (SELECT wd.name FROM `tabWork Done` wd
                WHERE wd.system_id = pd.name ORDER BY wd.creation DESC LIMIT 1) AS wd_name,
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
        plan_status = (row.plan_status or "").strip()

        if row.wd_name:
            new_status = "Completed"
        elif plan_status in ("Overdue", "Not Attended"):
            new_status = "Planned"
        elif plan_status == "Cancelled":
            new_status = "Dispatched"
        else:
            skipped.append({"name": row.name, "poid": row.poid, "plan_status": plan_status})
            continue

        frappe.db.set_value("PO Dispatch", row.name, "dispatch_status", new_status, update_modified=False)
        updated[new_status] += 1

    frappe.db.commit()

    print(
        f"repair_pending_with_execution_history: {len(rows)} candidates, "
        f"{sum(updated.values())} updated ({updated}), {len(skipped)} skipped (need a manual decision)"
    )
    if skipped:
        print("  skipped rows (no Work Done at all, plan_status doesn't match a rule):")
        for s in skipped:
            print(f"  - {s['name']} ({s['poid']}): plan_status={s['plan_status']!r}")

    return {"checked": len(rows), "updated": updated, "skipped": skipped}
