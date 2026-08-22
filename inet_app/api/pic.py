"""Project Invoice Controller (PIC) endpoints.

The PIC owns the invoicing lifecycle after the IM marks a POID as
"Confirmation Done". Each PO Dispatch carries a single ``pic_status`` (MS1)
plus an optional ``pic_status_ms2`` and the milestone amounts that flow into
the Cash Flow Summary dashboard.
"""

import frappe
from frappe.utils import cint, flt, getdate, nowdate
from inet_app.api.notifications import _make_notification, _notify_role
from inet_app.setup import ACCOUNTING_DUID_FIELDNAME

from inet_app.api.command_center import (
    _MS1_INVOICED_SQL,
    _MS1_NOT_INVOICED_SQL,
    _MS2_INVOICED_SQL,
    _MS2_NOT_INVOICED_SQL,
    _NOT_CANCELLED_SQL,
    _REPORTING_SCOPE_SQL,
    _batch_item_activity_types,
    _dashboard_etag,
    _ensure_list,
    _iso_now,
    _po_dispatch_col_expr,
    _portal_filters_dict,
    _portal_row_limit,
    _sql_in_or_eq,
    _sql_like_pattern,
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


# A "PO Line Canceled" row auto-carries dispatch_status='Cancelled' (see
# update_pic_row / bulk_update_pic_status), but PIC's own views must keep
# showing it. Any default "hide dispatch_status='Cancelled'" guard in this
# module should OR against this so those rows aren't hidden from the very
# dashboards that report them.
_PIC_LINE_CANCELED_SQL = (
    "(IFNULL(pd.pic_status,'') = 'PO Line Canceled' OR IFNULL(pd.pic_status_ms2,'') = 'PO Line Canceled')"
)


# MS2's "effective" status — MS2 has no Work-Done-confirmation fallback rule
# (that only drives MS1's initial state), so blank simply reads as
# 'Work Not Done', same convention already used ad hoc elsewhere in this file.
_PIC_MS2_EFFECTIVE_SQL = "COALESCE(NULLIF(pd.pic_status_ms2,''), 'Work Not Done')"

_PIC_PENDING_STATUSES_SQL = "('Work Not Done')"

# A row is "Pending" (hasn't reached PIC yet) only when BOTH milestones are
# still genuinely untouched — a row with one milestone progressed (including
# just flagged "PO Need to Cancel") belongs in the Active stage even if the
# other hasn't started. "PO Need to Cancel" deliberately does NOT count as
# "still pending" here — flagging a line to cancel is itself PIC taking
# action on it, so it belongs on the Active page like any other in-progress
# status, not lumped in with untouched "Work Not Done" rows.
_PIC_PENDING_SQL = f"""
(({_PIC_INITIAL_RULE_SQL.strip()}) IN {_PIC_PENDING_STATUSES_SQL}
 AND {_PIC_MS2_EFFECTIVE_SQL} IN {_PIC_PENDING_STATUSES_SQL})
"""

_PIC_DISPATCH_CANCELLED_SQL = "IFNULL(pd.dispatch_status,'') = 'Cancelled'"

# Page-routing only: a dispatch-level cancellation — whether it came from
# PIC's own "PO Line Canceled" or from an unrelated desk-level cancel of the
# whole PO Dispatch — means the row is dead and belongs on the Cancelled
# page even if PIC's own pic_status hasn't caught up yet. Kept separate from
# _PIC_LINE_CANCELED_SQL, which other queries (dashboard/summary/report) use
# purely as a pic_status-driven exemption — broadening that one would
# silently change unrelated financial totals those queries were tuned for.
_PIC_EFFECTIVELY_CANCELLED_SQL = f"({_PIC_LINE_CANCELED_SQL} OR {_PIC_DISPATCH_CANCELLED_SQL})"

# Page-routing only, same spirit as _PIC_EFFECTIVELY_CANCELLED_SQL above:
# dispatch_status='Closed' is already the authoritative "both milestones
# resolved" signal update_pic_row/bulk_update_pic_status compute and persist
# (see _PIC_MS_RESOLVED_FOR_CLOSE below) — reuse it directly rather than
# re-deriving the same rule here a second time.
_PIC_DISPATCH_CLOSED_SQL = "IFNULL(pd.dispatch_status,'') = 'Closed'"
_PIC_EFFECTIVELY_CLOSED_SQL = f"({_PIC_DISPATCH_CLOSED_SQL} AND NOT {_PIC_EFFECTIVELY_CANCELLED_SQL})"

_PIC_STAGE_SQL = {
    "pending": f"({_PIC_PENDING_SQL} AND NOT {_PIC_EFFECTIVELY_CANCELLED_SQL})",
    "active": f"(NOT {_PIC_PENDING_SQL} AND NOT {_PIC_EFFECTIVELY_CANCELLED_SQL} AND NOT {_PIC_EFFECTIVELY_CLOSED_SQL})",
    "closed": _PIC_EFFECTIVELY_CLOSED_SQL,
    "cancelled": _PIC_EFFECTIVELY_CANCELLED_SQL,
}


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
           MAX(IF(wd.submission_status = 'Confirmation Done', 1, 0)) AS confirmed,
           CASE MAX(CASE wd.submission_status
               WHEN 'PIC Rejected'          THEN 3
               WHEN 'Confirmation Done'      THEN 2
               WHEN 'Ready for Confirmation' THEN 1
               ELSE 0 END)
               WHEN 3 THEN 'PIC Rejected'
               WHEN 2 THEN 'Confirmation Done'
               WHEN 1 THEN 'Ready for Confirmation'
               ELSE NULL
           END AS im_submission_status
    FROM `tabRollout Plan` rp
    INNER JOIN `tabDaily Execution` de ON de.rollout_plan = rp.name
    INNER JOIN `tabWork Done` wd ON wd.execution = de.name
    GROUP BY rp.po_dispatch
) wd_sub ON wd_sub.po_dispatch = pd.name
LEFT JOIN `tabINET Team` sc_team_full ON sc_team_full.name = pd.backend_team
LEFT JOIN `tabSubcontract Master` sm
       ON sm.name = COALESCE(plan.subcontractor, sc_team_full.subcontractor)
LEFT JOIN `tabSubcontract Master` sm_pd ON sm_pd.name = pd.contract
"""


# Lean FROM clause for callers that don't need team_type / subcontractor —
# notably PIC Tracker. Drops the heaviest aggregate (Rollout Plan +
# Daily Execution + INET Team grouped by po_dispatch) and the Subcontractor
# Master join. Keeps only what the initial-state rule actually reads
# (``wd_sub.confirmed``) plus the IM Master / Project Control Center joins
# used in label projection and search. ~50–80% wall-time drop on PIC
# Tracker list calls.
# plan_contract: lightweight subquery (no Daily Execution) to resolve the
# subcontractor (and its contract_model) via the Rollout Plan team.
_PIC_FROM_JOIN_LEAN = """
FROM `tabPO Dispatch` pd
LEFT JOIN `tabIM Master` imm ON imm.name = pd.im
LEFT JOIN `tabProject Control Center` proj ON proj.name = pd.project_code
LEFT JOIN (
    SELECT rp.po_dispatch AS po_dispatch,
           MAX(IF(wd.submission_status = 'Confirmation Done', 1, 0)) AS confirmed,
           CASE MAX(CASE wd.submission_status
               WHEN 'PIC Rejected'          THEN 3
               WHEN 'Confirmation Done'      THEN 2
               WHEN 'Ready for Confirmation' THEN 1
               ELSE 0 END)
               WHEN 3 THEN 'PIC Rejected'
               WHEN 2 THEN 'Confirmation Done'
               WHEN 1 THEN 'Ready for Confirmation'
               ELSE NULL
           END AS im_submission_status
    FROM `tabRollout Plan` rp
    INNER JOIN `tabDaily Execution` de ON de.rollout_plan = rp.name
    INNER JOIN `tabWork Done` wd ON wd.execution = de.name
    GROUP BY rp.po_dispatch
) wd_sub ON wd_sub.po_dispatch = pd.name
LEFT JOIN (
    SELECT rp.po_dispatch, MAX(it.subcontractor) AS subcontractor
    FROM `tabRollout Plan` rp
    LEFT JOIN `tabINET Team` it ON it.name = rp.team
    GROUP BY rp.po_dispatch
) plan_contract ON plan_contract.po_dispatch = pd.name
LEFT JOIN `tabINET Team` sc_team ON sc_team.name = pd.backend_team
LEFT JOIN `tabSubcontract Master` sm_sub
       ON sm_sub.name = COALESCE(plan_contract.subcontractor, sc_team.subcontractor)
