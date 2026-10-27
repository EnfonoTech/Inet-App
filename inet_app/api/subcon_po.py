"""Subcon PO — the supplier side of the PIC's world.

Mirror image of ``pic.py``: where that module tracks what INET bills the
*customer* per POID milestone (Sales Invoice → Payment Entry →
"Commercial Invoice Closed"), this one tracks what INET owes the
*subcontractor* for the same milestone (Purchase Order → Purchase Invoice →
"Closed").

Key differences from the sales side, all deliberate:

* **The Purchase Order is printed and emailed to the subcontractor.** So the
  line rate written onto it is the subcontractor's own net rate
  (``pd.rate × payout_pct / 100``) — never the customer rate with the margin
  expressed as an ERPNext discount, which would disclose INET's markup. See
  ``_po_item_pricing`` for why ``price_list_rate`` is pinned equal to ``rate``.
* **Payment is Accounts' job, not PIC's.** PIC can close a milestone by hand
  (``bulk_update_subcon_po_status``) without any Payment Entry existing. The
  Payment Entry hooks still run when Accounts does link one, so the two sides
  agree whichever way round it happens.
* **A line's subcontractor is resolved, not stored.** ``pd.contract`` wins;
  failing that the Rollout Plan team's subcontractor, then ``backend_team``'s.
  Same COALESCE precedence ``pic.py`` already uses. Only ``type = 'SUB'``
  masters produce a supplier PO — INET-type contracts are own-crew work.
"""

from inet_app.roles import ADMIN_NOTIFY_ROLES, PM_LEVEL_ROLES
import frappe
from frappe.utils import add_days, cint, cstr, flt, getdate, nowdate
from inet_app.api.subcontractor_sync import (
    ALLOC_SHARE_SQL,
    ALLOC_TOTALS_JOIN_SQL,
    LAST_VISIT_SUBCONTRACTOR_SQL,
    deduction_sql,
    net_payout_sql,
    paid_out_sql,
)

from inet_app.api.command_center import (
    _ensure_list,
    _portal_filters_dict,
    _portal_row_limit,
    _sql_in_or_eq,
    _sql_like_pattern,
    excel_filter_clause,
    excel_options_from_query,
    _sql_limit_suffix,
    _sql_search_clause,
)
from inet_app.setup import ACCOUNTING_DUID_FIELDNAME
from inet_app.api.pic import (
    _TAX_RATE_FRACTION_SQL,
    _pic_role_or_throw,
    _write_pic_activity_log,
)


# ── Status vocabulary ────────────────────────────────────────────────────
# Blank is a real, meaningful value ("not ordered yet") exactly like
# pic_status's blank → "Work Not Done" convention, which is why the doctype
# Select options start with an empty line. Resetting a line to blank is what
# makes it orderable again after a cancelled PO.
SUB_PO_NOT_ORDERED = ""
# PIC's own readiness call — the purchase-side mirror of the sales side's
# "Ready for Invoice". Deliberately manual: none of the automatic signals that
# could have stood in for it are usable on this bench (subcon_submission_status
# is set on 8 of 1,672 SUB lines, and ms{1,2}_payment_received_date on 0 of
# 17,446 rows), and MS1's customer status is 'Commercial Invoice Closed' on 99%
# of lines, so deriving readiness from it would flag everything.
SUB_PO_READY = "Ready to Order"
SUB_PO_CREATED = "PO Created"
SUB_PO_SUBMITTED = "PO Submitted"
SUB_PO_BILL_RECEIVED = "Invoice Received"
SUB_PO_PI_SUBMITTED = "Purchase Invoice Submitted"
SUB_PO_CLOSED = "Closed"

SUB_PO_STATUSES = [
    SUB_PO_READY,
    SUB_PO_CREATED,
    SUB_PO_SUBMITTED,
    SUB_PO_BILL_RECEIVED,
    SUB_PO_PI_SUBMITTED,
    SUB_PO_CLOSED,
]

# There is deliberately NO subcon-side "cancelled" status. Cancellation is a
# property of the PO line itself, not of the supplier order: a killed line is
# already `dispatch_status = 'Cancelled'` / `pic_status = 'PO Line Canceled'`
# on the customer side (see _LINE_DEAD_SQL), and that is the single source of
# truth. Cancelling the supplier Purchase Order therefore doesn't mark the line
# "cancelled" — it means no order exists any more, so the milestone goes back
# to Not Ordered and becomes orderable again (see _reset_milestone).

# "PO Created" is a DRAFT Purchase Order — nothing has gone to the supplier
# yet, so the line still belongs on the To Order tab (with its draft linked, so
# PIC can go submit it) and only counts as Ordered once the PO is submitted.
_ORDERED_STATUSES = (SUB_PO_SUBMITTED,)
# From PIC's point of view the line is invoiced the moment the sub's bill is
# recorded — the Purchase Invoice sits in draft only because submitting it is
# Accounts' job, which is nothing to do with PIC's work being done. So the
# Invoiced tab covers both, and Close accepts either.
_INVOICED_STATUSES = (SUB_PO_BILL_RECEIVED, SUB_PO_PI_SUBMITTED)
_PENDING_ORDER_STATUSES = (SUB_PO_NOT_ORDERED, SUB_PO_READY, SUB_PO_CREATED)
_CLOSED_STATUSES = (SUB_PO_CLOSED,)
# A PO can be raised from either state. Marking "Ready to Order" is PIC telling
# themselves (or a colleague) which milestones to work next — it is NOT a hard
# prerequisite, so a straightforward line can still be ordered in one step
# without the extra click. Only the "Auto" create mode restricts itself to
# Ready milestones; see create_purchase_order_from_pic.
_CREATABLE_STATUSES = (SUB_PO_NOT_ORDERED, SUB_PO_READY)

# A supplier PO may only be raised for a milestone INET has already billed the
# customer for — the subcontractor is not committed to before the revenue side
# is invoiced. Gated per MILESTONE on its own customer status (pic_status for
# MS1, pic_status_ms2 for MS2), not on the line's rolled-up dispatch_status:
# a line at "Partially Closed" means MS1 is closed while MS2 may not even be
# worked yet, so a line-level test would leave those MS2 legs orderable.
_CUSTOMER_BILLED_STATUSES = ("Commercial Invoice Submitted", "Commercial Invoice Closed")

# There is deliberately no separate "closed without a PO" status — one "Closed"
# covers both a settled Purchase Order and the pre-launch backlog that was paid
# outside this system. The distinction is still reportable because it's
# derivable: a closed milestone with no Purchase Order document behind it was
# closed without one (see `closed_no_po` in subcon_payout_summary). That's why
# a manual close no longer fabricates a `sub_po_amount` — a stamped amount now
# means "a real PO said so", and closed-without-PO value falls back to the
# expected figure at report time instead.

# ── Derived line-level status ────────────────────────────────────────────
# One status per LINE, rolled up from the two milestone statuses, so PIC can
# see a line's overall position without reading both columns. Mirrors the
# "Partially X" idiom PO Dispatch.dispatch_status already uses (Partially
# Submitted / Partially Closed) rather than inventing a new vocabulary.
_SUB_PO_RANK = {
    SUB_PO_NOT_ORDERED: 0,
    SUB_PO_READY: 1,
    SUB_PO_CREATED: 2,
    SUB_PO_SUBMITTED: 3,
    SUB_PO_BILL_RECEIVED: 4,
    SUB_PO_PI_SUBMITTED: 5,
    SUB_PO_CLOSED: 6,
}
_SUB_PO_RANK_LABEL = {
    0: "Not Ordered",
    1: SUB_PO_READY,
    2: SUB_PO_CREATED,
    3: SUB_PO_SUBMITTED,
    4: SUB_PO_BILL_RECEIVED,
    5: SUB_PO_PI_SUBMITTED,
    6: SUB_PO_CLOSED,
}
# Values the derived column can take — the ladder above plus the mixed states.
# This is the ONLY status surfaced on the page; the two per-milestone columns
# were dropped in favour of it, so it has to be able to express any MS1/MS2
# combination on its own.
# Ladder order, each "Partially X" immediately before the full X it precedes.
# Must stay identical to the sub_po_status Select options in po_dispatch.json —
# the regression suite asserts that, because they silently drifted once.
SUB_PO_OVERALL_STATUSES = [
    "Not Ordered",
    "Partially Ready",
    SUB_PO_READY,
    "Partially Created",
    SUB_PO_CREATED,
    "Partially Ordered",
    SUB_PO_SUBMITTED,
    "Partially Invoiced",
    SUB_PO_BILL_RECEIVED,
    SUB_PO_PI_SUBMITTED,
    "Partially Closed",
    SUB_PO_CLOSED,
]


def _compute_overall_status(ms1_status, ms2_status, ms1_amount, ms2_amount):
    """Roll the two milestone statuses up into the single line status.

    The subcon mirror of _compute_dispatch_status_from_pic (pic.py), which does
    the same job for pic_status/pic_status_ms2 -> dispatch_status. Kept in Python
    and *stored* rather than derived in SQL so Desk list views, report builder,
    exports and the portal all read the same value from the same column.

    A milestone with no amount doesn't exist on the line and takes no part in
    the rollup — that's what stops a single-milestone line reading "Partially"
    anything. "" means the line has no milestone amounts at all.
    """
    legs = []
    if flt(ms1_amount or 0) > 0:
        legs.append((ms1_status or "").strip())
    if flt(ms2_amount or 0) > 0:
        legs.append((ms2_status or "").strip())
    if not legs:
        return ""

    ranks = [_SUB_PO_RANK.get(x, 0) for x in legs]
    lo, hi = min(ranks), max(ranks)
    if lo == hi:
        return _SUB_PO_RANK_LABEL[hi]

    # Mixed legs: name the stage the FURTHEST leg has actually reached, keyed off
    # the status constants so it can't drift from the ladder. Two cases were
    # wrong when this was a chain of ifs with a catch-all "Partially Ordered":
    #   * PO Created is a DRAFT purchase order — nothing has gone to the
    #     supplier and the line still sits on To Order — so it must not read as
    #     "Ordered". It gets its own "Partially Created".
    #   * Invoice Received is an INVOICED stage (it is in _INVOICED_STATUSES and
    #     drives the Invoiced tab), so it maps to "Partially Invoiced" rather
    #     than falling through to "Partially Ordered".
    return {
        _SUB_PO_RANK[SUB_PO_CLOSED]:        "Partially Closed",
        _SUB_PO_RANK[SUB_PO_PI_SUBMITTED]:  "Partially Invoiced",
        _SUB_PO_RANK[SUB_PO_BILL_RECEIVED]: "Partially Invoiced",
        _SUB_PO_RANK[SUB_PO_SUBMITTED]:     "Partially Ordered",
        _SUB_PO_RANK[SUB_PO_CREATED]:       "Partially Created",
        _SUB_PO_RANK[SUB_PO_READY]:         "Partially Ready",
    }.get(hi, "Partially Ordered")


def _sync_overall_status(pd_name):
    """Recompute and persist the rolled-up ``sub_po_status`` for one line.

    Called after every milestone-status write in this module. Writes only on an
    actual change so it doesn't churn ``modified`` on no-ops.

    CONTRACT: any code that writes ``sub_po_status_ms1`` / ``sub_po_status_ms2`` with
    a raw ``frappe.db.set_value`` (a patch, a console fix) must call this after,
    or the stored rollup goes stale. Document saves are covered automatically by
    ``set_overall_status`` on PO Dispatch's validate hook; only bypassing the ORM
    skips it. This is the same trade-off ``dispatch_status`` already carries.
    """
    row = frappe.db.get_value(
        "PO Dispatch", pd_name,
        ["sub_po_status_ms1", "sub_po_status_ms2", "ms1_amount", "ms2_amount",
         "sub_po_status"],
        as_dict=True,
    )
    if not row:
        return None
    want = _compute_overall_status(row.sub_po_status_ms1, row.sub_po_status_ms2,
                                  row.ms1_amount, row.ms2_amount)
    if (row.sub_po_status or "") != want:
        frappe.db.set_value("PO Dispatch", pd_name, "sub_po_status", want,
                            update_modified=False)
    return want


def set_overall_status(doc, method=None):
    """PO Dispatch validate hook — keeps the stored rollup right for any save,
    including a hand edit in Desk that never goes through this module.

    Runs after the doctype's own validate, so ms1_amount / ms2_amount have
    already been recomputed by PODispatch._compute_ms_amounts.
    """
    doc.sub_po_status = _compute_overall_status(
        doc.get("sub_po_status_ms1"), doc.get("sub_po_status_ms2"),
        doc.get("ms1_amount"), doc.get("ms2_amount"),
    )


def _status_field(milestone):
    return "sub_po_status_ms1" if milestone == "MS1" else "sub_po_status_ms2"


def _pic_status_field(milestone):
    """The CUSTOMER-side status field for a milestone (pic.py's vocabulary)."""
    return "pic_status" if milestone == "MS1" else "pic_status_ms2"


def _customer_billed_ms_sql(n):
    """Has INET invoiced the customer for this milestone yet."""
    col = "pd.pic_status" if n == 1 else "pd.pic_status_ms2"
    return _in_list_sql(f"IFNULL({col}, '')", _CUSTOMER_BILLED_STATUSES)


def _ms_num(milestone):
    return 1 if milestone == "MS1" else 2


def _norm_milestone(raw, default=None):
    ms = (raw or "").strip().upper()
    if not ms:
        return default
    if ms not in ("MS1", "MS2"):
        frappe.throw("milestone must be MS1 or MS2")
    return ms


# A payout deduction's Paid Out bill to a third party carries the line's
# `poid` — it is the POID accounting dimension, so the cost lands on the line
# in the ledger — but it is NOT the subcontractor's bill. Its items are marked
# by `payout_deduction`, and every reader of subcontractor bills by POID must
# exclude them with this, or the third party's bill passes as the
# subcontractor's: in the tracker's bill column, the popup, the re-rate guard.
# The status hooks need no SQL — they also require a milestone, which these
# items never carry — but _purchase_doc_lines checks the mark as well.
def not_deduction_bill_sql(alias):
    return f"IFNULL({alias}.payout_deduction, '') = ''"


# ── SQL fragments ────────────────────────────────────────────────────────
# One `sm` alias, because a line resolves to exactly one Subcontract Master.
# NULLIF on pd.contract matters: the column is '' rather than NULL on plenty
# of imported rows, and '' would win a bare COALESCE and defeat the fallback.
_SUBCON_FROM_JOIN = f"""
FROM `tabPO Dispatch` pd
LEFT JOIN `tabIM Master` imm ON imm.name = pd.im
LEFT JOIN `tabProject Control Center` proj ON proj.name = pd.project_code
LEFT JOIN (
{LAST_VISIT_SUBCONTRACTOR_SQL}) plan_sub ON plan_sub.po_dispatch = pd.name
LEFT JOIN `tabINET Team` bt ON bt.name = pd.backend_team
LEFT JOIN `tabPO Subcontract Allocation` alloc
       ON alloc.parent = pd.name
      AND alloc.parenttype = 'PO Dispatch'
      AND alloc.parentfield = 'subcontract_allocations'
LEFT JOIN `tabSubcontract Master` sm
       ON sm.name = COALESCE(
            NULLIF(alloc.subcontractor, ''),
            NULLIF(pd.contract, ''), plan_sub.subcontractor, bt.subcontractor)
LEFT JOIN `tabSupplier` sup ON sup.name = sm.supplier
-- Quantity already on live supplier POs, per milestone. Joined once rather
-- than looked up per row: as a correlated subquery the To Order tab took
-- 25.7s, because the stage predicate runs for every dispatch line.
LEFT JOIN (SELECT poi_q.poid AS poid, UPPER(IFNULL(poi_q.milestone, '')) AS ms,
                  SUM(IFNULL(poi_q.qty, 0)) AS qty
             FROM `tabPurchase Order Item` poi_q
             JOIN `tabPurchase Order` po_q ON po_q.name = poi_q.parent
                  AND po_q.docstatus < 2
            GROUP BY poi_q.poid, UPPER(IFNULL(poi_q.milestone, ''))) oq1
       ON oq1.poid = pd.name AND oq1.ms = 'MS1'
LEFT JOIN (SELECT poi_r.poid AS poid, UPPER(IFNULL(poi_r.milestone, '')) AS ms,
                  SUM(IFNULL(poi_r.qty, 0)) AS qty
             FROM `tabPurchase Order Item` poi_r
             JOIN `tabPurchase Order` po_r ON po_r.name = poi_r.parent
                  AND po_r.docstatus < 2
            GROUP BY poi_r.poid, UPPER(IFNULL(poi_r.milestone, ''))) oq2
       ON oq2.poid = pd.name AND oq2.ms = 'MS2'
{ALLOC_TOTALS_JOIN_SQL}
"""

# A line split across subcontractors produces ONE ROW PER SUPPLIER through the
# join above, and each row must carry only that supplier's share of the money —
# otherwise two rows worth the whole line would double the payout in every
# total built on this join. Shared with pic.py and command_center.py so the
# four reports that split INET from SUB money all divide it the same way.
_ALLOC_SHARE_SQL = ALLOC_SHARE_SQL


