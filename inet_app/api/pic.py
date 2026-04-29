"""Project Invoice Controller (PIC) endpoints.

The PIC owns the invoicing lifecycle after the IM marks a POID as
"Confirmation Done". Each PO Dispatch carries a single ``pic_status`` (MS1)
plus an optional ``pic_status_ms2`` and the milestone amounts that flow into
the Cash Flow Summary dashboard.
"""

import frappe
from frappe.utils import cint, flt, getdate, nowdate

from inet_app.api.command_center import (
    _ensure_list,
    _portal_filters_dict,
    _portal_row_limit,
    _sql_in_or_eq,
    _sql_like_tokens,
    _sql_limit_suffix,
    _sql_search_clause,
)


# Initial-state rule: if the IM has marked Work Done.submission_status =
# "Confirmation Done" (or the subcon-equivalent on PO Dispatch), the line
# enters the PIC pipeline as "Under Process to Apply"; everything else is
# "Work Not Done". This is computed on read so historical data lights up
# without a backfill — the moment the PIC actually saves a status, the
# stored value takes over.
_PIC_INITIAL_RULE_SQL = """
CASE
  WHEN IFNULL(pd.pic_status,'') != '' THEN pd.pic_status
  WHEN IFNULL(wd_sub.confirmed,0) = 1
       OR IFNULL(pd.subcon_submission_status,'') = 'Confirmation Done'
    THEN 'Under Process to Apply'
  ELSE 'Work Not Done'
END
"""


_PIC_FROM_JOIN = """
FROM `tabPO Dispatch` pd
LEFT JOIN `tabIM Master` imm ON imm.name = pd.im
LEFT JOIN `tabProject Control Center` proj ON proj.name = pd.project_code
LEFT JOIN (
    SELECT rp.po_dispatch AS po_dispatch,
           MAX(de.execution_date) AS execution_date,
           MAX(it.team_type) AS team_type,
           MAX(it.subcontractor) AS subcontractor
    FROM `tabRollout Plan` rp
    LEFT JOIN `tabDaily Execution` de ON de.rollout_plan = rp.name
    LEFT JOIN `tabINET Team` it ON it.name = rp.team
    GROUP BY rp.po_dispatch
) plan ON plan.po_dispatch = pd.name
LEFT JOIN (
    SELECT rp.po_dispatch AS po_dispatch,
           MAX(IF(wd.submission_status = 'Confirmation Done', 1, 0)) AS confirmed
    FROM `tabRollout Plan` rp
    INNER JOIN `tabDaily Execution` de ON de.rollout_plan = rp.name
    INNER JOIN `tabWork Done` wd ON wd.execution = de.name
    GROUP BY rp.po_dispatch
) wd_sub ON wd_sub.po_dispatch = pd.name
LEFT JOIN `tabSubcontractor Master` sm ON sm.name = plan.subcontractor
"""


def _pic_role_or_throw():
    roles = set(frappe.get_roles(frappe.session.user))
    if not roles & {"Administrator", "System Manager", "INET Admin", "INET PIC"}:
        frappe.throw("Not permitted — PIC role required.", frappe.PermissionError)