LEFT JOIN `tabSubcontract Master` sm_pd ON sm_pd.name = pd.contract
"""


def _pic_role_or_throw():
    roles = set(frappe.get_roles(frappe.session.user))
    required = {"Administrator", "System Manager", "INET Admin", "INET PIC"}
    if not roles & required:
        user_roles = ", ".join(sorted(roles - {"All", "Guest"})) or "none"
        frappe.throw(
            f"Not permitted. Your roles: {user_roles}. "
            f"Required (any one of): {', '.join(sorted(required))}.",
            frappe.PermissionError,
        )


@frappe.whitelist()
def list_pic_rows(filters=None, limit=500, portal_filters=None, with_team_type=0, stage=None):
    """Return PO Dispatch rows enriched with PIC fields + initial-state rule.

    ``filters`` (legacy): currently unused; reserved for symmetry with the
    other list_* helpers.
    ``stage``: one of "pending" / "active" / "cancelled" — the 3-way,
    mutually-exclusive-and-collectively-exhaustive partition backing the 3
    PIC pages (Pending / PIC Tracker / Cancelled). Required. See
    ``_PIC_STAGE_SQL``.
    ``portal_filters`` (JSON dict): ``search``, ``project_code``, ``site_code``,
    ``im``, ``pic_status`` (multi), ``pic_status_ms2`` (multi),
    ``dispatch_status`` (multi), ``im_status`` (multi, "__NONE__" for blank),
    ``from_date`` / ``to_date`` (against ``ms1_applied_date``). These narrow
    further *within* ``stage`` — they no longer determine the default set.
    ``with_team_type``: when truthy, include the heavy Rollout Plan
    aggregate that resolves ``team_type`` / ``subcontractor`` /
    ``subcontractor_payout_pct`` / ``subcontractor_margin_pct``. Default
    is **off** — the PIC Tracker doesn't use these columns and the
    aggregate is the dominant cost of the query.
    """
    _pic_role_or_throw()
    if stage not in _PIC_STAGE_SQL:
        frappe.throw(f"stage must be one of {sorted(_PIC_STAGE_SQL)}, got {stage!r}")
    pf = _portal_filters_dict(portal_filters)
    limit_page_length = _portal_row_limit(limit, 500)
    with_team_type = bool(cint(with_team_type))

    where = [
        "1=1",
        "IFNULL(pd.is_internal_work, 0) = 0",
        "IFNULL(pd.is_dummy_po, 0) = 0",
        _PIC_STAGE_SQL[stage],
    ]
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
    pic_ms2_vals = _ensure_list(pf.get("pic_status_ms2"))

    if pic_vals and pic_ms2_vals:
        # Both filters set → OR logic, so a line is shown if either its MS1
        # effective status or its MS2 status matches.
        ph1 = ", ".join(["%s"] * len(pic_vals))
        ph2 = ", ".join(["%s"] * len(pic_ms2_vals))
        where.append(
            f"(({_PIC_INITIAL_RULE_SQL.strip()}) IN ({ph1})"
            f" OR IFNULL(pd.pic_status_ms2,'') IN ({ph2}))"
        )
        params.extend(pic_vals)
        params.extend(pic_ms2_vals)
    elif pic_vals:
        ph = ", ".join(["%s"] * len(pic_vals))
        where.append(f"({_PIC_INITIAL_RULE_SQL.strip()}) IN ({ph})")
        params.extend(pic_vals)
    elif pic_ms2_vals:
        ph = ", ".join(["%s"] * len(pic_ms2_vals))
        where.append(f"IFNULL(pd.pic_status_ms2,'') IN ({ph})")
        params.extend(pic_ms2_vals)

    if pf.get("from_date"):
        where.append("pd.ms1_applied_date >= %s")
        params.append(pf["from_date"])
    if pf.get("to_date"):
        where.append("pd.ms1_applied_date <= %s")
        params.append(pf["to_date"])

    invoice_month_vals = _ensure_list(pf.get("invoice_month"))
    if invoice_month_vals:
        ph = ", ".join(["%s"] * len(invoice_month_vals))
        where.append(
            f"(DATE_FORMAT(pd.ms1_invoice_month, '%%Y-%%m') IN ({ph})"
            f" OR DATE_FORMAT(pd.ms2_invoice_month, '%%Y-%%m') IN ({ph}))"
        )
        params.extend(invoice_month_vals * 2)

    # dispatch_status is purely an optional explicit narrowing filter here —
    # the `stage` clause above (driven only by pic_status/pic_status_ms2) is
    # what determines default visibility, deliberately not dispatch_status
    # (which can be hand-set from the desk for reasons unrelated to the PIC
    # flow; gating default visibility on it could let a row fall through all
    # 3 pages).
    if pf.get("dispatch_status"):
        ds_vals = _ensure_list(pf.get("dispatch_status"))
        ph = ", ".join(["%s"] * len(ds_vals))
        where.append(f"IFNULL(pd.dispatch_status,'') IN ({ph})")
        params.extend(ds_vals)

    # im_status: the IM-side submission state (Ready for Confirmation /
    # Confirmation Done / PIC Rejected) computed in wd_sub above — distinct
    # from pic_status/dispatch_status, which are PIC's own fields.
    # "__NONE__" is the sentinel this app already uses elsewhere for "blank" —
    # here that means no Work Done has ever been submitted for this line yet.
    im_status_vals = _ensure_list(pf.get("im_status"))
    if im_status_vals:
        wants_none = "__NONE__" in im_status_vals
        real_vals = [v for v in im_status_vals if v != "__NONE__"]
        parts = []
        if wants_none:
            parts.append("IFNULL(wd_sub.im_submission_status,'') = ''")
        if real_vals:
            ph = ", ".join(["%s"] * len(real_vals))
            parts.append(f"wd_sub.im_submission_status IN ({ph})")
            params.extend(real_vals)
        if parts:
            where.append("(" + " OR ".join(parts) + ")")

    isdp_vals = _ensure_list(pf.get("isdp_owner"))
    if isdp_vals:
        ph = ", ".join(["%s"] * len(isdp_vals))
        where.append(f"IFNULL(pd.isdp_owner,'') IN ({ph})")
        params.extend(isdp_vals)

    ibuy_vals = _ensure_list(pf.get("ibuy_owner"))
    if ibuy_vals:
        ph = ", ".join(["%s"] * len(ibuy_vals))
        where.append(f"IFNULL(pd.ibuy_owner,'') IN ({ph})")
        params.extend(ibuy_vals)

    # subcontractor filter — resolved after with_team_type is known so the
    # correct join alias is used (sm vs sm_sub for the Rollout Plan branch).
    subcon_vals = _ensure_list(pf.get("subcontractor"))

    # Same subcontractor/contract-model resolution `team_cols` uses below —
    # computed here too so the per-column filter and general search can
    # reference it.
    if with_team_type:
        _subcon_expr_pic = "COALESCE(sm_pd.subcontractor_name, sm.subcontractor_name)"
        _contract_model_expr_pic = "COALESCE(sm_pd.contract_model, sm.contract_model)"
    else:
        _subcon_expr_pic = "COALESCE(sm_pd.subcontractor_name, sm_sub.subcontractor_name)"
        _contract_model_expr_pic = "COALESCE(sm_pd.contract_model, sm_sub.contract_model)"

    sqc_expr = _po_dispatch_col_expr("sqc_status")
    pat_expr = _po_dispatch_col_expr("pat_status")
    im_rej_expr = _po_dispatch_col_expr("im_rejection_remark")
    pic_rej_expr = _po_dispatch_col_expr("pic_rejection_remark")
    _pic_rej_bare = pic_rej_expr.split(" AS ")[0]

    # Per-column "Manage Table" filters — see list_im_rollout_plans (in
    # command_center.py) for the rationale (each column matched independently
    # and ANDed, not blended into the wide `search` clause below; same
    # expressions widen that search too, so both paths cover the same fields).
    col_filter_map = {
        "subcontract": _subcon_expr_pic,
        "contract_model": _contract_model_expr_pic,
        "poid": "COALESCE(NULLIF(pd.poid,''), pd.name)",
        "po_no": "IFNULL(pd.po_no,'')",
        "po_status": "IFNULL(pd.dispatch_status,'')",
        "project_domain": "IFNULL(pd.project_domain,'')",
        "project": "IFNULL(pd.project_code,'')",
        "item": "IFNULL(pd.item_code,'')",
        "description": "IFNULL(pd.item_description,'')",
        "duid": "IFNULL(pd.site_code,'')",
        "qty": "CAST(pd.qty AS CHAR)",
        "unit_price": "CAST(pd.rate AS CHAR)",
        "line_amount": "CAST(pd.line_amount AS CHAR)",
        "tax_rate": "IFNULL(pd.tax_rate,'')",
        "payment_terms": "IFNULL(pd.payment_terms,'')",
        "im_status": "IFNULL(wd_sub.im_submission_status,'')",
        "pic_status_ms1": f"({_PIC_INITIAL_RULE_SQL.strip()})",
        "pic_rejection_reason": _pic_rej_bare,
        "isdp_owner": "IFNULL(pd.isdp_owner,'')",
        "ibuy_owner": "IFNULL(pd.ibuy_owner,'')",
        "applied_date_ms1": "CAST(pd.ms1_applied_date AS CHAR)",
        "ms1": "CAST(pd.ms1_pct AS CHAR)",
        "ms1_amt": "CAST(pd.ms1_amount AS CHAR)",
        "ms1_invoiced": "CAST(pd.ms1_invoiced AS CHAR)",
        "ms1_unbilled": "CAST(pd.ms1_unbilled AS CHAR)",
        "pic_status_ms2": "IFNULL(pd.pic_status_ms2,'')",
        "applied_date_ms2": "CAST(pd.ms2_applied_date AS CHAR)",
        "ms2": "CAST(pd.ms2_pct AS CHAR)",
        "ms2_amt": "CAST(pd.ms2_amount AS CHAR)",
        "ms2_invoiced": "CAST(pd.ms2_invoiced AS CHAR)",
    }
    # Not backend-filterable: "Edit" is an action column.
    column_filters_pic = pf.get("column_filters")
    if isinstance(column_filters_pic, str):
        try:
            column_filters_pic = frappe.parse_json(column_filters_pic)
        except Exception:
            column_filters_pic = None
    if isinstance(column_filters_pic, dict):
        for col_key, raw_val in column_filters_pic.items():
            pat = _sql_like_pattern(raw_val)
            if not pat:
                continue
            expr = col_filter_map.get(col_key)
            if not expr:
                continue
            where.append(f"{expr} LIKE %s")
            params.append(pat)

    search = pf.get("search") or pf.get("q") or ""
    if search:
        concat_parts_pic = [
            "IFNULL(pd.poid,''), IFNULL(pd.po_no,''), IFNULL(pd.item_code,''),",
            "IFNULL(pd.item_description,''),",
            "IFNULL(pd.project_code,''), IFNULL(proj.project_name,''),",
            "IFNULL(pd.project_domain,''),",
            "IFNULL(pd.site_code,''), IFNULL(pd.site_name,''),",
            "IFNULL(pd.center_area,''), IFNULL(imm.full_name,''),",
            "IFNULL(pd.isdp_owner,''), IFNULL(pd.ibuy_owner,''),",
            "IFNULL(pd.payment_terms,''),",
            f"IFNULL({_subcon_expr_pic},''), IFNULL({_contract_model_expr_pic},''),",
            f"IFNULL({_pic_rej_bare},'')",
        ]
        clause, like_params = _sql_search_clause(
            "CONCAT_WS(' '," + " ".join(concat_parts_pic) + ")",
            search,
            exact_cols=["IFNULL(pd.poid,'')", "IFNULL(pd.site_code,'')"],
        )
        if clause:
            where.append(clause)
            params.extend(like_params)

    if with_team_type:
        team_cols = (
            "plan.team_type AS team_type, "
            "COALESCE(sm_pd.subcontractor_name, sm.subcontractor_name) AS subcontractor, "
            "COALESCE(sm_pd.sub_payout_pct, sm.sub_payout_pct) AS subcontractor_payout_pct, "
            "COALESCE(sm_pd.inet_margin_pct, sm.inet_margin_pct) AS subcontractor_margin_pct, "
            "COALESCE(sm_pd.contract_model, sm.contract_model) AS contract_model"
        )
        from_clause = _PIC_FROM_JOIN
    else:
        team_cols = (
            "NULL AS team_type, "
            "COALESCE(sm_pd.subcontractor_name, sm_sub.subcontractor_name) AS subcontractor, "
            "NULL AS subcontractor_payout_pct, "
            "NULL AS subcontractor_margin_pct, "
            "COALESCE(sm_pd.contract_model, sm_sub.contract_model) AS contract_model"
        )
        from_clause = _PIC_FROM_JOIN_LEAN

    if subcon_vals:
        ph = ", ".join(["%s"] * len(subcon_vals))
        sc_col = "COALESCE(sm_pd.name, sm.name)" if with_team_type else "COALESCE(sm_pd.name, sm_sub.name)"
        where.append(f"IFNULL({sc_col},'') IN ({ph})")
        params.extend(subcon_vals)

    vat_frac = _TAX_RATE_FRACTION_SQL.format(col="pd.tax_rate")
    sql = f"""
    SELECT  /* {limit_page_length} = 0 → unlimited; with_team_type={int(with_team_type)} */
      pd.name AS po_dispatch,
      pd.poid,
      pd.po_no,
      pd.po_line_no,
      pd.customer,
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
      {sqc_expr}, {pat_expr}, {im_rej_expr}, {pic_rej_expr},
      ({_PIC_INITIAL_RULE_SQL.strip()}) AS pic_status_effective,
      pd.pic_status AS pic_status_stored,
      pd.pic_status_ms2,
      pd.isdp_owner, pd.ibuy_owner,
      pd.pic_detail_remark, pd.pic_detail_remark_ms2,
      pd.im_confirmation_note,
      pd.ms1_pct, pd.ms2_pct,
      pd.ms1_amount, pd.ms2_amount,
      pd.ms1_invoiced, pd.ms2_invoiced,
      pd.ms1_unbilled, pd.ms2_unbilled,
      ROUND(IFNULL(pd.ms1_invoiced, 0) * ({vat_frac}), 2) AS ms1_vat,
      ROUND(IFNULL(pd.ms2_invoiced, 0) * ({vat_frac}), 2) AS ms2_vat,
      pd.ms1_applied_date, pd.ms2_applied_date,
      pd.ms1_invoice_month, pd.ms2_invoice_month,
      pd.ms1_ibuy_inv_date, pd.ms2_ibuy_inv_date,
      pd.ms1_payment_received_date, pd.ms2_payment_received_date,
      pd.remaining_milestone_pct,
      {team_cols},
      pd.modified,
      wd_sub.im_submission_status
    {from_clause}
    WHERE {' AND '.join(where)}
    ORDER BY pd.modified DESC
    {_sql_limit_suffix(limit_page_length)}
    """
    # Total matching count + MS1/MS2 sums, independent of the row-limit cap
    # above — the FE "Total Lines" indicator and KPI strip must reflect
    # every row matching the filters, not just however many were fetched
    # into the table (a rowLimit=20 view must not show a 20-row sum as if
    # it were the whole filtered set).
    agg = (frappe.db.sql(
        f"""
        SELECT COUNT(*) AS total,
               COALESCE(SUM(pd.ms1_amount), 0) AS ms1_amount_total,
               COALESCE(SUM(pd.ms1_invoiced), 0) AS ms1_invoiced_total,
               COALESCE(SUM(ROUND(IFNULL(pd.ms1_invoiced, 0) * ({vat_frac}), 2)), 0) AS ms1_vat_total,
               COALESCE(SUM(pd.ms2_amount), 0) AS ms2_amount_total,
               COALESCE(SUM(pd.ms2_invoiced), 0) AS ms2_invoiced_total,
               COALESCE(SUM(ROUND(IFNULL(pd.ms2_invoiced, 0) * ({vat_frac}), 2)), 0) AS ms2_vat_total
        {from_clause}
        WHERE {' AND '.join(where)}
        """,
        tuple(params),
        as_dict=True,
    ) or [{}])[0]
    total_count = cint(agg.get("total") or 0)

    rows = frappe.db.sql(sql, tuple(params), as_dict=True)
    if rows:
        act_map = _batch_item_activity_types(rows)
        inv_map = _batch_linked_invoices([r["po_dispatch"] for r in rows])
        for r in rows:
            r["activity_type"] = act_map.get(r.get("item_code") or "")
            r["linked_invoices_csv"] = inv_map.get(r["po_dispatch"])
    return {
        "rows": rows,
        "total_count": total_count,
        "totals": {
            "ms1_amount": flt(agg.get("ms1_amount_total") or 0),
            "ms1_invoiced": flt(agg.get("ms1_invoiced_total") or 0),
            "ms1_vat": flt(agg.get("ms1_vat_total") or 0),
            "ms2_amount": flt(agg.get("ms2_amount_total") or 0),
            "ms2_invoiced": flt(agg.get("ms2_invoiced_total") or 0),
            "ms2_vat": flt(agg.get("ms2_vat_total") or 0),
        },
    }


def _batch_linked_invoices(po_dispatch_names):
    """Return {po_dispatch: "SI-0001|Submitted, SI-0002|Draft"} for every name
    in ``po_dispatch_names`` that has at least one linked Sales Invoice Item.

    A separate batched query (not a JOIN folded into the caller's main
    SELECT) so it can't multiply rows in callers — like ``list_pic_rows`` —
    that already carry other one-to-many joins.
    """
    names = list({n for n in (po_dispatch_names or []) if n})
    if not names or not frappe.db.has_column("Sales Invoice Item", "poid"):
        return {}
    ph = ", ".join(["%s"] * len(names))
    rows = frappe.db.sql(
        f"""
        SELECT sii.poid AS po_dispatch,
               GROUP_CONCAT(DISTINCT CONCAT(si.name, '|',
                 CASE WHEN si.docstatus = 1 THEN 'Submitted'
                      WHEN si.docstatus = 0 THEN 'Draft' ELSE '?' END)
                 ORDER BY si.name SEPARATOR ', ') AS linked_invoices_csv
        FROM `tabSales Invoice Item` sii
        JOIN `tabSales Invoice` si ON si.name = sii.parent AND si.docstatus < 2
        WHERE sii.poid IN ({ph})
        GROUP BY sii.poid
        """,
        tuple(names),
        as_dict=True,
    )
    return {r["po_dispatch"]: r["linked_invoices_csv"] for r in rows}


def _batch_draft_invoices_by_milestone(poids):
    """Return {(poid, "MS1"|"MS2"): sales_invoice_name} for every DRAFT
    (docstatus=0) Sales Invoice Item among ``poids`` — used by
    create_sales_invoice_from_pic to block spinning up a duplicate draft for
    a POID/milestone that already has one sitting unsubmitted.

    A legacy line with no ``milestone`` tag can't be attributed to one
    milestone or the other, so it conservatively blocks BOTH — safer than
    guessing and letting a real duplicate through.
    """
    names = list({n for n in (poids or []) if n})
    if not names or not frappe.db.has_column("Sales Invoice Item", "poid"):
        return {}
    ph = ", ".join(["%s"] * len(names))
    rows = frappe.db.sql(
        f"""
        SELECT sii.poid AS poid, UPPER(IFNULL(sii.milestone,'')) AS milestone, si.name AS si_name
        FROM `tabSales Invoice Item` sii
        JOIN `tabSales Invoice` si ON si.name = sii.parent
        WHERE si.docstatus = 0 AND sii.poid IN ({ph})
        """,
        tuple(names),
        as_dict=True,
    )
    out = {}
    for r in rows:
        ms = r["milestone"]
        if ms in ("MS1", "MS2"):
            out.setdefault((r["poid"], ms), r["si_name"])
        else:
            out.setdefault((r["poid"], "MS1"), r["si_name"])
            out.setdefault((r["poid"], "MS2"), r["si_name"])
    return out


# PO Dispatch.tax_rate is a free-text field — almost always "15%", sometimes
# a raw fraction like "0.15", occasionally blank. Normalize to a fraction for
# VAT math; default to the standard 15% KSA rate when nothing is recorded.
_TAX_RATE_FRACTION_SQL = """
    CASE
      WHEN {col} IS NULL OR {col} = '' THEN 0.15
      WHEN LOCATE('%%', {col}) > 0 THEN CAST(REPLACE({col}, '%%', '') AS DECIMAL(10,4)) / 100
      ELSE CAST({col} AS DECIMAL(10,4))
    END
"""


def _vat_on_sql(amount_expr, tax_col="pd.tax_rate"):
    """VAT on ``amount_expr`` using the PO line's ``tax_rate`` field."""
    frac = _TAX_RATE_FRACTION_SQL.format(col=tax_col)
    return f"IFNULL({amount_expr}, 0) * ({frac})"


