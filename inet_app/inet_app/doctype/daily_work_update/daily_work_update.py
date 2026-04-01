import frappe
from frappe import _
from frappe.model.document import Document


class DailyWorkUpdate(Document):
    def validate(self):
        self._validate_progress_rows()
        self._validate_gps_location()

    def _validate_progress_rows(self):
        for row in self.tasks_completed or []:
            value = float(row.progress_percentage or 0)
            if value < 0 or value > 100:
                frappe.throw(_("Task row progress percentage must be between 0 and 100."))

    def _validate_gps_location(self):
        if not self.gps_location:
            return
        parts = [p.strip() for p in self.gps_location.split(",")]
        if len(parts) != 2:
            frappe.throw(_("GPS location must be in 'lat,lng' format."))
        try:
            lat = float(parts[0])
            lng = float(parts[1])
        except ValueError:
            frappe.throw(_("GPS location must contain valid numeric latitude and longitude."))
        if lat < -90 or lat > 90 or lng < -180 or lng > 180:
            frappe.throw(_("GPS coordinates are out of valid range."))
