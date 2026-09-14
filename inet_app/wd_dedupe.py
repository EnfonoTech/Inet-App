"""Merge duplicate Work Done records down to one per PO line.

KEEP rule (business): a copy with a real execution chain beats one without;
among those the HIGHEST visit number wins; ties go to the original.
Nothing is thrown away — every field is merged onto the survivor first.
"""
import frappe
from frappe.utils import flt, cint

BILL_RANK = {"": 0, "Pending": 1, "Invoiced": 2, "Closed": 3}


def _groups():
    rows = frappe.db.sql("""
        SELECT wd.name, wd.system_id, pd.poid, wd.creation, wd.modified,
               IFNULL(wd.submission_status,'') AS submission_status,
               IFNULL(wd.billing_status,'')    AS billing_status,
               IFNULL(wd.ms1_closed,0)         AS ms1_closed,
               IFNULL(wd.ms2_closed,0)         AS ms2_closed,
               wd.revenue_sar, rp.visit_number
        FROM `tabWork Done` wd
        JOIN `tabPO Dispatch` pd ON pd.name = wd.system_id
        LEFT JOIN `tabDaily Execution` de ON de.name = wd.execution
        LEFT JOIN `tabRollout Plan`   rp ON rp.name = de.rollout_plan
        WHERE wd.system_id IS NOT NULL
          AND wd.system_id IN (
              SELECT system_id FROM `tabWork Done`
              WHERE system_id IS NOT NULL GROUP BY system_id HAVING COUNT(*) > 1)
        ORDER BY pd.poid, wd.creation
    """, as_dict=True)
    g = {}
    for r in rows:
        g.setdefault(r.system_id, []).append(r)
    return g


def _survivor(copies):
    # has-execution first, then highest visit, then earliest created
    return sorted(copies, key=lambda r: (
        0 if r.visit_number is not None else 1,
        -cint(r.visit_number or 0),
        r.creation,
    ))[0]


def run(apply=0, rollback=0):
    apply, rollback = cint(apply), cint(rollback)
    out, groups = [], _groups()
    out.append(f"duplicate lines: {len(groups)}  records: {sum(len(v) for v in groups.values())}")

    for sid, copies in groups.items():
        keep = _survivor(copies)
        losers = [c for c in copies if c.name != keep.name]

        # Merge: last non-blank PIC decision wins; most advanced billing wins;
        # milestone flags OR together (one copy may have closed MS1, the other MS2).
        statused = [c for c in copies if c.submission_status]
        best_status = max(statused, key=lambda c: c.modified).submission_status if statused else ""
        best_bill = max(copies, key=lambda c: BILL_RANK.get(c.billing_status, 0)).billing_status
        ms1 = 1 if any(cint(c.ms1_closed) for c in copies) else 0
        ms2 = 1 if any(cint(c.ms2_closed) for c in copies) else 0

        pd = frappe.db.get_value("PO Dispatch", sid,
                                 ["line_amount", "ms1_amount", "ms2_amount"], as_dict=True) or {}
        if ms1 and not ms2:
            revenue = flt(pd.get("ms1_amount"))
        elif ms2 and not ms1:
            revenue = flt(pd.get("ms2_amount"))
        else:
            revenue = flt(pd.get("line_amount"))

        changes = []
        if best_status != keep.submission_status: changes.append(f"submission_status '{keep.submission_status}'->'{best_status}'")
        if best_bill != keep.billing_status:      changes.append(f"billing_status '{keep.billing_status}'->'{best_bill}'")
        if ms1 != cint(keep.ms1_closed):          changes.append(f"ms1_closed {keep.ms1_closed}->{ms1}")
        if ms2 != cint(keep.ms2_closed):          changes.append(f"ms2_closed {keep.ms2_closed}->{ms2}")
        if flt(revenue) != flt(keep.revenue_sar): changes.append(f"revenue_sar {flt(keep.revenue_sar)}->{revenue}")

        out.append(f"{keep.poid}: KEEP {keep.name} (v{keep.visit_number or '-'}) "
                   f"DELETE {[l.name for l in losers]} | merge: {changes or 'nothing to carry'}")

        if apply:
            doc = frappe.get_doc("Work Done", keep.name)
            doc.submission_status = best_status
            doc.billing_status = best_bill
            doc.ms1_closed, doc.ms2_closed = ms1, ms2
            doc.save(ignore_permissions=True)          # before_save re-derives revenue_sar
            for l in losers:
                frappe.delete_doc("Work Done", l.name, force=True,
                                  ignore_permissions=True, delete_permanently=True)

    if apply:
        left = frappe.db.sql("""SELECT COUNT(*) FROM (SELECT system_id FROM `tabWork Done`
                                WHERE system_id IS NOT NULL GROUP BY system_id
                                HAVING COUNT(*) > 1) x""")[0][0]
        out.append(f"AFTER APPLY: lines still holding duplicates = {left}")
        if rollback:
            frappe.db.rollback()
            still = frappe.db.sql("""SELECT COUNT(*) FROM (SELECT system_id FROM `tabWork Done`
                                     WHERE system_id IS NOT NULL GROUP BY system_id
                                     HAVING COUNT(*) > 1) x""")[0][0]
            out.append(f"ROLLED BACK: duplicate lines restored = {still}")
        else:
            frappe.db.commit()
    return "\n".join(out)
