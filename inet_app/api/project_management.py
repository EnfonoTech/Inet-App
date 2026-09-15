import frappe
from inet_app.api.command_center import (
    LINE_DONE_STATUSES,
    excel_orm_filter,
    excel_options_from_orm,
)
from frappe import _
from frappe.utils import cint, flt


def _as_dict(doc):
    if isinstance(doc, str):
        return frappe._dict(frappe.parse_json(doc))
    return frappe._dict(doc or {})


def _make_poid(po_no, po_line_no, shipment_number):
    """Build POID: PO No - PO Line No - Shipment No (omits shipment part if blank)."""
    parts = [str(po_no or "").strip(), str(cint(po_line_no) if po_line_no else 0)]
    if shipment_number:
        parts.append(str(shipment_number).strip())
    return "-".join(parts)


def _project_value_revenue(project_codes):
    """Total contracted value and delivered revenue per project code — the
    real, always-available replacement for the dead budget_amount/actual_cost/
    completion_percentage fields (manual Desk entry only, never written by the
    app; meaningless for a customer project).

    Revenue is the value of the project's DONE lines (LINE_DONE_STATUSES), not
    the sum of its Work Done records. Work Done was the original basis and it
    made this figure useless: only 61 Work Done rows exist against 12,000+
    done lines, because the rest were imported already completed — often
    already invoiced — with no plan or execution ever created. Company-wide
    that read SAR 47,470 against SAR 9,428,121 of genuinely delivered line
    value, and a project like 56A0NPK (2,171 lines, 81.6% of its value closed)
    showed Revenue SAR 0 and Completion 0%.

    This is the same definition the Project Performance and Profitability
    reports use, via the shared constant, so a project's card and its row in
    those reports cannot disagree about the word "revenue".
    """
    codes = [c for c in (project_codes or []) if c]
    if not codes:
        return {}
    ph = ", ".join(["%s"] * len(codes))
    # Cancelled lines are excluded, matching the Profitability report: a
    # cancelled line is not value the project can still deliver, so leaving it
    # in only depresses Completion % against a denominator nobody is working
    # towards. This was the last remaining disagreement between the two — one
    # project differed by the SAR 100 its cancelled lines carry.
    value_rows = frappe.db.sql(
        f"""
        SELECT project_code, COALESCE(SUM(line_amount), 0) AS total_value
        FROM `tabPO Dispatch`
        WHERE project_code IN ({ph})
          AND IFNULL(is_internal_work, 0) = 0
          AND IFNULL(dispatch_status, '') NOT LIKE '%%Cancel%%'
        GROUP BY project_code
        """,
        tuple(codes), as_dict=True,
    )
    value_by = {r.project_code: flt(r.total_value) for r in value_rows}

    # Same is_internal_work exclusion as the value query above — without it a
    # project's revenue could include lines its own total value leaves out,
    # and Completion % could exceed 100 on nothing but that mismatch.
    ph_done = ", ".join(["%s"] * len(LINE_DONE_STATUSES))
    revenue_rows = frappe.db.sql(
        f"""
        SELECT project_code, COALESCE(SUM(line_amount), 0) AS revenue
        FROM `tabPO Dispatch`
        WHERE project_code IN ({ph})
          AND IFNULL(is_internal_work, 0) = 0
          AND dispatch_status IN ({ph_done})
        GROUP BY project_code
        """,
        tuple(codes) + tuple(LINE_DONE_STATUSES), as_dict=True,
    )
    revenue_by = {r.project_code: flt(r.revenue) for r in revenue_rows}

    out = {}
    for c in codes:
        tv = value_by.get(c, 0.0)
        rv = revenue_by.get(c, 0.0)
        out[c] = {
            "total_value": tv,
            "revenue": rv,
            "completion_pct": round(rv / tv * 100, 1) if tv else 0.0,
        }
    return out


