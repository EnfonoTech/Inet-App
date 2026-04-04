# INET Operations Command Center — Design Spec

**Date:** 2026-04-04
**Status:** Approved
**Author:** Claude + Sayanth

## Overview

Rebuild the INET PMS portal into a full Operations Command Center that replaces the customer's Excel-based project management system. The system manages the complete lifecycle of Huawei PO intake through field execution to revenue recognition for INET Telecom's field service operations in Saudi Arabia.

## Users & Access

Three role-based views within a single React SPA at `/pms/`:

| Role | Access | View |
|------|--------|------|
| **Admin** (INET Admin role or Administrator) | Full system. Command Dashboard on office wall screen. All pipeline stages, masters, reports. | Dark ops-center dashboard + operational pages |
| **IM** (Users linked as Implementation Manager in Team Master) | Own teams, projects, revenue. Individual performance dashboard. | Filtered dashboard + action items |
| **Field Team** (Users linked as team members in Team Master) | Today's assigned work. Submit execution updates. | Work list + execution form |

Role detection: Frappe session user → check `Has Role` for "INET Admin" → check Team Master for IM/team membership → route accordingly.

## Visual Design

**Theme:** Dark Operations Center
- Background: `#060d18` to `#0c1a30` gradient range
- Cards: `rgba(15,30,55,0.6)` with subtle border glow
- Text: `#e8ecf4` primary, `#7db8e8` labels
- Accent colors: Green `#4ade80` (good), Amber `#fbbf24` (warning), Red `#f87171` (critical), Blue `#60a5fa` (info)
- Typography: Inter for UI, JetBrains Mono for numbers
- All pages share the dark theme — no light mode needed (office screen + operational tool)

**Dashboard is designed for 1920x1080 wall-mounted display** with auto-refresh every 60 seconds.

## Data Pipeline — 6 Stages

### Stage 1: PO Dump (CSV/Excel Upload)

**Input:** Huawei PO export file (.xlsx/.csv) with columns: ID, PO Status, PO No, PO Line No, Shipment No, Site Name, Site Code, Item Code, Item Description, Unit, Qty, Unit Price, Line Amount, Tax Rate, Payment Terms, Project Code, Project Name, Center Area, Publish Date.

**Process:**
1. Admin uploads file on PO Upload page
2. System parses file, maps columns to PO Intake fields
3. Validates: Item Code exists in Customer Item Master (820 items), Project Code exists in Project Master (116 projects), Qty > 0, Rate > 0
4. Shows validation summary with errors highlighted
5. Admin confirms → creates PO Intake records with child PO Intake Line items

**Output:** PO Intake doctype records with status "New".

### Stage 2: PO Dispatch (Admin Assigns Work)

**Input:** PO Intake lines with status "New".

**Process:**
1. Admin sees table of undispatched PO lines
2. For each line (or bulk selection), assigns: Team, Target Month, Planning Mode (Plan/Direct)
3. System auto-maps: Project Code → Customer, IM from Project Master + Team Master
4. Generates `system_id` — the primary key for all downstream tracking
5. Creates PO Dispatch record

**Output:** PO Dispatch records with status "Dispatched". Each has a unique `system_id`.

### Stage 3: Rollout Planning (Admin/IM Plans)

**Input:** Dispatched items from Stage 2.

**Process:**
1. Dispatched items enter planning queue
2. Admin/IM assigns: Plan Date, Visit Type (Work Done / Re-Visit / Extra Visit)
3. System applies Visit Multiplier from Visit Multiplier Master (1.0x / 0.5x / 1.5x)
4. Target Amount calculated from PO line amount × visit multiplier
5. Creates Rollout Plan record

**Output:** Rollout Plan records with status "Planned" → "Ready for Execution".

### Stage 4: Daily Execution (Field Teams)

**Input:** Planned items for today's date assigned to the logged-in team.

**Process:**
1. Field team lead opens app, sees today's planned work items
2. Updates each item: Execution Status (In Progress / Completed / Hold / Cancelled / Postponed)
3. Records: Achieved Quantity, GPS location, Photos
4. System calculates Achieved Amount from Item Master rate × achieved qty
5. QC status tracked (Pass / Fail / Pending)

