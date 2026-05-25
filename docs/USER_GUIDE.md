# INET Operations Command Center — User Guide

**Portal URL:** `https://<your-site>/pms/`  
**Login:** Email address and password (same as your company account).

---

## 1. Overview

The INET Operations Command Center manages telecom rollout projects end-to-end — from the first purchase order to the final invoice — through a single browser-based portal.

**Work order lifecycle:**
```
PO Upload → Dispatch → PO Control → Rollout Planning → Rollout Execution → Work Done → Invoice
```

**Materials lifecycle (parallel):**
```
Huawei Delivery → Main Warehouse → Team Warehouse → On-site Use → (Return if unused)
```

### 1.1 User roles

| Role | Who uses it | What they see |
|------|-------------|---------------|
| **Project Manager (PM)** | Operations management | Full access: all dashboards, all teams, all projects, financials, approvals, masters |
| **Implementation Manager (IM)** | Site manager | Their own teams, projects, materials, execution, backend assignment, expense approvals |
| **Field Team** | On-site engineers | Today's assigned work, execution forms, team stock, expense submission |
| **PIC** | Invoice / billing controller | Milestone billing tracker, invoice pipeline, payment tracking |

When you log in the portal automatically shows the correct layout for your role. You only see pages relevant to you.

### 1.2 Common controls (appear on all data pages)

- **Search box** — filters the table as you type (300 ms debounce). Searches across the most relevant fields (shown in placeholder text).
- **Filter dropdowns** — multi-select dropdowns for Status, Project, Team, DUID, etc. Click the dropdown, tick one or more options, click away to apply.
- **Clear button** — resets all active filters. Only appears when at least one filter is set.
- **Row limit selector** — at the bottom of every table, choose 25 / 50 / 100 / All. "All" returns every matching row with no cap.
- **Export Excel / Download CSV** — exports the current filtered and sorted view.
- **Refresh button** — reloads the page data from the server. List pages do not auto-refresh; click Refresh when you need the latest state.
- **Manage Table** — column visibility, order, widths, and per-column sort or filter are saved per user across sessions.

---

## 2. Project Manager (PM) Guide

The PM role has the full sidebar. The default home page on login is the **Command Dashboard**.

---

### 2.1 Command Dashboard (`/pms/dashboard`)

Live operations overview. Designed for wall displays. **Auto-refreshes every 5 minutes.**

**Header:** Dashboard title, last-updated timestamp, live green indicator dot, date range picker.

**KPI row — 6 tiles:**

| Tile | What it shows |
|------|---------------|
| Open PO Lines | Work orders currently in progress (not yet Completed) |
| Open PO Line Value | Total SAR value of all in-progress work orders |
| Idle Teams | Teams with no work scheduled today (amber text) |
| Planned Activities | Work scheduled for today — SAR amount + activity count |
| Closed Activities | Work completed this period — SAR amount + count (green) |
| ReVisits | Return visits to sites (amber) |

**INET Teams row:** Active teams count, monthly cost, monthly target, target as of today, achieved as of today (green), gap as of today (red if behind, green if ahead).

**Subcontractor row:** Sub-teams count, target, revenue (green), expense, INET margin (green if ≥0, red if <0), gap.

**Backend Teams row:** Active backend teams, Pending count (amber), Completed this month (green).

**Company Financial row:** Company target, Achieved (green), Gap (red/green), Total Cost, Profit/Loss (colour-coded), Coverage %.

**Colour guide:** Green = on target or good · Red = at risk · Amber = warning · Blue = neutral

**Bottom panels (4 cards):**

| Panel | Content |
|-------|---------|
| Top 5 Teams | Team name, Target, Achieved (green), Completion % (green ≥80%, amber ≥40%, red <40%) |
| IM Performance | IM name, Teams count, Revenue (green), Cost, Profit (colour-coded) |
| Team Status | Bar chart (Active/Idle/Planned/In Progress, colour-coded) + donut chart showing Active % |
| Action Watchlist | Indicator name, current value, target, status badge (green=optimised, red=recover/monitor, amber=behind, blue=ahead) |

---

### 2.2 Other Dashboards

The PM role has **six dashboards** accessible from the sidebar or via the dashboard switcher control at the top of each dashboard:

#### CEO Dashboard (`/pms/ceo-dashboard`)
Executive summary for senior management. KPIs: Total Revenue, Net Profit, Active Projects, Pending Invoices, Coverage %. Panels: Revenue trend chart, Top 5 Teams, IM Performance table, Issues & Alerts list.

#### Commercial Dashboard (`/pms/commercial-dashboard`)
Sales focus. KPIs: Total Revenue, Monthly Revenue, Pending Invoices, Revenue Growth %, Active Teams. Panels: Revenue breakdown by category, revenue trend by IM (bar chart), top deals table.

#### PM Dashboard (`/pms/pm-dashboard`)
Project health view. KPIs: Active Projects, On Track, At Risk, Delayed counts. Panels: Budget vs Actual table per project, project health distribution pie chart, budget utilisation progress bars.

#### Operations Dashboard (`/pms/ops-dashboard`)
Operational revenue. KPIs: Total Revenue, Avg Daily Revenue, Jobs Completed, Open Orders, Revenue vs Target %. Panels: IM revenue bar chart, team distribution chart, billing overview donut.

#### Financial Dashboard (`/pms/financial-dashboard`)
Finance/CFO view. KPIs: Total Revenue, Total Cost, Net Profit, Margin %, Outstanding SAR. Panels: Monthly P&L bar chart, cost breakdown pie chart, invoicing pipeline progress bars (MS1 unbilled, MS2 unbilled, total invoiced).

#### IM Dashboard View (`/pms/im-dashboard-view`)
PM viewing an individual IM's dashboard. Same layout as the IM Dashboard (see section 3.1) but accessible from the PM role for monitoring or support purposes.

---

### 2.3 Projects (`/pms/projects`)

List of all Project Control Center records.

**Filters:** Status (Active / On Hold / At Risk / Completed), Team, text search.

**Table columns:** Project Code, Project Name, Status badge (colour-coded), Customer, IM, Budget (SAR), Unloaded, Dispatched, Planned, Executed, Billed, Actions ("View Details" button).

**Status badge colours:** Active=green, On Hold=amber, At Risk=red, Completed=blue.

**+ Create Project button** opens a modal with:
- Project Code (required, e.g. PRJ-2026-001)
- Status dropdown (Active / On Hold / At Risk / Completed)
- Project Name (required)
- Customer (searchable dropdown)
- Implementation Manager (searchable dropdown)
- Center / Area (text)
- Project Domain (searchable dropdown)
- Huawei IM (searchable dropdown)
- Budget Amount in SAR (number)

#### Project Detail page (`/pms/projects/:projectCode`)

Click "View Details" on any row to open the project detail with **five tabs:**

- **Overview** — Status, PM, Customer, budget, created date, location, financial data, expense summary. Edit button opens the project creation form pre-filled.
- **PO Lines** — All PO Dispatch records for this project: POID, Item Code, Qty, Rate, Line Amount, Status.
- **Rollout** — All Rollout Plans grouped by DUID. Each group can expand to show sub-tabs: PO Lines, Planned Activity, Additional Activities, Expenses. Includes a button to create additional rollout plans.
- **Execution** — Execution records with status: Plan name, Team, Visit Type, Start Date, Achieved, Execution Status.
- **Work Done** — Billing records: Team, Item, Qty, Amount, Billing Status.

---

### 2.4 PO Upload (`/pms/po-upload`)

Two modes selected by tabs at the top of the page.

#### Standard Upload (current POs)

A three-step wizard shown by a visual progress indicator (Upload → Review → Confirm):

**Step 1 — Upload:**
1. Select **Customer** from the required dropdown ("All PO lines in this file will be assigned to this customer").
2. Drop the `.xlsx` file onto the upload area or click to browse.
3. The system validates the file automatically and moves to the Review step.