@frappe.whitelist()
def list_projects(
    limit=20,
    offset=0,
    search=None,
    status=None,
    domain=None,
    area=None,
    implementation_manager=None,
    huawei_im=None,
    column_filters=None,
):
    """List projects; ``limit=0`` loads all rows (no cap). Other limits are clamped to 1..10000."""
    filters = []
    if status:
        filters.append(["project_status", "=", status])
    if domain:
        filters.append(["project_domain", "=", domain])
    if area:
        filters.append(["center_area", "=", area])
    if huawei_im:
        filters.append(["huawei_im", "=", huawei_im])
    im = (implementation_manager or "").strip()
    if im:
        filters.append(["implementation_manager", "=", im])

    or_filters = []
    if search:
        like = f"%{search}%"
        or_filters = [
            ["project_code", "like", like],
            ["project_name", "like", like],
            ["customer", "like", like],
        ]

    # Per-column "Manage Table" filters — see list_im_rollout_plans (in
    # command_center.py) for the rationale (each column matched independently
    # and ANDed, not blended into the wide `search` box's OR-across-fields
    # match above). Frappe's list `filters` param already ANDs its entries,
    # so a plain ["field", "like", pattern] per active column is enough here
    # — no raw SQL needed for this single-table, join-free query.
    col_filter_map = {
        "region": "region_type",
        "code": "project_code",
        "project_code": "project_code",
        "project_name": "project_name",
        "customer": "customer",
        "domain": "project_domain",
        "huawei_im": "huawei_im",
        "status": "project_status",
        "im": "implementation_manager",
        "area": "center_area",
    }
    if frappe.db.has_column("Project Control Center", "region_type"):
        col_filter_map["region"] = "region_type"
    if isinstance(column_filters, str):
        try:
            column_filters = frappe.parse_json(column_filters)
        except Exception:
            column_filters = None
    if isinstance(column_filters, dict):
        for col_key, raw_val in column_filters.items():
            # ORM filter list, not SQL — see excel_orm_filter().
            if isinstance(raw_val, dict):
                _entry = excel_orm_filter(col_filter_map.get(col_key), raw_val)
                if _entry:
                    filters.append(_entry)
                continue
            val = str(raw_val or "").strip()
            if not val:
                continue
            field = col_filter_map.get(col_key)
            if not field:
                continue
            esc = val.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            filters.append([field, "like", f"%{esc}%"])

    proj_fields = [
        "name",
        "project_code",
        "project_name",
        "customer",
        "project_domain",
        "project_status",
        "implementation_manager",
        "center_area",
        "huawei_im",
        "modified",
    ]
    if frappe.db.has_column("Project Control Center", "region_type"):
        proj_fields.insert(proj_fields.index("center_area") + 1, "region_type")
    page_len = cint(limit) if limit is not None else 20
    if page_len < 0:
        page_len = 20
    elif page_len == 0:
        page_len = 0
    elif page_len > 10000:
        page_len = 10000

    gl_kwargs = dict(
        filters=filters,
        or_filters=or_filters,
        fields=proj_fields,
        order_by="modified desc",
        start=cint(offset),
    )
    if page_len:
        gl_kwargs["page_length"] = page_len
    rows = frappe.get_list("Project Control Center", **gl_kwargs)

    # budget_amount / actual_cost / completion_percentage used to be shown
    # here, but nothing in the app ever writes them (manual Desk entry only,
    # usually never touched) — meaningless for a customer project, which has
    # no internal "budget" concept. Replaced with real figures: total
    # contracted value, revenue actually realized, completion % as their
    # ratio — see _project_value_revenue().
    vr = _project_value_revenue([r.name for r in rows])
    for r in rows:
        r.update(vr.get(r.name, {"total_value": 0.0, "revenue": 0.0, "completion_pct": 0.0}))

    return rows


@frappe.whitelist()
def get_project_detail(name):
    doc = frappe.get_doc("Project Control Center", name)
    out = doc.as_dict()
    out.update(_project_value_revenue([name]).get(
        name, {"total_value": 0.0, "revenue": 0.0, "completion_pct": 0.0}))
    return out


