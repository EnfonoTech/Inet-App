"""INET Certificate Tracker (INET HR).

Reads/writes only Employee Certificate / Certificate Type / Certification
Domain, and *reads* Employee for names/teams. Nothing here writes to any PMS
workflow doctype (PO Dispatch, Rollout Plan, Daily Execution, Work Done, ...)
— see apps/inet_app/CLAUDE.md guardrail notes in the build plan.
"""

import random

import frappe
from frappe import _
from frappe.utils import cint, flt

PROTECH_DOMAIN = "WL & MW"

ALL_STATUSES = ["Valid", "Expiring Soon", "Expired", "Not Issued"]


def set_employee_autoname(doc, method=None):
	"""doc_events hook (Employee.autoname) — names a new Employee by its
	Employee Number (== Iqama/National ID for everyone this tracker touches)
	instead of the HR-EMP- series, matching production's actual convention:
	an employee's ID *is* their employee number there. Only sets doc.name
	when it actually has a value to use — an Employee created elsewhere on
	this bench without one (e.g. an unrelated Desk flow) is untouched here,
	and Frappe's own naming_series fallback in set_new_name() takes over
	exactly as before."""
	value = (doc.employee_number or doc.iqama_number or "").strip()
	if value:
		doc.name = value


# ---------------------------------------------------------------------------
# Catalog
# ---------------------------------------------------------------------------

@frappe.whitelist()
def list_certificate_types():
	return frappe.get_all(
		"Certificate Type",
		filters={"is_active": 1},
		fields=["name", "certificate_name", "applies_to", "renewal_cost", "validity_months"],
		order_by="certificate_name asc",
	)


@frappe.whitelist()
def list_certification_domains():
	return frappe.get_all(
		"Certification Domain",
		filters={"status": "Active"},
		fields=["name", "domain_name"],
		order_by="domain_name asc",
	)


@frappe.whitelist()
def list_certificate_tracker_companies():
	"""Every active Certificate Tracker Company, regardless of whether it
	currently has any employees — backs the Add/Edit Employee form's Company
	dropdown. (Contrast list_tracker_companies(), which only returns
	companies that actually have Active employees, for the By Company nav.)"""
	return frappe.get_all(
		"Certificate Tracker Company",
		filters={"status": "Active"},
		fields=["name", "company_name"],
		order_by="company_name asc",
	)


@frappe.whitelist()
def list_designations():
	return frappe.get_all("Designation", fields=["name"], order_by="name asc")


@frappe.whitelist()
def list_genders():
	return frappe.get_all("Gender", fields=["name"], order_by="name asc")


@frappe.whitelist()
def get_nav_badge_counts():
	"""Sidebar badge counts (Resource/Protech/Former/Expiring 90d) — same
	numbers as the pages themselves, computed directly so the sidebar never
	shows a "—" placeholder a user could mistake for zero."""
	row = frappe.db.sql(
		"""
		SELECT
			SUM(CASE WHEN status = 'Active' AND (certification_domain != %s OR certification_domain IS NULL) THEN 1 ELSE 0 END) AS resource,
			SUM(CASE WHEN status = 'Active' AND certification_domain = %s THEN 1 ELSE 0 END) AS protech,
			SUM(CASE WHEN status = 'Left' THEN 1 ELSE 0 END) AS former
		FROM `tabEmployee`
		""",
		(PROTECH_DOMAIN, PROTECH_DOMAIN),
		as_dict=True,
	)[0]
	expiring_90 = frappe.db.sql(
		"""
		SELECT COUNT(*) AS c FROM `tabEmployee Certificate` ec
		INNER JOIN `tabEmployee` emp ON emp.name = ec.employee
		WHERE emp.status = 'Active' AND ec.status IN ('Expiring Soon', 'Expired') AND ec.days_to_expiry <= 90
		""",
		as_dict=True,
	)[0].c
	return {
		"resource": cint(row.resource), "protech": cint(row.protech),
		"former": cint(row.former), "expiring_90": cint(expiring_90),
	}


# ---------------------------------------------------------------------------
# Employee + certificate listing (Resource Tracker / Protech / Former)
# ---------------------------------------------------------------------------

def _cohort_filters(cohort):
	"""Map the UI's cohort tabs onto Employee filters. certification_domain ==
	"WL & MW" is the Protech cohort; everything else Active is Resource;
	Former is purely Employee.status, independent of domain. Any other
	cohort value that matches a real Certificate Tracker Company name (the
	By Company page's tabs — Mabran, Wabranco, etc.) filters on that
	instead, independent of domain — a subcontractor's resources aren't
	further split by Resource/Protech."""
	filters = {}
	if cohort == "former":
		filters["status"] = "Left"
	elif cohort == "active":  # both resource + protech — used by the compliance report
		filters["status"] = "Active"
	elif cohort == "protech":
		filters["status"] = "Active"
		filters["certification_domain"] = PROTECH_DOMAIN
	elif cohort == "resource":
		filters["status"] = "Active"
		filters["certification_domain"] = ["!=", PROTECH_DOMAIN]
	elif cohort and frappe.db.exists("Certificate Tracker Company", cohort):
		filters["status"] = "Active"
		filters["tracker_company"] = cohort
	return filters


@frappe.whitelist()
def list_employee_certificates(cohort=None, domain=None, search=None, limit=0):
	"""Bulk endpoint: employees + all of their certificate rows in one round
	trip. Never call a per-employee API in a loop from the frontend."""
	filters = _cohort_filters(cohort)
	if domain:
		filters["certification_domain"] = domain
	if search:
		filters["employee_name"] = ["like", f"%{search}%"]

	list_kwargs = dict(
		filters=filters,
		fields=[
			"name", "employee_name", "iqama_number", "nationality",
			"cell_number", "personal_email", "designation",
			"certification_domain", "tracker_company", "status", "uniportal_id",
		],
		order_by="employee_name asc",
	)
	if cint(limit):
		list_kwargs["limit_page_length"] = cint(limit)

	employees = frappe.get_all("Employee", **list_kwargs)
	if not employees:
		return {"employees": []}

	emp_names = [e.name for e in employees]
	# Bounded by the employee list itself (at most len(emp_names) x number of
	# certificate types) — no heuristic cap needed, so none is passed.
	certs = frappe.get_all(
		"Employee Certificate",
		filters={"employee": ["in", emp_names]},
		fields=[
			"employee", "certificate_type", "certificate_no",
			"issue_date", "expiry_date", "status", "days_to_expiry",
		],
	)

	by_employee = {}
	for c in certs:
		by_employee.setdefault(c.employee, {})[c.certificate_type] = c

	for e in employees:
		e["certs"] = by_employee.get(e.name, {})

	return {"employees": employees}


# ---------------------------------------------------------------------------
# Dashboards
# ---------------------------------------------------------------------------

def _active_employees():
	return frappe.get_all(
		"Employee",
		filters={"status": "Active"},
		fields=["name", "certification_domain", "tracker_company"],
	)


