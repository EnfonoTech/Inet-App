"""Project Expense Claim API — team-lead-filed, IM-approved expense claims mapped to POIDs."""
import frappe
from frappe.utils import flt, nowdate


def _get_team_for_user(user=None):
    """Return the INET Team doc where field_user matches the given (or session) user."""
    user = user or frappe.session.user
    team = frappe.db.get_value(
        "INET Team",
        {"field_user": user, "status": "Active"},
        ["name", "team_id", "team_name", "im"],
        as_dict=True,
    )
    return team


def _get_employee_for_user(user=None):
    """Return the Employee name linked to a Frappe user."""
    user = user or frappe.session.user
    return frappe.db.get_value("Employee", {"user_id": user, "status": "Active"}, "name")


def _get_im_user(im_master_name):
    """Return the Frappe User linked to an IM Master record."""
    return frappe.db.get_value("IM Master", im_master_name, "user")


def _get_company():
    """Return the default company from Global Defaults."""
    return frappe.defaults.get_global_default("company") or frappe.db.get_single_value("Global Defaults", "default_company")


def _resolve_poid_display(system_id):
    """Return the human-readable POID string for a PO Dispatch name (system_id)."""
    if not system_id:
        return system_id
    poid = frappe.db.get_value("PO Dispatch", system_id, "poid")
    return poid or system_id


def _enrich_lines_with_poid(rows, parent_field="parent"):
    """For a list of claim records, attach their detail lines with resolved POID display."""
    if not rows:
        return rows
    claim_names = [r.name for r in rows]
    ph = ", ".join(["%s"] * len(claim_names))
    detail_rows = frappe.db.sql(
        f"""
        SELECT
            ecd.parent,
            COALESCE(pd.poid, ecd.poid, '') AS poid_display,
            ecd.poid AS poid_raw,
            ecd.expense_type,
            ecd.amount,
            ecd.description
        FROM `tabExpense Claim Detail` ecd
        LEFT JOIN `tabPO Dispatch` pd ON pd.name = ecd.poid
        WHERE ecd.parent IN ({ph})
        ORDER BY ecd.idx ASC
        """,
        tuple(claim_names),
        as_dict=True,
    )
    by_claim = {}
    for d in detail_rows:
        by_claim.setdefault(d.parent, []).append({
            "expense_type": d.expense_type,
            "amount": d.amount,
            "description": d.description,
            "poid": d.poid_display,  # human-readable POID
        })
    for r in rows:
        r["lines"] = by_claim.get(r.name, [])
    return rows


# ── Public API ────────────────────────────────────────────────────────────────

@frappe.whitelist()
def get_field_user_team():
    """Return the INET Team info for the logged-in field user, plus employee check."""
    team = _get_team_for_user()
    employee = _get_employee_for_user()

    if not team:
        return {"has_team": False, "has_employee": bool(employee)}

    im_name = team.get("im")
    im_user = _get_im_user(im_name) if im_name else None
    im_full_name = frappe.db.get_value("IM Master", im_name, "full_name") if im_name else None
    return {
        "has_team": True,
        "has_employee": bool(employee),
        "name": team.name,
        "team_id": team.team_id,
        "team_name": team.team_name,
        "im": im_name,
        "im_user": im_user,
        "im_name": im_full_name,
    }


@frappe.whitelist()
def get_expense_claim_types():
    """Return expense claim types that have a default account configured for the company."""
    company = _get_company()

    if company:
        rows = frappe.db.sql(
            """
            SELECT DISTINCT ect.name, ect.expense_type
            FROM `tabExpense Claim Type` ect
            JOIN `tabExpense Claim Account` eca ON eca.parent = ect.name
            WHERE eca.parenttype = 'Expense Claim Type'
              AND eca.company = %s
              AND eca.default_account IS NOT NULL
              AND eca.default_account != ''
            ORDER BY ect.expense_type ASC
            LIMIT 200
            """,
            (company,),
            as_dict=True,
        )
    else:
        rows = frappe.db.sql(
            """
            SELECT DISTINCT ect.name, ect.expense_type
            FROM `tabExpense Claim Type` ect
            JOIN `tabExpense Claim Account` eca ON eca.parent = ect.name
            WHERE eca.parenttype = 'Expense Claim Type'
              AND eca.default_account IS NOT NULL
              AND eca.default_account != ''
            ORDER BY ect.expense_type ASC
            LIMIT 200
            """,
            as_dict=True,
        )
    return rows


