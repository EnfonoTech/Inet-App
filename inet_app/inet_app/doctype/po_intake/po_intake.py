import frappe
from frappe.model.document import Document
from frappe.utils import flt


def normalize_po_intake_status(value):
    """PO Intake.status allows OPEN, CLOSED, CANCELLED only (uploads often send NEW)."""
    s = str(value or "").strip().upper() or "OPEN"
    if s in ("OPEN", "CLOSED", "CANCELLED"):
        return s
    if s in ("NEW", "DRAFT", "ACTIVE", "PENDING", "IN PROGRESS", "IN_PROGRESS", "ONGOING"):
        return "OPEN"
    if s in ("CANCEL", "CANCELED"):
        return "CANCELLED"
    if s in ("CLOSE", "COMPLETED", "DONE"):
        return "CLOSED"
    return "OPEN"


class POIntake(Document):
    def validate(self):
        self.status = normalize_po_intake_status(self.status)
        # Always derive totals from line qty/rate to match "avoid manual edits" rule.
        grand_total = 0
        for row in (self.po_lines or []):
            row.line_amount = flt(row.qty) * flt(row.rate)
            grand_total += flt(row.line_amount)

        self.grand_total = grand_total

