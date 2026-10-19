"""Hand-run remediations for subcontractor purchase data.

Nothing here is registered as a patch. Each function is a one-off correction
run deliberately, on a named site, after someone has decided it should happen:

    bench --site <site> execute inet_app.api.subcon_fixes.<name>

They are written to be safe to re-run: every one re-reads the live data,
skips what is already correct, and refuses rather than guesses when the data
no longer matches the situation it was written for.
"""

import json

import frappe
from frappe.utils import flt

# ── Imdad Line Establishment: five POs raised at 80% that should be 85% ──
#
# The Subcontract Master said 80% when these orders went out and was edited to
# 85% afterwards. The client's instruction is that 85% is correct for all of
# them, so the orders - not the master - are what must change.
#
# Corrected IN PLACE, through ERPNext's own "Update Items" on the submitted
# order. The order keeps its name, its date, its lines and its docstatus;
# nothing is cancelled, deleted or renamed, and the milestones are not reset.
# Rebuilding each order was the first plan and is strictly worse: it has to
# delete the cancelled original to free the name, and a half-finished run
# leaves a deleted order and an unrenamed replacement.
#
# Nothing posted stands behind these orders - no Purchase Receipt, no
# SUBMITTED Purchase Invoice, no Payment Entry. The five DRAFT purchase
# invoices do, and they are corrected in the same pass.
IMDAD_SUBCONTRACT = "Imdad Line Establishment 85%"
IMDAD_PAYOUT_PCT = 85.0
IMDAD_ORDERS = ("PO-00018", "PO-00023", "PO-00031", "PO-00036", "PO-00101")


def fix_imdad_rates_in_place(dry_run=1, orders=None, payout_pct=None):
    """Re-rate each order and its draft bill to 85%, in place.

    ``dry_run=1`` (the default) reports what each order would do and writes
    nothing. Pass ``dry_run=0`` to apply.
    """
    dry_run = int(dry_run)
    pct = flt(payout_pct or IMDAD_PAYOUT_PCT)
    names = list(orders or IMDAD_ORDERS)

    changed = skipped = refused = failed = 0

    # Committed one unit at a time, on purpose. A single bad document must not
    # discard the orders that already went through - the first run aborted on
    # one unrelated bill and rolled back all four corrected orders with it.
    for po_name in names:
        verdict = _guard(po_name, dry_run, lambda: _fix_order(po_name, pct, dry_run))
        print("  %-10s %-7s %s" % (po_name, verdict["state"], verdict["why"]))
        if verdict["state"] == "ok":
            changed += 1
        elif verdict["state"] == "skip":
            skipped += 1
        elif verdict["state"] == "FAILED":
            failed += 1
        else:
            refused += 1

    # Draft bills are corrected even for an order that needed no change: a
    # bill can carry the old rate while its order is already right.
    for po_name in names:
        for pi_name in _draft_invoice_names(po_name):
            verdict = _guard(pi_name, dry_run,
                             lambda: _fix_draft_invoice(pi_name, pct, dry_run))
            print("  %-10s %-7s %s" % (po_name, verdict["state"], verdict["why"]))
            if verdict["state"] == "FAILED":
                failed += 1

    print("fix_imdad_rates_in_place (%s): %d order(s) re-rated, %d already correct, "
          "%d refused, %d failed"
          % ("DRY RUN" if dry_run else "APPLIED", changed, skipped, refused, failed))
    if dry_run:
        print("  Nothing was written. Re-run with dry_run=0 to apply.")


def _guard(label, dry_run, fn):
    """Run one unit, commit it on success, roll back only that unit on failure."""
    try:
        verdict = fn()
        if not dry_run and verdict["state"] == "ok":
            frappe.db.commit()
        return verdict
    except Exception as exc:
        frappe.db.rollback()
        return {"state": "FAILED", "why": "%s: %s" % (label, str(exc)[:160])}


def _fix_order(po_name, pct, dry_run, skip_posted_check=False, only_poids=None):
    """Re-rate a submitted order to ``pct``.

    ``only_poids`` limits the change to those PO Dispatch lines; every other
    row is sent through Update Items at the rate it already carries, so it is
    passed through untouched. Without it the whole order moves, which is what
    the October correction needed and what the 40% correction must NOT do:
    PO-00031 carries 88 lines that stay at 85% alongside the 21 that move.
    """
    if not frappe.db.exists("Purchase Order", po_name):
        return {"state": "refuse", "why": "no such Purchase Order on this site"}
    doc = frappe.get_doc("Purchase Order", po_name)
    if doc.docstatus != 1:
        return {"state": "refuse",
                "why": "docstatus %d - Update Items only applies to a submitted order"
                       % doc.docstatus}

    items = [i for i in doc.items if (i.get("poid") or "")]
    if len(items) != len(doc.items):
        return {"state": "refuse",
                "why": "%d item(s) carry no POID - cannot re-rate them safely"
                       % (len(doc.items) - len(items))}

    scope = {str(x).strip() for x in only_poids if str(x).strip()} if only_poids else None

    def _in_scope(item):
        return scope is None or (item.get("poid") or "").strip() in scope

    def _rate_for(item):
        # Out of scope: whatever the row already says. Sending the current
        # rate through Update Items is how a row is left alone -- the call
        # replaces the whole item set, so every row has to be listed.
        return _target_rate(item, pct, doc) if _in_scope(item) else flt(item.rate)

    if scope is not None:
        found = {(i.get("poid") or "").strip() for i in items} & scope
        if not found:
            return {"state": "skip", "why": "none of those POIDs are on this order"}

    targets = []
    for item in items:
        if not _in_scope(item):
            continue
        new_rate = _target_rate(item, pct, doc)
        if new_rate is None:
            return {"state": "refuse",
                    "why": "row %s: its PO Dispatch line has no rate" % item.idx}
        if flt(item.rate, 2) != flt(new_rate, 2):
            targets.append((item, new_rate))

    if not targets:
        return {"state": "skip", "why": "already at %g%%" % pct}

    # redo_imdad_bills_at_85 deletes the bill before calling this for real, so
    # its PREVIEW must not report a blocker that will not exist by then.
    blocker = None if skip_posted_check else _posted_blocker(items)
    if blocker:
        return {"state": "refuse", "why": blocker}

    new_total = sum(flt(i.qty) * flt(_rate_for(i)) for i in items)
    why = ("%d of %d rows, %s, %.2f -> %.2f"
           % (len(targets), len(items), doc.transaction_date,
              flt(doc.total), round(new_total, 2)))
    if dry_run:
        return {"state": "ok", "why": "WOULD RE-RATE: " + why}

    # price_list_rate FIRST, and equal to the new rate. update_child_qty_rate
    # cannot set it, and its `rate > price_list_rate` branch would otherwise
    # stamp margin_type="Amount" with the 5% difference onto every row - the
    # rate-ballooning pattern _po_item_pricing already guards against at
    # creation time.
    for pair in targets:
        frappe.db.set_value("Purchase Order Item", pair[0].name, {
            "price_list_rate": pair[1],
            "discount_percentage": 0,
            "discount_amount": 0,
            "margin_type": "",
            "margin_rate_or_amount": 0,
            "payout_pct": pct,
        }, update_modified=False)

    trans_items = []
    for item in items:
        trans_items.append({
            "docname": item.name,
            "idx": item.idx,
            "item_code": item.item_code,
            "qty": flt(item.qty),
            "rate": flt(_rate_for(item)),
            "uom": item.uom,
            "conversion_factor": flt(item.conversion_factor) or 1,
            "schedule_date": str(item.schedule_date or doc.schedule_date or ""),
        })

    from erpnext.controllers.accounts_controller import update_child_qty_rate
    update_child_qty_rate("Purchase Order", json.dumps(trans_items), po_name)

    _stamp_milestone_amounts(frappe.get_doc("Purchase Order", po_name), pct,
                             only_poids=scope)
    return {"state": "ok", "why": "RE-RATED: " + why}


def _target_rate(item, pct, doc):
    """The supplier's unit rate at ``pct`` of the customer's rate.

    Read from the PO Dispatch line rather than scaled off the existing rate,
    so a row that was wrong for some other reason comes out right too.
    """
    pd_rate = frappe.db.get_value("PO Dispatch", item.poid, "rate")
    if pd_rate is None:
        return None
    precision = item.precision("rate") or 2
    return flt(flt(pd_rate) * pct / 100.0, precision)


