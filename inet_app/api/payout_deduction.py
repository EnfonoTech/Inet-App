"""Payout deductions — money taken off what a line pays its subcontractor.

See docs/PAYOUT_DEDUCTION.md for the why. In short: a `PO Payout Deduction`
row on a PO Dispatch line says "SAR X of this line is not the subcontractor's",
with a type (`Deduction Type`, a master), a basis (off the line value before
the payout %, or off the payout itself) and a settlement:

  * Retained  — the money stays with the company
  * Paid Out  — it goes to a third party, so it is a cost in the margin

Every payout and margin figure reads the rows through ``deduction_sql`` in
subcontractor_sync.py — that is the one definition. This module only writes
rows, previews their effect, and raises the Paid Out purchase invoice.

The rule that keeps every report consistent: a row may be added, edited or
removed only while the milestones it falls on are UNORDERED. A supplier PO
raised afterwards carries the deduction as a discount, so the PO, its stamped
amount, the payout column and the margin all say the same thing. Once a
milestone is ordered the row is locked.
"""
import frappe
from frappe.utils import cint, cstr, flt, now_datetime, nowdate

from inet_app.setup import ACCOUNTING_DUID_FIELDNAME
from inet_app.api.subcontractor_sync import (
    ALLOC_TOTALS_JOIN_SQL,
    deduction_sql,
)

SETTLEMENTS = ("Retained", "Paid Out")
DEDUCT_FROM = ("Line Value", "Payout")
_PARENT = {"parenttype": "PO Dispatch", "parentfield": "payout_deductions"}
# A milestone at one of these has no supplier PO yet, so a deduction on it can
# still change what the PO will say. Anything further along is locked.
_UNORDERED = ("", "Ready to Order")
_ROW_FIELDS = ["name", "parent", "idx", "deduction_type", "deduct_from", "amount",
               "settlement", "payee", "subcontractor", "milestone",
               "purchase_invoice", "remark", "added_by", "added_on"]


def _require_pic():
    from inet_app.api.pic import _pic_role_or_throw
    _pic_role_or_throw()


def _as_list(value):
    if isinstance(value, str):
        value = value.strip()
        if value.startswith("["):
            value = frappe.parse_json(value)
        else:
            value = [value] if value else []
    return [cstr(v).strip() for v in (value or []) if cstr(v).strip()]


def _as_dict(value):
    if isinstance(value, str):
        value = frappe.parse_json(value) if value.strip() else {}
    return value or {}


# ── Reading ──────────────────────────────────────────────────────────────

def batch_line_deductions(po_dispatch_names):
    """``{po_dispatch: [row, ...]}`` for the lines that have any."""
    names = sorted({n for n in (po_dispatch_names or []) if n})
    out = {}
    for i in range(0, len(names), 800):
        chunk = names[i:i + 800]
        for r in frappe.get_all(
            "PO Payout Deduction",
            filters=dict(_PARENT, parent=["in", chunk]),
            fields=_ROW_FIELDS, order_by="idx asc",
            limit_page_length=0,
        ):
            out.setdefault(r.parent, []).append(r)
    return out


def attach_deductions(rows, key="po_dispatch", field="payout_deductions"):
    """Hang each row's deduction list off it, in place, for the lines with any.

    Only rows whose ``deduction_amount`` is non-zero are looked up when that
    column is present, so a page of lines with no deductions costs nothing.
    """
    rows = rows or []
    want = [r.get(key) for r in rows if isinstance(r, dict) and r.get(key)
            and ("deduction_amount" not in r or flt(r.get("deduction_amount")))]
    if not want:
        return rows
    by_line = batch_line_deductions(want)
    for r in rows:
        found = by_line.get(r.get(key)) if isinstance(r, dict) else None
        if found:
            r[field] = found
    return rows


def _line_heads(names):
    """The line fields the rules below need, keyed by PO Dispatch name."""
    out = {}
    for i in range(0, len(names), 800):
        chunk = names[i:i + 800]
        for r in frappe.get_all(
            "PO Dispatch", filters={"name": ["in", chunk]},
            fields=["name", "poid", "line_amount", "ms1_amount", "ms2_amount",
                    "sub_po_status_ms1", "sub_po_status_ms2", "is_internal_work",
                    "is_dummy_po"],
            limit_page_length=0,
        ):
            out[r.name] = r
    return out


def _touched_milestones(head, milestone):
    """The milestones a row pinned to ``milestone`` (or spread) falls on."""
    if milestone in ("MS1", "MS2"):
        return [milestone]
    return [ms for ms, n in (("MS1", 1), ("MS2", 2)) if flt(head.get(f"ms{n}_amount")) > 0] or ["MS1"]


