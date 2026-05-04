# INET App — Project Summary

A Frappe v15 + ERPNext custom app that runs the **Huawei telecom-rollout
PMS** end-to-end. Companion docs: [SYSTEM_OVERVIEW.md](SYSTEM_OVERVIEW.md)
(architecture deep-dive), [USER_GUIDE.md](USER_GUIDE.md) (role workflows),
[FINDINGS.md](FINDINGS.md) (known issues).

## What it does

Models the lifecycle of a Huawei PO line from **Excel upload → IM
dispatch → field execution → invoicing (PIC)**. Replaces a spreadsheet-
heavy process with a single-page portal at `/pms/*` that scales across
four roles, with the underlying doctypes editable from the Frappe Desk
for power users.

```
PO Upload (Excel)
   └── PO Intake (+ Lines)            status: OPEN/CLOSED/CANCELLED
        └── PO Dispatch (1-per-line)  Pending → Dispatched → Planned → Completed
             ├── Rollout Plan         (multi-team, multi-visit)
             │    └── Daily Execution (per team, per day)
             │         └── Work Done  (one per plan, aggregates teams)
             └── PIC                  pic_status MS1 / MS2 (invoicing)
```

## Roles & portals

| Role  | Portal              | Primary pages                                  |
|-------|---------------------|------------------------------------------------|
| Admin / PM | `/pms/admin/*` | Command Dashboard, Projects, PO Upload/Dump, Rollout Planning, Execution Monitor, Work Done, Issues & Risks, Reports, Masters |
| IM    | `/pms/im/*`         | IM Dashboard, PO Intake, Dispatch, Planning, Execution, Work Done, Backend, I&R, Teams, Reports, Timesheets |
| Field TL | `/pms/field/*`   | Today's Work, Execution Form, QC/CIAG, Field History, Timesheet |
| PIC   | `/pms/pic/*`        | PIC Dashboard, Invoice Tracker, Reports         |

All under one SPA (React 18 + Vite, PWA-installable).

## Tech stack

- **Backend** — Frappe v15, ERPNext custom doctypes, ~10k-line API at
  [`inet_app/api/command_center.py`](../inet_app/api/command_center.py).
  Whitelisted endpoints + raw SQL for cache-bypass on hot paths.
- **Frontend** — React 18 + Vite SPA, service-worker PWA, builds to
  `inet_app/public/portal/`. Single API client at
  [`frontend/src/services/api.js`](../frontend/src/services/api.js).
- **Data** — MariaDB via Frappe ORM. Custom doctypes in
  [`inet_app/inet_app/doctype/`](../inet_app/inet_app/doctype/) (~30
  doctypes — PO Dispatch, Rollout Plan, Daily Execution, Work Done, INET
  Team, IM Master, PIC Activity Log, etc.).

## Key workflows

**Workflow #1 — Multi-team execution.** A Rollout Plan can split line
qty across 2+ Field Teams via a `teams` child table. Each team gets its
own Daily Execution keyed by `(rollout_plan, team)`; one plan-level Work
Done aggregates them. TL remarks combine into the PO Dispatch with team
prefixing + dedup. QC/CIAG required is per-plan.

**Workflow #2 — Multi-visit per POID.** The same POID can have multiple
sequential visits. Each `Rollout Plan` carries a `visit_number` that
auto-increments. The IM picks "All POIDs (re-plan)" on Rollout Planning
or IM Dispatch to plan the next visit. Duplicate guard blocks an exact
collision on **(POID, plan_date, team, access_period, access_time)**;
override with `force_duplicate=true`. A `DispatchVisitHistory` panel in
every detail modal shows the full visit chain.

**Backend Team workflow.** IM with `can_assign_backend = 1` can dispatch
a POID to a Backend Team (renamed from Sub-Contract). Vendor concept
(Subcontractor Master, subcon_status, etc.) is preserved.

**PIC invoicing.** Per-POID MS1/MS2 milestones, payment-terms parsing,
billing roll-up, CSV exports. Sales Invoice integration is on the
roadmap (custom Accounting Dimensions for POID + Project).

## Notable architectural choices

- `has_column` / `hasattr` guards everywhere — schema can drift between
  dev and prod without breaking the API.
- `frappe.db.set_value` backstop after `doc.insert` — works around
  Document-class meta-cache staleness when columns were added late.
- `after_migrate` hook in [`setup.py`](../inet_app/setup.py) re-syncs
  workspace JSON, ensures custom Item field, drops unused doctypes.
- Property Setters (not source edits) for hiding ERPNext fields.
- Workspace shortcut JSON force-resync (Frappe only re-imports if
  file-mtime > db-mtime).

## Status

Active development against a production-tracking site. Currently three
commits ahead of `origin/main`. Most recent: workflow #2 (multi-visit
+ duplicate guard), preceded by multi-team rollout, Backend rename, and
the `Item.activity_type` migration. Sales Invoice integration is
queued behind the functional-side answers.