@frappe.whitelist()
def list_pic_rows(filters=None, limit=500, portal_filters=None):
    """Return PO Dispatch rows enriched with PIC fields + initial-state rule.

    ``filters`` (legacy): currently unused; reserved for symmetry with the
    other list_* helpers.
    ``portal_filters`` (JSON dict): ``search``, ``project_code``, ``site_code``,
    ``im``, ``pic_status`` (multi), ``pic_status_ms2`` (multi),
    ``from_date`` / ``to_date`` (against ``ms1_applied_date``).
    """
    _pic_role_or_throw()
    pf = _portal_filters_dict(portal_filters)
    limit_page_length = _portal_row_limit(limit, 500)

    where = ["1=1"]
    params = []

    for col, key in (
        ("pd.project_code", "project_code"),
        ("pd.site_code", "site_code"),
        ("pd.im", "im"),
    ):
        c, p = _sql_in_or_eq(col, pf.get(key))
        if c:
            where.append(c)
            params.extend(p)

    pic_vals = _ensure_list(pf.get("pic_status"))
    if pic_vals:
        # Match either the stored value OR the computed initial state.
        ph = ", ".join(["%s"] * len(pic_vals))
        where.append(f"({_PIC_INITIAL_RULE_SQL.strip()}) IN ({ph})")
        params.extend(pic_vals)

    pic_ms2_vals = _ensure_list(pf.get("pic_status_ms2"))
    if pic_ms2_vals:
        ph = ", ".join(["%s"] * len(pic_ms2_vals))
        where.append(f"IFNULL(pd.pic_status_ms2,'') IN ({ph})")
        params.extend(pic_ms2_vals)

    if pf.get("from_date"):
        where.append("pd.ms1_applied_date >= %s")
        params.append(pf["from_date"])
    if pf.get("to_date"):
        where.append("pd.ms1_applied_date <= %s")
        params.append(pf["to_date"])

    if pf.get("dispatch_status"):
        ds_vals = _ensure_list(pf.get("dispatch_status"))
        ph = ", ".join(["%s"] * len(ds_vals))
        where.append(f"IFNULL(pd.dispatch_status,'') IN ({ph})")
        params.extend(ds_vals)
    else:
        # Default: hide cancelled / closed (archive) lines so the active
        # invoicing pipeline is the focus.
        where.append("IFNULL(pd.dispatch_status,'') NOT IN ('Cancelled', 'Closed')")

    search = pf.get("search") or pf.get("q") or ""
    if search:
        clause, like_params = _sql_search_clause(
            "CONCAT_WS(' ',"
            " IFNULL(pd.poid,''), IFNULL(pd.po_no,''), IFNULL(pd.item_code,''),"
            " IFNULL(pd.item_description,''),"
            " IFNULL(pd.project_code,''), IFNULL(proj.project_name,''),"
            " IFNULL(pd.project_domain,''),"
            " IFNULL(pd.site_code,''), IFNULL(pd.site_name,''),"
            " IFNULL(pd.center_area,''), IFNULL(imm.full_name,''),"
            " IFNULL(pd.isdp_ibuy_owner,''), IFNULL(pd.isdp_owner_ms2,''),"
            " IFNULL(pd.payment_terms,''))",
            search,
        )
        if clause:
            where.append(clause)
            params.extend(like_params)

    sql = f"""
    SELECT  /* {limit_page_length} = 0 → unlimited */
      pd.name AS po_dispatch,
      pd.poid,
      pd.po_no,
      pd.po_line_no,
      pd.item_code,
      pd.item_description,
      pd.qty,
      pd.rate,
      pd.line_amount,
      pd.tax_rate,
      pd.project_domain,
      pd.project_code,
      proj.project_name AS project_name,
      pd.site_code,
      pd.site_name,
      pd.center_area,
      pd.im,
      imm.full_name AS im_full_name,
      pd.dispatch_status,
      pd.payment_terms,
      pd.sqc_status, pd.pat_status, pd.im_rejection_remark,
      ({_PIC_INITIAL_RULE_SQL.strip()}) AS pic_status_effective,
      pd.pic_status AS pic_status_stored,
      pd.pic_status_ms2,
      pd.isdp_ibuy_owner, pd.isdp_owner_ms2,
      pd.pic_detail_remark, pd.pic_detail_remark_ms2,
      pd.ms1_pct, pd.ms2_pct,
      pd.ms1_amount, pd.ms2_amount,
      pd.ms1_invoiced, pd.ms2_invoiced,
      pd.ms1_unbilled, pd.ms2_unbilled,
      pd.subcon_pct_ms1, pd.inet_pct_ms1,
      pd.subcon_pct_ms2, pd.inet_pct_ms2,
      pd.ms1_applied_date, pd.ms2_applied_date,
      pd.ms1_invoice_month, pd.ms2_invoice_month,
      pd.ms1_ibuy_inv_date, pd.ms2_ibuy_inv_date,
      pd.ms1_payment_received_date, pd.ms2_payment_received_date,
      pd.remaining_milestone_pct,
      plan.team_type AS team_type,
      sm.subcontractor_name AS subcontractor,
      sm.sub_payout_pct AS subcontractor_payout_pct,
      sm.inet_margin_pct AS subcontractor_margin_pct,
      pd.modified
    {_PIC_FROM_JOIN}
    WHERE {' AND '.join(where)}
    ORDER BY pd.modified DESC
    {_sql_limit_suffix(limit_page_length)}
    """
    return frappe.db.sql(sql, tuple(params), as_dict=True)


