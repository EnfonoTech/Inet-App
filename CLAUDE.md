# inet_app — working notes for Claude

Site: **inet**. Backend Python under `inet_app/`, SPA frontend under `frontend/` (Vite).

## Frontend build — ALWAYS do this after any frontend change
Many "still not working / still showing old" reports are stale builds.

```bash
cd /home/ramees/frappe-bench/apps/inet_app/frontend && yarn build
cd /home/ramees/frappe-bench && bench --site inet clear-cache && bench --site inet clear-website-cache
```

Tell the user to **hard-refresh (Ctrl+Shift+R)** after every build. Use `yarn dev` only for live local iteration.

## Running a big change and small fixes at the same time

Both belong in one session, done one after the other — not two sessions in this
tree. Two agents editing `apps/inet_app` at once has already cost real work: an
in-flight Team Utilization change was wiped by the other session's reset, and
every commit afterwards needed its diff hunks inspected to avoid taking someone
else's code. If parallel really is needed, give the second agent its own git
worktree so it cannot touch this one.

Interleaving safely:

- **Commit the small fix on its own**, before resuming the big one. Separate
  commits mean reverting the big change never takes the small fixes with it.
- **Check what the big change has open first.** If the small fix touches a file
  the big work has half-edited, finish or park that file before starting.
- **Frontend is the sharp edge.** `yarn build` bundles the whole tree, and the
  built assets are committed — so building for a small fix while big frontend
  work sits unfinished ships that work as compiled output. Either the big work
  is committed first, or the small fix is backend-only, or commit the small fix
  without assets and rebuild once the tree is clean.
- **Backend-only small fixes are always safe to slot in**, since nothing is
  bundled.

## Backend changes
After editing doctypes / custom fields / patches / hooks:
`bench --site inet migrate` (or at least `bench --site inet clear-cache`).

## A feature is not finished when the feature works

**Reports, dashboards and table columns do not follow a change on their own.**
They read the same data through their own queries and their own constants, so a
new field, a new status value or a changed derivation is invisible to them until
each one is edited. This has been missed repeatedly — the feature ships, and the
numbers on the dashboards quietly keep meaning the old thing.

After any change that adds a field, adds a status value, or changes how a figure
is derived, sweep these before calling it done:

- **The report and dashboard endpoints** — 18 of them in `command_center.py`
  alone (`get_*_report` / `get_*_dashboard`: commercial, command, IM
  performance, project profitability/performance, rollout burn-down, top teams,
  PO dispatch status, PO milestone status, weekly performance, revenue tracking,
  revenue forecast, rollout week, rollout forecast, IM dashboard, field team,
  team report), plus PIC's own in `pic.py`.
- **Shared status constants**, which silently exclude anything new:
  `LINE_DONE_STATUSES` in `command_center.py`, the status lists and
  `pic_status_order()` in `pic.py`. A new status value that is not added here
  simply drops out of every report that uses them.
- **Explicit column lists.** List endpoints and export builders name their
  columns one by one — a new field will not appear in a table, a detail modal or
  an Excel export until it is named there too.
- **Frontend filter option lists**, which are often hard-coded copies of a
  Select's options.

Then say in the handover **which reports were updated and which were
deliberately left alone**. "Not updated yet" is a fine answer; silence is not.

---

## Frontend architecture

### Key files
- `frontend/src/services/api.js` — all `pmApi.*` calls; add new endpoints here
- `frontend/src/pages/im/` — IM (Implementation Manager) pages
- `frontend/src/pages/admin/` — PM/admin pages
- `frontend/src/components/` — shared components
- `frontend/src/context/` — AuthContext (role, imName, user), TableRowLimitContext
- `frontend/src/hooks/` — useDebounced, useFilterOptions, etc.

