"""Reconcile a line's subcontractor split — Administrator only.

Every other route into the split is derived: the closure ledger, the rollout
plan's teams, the line's own stamp. Derivation is faithful to what the system
recorded, which is not always what happened — on this bench 154 lines worth
SAR 139,693 have a plan team that disagrees with the line's stamp, and the
client has said of one qty-6 line that the real division was 5 Mabran / 1 INET
where the plans say 3 / 3.

Nothing can settle that from inside the system, so this screen puts every
source side by side and lets a person decide. The decision is written to the
closure ledger when the line has been closed (the ledger is what each supplier
is paid on) and to the allocation rows otherwise, and it is marked so no later
re-derivation overwrites it.

Administrator ONLY, deliberately — see ``roles.is_superuser``. This rewrites
who gets paid, and an issued supplier PO still blocks it.
"""

import frappe
from frappe.utils import cstr, flt

from inet_app.api.subcontractor_sync import (
    ALLOC_FROM_ADMIN,
    MANUAL_OVERRIDE_REMARK,
    SUBCON_LOCKED,
    assert_subcontractor_change_allowed,
    dispatch_subcontractor_locks,
    resync_dispatch_allocations,
)
from inet_app.roles import is_superuser


def _require_superuser():
    if not is_superuser():
        frappe.throw(
            "Reconciling a subcontractor is restricted to the Administrator.",
            frappe.PermissionError,
        )


def _resolve_dispatch(poid):
    """Accept a POID or a PO Dispatch name — the admin will paste either."""
    key = cstr(poid or "").strip()
    if not key:
        frappe.throw("Enter a POID.")
    if frappe.db.exists("PO Dispatch", key):
        return key
    name = frappe.db.get_value("PO Dispatch", {"poid": key}, "name")
    if not name:
        frappe.throw(f"No PO line found for {key}.")
    return name


@frappe.whitelist()
def get_subcontractor_reconcile(poid):
    """Everything known about one line's subcontractor, from every source.

    Returned whole rather than as separate calls: the point of the screen is
    seeing the sources disagree, and three round trips would let the parts
    arrive out of step with each other.
    """
    _require_superuser()
    name = _resolve_dispatch(poid)

    line = frappe.db.get_value(
        "PO Dispatch", name,
        ["name", "poid", "po_no", "project_code", "site_code", "item_code",
         "item_description", "qty", "confirmed_qty", "rate", "line_amount",
         "contract", "im", "dispatch_status", "pic_status", "pic_status_ms2",
         "ms1_amount", "ms2_amount", "is_dummy_po", "is_internal_work",
         "backend_team"],
        as_dict=True,
    ) or {}

    allocations = frappe.get_all(
        "PO Subcontract Allocation",
        filters={"parent": name, "parenttype": "PO Dispatch",
                 "parentfield": "subcontract_allocations"},
        fields=["subcontractor", "qty", "amount", "source",
                "sub_po_status_ms1", "sub_po_amount_ms1", "sub_po_date_ms1",
                "sub_po_status_ms2", "sub_po_amount_ms2", "sub_po_date_ms2"],
        order_by="idx",
    ) or []

    # The Work Done and its ledger — "any method" was the explicit ask, so a
    # Direct Close, a Backend assign and a rollout close all show the same way.
    work_done = frappe.get_all(
        "Work Done", filters={"system_id": name},
        fields=["name", "source", "executed_qty", "revenue_sar", "subcontractor",
                "submission_status", "execution", "creation"],
    ) or []
    ledger = []
    for wd in work_done:
        for row in frappe.get_all(
            "Work Done Closure", filters={"parent": wd["name"]},
            fields=["name", "closed_qty", "closed_amount", "closed_on", "milestone",
                    "source", "closed_by", "subcontractor", "rollout_plan", "team",
                    "remark"],
            order_by="idx",
        ) or []:
            row["work_done"] = wd["name"]
            ledger.append(row)

    plans = frappe.db.sql(
        """
        SELECT rp.name, rp.plan_date, rp.plan_status, rp.visit_number, rp.visit_type,
               rp.team, it.team_name, it.team_type, it.subcontractor,
               rpt.assigned_qty, rpt.achieved_qty, rpt.tl_status
        FROM `tabRollout Plan` rp
        LEFT JOIN `tabRollout Plan Team` rpt ON rpt.parent = rp.name
        LEFT JOIN `tabINET Team` it ON it.name = COALESCE(rpt.team, rp.team)
        WHERE rp.po_dispatch = %s
        ORDER BY IFNULL(rp.visit_number, 0) DESC, rp.creation DESC
        """,
        (name,), as_dict=True,
    ) or []

    # What each source WOULD say, so the disagreement is visible rather than
    # something the admin has to reconstruct.
    from inet_app.api.subcontractor_sync import derive_dispatch_allocations
    derived = derive_dispatch_allocations(name)

    locks = dispatch_subcontractor_locks(name)
    history = frappe.get_all(
        "PO Status Event",
        filters={"po_dispatch": name, "field_changed": "contract"},
        fields=["old_value", "new_value", "remark", "changed_at", "changed_by"],
        order_by="changed_at desc", limit_page_length=20,
    ) if frappe.db.exists("DocType", "PO Status Event") else []

    return {
        "line": line,
        "allocations": allocations,
        "work_done": work_done,
        "ledger": ledger,
        "plans": plans,
        "derived": derived,
        "locks": locks,
        "locked": any(v["state"] == SUBCON_LOCKED for v in locks.values()),
        "history": history,
        "subcontractors": frappe.get_all(
            "Subcontract Master", fields=["name", "subcontractor_name", "type",
                                          "sub_payout_pct", "inet_margin_pct"],
            order_by="subcontractor_name", limit_page_length=0),
    }


