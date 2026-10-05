"""Which subcontractor a PO line belongs to — resolved from the last live visit.

A POID's subcontractor has never been a single stored value. It is resolved:
``pd.contract`` wins, else the rollout plan's team, else ``backend_team``'s.
``pd.contract`` is the snapshot the reports actually read, and it used to be
written **once** — every writer guarded with ``if subcontractor and not
existing_contract``. Whatever touched the line first won for good.

That guard is what produced the wrong values on this bench:

* A line planned to team A, cancelled, then re-planned to team B kept A's
  subcontractor, because the cancelled visit stamped it first.
* A line re-visited by a different team kept visit 1's subcontractor.
* Lines carrying an archive-import value never picked up the team that
  actually did the work.

The rule now is: **the last live visit owns the line.** A cancelled plan owns
nothing — cancelling re-derives from whatever visits remain, and clears the
snapshot when none do. Both are this module's job, so the rule lives in one
place instead of at each of the writers.

The one thing that overrides the rule is money: once a Subcon PO has been
raised against the line, the subcontractor is whoever that PO was sent to, and
no re-derivation may quietly move it.
"""

import frappe
from frappe.utils import cstr, flt

# The last live visit of each PO Dispatch, as a derived table.
#
# Ordering is (visit_number, creation) descending rather than creation alone:
# visit number is the business ordering and a re-visit can be created before an
# earlier visit is finally closed off. Cancelled plans are excluded here rather
# than filtered by the caller — a cancelled visit is not a source of truth for
# anything, and every previous reader of this relation used
# ``MAX(it.subcontractor)``, which picks the alphabetically largest name and so
# silently preferred a cancelled plan roughly half the time. No filter on the
# team having a subcontractor: if the last visit's team has none, the line has
# none from the plan side and the caller's COALESCE moves on to backend_team.
LAST_VISIT_SUBCONTRACTOR_SQL = """
    SELECT _lv.po_dispatch AS po_dispatch,
           _lv.team AS team,
           _lv.team_type AS team_type,
           _lv.subcontractor AS subcontractor
    FROM (
        SELECT rp.po_dispatch AS po_dispatch,
               rp.team AS team,
               it.team_type AS team_type,
               it.subcontractor AS subcontractor,
               ROW_NUMBER() OVER (
                   PARTITION BY rp.po_dispatch
                   ORDER BY IFNULL(rp.visit_number, 0) DESC, rp.creation DESC
               ) AS rn
        FROM `tabRollout Plan` rp
        JOIN `tabINET Team` it ON it.name = rp.team
        WHERE IFNULL(rp.plan_status, '') <> 'Cancelled'
    ) _lv
    WHERE _lv.rn = 1
"""

# ── The subcontractor split, as SQL ──────────────────────────────────────────
#
# A line split across subcontractors has one `PO Subcontract Allocation` row per
# supplier, and joining that table turns one line into one row PER SUPPLIER.
# Every money figure on such a row must therefore carry only that supplier's
# share, or two rows worth the whole line double the total.
#
# These two constants are the single definition of that. They live here, beside
# LAST_VISIT_SUBCONTRACTOR_SQL, because pic.py, subcon_po.py and
# command_center.py all need them and subcon_po.py already imports from pic.py —
# a copy in each would be three definitions drifting apart.
#
# `ALLOC_JOIN_SQL` expects the PO Dispatch aliased `pd`, and aliases the
# allocation `alloc`, its master `sm_alloc` and the line's allocation totals
# `alloc_tot`. The totals are a grouped derived table rather than a correlated
# subquery so they cost one scan, not one per row.
ALLOC_TOTALS_JOIN_SQL = """
LEFT JOIN (
    SELECT parent,
           SUM(IFNULL(qty, 0)) AS total_qty,
           COUNT(*) AS legs
    FROM `tabPO Subcontract Allocation`
    WHERE parenttype = 'PO Dispatch' AND parentfield = 'subcontract_allocations'
    GROUP BY parent
) alloc_tot ON alloc_tot.parent = pd.name
"""

