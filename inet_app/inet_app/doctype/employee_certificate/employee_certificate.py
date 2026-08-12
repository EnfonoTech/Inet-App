import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import date_diff, getdate, nowdate

STATUS_NOT_ISSUED = "Not Issued"
STATUS_VALID = "Valid"
STATUS_EXPIRING = "Expiring Soon"
STATUS_EXPIRED = "Expired"

# Days-remaining threshold for "Expiring Soon" — matches the reference tracker's
# certStatus() (expired: days < 0, expiring: 0-90, else valid).
EXPIRING_WITHIN_DAYS = 90


class EmployeeCertificate(Document):
	def validate(self):
		self.check_duplicate()
		self.set_status()

	def check_duplicate(self):
		"""One row per (employee, certificate_type) — enforced here since Frappe
		doctypes only support single-field uniqueness natively."""
		if not (self.employee and self.certificate_type):
			return
		existing = frappe.db.get_value(
			"Employee Certificate",
			{
				"employee": self.employee,
				"certificate_type": self.certificate_type,
				"name": ["!=", self.name or ""],
			},
			"name",
		)
		if existing:
			frappe.throw(
				_("{0} already has a {1} certificate record ({2}).").format(
					self.employee_name or self.employee, self.certificate_type, existing
				)
			)

	def set_status(self):
		if not self.certificate_no and not self.expiry_date:
			self.status = STATUS_NOT_ISSUED
			self.days_to_expiry = None
			return
		if not self.expiry_date:
			# Has a certificate number but no tracked expiry (e.g. lifetime cert).
			self.status = STATUS_VALID
			self.days_to_expiry = None
			return
		days = date_diff(getdate(self.expiry_date), getdate(nowdate()))
		self.days_to_expiry = days
		if days < 0:
			self.status = STATUS_EXPIRED
		elif days <= EXPIRING_WITHIN_DAYS:
			self.status = STATUS_EXPIRING
		else:
			self.status = STATUS_VALID