def _ms_amount_sql(n):
    """Milestone ``n``'s amount for THIS allocation, not the whole line."""
    return f"ROUND(IFNULL(pd.ms{n}_amount, 0) * {_ALLOC_SHARE_SQL}, 4)"

# Only SUB-type contracts get a supplier PO. INET-type contracts are INET's
# own crews (100% margin / 0% payout) and never produce one, which is why
# this is part of the base WHERE rather than a user-facing filter.
_SUBCON_BASE_WHERE = [
    "IFNULL(pd.is_internal_work, 0) = 0",
    "IFNULL(pd.is_dummy_po, 0) = 0",
    "sm.name IS NOT NULL",
    "IFNULL(sm.type, '') = 'SUB'",
]


def _ms_status_sql(n):
    col = "pd.sub_po_status_ms1" if n == 1 else "pd.sub_po_status_ms2"
    return f"IFNULL({col}, '')"


def _expected_payout_sql(n):
    """Live payout for a milestone from the master % — what the PO *would* be.

    Distinct from the stamped ``sub_po_amount_ms{n}``, which is what an
    already-created PO actually says. Both are returned so the tracker can
    show "expected" on unordered lines and the real document figure on
    ordered ones, and so a later edit to ``sub_payout_pct`` can never appear
    to rewrite an issued PO.

    Net of the line's payout deductions (see ``net_payout_sql``); a line with
    none is exactly ``amount × %`` as before.
    """
    return f"ROUND({net_payout_sql(_ms_amount_sql(n), 'IFNULL(sm.sub_payout_pct, 0)', n)}, 2)"


def _gross_payout_sql(n):
    """The payout before any deduction — the "before" of before → after."""
    return f"ROUND({_ms_amount_sql(n)} * IFNULL(sm.sub_payout_pct, 0) / 100, 2)"


def _deduction_state_sql():
    from inet_app.api.payout_deduction import deduction_state_sql
    return deduction_state_sql()


def _deduction_total_sql():
    """Every deduction on this supplier's leg, both milestones, any kind."""
    return f"ROUND({deduction_sql(1, 'all')} + {deduction_sql(2, 'all')}, 2)"


def _payout_shown_sql(n):
    """The payout figure the UI actually shows: the issued PO's amount when
    there is one, the expected figure from the master % otherwise."""
    return f"COALESCE(NULLIF(pd.sub_po_amount_ms{n}, 0), {_expected_payout_sql(n)})"


# ── When a payout is incurred, and for how much ──────────────────────────
#
# The subcontractor is owed for a milestone once INET has invoiced the
# customer for it. "When" therefore means the customer invoice's own date,
# and the authoritative source for that is the Sales Invoice itself —
# `Sales Invoice Item` carries both `poid` and `milestone`, so the link is
# exact. Reading the document rather than the date copied onto PO Dispatch
# matters for two reasons: a cancelled invoice simply stops being a row here
# (no reversal logic to get wrong), and a milestone invoiced in parts gives
# one row per part, on its own date, for its own share.
#
# One row per PART, not per milestone, is the point. A 3-qty line billed 2
# now and 1 next month is two Sales Invoice Items against the same MS1, and
# each must carry its own date and its own slice of the payout. Scaling by
# `sii.amount / pd.msN_amount` does that: the fractions sum to 1 across the
# parts, so the milestone's whole payout lands, spread over the dates it was
# actually invoiced on.
#
# The fraction divides by the FULL milestone amount, never by
# `_ms_amount_sql(n)` (this allocation's share of it): the customer invoice
# line is the whole milestone, while the payout being scaled is already this
# supplier's own slice. Dividing both by the share would square it.
# The date chain and the "already invoiced" test live on the customer side,
# in pic.py, and are imported rather than restated here — the payout and the
# revenue it comes out of must agree about when a milestone was invoiced.
from inet_app.api.pic import (  # noqa: E402
    submitted_invoice_exists_sql as _submitted_invoice_exists_sql,
)
# The imported rungs of the invoiced ladder, shared with the PIC pages rather
# than restated here. This leg used to read a local copy that still put the
# month BUCKET above the real IBUY invoice date, so the Command Dashboard's
# subcontractor figures placed 3,666 of 4,137 legacy events on the 1st of
# their month while the PIC pages placed the same events on the day they were
# actually billed. Monthly totals agreed; any day-level range did not.
from inet_app.api.event_dates import (  # noqa: E402
    legacy_customer_invoiced_date as _legacy_invoiced_date,
)


def subcon_invoice_window(pf):
    """``(sql, params)`` restricting to lines with a payout event in a
    customer-invoice date window — the window the Command Dashboard's
    Sub-Con figures are built on.

    Deliberately separate from ``_supplier_po_date_filter``, which filters on
    the SUPPLIER PO date. They answer different questions and a page can
    carry either; this one is what a drill-through from the dashboard passes,
    so the page it lands on counts the same money the tile did.
    """
    frm = (pf or {}).get("invoice_from_date")
    to = (pf or {}).get("invoice_to_date")
    if not frm and not to:
        return "", []
    conds = ["ev_w.po_dispatch = pd.name", "ev_w.subcontract = sm.name"]
    params = []
    if frm:
        conds.append("ev_w.event_date >= %s")
        params.append(frm)
    if to:
        conds.append("ev_w.event_date <= %s")
        params.append(to)
    return (
        f"EXISTS (SELECT 1 FROM ({subcon_payout_events_sql()}) ev_w"
        f" WHERE {' AND '.join(conds)})",
        params,
    )


def subcon_payout_events_sql():
    """``(po_dispatch, subcontract, milestone, event_date, revenue, payout,
    inet_margin, paid_out)``, one row per payout event, as a UNION ALL subquery.

    ``paid_out`` is payout deductions Paid Out to a third party on the same
    slice — money that leaves the company for the work but is not the
    subcontractor's payout. ``inet_margin`` is already net of it.

    All three money columns come out of the same row so a caller cannot put
    revenue in one period and its own cost in another — the mismatch that
    made the old revenue-dated expense impossible to reconcile.

    Two legs per milestone:

    * **Invoiced** — one row per submitted Sales Invoice Item, dated by that
      invoice's ``posting_date`` and carrying its proportional share of the
      payout. This is the only leg new work can ever land in.
    * **Legacy** — a milestone whose PIC status says it was billed but which
      has no submitted Sales Invoice behind it, because it was invoiced
      before the portal raised invoices. Dated by whatever the Master Tracker
      import left, and worth the whole milestone payout. On the production
      copy this is ~91% of billed subcontracted milestones today and shrinks
      to nothing on its own as new work flows through the invoice.

    The two legs cannot overlap: the legacy leg requires that no submitted
    invoice exists for that milestone.

    `event_date` can be NULL on the legacy leg — a milestone the sheet left
    undated. Those rows are deliberately kept rather than dropped, so a
    caller can count what it cannot place in time instead of silently
    losing it.
    """
    legs = []
    for n in (1, 2):
        ms_full = f"IFNULL(pd.ms{n}_amount, 0)"
        legs.append(f"""
        SELECT pd.name AS po_dispatch, sm.name AS subcontract, 'MS{n}' AS milestone,
               si.posting_date AS event_date,
               ROUND(IFNULL(sii.amount, 0) * ({_ALLOC_SHARE_SQL}), 4) AS revenue,
               ROUND({_payout_shown_sql(n)} * (IFNULL(sii.amount, 0) / NULLIF({ms_full}, 0)), 4) AS payout,
               ROUND({_inet_amount_sql(n)} * (IFNULL(sii.amount, 0) / NULLIF({ms_full}, 0)), 4) AS inet_margin,
               ROUND({paid_out_sql(n, f"IFNULL(sii.amount, 0) / NULLIF({ms_full}, 0)")}, 4) AS paid_out
        {_SUBCON_FROM_JOIN}
        JOIN `tabSales Invoice Item` sii
              ON sii.poid = pd.name AND IFNULL(sii.milestone, '') = 'MS{n}'
        JOIN `tabSales Invoice` si ON si.name = sii.parent AND si.docstatus = 1
        WHERE {' AND '.join(_SUBCON_BASE_WHERE)}
        """)
        legs.append(f"""
        SELECT pd.name AS po_dispatch, sm.name AS subcontract, 'MS{n}' AS milestone,
               {_legacy_invoiced_date(n)} AS event_date,
               {_ms_amount_sql(n)} AS revenue,
               {_payout_shown_sql(n)} AS payout,
               {_inet_amount_sql(n)} AS inet_margin,
               ROUND({paid_out_sql(n)}, 4) AS paid_out
        {_SUBCON_FROM_JOIN}
        WHERE {' AND '.join(_SUBCON_BASE_WHERE)}
          AND {_customer_billed_ms_sql(n)}
          AND NOT {_submitted_invoice_exists_sql(n)}
        """)
    return " UNION ALL ".join(legs)


def _inet_amount_sql(n):
    """INET's own share of the milestone — the margin it keeps.

    Same expression pic_invoicing_summary already uses for its `inet_amt`
    (ms_amount x inet_margin_pct / 100), so the customer-side and supplier-side
    reports state INET's margin identically instead of two near-miss formulas.

    A payout deduction moves it twice: what the subcontractor is no longer
    paid comes back to the margin, and a deduction Paid Out to a third party
    leaves it. Retained, 880 at 80% less 100: 176 + 80 = 256. Paid Out:
    176 + 80 − 100 = 156. With no deduction rows both terms are zero.
    """
    return (f"ROUND({_ms_amount_sql(n)} * COALESCE(sm.inet_margin_pct, 0) / 100"
            f" + ({_gross_payout_sql(n)} - {_expected_payout_sql(n)})"
            f" - {deduction_sql(n, 'paid')}, 2)")


def _vat_sql(n):
    """VAT on that payout, derived from PO Dispatch.tax_rate.

    tax_rate is free text ("15%", "0.15", blank), so it goes through the same
    normaliser the sales side uses (_TAX_RATE_FRACTION_SQL in pic.py) instead of
    a second, subtly different parser here. Blank falls back to the standard
    15% KSA rate, same as there.
    """
    frac = _TAX_RATE_FRACTION_SQL.format(col="pd.tax_rate")
    return f"ROUND({_payout_shown_sql(n)} * ({frac}), 2)"


# A customer line that's been cancelled isn't going to be executed or paid, so
# it must not be orderable — but it stays visible in the other tabs if a PO was
# already raised against it, so nothing disappears on PIC mid-flow.
_LINE_DEAD_SQL = (
    "(IFNULL(pd.dispatch_status,'') = 'Cancelled'"
    " OR IFNULL(pd.pic_status,'') = 'PO Line Canceled'"
    " OR IFNULL(pd.pic_status_ms2,'') = 'PO Line Canceled')"
)


def _orderable_ms_sql(n):
    """Can a PO actually be RAISED for this milestone right now.

    Stricter than the To Order tab's membership below: a milestone already
    sitting on a draft PO ("PO Created") still shows on that tab so PIC can go
    submit it, but must not be selectable for a second PO. This drives the
    ``can_order_ms1`` / ``can_order_ms2`` flags the FE gates its action on.
    """
    return (f"(IFNULL(pd.ms{n}_amount, 0) > 0 AND "
            f"{_customer_billed_ms_sql(n)} AND "
            f"{_in_list_sql(_ms_status_sql(n), _CREATABLE_STATUSES)})")


def _ready_ms_sql(n):
    """PIC has explicitly marked this milestone ready to order.

    The purchase-side counterpart of ``pic_status = 'Ready for Invoice'``, and
    what the "Auto" create mode selects on — the same way
    create_sales_invoice_from_pic picks up every Ready milestone when no
    milestone is named.
    """
    return (f"(IFNULL(pd.ms{n}_amount, 0) > 0 AND {_customer_billed_ms_sql(n)} "
            f"AND {_ms_status_sql(n)} = '{SUB_PO_READY}')")


def _ordered_qty_ms_sql(n):
    """Quantity already on live supplier POs for this milestone.

    Reads the oq1 / oq2 joins in _SUBCON_FROM_JOIN.
    """
    return f"IFNULL(oq{n}.qty, 0)"


def _entitled_qty_ms_sql(n):
    """Quantity this milestone may be ordered in total, for this supplier."""
    return (
        f"(IFNULL(NULLIF(alloc.qty, 0), IFNULL(pd.qty, 0))"
        f" * IFNULL(pd.ms{n}_pct, 0) / 100)"
    )


def _awaiting_order_ms_sql(n):
    """Belongs on the To Order tab: not ordered, ordered but still a draft, or
    PART ordered.

    The quantity clause is what lets a line come back. A PO consumes a
    QUANTITY, not the whole milestone: order 2 of a 3-qty line, or correct a
    PO downwards, and the rest still has to be orderable. Status alone said
    "PO Submitted" and the line vanished from this tab with work left on it,
    so there was no way to reach it short of cancelling the supplier's PO.
    """
    return (f"(IFNULL(pd.ms{n}_amount, 0) > 0 AND "
            f"{_customer_billed_ms_sql(n)} AND "
            f"({_in_list_sql(_ms_status_sql(n), _PENDING_ORDER_STATUSES)}"
            f" OR {_ordered_qty_ms_sql(n)} < {_entitled_qty_ms_sql(n)} - 0.0001))")


def _in_list_sql(expr, values):
    ph = ", ".join([f"'{v}'" for v in values])  # fixed vocabulary, not user input
    return f"{expr} IN ({ph})"


# Stages are per-*milestone* predicates ORed across MS1/MS2, so they are
# deliberately NOT mutually exclusive: a line whose MS1 is paid while its MS2
# is still unordered belongs in BOTH "closed" and "to_order", and PIC needs to
# see it in To Order to raise the MS2 order at all. This is the one structural
# difference from pic.py's MECE `_PIC_STAGE_SQL`.
_SUBCON_STAGE_SQL = {
    "to_order": f"(({_awaiting_order_ms_sql(1)} OR {_awaiting_order_ms_sql(2)}) AND NOT {_LINE_DEAD_SQL})",
    "ordered": (
        f"({_in_list_sql(_ms_status_sql(1), _ORDERED_STATUSES)}"
        f" OR {_in_list_sql(_ms_status_sql(2), _ORDERED_STATUSES)})"
    ),
    "invoiced": (
        f"({_in_list_sql(_ms_status_sql(1), _INVOICED_STATUSES)}"
        f" OR {_in_list_sql(_ms_status_sql(2), _INVOICED_STATUSES)})"
    ),
    "closed": (
        f"({_in_list_sql(_ms_status_sql(1), _CLOSED_STATUSES)}"
        f" OR {_in_list_sql(_ms_status_sql(2), _CLOSED_STATUSES)})"
    ),
    # No "cancelled" stage: there is no subcon-side cancellation. A line killed
    # on the customer side is excluded from To Order by _LINE_DEAD_SQL but stays
    # visible in the other stages if a PO was already raised against it, with
    # its red "Cancelled" dispatch_status badge showing why — so PIC can still
    # find it and pull the supplier PO back.
    "all": "1=1",
}


# ── Linked-document lookups (derived, never stored) ──────────────────────
# The sales side deliberately doesn't store the Sales Invoice name on
# PO Dispatch either (see _batch_linked_invoices in pic.py) — deriving it
# means a Desk-side cancel or delete can't leave a stale pointer behind.
def _batch_linked_purchase_docs(po_dispatch_names):
    """Return {po_dispatch: {"po": "...csv", "pi": "...csv"}}.

    Batched, not folded into the caller's SELECT, so a POID with two POs
    can't multiply the caller's rows.

    Cancelled documents are deliberately included (labelled "Cancelled")
    rather than filtered out. PIC's manual close wins over the document hooks
    by design, so a line can legitimately sit at "Closed" with a
    cancelled PO behind it — hiding docstatus 2 here would erase the only
    trace of that from the tracker. The duplicate guard in
    _existing_purchase_orders_by_milestone still ignores cancelled POs, since
    those must not block re-ordering.
    """
    names = list({n for n in (po_dispatch_names or []) if n})
    out = {}
    if not names:
        return out

    for key, child_dt, parent_dt in (
        ("po", "Purchase Order Item", "Purchase Order"),
        ("pi", "Purchase Invoice Item", "Purchase Invoice"),
    ):
        if not frappe.db.has_column(child_dt, "poid"):
            continue
        _bill_filter = (f" AND {not_deduction_bill_sql('c')}"
                        if frappe.db.has_column(child_dt, "payout_deduction") else "")
        for chunk in _chunk(names, 800):
            ph = ", ".join(["%s"] * len(chunk))
            rows = frappe.db.sql(
                f"""
                SELECT c.poid AS po_dispatch,
                       GROUP_CONCAT(DISTINCT CONCAT(
                         p.name, '|', UPPER(IFNULL(c.milestone, '')), '|',
                         CASE WHEN p.docstatus = 1 THEN 'Submitted'
                              WHEN p.docstatus = 0 THEN 'Draft'
                              WHEN p.docstatus = 2 THEN 'Cancelled' ELSE '?' END,
                         '|', TRIM(TRAILING '.' FROM TRIM(TRAILING '0'
                              FROM CAST(IFNULL(c.qty, 0) AS CHAR))))
                         ORDER BY p.name SEPARATOR ', ') AS csv
                FROM `tab{child_dt}` c
                JOIN `tab{parent_dt}` p ON p.name = c.parent
                WHERE c.poid IN ({ph}){_bill_filter}
                GROUP BY c.poid
                """,
                tuple(chunk),
                as_dict=True,
            )
            for r in rows:
                out.setdefault(r["po_dispatch"], {})[key] = r["csv"]
    return out


