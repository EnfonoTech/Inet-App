import frappe
from frappe.model.document import Document

from inet_app.region_type import region_type_from_center_area


class PODispatch(Document):
    def validate(self):
        self.region_type = region_type_from_center_area(self.center_area)

    def before_insert(self):
        # Immutable internal reference = first autoname (SYS-{year}-{#####}). Name may later be renamed to POID.
        if not getattr(self, "system_id", None) and self.name:
            self.system_id = self.name
