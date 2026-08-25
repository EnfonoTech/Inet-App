"""One-off import of the ~90 real INET employees + their certificate data
from the reference "INET Certificate Tracker" HTML tool into Frappe
(Employee + Employee Certificate), for the INET HR feature.

Idempotent — dedupes Employees by `iqama_number` and Employee Certificate
rows by (employee, certificate_type), so it's safe to re-run after fixing a
mapping issue. Deliberately NOT wired into after_migrate — run manually:

    bench --site inet execute inet_app.scripts.import_certificate_tracker_data.execute

The source data (RAW.rt/pt/fe from the reference HTML's embedded JSON) is
checked in as certificate_tracker_seed.json next to this file, so the import
doesn't depend on that external HTML file being present at runtime.
"""

import json
import os

import frappe
from frappe.utils import getdate

SEED_FILE = os.path.join(os.path.dirname(__file__), "certificate_tracker_seed.json")

# The reference tool's `position` values map straight onto Designation,
# except this one where a clearer label was chosen (see the build plan).
DESIGNATION_MAP = {
	"Document": "Document Controller",
}

# Fields the source data has no information for at all. Rather than
# fabricating a date of birth/joining or guessing gender, mandatory-field
# validation is bypassed for these specific fields on import — they show up
# genuinely blank in the Employee list so HR knows to fill them in, instead
# of looking complete with made-up values.
UNKNOWN_MANDATORY_FIELDS = ["gender", "date_of_birth", "date_of_joining"]


def _default_company():
	company = frappe.db.get_single_value("Global Defaults", "default_company")
	if company:
		return company
	companies = frappe.get_all("Company", limit=1, pluck="name")
	return companies[0] if companies else None


def _designation_for(position):
	if not position:
		return None
	return DESIGNATION_MAP.get(position, position)


def _find_or_create_employee(entry, company):
	iqama = (entry.get("iqama") or "").strip()
	full_name = entry.get("name") or ""
	if not iqama:
		print(f"  SKIP {full_name!r} — no Iqama/national ID to dedupe on")
		return None, "skipped"

	existing = frappe.db.get_value("Employee", {"iqama_number": iqama}, "name")
	is_new = not existing
	doc = frappe.get_doc("Employee", existing) if existing else frappe.new_doc("Employee")

	if is_new:
		parts = full_name.split()
		doc.first_name = parts[0] if parts else full_name
		if len(parts) > 1:
			doc.last_name = " ".join(parts[1:])
		doc.company = company

	doc.employee_name = full_name
	doc.cell_number = entry.get("mobile") or doc.cell_number
	doc.personal_email = entry.get("email") or doc.personal_email
	doc.iqama_number = iqama
	# Production names Employees off employee_number (its Employee ID is the
	# Iqama Number, not this bench's HR-EMP- series) — keep that field
	# populated to match regardless of which naming scheme is actually
	# active on the site this runs against.
	doc.employee_number = iqama
	doc.nationality = entry.get("nationality") or doc.nationality
	doc.uniportal_id = entry.get("uniportal") or doc.uniportal_id
	doc.certification_domain = entry.get("domain") or doc.certification_domain
	doc.status = "Left" if entry.get("_sheet") == "former" else "Active"

	if doc.status == "Left" and not doc.relieving_date:
		# ERPNext requires a relieving_date for status=Left and the source
		# data has no real termination date — rather than leave the import
		# stuck, flag today's date as an explicit placeholder for HR to
		# correct per person, instead of guessing an actual last working day.
		doc.relieving_date = frappe.utils.nowdate()
		print(f"  NOTE {full_name!r} marked Left with a PLACEHOLDER relieving date (today) — please correct")

	designation_name = _designation_for(entry.get("position"))
	if designation_name and frappe.db.exists("Designation", designation_name):
		doc.designation = designation_name

	doc.flags.ignore_mandatory = True
	for fieldname in UNKNOWN_MANDATORY_FIELDS:
		if not doc.get(fieldname):
			doc.set(fieldname, None)

	if is_new:
		doc.insert(ignore_permissions=True)
	else:
		doc.save(ignore_permissions=True)
	return doc.name, ("created" if is_new else "updated")


def _safe_getdate(raw, employee, cert_name, field_label):
	"""A few rows in the source spreadsheet have malformed dates (e.g.
	"20-072026", "02/06//2025"). Rather than guess at the intended date for a
	compliance record, skip just that field and flag it loudly so HR can
	correct it directly on the Employee Certificate record."""
	try:
		return getdate(raw)
	except Exception:
		print(f"  WARN unparseable {field_label} {raw!r} for {employee} / {cert_name} — left blank, please fix manually")
		return None


def _upsert_certificate(employee, cert_name, cert):
	if not (cert.get("no") or cert.get("expiry")):
		return None  # nothing to import — reference tracker leaves these blank too

	if not frappe.db.exists("Certificate Type", cert_name):
		print(f"  WARN unknown certificate type {cert_name!r} for {employee} — skipped")
		return None

	existing = frappe.db.get_value(
		"Employee Certificate",
		{"employee": employee, "certificate_type": cert_name},
		"name",
	)
	doc = frappe.get_doc("Employee Certificate", existing) if existing else frappe.new_doc("Employee Certificate")
	doc.employee = employee
	doc.certificate_type = cert_name
	doc.certificate_no = cert.get("no") or None
	doc.issue_date = _safe_getdate(cert["start"], employee, cert_name, "issue date") if cert.get("start") else None
	doc.expiry_date = _safe_getdate(cert["expiry"], employee, cert_name, "expiry date") if cert.get("expiry") else None

	if existing:
		doc.save(ignore_permissions=True)
	else:
		doc.insert(ignore_permissions=True)
	return "created" if not existing else "updated"


def execute():
	company = _default_company()
	if not company:
		frappe.throw("No Company found on this site — create one before running this import.")

	with open(SEED_FILE, encoding="utf-8") as f:
		seed = json.load(f)

	summary = {
		"employees_created": 0, "employees_updated": 0, "employees_skipped": 0,
		"certs_created": 0, "certs_updated": 0,
	}

	for cohort in ("rt", "pt", "fe"):
		print(f"--- {cohort} ({len(seed[cohort])} records) ---")
		for entry in seed[cohort]:
			employee_name, outcome = _find_or_create_employee(entry, company)
			if outcome == "skipped":
				summary["employees_skipped"] += 1
				continue
			summary[f"employees_{outcome}"] += 1

			for cert_name, cert in entry.get("certs", {}).items():
				cert_outcome = _upsert_certificate(employee_name, cert_name, cert)
				if cert_outcome:
					summary[f"certs_{cert_outcome}"] += 1

	frappe.db.commit()

	print("\nCertificate Tracker import complete:")
	for key, value in summary.items():
		print(f"  {key}: {value}")
	print(
		"\nNote: gender / date of birth / date of joining were not in the "
		"source data and were left blank rather than guessed — fill these "
		"in from the Employee list if HRMS leave/payroll features need them."
	)
	return summary
