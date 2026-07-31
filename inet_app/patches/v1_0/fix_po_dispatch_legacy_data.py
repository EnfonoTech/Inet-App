"""
Fix two classes of legacy data quality issues on PO Dispatch that surfaced
when the "Assign IM" bulk action started running records through a fully
validated doc.save() (previously these fields were never re-validated since
the historical PO Archive Import wrote them directly via frappe.db.set_value,
bypassing validate() entirely — see _stamp_archive_pic_fields in
command_center.py, now fixed at the source using the same helpers this
patch calls):

1. pic_status / pic_status_ms2 (Select fields) hold a value that only
   case-differs from a real option, e.g. "PO line Canceled" instead of the
   defined "PO Line Canceled" — Frappe's Select validation is exact-match, so
   any save() on such a record throws "... cannot be '...'. It should be one
   of ...". Normalized to the correctly-cased option.

2. isdp_owner / ibuy_owner (Link fields) hold a value that isn't a real
   owner record, which fails Link validation on save with "Could not find
   ISDP Owner: ...". Most of these turned out to be a REAL owner name with a
   decoration prefix tacked on (e.g. "Rejected By Asad Mehmood" where "Asad
   Mehmood" is a genuine person who should be an ISDP Owner) — so this strips
   known prefixes, and if the stripped name doesn't already exist as a
   record, CREATES it (status defaults to Active) rather than discarding the
   name, then maps the field to it. Only when no known prefix can be
   stripped at all (a plain, undecorated string that still doesn't match any
   real owner — usually a genuine remark, not a name) is the field cleared;
   that original text is NOT written into pic_rejection_remark or any other
   business-facing remark field (PICs use those for real rejection notes; a
   cleanup script has no business writing into them) — it's only printed
   here for manual follow-up, since bench migrate output is captured/logged
   already.
"""
import frappe

from inet_app.api.command_center import normalize_select_value, resolve_or_create_owner_link


def _fix_select_casing(fieldname, label):
    if not frappe.db.has_column("PO Dispatch", fieldname):
        return 0
    rows = frappe.db.sql(
        f"""
        SELECT name, `{fieldname}` AS val FROM `tabPO Dispatch`
        WHERE IFNULL(`{fieldname}`, '') != ''
        """,
        as_dict=True,
    )
    fixed = 0
    for r in rows:
        val = (r.val or "").strip()
        correct = normalize_select_value("PO Dispatch", fieldname, val)
        if correct == val:
            continue
        frappe.db.set_value("PO Dispatch", r.name, fieldname, correct, update_modified=False)
        fixed += 1
    if fixed:
        frappe.db.commit()
    print(f"fix_po_dispatch_legacy_data: normalized {fixed} case-mismatched {label} value(s)")
    return fixed


def _fix_invalid_owner_link(fieldname, owner_doctype, label):
    if not frappe.db.has_column("PO Dispatch", fieldname):
        return
    if not frappe.db.table_exists(owner_doctype):
        return
    rows = frappe.db.sql(
        f"""
        SELECT name, `{fieldname}` AS val FROM `tabPO Dispatch`
        WHERE IFNULL(`{fieldname}`, '') != ''
        """,
        as_dict=True,
    )
    recovered = 0
    created = 0
    cleared = 0
    for r in rows:
        val = (r.val or "").strip()
        if not val or frappe.db.exists(owner_doctype, val):
            continue
        resolved, was_created = resolve_or_create_owner_link(owner_doctype, val)
        if resolved:
            frappe.db.set_value("PO Dispatch", r.name, fieldname, resolved, update_modified=False)
            if was_created:
                created += 1
                print(f"fix_po_dispatch_legacy_data: {r.name} — created new {label} {resolved!r} and mapped it")
            else:
                recovered += 1
            continue
        # No known decoration prefix matched at all — this isn't a
        # recognizable name, likely a genuine remark. Clear it, but do NOT
        # write the original text into a business remark field. Printed for
        # manual follow-up only (visible in bench migrate output).
        frappe.db.set_value("PO Dispatch", r.name, fieldname, "", update_modified=False)
        cleared += 1
        print(f"fix_po_dispatch_legacy_data: {r.name} — cleared unrecoverable {label} value: {val!r}")
    if recovered or created or cleared:
        frappe.db.commit()
    print(
        f"fix_po_dispatch_legacy_data: {label} — recovered {recovered} (matched existing), "
        f"created {created} (new record), cleared {cleared} (unrecoverable, see above)"
    )


def execute():
    _fix_select_casing("pic_status", "PIC Status (MS1)")
    _fix_select_casing("pic_status_ms2", "PIC Status (MS2)")
    _fix_invalid_owner_link("isdp_owner", "ISDP Owner", "ISDP Owner")
    _fix_invalid_owner_link("ibuy_owner", "IBuy Owner", "iBuy Owner")