**Step 2 — Review:**
- **Summary chips** at top: Valid rows (green), Error rows (red), Total rows (amber), New products (warning), Missing projects (error).
- **Advisories:** 
  - New Products (amber box) — lists item codes that will be auto-created; they load but are excluded from financials until reconciled. Item codes shown as monospace pills.
  - Missing Projects (red box) — lists project codes not found in the system. These rows will not import.
- **Valid Rows table** — columns: Row #, Item Code, Item (✓ Exists green badge / ⚠ New amber badge), PO No, Project Code, Project (✕ Not Found red badge), Qty, Rate, Line Amount, Row Status. Rows with new items have amber background; rows with missing projects have red background.
- **Error Rows table** — same columns plus an Error column (red text). All rows have light red background.
- Buttons: **Start Over** (secondary) · **Confirm Import (X rows)** (primary, disabled if any error rows exist).

**Step 3 — Success:**
- Green success banner if rows were imported; red banner if all were duplicates.
- **Summary chips:** Lines Imported (green), Duplicates Skipped (amber), Already Closed (gray), Already Cancelled (red), New POs (green), Appended POs (blue), Total POs Touched (gray).
- **Terminal Duplicate Card** (if applicable, purple accent) — POIDs that exist in Closed or Cancelled state. Shows count with expandable sample table (POID, PO No, Existing Status). Button: "View samples (X)".
- **Upload Record table** — search by PO No or Intake doc; filter by status (All / New only / Appended only / Duplicate only). Columns: PO No, Intake Doc (link to Frappe desk), Status (pill), Added (green), Skipped (amber). Footer shows totals.

**Upload History panel** (always visible on Step 1 and Step 3):
- Header: "Upload History (X)" with Refresh button.
- Columns: Uploaded At, By, File, Customer, POs, Imported, Skipped, Closed, Cancelled, Status, Actions.
- Status badges: Completed (green), Partial (amber), Failed (red).
- **"View" button** per row opens a **Detail Modal** with full breakdown: filename, metadata, all summary chips, Terminal Dupe Card, per-PO details table.

#### Archive Upload (historical records)

Imports closed or cancelled POs from past periods to complete business history.

1. Upload the Master Tracker `.xlsb` file (also accepts `.xlsx`, `.csv`).
2. Preview shows: filename, total rows, badge chips for CLOSED (green), CANCELLED (red), OPEN (gray, skipped), OTHER (amber, skipped). Import summary "Will import X rows from Y projects". Warnings for missing UOMs, notes for new Items and Projects auto-created, errors if projects have no customer.
3. Click **Start archive import (X)** — the job runs in the background. You can safely close the page.
4. Job status panel shows: status label (Completed=green, Failed=red, Partial=amber, Running/Queued=blue), stats (lines_imported, lines_skipped, po_created, po_updated), animated progress bar, log name reference code.

> **Tip:** Run Standard Upload first for the current month, then Archive imports for prior months in chronological order.

---

### 2.5 PO Dump (`/pms/po-dump`)

Full export and inspection of all PO line data across all time periods.

**Filters:**
- **From / To date** — date range (defaults to current month start → today).
- **Status checkboxes** — Show OPEN (checked by default), Show CLOSED, Show CANCELLED. Check the ones you need. Results update instantly when you tick or untick — no Apply button needed.
- **Text search** — searches across all fields.

**Table:** Dynamic columns based on PO data. Status cells are colour-coded: OPEN=blue background, CLOSED=gray, CANCELLED=red.

**Summary bar** shows: "X rows · [status breakdown]".

**Download CSV** button exports your current filtered view.

**"View Details" button** on each row opens a **Detail Modal** with pills (PO number, Project, DUID, Status), hero stats (Item Code, Requested Qty, Unit Price, Line Amount), and full record details.

**Row limit** selector (25 / 50 / 100 / All) at bottom of table.

---

### 2.6 Dispatch (`/pms/dispatch`)

Assign PO lines to Implementation Managers.

**Three tabs:** Pending Dispatch (New lines), Dispatched (assigned lines), All Lines.

**Toolbar:**
- Text search (POID, PO No, Item, Project, DUID)
- All Projects (multi-select)
- All IMs (multi-select)
- All DUIDs (multi-select)
- Date range picker
- Clear button
- Selection indicator: "[N] selected" + "Dispatch Selected (N)" button

**Dispatched / All tabs** show additional columns: **Mode badge** (Auto=violet gradient, Manual=slate gradient), IM, Target Month.

Auto-dispatched rows have a subtle violet background to distinguish them from Manual.

**Dispatch button** opens the **Dispatch Modal:**
- Title shows "Dispatch N Line(s)"
- **Assign IM** dropdown (required)
- **Planning Mode** dropdown (Plan / Direct) — required
- Summary info box showing: selected line count → IM name → Mode
- Footer: Cancel · Confirm Dispatch

**Convert to Manual button** (when Auto-dispatched lines are selected):
- Converts selected Auto lines to Manual for a specific project
- Optional **Re-assign IM** dropdown
- Scope: single project (must select a project first) or individual rows

**View button** per row opens a **Detail Modal** with pills (POID, Project, IM, Mode) and full PO Dispatch record.

---

### 2.7 Planning (`/pms/planning`)

Schedule dispatched work by creating rollout visit plans.

**Scope toggle:** "Unplanned" (default, shows lines without a plan) · "All POIDs (re-plan)" (shows everything, used to add additional visits).

**Toolbar:** Text search, All Projects, All IMs, All DUIDs, Date range, Clear. Selection indicator + "Create Plans ([N])" primary button.

**Table columns:** Checkbox, POID (with "PLANNED" blue badge if already has a plan), Item Code, Description, Activity Type, Project, DUID, Center area, Region, IM, Target Month, Line Amount, Open (View button).

**Footer** shows row count + selected count + total SAR of selected rows.

**Create Plans modal** (opens when rows selected):
- **Selected DUIDs section** — scrollable chip list of selected DUIDs with summary ("N dispatch lines · Qty X · SAR X · IM: name")
- **Lead team** dropdown (required) — the primary team for this plan
- **Visit type** dropdown: Execution / Re-Visit / Extra Visit
- **Additional Teams section** (optional) — click "+ Add team" to split work across multiple teams:
  - Each team row: Team select (excludes lead), Qty input (decimal), Remove button
  - Summary box shows: "Total qty X · Assigned to extras X · Remaining for lead team X" (remaining shows red if over-allocated)
  - Hint: "Lead team gets the remaining qty if you leave it blank"
- **Access Details section:**
  - Planned start date (required date input)
  - Planned end date (required, must be ≥ start date)
  - Access time (optional text, e.g. "08:00")
  - Access period radio buttons: Not set · Day · Night
- **Workflow toggles:**
  - QC Required checkbox (checked by default)
  - CIAG Required checkbox (checked by default)
  - When unchecked, field team is not prompted for that check
- **Remark textarea** — note visible to field team and IM
- Footer: Cancel · "Create N plan(s)" (disabled if required fields missing)

**Visit type multipliers:**

| Visit Type | Revenue Multiplier | When to use |
|------------|-------------------|-------------|
| Execution (Work Done) | 1.0× | Standard first visit |
| Re-Visit | 0.5× | Return to site for rework |
| Extra Visit | 1.5× | Additional mobilisation required |

---

### 2.8 Execution Monitor (`/pms/execution`)

Read-only live monitor of all execution activity across all teams. Subtitle shows "Today's live execution status · Last refreshed [time]".

**Toolbar:** Text search, All Plan Status (multi-select), All Exec Status (multi-select), All Visit Types (multi-select), All Projects (multi-select), All Teams (multi-select), All DUIDs (multi-select), Date range, Clear. Export Excel button. Refresh button.

**Table columns (27 columns):**