# Fields the PIC is allowed to write via update_pic_row. Anything outside this
# allowlist is silently ignored to keep the IM/admin-owned columns safe.
_PIC_WRITABLE = (
    # MS1
    "pic_status", "isdp_ibuy_owner", "pic_detail_remark", "ms1_applied_date",
    "ms1_invoiced", "subcon_pct_ms1", "inet_pct_ms1",
    "ms1_invoice_month", "ms1_ibuy_inv_date", "ms1_payment_received_date",
    # MS2
    "pic_status_ms2", "isdp_owner_ms2", "pic_detail_remark_ms2", "ms2_applied_date",
    "ms2_invoiced", "subcon_pct_ms2", "inet_pct_ms2",
    "ms2_invoice_month", "ms2_ibuy_inv_date", "ms2_payment_received_date",
    # Common
    "remaining_milestone_pct",
    "ms1_pct", "ms2_pct",  # PIC may override the parsed split
    # Acceptance gates — PIC can correct typos coming from the master tracker
    "sqc_status", "pat_status", "im_rejection_remark",
)
_PIC_WRITABLE_SET = frozenset(_PIC_WRITABLE)


@frappe.whitelist()
def update_pic_row(po_dispatch, fields):
    """Patch one PO Dispatch's PIC fields. Runs validate so amounts recompute."""
    _pic_role_or_throw()
    if not po_dispatch:
        frappe.throw("po_dispatch is required")
    if isinstance(fields, str):
        fields = frappe.parse_json(fields) or {}
    if not isinstance(fields, dict) or not fields:
        frappe.throw("fields payload is required")

    if not frappe.db.exists("PO Dispatch", po_dispatch):
        frappe.throw(f"PO Dispatch not found: {po_dispatch}")

    doc = frappe.get_doc("PO Dispatch", po_dispatch)
    touched = []
    for k, v in fields.items():
        if k not in _PIC_WRITABLE_SET:
            continue
        if isinstance(v, str):
            v = v.strip() or None
        setattr(doc, k, v)
        touched.append(k)
    if not touched:
        frappe.throw("No writable PIC fields in payload")

    doc.flags.ignore_permissions = True
    doc.save()
    frappe.db.commit()

    return {
        "po_dispatch": doc.name,
        "poid": doc.poid or doc.name,
        "updated_fields": touched,
        "ms1_amount": flt(doc.ms1_amount),
        "ms2_amount": flt(doc.ms2_amount),
        "ms1_unbilled": flt(doc.ms1_unbilled),
        "ms2_unbilled": flt(doc.ms2_unbilled),
    }


@frappe.whitelist()
def bulk_update_pic_status(po_dispatches, pic_status, milestone="MS1", remark=None):
    """Set ``pic_status`` (MS1) or ``pic_status_ms2`` (MS2) on N rows at once."""
    _pic_role_or_throw()
    if isinstance(po_dispatches, str):
        try:
            parsed = frappe.parse_json(po_dispatches)
            if isinstance(parsed, (list, tuple)):
                po_dispatches = parsed
        except Exception:
            po_dispatches = [po_dispatches]
    if not isinstance(po_dispatches, (list, tuple)) or not po_dispatches:
        frappe.throw("po_dispatches list is required")

    milestone = str(milestone or "MS1").upper()
    if milestone == "MS2":
        status_field = "pic_status_ms2"
        remark_field = "pic_detail_remark_ms2"
    else:
        status_field = "pic_status"
        remark_field = "pic_detail_remark"

    updated = []
    errors = []
    for name in po_dispatches:
        name = str(name or "").strip()
        if not name:
            continue
        if not frappe.db.exists("PO Dispatch", name):
            errors.append({"po_dispatch": name, "error": "Not found"})
            continue
        try:
            payload = {status_field: pic_status}
            if remark:
                payload[remark_field] = str(remark)[:8000]
            frappe.db.set_value("PO Dispatch", name, payload, update_modified=True)
            updated.append({"po_dispatch": name, status_field: pic_status})
        except Exception as e:
            errors.append({"po_dispatch": name, "error": frappe.utils.cstr(e)[:500]})

    frappe.db.commit()
    return {
        "updated": updated,
        "errors": errors,
        "summary": {
            "total": len(po_dispatches),
            "updated_count": len(updated),
            "error_count": len(errors),
            "field": status_field,
            "value": pic_status,
        },
    }