@frappe.whitelist()
def upsert_project(payload):
    data = _as_dict(payload)
    name = data.get("name")
    if name:
        doc = frappe.get_doc("Project Control Center", name)
        doc.update(data)
        doc.save()
    else:
        doc = frappe.get_doc({"doctype": "Project Control Center", **data})
        doc.insert()
    return {"name": doc.name}


@frappe.whitelist()
def get_project_kpis():
    rows = frappe.get_all(
        "Project Control Center",
        fields=["name", "project_status"],
        limit_page_length=0,
    )
    total = len(rows)
    active = len([r for r in rows if r.project_status == "Active"])
    at_risk = len([r for r in rows if r.project_status == "At Risk"])
    overdue = len([r for r in rows if r.project_status == "On Hold"])

    # total_budget/actual_spent/budget_utilization used to come from
    # budget_amount/actual_cost — dead fields, nothing writes them. Replaced
    # with the real company-wide totals: contracted value across all
    # projects and the value delivered against it.
    #
    # Both sides use the same definitions as _project_value_revenue and the
    # two project reports — done LINES, not Work Done records, and cancelled
    # and internal lines out of both. Summing Work Done here read SAR 46,552
    # (0.34%) against SAR 9,428,121 of genuinely delivered value, because
    # only 61 Work Done records exist against 12,000+ done lines.
    ph_done = ", ".join(["%s"] * len(LINE_DONE_STATUSES))
    _scope = ("WHERE IFNULL(is_internal_work, 0) = 0 "
              "AND IFNULL(dispatch_status, '') NOT LIKE '%%Cancel%%'")
    total_value = flt(frappe.db.sql(
        f"SELECT COALESCE(SUM(line_amount), 0) FROM `tabPO Dispatch` {_scope}"
    )[0][0])
    total_revenue = flt(frappe.db.sql(
        f"SELECT COALESCE(SUM(line_amount), 0) FROM `tabPO Dispatch` {_scope} "
        f"AND dispatch_status IN ({ph_done})",
        tuple(LINE_DONE_STATUSES),
    )[0][0])
    revenue_pct = round(total_revenue / total_value * 100, 2) if total_value else 0

    return {
        "total_projects": total,
        "active_projects": active,
        "projects_at_risk": at_risk,
        "overdue_projects": overdue,
        "total_value": total_value,
        "total_revenue": total_revenue,
        "revenue_pct": revenue_pct,
    }


@frappe.whitelist()
def get_pms_overview():
    """Operational snapshot used by PMS dashboard widgets."""
    return {
        "workflow_stages": [
            "PO Intake",
            "Planning & Dispatch",
            "Execution",
            "QC",
            "Completion Ledger",
            "Dashboard",
        ],
    }


@frappe.whitelist()
def capture_gps_location(lat=None, lng=None):
    if lat is None or lng is None:
        frappe.throw(_("Latitude and Longitude are required."))
    lat = flt(lat)
    lng = flt(lng)
    if lat < -90 or lat > 90 or lng < -180 or lng > 180:
        frappe.throw(_("GPS coordinates are out of valid range."))
    return f"{lat},{lng}"


