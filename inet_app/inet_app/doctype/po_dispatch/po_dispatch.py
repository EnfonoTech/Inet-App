import re

import frappe
from frappe.model.document import Document
from frappe.utils import flt

from inet_app.region_type import region_type_from_center_area


# AC1 / AC2 percentage extractor — handles all 10 distinct Payment Terms
# patterns observed in the master tracker, including the mojibake-encoded
# variants ("ã€TTã€‘"). Falls back to (100, 0) when no AC markers found.
_PAYMENT_TERMS_AC_RE = re.compile(r"AC\s*([12])\s*\(\s*([\d.]+)\s*%", re.IGNORECASE)


def parse_payment_terms_pcts(payment_terms):
    """Return ``(ms1_pct, ms2_pct)`` parsed from a Payment Terms string.

    Examples
    --------
    >>> parse_payment_terms_pcts("AC1 (100.00%, INV AC -30D, Complete 100%)")
    (100.0, 0.0)
    >>> parse_payment_terms_pcts("AC1 (70.00%, ...) / AC2 (30.00%, ...)")
    (70.0, 30.0)
    >>> parse_payment_terms_pcts("Invoice AC 30D")
    (100.0, 0.0)
    """
    if not payment_terms:
        return 100.0, 0.0
    s = str(payment_terms).strip()
    m1 = m2 = None
    for m in _PAYMENT_TERMS_AC_RE.finditer(s):
        idx = m.group(1)
        try:
            pct = float(m.group(2))
        except ValueError:
            continue
        if idx == "1" and m1 is None:
            m1 = pct
        elif idx == "2" and m2 is None:
            m2 = pct
    if m1 is None and m2 is None:
        return 100.0, 0.0
    return (m1 or 0.0), (m2 or 0.0)


class PODispatch(Document):
    def validate(self):
        self.region_type = region_type_from_center_area(self.center_area)
        self._ensure_duid_master()
        self._fill_payment_term_pcts()
        self._compute_confirmed_amount()
        self._compute_ms_amounts()

    def before_save(self):
        # Capture current im BEFORE the save so on_update can detect a change.
        # on_update runs after the row is committed so reading from DB there
        # would always return the new value.
        self._old_im = (frappe.db.get_value("PO Dispatch", self.name, "im") or "") if not self.is_new() else ""

    def on_update(self):
        new_im = (self.im or "").strip()
        old_im = (getattr(self, "_old_im", "") or "").strip()
        if new_im and old_im != new_im:
            from inet_app.api.command_center import _cascade_im_on_dispatch
            _cascade_im_on_dispatch(self.name, new_im)

    def before_insert(self):
        # Immutable internal reference = first autoname (SYS-{year}-{#####}). Name may later be renamed to POID.
        if not getattr(self, "system_id", None) and self.name:
            self.system_id = self.name

    def _ensure_duid_master(self):
        duid = str(getattr(self, "site_code", "") or "").strip()
        if not duid or not frappe.db.exists("DocType", "DUID Master"):
            return
        if frappe.db.exists("DUID Master", duid):
            return
        doc = frappe.new_doc("DUID Master")
        doc.duid = duid
        doc.site_name = (getattr(self, "site_name", "") or "").strip()
        doc.center_area = (getattr(self, "center_area", "") or "").strip()
        doc.insert(ignore_permissions=True)

    def _fill_payment_term_pcts(self):
        """Stamp ms1_pct / ms2_pct from payment_terms when not already set.

        Only auto-fills when both percentages still look like the defaults
        (100/0 or 0/0) — otherwise a manual PIC override would be wiped on
        every save.
        """
        cur_m1 = flt(getattr(self, "ms1_pct", 0))
        cur_m2 = flt(getattr(self, "ms2_pct", 0))
        looks_default = (cur_m1 in (0.0, 100.0)) and (cur_m2 == 0.0)
        if not looks_default:
            return
        terms = (getattr(self, "payment_terms", "") or "").strip()
        if not terms:
            return
        ms1_pct, ms2_pct = parse_payment_terms_pcts(terms)
        if cur_m1 != ms1_pct or cur_m2 != ms2_pct:
            self.ms1_pct = ms1_pct
            self.ms2_pct = ms2_pct

    def _compute_confirmed_amount(self):
        """Derive confirmed_amount and remaining_qty from confirmed_qty.

        ``line_amount`` is deliberately left alone — it stays the quantity and
        value Huawei ordered. Overwriting it would erase the shortfall instead
        of showing it: the PO Published Value vs Invoiced Value view would
        quietly shrink, and a later PO re-upload could restore the old figure
        over the correction.
        """
        if not hasattr(self, "confirmed_qty"):
            return
        qty = flt(getattr(self, "qty", 0))
        confirmed = flt(getattr(self, "confirmed_qty", 0))
        if confirmed <= 0:
            self.confirmed_amount = 0
            self.remaining_qty = 0
            return
        rate = flt(getattr(self, "rate", 0))
        # Prefer rate x qty, but fall back to a pro-rata slice of line_amount
        # when no rate is stored — some archive-imported lines carry only the
        # line total.
        if rate:
            self.confirmed_amount = round(rate * confirmed, 4)
        elif qty:
            self.confirmed_amount = round(
                flt(getattr(self, "line_amount", 0)) * confirmed / qty, 4
            )
        else:
            self.confirmed_amount = flt(getattr(self, "line_amount", 0))
        self.remaining_qty = round(qty - confirmed, 4) if qty else 0

    # The one remaining-quantity decision that changes what can be billed: the
    # customer has agreed to pay for the shortfall, so the line is worth its
    # full ordered value again even though less was delivered.
    BILL_FULL_ON_ACTION = "Pending \u2013 to be invoiced"

    def billable_amount(self):
        """What this line can be invoiced for.

        Normally the ordered line_amount. Once the IM confirms a reduced
        quantity it drops to the confirmed amount — that is what carries a
        partial delivery through to invoicing, with no change anywhere in the
        PIC flow, because the payment-term percentages simply apply to a
        smaller base.

        The exception is a remainder marked "to be invoiced": the customer is
        paying for the undelivered part too, so the base goes back to the full
        ordered value.
        """
        confirmed = flt(getattr(self, "confirmed_amount", 0))
        if not confirmed:
            return flt(getattr(self, "line_amount", 0))
        action = (getattr(self, "remaining_qty_action", "") or "").strip()
        if action == self.BILL_FULL_ON_ACTION:
            return flt(getattr(self, "line_amount", 0)) or confirmed
        return confirmed

    def _compute_ms_amounts(self):
        """Derive ms1/ms2 amount + unbilled + remaining milestone pct."""
        line = self.billable_amount()
        m1_pct = flt(getattr(self, "ms1_pct", 0))
        m2_pct = flt(getattr(self, "ms2_pct", 0))
        m1_amt = round(line * m1_pct / 100.0, 4) if line else 0.0
        m2_amt = round(line * m2_pct / 100.0, 4) if line else 0.0
        self.ms1_amount = m1_amt
        self.ms2_amount = m2_amt
        m1_inv = flt(getattr(self, "ms1_invoiced", 0))
        m2_inv = flt(getattr(self, "ms2_invoiced", 0))
        self.ms1_unbilled = round(m1_amt - m1_inv, 4)
        self.ms2_unbilled = round(m2_amt - m2_inv, 4)
        remaining = (m1_amt - m1_inv) + (m2_amt - m2_inv)
        self.remaining_milestone_pct = round(remaining / line * 100.0, 2) if line else 0.0
