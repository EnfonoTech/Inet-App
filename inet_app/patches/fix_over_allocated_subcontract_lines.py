"""Correct the lines whose allocations add up to more than the line itself.

``backfill_subcontract_allocations`` derived each line's split from its
Rollout Plan Teams before the derivation learned to read only the LATEST
visit and to scale an over-sum back to the line. On three lines it therefore
mixed two visits together and published shares that do not sum to 1:

    1011HG3692386-1025-2-1   line qty 1    allocated 1.5   (Saleh 1 + iNet 0.5)
    1011HG3692386-1025-3-1   line qty 1    allocated 1.5   (Saleh 1 + iNet 0.5)
    1011HG3692386-1445-3-1   line qty 6    allocated 9     (Mabran 6 + iNet 3)

They are the only three in the book whose stamped PO implies a rate that is
not their contract's - all three imply 120%, which is 80% divided by two
thirds - and together they account for SAR 3,206.00 of the gap between the
Subcon PO header card and the payout report.

**This patch fixes the two Saleh lines only.** On both, the submitted PO
covers the whole line, and a submitted PO is the source of truth, so Saleh
holds 100% of each. Nothing is in dispute and nothing else has to happen
first.

``1011HG3692386-1445-3-1`` is deliberately NOT here. Its correct split is
Mabran 5 / iNet 1 - what the client asked for in writing before the order
went out - but PO-00098 was then issued for the full 6 by mistake. Writing
the split while that PO stands would put the line in permanent conflict with
an issued document, and ``resync_dispatch_allocations`` would raise Mabran
back to 6 on the next rebuild anyway. Cancel or amend PO-00098 first, then
run ``fix_mabran_split_after_po_cancelled`` by hand - it refuses to act while
a live PO is still on the line.

Idempotent: a line already carrying the target split is skipped, and a line
whose data no longer matches the recorded diagnosis is left alone rather than
overwritten.
"""

import frappe
from frappe.utils import flt

#: poid -> [(subcontractor, qty), …]. Must sum to the line's own quantity.
TARGETS = {
    "1011HG3692386-1025-2-1": [
        ("Saleh Abdul Aziz Al Dosari Contracting Company", 1.0),
    ],
    "1011HG3692386-1025-3-1": [
        ("Saleh Abdul Aziz Al Dosari Contracting Company", 1.0),
    ],
}

#: Held back until PO-00098 is cancelled or amended - see the module docstring.
MABRAN_POID = "1011HG3692386-1445-3-1"
MABRAN_TARGET = [
    ("Mabran Al Arabia Contracting Company 80%", 5.0),
    ("INet Telecom F&C", 1.0),
]


def execute():
    _apply(TARGETS, label="fix_over_allocated_subcontract_lines")


def fix_mabran_split_after_po_cancelled():
    """Run by hand once PO-00098 is cancelled or amended from 6 to 5.

        bench --site <site> execute \\
          inet_app.patches.fix_over_allocated_subcontract_lines.fix_mabran_split_after_po_cancelled

    Refuses while a live Purchase Order still covers the line: the split and
    the issued document would contradict each other, and the next allocation
    rebuild would overwrite the split to match the PO.
    """
    name = frappe.db.get_value("PO Dispatch", {"poid": MABRAN_POID}, "name")
    if not name:
        print(f"{MABRAN_POID}: not on this site, nothing to do")
        return
    live = frappe.db.sql(
        """SELECT po.name, po.docstatus, poi.milestone, poi.qty, poi.amount
           FROM `tabPurchase Order Item` poi
           JOIN `tabPurchase Order` po ON po.name = poi.parent AND po.docstatus < 2
          WHERE poi.poid = %s""", (name,), as_dict=True) or []
    if live:
        print(f"{MABRAN_POID}: REFUSED - a live Purchase Order still covers this line:")
        for r in live:
            print(f"    {r['name']}  {r['milestone']}  qty {r['qty']:g}  "
                  f"SAR {flt(r['amount']):,.2f}  docstatus {r['docstatus']}")
        print("  Cancel or amend it to qty 5 (SAR 4,204.00) first, then re-run.")
        return
    _apply({MABRAN_POID: MABRAN_TARGET}, label="fix_mabran_split_after_po_cancelled")


def _apply(targets, label):
    """Write each target split as an Administrator override, or explain why not."""
    if not frappe.db.exists("DocType", "PO Subcontract Allocation"):
        print(f"{label}: doctype absent, nothing to do")
        return

    from inet_app.api.subcon_reconcile import _write_allocations

    fixed = skipped = held = 0
    for poid, target in targets.items():
        name = frappe.db.get_value("PO Dispatch", {"poid": poid}, "name")
        if not name:
            held += 1
            print(f"  {poid}: not on this site, skipped")
            continue

        pd = frappe.db.get_value(
            "PO Dispatch", name,
            ["poid", "qty", "confirmed_qty", "rate", "line_amount"], as_dict=True) or {}

        unknown = [s for s, _ in target if not frappe.db.exists("Subcontract Master", s)]
        if unknown:
            held += 1
            print(f"  {poid}: unknown subcontractor(s) {unknown}, skipped")
            continue

        # The split re-divides the line; it must not re-quantify it.
        line_qty = flt(pd.get("qty") or 0)
        total = round(sum(q for _, q in target), 4)
        if line_qty and abs(total - line_qty) > 0.0001:
            held += 1
            print(f"  {poid}: target sums to {total:g} but the line carries "
                  f"{line_qty:g}, skipped")
            continue

        current = [
            (r.subcontractor, round(flt(r.qty), 4))
            for r in frappe.get_all(
                "PO Subcontract Allocation",
                filters={"parent": name, "parenttype": "PO Dispatch",
                         "parentfield": "subcontract_allocations"},
                fields=["subcontractor", "qty"],
                order_by="idx")
        ]
        if sorted(current) == sorted((s, round(q, 4)) for s, q in target):
            skipped += 1
            print(f"  {poid}: already correct, skipped")
            continue

        _write_allocations(name, [{"subcontractor": s, "qty": q} for s, q in target], pd)
        fixed += 1
        print(f"  {poid}: {current} -> {target}")

    frappe.db.commit()
    print(f"{label}: {fixed} corrected, {skipped} already correct, {held} skipped")
