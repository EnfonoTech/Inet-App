import frappe

from inet_app.api.command_center import _PO_LINE_FROM_ARCHIVE


def execute():
    """Seed `PO Intake Line.po_upload_date` for lines that predate the field.

    Going forward the standard upload stamps each line as it arrives. For
    history, the best evidence available is the PO document's own creation —
    `PO Intake Line.creation` holds it, because Frappe gives every child row
    its parent's timestamp.

    That is PO-level, so a line appended to an existing PO by a later upload
    is backfilled with the PO's first arrival rather than its own. There is no
    record anywhere that could tell those apart — the only per-line evidence
    Frappe kept was overwritten with the parent's — so this is as good as the
    history gets. It is right for the common case (a PO's lines arriving
    together) and never worse than the document-level date the charts used
    before the field existed.

    Archive-imported lines are left null on purpose. An archive run is a bulk
    backfill of historic closed lines, so its timestamp is the day we loaded
    history; those lines keep falling back to the dump's own publish/start
    dates, exactly as they did before.
    """
    if not frappe.db.has_column("PO Intake Line", "po_upload_date"):
        return

    updated = frappe.db.sql(
        f"""
        UPDATE `tabPO Intake Line` il
        SET il.po_upload_date = il.creation
        WHERE il.po_upload_date IS NULL
          AND NOT {_PO_LINE_FROM_ARCHIVE}
        """
    )
    frappe.db.commit()

    counts = frappe.db.sql(
        """
        SELECT COUNT(*) AS total,
               SUM(po_upload_date IS NOT NULL) AS stamped
        FROM `tabPO Intake Line`
        """,
        as_dict=True,
    )[0]
    print(
        f"po_upload_date backfilled: {frappe.utils.cint(counts.get('stamped'))}"
        f" of {frappe.utils.cint(counts.get('total'))} lines"
        f" ({frappe.utils.cint(counts.get('total')) - frappe.utils.cint(counts.get('stamped'))}"
        f" left to archive history)"
    )
