"""When a thing happened — decided once, for every dashboard and report.

Two screens asking the same question must give the same answer. "Invoiced in
October" has to mean one thing on the Command Dashboard, on PIC Overview, in
the Monthly Roll-up and in every export, or the figures argue with each other
and nobody can tell which is right. That is what this module is for: each
business event has exactly one date expression, written here, imported
everywhere.

THE RULE: THE DOCUMENT WINS.

A milestone is invoiced when a Sales Invoice says so, paid when a Payment
Entry says so, ordered when a Purchase Order says so. Those documents are
created by the system, carry their own posting date, and correct themselves —
cancel the invoice and the date is gone; re-issue it and the new date stands.
Nothing has to be remembered or re-typed.

The stored date columns on PO Dispatch (``ms1_invoice_month``,
``ms1_payment_received_date``,
``sub_po_date_ms1``, ``sub_paid_date_ms1``) are a FALLBACK, never the first
answer. They came from the Master Tracker import, from before the portal
raised its own documents, and they are the only record those older lines have.
They must keep working — but a surface that reads them FIRST goes blind the
moment the document flow takes over, which is exactly what happened to PIC
Overview: it filtered on ``ms1_applied_date``, nothing has written that column
since 2026-09-10, and the four headline figures read 0.00 while the report
underneath them showed 209,438.56 for the same month.

So every ladder below is: document first, stored column second, oldest and
least reliable column last.

ON MIN(): where several documents cover one milestone — a milestone billed in
parts, or paid in instalments — these answer "when did this start", because a
line-level date filter asks which period a LINE belongs to. Money that has to
be split across the periods it actually landed in is a different question,
answered per document rather than per line (see subcon_payout_events_sql).
"""

CUSTOMER_BILLED_STATUSES = ("Commercial Invoice Submitted", "Commercial Invoice Closed")


def _ms(n):
    if n not in (1, 2):
        raise ValueError("milestone must be 1 or 2")
    return n


def _nz(col):
    """A date column that is empty rather than NULL still has to read as unset."""
    return f"NULLIF({col}, '0000-00-00')"


def customer_invoiced_date(n, pd="pd"):
    """When this milestone was invoiced to the customer.

    Sales Invoice posting date, then the imported IBUY / INV date, then the
    imported invoice month.

    ``ms{n}_ibuy_inv_date`` is the real invoice DATE: checked against the
    "Invoices Data" sheet the import came from, it matches that sheet's
    Invoice Date on 14,585 of 15,013 rows (97%), and the rest differ by a
    day. ``ms{n}_invoice_month`` is the month BUCKET, stored as the 1st —
    it equals the real date on only 272 rows. Both name the same month on
    all but one line, so monthly totals barely care; a day-level filter
    cares a great deal, because every legacy line would otherwise claim to
    have been invoiced on the 1st.

    ``ms{n}_applied_date`` is deliberately not a rung: it is when a line was
    APPLIED for, not when it was billed. A milestone with no date on any
    rung is reported as undated rather than guessed at.
    """
    _ms(n)
    return (
        "COALESCE("
        f" (SELECT MIN(si_d.posting_date) FROM `tabSales Invoice Item` sii_d"
        f"    JOIN `tabSales Invoice` si_d ON si_d.name = sii_d.parent AND si_d.docstatus = 1"
        f"   WHERE sii_d.poid = {pd}.name AND IFNULL(sii_d.milestone, '') = 'MS{n}'),"
        f" {_nz(f'{pd}.ms{n}_ibuy_inv_date')},"
        f" {_nz(f'{pd}.ms{n}_invoice_month')})"
    )


def customer_paid_date(n, pd="pd"):
    """When the customer's payment landed for this milestone.

    Payment Entry posting date — reached through the Sales Invoice it settles —
    then the stored received date.
    """
    _ms(n)
    return (
        "COALESCE("
        f" (SELECT MIN(pe_d.posting_date) FROM `tabPayment Entry Reference` per_d"
        f"    JOIN `tabPayment Entry` pe_d ON pe_d.name = per_d.parent AND pe_d.docstatus = 1"
        f"    JOIN `tabSales Invoice Item` sii_p ON sii_p.parent = per_d.reference_name"
        f"   WHERE per_d.reference_doctype = 'Sales Invoice'"
        f"     AND sii_p.poid = {pd}.name AND IFNULL(sii_p.milestone, '') = 'MS{n}'),"
        f" {_nz(f'{pd}.ms{n}_payment_received_date')})"
    )


