# INET Operations Command Center — User Guide

**URL:** http://mysite.local:8001/pms/
**Login:** Use your Frappe/ERPNext credentials

---

## 1. System Overview

The INET Operations Command Center replaces the Excel-based project management system. It manages the full lifecycle of telecom field operations:

```
PO Upload → Dispatch → Planning → Execution → Work Done → Dashboard KPIs
```

### Three User Roles

| Role | Who | What they see |
|------|-----|--------------|
| **Admin** | Administrator, System Managers | Full Command Dashboard (wall screen), all pipeline stages, reports, master data |
| **IM** | Implementation Managers (Majid, Ajmal) | Personal dashboard filtered to their teams and projects |
| **Field Team** | Team leads (Team-01 through Team-60) | Today's assigned work, execution update forms |

The system auto-detects your role at login based on your Frappe user account.

---

## 2. Admin Guide

### 2.1 Command Dashboard (`/pms/dashboard`)

The main monitoring screen — designed for a wall-mounted 1920x1080 display.

**4 KPI Rows (top to bottom):**

| Row | What it shows | Key metrics |
|-----|--------------|-------------|
| **Operational Overview** | Overall operations health | Total Open PO Value, Active Teams, Idle Teams, Planned Activities, Closed Activities, Re-Visits |
| **INET Teams Performance** | Internal team financials | Active INET Teams, Monthly Cost, Monthly Target, Target Today (prorated), Achieved, Gap |
| **Subcontractor Performance** | Sub-contractor metrics | Active Sub Teams, Target, Revenue, Expense, INET Margin, Gap |
| **Company Financial Summary** | Company-wide P&L | Company Target, Total Achieved, Gap, Total Cost, Profit/Loss, Coverage % |

**4 Bottom Panels:**

| Panel | Content |
|-------|---------|
| **Top 5 Teams** | Best performing teams by revenue this month |
| **IM Performance** | Revenue, cost, and profit per Implementation Manager |
| **Team Status** | Bar chart (Active/Idle/Planned/In Progress) + completion donut |
| **Action Watchlist** | Alerts: Idle teams, missed activities, forecast gap, P&L, re-visits |

**Color coding:**
- Green = good (achievements, active, on target)
- Red = critical (gaps, losses, overdue) — negative values shown in parentheses like (303,382)
- Amber = warning (idle teams, behind schedule)

**Auto-refresh:** Dashboard refreshes every 60 seconds. The green pulsing dot in the header indicates live connection.

---

### 2.2 PO Upload (`/pms/po-upload`)

**Purpose:** Import Huawei PO export files into the system.

**Step-by-step:**

1. **Get the PO file** from Huawei's procurement system (`.xlsx` format like `PURCHASE_ORDER_20260325003415.xlsx`)

2. **Drag & drop** the file onto the upload zone (or click to browse)

3. **Review validation results:**
   - Green rows = valid (Item Code found, Project Code exists, Qty > 0)
   - Red rows = errors (missing fields, unknown codes)
   - The system validates against the Customer Item Master (820 items) and Project Master (74 projects)

4. **Click "Confirm Import"** to create PO Intake records

**What gets created:** Each PO number becomes a "PO Intake" record with line items. Status starts as "New".

**Columns parsed from the Huawei file:**
PO No, PO Line No, Shipment No, Site Name, Site Code, Item Code, Item Description, Unit, Qty, Unit Price, Line Amount, Project Code, Project Name, Center Area, Publish Date

---

### 2.3 PO Dispatch (`/pms/dispatch`)

**Purpose:** Assign PO lines to teams for execution.

**Step-by-step:**

1. You see a table of PO Intake lines with status "New" (imported but not yet assigned)

2. **Select lines** using checkboxes (select individual lines or use "Select All")

3. **Choose assignment:**
   - **Team:** Select from the dropdown (60 teams: Team-01 through Team-60)
   - **Target Month:** Pick the month this work should be completed
   - Planning Mode defaults to "Plan"

4. **Click "Dispatch Selected"**

**What happens:**
- Creates "PO Dispatch" records with a unique System ID (e.g., `SYS-2026-00001`)
- Auto-maps the Implementation Manager from the Team Master
- Auto-maps the Customer from the Project Master
- Status changes to "Dispatched"

**The System ID** is the primary tracking key — it follows the work through planning, execution, and completion.

---

### 2.4 Rollout Planning (`/pms/planning`)

**Purpose:** Schedule dispatched work for specific dates.

**Step-by-step:**

1. You see dispatched PO lines (status "Dispatched")

2. **Select lines** to plan

3. **Set planning details:**
   - **Plan Date:** When the team should execute this work
   - **Visit Type:**
     - "Work Done" = standard first visit (1.0x multiplier)
     - "Re-Visit" = return visit for rework (0.5x multiplier — lower expected cost)
     - "Extra Visit" = additional mobilization (1.5x multiplier)

4. **Click "Create Plans"**