@frappe.whitelist()
def get_pic_dashboard(from_date=None, to_date=None):
    """KPIs + bucket counts + monthly invoicing roll-up for the PIC dashboard.

    Mirrors the spreadsheet's "Cash Flow Summary" sheet:
      - Acceptance bucket counts + amounts (per pic_status)
      - Pending approvals by ISDP / I-Buy owner
      - Monthly invoicing roll-up (MS1 + MS2 invoiced per month)
      - INET vs Subcon split by team_type
    """
    _pic_role_or_throw()

    fd = getdate(from_date) if from_date else None
    td = getdate(to_date) if to_date else None
    range_clause = ""
    range_params = []
    if fd and td:
        range_clause = "AND IFNULL(pd.ms1_applied_date, pd.ms2_applied_date) BETWEEN %s AND %s"
        range_params = [fd, td]
    elif fd:
        range_clause = "AND IFNULL(pd.ms1_applied_date, pd.ms2_applied_date) >= %s"
        range_params = [fd]
    elif td:
        range_clause = "AND IFNULL(pd.ms1_applied_date, pd.ms2_applied_date) <= %s"
        range_params = [td]

    # ── Acceptance buckets — count + 1st/2nd/total amounts per pic_status.
    bucket_rows = frappe.db.sql(
        f"""
        SELECT bucket,
               COUNT(*) AS line_count,
               COALESCE(SUM(ms1_amount), 0) AS ms1_total,
               COALESCE(SUM(ms2_amount), 0) AS ms2_total,
               COALESCE(SUM(ms1_amount + ms2_amount), 0) AS total
        FROM (
          SELECT
            ({_PIC_INITIAL_RULE_SQL.strip()}) AS bucket,
            pd.ms1_amount, pd.ms2_amount
          {_PIC_FROM_JOIN}
          WHERE IFNULL(pd.dispatch_status,'') NOT IN ('Cancelled','Closed')
          {range_clause}
        ) t
        GROUP BY bucket
        ORDER BY line_count DESC
        """,
        tuple(range_params),
        as_dict=True,
    )

    # ── Pending approvals by I-Buy / ISDP owner (split by who's holding the line).
    pending_ibuy = frappe.db.sql(
        f"""
        SELECT pd.isdp_ibuy_owner AS owner,
               COUNT(*) AS line_count,
               COALESCE(SUM(pd.ms1_amount), 0) AS amount_ms1,
               COALESCE(SUM(pd.ms2_amount), 0) AS amount_ms2
        {_PIC_FROM_JOIN}
        WHERE IFNULL(pd.dispatch_status,'') NOT IN ('Cancelled','Closed')
          AND IFNULL(pd.isdp_ibuy_owner,'') != ''
          AND ({_PIC_INITIAL_RULE_SQL.strip()}) = 'Under I-BUY'
          {range_clause}
        GROUP BY pd.isdp_ibuy_owner
        ORDER BY line_count DESC
        LIMIT 50
        """,
        tuple(range_params),
        as_dict=True,
    )
    pending_isdp = frappe.db.sql(
        f"""
        SELECT pd.isdp_ibuy_owner AS owner,
               COUNT(*) AS line_count,
               COALESCE(SUM(pd.ms1_amount), 0) AS amount_ms1,
               COALESCE(SUM(pd.ms2_amount), 0) AS amount_ms2
        {_PIC_FROM_JOIN}
        WHERE IFNULL(pd.dispatch_status,'') NOT IN ('Cancelled','Closed')
          AND IFNULL(pd.isdp_ibuy_owner,'') != ''
          AND ({_PIC_INITIAL_RULE_SQL.strip()}) = 'Under ISDP'
          {range_clause}
        GROUP BY pd.isdp_ibuy_owner
        ORDER BY line_count DESC
        LIMIT 50
        """,
        tuple(range_params),
        as_dict=True,
    )

    # ── Monthly invoicing roll-up: from ms1_invoice_month / ms2_invoice_month.
    monthly = frappe.db.sql(
        """
        SELECT m AS invoice_month,
               COALESCE(SUM(ms1_inv), 0) AS ms1_invoiced,
               COALESCE(SUM(ms2_inv), 0) AS ms2_invoiced,
               COALESCE(SUM(ms1_inv + ms2_inv), 0) AS total
        FROM (
          SELECT DATE_FORMAT(ms1_invoice_month, '%Y-%m') AS m,
                 ms1_invoiced AS ms1_inv, 0 AS ms2_inv
          FROM `tabPO Dispatch`
          WHERE ms1_invoice_month IS NOT NULL
          UNION ALL
          SELECT DATE_FORMAT(ms2_invoice_month, '%Y-%m') AS m,
                 0 AS ms1_inv, ms2_invoiced AS ms2_inv
          FROM `tabPO Dispatch`
          WHERE ms2_invoice_month IS NOT NULL
        ) u
        WHERE m IS NOT NULL
        GROUP BY m
        ORDER BY m DESC
        LIMIT 36
        """,
        as_dict=True,
    )

    # ── INET vs Subcon split — based on the assigned team's team_type.
    inet_subcon = frappe.db.sql(
        f"""
        SELECT COALESCE(plan.team_type, 'INET') AS team_type,
               COUNT(*) AS line_count,
               COALESCE(SUM(pd.ms1_invoiced + pd.ms2_invoiced), 0) AS invoiced_total,
               COALESCE(SUM(pd.ms1_amount + pd.ms2_amount), 0) AS po_total
        {_PIC_FROM_JOIN}
        WHERE IFNULL(pd.dispatch_status,'') NOT IN ('Cancelled','Closed')
          {range_clause}
        GROUP BY COALESCE(plan.team_type, 'INET')
        """,
        tuple(range_params),
        as_dict=True,
    )

    # ── Top-line KPIs.
    kpi = frappe.db.sql(
        f"""
        SELECT
          COALESCE(SUM(pd.ms1_invoiced + pd.ms2_invoiced), 0) AS total_invoiced,
          COALESCE(SUM(pd.ms1_unbilled), 0) AS unbilled_ms1,
          COALESCE(SUM(pd.ms2_unbilled), 0) AS unbilled_ms2,
          COUNT(*) AS line_count
        {_PIC_FROM_JOIN}
        WHERE IFNULL(pd.dispatch_status,'') NOT IN ('Cancelled','Closed')
          {range_clause}
        """,
        tuple(range_params),
        as_dict=True,
    )
    kpi = (kpi[0] if kpi else {}) or {}

    return {
        "from_date": str(fd) if fd else None,
        "to_date": str(td) if td else None,
        "kpi": {
            "total_invoiced": flt(kpi.get("total_invoiced") or 0),
            "unbilled_ms1": flt(kpi.get("unbilled_ms1") or 0),
            "unbilled_ms2": flt(kpi.get("unbilled_ms2") or 0),
            "line_count": cint(kpi.get("line_count") or 0),
        },
        "buckets": bucket_rows,
        "pending_ibuy": pending_ibuy,
        "pending_isdp": pending_isdp,
        "monthly": monthly,
        "inet_subcon": inet_subcon,
    }


@frappe.whitelist()
def get_pic_capability():
    """FE bootstrap: tells the SPA whether the current session is a PIC."""
    roles = set(frappe.get_roles(frappe.session.user))
    return {
        "is_pic": bool(roles & {"INET PIC"}),
        "is_admin": bool(roles & {"Administrator", "System Manager", "INET Admin"}),
    }