@frappe.whitelist()
def dashboard_charts():
    project_status = frappe.db.sql(
        """
        SELECT project_status AS label, COUNT(*) AS value
        FROM `tabProject Control Center`
        GROUP BY project_status
    """,
        as_dict=True,
    )
    # budget_vs_actual used to come from budget_amount/actual_cost — dead
    # fields, nothing writes them. Replaced with real total value vs revenue
    # realized per project, same figures as the Projects list pages.
    recent_projects = frappe.get_all(
        "Project Control Center",
        fields=["name", "project_code"],
        order_by="modified desc",
        limit_page_length=20,
    )
    vr = _project_value_revenue([p.name for p in recent_projects])
    value_vs_revenue = [
        {
            "project_code": p.project_code,
            "total_value": vr.get(p.name, {}).get("total_value", 0.0),
            "revenue": vr.get(p.name, {}).get("revenue", 0.0),
        }
        for p in recent_projects if p.project_code
    ]
    domain_distribution = frappe.db.sql(
        """
        SELECT project_domain AS label, COUNT(*) AS value
        FROM `tabProject Control Center`
        WHERE IFNULL(project_domain, '') != ''
        GROUP BY project_domain
    """,
        as_dict=True,
    )
    # Deliberately a LINE-based completion metric — "how many of this
    # project's PO lines are operationally done" — unlike the IM dashboard's
    # Project Progress, which counts Rollout Plans. The two answer different
    # questions and are not expected to match.
    #
    # Cancelled lines and internal work are excluded from both numerator and
    # denominator: a cancelled line is not outstanding work, and internal
    # work is not customer scope (every value query elsewhere in the app
    # filters is_internal_work the same way). Ranked by contracted value, so
    # "top" means the projects that matter most, not merely the ones with the
    # most line items.
    top_projects = frappe.db.sql(
        """
        SELECT
            pd.project_code,
            COUNT(*) AS total,
            COALESCE(SUM(pd.line_amount), 0) AS value,
            -- "Completed" and later (Partially Submitted/Submitted/Partially
            -- Closed/Closed) are all operationally done — PIC progressing a
            -- line through its own invoicing pipeline shouldn't make this
            -- completion % regress. See inet_app.api.pic._compute_dispatch_status_from_pic.
            SUM(CASE WHEN pd.dispatch_status IN ('Completed', 'Partially Submitted', 'Submitted', 'Partially Closed', 'Closed') THEN 1 ELSE 0 END) AS completed
        FROM `tabPO Dispatch` pd
        WHERE pd.project_code IS NOT NULL AND pd.project_code != ''
          AND IFNULL(pd.is_internal_work, 0) != 1
          AND IFNULL(pd.dispatch_status, '') NOT LIKE '%%Cancel%%'
        GROUP BY pd.project_code
        ORDER BY value DESC
        LIMIT 10
        """,
        as_dict=True,
    )
    for p in top_projects:
        p["completion_pct"] = round((p["completed"] / p["total"]) * 100) if p["total"] else 0
        p["basis"] = "po_lines"
    return {
        "projects_by_status": project_status,
        "value_vs_revenue": value_vs_revenue,
        "project_distribution_by_domain": domain_distribution,
        "top_projects": top_projects,
    }


@frappe.whitelist()
def list_customers(limit=200, search=None):
    filters = {}
    or_filters = []
    if search:
        like = f"%{search}%"
        or_filters = [["name", "like", like], ["customer_name", "like", like]]
    return frappe.get_list(
        "Customer",
        filters=filters,
        or_filters=or_filters,
        fields=["name", "customer_name"],
        order_by="modified desc",
        page_length=min(cint(limit) or 200, 500),
    )


@frappe.whitelist()
def list_item_catalog(limit=500, search=None):
    filters = {"disabled": 0}
    or_filters = []
    if search:
        like = f"%{search}%"
        or_filters = [["item_code", "like", like], ["item_name", "like", like]]
    items = frappe.get_list(
        "Item",
        filters=filters,
        or_filters=or_filters,
        fields=["name", "item_code", "item_name", "stock_uom", "description"],
        order_by="modified desc",
        page_length=min(cint(limit) or 500, 1000),
    )
    item_codes = [d.item_code for d in items if d.item_code]
    prices = {}
    if item_codes:
        rows = frappe.get_all(
            "Item Price",
            filters={"item_code": ["in", item_codes], "selling": 1},
            fields=["item_code", "price_list_rate"],
            order_by="valid_from desc, modified desc",
            limit_page_length=5000,
        )
        for row in rows:
            if row.item_code not in prices:
                prices[row.item_code] = flt(row.price_list_rate)

    return [
        {
            "item_code": d.item_code,
            "item_name": d.item_name,
            "uom": d.stock_uom,
            "description": d.description,
            "rate": prices.get(d.item_code, 0),
        }
        for d in items
    ]


