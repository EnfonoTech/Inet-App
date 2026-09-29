import frappe
from frappe.model.document import Document
from frappe.utils import cint, flt

class WorkDone(Document):
    def _line_revenue(self):
        """Revenue for this row, taken from the PO line it closes.

        Revenue is not an independently editable number — a line is worth what
        the PO says it is worth — so this must equal the dispatch's own amount.
        It used to be recomputed here as ``billing_rate_sar * executed_qty``,
        which silently overrode whatever the caller had set and let the two
        drift apart; the fix_work_done_revenue_sar patch existed only to keep
        realigning them after the fact. Deriving it from the line instead makes
        the two equal by construction, so every report that sums either column
        agrees without each query having to compensate.

        A MILESTONE-SCOPED Direct Close is the one case where the row is not
        worth the whole line: closing one milestone need not move the line's
        dispatch_status, and such a row represents only the milestone it
        closed. Same ms1_closed/ms2_closed test list_work_done_rows uses for
        its visibility rule — both flags equal (0/0 normal, or 1/1 whole-line
        close) means the row stands for the entire line.

        Where the IM has confirmed a REDUCED quantity, the line is worth the
        confirmed amount, not the ordered one — a POID bought for 3 where only
        2 were delivered is worth 2. ms1_amount / ms2_amount are already
        re-based on it by PO Dispatch.validate(), so only the whole-line branch
        has to choose. line_amount itself stays untouched as Huawei's figure.

        Returns None when there is no usable line to read, so the caller can
        keep the old rate x qty behaviour rather than zeroing a real figure.
        """
        if not self.system_id:
            return None
        pd = frappe.db.get_value(
            "PO Dispatch", self.system_id,
            ["line_amount", "confirmed_amount", "remaining_qty_action",
             "ms1_amount", "ms2_amount"], as_dict=True,
        )
        if not pd:
            return None
        ms1, ms2 = cint(getattr(self, "ms1_closed", 0)), cint(getattr(self, "ms2_closed", 0))
        if ms1 and not ms2:
            return flt(pd.ms1_amount)
        if ms2 and not ms1:
            return flt(pd.ms2_amount)
        # Same rule as PO Dispatch.billable_amount(), including the
        # "to be invoiced" remainder that restores the full ordered value.
        confirmed = flt(pd.confirmed_amount)
        if not confirmed:
            return flt(pd.line_amount)
        from inet_app.inet_app.doctype.po_dispatch.po_dispatch import PODispatch

        if (pd.remaining_qty_action or "").strip() == PODispatch.BILL_FULL_ON_ACTION:
            return flt(pd.line_amount) or confirmed
        return confirmed

    def before_save(self):
        line_revenue = self._line_revenue()
        self.revenue_sar = (
            line_revenue if line_revenue is not None
            else flt(self.billing_rate_sar) * flt(self.executed_qty)
        )
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
            from inet_app.api.status_log import set_dispatch_status

            set_dispatch_status(pd_name, "Completed")
        if pd.po_intake and pd.po_line_no:
            intake_line = frappe.db.exists("PO Intake Line",
                {"parent": pd.po_intake, "po_line_no": pd.po_line_no})
            if intake_line and isinstance(intake_line, str):
                frappe.db.set_value("PO Intake Line", intake_line, "po_line_status", "Completed")