@frappe.whitelist()
def get_available_poids(team=None):
    """Return PO Dispatches available for expense claim POID selection.

    Scoped to the IM who manages the given team (or the session user's team).
    Excludes Closed / Cancelled dispatches.
    """
    if not team:
        t = _get_team_for_user()
        if not t:
            return []
        team = t.name

    im_name = frappe.db.get_value("INET Team", team, "im")
    if not im_name:
        return []

    rows = frappe.db.sql(
        """
        SELECT name, poid, system_id, site_code, item_code, dispatch_status
        FROM `tabPO Dispatch`
        WHERE im = %s
          AND dispatch_status NOT IN ('Closed', 'Cancelled')
        ORDER BY poid ASC
        LIMIT 500
        """,
        (im_name,),
        as_dict=True,
    )
    return rows


@frappe.whitelist()
def create_project_expense_claim(date=None, remarks=None, inet_team=None, expense_lines=None):
    """Create a draft ERPNext Expense Claim for a project team lead.

    expense_lines: JSON list of {expense_type, description, amount, poids: [po_dispatch_name, ...]}
    For multi-POID lines the amount is split equally across all selected POIDs.
    """
    import json

    if isinstance(expense_lines, str):
        expense_lines = json.loads(expense_lines)

    if not expense_lines:
        frappe.throw("At least one expense line is required.")

    # Resolve employee
    employee = _get_employee_for_user()
    if not employee:
        frappe.throw("No active Employee record found for your user account. Contact HR.")

    # Resolve team
    if not inet_team:
        team_doc = _get_team_for_user()
        if not team_doc:
            frappe.throw("No active INET Team found for your user account.")
        inet_team = team_doc.name
    else:
        team_doc = frappe.db.get_value(
            "INET Team", inet_team, ["name", "im"], as_dict=True
        )
        if not team_doc:
            frappe.throw(f"INET Team '{inet_team}' not found.")

    # Resolve IM as expense approver
    im_name = team_doc.get("im")
    if not im_name:
        frappe.throw("The team has no Implementation Manager assigned.")
    im_user = _get_im_user(im_name)
    if not im_user:
        frappe.throw(f"IM Master '{im_name}' has no linked Frappe User.")

    posting_date = date or nowdate()
    company = _get_company()

    # Get payable account and default cost center from INET Settings / Company
    payable_account = frappe.db.get_single_value("INET Settings", "expense_payable_account") or None
    default_cost_center = frappe.db.get_value("Company", company, "cost_center") if company else None

    doc = frappe.new_doc("Expense Claim")
    doc.employee = employee
    doc.posting_date = posting_date
    doc.company = company
    doc.expense_approver = im_user
    doc.inet_team = inet_team
    doc.is_project_claim = 1
    if payable_account:
        doc.payable_account = payable_account
    if remarks:
        doc.remark = remarks

    # Build expense detail rows
    for line in expense_lines:
        exp_type = line.get("expense_type")
        description = line.get("description") or ""
        total_amount = flt(line.get("amount") or 0)
        poids = line.get("poids") or []

        if not exp_type:
            frappe.throw("Expense Type is required for each line.")
        if total_amount <= 0:
            frappe.throw(f"Amount must be greater than zero for expense type '{exp_type}'.")
        if not poids:
            frappe.throw(f"At least one POID must be selected for expense type '{exp_type}'.")

        split_amount = flt(total_amount / len(poids), 2)
        # Distribute any rounding remainder to the last row
        remainder = flt(total_amount - split_amount * len(poids), 2)

        for idx, poid in enumerate(poids):
            row_amount = split_amount + (remainder if idx == len(poids) - 1 else 0)
            row = doc.append("expenses", {})
            row.expense_date = posting_date
            row.expense_type = exp_type
            row.description = description
            row.amount = row_amount
            row.sanctioned_amount = row_amount
            if default_cost_center and hasattr(row, "cost_center"):
                row.cost_center = default_cost_center
            # poid field is auto-created by the POID accounting dimension (stores PO Dispatch name)
            if hasattr(row, "poid"):
                row.poid = poid

    doc.flags.ignore_permissions = True
    doc.insert()

    # Share with IM approver so they can view & approve
    try:
        frappe.share.add(
            "Expense Claim",
            doc.name,
            im_user,
            write=1,
            submit=1,
            notify=1,
        )
    except Exception:
        pass

    return {"claim_name": doc.name, "status": doc.approval_status}