def _is_eligible(applies_to, domain):
	"""Whether an employee in `domain` is expected to hold a certificate
	whose type is scoped to `applies_to` (mirrors the reference tracker's
	separate RT_CERTS/PT_CERTS catalogs, but driven by data, not code)."""
	if applies_to == "Protech (WL & MW)":
		return domain == PROTECH_DOMAIN
	if applies_to == "Resource Team":
		return domain != PROTECH_DOMAIN
	return True  # "Both" (or unset)


@frappe.whitelist()
def get_certificate_dashboard_stats():
	employees = _active_employees()
	domain_counts = {}
	for e in employees:
		key = e.certification_domain or "Unassigned"
		domain_counts[key] = domain_counts.get(key, 0) + 1

	status_rows = frappe.db.sql(
		"""
		SELECT ec.status, COUNT(*) AS count
		FROM `tabEmployee Certificate` ec
		INNER JOIN `tabEmployee` emp ON emp.name = ec.employee
		WHERE emp.status = 'Active'
		GROUP BY ec.status
		""",
		as_dict=True,
	)
	status_map = {row.status: row.count for row in status_rows}

	cost_row = frappe.db.sql(
		"""
		SELECT COALESCE(SUM(ct.renewal_cost), 0) AS total
		FROM `tabEmployee Certificate` ec
		INNER JOIN `tabEmployee` emp ON emp.name = ec.employee
		INNER JOIN `tabCertificate Type` ct ON ct.name = ec.certificate_type
		WHERE emp.status = 'Active' AND ec.status IN ('Expiring Soon', 'Expired')
		""",
		as_dict=True,
	)[0]

	return {
		"total_employees": len(employees),
		"domain_counts": domain_counts,
		"status_counts": {s: status_map.get(s, 0) for s in ALL_STATUSES},
		"cost_at_risk": flt(cost_row.total),
	}


@frappe.whitelist()
def get_certificate_status_summary(cohort=None):
	"""One row per Certificate Type with counts of Valid/Expiring/Expired/Not
	Issued among currently-Active employees eligible for that type.
	`cohort` optionally scopes to "resource" or "protech" only (mirrors the
	reference tracker's per-sheet Cert Status Summary selector); default /
	"all" / anything else is every Active employee."""
	cert_types = frappe.get_all(
		"Certificate Type",
		filters={"is_active": 1},
		fields=["name", "certificate_name", "applies_to"],
		order_by="certificate_name asc",
	)
	if cohort in ("resource", "protech"):
		employees = frappe.get_all("Employee", filters=_cohort_filters(cohort), fields=["name", "certification_domain"])
	else:
		employees = _active_employees()
	domain_by_emp = {e.name: e.certification_domain for e in employees}

	certs = frappe.get_all(
		"Employee Certificate",
		filters={"employee": ["in", list(domain_by_emp.keys())]},
		fields=["employee", "certificate_type", "status"],
	)
	status_by_emp_cert = {(c.employee, c.certificate_type): c.status for c in certs}

	summary = []
	for ct in cert_types:
		counts = {s: 0 for s in ALL_STATUSES}
		for emp_name, domain in domain_by_emp.items():
			if not _is_eligible(ct.applies_to, domain):
				continue
			status = status_by_emp_cert.get((emp_name, ct.name), "Not Issued")
			counts[status] = counts.get(status, 0) + 1
		summary.append({
			"certificate_type": ct.name,
			"applies_to": ct.applies_to,
			"counts": counts,
			"eligible_total": sum(counts.values()),
		})
	return summary


@frappe.whitelist()
def get_certificate_domain_summary():
	"""One row per Certification Domain: how many Active employees, and the
	status breakdown across all of their *eligible* certificate types
	combined (an employee missing an eligible cert entirely counts as "Not
	Issued" here too — same eligibility rule as get_certificate_status_summary,
	just grouped by domain instead of by certificate type)."""
	employees = _active_employees()
	domain_by_emp = {e.name: (e.certification_domain or "Unassigned") for e in employees}

	cert_types = frappe.get_all("Certificate Type", filters={"is_active": 1}, fields=["name", "applies_to"])
	certs = frappe.get_all(
		"Employee Certificate",
		filters={"employee": ["in", list(domain_by_emp.keys())]},
		fields=["employee", "certificate_type", "status"],
	)
	status_by_emp_cert = {(c.employee, c.certificate_type): c.status for c in certs}

	by_domain = {}
	for emp_name, domain in domain_by_emp.items():
		d = by_domain.setdefault(domain, {"domain": domain, "employees": 0, "counts": {s: 0 for s in ALL_STATUSES}})
		d["employees"] += 1
		for ct in cert_types:
			if not _is_eligible(ct.applies_to, domain):
				continue
			status = status_by_emp_cert.get((emp_name, ct.name), "Not Issued")
			d["counts"][status] += 1

	return sorted(by_domain.values(), key=lambda d: d["employees"], reverse=True)


# INET and Protech aren't separate subcontractor firms — they're already
# fully represented by the domain-based Innovation Team / Protech (WL & MW)
# trackers (certification_domain, not Company). Listing them again as their
# own dynamic tracker would double-count the same people from two angles
# (e.g. an INET-company, Fixed-Network employee shows up in both "Innovation
# Team" and a standalone "INET" tracker). Matches the reference tool's own
# SHEET_INFO, which likewise has no entry for either name.
NON_SUBCONTRACTOR_COMPANIES = {"INET", "PROTECH"}


@frappe.whitelist()
def list_tracker_companies():
	"""Active Certificate Tracker Company records (excluding INET/Protech —
	see NON_SUBCONTRACTOR_COMPANIES) + how many Active employees are on each
	— backs the sidebar's dynamic per-company trackers (one per subcontractor
	that actually has people, no hardcoded list)."""
	companies = frappe.get_all(
		"Certificate Tracker Company",
		filters={"status": "Active", "name": ["not in", list(NON_SUBCONTRACTOR_COMPANIES)]},
		fields=["name"], order_by="name asc",
	)
	counts = {c.name: c.count for c in frappe.get_all(
		"Employee", filters={"status": "Active", "tracker_company": ["is", "set"]},
		fields=["tracker_company as name", "count(name) as count"], group_by="tracker_company",
	)}
	return [{"name": c.name, "employees": counts.get(c.name, 0)} for c in companies if counts.get(c.name)]