### Shared components — always use these, do not reinvent
| Component | Purpose |
|---|---|
| `DataTableWrapper` | Wraps `.data-table-wrapper > .data-table-scroll`. Pass `loadedCount/filteredCount/filterActive` to attach `TableRowsLimitFooter` automatically |
| `TableRowsLimitFooter` | Row-limit selector footer; use via DataTableWrapper props, not standalone |
| `SearchableSelect` | Dropdown with search; supports `multi`, `onSearch`, `options=[{id,label}]` |
| `DateRangePicker` | `value={{ from, to }}` / `onChange={({from,to})=>...}` |
| `ExportExcelButton` | `filename` + `rows` props |
| `StatusBadge` | **Not actually one global component** — duplicated ad hoc per page, same `{value, bg, fg, bd}` pill shape but no shared color source of truth. See "Status colors" below before adding a new one. |
| `useTableRowLimit` | `const { rowLimit } = useTableRowLimit()` — global row limit |
| `useDebounced` | `const debounced = useDebounced(value, 300)` |
| `useFilterOptions` | `const { options } = useFilterOptions("PO Dispatch", ["project_code"])` |

### Pre-flight checklist: adding a new page or tab
Nearly every historical inet_app UI bug traces back to one of these two causes — check
both before shipping a new page/tab:
1. **React reuses the same `<table>` DOM node across tabs/pages, desyncing
   DataTablePro's enhancement state.** Give each tab a distinct, stable
   `data-table-key`. Never reuse one `data-table-key` across tabs with different
   column sets (desyncs headers from body cells — `77d2f11`). Never gate the `<table>`
   itself on `rows.length` (see "Table structure rules" below).
