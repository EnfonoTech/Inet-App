import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt, getdate


class RolloutPlan(Document):
    def validate(self):
        if self.plan_end_date and self.plan_date:
            if getdate(self.plan_end_date) < getdate(self.plan_date):
                frappe.throw(_("Planned end date cannot be before plan start date"))

        # Block manual / unauthorised setting of plan_status to Cancelled.
        # Cancellation must go through the cancel-request → PM-approve flow
        # (command_center.request_cancel_plan / pm_decide_cancel_plan).
        # Admin override: set flags.allow_status_override = True on the doc.
        if (
            self.plan_status == "Cancelled"
            and self.get_doc_before_save()
            and self.get_doc_before_save().plan_status != "Cancelled"
            and (self.cancel_request_status or "None") != "Approved"
            and not frappe.flags.allow_status_override
        ):
            frappe.throw(
                _(
                    "Cannot set plan status to Cancelled directly. "
                    "Use the Cancel Plan request flow "
                    "(IM requests → PM approves) or set "
                    "flags.allow_status_override = True for admin corrections."
                )
            )

    def before_save(self):
        if not self.visit_multiplier:
            mult = frappe.db.get_value("Visit Multiplier Master", self.visit_type, "multiplier")
            # "Execution" is the new label for legacy "Work Done" — use the
            # old master entry if no row exists under the new name yet.
            if mult is None and self.visit_type == "Execution":
                mult = frappe.db.get_value("Visit Multiplier Master", "Work Done", "multiplier")
            self.visit_multiplier = flt(mult or 1.0)
        if self.target_amount and self.achieved_amount:
            target = flt(self.target_amount)
            if target > 0:
                self.completion_pct = round(flt(self.achieved_amount) / target * 100, 2)

        self._sync_plan_team_members()

    def _sync_plan_team_members(self):
        """Rebuild plan_team_members from INET Team Member rows for every assigned team.

        Keeps IM-added manual rows that don't belong to any assigned team intact.
        For teams in the teams child table, replaces their rows with the current
        INET Team Member list so changes to INET Team roster propagate here.
        """
        assigned_teams = [row.team for row in (self.teams or []) if row.team]
        if not assigned_teams:
            return

        # Fetch current members from INET Team for all assigned teams
        ph = ", ".join(["%s"] * len(assigned_teams))
        team_members = frappe.db.sql(
            f"""
            SELECT itm.parent AS team, itm.employee, itm.designation, itm.is_team_lead,
                   it.team_name, emp.employee_name
            FROM `tabINET Team Member` itm
            INNER JOIN `tabINET Team` it ON it.name = itm.parent
            LEFT JOIN `tabEmployee` emp ON emp.name = itm.employee
            WHERE itm.parent IN ({ph})
            ORDER BY itm.parent, itm.is_team_lead DESC, itm.idx
            """,
            assigned_teams,
            as_dict=True,
        )

        # Remove existing rows for assigned teams; keep rows for other teams (manual adds)
        retained = [
            row for row in (self.plan_team_members or [])
            if row.team not in assigned_teams
        ]

        # Rebuild from fresh INET Team data
        self.plan_team_members = []
        for row in retained:
            self.append("plan_team_members", {
                "team": row.team,
                "team_name": row.team_name,
                "employee": row.employee,
                "employee_name": row.employee_name,
                "designation": row.designation,
                "is_team_lead": row.is_team_lead,
            })
        for m in team_members:
            self.append("plan_team_members", {
                "team": m["team"],
                "team_name": m["team_name"],
                "employee": m["employee"],
                "employee_name": m.get("employee_name") or m["employee"],
                "designation": m.get("designation"),
                "is_team_lead": m.get("is_team_lead", 0),
            })
