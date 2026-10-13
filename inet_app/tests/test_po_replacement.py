"""POID Replacement / Merge — the guards that define the replaceable window.

Run with::

    bench --site inet run-tests --app inet_app \
        --module inet_app.tests.test_po_replacement

Phase 1 moves nothing. What is tested here is the refusal set, because that
is what the whole design rests on: a line may be replaced until it is
CONFIRMED, and after that the money is settled and the correction belongs to
finance. Every simplification in the feature — no closure ledger to merge, no
accounting row ever re-attributed — is bought by these refusals holding.

Fixtures are disposable lines cloned off real ones, torn down explicitly in
``tearDown`` rather than by the runner's rollback: PO Dispatch inserts here
commit, so a rollback would report success while leaving rows behind (see the
bench CLAUDE.md).
"""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import flt, today

from inet_app.api.command_center import (
    _po_replacement_snapshot,
    assert_po_replacement_source_eligible,
    assert_po_replacement_target_eligible,
    check_po_replacement,
)

SUFFIX = "-REPLTEST"


def _cleanup():
    dead = frappe.get_all("PO Dispatch", filters={"poid": ["like", "%" + SUFFIX]},
                          pluck="name")
    for wd in (frappe.get_all("Work Done", filters={"system_id": ["in", dead]},
                              pluck="name") if dead else []):
        frappe.delete_doc("Work Done", wd, force=True, ignore_permissions=True)
    for r in frappe.get_all("PO Replacement Request",
                            filters={"reason": ["like", "%" + SUFFIX + "%"]}, pluck="name"):
        frappe.delete_doc("PO Replacement Request", r, force=True, ignore_permissions=True)
    for name in dead:
        frappe.delete_doc("PO Dispatch", name, force=True, ignore_permissions=True)
    frappe.db.commit()


def _disposable_line(tag, qty=3.0, project_code=None):
    """A line cloned off a real one, so every derived field is valid."""
    src = frappe.db.sql("""
        SELECT pd.name FROM `tabPO Dispatch` pd
        WHERE IFNULL(pd.is_dummy_po,0)=0 AND IFNULL(pd.is_internal_work,0)=0
          AND IFNULL(pd.im,'') != '' AND IFNULL(pd.line_amount,0) > 0
          AND IFNULL(pd.project_code,'') != ''
          AND NOT EXISTS (SELECT 1 FROM `tabWork Done` wd WHERE wd.system_id = pd.name)
          AND NOT EXISTS (SELECT 1 FROM `tabRollout Plan` rp WHERE rp.po_dispatch = pd.name)
        LIMIT 1""")
    if not src:
        raise frappe.ValidationError("no clean PO Dispatch to clone for the fixture")
    doc = frappe.copy_doc(frappe.get_doc("PO Dispatch", src[0][0]))
    doc.poid = (doc.poid or doc.name)[:110] + tag + SUFFIX
    doc.qty = qty
    doc.rate = round(flt(doc.line_amount) / qty, 6) if flt(doc.line_amount) else 0
    if project_code:
        doc.project_code = project_code
    # The clone inherits the source line's history; a fresh fixture has none.
    doc.dispatch_status = "Dispatched"
    doc.pic_status = ""
    doc.pic_status_ms2 = ""
    if doc.meta.has_field("subcontract_allocations"):
        doc.subcontract_allocations = []
    for f in ("ms1_invoiced", "ms2_invoiced", "confirmed_qty", "confirmed_amount",
              "contract", "sub_po_status", "sub_po_status_ms1", "sub_po_status_ms2",
              "sub_po_supplier", "direct_close_by", "replaced_by", "replaces_poids"):
        if doc.meta.has_field(f):
            doc.set(f, None)
    doc.insert(ignore_permissions=True)
    frappe.db.commit()
    return doc.name