ALLOC_JOIN_SQL = """
LEFT JOIN `tabPO Subcontract Allocation` alloc
       ON alloc.parent = pd.name
      AND alloc.parenttype = 'PO Dispatch'
      AND alloc.parentfield = 'subcontract_allocations'
LEFT JOIN `tabSubcontract Master` sm_alloc ON sm_alloc.name = alloc.subcontractor
""" + ALLOC_TOTALS_JOIN_SQL

# The allocation's share of its line.
#
# Divided by the line's ALLOCATED total, not by `pd.qty`. The two are usually
# the same, but not always: a partial close allocates less than the line, and a
# plan can assign more. Dividing by pd.qty there gives shares that do not sum
# to 1 — measured on the production copy, 6 lines, one of which weighted 200%
# of its own value. Dividing by the allocated total is exact by construction:
# the shares of a line always sum to exactly 1, whatever the quantities say.
#
# A line with no allocation rows, and a line whose allocations are all zero,
# fall to the ELSE branch: one row at share 1, or N rows at 1/N. The first is
# the overwhelming majority and is today's figure unchanged.
ALLOC_SHARE_SQL = """
(CASE WHEN IFNULL(alloc_tot.total_qty, 0) > 0
      THEN IFNULL(alloc.qty, 0) / alloc_tot.total_qty
      ELSE 1 / GREATEST(IFNULL(alloc_tot.legs, 1), 1) END)"""


# Remark written on the PO Status Event when a person (not the rollout track)
# decided a line's subcontractor. A line carrying one is not re-derived: the
# client's own records beat anything we can infer from the plans, and on this
# bench 5 corrected lines have a live plan whose team still says otherwise.
MANUAL_OVERRIDE_REMARK = "client subcontractor correction"


def has_manual_override(po_dispatch):
    """True when the line's subcontractor was last set by hand."""
    if not frappe.db.exists("DocType", "PO Status Event"):
        return False
    row = frappe.db.sql(
        """
        SELECT IFNULL(remark, '')
        FROM `tabPO Status Event`
        WHERE po_dispatch = %s AND field_changed = 'contract'
        ORDER BY changed_at DESC, creation DESC
        LIMIT 1
        """,
        (po_dispatch,),
    )
    return bool(row) and cstr(row[0][0]).strip() == MANUAL_OVERRIDE_REMARK


# Work Done rows whose subcontractor came from a plan, and may therefore be
# re-derived from one. A Direct Close or Backend close recorded the IM's own
# choice of subcontractor for a line that never had a plan; re-deriving those
# from "no live visit" would throw that choice away.
_PLAN_SOURCED = ("Rollout Execution", "")


def resolve_last_visit_subcontractor(po_dispatch):
    """The subcontractor of the line's last non-cancelled visit, or ''."""
    if not po_dispatch:
        return ""
    row = frappe.db.sql(
        """
        SELECT it.subcontractor
        FROM `tabRollout Plan` rp
        JOIN `tabINET Team` it ON it.name = rp.team
        WHERE rp.po_dispatch = %s
          AND IFNULL(rp.plan_status, '') <> 'Cancelled'
        ORDER BY IFNULL(rp.visit_number, 0) DESC, rp.creation DESC
        LIMIT 1
        """,
        (po_dispatch,),
    )
    return cstr(row[0][0]) if row else ""


def subcon_po_raised(po_dispatch):
    """True when a Subcon PO already exists for the line.

    Ordering the PO is the point at which the subcontractor stops being a
    routing decision and becomes a commitment to a supplier, so nothing below
    may re-derive past it.
    """
    vals = frappe.db.get_value(
        "PO Dispatch", po_dispatch,
        ["sub_po_status", "sub_po_status_ms1", "sub_po_status_ms2", "sub_po_supplier"],
        as_dict=True,
    ) or {}
    if cstr(vals.get("sub_po_supplier")).strip():
        return True
    for f in ("sub_po_status", "sub_po_status_ms1", "sub_po_status_ms2"):
        if cstr(vals.get(f)).strip() not in ("", "Not Ordered"):
            return True
    return False