def _lock_reason(head, milestone):
    """Why a deduction on this line + milestone can no longer change, or None."""
    for ms in _touched_milestones(head, milestone):
        status = cstr(head.get(f"sub_po_status_{ms.lower()}") or "").strip()
        if status not in _UNORDERED:
            return f"{ms} is already at {status}"
    return None


def _sub_legs(names):
    """``{po_dispatch: [subcontract, ...]}`` — the payable (SUB) legs of each line,
    through the same resolution the Subcon PO page uses."""
    from inet_app.api.subcon_po import _SUBCON_FROM_JOIN, _SUBCON_BASE_WHERE
    out = {}
    for i in range(0, len(names), 800):
        chunk = names[i:i + 800]
        ph = ", ".join(["%s"] * len(chunk))
        for r in frappe.db.sql(
            f"""SELECT pd.name AS po_dispatch, sm.name AS subcontract
                {_SUBCON_FROM_JOIN}
                WHERE pd.name IN ({ph}) AND {' AND '.join(_SUBCON_BASE_WHERE)}""",
            tuple(chunk), as_dict=True,
        ):
            out.setdefault(r.po_dispatch, []).append(r.subcontract)
    return out


def split_legs(names):
    """``{po_dispatch: [{subcontractor, label, share, payable}]}`` for lines
    split across more than one subcontractor leg.

    The preview and the popup show money for the PAYABLE legs only, so on a
    line half INet / half Jareesh the figures are Jareesh's half — and without
    saying so they read as a payout on an INET line. ``share`` is the leg's
    percentage of the line, the same quantity weighting ALLOC_SHARE_SQL uses.
    """
    names = sorted({n for n in (names or []) if n})
    out = {}
    if not names:
        return out
    rows = frappe.db.sql(
        """SELECT a.parent, a.subcontractor, IFNULL(a.qty, 0) AS qty,
                  IFNULL(sm.subcontractor_name, a.subcontractor) AS label,
                  IFNULL(sm.sub_payout_pct, 0) AS pct
             FROM `tabPO Subcontract Allocation` a
             LEFT JOIN `tabSubcontract Master` sm ON sm.name = a.subcontractor
            WHERE a.parenttype = 'PO Dispatch' AND a.parentfield = 'subcontract_allocations'
              AND a.parent IN ({})
            ORDER BY a.parent, a.idx""".format(", ".join(["%s"] * len(names))),
        tuple(names), as_dict=True)
    by = {}
    for r in rows:
        by.setdefault(r.parent, []).append(r)
    for parent, legs in by.items():
        if len(legs) < 2:
            continue
        total = sum(flt(l.qty) for l in legs)
        out[parent] = [{
            "subcontractor": l.subcontractor, "label": l.label,
            "share": round(flt(l.qty) / total * 100, 1) if total else round(100 / len(legs), 1),
            "payable": flt(l.pct) > 0,
        } for l in legs]
    return out


def leg_deductions(po_dispatch, subcontract, n):
    """``{"line", "payout", "paid"}`` for one supplier leg and milestone ``n``.

    Evaluated by ``deduction_sql`` itself over a minimal join that reproduces
    the Subcon PO page's ``alloc`` / ``alloc_tot`` / ``sm`` aliases, so the PO
    built from this cannot disagree with the figure the page showed.
    """
    row = frappe.db.sql(
        f"""
        SELECT {deduction_sql(n, 'line')} AS line,
               {deduction_sql(n, 'payout')} AS payout,
               {deduction_sql(n, 'paid')} AS paid
        FROM `tabPO Dispatch` pd
        JOIN `tabSubcontract Master` sm ON sm.name = %s
        LEFT JOIN `tabPO Subcontract Allocation` alloc
               ON alloc.parent = pd.name AND alloc.parenttype = 'PO Dispatch'
              AND alloc.parentfield = 'subcontract_allocations'
              AND alloc.subcontractor = sm.name
        {ALLOC_TOTALS_JOIN_SQL}
        WHERE pd.name = %s
        """,
        (subcontract, po_dispatch), as_dict=True,
    )
    r = row[0] if row else {}
    return {k: flt(r.get(k)) for k in ("line", "payout", "paid")}


