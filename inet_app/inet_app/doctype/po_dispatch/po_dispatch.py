import frappe
from frappe.model.document import Document

class PODispatch(Document):
    def after_insert(self):
        self.system_id = self.name
        self.db_set("system_id", self.name)
