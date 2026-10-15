import frappe
from frappe.model.document import Document
from frappe.utils import flt

# Rates that are baked into an issued Purchase Order the moment it is raised.
_RATE_FIELDS = ("sub_payout_pct", "inet_margin_pct")


class SubcontractMaster(Document):
    def validate(self):
        self._block_rate_change_after_po()

    def _block_rate_change_after_po(self):
        """A rate may not be edited once a PO has been raised on this contract.

        Editing it rewrites history: the payout column keeps showing the real
        PO amount (correct), while every figure still derived from the
        percentage — INET's margin, the expected payout, the Command
        Dashboard's Sub-Con share — silently moves to the new rate. Imdad Line
        Establishment did exactly this: 127 POs issued at 80%, the master later
        changed to 85%, and the Closed row stopped adding up by SAR 3,387.27.

        The supported way to change a rate is a NEW Subcontract Master at the
        new percentage, which is already the convention here — Protech exists
        at 85% and 90%, Mabran at 80% and 90%. Old lines keep their contract
        and their history; new lines are raised against the new one.

        A deliberate correction (a genuine typo on a master whose POs were all
        raised at the corrected figure) can set
        ``frappe.flags.allow_subcontract_rate_change = True`` first.
        """
        if self.is_new() or frappe.flags.allow_subcontract_rate_change:
            return
        before = self.get_doc_before_save()
        if not before:
            return
        changed = [f for f in _RATE_FIELDS
                   if flt(before.get(f)) != flt(self.get(f))]
        if not changed:
            return

        lines, samples = _lines_with_issued_po(self.name)
        if not lines:
            return

        moved = ", ".join(
            f"{f.replace('_', ' ')} {flt(before.get(f)):g}% → {flt(self.get(f)):g}%"
            for f in changed)
        frappe.throw(
            f"{self.name} already has <b>{lines:,} line(s) with a supplier "
            f"Purchase Order raised on it</b> (e.g. {', '.join(samples)}), so "
            f"its rate cannot be changed ({moved}).<br><br>"
            f"Those POs were issued at the current percentage. Changing it here "
            f"would leave the reports unable to reconcile — the payout keeps "
            f"showing the real PO amount while INET's margin and the expected "
            f"payout jump to the new rate.<br><br>"
            f"Create a <b>new Subcontract Master</b> at the new percentage "
            f"instead (the way <i>Protech … 85%</i> and <i>Protech … 90%</i> "
            f"already exist) and raise new lines against it.",
            title="Rate is locked by an issued Purchase Order",
        )


def _lines_with_issued_po(master):
    """``(line_count, up_to_3_sample_poids)`` for lines carrying a real PO.

    A stamped ``sub_po_amount_ms{n}`` means a Purchase Order said so — a
    manual close no longer fabricates one — so it is the test for "a PO was
    actually raised against this contract". Resolution reuses the Subcon PO
    page's own join, so this agrees with what that page shows rather than
    reading ``pd.contract`` alone and missing the lines that resolve through
    an allocation or a team.
    """
    from inet_app.api.subcon_po import _SUBCON_BASE_WHERE, _SUBCON_FROM_JOIN

    where = " AND ".join(_SUBCON_BASE_WHERE)
    rows = frappe.db.sql(
        f"""
        SELECT DISTINCT COALESCE(NULLIF(pd.poid, ''), pd.name) AS poid
        {_SUBCON_FROM_JOIN}
        WHERE {where} AND sm.name = %s
          AND (IFNULL(pd.sub_po_amount_ms1, 0) > 0
            OR IFNULL(pd.sub_po_amount_ms2, 0) > 0)
        """,
        (master,), as_dict=True) or []
    return len(rows), [r["poid"] for r in rows[:3]]
