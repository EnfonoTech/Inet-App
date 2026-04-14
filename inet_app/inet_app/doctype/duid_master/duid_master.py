import frappe
from frappe.model.document import Document

from inet_app.region_type import region_type_from_center_area


class DUIDMaster(Document):
    def validate(self):
        self.duid = (self.duid or self.name or "").strip()
        self.site_name = (self.site_name or "").strip()
        self.center_area = (self.center_area or "").strip()
        self.region_type = region_type_from_center_area(self.center_area)
        if not self.duid:
            frappe.throw("DUID is required")