| Column | Notes |
|--------|-------|
| Plan | Rollout plan name |
| POID | Monospace, small |
| Dummy POID | Monospace, very small, full value in tooltip |
| Item code | Monospace |
| Description | Full value in tooltip |
| Activity Type | |
| Project | |
| DUID | Monospace, tooltip |
| Center area | Truncated, tooltip |
| Region | |
| Team | |
| IM | |
| Plan Date | |
| Visit Type | |
| Visit # | Right-aligned, tooltip explains visit number |
| Target | Right-aligned |
| Achieved | Right-aligned; coloured: green ≥80%, amber ≥40%, red <40%; percentage shown in parentheses |
| Plan Status | Status badge |
| TL Status | **Clickable badge** — opens edit modal |
| Exec Status | Status badge |
| QC | Badge or "Not Applicable" |
| CIAG | Badge or "Not Applicable" |
| Issue Category | **Clickable button** (amber if issue set, gray if none) — opens edit modal |
| General | Remarks cell (click to edit inline) |
| Manager | Remarks cell (click to edit inline) |
| Team Lead | Remarks cell (click to edit inline) |
| Open | "View" button → Detail Modal |

**TL Status edit modal:** Status dropdown (all EXECUTION_STATUS_OPTIONS), Save / Cancel.

**Issue Category edit modal:** Category dropdown + "— None —" option, Save / Cancel.

**Detail Modal:** pills, hero stats, remarks, plan teams breakdown, visit history, attachments.

---

### 2.9 Work Done (`/pms/work-done`)

All completed billable work with financial totals.

**Summary cards (2 cards):** Executed Qty (total) · Revenue (SAR total).

**Toolbar:** Text search, All Billing Status (multi-select: Pending / Invoiced / Closed), All Teams, All Projects, All DUIDs, Date range, Clear. Export Excel. Refresh.

**Table columns:** POID, Item Code, Description, Activity Type, Project, DUID, Team, Executed Qty (right), Revenue (right), Billing Status badge, General Remark (inline edit), Submission Status (clickable button), Open (View button).

**Billing Status colour coding:**
- **Pending** — amber (work complete, billing not yet started or still in progress)
- **Invoiced** — green (commercial invoice submitted to customer)
- **Closed** — green (payment received, milestone fully closed)

Billing status is set **automatically** by PIC actions — you do not need to edit it manually here.

**Submission Status button** — click to open a modal to change status. Modal shows current status + dropdown for all BILLING_STATUSES + warning if applicable.

Backend (subcontracted) Work Done rows have a light gray row background to distinguish them.

---

### 2.10 Issues & Risks (`/pms/issues-risks`)

Track and manage execution issues across all teams.

**Toolbar:** Text search, All Issue Categories (multi-select), All Exec Status (multi-select), All TL Status (multi-select), All QC Status (multi-select), All CIAG Status (multi-select), All Projects (multi-select), All Teams (multi-select), All DUIDs (multi-select), Date range, Clear. Export Excel. Refresh. Selection + "Create Plans (N)" button.

**Table columns:** Checkbox, Plan, POID, Item Code, Description, Activity Type, Project, DUID, Team, Plan Date, Issue Category (clickable — amber button if set, gray if none), TL Status badge, Exec Status badge, QC Status badge, CIAG Status badge, General Remark (inline edit).

**Create Plans from Issues modal:** Identical to the Planning modal (see 2.7) but:
- Visit Type is pre-set to "Re-Visit"
- Summary shows "X selected issue records with X unique POIDs"
- Additional "Issue Remarks" textarea at the bottom

---

### 2.11 Backend (`/pms/backend`)

Manages work assigned to backend teams (work handled outside the normal field execution chain).

**Two tabs:** Pending (work not yet confirmed done) · Work Done (completed backend lines).

**Toolbar:** Text search, All Projects, All DUIDs, All Teams, Clear. Selection + "Mark Work Done" primary button. "View" button per row.

**Mark Work Done modal** (for selected pending lines):
- Shows list of selected POIDs
- **Completion date** field (required)
- **Remark** textarea
- Confirm button — creates a synthesised Work Done record for each selected line so revenue and PIC tracking work normally.

**Total SAR** for filtered rows and selected rows shown in the toolbar area.

---

### 2.12 Reports (`/pms/reports`)

Four script-based summary reports. Click a tab to load that report, then click **Refresh** to reload it.

| Tab | Content |
|-----|---------|
| Project Status Summary | All projects with status, budget, and actuals |
| Budget vs Actual | Per-project cost comparison table |
| Team Utilization | Team assignments and utilisation percentage |
| Daily Work Progress | Progress by team and date |

---

### 2.13 Time Logs (`/pms/timesheets`)

View of all execution time entries submitted by field teams across all teams.

**Header subtitle** shows: matching count (if search active) · loaded count · total hours.

**Summary cards (2):** Log lines (blue, shows count) · Total hours (green, sums `duration_hours`).

**Toolbar:** Text search (user, plan, team, project), Team ID filter (exact match text input), Date range, Clear. Export Excel.

**Table columns:** ID, User, Team, Rollout (Plan link), Start Time, End Time, Duration (hours, right-aligned), Notes.

---

### 2.14 Team Allocation Approvals (`/pms/approvals`)

Review and approve or reject Team Allocation Requests — IMs requesting to transfer a team to another IM.

A **red dot badge** on the Approvals nav link shows the count of pending items.

**Two tabs:** Awaiting Approval (with pending count badge) · History.

**Table columns:** Submitted Date/Time, Request Type (Team Transfer or Plan Cancellation), Team Name, New IM, Current IM, Reason, Status badge (Pending PM Approval=blue, Approved=green, Rejected=red).

**Decision modal:** Shows full request details, optional Remark textarea, **Approve** (primary) and **Reject** (secondary) buttons.

Success notice confirms: "✓ Request approved — team transferred" or "✓ Request rejected".

---

### 2.15 Expenses (`/pms/expenses`)

View all expense claims submitted by field teams across all IMs and teams.

Same interface as IM Expense Approvals (see section 3.12) but unscoped — shows everything.

**Toolbar:** Text search, IM filter, Team filter, Approval Status filter, Date range, Clear. Export Excel.

**Total SAR** calculated across filtered rows shown in the toolbar.

---

### 2.16 Operations Overview (`/pms/overview`)

Cross-cutting three-tab search tool.

- **DUID / Site tab** — enter a DUID or site code (optionally with a PO filter) to see all PO lines, rollout plans, execution records, and expense data for that site.
- **PO tab** — search by PO number to see all lines and dispatch status.
- **Acceptance tab** — acceptance-stage pipeline view showing all lines at acceptance milestone.

---

### 2.17 Material Requests (`/pms/im-material-request`)

PM view of all material transfer requests across all IMs. Identical to the IM Material Management page (see section 3.10) but unscoped — useful for monitoring and auditing that transfers are happening on schedule.

---

### 2.18 Masters (`/pms/masters`)

Reference data management. Card grid showing 12+ master data types, each with:
- Icon with colour-coded background
- Description text
- Live record count badge
- Click to expand → preview table of records with links to the Frappe Desk form for editing
- **+ New** button to create new records in Frappe Desk

Master types include: Area, INET Team, IM Master, Project Domain, Huawei IM, Subcontractor, Customer Item, Activity Cost, Item Catalog, Project, Customer, Visit Multiplier, Subcontractor Rates, Execution Category.

**Deep link:** `/pms/masters?expand=<DocType Name>` opens a specific card already expanded.

---

## 3. Implementation Manager (IM) Guide

The IM portal shows **only data for your teams and your projects**. Every list, filter, and metric is scoped to you automatically.

---

### 3.1 My Dashboard (`/pms/im-dashboard`)

Personal operations overview. **Auto-refreshes every 5 minutes.**

**Header:** Blue gradient banner showing "IM Dashboard – INet Telecom", your IM name, "Updated Xm ago" relative timestamp. Date range picker (defaults to this month). **Refresh** button (spins while loading).