@frappe.whitelist()
def pic_invoicing_summary(portal_filters=None):
    """Aggregate invoicing summary grouped by PIC status — INET vs Subcon split.

    Returns::
        {
          top: {inet_ms1, subcon_ms1, total_ms1, inet_ms2, subcon_ms2, total_ms2,
                inet_total, subcon_total, grand_total},
          ms1_rows: [{pic_status, row_count, po_amount, invoiced, unbilled,
                      subcon_amt, inet_amt}],
          ms2_rows: same shape,
        }

    Accepted portal_filters keys:
        project_code, site_code, im,
        from_date / to_date  (ms1_applied_date range),
        contract_model       (sm_sub.contract_model),
        ms1_invoice_month    (YYYY-MM, filters MS1 rows only),
        ms2_invoice_month    (YYYY-MM, filters MS2 rows only),
        dispatch_status      (default: hide Cancelled / Closed).
    """
    _pic_role_or_throw()
    pf = _portal_filters_dict(portal_filters)

    # ── Common WHERE (applies to both MS1 and MS2 queries) ──────────────
    where_common = ["1=1", "IFNULL(pd.is_internal_work, 0) = 0", "IFNULL(pd.is_dummy_po, 0) = 0"]
    params_common = []

    for col, key in (
        ("pd.project_code", "project_code"),
        ("pd.site_code",    "site_code"),
        ("pd.im",           "im"),
    ):
        c, p = _sql_in_or_eq(col, pf.get(key))
        if c:
            where_common.append(c)
            params_common.extend(p)

    if pf.get("from_date"):
        where_common.append("pd.ms1_applied_date >= %s")
        params_common.append(pf["from_date"])
    if pf.get("to_date"):
        where_common.append("pd.ms1_applied_date <= %s")
        params_common.append(pf["to_date"])

    if pf.get("contract_model"):
        cm_vals = _ensure_list(pf["contract_model"])
        ph = ", ".join(["%s"] * len(cm_vals))
        where_common.append(f"COALESCE(sm_sub.contract_model, 'Fix & Core') IN ({ph})")
        params_common.extend(cm_vals)

    if pf.get("subcontract"):
        sc_vals = _ensure_list(pf["subcontract"])
        ph = ", ".join(["%s"] * len(sc_vals))
        where_common.append(f"COALESCE(sm_pd.name, sm_sub.name) IN ({ph})")
        params_common.extend(sc_vals)

    if pf.get("dispatch_status"):
        ds_vals = _ensure_list(pf["dispatch_status"])
        ph = ", ".join(["%s"] * len(ds_vals))
        where_common.append(f"IFNULL(pd.dispatch_status,'') IN ({ph})")
        params_common.extend(ds_vals)
    else:
        # "PO Line Canceled" rows are exempted — the summary must keep
        # reporting that bucket even though it auto-carries dispatch_status='Cancelled'.
        where_common.append(f"(IFNULL(pd.dispatch_status,'') != 'Cancelled' OR {_PIC_LINE_CANCELED_SQL})")

    # ── MS1: additional invoice-month filter ─────────────────────────────
    where_ms1 = list(where_common)
    params_ms1 = list(params_common)
    ms1_month_vals = _ensure_list(pf.get("ms1_invoice_month"))
    if ms1_month_vals:
        ph = ", ".join(["%s"] * len(ms1_month_vals))
        where_ms1.append(f"DATE_FORMAT(pd.ms1_invoice_month, '%%Y-%%m') IN ({ph})")
        params_ms1.extend(ms1_month_vals)

    # ── MS2: additional invoice-month filter + only rows with an MS2 ─────
    where_ms2 = list(where_common)
    params_ms2 = list(params_common)
    ms2_month_vals = _ensure_list(pf.get("ms2_invoice_month"))
    if ms2_month_vals:
        ph = ", ".join(["%s"] * len(ms2_month_vals))
        where_ms2.append(f"DATE_FORMAT(pd.ms2_invoice_month, '%%Y-%%m') IN ({ph})")
        params_ms2.extend(ms2_month_vals)
    where_ms2.append("IFNULL(pd.ms2_amount, 0) > 0")

    vat_on_invoiced = _vat_on_sql("pd.ms1_invoiced")
    vat_on_ms2_invoiced = _vat_on_sql("pd.ms2_invoiced")

    # ── MS1 breakdown query ───────────────────────────────────────────────
    ms1_sql = f"""
    SELECT
      ({_PIC_INITIAL_RULE_SQL.strip()}) AS pic_status,
      COUNT(*) AS row_count,
      SUM(IFNULL(pd.ms1_amount,  0)) AS po_amount,
      SUM(IFNULL(pd.ms1_invoiced,0)) AS invoiced,
      SUM({vat_on_invoiced}) AS vat,
      SUM(IFNULL(pd.ms1_unbilled,0)) AS unbilled,
      SUM(IFNULL(pd.ms1_amount,  0) * IFNULL(COALESCE(sm_pd.sub_payout_pct,   sm_sub.sub_payout_pct),   0)   / 100) AS subcon_amt,
      SUM(IFNULL(pd.ms1_amount,  0) * COALESCE(sm_pd.inet_margin_pct, sm_sub.inet_margin_pct, 100) / 100) AS inet_amt,
      SUM(IFNULL(pd.ms1_amount,  0) * IFNULL(COALESCE(sm_pd.sub_payout_pct,   sm_sub.sub_payout_pct),   0)   / 100 * ({_TAX_RATE_FRACTION_SQL.format(col="pd.tax_rate")})) AS subcon_vat,
      SUM(IFNULL(pd.ms1_amount,  0) * COALESCE(sm_pd.inet_margin_pct, sm_sub.inet_margin_pct, 100) / 100 * ({_TAX_RATE_FRACTION_SQL.format(col="pd.tax_rate")})) AS inet_vat
    {_PIC_FROM_JOIN_LEAN}
    WHERE {' AND '.join(where_ms1)}
    GROUP BY ({_PIC_INITIAL_RULE_SQL.strip()})
    ORDER BY po_amount DESC
    """

    # ── MS2 breakdown query ───────────────────────────────────────────────
    ms2_sql = f"""
    SELECT
      COALESCE(NULLIF(pd.pic_status_ms2, ''), 'Work Not Done') AS pic_status,
      COUNT(*) AS row_count,
      SUM(IFNULL(pd.ms2_amount,  0)) AS po_amount,
      SUM(IFNULL(pd.ms2_invoiced,0)) AS invoiced,
      SUM({vat_on_ms2_invoiced}) AS vat,
      SUM(IFNULL(pd.ms2_unbilled,0)) AS unbilled,
      SUM(IFNULL(pd.ms2_amount,  0) * IFNULL(COALESCE(sm_pd.sub_payout_pct,   sm_sub.sub_payout_pct),   0)   / 100) AS subcon_amt,
      SUM(IFNULL(pd.ms2_amount,  0) * COALESCE(sm_pd.inet_margin_pct, sm_sub.inet_margin_pct, 100) / 100) AS inet_amt,
      SUM(IFNULL(pd.ms2_amount,  0) * IFNULL(COALESCE(sm_pd.sub_payout_pct,   sm_sub.sub_payout_pct),   0)   / 100 * ({_TAX_RATE_FRACTION_SQL.format(col="pd.tax_rate")})) AS subcon_vat,
      SUM(IFNULL(pd.ms2_amount,  0) * COALESCE(sm_pd.inet_margin_pct, sm_sub.inet_margin_pct, 100) / 100 * ({_TAX_RATE_FRACTION_SQL.format(col="pd.tax_rate")})) AS inet_vat
    {_PIC_FROM_JOIN_LEAN}
    WHERE {' AND '.join(where_ms2)}
    GROUP BY COALESCE(NULLIF(pd.pic_status_ms2, ''), 'Work Not Done')
    ORDER BY po_amount DESC
    """

    ms1_rows = frappe.db.sql(ms1_sql, tuple(params_ms1), as_dict=True)
    ms2_rows = frappe.db.sql(ms2_sql, tuple(params_ms2), as_dict=True)

    # Split only meaningful for invoiced statuses; zero out everything else.
    _INVOICED = {"Commercial Invoice Closed", "Commercial Invoice Submitted"}
    for r in ms1_rows:
        if r.get("pic_status") not in _INVOICED:
            r["subcon_amt"] = 0.0; r["inet_amt"] = 0.0
            r["subcon_vat"] = 0.0; r["inet_vat"] = 0.0
            r["vat"] = 0.0
    for r in ms2_rows:
        if r.get("pic_status") not in _INVOICED:
            r["subcon_amt"] = 0.0; r["inet_amt"] = 0.0
            r["subcon_vat"] = 0.0; r["inet_vat"] = 0.0
            r["vat"] = 0.0

    # ── Top summary (derived from row aggregates) ─────────────────────────
    inet_ms1   = sum(flt(r.get("inet_amt"))   for r in ms1_rows)
    subcon_ms1 = sum(flt(r.get("subcon_amt")) for r in ms1_rows)
    inet_ms2   = sum(flt(r.get("inet_amt"))   for r in ms2_rows)
    subcon_ms2 = sum(flt(r.get("subcon_amt")) for r in ms2_rows)
    inet_ms1_vat   = sum(flt(r.get("inet_vat"))   for r in ms1_rows)
    subcon_ms1_vat = sum(flt(r.get("subcon_vat")) for r in ms1_rows)
    inet_ms2_vat   = sum(flt(r.get("inet_vat"))   for r in ms2_rows)
    subcon_ms2_vat = sum(flt(r.get("subcon_vat")) for r in ms2_rows)
    total_ms1_vat = inet_ms1_vat + subcon_ms1_vat
    total_ms2_vat = inet_ms2_vat + subcon_ms2_vat

    return {
        "top": {
            "inet_ms1":    round(inet_ms1,   2),
            "subcon_ms1":  round(subcon_ms1, 2),
            "total_ms1":   round(inet_ms1 + subcon_ms1, 2),
            "inet_ms2":    round(inet_ms2,   2),
            "subcon_ms2":  round(subcon_ms2, 2),
            "total_ms2":   round(inet_ms2 + subcon_ms2, 2),
            "inet_total":  round(inet_ms1 + inet_ms2, 2),
            "subcon_total": round(subcon_ms1 + subcon_ms2, 2),
            "grand_total": round(inet_ms1 + subcon_ms1 + inet_ms2 + subcon_ms2, 2),
            "inet_ms1_vat": round(inet_ms1_vat, 2),
            "subcon_ms1_vat": round(subcon_ms1_vat, 2),
            "total_ms1_vat": round(total_ms1_vat, 2),
            "inet_ms2_vat": round(inet_ms2_vat, 2),
            "subcon_ms2_vat": round(subcon_ms2_vat, 2),
            "total_ms2_vat": round(total_ms2_vat, 2),
            "inet_total_vat": round(inet_ms1_vat + inet_ms2_vat, 2),
            "subcon_total_vat": round(subcon_ms1_vat + subcon_ms2_vat, 2),
            "grand_total_vat": round(total_ms1_vat + total_ms2_vat, 2),
            "inet_ms1_total": round(inet_ms1 + inet_ms1_vat, 2),
            "subcon_ms1_total": round(subcon_ms1 + subcon_ms1_vat, 2),
            "total_ms1_total": round(inet_ms1 + subcon_ms1 + total_ms1_vat, 2),
            "inet_ms2_total": round(inet_ms2 + inet_ms2_vat, 2),
            "subcon_ms2_total": round(subcon_ms2 + subcon_ms2_vat, 2),
            "total_ms2_total": round(inet_ms2 + subcon_ms2 + total_ms2_vat, 2),
            "inet_grand_total": round(inet_ms1 + inet_ms2 + inet_ms1_vat + inet_ms2_vat, 2),
            "subcon_grand_total": round(subcon_ms1 + subcon_ms2 + subcon_ms1_vat + subcon_ms2_vat, 2),
            "grand_total_incl_vat": round(
                inet_ms1 + subcon_ms1 + inet_ms2 + subcon_ms2 + total_ms1_vat + total_ms2_vat, 2
            ),
        },
        "ms1_rows": [dict(r) for r in ms1_rows],
        "ms2_rows": [dict(r) for r in ms2_rows],
    }


# PO Dispatch.tax_rate — see _TAX_RATE_FRACTION_SQL above.


def _payment_ledger_leg_sql(milestone):
    """One UNION leg (MS1 or MS2) of the payment-ledger queries below.

    Sectioned by ``ms{n}_invoice_month`` (the same field the rest of this
    module calls "Invoicing Month" — matches the PIC Tracker column of the
    same name). ``ms{n}_payment_received_date`` is a separate field, shown
    only as the "Payment Received Date" display column — it's independent
    of which month a line is filed under and is often blank until the
    customer actually pays.
    """
    amt_col = f"pd.ms{milestone}_invoiced"
    invoice_month_col = f"pd.ms{milestone}_invoice_month"
    applied_col = f"pd.ms{milestone}_applied_date"
    received_col = f"pd.ms{milestone}_payment_received_date"
    vat_expr = _TAX_RATE_FRACTION_SQL.format(col="pd.tax_rate")
    where = f"""
        IFNULL(pd.is_internal_work, 0) = 0 AND IFNULL(pd.is_dummy_po, 0) = 0
        AND {amt_col} IS NOT NULL AND {amt_col} != 0
        AND {invoice_month_col} IS NOT NULL
    """
    return amt_col, invoice_month_col, applied_col, received_col, vat_expr, where


@frappe.whitelist()
def pic_payment_ledger_summary(portal_filters=None):
    """Invoicing ledger, aggregated to month grain — sectioned by Invoicing Month.

    Every MS1/MS2 invoice event (any PO Dispatch line with a nonzero
    ms{1,2}_invoiced) is grouped by its ms{1,2}_invoice_month. VAT is
    derived from tax_rate — there's no stored VAT amount on PO Dispatch.

    Feeds the Invoicing Summary "Payment Ledger" tab's collapsible
    year -> month tree. Year totals are summed client-side from these month
    rows; per-day totals for a given month are fetched lazily by
    pic_payment_ledger_month_detail() only when that month is expanded —
    this endpoint alone stays small (one row per calendar month) regardless
    of how many thousand invoice lines exist.
    """
    _pic_role_or_throw()
    _portal_filters_dict(portal_filters)  # reserved for future filters

    legs = []
    for milestone in (1, 2):
        amt_col, invoice_month_col, _applied_col, _received_col, vat_expr, where = _payment_ledger_leg_sql(milestone)
        legs.append(f"""
          SELECT {invoice_month_col} AS invoice_month, {amt_col} AS amt, ({vat_expr}) AS vat_rate
          FROM `tabPO Dispatch` pd
          WHERE {where}
        """)

    rows = frappe.db.sql(
        f"""
        SELECT DATE_FORMAT(invoice_month, '%%Y-%%m') AS ym,
               COALESCE(SUM(amt), 0) AS invoiced_amount,
               COALESCE(SUM(amt * vat_rate), 0) AS vat_amount
        FROM ({' UNION ALL '.join(legs)}) u
        GROUP BY ym
        ORDER BY ym ASC
        """,
        (),
        as_dict=True,
    )
    out = []
    for r in rows:
        invoiced = flt(r.get("invoiced_amount"))
        vat = flt(r.get("vat_amount"))
        out.append({
            "year_month": r["ym"],
            "invoiced_amount": round(invoiced, 2),
            "vat_amount": round(vat, 2),
            "total_amount": round(invoiced + vat, 2),
        })
    return out


@frappe.whitelist()
def pic_payment_ledger_month_detail(year_month):
    """Per-day totals for one YYYY-MM Invoicing Month.

    Every MS1/MS2 invoice event in that month is bucketed by the day of its
    ms{n}_applied_date (falling back to the invoice month itself when no
    applied date was recorded) and summed — multiple invoice lines applied
    on the same day collapse into one row, they are never listed
    individually. "Payment Received Date" is carried along per bucket only
    when every line in it agrees on the same date; it's a display field,
    not the grouping key, so a mixed bucket just shows blank rather than a
    misleading single date.

    Lazy-loaded by the frontend only when the PIC expands that month's row
    in the Payment Ledger tree — keeps the always-on summary endpoint above
    cheap while still allowing drill-down to per-day totals.
    """
    _pic_role_or_throw()
    year_month = str(year_month or "").strip()
    if len(year_month) != 7 or year_month[4] != "-" or not (year_month[:4] + year_month[5:]).isdigit():
        frappe.throw("year_month must be YYYY-MM")

    legs = []
    params = []
    for milestone in (1, 2):
        amt_col, invoice_month_col, applied_col, received_col, vat_expr, where = _payment_ledger_leg_sql(milestone)
        legs.append(f"""
          SELECT COALESCE({applied_col}, {invoice_month_col}) AS bucket_date,
                 {received_col} AS received_date, {amt_col} AS amt, ({vat_expr}) AS vat_rate
          FROM `tabPO Dispatch` pd
          WHERE {where} AND DATE_FORMAT({invoice_month_col}, '%%Y-%%m') = %s
        """)
        params.append(year_month)

    rows = frappe.db.sql(
        f"""
        SELECT bucket_date,
               MIN(received_date) AS min_received, MAX(received_date) AS max_received,
               COALESCE(SUM(amt), 0) AS invoiced_amount,
               COALESCE(SUM(amt * vat_rate), 0) AS vat_amount
        FROM ({' UNION ALL '.join(legs)}) u
        GROUP BY bucket_date
        ORDER BY bucket_date ASC
        """,
        tuple(params),
        as_dict=True,
    )
    out = []
    for r in rows:
        invoiced = flt(r.get("invoiced_amount"))
        vat = flt(r.get("vat_amount"))
        min_recv, max_recv = r.get("min_received"), r.get("max_received")
        out.append({
            "applied_date": str(r["bucket_date"]) if r.get("bucket_date") else None,
            "payment_received_date": str(min_recv) if min_recv and min_recv == max_recv else None,
            "invoiced_amount": round(invoiced, 2),
            "vat_amount": round(vat, 2),
            "total_amount": round(invoiced + vat, 2),
        })
    return out


@frappe.whitelist()
def get_pic_summary_filter_options():
    """Distinct contract models, invoice months, and subcontracts for the invoicing summary filters."""
    _pic_role_or_throw()
    contract_models = frappe.db.sql(
        """
        SELECT DISTINCT sm.contract_model
        FROM `tabSubcontract Master` sm
        WHERE IFNULL(sm.contract_model, '') != ''
        ORDER BY sm.contract_model
        """,
        as_dict=True,
    )
    months = frappe.db.sql(
        """
        SELECT DISTINCT m FROM (
          SELECT DATE_FORMAT(ms1_invoice_month, '%%Y-%%m') AS m
          FROM `tabPO Dispatch` WHERE ms1_invoice_month IS NOT NULL
          UNION
          SELECT DATE_FORMAT(ms2_invoice_month, '%%Y-%%m') AS m
          FROM `tabPO Dispatch` WHERE ms2_invoice_month IS NOT NULL
        ) t
        WHERE m IS NOT NULL
        ORDER BY m
        """,
        (),
        as_dict=True,
    )
    subcontracts = frappe.db.sql(
        """
        SELECT name, IFNULL(subcontractor_name, name) AS label
        FROM `tabSubcontract Master`
        ORDER BY subcontractor_name, name
        """,
        as_dict=True,
    )
    models = [r.contract_model for r in contract_models]
    if "Fix & Core" not in models:
        models.insert(0, "Fix & Core")
    return {
        "contract_models": models,
        "invoice_months":  [r.m for r in months],
        "subcontracts":    [{"id": r.name, "label": r.label} for r in subcontracts],
    }