@frappe.whitelist()
def create_customer(payload):
    data = _as_dict(payload)
    customer_name = data.get("customer_name") or data.get("customer") or data.get("name")
    if not customer_name:
        frappe.throw(_("customer_name is required"))

    customer_type = data.get("customer_type") or data.get("type") or ""

    fields = {"customer_name": customer_name}
    if customer_type:
        fields["customer_type"] = customer_type

    doc = frappe.get_doc({"doctype": "Customer", **fields})
    doc.insert(ignore_permissions=True)
    return {"name": doc.name, "customer_name": doc.customer_name}


def sync_inet_pm_roles(doc, method=None):
    """Give every INET PM user the INET Admin role as well (User.validate).

    INET PM deliberately carries no permissions of its own — it marks an
    admin whose sidebar hides Switch to Desk, Masters and the Certificate
    Tracker. The access itself still comes from INET Admin, which owns the
    app's 35 DocType permission rows and is what all this app's
    `"INET Admin" in roles` checks test. Pairing the two here means an
    administrator assigns ONE role and the PM's portal simply works, instead
    of the role silently granting nothing.

    Runs on validate (not after_insert) so the row is added before the save
    that triggered it is written — no second save, no recursion.
    """
    roles = {r.role for r in (doc.get("roles") or [])}
    if "INET PM" in roles and "INET Admin" not in roles:
        doc.append("roles", {"role": "INET Admin"})


@frappe.whitelist(allow_guest=True)
def get_logged_user():
    user = frappe.session.user
    if not user or user == "Guest":
        return {"user": "Guest", "full_name": "", "authenticated": False, "app_role": "field"}

    full_name = frappe.db.get_value("User", user, "full_name") or user.split("@")[0]
    user_roles = frappe.get_roles(user)

    # Warehouse Manager (Stock Manager) portal view is removed for now.
    # Without this, a Stock-Manager-only account (no other recognized
    # portal role) would fall through to the "field" default below and land
    # on the Field portal — worse than no access at all — so it's explicitly
    # treated as unauthenticated for the portal instead, same as Guest.
    if "Stock Manager" in user_roles and not (
        user == "Administrator"
        or set(user_roles) & {"System Manager", "INET Admin", "INET PIC", "INET IM", "INET Field Team"}
    ):
        return {"user": user, "full_name": full_name, "authenticated": False, "app_role": None}

    app_role = "field"
    im_name = None
    team_id = None

    # INET PM is the admin portal with the desk/masters/certificate entries
    # hidden — same role set underneath (see sync_inet_pm_roles), so it
    # resolves to "admin" here and is distinguished only by the is_pm flag
    # the sidebar reads. A user who is genuinely a System Manager /
    # Administrator is never treated as a PM, even if also tagged INET PM:
    # taking options away from someone who demonstrably has desk access
    # would be hiding a door they already hold the key to.
    is_pm = (
        "INET PM" in user_roles
        and user != "Administrator"
        and "System Manager" not in user_roles
    )

    if user == "Administrator" or "System Manager" in user_roles or "INET Admin" in user_roles:
        app_role = "admin"
    elif "INET PM" in user_roles:
        # Role assigned but the INET Admin pairing hasn't run yet (hook
        # skipped, or roles edited directly in the DB). Treat as admin
        # anyway so the portal is usable; sync_inet_pm_roles repairs the
        # pairing on the user's next save, and migrate backfills it.
        app_role = "admin"
    elif "INET PIC" in user_roles:
        app_role = "pic"
    elif "INET IM" in user_roles:
        app_role = "im"
        try:
            # ignore_permissions: session-init lookup must not be blocked by
            # role/user permissions. Use DocType existence check (registry)
            # instead of table_exists() which uses a stale table cache.
            if frappe.db.exists("DocType", "IM Master"):
                im_rec = frappe.get_all(
                    "IM Master", filters={"user": user},
                    fields=["name", "full_name"], limit=1,
                    ignore_permissions=True,
                )
                if not im_rec:
                    im_rec = frappe.get_all(
                        "IM Master", filters={"full_name": full_name},
                        fields=["name", "full_name"], limit=1,
                        ignore_permissions=True,
                    )
                if im_rec:
                    im_name = im_rec[0].name
        except Exception:
            pass
        if not im_name:
            im_name = full_name  # last-resort fallback
        im_teams = frappe.get_all(
            "INET Team",
            filters={"im": ["in", [im_name, full_name]]},
            fields=["team_id"],
            limit=100,
        )
        if im_teams:
            team_id = im_teams[0].team_id
    elif "INET Field Team" in user_roles:
        app_role = "field"
        # Primary: exact match by field_user (User link on INET Team)
        ft = frappe.get_all(
            "INET Team",
            filters={"field_user": user, "status": "Active"},
            fields=["team_id"],
            limit=1,
        )
        if ft:
            team_id = ft[0].team_id

    out = {
        "user": user,
        "full_name": full_name,
        "authenticated": True,
        "app_role": app_role,
        "is_pm": is_pm,
        "im_name": im_name,
        "team_id": team_id,
    }
    # SPA uses this on every POST; Desk /app load also calls get_csrf_token() and rotates it —
    # the portal must refresh via GET get_logged_user (no CSRF) after switching tabs.
    out["csrf_token"] = frappe.sessions.get_csrf_token()
    return out


