# Copyright (c) 2026, enfono and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class INETTeamMember(Document):
    def validate(self):
        if self.employee:
            des = frappe.db.get_value("Employee", self.employee, "designation")
            if des:
                self.designation = des
