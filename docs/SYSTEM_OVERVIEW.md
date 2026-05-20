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
                  └────┬─────┘  └────────────────────────┘
                       ▼
              ┌──────────────┐
              │ Daily Exec   │  ← material_usage child table
              │ (per visit)  │
              └─────┬────────┘
                    ▼
              ┌──────────┐
              │ Work Done│  → auto-issues materials (Material Issue SE)
              └──────────┘

Material flow (separate chain):
  Huawei Outbound Plan
       ↓ (Material Receipt SE, to_duid = DUID)
  Source Warehouse (INET main)
       ↓ (Material Request → Material Transfer SE, duid = source DUID)
  Team Warehouse (INET Team.warehouse)
       ↓ (Material Issue SE on Work Done, duid = team DUID)
  Consumed
```

## Repository layout

```
apps/inet_app/
├── inet_app/                     ← Frappe app
│   ├── api/
│   │   ├── command_center.py     ← main pipeline API (~10k lines)
│   │   ├── material_management.py← material request / stock / receipt / issue
│   │   ├── pic.py                ← PIC role: list / update / dashboard / reports
│   │   └── project_management.py ← session bootstrap + PM helpers
│   ├── inet_app/doctype/         ← 30+ doctypes
│   │   └── daily_execution_material/ ← child table: item/qty_transferred/qty_used
│   ├── public/
│   │   ├── portal/               ← built Vite output (SPA bundle + service worker)
│   │   └── js/stock_entry.js     ← desk-side DUID auto-fill for Stock Entry
│   ├── hooks.py                  ← role_home_page, fixtures, after_migrate, doc_events
│   └── setup.py                  ← after_migrate: roles, permissions, material setup
├── frontend/                     ← Vite + React 18 SPA
│   ├── src/
│   │   ├── App.jsx               ← role-gated route table
│   │   ├── components/
│   │   │   ├── AppShell.jsx      ← sidebar + role nav
│   │   │   ├── DataTablePro.jsx  ← table chrome (manage cols / sort / filter)
│   │   │   │                       listens for "tablepro:check" custom event
│   │   │   └── …                 ← SearchableSelect, DateRangePicker, etc.
│   │   ├── context/              ← Auth, TableRowLimit
│   │   ├── pages/
│   │   │   ├── admin/            ← PM views
│   │   │   ├── im/               ← IM views (incl. IMMaterialRequest.jsx)
│   │   │   ├── field/            ← Field views (PWA-friendly, incl. FieldMyStock.jsx)
│   │   │   └── pic/              ← PIC views
│   │   ├── services/api.js       ← single fetch wrapper + endpoint helpers
│   │   └── styles/
│   └── vite.config.js            ← PWA registration, scope=/pms/
└── docs/
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
runs the role-resolution priority **PIC → IM → Field → Admin**. `INET Admin`,
`System Manager`, and `Administrator` all map to the admin SPA.

## Central data model

### PO Dispatch (the spine)

Every active POID lives as one row in `PO Dispatch`. It carries:

| Section      | Key fields |
|--------------|-----------|
| Identity     | `name` (system_id), `poid`, `po_no`, `po_line_no`, `item_code`, `qty`, `rate`, `line_amount` |
| Assignment   | `project_code`, `customer`, `im` → IM Master, `dispatch_status` |
| Site         | `site_code` → DUID Master / DUID string |
| Sub-Contract | `subcon_team`, `subcon_status`, `subcon_submission_status` |
| Invoice (PIC)| `pic_status`, `pic_status_ms2`, `ms1_pct`, `ms2_pct`, `ms1_amount`, `ms2_amount` |

`dispatch_status` enum: `Pending → Dispatched → Planned → Completed`,
plus terminals `Sub-Contracted`, `Closed`, `Cancelled`. **No formal state
machine** — see FINDINGS.

### Material flow doctypes

| Doctype | Purpose |
|---------|---------|
| **Huawei Outbound Plan** | Shipment from Huawei; `outbound_status=Received` triggers Material Receipt SE. `du_id` / `duid_master` = site DUID. |
| **Material Request** (ERPNext) | Transfer request from main warehouse → team warehouse. Custom fields: `poid`, `duid`, `im`, `team_warehouse`, `request_status`. |
| **INET Team** | `warehouse` field links the team to its ERPNext warehouse. |
| **Daily Execution Material** | Child table on Daily Execution. Fields: `item_code`, `item_name`, `material_request`, `qty_transferred`, `qty_used`, `uom`. |
| **INET Settings** | `source_warehouse` = main INET warehouse. |

