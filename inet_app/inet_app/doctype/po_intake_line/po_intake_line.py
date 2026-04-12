import frappe
from frappe.model.document import Document
from frappe.model.naming import make_autoname


def make_poid(po_no, po_line_no, shipment_number):
    """Build POID string: PO No - PO Line No - Shipment No."""
    parts = [str(po_no or "").strip()]
    parts.append(str(int(po_line_no)) if po_line_no else "0")
    if shipment_number:
        parts.append(str(shipment_number).strip())
    return "-".join(parts)


class POIntakeLine(Document):
    def before_save(self):
        if not getattr(self, "inet_line_uid", None):
            self._set_inet_line_uid()
        self._set_poid()

    def before_insert(self):
        self._set_inet_line_uid()
        self._set_poid()

    def _set_poid(self):
        po_no = getattr(self, "parent", None) or ""
        # Try to get po_no from the parent PO Intake document
        if po_no and self.docstatus is not None:
            try:
                po_no = frappe.db.get_value("PO Intake", po_no, "po_no") or po_no
            except Exception:
                pass
        self.poid = make_poid(po_no, self.po_line_no, self.shipment_number)

    def _set_inet_line_uid(self):
        if getattr(self, "inet_line_uid", None):
            return
        if not frappe.db.has_column("PO Intake Line", "inet_line_uid"):
            return
        self.inet_line_uid = make_autoname("ILN-.YYYY.-.######")
