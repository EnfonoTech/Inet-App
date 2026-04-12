import frappe
from frappe import _
from frappe.model.document import Document


class INETTeam(Document):
    def validate(self):
        leads = [r for r in (self.team_members or []) if getattr(r, "is_team_lead", None)]
        if len(leads) > 1:
            frappe.throw(_("Only one Team Lead is allowed per INET Team."))
        if len(leads) == 1:
            emp = leads[0].employee
            if not emp:
                frappe.throw(_("Team Lead row must have an Employee selected."))
            user_id = frappe.db.get_value("Employee", emp, "user_id")
            if not user_id:
                frappe.throw(
                    _(
                        "Team Lead employee {0} must have a linked User (set User Id on the Employee record)."
                    ).format(emp)
                )
            self.field_user = user_id
        elif self.team_members and len(leads) == 0:
            # Rows exist but none marked Team Lead — clear stale Field App user
            self.field_user = None
