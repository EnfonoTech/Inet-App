import frappe
from frappe.model.document import Document
from frappe.utils import flt


class DailyExecution(Document):
    def before_insert(self):
        self._populate_execution_team_members()

    def before_save(self):
        if self.execution_status == "Completed" and self.rollout_plan:
            total = frappe.db.sql(
                """
                SELECT COALESCE(SUM(achieved_amount), 0)
                FROM `tabDaily Execution`
                WHERE rollout_plan = %s AND execution_status = 'Completed' AND name != %s
                """,
                (self.rollout_plan, self.name or ""),
            )[0][0]
            rp = frappe.get_doc("Rollout Plan", self.rollout_plan)
            rp.achieved_amount = flt(total) + flt(self.achieved_amount)
            if flt(rp.target_amount) > 0:
                rp.completion_pct = round(flt(rp.achieved_amount) / flt(rp.target_amount) * 100, 2)
            rp.plan_status = "Completed" if rp.completion_pct >= 100 else "In Execution"
            rp.save(ignore_permissions=True)

    def _populate_execution_team_members(self):
        """Populate execution_team_members on first creation.

        Source priority:
        1. Rollout Plan's plan_team_members filtered to this execution's team (multi-team aware)
        2. INET Team Member directly (fallback when no plan or plan has no members yet)

        IM can freely edit these rows after creation.
        """
        if self.execution_team_members:
            return  # already set, don't overwrite

        members = []

        if self.rollout_plan and self.team:
            # Pull from plan snapshot filtered by this execution's team
            plan_members = frappe.db.get_all(
                "Rollout Plan Team Member",
                filters={"parent": self.rollout_plan, "team": self.team},
                fields=["team", "team_name", "employee", "employee_name", "designation", "is_team_lead"],
                order_by="is_team_lead desc, idx asc",
            )
            members = plan_members

        if not members and self.team:
            # Fallback: read directly from INET Team Member
            raw = frappe.db.sql(
                """
                SELECT itm.employee, itm.designation, itm.is_team_lead,
                       it.team_name, emp.employee_name
                FROM `tabINET Team Member` itm
                INNER JOIN `tabINET Team` it ON it.name = itm.parent
                LEFT JOIN `tabEmployee` emp ON emp.name = itm.employee
                WHERE itm.parent = %s
                ORDER BY itm.is_team_lead DESC, itm.idx
                """,
                self.team,
                as_dict=True,
            )
            members = [
                {
                    "team": self.team,
                    "team_name": m.get("team_name", ""),
                    "employee": m["employee"],
                    "employee_name": m.get("employee_name") or m["employee"],
                    "designation": m.get("designation"),
                    "is_team_lead": m.get("is_team_lead", 0),
                }
                for m in raw
            ]

        for m in members:
            self.append("execution_team_members", {
                "team": m.get("team") or self.team,
                "team_name": m.get("team_name", ""),
                "employee": m["employee"],
                "employee_name": m.get("employee_name") or m["employee"],
                "designation": m.get("designation"),
                "is_team_lead": m.get("is_team_lead", 0),
                "is_present": 1,
            })
