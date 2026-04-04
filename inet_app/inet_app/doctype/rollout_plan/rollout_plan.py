import frappe
from frappe.model.document import Document
from frappe.utils import flt

class RolloutPlan(Document):
    def before_save(self):
        if not self.visit_multiplier:
            mult = frappe.db.get_value("Visit Multiplier Master", self.visit_type, "multiplier")
            self.visit_multiplier = flt(mult or 1.0)
        if self.target_amount and self.achieved_amount:
            target = flt(self.target_amount)
            if target > 0:
                self.completion_pct = round(flt(self.achieved_amount) / target * 100, 2)