@frappe.whitelist()
def get_certificate_company_summary():
	"""One row per Certificate Tracker Company (Mabran, Wabranco, ...): how
	many Active employees, and the status breakdown across all of their
	*eligible* certificate types combined. Same shape/eligibility rule as
	get_certificate_domain_summary, just grouped by company instead of
	domain — employees with no company set are excluded rather than lumped
	into an "Unassigned" bucket, since not every historical record has one."""
	employees = frappe.get_all(
		"Employee", filters={"status": "Active", "tracker_company": ["is", "set"]},
		fields=["name", "certification_domain", "tracker_company"],
	)
	if not employees:
		return []
	company_by_emp = {e.name: e.tracker_company for e in employees}
	domain_by_emp = {e.name: e.certification_domain for e in employees}

	cert_types = frappe.get_all("Certificate Type", filters={"is_active": 1}, fields=["name", "applies_to"])
	certs = frappe.get_all(
		"Employee Certificate",
		filters={"employee": ["in", list(company_by_emp.keys())]},
		fields=["employee", "certificate_type", "status"],
	)
	status_by_emp_cert = {(c.employee, c.certificate_type): c.status for c in certs}

	by_company = {}
	for emp_name, company in company_by_emp.items():
		c = by_company.setdefault(company, {"company": company, "employees": 0, "counts": {s: 0 for s in ALL_STATUSES}})
		c["employees"] += 1
		domain = domain_by_emp.get(emp_name)
		for ct in cert_types:
			if not _is_eligible(ct.applies_to, domain):
				continue
			status = status_by_emp_cert.get((emp_name, ct.name), "Not Issued")
			c["counts"][status] += 1

	return sorted(by_company.values(), key=lambda c: c["employees"], reverse=True)


@frappe.whitelist()
def list_employees_for_certificate(certificate_type, status=None, cohort=None):
	"""Drill-down for the Certificate Status Summary / Overview pages: every
	currently-Active, eligible employee for `certificate_type`, optionally
	narrowed to one status (a row missing entirely means "Not Issued") and to
	one cohort ("resource"/"protech"/a Certificate Tracker Company name) so a
	scoped summary page's drill-through doesn't pull in employees outside the
	sheet the user is looking at."""
	cohort_filters = _cohort_filters(cohort) if cohort else {}
	if cohort_filters:
		employees = frappe.get_all("Employee", filters=cohort_filters, fields=["name", "certification_domain", "tracker_company"])
	else:
		employees = _active_employees()
	cert_type = frappe.db.get_value("Certificate Type", certificate_type, "applies_to")
	eligible = {e.name: e.certification_domain for e in employees if _is_eligible(cert_type, e.certification_domain)}
	if not eligible:
		return []

	certs = frappe.get_all(
		"Employee Certificate",
		filters={"employee": ["in", list(eligible.keys())], "certificate_type": certificate_type},
		fields=["employee", "certificate_no", "issue_date", "expiry_date", "status", "days_to_expiry"],
	)
	cert_by_emp = {c.employee: c for c in certs}

	emp_names = frappe.get_all(
		"Employee",
		filters={"name": ["in", list(eligible.keys())]},
		fields=["name", "employee_name", "iqama_number", "designation", "tracker_company"],
	)

	rows = []
	for e in emp_names:
		cert = cert_by_emp.get(e.name)
		row_status = cert.status if cert else "Not Issued"
		if status and row_status != status:
			continue
		rows.append({
			"employee": e.name,
			"employee_name": e.employee_name,
			"iqama_number": e.iqama_number,
			"designation": e.designation,
			"certification_domain": eligible.get(e.name),
			"tracker_company": e.tracker_company,
			"certificate_no": cert.certificate_no if cert else None,
			"issue_date": cert.issue_date if cert else None,
			"expiry_date": cert.expiry_date if cert else None,
			"status": row_status,
			"days_to_expiry": cert.days_to_expiry if cert else None,
		})
	return rows


@frappe.whitelist()
def get_certificate_cost_summary(group_by="certificate_type"):
	"""Cost-at-risk = renewal_cost summed over Expiring/Expired rows for
	currently-Active employees, grouped by certificate_type / domain /
	employee."""
	if group_by not in ("certificate_type", "domain", "employee"):
		group_by = "certificate_type"

	rows = frappe.db.sql(
		"""
		SELECT
			ec.employee, emp.employee_name, emp.certification_domain,
			ec.certificate_type, ec.status, ct.renewal_cost
		FROM `tabEmployee Certificate` ec
		INNER JOIN `tabEmployee` emp ON emp.name = ec.employee
		INNER JOIN `tabCertificate Type` ct ON ct.name = ec.certificate_type
		WHERE emp.status = 'Active' AND ec.status IN ('Expiring Soon', 'Expired')
		""",
		as_dict=True,
	)

	groups = {}
	for row in rows:
		if group_by == "certificate_type":
			key = row.certificate_type
		elif group_by == "domain":
			key = row.certification_domain or "Unassigned"
		else:
			key = row.employee_name or row.employee
		g = groups.setdefault(key, {"key": key, "count": 0, "cost": 0.0})
		g["count"] += 1
		g["cost"] += flt(row.renewal_cost)

	result = sorted(groups.values(), key=lambda g: g["cost"], reverse=True)
	return {"rows": result, "grand_total": sum(g["cost"] for g in result)}


def _employees_for_costed_cohort(cohort):
	"""Unlike the rest of the tracker (Active-only 'eligibility'), the Cost
	page's reference behaviour includes Former Employees when no cohort is
	picked — matching the original tool's getCostEmployees(), whose "All
	Employees" option was rt+pt+fe combined, not just active staff."""
	fields = ["name", "employee_name", "certification_domain", "designation", "status"]
	if cohort in ("resource",):
		return frappe.get_all("Employee", filters={"status": "Active", "certification_domain": ["!=", PROTECH_DOMAIN]}, fields=fields)
	if cohort in ("protech",):
		return frappe.get_all("Employee", filters={"status": "Active", "certification_domain": PROTECH_DOMAIN}, fields=fields)
	if cohort in ("former",):
		return frappe.get_all("Employee", filters={"status": "Left"}, fields=fields)
	return frappe.get_all("Employee", fields=fields)  # "" / "all" — everyone


