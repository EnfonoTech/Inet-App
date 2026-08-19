"""Project Expense Claim API — team-lead-filed, IM-approved expense claims mapped to DUIDs (sites)."""
import frappe
from frappe.utils import flt, nowdate
from inet_app.api.command_center import _sql_like_pattern
from inet_app.setup import ACCOUNTING_DUID_FIELDNAME


def _expense_limit_suffix(limit):
    """SQL LIMIT suffix for the 4 expense-claim list endpoints.

    Only the frontend's "All" preset (rowLimit === 0) changes anything here —
    it removes the LIMIT entirely. Any other value is ignored and the
    endpoint keeps its existing hardcoded default cap. This is deliberate:
    these endpoints feed both the displayed rows AND client-side tab-count
    badges (Pending/Unpaid/Paid) computed from that same result set — actually
    honoring a small rowLimit (e.g. the default 20) would silently undercount
    those badges. Only "All" is unambiguous (0 truly means "no cap").
    """
    try:
        lim = int(limit)
    except (TypeError, ValueError):
        return None
    return "" if lim == 0 else None


# Per-column "Manage Table" filters — see list_im_rollout_plans (in
# command_center.py) for the rationale (each column matched independently
# and ANDed). Shared by list_pending_expense_approvals / list_im_all_claims /
# list_all_expense_claims, which all query `tabExpense Claim` with the same
# alias (`ec`, plus `emp`/`it`, and `im` only on the admin variant).
_EXPENSE_COL_FILTER_MAP = {
    "claim": "IFNULL(ec.name,'')",
    "date": "CAST(ec.posting_date AS CHAR)",
    "team_lead": "IFNULL(emp.employee_name,'')",
    "team": "COALESCE(NULLIF(it.team_name,''), ec.inet_team, '')",
    "amount_sar": "CAST(ec.total_claimed_amount AS CHAR)",
    "status": "IFNULL(ec.approval_status,'')",
    # IMExpense.jsx's own "Payment" column shows a computed Paid/Unpaid label
    # (paymentStatus() — derived from this raw field plus approval_status);
    # matching the raw column is a reasonable approximation without
    # duplicating that derivation in SQL.
    "payment": "IFNULL(ec.status,'')",
}


def _apply_expense_column_filters(column_filters, conditions, params, has_im_join=False):
    if isinstance(column_filters, str):
        try:
            column_filters = frappe.parse_json(column_filters)
        except Exception:
            column_filters = None
    if not isinstance(column_filters, dict):
        return
    for col_key, raw_val in column_filters.items():
        pat = _sql_like_pattern(raw_val)
        if not pat:
            continue
        if col_key == "im" and has_im_join:
            conditions.append("IFNULL(im.full_name,'') LIKE %s")
            params.append(pat)
            continue
        expr = _EXPENSE_COL_FILTER_MAP.get(col_key)
        if not expr:
            continue
        conditions.append(f"{expr} LIKE %s")
        params.append(pat)


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


def _resolve_project_for_duid(duid, im_name):
    """Best-effort: derive the project a DUID belongs to from the IM's own PO
    Dispatches at that site. Project Control Center is autonamed by project_code,
    so the value returned here is already the Link value for project_control_center.
    """
    if not duid or not im_name:
        return None
    row = frappe.db.sql(
        """
        SELECT project_code
        FROM `tabPO Dispatch`
        WHERE site_code = %s AND im = %s AND IFNULL(project_code, '') != ''
        ORDER BY modified DESC
        LIMIT 1
        """,
        (duid, im_name),
    )
    return row[0][0] if row else None