def _posted_blocker(items):
    """Why this order must not be re-rated, or None.

    Only POSTED paperwork blocks: a submitted Purchase Invoice, a Purchase
    Receipt, or a payment. Each is real accounting that a rate change would
    strand, and unwinding it is a decision for Accounts, not for this script.
    A DRAFT purchase invoice does not block - it is corrected alongside.
    """
    poids = sorted({(i.get("poid") or "") for i in items})
    ph = ", ".join(["%s"] * len(poids))
    submitted = frappe.db.sql(
        f"""SELECT DISTINCT pi.name FROM `tabPurchase Invoice Item` pii
             JOIN `tabPurchase Invoice` pi ON pi.name = pii.parent AND pi.docstatus = 1
            WHERE pii.poid IN ({ph})""", tuple(poids))
    if submitted:
        return ("a SUBMITTED Purchase Invoice exists (%s) - Accounts must cancel it "
                "first" % submitted[0][0])
    receipts = frappe.db.sql(
        f"""SELECT DISTINCT pr.name FROM `tabPurchase Receipt Item` pri
             JOIN `tabPurchase Receipt` pr ON pr.name = pri.parent AND pr.docstatus < 2
            WHERE pri.purchase_order IN (SELECT DISTINCT parent
                  FROM `tabPurchase Order Item` WHERE poid IN ({ph}))""", tuple(poids))
    if receipts:
        return "a Purchase Receipt exists (%s)" % receipts[0][0]
    payments = frappe.db.sql(
        f"""SELECT DISTINCT pe.name FROM `tabPayment Entry Reference` per
             JOIN `tabPayment Entry` pe ON pe.name = per.parent AND pe.docstatus = 1
            WHERE per.reference_doctype = 'Purchase Invoice'
              AND per.reference_name IN (
                  SELECT DISTINCT pii.parent FROM `tabPurchase Invoice Item` pii
                   WHERE pii.poid IN ({ph}))""", tuple(poids))
    if payments:
        return "a payment exists (%s)" % payments[0][0]
    return None


def _draft_invoice_names(po_name):
    """DRAFT supplier bills raised against this order.

    A submitted one is never touched - _posted_blocker has already refused
    the order in that case.
    """
    return frappe.db.sql_list(
        """SELECT DISTINCT pii.parent
             FROM `tabPurchase Invoice Item` pii
             JOIN `tabPurchase Invoice` pi ON pi.name = pii.parent AND pi.docstatus = 0
            WHERE pii.purchase_order = %s""", (po_name,))


def _fix_draft_invoice(pi_name, pct, dry_run):
    """Re-rate one draft bill in place and re-save, recalculating its totals."""
    pi = frappe.get_doc("Purchase Invoice", pi_name)
    rows = [i for i in pi.items if (i.get("poid") or "")]
    pending = []
    for item in rows:
        new_rate = _target_rate(item, pct, pi)
        if new_rate is not None and flt(item.rate, 2) != flt(new_rate, 2):
            pending.append((item, new_rate))
    if not pending:
        return {"state": "skip", "why": "%s already at %g%%" % (pi_name, pct)}

    new_total = sum(flt(i.qty) * flt(_target_rate(i, pct, pi)) for i in rows)
    why = ("%s: %d of %d rows, %.2f -> %.2f"
           % (pi_name, len(pending), len(rows), flt(pi.total), round(new_total, 2)))
    if dry_run:
        return {"state": "ok", "why": "WOULD RE-RATE BILL " + why}

    for pair in pending:
        pair[0].rate = pair[1]
        # Same reason as on the order: equal, never blank, so no margin or
        # discount is back-derived from the customer's rate.
        pair[0].price_list_rate = pair[1]
        pair[0].discount_percentage = 0
        pair[0].discount_amount = 0
        pair[0].margin_type = ""
        pair[0].margin_rate_or_amount = 0
    pi.save(ignore_permissions=True)
    return {"state": "ok", "why": "RE-RATED BILL " + why}


def _stamp_milestone_amounts(doc, pct, only_poids=None):
    """What create_purchase_order_from_pic stamps at creation, applied after.

    ``on_purchase_order_update_after_submit`` now does this for every Update
    Items edit, so on a current build this writes the values the hook has
    already written and changes nothing. It stays as the belt-and-braces for a
    site running this correction before that hook ships, and because this
    function must leave the stamps right whether or not a hook fired.
    """
    from inet_app.api.subcon_po import _sync_overall_status

    for item in doc.items:
        pd_name = (item.get("poid") or "").strip()
        ms = (item.get("milestone") or "").upper()
        if not pd_name or ms not in ("MS1", "MS2"):
            continue
        # A partial re-rate must not stamp its pct onto the rows it left
        # alone -- that is how 88 lines at 85% would start claiming 40%.
        if only_poids is not None and pd_name not in only_poids:
            continue
        n = 1 if ms == "MS1" else 2
        payload = {
            "sub_po_pct_ms%d" % n: pct,
            "sub_po_amount_ms%d" % n: flt(item.get("amount") or 0),
        }
        frappe.db.set_value("PO Dispatch", pd_name,
                            dict(payload, sub_po_supplier=doc.supplier),
                            update_modified=True)
        _mirror_to_allocation(pd_name, payload)
        _sync_overall_status(pd_name)


def _mirror_to_allocation(pd_name, payload):
    """Keep the allocation row's copy of the PO columns in step.

    _set_status does this through _mirror_status_to_allocation; these writes
    go straight to the field, so the mirror has to be made here or the
    reconcile screen shows an allocation still carrying the old rate.
    """
    rows = frappe.get_all(
        "PO Subcontract Allocation",
        filters={"parent": pd_name, "parenttype": "PO Dispatch",
                 "parentfield": "subcontract_allocations"},
        fields=["name"])
    if len(rows) != 1:
        return  # split line: which leg this order belongs to is not ours to guess
    mirror = {}
    for key in payload:
        if frappe.db.has_column("PO Subcontract Allocation", key):
            mirror[key] = payload[key]
    if mirror:
        frappe.db.set_value("PO Subcontract Allocation", rows[0].name, mirror,
                            update_modified=False)


# ── 1011HG3692386-1445-3-1: the order went out for 6, the split is 5 / 1 ──
#
# The client asked in writing for Mabran 5 and iNet 1 before the order was
# raised; PO-00098 then went out for the whole 6. With the client's
# confirmation the order is corrected to 5 through ERPNext's own Update Items
# - no cancel, no delete - and the allocation is written to match.
#
# Order matters only for tidiness: correcting the PO first lets
# on_purchase_order_update_after_submit restamp the milestone, and writing the
# allocation second settles the share. Either way the end state is the same.
MABRAN_POID = "1011HG3692386-1445-3-1"
MABRAN_ORDER = "PO-00098"
MABRAN_SPLIT = (("Mabran Al Arabia Contracting Company 80%", 5.0),
                ("INet Telecom F&C", 1.0))


def fix_mabran_split_5_1(dry_run=1):
    """Correct PO-00098 to quantity 5 and set the split to Mabran 5 / iNet 1."""
    dry_run = int(dry_run)
    name = frappe.db.get_value("PO Dispatch", {"poid": MABRAN_POID}, "name")
    if not name:
        print("  %s: not on this site, nothing to do" % MABRAN_POID)
        return

    wanted_qty = MABRAN_SPLIT[0][1]
    po_line = _mabran_po_row(name)
    if po_line is None:
        print("  %s: no live item on %s - correct it by hand"
              % (MABRAN_ORDER, MABRAN_POID))
    elif flt(po_line.qty) == wanted_qty:
        print("  %s: already at qty %g" % (MABRAN_ORDER, wanted_qty))
    elif dry_run:
        print("  %s: WOULD SET qty %g -> %g, amount %.2f -> %.2f"
              % (MABRAN_ORDER, flt(po_line.qty), wanted_qty, flt(po_line.amount),
                 wanted_qty * flt(po_line.rate)))
    else:
        _set_po_qty(MABRAN_ORDER, po_line.name, wanted_qty)
        print("  %s: qty set to %g" % (MABRAN_ORDER, wanted_qty))

    current = [(r.subcontractor, round(flt(r.qty), 4)) for r in frappe.get_all(
        "PO Subcontract Allocation",
        filters={"parent": name, "parenttype": "PO Dispatch",
                 "parentfield": "subcontract_allocations"},
        fields=["subcontractor", "qty"], order_by="idx")]
    target = [(s, round(q, 4)) for s, q in MABRAN_SPLIT]
    if sorted(current) == sorted(target):
        print("  %s: allocation already %s" % (MABRAN_POID, target))
    elif dry_run:
        print("  %s: WOULD SET allocation %s -> %s" % (MABRAN_POID, current, target))
    else:
        pd = frappe.db.get_value(
            "PO Dispatch", name, ["poid", "qty", "confirmed_qty", "rate", "line_amount"],
            as_dict=True)
        from inet_app.api.subcon_reconcile import _write_allocations
        _write_allocations(name, [{"subcontractor": s, "qty": q} for s, q in target], pd)
        frappe.db.commit()
        print("  %s: allocation set to %s" % (MABRAN_POID, target))

    if dry_run:
        print("  Nothing was written. Re-run with dry_run=0 to apply.")