@frappe.whitelist()
def get_cost_page_data(cohort=None):
	"""Everything the Certificate Cost page's overview needs in one call:
	the per-certificate-type breakdown table, a cost-by-cohort chart (only
	meaningful when no single cohort is picked), and the per-employee cost
	detail table — all scoped to the same cohort filter."""
	employees = _employees_for_costed_cohort(cohort)
	emp_names = [e.name for e in employees]
	domain_by_emp = {e.name: e.certification_domain for e in employees}
	emp_lookup = {e.name: e for e in employees}

	cert_types = frappe.get_all(
		"Certificate Type", filters={"is_active": 1},
		fields=["name", "applies_to", "renewal_cost"], order_by="certificate_name asc",
	)
	cost_by_type = {ct.name: flt(ct.renewal_cost) for ct in cert_types}

	certs = []
	if emp_names:
		certs = frappe.get_all(
			"Employee Certificate", filters={"employee": ["in", emp_names]},
			fields=["employee", "certificate_type", "status", "expiry_date"],
		)
	status_by_emp_cert = {(c.employee, c.certificate_type): c.status for c in certs}
	expiry_by_emp_cert = {(c.employee, c.certificate_type): c.expiry_date for c in certs}

	type_rows = []
	for ct in cert_types:
		counts = {s: 0 for s in ALL_STATUSES}
		for emp_name in emp_names:
			if not _is_eligible(ct.applies_to, domain_by_emp.get(emp_name)):
				continue
			status = status_by_emp_cert.get((emp_name, ct.name), "Not Issued")
			counts[status] += 1
		renewal_needed = counts["Expiring Soon"] + counts["Expired"]
		holders = counts["Valid"] + counts["Expiring Soon"] + counts["Expired"]
		unit_cost = flt(ct.renewal_cost)
		type_rows.append({
			"certificate_type": ct.name,
			"unit_cost": unit_cost,
			"holders": holders,
			"valid": counts["Valid"], "expiring": counts["Expiring Soon"], "expired": counts["Expired"],
			"renewal_needed": renewal_needed,
			"expiring_cost": counts["Expiring Soon"] * unit_cost,
			"expired_cost": counts["Expired"] * unit_cost,
			"total_cost": renewal_needed * unit_cost,
			# Cost if every current holder (not just those due for renewal)
			# were renewed — a second, larger figure for budgeting purposes.
			"all_holders_cost": holders * unit_cost,
		})

	cost_by_cohort = {}
	for c in certs:
		if c.status not in ("Expiring Soon", "Expired"):
			continue
		emp = emp_lookup.get(c.employee)
		if emp is None:
			continue
		if emp.get("status") == "Left":
			grp = "Former"
		elif domain_by_emp.get(c.employee) == PROTECH_DOMAIN:
			grp = "Protech"
		else:
			grp = "Resource"
		cost_by_cohort[grp] = cost_by_cohort.get(grp, 0.0) + cost_by_type.get(c.certificate_type, 0)

	# Per-employee breakdown, one column per certificate type that currently
	# carries a renewal cost (mirrors the reference tool's 4 hardcoded
	# priced columns, but data-driven so it grows as HR prices more types).
	# Includes every employee in scope, not just those with cost > 0, so the
	# frontend can offer a "No Renewal Needed" filter like the original.
	priced_types = [ct for ct in cert_types if flt(ct.renewal_cost) > 0]
	employee_rows = []
	for emp_name in emp_names:
		emp = emp_lookup.get(emp_name, {})
		row_certs = {}
		total_cost = 0.0
		renewal_count = 0
		for ct in priced_types:
			if not _is_eligible(ct.applies_to, domain_by_emp.get(emp_name)):
				continue
			status = status_by_emp_cert.get((emp_name, ct.name), "Not Issued")
			needs_renewal = status in ("Expiring Soon", "Expired")
			cost = cost_by_type.get(ct.name, 0) if needs_renewal else 0
			row_certs[ct.name] = {
				"status": status, "cost": cost,
				"expiry_date": expiry_by_emp_cert.get((emp_name, ct.name)),
			}
			if needs_renewal:
				total_cost += cost
				renewal_count += 1
		employee_rows.append({
			"employee": emp_name, "employee_name": emp.get("employee_name") or emp_name,
			"certification_domain": emp.get("certification_domain"),
			"certs": row_certs, "count": renewal_count, "cost": total_cost,
		})
	employee_rows.sort(key=lambda r: r["cost"], reverse=True)

	return {
		"employees_count": len(employees),
		"type_rows": type_rows,
		"cost_by_cohort": cost_by_cohort,
		"employee_rows": employee_rows,
		"priced_cert_types": [ct.name for ct in priced_types],
		"grand_total": sum(r["total_cost"] for r in type_rows),
		"grand_total_all_holders": sum(r["all_holders_cost"] for r in type_rows),
	}


@frappe.whitelist()
def get_expiring_certificates(days=90):
	days = cint(days) or 90
	return frappe.db.sql(
		"""
		SELECT
			ec.name, ec.employee, emp.employee_name, emp.certification_domain,
			emp.designation, ec.certificate_type, ec.certificate_no,
			ec.expiry_date, ec.status, ec.days_to_expiry
		FROM `tabEmployee Certificate` ec
		INNER JOIN `tabEmployee` emp ON emp.name = ec.employee
		WHERE emp.status = 'Active'
			AND ec.status IN ('Expiring Soon', 'Expired')
			AND ec.days_to_expiry <= %s
		ORDER BY ec.days_to_expiry ASC
		""",
		(days,),
		as_dict=True,
	)


@frappe.whitelist()
def get_certificates_by_status(status):
	"""Flat list of Employee Certificate rows for Active employees in a
	single status (Valid / Expiring Soon / Expired) — backs the Dashboard's
	clickable stat cards and status-doughnut drill-down modal."""
	return frappe.db.sql(
		"""
		SELECT
			ec.name, ec.employee, emp.employee_name, emp.certification_domain, emp.tracker_company,
			emp.designation, emp.iqama_number, emp.cell_number, ec.certificate_type,
			ec.certificate_no, ec.expiry_date, ec.status, ec.days_to_expiry
		FROM `tabEmployee Certificate` ec
		INNER JOIN `tabEmployee` emp ON emp.name = ec.employee
		WHERE emp.status = 'Active' AND ec.status = %s
		ORDER BY ec.days_to_expiry ASC
		""",
		(status,),
		as_dict=True,
	)


# ---------------------------------------------------------------------------
# Create Employee (from the tracker page)
# ---------------------------------------------------------------------------

def _default_company():
	company = frappe.db.get_single_value("Global Defaults", "default_company")
	if company:
		return company
	companies = frappe.get_all("Company", limit_page_length=1, pluck="name")
	return companies[0] if companies else None


@frappe.whitelist()
def create_employee(payload):
	"""Add a new Employee directly from the tracker. Unlike the one-off
	historical import (which had no choice but to leave gender/DOB/DOJ blank
	for records with no such data), this is a live form filled in by a
	person right now — so Frappe's real mandatory-field validation
	(company, status, gender, first_name, date_of_joining, date_of_birth)
	is NOT bypassed here. A missing field surfaces as a normal
	ValidationError with a clear message for the frontend to show."""
	if isinstance(payload, str):
		payload = frappe.parse_json(payload)

	full_name = (payload.get("employee_name") or "").strip()
	if not full_name:
		frappe.throw(_("Employee Name is required."))

	iqama = (payload.get("iqama_number") or "").strip()
	if not iqama:
		# Employee Number is mandatory on this site (Property Setter) and
		# doubles as the Employee ID (see set_employee_autoname) — without
		# an Iqama there's nothing to name the record by.
		frappe.throw(_("Iqama / National ID is required."))
	if frappe.db.exists("Employee", {"iqama_number": iqama}):
		frappe.throw(_("An employee with Iqama/National ID {0} already exists.").format(iqama))

	company = _default_company()
	if not company:
		frappe.throw(_("No Company found on this site — create one first."))

	parts = full_name.split()
	doc = frappe.new_doc("Employee")
	doc.first_name = parts[0] if parts else full_name
	if len(parts) > 1:
		doc.last_name = " ".join(parts[1:])
	doc.employee_name = full_name
	doc.company = company
	doc.status = payload.get("status") or "Active"
	doc.gender = payload.get("gender")
	doc.date_of_birth = payload.get("date_of_birth")
	doc.date_of_joining = payload.get("date_of_joining")
	doc.relieving_date = payload.get("relieving_date")
	doc.cell_number = payload.get("cell_number")
	doc.personal_email = payload.get("personal_email")
	doc.iqama_number = iqama or None
	# Employee Number doubles as the actual Employee ID on this site (see
	# set_employee_autoname) — matches production's convention, where an
	# employee's ID *is* their employee number.
	doc.employee_number = iqama or None
	doc.nationality = payload.get("nationality")
	doc.uniportal_id = payload.get("uniportal_id")
	doc.certification_domain = payload.get("certification_domain")
	doc.tracker_company = payload.get("tracker_company")
	doc.designation = payload.get("designation")
	doc.insert()
	return doc.as_dict()


