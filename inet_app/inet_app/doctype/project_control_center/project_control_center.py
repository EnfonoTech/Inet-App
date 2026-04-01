import frappe
from frappe import _
from frappe.model.document import Document


class ProjectControlCenter(Document):
    def validate(self):
        self._validate_completion_percentage()
        self._validate_budget_vs_actual()

    def _validate_completion_percentage(self):
        value = flt_or_zero(self.completion_percentage)
        if value < 0 or value > 100:
            frappe.throw(_("Completion Percentage must be between 0 and 100."))

    def _validate_budget_vs_actual(self):
        budget = flt_or_zero(self.budget_amount)
        actual = flt_or_zero(self.actual_cost)
        if budget and actual > budget:
            frappe.msgprint(
                _("Actual Cost ({0}) has exceeded Budget Amount ({1}).").format(actual, budget),
                indicator="orange",
                alert=True,
            )


def flt_or_zero(value):
    try:
        return float(value or 0)
    except Exception:
        return 0.0