2. **Client-side filter/limit/tab logic applied *after* an already row-limited fetch
   is wrong.** Push tab/scope/search filters to the backend query — don't fetch once
   at the current row limit and then slice/filter in JS (`8f1451f` swept ~25 pages for
   this exact bug, including "table unmounts to a full loading screen on every
   refetch").

Also check: sort by `creation DESC`, not `modified DESC` (rows must not reorder under
the user when someone edits one — `fc71d14`); **tfoot column totals need one `<td>` per
column, never `colSpan`** — DataTablePro reorders thead/tbody/tfoot cells by their
`data-col-key`, and a merged cell has no single key, so the totals drift out from under
their headers the moment a column is moved (`4bf90af`; swept across all 37 tables with a
totals row). Put the label in its own cell (index 1 when there's a leading checkbox
column, else 0) and emit `<td />` for every other column — see `admin/WorkDone.jsx`. If
the header has conditional columns, the tfoot must repeat the *same* conditions
(`{tab === "my" && <td />}`), or compute the trailing run dynamically the way
`admin/PODispatch.jsx` does with `colCount`. This applies only to `<tfoot>`: a tbody
empty-state row *should* still use `colSpan` to span the table, and plain non
`.data-table` summary tables are unaffected; checkbox `<th>/<td>` needs **no** inline width —
CSS auto-narrows it to 44px, adding a width breaks that (`faf297b`). See "Row-limit
filter", "Status colors", and "Multi-select bulk-action toolbar" further down for the
three other most common new-page gotchas.

### Tab pattern — CRITICAL (wrong structure causes CSS bugs)
Pages with tabs MUST follow the **IMTeams.jsx pattern**:
1. Tab bar — always rendered
2. Toolbar — `{tab === "X" && <div className="toolbar">...</div>}` — conditional, OUTSIDE page-content
3. ONE `<div className="page-content">` — **always rendered**, contains ONE DataTableWrapper
4. Inside DataTableWrapper — switch content by tab with `tab === "X" ? (...) : (...)`

**NEVER** put separate `<div className="page-content"><DataTableWrapper>` blocks inside per-tab conditionals. The CSS uses `:has(.page-content > .data-table-wrapper)` for full-height layout — it must match the same DOM path regardless of which tab is active.

### Table structure rules
- Use `<table className="data-table">` inside DataTableWrapper
- Checkbox-only first column (`<th><input type="checkbox"/></th>`) is auto-narrowed to 44px by CSS — no inline style needed
- `DataTablePro` (global, in AppShell) auto-enhances every `.data-table-wrapper table.data-table` with Manage Table / Filters / Reset / column resize
- Do NOT add `style` width to checkbox `<th>/<td>` — CSS `!important` rule handles it
- For multi-tab pages sharing one DataTableWrapper, use `data-table-key` attribute if you want separate saved column preferences per tab

### Column filters — Excel-style value dropdowns (USE ON EVERY TABLE)

Every one of the app's 47 tables uses this. **A new page or tab must use it too — do not
add a bare substring filter.** Each column header gets a dropdown with a searchable,
multi-select list of the values that column actually holds, plus `(Blanks)` and a
`Contains "…"` option. `DataTablePro` builds the UI; the page only supplies data.

**Two modes, chosen automatically at runtime:**
- **Backend mode** — the page answers `tablepro:request-column-options`. Options cascade
  off that page's own query and the filter covers the whole dataset. Prefer this.
- **Local mode** — nobody answers, so `optionsFromDom()` reads distinct values off the
  rendered rows and the filter carries `local: true`, narrowing in the DOM. Correct only
  for tables that already hold their entire dataset (aggregate rollups, report views).

**Opting a table in** — one attribute, plus opt-outs for non-data columns:
```jsx
<table className="data-table" data-excel-filter-all="1" data-table-key="my-table-v1">
  <th data-excel-filter="0">Actions</th>                  {/* buttons, row numbers */}
  <th data-excel-filter-bucket="month">Target Month</th>  {/* or "day" for dates */}
```

**Wiring a page to backend mode** — three pieces (see `admin/WorkDone.jsx` for the
simplest example, `im/IMPOIntake.jsx` for a multi-table page):
1. A `queryArgsRef` the fetch effect writes the query it actually ran into. On a
   multi-table page make it a map keyed by `data-table-key`.
2. A `tablepro:request-column-options` listener calling
   `pmApi.getColumnFilterOptions({ source, col_key, bucket, search, limit,
   portal_filters, exclude_column })`.
3. A shape-aware active-filter check — a value is either a legacy substring string or
   `{values, blanks, contains}`. `String(obj)` is `"[object Object]"` (always truthy), so
   without this an emptied selection never clears. Mirrors `_column_filter_is_active()`.

**Adding a backend source** (registry: `EXCEL_OPTION_SOURCES` in `command_center.py`):
give the list function an `_options` param and answer from its **own fully-built**
wheres/params — never re-derive the WHERE, or the options and the rows drift apart.
`excel_filter_clause()` applies a filter; `excel_options_from_query()` builds the option
list. ORM-filtered sources use `excel_orm_filter()` / `excel_options_from_orm()` instead.
Modules outside `command_center.py` must import lazily inside the lambda (circular import).

**The rule that breaks most often: the filter must match what the cell RENDERS, not what
the column stores.** Five separate bugs came from this — check the cell, not the header:
- **Link fields** (`im`, `team_id`, `user`, `approver`, `subcontractor`) display a resolved
  name. Use `IFNULL(NULLIF((SELECT <name> FROM <master> WHERE name = <code>), ''),
  IFNULL(<code>,''))`, and grep for hardcoded overrides that bypass the map.
- **Badges that substitute a label for empty** — `PicStatusBadge` renders "Work Not Done",
  `SubPoStatusBadge` "Not Ordered". Wrap with `IF(col = '', '<label>', col)` or the
  dropdown offers `(Blanks)` for cells that visibly read those words.
- **Computed/derived columns** — mirror the derivation (e.g. `_current_plan_subquery`
  matches `get_dispatch_plan_summaries`' "highest visit_number, non-cancelled" rule).
- **Composite cells** — MS1/MS2 show `✓ 1,190.00 · 50% · date`; filter the useful part
  (the percentage), not the whole string.
- **Formatted numbers** — a `decimal(21,9)` CAST yields `992.000000000`.
  `excel_options_from_query` auto-detects an all-numeric list and sorts it numerically
  (SQL `ORDER BY` is lexical: "100" before "70").

**Other traps:**
- Fold `column_filters` into `portal` **before** the skip-refetch `signature` is computed,
  or the guard sees an unchanged signature and never re-fetches.
- Declare `useDebounced`/`useRef` values **above** the `load` callback that lists them in
  its dep array — dep arrays evaluate during render, so a later `const` is a temporal
  dead zone `ReferenceError` that white-screens the page. `yarn build` will NOT catch it.
- All 20+ per-column filter loops across the 6 api files route dicts through
  `excel_filter_clause`; `_sql_like_pattern()` returns None for a dict as a fail-safe.
  If you add a loop, handle dicts or it silently drops the filter.
- Adding a column? Update the empty-state `colSpan` and the `tfoot` (one `<td>` per
  column, no `colSpan` for totals).

### Row-limit filter (`TableRowsLimitFooter` / `useTableRowLimit`)
Presets are **20 / 100 / 500 / 2500 / All** (`TABLE_ROW_LIMIT_PRESETS` in
`TableRowLimitContext.jsx`), stored per-*path* in `sessionStorage` — resets to 20 on
every page reload (deliberate, for fast first paint — don't "fix" this). `rowLimit`
passes straight through as the API's `limit`/`limit_page_length`; `0` means unlimited
(`_portal_row_limit()` in `command_center.py` skips its normal 1..10000 clamp entirely
when the limit is falsy).

**A limit that slices an already-built list is not a limit.** Before wiring the footer to
a table, check the endpoint actually reduces its work — `limit=5` and `All` taking the
same time means it doesn't. Material Management's stock tabs had exactly that. Either push
the limit into the query (DUID Stock: grouping + exclusion + `LIMIT` moved into one SQL,
47ms -> 8ms) or, where the cost is inherent to building the aggregate and a cap cannot
help (Stock Balance is teams x items; Bill Wise explodes every bill), **remove the footer
and load everything** rather than showing a control that does nothing. Also watch for
tabs that hardcode `const args = { limit: 100 }` and never read `useTableRowLimit` — the
selector then silently does nothing.

**"All" on 20k+ rows is a known trouble spot, not a solved problem** — if a new page's
"All" can return many thousands of rows, you need all of the following, not just one:
- Mounting 15k+ `<tr>`s in one React commit freezes the tab. Use `useProgressiveRows`
  (mounts in chunks of 3000 via `requestAnimationFrame`) for any page that can return
  that many rows on "All". It sets `window.__inetTableBulkLoading` so `DataTablePro`
  skips its per-mutation full-table rescan mid-chunk-load (would otherwise be
  O(rows²)) — don't bypass this flag.
- Row virtualization was tried and **reverted** (`PICTracker.jsx`) — it fights
  DataTablePro's `MutationObserver` and rows stop rendering. Don't reintroduce it
  without reworking DataTablePro alongside it.
- Unbounded `IN (...)` clauses crash with `SQLParseError: Maximum number of tokens
  exceeded (10000)` around ~16k names. Chunk any `frappe.get_all(filters=[...
  "in" ...])` built from an unlimited row set into batches of 1000 (see the
  `_chunked()` fix in `77d2f11`).
- Backend joins that build per-row lookup dicts (execution/plan/dispatch maps) are a
  silent-truncation trap if the related-record fetch uses a heuristic cap instead of
  an exact bound. `list_work_done_rows` used to do this (`rel_cap = min(max(len(rows)*4,
  200), 8000)`, fixed 2026-08-10) — on "All" with 2000+ primary rows it would silently
  drop matches past 8000. Since these lookups are always `name in <names>` against a
  primary key, the query can never return more than `len(<names>)` rows anyway — use
  `limit_page_length=len(<names>) + 1`, not an arbitrary cap, whenever you write a new
  one of these joins.
- The 4 expense-claim endpoints (`inet_app/api/expense.py`) used to ignore `rowLimit`
  entirely — every preset (20/100/500/2500/All) issued the same hardcoded `LIMIT
  200`/`LIMIT 500` SQL, so "All" never really meant all (fixed 2026-08-10: `limit=0`
  now removes the cap). Deliberately **not** wired for the other presets — `IMExpense`/
  `FieldExpense`'s tab-count badges (Pending/Unpaid/Paid) are derived client-side from
  that same fetch, so honoring a small limit would silently undercount them. If you add
  a new endpoint like this, decide up front whether "the displayed rows" and "the
  counts shown elsewhere on the page" can share one capped fetch — if not, they need
  two separate queries, not one fetch reused for both.
- The limit is per-*path*, not per-*tab*. If a tabbed page allows "All", guard tab
  switches so they don't silently re-trigger an unlimited fetch on a tab the user
  didn't ask for — see `confirmedAllTabRef` in `PODispatch.jsx` / `IMWorkDone.jsx`.
- Shrinking the limit back down (e.g. All -> 20) after "All" already loaded should
  never need a server round-trip — the rows are already in memory. But don't just
  `.slice()` the array shorter either: React still has to physically unmount however
  many rows that drops, which costs real time proportional to the count regardless
  of how cheap React's own diffing considers the removal — chunking that spreads it
  across frames (avoids freezing) but does not make it fast. For an instant shrink,
  keep every row mounted and hide the ones past the new limit with
  `style={{display: idx >= limit ? "none" : undefined}}` in the `.map()` instead —
  a style change on existing elements, not a removal, so DataTablePro's
  `MutationObserver` (`childList` only) doesn't even see it. See `PICTracker.jsx`
  for the reference implementation (skip-refetch-on-shrink + CSS-hide render +
  updating select-all/footer-count/CSV-export to respect the display limit rather
  than the full cached array length).
- Don't add page-specific special-case logic (e.g. "detect this cheap case and skip
  the normal path") into the shared `useProgressiveRows` hook itself — it's used by
  ~24 pages, so a subtle edge case there breaks all of them at once. An attempt at
  exactly this (a "shrink is just a smaller prefix" fast path) shipped a real bug: an
  empty array is vacuously "a prefix" of anything, which could lock a table's display
  at zero rows. Implement page-specific optimizations (like the CSS-hide pattern
  above) at the page level instead, even if it means a little duplication.

### Status colors
The `StatusBadge` row above is aspirational, not real — there is **no shared
color-map file**. `pic/picShared.jsx` and `im/IMPOIntake.jsx` each hand-roll their own
`dispatchStatusColor()` for the *same* `PO Dispatch.dispatch_status` vocabulary, kept
in sync only by a code comment ("same mapping as..."). Half a dozen other pages
(`IMExpense`, `FieldExpense`, `Projects`, `POUpload`, `IMDashboard`,
`IMMaterialRequest`) each define their own differently-shaped local `StatusBadge`.

**Before adding a status badge on a new page**: grep for the status field's existing
color mapping first (e.g. `dispatch_status`, `plan_status`) and reuse the exact
colors already in use elsewhere — don't invent a new palette for a status that
already has a color convention on another page.

### Multi-select bulk-action toolbar
No shared hook — every page reimplements this locally. Follow the existing pattern
rather than inventing a new one:
- Selection state: `useState(new Set())`, named `selected` (not `selectedRows` —
  `WorkDone.jsx` drifted to that name; stay consistent with the majority in new code).
- Header "select all" checkbox: `checked={rows.length > 0 && rows.every(r =>
  selected.has(r.<key>))}`, plus an `indeterminate` ref-callback when some-but-not-all
  rows are selected.
- `toggleAll` must only select currently **visible** rows — respect DataTablePro's
  active column filters, not the full unfiltered row set (see `toggleAll` in
  `PODispatch.jsx`; this exact bug was swept in `585038c`).
- Toolbar action buttons: `disabled={selected.size === 0}`; once >0, show the count in
  the label, e.g. `` `Dispatch Selected (${selected.size})` ``. When exactly one row
  can be acted on meaningfully, derive a singular `selectedRow` and swap the button
  text (singular vs "(N)") the way `WorkDone.jsx` does.

### CSS — `.toolbar` layout
`.toolbar` is a flex row. Direct children auto-join the row. Put action buttons inside `<div className="toolbar-actions">` to right-align them. The `.toolbar` + `.page-content` CSS chain manages full-height layout automatically.

---

## Traps that have cost real time

Each of these produced a wrong answer or a broken deploy. None is obvious from
reading the code around it.

**Some endpoints commit internally — a rolled-back test did not roll back.**
`generate_work_done`, `dispatch_po_lines` and `create_rollout_plans` call
`frappe.db.commit()` inside their own loops. A test that wraps them and calls
`frappe.db.rollback()` at the end reports success while the data stays changed.
This has silently corrupted dev data twice (a POID rewritten to `-1`, a Work
Done adopted). **After exercising any of these, re-read the rows and check —
never trust the rollback.** Repair explicitly, and snapshot before you start.

**A literal `%` in SQL is a format placeholder whenever params are bound.**
pymysql reads it before MariaDB does, so `LIKE '%foo%'`, `DATE_FORMAT(x,'%Y')`
and `(WEEKDAY(x) + 2) % 7` all need `%%` — *including inside SQL comments*. A
comment warning about `%` broke the query it was warning about. Better still,
pass the pattern as a parameter (`LIKE %s` with `'%foo%'` in the tuple) and the
problem disappears.

**`@frappe.whitelist()` must sit immediately above its function.** Inserting a
helper between the decorator and the `def` rebinds the decorator to the helper:
the endpoint stops being callable and a private helper becomes a public API.
It fails **only over HTTP** — calling the function directly in a console or
test works perfectly, so in-process verification will not catch it. After
touching anything near a decorator, check `frappe.whitelisted` or hit the
endpoint.

**Code that reads a field the app never ships.** Three outages so far
(`Sales Invoice Item.milestone`, `Rollout Plan.qc_required` / `ciag_required`,
`DUID Master.site_id`): a field created by hand on one site, code written
against it, every other site 500s on "Unknown column". `inet_app/schema_check.py`
reports this at the end of every `after_migrate`; run it directly with
`bench --site <site> execute inet_app.schema_check.run`. **A field belongs in
the doctype JSON, or in `setup.py` when it lives on another app's doctype.**

**Frappe stamps child rows with the PARENT's `creation`.** Every row of a child
table shares the parent document's timestamp — verified across all 9,956 PO
Intakes. So a child row's `creation` is *not* when that row arrived, and a line
appended to an existing parent months later is indistinguishable from the
original ones. If you need a per-row arrival time, store it (see
`PO Intake Line.po_upload_date`).

**Single-column indexes added by `ALTER TABLE` are dropped by the next
migrate.** Frappe's schema sync removes any single-column index whose doctype
field lacks `search_index`. Declare them in the doctype JSON instead; only
compound indexes survive as a patch.

**Frappe's `like` does not honour the backslash escape.** `["like", "inet\_%"]`
matches nothing, and unescaped `inet_%` leans on `_` being a wildcard. Filter on
`dt` + `module` and match the prefix in Python.

**`yarn build` bundles the whole working tree.** The built portal assets are
committed, so building while unfinished work sits in the tree commits that work
as compiled output. Before building, either commit or make sure the tree holds
only what you intend to ship.

---

## Domain rules that are easy to get wrong

**The working week is Saturday to Friday.** KSA; Friday is the holiday. One
anchor per language, and they must not drift apart: `_week_start()` /
`_week_start_sql()` in `command_center.py`, `weekStartOfLocal()` in
`frontend/src/utils/weeks.js`. MariaDB has no Saturday `YEARWEEK` mode, so weekly
grouping is date arithmetic, not `YEARWEEK`.

**Never `toISOString()` a locally-built Date.** It converts to UTC first, so in
Riyadh local midnight serialises as the previous day. Format from local parts —
`isoLocal()` in `weeks.js`.

**A visit can take several plans; a line has one Work Done.** Work that needs two
dates, or two teams on two dates, is still one visit: those plans are companions
and share the visit number. Only `Re-Visit` and `Extra Visit` advance it. Work
Done cannot be recorded until *every* non-cancelled plan of that visit has a
completed execution with QC settled, and it anchors to the visit's last completed
execution.

**A line is closed by the rollout OR by a shortcut, never both.** Direct Close and
Backend record the Work Done immediately. A line with a shortcut Work Done cannot
be planned, forecast or dispatched; a line with a live plan or a forecast week
cannot be direct-closed or sent to backend. Adoption (`adopt_existing`) is the one
supported crossing, and it moves the existing record rather than creating a second.

**Cancelled is terminal for a plan.** Nothing un-cancels one; a re-attempt gets a
new plan. `_sync_rollout_plan_from_daily_execution` must never write a status onto
a cancelled plan — it used to, which resurrected plans a PM had cancelled.

**Billing status is derived from PIC, not stored.** `list_work_done_rows` reads
`PO Dispatch.pic_status`: Closed/Canceled -> Closed; Submitted / Ready for Invoice
/ Under I-BUY / Under ISDP -> Invoiced; anything else PIC touched -> Pending.

**Cost and margin on Work Done are not real per-line figures.** `team_cost_sar` is
a team's whole DAILY cost charged to each POID it touched that day, so
`total_cost_sar` and `margin_sar` built on it are meaningless per line. The app
already hides them (ProjectDetail dropped its Cost/Margin columns; the Work Done
detail modal hides both). **Do not build reporting on them and do not "fix" them
by spreading them wider.**

**IM scoping reads the `im` stamped on the record** (`Rollout Plan.im`,
`Daily Execution.im`, `PO Dispatch.im`), which is historical — never
`INET Team.im`, which is the team's *current* manager and would move a team's
whole back-catalogue the moment it is reassigned. Team reports must not filter
teams by status: a team on leave this week still did last month's work.

**Bulk jobs and per-row hooks.** A doctype hook that notifies a role fires once
per row and writes one document per recipient. On a 5,500-row import that was 45
minutes of a 60-minute job (measured: 494ms/row vs 3ms with the hook muted).
Before adding an import loop, check what its inserts trigger.

---

## Backend architecture

### Main API file
`inet_app/api/command_center.py` — nearly all portal APIs live here. Functions are `@frappe.whitelist()`. Keep them here unless there's a clear reason to split.

### Key doctypes
| Doctype | Purpose |
|---|---|
| `PO Dispatch` | Core POID record. Fields: `poid`, `po_no`, `project_code`, `site_code` (DUID), `im`, `line_amount`, `dispatch_status`, `is_dummy_po`, `was_dummy_po`, `original_dummy_poid` |
| `Rollout Plan` | Plan for executing a POID. Links to PO Dispatch via `po_dispatch`. Fields: `plan_date`, `plan_status`, `team`, `visit_number`, `completion_pct` |
| `Daily Execution` | TL execution record. Links to Rollout Plan via `rollout_plan` |
| `Work Done` | Revenue record. Links to PO Dispatch DIRECTLY via `system_id` (NOT via Rollout Plan) |
| `INET Team` | Team record. `team_name` is display name |
| `Project Control Center` | Project. `project_code`, `implementation_manager` |

### Work Done ↔ PO Dispatch link
`Work Done.system_id` = PO Dispatch name. There is NO `Work Done.rollout_plan` field. Any SQL touching Work Done revenue must join via `wd.system_id = pd.name`.

### Patches
- File: `inet_app/patches/` directory
- Register in: `inet_app/inet_app/patches.txt` under `[post_model_sync]`
- If a patch ran but failed (Frappe marked it executed), re-run directly:
  `bench --site inet execute "inet_app.patches.<module>.execute"`

### dummy_preset values for list_po_dispatches
| Value | Meaning |
|---|---|
| `"dummy"` | Open dummy POs (is_dummy_po=1) |
| `"mapped_dummy"` | Mapped dummies (was_dummy_po=1) |
| `"dummy_any"` | Both open and mapped dummies |
| `"standard"` | Non-dummy only |
| `"all"` | Everything |

### Bulk API pattern
When a page needs per-row related data (e.g., rollout plan per POID), always write a BULK endpoint that takes a list and returns a dict keyed by name. Never call a single-record API N times in a loop from the frontend.

Example: `get_dispatch_plan_summaries(po_dispatches)` → `{ "POID-1": {...}, "POID-2": {...} }`

---

## Product context
See `sites/client requirement for inet.md` and `sites/inet_pms_development_update.md`.

### Page → file mapping
| Client term | JSX file | Route |
|---|---|---|
| PO Control | `IMPOIntake.jsx` | `/im-po-intake` |
| IM Dispatch / Rollout Planning | `IMDispatch.jsx` | `/im-dispatch` |
| Rollout Execution | `IMPlanning.jsx` | `/im-planning` |
| Rollout Work Done | `IMExecution.jsx` | `/im-execution` |
| Work Done | `IMWorkDone.jsx` | `/im-workdone` |
| Admin Teams | `admin/Teams.jsx` | `/admin-teams` |

### Roles
- **IM** (Implementation Manager) — manages POIDs, plans, teams
- **PM** (Project Manager / admin) — oversight, approvals, admin pages
- Role is from `useAuth().role`