# A milestone counts as "resolved enough" to close the whole dispatch once
# it's either actually closed or the invoice has been submitted — matching
# the same definition the Data Integrity report uses (see
# _DATA_INTEGRITY_TERMINAL_MS in command_center.py) so a dispatch that's
# fine by that report's standard is also reachable by these normal write
# paths, not just historically stamped that way by import/legacy bugs.
_PIC_MS_RESOLVED_FOR_CLOSE = {"Commercial Invoice Closed", "Commercial Invoice Submitted"}

_PIC_REJECTED_STATUSES = {"I-BUY Rejected", "ISDP Rejected"}

# dispatch_status values this module auto-manages once a line reaches
# Completed and enters the PIC/invoicing flow — see
# _compute_dispatch_status_from_pic. Anything outside this set (Pending,
# Dispatched, Planned, Backend Assigned, Completed itself, Cancelled) is
# either an earlier stage this module doesn't touch, or Cancelled which is
# handled as its own priority branch.
_PIC_AUTO_MANAGED_DISPATCH_STATUSES = {
    "Partially Submitted", "Submitted", "Partially Closed", "Closed",
}


def _compute_dispatch_status_from_pic(ms1_status, ms2_status, ms2_amount, current_dispatch_status):
    """Auto-derive dispatch_status from MS1/MS2 pic_status, for a line that's
    already Completed and progressing through PIC's invoicing pipeline.

    Priority (first match wins) — deliberately stricter than
    _PIC_MS_RESOLVED_FOR_CLOSE (that set is for a different purpose: whether
    a milestone counts as "locked"/terminal elsewhere, e.g. the Data
    Integrity report). Here, "Submitted" is never good enough to call
    anything "Closed" — only a literal "Commercial Invoice Closed" is:

      1. Either milestone "PO Line Canceled"           -> Cancelled
      2. MS1 Closed AND (MS2 Closed OR MS2 doesn't exist) -> Closed
      3. Exactly one of MS1/MS2 Closed, the other in ANY
         other stage (including Submitted), MS2 exists  -> Partially Closed
      4. Both Submitted, OR MS1 Submitted with no MS2    -> Submitted
      5. Exactly one of MS1/MS2 Submitted (not caught by
         #2/#3 above)                                    -> Partially Submitted
      6. None of the above: if currently sitting in one of THIS function's
         own auto-managed statuses (PIC reopened something that used to
         qualify), fall back to Completed rather than leaving it stale.
         Otherwise leave dispatch_status untouched (returns None).

    Returns the new dispatch_status string, or None if no change is needed.
    """
    ms1 = (ms1_status or "").strip()
    ms2 = (ms2_status or "").strip()
    ms2_exists = flt(ms2_amount or 0) > 0

    if ms1 == "PO Line Canceled" or ms2 == "PO Line Canceled":
        return "Cancelled"

    ms1_closed = ms1 == "Commercial Invoice Closed"
    ms2_closed = ms2 == "Commercial Invoice Closed"
    ms1_submitted = ms1 == "Commercial Invoice Submitted"
    ms2_submitted = ms2 == "Commercial Invoice Submitted"

    if ms1_closed and (ms2_closed or not ms2_exists):
        return "Closed"
    if (ms1_closed or ms2_closed) and ms2_exists:
        return "Partially Closed"
    if (ms1_submitted and ms2_submitted) or (ms1_submitted and not ms2_exists):
        return "Submitted"
    if ms1_submitted or ms2_submitted:
        return "Partially Submitted"

    if (current_dispatch_status or "").strip() in _PIC_AUTO_MANAGED_DISPATCH_STATUSES:
        return "Completed"
    return None


def _reflect_pic_rejection(po_dispatch_name, closed_flag):
    """Mirror a milestone landing on I-BUY Rejected / ISDP Rejected onto the
    IM's own portal: marks/creates a Work Done record 'PIC Rejected' (same
    as reject_pic_line does) so it shows up on IM Work Done's PIC Rejected
    tab, then notifies the IM. Factored out so update_pic_row and
    bulk_update_pic_status get the same reflection reject_pic_line always
    had — without this, setting one of these two statuses via the generic
    "Bulk Set Status" path (instead of the dedicated Reject action) silently
    skipped both the IM notification and the Work Done record entirely.
    """
    wd_docs = frappe.get_all(
        "Work Done",
        filters={"system_id": po_dispatch_name, "submission_status": "Confirmation Done"},
        fields=["name"],
    )
    if wd_docs:
        for wd in wd_docs:
            frappe.db.set_value("Work Done", wd.name, "submission_status", "PIC Rejected", update_modified=True)
    else:
        new_wd = frappe.new_doc("Work Done")
        new_wd.system_id = po_dispatch_name
        new_wd.submission_status = "PIC Rejected"
        new_wd.source = "Direct Close"  # closest existing option; no real execution chain behind this
        new_wd.set(closed_flag, 1)
        new_wd.insert(ignore_permissions=True)
    frappe.db.commit()
    try:
        from inet_app.api.notifications import notify_im_pic_rejected
        notify_im_pic_rejected(po_dispatch_name)
    except Exception:
        pass

