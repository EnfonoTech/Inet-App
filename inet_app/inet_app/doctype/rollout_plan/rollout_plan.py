import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt, getdate

class RolloutPlan(Document):
    def validate(self):
        if self.plan_end_date and self.plan_date:
            if getdate(self.plan_end_date) < getdate(self.plan_date):
                frappe.throw(_("Planned end date cannot be before plan start date"))

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
