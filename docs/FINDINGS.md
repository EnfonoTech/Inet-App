# INET App — Findings Backlog

Actionable list of bugs, performance work, and enhancement opportunities.
Prioritized by blast radius: **P0** = data loss / corruption, **P1** = wrong
behavior or measurable slowness, **P2** = UX / polish.

Every entry has **Where**, **Why it matters**, and **Fix**.

---

## P0 — Data-integrity gaps

### `dispatch_status` has no state machine
- **Where**: PO Dispatch enum touched from many places (`confirm_po_upload`,
  `_run_po_archive_import`, `mark_subcon_work_done`, `assign_subcon`, etc.).
- **Why**: Nothing prevents `Closed → Pending` or `Completed → Cancelled`.
  Sub-contract flow manages `Sub-Contracted → Completed` by convention only.
- **Fix**: Add a `validate` hook on PO Dispatch with a transition matrix.
  Allow admin override via `flags.allow_status_override = True`.

### `frappe.db.set_value` bypasses validate
- **Where**: `pic.py` `bulk_update_pic_status`; `command_center.py`
  `_stamp_archive_pic_fields`.
- **Why**: Derived columns (`ms1_unbilled`, `ms2_unbilled`) go stale when the
  invoiced amount changes and the validate hook is skipped.
- **Fix**: For bulk PIC status (no monetary fields) the bypass is fine — keep
  it. For the archive importer, manually recompute unbilled amounts after
  `set_value` so reads stay consistent.

---

## P1 — Bugs / fragile logic

### PIC drift after retroactive Work Done changes
- **Where**: `pic.py` `_PIC_INITIAL_RULE_SQL`.
- **Why**: Once the PIC saves, the stored value wins forever. If the IM later
  un-confirms Work Done, the PIC row keeps showing the old status.
- **Fix**: When IM toggles `submission_status` away from `Confirmation Done`,
  also clear / revert `pic_status` on the linked PO Dispatch.

### Race in older list pages (still on `useResetOnRowLimitChange`)
- **Status**: Patched on IMPOIntake, ExecutionMonitor, IMWorkDone, admin
  WorkDone. Remaining pages are low-risk (they don't reset mid-load on row
  limit change). Migrate as pages get touched.

### Many SELECTs miss `has_column` guards
- **Where**: `command_center.py` list projections, `pic.py` SELECT.
- **Why**: A site that pulled code but hasn't run `bench migrate` yet will
  throw `OperationalError 1054`.
- **Fix**: Use the existing `_po_dispatch_col_expr` helper consistently across
  all query sites.

### `frappe.parse_json` without try/except
- **Where**: Several payload-parsing call sites in `command_center.py`.
- **Why**: Truncated payload → `None` → `AttributeError` on `.get()` → 500.
- **Fix**: Wrap each boundary call in try/except; `frappe.throw("Malformed
  payload")` on failure.

### DUID inventory dimension only on `tabStock Entry Detail`, not `tabStock Ledger Entry`
- **Where**: `material_management.py` — any query that tries to use `sle.duid`.
- **Why**: ERPNext Inventory Dimensions are added as columns on `tabStock Entry
  Detail` (and optionally on SLE), but on this installation the DUID dimension
  does NOT exist on `tabStock Ledger Entry`. Querying `sle.duid` raises
  `OperationalError 1054` silently swallowed by try/except, returning empty
  results.
- **Fix** (done): Per-DUID balance uses SE Detail queries only
  (`tabStock Entry Detail`). Do not add SLE queries for DUID unless the
  dimension is confirmed present on `tabStock Ledger Entry`.

### Legacy Material Receipt SEs have wrong DUID column direction
- **Where**: Old Stock Entry Details (Material Receipt) have `duid` (source
  field) populated instead of `to_duid` (target field).
- **Why**: Before the direction fix, the JS auto-fill used the wrong field.
  Those SEs are already submitted and cannot be amended.
- **Fix** (done): `get_duid_stock_summary` uses
  `COALESCE(NULLIF(to_duid,''), NULLIF(duid,''))` for receipt rows so legacy
  data is counted correctly.

### Material Request duplicate check is per-`poid + set_warehouse`
- **Where**: `create_material_request` in `material_management.py`.
- **Why**: If the same POID has two DUIDs or two teams requesting, the second
  request is blocked even if it's legitimately different.
- **Note**: Current behaviour is intentional to prevent re-requesting the same
  materials. If multi-request-per-POID is needed, the duplicate check key
  must be extended (e.g. add `duid`).

### Standard upload still hits `MandatoryError` for some legacy rows
- **Where**: `confirm_po_upload`.
- **Why**: `flags.ignore_mandatory = True` doesn't always propagate to child
  saves before Frappe's validate runs.
- **Fix**: Pass `ignore_mandatory=True` directly to `doc.save(...)`, or stamp
  a placeholder code (`MISC-{poid}`) so mandatory passes naturally.

---

## P1 — Performance

### `_batch_customer_activity_types` runs on every list
- **Where**: `command_center.py` — called by `list_po_dispatches` and
  `list_work_done_rows`.
- **Why**: N+1-style Customer Item Master lookup per `(customer, item_code)`
  pair, even if the column is hidden.
- **Fix**: Cache via `frappe.cache().hset("inet_cim_map", ...)` with 1-hour
  TTL; invalidate on CIM create/update/delete.

### `frappe.db.commit()` in per-row loops
- **Where**: `_run_po_archive_import` commits inside the per-PO loop.
- **Why**: Each commit flushes the binlog — 16k rows = 16k flushes.
- **Fix**: Move the commit to the chunk boundary (every 200 POs), not the
  inner per-row loop.

---

## P2 — UX / polish

### Edit popovers don't pre-validate
- **Where**: PIC Tracker edit, IM Team edit, PO Upload Step 2.
- **Why**: Users hit Save, wait for the round-trip, then see a 400 error.
- **Fix**: Add a local `validate(formData)` step before `submit()`. Cheap
  checks: MS1% + MS2% ≤ 100, Applied Date not in the future, etc.

### Generic error messages
- **Where**: `pic.py` `_pic_role_or_throw()`.
- **Fix**: Echo the user's actual roles + the required ones.

---

## P2 — Data quality

### Foreign-key fields stored as Data
- **Where**: `isdp_ibuy_owner`, `isdp_owner_ms2` store free-text owner names.
- **Fix**: Defer until owner list is stable; promote to a Link to a new
  "Huawei Owner Master" when ready.

### `_stamp_archive_pic_fields` doesn't recompute all derived fields
- **Where**: Archive importer computes `ms1_unbilled` / `ms2_unbilled` after
  `set_value` but skips other derived fields (e.g. `region_type`).
- **Fix**: Run a periodic or one-shot `bench execute` recompute pass, or call
  `doc.run_method("validate"); doc.db_update()` after archive imports.

---

## Roadmap (later)

- Owner Master + Link conversion for `isdp_ibuy_owner`.
- Cursor pagination for PO Dump and PIC Tracker (currently offset-based).
- Replace per-page sort dropdowns with DataTablePro sort menu everywhere.
- Code-split the portal bundle (currently ~1.8 MB — Vite warns chunk > 500 kB).
  Use `React.lazy + Suspense` for page-level components.
- Material Request: consider extending duplicate-check key to include `duid`
  if multi-request-per-POID is ever needed.
- DataTablePro: consider a global `MutationObserver` on the app root as a
  long-term alternative to the `tablepro:check` custom-event pattern, to
  auto-detect new `.data-table-wrapper` elements without requiring each
  tab-switching component to dispatch the event.