### DUID Inventory Dimension

ERPNext Inventory Dimensions add two columns to `tabStock Entry Detail`:

| Column | Direction | Set when |
|--------|-----------|----------|
| `duid` | Source (from) | Material Transfer (leaving source WH), Material Issue |
| `to_duid` | Target (to) | Material Receipt (arriving at target WH), Material Transfer (arriving at team WH) |

**Critical**: `duid` does NOT exist on `tabStock Ledger Entry` in this
installation. All per-DUID balance queries must use `tabStock Entry Detail`.

Per-DUID balance formula:
```
balance = SUM(SE Detail qty WHERE type=Transfer AND to_duid=X AND t_warehouse=WH)
        - SUM(SE Detail qty WHERE type=Issue    AND duid=X    AND s_warehouse=WH)
```

Legacy SEs (before direction fix) may have `duid` set on receipts instead of
`to_duid`. Queries use `COALESCE(NULLIF(to_duid,''), NULLIF(duid,''))` for
receipts to handle both.

## Major flows

### 1. PO Upload (standard)
1. PM uploads `.xlsx`/`.csv` → `upload_po_file` parses, normalizes, validates.
2. `confirm_po_upload` chunks by `po_no`, creates PO Intake + PO Dispatch rows.
3. `record_po_upload_log` persists the audit trail.

### 2. PO Upload (archive)
`start_po_archive_import` enqueues `_run_po_archive_import` (long queue,
3600s). Reads CLOSED/CANCELLED rows only, creates intake/lines/dispatches
with `dispatch_status='Closed'/'Cancelled'` and stamps PIC payload.

### 3. IM Workflow
```
PO Control → Rollout Planning → Rollout Execution → Work Done
```
- **PO Control**: assign `target_month` to move to planning.
- **Rollout Planning**: create `Rollout Plan` (team, date).
- **Work Done**: `generate_work_done()` auto-issues materials consumed by the
  field team (reads `Daily Execution.material_usage` child table → creates
  Material Issue SE idempotently).

### 4. Material Management Workflow
```
Huawei ships materials (Huawei Outbound Plan, status=Received)
    → IM creates Material Receipt SE (to_duid = DUID)
    → IM creates Material Request (source WH → team WH)
    → IM approves → Material Transfer SE (duid=source, to_duid=team)
    → Field team records qty_used in Daily Execution (material_usage tab)
    → IM generates Work Done → auto Material Issue SE (duid = team DUID)
```

**Portal pages:**
- `/pms/im-material-request` (`IMMaterialRequest.jsx`) — IM view: Requests
  tab (list with filters) + DUID Stock tab (main WH overview, search/filter,
  auto-hides fully-transferred DUIDs).
- `/pms/materials` (`FieldMyStock.jsx`) — Field user's team warehouse stock,
  per-DUID breakdown.
- IMTeams detail panel — stock section per team with per-DUID sources.

**Duplicate guard**: `create_material_request` blocks if an active MR already
exists for the same `poid + set_warehouse`.

**Idempotent auto-issue**: `generate_work_done` checks existing Issue SEs via
`sed.material_request` join before creating new SE.

### 5. Field Workflow (PWA)
- **Today's Work** (`/pms/today`): plans for today.
- **Execute** (`/pms/field-execute/:id`): start/stop timer, capture
  qty/CIAG/QC, photos, material usage (qty_used per item).
- **Materials** (`/pms/materials`): current stock in team's warehouse.

### 6. Sub-Contract flow
No Rollout Plan / Daily Execution / Work Done — `subcon_status` tracks
progress. Subcon completions are unioned into Work Done feed via
`_synthesize_subcon_workdone_rows`.

### 7. PIC (Invoice Controller)
```
Confirmation Done → Under Process to Apply → Under I-BUY/ISDP
    → Ready for Invoice → Commercial Invoice Submitted → Closed
```
MS1 and MS2 each have independent status. Split parsed from Payment Terms.

## API surface