**Output:** Daily Execution records. Completed items flow to Stage 5.

### Stage 5: Work Done (Auto-Generated)

**Input:** Completed executions from Stage 4.

**Process:**
1. Scheduled job (or trigger on execution completion) creates Work Done records
2. Revenue calculated: `Billing_Rate_SAR × Executed_Qty` (rate from Customer Item Master, using Standard_Rate for standard regions, Hard_Rate for hard regions)
3. Cost calculated: Team Daily Cost (from Team Master) + Subcontract Expected Cost (from Subcontract Cost Master) × Visit Multiplier
4. Margin = Revenue - Cost
5. INET vs Sub-Con split: If team type is INET, full margin to INET. If SUB, apply INet_Margin_% from Subcontractor Master.

**Output:** Work Done records with revenue, cost, margin. Used for invoicing and dashboard KPIs.

### Stage 6: QC & Closure

**Input:** Work Done records + QC results from Stage 4.

**Process:**
1. Items with QC Pass → status "Closed"
2. Items with QC Fail → flag issue category (PAT Rejection, QC Rejection, POD Pending) → schedule Re-Visit
3. Re-Visits create new Rollout Plan entries (Stage 3) with Visit Type = "Re-Visit" and 0.5x multiplier
4. Issues tracked in Action Watchlist on dashboard

**Output:** Closed items feed all dashboard KPIs. Open issues appear in Action Watchlist.

## Command Dashboard (Admin View)

Full-screen dark dashboard with 4 KPI rows + 4 bottom panels. Auto-refreshes every 60 seconds.

### KPI Row 1: Operational Overview
- Total Open PO Value (sum of all active PO Intake line amounts)
- Active Teams (teams with execution today)
- Idle Teams Today (teams with no execution today)
- Planned Activities (Rollout Plans in "Planned" status)
- Closed Activities (Executions in "Completed" status this month)
- Re-Visits (Rollout Plans with visit_type = "Re-Visit" this month)

### KPI Row 2: INET Teams Performance
- Active INET Teams (teams where team_type = "INET" and status = "Active")
- INET Monthly Cost (sum of daily_cost × working days for INET teams)
- INET Monthly Target (from system settings or project targets)
- INET Target Today (monthly target prorated to today)
- INET Achieved (sum of Work Done revenue for INET teams this month)
- INET Gap Today (Target Today - Achieved)

### KPI Row 3: Subcontractor Performance
- Active Sub Teams (teams where team_type = "SUB")
- Sub-Con Target (monthly target for sub teams)
- Sub-Con Revenue (Work Done revenue for sub teams this month)
- Sub-Con Expense (subcontract cost for sub teams this month)
- INET Margin (Sub-Con) (revenue × INet_Margin_% for each sub)
- Sub-Con Gap (target - revenue)

### KPI Row 4: Company Financial Summary
- Company Target (INET target + Sub target)
- Total Achieved (all Work Done revenue this month)
- Company Gap (target - achieved)
- Total Cost (INET team costs + sub costs)
- Company Profit / Loss (achieved - cost)
- Coverage % (achieved / target × 100)

### Bottom Panel 1: Top 5 Team Snapshot
Table: Team Name, Known Target, Known Achieved, Completion %, Performance rating.
Sorted by achieved revenue descending.

### Bottom Panel 2: IM Performance Snapshot
Table: IM Name, Teams count, Revenue, Team Cost, Profit.
Dynamically generated from Team Master IM grouping.

### Bottom Panel 3: Team Status + Completion
- Bar chart: Active / Idle / Planned / In Progress team counts
- Donut chart: Overall completion percentage

### Bottom Panel 4: Action Watchlist
Rows with indicator, metric name, current value, target, status badge, recommended action.
Metrics: Idle Teams, Missed Activities, Schedule Gap, Forecast Gap, Real-Time P/L, Re-Visits.
Status colors: Optimized (green), Recover (red), Behind (amber), Ahead (blue), Normal (gray).

## IM Dashboard

Same dark theme, filtered to the logged-in IM's data:

