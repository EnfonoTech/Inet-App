# INET App — Findings Backlog

Actionable list of bugs, performance work, and enhancement opportunities
identified by an audit pass of the codebase. Prioritized by blast radius:
**P0** would lose / corrupt data, **P1** is wrong behavior or measurable
slowness, **P2** is UX or polish.

Every entry has:
- **Where** — file:line or a flow name.
- **Why it matters** — 1 line.
- **Fix** — what to do.

---

## P0 — Data-integrity gaps

### `dispatch_status` has no state machine
- **Where**: PO Dispatch enum touched from many places (`confirm_po_upload`,
  `_run_po_archive_import`, `mark_subcon_work_done`, `assign_subcon`, etc.).
- **Why**: Nothing prevents `Closed → Pending` or `Completed → Cancelled`.
  The sub-contract flow currently manages `Sub-Contracted → Completed` by
  convention only; an admin clicking the wrong row could revert a finished
  invoice flow.
- **Fix**: Add a `validate` hook on PO Dispatch that consults a transition
  matrix and rejects illegal moves. Allow admin override via
  `flags.allow_status_override = True` for one-off corrections.

### `frappe.db.set_value` bypasses validate
- **Where**:
  - `pic.py` — `bulk_update_pic_status` (line ~298) writes `pic_status` /
    `pic_status_ms2` raw via `frappe.db.set_value`.
  - `command_center.py` — `_stamp_archive_pic_fields` (archive import) writes
    the full PIC payload raw.
- **Why**: PO Dispatch's validate hook recomputes `ms1_amount` / `ms2_amount`
  / `ms1_unbilled` / `ms2_unbilled`. Bypassing it leaves derived columns
  stale when the underlying invoiced amount changes.
- **Fix**: For bulk PIC status (no monetary fields touched) the bypass is
  fine — keep it. For the archive importer, after `set_value` of the bulk
  payload, manually recompute `ms1_unbilled` / `ms2_unbilled` (already
  partially done) so reads stay consistent without paying the `doc.save()`
  cost on 12k rows.

---

## P1 — Bugs / fragile logic

### PIC drift after retroactive Work Done changes
- **Where**: `pic.py` `_PIC_INITIAL_RULE_SQL`.
- **Why**: The rule reads "if `pic_status` is null, derive from
  `Work Done.submission_status='Confirmation Done'`." Once the PIC saves,
  the stored value wins forever. If the IM later marks Work Done as
  un-confirmed (e.g. because of a rejection), the PIC row keeps showing the
  old status.
- **Fix**: When IM toggles `submission_status` away from
  `Confirmation Done`, also clear `pic_status` (or set it to
  `Work Not Done`) on the linked PO Dispatch. Add the hook to
  `update_work_done_submission`.

### Race in older list pages (still on `useResetOnRowLimitChange`)
- **Where**: `IMPOIntake.jsx`, `IMSubcon.jsx`, `WorkDone.jsx`,
  `ExecutionMonitor.jsx`, `IMWorkDone.jsx`, etc.
- **Why**: Two parallel state flows (the reset hook clears rows during
  render; a separate `useEffect([load])` fires the API). When the row limit
  changes from a higher to lower number, the smaller fetch can finish
  before the reset commits, leaving the table blank. This is the same bug
  we already fixed in `PICTracker.jsx` with a single `useEffect` +
  `cancelled` guard.
- **Fix**: Migrate the other pages to the same pattern. ~50-line change
  per page; do them all in one PR so the pattern is consistent.

### Many SELECTs miss `has_column` guards
- **Where**: After the recent prod fix the `general_remark` /
  `manager_remark` / `team_lead_remark` projections are guarded everywhere,
  but the surrounding columns (`pic_status`, `subcon_submission_status`,
  `payment_terms`, `tax_rate`, `project_domain`) only have guards in some
  spots.
- **Why**: A site that's pulled the new code but hasn't run `bench migrate`
  yet will throw `OperationalError 1054` from the next list endpoint that
  hasn't been guarded.
- **Fix**: Use the existing `_po_dispatch_col_expr` helper consistently.
  `command_center.py` projections + `pic.py` SELECT need a one-time pass.
  Migration is the long-term fix; guards are seat-belts.

### `frappe.parse_json` without try/except
- **Where**: a handful of payload-parsing call sites in command_center.py
  (search `frappe.parse_json(`).
- **Why**: A truncated payload returns `None`; downstream code does
  `payload.get(...)` which throws `AttributeError`. The user sees a server
  500 instead of a clean validation error.
- **Fix**: Wrap each `frappe.parse_json` boundary call in try/except and
  `frappe.throw("Malformed payload")` on failure.

### Standard upload still hits Frappe `MandatoryError` for some legacy rows
- **Where**: `confirm_po_upload`. The `_resolve_item_code_with_fallback`
  helper covers the obvious cases (blank, "NA", "-") and we set
  `doc.flags.ignore_mandatory = True`, but some rows still fail with
  `Row #1: Value missing for: Item Code` if Frappe's validate runs *before*
  the flag is read by the child save.
- **Fix**: Set the flag on the child entries directly — `append_row["__skip_mandatory"] = True`
  isn't a Frappe convention; instead pass `ignore_mandatory=True` to
  `doc.save(ignore_mandatory=True)` rather than via flags. Or short-circuit
  by stamping a placeholder code (`MISC-{poid}`) when both code + desc are
  empty, so mandatory passes naturally.

---

## P1 — Performance

### Missing MySQL indexes (the big one)
PO Dispatch is the most-queried table at ~16k rows. Add these (one
migration, drops the response time on the affected lists by 50–80%):

