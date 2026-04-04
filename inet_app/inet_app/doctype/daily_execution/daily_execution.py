import frappe
from frappe.model.document import Document
from frappe.utils import flt

class DailyExecution(Document):
    def before_save(self):
        if self.execution_status == "Completed" and self.rollout_plan:
            rp = frappe.get_doc("Rollout Plan", self.rollout_plan)
            rp.achieved_amount = flt(rp.achieved_amount) + flt(self.achieved_amount)
            if flt(rp.target_amount) > 0:
                rp.completion_pct = round(flt(rp.achieved_amount) / flt(rp.target_amount) * 100, 2)
            rp.plan_status = "Completed" if rp.completion_pct >= 100 else "In Execution"
            rp.save(ignore_permissions=True)