def _mabran_po_row(pd_name):
    rows = frappe.db.sql(
        """SELECT poi.name, poi.qty, poi.rate, poi.amount
             FROM `tabPurchase Order Item` poi
             JOIN `tabPurchase Order` po ON po.name = poi.parent AND po.docstatus = 1
            WHERE poi.parent = %s AND poi.poid = %s""",
        (MABRAN_ORDER, pd_name), as_dict=True)
    return rows[0] if rows else None


def _set_po_qty(po_name, row_name, new_qty):
    """Change one row's quantity through Update Items, leaving the rest alone."""
    from erpnext.controllers.accounts_controller import update_child_qty_rate

    doc = frappe.get_doc("Purchase Order", po_name)
    trans = []
    for item in doc.items:
        trans.append({
            "docname": item.name,
            "idx": item.idx,
            "item_code": item.item_code,
            "qty": new_qty if item.name == row_name else flt(item.qty),
            "rate": flt(item.rate),
            "uom": item.uom,
            "conversion_factor": flt(item.conversion_factor) or 1,
            "schedule_date": str(item.schedule_date or doc.schedule_date or ""),
        })
    update_child_qty_rate("Purchase Order", json.dumps(trans), po_name)
    frappe.db.commit()


# ── Twelve Imdad lines that were INET's own work all along ──────────────
#
# Closed by hand with a payment date and no Purchase Order, because there was
# never a subcontractor to pay: the client confirms these twelve belong to
# iNet. Moving them to the INET master takes them out of the subcontractor
# reports entirely - _SUBCON_BASE_WHERE only admits type = 'SUB' - and moves
# their value from payout to INET margin, which is what INET's own crew doing
# the work means.
IMDAD_TO_INET_MASTER = "INet Telecom M&W"     # all twelve are Microwave & Wireless
IMDAD_TO_INET_POIDS = (
    "1011HG3167911-58-1-1", "1011HG3167911-59-2-1", "1011HG3167911-60-2-1",
    "1011HG3167911-66-1-1", "1011HG3167911-70-3-1", "1011HG3167911-74-1-1",
    "1011HG3167911-75-1-1", "1011HG3167911-76-1-1", "1011HG3167911-81-2-1",
    "1011HG3167911-84-2-1", "1011HG3167911-88-1-1", "1011HG3167911-117-2-1",
)


def revert_imdad_lines_to_inet(dry_run=1, poids=None, master=None):
    """Move the twelve direct-closed Imdad lines onto INET's own contract."""
    dry_run = int(dry_run)
    target = master or IMDAD_TO_INET_MASTER
    names = list(poids or IMDAD_TO_INET_POIDS)

    if not frappe.db.exists("Subcontract Master", target):
        print("  %s: no such Subcontract Master - nothing done" % target)
        return
    if frappe.db.get_value("Subcontract Master", target, "type") != "INET":
        print("  %s: not an INET-type master - refusing" % target)
        return

    moved = skipped = refused = 0
    for poid in names:
        name = frappe.db.get_value("PO Dispatch", {"poid": poid}, "name")
        if not name:
            print("  %-26s skip    not on this site" % poid)
            refused += 1
            continue
        row = frappe.db.get_value(
            "PO Dispatch", name,
            ["contract", "sub_po_amount_ms1", "sub_po_amount_ms2", "ms1_amount"],
            as_dict=True) or {}
        if row.get("contract") == target:
            print("  %-26s skip    already on %s" % (poid, target))
            skipped += 1
            continue
        # A real supplier PO means this is not INET's own work after all.
        if flt(row.get("sub_po_amount_ms1")) or flt(row.get("sub_po_amount_ms2")):
            print("  %-26s REFUSE  a supplier PO is stamped on it" % poid)
            refused += 1
            continue
        if dry_run:
            print("  %-26s would move %s -> %s, payout %.2f -> 0.00"
                  % (poid, row.get("contract"), target,
                     flt(row.get("ms1_amount")) * 0.85))
            moved += 1
            continue
        _move_line_to_master(name, target)
        moved += 1
        print("  %-26s moved to %s" % (poid, target))

    if not dry_run:
        frappe.db.commit()
    print("revert_imdad_lines_to_inet (%s): %d moved, %d already correct, %d refused"
          % ("DRY RUN" if dry_run else "APPLIED", moved, skipped, refused))
    if dry_run:
        print("  Nothing was written. Re-run with dry_run=0 to apply.")


def _move_line_to_master(pd_name, target):
    """Point a line at a different Subcontract Master and clear supplier tracking.

    Written as an Administrator allocation so no later resync re-derives the
    old subcontractor back from the rollout plans. The subcon status columns
    are cleared because there is no supplier to order from, invoice or pay -
    leaving "Closed" and a payment date behind would keep claiming money went
    out to Imdad.
    """
    from inet_app.api.subcon_reconcile import _write_allocations

    pd = frappe.db.get_value(
        "PO Dispatch", pd_name,
        ["poid", "qty", "confirmed_qty", "rate", "line_amount"], as_dict=True)
    qty = flt(pd.get("confirmed_qty")) or flt(pd.get("qty")) or 1.0
    _write_allocations(pd_name, [{"subcontractor": target, "qty": qty}], pd)

    cleared = {"contract": target, "sub_po_supplier": None, "sub_po_status": ""}
    for n in (1, 2):
        cleared["sub_po_status_ms%d" % n] = ""
        cleared["sub_po_pct_ms%d" % n] = 0
        cleared["sub_po_amount_ms%d" % n] = 0
        cleared["sub_po_date_ms%d" % n] = None
        cleared["sub_paid_date_ms%d" % n] = None
    frappe.db.set_value("PO Dispatch", pd_name, cleared, update_modified=True)


