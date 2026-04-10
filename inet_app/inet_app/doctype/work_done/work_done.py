import frappe
from frappe.model.document import Document
from frappe.utils import flt

class WorkDone(Document):
    def before_save(self):
        self.revenue_sar = flt(self.billing_rate_sar) * flt(self.executed_qty)
        self.total_cost_sar = (
            flt(self.team_cost_sar)
            + flt(self.subcontract_cost_sar)
            + flt(getattr(self, "activity_cost_sar", 0))
        )
        self.margin_sar = flt(self.revenue_sar) - flt(self.total_cost_sar)
