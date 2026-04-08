# Copyright (c) 2026, enfono and contributors
# License: MIT

import frappe
from frappe.model.document import Document
from frappe.utils import get_datetime, time_diff_in_seconds


class ExecutionTimeLog(Document):
    def validate(self):
        self.validate_running_timer()
        self.calculate_duration()

    def validate_running_timer(self):
        if not self.is_running:
            return
        existing = frappe.get_all(
            "Execution Time Log",
            filters={
                "user": self.user,
                "is_running": 1,
                "name": ["!=", self.name or ""],
            },
            limit=1,
            ignore_permissions=True,
        )
        if existing:
            frappe.throw(
                f"You already have a running timer ({existing[0].name}). Stop it before starting a new one."
            )

    def calculate_duration(self):
        if self.start_time and self.end_time and not self.is_running:
            start = get_datetime(self.start_time)
            end = get_datetime(self.end_time)
            if end < start:
                frappe.throw("End Time cannot be before Start Time")
            diff_seconds = time_diff_in_seconds(end, start)
            self.duration_minutes = int(diff_seconds / 60)
            self.duration_hours = round(diff_seconds / 3600, 2)
        elif self.is_running:
            self.duration_minutes = 0
            self.duration_hours = 0.0