def deduction_per_unit(po_dispatch, subcontract, milestone, payout_pct, full_qty, ms_pct):
    """What one unit of a supplier PO line is reduced by.

    The leg's milestone deduction — line-value deductions scaled by the
    payout %, payout deductions whole, exactly as ``net_payout_sql`` — spread
    over the milestone's quantity, so a PO for part of the quantity carries
    its part. Zero on a line with no deduction rows, without a query.
    """
    if not (po_dispatch and subcontract):
        return 0.0
    if not frappe.db.exists("PO Payout Deduction", dict(_PARENT, parent=po_dispatch)):
        return 0.0
    n = 2 if cstr(milestone).upper() == "MS2" else 1
    ded = leg_deductions(po_dispatch, subcontract, n)
    effect = flt(ded["line"]) * flt(payout_pct) / 100.0 + flt(ded["payout"])
    if effect <= 0:
        return 0.0
    full_qty = flt(full_qty) or 1.0
    ms_qty = round(full_qty * flt(ms_pct) / 100.0, 6) if flt(ms_pct) > 0 else full_qty
    return effect / ms_qty if ms_qty else effect


def deduction_labels(po_dispatch, milestone):
    """Type names of the rows that fall on ``milestone`` — for the PO text."""
    names = []
    for r in frappe.get_all("PO Payout Deduction", filters=dict(_PARENT, parent=po_dispatch),
                            fields=["deduction_type", "milestone"], order_by="idx asc"):
        if cstr(r.milestone) in ("", milestone) and r.deduction_type not in names:
            names.append(r.deduction_type)
    return names


def _line_metrics(names):
    """Per line, summed over its payable legs: gross payout, net payout,
    margin and deduction — the same expressions the Subcon PO page shows."""
    if not names:
        return {}
    from inet_app.api.subcon_po import (
        _SUBCON_BASE_WHERE, _SUBCON_FROM_JOIN, _deduction_total_sql,
        _expected_payout_sql, _gross_payout_sql, _inet_amount_sql,
    )
    ph = ", ".join(["%s"] * len(names))
    rows = frappe.db.sql(
        f"""
        SELECT pd.name AS po_dispatch,
               SUM({_gross_payout_sql(1)} + {_gross_payout_sql(2)}) AS gross_payout,
               SUM({_expected_payout_sql(1)} + {_expected_payout_sql(2)}) AS payout,
               SUM({_inet_amount_sql(1)} + {_inet_amount_sql(2)}) AS margin,
               SUM({_deduction_total_sql()}) AS deduction
        {_SUBCON_FROM_JOIN}
        WHERE pd.name IN ({ph}) AND {' AND '.join(_SUBCON_BASE_WHERE)}
        GROUP BY pd.name
        """,
        tuple(names), as_dict=True,
    )
    return {r.po_dispatch: {k: round(flt(r.get(k)), 2)
                            for k in ("gross_payout", "payout", "margin", "deduction")}
            for r in rows}


@frappe.whitelist()
def get_deduction_types():
    """Enabled types with their defaults, for the Add Deduction form."""
    return frappe.get_all(
        "Deduction Type", filters={"enabled": 1},
        fields=["name", "deduct_from", "default_amount", "default_settlement", "expense_item"],
        order_by="name asc",
    )


@frappe.whitelist()
def search_payees(txt=None, limit=20):
    """Suppliers for the Paid Out payee picker, ``[{id, label}]``."""
    _require_pic()
    txt = cstr(txt).strip()
    filters = {"disabled": 0}
    or_filters = ([["name", "like", f"%{txt}%"], ["supplier_name", "like", f"%{txt}%"]]
                  if txt else None)
    rows = frappe.get_all("Supplier", filters=filters, or_filters=or_filters,
                          fields=["name", "supplier_name"], order_by="supplier_name asc",
                          limit_page_length=cint(limit) or 20)
    return [{"id": r.name,
             "label": r.supplier_name if r.supplier_name == r.name or not r.supplier_name
             else f"{r.supplier_name} ({r.name})"} for r in rows]


@frappe.whitelist()
def get_line_deductions(po_dispatch):
    """One line's deductions, each with whether it can still be changed."""
    _require_pic()
    head = _line_heads([po_dispatch]).get(po_dispatch)
    if not head:
        frappe.throw(f"PO Dispatch {po_dispatch} not found.")
    rows = batch_line_deductions([po_dispatch]).get(po_dispatch) or []
    pis = {r.purchase_invoice for r in rows if r.purchase_invoice}
    pi_state = {p.name: p.docstatus for p in frappe.get_all(
        "Purchase Invoice", filters={"name": ["in", sorted(pis) or [""]]},
        fields=["name", "docstatus"])} if pis else {}
    for r in rows:
        r["purchase_invoice_status"] = (
            {0: "Draft", 1: "Submitted", 2: "Cancelled"}.get(pi_state.get(r.purchase_invoice))
            if r.purchase_invoice else None)
        r["lock_reason"] = _row_lock_reason(head, r, pi_state)
    return {
        "rows": rows,
        "metrics": _line_metrics([po_dispatch]).get(po_dispatch) or {},
        # False on an INET-crew line: nothing is paid to a subcontractor, so
        # only a Paid Out deduction (a third party's cost) can sit on it.
        "has_payout": bool(_sub_legs([po_dispatch]).get(po_dispatch)),
        # A split line's payout and margin above are its PAYABLE legs only.
        "split": split_legs([po_dispatch]).get(po_dispatch) or [],
        "can_add": not _lock_reason(head, ""),
        "add_lock_reason": _lock_reason(head, ""),
    }