@frappe.whitelist()
def update_employee(name, payload):
	"""Edit an existing Employee's basic info from the tracker's Edit modal.
	Same mandatory-field rules as create_employee — a cleared gender/DOB/DOJ
	surfaces as a normal validation error rather than being silently allowed."""
	if isinstance(payload, str):
		payload = frappe.parse_json(payload)

	doc = frappe.get_doc("Employee", name)

	full_name = (payload.get("employee_name") or "").strip()
	if full_name:
		parts = full_name.split()
		doc.first_name = parts[0] if parts else full_name
		doc.last_name = " ".join(parts[1:]) if len(parts) > 1 else None
		doc.employee_name = full_name

	iqama = (payload.get("iqama_number") or "").strip()
	if iqama and iqama != doc.iqama_number and frappe.db.exists("Employee", {"iqama_number": iqama, "name": ["!=", name]}):
		frappe.throw(_("Another employee already has Iqama/National ID {0}.").format(iqama))

	for field in ("status", "gender", "date_of_birth", "date_of_joining", "relieving_date",
	              "cell_number", "personal_email", "nationality", "uniportal_id",
	              "certification_domain", "tracker_company", "designation"):
		if field in payload:
			doc.set(field, payload.get(field) or None)
	if "iqama_number" in payload:
		doc.iqama_number = iqama or None
		# Keep Employee Number in sync with Iqama (see set_employee_autoname)
		# — a corrected Iqama should carry through, though correcting it
		# after the fact does NOT rename the already-created record itself
		# (autoname only runs once, on insert).
		if iqama:
			doc.employee_number = iqama

	doc.save()
	return doc.as_dict()


@frappe.whitelist()
def delete_employee(name):
	"""Delete an Employee and their certificate records. Destructive —
	the frontend must confirm before calling this."""
	if not frappe.db.exists("Employee", name):
		frappe.throw(_("Employee {0} not found.").format(name))
	for cert_name in frappe.get_all("Employee Certificate", filters={"employee": name}, pluck="name"):
		frappe.delete_doc("Employee Certificate", cert_name, ignore_permissions=True)
	frappe.delete_doc("Employee", name)
	frappe.db.commit()
	return {"deleted": name}


@frappe.whitelist()
def global_search_employees(query=None, status_filter=None, cohort=None):
	"""Search across ALL employees (Active + Left) at once — the tracker is
	a standalone page, not Desk, so there's no Ctrl+G fallback to lean on
	the way the PMS portal can. `cohort` accepts "resource"/"protech"/
	"former" or any Certificate Tracker Company name (see _cohort_filters)."""
	filters = _cohort_filters(cohort) if cohort else {}

	fields = ["name", "employee_name", "iqama_number", "cell_number", "certification_domain",
	          "tracker_company", "designation", "status"]
	query = (query or "").strip()
	if query:
		# frappe.get_all doesn't do OR directly — search name/iqama/mobile separately and merge.
		matches = {}
		for field in ("employee_name", "iqama_number", "cell_number"):
			for e in frappe.get_all("Employee", filters={**filters, field: ["like", f"%{query}%"]}, fields=fields):
				matches[e.name] = e
		employees = list(matches.values())
	else:
		employees = frappe.get_all("Employee", filters=filters, fields=fields, limit_page_length=200)

	if not employees:
		return {"employees": []}

	emp_names = [e.name for e in employees]
	certs = frappe.get_all(
		"Employee Certificate",
		filters={"employee": ["in", emp_names]},
		fields=["employee", "certificate_type", "certificate_no", "issue_date", "expiry_date", "status", "days_to_expiry"],
	)
	by_employee = {}
	for c in certs:
		by_employee.setdefault(c.employee, {})[c.certificate_type] = c

	for e in employees:
		certs_for_e = by_employee.get(e.name, {})
		e["certs"] = certs_for_e
		statuses = {c.status for c in certs_for_e.values()}
		if "Expired" in statuses:
			e["overall_status"] = "Expired"
		elif "Expiring Soon" in statuses:
			e["overall_status"] = "Expiring Soon"
		elif statuses:
			e["overall_status"] = "Valid"
		else:
			e["overall_status"] = "Not Issued"

	if status_filter:
		employees = [e for e in employees if e["overall_status"] == status_filter]

	employees.sort(key=lambda e: e["employee_name"] or "")
	return {"employees": employees[:200]}


# ---------------------------------------------------------------------------
# Create / update one certificate row
# ---------------------------------------------------------------------------

@frappe.whitelist()
def upsert_employee_certificate(employee, certificate_type, certificate_no=None,
                                 issue_date=None, expiry_date=None, remarks=None):
	if not employee or not certificate_type:
		frappe.throw(_("Employee and Certificate Type are required."))

	existing = frappe.db.get_value(
		"Employee Certificate",
		{"employee": employee, "certificate_type": certificate_type},
		"name",
	)
	doc = frappe.get_doc("Employee Certificate", existing) if existing else frappe.new_doc("Employee Certificate")
	doc.employee = employee
	doc.certificate_type = certificate_type
	doc.certificate_no = certificate_no
	doc.issue_date = issue_date or None
	doc.expiry_date = expiry_date or None
	doc.remarks = remarks
	doc.save()
	return doc.as_dict()


# ---------------------------------------------------------------------------
# Certificate attachments — plain Frappe multi-file attachments (no Attach
# field on the doctype), so a certificate can have more than one file
# (front/back, multiple pages, etc.) instead of being limited to one.
# ---------------------------------------------------------------------------

@frappe.whitelist()
def list_certificate_attachments(employee, certificate_type):
	name = frappe.db.get_value(
		"Employee Certificate", {"employee": employee, "certificate_type": certificate_type}, "name"
	)
	if not name:
		return []
	return frappe.get_all(
		"File",
		filters={"attached_to_doctype": "Employee Certificate", "attached_to_name": name},
		fields=["name", "file_name", "file_url"],
		order_by="creation desc",
	)


