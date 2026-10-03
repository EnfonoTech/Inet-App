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
