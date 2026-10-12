from frappe.model.document import Document


class POReplacementRequestLine(Document):
    """One POID being replaced. Every field but ``po_dispatch`` is a snapshot
    taken when the request was made, so the request still reads correctly
    after the line itself has been cancelled and re-pointed."""
    pass