@frappe.whitelist()
def list_employee_certificate_attachments(employee):
	"""Bulk endpoint: every attachment across ALL of one employee's
	certificates in a single query, keyed by certificate_type. Backs the
	read-only Employee Detail modal's certificate cards — never loop
	list_certificate_attachments() once per certificate type from the
	frontend."""
	cert_docs = frappe.get_all("Employee Certificate", filters={"employee": employee}, fields=["name", "certificate_type"])
	if not cert_docs:
		return {}
	type_by_cert_name = {c.name: c.certificate_type for c in cert_docs}
	files = frappe.get_all(
		"File",
		filters={"attached_to_doctype": "Employee Certificate", "attached_to_name": ["in", list(type_by_cert_name.keys())]},
		fields=["name", "file_name", "file_url", "attached_to_name"],
		order_by="creation desc",
	)
	result = {}
	for f in files:
		cert_type = type_by_cert_name.get(f.attached_to_name)
		if not cert_type:
			continue
		result.setdefault(cert_type, []).append({"name": f.name, "file_name": f.file_name, "file_url": f.file_url})
	return result


@frappe.whitelist()
def delete_certificate_attachment(file_name):
	doc = frappe.get_doc("File", file_name)
	if doc.attached_to_doctype != "Employee Certificate":
		frappe.throw(_("Not a certificate attachment."))
	frappe.delete_doc("File", file_name, ignore_permissions=True)
	return {"deleted": file_name}


@frappe.whitelist()
def bulk_upsert_employee_certificates(rows):
	"""Bulk renewal — a CSV/Excel upload with columns Employee (Employee ID
	or Iqama/National ID), Certificate Type, Certificate No, Issue Date,
	Expiry Date. One row per (employee, certificate_type); matches the
	tracker's real-world pattern of renewing many people at once after a
	single training/inspection event, instead of one click each."""
	if isinstance(rows, str):
		rows = frappe.parse_json(rows)

	summary = {"created": 0, "updated": 0, "errors": []}
	for i, row in enumerate(rows or []):
		row_no = i + 2  # +1 for 0-index, +1 for the header row a spreadsheet would have
		try:
			employee = (row.get("employee") or "").strip()
			if employee and not frappe.db.exists("Employee", employee):
				employee = ""
			if not employee and row.get("iqama_number"):
				employee = frappe.db.get_value("Employee", {"iqama_number": row["iqama_number"].strip()}, "name") or ""
			if not employee:
				summary["errors"].append({"row": row_no, "error": "Employee not found (checked Employee ID and Iqama/ID)"})
				continue

			certificate_type = (row.get("certificate_type") or "").strip()
			if not certificate_type or not frappe.db.exists("Certificate Type", certificate_type):
				summary["errors"].append({"row": row_no, "error": f"Unknown Certificate Type: {certificate_type!r}"})
				continue

			existing = frappe.db.get_value(
				"Employee Certificate", {"employee": employee, "certificate_type": certificate_type}, "name"
			)
			doc = frappe.get_doc("Employee Certificate", existing) if existing else frappe.new_doc("Employee Certificate")
			doc.employee = employee
			doc.certificate_type = certificate_type
			if row.get("certificate_no"):
				doc.certificate_no = row["certificate_no"]
			if row.get("issue_date"):
				doc.issue_date = row["issue_date"]
			if row.get("expiry_date"):
				doc.expiry_date = row["expiry_date"]
			doc.save()
			summary["updated" if existing else "created"] += 1
		except Exception as e:
			summary["errors"].append({"row": row_no, "error": str(e)})

	frappe.db.commit()
	return summary


# ---------------------------------------------------------------------------
# Full sync from the reference tracker's Excel layout — unlike
# bulk_upsert_employee_certificates above (cert-only renewals for employees
# that already exist), this can create brand-new Employees too, so the
# whole sheet can be uploaded directly and this bench ends up matching it.
# ---------------------------------------------------------------------------

_SHEET_STATUS_MAP = {
	"current employee": "Active",
	"former employee": "Left",
	"blocked": "Suspended",
	# ERPNext's Employee.validate() hardcodes its valid status list in Python
	# (Active/Inactive/Suspended/Left) independent of the Select field's
	# options, so a Property Setter alone can't add a real "Pending" status
	# — it would just fail validation on every save. Pending resources are
	# presumably still working, so they're treated as Active; nothing else
	# in the sheet is lost since this cohort is otherwise fully captured by
	# Certificate Tracker Company + Certification Domain.
	"pending": "Active",
	"active": "Active",
	"inactive": "Inactive",
	"suspended": "Suspended",
	"left": "Left",
}

_TRACKER_DESIGNATION_ALIASES = {
	"document": "Document Controller",
	"team leader": "Team Leader",  # normalizes the sheet's "Team leader" casing variant
}


def _ensure_master(doctype, name_field, name, cache=None):
	"""Find-or-create a lightweight master record by name. `cache`, when
	given, is a set shared across every call for the SAME doctype within
	one batch (e.g. one tracker sync) — most rows repeat the same handful
	of domain/company/designation values, so without it this is a wasted
	`frappe.db.exists()` round trip on every single row."""
	name = (name or "").strip()
	if not name:
		return None
	if cache is not None and name in cache:
		return name
	if not frappe.db.exists(doctype, name):
		frappe.get_doc({"doctype": doctype, name_field: name}).insert(ignore_permissions=True)
	if cache is not None:
		cache.add(name)
	return name


def _ensure_tracker_domain(name, cache=None):
	return _ensure_master("Certification Domain", "domain_name", name, cache)


def _ensure_tracker_company_master(name, cache=None):
	return _ensure_master("Certificate Tracker Company", "company_name", name, cache)


def _ensure_tracker_designation(name, cache=None):
	name = (name or "").strip()
	if not name:
		return None
	name = _TRACKER_DESIGNATION_ALIASES.get(name.lower(), name)
	return _ensure_master("Designation", "designation_name", name, cache)


def _ensure_employment_type(name, cache=None):
	name = (name or "").strip()
	if not name:
		return None
	if cache is not None and name in cache:
		return name
	if not frappe.db.exists("Employment Type", name):
		frappe.get_doc({"doctype": "Employment Type", "employee_type_name": name}).insert(ignore_permissions=True)
	if cache is not None:
		cache.add(name)
	return name


def _random_placeholder_gender():
	genders = frappe.get_all("Gender", pluck="name") or ["Male"]
	return random.choice(genders)


def _random_placeholder_dob():
	"""A plausible working-age adult (20-55 years old) — only used when a
	brand-new employee's sheet row has no DOB at all, so Frappe's mandatory
	field validation passes with a real value instead of either being
	bypassed (as the one-off historical import did) or blocking the row."""
	years_ago = random.randint(20, 55)
	days_jitter = random.randint(0, 364)
	return frappe.utils.add_days(frappe.utils.add_years(frappe.utils.nowdate(), -years_ago), -days_jitter)