def _row_lock_reason(head, row, pi_state=None):
    reason = _lock_reason(head, cstr(row.get("milestone")))
    if reason:
        return reason
    pi = row.get("purchase_invoice")
    if pi:
        state = (pi_state or {}).get(pi)
        if state is None:
            state = frappe.db.get_value("Purchase Invoice", pi, "docstatus")
        if cint(state) == 1:
            return f"Purchase Invoice {pi} is submitted"
    return None


# ── Writing ──────────────────────────────────────────────────────────────

def _clean_input(deduction_type, settlement, payee, milestone, subcontractor,
                 require_enabled=True):
    dtype = frappe.db.get_value(
        "Deduction Type", deduction_type,
        ["name", "deduct_from", "enabled", "expense_item"], as_dict=True)
    if not dtype:
        frappe.throw(f"Deduction Type '{deduction_type}' not found.")
    if require_enabled and not cint(dtype.enabled):
        frappe.throw(f"Deduction Type '{deduction_type}' is disabled.")
    settlement = cstr(settlement).strip()
    if settlement not in SETTLEMENTS:
        frappe.throw("Settlement must be Retained or Paid Out.")
    payee = cstr(payee).strip() or None
    if settlement == "Paid Out":
        if not payee:
            frappe.throw("A Paid Out deduction needs a payee.")
        if not frappe.db.exists("Supplier", payee):
            frappe.throw(f"Supplier '{payee}' not found.")
    else:
        payee = None
    milestone = cstr(milestone).strip().upper()
    if milestone in ("", "AUTO"):
        milestone = ""
    elif milestone not in ("MS1", "MS2"):
        frappe.throw("Milestone must be MS1, MS2 or blank.")
    subcontractor = cstr(subcontractor).strip() or None
    return dtype, settlement, payee, milestone, subcontractor


def _split_amounts(names, amount_mode, amount, amounts):
    """Per-line amounts: the same figure on each, or a total split equally
    with the last line taking the rounding so the parts sum exactly. Any
    per-line figure the user edited in the preview wins."""
    amount = flt(amount, 2)
    out = {}
    if cstr(amount_mode) == "split" and names:
        share = flt(amount / len(names), 2)
        for i, n in enumerate(names):
            out[n] = share if i < len(names) - 1 else flt(amount - share * (len(names) - 1), 2)
    else:
        out = {n: amount for n in names}
    for n, v in (_as_dict(amounts) or {}).items():
        if n in out and v not in (None, ""):
            out[n] = flt(v, 2)
    return out


def _plan(names, dtype, settlement, payee, milestone, subcontractor, per_line, metrics):
    """Check every line; return ``(ok, blocked)`` without writing anything.

    A Payout-basis deduction may not exceed the line's payout. That keeps the
    payout from ever being clamped at zero, which is what lets the reports
    that slice a line by invoiced amount subtract deductions linearly and
    still agree with the Subcon PO page to the cent."""
    heads = _line_heads(names)
    legs = _sub_legs(names)
    ok, blocked = [], []
    for name in names:
        head = heads.get(name)
        label = (head or {}).get("poid") or name
        amt = flt(per_line.get(name))
        why = None
        if not head:
            why = "line not found"
        elif cint(head.is_internal_work) or cint(head.is_dummy_po):
            why = "internal work or dummy PO"
        elif not legs.get(name) and settlement != "Paid Out":
            # An INET-crew line pays no subcontractor, so there is nothing to
            # retain FROM — only a third party's cost can sit on it.
            why = "no subcontractor payout to take it from — on an INET-crew line only Paid Out applies"
        elif not legs.get(name) and dtype.deduct_from == "Payout":
            why = "the line has no subcontractor payout — use a Line Value type"
        elif not legs.get(name) and subcontractor:
            why = "the line has no subcontractor"
        elif subcontractor and subcontractor not in legs[name]:
            why = f"{subcontractor} is not a subcontractor on this line"
        elif milestone and flt(head.get(f"ms{milestone[-1]}_amount")) <= 0:
            why = f"the line has no {milestone}"
        elif amt <= 0:
            why = "amount must be more than zero"
        elif amt > flt(head.line_amount):
            why = f"more than the line value ({flt(head.line_amount):,.2f})"
        elif (dtype.deduct_from == "Payout"
              and amt > flt((metrics.get(name) or {}).get("payout"))):
            why = f"more than the payout ({flt((metrics.get(name) or {}).get('payout')):,.2f})"
        else:
            why = _lock_reason(head, milestone)
            if why:
                why += " — a deduction can only change while the milestone is unordered"
        if why:
            blocked.append({"po_dispatch": name, "poid": label, "amount": amt, "reason": why})
        else:
            ok.append({"po_dispatch": name, "poid": label, "amount": amt,
                       "line_amount": flt(head.line_amount),
                       # INET-crew line: no payout to move, only a cost.
                       "inet_line": not legs.get(name)})
    return ok, blocked


