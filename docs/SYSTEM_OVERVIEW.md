# INET App — System Overview

End-to-end map of what's in the codebase as of this writing. Pair with
[USER_GUIDE.md](USER_GUIDE.md) for role-by-role workflows and
[FINDINGS.md](FINDINGS.md) for known bugs / performance work.

## At a glance

A Frappe v15 + ERPNext custom telecom-rollout PMS. Models the lifecycle of a
Huawei PO line all the way from upload → dispatch → field execution →
sub-contract or invoicing. Four portal roles (Admin / IM / Field / PIC) live
under one SPA at `/pms/*`; the underlying doctypes are also editable from the
Frappe Desk for power users.

```
                        ┌────────────────────┐
                        │  PO Upload (Excel) │
                        └──────────┬─────────┘
                                   ▼
                          ┌───────────────┐
                          │   PO Intake   │  (status: OPEN/CLOSED/CANCELLED)
                          │ + PO Intake   │
                          │   Lines       │
                          └────────┬──────┘
                                   ▼ 1-1 per line
                          ┌───────────────────┐
                          │   PO Dispatch     │  ← every active line lives here
                          │   (system_id +    │     (Pending → Dispatched →
                          │   poid)           │      Planned → Completed)
                          └─────┬─────┬───────┘
                                │     │
                  IM rollout    │     │  PIC invoicing
                                ▼     ▼
                  ┌──────────┐  ┌────────────────────────┐
                  │ Rollout  │  │ pic_status (MS1)       │
                  │  Plan    │  │ pic_status_ms2 (MS2)   │
                  └────┬─────┘  │ + amounts / dates /    │
                       ▼        │   owners / unbilled    │
              ┌──────────────┐  └────────────────────────┘
              │ Daily Exec   │
              │ (per visit)  │
              └─────┬────────┘
                    ▼
              ┌──────────┐
              │ Work Done│  (submission_status drives PIC initial state)
              └──────────┘
```

## Repository layout

```
apps/inet_app/
├── inet_app/                     ← Frappe app
│   ├── api/
│   │   ├── command_center.py     ← ~9k-line monolithic API surface
│   │   ├── pic.py                ← PIC role: list / update / dashboard / reports
│   │   └── project_management.py ← session bootstrap + a few PM-side helpers
│   ├── inet_app/doctype/         ← 30+ doctypes (PO Dispatch is the spine)
│   ├── www/
│   │   └── pms.html              ← Frappe template that hosts the SPA
│   ├── public/portal/            ← built Vite output (SPA bundle + service worker)
│   ├── hooks.py                  ← role_home_page, fixtures, after_migrate
│   └── setup.py                  ← `_ensure_inet_roles()` etc.
├── frontend/                     ← Vite + React 18 SPA
│   ├── src/
│   │   ├── App.jsx               ← role-gated route table
│   │   ├── components/
│   │   │   ├── AppShell.jsx      ← sidebar + role nav
│   │   │   ├── DataTablePro.jsx  ← table chrome (manage cols / sort / filter)
│   │   │   └── …                 ← SearchableSelect, DateRangePicker, etc.
│   │   ├── context/              ← Auth, TableRowLimit
│   │   ├── pages/
│   │   │   ├── admin/            ← PM views
│   │   │   ├── im/               ← IM views
│   │   │   ├── field/            ← Field views (PWA-friendly)
│   │   │   └── pic/              ← PIC views (new)
│   │   ├── services/api.js       ← single fetch wrapper + endpoint helpers
│   │   └── styles/
│   └── vite.config.js            ← PWA registration, scope=/pms/
└── docs/
    ├── USER_GUIDE.md             ← role-by-role how-to
    ├── SYSTEM_OVERVIEW.md        ← this doc
    └── FINDINGS.md               ← bugs / perf / enhancement backlog
```

## Roles & login

`role_home_page` in [hooks.py](../inet_app/hooks.py) maps Frappe roles to the
SPA landing path:

| Frappe role        | App role string | Lands on            |
|--------------------|-----------------|---------------------|
| `INET Admin`       | `admin`         | `/pms/dashboard`    |
| `INET IM`          | `im`            | `/pms/im-dashboard` |
| `INET Field Team`  | `field`         | `/pms/today`        |
| `INET PIC`         | `pic`           | `/pms/pic-dashboard`|

`get_logged_user` ([api/project_management.py](../inet_app/api/project_management.py))
runs the role-resolution priority **PIC → IM → Field → Admin**, so a user
with multiple INET roles gets the most specific UI. `INET Admin`,
`System Manager`, and `Administrator` all map to the admin SPA.

Roles are created idempotently on `bench migrate` via
[setup.py](../inet_app/setup.py)'s `_ensure_inet_roles()` hook.

## Central data model