def _recost_work_done(wd_name, subcontractor):
    """Re-stamp a Work Done's subcontractor and the figures derived from it.

    Cost is only rewritten when a Subcontract Cost Master row exists for the
    incoming subcontractor; with no cost row the previous cost is left alone
    rather than being zeroed, so a re-derivation can never silently inflate a
    line's margin.
    """
    updates = {"subcontractor": subcontractor or None}
    if subcontractor:
        margin_pct = frappe.db.get_value(
            "Subcontract Master", subcontractor, "inet_margin_pct")
        updates["inet_margin_pct"] = flt(margin_pct or 0)
        cost = frappe.db.get_value(
            "Subcontract Cost Master",
            {"subcontractor": subcontractor, "active_flag": 1},
            "expected_cost_sar",
        )
        if cost is not None:
            updates["subcontract_cost_sar"] = flt(cost or 0)
    else:
        updates["inet_margin_pct"] = 0.0
    frappe.db.set_value("Work Done", wd_name, updates, update_modified=False)


def resync_dispatch_contract(po_dispatch, *, reason=None, allow_clear=True):
    """Re-derive ``PO Dispatch.contract`` from the line's last live visit.

    Returns ``(changed, old, new)``. Safe to call on any line and from any
    flow: it writes only when the derived value actually differs, so the plan
    writers and the cancel writers can both call it unconditionally.

    ``allow_clear=False`` keeps an existing snapshot when no live visit remains
    — used where the caller knows a close is in progress and the line is about
    to be given a subcontractor by some other route.
    """
    po_dispatch = cstr(po_dispatch or "").strip()
    if not po_dispatch or not frappe.db.exists("PO Dispatch", po_dispatch):
        return False, None, None
    if subcon_po_raised(po_dispatch):
        return False, None, None
    if reason != MANUAL_OVERRIDE_REMARK and has_manual_override(po_dispatch):
        return False, None, None

    old = cstr(frappe.db.get_value("PO Dispatch", po_dispatch, "contract") or "")
    new = resolve_last_visit_subcontractor(po_dispatch)

    if not new:
        # No live visit left. Only a snapshot that a plan could have written may
        # be cleared by the disappearance of plans — a Direct Close / Backend
        # line's subcontractor was chosen by a person, not derived.
        sources = frappe.db.sql_list(
            "SELECT IFNULL(source, '') FROM `tabWork Done` WHERE system_id = %s",
            (po_dispatch,),
        )
        clearable = allow_clear and old and all(s in _PLAN_SOURCED for s in sources)
        if not clearable:
            new = old

    changed = new != old
    if changed:
        frappe.db.set_value("PO Dispatch", po_dispatch, "contract", new or None,
                            update_modified=False)
        try:
            from inet_app.api.status_log import log_status_event
            log_status_event(po_dispatch, "contract", old, new,
                             remark=reason, stamp_stage=False)
        except Exception:
            pass

        # Work Done carries its own copy, stamped at closure and re-derived by
        # nothing. It follows a real re-derivation, but only that: the two
        # fields answer different questions — pd.contract is who the line
        # belongs to now, wd.subcontractor is who did the recorded work — so a
        # no-op resync must not quietly rewrite the history of a closed line.
        for wd_name, wd_sub in frappe.db.sql(
            "SELECT name, IFNULL(subcontractor, '') FROM `tabWork Done` WHERE system_id = %s",
            (po_dispatch,),
        ):
            if cstr(wd_sub) != new:
                _recost_work_done(wd_name, new)

    return changed, old, new


# ── Per-subcontractor allocation ────────────────────────────────────────────
# A line can be worked by several subcontractors — 5 units by one, 1 by
# another — and the money owed to each follows the quantity they did. The
# single ``pd.contract`` cannot express that, so the share lives in the
# ``subcontract_allocations`` child table and ``pd.contract`` plus the 15 flat
# ``sub_po_*`` columns become a MIRROR of it. One allocation reproduces today's
# values exactly, which is what lets every existing reader stay untouched.