def _resolve(names, dtype, settlement, payee, milestone, subcontractor,
             amount_mode, amount, amounts, metrics):
    """``(ok, blocked)`` with the amounts settled.

    "Split a total" divides across the lines that can actually TAKE the
    deduction: a report fee of 300 over three sites, one of them already
    ordered, is 150 on each of the other two — not 100 each and 100 lost.
    """
    per_line = _split_amounts(names, amount_mode, amount, amounts)
    ok, blocked = _plan(names, dtype, settlement, payee, milestone, subcontractor,
                        per_line, metrics)
    if cstr(amount_mode) == "split" and blocked and ok:
        ok_names = [e["po_dispatch"] for e in ok]
        per_line = _split_amounts(ok_names, amount_mode, amount, amounts)
        ok, more_blocked = _plan(ok_names, dtype, settlement, payee, milestone,
                                 subcontractor, per_line, metrics)
        blocked = blocked + more_blocked
    return ok, blocked


def _insert_rows(ok, dtype, settlement, payee, milestone, subcontractor, remark):
    user, at = frappe.session.user, now_datetime()
    names = [e["po_dispatch"] for e in ok]
    next_idx = {}
    if names:
        for r in frappe.db.sql(
            """SELECT parent, MAX(idx) AS idx FROM `tabPO Payout Deduction`
                WHERE parenttype = 'PO Dispatch' AND parentfield = 'payout_deductions'
                  AND parent IN ({}) GROUP BY parent""".format(", ".join(["%s"] * len(names))),
            tuple(names), as_dict=True,
        ):
            next_idx[r.parent] = cint(r.idx)
    for e in ok:
        idx = next_idx.get(e["po_dispatch"], 0) + 1
        next_idx[e["po_dispatch"]] = idx
        frappe.get_doc(dict(
            _PARENT, doctype="PO Payout Deduction", parent=e["po_dispatch"], idx=idx,
            deduction_type=dtype.name, deduct_from=dtype.deduct_from,
            amount=e["amount"], settlement=settlement, payee=payee,
            subcontractor=subcontractor, milestone=milestone or None,
            remark=cstr(remark).strip() or None, added_by=user, added_on=at,
        )).db_insert()
    _touch(names)


def _touch(names):
    """Bump the lines' ``modified``. The dashboards cache on an etag built from
    MAX(modified) of PO Dispatch and friends (_dashboard_etag), and a child row
    written on its own never moves it — so without this a new deduction would
    leave every cached payout and margin figure stale until something else
    changed."""
    names = sorted({n for n in names if n})
    if not names:
        return
    frappe.db.sql(
        "UPDATE `tabPO Dispatch` SET modified = %s, modified_by = %s WHERE name IN ({})".format(
            ", ".join(["%s"] * len(names))),
        tuple([now_datetime(), frappe.session.user] + names))


def _audit(names, new_value, remark=None):
    from inet_app.api.pic import _write_pic_activity_log
    _write_pic_activity_log("Other", None, "payout_deduction", new_value,
                            [{"po_dispatch": n} for n in names], {}, remark=remark)