@frappe.whitelist()
def set_subcontractor_allocation(po_dispatch, allocation, remark=None):
    """Write a hand-decided split. Returns the reloaded reconcile payload.

    The split is a RE-DIVISION, never a re-quantification: its total must equal
    what the line already says was done. Changing how much was done is the
    confirmation step's job and has its own invoicing guards; letting this
    screen do both would make one button able to move money two ways at once.

    When the line has a closure ledger, that is what gets rewritten — the
    ledger is what each supplier is paid on, and an allocation corrected
    without it would be reverted by the next close event. A line with no
    closure yet gets allocation rows directly.
    """
    _require_superuser()
    name = _resolve_dispatch(po_dispatch)

    if isinstance(allocation, str):
        allocation = frappe.parse_json(allocation)
    clean, seen = [], set()
    for entry in (allocation or []):
        if not isinstance(entry, dict):
            continue
        sub = cstr(entry.get("subcontractor") or "").strip()
        qty = flt(entry.get("qty") or 0)
        if not sub or qty <= 0:
            continue
        if sub in seen:
            frappe.throw(f"{sub} appears twice — combine the quantities.")
        if not frappe.db.exists("Subcontract Master", sub):
            frappe.throw(f"Unknown subcontractor: {sub}")
        seen.add(sub)
        clean.append({"subcontractor": sub, "qty": qty})
    if not clean:
        frappe.throw("Give at least one subcontractor and quantity.")

    pd = frappe.db.get_value("PO Dispatch", name,
                             ["poid", "qty", "confirmed_qty", "rate", "line_amount"],
                             as_dict=True)
    poid = pd.get("poid") or name

    wd = frappe.get_all("Work Done", filters={"system_id": name},
                        fields=["name", "executed_qty", "revenue_sar"], limit=1)
    # The total to match: what was actually closed when there is a Work Done,
    # the confirmed quantity next, the ordered quantity last.
    expected = (flt(wd[0]["executed_qty"]) if wd
                else (flt(pd.get("confirmed_qty")) or flt(pd.get("qty"))))
    total = round(sum(e["qty"] for e in clean), 4)
    if expected and abs(total - flt(expected)) > 0.0001:
        frappe.throw(
            f"{poid}: the split adds up to {total:g}, but this line carries "
            f"{flt(expected):g}. Reconciling re-divides a quantity between "
            f"subcontractors — it does not change how much was done."
        )

    # An issued supplier PO still wins. Throws for a submitted PO, warns for a draft.
    assert_subcontractor_change_allowed(name, clean)

    if wd:
        _rewrite_ledger(wd[0], clean, remark)
    _write_allocations(name, clean, pd)

    try:
        from inet_app.api.status_log import log_status_event
        old = cstr(frappe.db.get_value("PO Dispatch", name, "contract") or "")
        # The line's single stamp follows the LARGEST share: it is the "who
        # does this line belong to" field, and on a split the biggest share is
        # the only defensible single answer.
        new = max(clean, key=lambda e: e["qty"])["subcontractor"]
        if new != old:
            frappe.db.set_value("PO Dispatch", name, "contract", new,
                                update_modified=False)
            log_status_event(name, "contract", old, new,
                             remark=MANUAL_OVERRIDE_REMARK, stamp_stage=False)
    except Exception:
        frappe.log_error(frappe.get_traceback(), "subcon reconcile: contract stamp")

    frappe.db.commit()
    return get_subcontractor_reconcile(name)