# Fields the PIC is allowed to write via update_pic_row. Anything outside this
# allowlist is silently ignored to keep the IM/admin-owned columns safe.
_PIC_WRITABLE = (
    # MS1
    "pic_status", "isdp_owner", "ibuy_owner", "pic_detail_remark", "ms1_applied_date",
    "ms1_invoice_month", "ms1_ibuy_inv_date", "ms1_payment_received_date",
    # MS2
    "pic_status_ms2", "pic_detail_remark_ms2", "ms2_applied_date",
    "ms2_invoice_month", "ms2_ibuy_inv_date", "ms2_payment_received_date",
    # Common
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
    if cint(frappe.db.get_value("PO Dispatch", po_dispatch, "is_internal_work") or 0):
        frappe.throw("Internal work does not enter the PIC / invoicing flow.")

    doc = frappe.get_doc("PO Dispatch", po_dispatch)
    old_ms1 = (doc.pic_status or "").strip()
    old_ms2 = (doc.pic_status_ms2 or "").strip()
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

    # Sync dispatch_status and Work Done billing_status from PIC status changes
    closed = "Commercial Invoice Closed"
    submitted = "Commercial Invoice Submitted"
    cancelled = "PO Line Canceled"
    new_ms1 = (fields.get("pic_status") or "").strip()
    new_ms2 = (fields.get("pic_status_ms2") or "").strip()
    ms1_touched = "pic_status" in fields
    ms2_touched = "pic_status_ms2" in fields
    # Only recompute when this call actually touches a milestone status —
    # eff_ms1/eff_ms2 fall back to the stored value for whichever one this
    # call didn't touch, so a single-milestone update still sees the OTHER
    # milestone's real state. See _compute_dispatch_status_from_pic for the
    # full Closed/Partially Closed/Submitted/Partially Submitted rules.
    if ms1_touched or ms2_touched:
        eff_ms1 = new_ms1 if ms1_touched else old_ms1
        eff_ms2 = new_ms2 if ms2_touched else old_ms2
        new_dispatch_status = _compute_dispatch_status_from_pic(
            eff_ms1, eff_ms2, doc.ms2_amount, doc.dispatch_status
        )
        if new_dispatch_status:
            doc.dispatch_status = new_dispatch_status

    # Manually flipping a milestone to Submitted/Closed here (as opposed to
    # the normal Sales-Invoice-submit flow, which sets pic_status and
    # ms1_invoiced together) would otherwise leave ms1_invoiced/ms2_invoiced
    # at whatever they were before — commonly 0 — while the status claims
    # the milestone is done. Force the invoiced amount to match on a
    # genuine transition so status and money can't drift apart; ms1_unbilled/
    # ms2_unbilled then self-correct via _compute_ms_amounts() in
    # doc.save() below. ms1_invoiced/ms2_invoiced aren't in _PIC_WRITABLE, so
    # there's no legitimate partial-invoice value in `fields` this could
    # clobber.
    if ms1_touched and new_ms1 in _PIC_MS_RESOLVED_FOR_CLOSE and old_ms1 != new_ms1:
        doc.ms1_invoiced = flt(doc.ms1_amount or 0)
    if ms2_touched and new_ms2 in _PIC_MS_RESOLVED_FOR_CLOSE and old_ms2 != new_ms2:
        doc.ms2_invoiced = flt(doc.ms2_amount or 0)

    billing = None
    if new_ms1 == submitted or new_ms2 == submitted:
        billing = "Invoiced"
    elif new_ms1 == closed or new_ms2 == closed:
        billing = "Closed"
    elif new_ms1 == cancelled or new_ms2 == cancelled:
        billing = "Closed"

    doc.flags.ignore_permissions = True
    doc.save()
    frappe.db.commit()

    # Reflect a NEW transition into I-BUY Rejected / ISDP Rejected onto the
    # IM's own portal — see _reflect_pic_rejection. Gated on old != new so
    # editing some unrelated field on an already-rejected line doesn't
    # re-notify every time.
    if ms1_touched and new_ms1 in _PIC_REJECTED_STATUSES and old_ms1 != new_ms1:
        _reflect_pic_rejection(doc.name, "ms1_closed")
    if ms2_touched and new_ms2 in _PIC_REJECTED_STATUSES and old_ms2 != new_ms2:
        _reflect_pic_rejection(doc.name, "ms2_closed")

    # Derive PO Intake Line's status straight from doc.dispatch_status,
    # already correctly (re)computed above via _compute_dispatch_status_from_pic
    # — this used to run its OWN separate, looser check here (MS1 closed AND
    # (MS2 closed OR *submitted* OR zero)), the exact old rule that made
    # dispatch_status jump straight to Closed on a submitted-not-closed MS2.
    # That meant PO Intake Line could say "Closed" while PO Dispatch
    # correctly said "Partially Closed" — e.g. the PO Dump page's Closed
    # count (which reads po_line_status) silently disagreeing with the
    # actual count of dispatch_status='Closed' lines. po_line_status has no
    # Partially Closed/Submitted/Partially Submitted values of its own, so
    # anything short of the real, literal "Closed" stays unset (None) here.
    if doc.dispatch_status == "Cancelled":
        il_status = "Cancelled"
    elif doc.dispatch_status == "Closed":
        il_status = "Closed"
    else:
        il_status = None
    if doc.po_intake and doc.po_line_no:
        il = frappe.db.exists("PO Intake Line",
            {"parent": doc.po_intake, "po_line_no": doc.po_line_no})
        if il and isinstance(il, str):
            if il_status:
                frappe.db.set_value("PO Intake Line", il, "po_line_status", il_status)
                frappe.db.commit()
            elif ms1_touched or ms2_touched:
                # Neither closed nor cancelled after an explicit status
                # change — if the intake line was previously Closed, reopen
                # it too rather than leaving it stale.
                current_il_status = frappe.db.get_value("PO Intake Line", il, "po_line_status")
                if current_il_status == "Closed":
                    frappe.db.set_value("PO Intake Line", il, "po_line_status", "Completed")
                    frappe.db.commit()

    if billing:
        wd_names = frappe.db.get_all("Work Done", {"system_id": doc.name}, pluck="name")
        for wd_name in wd_names:
            frappe.db.set_value("Work Done", wd_name, "billing_status", billing)
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


def _write_pic_activity_log(action, milestone, field_changed, new_value, updated, old_values, remark=None):
    """Persist one PIC Activity Log row per touched PO Dispatch.

    The whole batch shares a single ``batch_id`` and ``row_count`` so a
    reviewer can group/sort by batch and see "this user flipped 47 rows in
    one click at HH:MM."
    """
    if not updated:
        return
    try:
        batch_id = frappe.generate_hash(length=10)
        performed_at = frappe.utils.now_datetime()
        user = frappe.session.user
        full_name = (
            frappe.db.get_value("User", user, "full_name") if user else None
        ) or user or "Guest"
        row_count = len(updated)
        for entry in updated:
            doc = frappe.get_doc({
                "doctype": "PIC Activity Log",
                "action": action,
                "po_dispatch": entry.get("po_dispatch"),
                "milestone": milestone,
                "field_changed": field_changed,
                "old_value": frappe.utils.cstr(old_values.get(entry.get("po_dispatch"), "") or ""),
                "new_value": frappe.utils.cstr(new_value or ""),
                "user": user,
                "user_full_name": full_name,
                "performed_at": performed_at,
                "batch_id": batch_id,
                "row_count": row_count,
                "remark": (str(remark)[:1000] if remark else None),
            })
            doc.flags.ignore_permissions = True
            doc.insert(ignore_permissions=True)
    except Exception:
        # Audit-trail writes must never block the user's primary action.
        # Surfaced in error log; the bulk update itself already committed.
        frappe.log_error(frappe.get_traceback(), "PIC Activity Log write failed")


@frappe.whitelist()
def bulk_update_pic_status(po_dispatches, pic_status, milestone="MS1", remark=None, applied_date=None):
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
        applied_date_field = "ms2_applied_date"
    else:
        status_field = "pic_status"
        remark_field = "pic_detail_remark"
        applied_date_field = "ms1_applied_date"
    applied_date = str(applied_date).strip() if applied_date else None

    # Snapshot old values up front so the audit log can record before/after.
    names_to_check = [str(n or "").strip() for n in po_dispatches]
    names_to_check = [n for n in names_to_check if n]
    old_values = {}
    if names_to_check:
        for row in frappe.db.sql(
            f"SELECT name, `{status_field}` AS old_status "
            f"FROM `tabPO Dispatch` WHERE name IN ({', '.join(['%s'] * len(names_to_check))})",
            tuple(names_to_check),
            as_dict=True,
        ):
            old_values[row["name"]] = row.get("old_status")

    updated = []
    errors = []
    for name in po_dispatches:
        name = str(name or "").strip()
        if not name:
            continue
        if not frappe.db.exists("PO Dispatch", name):
            errors.append({"po_dispatch": name, "error": "Not found"})
            continue
        if cint(frappe.db.get_value("PO Dispatch", name, "is_internal_work") or 0):
            errors.append({"po_dispatch": name, "error": "Internal work — no PIC flow"})
            continue
        try:
            # Fetch current milestone state up front — dispatch_status must
            # only flip to Closed when BOTH milestones are resolved (this
            # bulk call only ever targets one of them), same rule
            # update_pic_row uses. Naively closing on this one milestone
            # alone was the bug: MS1 → Commercial Invoice Closed used to
            # force dispatch_status=Closed even with MS2 still open.
            pd = frappe.db.get_value("PO Dispatch", name,
                ["pic_status", "pic_status_ms2", "ms1_amount", "ms2_amount",
                 "po_intake", "po_line_no", "dispatch_status"], as_dict=True)
            if not pd:
                errors.append({"po_dispatch": name, "error": "Not found"})
                continue

            old_status = old_values.get(name)
            new_ms1 = pic_status if status_field == "pic_status" else (pd.pic_status or "")
            new_ms2 = pic_status if status_field == "pic_status_ms2" else (pd.pic_status_ms2 or "")

            payload = {status_field: pic_status}
            if remark:
                payload[remark_field] = str(remark)[:8000]
            if applied_date:
                payload[applied_date_field] = applied_date
            # Manually bulk-flipping into Submitted/Closed here — as opposed
            # to the normal Sales-Invoice-submit flow, which sets pic_status
            # and ms1_invoiced together — would otherwise leave the invoiced
            # amount at whatever it was before (commonly 0) while the status
            # claims the milestone is done. Force it to match on a genuine
            # transition; this path writes via raw set_value (bypasses
            # doc.save()/_compute_ms_amounts()), so unbilled is set
            # explicitly here too rather than left to recompute itself.
            if pic_status in _PIC_MS_RESOLVED_FOR_CLOSE and (old_status or "").strip() != pic_status:
                amount_field = "ms1_amount" if status_field == "pic_status" else "ms2_amount"
                invoiced_field = "ms1_invoiced" if status_field == "pic_status" else "ms2_invoiced"
                unbilled_field = "ms1_unbilled" if status_field == "pic_status" else "ms2_unbilled"
                payload[invoiced_field] = flt(pd.get(amount_field) or 0)
                payload[unbilled_field] = 0.0
            # See _compute_dispatch_status_from_pic for the full Closed/
            # Partially Closed/Submitted/Partially Submitted priority rules.
            new_dispatch_status = _compute_dispatch_status_from_pic(
                new_ms1, new_ms2, pd.ms2_amount, pd.dispatch_status
            )
            if new_dispatch_status:
                payload["dispatch_status"] = new_dispatch_status
            frappe.db.set_value("PO Dispatch", name, payload, update_modified=True)

            # Derived straight from the effective dispatch_status above (see
            # update_pic_row's identical fix) instead of a separate, looser
            # "MS1 closed AND (MS2 closed OR *submitted* OR zero)" check —
            # that old check let po_line_status say "Closed" while the real
            # dispatch_status correctly said "Partially Closed", which is
            # exactly why PO Dump's Closed count (reads po_line_status)
            # could disagree with the actual dispatch_status='Closed' count.
            effective_dispatch_status = new_dispatch_status or pd.dispatch_status
            if effective_dispatch_status == "Cancelled":
                il_status = "Cancelled"
            elif effective_dispatch_status == "Closed":
                il_status = "Closed"
            else:
                il_status = None
            if pd.po_intake and pd.po_line_no:
                il = frappe.db.exists("PO Intake Line",
                    {"parent": pd.po_intake, "po_line_no": pd.po_line_no})
                if il and isinstance(il, str):
                    if il_status:
                        frappe.db.set_value("PO Intake Line", il, "po_line_status", il_status)
                    else:
                        # Neither closed nor cancelled after this change — if
                        # the intake line was previously Closed, reopen it.
                        current_il_status = frappe.db.get_value("PO Intake Line", il, "po_line_status")
                        if current_il_status == "Closed":
                            frappe.db.set_value("PO Intake Line", il, "po_line_status", "Completed")

            # Reflect a NEW transition into I-BUY Rejected / ISDP Rejected
            # onto the IM's own portal — see _reflect_pic_rejection. Gated
            # on old != new so re-saving an already-rejected status doesn't
            # re-notify every time.
            if pic_status in _PIC_REJECTED_STATUSES and (old_status or "").strip() != pic_status:
                closed_flag = "ms1_closed" if status_field == "pic_status" else "ms2_closed"
                _reflect_pic_rejection(name, closed_flag)

            updated.append({"po_dispatch": name, status_field: pic_status})
        except Exception as e:
            errors.append({"po_dispatch": name, "error": frappe.utils.cstr(e)[:500]})

    if updated:
        _write_pic_activity_log(
            action="Bulk Status Update",
            milestone=milestone,
            field_changed=status_field,
            new_value=pic_status,
            updated=updated,
            old_values=old_values,
            remark=remark,
        )

    frappe.db.commit()

    if updated:
        n = len(updated)
        _make_notification(
            frappe.session.user,
            f"[INFO] Bulk update complete — {n} dispatch(es) moved to '{pic_status}'",
            "PO Dispatch", None,
        )

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


def _invoice_month_clause(fd, td):
    """WHERE clause + params scoping the ``YYYY-MM`` invoice bucket.

    Both bounds are snapped to whole months — a mid-month ``from``/``to``
    still includes its entire month, so a monthly roll-up never shows a
    partial bar.
    """
    if fd and td:
        return (
            "WHERE m BETWEEN DATE_FORMAT(%s, '%%Y-%%m') AND DATE_FORMAT(%s, '%%Y-%%m')",
            [fd, td],
        )
    if fd:
        return "WHERE m >= DATE_FORMAT(%s, '%%Y-%%m')", [fd]
    if td:
        return "WHERE m <= DATE_FORMAT(%s, '%%Y-%%m')", [td]
    return "", []


def _monthly_invoicing_rows(fd=None, td=None, order="DESC", limit=36):
    """MS1 + MS2 invoiced value grouped by invoicing month.

    Single source of truth for the "Monthly Invoicing Roll-up" figure —
    shared by ``get_pic_dashboard``, ``get_pic_report(kind="monthly")`` and
    the admin PO-vs-invoice trend chart, so all three always reconcile.

    A milestone is invoiced once it reaches "Commercial Invoice Submitted"
    (invoice raised) or "Commercial Invoice Closed" (raised + paid), and its
    value is the FULL ``ms1_amount`` / ``ms2_amount`` — a milestone is never
    partly billed. This deliberately does NOT read ``ms1_invoiced`` /
    ``ms2_invoiced``: those are per-row display fields on the PIC tracker and
    hold bad values left over from earlier testing.

    Milestones that are invoiced but carry no invoicing month cannot be put
    in a bucket and are absent here — ``_undated_invoiced_value()`` in
    command_center reports that residual.
    """
    invoice_clause, invoice_params = _invoice_month_clause(fd, td)
    order_sql = "ASC" if str(order).upper() == "ASC" else "DESC"
    limit_sql = f"LIMIT {cint(limit)}" if limit else ""
    vat_frac = _TAX_RATE_FRACTION_SQL.format(col="pd.tax_rate")
    return frappe.db.sql(
        f"""
        SELECT m AS invoice_month,
               COALESCE(SUM(ms1_inv), 0) AS ms1_invoiced,
               COALESCE(SUM(ms2_inv), 0) AS ms2_invoiced,
               COALESCE(SUM(ms1_inv + ms2_inv), 0) AS total,
               COALESCE(SUM(ms1_vat + ms2_vat), 0) AS vat_amount,
               COALESCE(SUM(ms1_inv + ms2_inv + ms1_vat + ms2_vat), 0) AS total_amount
        FROM (
          SELECT DATE_FORMAT(pd.ms1_invoice_month, '%%Y-%%m') AS m,
                 IFNULL(pd.ms1_amount, 0) AS ms1_inv, 0 AS ms2_inv,
                 IFNULL(pd.ms1_amount, 0) * ({vat_frac}) AS ms1_vat, 0 AS ms2_vat
          FROM `tabPO Dispatch` pd
          WHERE pd.ms1_invoice_month IS NOT NULL
            AND {_MS1_INVOICED_SQL}
            AND {_REPORTING_SCOPE_SQL}
          UNION ALL
          SELECT DATE_FORMAT(pd.ms2_invoice_month, '%%Y-%%m') AS m,
                 0 AS ms1_inv, IFNULL(pd.ms2_amount, 0) AS ms2_inv,
                 0 AS ms1_vat, IFNULL(pd.ms2_amount, 0) * ({vat_frac}) AS ms2_vat
          FROM `tabPO Dispatch` pd
          WHERE pd.ms2_invoice_month IS NOT NULL
            AND {_MS2_INVOICED_SQL}
            AND {_REPORTING_SCOPE_SQL}
        ) u
        {invoice_clause}
        GROUP BY m
        ORDER BY m {order_sql}
        {limit_sql}
        """,
        tuple(invoice_params),
        as_dict=True,
    )


@frappe.whitelist()
def get_pic_dashboard(from_date=None, to_date=None, etag=None):
    """KPIs + bucket counts + monthly invoicing roll-up for the PIC dashboard.

    The date range filters all panels by ``ms1_applied_date`` (the date a
    line entered the invoicing pipeline). Rows without an applied date (e.g.
    "Work Not Done") are excluded when a date range is set.  Clearing the
    filter shows the full pipeline.

    If the caller passes ``etag`` matching the current data version,
    short-circuits with ``{"unchanged": True, "etag": ...}``.
    """
    _pic_role_or_throw()

    current_etag = _dashboard_etag("pic", from_date, to_date)
    if etag and etag == current_etag:
        return {"unchanged": True, "etag": current_etag, "last_updated": _iso_now()}

    payload = pic_dashboard_payload(from_date, to_date)
    payload["etag"] = current_etag
    payload["last_updated"] = _iso_now()
    return payload


def pic_dashboard_payload(from_date=None, to_date=None):
    """The PIC dashboard figures, with no role guard and no etag handling.

    Split out of ``get_pic_dashboard`` so the admin Commercial dashboard can
    show the same invoicing numbers without demanding the INET PIC role. The
    two screens must never disagree about invoiced / unbilled / INET-vs-Subcon,
    so they share one computation instead of two copies of this SQL.

    Not whitelisted on purpose — callers are responsible for their own access
    check (``get_pic_dashboard`` guards on the PIC roles; the Commercial
    dashboard is admin/PM-facing and intentionally does not).
    """
    fd = getdate(from_date) if from_date else None
    td = getdate(to_date) if to_date else None

    # Time-series clauses — applied to monthly + pending-owner panels only.
    applied_clause = ""
    applied_params = []
    if fd and td:
        applied_clause = "AND pd.ms1_applied_date BETWEEN %s AND %s"
        applied_params = [fd, td]
    elif fd:
        applied_clause = "AND pd.ms1_applied_date >= %s"
        applied_params = [fd]
    elif td:
        applied_clause = "AND pd.ms1_applied_date <= %s"
        applied_params = [td]

    # Invoice-month conditions for the INET/Subcon split CASE expressions.
    # Each of the 4 SUM(CASE ...) uses split_ms1_cond (2 params each × 2 = 4)
    # then split_ms2_cond (2 params each × 2 = 4), total 8 params when both dates set.
    split_ms1_cond = ""
    split_ms2_cond = ""
    split_params = []
    if fd and td:
        split_ms1_cond = "AND DATE_FORMAT(pd.ms1_invoice_month,'%%Y-%%m') BETWEEN DATE_FORMAT(%s,'%%Y-%%m') AND DATE_FORMAT(%s,'%%Y-%%m')"
        split_ms2_cond = "AND DATE_FORMAT(pd.ms2_invoice_month,'%%Y-%%m') BETWEEN DATE_FORMAT(%s,'%%Y-%%m') AND DATE_FORMAT(%s,'%%Y-%%m')"
        split_params = [fd, td, fd, td, fd, td, fd, td]
    elif fd:
        split_ms1_cond = "AND pd.ms1_invoice_month >= %s"
        split_ms2_cond = "AND pd.ms2_invoice_month >= %s"
        split_params = [fd, fd, fd, fd]
    elif td:
        split_ms1_cond = "AND pd.ms1_invoice_month <= %s"
        split_ms2_cond = "AND pd.ms2_invoice_month <= %s"
        split_params = [td, td, td, td]

    # ── Acceptance buckets — count + 1st/2nd/total amounts per pic_status.
    # Each dispatch line is counted once per DISTINCT bucket it contributes to.
    # When MS1 and MS2 fall in the same bucket the line is counted once (not twice)
    # and both amounts are merged into that single bucket row.
    # When MS1 and MS2 are in different buckets the line appears in both.
    bucket_rows = frappe.db.sql(
        f"""
        SELECT bucket,
               COUNT(*) AS line_count,
               COALESCE(SUM(ms1_amount), 0) AS ms1_total,
               COALESCE(SUM(ms2_amount), 0) AS ms2_total,
               COALESCE(SUM(ms1_amount + ms2_amount), 0) AS total
        FROM (
          -- MS1 row: always emitted.
          -- If MS2 falls in the same bucket, absorb ms2_amount here so the
          -- line is not double-counted in the UNION below.
          SELECT
            ({_PIC_INITIAL_RULE_SQL.strip()}) AS bucket,
            pd.ms1_amount AS ms1_amount,
            CASE
              WHEN IFNULL(pd.ms2_amount, 0) > 0
                   AND COALESCE(NULLIF(pd.pic_status_ms2,''),'Work Not Done')
                       = ({_PIC_INITIAL_RULE_SQL.strip()})
              THEN pd.ms2_amount
              ELSE 0
            END AS ms2_amount
          {_PIC_FROM_JOIN}
          WHERE IFNULL(pd.is_internal_work, 0) = 0 AND IFNULL(pd.is_dummy_po, 0) = 0
            AND (IFNULL(pd.dispatch_status,'') != 'Cancelled' OR {_PIC_LINE_CANCELED_SQL})
          {applied_clause}
          UNION ALL
          -- MS2 row: only emitted when ms2_amount > 0 AND its bucket differs
          -- from the MS1 bucket (avoids the same-bucket double-count).
          SELECT
            COALESCE(NULLIF(pd.pic_status_ms2,''), 'Work Not Done') AS bucket,
            0 AS ms1_amount,
            pd.ms2_amount AS ms2_amount
          {_PIC_FROM_JOIN}
          WHERE IFNULL(pd.is_internal_work, 0) = 0 AND IFNULL(pd.is_dummy_po, 0) = 0
            AND (IFNULL(pd.dispatch_status,'') != 'Cancelled' OR {_PIC_LINE_CANCELED_SQL})
            AND IFNULL(pd.ms2_amount, 0) > 0
            AND COALESCE(NULLIF(pd.pic_status_ms2,''),'Work Not Done')
                != ({_PIC_INITIAL_RULE_SQL.strip()})
          {applied_clause}
        ) t
        GROUP BY bucket
        ORDER BY line_count DESC
        """,
        tuple(applied_params) * 2,
        as_dict=True,
    )

    # ── Pending approvals by I-Buy / ISDP owner — date scopes the rows.
    pending_ibuy = frappe.db.sql(
        f"""
        SELECT pd.ibuy_owner AS owner,
               COUNT(*) AS line_count,
               COALESCE(SUM(pd.ms1_amount), 0) AS amount_ms1,
               COALESCE(SUM(pd.ms2_amount), 0) AS amount_ms2
        {_PIC_FROM_JOIN}
        WHERE IFNULL(pd.is_internal_work, 0) = 0 AND IFNULL(pd.is_dummy_po, 0) = 0
          AND IFNULL(pd.dispatch_status,'') != 'Cancelled'
          AND IFNULL(pd.ibuy_owner,'') != ''
          AND ({_PIC_INITIAL_RULE_SQL.strip()}) = 'Under I-BUY'
          {applied_clause}
        GROUP BY pd.ibuy_owner
        ORDER BY line_count DESC
        LIMIT 50
        """,
        tuple(applied_params),
        as_dict=True,
    )
    pending_isdp = frappe.db.sql(
        f"""
        SELECT pd.isdp_owner AS owner,
               COUNT(*) AS line_count,
               COALESCE(SUM(pd.ms1_amount), 0) AS amount_ms1,
               COALESCE(SUM(pd.ms2_amount), 0) AS amount_ms2
        {_PIC_FROM_JOIN}
        WHERE IFNULL(pd.is_internal_work, 0) = 0 AND IFNULL(pd.is_dummy_po, 0) = 0
          AND IFNULL(pd.dispatch_status,'') != 'Cancelled'
          AND IFNULL(pd.isdp_owner,'') != ''
          AND ({_PIC_INITIAL_RULE_SQL.strip()}) = 'Under ISDP'
          {applied_clause}
        GROUP BY pd.isdp_owner
        ORDER BY line_count DESC
        LIMIT 50
        """,
        tuple(applied_params),
        as_dict=True,
    )

    # ── Monthly invoicing roll-up — date scopes the YYYY-MM bucket.
    monthly = _monthly_invoicing_rows(fd, td, order="DESC", limit=36)

    # ── INET vs Subcon split — filtered by invoice month when date range set.
    vat_frac = _TAX_RATE_FRACTION_SQL.format(col="pd.tax_rate")
    _split = frappe.db.sql(
        f"""
        SELECT
          SUM(CASE WHEN ({_PIC_INITIAL_RULE_SQL}) IN ('Commercial Invoice Closed','Commercial Invoice Submitted')
              {split_ms1_cond}
              THEN IFNULL(pd.ms1_amount, 0) * COALESCE(sm_pd.inet_margin_pct, sm_sub.inet_margin_pct, 100) / 100 ELSE 0 END) AS inet_ms1,
          SUM(CASE WHEN ({_PIC_INITIAL_RULE_SQL}) IN ('Commercial Invoice Closed','Commercial Invoice Submitted')
              {split_ms1_cond}
              THEN IFNULL(pd.ms1_amount, 0) * IFNULL(COALESCE(sm_pd.sub_payout_pct, sm_sub.sub_payout_pct), 0) / 100 ELSE 0 END) AS subcon_ms1,
          SUM(CASE WHEN IFNULL(pd.pic_status_ms2,'') IN ('Commercial Invoice Closed','Commercial Invoice Submitted')
              {split_ms2_cond}
              THEN IFNULL(pd.ms2_amount, 0) * COALESCE(sm_pd.inet_margin_pct, sm_sub.inet_margin_pct, 100) / 100 ELSE 0 END) AS inet_ms2,
          SUM(CASE WHEN IFNULL(pd.pic_status_ms2,'') IN ('Commercial Invoice Closed','Commercial Invoice Submitted')
              {split_ms2_cond}
              THEN IFNULL(pd.ms2_amount, 0) * IFNULL(COALESCE(sm_pd.sub_payout_pct, sm_sub.sub_payout_pct), 0) / 100 ELSE 0 END) AS subcon_ms2,
          SUM(CASE WHEN ({_PIC_INITIAL_RULE_SQL}) IN ('Commercial Invoice Closed','Commercial Invoice Submitted')
              {split_ms1_cond}
              THEN IFNULL(pd.ms1_amount, 0) * COALESCE(sm_pd.inet_margin_pct, sm_sub.inet_margin_pct, 100) / 100 * ({vat_frac}) ELSE 0 END) AS inet_ms1_vat,
          SUM(CASE WHEN ({_PIC_INITIAL_RULE_SQL}) IN ('Commercial Invoice Closed','Commercial Invoice Submitted')
              {split_ms1_cond}
              THEN IFNULL(pd.ms1_amount, 0) * IFNULL(COALESCE(sm_pd.sub_payout_pct, sm_sub.sub_payout_pct), 0) / 100 * ({vat_frac}) ELSE 0 END) AS subcon_ms1_vat,
          SUM(CASE WHEN IFNULL(pd.pic_status_ms2,'') IN ('Commercial Invoice Closed','Commercial Invoice Submitted')
              {split_ms2_cond}
              THEN IFNULL(pd.ms2_amount, 0) * COALESCE(sm_pd.inet_margin_pct, sm_sub.inet_margin_pct, 100) / 100 * ({vat_frac}) ELSE 0 END) AS inet_ms2_vat,
          SUM(CASE WHEN IFNULL(pd.pic_status_ms2,'') IN ('Commercial Invoice Closed','Commercial Invoice Submitted')
              {split_ms2_cond}
              THEN IFNULL(pd.ms2_amount, 0) * IFNULL(COALESCE(sm_pd.sub_payout_pct, sm_sub.sub_payout_pct), 0) / 100 * ({vat_frac}) ELSE 0 END) AS subcon_ms2_vat
        {_PIC_FROM_JOIN_LEAN}
        WHERE IFNULL(pd.is_internal_work, 0) = 0 AND IFNULL(pd.is_dummy_po, 0) = 0
          AND IFNULL(pd.dispatch_status,'') != 'Cancelled'
        """,
        tuple(split_params),
        as_dict=True,
    )
    _r = (_split[0] if _split else {}) or {}
    _im1  = flt(_r.get("inet_ms1"));  _sm1 = flt(_r.get("subcon_ms1"))
    _im2  = flt(_r.get("inet_ms2"));  _sm2 = flt(_r.get("subcon_ms2"))
    _im1v = flt(_r.get("inet_ms1_vat")); _sm1v = flt(_r.get("subcon_ms1_vat"))
    _im2v = flt(_r.get("inet_ms2_vat")); _sm2v = flt(_r.get("subcon_ms2_vat"))
    _t1v = _im1v + _sm1v; _t2v = _im2v + _sm2v
    inet_subcon = {
        "inet_ms1":    round(_im1,  2), "subcon_ms1":  round(_sm1, 2), "total_ms1":   round(_im1 + _sm1, 2),
        "inet_ms2":    round(_im2,  2), "subcon_ms2":  round(_sm2, 2), "total_ms2":   round(_im2 + _sm2, 2),
        "inet_total":  round(_im1 + _im2, 2),
        "subcon_total": round(_sm1 + _sm2, 2),
        "grand_total": round(_im1 + _sm1 + _im2 + _sm2, 2),
        "inet_ms1_vat": round(_im1v, 2), "subcon_ms1_vat": round(_sm1v, 2), "total_ms1_vat": round(_t1v, 2),
        "inet_ms2_vat": round(_im2v, 2), "subcon_ms2_vat": round(_sm2v, 2), "total_ms2_vat": round(_t2v, 2),
        "inet_total_vat": round(_im1v + _im2v, 2),
        "subcon_total_vat": round(_sm1v + _sm2v, 2),
        "grand_total_vat": round(_t1v + _t2v, 2),
        "inet_ms1_total": round(_im1 + _im1v, 2),
        "subcon_ms1_total": round(_sm1 + _sm1v, 2),
        "total_ms1_total": round(_im1 + _sm1 + _t1v, 2),
        "inet_ms2_total": round(_im2 + _im2v, 2),
        "subcon_ms2_total": round(_sm2 + _sm2v, 2),
        "total_ms2_total": round(_im2 + _sm2 + _t2v, 2),
        "inet_grand_total": round(_im1 + _im2 + _im1v + _im2v, 2),
        "subcon_grand_total": round(_sm1 + _sm2 + _sm1v + _sm2v, 2),
        "grand_total_incl_vat": round(_im1 + _sm1 + _im2 + _sm2 + _t1v + _t2v, 2),
    }

    # ── Top-line KPIs — scoped by date when set.
    # line_count is the "All Lines" tile — every PIC-scoped POID, matching
    # the pending+active+cancelled total. total_invoiced/unbilled stay
    # scoped to non-cancelled lines only — a cancelled PO's amount isn't
    # outstanding revenue, so it must not inflate those money figures.
    kpi = frappe.db.sql(
        f"""
        SELECT
          COALESCE(SUM(CASE WHEN {_MS1_INVOICED_SQL} AND {_NOT_CANCELLED_SQL}
                            THEN IFNULL(pd.ms1_amount, 0) ELSE 0 END), 0)
        + COALESCE(SUM(CASE WHEN {_MS2_INVOICED_SQL} AND {_NOT_CANCELLED_SQL}
                            THEN IFNULL(pd.ms2_amount, 0) ELSE 0 END), 0) AS total_invoiced,
          COALESCE(SUM(CASE WHEN {_MS1_NOT_INVOICED_SQL} AND {_NOT_CANCELLED_SQL}
                            THEN IFNULL(pd.ms1_amount, 0) ELSE 0 END), 0) AS unbilled_ms1,
          COALESCE(SUM(CASE WHEN {_MS2_NOT_INVOICED_SQL} AND {_NOT_CANCELLED_SQL}
                            THEN IFNULL(pd.ms2_amount, 0) ELSE 0 END), 0) AS unbilled_ms2,
          COUNT(*) AS line_count,
          COALESCE(SUM(CASE WHEN {_PIC_STAGE_SQL["pending"]} THEN 1 ELSE 0 END), 0) AS pending_count,
          COALESCE(SUM(CASE WHEN {_PIC_STAGE_SQL["active"]} THEN 1 ELSE 0 END), 0) AS active_count,
          COALESCE(SUM(CASE WHEN {_PIC_STAGE_SQL["closed"]} THEN 1 ELSE 0 END), 0) AS closed_count,
          COALESCE(SUM(CASE WHEN {_PIC_STAGE_SQL["cancelled"]} THEN 1 ELSE 0 END), 0) AS cancelled_count
        {_PIC_FROM_JOIN}
        WHERE IFNULL(pd.is_internal_work, 0) = 0 AND IFNULL(pd.is_dummy_po, 0) = 0
        {applied_clause}
        """,
        tuple(applied_params),
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
            "pending_count": cint(kpi.get("pending_count") or 0),
            "active_count": cint(kpi.get("active_count") or 0),
            "closed_count": cint(kpi.get("closed_count") or 0),
            "cancelled_count": cint(kpi.get("cancelled_count") or 0),
        },
        "buckets": bucket_rows,
        "pending_ibuy": pending_ibuy,
        "pending_isdp": pending_isdp,
        "monthly": monthly,
        "inet_subcon": inet_subcon,
    }