def _ordered_qty_by_milestone(poids):
    """``{(poid, "MS1"|"MS2", subcontract): qty_already_on_live_POs}``.

    What the duplicate guard actually needs. A PO does not consume a
    milestone, it consumes a QUANTITY of it: order 2 of a 3-qty line's MS1
    and the remaining 1 still has to be orderable, which the old "a PO
    exists, so refuse" rule made impossible. A milestone is only closed to
    new orders once the quantity on its live POs reaches what it is entitled
    to.

    Cancelled POs (docstatus 2) do not count — cancelling is how you free a
    quantity up again.
    """
    names = list({n for n in (poids or []) if n})
    out = {}
    if not names or not frappe.db.has_column("Purchase Order Item", "poid"):
        return out
    for chunk in _chunk(names, 800):
        ph = ", ".join(["%s"] * len(chunk))
        rows = frappe.db.sql(
            f"""
            SELECT poi.poid AS poid, UPPER(IFNULL(poi.milestone, '')) AS milestone,
                   IFNULL(poi.subcontract, '') AS subcontract,
                   SUM(IFNULL(poi.qty, 0)) AS qty
            FROM `tabPurchase Order Item` poi
            JOIN `tabPurchase Order` po ON po.name = poi.parent
            WHERE poi.poid IN ({ph}) AND po.docstatus < 2
            GROUP BY poi.poid, UPPER(IFNULL(poi.milestone, '')),
                     IFNULL(poi.subcontract, '')
            """,
            tuple(chunk), as_dict=True,
        )
        for r in rows:
            out[(r["poid"], r["milestone"], r["subcontract"])] = flt(r["qty"])
    return out


def entitled_po_qty(pd_row, milestone):
    """How much of this milestone this supplier may be ordered, in total.

    The same figure _po_item_pricing builds a PO line from: this supplier's
    own allocated quantity, scaled by the milestone percentage.
    """
    n = _ms_num(milestone)
    full_qty = flt(pd_row.get("alloc_qty") or 0) or flt(pd_row.get("qty") or 0)
    return flt(full_qty) * flt(pd_row.get(f"ms{n}_pct") or 0) / 100.0


def _existing_purchase_orders_by_milestone(poids, include_submitted=True):
    """Return {(poid, "MS1"|"MS2", subcontract): "PO-0001 (Draft)"} for live POs.

    The duplicate guard for PO creation. A legacy/hand-made line with no
    ``milestone`` tag can't be attributed to one milestone, so it
    conservatively blocks BOTH — same reasoning as
    ``_batch_draft_invoices_by_milestone`` on the sales side.

    Keyed by SUBCONTRACT as well as milestone. A line worked by two
    subcontractors needs one PO each, and keying on (poid, milestone) alone
    made the first PO block the second — the one hard blocker that stopped a
    split line being ordered at all. A row whose ``subcontract`` is blank
    (legacy, or a PO raised before the field existed) blocks every supplier on
    that milestone, which is the same conservative stance the blank-milestone
    case already takes.
    """
    names = list({n for n in (poids or []) if n})
    out = {}
    if not names or not frappe.db.has_column("Purchase Order Item", "poid"):
        return out
    docstatus_clause = "po.docstatus < 2" if include_submitted else "po.docstatus = 0"
    for chunk in _chunk(names, 800):
        ph = ", ".join(["%s"] * len(chunk))
        rows = frappe.db.sql(
            f"""
            SELECT poi.poid AS poid, UPPER(IFNULL(poi.milestone, '')) AS milestone,
                   IFNULL(poi.subcontract, '') AS subcontract,
                   po.name AS po_name, po.docstatus AS docstatus
            FROM `tabPurchase Order Item` poi
            JOIN `tabPurchase Order` po ON po.name = poi.parent
            WHERE {docstatus_clause} AND poi.poid IN ({ph})
            """,
            tuple(chunk),
            as_dict=True,
        )
        for r in rows:
            label = f"{r['po_name']} ({'Submitted' if cint(r['docstatus']) == 1 else 'Draft'})"
            ms = r["milestone"]
            # "" is the wildcard: a PO line that never recorded its
            # subcontract blocks all of them, since there is no way to tell
            # which supplier it already covers.
            sub = r["subcontract"]
            for key in ((ms,) if ms in ("MS1", "MS2") else ("MS1", "MS2")):
                out.setdefault((r["poid"], key, sub), label)
    return out


def _po_exists_for(dupes, po_dispatch, milestone, subcontract):
    """True when ``dupes`` already covers this line + milestone + supplier.

    A blank-subcontract PO line blocks every supplier, so both the exact key
    and the wildcard are checked.
    """
    return (
        (po_dispatch, milestone, cstr(subcontract or "")) in dupes
        or (po_dispatch, milestone, "") in dupes
    )


def _chunk(items, size=800):
    """Bound every IN (...) built from a row set that "All" can make unbounded.

    frappe/MariaDB blow up (SQLParseError: Maximum number of tokens exceeded)
    somewhere past ~10k values in one clause — see the _chunked() note in
    command_center.py.
    """
    items = list(items)
    for i in range(0, len(items), size):
        yield items[i:i + size]


# ── Subcontractor resolution ─────────────────────────────────────────────
def _batch_resolve_subcontracts(po_dispatch_names):
    """Return {pd_name: {contract + payout fields + milestone amounts}}.

    Batched on purpose. Both bulk paths here — creating POs for a large
    selection and closing the pre-launch backlog — run over up to the whole
    1.6k-line SUB population, and resolving the subcontractor one line at a
    time would mean a Rollout Plan aggregate query per line. This resolves
    every line in one query per chunk using the exact same join and COALESCE
    precedence as ``_SUBCON_FROM_JOIN``, so what the create endpoints
    validate is always what the list query showed.
    """
    names = list({n for n in (po_dispatch_names or []) if n})
    out = {}
    if not names:
        return out
    for chunk in _chunk(names, 800):
        ph = ", ".join(["%s"] * len(chunk))
        rows = frappe.db.sql(
            f"""
            SELECT pd.name AS po_dispatch, pd.poid, pd.item_code, pd.item_description,
                   pd.qty, pd.rate, pd.line_amount,
                   pd.project_code, pd.site_code, pd.site_name,
                   pd.ms1_pct, pd.ms2_pct, pd.ms1_amount, pd.ms2_amount,
                   pd.is_internal_work, pd.is_dummy_po, pd.dispatch_status,
                   pd.sub_po_status_ms1, pd.sub_po_status_ms2,
                   pd.pic_status, pd.pic_status_ms2,
                   pd.sub_po_amount_ms1, pd.sub_po_amount_ms2,
                   sm.name AS subcontract, sm.type AS contract_type,
                   sm.supplier, sm.sub_payout_pct, sm.contract_model, sm.status AS contract_status,
                   -- The supplier's OWN share of the line. Without it the PO
                   -- was raised for the whole line quantity: 121 units ordered
                   -- from a subcontractor who did 50 of them.
                   alloc.qty AS alloc_qty,
                   (SELECT COUNT(*) FROM `tabPO Subcontract Allocation` a2
                     WHERE a2.parent = pd.name AND a2.parenttype = 'PO Dispatch') AS alloc_count
            {_SUBCON_FROM_JOIN}
            WHERE pd.name IN ({ph})
            -- A split line yields one row per supplier here, and only one of
            -- them survives into the dict below. Ordering puts the PAYABLE one
            -- last so it wins: an INET contract never gets a supplier PO, so
            -- letting row order decide meant the PO sometimes resolved to the
            -- in-house leg and the line was skipped as "INET-type contract".
            ORDER BY CASE WHEN IFNULL(sm.type,'') = 'SUB' THEN 1 ELSE 0 END,
                     IFNULL(alloc.qty, 0)
            """,
            tuple(chunk),
            as_dict=True,
        )
        for r in rows:
            out[r["po_dispatch"]] = r
    return out


# ── List endpoint ────────────────────────────────────────────────────────
def _supplier_po_date_filter(pf):
    """``(sql, params)`` restricting lines to a SUPPLIER PO raised in the range.

    This page is about what is owed to subcontractors, so its date range is
    the date the PO went to the supplier — ``sub_po_date_ms1`` /
    ``sub_po_date_ms2``, which ``create_purchase_order_from_pic`` stamps from
    the Purchase Order it just made. Audited on the production copy: all 188
    MS1 and 63 MS2 stamps equal their Purchase Order's ``transaction_date``,
    none differ, none missing, and no stamp exists without a PO line behind
    it — so this reads the stamp rather than joining back to the PO.

    It used to filter ``ms1_applied_date``: when PIC applied MS1 to the
    CUSTOMER. That is a sales date on a purchase page, and it is blank on 37%
    of lines, so any range silently dropped 8,282 of them.

    Per milestone, not per line. A range must CONTAIN one milestone's PO date;
    OR'ing the bounds separately would match a line whose MS1 satisfied
    "from" and whose MS2 satisfied "to" while neither PO fell in the range.

    A line with no supplier PO has no PO date and therefore cannot be in any
    range — so the To Order tab comes back empty once a range is set. That is
    the honest answer to "which lines were ordered in this period", not a bug.
    """
    frm, to = pf.get("from_date"), pf.get("to_date")
    if not (frm or to):
        return None, []
    arms, params = [], []
    for col in ("sub_po_date_ms1", "sub_po_date_ms2"):
        conds = [f"pd.{col} IS NOT NULL"]
        if frm:
            conds.append(f"pd.{col} >= %s")
            params.append(frm)
        if to:
            conds.append(f"pd.{col} <= %s")
            params.append(to)
        arms.append("(" + " AND ".join(conds) + ")")
    return "(" + " OR ".join(arms) + ")", params