@frappe.whitelist()
def preview_payout_deduction(po_dispatches, deduction_type, settlement, amount=0,
                             amount_mode="each", amounts=None, payee=None,
                             milestone=None, subcontractor=None):
    """What adding this deduction would do, line by line, without saving.

    The rows are written inside a savepoint, read back through the very
    expressions the Subcon PO page and the reports use, and rolled back — so
    the "after" in the preview is the after every report will show.
    """
    _require_pic()
    names = _as_list(po_dispatches)
    if not names:
        frappe.throw("Select at least one line.")
    dtype, settlement, payee, milestone, subcontractor = _clean_input(
        deduction_type, settlement, payee, milestone, subcontractor)
    before = _line_metrics(names)
    ok, blocked = _resolve(names, dtype, settlement, payee, milestone, subcontractor,
                           amount_mode, amount, amounts, before)

    ok_names = [e["po_dispatch"] for e in ok]
    after = {}
    if ok:
        frappe.db.savepoint("payout_deduction_preview")
        try:
            _insert_rows(ok, dtype, settlement, payee, milestone, subcontractor, None)
            after = _line_metrics(ok_names)
        finally:
            frappe.db.rollback(save_point="payout_deduction_preview")

    splits = split_legs(ok_names)
    for e in ok:
        if splits.get(e["po_dispatch"]):
            e["split"] = splits[e["po_dispatch"]]
    lines = []
    for e in ok:
        if e.get("inet_line"):
            # No payout here; the deduction is a third party's cost against
            # the line, and that is the whole of its effect.
            lines.append(dict(e, payout_before=None, payout_after=None,
                              margin_before=None, margin_after=None, cost=e["amount"]))
            continue
        b, a = before.get(e["po_dispatch"]) or {}, after.get(e["po_dispatch"]) or {}
        lines.append(dict(e,
                          payout_before=flt(b.get("payout")), payout_after=flt(a.get("payout")),
                          margin_before=flt(b.get("margin")), margin_after=flt(a.get("margin"))))
    sub = [l for l in lines if not l.get("inet_line")]
    return {
        "lines": lines,
        "blocked": blocked,
        "total": round(sum(e["amount"] for e in ok), 2),
        "payout_change": round(sum(l["payout_after"] - l["payout_before"] for l in sub), 2),
        "margin_change": round(sum(l["margin_after"] - l["margin_before"] for l in sub)
                               - sum(l["cost"] for l in lines if l.get("inet_line")), 2),
    }


@frappe.whitelist()
def add_payout_deduction(po_dispatches, deduction_type, settlement, amount=0,
                         amount_mode="each", amounts=None, payee=None,
                         milestone=None, subcontractor=None, remark=None):
    """Add one deduction to each selected line. Blocked lines are skipped and
    reported, never half-written."""
    _require_pic()
    names = _as_list(po_dispatches)
    if not names:
        frappe.throw("Select at least one line.")
    dtype, settlement, payee, milestone, subcontractor = _clean_input(
        deduction_type, settlement, payee, milestone, subcontractor)
    before = _line_metrics(names)
    ok, blocked = _resolve(names, dtype, settlement, payee, milestone, subcontractor,
                           amount_mode, amount, amounts, before)
    if not ok:
        frappe.throw("Nothing to add: " + "; ".join(
            f"{b['poid']}: {b['reason']}" for b in blocked[:10]))
    _insert_rows(ok, dtype, settlement, payee, milestone, subcontractor, remark)
    _audit([e["po_dispatch"] for e in ok],
           f"+ {dtype.name} {settlement}", remark=cstr(remark).strip() or None)
    frappe.db.commit()
    return {"added": len(ok), "blocked": blocked,
            "total": round(sum(e["amount"] for e in ok), 2)}


def _get_row(row_name):
    row = frappe.db.get_value("PO Payout Deduction", row_name, _ROW_FIELDS, as_dict=True)
    if not row:
        frappe.throw("That deduction no longer exists — refresh the page.")
    head = _line_heads([row.parent]).get(row.parent)
    return row, head


@frappe.whitelist()
def update_payout_deduction(row, amount=None, settlement=None, payee=None,
                            milestone=None, remark=None):
    """Change an unlocked row. The type stays; remove and add to change it."""
    _require_pic()
    current, head = _get_row(row)
    reason = _row_lock_reason(head, current)
    if reason:
        frappe.throw(f"Locked: {reason}.")
    if current.purchase_invoice:
        frappe.throw("Remove the draft purchase invoice first — delete this "
                     "deduction and add it again with the new figures.")
    dtype, settlement, payee, new_ms, _sub = _clean_input(
        current.deduction_type, settlement or current.settlement,
        payee if payee is not None else current.payee,
        milestone if milestone is not None else current.milestone,
        current.subcontractor, require_enabled=False)
    new_amount = flt(amount if amount not in (None, "") else current.amount, 2)
    if new_amount <= 0 or new_amount > flt(head.line_amount):
        frappe.throw("Amount must be more than zero and no more than the line value.")
    reason = _lock_reason(head, new_ms)
    if reason:
        frappe.throw(f"Locked: {reason}.")
    frappe.db.set_value("PO Payout Deduction", row, {
        "amount": new_amount, "settlement": settlement, "payee": payee,
        "milestone": new_ms or None,
        "remark": cstr(remark).strip() if remark is not None else current.remark,
    }, update_modified=False)
    _touch([current.parent])
    _audit([current.parent], f"~ {current.deduction_type} {settlement} {new_amount:g}")
    frappe.db.commit()
    return get_line_deductions(current.parent)