- **My KPIs:** Revenue, Cost, Profit, Team count, Target vs Achieved (same card components as Command Dashboard)
- **My Teams:** Table of teams under this IM — today's status, current assignment, daily revenue
- **My Projects:** Projects linked to this IM — completion %, budget utilization
- **Weekly Revenue Trend:** Revenue by week (W-1 through W-5) as bar chart
- **Action Items:** Pending dispatches to plan, overdue work, QC rejections needing attention

## Field Team View

Minimal interface for team leads in the field:

- **Today's Work:** List of planned activities for today from Rollout Planning
- **Execute:** Per-item status update form — select status, enter achieved qty, capture GPS, attach photos
- **My History:** Past work done records and achievement stats
- **My Assignment:** Current project, dates, role

## Backend: New Doctypes

### PO Dispatch
```
Fields:
  - system_id: Data (auto-generated, primary tracking key) — Naming Series: SYS-.YYYY.-.#####
  - po_intake: Link to PO Intake
  - po_intake_line: Data (reference to child row)
  - po_no: Data
  - po_line_no: Int
  - item_code: Link to Item
  - item_description: Small Text
  - qty: Float
  - rate: Currency
  - line_amount: Currency
  - project_code: Link to Project Control Center
  - customer: Link to Customer
  - im: Data (IM name from Team Master)
  - team: Data (Team_ID from Team Master)
  - target_month: Date
  - planning_mode: Select (Plan / Direct)
  - dispatch_status: Select (Pending / Dispatched / Planned / Completed / Cancelled)
  - center_area: Data
  - site_code: Data
  - site_name: Data
```

### Rollout Plan
```
Fields:
  - name: Naming Series RPL-.YYYY.-.#####
  - system_id: Data (Link to PO Dispatch system_id)
  - po_dispatch: Link to PO Dispatch
  - team: Data
  - plan_date: Date
  - visit_type: Select (Work Done / Re-Visit / Extra Visit)
  - visit_number: Int (1, 2, 3...)
  - visit_multiplier: Float (auto-set from Visit Multiplier Master)
  - target_amount: Currency (line_amount × visit_multiplier)
  - achieved_amount: Currency (sum from Daily Execution)
  - completion_pct: Percent
  - plan_status: Select (Planned / In Execution / Completed / Cancelled)
```

### Daily Execution
```
Fields:
  - name: Naming Series EXE-.YYYY.MM.-.#####
  - system_id: Data
  - rollout_plan: Link to Rollout Plan
  - team: Data
  - execution_date: Date
  - execution_status: Select (In Progress / Completed / Hold / Cancelled / Postponed)
  - achieved_qty: Float
  - achieved_amount: Currency
  - gps_location: Data
  - photos: Attach Image
  - qc_status: Select (Pending / Pass / Fail)
  - ciag_status: Data
  - revisit_flag: Check
  - remarks: Small Text
```

### Work Done
```
Fields:
  - name: Naming Series WD-.YYYY.-.#####
  - system_id: Data
  - execution: Link to Daily Execution
  - item_code: Link to Item
  - executed_qty: Float
  - billing_rate_sar: Currency (from Customer Item Master)
  - revenue_sar: Currency (billing_rate × qty)
  - team_cost_sar: Currency (from Team Master daily_cost prorated)
  - subcontract_cost_sar: Currency (from Subcontract Cost Master)
  - total_cost_sar: Currency
  - margin_sar: Currency (revenue - total_cost)
  - inet_margin_pct: Percent (from Subcontractor Master)
  - billing_status: Select (Pending / Invoiced / Closed)
```

### Enhanced PO Intake
Add fields to existing doctype:
- division: Data
- contract: Data
- center_area: Data
- publish_date: Date

Add fields to PO Intake Line child table:
- shipment_number: Data
- site_code: Data
- site_name: Data
- po_status: Select (New / Dispatched / Completed)

### Enhanced Project Control Center
Add fields:
- customer: Link to Customer
- huawei_im: Data
- division: Data
- monthly_target: Currency
- active_flag: Select (Yes / No)

### New Master Doctypes (simple reference tables)

**Area Master:** area_code (Data, PK), area_name (Data)

