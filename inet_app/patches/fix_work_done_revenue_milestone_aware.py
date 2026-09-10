"""Realign Work Done.revenue_sar with the PO line, milestone-aware.

Revenue is not an independently editable number, so revenue_sar has to equal
the amount of the line the row closes. Two things had been breaking that:

- Work Done's before_save recomputed revenue_sar as
  ``billing_rate_sar * executed_qty`` on every save, overriding whatever the
  caller set. It now derives the figure from the line instead, so new and
  edited rows stay aligned by construction.

- The earlier fix_work_done_revenue_sar patch realigned divergent rows to
  ``pd.line_amount`` unconditionally. That is right for a normal row but wrong
  for a MILESTONE-SCOPED Direct Close, which represents only the one milestone
  it closed and is therefore worth that milestone's amount. It is why a
  live MS2-only row was carrying its full line amount (1,383 against a 414.90
  milestone). This patch runs after it and corrects that class of row.

Kept as a separate patch rather than an edit to the original: the original has
already executed on live sites, and on a fresh install the ordering in
patches.txt means this one has the final say either way.
"""
import frappe
from frappe.utils import cint, flt


def execute():
    if not frappe.db.has_column("Work Done", "ms1_closed"):
        print("fix_work_done_revenue_milestone_aware: ms1_closed column absent, skipping")
        return

    rows = frappe.db.sql(
        """
        SELECT wd.name, wd.revenue_sar, wd.source,
               IFNULL(wd.ms1_closed, 0) AS ms1_closed,
               IFNULL(wd.ms2_closed, 0) AS ms2_closed,
               pd.line_amount, pd.ms1_amount, pd.ms2_amount
        FROM `tabWork Done` wd
        JOIN `tabPO Dispatch` pd ON pd.name = wd.system_id
        """,
        as_dict=True,
    )

    fixed = 0
    for row in rows:
        ms1, ms2 = cint(row.ms1_closed), cint(row.ms2_closed)
        # Both flags equal (0/0 normal row, or 1/1 whole-line close) means the
        # row stands for the entire line — the same test list_work_done_rows
        # uses for its per-milestone visibility rule.
        if ms1 and not ms2:
            correct = flt(row.ms1_amount)
        elif ms2 and not ms1:
            correct = flt(row.ms2_amount)
        else:
            correct = flt(row.line_amount)

        if abs(flt(row.revenue_sar) - correct) > 0.001:
            frappe.db.set_value(
                "Work Done", row.name, "revenue_sar", correct,
                update_modified=False,
            )
            fixed += 1
            print(
                f"  {row.name} ({row.source}, ms1={ms1} ms2={ms2}): "
                f"{flt(row.revenue_sar)} -> {correct}"
            )

    if not fixed:
        print("fix_work_done_revenue_milestone_aware: nothing to fix")
        return

    frappe.db.commit()
    print(f"fix_work_done_revenue_milestone_aware: corrected {fixed} of {len(rows)} Work Done records")