def supplier_ordered_date(n, pd="pd"):
    """When the supplier PO for this milestone was raised.

    Purchase Order transaction date, then the date the hook stamped. Supplier
    documents carry ``poid`` on their item rows exactly as the customer ones
    do, so the lookup is the same shape.
    """
    _ms(n)
    return (
        "COALESCE("
        f" (SELECT MIN(po_d.transaction_date) FROM `tabPurchase Order Item` poi_d"
        f"    JOIN `tabPurchase Order` po_d ON po_d.name = poi_d.parent AND po_d.docstatus = 1"
        f"   WHERE poi_d.poid = {pd}.name AND IFNULL(poi_d.milestone, '') = 'MS{n}'),"
        f" {_nz(f'{pd}.sub_po_date_ms{n}')})"
    )


def supplier_invoiced_date(n, pd="pd"):
    """When the supplier billed us for this milestone.

    Purchase Invoice posting date. There is no stored fallback — this event was
    never recorded on PO Dispatch before the documents existed.
    """
    _ms(n)
    return (
        f"(SELECT MIN(pi_d.posting_date) FROM `tabPurchase Invoice Item` pii_d"
        f"   JOIN `tabPurchase Invoice` pi_d ON pi_d.name = pii_d.parent AND pi_d.docstatus = 1"
        f"  WHERE pii_d.poid = {pd}.name AND IFNULL(pii_d.milestone, '') = 'MS{n}')"
    )


def supplier_paid_date(n, pd="pd"):
    """When we paid the supplier for this milestone.

    Payment Entry posting date — through the Purchase Invoice it settles —
    then the stored closed date.
    """
    _ms(n)
    return (
        "COALESCE("
        f" (SELECT MIN(pe_s.posting_date) FROM `tabPayment Entry Reference` per_s"
        f"    JOIN `tabPayment Entry` pe_s ON pe_s.name = per_s.parent AND pe_s.docstatus = 1"
        f"    JOIN `tabPurchase Invoice Item` pii_s ON pii_s.parent = per_s.reference_name"
        f"   WHERE per_s.reference_doctype = 'Purchase Invoice'"
        f"     AND pii_s.poid = {pd}.name AND IFNULL(pii_s.milestone, '') = 'MS{n}'),"
        f" {_nz(f'{pd}.sub_paid_date_ms{n}')})"
    )


