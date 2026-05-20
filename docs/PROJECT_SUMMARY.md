# INET App — Project Summary

A **Frappe v15 + ERPNext** custom app that powers the **Huawei Telecom Rollout Project Management System (PMS)** end-to-end. It replaces a spreadsheet-heavy manual process with a single-page portal at `/pms/*` across four roles, with underlying doctypes editable from the Frappe Desk for power users.

---

## Overview

**App Name:** `inet_app`  
**Publisher:** enfono (ramees@enfono.com)  
**License:** MIT  
**Python:** 3.11  
**Frontend:** React 18 + Vite (SPA, PWA-installable)

The app models the lifecycle of a Huawei PO line from **Excel upload → IM dispatch → field execution → invoicing (PIC)**, with a parallel **material management chain** (Huawei shipment → main warehouse → team warehouse → field consumption).

---

## Architecture

### Core Pipeline

```
PO Upload (Excel)
   └── PO Intake (+ Lines)            status: OPEN/CLOSED/CANCELLED
        └── PO Dispatch (1-per-line)  Pending → Dispatched → Planned → Completed
             ├── Rollout Plan         (multi-team, multi-visit)
             │    └── Daily Execution (per team, per day; material_usage child table)
             │         └── Work Done  (auto-issues materials on generation)
             └── PIC                  pic_status MS1 / MS2 (invoicing)

Material chain (runs in parallel):
  Huawei Outbound Plan (Received)
       → Material Receipt SE  (to_duid = DUID)
       → Material Request     (main WH → team WH, portal-created)
       → Material Transfer SE (duid = source DUID, to_duid = team DUID)
       → [field records qty_used on Daily Execution]
       → Work Done generated  → Material Issue SE (duid = team DUID)
```

### Custom Doctypes (~32)

| Doctype | Purpose |
|---------|---------|
| **Project Control Center** | Project metadata with INET-specific fields |
| **PO Intake / PO Intake Line** | Uploaded PO data from Excel |
| **PO Dispatch** | One-per-line record: POID, IM, site, PIC status, MS1/MS2 |
| **Rollout Plan** | Multi-team, multi-visit execution plan per PO Dispatch |
| **Rollout Plan Team** | Child table splitting line qty across Field Teams |
| **Daily Execution** | Per-team, per-day execution record; includes `material_usage` child table |
| **Daily Execution Material** | Child table: item_code, material_request, qty_transferred, qty_used |
| **Work Done** | Plan-level aggregation; feeds PIC pipeline; triggers material issue |
| **INET Team / INET Team Member** | Team master with IM, field_user, warehouse, team_type |
| **IM Master** | Implementation Manager master |
| **INET Settings** | Site-wide settings: `source_warehouse`, `default_company` |
| **Huawei Outbound Plan** | Huawei-side shipment record; `du_id` = DUID, `outbound_status` |
| **DUID Master** | Site code master with lat/lon, area |
| **Area Master** | Geographic area definitions |
| **Team Allocation Request** | IM-to-IM team transfer with PM approval |
| **PO Upload Log / Detail** | Audit trail for PO file imports |
| **Execution Time Log** | Field work time tracking |
| **Customer Item Master** | Customer-specific item rates |
| **Subcontractor Master / Cost Master** | Vendor management with margin/payout % |
| **Activity Cost / Category** | Activity codes with base costs |
| **PIC Activity Log** | Audit trail for PIC bulk status updates |

### Reports (4 Custom)

Project Status Summary, Budget vs Actual, Team Utilization, Daily Work Progress.

---

## Roles & Portals

| Role | Portal Path | Primary Pages |
|------|-------------|---------------|
| **Admin / PM** | `/pms/admin/*` | Command Dashboard, Projects, PO Upload, Rollout Planning, Execution Monitor, Work Done, Masters, Approvals |
| **IM** | `/pms/im/*` | IM Dashboard, PO Intake, Dispatch, Planning, Execution, Work Done, Material Requests, Teams |
| **Field Team** | `/pms/field/*` | Today's Work, Execution Form, Field History, Materials (stock view), Timesheet |
| **PIC** | `/pms/pic/*` | PIC Dashboard, Invoice Tracker, Reports |

---

## Tech Stack

### Backend
- **Framework:** Frappe v15 + ERPNext
- **Main API:** `inet_app/api/command_center.py` (~10k lines)
- **Material API:** `inet_app/api/material_management.py`
- **PIC API:** `inet_app/api/pic.py`
- **Database:** MariaDB via Frappe ORM + raw SQL for performance-sensitive paths