**6 KPI tiles (one row):**

| Tile | Description |
|------|-------------|
| Total Assigned Sites | All sites dispatched to your teams in the selected period |
| Completed Sites | Sites with Completed execution status (green) |
| In Progress | Sites currently in execution (blue) |
| Delayed Sites | Sites past planned date with no completion (red) |
| Today's Target | Sites planned for today (indigo) |
| Today Completed | Sites completed today (green) |

**Project Progress panel (left, 2/3 width):** Progress bar per project showing completion %. Green bar ≥70%, amber ≥40%, blue below 40%.

**Team Performance panel (right, 1/3):** Up to 8 teams listed with sites done count.

**Site Status table (left, 2/3):** Columns: Site ID (monospace), Location, Project, Status (colour-coded badge), Last Update (relative time "Xm ago"), Issue (red if present). "View all →" link navigates to Rollout Execution.

**Issues & Escalations panel (right, 1/3):** Four counters:
- Critical Issues (red dot) — delayed sites count
- Pending Approvals (amber dot) — Team Allocation Requests awaiting response
- Open Dummy POs (purple dot)
- QC Fail Needs Action (green dot)

**Activity Timeline (1/3):** Recent execution events with relative timestamps ("5m ago", "2h ago") and event labels.

**Site Map (1/3):** Leaflet interactive map. Each site is a coloured circle pin — colour matches execution status: green=Completed, blue=In Progress/In Execution, red=Issue/Cancelled, amber=Hold/Postponed, yellow=Planned. Click a pin for a popup with site name, code, project, status badge, and last update. If no coordinates are set for DUIDs, shows a placeholder with instructions.

**My Performance panel (1/3):** Monthly Target (sites), Achieved (sites), Performance % with a green progress bar, and a legend (green=Completed, blue=In Progress, red=Delayed).

---

### 3.2 My Projects (`/pms/im-projects`)

All projects where you are the assigned Implementation Manager.

**Toolbar:** Text search, Project Status filter, Team filter, Clear.

**Table columns:** Project Code, Project Name, Status badge, Customer, Budget, Achieved %, Status.

Click a row or "View Details" to open the same Project Detail page as the PM role (five tabs: Overview, PO Lines, Rollout, Execution, Work Done).

---

### 3.3 My Teams (`/pms/im-teams`)

Your assigned field teams with members, warehouse, and work allocation.

**Table columns:** Team ID, Team Name, Field User (team lead), Warehouse, Active POIDs, Status.

Click a row to open the **Team Detail panel:**
- **Members tab** — roster of all team members
- **Stock tab** — current stock in the team's warehouse broken down by DUID and item
- **Team Allocation Requests tab** — incoming requests from other IMs to borrow this team. For each request: From IM, To IM, Reason, Status. **Accept** or **Reject** buttons with optional remark.

A **red dot badge** on the My Teams nav link indicates pending Team Allocation Requests.

**Edit team** inline — click the edit (pencil) icon on a row to edit Team Name and other details in a pop-over. Team Name is required.

---

### 3.4 PO Control (`/pms/im-po-intake`)

The first IM step in the workflow. Lines dispatched to you (auto or manually by the PM) land here before they have a target month assigned.

**Subtitle:** "Lines dispatched to you (auto or manual) that still need a target month. Pick lines and assign a month to move them to My Dispatches."

**Toolbar:**
- Text search (POID, PO, Item, Project, DUID)
- Mode dropdown: All modes / Auto / Manual
- All Projects (multi-select)
- All DUIDs (multi-select)
- Clear button
- Selection count + total SAR ("N selected · SAR X,XXX")
- **Dispatch (N)** button (blue) — assigns a target month
- **Assign to Backend (N)** button (purple) — only visible to IMs with backend capability enabled

**Table columns:** Checkbox, POID (monospace), Mode badge (Auto=violet, Manual=slate), PO No, Project, Item (monospace), Description (truncated, tooltip), Activity Type, Qty (right), Amount SAR (right), DUID (monospace, site name in tooltip), Center area (truncated), Dispatched On.

Auto-dispatched rows have a subtle violet background.

Click anywhere on a row to toggle its checkbox.

**Dispatch modal** (tap **Dispatch (N)** after selecting rows):
- Title: "Dispatch · N lines"
- Instruction: "Pick a target month. These lines will move into My Dispatches and become available for rollout planning."
- **Target month** dropdown — rolling 12-month list (current month + next 11), required
- Footer: Cancel · "Dispatch N lines"
- After success: green toast notification "Moved N lines to My Dispatches (target month YYYY-MM)"

**Assign to Backend modal** (tap **Assign to Backend (N)** after selecting rows — only shown if you have backend capability):
- Title: "Assign to Backend · N POIDs"
- Scrollable list of selected POIDs with PO No, Item Code, DUID
- **Backend Team** dropdown (required — lists active teams with category "Backend Team")
- **Note** textarea (optional — for scope/reference notes)
- Error if selected lines include Closed or Completed POIDs
- Footer: Cancel · "Assign N POIDs" (purple button)
- After success: green toast "Assigned N POIDs to backend team [name]"

**Export Excel** button. **Refresh** button.

---

### 3.5 Rollout Planning (`/pms/im-dispatch`)

Create and manage rollout plans for your dispatched lines (lines that have a target month assigned).

**Three tabs:** New (lines pending planning), In Progress, Completed.

**Toolbar:** Text search, Status filter, Project filter, Visit Type filter, DUID filter, Date range, Clear. Export Excel. Refresh. Selection + "Create Plans" button.

**Table columns:** Checkbox, POID (with "PLANNED" blue badge if already planned), Item Code, Description (tooltip), Activity Type, Project, DUID, Center area, Region, IM, Target Month, Line Amount (right), Open (View button).

**Footer** shows total row count, selected count, and total SAR of selected rows.

The Create Plans modal is identical to the PM Planning modal (see section 2.7): Lead team, Visit type, Additional Teams table with qty splitting, Access Details (start/end dates, access time, access period Day/Night), QC Required / CIAG Required toggles, Remark textarea.

**Edit dispatch details** — click the row's "View" button for the Detail Modal. From there you can edit manager remarks, general remarks, and team lead remarks inline.

---

### 3.6 Rollout Execution (`/pms/im-planning`)

Monitor the execution of your rollout plans in real time.

**Toolbar:** Month filter, Status filter (multi-select), Project filter, Team filter, DUID filter, Date range, Clear. Export Excel. Refresh.

**Table columns:** Plan name, POID (monospace), Item Code, Description, Project, DUID, Team, Plan Date, Visit Type, Visit #, Target (right), Achieved % (right, colour-coded), Plan Status badge, Exec Status badge, TL Status badge, QC badge, CIAG badge, Issue Category button, Manager Remark (inline edit), General Remark (inline edit), Open (View button).

**View button** opens the **Plan Detail modal:**
- Pills: Plan name, POID, Project, Team
- Hero stats: Target, Achieved, Achievement %
- Plan Teams Breakdown — all teams on this plan, their assigned qty, TL status, achieved qty
- Visit history — all visits for this POID with date, type, status
- Attachments section — photos uploaded by field team
- Remarks: general, manager (editable from here), team lead

**Manager Remark inline edit** — click the remark cell to edit directly in the table. The remark is visible to field team on the execution form.

---

### 3.7 Rollout Work Done (`/pms/im-execution`)

Review completed executions before they are finalised.

**Toolbar:** Status filter, Project filter, Team filter, DUID filter, Date range, Clear. Export Excel. Refresh.

**Table columns:** Plan, POID (monospace), Item Code, Description, Activity Type, Project, DUID, Team, Target (right), Achieved (right, %, colour-coded), Plan Status badge, Exec Status badge, TL Status badge, QC badge, CIAG badge, Manager Remark (inline edit), Open (View button).