**What happens:**
- Creates "Rollout Plan" records
- Visit Multiplier is auto-applied from the Visit Multiplier Master
- Target Amount = PO Line Amount x Visit Multiplier
- Status: "Planned" → ready for field teams

---

### 2.5 Execution Monitor (`/pms/execution`)

**Purpose:** Watch field team progress in real-time (read-only for admin).

Shows all Rollout Plans in "Planned" or "In Execution" status with:
- System ID, Team, Plan Date, Visit Type
- Target Amount, Achieved Amount, Completion %
- Status with color coding

**Auto-refreshes every 30 seconds.**

---

### 2.6 Work Done (`/pms/work-done`)

**Purpose:** View completed, billable work with revenue/cost/margin calculations.

Shows all "Work Done" records with:
- Item Code, Executed Qty
- **Revenue** (SAR) = Billing Rate x Qty (rate from Customer Item Master)
- **Cost** (SAR) = Team Daily Cost + Subcontract Cost
- **Margin** (SAR) = Revenue - Cost
- Billing Status (Pending / Invoiced / Closed)

**Totals row** at the bottom shows sum of revenue, cost, and margin.

**Revenue calculation logic:**
- Standard Region → uses `Standard_Rate_SAR` from Customer Item Master
- Hard Region (center_area contains "Hard") → uses `Hard_Rate_SAR`

---

### 2.7 Reports (`/pms/reports`)

Four report types available:

| Report | What it shows |
|--------|--------------|
| **Project Status Summary** | All projects with status, budget, actual cost |
| **Budget vs Actual** | Budget vs actual cost comparison per project |
| **Team Utilization** | Team assignments and utilization percentages |
| **Daily Work Progress** | Daily execution progress by team and date |

Click a report tab to load it. Use filters to narrow results.

---

### 2.8 Masters (`/pms/masters`)

Reference data overview showing record counts for each master table:

| Master | Records | Description |
|--------|---------|-------------|
| Area Master | 7 | Saudi regions: Riyadh, Jeddah, Dammam, Abha, Qassim, Makkah, Madinah |
| INET Team | 60 | Field teams (Team-01 through Team-60) with IM, type, daily cost |
| Subcontractor Master | 7 | Subcontractors with INET margin % and payout % |
| Project Control Center | 74 | All active projects with domain, customer, IM |
| Customer Item Master | 0* | Billing rates (Standard and Hard region rates) |
| Activity Cost Master | 0* | Internal cost benchmarks per activity |
| Visit Multiplier Master | 4 | Work Done=1.0x, Re-Visit=0.5x, Extra=1.5x, Plan=0x |

*Customer Item Master and Activity Cost Master need to be imported — see Section 5.

Click any card to open the doctype in Frappe Desk for editing.

---

## 3. IM (Implementation Manager) Guide

### 3.1 IM Dashboard (`/pms/im-dashboard`)

When you log in as an IM (e.g., a user whose full name matches "Majid Ali" or "Ajmal Muhammed" in the INET Team master), you see your personal dashboard:

**My KPIs (4 cards):**
- Total Revenue this month (from your teams' Work Done)
- Total Cost (your teams' daily costs)
- Profit/Loss (revenue minus cost)
- Team Count (how many teams report to you)

**My Teams table:**
- Team name, type (INET/SUB), status, daily cost
- Shows which teams are active today vs idle

**My Projects table:**
- Projects where you are the Implementation Manager
- Project code, name, status, completion %, budget

---

## 4. Field Team Guide

### 4.1 Today's Work (`/pms/today`)

When you log in as a field team member, you see your work cards for today:

Each card shows:
- Item description (what work to do)
- Site name and project code
- Target amount
- Current status

**Click a card** to open the execution form.

### 4.2 Execution Form (`/pms/execute/:id`)

Submit your daily work update:

1. **Execution Status:** Select from dropdown
   - In Progress — work started
   - Completed — work finished
   - Hold — paused
   - Cancelled — work cancelled
   - Postponed — rescheduled

2. **Achieved Qty:** How many units completed

3. **GPS Location:** Click "Capture GPS" to auto-fill from your device's location

4. **Remarks:** Any notes about the work

5. **Click Submit**

**When you mark "Completed":** The system automatically:
- Updates the Rollout Plan's achieved amount and completion %
- Creates a "Work Done" record with revenue/cost/margin calculations
- The data flows to the Command Dashboard KPIs

---

## 5. First-Time Setup Guide

### 5.1 Import Master Data

After first installation, you need to import reference data from the CONTROL_CENTER.xlsx file:

1. **Upload CONTROL_CENTER.xlsx** to Frappe:
   - Go to http://mysite.local:8001 (Frappe Desk)
   - Navigate to File Manager
   - Upload the CONTROL_CENTER.xlsx file

2. **Run the import** via Frappe Console:
   ```bash
   cd ~/frappe-bench
   bench --site mysite.local console
   ```
   Then:
   ```python
   from inet_app.api.data_import import import_control_center_xlsx
   result = import_control_center_xlsx("/files/CONTROL_CENTER.xlsx")
   print(result)
   frappe.db.commit()
   ```

3. **Verify counts** at `/pms/masters`

### 5.2 Import First PO File

1. Go to `/pms/po-upload`
2. Upload `PURCHASE_ORDER_20260325003415.xlsx` (or any Huawei PO export)
3. Review validation → Confirm Import
4. Go to `/pms/dispatch` → assign lines to teams
5. Go to `/pms/planning` → set plan dates
6. Check `/pms/dashboard` — KPIs should now show data

### 5.3 Set Up IM Users

For IMs to get their own dashboard:

1. Create Frappe users for each IM (e.g., `majid@inet.com`, `ajmal@inet.com`)
2. Set their **Full Name** to match the `im` field in INET Team master (e.g., "Majid Ali", "Ajmal Muhammed")
3. When they log in to `/pms/`, they'll automatically see the IM Dashboard

### 5.4 Set Up Field Team Users

1. Create Frappe users for team leads
2. The system will detect them as "Field" role (default for non-admin, non-IM users)
3. They see Today's Work filtered to planned items

---

## 6. Complete Workflow Example

Here's a full cycle from PO to Dashboard:

```
1. Huawei sends PO export file (17 line items worth SAR 25,000)
       ↓
2. Admin uploads at /pms/po-upload → 17 PO Intake lines created
       ↓
3. Admin goes to /pms/dispatch → assigns 10 lines to Team-01 (Irfan/Rafeeq)
   and 7 lines to Team-05 (Sharban/Iqbal)
       ↓
4. Admin goes to /pms/planning → sets plan date to today, visit type "Work Done"
       ↓
5. Team-01 lead logs in → sees 10 items at /pms/today
   Team-05 lead logs in → sees 7 items at /pms/today
       ↓
6. Team-01 clicks each item → marks "Completed", enters achieved qty
       ↓
7. System auto-creates Work Done records:
   Revenue = SAR 706 (billing rate) x 1 (qty) = SAR 706
   Cost = SAR 1000 (team daily cost) / items = SAR 100
   Margin = SAR 606
       ↓
8. Command Dashboard updates (within 60 seconds):
   - Closed Activities: +1
   - INET Achieved: +SAR 706
   - INET Gap Today decreases
   - Top Teams table updates
   - Team-01 shows in Top 5 if they have highest revenue
```

---

## 7. Key Financial Formulas

| Calculation | Formula | Source |
|------------|---------|--------|
| Revenue | Billing Rate x Executed Qty | Customer Item Master (Standard or Hard rate based on region) |
| Team Cost | Daily Cost from Team Master | INET Team doctype (default SAR 1,000/day) |
| Sub Cost | Expected Cost x Visit Multiplier | Subcontract Cost Master |
| Total Cost | Team Cost + Sub Cost | Calculated |
| Margin | Revenue - Total Cost | Calculated |
| INET Margin (for subs) | Revenue x INET Margin % | Subcontractor Master |
| Coverage % | Total Achieved / Company Target x 100 | Dashboard calculation |

**Visit Multipliers:**
| Type | Multiplier | When used |
|------|-----------|-----------|
| Work Done | 1.0x | Standard first visit |
| Re-Visit | 0.5x | Return visit for rework |
| Extra Visit | 1.5x | Additional mobilization needed |
| Plan | 0x | Planning only, no cost |

---

## 8. Navigation Reference

### Admin Sidebar
| Icon | Page | URL |
|------|------|-----|
| ◆ | Dashboard | /pms/dashboard |
| ↑ | PO Upload | /pms/po-upload |
| → | Dispatch | /pms/dispatch |
| ☰ | Planning | /pms/planning |
| ◎ | Execution | /pms/execution |
| ✓ | Work Done | /pms/work-done |
| ◫ | Reports | /pms/reports |
| ⚙ | Masters | /pms/masters |

### Keyboard Shortcuts
- **Cmd+Shift+R** — Hard refresh (bypass browser cache)
- The dashboard auto-refreshes every 60 seconds

---

## 9. Troubleshooting

| Issue | Solution |
|-------|----------|
| Dashboard shows old white theme | Hard refresh: Cmd+Shift+R or open in incognito window |
| "Loading..." stuck forever | Check if bench server is running: `cd ~/frappe-bench && bench serve --port 8001` |
| PO Upload validation errors | Check that Item Codes match Customer Item Master, Project Codes match Project Control Center |
| Dashboard KPIs all zero | No Work Done records yet — complete the full pipeline (upload → dispatch → plan → execute → complete) |
| Login fails | Use Frappe credentials. Default admin: Administrator / admin |
| IM Dashboard shows wrong data | Check that user's Full Name matches the `im` field in INET Team master exactly |

---

**System Info:**
- Backend: Frappe 15 / ERPNext 15
- Frontend: React 19 + Vite 6
- Database: MariaDB 10.11
- Server: `bench serve --port 8001`
- Site: mysite.local