@frappe.whitelist()
def get_pic_report(kind="pipeline", from_date=None, to_date=None, project_code=None, owner=None):
    """Canned PIC reports — exposed as a single endpoint to keep the FE simple.

    Each report has its own column shape (returned in ``columns``) so the
    front-end can render the table generically and download CSV without
    keeping the column list in sync.

    ``kind``:
      - ``pipeline``    — bucket breakdown (lines + MS1/MS2 amounts).
      - ``monthly``     — invoicing roll-up by month from MS1/MS2 invoice month.
      - ``aging``       — POIDs in Under I-BUY / Under ISDP with days_since_applied.
      - ``closed``      — POIDs that reached Commercial Invoice Closed (date-bounded).
      - ``rejected``    — POIDs in I-BUY Rejected / ISDP Rejected.
    """
    _pic_role_or_throw()
    kind = (kind or "pipeline").lower()
    fd = getdate(from_date) if from_date else None
    td = getdate(to_date) if to_date else None

    project_clause = ""
    project_params = []
    if project_code:
        c, p = _sql_in_or_eq("pd.project_code", project_code)
        if c:
            project_clause = f" AND {c}"
            project_params = list(p)

    if kind == "pipeline":
        return {
            "kind": kind,
            "columns": [
                {"key": "bucket", "label": "PIC Status"},
                {"key": "line_count", "label": "Lines", "numeric": True},
                {"key": "ms1_total", "label": "MS1 Amount", "numeric": True, "money": True},
                {"key": "ms2_total", "label": "MS2 Amount", "numeric": True, "money": True},
                {"key": "total", "label": "Total", "numeric": True, "money": True},
            ],
            "rows": frappe.db.sql(
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
                  WHERE IFNULL(pd.is_internal_work, 0) = 0 AND IFNULL(pd.is_dummy_po, 0) = 0
                    AND (IFNULL(pd.dispatch_status,'') != 'Cancelled' OR {_PIC_LINE_CANCELED_SQL})
                  {project_clause}
                ) t
                GROUP BY bucket
                ORDER BY line_count DESC
                """,
                tuple(project_params),
                as_dict=True,
            ),
        }

    if kind == "monthly":
        # Optional date scope on the YYYY-MM bucket. Unlimited — the dashboard
        # panel caps at 36 months, the report does not.
        return {
            "kind": kind,
            "columns": [
                {"key": "invoice_month", "label": "Invoicing Month"},
                {"key": "ms1_invoiced", "label": "MS1 Invoiced", "numeric": True, "money": True},
                {"key": "ms2_invoiced", "label": "MS2 Invoiced", "numeric": True, "money": True},
                {"key": "total", "label": "Total (excl. VAT)", "numeric": True, "money": True},
                {"key": "vat_amount", "label": "VAT Amount", "numeric": True, "money": True},
                {"key": "total_amount", "label": "Total (incl. VAT)", "numeric": True, "money": True},
            ],
            "rows": _monthly_invoicing_rows(fd, td, order="DESC", limit=None),
        }

    if kind == "aging":
        # POIDs sitting in Under I-BUY / Under ISDP, with days since applied.
        owner_clause = ""
        owner_params = []
        if owner:
            owner_clause = " AND pd.isdp_owner = %s"
            owner_params = [owner]
        return {
            "kind": kind,
            "columns": [
                {"key": "poid", "label": "POID"},
                {"key": "po_no", "label": "PO No"},
                {"key": "project_code", "label": "Project"},
                {"key": "site_code", "label": "DUID"},
                {"key": "pic_status", "label": "PIC Status"},
                {"key": "isdp_owner", "label": "ISDP Owner"},
                {"key": "ms1_applied_date", "label": "Applied"},
                {"key": "days_since_applied", "label": "Days Aging", "numeric": True},
                {"key": "ms1_amount", "label": "MS1 Amount", "numeric": True, "money": True},
            ],
            "rows": frappe.db.sql(
                f"""
                SELECT pd.poid AS poid,
                       pd.po_no, pd.project_code, pd.site_code,
                       pd.pic_status,
                       pd.isdp_owner,
                       pd.ms1_applied_date,
                       DATEDIFF(CURDATE(), pd.ms1_applied_date) AS days_since_applied,
                       pd.ms1_amount
                {_PIC_FROM_JOIN}
                WHERE IFNULL(pd.is_internal_work, 0) = 0 AND IFNULL(pd.is_dummy_po, 0) = 0
                  AND IFNULL(pd.dispatch_status,'') != 'Cancelled'
                  AND pd.pic_status IN ('Under I-BUY', 'Under ISDP')
                  AND pd.ms1_applied_date IS NOT NULL
                  {project_clause}
                  {owner_clause}
                ORDER BY days_since_applied DESC
                LIMIT 2000
                """,
                tuple(project_params + owner_params),
                as_dict=True,
            ),
        }

    if kind == "closed":
        # POIDs that reached Commercial Invoice Closed.
        # Date scope on ms1_payment_received_date when set, else ms1_invoice_month.
        date_clause = ""
        date_params = []
        if fd and td:
            date_clause = "AND COALESCE(pd.ms1_payment_received_date, pd.ms1_invoice_month) BETWEEN %s AND %s"
            date_params = [fd, td]
        elif fd:
            date_clause = "AND COALESCE(pd.ms1_payment_received_date, pd.ms1_invoice_month) >= %s"
            date_params = [fd]
        elif td:
            date_clause = "AND COALESCE(pd.ms1_payment_received_date, pd.ms1_invoice_month) <= %s"
            date_params = [td]
        return {
            "kind": kind,
            "columns": [
                {"key": "poid", "label": "POID"},
                {"key": "po_no", "label": "PO No"},
                {"key": "project_code", "label": "Project"},
                {"key": "site_code", "label": "DUID"},
                {"key": "ms1_invoice_month", "label": "Invoice Month"},
                {"key": "ms1_payment_received_date", "label": "Payment Received"},
                {"key": "ms1_amount", "label": "MS1 Amount", "numeric": True, "money": True},
                {"key": "ms2_amount", "label": "MS2 Amount", "numeric": True, "money": True},
                {"key": "total", "label": "Total", "numeric": True, "money": True},
            ],
            "rows": frappe.db.sql(
                f"""
                SELECT pd.poid, pd.po_no, pd.project_code, pd.site_code,
                       pd.ms1_invoice_month,
                       pd.ms1_payment_received_date,
                       pd.ms1_amount,
                       pd.ms2_amount,
                       (pd.ms1_amount + pd.ms2_amount) AS total
                {_PIC_FROM_JOIN}
                WHERE IFNULL(pd.is_internal_work, 0) = 0 AND IFNULL(pd.is_dummy_po, 0) = 0
                  AND pd.pic_status = 'Commercial Invoice Closed'
                  {project_clause}
                  {date_clause}
                ORDER BY pd.ms1_payment_received_date DESC, pd.ms1_invoice_month DESC
                LIMIT 5000
                """,
                tuple(project_params + date_params),
                as_dict=True,
            ),
        }

    if kind == "rejected":
        return {
            "kind": kind,
            "columns": [
                {"key": "poid", "label": "POID"},
                {"key": "po_no", "label": "PO No"},
                {"key": "project_code", "label": "Project"},
                {"key": "site_code", "label": "DUID"},
                {"key": "pic_status", "label": "Rejected At"},
                {"key": "isdp_owner", "label": "ISDP Owner"},
                {"key": "im_rejection_remark", "label": "IM Rejection Remark"},
                {"key": "pic_detail_remark", "label": "PIC Note"},
                {"key": "ms1_amount", "label": "MS1 Amount", "numeric": True, "money": True},
            ],
            "rows": frappe.db.sql(
                f"""
                SELECT pd.poid, pd.po_no, pd.project_code, pd.site_code,
                       pd.pic_status,
                       pd.isdp_owner,
                       pd.im_rejection_remark,
                       pd.pic_detail_remark,
                       pd.ms1_amount
                {_PIC_FROM_JOIN}
                WHERE IFNULL(pd.is_internal_work, 0) = 0 AND IFNULL(pd.is_dummy_po, 0) = 0
                  AND pd.pic_status IN ('I-BUY Rejected', 'ISDP Rejected')
                  AND IFNULL(pd.dispatch_status,'') NOT IN ('Cancelled','Closed')
                  {project_clause}
                ORDER BY pd.modified DESC
                LIMIT 2000
                """,
                tuple(project_params),
                as_dict=True,
            ),
        }

    frappe.throw(f"Unknown report kind: {kind}")


@frappe.whitelist()
def get_pic_capability():
    """FE bootstrap: tells the SPA whether the current session is a PIC."""
    roles = set(frappe.get_roles(frappe.session.user))
    return {
        "is_pic": bool(roles & {"INET PIC"}),
        "is_admin": bool(roles & {"Administrator", "System Manager", "INET Admin"}),
    }


@frappe.whitelist()
def create_sales_invoice_from_pic(po_dispatch=None, milestone=None):
    """Create an ERPNext Sales Invoice (draft) from one or many PO Dispatches.

    ``po_dispatch`` can be a single name or a JSON list of names.  Each becomes
    one item row in the same Sales Invoice.

    Does NOT change PIC status — status changes to 'Commercial Invoice Submitted'
    only when the Sales Invoice is submitted.
    """
    _pic_role_or_throw()
    # Accept single string or JSON list
    if isinstance(po_dispatch, str) and po_dispatch.strip().startswith("["):
        po_dispatch = frappe.parse_json(po_dispatch)
    if isinstance(po_dispatch, list):
        dispatch_list = po_dispatch
    else:
        dispatch_list = [po_dispatch]

    dispatch_list = [d for d in dispatch_list if d]
    if not dispatch_list:
        frappe.throw("po_dispatch is required")

    milestone = (milestone or "").strip().upper()
    if milestone and milestone not in ("MS1", "MS2"):
        frappe.throw("milestone must be MS1 or MS2")

    # Validate all dispatches exist, then auto-detect milestone from the first
    # Ready row if not explicitly provided.  All rows must be Ready for the same
    # milestone.
    pds_raw = []
    first_customer = None
    for dname in dispatch_list:
        if not frappe.db.exists("PO Dispatch", dname):
            frappe.throw(f"PO Dispatch {dname} not found.")
        pd = frappe.db.get_value("PO Dispatch", dname, "*", as_dict=True)
        if not pd:
            frappe.throw(f"PO Dispatch {dname} not found.")
        if cint(pd.get("is_internal_work") or 0):
            frappe.throw(f"{dname} is internal work — it cannot be invoiced.")
        pds_raw.append(pd)

    # Resolve the Ready milestone(s) per row. When the caller already picked
    # a milestone we still validate that the row is Ready for *that*
    # milestone; when auto-detecting we let each row use whichever
    # milestone(s) are Ready.
    pds = []          # (doc_dict, milestone, amount)
    resolved = []     # (pd, dname, milestone, amount) — before the draft-conflict check
    for pd in pds_raw:
        dname = pd["name"]
        ms1_s = (pd.get("pic_status") or "").strip()
        ms2_s = (pd.get("pic_status_ms2") or "").strip()
        ms1_amt = flt(pd.get("ms1_amount") or 0)
        ms2_amt = flt(pd.get("ms2_amount") or 0)

        row_entries = []  # [(milestone, amount), ...] — usually 1, can be 2

        if milestone:
            # Explicit milestone — validate that specific one
            row_milestone = milestone.upper()
            if row_milestone == "MS1":
                ready = ms1_s == "Ready for Invoice" and ms1_amt > 0
                cur = ms1_s
                row_amount = ms1_amt
            else:
                ready = ms2_s == "Ready for Invoice" and ms2_amt > 0
                cur = ms2_s
                row_amount = ms2_amt

            if cur in ("Commercial Invoice Submitted", "Commercial Invoice Closed"):
                # Already invoiced for this milestone — try the other one
                if row_milestone == "MS1" and ms2_s == "Ready for Invoice" and ms2_amt > 0:
                    row_entries.append(("MS2", ms2_amt))
                elif row_milestone == "MS2" and ms1_s == "Ready for Invoice" and ms1_amt > 0:
                    row_entries.append(("MS1", ms1_amt))
                # else: both already invoiced or the other isn't ready — nothing to add
            elif ready:
                row_entries.append((row_milestone, row_amount))
        else:
            # Auto-detect: include EVERY milestone that's currently Ready for
            # Invoice — normally just one, but if a row has both MS1 and MS2
            # flagged Ready at the same time, both go onto the invoice as
            # two separate lines rather than picking one and silently
            # dropping the other.
            if ms1_s == "Ready for Invoice" and ms1_amt > 0:
                row_entries.append(("MS1", ms1_amt))
            if ms2_s == "Ready for Invoice" and ms2_amt > 0:
                row_entries.append(("MS2", ms2_amt))

        if not row_entries:
            continue

        customer = pd.get("customer")
        if not customer or not frappe.db.exists("Customer", customer):
            frappe.throw(f"{dname}: Customer '{customer}' not found.")

        if first_customer is None:
            first_customer = customer
        elif customer != first_customer:
            frappe.throw(
                f"All lines must have the same customer. "
                f"'{dname}' has '{customer}', expected '{first_customer}'."
            )

        for row_milestone, row_amount in row_entries:
            if row_amount > 0:
                resolved.append((pd, dname, row_milestone, row_amount))

    if not resolved:
        frappe.throw("No valid lines to invoice after filtering.")

    # Hard block: creating a Sales Invoice never changes pic_status (only
    # submitting one does), so a row can sit at "Ready for Invoice"
    # indefinitely even after a draft already exists for it — without this
    # check, clicking Create again would silently spin up a duplicate draft
    # for the same POID/milestone. One batched query for the whole
    # selection, not one per row (see _batch_draft_invoices_by_milestone).
    existing_drafts = _batch_draft_invoices_by_milestone([dname for _, dname, _, _ in resolved])
    conflicts = []
    for pd, dname, row_milestone, _ in resolved:
        si_name = existing_drafts.get((dname, row_milestone))
        if si_name:
            conflicts.append(f"{pd.get('poid') or dname} ({row_milestone}) → draft {si_name}")
    if conflicts:
        frappe.throw(
            "Can't create — a draft invoice already exists for: " + "; ".join(conflicts) +
            ". Delete or cancel the existing draft first, then try again."
        )

    pds = [(pd, m, a) for pd, _, m, a in resolved]

    # If we auto-detected, the batch milestone is the first row's choice
    if not milestone:
        milestone = pds[0][1]

    if not frappe.db.exists("DocType", "Sales Invoice"):
        frappe.throw("Sales Invoice doctype not found — ERPNext may not be installed.")

    tax_template = frappe.db.get_single_value("INET Settings", "sales_tax_template")

    # DUID and project ride along as accounting dimensions so revenue can be
    # filtered by site and project in the General Ledger, the same way the
    # subcontractor side already does it (see create_purchase_order_from_pic).
    # Both are Link fields, but PO Dispatch stores site_code / project_code as
    # plain text — a value with no master record would fail Link validation and
    # take the whole invoice down, so only values that really exist are set.
    real_duids = set(frappe.db.get_all(
        "DUID Master",
        filters={"name": ["in", sorted({(pd.get("site_code") or "") for pd, _m, _a in pds} - {""}) or [""]]},
        pluck="name",
    ))
    real_projects = set(frappe.db.get_all(
        "Project Control Center",
        filters={"name": ["in", sorted({(pd.get("project_code") or "") for pd, _m, _a in pds} - {""}) or [""]]},
        pluck="name",
    ))

    total_amount = 0
    try:
        si = frappe.new_doc("Sales Invoice")
        si.customer = first_customer
        si.company = frappe.defaults.get_user_default("Company") or frappe.defaults.get_global_default("company")
        si.due_date = frappe.utils.add_days(frappe.utils.nowdate(), 30)
        if tax_template:
            si.taxes_and_charges = tax_template
            # Server-side creation doesn't auto-fetch template rows (that's
            # form JS behaviour) — append them so VAT is actually applied.
            from erpnext.controllers.accounts_controller import get_taxes_and_charges
            for tax in get_taxes_and_charges("Sales Taxes and Charges Template", tax_template) or []:
                si.append("taxes", tax)
        for pd, row_milestone, amount in pds:
            dname = pd["name"]
            item_code = pd.get("item_code") or "Service"
            if not frappe.db.exists("Item", item_code):
                item_code = "Service"
            # Scale qty proportionally so qty × rate = milestone amount.
            ms_pct = flt(pd.get("ms1_pct" if row_milestone == "MS1" else "ms2_pct") or 0)
            full_qty = flt(pd.get("qty") or 1)
            full_rate = flt(pd.get("rate") or amount)
            scaled_qty = round(full_qty * ms_pct / 100.0, 4) if ms_pct > 0 else full_qty
            duid = (pd.get("site_code") or "").strip()
            project = (pd.get("project_code") or "").strip()
            si.append("items", {
                "item_code": item_code,
                "qty": scaled_qty,
                "rate": full_rate,
                "amount": amount,
                "poid": dname,
                "milestone": row_milestone,
                ACCOUNTING_DUID_FIELDNAME: duid if duid in real_duids else None,
                "project_control_center": project if project in real_projects else None,
            })
            total_amount += amount
        si.save(ignore_permissions=True)
        inv_name = si.name
    except Exception as e:
        frappe.log_error(f"Sales Invoice creation failed: {e}")
        frappe.throw(f"Failed to create Sales Invoice: {str(e)}")

    # Summarise milestone mix (e.g. "MS1" or "MS1+MS2")
    ms_set = sorted({m for _, m, _ in pds})
    milestone_summary = "+".join(ms_set) if ms_set else milestone

    return {
        "sales_invoice": inv_name,
        "line_count": len(pds),
        "milestone": milestone_summary,
        "amount": total_amount,
        "invoice_url": f"/app/sales-invoice/{inv_name}",
    }


def _get_poid_milestone_from_item(item):
    """Return (pd_name, milestone) derived from item.  milestone is 'MS1'/'MS2'/None."""
    pd_name = (item.get("poid") or "").strip()
    if not pd_name:
        return None, None
    milestone = (item.get("milestone") or "").strip().upper()
    if milestone not in ("MS1", "MS2"):
        milestone = None
    return pd_name, milestone


def _calc_invoiced_from_submitted(pd_name, excluding_invoice=None):
    """Sum item.amount from all *submitted* Sales Invoices for a POID, split by milestone.

    Returns (ms1_total, ms2_total) as floats.
    """
    filters = {"poid": pd_name, "docstatus": 1}
    si_names = frappe.db.get_all(
        "Sales Invoice Item",
        filters=filters,
        fields=["parent", "amount", "milestone"],
    )
    ms1_total = 0.0
    ms2_total = 0.0
    for row in si_names:
        if excluding_invoice and row.parent == excluding_invoice:
            continue
        ms = (row.get("milestone") or "").strip().upper()
        amt = flt(row.amount or 0)
        if ms == "MS2":
            ms2_total += amt
        else:
            ms1_total += amt
    return round(ms1_total, 4), round(ms2_total, 4)


def before_sales_invoice_submit(doc, method):
    """Validate invoice line items against PO Dispatch milestone amounts before submit.

    For each item with a POID set:
    - Validates that item.amount matches the milestone amount on PO Dispatch
      (within SAR 0.01 tolerance).
    - Validates that the cumulative invoiced amount (existing submitted invoices
      + this invoice) does not exceed the milestone amount.
    """
    for item in doc.items:
        pd_name = (item.get("poid") or "").strip()
        if not pd_name:
            continue
        if not frappe.db.exists("PO Dispatch", pd_name):
            frappe.throw(
                f"Item {item.item_code or item.idx}: POID '{pd_name}' does not exist in PO Dispatch."
            )

        pd = frappe.db.get_value(
            "PO Dispatch", pd_name,
            ["ms1_amount", "ms2_amount"],
            as_dict=True,
        )
        if not pd:
            continue

        item_amount = flt(item.amount or 0)
        milestone = (item.get("milestone") or "").strip().upper()
        ms1_amt = flt(pd.ms1_amount or 0)
        ms2_amt = flt(pd.ms2_amount or 0)

        if not milestone:
            # Auto-detect milestone by amount match (legacy path)
            if ms1_amt > 0 and abs(item_amount - ms1_amt) < 0.01:
                milestone = "MS1"
            elif ms2_amt > 0 and abs(item_amount - ms2_amt) < 0.01:
                milestone = "MS2"
            else:
                # Can't determine milestone — skip validation (may be a non-INET line)
                continue

        target_amt = ms1_amt if milestone == "MS1" else ms2_amt
        if target_amt <= 0:
            frappe.throw(
                f"Item {item.item_code or item.idx}: POID '{pd_name}' has no {milestone} amount set."
            )

        if abs(item_amount - target_amt) > 0.01:
            frappe.throw(
                f"Item {item.item_code or item.idx} (POID {pd_name}, {milestone}): "
                f"Invoice amount {item_amount:,.2f} does not match {milestone} amount {target_amt:,.2f} on PO Dispatch."
            )

        # Cumulative check: already-submitted invoices + this invoice must not exceed milestone amount
        ms1_already, ms2_already = _calc_invoiced_from_submitted(pd_name, excluding_invoice=doc.name)
        already = ms1_already if milestone == "MS1" else ms2_already
        if already + item_amount > target_amt + 0.01:
            frappe.throw(
                f"Item {item.item_code or item.idx} (POID {pd_name}, {milestone}): "
                f"Cumulative invoiced amount ({already:,.2f} + {item_amount:,.2f} = {already + item_amount:,.2f}) "
                f"exceeds {milestone} amount {target_amt:,.2f} on PO Dispatch."
            )


def on_sales_invoice_submit(doc, method):
    """When a Sales Invoice is submitted, update PIC status to 'Commercial Invoice Submitted'.

    Reads the `poid` accounting-dimension field from each item row to find the
    PO Dispatch and updates the appropriate MS1/MS2 status.  Non-matching POIDs
    are silently skipped — the invoice may contain non-INET lines.

    Also recomputes ms1_unbilled / ms2_unbilled / remaining_milestone_pct so
    the PIC dashboards immediately reflect the new invoiced amounts.
    """
    for item in doc.items:
        pd_name = (item.get("poid") or "").strip()
        if not pd_name or not frappe.db.exists("PO Dispatch", pd_name):
            continue

        try:
            pd = frappe.db.get_value("PO Dispatch", pd_name, [
                "pic_status", "pic_status_ms2",
                "ms1_amount", "ms2_amount",
                "ms1_invoiced", "ms2_invoiced",
                "line_amount",
            ], as_dict=True)
        except Exception:
            continue
        if not pd:
            continue

        item_amount = flt(item.amount or 0)
        item_milestone = (item.get("milestone") or "").strip().upper()
        updates = {}

        ms1_amt = flt(pd.ms1_amount or 0)
        ms2_amt = flt(pd.ms2_amount or 0)

        ms1_ready = (pd.pic_status or "").strip() == "Ready for Invoice"
        ms2_ready = (pd.pic_status_ms2 or "").strip() == "Ready for Invoice"

        # Prefer the milestone tag stored on the item, fall back to amount matching
        if item_milestone in ("MS1", "MS2"):
            update_ms1 = item_milestone == "MS1" and ms1_ready
            update_ms2 = item_milestone == "MS2" and ms2_ready
        else:
            ms1_amount_match = ms1_amt > 0 and abs(item_amount - ms1_amt) < 0.01
            ms2_amount_match = ms2_amt > 0 and abs(item_amount - ms2_amt) < 0.01
            update_ms1 = ms1_ready and ms1_amount_match
            update_ms2 = ms2_ready and ms2_amount_match

        if update_ms1:
            # Accumulate from all submitted invoices for this POID
            ms1_total, _ = _calc_invoiced_from_submitted(pd_name)
            updates.update({
                "pic_status": "Commercial Invoice Submitted",
                "ms1_invoiced": ms1_total,
                "ms1_unbilled": round(ms1_amt - ms1_total, 4),
                "ms1_invoice_month": doc.posting_date,
            })

        if update_ms2:
            _, ms2_total = _calc_invoiced_from_submitted(pd_name)
            updates.update({
                "pic_status_ms2": "Commercial Invoice Submitted",
                "ms2_invoiced": ms2_total,
                "ms2_unbilled": round(ms2_amt - ms2_total, 4),
                "ms2_invoice_month": doc.posting_date,
            })

        if not updates:
            continue

        # Recompute remaining_milestone_pct from the updated invoiced values
        m1_inv = flt(updates.get("ms1_invoiced", flt(pd.ms1_invoiced or 0)))
        m2_inv = flt(updates.get("ms2_invoiced", flt(pd.ms2_invoiced or 0)))
        line = flt(pd.line_amount or 0)
        remaining = (ms1_amt - m1_inv) + (ms2_amt - m2_inv)
        updates["remaining_milestone_pct"] = round(remaining / line * 100.0, 2) if line else 0.0

        frappe.db.set_value("PO Dispatch", pd_name, updates, update_modified=True)

        # Sync Work Done billing_status to Invoiced
        wd_names = frappe.db.get_all("Work Done", {"system_id": pd_name}, pluck="name")
        for wd_name in wd_names:
            frappe.db.set_value("Work Done", wd_name, "billing_status", "Invoiced")

    _notify_role("INET Admin",
        f"[INFO] Sales Invoice {doc.name} submitted",
        "Sales Invoice", doc.name)


def on_sales_invoice_cancel(doc, method):
    """When a Sales Invoice is cancelled, recalculate invoiced amounts from remaining
    submitted invoices and revert PIC status to 'Ready for Invoice' if none remain."""
    for item in doc.items:
        pd_name = (item.get("poid") or "").strip()
        if not pd_name or not frappe.db.exists("PO Dispatch", pd_name):
            continue

        try:
            pd = frappe.db.get_value("PO Dispatch", pd_name, [
                "pic_status", "pic_status_ms2",
                "ms1_amount", "ms2_amount",
                "line_amount",
            ], as_dict=True)
        except Exception:
            continue
        if not pd:
            continue

        item_milestone = (item.get("milestone") or "").strip().upper()
        updates = {}

        ms1_amt = flt(pd.ms1_amount or 0)
        ms2_amt = flt(pd.ms2_amount or 0)

        ms1_submitted = (pd.pic_status or "").strip() == "Commercial Invoice Submitted"
        ms2_submitted = (pd.pic_status_ms2 or "").strip() == "Commercial Invoice Submitted"

        revert_ms1 = (item_milestone == "MS1" and ms1_submitted) or (not item_milestone and ms1_submitted)
        revert_ms2 = (item_milestone == "MS2" and ms2_submitted) or (not item_milestone and ms2_submitted)

        if revert_ms1:
            # Recalculate from remaining submitted invoices (excluding this cancelled one)
            ms1_remaining, _ = _calc_invoiced_from_submitted(pd_name, excluding_invoice=doc.name)
            if ms1_remaining > 0:
                updates.update({
                    "ms1_invoiced": ms1_remaining,
                    "ms1_unbilled": round(ms1_amt - ms1_remaining, 4),
                })
            else:
                updates.update({
                    "pic_status": "Ready for Invoice",
                    "ms1_invoiced": 0,
                    "ms1_unbilled": ms1_amt,
                    "ms1_invoice_month": None,
                })

        if revert_ms2:
            _, ms2_remaining = _calc_invoiced_from_submitted(pd_name, excluding_invoice=doc.name)
            if ms2_remaining > 0:
                updates.update({
                    "ms2_invoiced": ms2_remaining,
                    "ms2_unbilled": round(ms2_amt - ms2_remaining, 4),
                })
            else:
                updates.update({
                    "pic_status_ms2": "Ready for Invoice",
                    "ms2_invoiced": 0,
                    "ms2_unbilled": ms2_amt,
                    "ms2_invoice_month": None,
                })

        if not updates:
            continue

        m1_inv = flt(updates.get("ms1_invoiced", 0))
        m2_inv = flt(updates.get("ms2_invoiced", 0))
        line = flt(pd.line_amount or 0) or (ms1_amt + ms2_amt)
        remaining = (ms1_amt - m1_inv) + (ms2_amt - m2_inv)
        updates["remaining_milestone_pct"] = round(remaining / line * 100.0, 2) if line else 0.0

        frappe.db.set_value("PO Dispatch", pd_name, updates, update_modified=True)

        # Revert Work Done billing_status only if no submitted invoices remain for this POID
        ms1_rem, ms2_rem = _calc_invoiced_from_submitted(pd_name, excluding_invoice=doc.name)
        if ms1_rem + ms2_rem <= 0:
            wd_names = frappe.db.get_all("Work Done", {"system_id": pd_name}, pluck="name")
            for wd_name in wd_names:
                frappe.db.set_value("Work Done", wd_name, "billing_status", "")

    _notify_role("INET PIC",
        f"[ALERT] Sales Invoice {doc.name} was cancelled — dispatches reverted",
        "Sales Invoice", doc.name)


def _po_dispatch_names_from_payment_entry(pe_doc):
    """Return list of (pd_name, milestone, si_name) tuples from a Payment Entry.

    Walks the references child table for Sales Invoice entries, then reads
    each SI's item rows to find POID accounting dimensions.
    """
    results = []
    for ref in (pe_doc.get("references") or []):
        if (ref.get("reference_doctype") or "") != "Sales Invoice":
            continue
        si_name = (ref.get("reference_name") or "").strip()
        if not si_name:
            continue
        try:
            si_items = frappe.db.get_all(
                "Sales Invoice Item",
                filters={"parent": si_name},
                fields=["poid", "milestone", "amount"],
            )
        except Exception:
            continue
        for item in si_items:
            pd_name = (item.get("poid") or "").strip()
            if pd_name and frappe.db.exists("PO Dispatch", pd_name):
                results.append({
                    "pd_name": pd_name,
                    "milestone": (item.get("milestone") or "").strip().upper(),
                    "si_name": si_name,
                    "amount": flt(item.get("amount") or 0),
                })
    return results


def on_payment_entry_submit(doc, method=None):
    """When a Payment Entry is submitted for a Sales Invoice that has POID items,
    advance pic_status / pic_status_ms2 from 'Commercial Invoice Submitted'
    to 'Commercial Invoice Closed' and stamp the payment received date.
    """
    posting_date = doc.posting_date
    seen = set()
    for entry in _po_dispatch_names_from_payment_entry(doc):
        pd_name = entry["pd_name"]
        milestone = entry["milestone"]
        key = (pd_name, milestone)
        if key in seen:
            continue
        seen.add(key)

        try:
            pd = frappe.db.get_value("PO Dispatch", pd_name, [
                "pic_status", "pic_status_ms2",
                "ms1_amount", "ms2_amount",
            ], as_dict=True)
        except Exception:
            continue
        if not pd:
            continue

        ms1_status = (pd.pic_status or "").strip()
        ms2_status = (pd.pic_status_ms2 or "").strip()
        ms1_amt = flt(pd.ms1_amount or 0)
        ms2_amt = flt(pd.ms2_amount or 0)
        updates = {}

        # Determine which milestone to close
        if milestone == "MS1":
            close_ms1 = ms1_status == "Commercial Invoice Submitted"
            close_ms2 = False
        elif milestone == "MS2":
            close_ms1 = False
            close_ms2 = ms2_status == "Commercial Invoice Submitted"
        else:
            # No milestone tag — fall back to amount matching
            amt = entry["amount"]
            close_ms1 = ms1_status == "Commercial Invoice Submitted" and ms1_amt > 0 and abs(amt - ms1_amt) < 0.01
            close_ms2 = ms2_status == "Commercial Invoice Submitted" and ms2_amt > 0 and abs(amt - ms2_amt) < 0.01

        if close_ms1:
            updates["pic_status"] = "Commercial Invoice Closed"
            updates["ms1_payment_received_date"] = posting_date
        if close_ms2:
            updates["pic_status_ms2"] = "Commercial Invoice Closed"
            updates["ms2_payment_received_date"] = posting_date

        if updates:
            frappe.db.set_value("PO Dispatch", pd_name, updates, update_modified=True)


def on_payment_entry_cancel(doc, method=None):
    """When a Payment Entry is cancelled, revert pic_status from
    'Commercial Invoice Closed' back to 'Commercial Invoice Submitted'
    and clear the payment received date.
    """
    seen = set()
    for entry in _po_dispatch_names_from_payment_entry(doc):
        pd_name = entry["pd_name"]
        milestone = entry["milestone"]
        key = (pd_name, milestone)
        if key in seen:
            continue
        seen.add(key)

        try:
            pd = frappe.db.get_value("PO Dispatch", pd_name, [
                "pic_status", "pic_status_ms2",
            ], as_dict=True)
        except Exception:
            continue
        if not pd:
            continue

        ms1_status = (pd.pic_status or "").strip()
        ms2_status = (pd.pic_status_ms2 or "").strip()
        updates = {}

        if milestone == "MS1":
            revert_ms1 = ms1_status == "Commercial Invoice Closed"
            revert_ms2 = False
        elif milestone == "MS2":
            revert_ms1 = False
            revert_ms2 = ms2_status == "Commercial Invoice Closed"
        else:
            revert_ms1 = ms1_status == "Commercial Invoice Closed"
            revert_ms2 = ms2_status == "Commercial Invoice Closed"

        if revert_ms1:
            updates["pic_status"] = "Commercial Invoice Submitted"
            updates["ms1_payment_received_date"] = None
        if revert_ms2:
            updates["pic_status_ms2"] = "Commercial Invoice Submitted"
            updates["ms2_payment_received_date"] = None

        if updates:
            frappe.db.set_value("PO Dispatch", pd_name, updates, update_modified=True)


@frappe.whitelist()
def get_work_done_attachments_for_dispatch(po_dispatch):
    """Return Frappe File attachments from all Work Done docs for a PO Dispatch."""
    po_dispatch = (po_dispatch or "").strip()
    if not po_dispatch:
        return []
    wd_names = frappe.db.get_all("Work Done", {"system_id": po_dispatch}, pluck="name")
    if not wd_names:
        return []
    return frappe.db.get_all(
        "File",
        filters={"attached_to_doctype": "Work Done", "attached_to_name": ["in", wd_names]},
        fields=["name", "file_name", "file_url", "file_size", "is_private", "creation"],
        order_by="creation asc",
    )


# A milestone that's already been invoiced can't be rejected — the other
# milestone on the same line is independent and may still be rejectable.
_REJECT_BLOCKED_STATUSES = {"Commercial Invoice Submitted", "Commercial Invoice Closed"}

@frappe.whitelist()
def reject_pic_line(po_dispatches, milestone="MS1", remark=None, im=None, new_status=None):
    """PIC rejects one or more lines for a given milestone.

    ``new_status`` is required and explicit — the PIC picks it (the frontend
    pre-fills the line's current status as a starting point, but nothing is
    auto-computed server-side). Can be any real pic_status option except
    the two invoiced ones (a reject can't manufacture an invoiced state).

    Marks a Work Done record 'PIC Rejected' so the IM sees it on their Work
    Done page and can resubmit — if no confirmed Work Done exists for this
    line (legacy/archive lines with no real execution history), one is
    created on the spot rather than silently doing nothing. Blocked once
    the target milestone has actually been invoiced (Commercial Invoice
    Submitted/Closed); the other milestone on the same line can still be
    rejected independently.

    ``im`` is only used to backfill PO Dispatch.im when a line has none —
    required in that case so there's someone to notify.
    """
    _pic_role_or_throw()
    new_status = (new_status or "").strip()
    if not new_status:
        frappe.throw("new_status is required")
    valid_statuses = [
        o for o in (frappe.get_meta("PO Dispatch").get_field("pic_status").options or "").split("\n")
        if o.strip()
    ]
    if new_status not in valid_statuses:
        frappe.throw(f"Invalid new_status: {new_status}")
    if new_status in _REJECT_BLOCKED_STATUSES:
        frappe.throw(f"Can't set the resulting status to {new_status} via reject.")
    if isinstance(po_dispatches, str):
        try:
            parsed = frappe.parse_json(po_dispatches)
            if isinstance(parsed, (list, tuple)):
                po_dispatches = parsed
        except Exception:
            po_dispatches = [po_dispatches]
    if not isinstance(po_dispatches, (list, tuple)) or not po_dispatches:
        frappe.throw("po_dispatches list is required")

    remark = (remark or "").strip()
    if not remark:
        frappe.throw("Rejection remark is required")

    milestone = str(milestone or "MS1").upper()
    if milestone == "MS2":
        status_field = "pic_status_ms2"
        closed_flag = "ms2_closed"
        # MS2 has no dedicated rejection-remark field like MS1's
        # pic_rejection_remark — reuse its general-purpose detail remark.
        remark_field = "pic_detail_remark_ms2"
    else:
        status_field = "pic_status"
        closed_flag = "ms1_closed"
        remark_field = "pic_rejection_remark"

    im = (im or "").strip() or None
    if im and not frappe.db.exists("IM Master", im):
        frappe.throw(f"Invalid IM: {im}")

    updated = []
    errors = []
    for name in po_dispatches:
        name = str(name or "").strip()
        if not name:
            continue
        if not frappe.db.exists("PO Dispatch", name):
            errors.append({"po_dispatch": name, "error": "Not found"})
            continue

        pd = frappe.db.get_value("PO Dispatch", name, ["im", "poid", status_field], as_dict=True)
        label = pd.get("poid") or name
        current_status = (pd.get(status_field) or "").strip()
        if current_status in _REJECT_BLOCKED_STATUSES:
            errors.append({
                "po_dispatch": name,
                "error": f"{label}: {milestone} is already {current_status} — can't reject an invoiced milestone.",
            })
            continue

        if not pd.get("im"):
            if not im:
                errors.append({"po_dispatch": name, "error": f"{label}: No IM assigned — pick an IM to notify before rejecting."})
                continue
            frappe.db.set_value("PO Dispatch", name, "im", im, update_modified=False)

        wd_docs = frappe.get_all(
            "Work Done",
            filters={"system_id": name, "submission_status": "Confirmation Done"},
            fields=["name"],
        )
        if wd_docs:
            for wd in wd_docs:
                frappe.db.set_value("Work Done", wd.name, "submission_status", "PIC Rejected", update_modified=True)
        else:
            # No confirmed Work Done to reject (legacy/archive line) —
            # create one now so the reject is a real, addressable record
            # the IM can find and resubmit, instead of a silent no-op.
            new_wd = frappe.new_doc("Work Done")
            new_wd.system_id = name
            new_wd.submission_status = "PIC Rejected"
            new_wd.source = "Direct Close"  # closest existing option; no real execution chain behind this
            new_wd.set(closed_flag, 1)
            new_wd.insert(ignore_permissions=True)

        frappe.db.set_value("PO Dispatch", name, status_field, new_status, update_modified=True)
        if frappe.db.has_column("PO Dispatch", remark_field):
            frappe.db.set_value("PO Dispatch", name, remark_field, remark, update_modified=False)
        updated.append({"po_dispatch": name, status_field: new_status})

    if updated:
        frappe.db.commit()
        try:
            from inet_app.api.notifications import notify_im_pic_rejected
            for u in updated:
                notify_im_pic_rejected(u["po_dispatch"])
        except Exception:
            pass

    return {
        "updated": updated,
        "errors": errors,
        "summary": {
            "total": len(po_dispatches),
            "updated_count": len(updated),
            "error_count": len(errors),
        },
    }


@frappe.whitelist()
def get_po_dispatch_im_attachments(po_dispatch):
    """Return IM file attachments for a PO Dispatch (uploaded by IM).
    Includes legacy im_attachment and the newer im_doc1/im_doc2 slots."""
    po_dispatch = (po_dispatch or "").strip()
    if not po_dispatch:
        return []
    return frappe.db.sql(
        """
        SELECT name, file_name, file_url, file_size, attached_to_field, creation
        FROM `tabFile`
        WHERE attached_to_doctype = 'PO Dispatch'
          AND attached_to_name = %s
          AND attached_to_field IN ('im_attachment', 'im_doc1', 'im_doc2', 'im_doc2a', 'im_doc2b', 'im_doc2c')
        ORDER BY attached_to_field, creation ASC
        """,
        po_dispatch,
        as_dict=True,
    )


@frappe.whitelist()
def get_po_dispatch_pic_attachments(po_dispatch):
    """Return PIC file attachments for a PO Dispatch (uploaded by PIC)."""
    _pic_role_or_throw()
    po_dispatch = (po_dispatch or "").strip()
    if not po_dispatch:
        return []
    return frappe.get_all(
        "File",
        filters={
            "attached_to_doctype": "PO Dispatch",
            "attached_to_name": po_dispatch,
            "attached_to_field": "pic_attachment",
        },
        fields=["name", "file_name", "file_url", "file_size", "creation"],
        order_by="creation desc",
    )
