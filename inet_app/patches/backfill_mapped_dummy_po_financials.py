"""
One-time fix: map_im_dummy_po_to_intake_line() never copied tax_rate /
payment_terms from the PO Intake Line onto the mapped PO Dispatch, and wrote
via frappe.db.set_value() — bypassing PODispatch.validate() entirely, so
ms1_pct/ms2_pct (derived from payment_terms) and ms1_amount/ms2_amount/
ms1_unbilled/ms2_unbilled/remaining_milestone_pct (derived from line_amount
+ those percentages) were never (re)computed for the real mapped values.
Every PO Dispatch with was_dummy_po=1 went through that path.

This backfill only ever fills tax_rate/payment_terms when the dispatch's
own value is currently blank (never overwrites a value already present —
could be a deliberate PIC correction made after noticing the gap), then
re-saves the document so validate() recomputes the derived MS fields for
real. PODispatch._fill_payment_term_pcts() already guards against
clobbering a genuine manual ms1_pct/ms2_pct split (only auto-fills when
the current split still "looks like" the untouched 100/0 or 0/0 default),
so re-saving every was_dummy_po=1 row here is safe even for ones that
don't actually need tax_rate/payment_terms filled in.
"""
import frappe


def execute():
    rows = frappe.db.sql(
        """
        SELECT pd.name AS dispatch, pil.tax_rate AS il_tax_rate, pil.payment_terms AS il_payment_terms
        FROM `tabPO Dispatch` pd
        INNER JOIN `tabPO Intake Line` pil
            ON pil.parent = pd.po_intake AND pil.po_line_no = pd.po_line_no
        WHERE IFNULL(pd.was_dummy_po, 0) = 1
          AND IFNULL(pd.po_intake, '') != ''
        """,
        as_dict=True,
    )

    if not rows:
        print("backfill_mapped_dummy_po_financials: nothing to check")
        return

    checked = 0
    filled_tax_rate = 0
    filled_payment_terms = 0
    resaved = 0
    errors = []

    for row in rows:
        checked += 1
        doc = frappe.get_doc("PO Dispatch", row.dispatch)
        touched = False

        if not (doc.tax_rate or "").strip() and (row.il_tax_rate or "").strip():
            doc.tax_rate = row.il_tax_rate
            filled_tax_rate += 1
            touched = True

        if not (doc.payment_terms or "").strip() and (row.il_payment_terms or "").strip():
            doc.payment_terms = row.il_payment_terms
            filled_payment_terms += 1
            touched = True

        try:
            doc.save(ignore_permissions=True)
            resaved += 1
        except Exception as e:
            errors.append(f"{row.dispatch}: {e}")
            continue

    frappe.db.commit()
    print(
        f"backfill_mapped_dummy_po_financials: checked {checked} mapped-dummy dispatches, "
        f"filled tax_rate on {filled_tax_rate}, payment_terms on {filled_payment_terms}, "
        f"re-saved {resaved} (recomputes ms1/ms2 amounts via validate())"
    )
    if errors:
        print(f"  {len(errors)} errors:")
        for e in errors[:20]:
            print(f"  - {e}")
