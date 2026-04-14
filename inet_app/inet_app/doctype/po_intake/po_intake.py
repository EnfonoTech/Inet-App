import frappe
from frappe.model.document import Document
from frappe.utils import flt


class POIntake(Document):
    def validate(self):
        # Always derive totals from line qty/rate to match "avoid manual edits" rule.
        grand_total = 0
        for row in (self.po_lines or []):
            row.line_amount = flt(row.qty) * flt(row.rate)
            grand_total += flt(row.line_amount)

        self.grand_total = grand_total

