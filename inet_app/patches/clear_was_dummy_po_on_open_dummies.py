"""Clear `was_dummy_po` on dummy POs that have not been mapped yet.

`was_dummy_po` means "this was a dummy and has since been mapped". But
`create_im_dummy_po_dispatch` used to set it at CREATION, so every dummy was
born claiming to have been mapped already — 257 open dummies carried it on
production.

Most readers pair it with `is_dummy_po = 0` and were unaffected. One did not:
``send_dummy_po_reminder`` filtered on ``was_dummy_po = 0 OR NULL`` alongside
``is_dummy_po = 1``, two conditions that could never both be true. Its daily
08:00 run matched nothing and no IM was ever reminded about an unmapped dummy.

The writer is fixed, so new dummies are clean; this corrects the ones already
stamped. Only rows that are still open dummies are touched — a mapped one has
`is_dummy_po = 0` and its flag is correct.

`update_modified` is left alone deliberately: this repairs a flag that was
never meaningful on these rows, and bumping `modified` would reorder every
dummy in lists sorted by it for no reason the user would recognise.
"""

import frappe


def execute():
    if not (frappe.db.has_column("PO Dispatch", "was_dummy_po")
            and frappe.db.has_column("PO Dispatch", "is_dummy_po")):
        return
    frappe.db.sql(
        """UPDATE `tabPO Dispatch`
           SET was_dummy_po = 0
           WHERE IFNULL(is_dummy_po, 0) = 1 AND IFNULL(was_dummy_po, 0) = 1"""
    )
    frappe.db.commit()