@frappe.whitelist()
def remove_payout_deduction(row):
    """Delete an unlocked row, and its draft purchase invoice with it."""
    _require_pic()
    current, head = _get_row(row)
    reason = _row_lock_reason(head, current)
    if reason:
        frappe.throw(f"Locked: {reason}.")
    pi = current.purchase_invoice
    if pi and frappe.db.exists("Purchase Invoice", pi):
        if cint(frappe.db.get_value("Purchase Invoice", pi, "docstatus")) == 0:
            frappe.delete_doc("Purchase Invoice", pi, ignore_permissions=True)
    frappe.db.delete("PO Payout Deduction", {"name": row})
    _touch([current.parent])
    _audit([current.parent], f"- {current.deduction_type} {current.settlement}")
    frappe.db.commit()
    return get_line_deductions(current.parent)


# A Paid Out row still owes an invoice when it has none, or only a cancelled
# one. The list's Deduction column, its filter and the bulk button all read
# this one expression so they cannot disagree about which lines are due.
_INVOICE_DUE_SQL = """
    d.settlement = 'Paid Out'
    AND NOT EXISTS (SELECT 1 FROM `tabPurchase Invoice` pi_d
                     WHERE pi_d.name = d.purchase_invoice AND pi_d.docstatus < 2)
"""


def deduction_state_sql(pd="pd"):
    """The line's deduction state, as the Deduction column shows it:
    '' (none), 'Invoice Due', 'Invoiced' (every Paid Out row has a live
    invoice) or 'Retained' (Retained rows only)."""
    base = (f"FROM `tabPO Payout Deduction` d WHERE d.parent = {pd}.name"
            " AND d.parenttype = 'PO Dispatch' AND d.parentfield = 'payout_deductions'")
    return (
        f"(CASE WHEN NOT EXISTS (SELECT 1 {base}) THEN ''"
        f" WHEN EXISTS (SELECT 1 {base} AND {_INVOICE_DUE_SQL}) THEN 'Invoice Due'"
        f" WHEN EXISTS (SELECT 1 {base} AND d.settlement = 'Paid Out') THEN 'Invoiced'"
        f" ELSE 'Retained' END)"
    )


def _due_rows(po_dispatches=None, rows=None):
    """Paid Out rows that still owe an invoice, for the given lines or rows."""
    cond, params = [], []
    if po_dispatches:
        cond.append("d.parent IN ({})".format(", ".join(["%s"] * len(po_dispatches))))
        params += list(po_dispatches)
    if rows:
        cond.append("d.name IN ({})".format(", ".join(["%s"] * len(rows))))
        params += list(rows)
    if not cond:
        return []
    return frappe.db.sql(
        f"""SELECT d.name, d.parent, d.deduction_type, d.amount, d.payee,
                   IFNULL(NULLIF(pd.poid, ''), pd.name) AS poid
              FROM `tabPO Payout Deduction` d
              JOIN `tabPO Dispatch` pd ON pd.name = d.parent
             WHERE d.parenttype = 'PO Dispatch' AND d.parentfield = 'payout_deductions'
               AND ({' OR '.join(cond)}) AND {_INVOICE_DUE_SQL}
             ORDER BY d.payee, pd.poid""",
        tuple(params), as_dict=True)


