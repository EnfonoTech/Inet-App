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

    def on_submit(self):
        """Mark the linked PO Dispatch and PO Intake Line as Completed."""
        pd_name = getattr(self, "system_id", None)
        if not pd_name or not frappe.db.exists("PO Dispatch", pd_name):
            return
        pd = frappe.db.get_value("PO Dispatch", pd_name,
            ["dispatch_status", "po_intake", "po_line_no"], as_dict=True)
        if not pd:
            return
        if pd.dispatch_status != "Completed":
            frappe.db.set_value("PO Dispatch", pd_name, "dispatch_status", "Completed")
        if pd.po_intake and pd.po_line_no:
            intake_line = frappe.db.exists("PO Intake Line",
                {"parent": pd.po_intake, "po_line_no": pd.po_line_no})
            if intake_line and isinstance(intake_line, str):
                frappe.db.set_value("PO Intake Line", intake_line, "po_line_status", "Completed")
