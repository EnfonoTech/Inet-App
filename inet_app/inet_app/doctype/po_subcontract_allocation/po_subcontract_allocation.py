# Copyright (c) 2026, enfono and contributors
# For license information, please see license.txt

from frappe.model.document import Document


class POSubcontractAllocation(Document):
    """One subcontractor's share of a PO line.

    Derived from the Work Done closure ledger (or, before any confirmation,
    from Rollout Plan Team) by ``resync_dispatch_allocations`` — never typed
    directly except through the Administrator reconcile screen. The flat
    ``sub_po_*`` columns on PO Dispatch stay as a mirror of these rows so every
    existing reader keeps working unchanged.
    """
    pass
