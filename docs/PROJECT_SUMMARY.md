# INET App — Project Summary

A **Frappe v15 + ERPNext** custom app that powers the **Huawei Telecom Rollout Project Management System (PMS)** end-to-end. It replaces a spreadsheet-heavy manual process with a single-page portal at `/pms/*` that scales across four roles, with underlying doctypes editable from the Frappe Desk for power users.

---

## 📋 Overview

**App Name:** `inet_app`  
**Publisher:** enfono (ramees@enfono.com)  
**License:** MIT  
**Version:** 0.0.1  
**Python:** 3.10+  
**Frontend:** React 18 + Vite (SPA, PWA-installable)

The app models the lifecycle of a Huawei PO line from **Excel upload → IM dispatch → field execution → invoicing (PIC)**.

---

## 🏗️ Architecture

### Core Pipeline

```
PO Upload (Excel)
   └── PO Intake (+ Lines)            status: OPEN/CLOSED/CANCELLED
        └── PO Dispatch (1-per-line)  Pending → Dispatched → Planned → Completed
             ├── Rollout Plan         (multi-team, multi-visit)
             │    └── Daily Execution (per team, per day)
             │         └── Work Done  (one per plan, aggregates teams)
             └── PIC                  pic_status MS1 / MS2 (invoicing)
```

### Custom Doctypes (~30)

| Doctype | Purpose |
|---------|---------|
| **Project Control Center** | Extends standard Project with INET-specific fields (project_code, domain, IM, budget, actual_cost, etc.) |
| **PO Intake / PO Intake Line** | Captures uploaded PO data from Excel with line-level details |
| **PO Dispatch** | One-per-line dispatch record carrying POID, IM, site, PIC status, MS1/MS2 amounts |
| **Rollout Plan** | Multi-team, multi-visit execution plan linked to a PO Dispatch |
| **Rollout Plan Team** | Child table for splitting line qty across 2+ Field Teams |
| **Daily Execution** | Per-team, per-day execution record |
| **Work Done** | Plan-level aggregation of execution; feeds into PIC pipeline |
| **Daily Work Update / Daily Work Update Task** | Field team daily progress tracking with photos, GPS, approval workflow |
| **Team Assignment** | Tracks team assignments to projects with utilization |
| **INET Team / INET Team Member** | Team master with IM, field_user, team_type, subcontractor linkage |
| **IM Master** | Implementation Manager master with cost rates |
| **PIC Activity Log** | Audit trail for PIC bulk status updates |
| **Execution Time Log** | Field work time tracking on rollout (not ERPNext Timesheet) |
| **Customer Item Master** | Customer-specific item rates (standard_rate_sar, hard_rate_sar) |
| **Activity Cost Master** | Activity codes with base costs and billing types |
| **Subcontractor Master / Subcontract Cost Master** | Vendor management with margin/payout percentages |
| **Area Master** | Geographic area definitions |
| **DUID Master** | Site code master |
| **Field Remark Template** | Predefined remarks for field team use |
| **Visit Multiplier Master** | Visit type multipliers for cost calculations |
| **KPI Slab Master / Project KPI Slab** | KPI configuration |
| **Team Allocation Request** | IM-to-IM team transfer with PM approval workflow |
| **PO Upload Log / PO Upload Log Detail** | Audit trail for PO file imports |
| **Project Domain** | Domain classification for projects |
| **Activity Category** | Activity categorization |
| **Customer Activity Type** | Customer-specific activity types |
| **Huawei IM** | Huawei IM contact master |

### Reports (4 Custom)

| Report | Type | Description |
|--------|------|-------------|
| Project Status Summary | Script Report | Overview of all projects with status breakdown |
| Budget vs Actual by Project | Query Report | Budget vs actual cost comparison per project |
| Team Utilization Report | Script Report | Team workload and utilization metrics |
| Daily Work Progress Report | Query Report | Daily work update aggregation |

### Dashboard

- **Project Management Dashboard** — KPI cards (total/active/at-risk projects, budget utilization), charts (status pie, budget vs actual bar, domain distribution donut, completion timeline)
- **PIC Dashboard** — Invoicing KPIs, bucket counts, monthly roll-up, INET vs Subcon split, pending I-BUY/ISDP approvals
- **IM Dashboard** — Per-IM operational snapshot
- **Field Team Dashboard** — Per-team actionable plans and execution status