#: Where a derived allocation came from, for the reconcile screen to show.
ALLOC_FROM_LEDGER = "Closure ledger"
ALLOC_FROM_PLAN = "Rollout Plan Team"
ALLOC_FROM_CONTRACT = "Line subcontractor"
# Set by hand on the reconcile screen. It outranks every derivation: the
# client's own records beat anything inferred from plans or a stamp, which is
# the whole reason that screen exists. Carried on the allocation row itself so
# a rebuild can see it without a second table to keep in step.
ALLOC_FROM_ADMIN = "Administrator"


# ── When an issued supplier PO freezes the line ──────────────────────────────
#
# A SUBMITTED supplier PO is a document the subcontractor holds. It names a
# supplier and a quantity, and nothing in this system may afterwards decide
# that the work was someone else's — not a re-derivation, not a patch, not a
# confirmation. Changing it means cancelling or amending the PO first, which is
# a deliberate act with its own trail.
#
# A DRAFT PO ("PO Created") and a line marked "Ready to Order" are not frozen:
# nothing has been issued to anyone yet. They warn, so PIC knows the draft it
# is about to submit no longer matches the line.
#
# The statuses are spelled out here rather than imported from subcon_po, which
# imports this module — the vocabulary is `PO Dispatch.sub_po_status_ms{1,2}`
# and `PO Subcontract Allocation.sub_po_status_ms{1,2}`, and a change there
# must be made in both places.
SUBCON_FREE = "free"
SUBCON_WARN = "warn"
SUBCON_LOCKED = "locked"

_SUB_PO_ISSUED = ("PO Submitted", "Invoice Received", "Purchase Invoice Submitted", "Closed")
_SUB_PO_DRAFT = ("Ready to Order", "PO Created")


def dispatch_subcontractor_locks(po_dispatch):
    """How far each supplier's PO has gone on this line.

    ``{subcontractor: {"state": …, "qty": …, "statuses": [...]}}`` — one entry
    per allocation row that has any PO activity at all. A line with no issued
    and no drafted PO returns ``{}``, which is almost every line.
    """
    po_dispatch = cstr(po_dispatch or "").strip()
    if not po_dispatch or not frappe.db.exists("DocType", "PO Subcontract Allocation"):
        return {}
    out = {}
    for r in frappe.get_all(
        "PO Subcontract Allocation",
        filters={"parent": po_dispatch, "parenttype": "PO Dispatch",
                 "parentfield": "subcontract_allocations"},
        fields=["subcontractor", "qty", "sub_po_status_ms1", "sub_po_status_ms2"],
    ) or []:
        sub = cstr(r.get("subcontractor") or "").strip()
        if not sub:
            continue
        statuses = [cstr(r.get("sub_po_status_ms1") or "").strip(),
                    cstr(r.get("sub_po_status_ms2") or "").strip()]
        statuses = [x for x in statuses if x]
        if not statuses:
            continue
        state = (SUBCON_LOCKED if any(x in _SUB_PO_ISSUED for x in statuses)
                 else SUBCON_WARN if any(x in _SUB_PO_DRAFT for x in statuses)
                 else SUBCON_FREE)
        if state == SUBCON_FREE:
            continue
        out[sub] = {"state": state, "qty": flt(r.get("qty")), "statuses": statuses}

    if out:
        return out

    # Nothing on the allocation rows. Every PO raised before those rows started
    # carrying their own status is recorded on the LINE instead, so the lock
    # has to read that too — otherwise the 260 supplier POs already submitted
    # on this bench would be unprotected until each line is re-ordered. The
    # line level can only name one supplier, which is exactly why the
    # per-allocation columns exist; this is the fallback, not the rule.
    line = frappe.db.get_value(
        "PO Dispatch", po_dispatch,
        ["contract", "qty", "confirmed_qty", "sub_po_status_ms1", "sub_po_status_ms2"],
        as_dict=True) or {}
    sub = cstr(line.get("contract") or "").strip()
    if not sub:
        return {}
    statuses = [cstr(line.get("sub_po_status_ms1") or "").strip(),
                cstr(line.get("sub_po_status_ms2") or "").strip()]
    statuses = [x for x in statuses if x]
    if not statuses:
        return {}
    state = (SUBCON_LOCKED if any(x in _SUB_PO_ISSUED for x in statuses)
             else SUBCON_WARN if any(x in _SUB_PO_DRAFT for x in statuses)
             else SUBCON_FREE)
    if state == SUBCON_FREE:
        return {}
    return {sub: {"state": state,
                  "qty": flt(line.get("confirmed_qty")) or flt(line.get("qty")),
                  "statuses": statuses}}


