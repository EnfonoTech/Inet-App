"""The subcontractor quantity split — the invariants that keep money right.

Run with::

    bench --site inet run-tests --app inet_app \
        --module inet_app.tests.test_subcontractor_split

Two kinds of test live here.

**Invariants over whatever data the site holds** (``TestSplitInvariants``) are
read-only and are the ones that catch drift: a share formula that stops summing
to 1, or a closure ledger that stops summing to its Work Done header, silently
mis-bills every split line without failing anything else.

**End-to-end cases** (``TestPartialClose``, ``TestIssuedPoLock``) build their
own disposable line and clean it up explicitly in ``tearDown`` rather than
relying on the test runner's rollback: ``direct_close_dispatches`` and the
closure path commit internally, so a rollback here would report success while
leaving the data changed (see the bench CLAUDE.md).
"""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt, today

from inet_app.api.subcontractor_sync import (
    ALLOC_JOIN_SQL,
    ALLOC_SHARE_SQL,
    SUBCON_LOCKED,
    SUBCON_WARN,
    dispatch_subcontractor_locks,
    resync_dispatch_allocations,
    subcontractor_change_block,
)

SUFFIX = "-SPLITTEST"


def _cleanup():
    dead = frappe.get_all("PO Dispatch", filters={"poid": ["like", "%" + SUFFIX]},
                          pluck="name")
    for wd in (frappe.get_all("Work Done", filters={"system_id": ["in", dead]},
                              pluck="name") if dead else []):
        frappe.delete_doc("Work Done", wd, force=True, ignore_permissions=True)
    for name in dead:
        frappe.delete_doc("PO Dispatch", name, force=True, ignore_permissions=True)
    for r in frappe.get_all("PO Direct Close Request",
                            filters={"reason": ["like", "%SPLITTEST%"]}, pluck="name"):
        frappe.delete_doc("PO Direct Close Request", r, force=True, ignore_permissions=True)
    frappe.db.commit()


def _disposable_line(qty=6.0):
    """A line cloned off a real one, so every derived field is valid."""
    src = frappe.db.sql("""
        SELECT pd.name FROM `tabPO Dispatch` pd
        WHERE IFNULL(pd.is_dummy_po,0)=0 AND IFNULL(pd.is_internal_work,0)=0
          AND IFNULL(pd.im,'') != '' AND IFNULL(pd.line_amount,0) > 0
          -- A close refuses a line missing these, so the fixture needs a
          -- source that already has them rather than inventing values.
          AND IFNULL(pd.huawei_im,'') != '' AND IFNULL(pd.project_domain,'') != ''
          AND NOT EXISTS (SELECT 1 FROM `tabWork Done` wd WHERE wd.system_id = pd.name)
          AND NOT EXISTS (SELECT 1 FROM `tabRollout Plan` rp WHERE rp.po_dispatch = pd.name)
        LIMIT 1""")
    if not src:
        raise frappe.ValidationError("no clean PO Dispatch to clone for the fixture")
    doc = frappe.copy_doc(frappe.get_doc("PO Dispatch", src[0][0]))
    doc.poid = (doc.poid or doc.name)[:120] + SUFFIX
    doc.qty = qty
    # The clone's rate belongs to the SOURCE line's quantity, and it inherits
    # that line's invoicing and PO status. A fixture for a fresh close starts
    # with none of it, or the guards fire on the source line's history.
    doc.rate = round(flt(doc.line_amount) / qty, 6) if flt(doc.line_amount) else 0
    doc.subcontract_allocations = []
    doc.contract = None
    doc.dispatch_status = "Dispatched"
    doc.pic_status = ""
    doc.pic_status_ms2 = ""
    for f in ("ms1_invoiced", "ms2_invoiced", "confirmed_qty", "executed_qty",
              "sub_po_status", "sub_po_status_ms1", "sub_po_status_ms2",
              "sub_po_supplier", "direct_close_by"):
        if doc.meta.has_field(f):
            doc.set(f, None)
    doc.insert(ignore_permissions=True)
    frappe.db.commit()
    return doc.name


def _two_sub_suppliers(direct_closeable=False):
    """Two SUB subcontractors.

    ``direct_closeable`` excludes the contract models an admin has flagged
    ``block_direct_close`` (Fix & Core on this bench) — they are only reachable
    through the rollout track, so a Direct Close fixture built on one is
    refused by the server with a message about routing, not about the split.
    """
    extra = ("AND IFNULL(cm.block_direct_close, 0) = 0" if direct_closeable else "")
    subs = frappe.db.sql_list(f"""
        SELECT sm.name FROM `tabSubcontract Master` sm
        LEFT JOIN `tabContract Model` cm ON cm.name = sm.contract_model
        WHERE IFNULL(sm.type,'') = 'SUB' {extra}
        ORDER BY sm.name LIMIT 2""")
    if len(subs) < 2:
        raise frappe.ValidationError("need two SUB subcontractors")
    return subs[0], subs[1]