@frappe.whitelist()
def list_my_expense_claims():
    """Return all project expense claims filed by the logged-in user."""
    employee = _get_employee_for_user()
    if not employee:
        return []

    rows = frappe.db.sql(
        """
        SELECT
            ec.name,
            ec.posting_date,
            ec.total_claimed_amount,
            ec.total_sanctioned_amount,
            ec.approval_status,
            ec.docstatus,
            ec.status,
            ec.inet_team,
            ec.remark,
            COALESCE(it.team_name, ec.inet_team) AS team_name
        FROM `tabExpense Claim` ec
        LEFT JOIN `tabINET Team` it ON it.name = ec.inet_team
        WHERE ec.employee = %s
          AND ec.is_project_claim = 1
        ORDER BY ec.posting_date DESC, ec.creation DESC
        LIMIT 200
        """,
        (employee,),
        as_dict=True,
    )

    return _enrich_lines_with_poid(rows)


@frappe.whitelist()
def list_pending_expense_approvals():
    """Return project expense claims pending approval by the logged-in IM."""
    im_user = frappe.session.user

    rows = frappe.db.sql(
        """
        SELECT
            ec.name,
            ec.posting_date,
            ec.employee,
            ec.total_claimed_amount,
            ec.approval_status,
            ec.docstatus,
            ec.status,
            ec.inet_team,
            ec.remark,
            emp.employee_name,
            COALESCE(it.team_name, ec.inet_team) AS team_name
        FROM `tabExpense Claim` ec
        LEFT JOIN `tabEmployee` emp ON emp.name = ec.employee
        LEFT JOIN `tabINET Team` it ON it.name = ec.inet_team
        WHERE ec.expense_approver = %s
          AND ec.is_project_claim = 1
          AND ec.approval_status = 'Draft'
          AND ec.docstatus = 0
        ORDER BY ec.posting_date DESC, ec.creation DESC
        LIMIT 200
        """,
        (im_user,),
        as_dict=True,
    )

    return _enrich_lines_with_poid(rows)


@frappe.whitelist()
def list_im_all_claims():
    """Return all project expense claims where the session user is the expense_approver (IM view)."""
    im_user = frappe.session.user

    rows = frappe.db.sql(
        """
        SELECT
            ec.name,
            ec.posting_date,
            ec.employee,
            ec.total_claimed_amount,
            ec.approval_status,
            ec.docstatus,
            ec.status,
            ec.inet_team,
            ec.remark,
            emp.employee_name,
            COALESCE(it.team_name, ec.inet_team) AS team_name
        FROM `tabExpense Claim` ec
        LEFT JOIN `tabEmployee` emp ON emp.name = ec.employee
        LEFT JOIN `tabINET Team` it ON it.name = ec.inet_team
        WHERE ec.expense_approver = %s
          AND ec.is_project_claim = 1
        ORDER BY ec.posting_date DESC, ec.creation DESC
        LIMIT 500
        """,
        (im_user,),
        as_dict=True,
    )

    return _enrich_lines_with_poid(rows)


@frappe.whitelist()
def list_all_expense_claims(filters=None):
    """Return all project expense claims (admin/PM view). Supports optional filters."""
    import json

    if isinstance(filters, str):
        filters = json.loads(filters)
    filters = filters or {}

    conditions = ["ec.is_project_claim = 1"]
    params = []

    if filters.get("im_user"):
        conditions.append("ec.expense_approver = %s")
        params.append(filters["im_user"])
    if filters.get("inet_team"):
        conditions.append("ec.inet_team = %s")
        params.append(filters["inet_team"])
    if filters.get("approval_status"):
        conditions.append("ec.approval_status = %s")
        params.append(filters["approval_status"])
    if filters.get("from_date"):
        conditions.append("ec.posting_date >= %s")
        params.append(filters["from_date"])
    if filters.get("to_date"):
        conditions.append("ec.posting_date <= %s")
        params.append(filters["to_date"])

    where = " AND ".join(conditions)

    rows = frappe.db.sql(
        f"""
        SELECT
            ec.name,
            ec.posting_date,
            ec.employee,
            ec.total_claimed_amount,
            ec.approval_status,
            ec.docstatus,
            ec.status,
            ec.inet_team,
            ec.expense_approver,
            ec.remark,
            emp.employee_name,
            COALESCE(it.team_name, ec.inet_team) AS team_name,
            im.full_name AS im_name
        FROM `tabExpense Claim` ec
        LEFT JOIN `tabEmployee` emp ON emp.name = ec.employee
        LEFT JOIN `tabINET Team` it ON it.name = ec.inet_team
        LEFT JOIN `tabIM Master` im ON im.user = ec.expense_approver
        WHERE {where}
        ORDER BY ec.posting_date DESC, ec.creation DESC
        LIMIT 500
        """,
        tuple(params),
        as_dict=True,
    )

    return _enrich_lines_with_poid(rows)