def subcontractor_change_block(po_dispatch, allocation):
    """Why this line's suppliers may not be changed to ``allocation``, or None.

    ``allocation`` is ``[{subcontractor, qty}, …]`` — the shape every caller
    already passes. A supplier holding an issued PO must still be there, for at
    least the quantity that PO covers. Giving MORE quantity to that supplier is
    fine (it is new work, ordered later); giving it less, or dropping it, is
    not — that is the PO being contradicted.

    Returns ``(state, message)`` where state is SUBCON_LOCKED or SUBCON_WARN,
    or ``(SUBCON_FREE, None)``. The caller decides whether a warn blocks.
    """
    locks = dispatch_subcontractor_locks(po_dispatch)
    if not locks:
        return SUBCON_FREE, None
    proposed = {}
    for a in (allocation or []):
        sub = cstr((a or {}).get("subcontractor") or "").strip()
        if sub:
            proposed[sub] = proposed.get(sub, 0.0) + flt((a or {}).get("qty"))

    hard, soft = [], []
    for sub, info in locks.items():
        got = flt(proposed.get(sub, 0.0))
        if got >= flt(info["qty"]) - 0.00005:
            continue
        where = " / ".join(info["statuses"])
        detail = (f"{sub} holds a supplier PO for {flt(info['qty']):g} ({where}), "
                  f"but this change leaves them {got:g}")
        (hard if info["state"] == SUBCON_LOCKED else soft).append(detail)

    if hard:
        return SUBCON_LOCKED, (
            "A submitted supplier PO cannot be contradicted: "
            + "; ".join(hard)
            + ". Cancel or amend that purchase order first, then make this change."
        )
    if soft:
        return SUBCON_WARN, (
            "A supplier PO is already drafted on this line: " + "; ".join(soft)
            + ". The draft will no longer match — update or delete it."
        )
    return SUBCON_FREE, None


def assert_subcontractor_change_allowed(po_dispatch, allocation):
    """Throw when an issued supplier PO forbids this change. Warns are let through."""
    state, msg = subcontractor_change_block(po_dispatch, allocation)
    if state == SUBCON_LOCKED:
        frappe.throw(msg, title="Supplier PO already issued")
    elif state == SUBCON_WARN and msg:
        frappe.msgprint(msg, alert=True, indicator="orange")
    return state


