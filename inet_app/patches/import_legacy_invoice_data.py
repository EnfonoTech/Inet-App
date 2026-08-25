"""
Not a migration patch — do NOT add this to patches.txt. Run it yourself,
once, wherever the historical data needs to land:

    bench --site <site> execute "inet_app.patches.import_legacy_invoice_data.execute"

Reads inet_app/patches/data/legacy_invoice_import.csv (poid, milestone,
invoice_no, po_type — extracted from the historical "Invoices Data" Excel)
and matches each row to a PO Dispatch by its poid field directly, since
PO Dispatch is named by an auto-counter (SYS-YYYY-#####) that has no
relationship to poid and can't be produced from the source data — this is
exactly why the CSV can't go through the Desk "Data Import" tool (that
tool only matches existing records by document name).

Only ever writes legacy_ms1_invoice_no / legacy_ms2_invoice_no /
legacy_po_type — plain reference fields with no controller logic attached,
so a direct frappe.db.set_value is enough (no recompute triggered, unlike
map_im_dummy_po_to_intake_line's tax_rate/payment_terms mapping).
Safe to re-run: every value comes from the same fixed CSV, so re-running
just re-applies the same result.
"""
import csv
import os

import frappe


def execute(csv_path=None):
    """Returns a summary dict as well as printing it, so both `bench execute`
    (console) and the "Settings" page's background job (run_legacy_invoice_import
    in pic.py) can use this the same way."""
    path = csv_path or os.path.join(os.path.dirname(__file__), "data", "legacy_invoice_import.csv")
    with open(path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    if not rows:
        print("import_legacy_invoice_data: CSV is empty, nothing to do")
        return {"csv_rows": 0, "updated": 0, "unmatched": [], "errors": []}

    updated = 0
    unmatched = []
    errors = []

    for row in rows:
        poid = (row.get("poid") or "").strip()
        ms = (row.get("milestone") or "").strip().upper()
        invoice_no = (row.get("invoice_no") or "").strip()
        po_type = (row.get("po_type") or "").strip()
        if not poid or ms not in ("MS1", "MS2"):
            continue

        name = frappe.db.get_value("PO Dispatch", {"poid": poid})
        if not name:
            unmatched.append(poid)
            continue

        vals = {}
        if invoice_no:
            vals[f"legacy_{ms.lower()}_invoice_no"] = invoice_no
        if po_type:
            vals["legacy_po_type"] = po_type
        if not vals:
            continue

        try:
            frappe.db.set_value("PO Dispatch", name, vals, update_modified=False)
            updated += 1
        except Exception as e:
            errors.append(f"{poid} ({name}): {e}")

    frappe.db.commit()

    print(
        f"import_legacy_invoice_data: {len(rows)} CSV rows, {updated} PO Dispatch rows updated, "
        f"{len(unmatched)} poids not found, {len(errors)} errors"
    )
    if unmatched:
        print(f"  first 20 unmatched poids: {unmatched[:20]}")
    if errors:
        print(f"  first 20 errors:")
        for e in errors[:20]:
            print(f"  - {e}")

    return {"csv_rows": len(rows), "updated": updated, "unmatched": unmatched, "errors": errors}