**View button** opens the same Plan Detail modal as Rollout Execution. From here you can also **Generate Work Done** for completed plans.

---

### 3.8 Work Done (`/pms/im-work-done`)

Your finalised Work Done records with billing status from PIC.

**Toolbar:** Billing Status filter (Pending / Invoiced / Closed), Team filter, Date range, Clear. Export Excel. Refresh.

**Table columns:** POID, Item Code, Description, Project, DUID, Team, Executed Qty (right), Revenue (right), Billing Status badge, General Remark (inline edit), Open (View button).

Billing status is updated automatically by PIC actions — no manual editing needed from your side.

---

### 3.9 Issues & Risks (`/pms/im-issues-risks`)

Log and manage site-level issues for your teams. Create re-visit plans directly from issue rows.

**Toolbar:** Text search, Issue Category filter, Exec Status filter, TL Status filter, QC Status filter, CIAG Status filter, Project filter, Team filter, DUID filter, Date range, Clear. Export Excel. Refresh. Selection + "Create Plans" button.

**Table columns:** Checkbox, Plan, POID, Item Code, Description, Project, DUID, Team, Plan Date, Issue Category (clickable), TL Status, Exec Status, QC Status, CIAG Status, General Remark (inline edit).

Create Plans from selected issues — Visit Type pre-set to Re-Visit. Add Issue Remarks in the modal.

---

### 3.10 Material Management (`/pms/im-material-request`)

Manage the full materials chain for your teams. Four tabs:

#### Requests Tab

All active material transfer requests scoped to your teams.

**Toolbar:** Status filter (Pending Approval / Approved / Transferred / Rejected), POID filter, Team filter, Date range, Clear. Export Excel. Refresh.

**Table columns:** Request name, POID, DUID, Team, Warehouse, Request Date, Status badge, Items count, Total Qty, Actions.

**Click a row** to open the **Request Detail panel:**
- POID, DUID, Team, Requested By, Request Date
- Items table: Item Code, Item Name, Qty Requested, UOM, Material Type (Huawei or Company INET)
- **Approve** button — creates Material Transfer Stock Entry; stock moves from main warehouse to team warehouse
- **Reject** button — enter rejection remark

**Status badges:** Pending Approval (amber) · Approved (blue) · Transferred (green) · Rejected (red)

#### DUID Stock Tab

Overview of all DUIDs (Huawei delivery codes) with materials available in the main warehouse.

**Table columns:** DUID, Site Name, Received Items (count of item types), Remaining (items still available — received minus already-requested), Request (button, only shown when remaining > 0).

**Create Transfer Request form** (opens when you click Request on a DUID row):

The form has two distinct material sections:

**Huawei Materials** section (blue background):
- Auto-populates with items from this DUID's Huawei outbound receipt
- Columns: Item, Remaining qty, Request Qty (editable — reduce from max if needed), UOM
- You cannot add new items to this section; it shows only what was received from Huawei
- Message "No remaining Huawei items to request" if all have already been requested

**Company Materials** section (green background):
- INET-owned materials (consumables, tools, hardware not supplied by Huawei)
- **Search box** — type item code or name; a dropdown shows matching items with current stock level
- Select an item from the dropdown to add it to the list
- For each added item: Item Code (display only), Item Name, Qty (number input), UOM, Remove button
- Current stock level shown next to each item in the search results (green if >0, red if 0)

**Form fields above sections:**
- POID selector — search and select the work order this transfer relates to; auto-fills DUID and Team
- Team dropdown — destination team (auto-filled from POID if available)
- Remark text (optional)

A request can contain Huawei items only, Company items only, or both together.

Submit the request → it appears in the Requests tab as "Pending Approval". Then go to Requests tab → click the request → Approve → stock transfers.

#### Returns Tab

Incoming return requests from your field teams (unused or excess materials being sent back to main warehouse).

**Table columns:** Request name, Team, Items, Return Date, Status badge, Actions.

**Click a row** to see the full return request:
- Items list with return quantities
- **Approve Return** button — creates a Material Transfer Stock Entry (team warehouse → main warehouse)
- **Reject** button — enter rejection remark

Return requests are filtered out of the Requests tab automatically so they do not appear in the forward-transfer queue.

#### All Requests Tab

Complete history of all material requests (including completed and rejected) with full filter options. Same table as Requests tab but no status filter pre-applied.

---

### 3.11 Backend (`/pms/im-backend`)

**Visible only to IMs with backend assignment permission** (the "Backend" nav link only appears if your IM Master record has "Can Assign Backend" enabled). If you need this access, contact your Project Manager.

This page is for PO dispatch lines assigned to backend (external partner) teams — lines that go through a direct completion flow without a Rollout Plan or field execution form.

**Two tabs:** Pending (awaiting work done confirmation) · Work Done (completed).

**Toolbar:** Text search, Project filter, DUID filter, Team filter, Clear. Selection count + total SAR. "Mark Work Done" button.

**Pending tab columns:** Checkbox, POID (monospace), System ID, PO No, Item Code, Description, Project, DUID, Backend Team, Assignment Date, Remark.

**Mark Work Done modal** (after selecting rows):
- List of selected POIDs
- **Completion Date** (required)
- **Remark** (optional)
- Confirm button — creates a synthesised Work Done record for each line so revenue and billing tracking work normally. No Rollout Plan or execution form is needed.

**Work Done tab columns:** POID, Item Code, Project, DUID, Backend Team, Completion Date, Revenue, Remark.

---

### 3.12 Expense Approvals (`/pms/im-expense`)

Review and approve expense claims submitted by your field teams.

**Toolbar:** Team filter, Approval Status filter, Date range, Clear. Export Excel. Refresh.

**Total SAR** of filtered rows shown next to the filter controls.

**Table columns:** Claim name, Date, Team, Employee, Total Amount (right), Lines count, POIDs count, Status badge, Actions.

**Status badges:** Pending (blue) · Approved (green) · Rejected (red) · Paid (green with different style)

**Click a row** or "View" to open the **Claim Detail panel:**
- Date, Team, Employee name
- Total Claimed Amount
- **Expense Lines table:**
  - Expense Type
  - Description
  - Amount (SAR)
  - POID(s) linked — if multiple POIDs, the amount was split equally per POID
- **Approve** button — approves the claim; moves it to "Unpaid" state on the field user's side
- **Reject** button — enter a rejection reason (required); reason is visible to the field user

---

### 3.13 Reports (`/pms/im-reports`)

Five tabbed reports filtered to your data.

| Tab | Content |
|-----|---------|
| PO Dispatches | Summary of all your dispatched lines with status |
| Rollout Plans | All your plans with visit type, teams, dates |
| Executions | Executions this month — team, site, achievement |
| Work Done | Work Done records this month with billing status |
| Projects | Projects table with budget vs achieved |

Each tab has a date range and filter strip. Refresh button reloads the active report.

---

### 3.14 Time Logs (`/pms/im-timesheets`)

Time entries submitted by your field teams.

**Summary cards:** Log lines count (blue) · Total hours (green).

**Toolbar:** Text search (user, plan, team), Date range, Clear. Export Excel.

**Table columns:** ID, User, Team, Rollout (Plan link), Start Time, End Time, Duration (hours), Notes.

---

## 4. Field Team Guide

The field portal is designed for **mobile use on site**. Pages use a card-based layout optimised for touch and small screens.

---

### 4.1 Today's Work (`/pms/today`)

Your home screen. Shows all work your team has planned for today.

**Header:** Time-based greeting ("Good morning/afternoon/evening, [your first name]"), today's full date (e.g. "Monday, 26 May 2026"). Refresh button (spins while loading).

**Summary chips** (appear when plans are loaded):
- **Total** — total plan count for today
- **In Progress** (amber dot) — plans currently in execution
- **Planned** (blue dot) — plans not yet started
- **Done** (green dot) — plans marked Completed

