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


def _get_expense_tax_settings():
    """Return (tax_rate, tax_account) for VAT-inclusive expense amounts from INET Settings."""
    rate = flt(frappe.db.get_single_value("INET Settings", "expense_tax_rate"))
    account = frappe.db.get_single_value("INET Settings", "expense_tax_account")
    return rate, account


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
            ecd.project_control_center AS project,
            COALESCE(pcc.project_code, ecd.project_control_center, '') AS project_display,
            ecd.expense_type,
            ecd.amount,
            ecd.description
        FROM `tabExpense Claim Detail` ecd
        LEFT JOIN `tabPO Dispatch` pd ON pd.name = ecd.poid
        LEFT JOIN `tabProject Control Center` pcc ON pcc.name = ecd.project_control_center
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
            "project": d.project_display,  # set for general (project-level) expenses
        })
    for r in rows:
        r["lines"] = by_claim.get(r.name, [])
    return _enrich_attachments(rows)


def _enrich_attachments(rows):
    """Attach the list of File attachments to each claim record."""
    if not rows:
        return rows
    files = frappe.get_all(
        "File",
        filters={
            "attached_to_doctype": "Expense Claim",
            "attached_to_name": ["in", [r.name for r in rows]],
        },
        fields=["attached_to_name", "file_name", "file_url"],
        order_by="creation asc",
    )
    by_claim = {}
    for f in files:
        by_claim.setdefault(f.attached_to_name, []).append(
            {"file_name": f.file_name, "file_url": f.file_url}
        )
    for r in rows:
        r["attachments"] = by_claim.get(r.name, [])
    return rows


def _link_attachments(claim_name, file_urls):
    """Attach already-uploaded files (by URL) to an Expense Claim."""
    for url in file_urls or []:
        if not url:
            continue
        candidates = frappe.get_all(
            "File",
            filters={"file_url": url},
            fields=["name", "attached_to_name"],
            order_by="creation desc",
            limit=5,
        )
        target = next((f for f in candidates if not f.attached_to_name), None)
        if target:
            frappe.db.set_value(
                "File",
                target.name,
                {"attached_to_doctype": "Expense Claim", "attached_to_name": claim_name},
                update_modified=False,
            )
        elif not candidates:
            frappe.get_doc({
                "doctype": "File",
                "file_url": url,
                "attached_to_doctype": "Expense Claim",
                "attached_to_name": claim_name,
            }).insert(ignore_permissions=True)


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
def get_available_projects(team=None):
    """Return Project Control Center projects for general (non-POID) expenses.

    Scoped to projects the team's IM works on (directly assigned, or appearing
    in the IM's PO Dispatches). Falls back to all active projects when the IM
    has none linked yet.
    """
    im_name = None
    if not team:
        t = _get_team_for_user()
        if t:
            team = t.name
    if team:
        im_name = frappe.db.get_value("INET Team", team, "im")

    rows = []
    if im_name:
        rows = frappe.db.sql(
            """
            SELECT DISTINCT pcc.name, pcc.project_code, pcc.project_name
            FROM `tabProject Control Center` pcc
            WHERE pcc.active_flag = 'Yes'
              AND (
                pcc.implementation_manager = %(im)s
                OR pcc.project_code IN (
                    SELECT DISTINCT project_code FROM `tabPO Dispatch`
                    WHERE im = %(im)s AND project_code IS NOT NULL AND project_code != ''
                )
              )
            ORDER BY pcc.project_code ASC
            LIMIT 500
            """,
            {"im": im_name},
            as_dict=True,
        )

    if not rows:
        rows = frappe.get_all(
            "Project Control Center",
            filters={"active_flag": "Yes"},
            fields=["name", "project_code", "project_name"],
            order_by="project_code asc",
            limit=500,
        )
    return rows