# ── Read-only: where does this site actually stand ──────────────────────
def report_subcon_fix_readiness():
    """Print everything the three corrections above depend on. Writes nothing.

    Exists because the production copy drifts from production: the five Imdad
    bills were DRAFTS on the copy and had been SUBMITTED on production by the
    time the fix ran, which is a different problem with a different answer.
    Run this first and read the real position rather than assuming the copy's.
    """
    def rows(sql, params=()):
        return frappe.db.sql(sql, params, as_dict=True)

    print("=" * 72)
    print("1. IMDAD ORDERS - the five raised at 80%")
    print("=" * 72)
    for po_name in IMDAD_ORDERS:
        po = frappe.db.get_value(
            "Purchase Order", po_name,
            ["name", "docstatus", "status", "transaction_date", "total", "supplier"],
            as_dict=True)
        if not po:
            print("  %-10s ABSENT" % po_name)
            continue
        pct = frappe.db.sql(
            """SELECT ROUND(AVG(payout_pct), 1) FROM `tabPurchase Order Item`
                WHERE parent = %s""", (po_name,))
        print("  %-10s docstatus=%s  %-22s  %s  total %10.2f  payout_pct %s"
              % (po.name, po.docstatus, po.status, po.transaction_date,
                 flt(po.total), (pct[0][0] if pct else "?")))
        for pi in rows(
            """SELECT pi.name, pi.docstatus, pi.status, pi.posting_date,
                      pi.total, pi.grand_total, pi.outstanding_amount
                 FROM `tabPurchase Invoice` pi
                WHERE pi.name IN (SELECT DISTINCT pii.parent
                                    FROM `tabPurchase Invoice Item` pii
                                   WHERE pii.purchase_order = %s)""", (po_name,)):
            print("             bill %-10s docstatus=%s  %-12s  %s  total %10.2f  "
                  "grand %10.2f  outstanding %10.2f"
                  % (pi.name, pi.docstatus, pi.status, pi.posting_date,
                     flt(pi.total), flt(pi.grand_total), flt(pi.outstanding_amount)))
            for pe in rows(
                """SELECT pe.name, pe.docstatus, pe.posting_date, per.allocated_amount
                     FROM `tabPayment Entry Reference` per
                     JOIN `tabPayment Entry` pe ON pe.name = per.parent
                    WHERE per.reference_doctype = 'Purchase Invoice'
                      AND per.reference_name = %s""", (pi.name,)):
                print("                  PAID %-12s docstatus=%s  %s  %10.2f"
                      % (pe.name, pe.docstatus, pe.posting_date,
                         flt(pe.allocated_amount)))
        for st in rows(
            """SELECT pd.sub_po_status_ms1 AS status, COUNT(*) AS legs
                 FROM `tabPurchase Order Item` poi
                 JOIN `tabPO Dispatch` pd ON pd.name = poi.poid
                WHERE poi.parent = %s GROUP BY pd.sub_po_status_ms1""", (po_name,)):
            print("             milestones: %-28s %d" % (st.status or "(blank)", st.legs))

    print()
    print("=" * 72)
    print("2. MABRAN SPLIT - %s" % MABRAN_POID)
    print("=" * 72)
    name = frappe.db.get_value("PO Dispatch", {"poid": MABRAN_POID}, "name")
    if not name:
        print("  not on this site")
    else:
        pd = frappe.db.get_value(
            "PO Dispatch", name,
            ["qty", "rate", "ms1_amount", "sub_po_amount_ms1", "sub_po_status_ms1",
             "contract"], as_dict=True)
        print("  line qty %g  rate %g  ms1 %.2f  stamped %.2f  status %s"
              % (flt(pd.qty), flt(pd.rate), flt(pd.ms1_amount),
                 flt(pd.sub_po_amount_ms1), pd.sub_po_status_ms1))
        for a in rows(
            """SELECT subcontractor, qty, source FROM `tabPO Subcontract Allocation`
                WHERE parent = %s ORDER BY idx""", (name,)):
            print("    allocation  %-45s %g  (%s)"
                  % (a.subcontractor, flt(a.qty), a.source))
        for r in rows(
            """SELECT po.name, po.docstatus, poi.qty, poi.rate, poi.amount
                 FROM `tabPurchase Order Item` poi
                 JOIN `tabPurchase Order` po ON po.name = poi.parent
                WHERE poi.poid = %s""", (name,)):
            print("    order       %-12s docstatus=%s  qty %g  rate %g  amount %.2f"
                  % (r.name, r.docstatus, flt(r.qty), flt(r.rate), flt(r.amount)))
        for r in rows(
            """SELECT pi.name, pi.docstatus FROM `tabPurchase Invoice Item` pii
                 JOIN `tabPurchase Invoice` pi ON pi.name = pii.parent
                WHERE pii.poid = %s""", (name,)):
            print("    bill        %-12s docstatus=%s" % (r.name, r.docstatus))

    print()
    print("=" * 72)
    print("3. THE TWELVE LINES TO REVERT TO iNET")
    print("=" * 72)
    for poid in IMDAD_TO_INET_POIDS:
        pd_name = frappe.db.get_value("PO Dispatch", {"poid": poid}, "name")
        if not pd_name:
            print("  %-26s ABSENT" % poid)
            continue
        pd = frappe.db.get_value(
            "PO Dispatch", pd_name,
            ["contract", "ms1_amount", "sub_po_amount_ms1", "sub_po_status_ms1",
             "sub_paid_date_ms1"], as_dict=True)
        live_po = frappe.db.sql(
            """SELECT po.name FROM `tabPurchase Order Item` poi
                 JOIN `tabPurchase Order` po ON po.name = poi.parent AND po.docstatus < 2
                WHERE poi.poid = %s LIMIT 1""", (pd_name,))
        print("  %-26s %-34s ms1 %8.2f  stamped %8.2f  %-10s paid %s  PO %s"
              % (poid, pd.contract, flt(pd.ms1_amount), flt(pd.sub_po_amount_ms1),
                 pd.sub_po_status_ms1 or "(blank)", pd.sub_paid_date_ms1 or "-",
                 live_po[0][0] if live_po else "none"))
    print()
    print("Read-only. Nothing was written.")


def redo_imdad_bills_at_85(dry_run=1, orders=None, payout_pct=None):
    """Cancel + delete each bill, re-rate its order to 85%, re-bill, submit.

    The whole sequence for a site where Accounts has already SUBMITTED the
    five purchase invoices at the old rate, which is where production was
    found. A submitted bill is posted accounting, so fix_imdad_rates_in_place
    refuses to touch the order underneath it - this does the unwinding first,
    deliberately and in order.

    Safe only because the bills are unpaid: every one is Overdue with its
    full grand total outstanding and no Payment Entry against it, so
    cancelling reverses the GL postings and settles nothing. The guard below
    re-checks that on the live data rather than trusting it.

    One order at a time, committed as it goes, so a failure leaves the
    finished ones finished. Per order:

        cancel the bill -> delete it -> re-rate the order -> re-bill -> submit

    The replacement bill keeps the original's posting date, supplier bill
    number and bill date, the same way the order keeps its name and date -
    this is a correction, not new business. It is built through
    receive_supplier_invoice, so the rates come from the corrected order
    rather than being carried over from the document being replaced.

    Milestone statuses are untouched throughout: they sit at "Closed", and
    every hook in the chain refuses to drag a closed milestone backwards.
    """
    dry_run = int(dry_run)
    pct = flt(payout_pct or IMDAD_PAYOUT_PCT)
    names = list(orders or IMDAD_ORDERS)
    ok = failed = 0

    for po_name in names:
        verdict = _guard(po_name, dry_run, lambda: _redo_one(po_name, pct, dry_run))
        for line in verdict.get("log", [verdict.get("why", "")]):
            print("  %-10s %s" % (po_name, line))
        if verdict["state"] == "FAILED":
            failed += 1
            print("  %-10s STOPPING - fix this before continuing" % po_name)
            break
        if verdict["state"] == "ok":
            ok += 1

    print("redo_imdad_bills_at_85 (%s): %d order(s) done, %d failed"
          % ("DRY RUN" if dry_run else "APPLIED", ok, failed))
    if dry_run:
        print("  Nothing was written. Re-run with dry_run=0 to apply.")


def _redo_one(po_name, pct, dry_run, only_poids=None):
    log = []
    if not frappe.db.exists("Purchase Order", po_name):
        return {"state": "refuse", "log": ["no such Purchase Order on this site"]}

    bills = frappe.db.sql(
        """SELECT DISTINCT pi.name, pi.docstatus, pi.posting_date, pi.bill_no,
                  pi.bill_date, pi.outstanding_amount, pi.grand_total
             FROM `tabPurchase Invoice` pi
             JOIN `tabPurchase Invoice Item` pii ON pii.parent = pi.name
            WHERE pii.purchase_order = %s AND pi.docstatus < 2""",
        (po_name,), as_dict=True)

    # Never unwind a bill that has been paid, even in part.
    for bill in bills:
        paid = frappe.db.sql(
            """SELECT pe.name FROM `tabPayment Entry Reference` per
                 JOIN `tabPayment Entry` pe ON pe.name = per.parent AND pe.docstatus = 1
                WHERE per.reference_doctype = 'Purchase Invoice'
                  AND per.reference_name = %s LIMIT 1""", (bill.name,))
        if paid:
            return {"state": "refuse",
                    "log": ["%s has a payment (%s) - raise the difference as a "
                            "supplementary bill instead" % (bill.name, paid[0][0])]}
        if bill.docstatus == 1 and flt(bill.outstanding_amount) < flt(bill.grand_total):
            return {"state": "refuse",
                    "log": ["%s is part settled (%.2f of %.2f outstanding)"
                            % (bill.name, flt(bill.outstanding_amount),
                               flt(bill.grand_total))]}

    carry = bills[0] if bills else None
    if dry_run:
        for bill in bills:
            log.append("would cancel + delete %s (docstatus %s, %s, grand %.2f)"
                       % (bill.name, bill.docstatus, bill.posting_date,
                          flt(bill.grand_total)))
        probe = _fix_order(po_name, pct, 1, skip_posted_check=True,
                           only_poids=only_poids)
        log.append(probe["why"])
        log.append("would re-bill from the corrected order and submit"
                   + (", keeping posting date %s" % carry.posting_date if carry else ""))
        return {"state": "ok", "log": log}

    for bill in bills:
        if bill.docstatus == 1:
            frappe.get_doc("Purchase Invoice", bill.name).cancel()
        frappe.delete_doc("Purchase Invoice", bill.name, force=1,
                          ignore_permissions=True)
        log.append("cancelled + deleted %s" % bill.name)

    verdict = _fix_order(po_name, pct, 0, only_poids=only_poids)
    log.append(verdict["why"])
    if verdict["state"] == "refuse":
        return {"state": "refuse", "log": log}

    from inet_app.api.subcon_po import receive_supplier_invoice
    made = receive_supplier_invoice(
        purchase_order=po_name,
        bill_no=(carry.bill_no if carry else None),
        bill_date=(carry.bill_date if carry else None))
    pi = frappe.get_doc("Purchase Invoice", made["purchase_invoice"])
    if carry and carry.posting_date:
        pi.set_posting_time = 1
        pi.posting_date = carry.posting_date
        pi.save(ignore_permissions=True)
    pi.submit()
    log.append("re-billed as %s, submitted, grand %.2f"
               % (pi.name, flt(pi.grand_total)))
    return {"state": "ok", "log": log}