Plans are **sorted by urgency:** In Progress (shown first) → Planned → Completed.

**Plan cards:**

Each plan appears as a card. The left border colour tells you the status at a glance:
- **Amber** — In Progress / In Execution
- **Blue** — Planned (not started)
- **Green** — Completed
- **Gray** — Cancelled

**Card contents:**
- Item description (large title)
- POID (bold) + Plan name (small, muted)
- **IM ✓ badge** (green, top right) — shown if your IM has confirmed this execution is completed
- **Status badge** — Planned / In Progress / Completed / Cancelled

**Card meta information (icons + labels):**
- Site code + site name (location pin icon)
- Activity type (speech bubble icon)
- Project code (clipboard icon)
- Visit type + "Your share [N]" (if you are one of multiple teams, shows your assigned qty) or "Qty [N]" (if single team). A purple badge "+N teams" appears if there are other teams on the same plan.
- Access time + period in parentheses (clock icon), e.g. "Access: 08:00 (Day)"
- **QC Not Required** amber badge — if the IM set QC not required for this plan
- **CIAG Not Required** amber badge — if the IM set CIAG not required
- **IM note callout** — if your IM left a note (Manager Remark), it appears as a highlighted callout at the bottom of the card meta

**Card footer:** "Tap to execute →" (if not yet started) or "Continue execution →" (if In Progress).

**Tap any card** to open the Execution Form for that plan.

**Empty states:**
- "All clear for today" + "Your team has no planned activities for today. Check back later or contact your IM."
- "No team assigned" + "Your account is not linked to a field team. Please contact your Implementation Manager." — appears if your account setup is incomplete.

---

### 4.2 Execute (`/pms/field-execute` or `/pms/field-execute/:planId`)

The main on-site execution form. Opens from Today's Work or directly via URL.

If opened without a plan ID, shows a **list of all actionable plans** (Planned + In Execution + Planning with Issue) for your team. Tap one to open the form for that plan.

#### Timer section (top of form)

A **live elapsed time** counter shows how long execution is running.

- **Start Timer** (play icon) — starts the time log for this plan. Only one timer can run at a time across all your plans.
- **Stop Timer** (stop icon) — stops the running timer. The time is logged.
- If a timer is running **on a different plan**, a warning shows: "A timer is running on [other plan name]". You can stop it here before starting this one.
- Timer busy state shows spinner; timer errors show inline in red.

#### Plan information header

Shows: Item description, POID, site code, activity type, project, visit type, target qty.

**IM Note callout** — if your IM left a note (Manager Remark), it appears here as an amber/blue callout box above the form fields.

**Plan Teams Breakdown** — shows all teams on this plan and their assigned quantities (useful on multi-team plans).

**IM confirmed badge** — green "IM ✓" badge if the IM has confirmed this execution.

#### Form fields

**Execution Status** dropdown (required):
- In Progress
- Completed
- Hold
- Cancelled
- Postponed

**Achieved Quantity** (number input, decimal allowed):
- Pre-filled automatically from the plan's target quantity
- Adjust if the actual quantity done is different

**QC Status** dropdown (only shown if QC is required for this plan):
- Pending
- Pass
- Fail
- N/A

**CIAG Status** dropdown (only shown if CIAG is required for this plan):
- Open
- Submitted
- Accepted
- Rejected

**GPS Location:**
- **Capture GPS** button — reads your device location. Shows "Lat, Lon (±Xm)" after capture.
- Or type coordinates manually in the text field.
- Accuracy is shown in parentheses (e.g. ±12m).

**Team Lead Remark (TL Remark):**

A smart remark system with two components:

1. **Remark picker** (searchable dropdown):
   - Click to open a searchable list of saved remark templates
   - Type to filter the list
   - Selected remarks appear as chips below the picker; click the × on a chip to remove it
   - If your typed text doesn't match any template, a **"+ Add '[text]' as new remark"** option appears at the bottom — tap it to save as a new template and pick it simultaneously
   - Multiple remarks can be picked and combined

2. **Extra free-text textarea** — for anything not covered by templates; appended below the picked template remarks on save.

Previously saved remarks from this plan pre-fill on load so re-editing doesn't lose prior text.

**Materials section:**

Shows all materials transferred to your team warehouse for this POID.

For each material item:
- **Item name** and item code (monospace)
- **Status badge**: "In Warehouse" (green, stock has been transferred) or "Pending" (amber, transfer not yet done)
- **Transferred qty** — how much was sent to your warehouse
- **Used qty input** — editable number field (max = transferred qty, pre-filled with transferred qty). Adjust downward if you used less than what was sent.

If no materials are assigned to this POID yet, shows "No materials assigned for this POID yet."

**Inline Expense section:**

Log site expenses directly from the execution form without opening the Expense page separately.

For each expense line:
- **Expense Type** dropdown (required)
- **Amount** (SAR, required, must be > 0)
- **Description** text (optional)
- **+ Add** button — adds the line to a queued list

Queued expense lines shown as a table below the form (Type, Amount, Description, Remove button). These are submitted together with the execution form.

**Photos / Attachments:**

- **Camera button** — opens the device camera or file picker. Upload photos from your phone or tablet.
- Uploaded photos show as thumbnail previews immediately (local preview while uploading).
- Each photo has a **Remove** button (×).
- Upload progress shows the pending thumbnail greyed out while uploading.
- Upload errors show inline in red.

#### Submit

The **Save** button submits all fields: execution status, achieved qty, QC/CIAG status, GPS, TL remarks, material usage, inline expense lines, and photos.

When status is **Completed**, the system automatically creates a Work Done record.

**After a successful submission:**
- Success state with "All Done!" message
- IM ✓ badge on the card in Today's Work if IM has confirmed
- Navigate back to Today's Work using the back arrow

---

### 4.3 QC / CIAG (`/pms/field-qc-ciag`)

Quality check and Customer Inspection and Acceptance (CIAG) forms. Separate from the execution form for cases where QC/CIAG needs to be completed independently.

For each active plan:
- **QC Status** select (Pass / Fail / N/A) + QC Remark textarea + photo upload
- **CIAG Status** select (Submitted / Accepted / Rejected / Open) + CIAG Remark textarea + photo upload
- **Save & Complete** button per section

---

### 4.4 History (`/pms/field-history`)

Read-only log of all previous work completed by your team.

**Toolbar:** Date range, Activity Type filter, Status filter. Export Excel.

**Table / card list columns:** Plan name, POID, Item Description, Site, Project, Visit Type, Plan Date, Status badge, Achieved Qty, Remarks.

---

### 4.5 My Stock (`/pms/field-my-stock`)

View all materials currently in your team's warehouse and submit material return requests.

**Header:** Team name, last-updated note. Stock is updated automatically when your IM approves a transfer — no refresh or confirmation needed.

**Stock list — each item is a card:**
- **Item Name** (large, bold)
- Item code (monospace, small)
- **Quantity** (large number, right-aligned) + UOM (e.g. Nos, Meters)
- **Material type badge:**
  - **Huawei** (amber badge) — customer-provided material from a Huawei outbound delivery
  - **Company (INET)** (blue badge) — INET-owned material (consumables, tools, hardware not from Huawei)
- **Left border colour:** amber = Huawei · blue = Company (INET)
- Tap the "▼ X DUIDs" button on a card to **expand** and see which delivery codes (DUIDs) this stock came from, and how much came from each delivery

#### Returning Materials

If you have unused, excess, or incorrectly delivered materials to send back to the main warehouse:

1. Tap **Return Materials** button (at the top of the stock page).
2. A form opens listing all items currently in your stock with checkboxes.
3. **Check** each item you want to return. Checking an item pre-fills the full available quantity — reduce it if returning only part.
4. Validation: the system will not allow a return quantity greater than your current stock.
5. Enter a **Reason** (required) — describe why (unused, damaged, wrong delivery, project cancelled, etc.).
6. Tap **Submit** — the return request is created and sent to your IM for approval.
7. After IM approval, stock moves back to the main warehouse automatically.