def _ledger(work_done):
    return frappe.get_all(
        "Work Done Closure", filters={"parent": work_done},
        fields=["closed_qty", "closed_amount", "subcontractor", "milestone"],
        order_by="idx")


def _allocations(po_dispatch):
    return frappe.get_all(
        "PO Subcontract Allocation",
        filters={"parent": po_dispatch, "parenttype": "PO Dispatch",
                 "parentfield": "subcontract_allocations"},
        fields=["subcontractor", "qty", "amount", "sub_po_status_ms1"])


class TestSplitInvariants(FrappeTestCase):
    """Read-only checks against the site's real data."""

    def test_shares_sum_to_one(self):
        """Every allocated line's shares must sum to exactly 1.

        This is the invariant the whole money split rests on: a line's shares
        are what divide its value between suppliers, so shares that sum to 0.5
        lose half the money and shares that sum to 2 bill it twice. Dividing by
        `pd.qty` instead of the allocated total broke this on 6 real lines, one
        of them at 200%.
        """
        bad = frappe.db.sql(f"""
            SELECT pd.poid, SUM({ALLOC_SHARE_SQL}) AS s
            FROM `tabPO Dispatch` pd
            {ALLOC_JOIN_SQL}
            WHERE alloc.name IS NOT NULL
            GROUP BY pd.name
            HAVING ABS(s - 1) > 0.000001
        """, as_dict=True)
        self.assertEqual(
            bad, [], f"{len(bad)} line(s) whose subcontractor shares do not sum to 1: "
                     + ", ".join(f"{r.poid}={flt(r.s):.4f}" for r in bad[:5]))

    def test_ledger_sums_to_work_done(self):
        """A Work Done's revenue must equal its closure ledger.

        ``WorkDone.before_save`` makes the ledger authoritative when it is
        non-empty. If the two drift, the per-supplier legs stop adding up to
        the line and every INET-vs-SUB figure is wrong by the difference.
        """
        bad = frappe.db.sql("""
            SELECT wd.name, IFNULL(wd.revenue_sar,0) AS hdr,
                   SUM(IFNULL(c.closed_amount,0)) AS led
            FROM `tabWork Done` wd
            JOIN `tabWork Done Closure` c ON c.parent = wd.name
                 AND c.parenttype='Work Done' AND c.parentfield='closures'
            GROUP BY wd.name
            HAVING ABS(hdr - led) > 0.01
        """, as_dict=True)
        self.assertEqual(bad, [], f"{len(bad)} Work Done row(s) disagree with their ledger")

    def test_every_closure_names_a_supplier(self):
        """A closure with no subcontractor has nobody to pay and nobody to bill."""
        n = frappe.db.sql("""
            SELECT COUNT(*) FROM `tabWork Done Closure`
            WHERE parenttype='Work Done' AND parentfield='closures'
              AND IFNULL(subcontractor,'') = ''
        """)[0][0]
        self.assertEqual(n, 0, f"{n} closure row(s) with no subcontractor stamped")


class TestPartialClose(FrappeTestCase):
    """2 today to one supplier, 4 later to another — one Work Done, never two."""

    def setUp(self):
        _cleanup()
        self.sub_a, self.sub_b = _two_sub_suppliers(direct_closeable=True)
        self.line = _disposable_line(6.0)
        self.line_amount = flt(frappe.db.get_value("PO Dispatch", self.line, "line_amount"))

    def tearDown(self):
        _cleanup()

    def test_partial_then_remainder_to_another_supplier(self):
        from inet_app.api.command_center import (
            admin_decide_direct_close_request, direct_close_dispatches, _remainder_close)

        res = direct_close_dispatches([self.line], "SUB", self.sub_a, "SPLITTEST partial",
                                      closed_on=today(), close_qty=2)
        self.assertTrue(res.get("created"), f"no request raised: {res.get('blocked')}")
        # A Direct Close is a REQUEST an admin decides. An admin raising one has
        # it approved on the spot; whether this session counts as an admin is a
        # per-site role question, so the decision is driven explicitly when it
        # was not auto-approved rather than assuming either way.
        if not res.get("auto_approved"):
            res = admin_decide_direct_close_request(res["request"], "approve")
            frappe.db.commit()
        self.assertFalse(res.get("blocked"), f"the close was blocked: {res.get('blocked')}")
        self.assertFalse(res.get("refused"), f"the close was refused: {res.get('refused')}")

        wd = frappe.get_all("Work Done", filters={"system_id": self.line},
                            fields=["name", "executed_qty", "revenue_sar"])
        self.assertEqual(len(wd), 1, "a line keeps ONE Work Done for its whole life")
        self.assertAlmostEqual(flt(wd[0].executed_qty), 2, places=3,
                               msg="a partial close must not close the whole line")
        self.assertAlmostEqual(flt(wd[0].revenue_sar), round(self.line_amount * 2 / 6, 2),
                               places=2)

        # The rest, later, to a DIFFERENT supplier — a different quantity, so
        # the one-supplier-per-quantity rule does not apply to it.
        _remainder_close(self.line, route="Direct Close", qty=4,
                         subcontractor=self.sub_b, remark="SPLITTEST remainder")
        frappe.db.commit()

        wd = frappe.get_all("Work Done", filters={"system_id": self.line},
                            fields=["name", "executed_qty", "revenue_sar"])
        self.assertEqual(len(wd), 1, "the remainder must not create a second Work Done")
        self.assertAlmostEqual(flt(wd[0].executed_qty), 6, places=3,
                               msg="2 + 4 is 6, never 7")
        self.assertAlmostEqual(flt(wd[0].revenue_sar), self.line_amount, places=2)

        led = _ledger(wd[0].name)
        self.assertEqual(len(led), 2, "one ledger row per closing event")
        self.assertEqual({r.subcontractor for r in led}, {self.sub_a, self.sub_b})
        self.assertAlmostEqual(sum(flt(r.closed_amount) for r in led),
                               flt(wd[0].revenue_sar), places=2)

        # And the allocations follow the ledger, or the Subcon PO page and
        # every dashboard keep billing the whole line to one supplier.
        alloc = {r.subcontractor: flt(r.qty) for r in _allocations(self.line)}
        self.assertEqual(alloc, {self.sub_a: 2.0, self.sub_b: 4.0})