@frappe.whitelist()
def list_subcon_po_rows(stage=None, portal_filters=None, limit=500, _options=None, _summary=None):
    """PO Dispatch lines that resolve to a SUB subcontractor, per stage.

    ``stage``: to_order / ordered / invoiced / closed / all —
    the tabs of the Subcon PO page. See ``_SUBCON_STAGE_SQL``; unlike the
    sales-side stages these overlap on purpose.
    ``portal_filters``: search, project_code, site_code, im, subcontract,
    contract_model, supplier, sub_po_status_ms1 (multi, "__NONE__" for blank),
    pic_status (multi), from_date / to_date (against the SUPPLIER PO date — see
    ``_supplier_po_date_filter``),
    column_filters (per-column Manage Table filters).
    ``limit``: 0 = unlimited (see _portal_row_limit).
    """
    _pic_role_or_throw()
    stage = (stage or "to_order").strip()
    if stage not in _SUBCON_STAGE_SQL:
        frappe.throw(f"stage must be one of {sorted(_SUBCON_STAGE_SQL)}, got {stage!r}")

    pf = _portal_filters_dict(portal_filters)
    limit_page_length = _portal_row_limit(limit, 500)

    where = ["1=1"] + list(_SUBCON_BASE_WHERE) + [_SUBCON_STAGE_SQL[stage]]
    params = []

    for col, key in (
        ("pd.project_code", "project_code"),
        ("pd.site_code", "site_code"),
        ("pd.im", "im"),
        ("sm.name", "subcontract"),
        ("sm.contract_model", "contract_model"),
        ("sm.supplier", "supplier"),
    ):
        c, p = _sql_in_or_eq(col, pf.get(key))
        if c:
            where.append(c)
            params.extend(p)

    # Purchase-side status filter, matched against EITHER milestone so a
    # single selection ("Closed") finds lines closed on either leg.
    status_vals = _ensure_list(pf.get("sub_po_status"))
    if status_vals:
        wants_none = "__NONE__" in status_vals
        real = [v for v in status_vals if v != "__NONE__"]
        parts = []
        if wants_none:
            parts.append(f"({_ms_status_sql(1)} = '' OR {_ms_status_sql(2)} = '')")
        if real:
            ph = ", ".join(["%s"] * len(real))
            # Matches either milestone OR the rolled-up line status, so the
            # filter accepts both the per-milestone vocabulary and the derived
            # "Partially …" values the UI now shows in its single status column.
            parts.append(
                f"({_ms_status_sql(1)} IN ({ph}) OR {_ms_status_sql(2)} IN ({ph})"
                f" OR IFNULL(pd.sub_po_status,'') IN ({ph}))"
            )
            params.extend(real * 3)
        where.append("(" + " OR ".join(parts) + ")")

    # PO-line status (PO Dispatch.dispatch_status) — the "PO Status" column.
    ds_vals = _ensure_list(pf.get("dispatch_status"))
    if ds_vals:
        ph = ", ".join(["%s"] * len(ds_vals))
        where.append(f"IFNULL(pd.dispatch_status,'') IN ({ph})")
        params.extend(ds_vals)

    # Narrow to the lines carried by specific supplier Purchase Order(s). This
    # is what makes "invoice everything on one PO" a one-click job: filter to
    # the PO, select all, Receive Invoice.
    po_vals = _ensure_list(pf.get("purchase_order"))
    if po_vals:
        ph = ", ".join(["%s"] * len(po_vals))
        where.append(f"""EXISTS (SELECT 1 FROM `tabPurchase Order Item` poi_f
                                JOIN `tabPurchase Order` po_f ON po_f.name = poi_f.parent
                                     AND po_f.docstatus < 2
                                WHERE poi_f.poid = pd.name AND po_f.name IN ({ph}))""")
        params.extend(po_vals)

    # Customer-side status, so PIC can hold back a supplier PO until the
    # customer leg has moved (there is deliberately no hard gate on it).
    pic_vals = _ensure_list(pf.get("pic_status"))
    if pic_vals:
        ph = ", ".join(["%s"] * len(pic_vals))
        where.append(
            f"(IFNULL(pd.pic_status,'') IN ({ph}) OR IFNULL(pd.pic_status_ms2,'') IN ({ph}))"
        )
        params.extend(pic_vals * 2)

    _po_date_sql, _po_date_params = _supplier_po_date_filter(pf)
    if _po_date_sql:
        where.append(_po_date_sql)
        params.extend(_po_date_params)
    # Customer-invoice window — what a Command Dashboard drill-through sends.
    _inv_sql, _inv_params = subcon_invoice_window(pf)
    if _inv_sql:
        where.append(_inv_sql)
        params.extend(_inv_params)

    col_filter_map = {
        "poid": "COALESCE(NULLIF(pd.poid,''), pd.name)",
        "po_no": "IFNULL(pd.po_no,'')",
        "project": "IFNULL(pd.project_code,'')",
        "duid": "IFNULL(pd.site_code,'')",
        "site_name": "IFNULL(pd.site_name,'')",
        "item": "IFNULL(pd.item_code,'')",
        "description": "IFNULL(pd.item_description,'')",
        # These two columns render THIS SUPPLIER'S share, not the line's, so
        # the filter has to offer the same numbers. Offering 121 for a cell
        # that reads 50 is the "filter must match what the cell renders" trap:
        # picking the only value on offer returned nothing the user could see.
        # Trailing zeros trimmed so the dropdown reads "50", the way the cell
        # does. ROUND(...,4) alone offered "50.0000" against a cell showing
        # "50" — the filter worked, but the user has to recognise the value.
        "qty": ("TRIM(TRAILING '.' FROM TRIM(TRAILING '0' FROM "
                f"CAST(ROUND(IFNULL(pd.qty,0) * ({ALLOC_SHARE_SQL}), 4) AS CHAR)))"),
        "unit_price": "CAST(pd.rate AS CHAR)",
        "line_amount": f"CAST(ROUND(IFNULL(pd.line_amount,0) * ({ALLOC_SHARE_SQL}), 2) AS CHAR)",
        "subcontract": "IFNULL(sm.subcontractor_name,'')",
        "contract_model": "IFNULL(sm.contract_model,'')",
        "supplier": "IFNULL(sm.supplier,'')",
        "payout_pct": "CAST(sm.sub_payout_pct AS CHAR)",
        "dispatch_status": "IFNULL(pd.dispatch_status,'')",
        # Header labels that slug differently from the keys above.
        "rate": "CAST(pd.rate AS CHAR)",
        "po_status": "IFNULL(pd.dispatch_status,'')",
        # The "Subcon Status" column renders pd.sub_po_status through
        # SubPoStatusBadge — the overall sub-PO state, Not Ordered through
        # Closed. It was mapped to pd.subcon_status, a different field whose
        # only values are Pending and Work Done, so the dropdown offered two
        # labels that never appear in the column and none that do.
        "subcon_status": "IF(IFNULL(pd.sub_po_status,'') = '', 'Not Ordered', pd.sub_po_status)",
        "amount": "CAST(pd.line_amount AS CHAR)",
        "payout": "CAST(sm.sub_payout_pct AS CHAR)",
        # Remaining header slugs on SubconPO.jsx. These mirror the SELECT's
        # own computed expressions so a filter matches what's rendered.
        # "Cust. MS1/MS2" render the PIC (customer-side) milestone STATUS
        # badge, and "Subcon MS1/MS2" the sub-PO status badge — not amounts.
        # Check the cell, not the header wording: an earlier pass mapped these
        # to ms*_amount and the dropdowns offered money on a status column.
        "cust_ms1": "IF(IFNULL(pd.pic_status,'') = '', 'Work Not Done', pd.pic_status)",
        # A line whose PO never had a second milestone (ms2_pct = 0 —
        # 87.5% of them) renders "NIL", not "Work Not Done". Mirror of
        # picMs2Label in frontend/src/pages/pic/picShared.jsx.
        "cust_ms2": (
            "IF(IFNULL(pd.ms2_pct,0) <= 0, 'NIL', IF(IFNULL(pd.pic_status_ms2,'') = '', 'Work Not Done', pd.pic_status_ms2))"
        ),
        # The Deduction cell shows the amount AND its state; the state is the
        # useful part to filter on ("which lines still owe an invoice").
        "deductions": _deduction_state_sql(),
        "payout_ms1": f"CAST({_expected_payout_sql(1)} AS CHAR)",
        "payout_ms2": f"CAST({_expected_payout_sql(2)} AS CHAR)",
        "vat_ms1": f"CAST({_vat_sql(1)} AS CHAR)",
        "vat_ms2": f"CAST({_vat_sql(2)} AS CHAR)",
        # PicStatusBadge / SubPoStatusBadge substitute these labels for an
        # empty value, so the option list must too — otherwise the dropdown
        # offers "(Blanks)" for cells that visibly read "Work Not Done" /
        # "Not Ordered", and never offers the label that IS on screen.
        "subcon_ms1": "IF(IFNULL(pd.sub_po_status_ms1,'') = '', 'Not Ordered', pd.sub_po_status_ms1)",
        "subcon_ms2": "IF(IFNULL(pd.sub_po_status_ms2,'') = '', 'Not Ordered', pd.sub_po_status_ms2)",
        # Quantity on live supplier POs. CAST to CHAR so the option list is
        # built from the same text the cell shows; excel_options_from_query
        # detects an all-numeric list and sorts it numerically.
        "ordered_qty_ms1": "CAST(IFNULL(oq1.qty, 0) AS CHAR)",
        "ordered_qty_ms2": "CAST(IFNULL(oq2.qty, 0) AS CHAR)",
        # Purchase Orders / Invoices are attached by _batch_linked_purchase_docs()
        # after the main query. Mirror that lookup (same child->parent hop and
        # same "PO-0001|MS1|Submitted" formatting) so these columns filter too.
        "purchase_orders": (
            "IFNULL((SELECT GROUP_CONCAT(DISTINCT CONCAT(p_o.name, '|', "
            "UPPER(IFNULL(c_o.milestone, '')), '|', "
            "CASE WHEN p_o.docstatus = 1 THEN 'Submitted' "
            "WHEN p_o.docstatus = 0 THEN 'Draft' "
            "WHEN p_o.docstatus = 2 THEN 'Cancelled' ELSE '?' END) "
            "ORDER BY p_o.name SEPARATOR ', ') "
            "FROM `tabPurchase Order Item` c_o "
            "JOIN `tabPurchase Order` p_o ON p_o.name = c_o.parent "
            "WHERE c_o.poid = pd.name), '')"
        ),
        "purchase_invoices": (
            "IFNULL((SELECT GROUP_CONCAT(DISTINCT CONCAT(p_i.name, '|', "
            "UPPER(IFNULL(c_i.milestone, '')), '|', "
            "CASE WHEN p_i.docstatus = 1 THEN 'Submitted' "
            "WHEN p_i.docstatus = 0 THEN 'Draft' "
            "WHEN p_i.docstatus = 2 THEN 'Cancelled' ELSE '?' END) "
            "ORDER BY p_i.name SEPARATOR ', ') "
            "FROM `tabPurchase Invoice Item` c_i "
            "JOIN `tabPurchase Invoice` p_i ON p_i.name = c_i.parent "
            "WHERE c_i.poid = pd.name AND IFNULL(c_i.payout_deduction, '') = ''), '')"
        ),
        "im": "IFNULL(imm.full_name,'')",
        "pic_status_ms1": "IF(IFNULL(pd.pic_status,'') = '', 'Work Not Done', pd.pic_status)",
        # A line whose PO never had a second milestone (ms2_pct = 0 —
        # 87.5% of them) renders "NIL", not "Work Not Done". Mirror of
        # picMs2Label in frontend/src/pages/pic/picShared.jsx.
        "pic_status_ms2": (
            "IF(IFNULL(pd.ms2_pct,0) <= 0, 'NIL', IF(IFNULL(pd.pic_status_ms2,'') = '', 'Work Not Done', pd.pic_status_ms2))"
        ),
        "ms1": "CAST(pd.ms1_pct AS CHAR)",
        "ms2": "CAST(pd.ms2_pct AS CHAR)",
        "ms1_amt": "CAST(pd.ms1_amount AS CHAR)",
        "ms2_amt": "CAST(pd.ms2_amount AS CHAR)",
        # SubPoStatusBadge shows "Not Ordered" for an empty status, so the
        # options have to as well — the same reason subcon_ms1/ms2 above
        # already do. Without it the dropdown offers "(Blanks)" for cells that
        # visibly read "Not Ordered", and never offers the label on screen.
        # _ms_status_sql itself is left alone: twelve stage filters depend on
        # it meaning the raw value.
        "sub_po_status": "IF(IFNULL(pd.sub_po_status,'') = '', 'Not Ordered', pd.sub_po_status)",
        "sub_po_status_ms1": f"IF({_ms_status_sql(1)} = '', 'Not Ordered', {_ms_status_sql(1)})",
        # MS2 renders an em dash, not a status, when the line has no MS2 value
        # — that is "not applicable", which belongs under (Blanks).
        "sub_po_status_ms2": (
            f"IF(IFNULL(pd.ms2_amount,0) <= 0, '', "
            f"IF({_ms_status_sql(2)} = '', 'Not Ordered', {_ms_status_sql(2)}))"
        ),
        "sub_po_amount_ms1": "CAST(pd.sub_po_amount_ms1 AS CHAR)",
        "sub_po_amount_ms2": "CAST(pd.sub_po_amount_ms2 AS CHAR)",
        # Both legs concatenated, so one Manage-Table filter finds a remark
        # written against either milestone (the UI shows them in one column).
        "remark": "CONCAT_WS(' ', IFNULL(pd.sub_po_remark_ms1,''), IFNULL(pd.sub_po_remark_ms2,''))",
        "sub_po_date_ms1": "CAST(pd.sub_po_date_ms1 AS CHAR)",
        "sub_po_date_ms2": "CAST(pd.sub_po_date_ms2 AS CHAR)",
        "vat_ms1": f"CAST({_vat_sql(1)} AS CHAR)",
        "vat_ms2": f"CAST({_vat_sql(2)} AS CHAR)",
        "expected_payout_ms1": f"CAST({_expected_payout_sql(1)} AS CHAR)",
        "expected_payout_ms2": f"CAST({_expected_payout_sql(2)} AS CHAR)",
    }
    column_filters = pf.get("column_filters")
    if isinstance(column_filters, str):
        try:
            column_filters = frappe.parse_json(column_filters)
        except Exception:
            column_filters = None
    if isinstance(column_filters, dict):
        for col_key, raw_val in column_filters.items():
            # Excel-style value filter — must be handled before
            # _sql_like_pattern(), which cannot take a dict.
            if isinstance(raw_val, dict):
                _c, _p = excel_filter_clause(col_filter_map.get(col_key), raw_val)
                if _c:
                    where.append(_c)
                    params.extend(_p)
                continue
            pat = _sql_like_pattern(raw_val)
            expr = col_filter_map.get(col_key)
            if pat and expr:
                where.append(f"{expr} LIKE %s")
                params.append(pat)

    search = pf.get("search") or pf.get("q") or ""
    if search:
        clause, like_params = _sql_search_clause(
            "CONCAT_WS(' ',"
            " IFNULL(pd.poid,''), IFNULL(pd.po_no,''), IFNULL(pd.item_code,''),"
            " IFNULL(pd.item_description,''),"
            " IFNULL(pd.project_code,''), IFNULL(proj.project_name,''),"
            " IFNULL(pd.site_code,''), IFNULL(pd.site_name,''),"
            " IFNULL(pd.center_area,''), IFNULL(imm.full_name,''),"
            " IFNULL(sm.subcontractor_name,''), IFNULL(sm.contract_model,''),"
            " IFNULL(sm.supplier,''),"
            " IFNULL(pd.sub_po_remark_ms1,''), IFNULL(pd.sub_po_remark_ms2,''))",
            search,
            exact_cols=["IFNULL(pd.poid,'')", "IFNULL(pd.site_code,'')"],
        )
        if clause:
            where.append(clause)
            params.extend(like_params)

    where_sql = " AND ".join(where)

    if _options:
        _e = col_filter_map.get(_options.get("col_key"))
        if not _e:
            return {"values": [], "has_blanks": False, "total": 0, "supported": False}
        return excel_options_from_query(
            _SUBCON_FROM_JOIN.strip().replace("FROM ", "", 1), where_sql, params, _e,
            bucket=_options.get("bucket"), search=_options.get("search"),
            limit=_options.get("limit"), label_kind=_options.get("label_kind"),
        )
    if _summary:
        # Subcon PO is the mirror of the customer side: what the subcontractor
        # is owed, how much of it has an actual PO raised, and how much has
        # been invoiced back to us.
        from inet_app.api.command_center import summary_from_query
        _metrics = [
            {"key": "lines", "label": "Lines", "agg": "count"},
            {"key": "duids", "label": "DUIDs", "agg": "count_distinct",
             "expr": "NULLIF(IFNULL(pd.site_code,''), '')"},
            {"key": "subcons", "label": "Subcons", "agg": "count_distinct",
             "expr": "NULLIF(IFNULL(pd.contract,''), '')"},
            {"key": "value", "label": "Value", "agg": "sum",
             "expr": "IFNULL(pd.line_amount, 0)", "format": "money", "tone": "good"},
        ]
        _summ = summary_from_query(
            _SUBCON_FROM_JOIN.strip().replace("FROM ", "", 1), where_sql, params, _metrics)
        # Arriving from the dashboard with an invoice window: show the payout
        # that window accounts for, beside the counts, instead of restating it
        # in a banner. It is event-scaled, so a milestone invoiced in parts
        # contributes only the parts inside the window.
        if pf.get("invoice_from_date") or pf.get("invoice_to_date"):
            _w, _wp = ["1=1"], []
            if pf.get("invoice_from_date"):
                _w.append("ev.event_date >= %s")
                _wp.append(pf["invoice_from_date"])
            if pf.get("invoice_to_date"):
                _w.append("ev.event_date <= %s")
                _wp.append(pf["invoice_to_date"])
            _pr = frappe.db.sql(
                f"""SELECT COALESCE(SUM(ev.payout), 0) AS payout
                    FROM ({subcon_payout_events_sql()}) ev
                    WHERE {' AND '.join(_w)}""", tuple(_wp), as_dict=True)
            _summ.setdefault("metrics", []).append({
                "key": "period_payout", "label": "Payout invoiced",
                "value": round(flt((_pr[0] if _pr else {}).get("payout")), 2),
                "format": "money", "tone": "good",
                "hint": "Owed to subcontractors for milestones billed to the customer in this period",
            })
        return _summ

    # creation DESC, not modified DESC: rows must not reorder under the user
    # when a status update touches one of them mid-review.
    rows = frappe.db.sql(
        f"""
        SELECT
          pd.name AS po_dispatch,
          COALESCE(NULLIF(pd.poid,''), pd.name) AS poid,
          pd.po_no, pd.po_line_no,
          pd.item_code, pd.item_description,
          pd.qty, pd.rate, pd.tax_rate,
          -- This supplier's share of the line. Every other money column on
          -- this row is already share-weighted (ms1_amount, ms2_amount), so a
          -- full-line 968.00 sitting beside a share of 400.00 read as a
          -- contradiction. `full_line_amount` keeps the whole figure for the
          -- popup, which is where the comparison belongs.
          ROUND(IFNULL(pd.line_amount, 0) * ({ALLOC_SHARE_SQL}), 2) AS line_amount,
          IFNULL(pd.line_amount, 0) AS full_line_amount,
          pd.project_code, proj.project_name,
          pd.site_code, pd.site_name, pd.center_area, pd.region_type,
          pd.im, imm.full_name AS im_full_name,
          pd.dispatch_status,
          pd.pic_status AS pic_status_ms1, pd.pic_status_ms2,
          pd.ms1_pct, pd.ms2_pct,
          {_ms_amount_sql(1)} AS ms1_amount, {_ms_amount_sql(2)} AS ms2_amount,
          alloc.subcontractor AS alloc_subcontractor,
          alloc.qty AS alloc_qty,
          (SELECT COUNT(*) FROM `tabPO Subcontract Allocation` a2
            WHERE a2.parent = pd.name AND a2.parenttype = 'PO Dispatch') AS alloc_count,
          pd.ms1_invoiced, pd.ms2_invoiced,
          pd.ms1_applied_date, pd.ms2_applied_date,
          pd.ms1_invoice_month, pd.ms2_invoice_month,
          pd.ms1_payment_received_date, pd.ms2_payment_received_date,
          sm.name AS subcontract,
          sm.subcontractor_name,
          sm.contract_model,
          sm.sub_payout_pct AS payout_pct,
          sm.inet_margin_pct,
          sm.supplier,
          sup.supplier_name,
          {_expected_payout_sql(1)} AS expected_payout_ms1,
          {_expected_payout_sql(2)} AS expected_payout_ms2,
          {_gross_payout_sql(1)} AS gross_payout_ms1,
          {_gross_payout_sql(2)} AS gross_payout_ms2,
          {_deduction_total_sql()} AS deduction_amount,
          {_deduction_state_sql()} AS deduction_state,
          -- Per-milestone orderability. A line whose MS1 is already ordered
          -- but whose MS2 is still open legitimately stays on the To Order
          -- tab (the stages overlap by design), so the UI has to know which
          -- leg the Create PO action applies to rather than assuming MS1.
          {_vat_sql(1)} AS vat_ms1,
          {_vat_sql(2)} AS vat_ms2,
          IF({_orderable_ms_sql(1)}, 1, 0) AS can_order_ms1,
          IF({_orderable_ms_sql(2)}, 1, 0) AS can_order_ms2,
          -- PIC's manual readiness call, per milestone. Drives the "Auto"
          -- create mode the same way "Ready for Invoice" drives the sales side.
          IF({_ready_ms_sql(1)}, 1, 0) AS ready_ms1,
          IF({_ready_ms_sql(2)}, 1, 0) AS ready_ms2,
          pd.sub_po_supplier,
          IFNULL(pd.sub_po_status, '') AS sub_po_status,
          {_ms_status_sql(1)} AS sub_po_status_ms1,
          {_ms_status_sql(2)} AS sub_po_status_ms2,
          pd.sub_po_pct_ms1, pd.sub_po_pct_ms2,
          pd.sub_po_amount_ms1, pd.sub_po_amount_ms2,
          pd.sub_po_date_ms1, pd.sub_po_date_ms2,
          pd.sub_paid_date_ms1, pd.sub_paid_date_ms2,
          pd.sub_po_remark_ms1, pd.sub_po_remark_ms2,
          -- How much QUANTITY is actually on live supplier POs, per
          -- milestone. The joins have always computed this for the
          -- duplicate guard; it was never shown, so a line ordered at the
          -- wrong quantity looked identical to a correct one and the only
          -- way to find out was to open the purchase order.
          IFNULL(oq1.qty, 0) AS ordered_qty_ms1,
          IFNULL(oq2.qty, 0) AS ordered_qty_ms2,
          -- What the milestone MAY be ordered for, from the same expression
          -- the To Order tab uses. A PO quantity is milestone-scaled -- the
          -- line quantity times the milestone percentage -- so comparing it
          -- against the raw line quantity flags 347 perfectly correct lines
          -- as short-ordered. (No literal percent sign in this comment on
          -- purpose: pymysql reads one as a format placeholder, even inside
          -- a comment, and the query dies with "not enough arguments".)
          {_entitled_qty_ms_sql(1)} AS entitled_qty_ms1,
          {_entitled_qty_ms_sql(2)} AS entitled_qty_ms2,
          pd.creation, pd.modified
        {_SUBCON_FROM_JOIN}
        WHERE {where_sql}
        ORDER BY pd.creation DESC
        {_sql_limit_suffix(limit_page_length)}
        """,
        tuple(params),
        as_dict=True,
    )

    # Totals over the whole filtered set, not just the fetched page — a
    # rowLimit=20 view must not show a 20-row sum as if it were everything.
    agg = (frappe.db.sql(
        f"""
        SELECT COUNT(*) AS total,
               COALESCE(SUM({_expected_payout_sql(1)}), 0) AS expected_ms1,
               COALESCE(SUM({_expected_payout_sql(2)}), 0) AS expected_ms2,
               COALESCE(SUM({_vat_sql(1)}), 0) AS vat_ms1,
               COALESCE(SUM({_vat_sql(2)}), 0) AS vat_ms2,
               COALESCE(SUM({_deduction_total_sql()}), 0) AS deduction_amount,
               COALESCE(SUM(pd.sub_po_amount_ms1), 0) AS ordered_ms1,
               COALESCE(SUM(pd.sub_po_amount_ms2), 0) AS ordered_ms2,
               COALESCE(SUM({_ms_amount_sql(1)}), 0) AS ms1_amount,
               COALESCE(SUM({_ms_amount_sql(2)}), 0) AS ms2_amount,
               SUM(IFNULL(sm.supplier,'') = '') AS missing_supplier
        {_SUBCON_FROM_JOIN}
        WHERE {where_sql}
        """,
        tuple(params),
        as_dict=True,
    ) or [{}])[0]

    if rows:
        linked = _batch_linked_purchase_docs([r["po_dispatch"] for r in rows])
        for r in rows:
            docs = linked.get(r["po_dispatch"]) or {}
            r["purchase_orders_csv"] = docs.get("po")
            r["purchase_invoices_csv"] = docs.get("pi")
            r["supplier_missing"] = 1 if not (r.get("supplier") or "").strip() else 0
        # The whole line's split, including the legs this page does not show.
        # A row here is one PAYABLE supplier, so a line shared with an INET
        # crew appears as a single row with nothing to say it is a share — the
        # marker and the View popup need the other legs to say so.
        from inet_app.api.subcontractor_sync import attach_allocations
        attach_allocations(rows, key="po_dispatch")
        from inet_app.api.payout_deduction import attach_deductions
        attach_deductions(rows, key="po_dispatch")

    return {
        "rows": rows,
        "total_count": cint(agg.get("total") or 0),
        "totals": {
            "vat_ms1": flt(agg.get("vat_ms1") or 0),
            "vat_ms2": flt(agg.get("vat_ms2") or 0),
            "deduction_amount": flt(agg.get("deduction_amount") or 0),
            "expected_ms1": flt(agg.get("expected_ms1") or 0),
            "expected_ms2": flt(agg.get("expected_ms2") or 0),
            "ordered_ms1": flt(agg.get("ordered_ms1") or 0),
            "ordered_ms2": flt(agg.get("ordered_ms2") or 0),
            "ms1_amount": flt(agg.get("ms1_amount") or 0),
            "ms2_amount": flt(agg.get("ms2_amount") or 0),
            "missing_supplier": cint(agg.get("missing_supplier") or 0),
        },
    }