def customer_invoice_events_sql():
    """``(po_dispatch, milestone, event_date, amount)`` — ONE ROW PER INVOICE.

    Per invoice, not per milestone. A milestone billed in two parts is two
    rows, each on its own posting date carrying its own amount, so the money
    lands in the months it was actually billed in. Dating the milestone by
    its first invoice put the whole amount in the earlier month: a line
    billed 54.00 in September and 27.00 in October showed 81.00 in September
    and nothing in October.

    USE THIS TO FILTER AND TO SUM. The scalar expressions above are
    correlated subqueries — fine in a SELECT over a page of rows, ruinous in
    a WHERE over the whole table. Filtering 22,833 dispatch lines that way
    measured 6m45s even with `poid` indexed; joined as a derived table it is
    one pass.

    Two legs, the same two rungs as everywhere: the Sales Invoice, then the
    imported month for milestones billed before the portal raised invoices.
    The legacy leg carries the whole milestone as a single event, because
    that is all the import recorded — it has no per-invoice detail to split.
    """
    legs = []
    for n in (1, 2):
        legs.append(f"""
        SELECT sii_e.poid AS po_dispatch, 'MS{n}' AS milestone,
               si_e.posting_date AS event_date,
               IFNULL(sii_e.amount, 0) AS amount
          FROM `tabSales Invoice Item` sii_e
          JOIN `tabSales Invoice` si_e ON si_e.name = sii_e.parent AND si_e.docstatus = 1
         WHERE IFNULL(sii_e.poid, '') != '' AND IFNULL(sii_e.milestone, '') = 'MS{n}'
        """)
        # The legacy leg is what the import recorded MINUS whatever the
        # documents already account for. A milestone invoiced partly outside
        # the system and partly inside holds both: suppressing the legacy
        # half whenever any Sales Invoice existed moved its money onto the
        # system invoice's date, which is a different month. Emitting only
        # the uncovered remainder keeps each half on its own date and never
        # double counts.
        _sys_sum = (
            f"(SELECT COALESCE(SUM(sii_s.amount), 0)"
            f"   FROM `tabSales Invoice Item` sii_s"
            f"   JOIN `tabSales Invoice` si_s ON si_s.name = sii_s.parent"
            f"        AND si_s.docstatus = 1"
            f"  WHERE sii_s.poid = pd_e.name"
            f"    AND IFNULL(sii_s.milestone, '') = 'MS{n}')"
        )
        _recorded = (
            f"CASE WHEN IFNULL(pd_e.ms{n}_invoiced, 0) > 0"
            f"     THEN pd_e.ms{n}_invoiced ELSE IFNULL(pd_e.ms{n}_amount, 0) END"
        )
        legs.append(f"""
        SELECT pd_e.name AS po_dispatch, 'MS{n}' AS milestone,
               COALESCE({_nz(f'pd_e.ms{n}_ibuy_inv_date')},
                        {_nz(f'pd_e.ms{n}_invoice_month')}) AS event_date,
               ROUND({_recorded} - {_sys_sum}, 4) AS amount
          FROM `tabPO Dispatch` pd_e
         WHERE IFNULL(pd_e.is_internal_work, 0) = 0
           AND {customer_billed_ms_sql(n, 'pd_e')}
           AND ROUND({_recorded} - {_sys_sum}, 4) > 0.0001
        """)
    return " UNION ALL ".join(legs)


def invoiced_amount_in_period_sql(n, from_date, to_date, pd="pd"):
    """``(join_sql, params, column)`` — this milestone's invoiced value INSIDE
    the window, as a LEFT JOIN rather than a per-row subquery.

    What a period report must sum. Summing ``ms{n}_invoiced`` and filtering
    the line by date counts the milestone's WHOLE value in whichever month it
    first appears; this counts only the invoices that actually fall in the
    window.
    """
    _ms(n)
    conds, params = ["1=1"], []
    if from_date:
        conds.append("ev_a.event_date >= %s")
        params.append(from_date)
    if to_date:
        conds.append("ev_a.event_date <= %s")
        params.append(to_date)
    alias = f"evw{n}"
    join = (
        f"LEFT JOIN (SELECT ev_a.po_dispatch, SUM(ev_a.amount) AS amt"
        f"             FROM ({customer_invoice_events_sql()}) ev_a"
        f"            WHERE ev_a.milestone = 'MS{n}' AND {' AND '.join(conds)}"
        f"            GROUP BY ev_a.po_dispatch) {alias}"
        f"       ON {alias}.po_dispatch = {pd}.name"
    )
    return join, params, f"IFNULL({alias}.amt, 0)"


def customer_billed_ms_sql(n, pd="pd"):
    """PIC says this milestone has been invoiced to the customer."""
    _ms(n)
    col = f"{pd}.pic_status" if n == 1 else f"{pd}.pic_status_ms2"
    vals = ", ".join("'%s'" % v for v in CUSTOMER_BILLED_STATUSES)
    return f"IFNULL({col}, '') IN ({vals})"


def line_invoiced_date(pd="pd"):
    """When this LINE first went out to the customer, either milestone.

    What a page means by "invoiced in this period" when it is filtering lines
    rather than milestones.
    """
    return f"LEAST(COALESCE({customer_invoiced_date(1, pd)}, '9999-12-31'), " \
           f"COALESCE({customer_invoiced_date(2, pd)}, '9999-12-31'))"