def _enrich_lines_with_duid(rows, parent_field="parent"):
    """For a list of claim records, attach their detail lines with DUID / project info.

    Unlike POID (a PO Dispatch document name that needs a join to resolve to the
    human-readable code), the DUID accounting dimension Links straight to DUID
    Master, whose `name` IS the DUID code — no resolution join needed for it.

    POID is still stored when known (e.g. filed from a rollout execution, which
    knows both) — resolved here for reference, but DUID remains the field the UI
    displays and groups by.
    """
    if not rows:
        return rows
    claim_names = [r.name for r in rows]
    ph = ", ".join(["%s"] * len(claim_names))
    detail_rows = frappe.db.sql(
        f"""
        SELECT
            ecd.parent,
            ecd.{ACCOUNTING_DUID_FIELDNAME} AS duid,
            COALESCE(pd.poid, ecd.poid, '') AS poid_display,
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
            "duid": d.duid,
            "poid": d.poid_display or None,  # set only when mapped from a rollout execution
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
def get_available_duids(team=None):
    """Return DUIDs (sites) available for expense claim allocation.

    Scoped to the IM who manages the given team (or the session user's team):
    a DUID qualifies if it has at least one non-Closed/Cancelled PO Dispatch
    under that IM.
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
        SELECT DISTINCT dm.name AS duid, dm.site_name, dm.center_area, dm.region_type
        FROM `tabDUID Master` dm
        JOIN `tabPO Dispatch` pd ON pd.site_code = dm.name
        WHERE pd.im = %s
          AND pd.dispatch_status NOT IN ('Closed', 'Cancelled')
        ORDER BY dm.name ASC
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

    expense_lines: JSON list of {expense_type, description, amount, duids: [duid, ...]}
    Amounts entered are VAT-INCLUSIVE: the net portion is stored on the expense
    rows (split equally across selected DUIDs) and the VAT portion is added as
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

    # Validate every line first and total the entered (VAT-inclusive) amounts.
    #
    # The net/tax split is deliberately computed ONCE on that combined total,
    # not per line: HRMS's Expense Claim.calculate_taxes() always recomputes
    # the tax row as rate% of total_sanctioned_amount on save, overriding
    # whatever tax_amount we set here. Rounding each line's VAT split
    # independently and then summing those roundings produces a
    # total_sanctioned_amount that differs from a single aggregate rounding
    # by a cent — e.g. two SAR 100 lines at 15% VAT: 100/1.15 rounds to 86.96
    # per line (173.92 combined), but 200/1.15 rounds to 173.91 in one step.
    # ERPNext then recomputes tax as 15% of whichever total actually lands,
    # so the double-rounding surfaces as a grand_total a cent off from what
    # was entered (200.01 instead of 200.00). Splitting from one aggregate
    # rounding — then distributing to rows with a remainder correction, same
    # technique already used for the per-line DUID split — keeps
    # total_sanctioned_amount exactly equal to the single rounded net, so
    # ERPNext's own recompute reproduces the entered total exactly.
    entries = []
    total_gross_all = 0.0
    for line in expense_lines:
        exp_type = line.get("expense_type")
        description = line.get("description") or ""
        gross_amount = flt(line.get("amount") or 0)
        duids = line.get("duids") or []
        is_general = bool(line.get("is_general"))
        project = line.get("project")
        # Optional — set when the caller already knows the exact POID (e.g. filed
        # straight from a rollout execution). Mapping both is fine; DUID stays
        # the required field, POID is just extra context when available.
        poid = line.get("poid")

        if not exp_type:
            frappe.throw("Expense Type is required for each line.")
        if gross_amount <= 0:
            frappe.throw(f"Amount must be greater than zero for expense type '{exp_type}'.")
        if is_general and not project:
            frappe.throw(f"A project must be selected for general expense '{exp_type}'.")
        if not is_general and not duids:
            frappe.throw(f"At least one DUID must be selected for expense type '{exp_type}'.")

        entries.append({
            "exp_type": exp_type, "description": description, "gross": gross_amount,
            "duids": duids, "is_general": is_general, "project": project, "poid": poid,
        })
        total_gross_all += gross_amount

    if tax_rate > 0:
        total_net_all = flt(total_gross_all / (1 + tax_rate / 100), 2)
        total_tax = flt(total_gross_all - total_net_all, 2)
    else:
        total_net_all = total_gross_all
        total_tax = 0.0

    # Build rows: each line's net share is proportional to its gross share of
    # the aggregate, with the running remainder corrected on the LAST line so
    # the true row-level sum always equals total_net_all exactly.
    net_running = 0.0
    last_idx = len(entries) - 1
    for i, e in enumerate(entries):
        if tax_rate > 0:
            if i == last_idx:
                line_net = flt(total_net_all - net_running, 2)
            else:
                line_net = flt(e["gross"] / total_gross_all * total_net_all, 2)
        else:
            line_net = e["gross"]
        net_running = flt(net_running + line_net, 2)

        # General expense — booked against the project, not a POID
        if e["is_general"]:
            row = doc.append("expenses", {})
            row.expense_date = posting_date
            row.expense_type = e["exp_type"]
            row.description = e["description"]
            row.amount = line_net
            row.sanctioned_amount = line_net
            if default_cost_center and hasattr(row, "cost_center"):
                row.cost_center = default_cost_center
            # field auto-created by the Project Control Center accounting dimension
            if not hasattr(row, "project_control_center"):
                frappe.throw("Project accounting dimension is not set up yet. Run bench migrate.")
            row.project_control_center = e["project"]
            continue

        duids = e["duids"]
        split_amount = flt(line_net / len(duids), 2)
        # Distribute any rounding remainder to the last row
        remainder = flt(line_net - split_amount * len(duids), 2)

        for idx, duid in enumerate(duids):
            row_amount = split_amount + (remainder if idx == len(duids) - 1 else 0)
            row = doc.append("expenses", {})
            row.expense_date = posting_date
            row.expense_type = e["exp_type"]
            row.description = e["description"]
            row.amount = row_amount
            row.sanctioned_amount = row_amount
            if default_cost_center and hasattr(row, "cost_center"):
                row.cost_center = default_cost_center
            # Field is auto-created by the DUID accounting dimension (Links to DUID
            # Master). Its fieldname is `duid_acc`, NOT `duid` — the inventory DUID
            # dimension owns the bare `duid` name on stock doctypes, so the accounting
            # one was moved aside. See _separate_duid_dimensions in setup.py.
            if not hasattr(row, ACCOUNTING_DUID_FIELDNAME):
                frappe.throw("DUID accounting dimension is not set up yet. Run bench migrate.")
            setattr(row, ACCOUNTING_DUID_FIELDNAME, duid)
            # poid field still exists (POID accounting dimension) — set it too when known
            if e["poid"] and hasattr(row, "poid"):
                row.poid = e["poid"]
            # Auto-map the project this DUID belongs to — no extra IM/TL input needed.
            if hasattr(row, "project_control_center"):
                auto_project = _resolve_project_for_duid(duid, im_name)
                if auto_project:
                    row.project_control_center = auto_project

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
def list_my_expense_claims(limit=None):
    """Return all project expense claims filed by the logged-in user."""
    employee = _get_employee_for_user()
    if not employee:
        return []

    limit_clause = _expense_limit_suffix(limit)
    if limit_clause is None:
        limit_clause = "LIMIT 200"

    rows = frappe.db.sql(
        f"""
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
        {limit_clause}
        """,
        (employee,),
        as_dict=True,
    )

    return _enrich_lines_with_duid(rows)


@frappe.whitelist()
def list_pending_expense_approvals(column_filters=None, limit=None):
    """Return project expense claims pending approval by the logged-in IM."""
    im_user = frappe.session.user

    conditions = [
        "ec.expense_approver = %s",
        "ec.is_project_claim = 1",
        "ec.approval_status = 'Draft'",
        "ec.docstatus = 0",
    ]
    params = [im_user]
    _apply_expense_column_filters(column_filters, conditions, params)

    limit_clause = _expense_limit_suffix(limit)
    if limit_clause is None:
        limit_clause = "LIMIT 200"

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
            ec.remark,
            emp.employee_name,
            COALESCE(it.team_name, ec.inet_team) AS team_name
        FROM `tabExpense Claim` ec
        LEFT JOIN `tabEmployee` emp ON emp.name = ec.employee
        LEFT JOIN `tabINET Team` it ON it.name = ec.inet_team
        WHERE {' AND '.join(conditions)}
        ORDER BY ec.posting_date DESC, ec.creation DESC
        {limit_clause}
        """,
        tuple(params),
        as_dict=True,
    )

    return _enrich_lines_with_duid(rows)


@frappe.whitelist()
def list_im_all_claims(column_filters=None, limit=None):
    """Return all project expense claims where the session user is the expense_approver (IM view)."""
    im_user = frappe.session.user

    conditions = ["ec.expense_approver = %s", "ec.is_project_claim = 1"]
    params = [im_user]
    _apply_expense_column_filters(column_filters, conditions, params)

    limit_clause = _expense_limit_suffix(limit)
    if limit_clause is None:
        limit_clause = "LIMIT 500"

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
            ec.remark,
            emp.employee_name,
            COALESCE(it.team_name, ec.inet_team) AS team_name
        FROM `tabExpense Claim` ec
        LEFT JOIN `tabEmployee` emp ON emp.name = ec.employee
        LEFT JOIN `tabINET Team` it ON it.name = ec.inet_team
        WHERE {' AND '.join(conditions)}
        ORDER BY ec.posting_date DESC, ec.creation DESC
        {limit_clause}
        """,
        tuple(params),
        as_dict=True,
    )

    return _enrich_lines_with_duid(rows)


@frappe.whitelist()
def list_all_expense_claims(filters=None, limit=None):
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

    _apply_expense_column_filters(filters.get("column_filters"), conditions, params, has_im_join=True)

    where = " AND ".join(conditions)

    limit_clause = _expense_limit_suffix(limit)
    if limit_clause is None:
        limit_clause = "LIMIT 500"

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
        {limit_clause}
        """,
        tuple(params),
        as_dict=True,
    )

    return _enrich_lines_with_duid(rows)


@frappe.whitelist()
def get_expense_claim_detail(claim_name):
    """Return full expense claim with all child rows."""
    doc = frappe.get_doc("Expense Claim", claim_name)
    if doc.employee != _get_employee_for_user() and doc.expense_approver != frappe.session.user:
        frappe.has_permission("Expense Claim", "read", doc=doc, throw=True)

    lines = []
    for row in doc.expenses:
        raw_project = getattr(row, "project_control_center", None)
        project_display = None
        if raw_project:
            project_display = frappe.db.get_value("Project Control Center", raw_project, "project_code") or raw_project
        raw_poid = getattr(row, "poid", None)
        lines.append({
            "expense_type": row.expense_type,
            "description": row.description,
            "amount": row.amount,
            "sanctioned_amount": row.sanctioned_amount,
            "duid": getattr(row, ACCOUNTING_DUID_FIELDNAME, None),
            "poid": (frappe.db.get_value("PO Dispatch", raw_poid, "poid") or raw_poid) if raw_poid else None,
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