class TestReplacementWindow(FrappeTestCase):
    """What may and may not be replaced."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        _cleanup()
        frappe.set_user("Administrator")
        cls.old = _disposable_line("-OLD")
        project = frappe.db.get_value("PO Dispatch", cls.old, "project_code")
        cls.new = _disposable_line("-NEW", project_code=project)

    @classmethod
    def tearDownClass(cls):
        _cleanup()
        super().tearDownClass()

    def _refusal(self, source=None, target=None):
        """The message check_po_replacement gives for one source line."""
        res = check_po_replacement([source or self.old], target or self.new)
        if res["target_error"]:
            return res["target_error"]
        return res["blocked"][0]["error"] if res["blocked"] else None

    # ── the window is open ──────────────────────────────────────────────
    def test_a_clean_line_may_be_replaced(self):
        res = check_po_replacement([self.old], self.new)
        self.assertIsNone(res["target_error"])
        self.assertEqual(res["blocked"], [])
        self.assertEqual([e["po_dispatch"] for e in res["eligible"]], [self.old])

    def test_two_old_poids_may_merge_onto_one_new(self):
        """The N:1 case the client actually has — two cancelled lines, one new."""
        second = _disposable_line("-OLD2",
                                  project_code=frappe.db.get_value(
                                      "PO Dispatch", self.old, "project_code"))
        try:
            res = check_po_replacement([self.old, second], self.new)
            self.assertIsNone(res["target_error"])
            self.assertEqual(res["blocked"], [])
            self.assertCountEqual([e["po_dispatch"] for e in res["eligible"]],
                                  [self.old, second])
            self.assertAlmostEqual(
                res["total_amount"],
                flt(frappe.db.get_value("PO Dispatch", self.old, "line_amount"))
                + flt(frappe.db.get_value("PO Dispatch", second, "line_amount")), 2)
        finally:
            frappe.delete_doc("PO Dispatch", second, force=True, ignore_permissions=True)
            frappe.db.commit()

    # ── the window closes ───────────────────────────────────────────────
    def test_confirmed_is_refused(self):
        frappe.db.set_value("PO Dispatch", self.old, "confirmed_qty", 2)
        try:
            self.assertIn("already confirmed", self._refusal())
        finally:
            frappe.db.set_value("PO Dispatch", self.old, "confirmed_qty", 0)

    def test_invoiced_is_refused(self):
        frappe.db.set_value("PO Dispatch", self.old, "ms1_invoiced", 100)
        try:
            self.assertIn("already invoiced", self._refusal())
        finally:
            frappe.db.set_value("PO Dispatch", self.old, "ms1_invoiced", 0)

    def test_cancelled_is_refused(self):
        """The 32 already-stranded lines are in this state and stay as they are."""
        frappe.db.set_value("PO Dispatch", self.old, "dispatch_status", "Cancelled")
        try:
            self.assertIn("already Cancelled", self._refusal())
        finally:
            frappe.db.set_value("PO Dispatch", self.old, "dispatch_status", "Dispatched")

    def test_subcontractor_po_is_refused(self):
        frappe.db.set_value("PO Dispatch", self.old, "sub_po_status", "PO Submitted")
        try:
            self.assertIn("subcontractor PO", self._refusal())
        finally:
            frappe.db.set_value("PO Dispatch", self.old, "sub_po_status", "Not Ordered")

    def test_a_line_already_replaced_is_refused(self):
        frappe.db.set_value("PO Dispatch", self.old, "replaced_by", self.new)
        try:
            self.assertIn("already replaced by", self._refusal())
        finally:
            frappe.db.set_value("PO Dispatch", self.old, "replaced_by", None)

    # ── the target ──────────────────────────────────────────────────────
    def test_a_poid_cannot_replace_itself(self):
        self.assertIn("cannot replace itself", self._refusal(target=self.old))

    def test_a_finished_target_is_refused(self):
        """A new POID must still be waiting to be worked. Closed is the one
        that mattered in practice: it carries no plan or Work Done of its own
        on legacy lines, so the carrying-work test let it through while the
        line had already been delivered and invoiced."""
        for status in ("Closed", "Completed", "Submitted", "Partially Closed",
                       "Backend Assigned", "Planned"):
            frappe.db.set_value("PO Dispatch", self.new, "dispatch_status", status)
            msg = self._refusal()
            self.assertIsNotNone(msg, f"{status} should be refused as a target")
            self.assertIn("waiting to be worked", msg, f"wrong reason for {status}")
        frappe.db.set_value("PO Dispatch", self.new, "dispatch_status", "Dispatched")
        self.assertIsNone(self._refusal(), "Dispatched must still be allowed")

    def test_an_invoiced_target_is_refused(self):
        frappe.db.set_value("PO Dispatch", self.new, "ms1_invoiced", 10)
        try:
            self.assertIn("already been invoiced", self._refusal())
        finally:
            frappe.db.set_value("PO Dispatch", self.new, "ms1_invoiced", 0)

    def test_the_picker_only_offers_what_the_guard_accepts(self):
        """The picker and the guard must agree, or the UI offers a POID and
        the server then refuses it."""
        from inet_app.api.command_center import list_po_replacement_targets
        for r in list_po_replacement_targets([self.old], limit=25):
            self.assertIn(r["dispatch_status"], ("", "Pending", "Dispatched"),
                          f"{r['poid']} offered with status {r['dispatch_status']}")
            res = check_po_replacement([self.old], r["name"])
            self.assertIsNone(res["target_error"],
                              f"{r['poid']} was offered but refused: {res['target_error']}")

    def test_a_target_carrying_work_is_refused(self):
        wd = frappe.new_doc("Work Done")
        wd.system_id = self.new
        wd.source = "Backend"
        wd.insert(ignore_permissions=True)
        frappe.db.commit()
        try:
            self.assertIn("double-book", self._refusal())
        finally:
            frappe.delete_doc("Work Done", wd.name, force=True, ignore_permissions=True)
            frappe.db.commit()

    def test_a_different_project_is_refused(self):
        other = frappe.db.sql("""SELECT name FROM `tabProject Control Center`
            WHERE name != %s LIMIT 1""",
            (frappe.db.get_value("PO Dispatch", self.new, "project_code"),))
        if not other:
            self.skipTest("only one project on this site")
        frappe.db.set_value("PO Dispatch", self.new, "project_code", other[0][0])
        try:
            self.assertIn("is on project", self._refusal())
        finally:
            frappe.db.set_value("PO Dispatch", self.new, "project_code",
                                frappe.db.get_value("PO Dispatch", self.old, "project_code"))

    # ── the snapshot the guards read ────────────────────────────────────
    def test_snapshot_counts_what_would_move(self):
        snap = _po_replacement_snapshot(self.old)
        for key in ("plan_count", "execution_count", "work_done_count",
                    "closure_count", "submitted_invoice_count"):
            self.assertIn(key, snap, f"{key} missing — a guard reads it")
            self.assertEqual(snap[key], 0, f"{key} should be 0 on a fresh fixture")
        self.assertFalse(snap["subcon_po_raised"])

    def test_guards_are_callable_directly(self):
        """The approve path re-runs these, so they must work off a snapshot
        alone rather than only through check_po_replacement."""
        src = _po_replacement_snapshot(self.old)
        tgt = _po_replacement_snapshot(self.new)
        assert_po_replacement_source_eligible(src)
        assert_po_replacement_target_eligible(tgt, [src])


def _plan_with_execution(po_dispatch):
    """A plan and its execution on a line, so a replacement has work to move."""
    rp = frappe.new_doc("Rollout Plan")
    rp.po_dispatch = po_dispatch
    rp.plan_date = today()
    rp.plan_status = "Planned"
    rp.visit_number = 1
    rp.im = frappe.db.get_value("PO Dispatch", po_dispatch, "im")
    rp.insert(ignore_permissions=True)
    de = frappe.new_doc("Daily Execution")
    de.rollout_plan = rp.name
    de.system_id = po_dispatch
    de.execution_date = today()
    de.execution_status = "Completed"
    de.insert(ignore_permissions=True)
    frappe.db.commit()
    return rp.name, de.name


def _work_done(po_dispatch, qty=1.0):
    wd = frappe.new_doc("Work Done")
    wd.system_id = po_dispatch
    wd.source = "Backend"
    wd.executed_qty = qty
    wd.insert(ignore_permissions=True)
    frappe.db.commit()
    return wd.name


class TestReplacementMovesTheWork(FrappeTestCase):
    """Phase 2 — approval actually re-points the work and leaves a tombstone."""

    def setUp(self):
        frappe.set_user("Administrator")
        _cleanup()
        self.old = _disposable_line("-M1")
        project = frappe.db.get_value("PO Dispatch", self.old, "project_code")
        self.new = _disposable_line("-M2", project_code=project)

    def tearDown(self):
        _cleanup()

    def _approve(self, sources, target):
        from inet_app.api.command_center import _apply_po_replacement
        snaps = [_po_replacement_snapshot(n) for n in sources]
        return _apply_po_replacement(snaps, _po_replacement_snapshot(target))

    def test_plan_execution_and_work_done_all_move(self):
        rp, de = _plan_with_execution(self.old)
        wd = _work_done(self.old)

        moved = self._approve([self.old], self.new)

        self.assertEqual(moved["plans"], 1)
        self.assertEqual(moved["executions"], 1)
        self.assertEqual(moved["work_done_moved"], 1)
        self.assertEqual(frappe.db.get_value("Rollout Plan", rp, "po_dispatch"), self.new)
        self.assertEqual(frappe.db.get_value("Daily Execution", de, "system_id"), self.new)
        self.assertEqual(frappe.db.get_value("Work Done", wd, "system_id"), self.new)

    def test_the_old_line_becomes_a_tombstone(self):
        self._approve([self.old], self.new)
        old = frappe.db.get_value("PO Dispatch", self.old,
                                  ["dispatch_status", "replaced_by", "replaced_on"],
                                  as_dict=True)
        self.assertEqual(old.dispatch_status, "Cancelled")
        self.assertEqual(old.replaced_by, self.new)
        self.assertIsNotNone(old.replaced_on)
        # and the new line records what it absorbed
        self.assertIn(frappe.db.get_value("PO Dispatch", self.old, "poid"),
                      frappe.db.get_value("PO Dispatch", self.new, "replaces_poids") or "")

    def test_the_moved_work_done_is_revalued_against_the_new_line(self):
        """The point of the feature: work recorded against a line that is now
        worth nothing becomes worth the new line's amount."""
        wd = _work_done(self.old)
        frappe.db.set_value("PO Dispatch", self.new, "line_amount", 999)
        self._approve([self.old], self.new)
        self.assertEqual(frappe.db.get_value("Work Done", wd, "system_id"), self.new)
        self.assertAlmostEqual(
            flt(frappe.db.get_value("Work Done", wd, "revenue_sar")), 999.0, 2)

    def test_two_work_done_records_merge_into_one(self):
        """N:1 — one Work Done per POID, so the second folds into the first."""
        second = _disposable_line("-M3",
                                  project_code=frappe.db.get_value(
                                      "PO Dispatch", self.old, "project_code"))
        _work_done(self.old, qty=2)
        _work_done(second, qty=3)
        moved = self._approve([self.old, second], self.new)
        self.assertEqual(moved["work_done_moved"], 1)
        self.assertEqual(moved["work_done_merged"], 1)
        rows = frappe.get_all("Work Done", filters={"system_id": self.new},
                              fields=["name", "executed_qty"])
        self.assertEqual(len(rows), 1, "the new POID must end with exactly one Work Done")
        self.assertAlmostEqual(flt(rows[0].executed_qty), 5.0, 4)
        # both old lines point at the same successor
        for src in (self.old, second):
            self.assertEqual(frappe.db.get_value("PO Dispatch", src, "replaced_by"), self.new)

    def test_a_replaced_line_cannot_be_replaced_again(self):
        self._approve([self.old], self.new)
        res = check_po_replacement([self.old], self.new)
        self.assertTrue(res["blocked"])
        self.assertIn("already", res["blocked"][0]["error"])

    def test_an_audit_event_is_written_for_both_sides(self):
        self._approve([self.old], self.new)
        self.assertTrue(frappe.db.count("PO Status Event",
                        {"po_dispatch": self.old, "field_changed": "replaced_by"}))
        self.assertTrue(frappe.db.count("PO Status Event",
                        {"po_dispatch": self.new, "field_changed": "replaces_poids"}))