@frappe.whitelist()
def sync_employees_from_tracker_sheet(rows):
	"""Upload the full reference tracker Excel (S.NO / Name / Iqama / Mobile /
	Nationality / Email / Domain / Region / Position / Driver / Subcon /
	Company Name / Uniportal / Status / Remarks, then Cert No./Start/Expiry
	per certificate type) and sync it straight into Employee + Employee
	Certificate — creating brand-new employees, not just renewing certs for
	ones that already exist (see bulk_upsert_employee_certificates for that
	narrower case). Domain / Designation / Certificate Tracker Company
	values are auto-created if the sheet names one that doesn't exist yet,
	so re-running this after the sheet changes keeps the bench in sync with
	it. Dedupes Employees by Iqama/National ID, same as the one-off
	historical import.

	A brand-new employee's sheet row never has gender/date_of_birth/
	date_of_joining (the sheet has no such columns) — Frappe's Employee
	doctype requires all three. Rather than bypass that validation, a new
	employee gets minimal random-but-valid placeholder values so the row
	imports cleanly; every such employee is listed back in the summary so
	HR knows exactly who to go correct."""
	if isinstance(rows, str):
		rows = frappe.parse_json(rows)

	company = _default_company()
	if not company:
		frappe.throw(_("No Company found on this site — create one before running this import."))

	# Bulk pre-fetch instead of a handful of lookup queries PER ROW — a
	# ~150-row sheet was otherwise issuing 1,500+ individual `db.get_value`/
	# `db.exists` round trips before a single document even got saved, slow
	# enough to blow past the webserver's own request timeout (504) even
	# before this got moved to a background job.
	existing_by_iqama = dict(frappe.db.sql(
		"SELECT iqama_number, name FROM `tabEmployee` WHERE IFNULL(iqama_number, '') != ''"
	))
	existing_by_empnum = dict(frappe.db.sql(
		"SELECT employee_number, name FROM `tabEmployee` WHERE IFNULL(employee_number, '') != ''"
	))
	existing_employee_names = set(frappe.db.sql_list("SELECT name FROM `tabEmployee`"))
	valid_cert_types = set(frappe.db.sql_list("SELECT name FROM `tabCertificate Type`"))
	existing_certs = {
		(c.employee, c.certificate_type): c.name
		for c in frappe.db.sql(
			"SELECT employee, certificate_type, name FROM `tabEmployee Certificate`", as_dict=True
		)
	}
	domain_cache, company_cache, designation_cache, employment_type_cache = set(), set(), set(), set()

	summary = {
		"employees_created": 0, "employees_updated": 0, "employees_skipped": 0,
		"certs_created": 0, "certs_updated": 0,
		"placeholder_personal_data": [],
		"errors": [],
	}

	for i, row in enumerate(rows or []):
		row_no = i + 6  # +1 for 0-index, +5 for this sheet's title/subtitle/header/subheader rows
		try:
			iqama = str(row.get("iqama") or "").strip()
			employee_name = (row.get("employee_name") or "").strip()
			if not iqama:
				summary["errors"].append({"row": row_no, "error": "No Iqama/National ID to dedupe on — skipped"})
				summary["employees_skipped"] += 1
				continue

			# Some sites (e.g. production, before this app's custom fields
			# existed there) already name/number their Employees by Iqama
			# without the iqama_number field itself ever being populated.
			# Falling back through employee_number and the docname itself
			# means this dedupe still finds them correctly instead of trying
			# to insert a duplicate that collides with the existing ID.
			existing = (
				existing_by_iqama.get(iqama)
				or existing_by_empnum.get(iqama)
				or (iqama if iqama in existing_employee_names else None)
			)
			is_new = not existing
			doc = frappe.get_doc("Employee", existing) if existing else frappe.new_doc("Employee")

			if is_new:
				parts = employee_name.split()
				doc.first_name = parts[0] if parts else (employee_name or iqama)
				if len(parts) > 1:
					doc.last_name = " ".join(parts[1:])
				doc.company = company
				doc.status = "Active"

			doc.employee_name = employee_name or doc.employee_name or iqama
			doc.iqama_number = iqama
			# Production names Employees off employee_number (its Employee ID
			# is the Iqama Number, not this bench's HR-EMP- series) — keep
			# that field populated to match regardless of which naming
			# scheme is actually active on the site this runs against.
			doc.employee_number = iqama
			if row.get("cell_number"):
				doc.cell_number = row["cell_number"]
			if row.get("nationality"):
				doc.nationality = row["nationality"]
			if row.get("personal_email"):
				doc.personal_email = row["personal_email"]
			if row.get("uniportal_id"):
				doc.uniportal_id = row["uniportal_id"]

			domain_name = _ensure_tracker_domain(row.get("certification_domain"), cache=domain_cache)
			if domain_name:
				doc.certification_domain = domain_name

			company_name = _ensure_tracker_company_master(row.get("tracker_company"), cache=company_cache)
			if company_name:
				doc.tracker_company = company_name
				# Business rule from HR: every subcontractor firm's resource is
				# on a Contract; only INET's own staff aren't. Only ever sets
				# "Contract" — never clears/overwrites an INET employee's
				# employment_type, since no replacement value was specified
				# for that side of the rule.
				if company_name.strip().upper() != "INET":
					doc.employment_type = _ensure_employment_type("Contract", cache=employment_type_cache)

			designation_name = _ensure_tracker_designation(row.get("designation"), cache=designation_cache)
			if designation_name:
				doc.designation = designation_name

			mapped_status = _SHEET_STATUS_MAP.get(str(row.get("status") or "").strip().lower())
			if mapped_status:
				doc.status = mapped_status
			if doc.status == "Left" and not doc.relieving_date:
				# ERPNext requires a relieving_date for status=Left; the sheet
				# has no real termination date, so today's date is flagged as
				# an explicit placeholder for HR to correct per person.
				doc.relieving_date = frappe.utils.nowdate()

			# Whether brand-new or an existing record from the earlier
			# historical import (which deliberately left these blank —
			# ignore_mandatory was used there since the data genuinely didn't
			# exist), a full doc.save() re-validates every mandatory field,
			# not just the ones this sync touches. Backfilling a minimal
			# random placeholder here — rather than leaving it blank — is
			# what keeps this sync from failing on every such row. Resolved
			# AFTER status/relieving_date above so a placeholder Date of
			# Joining for an already-Left employee lands before their
			# relieving date, not after it.
			needs_placeholder = not (doc.gender and doc.date_of_birth and doc.date_of_joining)
			if needs_placeholder:
				doc.gender = doc.gender or _random_placeholder_gender()
				doc.date_of_birth = doc.date_of_birth or _random_placeholder_dob()
				if not doc.date_of_joining:
					doc.date_of_joining = (
						frappe.utils.add_days(doc.relieving_date, -random.randint(30, 730))
						if doc.relieving_date else frappe.utils.nowdate()
					)
				summary["placeholder_personal_data"].append(employee_name or iqama)

			if is_new:
				doc.insert(ignore_permissions=True)
				# Keep the pre-fetched lookup maps current in case the same
				# Iqama appears twice in one upload (a duplicate row) — the
				# second occurrence should update this same record, not try
				# to insert another one.
				existing_by_iqama[iqama] = doc.name
				existing_employee_names.add(doc.name)
			else:
				# ignore_version: this bulk sync can touch hundreds of
				# documents in one run — skipping the audit-trail Version
				# snapshot on each update meaningfully cuts save() overhead
				# and isn't needed for HR data re-synced straight from the
				# source spreadsheet.
				doc.save(ignore_permissions=True, ignore_version=True)
			summary["employees_" + ("created" if is_new else "updated")] += 1

			for cert_type, cert in (row.get("certs") or {}).items():
				if not (cert.get("no") or cert.get("expiry")):
					continue
				if cert_type not in valid_cert_types:
					summary["errors"].append({"row": row_no, "error": f"Unknown Certificate Type: {cert_type!r}"})
					continue
				try:
					cert_existing = existing_certs.get((doc.name, cert_type))
					cdoc = frappe.get_doc("Employee Certificate", cert_existing) if cert_existing else frappe.new_doc("Employee Certificate")
					cdoc.employee = doc.name
					cdoc.certificate_type = cert_type
					if cert.get("no"):
						cdoc.certificate_no = cert["no"]
					if cert.get("start"):
						cdoc.issue_date = cert["start"]
					if cert.get("expiry"):
						cdoc.expiry_date = cert["expiry"]
					if cert_existing:
						cdoc.save(ignore_permissions=True, ignore_version=True)
					else:
						cdoc.insert(ignore_permissions=True)
						existing_certs[(doc.name, cert_type)] = cdoc.name
					summary["certs_" + ("updated" if cert_existing else "created")] += 1
				except Exception as e:
					# A malformed date in just this one certificate shouldn't
					# block the employee's other certificates in the same row
					# (a few rows in the source sheet have typos like
					# "20-072026" or "01/06//2027") — flag it and move on.
					summary["errors"].append({"row": row_no, "error": f"{cert_type}: {e}"})
		except Exception as e:
			summary["errors"].append({"row": row_no, "error": str(e)})

		if (i + 1) % 20 == 0:
			# Commit periodically rather than once at the very end — a large
			# sheet holding one huge open transaction for the whole run is
			# needless lock contention, and this way a worker restart or
			# crash partway through doesn't lose everything already done.
			frappe.db.commit()

	frappe.db.commit()
	return summary