---

## 👥 Roles & Portals

| Role | Portal Path | Primary Pages |
|------|-------------|---------------|
| **Admin / PM** | `/pms/admin/*` | Command Dashboard, Projects, PO Upload/Dump, Rollout Planning, Execution Monitor, Work Done, Issues & Risks, Reports, Masters, Approvals, Timesheets, Operations Overview |
| **IM** | `/pms/im/*` | IM Dashboard, PO Intake, Dispatch, Planning, Execution, Work Done, Backend, Issues & Risks, Teams, Reports, Timesheets |
| **Field Team** | `/pms/field/*` | Today's Work, Execution Form, QC/CIAG, Field History, Timesheet |
| **PIC** | `/pms/pic/*` | PIC Dashboard, Invoice Tracker, Reports |

All under one **React 18 SPA** (Vite-built, PWA-installable with service worker).

---

## 🔧 Tech Stack

### Backend
- **Framework:** Frappe v15
- **ERPNext:** Standard modules (Stock, Accounts, HR, etc.)
- **API Layer:** ~10k-line API at `inet_app/api/command_center.py` — whitelisted endpoints + raw SQL for cache-bypass on hot paths
- **Additional APIs:** `project_management.py` (CRUD), `pic.py` (invoicing), `data_import.py` (Excel import)
- **Database:** MariaDB via Frappe ORM

### Frontend
- **Framework:** React 18 + Vite
- **Routing:** React Router v6 (role-based route guards)
- **State:** React Context (AuthContext, TableRowLimitContext)
- **API Client:** Custom `api.js` with CSRF handling, chunked uploads, in-memory caching
- **PWA:** Service worker, maskable icons, installable
- **Build Output:** `inet_app/public/portal/`

### Key Libraries
- **Charts:** Frappe Charts (dashboard visualizations)
- **Excel:** openpyxl (data import), custom CSV/Excel export utilities
- **Linting:** ruff (Python), eslint + prettier (JS), pre-commit hooks

---

## 🔄 Key Workflows

### Workflow #1 — Multi-Team Execution
A Rollout Plan can split line qty across **2+ Field Teams** via a `teams` child table. Each team gets its own Daily Execution keyed by `(rollout_plan, team)`. One plan-level Work Done aggregates them. Team Lead remarks combine into the PO Dispatch with team prefixing + dedup. QC/CIAG is per-plan.

### Workflow #2 — Multi-Visit per POID
The same POID can have multiple sequential visits. Each Rollout Plan carries a `visit_number` that auto-increments. The IM picks "All POIDs (re-plan)" to plan the next visit. A duplicate guard blocks exact collision on **(POID, plan_date, team, access_period, access_time)**; override with `force_duplicate=true`. A DispatchVisitHistory panel shows the full visit chain.

### Workflow #3 — Backend Team (Subcontractor)
IMs with `can_assign_backend = 1` can dispatch a POID to a Backend Team. Vendor concept (Subcontractor Master, subcon_status, etc.) is preserved.

### Workflow #4 — PIC Invoicing
Per-POID MS1/MS2 milestones with payment-terms parsing, billing roll-up, CSV exports. 11-value PIC status scale (Work Not Done → Under Process to Apply → Under I-BUY/ISDP → Ready for Invoice → Commercial Invoice Submitted/Closed). Bulk status updates with audit trail.

### Workflow #5 — PO Intake & Auto-Dispatch
Excel upload → chunked processing → PO Intake creation → auto-dispatch to IM when project has an IM assigned. Duplicate detection by POID.

### Workflow #6 — Team Allocation Request
IM-to-IM team transfer workflow with PM approval. Request → IM Accept/Reject → PM Decide → Complete/Cancel.

---

## 🧩 Notable Architectural Choices