def _rewrite_ledger(wd_row, clean, remark):
    """Re-divide the closure ledger between suppliers, total untouched.

    Written as whole rows rather than patched in place: a ledger row is one
    closing event under one supplier, so a split that goes from two suppliers
    to three has no row-by-row correspondence to preserve.
    """
    doc = frappe.get_doc("Work Done", wd_row["name"])
    rows = list(doc.get("closures") or [])
    if not rows:
        return
    total_qty = sum(flt(r.closed_qty) for r in rows) or flt(wd_row["executed_qty"])
    total_amt = sum(flt(r.closed_amount) for r in rows) or flt(wd_row["revenue_sar"])
    first = rows[0]

    doc.set("closures", [])
    booked = 0.0
    for i, e in enumerate(clean):
        qty = flt(e["qty"])
        # The last leg absorbs the rounding, so the ledger still sums EXACTLY
        # to what the line was worth — the same rule _sync_work_done_closures
        # uses when it splits an amount.
        amt = (round(total_amt - booked, 4) if i == len(clean) - 1
               else round(total_amt * qty / total_qty, 4) if total_qty else 0.0)
        booked = round(booked + amt, 4)
        doc.append("closures", {
            "closed_qty": qty,
            "closed_amount": amt,
            "closed_on": first.closed_on,
            "milestone": first.milestone,
            "source": first.source,
            "closed_by": frappe.session.user,
            "subcontractor": e["subcontractor"],
            "remark": (f"{MANUAL_OVERRIDE_REMARK}: {remark}" if remark
                       else MANUAL_OVERRIDE_REMARK)[:1000],
        })
    doc.save(ignore_permissions=True)


def _write_allocations(name, clean, pd):
    """Store the hand-set split, marked so nothing re-derives past it."""
    rate = flt(pd.get("rate") or 0)
    ordered = flt(pd.get("qty") or 0)
    line_amount = flt(pd.get("line_amount") or 0)

    def _amount(q):
        if rate:
            return round(rate * q, 4)
        return round(line_amount * q / ordered, 4) if ordered else 0.0

    prev = {cstr(r.subcontractor): r for r in frappe.get_all(
        "PO Subcontract Allocation",
        filters={"parent": name, "parenttype": "PO Dispatch",
                 "parentfield": "subcontract_allocations"},
        fields=["subcontractor", "sub_po_status_ms1", "sub_po_pct_ms1",
                "sub_po_amount_ms1", "sub_po_date_ms1", "sub_paid_date_ms1",
                "sub_po_remark_ms1", "sub_po_status_ms2", "sub_po_pct_ms2",
                "sub_po_amount_ms2", "sub_po_date_ms2", "sub_paid_date_ms2",
                "sub_po_remark_ms2"])}

    frappe.db.delete("PO Subcontract Allocation", {
        "parent": name, "parenttype": "PO Dispatch",
        "parentfield": "subcontract_allocations",
    })
    for idx, e in enumerate(clean, start=1):
        row = {
            "doctype": "PO Subcontract Allocation",
            "parent": name, "parenttype": "PO Dispatch",
            "parentfield": "subcontract_allocations", "idx": idx,
            "subcontractor": e["subcontractor"], "qty": flt(e["qty"]),
            "amount": _amount(flt(e["qty"])), "source": ALLOC_FROM_ADMIN,
        }
        # PO tracking belongs to PIC, not to this correction — carried across
        # by subcontractor exactly as resync_dispatch_allocations does.
        old = prev.get(e["subcontractor"])
        if old:
            for f, v in old.items():
                if f != "subcontractor" and v is not None:
                    row[f] = v
        frappe.get_doc(row).db_insert()


@frappe.whitelist()
def clear_subcontractor_override(po_dispatch):
    """Drop the hand-set mark so the line goes back to being derived."""
    _require_superuser()
    name = _resolve_dispatch(po_dispatch)
    # Deleted rather than un-marked: a resync writes nothing when the shares it
    # derives already match what is stored, so blanking the source in place
    # would leave rows that claim no origin at all. Rebuilding from empty makes
    # the screen show where each share really comes from again.
    frappe.db.delete("PO Subcontract Allocation", {
        "parent": name, "parenttype": "PO Dispatch",
        "parentfield": "subcontract_allocations",
    })
    resync_dispatch_allocations(name, reason="admin cleared the override")
    frappe.db.commit()
    return get_subcontractor_reconcile(name)
