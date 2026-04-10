import frappe
from frappe.model.document import Document

from inet_app.region_type import region_type_from_center_area


class PODispatch(Document):
    def validate(self):
        self.region_type = region_type_from_center_area(self.center_area)

    def after_insert(self):
        self.system_id = self.name
        self.db_set("system_id", self.name)