1. **Schema Drift Guards** — `has_column()` / `hasattr()` checks everywhere so schema can differ between dev and prod without breaking the API
2. **`frappe.db.set_value` Backstop** — Used after `doc.insert()` to work around Document-class meta-cache staleness when columns were added late
3. **`after_migrate` Hook** — Re-syncs workspace JSON, ensures custom Item field (`activity_type`), drops unused doctypes, creates INET roles
4. **Property Setters** — Used instead of source edits for hiding ERPNext fields (e.g., Activity Type costing/billing rates)
5. **Workspace Force-Resync** — Frappe only re-imports workspace JSON if file-mtime > db-mtime; the setup hook clears and re-imports on every migrate
6. **Dashboard ETag Caching** — Cheap SHA-1 hash of MAX(modified) from key tables; frontend passes etag to short-circuit full payload regeneration
7. **Chunked PO Upload** — 500-row chunks to stay under Werkzeug/nginx size limits
8. **Table Personalization** — Per-user column order, visibility, widths, filters, and dynamic fields stored in `__UserSettings`
9. **PIC Initial-State Rule** — Computed on read (not stored) so historical data lights up without backfill
10. **Role-Based Home Pages** — `role_home_page` in hooks.py routes each role to their correct portal landing page

---

## 📁 Project Structure

```
inet_app/
├── inet_app/                          # Frappe app package
│   ├── __init__.py
│   ├── hooks.py                       # App hooks, routes, role_home_page, fixtures, doc_events
│   ├── modules.txt                    # Module: "Inet App"
│   ├── patches.txt                    # Migration patches
│   ├── setup.py                       # after_migrate hook
│   ├── region_type.py                 # Hard/Standard region detection
│   ├── api/
│   │   ├── command_center.py          # ~10k lines — main pipeline API
│   │   ├── project_management.py      # CRUD for projects, updates, assignments, PO
│   │   ├── pic.py                     # PIC invoicing endpoints
│   │   └── data_import.py             # Excel data import from CONTROL_CENTER.xlsx
│   ├── config/                        # App config
│   ├── fixtures/                      # Custom Field & Role fixtures
│   ├── inet_app/
│   │   ├── dashboard/                 # Project Management Dashboard
│   │   ├── doctype/                   # ~30 custom doctypes
│   │   ├── report/                    # 4 custom reports
│   │   ├── workspace/                 # PMS workspace JSON
│   │   └── www/                       # Portal pages (pms.html, inet_portal.html)
│   ├── patches/                       # Migration patches
│   ├── public/                        # Static assets (portal build output, CSS, JS)
│   ├── templates/                     # Jinja templates
│   └── tests/                         # Unit tests
├── frontend/                          # React SPA
│   ├── src/
│   │   ├── App.jsx                    # Root with role-based routing
│   │   ├── main.jsx                   # Entry point
│   │   ├── components/                # Reusable UI components
│   │   ├── context/                   # AuthContext, TableRowLimitContext
│   │   ├── hooks/                     # useDebounced, useFilterOptions, useTablePreferences
│   │   ├── modules/                   # Feature modules (Dashboard, POIntake, etc.)
│   │   ├── pages/                     # Route pages (admin/, im/, field/, pic/)
│   │   ├── services/api.js            # API client with CSRF, caching, chunked uploads
│   │   ├── styles/                    # CSS (dashboard, pages, theme)
│   │   └── utils/                     # Utilities (exportExcel, executionTimer, etc.)
│   └── public/                        # PWA assets, icons
├── docs/                              # Documentation
│   ├── PROJECT_SUMMARY.md             # This file
│   ├── SYSTEM_OVERVIEW.md             # Architecture deep-dive
│   ├── USER_GUIDE.md                  # Role workflows
│   ├── FINDINGS.md                    # Known issues
│   └── superpowers/                   # Design specs and plans
├── scripts/                           # Utility scripts
├── Doc.md                             # Original developer task breakdown (220+ tasks)
├── README.md                          # Installation & contributing guide
└── pyproject.toml                     # Python project config
```

---

## 🚀 Installation

```bash
cd $PATH_TO_YOUR_BENCH
bench get-app https://github.com/EnfonoTech/inet_app --branch develop
bench install-app inet_app
```

---

## 📊 Status

**Active development** against a production-tracking site. The app is currently in active use with ongoing enhancements including multi-visit support, multi-team rollout, backend team workflow, and PIC invoicing pipeline. Sales Invoice integration is queued behind functional-side requirements.