**Team Master** (new doctype, replaces using Team Assignment for team identity):
- team_id: Data (e.g., "Team-01")
- team_name: Data (e.g., "Irfan/Rafeeq")
- im: Data (Implementation Manager name)
- team_type: Select (INET / SUB)
- subcontractor: Data (Link to Subcontractor Master if SUB)
- status: Select (Active / Inactive)
- daily_cost_applies: Check
- daily_cost: Currency (default 1000 SAR for INET)

**Subcontractor Master:**
- name: Data (e.g., "Mabran-Fixed")
- type: Select (INET / SUB)
- inet_margin_pct: Percent
- sub_payout_pct: Percent
- contract_model: Data
- status: Select (Active / Inactive)
- approved_flag: Check

**Customer Item Master** (billing rate lookup):
- customer: Data
- item_code: Data
- customer_activity_type: Data
- domain: Data
- item_description: Small Text
- unit_type: Data
- standard_rate_sar: Currency
- hard_rate_sar: Currency
- active_flag: Check

**Activity Cost Master:**
- activity_code: Data
- standard_activity: Data
- category: Data
- base_cost_sar: Currency
- cost_type: Select (Fixed / Variable)
- billing_type: Select (Billable / Non-Billable)
- active_flag: Check

**Subcontract Cost Master:**
- subcontractor: Data
- activity_code: Data
- region_type: Select (Standard / Hard)
- expected_cost_sar: Currency
- effective_from: Date
- effective_to: Date
- active_flag: Check

**Visit Multiplier Master:**
- visit_type: Data (Work Done / Re-Visit / Extra Visit / Plan)
- multiplier: Float (1.0 / 0.5 / 1.5 / 0)