# ── The 40% correction: 46 of Imdad's lines, not all 134 ────────────────
#
# The client asked for 46 POIDs to move from 85% to 40%. Those 46 are spread
# across three orders that also carry 88 lines staying at 85%, and all three
# orders are already billed, so this is the October sequence again -- cancel
# the bill, re-rate, re-bill, submit -- with the re-rate limited to the named
# lines.
#
# Moving the lines onto the 40% Subcontract Master is a SEPARATE step and
# must come after: dispatch_subcontractor_locks refuses to re-point a line
# whose supplier holds an issued PO, and it is right to.
IMDAD_40_MASTER = "Imdad Line Establishment 40%"
IMDAD_40_PCT = 40.0
IMDAD_40_ORDERS = ("PO-00031", "PO-00036", "PO-00101")
IMDAD_40_POIDS = (
    "1011HG3167911-169-2-1", "1011HG3167911-86-3-1", "1011HG3167911-553-5-1",
    "1011HG3167911-553-2-1", "1011HG3167911-158-3-1", "1011HG3167911-626-2-1",
    "1011HG3167911-136-5-1", "1011HG3167911-129-2-1", "1011HG3167911-135-2-1",
    "1011HG3167911-118-1-1", "1011HG3167911-106-2-1", "1011HG3167911-69-1-1",
    "1011HG3167911-105-2-1", "1011HG3167911-73-1-1", "1011HG3167911-126-1-1",
    "1011HG3167911-125-3-1", "1011HG3167911-72-2-1", "1011HG3167911-71-3-1",
    "1011HG3167911-70-2-1", "1011HG3167911-84-3-1", "1011HG3167911-67-1-1",
    "1011HG3167911-168-4-1", "1011HG3167911-168-1-1", "1011HG3167911-58-3-1",
    "1011HG3167911-139-3-1", "1011HG3167911-119-1-1", "1011HG3167911-128-2-1",
    "1011HG3167911-87-2-1", "1011HG3167911-636-1-1", "1011HG3167911-156-2-1",
    "1011HG3167911-255-1-1", "1011HG3167911-178-2-1", "1011HG3167911-178-4-1",
    "1011HG3167911-177-1-1", "1011HG3167911-141-5-1", "1011HG3167911-141-4-1",
    "1011HG3167911-254-2-1", "1011HG3167911-121-1-1", "1011HG3167911-88-2-1",
    "1011HG3167911-123-2-1", "1011HG3167911-102-1-1", "1011HG3167911-173-3-1",
    "1011HG3167911-122-2-1", "1011HG3167911-61-1-1", "1011HG3167911-155-2-1",
    "1011HG3167911-60-3-1",
)


def _resolve_poids(poids):
    """Client POIDs -> PO Dispatch names, which is what a PO row carries."""
    out, missing = [], []
    for poid in poids:
        name = frappe.db.get_value("PO Dispatch", {"poid": poid}, "name")
        if name:
            out.append(name)
        else:
            missing.append(poid)
    return out, missing


def _attachment_backup_dir():
    import os
    return os.path.join(frappe.get_site_path(), "private", "files",
                        "subcon_fix_backup")


def _backup_filename(bill, file_name):
    """One stable name per (bill, attachment), so the restore can find it.

    The bill name is the prefix because the same supplier PDF can be attached
    to more than one bill, and the restore has to put each copy back under
    the document it belonged to.
    """
    return "%s__%s" % (bill, file_name)


def backup_bill_attachments(bills=None, dry_run=1):
    """Copy each bill's attachments aside BEFORE anything deletes them.

    Run this first, always. Cancelling and deleting a Purchase Invoice takes
    its File rows with it, and Frappe removes the stored blob when the last
    row referencing it goes -- so the supplier's own invoice PDF is gone from
    disk, not just unlinked. In October that cost a restore from the 03:16
    backup tar to get three PDFs back.

    Copies to <site>/private/files/subcon_fix_backup/ and prints every path,
    so a re-upload afterwards is a drag and drop rather than an archaeology
    exercise.
    """
    import os
    import shutil

    dry_run = int(dry_run)
    names = list(bills or ("PI-00013", "PI-00014", "PI-00015"))
    site = frappe.get_site_path()
    dest_dir = _attachment_backup_dir()

    rows = frappe.get_all(
        "File",
        filters={"attached_to_doctype": "Purchase Invoice",
                 "attached_to_name": ["in", names]},
        fields=["name", "file_name", "file_url", "is_private", "attached_to_name"])
    if not rows:
        print("  no attachments found on %s" % ", ".join(names))
        return

    if not dry_run:
        os.makedirs(dest_dir, exist_ok=True)

    copied = missing = 0
    for r in rows:
        url = r.get("file_url") or ""
        rel = url.lstrip("/")
        src = (os.path.join(site, rel) if url.startswith("/private/")
               else os.path.join(site, "public", rel))
        if not os.path.exists(src):
            missing += 1
            print("  %-10s MISSING ON DISK  %s" % (r["attached_to_name"], r["file_name"]))
            print("             expected: %s" % src)
            continue
        copied += 1
        dest = os.path.join(dest_dir, _backup_filename(r["attached_to_name"], r["file_name"]))
        print("  %-10s %s" % (r["attached_to_name"], r["file_name"]))
        print("             %s" % src)
        if not dry_run:
            shutil.copy2(src, dest)
            print("             copied to %s" % dest)

    print("  %d attachment(s) %s, %d missing on disk"
          % (copied, "copied" if not dry_run else "would be copied", missing))
    if dry_run:
        print("  Nothing was copied. Re-run with dry_run=0 before deleting any bill.")


def redo_imdad_bills_at_40(dry_run=1, orders=None, poids=None, payout_pct=None):
    """Cancel each bill, re-rate ONLY the named lines to 40%, re-bill, submit.

    Same sequence and the same guards as redo_imdad_bills_at_85 -- it refuses
    outright if any bill has a payment or is part settled -- but the re-rate
    is limited to ``poids``. Everything else on those orders is sent through
    Update Items at its existing rate and comes out unchanged.
    """
    dry_run = int(dry_run)
    pct = flt(payout_pct or IMDAD_40_PCT)
    names = list(orders or IMDAD_40_ORDERS)

    scope, missing = _resolve_poids(list(poids or IMDAD_40_POIDS))
    for poid in missing:
        print("  %-26s NOT FOUND on this site" % poid)
    print("  %d POID(s) in scope, %d order(s), target %g%%"
          % (len(scope), len(names), pct))
    if not scope:
        print("  nothing to do")
        return

    ok = failed = 0
    for po_name in names:
        verdict = _guard(po_name, dry_run,
                         lambda: _redo_one(po_name, pct, dry_run, only_poids=scope))
        for line in verdict.get("log", [verdict.get("why", "")]):
            print("  %-10s %s" % (po_name, line))
        if verdict["state"] == "FAILED":
            failed += 1
            print("  %-10s STOPPING - fix this before continuing" % po_name)
            break
        if verdict["state"] == "ok":
            ok += 1

    print("redo_imdad_bills_at_40 (%s): %d order(s) done, %d failed"
          % ("DRY RUN" if dry_run else "APPLIED", ok, failed))
    if dry_run:
        print("  Nothing was written. Re-run with dry_run=0 to apply.")