@frappe.whitelist()
def get_subcon_po_filter_options():
    """Distinct values for the Subcon PO page filter bar.

    Scoped to lines this page can actually show (SUB-type only) so the
    dropdowns never offer a value that yields zero rows.
    """
    _pic_role_or_throw()
    where_sql = " AND ".join(["1=1"] + list(_SUBCON_BASE_WHERE))
    rows = frappe.db.sql(
        f"""
        SELECT DISTINCT
          IFNULL(pd.project_code,'') AS project_code,
          IFNULL(pd.site_code,'')    AS site_code,
          IFNULL(pd.im,'')           AS im,
          IFNULL(imm.full_name,'')   AS im_full_name,
          IFNULL(sm.name,'')         AS subcontract,
          IFNULL(sm.contract_model,'') AS contract_model,
          IFNULL(sm.supplier,'')     AS supplier
        {_SUBCON_FROM_JOIN}
        WHERE {where_sql}
        """,
        (),
        as_dict=True,
    )

    def uniq(key):
        return sorted({(r.get(key) or "").strip() for r in rows} - {""})

    ims = {}
    for r in rows:
        if (r.get("im") or "").strip():
            ims[r["im"]] = (r.get("im_full_name") or r["im"]).strip() or r["im"]

    return {
        "project_code": uniq("project_code"),
        "site_code": uniq("site_code"),
        "subcontract": uniq("subcontract"),
        "contract_model": uniq("contract_model"),
        "supplier": uniq("supplier"),
        "im": [{"id": k, "label": v} for k, v in sorted(ims.items(), key=lambda kv: kv[1])],
        # PO Dispatch.dispatch_status vocabulary, straight off the doctype so
        # it can't drift from the Select.
        "dispatch_status": [
            o for o in (frappe.get_meta("PO Dispatch").get_field("dispatch_status").options or "").split("\n")
            if o.strip()
        ],
        # Live supplier POs that actually carry subcon lines, newest first.
        "purchase_order": frappe.db.sql_list("""
            SELECT DISTINCT po.name
            FROM `tabPurchase Order` po
            JOIN `tabPurchase Order Item` poi ON poi.parent = po.name
            WHERE po.docstatus < 2 AND IFNULL(poi.poid,'') != ''
            ORDER BY po.name DESC
            LIMIT 300
        """),
        # Milestone vocabulary plus the derived rollup values, deduped and kept
        # in ladder order — the filter accepts either (see list_subcon_po_rows).
        "sub_po_status": list(dict.fromkeys(SUB_PO_OVERALL_STATUSES)),
    }


# ── Purchase Order creation ──────────────────────────────────────────────
def _po_item_pricing(pd_row, milestone, payout_pct, precision, already_ordered=0.0):
    """Return (qty, rate, description, list_rate) for one supplier PO line.

    ``list_rate`` is the supplier's agreed unit rate and ``rate`` what is
    actually paid per unit. They differ only on a line with payout
    deductions: the PO then prints the agreed rate, the deduction as the
    item's discount, and the type named in the description — so the supplier
    can check both the rate and the reason against their contract. The
    deduction is spread per unit over the milestone's quantity, so a PO for
    2 of 6 units carries 2/6 of it.

    ``qty`` carries the milestone split (MS1 = 70% of the line → 0.7 × qty)
    and ``rate`` carries the payout split, so the printed PO shows the
    subcontractor's own agreed unit rate rather than a blended number they
    can't reconcile against their contract. Same qty-scaling the sales side
    uses in create_sales_invoice_from_pic.

    ``price_list_rate`` is pinned equal to ``rate`` by the caller, never left
    blank. If it were blank, set_missing_item_details fills it from Item
    Price during validate and taxes_and_totals then back-derives
    ``discount_amount = price_list_rate - rate`` and prints it — leaking the
    customer rate onto a document that goes to the supplier. Equal values
    make the discount exactly zero, and also keep calculate_margin's
    ``rate > price_list_rate`` branch from inflating the rate on a re-save
    (the rate-ballooning bug seen in fateh_pwa).
    """
    n = _ms_num(milestone)
    ms_pct = flt(pd_row.get(f"ms{n}_pct") or 0)
    # THIS SUPPLIER'S quantity, not the line's. On a line split 71 INET / 50
    # Jareesh, the supplier PO must be for 50 — it used to be raised for all
    # 121, ordering a subcontractor more than twice the work they did.
    # Milestone scaling then applies on top, as it always has.
    full_qty = flt(pd_row.get("alloc_qty") or 0) or flt(pd_row.get("qty") or 1) or 1
    full_rate = flt(pd_row.get("rate") or 0)

    qty = round(full_qty * ms_pct / 100.0, 6) if ms_pct > 0 else full_qty
    if qty <= 0:
        qty = full_qty
    # Only what is still unordered. A milestone part-ordered earlier — 2 of a
    # 3-qty line, then topped up — must produce a PO for the REMAINDER, not
    # for the whole milestone again, or the supplier is ordered the first
    # quantity twice.
    if already_ordered:
        qty = max(0.0, flt(qty) - flt(already_ordered))
    rate = flt(full_rate * payout_pct / 100.0, precision)
    list_rate = rate

    # Plain item description only. Site and milestone used to be appended here;
    # they now ride on the line's own `duid` / `project_control_center` /
    # `milestone` fields instead, so the printed description stays clean
    # (site_code and site_name are usually identical in this data anyway, which
    # made the appended line read as a duplicate).
    description = (pd_row.get("item_description") or pd_row.get("item_code") or "").strip()

    from inet_app.api.payout_deduction import deduction_labels, deduction_per_unit
    per_unit = deduction_per_unit(pd_row.get("po_dispatch"), pd_row.get("subcontract"),
                                  milestone, payout_pct, full_qty, ms_pct)
    if per_unit > 0:
        rate = max(0.0, flt(list_rate - per_unit, precision))
        labels = deduction_labels(pd_row["po_dispatch"], (milestone or "").upper())
        if labels:
            description = f"{description}\nLess: {', '.join(labels)}"

    return qty, rate, description, list_rate


@frappe.whitelist()
def create_purchase_order_from_pic(po_dispatch=None, milestone=None):
    """Create draft Purchase Order(s) for the selected PIC lines.

    ``po_dispatch``: a single name or a JSON list.
    ``milestone``:
      * ``"MS1"`` / ``"MS2"`` — just that milestone.
      * omitted / ``None`` — every milestone that is unordered and has an
        amount (so MS1 and MS2 go onto the SAME PO as two item rows).
      * ``"AUTO"`` — only the milestones PIC has marked "Ready to Order".
        This is the direct mirror of create_sales_invoice_from_pic, which
        picks up every ``pic_status = 'Ready for Invoice'`` milestone when no
        milestone is named. Each milestone still becomes its own item row.

    One PO per **Supplier** — a single PO may span several Subcontract
    Masters (two Protech contracts at 85% and 90%, say), because the payout
    percentage is resolved per line, not per document.

    Creating the PO leaves it in draft and sets the line to "PO Created".
    "PO Submitted" follows from the on_submit hook, so the status can never
    claim the supplier was sent something that is still unsubmitted.
    """
    _pic_role_or_throw()

    if isinstance(po_dispatch, str) and po_dispatch.strip().startswith("["):
        po_dispatch = frappe.parse_json(po_dispatch)
    names = po_dispatch if isinstance(po_dispatch, list) else [po_dispatch]
    names = [n for n in names if n]
    if not names:
        frappe.throw("po_dispatch is required")

    auto_ready = str(milestone or "").strip().upper() == "AUTO"
    want_ms = None if auto_ready else _norm_milestone(milestone)

    if not frappe.db.exists("DocType", "Purchase Order"):
        frappe.throw("Purchase Order doctype not found — ERPNext may not be installed.")

    # ── Resolve + validate every selected line before creating anything ──
    lines = _batch_resolve_subcontracts(names)
    valid_suppliers = set(frappe.db.get_all(
        "Supplier",
        filters={"name": ["in", sorted({(r.get("supplier") or "").strip()
                                        for r in lines.values()} - {""})] or [""]},
        pluck="name",
    ))

    resolved = []           # (line, milestone, amount)
    missing_supplier = {}   # contract -> [poid, ...]
    skipped = []
    for name in names:
        line = lines.get(name)
        if not line:
            frappe.throw(f"PO Dispatch {name} not found.")
        label = line.get("poid") or name

        if cint(line.get("is_internal_work") or 0):
            skipped.append(f"{label}: internal work")
            continue
        if not line.get("subcontract"):
            skipped.append(f"{label}: no subcontractor resolved")
            continue
        if (line.get("contract_type") or "") != "SUB":
            skipped.append(f"{label}: {line['subcontract']} is an INET-type contract")
            continue

        supplier = (line.get("supplier") or "").strip()
        if not supplier or supplier not in valid_suppliers:
            missing_supplier.setdefault(line["subcontract"], []).append(label)
            continue

        if flt(line.get("sub_payout_pct") or 0) <= 0:
            skipped.append(f"{label}: {line['subcontract']} has no Sub Payout %")
            continue

        for ms in (["MS1", "MS2"] if not want_ms else [want_ms]):
            n = _ms_num(ms)
            amount = flt(line.get(f"ms{n}_amount") or 0)
            current = (line.get(_status_field(ms)) or "").strip()
            if amount <= 0:
                if want_ms:
                    skipped.append(f"{label} ({ms}): no milestone amount")
                continue
            if current not in _CREATABLE_STATUSES:
                if want_ms:
                    skipped.append(f"{label} ({ms}): already at '{current}'")
                continue
            # Same gate the To Order tab applies, enforced here too so it
            # cannot be bypassed by posting a line name straight to the API.
            customer_status = (line.get(_pic_status_field(ms)) or "").strip()
            if customer_status not in _CUSTOMER_BILLED_STATUSES:
                skipped.append(
                    f"{label} ({ms}): customer not invoiced yet"
                    f" ({customer_status or 'no status'})"
                )
                continue
            # "Auto" mode takes only what PIC has marked Ready to Order —
            # the mirror of create_sales_invoice_from_pic picking up every
            # 'Ready for Invoice' milestone when no milestone is named.
            if auto_ready and current != SUB_PO_READY:
                continue
            resolved.append((line, ms, amount))

    if missing_supplier:
        detail = "; ".join(
            f"{c} (e.g. {', '.join(v[:3])}{'…' if len(v) > 3 else ''})"
            for c, v in missing_supplier.items()
        )
        _notify_missing_supplier(missing_supplier)
        frappe.throw(
            "Can't create — these Subcontract Masters have no Supplier linked: "
            f"{detail}. Link a Supplier on the Subcontract Master first."
        )

    if not resolved:
        msg = ("No milestone marked 'Ready to Order' in the selection."
               if auto_ready else "No orderable lines in the selection.")
        if skipped:
            msg += " " + "; ".join(skipped[:10]) + ("…" if len(skipped) > 10 else "")
        frappe.throw(msg)

    # ── Duplicate guard: a live PO already covering this POID+milestone+supplier ──
    # Supplier is part of the key: a line split between two subcontractors
    # needs one PO each, and keying on (poid, milestone) alone made the first
    # one block the second.
    _dispatch_names = [l["po_dispatch"] for l, _ms, _a in resolved]
    dupes = _existing_purchase_orders_by_milestone(_dispatch_names)
    ordered_qty = _ordered_qty_by_milestone(_dispatch_names)
    conflicts = []
    for line, ms, _amt in resolved:
        sub = cstr(line.get("subcontract") or "")
        if not _po_exists_for(dupes, line["po_dispatch"], ms, sub):
            continue
        # A PO consumes a QUANTITY, not the whole milestone. Order 2 of a
        # 3-qty line's MS1 and the remaining 1 must still be orderable —
        # refusing outright meant a line topped up after its first PO could
        # never have the extra ordered at all, short of cancelling a PO the
        # supplier already has. Only a milestone whose live POs already cover
        # everything it is entitled to is closed to new ones.
        entitled = entitled_po_qty(line, ms)
        already = (ordered_qty.get((line["po_dispatch"], ms, sub), 0.0)
                   + ordered_qty.get((line["po_dispatch"], ms, ""), 0.0))
        if entitled and already < entitled - 0.0001:
            continue
        label = (dupes.get((line["po_dispatch"], ms, sub))
                 or dupes.get((line["po_dispatch"], ms, "")))
        who = f" / {sub}" if sub else ""
        covered = (f" — {already:g} of {entitled:g} already ordered"
                   if entitled else "")
        conflicts.append(
            f"{line.get('poid') or line['po_dispatch']} ({ms}{who}) → {label}{covered}")
    if conflicts:
        frappe.throw(
            "Can't create — these are already fully ordered: "
            + "; ".join(conflicts)
            + ". Cancel the existing Purchase Order first, or order the "
              "remaining quantity only."
        )

    # ── Group by supplier, one PO each ───────────────────────────────────
    by_supplier = {}
    for entry in resolved:
        by_supplier.setdefault(entry[0]["supplier"], []).append(entry)

    company = (frappe.defaults.get_user_default("Company")
               or frappe.defaults.get_global_default("company"))
    tax_template = frappe.db.get_single_value("INET Settings", "purchase_tax_template")
    schedule_days = cint(frappe.db.get_single_value("INET Settings", "subcon_po_schedule_days")) or 30
    schedule_date = add_days(nowdate(), schedule_days)

    created = []
    for supplier, entries in by_supplier.items():
        po = frappe.new_doc("Purchase Order")
        po.supplier = supplier
        po.company = company
        po.transaction_date = nowdate()
        po.schedule_date = schedule_date
        if tax_template:
            po.taxes_and_charges = tax_template
            # Server-side creation doesn't auto-fetch template rows (that's
            # form JS), so append them or the PO goes out with no VAT.
            from erpnext.controllers.accounts_controller import get_taxes_and_charges
            for tax in get_taxes_and_charges("Purchase Taxes and Charges Template", tax_template) or []:
                po.append("taxes", tax)

        precision = po.precision("rate", "items") or 2
        wanted_items = {(l["item_code"] or "") for l, _ms, _a in entries}
        real_items = set(frappe.db.get_all(
            "Item", filters={"name": ["in", sorted(wanted_items - {""}) or [""]]}, pluck="name",
        ))
        # POID → DUID / project, carried per line onto the PO. Both are Link
        # fields (DUID Master / Project Control Center) already present on
        # Purchase Order Item from the inventory + accounting dimensions, so
        # they need no new custom fields — but a stale reference on an old
        # PO Dispatch row would fail Link validation and kill the whole save,
        # hence the batched existence check rather than trusting the value.
        real_duids = set(frappe.db.get_all(
            "DUID Master",
            filters={"name": ["in", sorted({(l["site_code"] or "") for l, _m, _a in entries} - {""}) or [""]]},
            pluck="name",
        ))
        real_projects = set(frappe.db.get_all(
            "Project Control Center",
            filters={"name": ["in", sorted({(l["project_code"] or "") for l, _m, _a in entries} - {""}) or [""]]},
            pluck="name",
        ))
        stamped = []
        for line, ms, _amount in entries:
            item_code = line.get("item_code") or ""
            if item_code not in real_items:
                item_code = "Service"
            payout_pct = flt(line.get("sub_payout_pct") or 0)
            _sub_k = cstr(line.get("subcontract") or "")
            _done = (ordered_qty.get((line["po_dispatch"], ms, _sub_k), 0.0)
                     + ordered_qty.get((line["po_dispatch"], ms, ""), 0.0))
            qty, rate, description, list_rate = _po_item_pricing(
                line, ms, payout_pct, precision, already_ordered=_done)
            duid = (line.get("site_code") or "").strip()
            project = (line.get("project_code") or "").strip()
            po.append("items", {
                "item_code": item_code,
                "description": description,
                "qty": qty,
                "rate": rate,
                # Equal to rate unless the line carries a payout deduction —
                # then the agreed rate, with the deduction as the discount.
                # Never blank: see _po_item_pricing docstring.
                "price_list_rate": list_rate,
                "discount_percentage": 0,
                "discount_amount": flt(list_rate - rate, precision),
                "schedule_date": schedule_date,
                "poid": line["po_dispatch"],
                "milestone": ms,
                "subcontract": line["subcontract"],
                "payout_pct": payout_pct,
                ACCOUNTING_DUID_FIELDNAME: duid if duid in real_duids else None,
                "project_control_center": project if project in real_projects else None,
            })
            stamped.append((line, ms, payout_pct))

        po.save(ignore_permissions=True)

        # Stamp from the SAVED document, not from our pre-computed intent, so
        # the tracker figure and the PO can never disagree after ERPNext's own
        # rounding of qty × rate.
        amount_by_key = {}
        for item in po.items:
            key = ((item.get("poid") or ""), (item.get("milestone") or "").upper())
            amount_by_key[key] = flt(item.get("amount") or 0)

        total = 0.0
        for line, ms, payout_pct in stamped:
            n = _ms_num(ms)
            amt = amount_by_key.get((line["po_dispatch"], ms), 0.0)
            frappe.db.set_value("PO Dispatch", line["po_dispatch"], {
                "sub_po_supplier": supplier,
                _status_field(ms): SUB_PO_CREATED,
                f"sub_po_pct_ms{n}": payout_pct,
                f"sub_po_amount_ms{n}": amt,
                f"sub_po_date_ms{n}": nowdate(),
            }, update_modified=True)
            _sync_overall_status(line["po_dispatch"])
            total += amt

        created.append({
            "purchase_order": po.name,
            "supplier": supplier,
            "line_count": len(stamped),
            "amount": round(total, 2),
            "milestones": "+".join(sorted({ms for _l, ms, _pc in stamped})),
            "purchase_order_url": f"/app/purchase-order/{po.name}",
        })

    _write_pic_activity_log(
        "Bulk Status Update", None, "sub_po_status", SUB_PO_CREATED,
        [{"po_dispatch": l["po_dispatch"]} for l, _ms, _a in resolved], {},
        remark="Subcon PO created: " + ", ".join(c["purchase_order"] for c in created),
    )

    return {
        "created": created,
        "purchase_orders": [c["purchase_order"] for c in created],
        "line_count": len(resolved),
        "amount": round(sum(c["amount"] for c in created), 2),
        "skipped": skipped,
    }