| Module | Highlights |
|--------|-----------|
| `inet_app.api.command_center` | List endpoints (PO Intake Lines, Dispatches, Rollout Plans, Daily Execution, Work Done, Issues & Risks), upload + archive import, masters CRUD, dashboard KPIs, table preferences. |
| `inet_app.api.material_management` | `create_material_request`, `list_material_requests`, `get_material_request`, `approve_material_request`, `get_poid_materials`, `get_team_material_stock`, `get_duid_stock_summary`, `get_duid_received_items`, `create_material_receipt_from_outbound`, `issue_materials_for_work_done`, `get_im_teams`, `get_source_warehouse`, `search_po_dispatches`, `get_poid_details`, `search_items`. |
| `inet_app.api.pic` | `list_pic_rows`, `update_pic_row`, `bulk_update_pic_status`, `get_pic_dashboard`, `get_pic_report`, `list_invoice_tracker_rows`, `create_sales_invoice_from_pic`. |
| `inet_app.api.project_management` | `get_logged_user` (session bootstrap), PM helpers. |

## hooks.py doc_events

```python
doc_events = {
    "Sales Invoice": {
        "on_submit": "inet_app.api.pic.on_sales_invoice_submit"
    },
    "Stock Entry": {
        "before_submit": "inet_app.api.material_management.before_stock_entry_submit",
        "on_submit":     "inet_app.api.material_management.on_stock_entry_submit"
    },
}
```

`before_stock_entry_submit` auto-fills `duid`/`to_duid` on SE Detail rows
from the linked Material Request (or PO Dispatch fallback) based on entry
type:
- Material Receipt → set `to_duid` only
- Material Transfer → set both `duid` (source) and `to_duid` (target)
- Material Issue → set `duid` only

## Frontend conventions

- **DataTablePro** auto-attaches a toolbar (Manage Table, Filters, Reset,
  Sort) to every `<table class="data-table">` inside a `<DataTableWrapper>`.
  Persists per-user prefs via `useTablePreferences`.
  **Tab-switching fix**: When a React tab switch unmounts the whole
  `.data-table-wrapper` subtree, the `.data-table-scroll` MutationObserver
  never fires. The fix: tab-switching components dispatch
  `document.dispatchEvent(new CustomEvent("tablepro:check"))` after 60ms;
  DataTablePro listens and calls `scheduleReinitFromDom()`.
- **`call()` wrapper** in `api.js` handles CSRF, JSON serialization, and
  Frappe error envelope translation.
- **PWA**: scope `/pms/`, `registerType: "autoUpdate"`. `main.jsx` unregisters
  wider-scope SWs and redirects to `/app` if booting outside `/pms`.
- **Standard tab pattern** (IMMaterialRequest, IMTeams): pill tablist
  (`role="tablist"` div), `.toolbar` div for filters, `.page-content` wrapper
  for `<DataTableWrapper>`. Dispatch `tablepro:check` in tab switch.
- **Field pages**: card-based PWA layout using `exec-page`, `history-card`,
  `today-chip` CSS classes. Large inputs (`inputMode="decimal"`) for easy
  touch entry.

## Migrations & deploy

```sh
git pull && bench --site <site> migrate
cd apps/inet_app/frontend && npm run build
bench restart
```

`after_migrate` hook creates roles, ensures material permissions (Stock
Manager role), ensures `Daily Execution Material` child doctype fields. New
schema fields land via doctype JSONs.

## Where to look first

- **List page change**: `frontend/src/pages/<role>/*.jsx` + matching `list_*`
  endpoint in `command_center.py` (or `pic.py` / `material_management.py`).
- **Material flow bug**: `material_management.py` — check the SE Detail query
  for the affected function; remember DUID is on SE Detail not SLE.
- **DUID balance wrong**: Check whether the SE has `duid`/`to_duid` set
  correctly. Legacy SEs may have the wrong column. Inspect via Frappe Desk
  → Stock Entry → Items child table → DUID / Target DUID fields.
- **DataTablePro missing on tab**: The page's tab-switch function must
  dispatch `tablepro:check` after the new content mounts.
- **Add a role**: `setup.py` `_ensure_inet_roles`, `hooks.py` `role_home_page`,
  `get_logged_user`, AppShell `*Nav`, `App.jsx` route gate.
- **Performance bug**: see FINDINGS for index recommendations and N+1 hotspots.