def restamp_subcontract_dimension(dry_run=1, poids=None):
    """Put the `subcontract` tag on PO/PI item rows back in step with the line.

    `subcontract` is a Custom Field on Purchase Order Item and Purchase
    Invoice Item -- the supplier contract the row was raised under. Nothing
    keeps it in step when a line is re-pointed at a different Subcontract
    Master, so after move_imdad_lines_to_40 all 46 orders and all 46 bill
    rows still read "Imdad Line Establishment 85%" while the line reads 40%.

    It is not a registered Accounting Dimension and never reaches GL Entry,
    so this is a tag correction with no accounting consequence -- which is
    why a direct write is right. `allow_on_submit` is 0, so the UI cannot
    do it on a submitted document anyway.

    Two things it refuses rather than guesses:

    * a line split across several allocations -- which leg an order belongs
      to is not derivable from the line's single stamp;
    * a row whose contract names a DIFFERENT SUPPLIER, not just a different
      rate for the same one. That is not drift, it is an order raised on
      somebody else, and it needs a person.
    """
    dry_run = int(dry_run)
    fixed = skipped = refused = 0

    for dt, parent in (("Purchase Order Item", "Purchase Order"),
                       ("Purchase Invoice Item", "Purchase Invoice")):
        if not frappe.db.has_column(dt, "subcontract"):
            continue
        where = ["IFNULL(c.subcontract,'') <> IFNULL(pd.contract,'')",
                 "IFNULL(pd.contract,'') <> ''", "p.docstatus < 2"]
        params = {}
        if poids:
            where.append("pd.poid IN %(poids)s")
            params["poids"] = list(poids)
        rows = frappe.db.sql(f"""
            SELECT c.name, c.parent, pd.name AS pd_name, pd.poid,
                   c.subcontract AS on_doc, pd.contract AS on_line
            FROM `tab{dt}` c
            JOIN `tab{parent}` p ON p.name = c.parent
            JOIN `tabPO Dispatch` pd ON pd.name = c.poid
            WHERE {' AND '.join(where)}
            ORDER BY c.parent, c.idx""", params, as_dict=True)
        if rows:
            print("  %s: %d row(s) out of step" % (dt, len(rows)))
        for r in rows:
            allocs = frappe.db.count(
                "PO Subcontract Allocation",
                {"parent": r.pd_name, "parenttype": "PO Dispatch",
                 "parentfield": "subcontract_allocations"})
            if allocs > 1:
                print("     %-26s %s SPLIT across %d suppliers - left alone"
                      % (r.poid, r.parent, allocs))
                skipped += 1
                continue
            sup_doc = frappe.db.get_value("Subcontract Master", r.on_doc, "supplier")
            sup_line = frappe.db.get_value("Subcontract Master", r.on_line, "supplier")
            if sup_doc and sup_line and sup_doc != sup_line:
                print("     %-26s %s REFUSE: %s is a different supplier (%s vs %s)"
                      % (r.poid, r.parent, r.on_doc, sup_doc, sup_line))
                refused += 1
                continue
            print("     %-26s %s  %s -> %s"
                  % (r.poid, r.parent, r.on_doc, r.on_line))
            fixed += 1
            if not dry_run:
                frappe.db.set_value(dt, r.name, "subcontract", r.on_line,
                                    update_modified=False)

    if not dry_run:
        frappe.db.commit()
    print("restamp_subcontract_dimension (%s): %d corrected, %d split lines left "
          "alone, %d refused" % ("DRY RUN" if dry_run else "APPLIED",
                                 fixed, skipped, refused))
    if dry_run and fixed:
        print("  Nothing was written. Re-run with dry_run=0 to apply.")


def move_imdad_lines_to_40(dry_run=1, poids=None, master=None):
    """Re-point the 46 corrected lines onto the 40% Subcontract Master.

    The rate correction fixed the money; this fixes the label. Until it runs
    the lines still read "Imdad Line Establishment 85%" while being paid at
    40%, and the 40% master shows nothing at all.

    Goes through set_subcontractor_allocation, so it keeps that endpoint's
    guards -- including the supplier-PO lock, which now compares SUPPLIERS
    rather than master names and therefore allows this move: both masters
    are Imdad Line Establishment, so the orders are not contradicted.

    The allocation's own PO tracking columns are re-mirrored afterwards.
    _write_allocations carries them across by subcontractor name, and the
    name is exactly what changes here, so without this the new row would
    claim no order was ever raised.
    """
    from inet_app.api.subcon_reconcile import set_subcontractor_allocation

    dry_run = int(dry_run)
    target = master or IMDAD_40_MASTER
    names = list(poids or IMDAD_40_POIDS)

    if not frappe.db.exists("Subcontract Master", target):
        print("  %s: no such Subcontract Master" % target)
        return

    moved = already = refused = 0
    for poid in names:
        pd_name = frappe.db.get_value("PO Dispatch", {"poid": poid}, "name")
        if not pd_name:
            print("  %-26s not on this site" % poid)
            refused += 1
            continue
        current = str(frappe.db.get_value("PO Dispatch", pd_name, "contract") or "")
        if current == target:
            already += 1
            continue

        # The split must total what the line says was done -- the same rule
        # set_subcontractor_allocation enforces, worked out the same way.
        wd = frappe.get_all("Work Done", filters={"system_id": pd_name},
                            fields=["executed_qty"], limit=1)
        row = frappe.db.get_value("PO Dispatch", pd_name,
                                  ["qty", "confirmed_qty"], as_dict=True) or {}
        qty = (flt(wd[0]["executed_qty"]) if wd
               else (flt(row.get("confirmed_qty")) or flt(row.get("qty"))))

        print("  %-26s %s -> %s   qty %g" % (poid, current or "(none)", target, qty))
        if dry_run:
            moved += 1
            continue

        try:
            set_subcontractor_allocation(
                po_dispatch=pd_name,
                allocation=json.dumps([{"subcontractor": target, "qty": qty}]),
                remark="40 percent correction: re-pointed to %s" % target)
        except Exception as exc:
            print("     REFUSED: %s" % str(exc)[:160])
            refused += 1
            continue

        line = frappe.db.get_value(
            "PO Dispatch", pd_name,
            ["sub_po_status_ms1", "sub_po_pct_ms1", "sub_po_amount_ms1",
             "sub_po_date_ms1", "sub_paid_date_ms1",
             "sub_po_status_ms2", "sub_po_pct_ms2", "sub_po_amount_ms2",
             "sub_po_date_ms2", "sub_paid_date_ms2"], as_dict=True) or {}
        _mirror_to_allocation(pd_name, {k: v for k, v in line.items() if v is not None})
        moved += 1

    # The order and bill rows carry their own copy of the contract. Nothing
    # keeps it in step with the line, so the move has to -- without this the
    # 46 orders still read 85% while the line reads 40%.
    if moved:
        print("  re-stamping the subcontract tag on the order and bill rows:")
        restamp_subcontract_dimension(dry_run=dry_run, poids=names)

    print("move_imdad_lines_to_40 (%s): %d moved, %d already there, %d refused"
          % ("DRY RUN" if dry_run else "APPLIED", moved, already, refused))
    if dry_run:
        print("  Nothing was written. Re-run with dry_run=0 to apply.")


# ── 1011HG3068810-966-2-1: the line says 3, the work was 2 ──────────────
#
# Client-confirmed. The customer side already agrees: ms1_invoiced is 348.00,
# exactly 2 x 174.00, with 174.00 sitting unbilled -- so cutting the line to
# 2 settles the unbilled remainder rather than creating one, and no customer
# invoice is touched.
#
# The supplier side does have to move: PO-00022 was raised for 3 and
# PI-00016 bills it, both submitted. Same sequence as the 40% correction --
# cancel the bill, change the quantity, re-bill -- because a submitted bill
# is posted accounting that a quantity change would strand.
QTY_FIX_POID = "1011HG3068810-966-2-1"
QTY_FIX_ORDER = "PO-00022"
QTY_FIX_NEW_QTY = 2.0


