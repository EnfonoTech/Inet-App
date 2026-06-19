"""
Run via: bench --site inet execute seed_notifs.run
(put this in apps/inet_app/inet_app/api/seed_notifs.py first)
"""
import frappe


def run():
    # Mark old null-link INET notifications as already-read so they don't clutter the bell
    frappe.db.sql(
        "UPDATE `tabNotification Log` SET `read`=1"
        " WHERE link IS NULL"
        "   AND (subject LIKE '[ALERT]%' OR subject LIKE '[INFO]%' OR subject LIKE '[CRITICAL]%')"
    )
    frappe.db.commit()
    print("Marked old null-link notifications as read")

    from inet_app.api.notifications import _make_notification

    _make_notification(
        "ramees@enfono.com",
        "[ALERT] Work submitted — POID 1011HG3692387-90-1-1 · DUID N-TBUK-SNFN",
        "Daily Execution", "EXE-TEST-01",
        link="/pms/im-execution",
    )
    _make_notification(
        "ramees@enfono.com",
        "[INFO] Plan assigned — POID 2011AB1234567-10-1-1",
        "Rollout Plan", "RP-TEST-01",
        link="/pms/im-planning",
    )
    _make_notification(
        "team6@gmail.com",
        "[INFO] Work confirmed by IM — POID 1011HG3692387-90-1-1 · DUID N-TBUK-SNFN",
        "Work Done", "WD-TEST-01",
        link="/pms/today",
    )
    _make_notification(
        "team6@gmail.com",
        "[CRITICAL] Daily update rejected — 2026-06-19",
        "Daily Work Update", "WU-TEST-01",
        link="/pms/today",
    )
    frappe.db.commit()

    logs = frappe.db.get_all(
        "Notification Log",
        filters=[["subject", "like", "[%]%"]],
        fields=["for_user", "subject", "link"],
        order_by="creation desc",
    )
    print(f"Seeded {len(logs)} notifications:")
    for l in logs:
        print(f"  [{l.for_user}] {l.subject[:60]}  link={l.link}")
