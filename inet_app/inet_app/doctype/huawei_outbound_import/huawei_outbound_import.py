import frappe
from frappe.model.document import Document


class HuaweiOutboundImport(Document):
    def before_save(self):
        if self.file and not self.outbound_date:
            from inet_app.api.material_management import _parse_outbound_date
            import os
            self.outbound_date = _parse_outbound_date(os.path.basename(self.file))