def fix_line_qty(dry_run=1, poid=None, order=None, new_qty=None):
    """Cut one line's quantity everywhere it is recorded, bill included.

    PO Dispatch, its Work Done, the supplier order row and the bill on top of
    it. Refuses rather than guesses whenever the line is not the simple shape
    this was written for -- several Work Done records, a closure ledger, a
    rollout plan, or a bill that has been paid.
    """
    dry_run = int(dry_run)
    poid = poid or QTY_FIX_POID
    po_name = order or QTY_FIX_ORDER
    new_qty = flt(new_qty if new_qty is not None else QTY_FIX_NEW_QTY)

    pd_name = frappe.db.get_value("PO Dispatch", {"poid": poid}, "name")
    if not pd_name:
        print("  %s: not on this site" % poid)
        return
    pd = frappe.db.get_value(
        "PO Dispatch", pd_name,
        ["qty", "rate", "line_amount", "ms1_pct", "ms1_amount", "ms2_amount",
         "ms1_invoiced", "ms1_unbilled", "confirmed_qty"], as_dict=True)
    old_qty = flt(pd.qty)
    rate = flt(pd.rate)
    if old_qty == new_qty:
        print("  %s already at qty %g" % (poid, new_qty))
        return
    if new_qty <= 0 or new_qty > old_qty:
        print("  %s: refusing to go from %g to %g" % (poid, old_qty, new_qty))
        return
    if flt(pd.ms2_amount):
        print("  %s: has an MS2 value - not the shape this handles" % poid)
        return

    new_line = flt(rate * new_qty, 2)
    new_ms1 = flt(new_line * flt(pd.ms1_pct) / 100.0, 2)
    print("  %s  qty %g -> %g" % (poid, old_qty, new_qty))
    print("     line amount %.2f -> %.2f" % (flt(pd.line_amount), new_line))
    print("     MS1 amount  %.2f -> %.2f   (invoiced %.2f, unbilled %.2f)"
          % (flt(pd.ms1_amount), new_ms1, flt(pd.ms1_invoiced), flt(pd.ms1_unbilled)))

    plans = frappe.db.count("Rollout Plan", {"po_dispatch": pd_name})
    if plans:
        print("     REFUSE: %d rollout plan(s) - the quantity is planned work, "
              "not a correction" % plans)
        return
    wds = frappe.get_all("Work Done", filters={"system_id": pd_name},
                         fields=["name", "executed_qty", "revenue_sar", "source"])
    if len(wds) > 1:
        print("     REFUSE: %d Work Done records" % len(wds))
        return
    wd = wds[0] if wds else None
    if wd:
        closures = frappe.db.count("Work Done Closure", {"parent": wd["name"]})
        if closures:
            print("     REFUSE: %s has %d closure row(s) - re-dividing a ledger "
                  "is subcon_reconcile's job" % (wd["name"], closures))
            return
        print("     %s  executed %g -> %g, revenue %.2f -> %.2f  (%s)"
              % (wd["name"], flt(wd["executed_qty"]), new_qty,
                 flt(wd["revenue_sar"]), new_line, wd["source"]))

    rows = frappe.db.sql(
        """SELECT poi.name, poi.qty, poi.rate, poi.amount, po.docstatus
             FROM `tabPurchase Order Item` poi
             JOIN `tabPurchase Order` po ON po.name = poi.parent
            WHERE poi.parent = %s AND poi.poid = %s""",
        (po_name, pd_name), as_dict=True)
    if len(rows) != 1:
        print("     REFUSE: %d row(s) for this line on %s" % (len(rows), po_name))
        return
    row = rows[0]
    print("     %s row  qty %g -> %g, amount %.2f -> %.2f"
          % (po_name, flt(row.qty), new_qty, flt(row.amount),
             flt(flt(row.rate) * new_qty, 2)))

    verdict = _guard(po_name, dry_run, lambda: _redo_one_qty(
        po_name, row.name, new_qty, pd_name, new_line, wd, dry_run))
    for line in verdict.get("log", [verdict.get("why", "")]):
        print("     %s" % line)
    print("fix_line_qty (%s): %s" % ("DRY RUN" if dry_run else "APPLIED",
                                     verdict["state"]))
    if dry_run:
        print("  Nothing was written. Re-run with dry_run=0 to apply.")


def _redo_one_qty(po_name, row_name, new_qty, pd_name, new_line, wd, dry_run):
    """Cancel the bill, change the quantity, re-bill -- as _redo_one does."""
    log = []
    bills = frappe.db.sql(
        """SELECT DISTINCT pi.name, pi.docstatus, pi.posting_date, pi.bill_no,
                  pi.bill_date, pi.outstanding_amount, pi.grand_total
             FROM `tabPurchase Invoice` pi
             JOIN `tabPurchase Invoice Item` pii ON pii.parent = pi.name
            WHERE pii.purchase_order = %s AND pi.docstatus < 2""",
        (po_name,), as_dict=True)
    for bill in bills:
        paid = frappe.db.sql(
            """SELECT pe.name FROM `tabPayment Entry Reference` per
                 JOIN `tabPayment Entry` pe ON pe.name = per.parent AND pe.docstatus = 1
                WHERE per.reference_doctype = 'Purchase Invoice'
                  AND per.reference_name = %s LIMIT 1""", (bill.name,))
        if paid:
            return {"state": "refuse",
                    "log": ["%s has a payment (%s)" % (bill.name, paid[0][0])]}
        if bill.docstatus == 1 and flt(bill.outstanding_amount) < flt(bill.grand_total):
            return {"state": "refuse",
                    "log": ["%s is part settled" % bill.name]}

    carry = bills[0] if bills else None
    if dry_run:
        for bill in bills:
            log.append("would cancel + delete %s (grand %.2f)"
                       % (bill.name, flt(bill.grand_total)))
        log.append("would set the order row to %g and re-bill" % new_qty)
        return {"state": "ok", "log": log}

    for bill in bills:
        if bill.docstatus == 1:
            frappe.get_doc("Purchase Invoice", bill.name).cancel()
        frappe.delete_doc("Purchase Invoice", bill.name, force=1,
                          ignore_permissions=True)
        log.append("cancelled + deleted %s" % bill.name)

    _set_po_qty(po_name, row_name, new_qty)
    log.append("order row set to %g" % new_qty)

    # The line itself, and the Work Done built from it.
    #
    # The derived money is taken from the doctype's own _compute_ms_amounts
    # rather than worked out here, then written field by field. Writing
    # qty/line_amount alone left ms1_unbilled claiming 174.00 still to bill
    # on a line that is now fully invoiced, and remaining_milestone_pct with
    # it. A plain doc.save() would recompute them -- and re-run the PIC
    # status machinery over a closed line, which is the thing to avoid.
    doc = frappe.get_doc("PO Dispatch", pd_name)
    doc.qty = new_qty
    doc.line_amount = new_line
    doc._compute_ms_amounts()
    frappe.db.set_value("PO Dispatch", pd_name, {
        "qty": flt(doc.qty),
        "line_amount": flt(doc.line_amount),
        "ms1_amount": flt(doc.ms1_amount),
        "ms2_amount": flt(doc.ms2_amount),
        "ms1_unbilled": flt(doc.ms1_unbilled),
        "ms2_unbilled": flt(doc.ms2_unbilled),
        "remaining_milestone_pct": flt(doc.remaining_milestone_pct),
    }, update_modified=True)
    log.append("PO Dispatch set to qty %g, line %.2f, MS1 %.2f, unbilled %.2f"
               % (new_qty, flt(doc.line_amount), flt(doc.ms1_amount),
                  flt(doc.ms1_unbilled)))
    if wd:
        frappe.db.set_value("Work Done", wd["name"], {
            "executed_qty": new_qty, "revenue_sar": new_line,
        }, update_modified=True)
        log.append("%s set to %g / %.2f" % (wd["name"], new_qty, new_line))

    from inet_app.api.subcon_po import receive_supplier_invoice
    made = receive_supplier_invoice(
        purchase_order=po_name,
        bill_no=(carry.bill_no if carry else None),
        bill_date=(carry.bill_date if carry else None))
    pi = frappe.get_doc("Purchase Invoice", made["purchase_invoice"])
    if carry and carry.posting_date:
        pi.set_posting_time = 1
        pi.posting_date = carry.posting_date
        pi.save(ignore_permissions=True)
    pi.submit()
    log.append("re-billed as %s, submitted, grand %.2f" % (pi.name, flt(pi.grand_total)))
    frappe.db.commit()
    return {"state": "ok", "log": log}