class TestReplacementApproval(FrappeTestCase):
    """The PM decision path, through the endpoint rather than the mover."""

    def setUp(self):
        frappe.set_user("Administrator")
        _cleanup()
        self.old = _disposable_line("-A1")
        project = frappe.db.get_value("PO Dispatch", self.old, "project_code")
        self.new = _disposable_line("-A2", project_code=project)
        self.req = self._pending_request()

    def tearDown(self):
        _cleanup()

    def _pending_request(self):
        """Built directly rather than through request_po_replacement, which
        needs a live IM session the test runner does not have."""
        src = _po_replacement_snapshot(self.old)
        doc = frappe.new_doc("PO Replacement Request")
        doc.im = frappe.db.get_value("PO Dispatch", self.old, "im")
        doc.new_po_dispatch = self.new
        doc.new_poid = frappe.db.get_value("PO Dispatch", self.new, "poid")
        doc.requested_by = frappe.session.user
        doc.request_status = "Pending PM Approval"
        doc.reason = "unit test " + SUFFIX
        doc.poid_count = 1
        doc.total_amount = flt(src.get("line_amount"))
        doc.append("poids", {
            "po_dispatch": self.old, "poid": src.get("poid"),
            "site_code": src.get("site_code"), "project_code": src.get("project_code"),
            "qty": flt(src.get("qty")), "line_amount": flt(src.get("line_amount")),
            "line_status": "Pending",
        })
        doc.insert(ignore_permissions=True)
        frappe.db.commit()
        return doc.name

    def test_approve_moves_the_work_and_closes_the_request(self):
        from inet_app.api.command_center import pm_decide_po_replacement
        _plan_with_execution(self.old)
        out = pm_decide_po_replacement(self.req, "approve", remark="ok " + SUFFIX)
        self.assertEqual(out["request_status"], "Approved")
        self.assertEqual(out["moved"]["plans"], 1)
        self.assertEqual(out["lines"][0]["line_status"], "Replaced")
        self.assertEqual(frappe.db.get_value("PO Dispatch", self.old, "replaced_by"), self.new)

    def test_reject_changes_nothing_but_the_request(self):
        from inet_app.api.command_center import pm_decide_po_replacement
        rp, _de = _plan_with_execution(self.old)
        out = pm_decide_po_replacement(self.req, "reject", remark="no " + SUFFIX)
        self.assertEqual(out["request_status"], "Rejected by PM")
        self.assertEqual(frappe.db.get_value("Rollout Plan", rp, "po_dispatch"), self.old)
        self.assertIsNone(frappe.db.get_value("PO Dispatch", self.old, "replaced_by"))
        self.assertEqual(frappe.db.get_value("PO Dispatch", self.old, "dispatch_status"),
                         "Dispatched")

    def test_a_line_that_moved_on_aborts_the_whole_approval(self):
        """Re-validation at approve time: the request was fine when made."""
        from inet_app.api.command_center import pm_decide_po_replacement
        frappe.db.set_value("PO Dispatch", self.old, "ms1_invoiced", 50)
        try:
            with self.assertRaises(Exception) as ctx:
                pm_decide_po_replacement(self.req, "approve")
            self.assertIn("already invoiced", str(ctx.exception))
            # nothing was written
            self.assertIsNone(frappe.db.get_value("PO Dispatch", self.old, "replaced_by"))
            self.assertEqual(
                frappe.db.get_value("PO Replacement Request", self.req, "request_status"),
                "Pending PM Approval")
        finally:
            frappe.db.set_value("PO Dispatch", self.old, "ms1_invoiced", 0)

    def test_a_decided_request_cannot_be_decided_again(self):
        from inet_app.api.command_center import pm_decide_po_replacement
        pm_decide_po_replacement(self.req, "reject")
        with self.assertRaises(Exception) as ctx:
            pm_decide_po_replacement(self.req, "approve")
        self.assertIn("not awaiting PM approval", str(ctx.exception))

    def test_the_pending_poid_list_sees_it(self):
        rows = frappe.db.sql(
            "SELECT l.po_dispatch FROM `tabPO Replacement Request Line` l "
            "INNER JOIN `tabPO Replacement Request` h ON h.name = l.parent "
            "WHERE h.request_status = 'Pending PM Approval'")
        self.assertIn(self.old, [r[0] for r in rows])

    def test_a_second_request_on_the_same_line_still_blocks_approval(self):
        """The approve path excludes only ITS OWN request from the
        duplicate-pending guard, so a second one racing it is still caught."""
        from inet_app.api.command_center import pm_decide_po_replacement
        rival = self._pending_request()
        try:
            with self.assertRaises(Exception) as ctx:
                pm_decide_po_replacement(self.req, "approve")
            self.assertIn("already waiting", str(ctx.exception))
            self.assertIn(rival, str(ctx.exception))
        finally:
            frappe.delete_doc("PO Replacement Request", rival,
                              force=True, ignore_permissions=True)
            frappe.db.commit()