**Returns History section** (below the stock list): All your past return requests with their current status.

**Return request status values:**

| Status | Meaning |
|--------|---------|
| Pending | Submitted, awaiting IM approval |
| Approved | IM approved, stock transferred back |
| Rejected | IM rejected, stock stays in your warehouse |

---

### 4.6 Expenses (`/pms/field-expense`)

Submit expense claims for project-related costs (fuel, accommodation, meals, tools, etc.) and track their approval status.

> **Note:** The **+ New Claim** button is only active if your user account has an Employee record linked. If the button appears greyed out, contact your IM.

**Your claims list has four tabs:**

| Tab | Shows |
|-----|-------|
| **Pending** | Submitted claims waiting for IM decision |
| **Unpaid** | Approved but payment not yet made to you |
| **Paid** | Fully settled claims |
| **All** | Complete claim history |

**Tab total** (SAR sum of visible claims) shown in the header, colour-coded by tab: amber for Pending, dark amber for Unpaid, green for Paid, blue for All.

**Claim card layout:**
- Claim name (document ID)
- Status badge + Payment badge
- Posting date
- Line count + POID count (e.g. "3 lines · 2 POIDs")
- Total SAR amount (bold, right-aligned)
- Remark (italic, gray)
- **Left border colour:** blue=pending, amber=approved/unpaid, green=paid, red=rejected

Tap any card to open the **Claim Detail modal:**
- Claim name, date, team
- Expense lines table: Type, Description, Amount, POID(s)
- IM's rejection reason (if rejected)

#### Creating a New Claim

1. Tap **+ New Claim**.
2. **Date** — claim date (defaults to today, required).
3. **Team** — pre-filled from your team assignment (read-only).
4. **Remarks** — optional overall note (e.g. "Jeddah North site visit, 3 days").
5. Add expense lines — tap **+ Add Expense Line** for each cost:

   | Field | Required | Notes |
   |-------|----------|-------|
   | Expense Type | Yes | Select from dropdown (Travel, Accommodation, Meals, etc.) |
   | Description | No | Short description of the cost |
   | Amount (SAR) | Yes | Must be > 0 |
   | POID | Yes | Select the work order this cost relates to |

6. **Single POID vs Multi-POID mode** — each line defaults to Single POID. Toggle to **Multi-POID** to link the cost to multiple work orders at once. When multiple POIDs are selected, the system shows a live split preview:

   > *SAR [amount] ÷ [N] POIDs = SAR [amount each]*

   The total amount is divided equally across all selected POIDs. Use this when one trip or expense covers work on several sites.

7. **Running total** — a "Total: SAR X,XXX" indicator updates as you add lines.
8. Tap **Submit Claim** — the claim is sent to your IM. You cannot edit it after submission.

**Validation rules:**
- Expense type required for every line
- Amount must be a positive number
- At least one POID required per line

**Claim status flow:**
```
Submitted → Pending (IM review) → Approved → Unpaid → Paid
                                → Rejected (with reason visible to you)
```

---

### 4.7 Time Log (`/pms/field-timesheet`)

Record your daily working hours per plan.

**Summary card** at top: total log entries count + total hours for the selected period.

**Log entry form:**
- Plan — select from your active plans
- Date — defaults to today
- Start Time — time picker
- End Time — time picker
- Duration — calculated automatically from start/end
- Activity Type — dropdown (Execution, Travel, Setup, etc.)
- Remark — optional text

**Tap Add** to log the entry.

**Logged entries list:** Date, Start, End, Duration (hours), Activity, Remark, Edit button, Delete button.

---

## 5. PIC (Project Invoice Controller) Guide

The PIC role manages the billing pipeline from completed work to payment received. Every PO line has **two milestones tracked independently**: MS1 (first milestone) and MS2 (second milestone).

---

### 5.1 PIC Dashboard (`/pms/pic-dashboard`)

Top-level financial view of the entire invoicing pipeline. **Auto-refreshes every 5 minutes.**

**Header:** Date range picker (defaults to all time), Refresh button. Admin users also see a **role switcher** to view a specific PIC's data.

**Pipeline bucket cards** — the full billing journey shown as status cards, each with total SAR, line count, and % of total pipeline:

| Status | Meaning |
|--------|---------|
| Work Not Done | Site not yet completed by field team |
| Under Process to Apply | Preparing submission documentation |
| Under I-BUY | Submitted into Huawei I-BUY approval system |
| Under ISDP | Submitted into ISDP approval system |
| I-BUY Rejected | Returned from I-BUY — needs correction and resubmission |
| ISDP Rejected | Returned from ISDP — needs correction and resubmission |
| Ready for Invoice | Approved by systems — ready to raise commercial invoice |
| Commercial Invoice Submitted | Invoice raised and sent to customer |
| Commercial Invoice Closed | Payment received; milestone fully closed |
| PO Need to Cancel | Line flagged for cancellation review |
| PO Line Canceled | Line has been formally cancelled |

**Other panels:**
- **Monthly revenue trend** — stacked bar chart by month
- **INET vs Subcontracted split** — donut chart showing revenue proportion
- **Pending I-BUY queue** — table of lines currently in I-BUY, sorted by age (oldest first)
- **Pending ISDP queue** — same for ISDP
- **KPI summary (bottom):** Total pipeline SAR · Closed SAR · Cancelled SAR · Total line count

---

### 5.2 PIC Tracker (`/pms/pic-tracker`)

Your main daily working page. Every active PO line is here. Filter, edit, and bulk-update billing statuses.

**Toolbar:** Text search, PIC Status MS1 (multi-select), PIC Status MS2 (multi-select), All Projects (multi-select), All DUIDs (multi-select), Clear, Refresh, **Download CSV**, row limit selector.

**Selection:** Checkboxes + select all. "N selected" count + **Bulk Update (N)** button appear when rows are selected.

**Totals row** at the bottom of the table sums all monetary columns over the current loaded rows (aligns with the columns even after Manage Table reshuffling).

**Table columns (all visible by default, reorderable via Manage Table):**

| Column | Notes |
|--------|-------|
| Checkbox | For bulk actions |
| Contract | Contract model |
| POID | Monospace |
| System ID | Monospace, small |
| PO No | |
| Project | |
| Project Name | |
| Item Code | |
| Item Description | |
| DUID | Site code |
| Site Name | |
| Qty | Right-aligned |
| Unit Price | Right-aligned |
| Line Amount | Right-aligned |
| Tax Rate | |
| Payment Terms | |
| SQC Status | |
| PAT Status | |
| PIC Status (MS1) | **Colour-coded status pill** |
| I-BUY/ISDP Owner | Owner name (MS1) |
| Detail Remarks (MS1) | |
| Applied Date (MS1) | |
| MS1 % | |
| MS1 Amount | Right-aligned |
| MS1 Invoiced | Right-aligned |
| MS1 Unbilled | Right-aligned |
| MS1 Invoicing Month | |
| MS1 iBuy/INV Date | |
| MS1 Payment Received | |
| PIC Status (MS2) | Colour-coded status pill |
| I-BUY/ISDP Owner (MS2) | Owner name (MS2) |
| Detail Remarks (MS2) | |
| Applied Date (MS2) | |
| MS2 % | |
| MS2 Amount | |
| MS2 Invoiced | |
| MS2 Unbilled | |
| MS2 Invoicing Month | |
| MS2 iBuy/INV Date | |
| MS2 Payment Received | |
| Remaining Milestone % | Auto-calculated |

**Status pill colour coding:**
- **Blue** — Ready for Invoice
- **Purple** — Under I-BUY
- **Darker purple** — Under ISDP
- **Amber** — Under Process to Apply / Pending
- **Red** — Rejected / Cancelled
- **Green** — Invoice Submitted / Closed / Accepted