# ── Putting the invoice numbers back ────────────────────────────────────
#
# redo_imdad_bills_at_85 deleted each bill and raised a replacement, so the
# five came back with new numbers at the end of the series - PI-00089..93 in
# place of PI-00011..15 - and their attachments went with the originals.
# Both are recoverable: Frappe keeps the full JSON of every deleted document
# in `Deleted Document`, including the File rows.
#
# The mapping is derived from that JSON rather than hard-coded, so this reads
# whatever actually happened on the site it runs on.
IMDAD_PI_PREFIX = "PI-"


def restore_imdad_invoice_names(dry_run=1, old_names=None):
    """Rename the replacement bills back, reset the counter, re-attach the PDFs."""
    dry_run = int(dry_run)
    olds = list(old_names or ("PI-00011", "PI-00012", "PI-00013",
                              "PI-00014", "PI-00015"))

    pairs, problems = _invoice_rename_pairs(olds)
    for line in problems:
        print("  %s" % line)
    for pair in pairs:
        print("  %-10s <- %-10s  (PO %s, grand %.2f)"
              % (pair["old"], pair["new"], pair["po"], flt(pair["grand"])))
        if dry_run:
            continue
        frappe.rename_doc("Purchase Invoice", pair["new"], pair["old"],
                          force=True, merge=False, show_alert=False)
        frappe.db.commit()

    _reset_naming_counter(dry_run, pairs)
    _restore_deleted_attachments(olds, dry_run)

    if dry_run:
        print("  Nothing was written. Re-run with dry_run=0 to apply.")


def _invoice_rename_pairs(olds):
    """[{old, new, po, grand}] derived from the Deleted Document JSON."""
    pairs, problems = [], []
    for old in olds:
        if frappe.db.exists("Purchase Invoice", old):
            problems.append("%s already exists - leaving it alone" % old)
            continue
        row = frappe.db.sql(
            """SELECT data FROM `tabDeleted Document`
                WHERE deleted_doctype = 'Purchase Invoice' AND deleted_name = %s
                ORDER BY creation DESC LIMIT 1""", (old,))
        if not row:
            problems.append("%s: no Deleted Document record, cannot tell which "
                            "bill replaced it" % old)
            continue
        data = json.loads(row[0][0])
        orders = {(i.get("purchase_order") or "")
                  for i in (data.get("items") or []) if i.get("purchase_order")}
        if len(orders) != 1:
            problems.append("%s: covered %d purchase orders, too ambiguous to "
                            "match automatically" % (old, len(orders)))
            continue
        po_name = orders.pop()
        live = frappe.db.sql(
            """SELECT DISTINCT pi.name, pi.grand_total
                 FROM `tabPurchase Invoice` pi
                 JOIN `tabPurchase Invoice Item` pii ON pii.parent = pi.name
                WHERE pii.purchase_order = %s AND pi.docstatus < 2""",
            (po_name,), as_dict=True)
        if len(live) != 1:
            problems.append("%s: %s now carries %d live bills - rename by hand"
                            % (old, po_name, len(live)))
            continue
        pairs.append({"old": old, "new": live[0].name, "po": po_name,
                      "grand": live[0].grand_total})
    return pairs, problems


def _reset_naming_counter(dry_run, pairs=None):
    """Point the series back at the highest number actually in use.

    Renaming frees the numbers the replacements had taken, and a counter left
    past them would skip that whole block for good.
    """
    rules = frappe.get_all(
        "Document Naming Rule",
        filters={"document_type": "Purchase Invoice", "prefix": IMDAD_PI_PREFIX},
        fields=["name", "counter", "prefix_digits"])
    if not rules:
        print("  no Document Naming Rule with prefix %s - counter untouched"
              % IMDAD_PI_PREFIX)
        return
    rule = rules[0]
    # On a preview the renames have not happened yet, so the numbers the
    # replacements still hold must be discounted or the counter looks correct
    # when it is about to be wrong.
    pending = {p["new"] for p in (pairs or [])} if dry_run else set()
    highest = 0
    for row in frappe.db.sql(
            """SELECT name FROM `tabPurchase Invoice` WHERE name LIKE %s""",
            (IMDAD_PI_PREFIX + "%",)):
        if row[0] in pending:
            continue
        tail = row[0][len(IMDAD_PI_PREFIX):]
        if tail.isdigit():
            highest = max(highest, int(tail))
    if int(rule.counter or 0) == highest:
        print("  naming counter already %d" % highest)
        return
    print("  naming counter %s -> %d (next bill becomes %s%0*d)"
          % (rule.counter, highest, IMDAD_PI_PREFIX,
             int(rule.prefix_digits or 5), highest + 1))
    if not dry_run:
        frappe.db.set_value("Document Naming Rule", rule.name, "counter", highest)
        frappe.db.commit()


def _restore_deleted_attachments(olds, dry_run):
    """Re-create the File rows deleted with the original bills.

    Only when the PDF is still on disk. Frappe removes the stored file when
    the last File row referencing it goes, so the row is recoverable from
    Deleted Document but the bytes may not be - and a File row pointing at
    nothing is worse than an honest "re-upload this".
    """
    import os
    import shutil

    wanted = set(olds)
    site = frappe.get_site_path()
    found = missing = already = 0
    for row in frappe.db.sql(
            """SELECT deleted_name, data FROM `tabDeleted Document`
                WHERE deleted_doctype = 'File' ORDER BY creation DESC LIMIT 200""",
            as_dict=True):
        data = json.loads(row["data"])
        if data.get("attached_to_doctype") != "Purchase Invoice":
            continue
        target = data.get("attached_to_name")
        if target not in wanted:
            continue
        url = data.get("file_url") or ""
        rel = url.lstrip("/")
        path = (os.path.join(site, rel) if url.startswith("/private/")
                else os.path.join(site, "public", rel))
        if frappe.db.exists("File", {"attached_to_doctype": "Purchase Invoice",
                                     "attached_to_name": target,
                                     "file_name": data.get("file_name")}):
            already += 1
            continue
        if not os.path.exists(path):
            # The bytes went with the bill, as they always do. Put them back
            # from the copy backup_bill_attachments took beforehand -- at the
            # ORIGINAL file_url, so the File row below describes a file that
            # really is there, under the name the supplier sent.
            spare = os.path.join(_attachment_backup_dir(),
                                 _backup_filename(target, data.get("file_name") or ""))
            if os.path.exists(spare):
                print("  %-10s restoring %s from the pre-delete backup"
                      % (target, data.get("file_name")))
                if not dry_run:
                    os.makedirs(os.path.dirname(path), exist_ok=True)
                    shutil.copy2(spare, path)
            else:
                missing += 1
                print("  %-10s NEEDS RE-UPLOAD: %s" % (target, data.get("file_name")))
                print("             looked for: %s" % path)
                print("             and no backup at: %s" % spare)
                continue
        found += 1
        print("  %-10s %s %s" % (target, "re-attaching" if not dry_run
                                   else "would re-attach", data.get("file_name")))
        if not dry_run:
            doc = frappe.new_doc("File")
            for field in ("file_name", "file_url", "is_private", "content_hash",
                          "file_size", "folder"):
                if data.get(field) is not None:
                    doc.set(field, data.get(field))
            doc.attached_to_doctype = "Purchase Invoice"
            doc.attached_to_name = target
            # The blob is already on disk at this exact file_url - restored
            # from the pre-deletion backup - so the row is what is missing,
            # not the bytes. Without this flag File.before_insert treats it
            # as a fresh upload: it re-reads the content, re-runs the PDF
            # scanner over it and writes it out again under a sanitised name,
            # which would move the file out from under its own URL.
            doc.flags.copy_from_existing_file = True
            doc.flags.ignore_duplicate_entry_error = True
            doc.insert(ignore_permissions=True)
            frappe.db.commit()
    print("  attachments: %d re-attached, %d already present, %d need re-upload"
          % (found, already, missing))
