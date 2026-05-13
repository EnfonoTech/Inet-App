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
        self._compute_ms_amounts()

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

    def _compute_ms_amounts(self):
        """Derive ms1/ms2 amount + unbilled. Read-only fields on the form."""
        line = flt(getattr(self, "line_amount", 0))
        m1_pct = flt(getattr(self, "ms1_pct", 0))
        m2_pct = flt(getattr(self, "ms2_pct", 0))
        m1_amt = round(line * m1_pct / 100.0, 4) if line else 0.0
        m2_amt = round(line * m2_pct / 100.0, 4) if line else 0.0
        self.ms1_amount = m1_amt
        self.ms2_amount = m2_amt
        self.ms1_unbilled = round(m1_amt - flt(getattr(self, "ms1_invoiced", 0)), 4)
        self.ms2_unbilled = round(m2_amt - flt(getattr(self, "ms2_invoiced", 0)), 4)