@frappe.whitelist()
def report_project_status_summary(filters=None):
    from inet_app.inet_app.report.project_status_summary.project_status_summary import execute

    columns, data = execute(_as_dict(filters or {}))
    return {"columns": columns, "data": data}


@frappe.whitelist()
def report_budget_vs_actual_by_project(filters=None):
    from inet_app.inet_app.report.budget_vs_actual_by_project.budget_vs_actual_by_project import execute

    columns, data = execute(_as_dict(filters or {}))
    return {"columns": columns, "data": data}


def _report_totals(columns, data, ratios=None, skip=()):
    """Totals for a Script Report wrapper, so the portal gets KPI cards.

    Summable columns (Currency/Int/Float) are summed. Percent columns are
    NOT: averaging per-row percentages weights a team with 2 plans the same
    as one with 200, and summing them is meaningless. `ratios` maps a percent
    fieldname to the (numerator, denominator) columns it was computed from,
    so its total is recomputed from the real underlying totals — the same
    rule the rest of the app's reports follow.

    `skip` drops columns that are numeric but not aggregable — the weekly
    W-1..W-5 percentage columns, which have no denominator carried in the row
    to rebuild a total from.
    """
    totals = {}
    rows = data or []
    ratios = ratios or {}
    for col in columns or []:
        fn = col.get("fieldname")
        if not fn or fn == "sn" or fn in skip or fn in ratios:
            continue
        if col.get("fieldtype") in ("Currency", "Int", "Float"):
            totals[fn] = round(sum(flt(r.get(fn)) for r in rows), 2)
    for pct_field, (num_f, den_f) in ratios.items():
        num = sum(flt(r.get(num_f)) for r in rows)
        den = sum(flt(r.get(den_f)) for r in rows)
        totals[pct_field] = round(num / den * 100, 1) if den else 0.0
    return totals


@frappe.whitelist()
def report_team_utilization_report(filters=None):
    from inet_app.inet_app.report.team_utilization_report.team_utilization_report import execute

    # A Frappe query report may return (columns, data, message, chart); this
    # one adds a message when the row cap trimmed the oldest days off the
    # requested range, so unpack by position rather than to a fixed pair.
    result = execute(_as_dict(filters or {}))
    columns, data = result[0], result[1]
    message = result[2] if len(result) > 2 else None
    # achievement_pct is completed/planned in the report's own SQL, so its
    # total is the ratio of those two totals.
    totals = _report_totals(
        columns, data,
        ratios={"achievement_pct": ("completed_activities", "planned_activities")},
    )
    out = {"columns": columns, "data": data, "totals": totals}
    if message:
        out["message"] = message
    return out