def _raise_invoices(due):
    """One DRAFT Purchase Invoice per payee, one item per deduction row.

    The items carry the line's ``poid`` — the POID accounting dimension, so
    the cost reaches the ledger against the line — plus ``payout_deduction``,
    which marks them as NOT the subcontractor's bill. Every reader of
    subcontractor bills by poid excludes that mark (not_deduction_bill_sql in
    subcon_po.py); the status hooks also need a milestone, which these items
    never carry.
    """
    skipped = [f"{r.poid}: no payee" for r in due if not r.payee]
    items = {}
    for t in {r.deduction_type for r in due}:
        items[t] = frappe.db.get_value("Deduction Type", t, "expense_item")
    skipped += [f"{r.poid}: '{r.deduction_type}' has no Expense Item — set one on Masters"
                for r in due if r.payee and not items.get(r.deduction_type)]
    by_payee = {}
    for r in due:
        if r.payee and items.get(r.deduction_type):
            by_payee.setdefault(r.payee, []).append(r)

    company = (frappe.defaults.get_user_default("Company")
               or frappe.defaults.get_global_default("company"))
    created = []
    # Same VAT template the subcontractor POs use. Server-side creation does
    # not fetch a template's rows (that is form JS), so they are appended here
    # as in create_purchase_order_from_pic — or the bill goes out with no VAT.
    # The deduction amount is the net figure; VAT is added on top, as on the
    # subcontractor's own PO.
    tax_template = frappe.db.get_single_value("INET Settings", "purchase_tax_template")
    tax_rows = []
    if tax_template:
        from erpnext.controllers.accounts_controller import get_taxes_and_charges
        tax_rows = get_taxes_and_charges("Purchase Taxes and Charges Template", tax_template) or []
    for payee, rows in by_payee.items():
        pi = frappe.new_doc("Purchase Invoice")
        pi.supplier = payee
        pi.company = company
        pi.posting_date = nowdate()
        pi.set_posting_time = 1
        if tax_template:
            pi.taxes_and_charges = tax_template
            for tax in tax_rows:
                pi.append("taxes", dict(tax))
        types = sorted({r.deduction_type for r in rows})
        dims = {d.name: d for d in frappe.get_all(
            "PO Dispatch", filters={"name": ["in", [r.parent for r in rows]]},
            fields=["name", "project_code", "site_code"])}
        real_projects = set(frappe.get_all("Project Control Center", pluck="name", filters={
            "name": ["in", [d.project_code for d in dims.values() if d.project_code] or [""]]}))
        real_duids = set(frappe.get_all("DUID Master", pluck="name", filters={
            "name": ["in", [d.site_code for d in dims.values() if d.site_code] or [""]]}))
        pi.remarks = f"{', '.join(types)} — {len(rows)} line(s): " + ", ".join(r.poid for r in rows[:20])
        for r in rows:
            pi.append("items", {
                "item_code": items[r.deduction_type],
                "description": f"{r.deduction_type} — {r.poid}",
                "qty": 1,
                "rate": flt(r.amount),
                "price_list_rate": flt(r.amount),
                "discount_percentage": 0,
                "discount_amount": 0,
                # The POID accounting dimension, so the cost lands on the line
                # in the ledger. `payout_deduction` marks it as NOT the
                # subcontractor's bill — see not_deduction_bill_sql.
                "poid": r.parent,
                "payout_deduction": r.name,
                "project_control_center": (dims[r.parent].project_code
                                           if dims[r.parent].project_code in real_projects else None),
                ACCOUNTING_DUID_FIELDNAME: (dims[r.parent].site_code
                                            if dims[r.parent].site_code in real_duids else None),
            })
        pi.flags.ignore_permissions = True
        pi.set_missing_values()
        pi.insert(ignore_permissions=True)
        for r in rows:
            frappe.db.set_value("PO Payout Deduction", r.name, "purchase_invoice", pi.name,
                                update_modified=False)
        _audit([r.parent for r in rows], f"PI {pi.name} for {', '.join(types)}")
        created.append({"purchase_invoice": pi.name, "payee": payee, "lines": len(rows),
                        "amount": round(sum(flt(r.amount) for r in rows), 2),
                        "grand_total": flt(pi.grand_total, 2),
                        "purchase_invoice_url": f"/app/purchase-invoice/{pi.name}"})
    return created, skipped


@frappe.whitelist()
def create_deduction_purchase_invoice(row):
    """Raise the draft Purchase Invoice for one Paid Out row (View popup)."""
    _require_pic()
    current, _head = _get_row(row)
    if current.settlement != "Paid Out":
        frappe.throw("Only a Paid Out deduction has someone to pay.")
    due = _due_rows(rows=[row])
    if not due:
        frappe.throw(f"Purchase Invoice {current.purchase_invoice} already exists for it.")
    created, skipped = _raise_invoices(due)
    if not created:
        frappe.throw("; ".join(skipped) or "Nothing to invoice.")
    frappe.db.commit()
    return created[0]


@frappe.whitelist()
def raise_deduction_invoices(po_dispatches):
    """Raise draft Purchase Invoices for every Paid Out deduction on the
    selected lines that has none yet — one invoice per payee, so a report
    preparer paid for ten sites gets one bill with ten lines."""
    _require_pic()
    names = _as_list(po_dispatches)
    if not names:
        frappe.throw("Select at least one line.")
    due = _due_rows(po_dispatches=names)
    if not due:
        frappe.throw("None of the selected lines has a Paid Out deduction waiting for an invoice.")
    created, skipped = _raise_invoices(due)
    if not created:
        frappe.throw("Nothing raised: " + "; ".join(skipped[:10]))
    frappe.db.commit()
    return {"created": created, "skipped": skipped}


def on_purchase_invoice_trash(doc, method=None):
    """A deleted draft takes its link off the deduction, so the button
    offers to raise it again rather than pointing at nothing."""
    for item in doc.get("items") or []:
        row = cstr(item.get("payout_deduction") or "").strip()
        if row and frappe.db.exists("PO Payout Deduction", row):
            frappe.db.set_value("PO Payout Deduction", row, "purchase_invoice", None,
                                update_modified=False)