@frappe.whitelist()
def enqueue_tracker_sync(rows):
	"""Runs sync_employees_from_tracker_sheet in the background instead of
	inline. Syncing 150+ employees and several hundred certificates in one
	HTTP request routinely takes long enough to hit the webserver's own
	request timeout (a 504, not a real failure — the frontend has no way
	to tell the difference). This just queues the work and hands back a
	job_id; the frontend polls check_tracker_sync_status() until it's
	done, however long that actually takes."""
	if isinstance(rows, str):
		rows = frappe.parse_json(rows)
	job_id = frappe.generate_hash(length=12)
	frappe.enqueue(
		"inet_app.api.hr_certificates.sync_employees_from_tracker_sheet",
		queue="long",
		timeout=3600,
		job_id=job_id,
		rows=rows,
	)
	return {"job_id": job_id}


@frappe.whitelist()
def check_tracker_sync_status(job_id):
	from frappe.utils.background_jobs import get_job

	job = get_job(job_id)
	if job is None:
		return {"status": "unknown"}
	status = job.get_status(refresh=True)
	if status == "finished":
		return {"status": "finished", "result": job.result}
	if status == "failed":
		exc = job.exc_info or "Unknown error"
		return {"status": "failed", "error": str(exc)[-2000:]}
	return {"status": status or "queued"}


# ---------------------------------------------------------------------------
# Renewal history (Frappe's own Version log — no extra tracking needed)
# ---------------------------------------------------------------------------

HISTORY_FIELDS = {"certificate_no", "issue_date", "expiry_date", "remarks"}


@frappe.whitelist()
def get_certificate_history(employee, certificate_type):
	name = frappe.db.get_value(
		"Employee Certificate", {"employee": employee, "certificate_type": certificate_type}, "name"
	)
	if not name:
		return []

	versions = frappe.get_all(
		"Version",
		filters={"ref_doctype": "Employee Certificate", "docname": name},
		fields=["owner", "creation", "data"],
		order_by="creation desc",
	)
	history = []
	for v in versions:
		try:
			data = frappe.parse_json(v.data)
		except Exception:
			continue
		changes = [
			{"field": c[0], "old": c[1], "new": c[2]}
			for c in (data.get("changed") or [])
			if c[0] in HISTORY_FIELDS
		]
		if changes:
			history.append({"modified": v.creation, "modified_by": v.owner, "changes": changes})
	return history


# ---------------------------------------------------------------------------
# Forward-looking renewal forecast
# ---------------------------------------------------------------------------

@frappe.whitelist()
def get_certificate_renewal_forecast():
	"""12-month-forward renewal calendar for Active employees' certificates —
	grouped by the month they actually expire, regardless of today's status
	(so it includes certs not yet "Expiring Soon" but due within the year),
	for HR budget planning rather than only reacting to what's already due."""
	return frappe.db.sql(
		"""
		SELECT DATE_FORMAT(ec.expiry_date, '%Y-%m') AS month, COUNT(*) AS count, COALESCE(SUM(ct.renewal_cost), 0) AS cost
		FROM `tabEmployee Certificate` ec
		INNER JOIN `tabEmployee` emp ON emp.name = ec.employee
		INNER JOIN `tabCertificate Type` ct ON ct.name = ec.certificate_type
		WHERE emp.status = 'Active'
			AND ec.expiry_date IS NOT NULL
			AND ec.expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 12 MONTH)
		GROUP BY month
		ORDER BY month ASC
		""",
		as_dict=True,
	)


# ---------------------------------------------------------------------------
# Scheduled job
# ---------------------------------------------------------------------------

def daily_certificate_status_refresh():
	"""Scheduled daily (see hooks.py). Recomputes status/days_to_expiry on
	every Employee Certificate row so dashboards/list filters stay accurate
	even on rows nobody has touched.

	Does NOT send any alerts itself — expiry notifications are handled by
	core Frappe's own Notification (Setup > Notification) "Days Before"
	trigger on Employee Certificate.expiry_date, so HR can tune
	thresholds/recipients from the Desk without a code change."""
	frappe.db.sql(
		"""
		UPDATE `tabEmployee Certificate`
		SET
			-- days_to_expiry is a non-nullable Int column (Frappe's Python-side
			-- ORM silently coerces None -> 0 for Int fields; raw SQL doesn't, so
			-- it must be spelled out here or a NULL expiry_date row throws).
			days_to_expiry = CASE
				WHEN expiry_date IS NULL THEN 0
				ELSE DATEDIFF(expiry_date, CURDATE())
			END,
			status = CASE
				WHEN (certificate_no IS NULL OR certificate_no = '') AND expiry_date IS NULL THEN 'Not Issued'
				WHEN expiry_date IS NULL THEN 'Valid'
				WHEN DATEDIFF(expiry_date, CURDATE()) < 0 THEN 'Expired'
				WHEN DATEDIFF(expiry_date, CURDATE()) <= 90 THEN 'Expiring Soon'
				ELSE 'Valid'
			END
		"""
	)
	frappe.db.commit()