@frappe.whitelist()
def get_expense_tax_info():
    """Return the VAT rate/account config used for tax-inclusive expense amounts."""
    rate, account = _get_expense_tax_settings()
    return {"tax_rate": rate, "tax_account_set": bool(account)}


@frappe.whitelist()
def create_project_expense_claim(date=None, remarks=None, inet_team=None, expense_lines=None, attachments=None):
    """Create a draft ERPNext Expense Claim for a project team lead.

    expense_lines: JSON list of {expense_type, description, amount, poids: [po_dispatch_name, ...]}
    Amounts entered are VAT-INCLUSIVE: the net portion is stored on the expense
    rows (split equally across selected POIDs) and the VAT portion is added as
    an Expense Taxes and Charges row, so grand_total equals the entered amount.
    attachments: JSON list of already-uploaded file URLs to attach to the claim.
    """
    import json

    if isinstance(expense_lines, str):
        expense_lines = json.loads(expense_lines)
    if isinstance(attachments, str):
        attachments = json.loads(attachments)

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

    # Entered amounts are VAT-inclusive — net goes on expense rows, VAT on a tax row
    tax_rate, tax_account = _get_expense_tax_settings()
    if tax_rate > 0 and not tax_account:
        frappe.throw("Expense VAT Account is not configured in INET Settings. Ask an administrator to set it.")

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
    total_tax = 0.0
    for line in expense_lines:
        exp_type = line.get("expense_type")
        description = line.get("description") or ""
        gross_amount = flt(line.get("amount") or 0)
        poids = line.get("poids") or []
        is_general = bool(line.get("is_general"))
        project = line.get("project")

        if not exp_type:
            frappe.throw("Expense Type is required for each line.")
        if gross_amount <= 0:
            frappe.throw(f"Amount must be greater than zero for expense type '{exp_type}'.")
        if is_general and not project:
            frappe.throw(f"A project must be selected for general expense '{exp_type}'.")
        if not is_general and not poids:
            frappe.throw(f"At least one POID must be selected for expense type '{exp_type}'.")

        # Back out the VAT portion: entered amount is tax-inclusive
        if tax_rate > 0:
            total_amount = flt(gross_amount / (1 + tax_rate / 100), 2)
            total_tax += flt(gross_amount - total_amount, 2)
        else:
            total_amount = gross_amount

        # General expense — booked against the project, not a POID
        if is_general:
            row = doc.append("expenses", {})
            row.expense_date = posting_date
            row.expense_type = exp_type
            row.description = description
            row.amount = total_amount
            row.sanctioned_amount = total_amount
            if default_cost_center and hasattr(row, "cost_center"):
                row.cost_center = default_cost_center
            # field auto-created by the Project Control Center accounting dimension
            if not hasattr(row, "project_control_center"):
                frappe.throw("Project accounting dimension is not set up yet. Run bench migrate.")
            row.project_control_center = project
            continue

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

    # VAT row — with rate set, ERPNext recomputes tax_amount as rate% of the
    # sanctioned total, so the tax follows any adjustment accounts makes later.
    if tax_rate > 0 and total_tax > 0:
        doc.append("taxes", {
            "account_head": tax_account,
            "description": f"VAT {flt(tax_rate)}% (included in claimed amount)",
            "rate": flt(tax_rate),
            "tax_amount": flt(total_tax, 2),
        })

    doc.flags.ignore_permissions = True
    doc.insert()

    _link_attachments(doc.name, attachments)

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

    # Notify the IM that a new claim is waiting for approval
    try:
        from inet_app.api.notifications import _make_notification
        employee_name = frappe.db.get_value("Employee", employee, "employee_name") or employee
        _make_notification(
            im_user,
            f"[ALERT] New expense claim from {employee_name} — SAR {flt(doc.grand_total, 2)}",
            "Expense Claim", doc.name,
            link="/pms/im-expense",
        )
    except Exception:
        frappe.log_error(frappe.get_traceback(), "Expense claim filing notification failed")

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
            ec.total_taxes_and_charges,
            ec.grand_total,
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
            ec.total_taxes_and_charges,
            ec.grand_total,
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
            ec.total_taxes_and_charges,
            ec.grand_total,
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
            ec.total_taxes_and_charges,
            ec.grand_total,
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
        raw_project = getattr(row, "project_control_center", None)
        project_display = None
        if raw_project:
            project_display = frappe.db.get_value("Project Control Center", raw_project, "project_code") or raw_project
        lines.append({
            "expense_type": row.expense_type,
            "description": row.description,
            "amount": row.amount,
            "sanctioned_amount": row.sanctioned_amount,
            "poid": _resolve_poid_display(raw_poid),  # human-readable POID
            "project": project_display,  # set for general (project-level) expenses
            "expense_date": str(row.expense_date) if row.expense_date else None,
        })

    attachments = frappe.get_all(
        "File",
        filters={"attached_to_doctype": "Expense Claim", "attached_to_name": doc.name},
        fields=["file_name", "file_url"],
        order_by="creation asc",
    )

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
        "total_taxes_and_charges": doc.total_taxes_and_charges,
        "grand_total": doc.grand_total,
        "remark": doc.remark,
        "lines": lines,
        "attachments": attachments,
    }