@frappe.whitelist()
def report_daily_work_progress_report(filters=None):
    from inet_app.inet_app.report.daily_work_progress_report.daily_work_progress_report import execute

    columns, data = execute(_as_dict(filters or {}))
    return {"columns": columns, "data": data}


@frappe.whitelist()
def report_monthly_team_details(filters=None):
    from inet_app.inet_app.report.monthly_team_details.monthly_team_details import execute

    columns, data = execute(_as_dict(filters or {}))
    # utilization_pct is total_completed/total_planned in the report's own
    # SQL. W-1..W-5 are per-week percentages with no denominator in the row,
    # so they are left out rather than summed into a meaningless figure.
    totals = _report_totals(
        columns, data,
        ratios={"utilization_pct": ("total_completed", "total_planned")},
        skip=("w1", "w2", "w3", "w4", "w5"),
    )
    return {"columns": columns, "data": data, "totals": totals}


def _item_meta(item_code):
    meta = frappe.db.get_value(
        "Item",
        item_code,
        ["item_name", "stock_uom", "description"],
        as_dict=True,
    )
    return meta or {}


@frappe.whitelist()
def list_po_intake(limit=20, offset=0, search=None, status=None):
    filters = {}
    if status:
        filters["status"] = status

    or_filters = []
    if search:
        like = f"%{search}%"
        or_filters = [["po_no", "like", like], ["customer", "like", like]]

    return frappe.get_list(
        "PO Intake",
        filters=filters,
        or_filters=or_filters,
        fields=["name", "po_no", "customer", "transaction_date", "schedule_date", "status", "grand_total"],
        order_by="modified desc",
        start=cint(offset),
        page_length=min(cint(limit) or 20, 100),
    )


@frappe.whitelist()
def create_po_intake(payload):
    data = _as_dict(payload)
    po_lines = data.get("po_lines") or data.get("items") or []
    if not po_lines:
        frappe.throw(_("At least one PO line is required to create PO Intake."))

    if not data.get("po_no"):
        frappe.throw(_("PO No is required."))
    if not data.get("customer"):
        frappe.throw(_("Customer is required."))

    doc = frappe.get_doc(
        {
            "doctype": "PO Intake",
            "po_no": data.get("po_no"),
            "customer": data.get("customer"),
            "transaction_date": data.get("transaction_date"),
            "schedule_date": data.get("schedule_date"),
            "status": data.get("status") or "Active",
        }
    )

    # Build child rows.
    for i, row in enumerate(po_lines, start=1):
        item_code = row.get("item_code") or row.get("item")
        if not item_code:
            frappe.throw(_("PO line item_code is required (row {0}).").format(i))

        qty = flt(row.get("qty") or 0)
        if qty <= 0:
            frappe.throw(_("PO line qty must be > 0 for item {0}.").format(item_code))

        rate = flt(row.get("rate") or 0)
        line_amount = flt(row.get("line_amount") or 0)
        if rate <= 0 and line_amount > 0:
            rate = line_amount / qty

        meta = _item_meta(item_code)
        uom = row.get("uom") or meta.get("stock_uom")
        item_description = row.get("item_description") or meta.get("description") or meta.get("item_name")

        doc.append(
            "po_lines",
            {
                "po_line_no": row.get("po_line_no") or i,
                "shipment_number": row.get("shipment_number") or row.get("shipment_no") or "",
                "poid": _make_poid(data.get("po_no"), row.get("po_line_no") or i, row.get("shipment_number") or row.get("shipment_no")),
                "site_code": row.get("site_code") or row.get("site") or "",
                "item_code": item_code,
                "item_description": item_description,
                "qty": qty,
                "uom": uom,
                "rate": rate,
                "project_code": row.get("project_code") or data.get("project_code"),
                "activity_code": row.get("activity_code") or data.get("activity_code"),
                "area": row.get("area") or data.get("area"),
                "line_status": data.get("status") or "Active",
            },
        )

    # Ensure required linkage fields exist for every line (Project is required by DocType).
    for row in doc.po_lines:
        if not row.project_code:
            frappe.throw(_("PO line project_code is required (PO {0}, line {1}).").format(data.get("po_no"), row.po_line_no))

    doc.insert()
    if cint(data.get("submit")):
        doc.submit()
    return {"name": doc.name}