### PO Dispatch (the spine)

Every active POID lives as one row in `PO Dispatch`. It carries:

| Section          | Key fields                                                                                                        |
|------------------|-------------------------------------------------------------------------------------------------------------------|
| Identity         | `name` (system_id, `SYS-YYYY-#####`), `poid`, `po_no`, `po_line_no`, `item_code`, `item_description`, `qty`, `rate`, `line_amount`, `tax_rate`, `payment_terms`, `project_domain` |
| Assignment       | `project_code` → Project Control Center, `customer`, `im` → IM Master, `target_month`, `dispatch_status`, `dispatch_mode` |
| Site             | `center_area`, `region_type`, `site_code` → DUID Master, `site_name`                                              |
| Remarks          | `general_remark` (PM), `manager_remark` (IM), `team_lead_remark` (Field)                                          |
| Sub-Contract     | `subcon_team`, `subcon_status`, `subcon_completed_on`, `subcon_remark`, `subcon_submission_status`                 |
| Invoice (PIC)    | `payment_terms`, `ms1_pct`, `ms2_pct`, `ms1_amount`, `ms2_amount`, `pic_status`, `isdp_ibuy_owner`, `pic_detail_remark`, `ms1_applied_date`, `ms1_invoiced`, `ms1_unbilled`, `subcon_pct_ms1`, `inet_pct_ms1`, `ms1_invoice_month`, `ms1_ibuy_inv_date`, `ms1_payment_received_date`, mirrored MS2 set, `remaining_milestone_pct`, `sqc_status`, `pat_status`, `im_rejection_remark` |
| Dummy lifecycle  | `is_dummy_po`, `was_dummy_po`, `original_dummy_poid`, `dummy_note`                                                |

Validate hook ([po_dispatch.py](../inet_app/inet_app/doctype/po_dispatch/po_dispatch.py))
parses Payment Terms via `parse_payment_terms_pcts()` (handles all 10
master-tracker patterns including the `ã€TTã€‘` mojibake variant), stamps
`ms1_pct/ms2_pct` only when at default, then derives `ms1_amount`,
`ms2_amount`, `ms1_unbilled`, `ms2_unbilled` from `line_amount × pct`.

`dispatch_status` enum: `Pending → Dispatched → Planned → Completed`,
plus terminals `Sub-Contracted`, `Closed`, `Cancelled`. There is
**no formal state machine** — see FINDINGS for the gap.

### Adjacent doctypes

- **PO Intake / PO Intake Line**: parents the dispatch rows. The line carries
  the original Excel cells (qty, rate, payment terms…) and `po_line_status`
  (mirror of dispatch status, used by the PM "Pending Dispatch" tab).
- **Rollout Plan**: per-visit plan; `po_dispatch` link, `team`, `plan_date`,
  `visit_type`, `visit_number`, `plan_status`. One PO Dispatch can have
  multiple plans (re-visits).
- **Daily Execution**: the field team's check-in for a plan visit;
  `execution_date`, `execution_status`, `qc_status`, `ciag_status`,
  `tl_status`, photos.
- **Work Done**: created when execution is Completed; `submission_status`
  (Ready for Confirmation / Confirmation Done) hands off to PIC.
- **INET Team / IM Master / Subcontractor Master**: org graph.
  `team_category` (Field Team / Sub-Contract Team) gates which teams the
  rollout plan picker shows. `Subcontractor Master.sub_payout_pct` and
  `inet_margin_pct` feed the PIC's INET-vs-Subcon split.
- **Project Control Center**: project metadata + monthly target; doctype with
  multiple child tables (team, materials, tasks, documents).
- **DUID Master**: site directory (latitude/longitude, area). The
  `area` link → **Area Master** drives the dashboard's "Location" labels.
- **PO Upload Log / PO Upload Log Detail**: audit history of standard +
  archive uploads. Carries `lines_skipped_terminal`, `lines_skipped_closed`,
  `lines_skipped_cancelled`, and a JSON `terminal_dupe_samples` so users see
  why duplicates didn't refresh.

## Major flows

### 1. PO Upload (standard)

1. PM uploads `.xlsx` / `.csv` from `/pms/po-upload` → **Step 1: Upload**.
2. `upload_po_file` parses, normalizes columns by alias, validates row-by-row
   (qty > 0, rate > 0, item_code resolvable). Rows with `PO Status = CLOSED
   or CANCELLED` are pushed to `error_rows` with the message *"use the Archive
   tab"* — only OPEN rows reach Step 2.