def _notify_missing_supplier(missing_supplier):
    """Tell INET Admin which Subcontract Masters are blocking a PO."""
    try:
        from inet_app.api.notifications import _notify_role
        contracts = ", ".join(sorted(missing_supplier))
        _notify_role(
            ADMIN_NOTIFY_ROLES,
            f"[ACTION] Subcon PO blocked — no Supplier linked on: {contracts}",
            "Subcontract Master", sorted(missing_supplier)[0],
        )
    except Exception:
        frappe.log_error(frappe.get_traceback(), "Subcon PO missing-supplier notify failed")


# ── Purchase Invoice creation ────────────────────────────────────────────
@frappe.whitelist()
def receive_supplier_invoice(purchase_order=None, po_dispatches=None,
                            bill_no=None, bill_date=None):
    """Record the subcontractor's invoice against a submitted supplier PO.

    Creates the draft Purchase Invoice AND moves the covered milestones to
    "Invoice Received" — the two halves of the same real-world event ("the
    sub's bill arrived"), which is why this is one action rather than a create
    plus a separate status click. Accounts submitting the invoice later is what
    advances it to "Purchase Invoice Submitted".

    ``po_dispatches`` (optional list) invoices only those PIC lines of the PO.
    Subcontractors bill a PO in instalments, so this is the normal case: PIC
    selects the lines the bill covers and repeats it for the next instalment.
    Omit it to take every not-yet-invoiced line on the PO.

    Legs already carried by a live Purchase Invoice are dropped automatically
    (see _invoiced_legs), so re-running for the same lines can't double-bill.

    Built with ERPNext's own ``make_purchase_invoice`` mapper and then filtered,
    rather than assembled by hand, so amounts, tax rows, the PO reference and
    the poid / milestone / subcontract / payout_pct tags all come across the
    way ERPNext intends.
    """
    _pic_role_or_throw()
    purchase_order = (purchase_order or "").strip()
    if not purchase_order:
        frappe.throw("purchase_order is required")
    if not frappe.db.exists("Purchase Order", purchase_order):
        frappe.throw(f"Purchase Order {purchase_order} not found.")

    docstatus = cint(frappe.db.get_value("Purchase Order", purchase_order, "docstatus"))
    if docstatus == 0:
        frappe.throw(
            f"{purchase_order} is still a draft. Submit the Purchase Order "
            "before recording the supplier's invoice."
        )
    if docstatus == 2:
        frappe.throw(f"{purchase_order} is cancelled.")

    if isinstance(po_dispatches, str):
        try:
            po_dispatches = frappe.parse_json(po_dispatches)
        except Exception:
            po_dispatches = [po_dispatches]
    wanted = {n for n in (po_dispatches or []) if n}

    already = _invoiced_legs(purchase_order)

    from erpnext.buying.doctype.purchase_order.purchase_order import make_purchase_invoice
    pi = make_purchase_invoice(purchase_order)

    kept, skipped = [], []
    for item in list(pi.items or []):
        poid = (item.get("poid") or "").strip()
        ms = (item.get("milestone") or "").strip().upper()
        if wanted and poid not in wanted:
            continue                      # not part of this instalment
        if (poid, ms) in already:
            skipped.append(f"{poid} {ms} → {already[(poid, ms)]}")
            continue
        kept.append(item)

    if not kept:
        if skipped:
            frappe.throw(
                "Every selected line is already invoiced on this PO: "
                + "; ".join(skipped[:8]) + ("…" if len(skipped) > 8 else "")
            )
        frappe.throw(
            f"Nothing to invoice on {purchase_order} for the selected lines."
        )

    pi.items = kept
    for idx, item in enumerate(pi.items, start=1):
        item.idx = idx

    if bill_no:
        pi.bill_no = str(bill_no).strip()
    if bill_date:
        pi.bill_date = getdate(bill_date)
    pi.save(ignore_permissions=True)

    # Mark the covered milestones "Invoice Received". Only from the ordered
    # states — never drag a milestone that PIC has already closed backwards.
    covered = []
    for pd_name, ms in _purchase_doc_lines(pi):
        if _set_status(pd_name, ms, SUB_PO_BILL_RECEIVED,
                       only_when=(SUB_PO_NOT_ORDERED, SUB_PO_READY,
                                  SUB_PO_CREATED, SUB_PO_SUBMITTED)):
            covered.append({"po_dispatch": pd_name, "milestone": ms})

    _write_pic_activity_log(
        "Bulk Status Update" if len(covered) > 1 else "Single Status Update",
        None, "sub_po_status", SUB_PO_BILL_RECEIVED, covered, {},
        remark=f"Supplier invoice {bill_no or '(no number)'} received — {pi.name}",
    )

    return {
        "purchase_invoice": pi.name,
        "purchase_order": purchase_order,
        "line_count": len(pi.items or []),
        "amount": flt(pi.grand_total or 0),
        "covered_lines": covered,
        "skipped_already_invoiced": skipped,
        # The FE attaches the supplier's invoice file to this doctype/name
        # right after, via the generic upload_file endpoint.
        "attach_to_doctype": "Purchase Invoice",
        "attach_to_name": pi.name,
        "purchase_invoice_url": f"/app/purchase-invoice/{pi.name}",
    }


def _invoiced_legs(purchase_order):
    """{(poid, milestone): pi_name} already carried by a live Purchase Invoice.

    A subcontractor can bill one PO in instalments, so the duplicate guard has
    to be per milestone leg — blocking a second invoice for the whole PO (as
    this module first did) would make partial invoicing impossible.
    """
    rows = frappe.db.sql("""
        SELECT pii.poid AS poid, UPPER(IFNULL(pii.milestone,'')) AS milestone,
               pi.name AS pi_name
        FROM `tabPurchase Invoice Item` pii
        JOIN `tabPurchase Invoice` pi ON pi.name = pii.parent AND pi.docstatus < 2
        WHERE pii.purchase_order = %s
    """, (purchase_order,), as_dict=True)
    return {((r["poid"] or ""), r["milestone"]): r["pi_name"] for r in rows}


@frappe.whitelist()
def get_purchase_order_summary(purchase_order=None):
    """Header + lines of one supplier PO, for the Receive Invoice screen.

    Read from the document itself rather than recomputed from the PIC rows, so
    what PIC compares the subcontractor's bill against is exactly what the PO
    says — including VAT, which the list view never carries. Each line also
    reports whether it has already been invoiced, so a partial invoice can show
    what is left to bill.
    """
    _pic_role_or_throw()
    purchase_order = (purchase_order or "").strip()
    if not purchase_order or not frappe.db.exists("Purchase Order", purchase_order):
        frappe.throw(f"Purchase Order {purchase_order or '(blank)'} not found.")

    po = frappe.get_doc("Purchase Order", purchase_order)
    poids = [(i.get("poid") or "") for i in po.items if i.get("poid")]
    labels = {}
    if poids:
        for chunk in _chunk(list(set(poids)), 800):
            for r in frappe.db.get_all("PO Dispatch", filters={"name": ["in", chunk]},
                                       fields=["name", "poid"]):
                labels[r.name] = r.poid or r.name

    invoiced = _invoiced_legs(purchase_order)

    items = [{
        "poid": i.get("poid"),
        "poid_label": labels.get(i.get("poid") or "", i.get("poid")),
        "milestone": i.get("milestone"),
        "item_code": i.item_code,
        "duid": i.get(ACCOUNTING_DUID_FIELDNAME) or i.get("duid"),
        "qty": flt(i.qty or 0),
        "rate": flt(i.rate or 0),
        "amount": flt(i.amount or 0),
        "payout_pct": flt(i.get("payout_pct") or 0),
        "subcontract": i.get("subcontract"),
        # Already billed on a live PI — the FE greys these out and leaves them
        # out of the "still to invoice" total, so nothing gets double-billed.
        "invoiced_on": invoiced.get(((i.get("poid") or ""),
                                     (i.get("milestone") or "").upper())),
    } for i in (po.items or [])]

    return {
        "name": po.name,
        "supplier": po.supplier,
        "supplier_name": frappe.db.get_value("Supplier", po.supplier, "supplier_name") or po.supplier,
        "transaction_date": str(po.transaction_date or ""),
        "schedule_date": str(po.schedule_date or ""),
        "currency": po.currency,
        "net_total": flt(po.net_total or 0),
        "total_taxes": flt(po.total_taxes_and_charges or 0),
        "grand_total": flt(po.grand_total or 0),
        "line_count": len(items),
        "invoiced_line_count": sum(1 for i in items if i["invoiced_on"]),
        "existing_purchase_invoices": sorted(set(invoiced.values())),
        "url": f"/app/purchase-order/{po.name}",
        "items": items,
    }


@frappe.whitelist()
def get_subcon_line_documents(po_dispatch=None):
    """Purchase Orders and Purchase Invoices behind one PIC line, in full.

    The list rows only carry a compact "name|milestone|state" CSV, which is
    enough for a table chip but useless in the detail view — it can't show the
    subcontractor's own bill reference or the invoice file PIC attached. This
    returns the documents properly, including each invoice's attachments.
    """
    _pic_role_or_throw()
    po_dispatch = (po_dispatch or "").strip()
    if not po_dispatch:
        frappe.throw("po_dispatch is required")

    def _state(docstatus):
        return {0: "Draft", 1: "Submitted", 2: "Cancelled"}.get(cint(docstatus), "?")

    orders = {}
    for r in frappe.db.sql("""
        SELECT po.name, po.docstatus, po.supplier, po.transaction_date,
               po.currency, po.grand_total, UPPER(IFNULL(poi.milestone,'')) AS milestone,
               -- THIS line's own quantity and value inside the order.
               -- grand_total is the whole document, which on a 26-line PO
               -- says nothing about what was ordered for this POID, and
               -- with two orders on one line there was no way at all to see
               -- which one carried how much.
               IFNULL(poi.qty, 0) AS qty, IFNULL(poi.rate, 0) AS rate,
               IFNULL(poi.amount, 0) AS amount
        FROM `tabPurchase Order Item` poi
        JOIN `tabPurchase Order` po ON po.name = poi.parent
        WHERE poi.poid = %s
        ORDER BY po.creation
    """, (po_dispatch,), as_dict=True):
        d = orders.setdefault(r.name, {
            "name": r.name, "state": _state(r.docstatus), "supplier": r.supplier,
            "date": str(r.transaction_date or ""),
            "currency": r.currency, "grand_total": flt(r.grand_total or 0),
            "milestones": [], "legs": [], "line_qty": 0.0, "line_amount": 0.0,
            "url": f"/app/purchase-order/{r.name}",
        })
        if r.milestone and r.milestone not in d["milestones"]:
            d["milestones"].append(r.milestone)
        d["legs"].append({"milestone": r.milestone or "—", "qty": flt(r.qty),
                          "rate": flt(r.rate), "amount": flt(r.amount)})
        d["line_qty"] = flt(d["line_qty"]) + flt(r.qty)
        d["line_amount"] = flt(d["line_amount"]) + flt(r.amount)

    invoices = {}
    for r in frappe.db.sql("""
        SELECT pi.name, pi.docstatus, pi.supplier, pi.bill_no, pi.bill_date, pi.posting_date,
               pi.currency, pi.grand_total, pii.purchase_order,
               UPPER(IFNULL(pii.milestone,'')) AS milestone,
               IFNULL(pii.qty, 0) AS qty, IFNULL(pii.rate, 0) AS rate,
               IFNULL(pii.amount, 0) AS amount
        FROM `tabPurchase Invoice Item` pii
        JOIN `tabPurchase Invoice` pi ON pi.name = pii.parent
        WHERE pii.poid = %s AND IFNULL(pii.payout_deduction, '') = ''
        ORDER BY pi.creation
    """, (po_dispatch,), as_dict=True):
        d = invoices.setdefault(r.name, {
            "name": r.name, "state": _state(r.docstatus), "supplier": r.supplier,
            "bill_no": r.bill_no or "", "bill_date": str(r.bill_date or ""),
            "posting_date": str(r.posting_date or ""),
            "currency": r.currency, "grand_total": flt(r.grand_total or 0),
            "purchase_order": r.purchase_order, "milestones": [],
            "legs": [], "line_qty": 0.0, "line_amount": 0.0,
            "attachments": [], "url": f"/app/purchase-invoice/{r.name}",
        })
        if r.milestone and r.milestone not in d["milestones"]:
            d["milestones"].append(r.milestone)
        d["legs"].append({"milestone": r.milestone or "—", "qty": flt(r.qty),
                          "rate": flt(r.rate), "amount": flt(r.amount)})
        d["line_qty"] = flt(d["line_qty"]) + flt(r.qty)
        d["line_amount"] = flt(d["line_amount"]) + flt(r.amount)

    # The supplier's invoice file, attached by the Receive Invoice action.
    if invoices:
        for f in frappe.db.get_all(
            "File",
            filters={"attached_to_doctype": "Purchase Invoice",
                     "attached_to_name": ["in", list(invoices)]},
            fields=["attached_to_name", "file_name", "file_url", "is_private"],
            order_by="creation",
        ):
            inv = invoices.get(f.attached_to_name)
            if inv is not None:
                inv["attachments"].append({
                    "file_name": f.file_name, "file_url": f.file_url,
                    "is_private": cint(f.is_private),
                })

    for d in list(orders.values()) + list(invoices.values()):
        d["milestones"].sort()

    return {
        "purchase_orders": list(orders.values()),
        "purchase_invoices": list(invoices.values()),
    }