@frappe.whitelist()
def import_po_intake(rows):
    parsed = frappe.parse_json(rows) if isinstance(rows, str) else rows
    if not parsed:
        frappe.throw(_("No rows provided for import."))

    grouped = {}
    validation_errors = []
    for idx, row in enumerate(parsed):
        po_no = row.get("po_no") if isinstance(row, dict) else None
        customer = row.get("customer") if isinstance(row, dict) else None

        item_code = row.get("item_code") if isinstance(row, dict) else None
        qty = flt(row.get("qty") or 0)
        project_code = row.get("project_code") if isinstance(row, dict) else None

        if not po_no:
            validation_errors.append({"row": idx, "error": "Missing po_no"})
            continue
        if not customer:
            validation_errors.append({"row": idx, "po_no": po_no, "error": "Missing customer"})
            continue
        if not item_code:
            validation_errors.append({"row": idx, "po_no": po_no, "error": "Missing item_code"})
            continue
        if qty <= 0:
            validation_errors.append({"row": idx, "po_no": po_no, "item_code": item_code, "error": "qty must be > 0"})
            continue
        if not project_code:
            validation_errors.append({"row": idx, "po_no": po_no, "item_code": item_code, "error": "Missing project_code"})
            continue

        key = f"{po_no}|{customer}"
        group = grouped.setdefault(
            key,
            {
                "po_no": po_no,
                "customer": customer,
                "transaction_date": row.get("transaction_date"),
                "schedule_date": row.get("schedule_date"),
                "status": row.get("status") or "Active",
                "po_lines": [],
            },
        )

        group["po_lines"].append(
            {
                "po_line_no": row.get("po_line_no") or row.get("line_no") or len(group["po_lines"]) + 1,
                "shipment_number": row.get("shipment_number") or row.get("shipment_no") or "",
                "poid": _make_poid(po_no, row.get("po_line_no") or row.get("line_no") or len(group["po_lines"]) + 1, row.get("shipment_number") or row.get("shipment_no")),
                "site_code": row.get("site_code") or row.get("site") or "",
                "item_code": item_code,
                "item_description": row.get("item_description") or row.get("item_name") or "",
                "qty": qty,
                "rate": row.get("rate") or 0,
                "line_amount": row.get("line_amount") or row.get("amount") or 0,
                "uom": row.get("uom") or "",
                "project_code": project_code,
                "activity_code": row.get("activity_code") or "",
                "area": row.get("area") or "",
            }
        )

    created = []
    for _, payload in grouped.items():
        payload["transaction_date"] = payload.get("transaction_date") or frappe.utils.nowdate()
        payload["schedule_date"] = payload.get("schedule_date") or payload["transaction_date"]
        result = create_po_intake(payload)
        created.append(result["name"])

    return {
        "created_count": len(created),
        "names": created,
        "validation_errors": validation_errors[:200],
    }


@frappe.whitelist()
def list_im_masters(status=None, search=None):
    """List IM Master records with optional filters."""
    filters = {}
    if status:
        filters["status"] = status
    or_filters = []
    if search:
        like = f"%{search}%"
        or_filters = [["im_id", "like", like], ["full_name", "like", like], ["email", "like", like]]
    return frappe.get_list(
        "IM Master",
        filters=filters,
        or_filters=or_filters if or_filters else None,
        fields=["name", "im_id", "full_name", "email", "phone",
                "monthly_cost_sar", "daily_cost_sar", "status"],
        order_by="full_name asc",
        page_length=200,
    )