def derive_dispatch_allocations(po_dispatch):
    """``[{subcontractor, qty, source}]`` for a line — the shares, not the status.

    Three sources, most authoritative first:

    1. **The closure ledger.** Once work is confirmed, each closure row says
       what a supplier is credited with. This is the record the IM signed off,
       so nothing else may override it.
    2. **Rollout Plan Team.** Before confirmation there is no ledger, but the
       IM has already assigned quantity per team at planning. Used so the
       Subcon PO page can show an expected split before the line closes.
    3. **The line's own subcontractor.** No plans and no ledger — a Direct
       Close or Backend line — so the whole quantity sits with one supplier.

    Quantities are returned as stored; no scaling or pro-rating happens here.
    Teams with no subcontractor are dropped: they are INET's own crews on the
    plan side, and a closure with no supplier has nobody to pay.
    """
    po_dispatch = cstr(po_dispatch or "").strip()
    if not po_dispatch:
        return []

    # A hand-set split is the answer, full stop. Nothing below may re-derive
    # past it — the admin was looking at the line precisely because the
    # derivation disagreed with what really happened.
    manual = frappe.get_all(
        "PO Subcontract Allocation",
        filters={"parent": po_dispatch, "parenttype": "PO Dispatch",
                 "parentfield": "subcontract_allocations", "source": ALLOC_FROM_ADMIN},
        fields=["subcontractor", "qty"],
    ) or []
    if manual:
        return [{"subcontractor": cstr(r["subcontractor"]), "qty": flt(r["qty"]),
                 "source": ALLOC_FROM_ADMIN} for r in manual if cstr(r["subcontractor"])]

    ledger = frappe.db.sql(
        """
        SELECT IFNULL(c.subcontractor, '') AS sub,
               ROUND(SUM(IFNULL(c.closed_qty, 0)), 4) AS qty
        FROM `tabWork Done Closure` c
        JOIN `tabWork Done` wd ON wd.name = c.parent
        WHERE wd.system_id = %s
        GROUP BY IFNULL(c.subcontractor, '')
        HAVING qty > 0
        """,
        (po_dispatch,), as_dict=True,
    ) or []
    rows = [r for r in ledger if r["sub"]]
    if rows:
        return [{"subcontractor": r["sub"], "qty": flt(r["qty"]),
                 "source": ALLOC_FROM_LEDGER} for r in rows]

    # LATEST visit only, matching LAST_VISIT_SUBCONTRACTOR_SQL. A Re-Visit
    # redoes the work rather than adding to it, so summing every visit would
    # pay two suppliers for one job — and the app's established rule is already
    # that the last live visit decides who the line belongs to.
    plan = frappe.db.sql(
        """
        SELECT IFNULL(it.subcontractor, '') AS sub,
               ROUND(SUM(IFNULL(rpt.assigned_qty, 0)), 4) AS qty
        FROM `tabRollout Plan` rp
        JOIN `tabRollout Plan Team` rpt ON rpt.parent = rp.name
        JOIN `tabINET Team` it ON it.name = rpt.team
        WHERE rp.po_dispatch = %s
          AND IFNULL(rp.plan_status, '') <> 'Cancelled'
          AND IFNULL(it.subcontractor, '') <> ''
          AND IFNULL(rp.visit_number, 0) = (
                SELECT MAX(IFNULL(rp2.visit_number, 0)) FROM `tabRollout Plan` rp2
                WHERE rp2.po_dispatch = rp.po_dispatch
                  AND IFNULL(rp2.plan_status, '') <> 'Cancelled')
        GROUP BY it.subcontractor
        HAVING qty > 0
        """,
        (po_dispatch,), as_dict=True,
    ) or []
    contract = cstr(frappe.db.get_value("PO Dispatch", po_dispatch, "contract") or "").strip()

    # A plan that names SEVERAL subcontractors is a genuine split, and nothing
    # else can express it — so it wins. A plan naming ONE does NOT override
    # pd.contract: the stamp is a decision someone made (the write-once stamp
    # at close, or the client's own correction), and on 154 lines worth
    # SAR 139,693 it disagrees with the plan's team. Preferring the plan there
    # would quietly move those lines onto a subcontractor's payable list as a
    # side effect of this feature. Which of the two is right is the question
    # the Administrator reconcile screen exists to answer, line by line.
    if len(plan) > 1:
        # Companion plans are validated one at a time by _sync_plan_teams, so
        # two teams on the same visit can each be assigned the WHOLE line —
        # real data does exactly that. Before confirmation these quantities are
        # only an estimate of relative effort, so an over-sum is scaled back to
        # the line rather than published as a split that bills more than the
        # PO. The IM's confirmation grid sets the real numbers.
        total = sum(flt(r["qty"]) for r in plan)
        line_qty = flt(frappe.db.get_value("PO Dispatch", po_dispatch, "qty") or 0)
        scale = (line_qty / total) if (line_qty and total > line_qty + 0.00005) else 1.0
        return [{"subcontractor": r["sub"], "qty": round(flt(r["qty"]) * scale, 4),
                 "source": ALLOC_FROM_PLAN} for r in plan]

    if contract:
        qty = flt(frappe.db.get_value("PO Dispatch", po_dispatch, "confirmed_qty")) or \
            flt(frappe.db.get_value("PO Dispatch", po_dispatch, "qty"))
        return [{"subcontractor": contract, "qty": qty, "source": ALLOC_FROM_CONTRACT}]

    if plan:
        return [{"subcontractor": plan[0]["sub"], "qty": flt(plan[0]["qty"]),
                 "source": ALLOC_FROM_PLAN}]
    return []