# ── Manual status control ────────────────────────────────────────────────
@frappe.whitelist()
def bulk_update_subcon_po_status(po_dispatches, status, milestone="MS1",
                                 date=None, remark=None, from_statuses=None):
    """Set the purchase-side status on N lines at once.

    ``milestone``:
      * ``"MS1"`` / ``"MS2"`` — that milestone only.
      * ``"BOTH"``  — every milestone on the line that has an amount.
      * ``"AUTO"``  — every milestone whose CURRENT status is in
        ``from_statuses``. This is what the tab-specific actions use: the
        Invoiced tab's "Close" says from ``Purchase Invoice Submitted``, so PIC
        never has to tell it which leg to act on — it closes exactly what is
        actually invoiced and leaves an untouched MS2 alone.

    ``from_statuses`` (list, optional) also guards the explicit modes: a
    milestone whose current status isn't in it is skipped rather than jumped
    over its stage. Omit it for a free-form correction.

    Free-form by design otherwise: PIC may mark a milestone "Closed" with no
    Payment Entry in the system (Accounts pays outside this flow), and that is
    also how the pre-launch backlog gets cleared without raising back-dated
    POs. ``status`` of "" resets a milestone to Not Ordered, which is what
    makes it orderable again after a cancelled PO.
    """
    _pic_role_or_throw()
    if isinstance(po_dispatches, str):
        try:
            po_dispatches = frappe.parse_json(po_dispatches)
        except Exception:
            po_dispatches = [po_dispatches]
    names = [n for n in (po_dispatches or []) if n]
    if not names:
        frappe.throw("po_dispatches is required")

    status = (status or "").strip()
    if status and status not in SUB_PO_STATUSES:
        frappe.throw(f"status must be blank or one of: {', '.join(SUB_PO_STATUSES)}")

    mode = str(milestone or "MS1").strip().upper()
    if isinstance(from_statuses, str):
        try:
            from_statuses = frappe.parse_json(from_statuses)
        except Exception:
            from_statuses = [from_statuses]
    allowed_from = None
    if from_statuses is not None:
        allowed_from = {(s or "").strip() for s in _ensure_list(from_statuses)} or None
        # _ensure_list drops "" (a real status here), so re-add it explicitly.
        if any((s or "") == "" for s in (from_statuses or [])):
            allowed_from = (allowed_from or set()) | {""}

    if mode in ("BOTH", "AUTO"):
        target_ms = ["MS1", "MS2"]
    else:
        target_ms = [_norm_milestone(mode, "MS1")]

    stamp_date = getdate(date) if date else nowdate()

    # One batched resolve for the whole selection. Clearing the pre-launch
    # backlog is a ~1.6k-line operation, so a per-row lookup here would be
    # thousands of queries.
    lines = _batch_resolve_subcontracts(names)

    updated, old_values, skipped = [], {}, []
    touched_ms = set()
    for name in names:
        line = lines.get(name)
        if not line:
            skipped.append(f"{name}: not found")
            continue
        label = line.get("poid") or name

        updates = {}
        line_touched = []
        for ms in target_ms:
            n = _ms_num(ms)
            field = _status_field(ms)
            current = (line.get(field) or "").strip()

            # A milestone with no amount doesn't exist on this line.
            if flt(line.get(f"ms{n}_amount") or 0) <= 0:
                if mode not in ("BOTH", "AUTO"):
                    skipped.append(f"{label} ({ms}): no milestone amount")
                continue
            if allowed_from is not None and current not in allowed_from:
                if mode not in ("BOTH", "AUTO"):
                    skipped.append(f"{label} ({ms}): is '{current or 'Not Ordered'}'")
                continue
            if current == status:
                continue

            updates[field] = status
            # Deliberately does NOT stamp sub_po_amount. A stamped amount means
            # "an issued Purchase Order says so"; closing the backlog with no PO
            # must not fabricate one, or the payout summary's "Ordered" total
            # would silently absorb lines that were never ordered. Closed value
            # with no PO behind it falls back to the expected figure at report
            # time instead (see subcon_payout_summary).
            if status in _CLOSED_STATUSES:
                updates[f"sub_paid_date_ms{n}"] = stamp_date
            elif status == SUB_PO_NOT_ORDERED:
                updates[f"sub_paid_date_ms{n}"] = None
            if remark:
                updates[f"sub_po_remark_ms{n}"] = str(remark)[:500]

            old_values.setdefault(name, current)
            line_touched.append(ms)

        if not updates:
            continue
        frappe.db.set_value("PO Dispatch", name, updates, update_modified=True)
        _sync_overall_status(name)
        updated.append({"po_dispatch": name})
        touched_ms.update(line_touched)

    log_ms = list(touched_ms)[0] if len(touched_ms) == 1 else None
    _write_pic_activity_log(
        "Bulk Status Update" if len(updated) > 1 else "Single Status Update",
        log_ms, "sub_po_status", status or "(Not Ordered)", updated, old_values,
        remark=remark,
    )
    return {
        "updated": len(updated),
        "skipped": skipped,
        "status": status,
        "milestones": sorted(touched_ms),
    }


# ── Document hooks ───────────────────────────────────────────────────────
def _purchase_doc_lines(doc):
    """Yield (pd_name, milestone) for every item on a purchase doc tagged with
    a POID that still exists. Untagged rows (ordinary non-subcon purchases)
    are ignored, so these hooks are inert on the rest of the bench's buying."""
    for item in (doc.get("items") or []):
        pd_name = (item.get("poid") or "").strip()
        if not pd_name or (item.get("payout_deduction") or "").strip():
            continue
        ms = (item.get("milestone") or "").strip().upper()
        if ms not in ("MS1", "MS2"):
            continue
        if not frappe.db.exists("PO Dispatch", pd_name):
            continue
        yield pd_name, ms


def _set_status(pd_name, milestone, new_status, only_when=None, extra=None,
                subcontract=None):
    """Move one milestone to ``new_status``, optionally only from a given set.

    ``only_when`` guards against a hook stamping over a status PIC has since
    moved further along by hand — e.g. a late Payment Entry must not drag a
    line PIC already closed back to an earlier state.
    """
    field = _status_field(milestone)
    current = (frappe.db.get_value("PO Dispatch", pd_name, field) or "").strip()
    if only_when is not None and current not in only_when:
        return False
    updates = {field: new_status}
    if extra:
        updates.update(extra)
    frappe.db.set_value("PO Dispatch", pd_name, updates, update_modified=True)
    # Mirror onto the supplier's OWN allocation row. On a split line the line
    # level can only hold one answer, so without this the second supplier's PO
    # is invisible — and the lock that stops a re-derivation contradicting an
    # issued PO reads these columns. `subcontract` is the Subcontract Master
    # the PO was raised against; with none given (a hook that cannot tell), the
    # line has one allocation or none, and a single row is stamped.
    _mirror_status_to_allocation(pd_name, milestone, new_status, extra, subcontract)
    _sync_overall_status(pd_name)
    return True


def _mirror_status_to_allocation(pd_name, milestone, new_status, extra, subcontract):
    """Copy a milestone's PO status onto the allocation row it belongs to."""
    if not frappe.db.exists("DocType", "PO Subcontract Allocation"):
        return
    rows = frappe.get_all(
        "PO Subcontract Allocation",
        filters={"parent": pd_name, "parenttype": "PO Dispatch",
                 "parentfield": "subcontract_allocations"},
        fields=["name", "subcontractor"])
    if not rows:
        return
    sub = cstr(subcontract or "").strip()
    targets = [r for r in rows if cstr(r.subcontractor or "") == sub] if sub else \
        (rows if len(rows) == 1 else [])
    if not targets:
        return
    field = "sub_po_status_ms1" if _ms_num(milestone) == 1 else "sub_po_status_ms2"
    payload = {field: new_status}
    for k, v in (extra or {}).items():
        if k.endswith(("_ms1", "_ms2")) and frappe.db.has_column(
                "PO Subcontract Allocation", k):
            payload[k] = v
    for r in targets:
        frappe.db.set_value("PO Subcontract Allocation", r.name, payload,
                            update_modified=False)


def _advance_from_purchase_doc(doc, new_status, only_when=None, extra_by_ms=None,
                               dry_run=False):
    touched = []
    seen = set()
    # Which Subcontract Master each line on this document was ordered against,
    # so the status lands on that supplier's allocation row and not on a
    # sibling supplier's.
    subs = {}
    for i in (doc.get("items") or []):
        key = cstr(i.get("poid") or "").strip()
        sub = cstr(i.get("subcontract") or "").strip()
        if key and sub:
            subs.setdefault(key, sub)
    for pd_name, ms in _purchase_doc_lines(doc):
        if (pd_name, ms) in seen:
            continue
        seen.add((pd_name, ms))
        if dry_run:
            touched.append({"po_dispatch": pd_name, "milestone": ms})
            continue
        extra = (extra_by_ms or {}).get(ms) or {}
        if _set_status(pd_name, ms, new_status, only_when=only_when, extra=extra,
                       subcontract=subs.get(pd_name)):
            touched.append({"po_dispatch": pd_name, "milestone": ms})
    return touched


def before_purchase_order_submit(doc, method=None):
    """Refuse to submit a supplier PO whose line no longer names that supplier.

    A PO can sit in draft for days. In between, the line can be re-confirmed,
    re-planned or reconciled onto a different subcontractor — and submitting
    the stale draft would issue a real purchase order to someone the system no
    longer says did the work. Checked at submit rather than at creation because
    submit is the moment the document becomes real.

    Only the lines this PO actually carries are checked, so ordinary buying on
    the rest of the bench is untouched.
    """
    stale = []
    for pd_name, _ms in _purchase_doc_lines(doc):
        item_subs = {cstr(i.get("subcontract") or "").strip()
                     for i in (doc.get("items") or [])
                     if cstr(i.get("poid") or "").strip() == pd_name}
        item_subs.discard("")
        if not item_subs:
            continue
        allocated = {cstr(r.subcontractor or "").strip() for r in frappe.get_all(
            "PO Subcontract Allocation",
            filters={"parent": pd_name, "parenttype": "PO Dispatch",
                     "parentfield": "subcontract_allocations"},
            fields=["subcontractor"])}
        allocated.discard("")
        if not allocated:
            # No allocation rows at all — nothing to contradict, and the line's
            # own stamp is what the PO was built from in the first place.
            continue
        gone = item_subs - allocated
        if gone:
            poid = frappe.db.get_value("PO Dispatch", pd_name, "poid") or pd_name
            stale.append(f"{poid}: ordered to {', '.join(sorted(gone))}, but the line "
                         f"now says {', '.join(sorted(allocated))}")
    if stale:
        frappe.throw(
            "This purchase order no longer matches its lines:<br>• "
            + "<br>• ".join(stale)
            + "<br><br>Rebuild the purchase order from the Subcon PO page so it "
              "goes to the supplier the line actually names.",
            title="Subcontractor changed since this PO was drafted",
        )


def on_purchase_order_submit(doc, method=None):
    """Submitted supplier PO → "PO Submitted" (it can now be sent out)."""
    _advance_from_purchase_doc(
        doc, SUB_PO_SUBMITTED,
        only_when=(SUB_PO_NOT_ORDERED, SUB_PO_READY, SUB_PO_CREATED),
        extra_by_ms={"MS1": {"sub_po_date_ms1": doc.get("transaction_date") or nowdate()},
                     "MS2": {"sub_po_date_ms2": doc.get("transaction_date") or nowdate()}},
    )


def on_purchase_order_update_after_submit(doc, method=None):
    """"Update Items" changed a submitted PO → re-stamp what PIC reads.

    ERPNext lets a submitted Purchase Order have its quantities and rates
    edited in place, without cancelling it, and nothing else here sees that:
    ``before_submit`` and ``on_submit`` have already run, so
    ``sub_po_amount_ms{n}`` keeps the figure from the ORIGINAL order while the
    document the supplier holds says something else. The tracker then reports
    a number no document supports.

    Found correcting five Imdad orders from 80% to 85%: the orders changed,
    every milestone kept its 80% stamp, and the only thing that noticed was a
    manual re-stamp afterwards. Correcting a quantity — ordering 5 of 6 after
    the fact — has the same hole.

    The quantity side needs no help beyond this: the To Order tab reads live
    Purchase Order Item quantities through the oq1/oq2 joins, so reducing an
    order from 6 to 5 puts the remaining 1 back on that tab by itself.

    A row REMOVED from the order is the one case that needs more than a
    re-stamp — the milestone has no order behind it any more, so it goes back
    to Ready to Order exactly as a cancel would leave it.
    """
    before = doc.get_doc_before_save()

    by_ms = {}
    for item in (doc.get("items") or []):
        pd_name = cstr(item.get("poid") or "").strip()
        ms = cstr(item.get("milestone") or "").strip().upper()
        if not pd_name or ms not in ("MS1", "MS2"):
            continue
        key = (pd_name, ms)
        # Summed, not overwritten: one order may carry two rows for the same
        # milestone, and the stamp is what the order says in total.
        entry = by_ms.setdefault(key, {"amount": 0.0, "pct": 0.0})
        entry["amount"] += flt(item.get("amount") or 0)
        entry["pct"] = flt(item.get("payout_pct") or 0) or entry["pct"]

    for key in by_ms:
        pd_name = key[0]
        n = _ms_num(key[1])
        if not frappe.db.exists("PO Dispatch", pd_name):
            continue
        new_pct = flt(by_ms[key]["pct"])
        new_amount = round(flt(by_ms[key]["amount"]), 2)
        now = frappe.db.get_value(
            "PO Dispatch", pd_name,
            [f"sub_po_pct_ms{n}", f"sub_po_amount_ms{n}"], as_dict=True) or {}
        if (flt(now.get(f"sub_po_pct_ms{n}")) == new_pct
                and flt(now.get(f"sub_po_amount_ms{n}")) == new_amount):
            continue  # nothing moved on this milestone
        payload = {f"sub_po_pct_ms{n}": new_pct,
                   f"sub_po_amount_ms{n}": new_amount}
        frappe.db.set_value("PO Dispatch", pd_name,
                            dict(payload, sub_po_supplier=doc.get("supplier")),
                            update_modified=True)
        _mirror_amount_to_allocation(pd_name, n, payload)
        _sync_overall_status(pd_name)

    if not before:
        return
    gone = set()
    for item in (before.get("items") or []):
        pd_name = cstr(item.get("poid") or "").strip()
        ms = cstr(item.get("milestone") or "").strip().upper()
        if pd_name and ms in ("MS1", "MS2") and (pd_name, ms) not in by_ms:
            gone.add((pd_name, ms))
    for key in gone:
        # Another live order may still cover it — only the last one leaving
        # means the milestone is unordered.
        still = frappe.db.sql(
            """SELECT 1 FROM `tabPurchase Order Item` poi
                JOIN `tabPurchase Order` po ON po.name = poi.parent AND po.docstatus < 2
               WHERE poi.poid = %s AND UPPER(IFNULL(poi.milestone,'')) = %s LIMIT 1""",
            (key[0], key[1]))
        if still:
            continue
        n = _ms_num(key[1])
        _set_status(key[0], key[1], SUB_PO_READY,
                    only_when=(SUB_PO_CREATED, SUB_PO_SUBMITTED,
                               SUB_PO_BILL_RECEIVED, SUB_PO_PI_SUBMITTED),
                    extra={f"sub_po_pct_ms{n}": 0,
                           f"sub_po_amount_ms{n}": 0,
                           f"sub_po_date_ms{n}": None,
                           f"sub_paid_date_ms{n}": None})


def _mirror_amount_to_allocation(pd_name, n, payload):
    """Keep the allocation row's copy of the stamped figures in step.

    _set_status does this through _mirror_status_to_allocation; this path
    writes the fields directly, so the mirror is made here or the reconcile
    screen shows an allocation still carrying the old order.
    """
    if not frappe.db.exists("DocType", "PO Subcontract Allocation"):
        return
    rows = frappe.get_all(
        "PO Subcontract Allocation",
        filters={"parent": pd_name, "parenttype": "PO Dispatch",
                 "parentfield": "subcontract_allocations"},
        fields=["name"])
    if len(rows) != 1:
        return  # split line: which leg this order belongs to is not ours to guess
    mirror = {k: v for k, v in payload.items()
              if frappe.db.has_column("PO Subcontract Allocation", k)}
    if mirror:
        frappe.db.set_value("PO Subcontract Allocation", rows[0].name, mirror,
                            update_modified=False)