class TestIssuedPoLock(FrappeTestCase):
    """A submitted supplier PO is the source of truth and cannot be re-derived away."""

    def setUp(self):
        _cleanup()
        self.sub_a, self.sub_b = _two_sub_suppliers()
        self.line = _disposable_line(6.0)

    def tearDown(self):
        _cleanup()

    def _allocate(self, sub, qty, po_status=None):
        frappe.get_doc({
            "doctype": "PO Subcontract Allocation",
            "parent": self.line, "parenttype": "PO Dispatch",
            "parentfield": "subcontract_allocations", "idx": 1,
            "subcontractor": sub, "qty": qty,
            "sub_po_status_ms1": po_status,
        }).db_insert()
        frappe.db.commit()

    def test_submitted_po_blocks_a_smaller_allocation(self):
        self._allocate(self.sub_a, 6.0, po_status="PO Submitted")
        state, msg = subcontractor_change_block(
            self.line, [{"subcontractor": self.sub_b, "qty": 6.0}])
        self.assertEqual(state, SUBCON_LOCKED, msg)
        self.assertIn("Cancel or amend", msg or "")

    def test_submitted_po_allows_extra_quantity_to_the_same_supplier(self):
        """More work ordered later is not a contradiction of the PO."""
        self._allocate(self.sub_a, 2.0, po_status="PO Submitted")
        state, _ = subcontractor_change_block(
            self.line, [{"subcontractor": self.sub_a, "qty": 6.0}])
        self.assertEqual(state, "free")

    def test_draft_po_only_warns(self):
        self._allocate(self.sub_a, 6.0, po_status="PO Created")
        state, msg = subcontractor_change_block(
            self.line, [{"subcontractor": self.sub_b, "qty": 6.0}])
        self.assertEqual(state, SUBCON_WARN, msg)

    def test_line_level_po_status_still_locks(self):
        """Every PO raised before the allocation rows carried their own status.

        Those are recorded on the line, so the lock has to read that too — 299
        submitted supplier POs on the production copy depend on this fallback.
        """
        self._allocate(self.sub_a, 6.0, po_status=None)
        frappe.db.set_value("PO Dispatch", self.line,
                            {"contract": self.sub_a, "sub_po_status_ms1": "PO Submitted"},
                            update_modified=False)
        frappe.db.commit()
        locks = dispatch_subcontractor_locks(self.line)
        self.assertIn(self.sub_a, locks)
        self.assertEqual(locks[self.sub_a]["state"], SUBCON_LOCKED)

    def test_not_ordered_is_free(self):
        self._allocate(self.sub_a, 6.0, po_status=None)
        self.assertEqual(dispatch_subcontractor_locks(self.line), {})
        state, _ = subcontractor_change_block(
            self.line, [{"subcontractor": self.sub_b, "qty": 6.0}])
        self.assertEqual(state, "free")

    def test_resync_never_shrinks_an_ordered_supplier(self):
        """A patch or an import must not reduce a quantity already ordered."""
        self._allocate(self.sub_a, 6.0, po_status="PO Submitted")
        resync_dispatch_allocations(self.line, reason="test")
        frappe.db.commit()
        alloc = {r.subcontractor: flt(r.qty) for r in _allocations(self.line)}
        self.assertIn(self.sub_a, alloc, "an ordered supplier was dropped by a resync")
        self.assertGreaterEqual(alloc[self.sub_a], 6.0,
                                "a resync reduced a quantity that is already on a PO")