def resync_dispatch_allocations(po_dispatch, *, reason=None):
    """Rebuild a line's allocation rows from what actually happened.

    Returns ``(changed, rows)``. Writes only when the derived shares differ
    from what is stored, so this is safe to call unconditionally from any flow.

    **Tracking is preserved, shares are re-derived.** Each row's ``sub_po_*``
    columns are what PIC has done with that supplier's PO — raising it,
    receiving the invoice, closing it — and nothing derived may overwrite that.
    So a rebuild carries those columns across by subcontractor and only ever
    recomputes ``qty``/``amount``.

    **A supplier whose PO is already raised is never dropped**, even if the
    derivation stops naming them. An issued document outranks a re-derivation,
    the same way ``_sync_plan_teams`` refuses to drop a team that has executed.
    """
    po_dispatch = cstr(po_dispatch or "").strip()
    if not po_dispatch or not frappe.db.exists("PO Dispatch", po_dispatch):
        return False, []
    if not frappe.db.exists("DocType", "PO Subcontract Allocation"):
        return False, []

    derived = derive_dispatch_allocations(po_dispatch)
    doc = frappe.get_doc("PO Dispatch", po_dispatch)
    existing = {cstr(r.subcontractor or ""): r for r in (doc.get("subcontract_allocations") or [])}

    rate = flt(doc.get("rate") or 0)
    ordered_qty = flt(doc.get("qty") or 0)
    line_amount = flt(doc.get("line_amount") or 0)

    def _amount(q):
        # Rate first: it is the per-unit figure the PO itself prints. Falling
        # back to a share of line_amount covers lines imported without a rate.
        if rate:
            return round(rate * q, 4)
        if ordered_qty:
            return round(line_amount * q / ordered_qty, 4)
        return 0.0

    wanted = {}
    for d in derived:
        wanted[d["subcontractor"]] = d

    # Keep an ordered row for a supplier the derivation no longer names.
    for sub, row in existing.items():
        if sub in wanted:
            continue
        if cstr(row.get("sub_po_status_ms1") or "") or cstr(row.get("sub_po_status_ms2") or ""):
            wanted[sub] = {"subcontractor": sub, "qty": flt(row.get("qty")),
                           "source": cstr(row.get("source") or "")}

    # A supplier holding an ISSUED PO keeps its ordered quantity, whatever the
    # derivation now says. This runs from patches and imports as well as from
    # the live flows, and a re-derivation is not entitled to shrink a quantity
    # somebody has already been sent a purchase order for. If the result then
    # over-covers the line, that conflict is left visible rather than silently
    # scaled away — it is exactly what the reconcile screen is for, and a
    # shrunk number would hide the very thing that needs deciding.
    for sub, info in dispatch_subcontractor_locks(po_dispatch).items():
        if info["state"] != SUBCON_LOCKED:
            continue
        d = wanted.get(sub)
        if d is None:
            wanted[sub] = {"subcontractor": sub, "qty": flt(info["qty"]),
                           "source": cstr((existing.get(sub) or {}).get("source") or "")}
        elif flt(d.get("qty")) < flt(info["qty"]) - 0.00005:
            d["qty"] = flt(info["qty"])

    new_rows = []
    for sub, d in wanted.items():
        prev = existing.get(sub)
        row = {"subcontractor": sub, "qty": flt(d["qty"]),
               "amount": _amount(flt(d["qty"])), "source": d.get("source") or ""}
        if prev:
            for f in ("sub_po_status_ms1", "sub_po_pct_ms1", "sub_po_amount_ms1",
                      "sub_po_date_ms1", "sub_paid_date_ms1", "sub_po_remark_ms1",
                      "sub_po_status_ms2", "sub_po_pct_ms2", "sub_po_amount_ms2",
                      "sub_po_date_ms2", "sub_paid_date_ms2", "sub_po_remark_ms2"):
                row[f] = prev.get(f)
        new_rows.append(row)
    new_rows.sort(key=lambda r: (-flt(r["qty"]), r["subcontractor"]))

    def _shape(rows):
        return [(cstr(r["subcontractor"]), round(flt(r["qty"]), 4)) for r in rows]

    if _shape(new_rows) == _shape(
        [{"subcontractor": r.subcontractor, "qty": r.qty}
         for r in (doc.get("subcontract_allocations") or [])]
    ):
        return False, new_rows

    # Written straight to the child table, never through doc.save(). Saving the
    # parent runs PODispatch.validate(), which re-derives ms1/ms2 amounts and
    # remaining_milestone_pct — on a line whose stored values had drifted that
    # silently rewrote them, which a mirror rebuild has no business doing.
    # Measured: 1 line in 60 moved remaining_milestone_pct 100 -> 0 that way.
    frappe.db.delete("PO Subcontract Allocation", {
        "parent": po_dispatch, "parenttype": "PO Dispatch",
        "parentfield": "subcontract_allocations",
    })
    for idx, r in enumerate(new_rows, start=1):
        child = frappe.get_doc({
            "doctype": "PO Subcontract Allocation",
            "parent": po_dispatch, "parenttype": "PO Dispatch",
            "parentfield": "subcontract_allocations", "idx": idx,
            **{k: v for k, v in r.items() if v is not None},
        })
        child.db_insert()
    if reason:
        frappe.logger().info(
            f"resync_dispatch_allocations {po_dispatch}: "
            f"{[(r['subcontractor'], r['qty']) for r in new_rows]} ({reason})")
    return True, new_rows


