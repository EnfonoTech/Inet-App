"""A target typed in by hand, which beats anything the data can derive.

Exists because some work has no team and no plan behind it — INet Telecom
M&D and M&W are closed entirely through Direct Close, so `team cost x margin`
gives them a target of zero forever (see docs/IM_PERFORMANCE_REPORT.md). It
also covers a new IM with no history, or a month the business simply wants to
set by hand.

Per COMPONENT on purpose. `inet_target` and `sub_target` each override only
their own half and may be left blank to keep the derived one; `total_target`
replaces both. Without that rule a single number is ambiguous the first time
someone means to correct only one side.
"""
import frappe
from frappe.model.document import Document
from frappe.utils import getdate


class IMMonthlyTarget(Document):
    def validate(self):
        # Stored as the first of the month so a lookup never has to guess
        # which day someone happened to pick.
        if self.month:
            self.month = getdate(self.month).replace(day=1)
        dupe = frappe.db.exists("IM Monthly Target",
                                {"im": self.im, "month": self.month,
                                 "name": ("!=", self.name)})
        if dupe:
            frappe.throw(f"A target for {self.im} in {self.month} already exists: {dupe}")