### Frontend
- **Framework:** React 18 + Vite, React Router v6
- **State:** React Context (AuthContext, TableRowLimitContext)
- **Table features:** DataTablePro (column manage / sort / filter / freeze / widths, persisted per user)
- **PWA:** Service worker, maskable icons, installable, scope `/pms/`
- **Build Output:** `inet_app/public/portal/`

### Desk-side
- `inet_app/public/js/stock_entry.js` — auto-fills DUID/to_duid on Stock Entry items from linked Material Request or Huawei Outbound Plan.

---

## Key Workflows

### #1 — Multi-Team Execution
Rollout Plan splits qty across 2+ Field Teams via `teams` child table. Each team has its own Daily Execution. One Work Done aggregates them.

### #2 — Multi-Visit per POID
Same POID can have multiple sequential Rollout Plans (`visit_number` auto-increments). Duplicate guard blocks same (POID, date, team, access period/time); override with `force_duplicate=true`.

### #3 — Material Management
Full traceability from Huawei shipment to field consumption:
1. **Receipt**: IM creates Material Receipt SE from Huawei Outbound Plan; `to_duid` auto-set.
2. **Request**: IM submits Material Request via portal (`/pms/im-material-request`), selecting POID, DUID, team, and items.
3. **Transfer**: IM approves → Material Transfer SE created; `duid` (source) + `to_duid` (team) auto-set.
4. **Usage**: Field team enters `qty_used` per item in the Execution Form material tab.
5. **Issue**: IM clicks Generate Work Done → Material Issue SE auto-created idempotently from the usage data; `duid` = team DUID.

DUID is an ERPNext Inventory Dimension. Direction rules:
- Receipt → `to_duid` only
- Transfer → both `duid` (source) and `to_duid` (destination)
- Issue → `duid` only

**Note**: `duid` column exists only on `tabStock Entry Detail`, NOT on `tabStock Ledger Entry` in this installation.

### #4 — PIC Invoicing
Per-POID MS1/MS2 milestones. 11-state PIC status scale. Bulk updates with audit trail. Sales Invoice integration from portal.

### #5 — Backend Team (Subcontractor)
IMs with `can_assign_backend=1` can dispatch a POID to a Backend Team. No Rollout Plan/Execution chain — `subcon_status` tracks progress directly.

### #6 — Team Allocation Request
IM-to-IM team transfer: Request → IM Accept/Reject → PM Decide → Complete/Cancel.

---

## Notable Architectural Choices

1. **Schema Drift Guards** — `has_column()` checks so code works on sites that haven't run `bench migrate` yet.
2. **DUID on SE Detail only** — Inventory Dimension DUID is NOT on SLE; all per-DUID balance queries use `tabStock Entry Detail` with Transfer-in minus Issue-out.
3. **Idempotent auto-issue** — `generate_work_done` checks for existing Issue SE via `sed.material_request` join; safe to call multiple times.
4. **DataTablePro tab-switch fix** — Tab-switching components dispatch `document.dispatchEvent(new CustomEvent("tablepro:check"))` after 60ms; DataTablePro reinits the newly mounted table (the `.data-table-scroll` MutationObserver doesn't fire on full subtree unmount).
5. **Lazy DUID stock hiding** — `get_duid_stock_summary` filters out DUIDs where `received_qty - transferred_qty - issued_qty ≤ 0`. Uses `COALESCE(to_duid, duid)` for receipts to handle legacy SEs with wrong direction.
6. **Material Request duplicate check** — Blocks re-requesting if an active MR for the same `poid + set_warehouse` already exists.
7. **Dashboard ETag Caching** — SHA-1 of `MAX(modified)` from key tables to short-circuit full payload regeneration.
8. **Table Personalization** — Per-user column order, visibility, widths, filters, sort stored in `__UserSettings`.
9. **PIC Initial-State Rule** — Computed on read (not stored) so historical data lights up without backfill.
10. **`frappe.db.set_value` Backstop** — After `doc.insert()` to work around Document-class meta-cache staleness.

---

## Status

**Active development** against a production-tracking site. Currently in production use. Recent major additions: full material management chain (receipt → request → transfer → usage → auto-issue), DUID inventory dimension enforcement, per-DUID stock balance views for both IM and Field roles.