def _notify_claim_filer(doc, subject):
    """Send a portal notification to the employee who filed the claim."""
    try:
        from inet_app.api.notifications import _make_notification
        filer = frappe.db.get_value("Employee", doc.employee, "user_id")
        _make_notification(filer, subject, "Expense Claim", doc.name, link="/pms/field-expense")
    except Exception:
        frappe.log_error(frappe.get_traceback(), "Expense claim status notification failed")


@frappe.whitelist()
def approve_expense_claim(claim_name):
    """Approve an expense claim WITHOUT submitting it. Caller must be the expense_approver.

    The claim stays in draft (docstatus 0) so the accounts team can still adjust
    amounts/accounts in ERPNext before they submit it themselves (which creates GL entries).
    """
    doc = frappe.get_doc("Expense Claim", claim_name)

    if doc.expense_approver != frappe.session.user:
        frappe.throw("Only the designated approver can approve this expense claim.")
    if doc.docstatus != 0:
        frappe.throw("Expense Claim is already submitted or cancelled.")
    if doc.approval_status == "Rejected":
        frappe.throw("Expense Claim has already been rejected.")

    # Pre-fill payable_account so accounts can submit without extra steps
    if not doc.payable_account:
        payable_account = frappe.db.get_single_value("INET Settings", "expense_payable_account")
        if payable_account:
            frappe.db.set_value("Expense Claim", claim_name, "payable_account", payable_account)

    # Set approval status only (permlevel 1 field — bypass via db.set_value).
    # Deliberately NOT submitting: accounts team finalises in ERPNext.
    frappe.db.set_value("Expense Claim", claim_name, "approval_status", "Approved")

    _notify_claim_filer(doc, f"[INFO] Expense claim {claim_name} approved — SAR {flt(doc.grand_total, 2)}")

    return {"status": "Approved", "claim_name": claim_name}


@frappe.whitelist()
def reject_expense_claim(claim_name, reason=None):
    """Reject an expense claim (stays draft, no submission). Caller must be the expense_approver."""
    doc = frappe.get_doc("Expense Claim", claim_name)

    if doc.expense_approver != frappe.session.user:
        frappe.throw("Only the designated approver can reject this expense claim.")
    if doc.docstatus != 0:
        frappe.throw("Expense Claim is already submitted or cancelled.")

    # Set rejection fields (permlevel 1 — bypass via db.set_value)
    frappe.db.set_value(
        "Expense Claim",
        claim_name,
        {
            "approval_status": "Rejected",
            "remark": reason or doc.remark or "",
        },
    )

    _notify_claim_filer(doc, f"[CRITICAL] Expense claim {claim_name} rejected — check remarks")

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