def invoiced_in_period_clause(from_date, to_date, pd="pd"):
    """``(sql, params)`` for "this line was invoiced inside the period".

    An IN against the event table, materialised once, rather than a
    correlated test per row: 0.12s against 6m45s for the same month and the
    same 262 lines. Append it to a WHERE list; nothing else about the
    caller's query has to change.

    Either milestone inside the window puts the line in it — a line billed
    MS1 in September and MS2 in October genuinely belongs to both months.
    """
    if not from_date and not to_date:
        return "", []
    conds, params = [], []
    if from_date:
        conds.append("ev_p.event_date >= %s")
        params.append(from_date)
    if to_date:
        conds.append("ev_p.event_date <= %s")
        params.append(to_date)
    return (
        f"{pd}.name IN (SELECT ev_p.po_dispatch FROM ({customer_invoice_events_sql()}) ev_p"
        f" WHERE {' AND '.join(conds)})",
        params,
    )


def milestone_invoiced_in_period_clause(n, from_date, to_date, pd="pd"):
    """``(sql, params)`` for "THIS milestone was invoiced inside the period".

    The per-milestone twin of invoiced_in_period_clause. A report whose money
    is split MS1/MS2 has to filter each half on its own date, or a line billed
    MS1 in September and MS2 in October drags both amounts into both months —
    which is how a summary and the monthly roll-up beside it end up
    disagreeing about the same period.
    """
    _ms(n)
    if not from_date and not to_date:
        return "", []
    conds, params = [], []
    if from_date:
        conds.append("ev_m.event_date >= %s")
        params.append(from_date)
    if to_date:
        conds.append("ev_m.event_date <= %s")
        params.append(to_date)
    return (
        f"{pd}.name IN (SELECT ev_m.po_dispatch FROM ({customer_invoice_events_sql()}) ev_m"
        f" WHERE ev_m.milestone = 'MS{n}' AND {' AND '.join(conds)})",
        params,
    )


def invoiced_in_months_clause(months, n=None, pd="pd"):
    """``(sql, params)`` for "invoiced in any of these YYYY-MM months".

    The month a user picks from a dropdown has to mean the same thing as the
    date range beside it, or the two filters disagree about one line. Both
    now read the invoice.
    """
    vals = [m for m in (months or []) if str(m or "").strip()]
    if not vals:
        return "", []
    ph = ", ".join(["%s"] * len(vals))
    ms_clause = f"ev_mo.milestone = 'MS{n}' AND " if n in (1, 2) else ""
    return (
        f"{pd}.name IN (SELECT ev_mo.po_dispatch"
        f" FROM ({customer_invoice_events_sql()}) ev_mo"
        f" WHERE {ms_clause}DATE_FORMAT(ev_mo.event_date, '%%Y-%%m') IN ({ph}))",
        list(vals),
    )


def invoiced_month_options_sql():
    """Every YYYY-MM that has an invoice in it — the dropdown's options.

    Built from the same events the filter matches on, so a month can never
    be offered that selects nothing, nor be missing when it holds invoices.
    """
    return (
        f"SELECT DISTINCT DATE_FORMAT(ev_op.event_date, '%%Y-%%m') AS m"
        f"  FROM ({customer_invoice_events_sql()}) ev_op"
        f" WHERE ev_op.event_date IS NOT NULL"
    )


def line_invoiced_between(from_date, to_date, pd="pd"):
    """``(sql, params)`` for "this line was invoiced inside the period".

    Either milestone falling in the window puts the line in it — a line billed
    MS1 in September and MS2 in October belongs to both months, because it was
    genuinely invoiced in both.
    """
    clauses, params = [], []
    for n in (1, 2):
        expr = customer_invoiced_date(n, pd)
        if from_date and to_date:
            clauses.append(f"({expr} BETWEEN %s AND %s)")
            params.extend([from_date, to_date])
        elif from_date:
            clauses.append(f"({expr} >= %s)")
            params.append(from_date)
        elif to_date:
            clauses.append(f"({expr} <= %s)")
            params.append(to_date)
    if not clauses:
        return "", []
    return "(" + " OR ".join(clauses) + ")", params
