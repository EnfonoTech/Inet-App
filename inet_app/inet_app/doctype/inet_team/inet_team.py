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
            # field_user is a convenience cache, not the source of truth for
            # login resolution — _session_inet_field_team_id() already falls
            # back to the team lead's Employee.user_id directly (via the
            # team_members child table) whenever field_user is blank. So a
            # team lead's Employee record having no linked User yet is a
            # normal, valid state, not an error: managing team membership
            # must never be blocked by it. Sync (not throw) so a lead change
            # can't leave a stale field_user pointing at the previous lead.
            self.field_user = frappe.db.get_value("Employee", emp, "user_id") or None
        elif self.team_members and len(leads) == 0:
            # Rows exist but none marked Team Lead — clear stale Field App user
            self.field_user = None