class TestReplacementOwnership(FrappeTestCase):
    """Who owns the new POID afterwards, and whose lines may be picked."""

    def setUp(self):
        frappe.set_user("Administrator")
        _cleanup()
        self.old = _disposable_line("-O1")
        project = frappe.db.get_value("PO Dispatch", self.old, "project_code")
        self.new = _disposable_line("-O2", project_code=project)

    def tearDown(self):
        _cleanup()

    def _move(self):
        from inet_app.api.command_center import _apply_po_replacement
        return _apply_po_replacement([_po_replacement_snapshot(self.old)],
                                     _po_replacement_snapshot(self.new))

    def test_an_unassigned_target_is_refused(self):
        """An IM only ever acts on their own POIDs — the rule the whole portal
        is built on. An unassigned line is not free to take: it has to be
        dispatched to the IM first, which is the step that makes it theirs."""
        frappe.db.set_value("PO Dispatch", self.new, "im", None)
        res = check_po_replacement([self.old], self.new)
        self.assertIsNotNone(res["target_error"])
        self.assertIn("not assigned to any IM", res["target_error"])

    def test_both_lines_must_be_the_same_im(self):
        im = frappe.db.get_value("PO Dispatch", self.old, "im")
        frappe.db.set_value("PO Dispatch", self.new, "im", im)
        self.assertIsNone(check_po_replacement([self.old], self.new)["target_error"])

    def test_a_target_already_owned_by_the_same_im_keeps_it(self):
        im = frappe.db.get_value("PO Dispatch", self.old, "im")
        frappe.db.set_value("PO Dispatch", self.new, "im", im)
        self._move()
        self.assertEqual(frappe.db.get_value("PO Dispatch", self.new, "im"), im)

    def test_another_ims_poid_cannot_be_taken(self):
        other = frappe.db.sql("""SELECT name FROM `tabIM Master`
            WHERE name != %s LIMIT 1""",
            (frappe.db.get_value("PO Dispatch", self.old, "im"),))
        if not other:
            self.skipTest("only one IM on this site")
        frappe.db.set_value("PO Dispatch", self.new, "im", other[0][0])
        res = check_po_replacement([self.old], self.new)
        self.assertIsNotNone(res["target_error"])
        self.assertIn("different IM", res["target_error"])

    def test_the_picker_never_offers_another_ims_poid(self):
        from inet_app.api.command_center import list_po_replacement_targets
        mine = frappe.db.get_value("PO Dispatch", self.old, "im")
        for r in list_po_replacement_targets([self.old], limit=50):
            owner = frappe.db.get_value("PO Dispatch", r["name"], "im") or ""
            self.assertEqual(owner, mine,
                             f"{r['poid']} belongs to {owner or '(unassigned)'}, not {mine}")


