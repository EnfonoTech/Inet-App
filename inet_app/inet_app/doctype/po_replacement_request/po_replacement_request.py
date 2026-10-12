import frappe
from frappe.model.document import Document


class POReplacementRequest(Document):
    """The customer cancelled a POID and issued another; the work moves across.

    Deliberately NOT the same thing as PO Cancel Request. A cancellation
    abandons the work; a replacement keeps it and files it under a new
    customer line. They have separate flows, separate approval queues, and
    only the outcome overlaps — the old line ends up Cancelled either way,
    distinguished by ``PO Dispatch.replaced_by`` being set.

    Several old POIDs may point at one new POID (the customer splitting or
    consolidating lines), which is why ``poids`` is a table and
    ``new_po_dispatch`` is a single field rather than the reverse.

    The state transitions (create / approve / reject / cancel) live in
    ``inet_app.api.command_center`` beside the transfer and cancel flows, so
    the endpoints can wrap them with role checks and move the work atomically
    on approval.
    """

    def validate(self):
        targets = {r.po_dispatch for r in (self.get("poids") or []) if r.po_dispatch}
        if self.new_po_dispatch and self.new_po_dispatch in targets:
            frappe.throw("A POID cannot replace itself.")
        if len(targets) != len([r for r in (self.get("poids") or []) if r.po_dispatch]):
            frappe.throw("The same POID is listed more than once.")