3. **Step 2: Review** shows valid + error rows; user clicks Confirm.
4. `confirm_po_upload` chunks rows by `po_no`, ensures masters
   (Project Control Center, Item, Customer Item Master, DUID Master), then
   for each PO group either creates a new `PO Intake` doc or appends to the
   existing one. After save, every new line gets a `PO Dispatch` row via
   `_upsert_po_dispatch_for_line` with `dispatch_status='Pending'`. If a row
   has a blank or `NA` item_code, `_resolve_item_code_with_fallback` swaps in
   the description (truncated to 140 chars). `flags.ignore_mandatory=True` on
   save lets legacy edge-cases through.
5. **Step 3: Summary** shows lines imported / skipped / new POs + a
   per-PO breakdown. Skipped duplicates are split into Closed vs Cancelled
   buckets so users can see why a row didn't refresh.
6. `record_po_upload_log` persists everything to **PO Upload Log** with the
   source file attached.

### 2. PO Upload (archive)

For backfilling closed/cancelled history from the Master Tracker. Same page,
separate Archive section.

1. `preview_po_archive_file` quickly scans the file (xlsb / xlsx / csv, with
   `pyxlsb` for binary), reports counts (CLOSED / CANCELLED / OPEN / OTHER),
   missing UOMs, missing Items, missing Projects, and projects without
   customer.
2. `start_po_archive_import` enqueues `_run_po_archive_import` on the `long`
   queue (3600s timeout) and creates a `PO Upload Log` doc to poll.
3. The worker reads only CLOSED + CANCELLED rows, resolves customer per-row
   from `Project Control Center.customer`, batch-creates intake + lines +
   dispatches with `dispatch_status='Closed' / 'Cancelled'`, **and stamps
   the rich PIC payload** (PIC Remarks, ISDP/I-Buy Owner, MS1/MS2 amounts,
   invoicing dates, subcon%/inet%) onto each dispatch via
   `frappe.db.set_value`. No auto-dispatch — these stay out of the workflow.
4. FE polls `get_po_archive_import_status(log_name)` every ~3s and displays
   progress + final summary.

### 3. IM Workflow

```
PO Control (intake) → Rollout Planning → Rollout Execution → Rollout Work Done
                                                              ↓
                                                            Subcon
```

- **PO Control** (`/pms/im-po-intake`): lines awaiting target_month assignment.
  Multi-select to set target_month (move to "Rollout Planning") or, if the IM
  has `can_subcon=1`, sub-contract to a non-field team via the Sub-Contract
  flow. Closed / Cancelled / Sub-Contracted / Completed lines are filtered out.
- **Rollout Planning** (`/pms/im-dispatch`): create a `Rollout Plan` (visit_type,
  date, team, manager_remark). Already-planned lines are hidden except
  unmapped Dummy POs.
- **Rollout Execution** (`/pms/im-planning`): list of planned rollouts;
  Daily Execution rows from the field show up here.
- **Rollout Work Done** (`/pms/im-execution`): execution-monitor view of the
  IM's lines; QC / CIAG / Execution Status visible.
- **Work Done** (`/pms/im-work-done`): Work Done docs for the IM. Submission
  status (`Ready for Confirmation` / `Confirmation Done`) hands the line off
  to PIC. Also shows the PIC-rolled-up billing pill with the raw PIC status
  as a tooltip.

### 4. Field Workflow (PWA-friendly)

- **Today's Work** (`/pms/today`): plans assigned to the field user's team
  for today.
- **Execute** (`/pms/field-execute/:id`): start/stop timer, capture
  qty/CIAG/QC, upload photos.
- **QC / CIAG**, **History**, **Time log**: role-scoped slices of the
  Daily Execution data.

The PWA scope is `/pms/` (vite.config.js) and `registerType: "autoUpdate"` so
older wider-scope service workers get replaced silently.

### 5. Sub-Contract flow

Lives entirely outside the rollout chain — no Rollout Plan / Daily Execution /
Work Done created. Each subcon dispatch carries its own `subcon_status`
(Pending / Work Done) and a `subcon_submission_status` field that mirrors
PIC's submission concept for subcon work. The IM's PO Control list excludes
`dispatch_status='Sub-Contracted'`, and the dedicated
`/pms/im-subcon` page lists pending subcon items with bulk Mark Work Done.
Subcon completions are unioned into the Work Done feed via
`_synthesize_subcon_workdone_rows` so revenue dashboards reflect them.

### 6. PIC (Invoice Controller)

```
IM marks Work Done.submission_status = "Confirmation Done"
                              ↓
              PIC sees POID as "Under Process to Apply"
                              ↓
              Under I-BUY / Under ISDP  → Rejected back to IM
                              ↓
                    Ready for Invoice
                              ↓
                Commercial Invoice Submitted
                              ↓
                Commercial Invoice Closed       (terminal)
```

11-value `pic_status` enum drives the dashboard buckets. The MS1/MS2 split
(parsed from Payment Terms) decides how `line_amount` divides into 1st and
2nd payment amounts. PIC has its own pages:

- **PIC Dashboard** (`/pms/pic-dashboard`) — gradient hero with KPIs +
  closed-vs-pipeline progress bar, flat acceptance pipeline table mirroring
  the Cash Flow Summary spreadsheet, monthly invoicing roll-up,
  INET-vs-Subcon split, pending I-BUY / ISDP owner tables. Auto-refreshes
  every 5 minutes. Date range scopes only the time-series panels (monthly /
  pending owners) — buckets and KPIs always show full pipeline.
- **PIC Tracker** (`/pms/pic-tracker`) — full POID list with multi-select,
  bulk status change, per-row edit popover (gradient hero + 3 status-chip
  tabs MS1/MS2/Acceptance + sticky save footer). Totals tfoot stays aligned
  with columns through Manage Table reorder/hide.
- **PIC Reports** (`/pms/pic-reports`) — five canned reports (pipeline /
  monthly / aging / closed / rejected) with adaptive filters and CSV
  download.

The PIC's status is the source of truth for billing — `list_work_done_rows`
rolls `pic_status` (11 values) up to the legacy 3-bucket `billing_status`
(Pending / Invoiced / Closed) for PM and IM Work Done views, and the SQL
filter uses the same `CASE` expression so picking "Closed" actually filters
on PIC's "Commercial Invoice Closed". The raw PIC status appears as a
tooltip on the billing pill.

## API surface

All RPC endpoints are whitelisted Python functions. The FE talks to them via
the single `call()` wrapper in [services/api.js](../frontend/src/services/api.js).

| Module                          | Highlights |
|---------------------------------|------------|
| `inet_app.api.command_center`   | List endpoints (PO Intake Lines, PO Dispatches, Rollout Plans, Daily Execution, Work Done, Issues & Risks, Execution Monitor), upload + archive import, masters CRUD via `genericList`/`genericCount`, dashboard KPIs, table preferences. |
| `inet_app.api.pic`              | `list_pic_rows`, `update_pic_row`, `bulk_update_pic_status`, `get_pic_dashboard`, `get_pic_report`, `get_pic_capability`. Initial-state rule via `_PIC_INITIAL_RULE_SQL`. |
| `inet_app.api.project_management`| `get_logged_user` (session bootstrap with role resolution), a few PM helpers. |

## Frontend conventions

- **DataTablePro** ([components/DataTablePro.jsx](../frontend/src/components/DataTablePro.jsx))
  is a single global component that auto-attaches a toolbar (Manage Table,
  Filters, Reset, Sort) to every `<table class="data-table">` inside a
  `<DataTableWrapper>`. It persists per-user prefs (column order, hidden,
  frozen, widths, filters, sort) via `useTablePreferences`. Stale prefs that
  no longer match a current column are filtered out automatically.
- **Cancellation guards** were added to PIC Tracker: `useEffect` returns a
  `cancelled` flag in cleanup so a slow earlier fetch can't overwrite a
  fast newer one when the row limit / filters change. Other list pages
  still use the older `useResetOnRowLimitChange` pattern (see FINDINGS).
- **`call()` wrapper** in `api.js` handles CSRF token refresh, JSON
  serialization of array payloads, and translates Frappe's error envelope.
- **PWA**: scope `/pms/`, `registerType: "autoUpdate"`. `main.jsx` has a
  defensive guard that unregisters wider-scope SWs and redirects to `/app`
  if the bundle ever boots outside `/pms`.

## Migrations & deploy

```sh
git pull && bench --site <site> migrate
cd apps/inet_app/frontend && npm run build
bench restart      # picks up worker-loaded code (frappe.enqueue)
```

The `after_migrate` hook (setup.py) creates roles idempotently. `fixtures` in
hooks.py exports Custom Fields and the four INET roles. New schema fields
land via the doctype JSONs; back-fill scripts live in `/tmp` (see commit
notes — `payment_terms` MS1/MS2 backfill, POID `.0` cleanup, etc.).

## Background jobs

- `_run_po_archive_import` (long queue, 3600s timeout) — large archive
  imports.
- Frappe's standard scheduler — used by ERPNext but the app doesn't add its
  own scheduled events as of this writing.

## Where to look first

- **Need to change a list page**: the page file under `frontend/src/pages/<role>/`
  + the matching `list_*` endpoint in `command_center.py` (or `pic.py`).
- **Need to add a column**: doctype JSON + the `pd_fields_wd` style projection
  list in the relevant endpoint + the FE column header / cell.
- **Need to add a role**: setup.py `_ensure_inet_roles`, hooks.py
  `role_home_page`, `get_logged_user`, AppShell `*Nav`, App.jsx route gate.
- **Performance bug**: see FINDINGS for the index recommendations and the
  N+1 hotspots already identified.