class TestReplacementLeavesTheNewLineUsable(FrappeTestCase):
    """After the move the new line must look like what it now carries."""

    def setUp(self):
        frappe.set_user("Administrator")
        _cleanup()
        self.old = _disposable_line("-U1")
        project = frappe.db.get_value("PO Dispatch", self.old, "project_code")
        self.new = _disposable_line("-U2", project_code=project)
        frappe.db.set_value("PO Dispatch", self.new, "im",
                            frappe.db.get_value("PO Dispatch", self.old, "im"))
        frappe.db.set_value("PO Dispatch", self.old, "line_amount", 512)
        frappe.db.set_value("PO Dispatch", self.new, "line_amount", 165)
        frappe.db.commit()

    def tearDown(self):
        _cleanup()

    def _move(self):
        from inet_app.api.command_center import _apply_po_replacement
        return _apply_po_replacement([_po_replacement_snapshot(self.old)],
                                     _po_replacement_snapshot(self.new))

    def test_a_line_that_gains_a_plan_reads_planned(self):
        """Left at Dispatched it sits in the still-to-be-planned queue while
        holding a live plan — an invitation to plan the same job twice."""
        rp, _de = _plan_with_execution(self.old)
        self._move()
        self.assertEqual(frappe.db.get_value("PO Dispatch", self.new, "dispatch_status"),
                         "Planned")
        self.assertEqual(frappe.db.get_value("PO Dispatch", self.old, "dispatch_status"),
                         "Cancelled")

    def test_a_line_that_gains_a_work_done_reads_completed(self):
        _work_done(self.old)
        self._move()
        self.assertEqual(frappe.db.get_value("PO Dispatch", self.new, "dispatch_status"),
                         "Completed")

    def test_the_moved_plan_is_revalued_against_the_new_line(self):
        """target_amount IS the line's value — completion_pct is
        achieved_amount / target_amount — so a plan carrying the old line's
        money measures completion against the wrong bar."""
        rp, _de = _plan_with_execution(self.old)
        frappe.db.set_value("Rollout Plan", rp, "target_amount", 512)
        frappe.db.commit()
        self._move()
        self.assertAlmostEqual(
            flt(frappe.db.get_value("Rollout Plan", rp, "target_amount")), 165.0, 2)

    def test_a_partial_plan_stays_partial(self):
        rp, _de = _plan_with_execution(self.old)
        frappe.db.set_value("Rollout Plan", rp, "target_amount", 256)  # half of 512
        frappe.db.commit()
        self._move()
        self.assertAlmostEqual(
            flt(frappe.db.get_value("Rollout Plan", rp, "target_amount")), 82.5, 2)

    def test_a_worthless_old_line_takes_the_new_lines_value(self):
        """The stranded case: work recorded against a line worth nothing."""
        frappe.db.set_value("PO Dispatch", self.old, "line_amount", 0)
        rp, _de = _plan_with_execution(self.old)
        frappe.db.set_value("Rollout Plan", rp, "target_amount", 0)
        frappe.db.commit()
        self._move()
        self.assertAlmostEqual(
            flt(frappe.db.get_value("Rollout Plan", rp, "target_amount")), 165.0, 2)

    def test_the_moved_records_take_the_new_lines_item_and_region(self):
        """item_code and region_type are copies of the line's own values —
        item_code matches its dispatch on 3,958 of 3,976 Work Done rows — so
        they are maintained, not snapshots, and must follow the move."""
        # item_code is a Link to Item, so the fixture needs two real ones.
        items = frappe.get_all("Item", pluck="name", limit_page_length=2)
        if len(items) < 2:
            self.skipTest("need two Items on this site")
        old_item, new_item = items[0], items[1]
        frappe.db.set_value("PO Dispatch", self.new,
                            {"item_code": new_item, "region_type": "Hard"})
        frappe.db.set_value("PO Dispatch", self.old,
                            {"item_code": old_item, "region_type": "Standard"})
        frappe.db.commit()
        rp, de = _plan_with_execution(self.old)
        frappe.db.set_value("Rollout Plan", rp, "region_type", "Standard")
        frappe.db.set_value("Daily Execution", de, "region_type", "Standard")
        wd = _work_done(self.old)
        frappe.db.commit()

        self._move()

        self.assertEqual(frappe.db.get_value("Work Done", wd, "item_code"), new_item)
        self.assertEqual(frappe.db.get_value("Work Done", wd, "region_type"), "Hard")
        self.assertEqual(frappe.db.get_value("Rollout Plan", rp, "region_type"), "Hard")
        self.assertEqual(frappe.db.get_value("Daily Execution", de, "region_type"), "Hard")

    def test_rate_follows_the_line_but_quantity_does_not(self):
        """Money is a property of the line; quantity is a fact about the work.
        The new POID orders a different quantity in 178 of 258 real pairs, so
        rescaling executed_qty would rewrite history to match a number it
        never had."""
        frappe.db.set_value("PO Dispatch", self.old, {"qty": 3, "rate": 170.67})
        frappe.db.set_value("PO Dispatch", self.new, {"qty": 1, "rate": 165})
        frappe.db.commit()
        wd = _work_done(self.old, qty=3)
        frappe.db.set_value("Work Done", wd, "billing_rate_sar", 170.67)
        frappe.db.commit()

        self._move()

        self.assertAlmostEqual(
            flt(frappe.db.get_value("Work Done", wd, "billing_rate_sar")), 165.0, 2,
            "rate is the line's and must follow")
        self.assertAlmostEqual(
            flt(frappe.db.get_value("Work Done", wd, "executed_qty")), 3.0, 4,
            "executed quantity is what was done and must NOT be rescaled")

    def test_a_quantity_change_is_surfaced_not_hidden(self):
        frappe.db.set_value("PO Dispatch", self.old, "qty", 3)
        frappe.db.set_value("PO Dispatch", self.new, "qty", 1)
        frappe.db.commit()
        res = check_po_replacement([self.old], self.new)
        self.assertIsNone(res["target_error"])
        self.assertTrue(res["warnings"], "a qty change must be reported")
        self.assertIn("orders 1", " ".join(res["warnings"]))

    def test_no_warning_when_nothing_changes(self):
        for f in ("qty", "rate", "line_amount"):
            frappe.db.set_value("PO Dispatch", self.new, f,
                                frappe.db.get_value("PO Dispatch", self.old, f))
        frappe.db.commit()
        self.assertEqual(check_po_replacement([self.old], self.new)["warnings"], [])
