import frappe
from frappe.model.document import Document


class TeamAllocationRequest(Document):
    """Workflow doctype for transferring an INET Team between IMs.

    The actual state transitions live in the ``inet_app.api.command_center``
    module so the API endpoints can wrap them with role checks and the
    atomic ``INET Team.im`` flip on PM approval. The Document class only
    enforces invariants that should hold regardless of how the row was
    created (Desk, API, fixture).
    """

    def validate(self):
        # Source and target IM must differ — there's nothing to transfer
        # otherwise, and the empty-from edge case (newly-created team
        # with no IM) is handled by the API layer at request time.
        if self.from_im and self.to_im and self.from_im == self.to_im:
            frappe.throw("Source IM and Target IM cannot be the same.")