def batch_dispatch_allocations(po_dispatch_names):
    """``{po_dispatch: [{subcontractor, qty, amount, …}]}`` for a set of lines.

    One query per chunk, never one per row — the list pages that need this
    routinely show thousands of lines, and a per-line lookup there is the
    pattern CLAUDE.md calls out as a silent performance trap.

    Only lines that actually HAVE allocations appear in the result, so a caller
    can treat a missing key as "nothing to show" and keep rendering the single
    value it rendered before.

    Chunked at 800 names: an unbounded ``IN (...)`` built from an "All" row set
    blows up with SQLParseError somewhere past ~10k values.
    """
    names = [cstr(n) for n in (po_dispatch_names or []) if n]
    out = {}
    if not names or not frappe.db.exists("DocType", "PO Subcontract Allocation"):
        return out
    seen = list(dict.fromkeys(names))
    for i in range(0, len(seen), 800):
        chunk = seen[i:i + 800]
        ph = ", ".join(["%s"] * len(chunk))
        for r in frappe.db.sql(
            f"""
            SELECT a.parent AS po_dispatch, a.subcontractor, a.qty, a.amount,
                   a.source, a.sub_po_status_ms1, a.sub_po_status_ms2,
                   a.sub_po_amount_ms1, a.sub_po_amount_ms2
            FROM `tabPO Subcontract Allocation` a
            WHERE a.parenttype = 'PO Dispatch'
              AND a.parentfield = 'subcontract_allocations'
              AND a.parent IN ({ph})
            ORDER BY a.parent, a.idx
            """,
            tuple(chunk), as_dict=True,
        ) or []:
            out.setdefault(r.pop("po_dispatch"), []).append(r)
    return out


def attach_allocations(rows, key="po_dispatch", field="subcontract_allocations"):
    """Hang each row's allocation list off it, in place. Returns ``rows``.

    A row whose line has one supplier gets a one-entry list, and a row with no
    allocations gets none at all — the UI falls back to the single value it
    already renders, so every single-supplier page is unchanged.
    """
    rows = rows or []
    names = [r.get(key) for r in rows if isinstance(r, dict) and r.get(key)]
    if not names:
        return rows
    by_line = batch_dispatch_allocations(names)
    for r in rows:
        if not isinstance(r, dict):
            continue
        allocs = by_line.get(r.get(key))
        if allocs:
            r[field] = allocs
    return rows