**Auto-status rule:** Lines with no status manually set show "Under Process to Apply" when site work is done, or "Work Not Done" when it hasn't started. Once you set a status it is stored. To return to the automatic default, clear the field in the edit panel.

#### Edit a row (single-line editing)

Click anywhere on a row to open the **edit popover**. Three tabs:

**MS1 tab:**
- PIC Status (MS1) — dropdown (all PIC status options)
- I-BUY/ISDP Owner — free text (person responsible in I-BUY or ISDP)
- Detail Remarks — free text note
- MS1 Applied Date — date (validated: cannot be in the future)
- MS1 iBuy Invoice Date — date (validated: cannot be in the future)
- MS1 Invoice Month — month picker
- MS1 Payment Received Date — date (validated: cannot be in the future)

**MS2 tab:** Same fields for MS2 milestone.

**Acceptance tab:**
- SQC Status — dropdown
- PAT Status — dropdown

**Save** / **Cancel** buttons. Validation errors shown inline (e.g. "MS1 Applied Date cannot be in the future").

#### Bulk Update

Select multiple rows → click **Bulk Update (N)**. Modal fields:
- **Milestone** — MS1 or MS2 (radio)
- **Status** — dropdown (all PIC status options)
- **Remark** — optional note
- Confirm button — updates all selected POIDs at once

#### Download CSV

Exports all currently loaded rows (respecting active filters) as a CSV file named `pic-tracker-YYYY-MM-DD.csv`. Includes all columns listed above plus date fields trimmed to YYYY-MM-DD for spreadsheet compatibility.

---

### 5.3 Invoice Tracker (`/pms/pic-invoice-tracker`)

Focused view for lines at "Ready for Invoice" or beyond. Use this to create invoices and close milestones.

**Toolbar:** Text search, Status filter, Project filter, Date range, Clear. Refresh.

**KPI pills** at the top (update with filters): MS1 Total · MS1 Invoiced · MS2 Total · MS2 Invoiced (SAR values across current view).

**Table columns:** Checkbox, POID (monospace), System ID, Item Code, Description, Project, DUID, MS1 Status (pill), MS2 Status (pill), Remaining % (auto-calculated, right-aligned), Linked Invoices (all Sales Invoices raised against this line), Actions.

**Create Sales Invoice** (select ready lines → click button):
- The system detects whether to invoice MS1 or MS2 for each selected line
- Sets correct amounts, quantities, and line references automatically
- Creates one or more Sales Invoice documents in ERPNext

**Mark Submitted** — bulk-advance selected lines to "Commercial Invoice Submitted".

**Mark Closed** — bulk-advance selected lines to "Commercial Invoice Closed".

**Automatic status updates:** When a Sales Invoice is submitted in the ERPNext system, the linked PO line automatically advances to "Commercial Invoice Submitted" and the Work Done billing status becomes "Invoiced". No manual update required.

---

### 5.4 PIC Reports (`/pms/pic-reports`)

Five reports for analysing the invoicing pipeline.

| Report | What it answers |
|--------|----------------|
| Acceptance Aging | Which acceptances have been pending the longest (sorted by age) |
| Submission vs Approval | How long approval takes after submission per project |
| Monthly Invoicing | Month-by-month invoiced amounts (trend chart + table) |
| INET vs Subcontracted | Revenue split between own teams and external partners |
| Pending by Owner | Which lines are waiting on which person and for how long |

Each report has a date range filter strip. **Export to CSV** button. **Refresh** reloads the active report.

---

### 5.5 How PIC status drives Work Done billing

As PIC updates milestone statuses, the **Billing Status** on Work Done (visible to PM and IM) updates automatically:

| PIC action | Work Done billing shows |
|------------|------------------------|
| Any status up to "Ready for Invoice" | **Pending** |
| "Commercial Invoice Submitted" | **Invoiced** |
| "Commercial Invoice Closed" (all milestones resolved) | **Closed** |

No manual update is needed on the Work Done side.

---

## 6. End-to-End Workflow Example

1. **PM uploads PO file** → Work order lines appear in the system.
2. **PM dispatches** → Lines assigned to IMs with a target month (Auto or Manual mode).
3. **IM opens PO Control** → Reviews incoming lines, assigns target month → lines move to Rollout Planning.
4. **IM creates rollout plan** (or PM does from Planning page) → Visit date, lead team, any additional teams, QC/CIAG toggles, access time set. Field team sees the work in Today's Work on the plan date.
5. **IM receipts Huawei delivery** → Creates Material Receipt Stock Entry from Huawei Outbound Plan.
6. **IM creates material transfer request** → DUID Stock tab → click Request → fills Huawei and/or Company materials sections → submits → approves → stock moves to team warehouse.
7. **Field team executes on site** → Opens Today's Work → taps the plan card → starts timer → sets status to In Progress → fills achieved qty, materials used, QC/CIAG status, GPS, photo, TL remarks → submits.
8. **Work Done created automatically** when status is Completed → Revenue, cost, and margin calculated.
9. **PIC tracks billing** → PIC Tracker → edits each line: MS1 Applied Date → I-BUY Owner → advances status from Under Process → Under I-BUY → Under ISDP → Ready for Invoice.
10. **PIC creates Sales Invoice** → Invoice Tracker → select ready lines → Create Sales Invoice → one click generates the invoice.
11. **Invoice closed** → Payment received → PIC marks "Commercial Invoice Closed". Work Done shows Closed. Dashboards reflect final numbers within 5 minutes.

---

## 7. Common Questions & Troubleshooting

| Problem | Solution |
|---------|---------|
| Dashboard shows stale data | Press **Ctrl+Shift+R** (Windows) or **Cmd+Shift+R** (Mac) to force a full page reload. Dashboards auto-refresh every 5 minutes. |
| I can't see my teams or projects | Contact your system administrator to verify your user account, IM Master record, and team links. |
| PO Upload row shows an error | Verify the item code and project code exist in the Masters; contact your PM if unsure. |
| Work Done billing status stuck on Pending | The PIC team updates this as they process milestones — no action needed from your side. |
| Material Request button not showing for a DUID | All received items for that DUID have already been requested; remaining quantity is zero. |
| IM dashboard empty or showing wrong data | Contact your administrator to link your user account to your IM Master record and assign teams. |
| Backend nav link not showing in IM sidebar | Your IM Master record needs "Can Assign Backend" enabled. Contact your Project Manager. |
| Invoice Tracker "Create Sales Invoice" fails | Check that the Customer and Item Code are set on the PO line. Also verify the item has a valid billing rate in Customer Item Master. |
| Return request submitted but stock hasn't moved | The IM needs to approve the return from the Returns tab in Material Requests. |
| Expense claim stuck on Pending | Your IM reviews claims from the Expense Approvals page. Follow up with them directly. |
| + New Claim button is greyed out on Expense page | Your user account must be linked to an Employee record. Contact your IM or administrator. |
| Expense claim not appearing in IM's Approvals list | The claim routes to the IM assigned to your team. Verify your team has a correct IM assigned. |
| Team Allocation dot on IM sidebar | You have pending Team Allocation Requests to respond to — open My Teams to review and Accept or Reject. |
| Billing status shows Invoiced but I submitted a Draft invoice | Only **Submitted** (not Draft) Sales Invoices trigger the automatic status update. Submit the invoice in ERPNext first. |
| GPS fails to capture | Check that your browser has location permission. On mobile, ensure Location Services is enabled for the browser. The form allows manual coordinate entry as a fallback. |
| TL Remark templates not appearing | Templates are saved per-user. Type a remark in the picker and tap "+ Add" to create your first template. |
| Plan shows "QC Not Required" / "CIAG Not Required" | The PM or IM unchecked those workflow toggles when creating the plan. You do not need to fill QC/CIAG status for that plan. |
| "No materials assigned for this POID yet" in execution form | The IM has not yet approved a material transfer request for this work order. Contact your IM. |
