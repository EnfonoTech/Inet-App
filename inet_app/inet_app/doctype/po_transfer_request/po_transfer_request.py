import frappe
from frappe.model.document import Document


class POTransferRequest(Document):
    """Batch IM-to-IM POID transfer, single PM approval covers every line.

    The actual state transitions (create / approve / reject / cancel) live
    in ``inet_app.api.command_center`` alongside the equivalent Team
    Allocation Request flow, so the API endpoints can wrap them with role
    checks and the atomic multi-row ``PO Dispatch.im`` flip on approval.
    """

    def validate(self):
        if self.from_im and self.to_im and self.from_im == self.to_im:
            frappe.throw("From IM and To IM cannot be the same.")