@frappe.whitelist()
def get_expense_claim_detail(claim_name):
    """Return full expense claim with all child rows."""
    doc = frappe.get_doc("Expense Claim", claim_name)
    if doc.employee != _get_employee_for_user() and doc.expense_approver != frappe.session.user:
        frappe.has_permission("Expense Claim", "read", doc=doc, throw=True)

    lines = []
    for row in doc.expenses:
        raw_poid = getattr(row, "poid", None)
        lines.append({
            "expense_type": row.expense_type,
            "description": row.description,
            "amount": row.amount,
            "sanctioned_amount": row.sanctioned_amount,
            "poid": _resolve_poid_display(raw_poid),  # human-readable POID
            "expense_date": str(row.expense_date) if row.expense_date else None,
        })

    return {
        "name": doc.name,
        "posting_date": str(doc.posting_date),
        "employee": doc.employee,
        "employee_name": frappe.db.get_value("Employee", doc.employee, "employee_name"),
        "inet_team": doc.inet_team,
        "expense_approver": doc.expense_approver,
        "approval_status": doc.approval_status,
        "docstatus": doc.docstatus,
        "status": doc.status,
        "total_claimed_amount": doc.total_claimed_amount,
        "total_sanctioned_amount": doc.total_sanctioned_amount,
        "remark": doc.remark,
        "lines": lines,
    }


@frappe.whitelist()
def approve_expense_claim(claim_name):
    """Approve and submit an expense claim. Caller must be the expense_approver."""
    doc = frappe.get_doc("Expense Claim", claim_name)

    if doc.expense_approver != frappe.session.user:
        frappe.throw("Only the designated approver can approve this expense claim.")
    if doc.docstatus != 0:
        frappe.throw("Expense Claim is already submitted or cancelled.")

    # Ensure payable_account is set before submission
    if not doc.payable_account:
        payable_account = frappe.db.get_single_value("INET Settings", "expense_payable_account")
        if payable_account:
            frappe.db.set_value("Expense Claim", claim_name, "payable_account", payable_account)

    # Set approval status (permlevel 1 field — bypass via db.set_value)
    frappe.db.set_value("Expense Claim", claim_name, "approval_status", "Approved")
    frappe.db.commit()

    # Reload and submit
    doc.reload()
    doc.flags.ignore_permissions = True
    doc.submit()

    return {"status": "Approved", "claim_name": claim_name}


@frappe.whitelist()
def reject_expense_claim(claim_name, reason=None):
    """Reject an expense claim. Caller must be the expense_approver."""
    doc = frappe.get_doc("Expense Claim", claim_name)

    if doc.expense_approver != frappe.session.user:
        frappe.throw("Only the designated approver can reject this expense claim.")
    if doc.docstatus != 0:
        frappe.throw("Expense Claim is already submitted or cancelled.")

    # Ensure payable_account is set before submission
    if not doc.payable_account:
        payable_account = frappe.db.get_single_value("INET Settings", "expense_payable_account")
        if payable_account:
            frappe.db.set_value("Expense Claim", claim_name, "payable_account", payable_account)

    # Set rejection fields (permlevel 1 — bypass via db.set_value)
    frappe.db.set_value(
        "Expense Claim",
        claim_name,
        {
            "approval_status": "Rejected",
            "remark": reason or doc.remark or "",
        },
    )
    frappe.db.commit()

    # Submit so the record is finalised (docstatus = 1, no GL entries for rejected)
    doc.reload()
    doc.flags.ignore_permissions = True
    doc.submit()

    return {"status": "Rejected", "claim_name": claim_name}


@frappe.whitelist()
def get_im_list_for_filter():
    """Return all IM Masters with a linked user (for admin filter dropdown)."""
    rows = frappe.get_all(
        "IM Master",
        filters={"status": "Active"},
        fields=["name", "full_name", "user"],
        order_by="full_name asc",
        limit=200,
    )
    return [r for r in rows if r.get("user")]


@frappe.whitelist()
def get_teams_for_filter(im_user=None):
    """Return INET Teams, optionally filtered by IM user (for admin filter dropdown)."""
    filters = {"status": "Active"}
    if im_user:
        im_master = frappe.db.get_value("IM Master", {"user": im_user}, "name")
        if im_master:
            filters["im"] = im_master

    rows = frappe.get_all(
        "INET Team",
        filters=filters,
        fields=["name", "team_id", "team_name"],
        order_by="team_name asc",
        limit=500,
    )
    return rows
