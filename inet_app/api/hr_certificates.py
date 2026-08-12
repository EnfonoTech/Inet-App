"""INET Certificate Tracker (INET HR).

Reads/writes only Employee Certificate / Certificate Type / Certification
Domain, and *reads* Employee for names/teams. Nothing here writes to any PMS
workflow doctype (PO Dispatch, Rollout Plan, Daily Execution, Work Done, ...)
— see apps/inet_app/CLAUDE.md guardrail notes in the build plan.
"""

import frappe
from frappe import _
from frappe.utils import cint, flt

PROTECH_DOMAIN = "WL & MW"

ALL_STATUSES = ["Valid", "Expiring Soon", "Expired", "Not Issued"]


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
	Former is purely Employee.status, independent of domain."""
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
			"certification_domain", "status",
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
		fields=["name", "certification_domain"],
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


@frappe.whitelist()
def list_employees_for_certificate(certificate_type, status=None, cohort=None):
	"""Drill-down for the Certificate Status Summary / Overview pages: every
	currently-Active, eligible employee for `certificate_type`, optionally
	narrowed to one status (a row missing entirely means "Not Issued") and to
	one cohort ("resource"/"protech") so a scoped summary page's drill-through
	doesn't pull in employees outside the sheet the user is looking at."""
	if cohort in ("resource", "protech"):
		employees = frappe.get_all("Employee", filters=_cohort_filters(cohort), fields=["name", "certification_domain"])
	else:
		employees = _active_employees()
	cert_type = frappe.db.get_value("Certificate Type", certificate_type, "applies_to")
	eligible = {e.name: e.certification_domain for e in employees if _is_eligible(cert_type, e.certification_domain)}
	if not eligible:
		return []

	certs = frappe.get_all(
		"Employee Certificate",
		filters={"employee": ["in", list(eligible.keys())], "certificate_type": certificate_type},
		fields=["employee", "certificate_no", "expiry_date", "status", "days_to_expiry"],
	)
	cert_by_emp = {c.employee: c for c in certs}

	emp_names = frappe.get_all(
		"Employee",
		filters={"name": ["in", list(eligible.keys())]},
		fields=["name", "employee_name", "designation"],
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
			"designation": e.designation,
			"certification_domain": eligible.get(e.name),
			"certificate_no": cert.certificate_no if cert else None,
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
		unit_cost = flt(ct.renewal_cost)
		type_rows.append({
			"certificate_type": ct.name,
			"unit_cost": unit_cost,
			"holders": counts["Valid"] + counts["Expiring Soon"] + counts["Expired"],
			"valid": counts["Valid"], "expiring": counts["Expiring Soon"], "expired": counts["Expired"],
			"renewal_needed": renewal_needed,
			"expiring_cost": counts["Expiring Soon"] * unit_cost,
			"expired_cost": counts["Expired"] * unit_cost,
			"total_cost": renewal_needed * unit_cost,
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
			ec.name, ec.employee, emp.employee_name, emp.certification_domain,
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
	if iqama and frappe.db.exists("Employee", {"iqama_number": iqama}):
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
	doc.nationality = payload.get("nationality")
	doc.uniportal_id = payload.get("uniportal_id")
	doc.certification_domain = payload.get("certification_domain")
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
	              "certification_domain", "designation"):
		if field in payload:
			doc.set(field, payload.get(field) or None)
	if "iqama_number" in payload:
		doc.iqama_number = iqama or None

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
	the way the PMS portal can."""
	filters = {}
	if cohort == "former":
		filters["status"] = "Left"
	elif cohort == "protech":
		filters["status"] = "Active"
		filters["certification_domain"] = PROTECH_DOMAIN
	elif cohort == "resource":
		filters["status"] = "Active"
		filters["certification_domain"] = ["!=", PROTECH_DOMAIN]

	fields = ["name", "employee_name", "iqama_number", "cell_number", "certification_domain",
	          "designation", "status"]
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
