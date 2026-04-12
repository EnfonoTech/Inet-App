"""
Before INET Team Member schema drops `user` and `member_role`, add new columns
and backfill employee / designation / is_team_lead from User + role.
"""

import frappe


def execute():
    if not frappe.db.table_exists("tabINET Team Member"):
        return

    cols = frappe.db.get_table_columns("INET Team Member")
    if "user" not in cols:
        return

    alters = []
    if "employee" not in cols:
        alters.append("ADD COLUMN `employee` varchar(140)")
    if "designation" not in cols:
        alters.append("ADD COLUMN `designation` varchar(140)")
    if "is_team_lead" not in cols:
        alters.append("ADD COLUMN `is_team_lead` int(1) NOT NULL DEFAULT 0")
    if alters:
        frappe.db.sql("ALTER TABLE `tabINET Team Member` " + ", ".join(alters))
        frappe.db.commit()

    has_role = "member_role" in cols
    if has_role:
        rows = frappe.db.sql(
            "SELECT name, `user`, `member_role` FROM `tabINET Team Member` WHERE IFNULL(`user`, '') != ''",
            as_dict=True,
        )
    else:
        rows = frappe.db.sql(
            "SELECT name, `user` FROM `tabINET Team Member` WHERE IFNULL(`user`, '') != ''",
            as_dict=True,
        )

    for r in rows:
        user = (r.get("user") or "").strip()
        if not user:
            continue
        emp = frappe.db.get_value("Employee", {"user_id": user}, "name")
        des = frappe.db.get_value("Employee", emp, "designation") if emp else None
        is_lead = 0
        if has_role and str(r.get("member_role") or "").strip() == "Team Lead":
            is_lead = 1
        updates = {"is_team_lead": is_lead}
        if emp:
            updates["employee"] = emp
        if des:
            updates["designation"] = des
        frappe.db.set_value("INET Team Member", r.name, updates, update_modified=False)

    frappe.db.commit()
