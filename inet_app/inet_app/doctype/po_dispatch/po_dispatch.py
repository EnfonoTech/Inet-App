import frappe
from frappe.model.document import Document

from inet_app.region_type import region_type_from_center_area


class PODispatch(Document):
    def validate(self):
        self.region_type = region_type_from_center_area(self.center_area)
        self._ensure_duid_master()

    def before_insert(self):
        # Immutable internal reference = first autoname (SYS-{year}-{#####}). Name may later be renamed to POID.
        if not getattr(self, "system_id", None) and self.name:
            self.system_id = self.name

    def _ensure_duid_master(self):
        duid = str(getattr(self, "site_code", "") or "").strip()
        if not duid or not frappe.db.exists("DocType", "DUID Master"):
            return
        if frappe.db.exists("DUID Master", duid):
            return
        doc = frappe.new_doc("DUID Master")
        doc.duid = duid
        doc.site_name = (getattr(self, "site_name", "") or "").strip()
        doc.center_area = (getattr(self, "center_area", "") or "").strip()
        doc.insert(ignore_permissions=True)