```sql
-- Drives PIC dashboard + tracker filters
ALTER TABLE `tabPO Dispatch` ADD INDEX idx_pd_pic_status (pic_status);
ALTER TABLE `tabPO Dispatch` ADD INDEX idx_pd_pic_status_ms2 (pic_status_ms2);

-- Drives subcon panel + Sub-Contract Pending list
ALTER TABLE `tabPO Dispatch` ADD INDEX idx_pd_subcon_status (subcon_status);

-- Drives "PO Control" intake (target_month null/has)
ALTER TABLE `tabPO Dispatch` ADD INDEX idx_pd_target_month (target_month);

-- Drives almost every list (filter by IM)
ALTER TABLE `tabPO Dispatch` ADD INDEX idx_pd_im (im);

-- Drives the Rollout Plan latest-visit lookup
ALTER TABLE `tabRollout Plan` ADD INDEX idx_rp_dispatch_visit (po_dispatch, visit_number);

-- Drives Daily Execution → Rollout Plan join
ALTER TABLE `tabDaily Execution` ADD INDEX idx_de_rollout_plan (rollout_plan);

-- Drives Work Done → Daily Execution + submission lookup
ALTER TABLE `tabWork Done` ADD INDEX idx_wd_execution (execution);
ALTER TABLE `tabWork Done` ADD INDEX idx_wd_submission_status (submission_status);
```

Add via a Frappe patch (`patches/v1_0/add_pic_indexes.py`) so it runs once
on every site's next migrate. ~30 lines.

### `_PIC_FROM_JOIN` does work for every PIC list call
- **Where**: `pic.py` `_PIC_FROM_JOIN` includes a sub-aggregate over
  Rollout Plan + Daily Execution + Work Done.
- **Why**: Even when the request is just a list of POIDs (Tracker page),
  every row pays the cost of computing team_type / subcontractor /
  is-confirmed.
- **Fix**: Two paths:
  1. (Quick) Materialize `team_type`, `subcontractor`, `confirmed` onto
     PO Dispatch as denormalized columns, updated via `Rollout Plan` /
     `Work Done` `on_update` hooks.
  2. (Cleaner) Use the joined view only in the PIC Dashboard endpoint;
     drop the joins from `list_pic_rows` since the Tracker doesn't show
     team_type today.

### `_batch_customer_activity_types` runs on every list
- **Where**: `command_center.py` — called by every list_po_dispatches and
  list_work_done_rows.
- **Why**: Looks up Customer Item Master per `(customer, item_code)` pair
  in a row, even if the column is hidden.
- **Fix**: Cache via `frappe.cache().hset("inet_cim_map", ...)` with a
  1-hour TTL; invalidate on Customer Item Master create/update/delete via
  on_change hook.

### `frappe.db.commit()` in per-row loops
- **Where**: `_run_po_archive_import` commits inside the per-PO loop.
- **Why**: Each commit flushes binlog + replication; for 16k rows that's
  16k flushes. Throughput ~2× lower than batched commits.
- **Fix**: Commit every 200 POs (already chunked by `chunk_size` — move
  the commit call to the chunk boundary, not the inner `for po_no in chunk`
  loop).

---

## P2 — Inconsistent UX

### Generic error messages
- **Where**: `pic.py` `_pic_role_or_throw()` says "Not permitted — PIC role
  required." but doesn't list the other roles that ARE permitted.
- **Fix**: Echo the user's actual roles + the required ones.

### Edit popovers don't pre-validate
- **Where**: PIC Tracker edit, IM Team edit (members), PO Upload Standard
  Step 2 confirm.
- **Why**: Users hit Save, wait for the round-trip, then see a 400 error.
- **Fix**: Add a `validate(formData)` step that runs locally before
  `submit()`. Cheap things like "MS1 % + MS2 % ≤ 100", "Applied Date
  not in the future", "Item Code can't be blank when Description is also
  blank". Show inline error states.

---

## P2 — Backend / data quality

### Foreign-key fields stored as Data
- **Where**: `subcon_team` is a Link to INET Team — that's correct. But
  some places in the code (`isdp_ibuy_owner`, `isdp_owner_ms2`) store
  free-text owner names. If owners stabilise into a known list, promote
  to a Link to a new "Huawei Owner Master".
- **Fix**: Defer until owner list is stable; not urgent.

### `_stamp_archive_pic_fields` doesn't recompute everything validate would
- **Where**: archive importer.
- **Why**: It manually computes `ms1_unbilled` / `ms2_unbilled` after
  set_value but skips `region_type`, etc. New derived fields added later
  won't get backfilled.
- **Fix**: Run `frappe.get_doc("PO Dispatch", name); doc.run_method("validate"); doc.db_update()`
  on a periodic basis after archive imports — or add a one-shot
  `bench execute` recompute helper.

---

## Quick wins (do these first)

The highest-impact items still open, each ≤ 1 hour of work:

1. **Add the seven indexes** above. One Frappe patch file. Drops big-list
   response times noticeably.
2. **Ship the FE race fix to the other list pages** (IMPOIntake first, then
   ExecutionMonitor, IMWorkDone). Eliminates the same blank-on-limit-change
   bug we fixed for PIC.
3. **Update `_PIC_FROM_JOIN` to skip the heavy aggregate when the caller
   only needs PIC fields** (Tracker page). Easiest version: have
   `list_pic_rows` accept a `with_team_type=False` flag and switch joins
   off when not needed.

---

## Roadmap (later)

- Owner Master + Link conversion for `isdp_ibuy_owner`.
- Cursor pagination for PO Dump and PIC Tracker (currently offset-based).
- Replace per-page sort dropdowns with the global DataTablePro sort menu
  everywhere (Execution Monitor still has a per-page one).
- Service worker version pinning so PWA users don't load mismatched
  bundle + cached prefs.