def _reset_milestone(doc, only_when):
    """Send a milestone back to "Ready to Order" and clear what the PO stamped.

    Shared by the cancel and delete hooks: with no subcon-side "cancelled"
    status, a supplier PO that goes away simply means the milestone is not
    ordered right now. It returns to the To Order tab with no stale amount, %,
    or date left behind.

    Ready to Order, not blank: losing the order does not undo PIC's decision
    that the milestone was ready to order — the milestone had to be orderable
    for the PO to exist at all, so the readiness still holds and the line is
    immediately re-orderable (including by the Auto create mode). PIC can still
    clear it deliberately with the "Reset to Not Ordered" status action.

    Cancellation of the *work* is a customer-side concept (dispatch_status /
    pic_status) and is untouched here.
    """
    for pd_name, ms in _purchase_doc_lines(doc):
        n = _ms_num(ms)
        _set_status(pd_name, ms, SUB_PO_READY, only_when=only_when,
                    extra={f"sub_po_pct_ms{n}": 0,
                           f"sub_po_amount_ms{n}": 0,
                           f"sub_po_date_ms{n}": None,
                           f"sub_paid_date_ms{n}": None})


def on_purchase_order_cancel(doc, method=None):
    """Cancelled supplier PO → back to Not Ordered, so it can be re-ordered.

    Deliberately does not touch a milestone PIC has already Closed by hand —
    a late cancel of the paperwork must not un-close settled money.
    """
    _reset_milestone(doc, only_when=(SUB_PO_CREATED, SUB_PO_SUBMITTED,
                                     SUB_PO_BILL_RECEIVED, SUB_PO_PI_SUBMITTED))


def on_purchase_order_trash(doc, method=None):
    """Deleted draft PO → back to Not Ordered.

    Without this a deleted draft would leave the line stuck at "PO Created"
    forever — never orderable again, and never visible on the To Order tab.
    """
    _reset_milestone(doc, only_when=(SUB_PO_CREATED,))


def on_purchase_invoice_submit(doc, method=None):
    """Submitted supplier Purchase Invoice → "Purchase Invoice Submitted"."""
    _advance_from_purchase_doc(
        doc, SUB_PO_PI_SUBMITTED,
        only_when=(SUB_PO_NOT_ORDERED, SUB_PO_READY, SUB_PO_CREATED,
                   SUB_PO_SUBMITTED, SUB_PO_BILL_RECEIVED),
    )


def on_purchase_invoice_cancel(doc, method=None):
    """Cancelled Purchase Invoice → back to "PO Submitted"."""
    _advance_from_purchase_doc(
        doc, SUB_PO_SUBMITTED,
        only_when=(SUB_PO_PI_SUBMITTED,),
    )


def on_purchase_invoice_trash(doc, method=None):
    """Deleted Purchase Invoice → back to "PO Submitted".

    A DRAFT invoice is deleted, not cancelled, so on_cancel never fires and
    without this the line would sit at "Invoice Received" for a bill that no
    longer exists — invisible on the Ordered tab and impossible to re-invoice.
    The Purchase Order side has had this since the start; the invoice side
    was missed.

    Only from "Invoice Received": a submitted invoice must be cancelled before
    it can be deleted, and that cancel has already returned the line to
    "PO Submitted", so this is a no-op on that path rather than a double revert.
    Partial invoicing means the doc's own items decide which milestones revert,
    so deleting one instalment leaves the other one's lines alone.
    """
    _advance_from_purchase_doc(
        doc, SUB_PO_SUBMITTED,
        only_when=(SUB_PO_BILL_RECEIVED,),
    )


def _subcon_lines_from_payment_entry(pe_doc):
    """(pd_name, milestone) pairs behind a Payment Entry's Purchase Invoices.

    The purchase mirror of _po_dispatch_names_from_payment_entry in pic.py.
    Purchase Orders are skipped: paying against a PO directly (an advance)
    isn't the subcontractor bill being settled, so it must not close a line.
    """
    out = []
    for ref in (pe_doc.get("references") or []):
        if (ref.get("reference_doctype") or "") != "Purchase Invoice":
            continue
        pi_name = (ref.get("reference_name") or "").strip()
        if not pi_name:
            continue
        try:
            items = frappe.db.get_all(
                "Purchase Invoice Item",
                filters={"parent": pi_name},
                fields=["poid", "milestone", "payout_deduction"],
            )
        except Exception:
            continue
        for item in items:
            if (item.get("payout_deduction") or "").strip():
                continue  # a deduction's third-party bill, not the subcontractor's
            pd_name = (item.get("poid") or "").strip()
            ms = (item.get("milestone") or "").strip().upper()
            if pd_name and ms in ("MS1", "MS2") and frappe.db.exists("PO Dispatch", pd_name):
                out.append((pd_name, ms))
    return out


def on_payment_entry_submit(doc, method=None):
    """Accounts paid the supplier → "Closed" + stamp the date.

    PIC can also close a milestone by hand, so this only advances a line
    that's still sitting at an earlier purchase-side status — it never
    overwrites a close PIC already made by hand, or re-stamps a closed line.
    """
    seen = set()
    for pd_name, ms in _subcon_lines_from_payment_entry(doc):
        if (pd_name, ms) in seen:
            continue
        seen.add((pd_name, ms))
        n = _ms_num(ms)
        _set_status(
            pd_name, ms, SUB_PO_CLOSED,
            only_when=(SUB_PO_READY, SUB_PO_CREATED, SUB_PO_SUBMITTED,
                       SUB_PO_BILL_RECEIVED, SUB_PO_PI_SUBMITTED),
            extra={f"sub_paid_date_ms{n}": doc.get("posting_date") or nowdate()},
        )


def on_payment_entry_cancel(doc, method=None):
    """Reversed supplier payment → back to "Purchase Invoice Submitted"."""
    seen = set()
    for pd_name, ms in _subcon_lines_from_payment_entry(doc):
        if (pd_name, ms) in seen:
            continue
        seen.add((pd_name, ms))
        n = _ms_num(ms)
        _set_status(
            pd_name, ms, SUB_PO_PI_SUBMITTED,
            only_when=(SUB_PO_CLOSED,),
            extra={f"sub_paid_date_ms{n}": None},
        )


# ── Payout summary ───────────────────────────────────────────────────────
@frappe.whitelist()
def subcon_payout_summary(portal_filters=None):
    """Supplier payout rollup — the purchase mirror of pic_invoicing_summary.

    Rebuilt to use the SAME stage vocabulary as the Subcon PO page's tabs, so
    the two never tell different stories:

        Payout = Not Ordered + Ready + Ordered + Invoiced + Closed

    That is a real partition, and the FE asserts it. It works because every
    figure is derived from one base — ``_payout_shown_sql``, i.e. the amount on
    the issued PO where there is one and the master-% expectation otherwise —
    rather than mixing an "expected" and a "stamped" number that drift apart the
    moment a Subcontract Master percentage is edited after ordering.

    ``Ordered`` here means "PO raised, not yet invoiced" (PO Created / PO
    Submitted) rather than the old "has a stamped amount", which silently
    included invoiced and closed lines and so could never partition.
    ``Invoiced`` follows the Invoiced tab and counts a recorded supplier bill
    whether or not Accounts has submitted the Purchase Invoice.
    ``closed_no_po`` stays as a subset of Closed: work closed with no PO behind
    it, i.e. the pre-launch backlog.

    Two grains are returned, on purpose:

    * ``by_status`` — grain (line, milestone). This is the money view, and it is
      why no "Partially …" value appears in it: a MILESTONE is never partially
      anything. A line with MS1 closed and MS2 unordered puts its MS1 payout in
      Closed and its MS2 payout in Not Ordered, which is the only split that
      states both correctly.
    * ``by_line_status`` — grain (line), grouped on the stored rollup
      ``pd.sub_po_status``, so the "Partially …" values do appear. Use it to
      count LINES by overall position; its payout column is the line's whole
      payout, which by definition cannot be split across stages.

    Both grains report the same total payout, so they reconcile.
    """
    _pic_role_or_throw()
    pf = _portal_filters_dict(portal_filters)

    where = ["1=1"] + list(_SUBCON_BASE_WHERE)
    params = []
    for col, key in (
        ("pd.project_code", "project_code"),
        ("pd.im", "im"),
        ("sm.name", "subcontract"),
        ("sm.contract_model", "contract_model"),
        ("sm.supplier", "supplier"),
        ("pd.dispatch_status", "dispatch_status"),
    ):
        c, p = _sql_in_or_eq(col, pf.get(key))
        if c:
            where.append(c)
            params.extend(p)
    _po_date_sql, _po_date_params = _supplier_po_date_filter(pf)
    if _po_date_sql:
        where.append(_po_date_sql)
        params.extend(_po_date_params)
    # Customer-invoice window — what a Command Dashboard drill-through sends.
    _inv_sql, _inv_params = subcon_invoice_window(pf)
    if _inv_sql:
        where.append(_inv_sql)
        params.extend(_inv_params)
    where_sql = " AND ".join(where)

    # One UNION leg per milestone: the grain of this report is (line, milestone),
    # exactly like the PO line it corresponds to.
    legs = []
    for n in (1, 2):
        legs.append(f"""
          SELECT sm.supplier AS supplier, sm.name AS subcontract,
                 sm.contract_model AS contract_model,
                 {_ms_status_sql(n)} AS status,
                 {_ms_amount_sql(n)} AS ms_amount,
                 {_inet_amount_sql(n)} AS inet_amount,
                 {_payout_shown_sql(n)} AS payout,
                 {_vat_sql(n)} AS vat,
                 IFNULL(pd.sub_po_amount_ms{n}, 0) AS stamped
          {_SUBCON_FROM_JOIN}
          WHERE {where_sql} AND IFNULL(pd.ms{n}_amount, 0) > 0
        """)
    union = " UNION ALL ".join(legs)
    all_params = tuple(params) * 2

    def _stage(statuses, alias):
        vals = ", ".join(f"'{v}'" for v in statuses)
        return f"COALESCE(SUM(CASE WHEN status IN ({vals}) THEN payout ELSE 0 END), 0) AS {alias}"

    agg_cols = f"""
        COUNT(*) AS row_count,
        COALESCE(SUM(ms_amount), 0) AS ms_amount,
        COALESCE(SUM(inet_amount), 0) AS inet_amount,
        COALESCE(SUM(payout), 0) AS payout,
        COALESCE(SUM(vat), 0) AS vat,
        {_stage([SUB_PO_NOT_ORDERED], 'not_ordered')},
        {_stage([SUB_PO_READY], 'ready')},
        {_stage([SUB_PO_CREATED, SUB_PO_SUBMITTED], 'ordered')},
        {_stage(list(_INVOICED_STATUSES), 'invoiced')},
        {_stage([SUB_PO_CLOSED], 'closed')},
        COALESCE(SUM(CASE WHEN status = '{SUB_PO_CLOSED}' AND stamped = 0
                          THEN payout ELSE 0 END), 0) AS closed_no_po
    """

    by_status_raw = frappe.db.sql(
        f"SELECT status, {agg_cols} FROM ({union}) u GROUP BY status",
        all_params, as_dict=True)

    # A row for EVERY rung, zero-filled, in ladder order. A status report whose
    # rows appear and vanish with the data can't be read as a pipeline —
    # "nothing is at Invoice Received" is itself the answer.
    _seen = {(r["status"] or ""): r for r in by_status_raw}
    _zero = {"row_count": 0, "ms_amount": 0.0, "inet_amount": 0.0, "payout": 0.0, "vat": 0.0,
             "not_ordered": 0.0, "ready": 0.0, "ordered": 0.0, "invoiced": 0.0,
             "closed": 0.0, "closed_no_po": 0.0}
    by_status = []
    for st in [SUB_PO_NOT_ORDERED] + SUB_PO_STATUSES:
        r = dict(_seen.get(st) or dict(_zero, status=st))
        r["status"] = st or "Not Ordered"
        by_status.append(r)

    # Line grain, grouped on the stored rollup — this is where the
    # "Partially …" values live. One row per line, so its payout is the line's
    # whole payout and cannot be attributed to a single stage.
    line_payout = f"({_payout_shown_sql(1)} + {_payout_shown_sql(2)})"
    line_inet = f"({_inet_amount_sql(1)} + {_inet_amount_sql(2)})"
    line_vat = f"({_vat_sql(1)} + {_vat_sql(2)})"
    by_line_raw = frappe.db.sql(
        f"""
        SELECT IFNULL(pd.sub_po_status, '') AS status,
               COUNT(*) AS row_count,
               COALESCE(SUM({_ms_amount_sql(1)} + {_ms_amount_sql(2)}), 0) AS ms_amount,
               COALESCE(SUM({line_inet}), 0) AS inet_amount,
               COALESCE(SUM({line_payout}), 0) AS payout,
               COALESCE(SUM({line_vat}), 0) AS vat
        {_SUBCON_FROM_JOIN}
        WHERE {where_sql}
          AND (IFNULL(pd.ms1_amount, 0) > 0 OR IFNULL(pd.ms2_amount, 0) > 0)
        GROUP BY IFNULL(pd.sub_po_status, '')
        """,
        tuple(params), as_dict=True)
    # No blank-vs-label remap here: the stored rollup holds the literal
    # "Not Ordered" (_compute_overall_status returns the label), and writes ''
    # only for a line with no milestone amounts at all — which the WHERE above
    # already excludes. Treating "Not Ordered" as blank silently dropped every
    # untouched line and left the two grains failing to reconcile.
    _seen_line = {(r["status"] or ""): r for r in by_line_raw}
    by_line_status = []
    for st in SUB_PO_OVERALL_STATUSES:
        r = dict(_seen_line.get(st) or {
            "status": st, "row_count": 0, "ms_amount": 0.0, "inet_amount": 0.0,
            "payout": 0.0, "vat": 0.0})
        r["status"] = st
        by_line_status.append(r)

    by_supplier = frappe.db.sql(
        f"""SELECT IFNULL(supplier, '') AS supplier, subcontract, contract_model, {agg_cols}
            FROM ({union}) u
            GROUP BY supplier, subcontract, contract_model
            ORDER BY payout DESC""",
        all_params, as_dict=True)

    tot = lambda k: round(sum(flt(r[k]) for r in by_status), 2)

    # Payout falling INSIDE the customer-invoice window, when one was given.
    # The stage totals above are whole-milestone figures on the lines shown;
    # this one is event-scaled, so a milestone invoiced in two parts
    # contributes only the part that falls in the window. It is the figure
    # that must equal the Command Dashboard's Sub-Con Expense tile, which is
    # why it is computed from the same subcon_payout_events_sql() the tile
    # uses rather than re-derived here.
    period_payout = None
    if pf.get("invoice_from_date") or pf.get("invoice_to_date"):
        _p_where, _p_params = ["1=1"], []
        if pf.get("invoice_from_date"):
            _p_where.append("ev.event_date >= %s")
            _p_params.append(pf["invoice_from_date"])
        if pf.get("invoice_to_date"):
            _p_where.append("ev.event_date <= %s")
            _p_params.append(pf["invoice_to_date"])
        _pr = frappe.db.sql(
            f"""SELECT COALESCE(SUM(ev.payout), 0) AS payout,
                       COALESCE(SUM(ev.revenue), 0) AS revenue,
                       COALESCE(SUM(ev.inet_margin), 0) AS inet_margin,
                       COUNT(*) AS events
                FROM ({subcon_payout_events_sql()}) ev
                WHERE {' AND '.join(_p_where)}""",
            tuple(_p_params), as_dict=True)
        _pr = (_pr[0] if _pr else {}) or {}
        period_payout = {
            "payout": round(flt(_pr.get("payout")), 2),
            "revenue": round(flt(_pr.get("revenue")), 2),
            "inet_margin": round(flt(_pr.get("inet_margin")), 2),
            "events": cint(_pr.get("events")),
            "from_date": pf.get("invoice_from_date"),
            "to_date": pf.get("invoice_to_date"),
        }

    return {
        "period_payout": period_payout,
        "top": {
            "inet_total": tot("inet_amount"),
            "payout_total": tot("payout"),
            "vat_total": tot("vat"),
            "gross_total": round(tot("payout") + tot("vat"), 2),
            "not_ordered_total": tot("not_ordered"),
            "ready_total": tot("ready"),
            "ordered_total": tot("ordered"),
            "invoiced_total": tot("invoiced"),
            "closed_total": tot("closed"),
            "closed_no_po_total": tot("closed_no_po"),
        },
        "by_status": [dict(r) for r in by_status],
        "by_line_status": by_line_status,
        "by_supplier": [dict(r) for r in by_supplier],
    }


@frappe.whitelist()
def get_subcon_po_capability():
    """FE bootstrap: can this session use the Subcon PO pages, and is the
    bench configured for them (purchase VAT template set, suppliers linked)?"""
    roles = set(frappe.get_roles(frappe.session.user))
    unlinked = frappe.db.get_all(
        "Subcontract Master",
        filters={"type": "SUB", "status": "Active", "supplier": ["in", ["", None]]},
        pluck="name",
    )
    return {
        "is_pic": bool(roles & {"INET PIC"}),
        "is_admin": bool(roles & PM_LEVEL_ROLES),
        "purchase_tax_template": frappe.db.get_single_value("INET Settings", "purchase_tax_template"),
        "schedule_days": cint(frappe.db.get_single_value("INET Settings", "subcon_po_schedule_days")) or 30,
        "contracts_without_supplier": unlinked,
    }