**System Settings** (stored in Frappe's Singles doctype or custom settings page):
- system_prefix: Data (INET)
- default_currency: Data (SAR)
- monthly_targets per IM: child table with IM, month, target amount

## Backend: New API Module

New file: `inet_app/api/command_center.py`

```python
# Dashboard aggregation
get_command_dashboard()              # All 4 KPI rows + 4 bottom panels
get_im_dashboard(im)                # Filtered for one IM
get_field_team_dashboard(team_id)    # Today's work for a team

# Pipeline operations
upload_po_file(file)                 # Parse xlsx/csv → validated rows with errors
dispatch_po_lines(payload)           # Bulk create PO Dispatch records
create_rollout_plans(payload)        # Bulk create from dispatched items
update_execution(payload)            # Field team status updates
complete_execution(execution_id)     # Mark complete + trigger Work Done

# Financial engine
calculate_revenue(system_id)         # Billing Rate × Qty from Item Master
calculate_cost(system_id)            # Team cost + subcontract cost
apply_visit_multiplier(system_id, visit_type)  # Cost adjustment
generate_work_done(execution_id)     # Create Work Done from completed execution

# Master data
list_teams(im=None, team_type=None)  # Filtered team listing
list_projects(im=None, status=None)  # Filtered project listing
get_system_settings()                # Currency, prefix, target months
```

## Frontend: File Structure

```
frontend/src/
├── main.jsx                          # Entry: BrowserRouter basename="/pms"
├── App.jsx                           # Role-based routing
├── styles/
│   ├── theme.css                     # Dark ops-center CSS variables + base styles
│   ├── dashboard.css                 # Dashboard-specific (KPI rows, panels, charts)
│   └── pages.css                     # Operational pages (tables, forms, modals)
├── services/
│   └── api.js                        # Frappe API client (existing, extended)
├── context/
│   ├── AuthContext.jsx                # Auth + role detection (Admin/IM/Field)
│   └── DashboardContext.jsx           # Auto-refresh timer, shared KPI state
├── components/
│   ├── AppShell.jsx                   # Dark sidebar + role-based nav
│   ├── KPICard.jsx                    # Reusable KPI card component
│   ├── MiniTable.jsx                  # Compact table for dashboard panels
│   ├── StatusBadge.jsx                # Color-coded status badges
│   ├── FileUpload.jsx                 # Drag-drop file upload with parsing
│   ├── Modal.jsx                      # Existing modal (rethemed)
│   └── Charts.jsx                     # Bar chart, donut chart components
├── pages/
│   ├── Login.jsx                      # Rethemed dark login
│   ├── admin/
│   │   ├── CommandDashboard.jsx       # The main wall-screen dashboard
│   │   ├── POUpload.jsx               # Stage 1: CSV/Excel upload + validation
│   │   ├── PODispatch.jsx             # Stage 2: Assign PO lines to teams
│   │   ├── RolloutPlanning.jsx        # Stage 3: Plan execution dates
│   │   ├── ExecutionMonitor.jsx       # Stage 4: Watch field progress (read-only)
│   │   ├── WorkDone.jsx               # Stage 5: Billable work + revenue
│   │   ├── Reports.jsx                # Analytics and reports
│   │   └── Masters.jsx                # View/edit master data
│   ├── im/
│   │   └── IMDashboard.jsx            # IM's personal dashboard
│   └── field/
│       ├── TodaysWork.jsx             # Today's planned items
│       └── ExecutionForm.jsx          # Submit execution updates
```

## Financial Calculation Engine

All monetary values in SAR. Calculations follow the Excel's Cost Rules (sheet 18):

### Revenue
```
Revenue_SAR = Billing_Rate_SAR × Executed_Qty
```
- Billing_Rate_SAR comes from Customer Item Master (sheet 12)
- Use Standard_Rate_SAR for Standard regions, Hard_Rate_SAR for Hard regions
- Region determined from Center Area field

### Cost
```
If subcontract cost available:
  Total_Cost = Subcontract_Expected_Cost × Visit_Multiplier
Else:
  Total_Cost = Base_Cost_SAR × Visit_Multiplier
```
- Base_Cost_SAR from Activity Cost Master (sheet 15)
- Subcontract cost from Subcontract Cost Master (sheet 16)
- Visit Multiplier from Visit Multiplier Master (sheet 17): Work Done=1.0, Re-Visit=0.5, Extra=1.5

### Team Cost
```
Team_Monthly_Cost = Daily_Cost × Working_Days_In_Month
```
- Daily_Cost from Team Master (sheet 7): 1000 SAR/day for INET teams

### Margin
```
If team_type = "INET":
  Margin = Revenue - Total_Cost (100% to INET)
If team_type = "SUB":
  INET_Margin = Revenue × INet_Margin_% (from Subcontractor Master)
  Sub_Payout = Revenue × Sub_Payout_%
```

### KPI Slabs (from sheet 19)
- INET Team daily revenue < 900 SAR/day → UNDERPERFORMING
- INET Team daily revenue < 1200 SAR/day → BELOW TARGET
- INET Team daily revenue >= 1200 SAR/day → ON TARGET

## Master Data Import

On first run, import from CONTROL_CENTER.xlsx:

| Sheet | Doctype | Records |
|-------|---------|---------|
| 01_ACTIVITY_MASTER | Item (with custom fields) | 237 |
| 03_PROJECT_DOMAIN_MASTER | Project Control Center | 116 |
| 04_AREA_MASTER | Area Master (new simple doctype) | 7 |
| 07_TEAM_MASTER | Team Master (enhanced) | 64 |
| 08_SUBCONTRACTOR_MASTER | Subcontractor Master (new) | 11 |
| 12_CUSTOMER_ITEM_MASTER | Customer Item Master (new) | 820 |
| 15_ACTIVITY_COST_MASTER | Activity Cost Master (new) | 238 |
| 16_SUBCONTRACT_COST_MASTER | Subcontract Cost Master (new) | 284 |
| 17_VISIT_MULTIPLIER_MASTER | Visit Multiplier Master (new) | 4 |
| 19_KPI_SLAB_MASTER | Project KPI Slab (existing, enhanced) | 10 |

Import scripts live in `inet_app/api/data_import.py` with validation and error reporting.

## Auto-Refresh & Real-Time

- Command Dashboard polls `get_command_dashboard()` every 60 seconds
- Live dot indicator pulses green when connected, red on error
- Timestamp shows "Last updated: DD MMM YYYY · HH:MM"
- No WebSocket needed — simple polling is sufficient for 60s intervals

## Out of Scope (Future Phases)

- Mobile native app (responsive web is sufficient)
- WhatsApp notifications
- Direct Huawei API integration (CSV upload covers this)
- Gantt chart views
- Print format designs
- GPS tracking map view
