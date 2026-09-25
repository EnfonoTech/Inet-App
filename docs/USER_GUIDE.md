# INET Operations Command Center — User Guide

**Portal:** `https://<your-site>/pms/`
**Sign in** with your company email address and password.

---

## 1. Overview

The Command Center runs telecom rollout work end to end — from the customer's purchase order to the supplier invoice — in one browser portal.

**Work order lifecycle**

```
PO Upload → Dispatch to an IM → Forecast → Plan → Execute → Work Done → Invoice
```

**Materials lifecycle (runs alongside)**

```
Huawei delivery → Main warehouse → Team warehouse → Used on site → Returned if unused
```

### 1.1 Roles

| Role | Who uses it | What they see |
|---|---|---|
| **Project Manager (PM)** | Operations management | Everything: all dashboards, teams, projects, financials, approvals, masters |
| **Implementation Manager (IM)** | Site manager | Their own lines, teams, plans, materials, expenses and reports |
| **Field Team** | On-site engineers | Today's work, the execution form, team stock, expenses, time log |
| **PIC** | Invoice controller | The billing pipeline, customer invoices and subcontractor POs |

The portal shows the layout for your role automatically. You only see the pages that apply to you.

### 1.2 The working week

The week runs **Saturday to Friday**. Every week picker, weekly view and weekly report uses that, so "this week" means the same thing everywhere in the portal.

A week is named by its Saturday. In month pickers the first week usually starts in the previous month — October 2026 opens with `W1 · Sep 26 – Oct 2` — so the label always carries the real dates.

### 1.3 Controls you'll find on every data page

- **Search** — filters as you type. You can paste a list of POIDs separated by spaces, commas, tabs or new lines and it will match all of them.
- **Filter dropdowns** — multi-select for Status, Project, Team, DUID and so on.
- **Column filters** — click the small arrow in any column header for a searchable, tick-box list of the values that column actually holds, plus `(Blanks)` and a `Contains "…"` option. These cover the whole dataset, not just the rows on screen.
- **Clear** — resets every active filter. Appears once at least one is set.
- **Rows to load** — at the bottom of each table: **20 / 100 / 500 / 2500 / All**. It resets to 20 each time you open the page, for a fast first paint.
- **Export Excel** — exports what you are looking at, filters and sorting included. On a capped view the export still fetches every matching row.
- **Refresh** — lists do not poll; click Refresh for the latest state.
- **Manage Table** — show, hide, reorder and resize columns. Your layout is saved per page, per user.

### 1.4 Attachments

Files attach to most records. Anything larger than the site's upload limit is refused with the size and the limit named — use **Attach via web link** for those and paste a shared link instead.

---

## 2. Project Manager (PM)

The PM sidebar has twenty entries. Login lands on the **Command Dashboard**.

### 2.1 Dashboard (`/pms/dashboard`)

Live operations overview, built to sit on a wall display. Auto-refreshes every five minutes.

**KPI row**

| Tile | Meaning |
|---|---|
| Open PO Lines | Lines not yet Completed |
| Open PO Value | Their total SAR value |
| Planned Activities | Scheduled in the range — amount and count |
| In Progress | Started, not yet finished |
| Work Done | Recorded in the range — amount and count |
| Closed | Every milestone through PIC — amount and count |
| Re-Visits | Return visits to a site |
| Dummy POs | Placeholder lines still to be mapped to a real PO |

**Work Done and Closed do not overlap.** Together they account for all recorded work in the period: Work Done is what still has billing to run, Closed is what PIC has finished.

**Rows below:** INET teams (count, cost, target, achieved, gap) · Subcontractors (count, target, revenue, expense, gap) · Backend teams (active, pending, completed) · Company financials (target, achieved, gap, cost, profit, coverage).

**Panels:** Top 5 Teams · IM Performance · Team Status chart · Action Watchlist.

Colour: green on target · amber warning · red at risk · blue neutral.

### 2.2 The other dashboards

Reached from the sidebar or the switcher at the top of any dashboard.

| Dashboard | For | Shows |
|---|---|---|
| **CEO** (`/pms/ceo-dashboard`) | Senior management | Revenue, net profit, active projects, pending invoices, coverage |
| **Commercial** (`/pms/commercial-dashboard`) | Sales | PO published value vs invoiced value, monthly invoicing, top projects and subcontracts |
| **PM** (`/pms/pm-dashboard`) | Project health | Active / on track / at risk / delayed, budget vs actual |
| **Operations** (`/pms/ops-dashboard`) | Delivery | Revenue per IM, team distribution, billing overview |
| **Financial** (`/pms/financial-dashboard`) | Finance | P&L, cost breakdown, invoicing pipeline |
| **IM view** (`/pms/im-dashboard-view`) | Monitoring one IM | The IM's own dashboard, read-only |

On the Commercial dashboard, a PO line is dated by **when it reached us** — the day it was uploaded. Lines that predate upload logging fall back to the customer's publish date, then the PO start date; the note under the chart says how many lines sit on each.

### 2.3 Projects (`/pms/projects`)

Every Project Control Center record.

**Columns:** Project Code, Name, Status, Customer, IM, Budget, Unloaded, Dispatched, Planned, Executed, Billed.

**+ Create Project** captures code, name, status, customer, IM, centre/area, project domain, Huawei IM and budget.

**Project detail** (View Details) has five tabs: **Overview**, **PO Lines**, **Rollout** (plans grouped by DUID), **Execution**, **Work Done**.

> Set **Huawei IM** and **Project Domain** on the project. Lines inherit them, and planning asks for them line by line when they are missing.

### 2.4 PO Upload (`/pms/po-upload`)

Two modes, chosen by tab.

**Standard upload** — a three-step wizard for current POs.

1. **Upload** — pick the customer, drop the `.xlsx`.
2. **Review** — valid and error rows are listed separately, with advisories for item codes that will be created and project codes that are missing. Rows with missing projects do not import. Confirm is blocked while any error row remains.
3. **Confirm** — a summary of lines imported, duplicates skipped, lines already closed or cancelled, and POs created or appended.

Closed and cancelled lines are refused here by design — bring those in through the Archive tab.

**Archive upload** — historical closed and cancelled POs from the Master Tracker (`.xlsb`, `.xlsx` or `.csv`). The import runs in the background; you can close the page and come back to the status panel.

**Upload History** lists every run with its counts and a View button for the full per-PO breakdown.

> Do the Standard upload for the current month first, then Archive imports for earlier months in date order.

### 2.5 PO Dump (`/pms/po-dump`)

Full inspection and export of PO line data across all periods. Filter by date range and by OPEN / CLOSED / CANCELLED, search across every field, and export the filtered view.

### 2.6 Dispatch (`/pms/dispatch`)

Assign PO lines to an IM.

**Tabs:** Pending Dispatch · Dispatched · All Lines.

Select lines and **Dispatch Selected** to choose the IM and the planning mode (Plan or Direct). Auto-dispatched rows carry a violet tint and a Mode badge; **Convert to Manual** moves them, optionally reassigning the IM at the same time.

### 2.7 Planning (`/pms/planning`)

Create rollout visits for dispatched work.

**Scope:** Unplanned (default) · All POIDs (re-plan).

**Create Plans** asks for the lead team, visit type, planned start and end dates, access time and access period, and optionally extra teams with a quantity split. QC Required and CIAG Required are on by default; turning one off means the field team is not asked for that step.

**Visit types**

| Type | Multiplier | Use for |
|---|---|---|
| Execution | 1.0× | The work itself |
| Re-Visit | 0.5× | Going back after an issue |
| Extra Visit | 1.5× | Extra mobilisation |

**A visit can take more than one plan.** If the work needs two dates, or two teams on two dates, create a second **Execution** plan — it joins the same visit rather than counting as another attempt. Only **Re-Visit** and **Extra Visit** advance the visit number.

### 2.8 Execution Monitor (`/pms/execution`)

Read-only view of execution across every team, with filters for plan status, execution status, visit type, project, team, DUID and date.

An **Execution Analytics** tab sits beside it: attention buckets, breakdowns across many dimensions, repeat-visit and busiest-site concentration, and a monthly trend. Every tile opens the exact list of records behind it, so a number and the list it leads to always agree. Controls let you include closed work and past visits, which the list view hides by default.

### 2.9 Work Done (`/pms/work-done`)

Every Work Done record, with its billing state.

Rows whose milestones have all reached a terminal PIC status are hidden — this is a working list, not an invoicing archive. **Billing status is derived from PIC**, not stored separately: Commercial Invoice Closed or PO Line Canceled read as **Closed**; Submitted, Ready for Invoice, Under I-BUY or Under ISDP read as **Invoiced**; anything else PIC has touched reads as **Pending**.

### 2.10 Issues & Risks (`/pms/issues-risks`)

Plans flagged with an issue. Select rows and re-plan them from here; the modal asks for the team, dates and access window, and for Huawei IM or Project Domain only when the selected lines have neither their own value nor one from their project.

### 2.11 Backend (`/pms/backend`)

Lines handed to a non-field team. Backend work stays out of the rollout chain: no plan, no execution, and its Work Done is recorded directly.

### 2.12 Reports (`/pms/reports`)

A catalogue of 21 reports across **Teams & Utilization**, **Performance**, **Project Reports**, **Rollout & Delivery**, **Commercial**, **Client / Domain**, **CIAG Site Sign & Verify** and **Material Reports**. Pick a category, pick a report, set the filters, then switch between table and chart and export.

Team reports include every team whatever its status — a team on leave this week still did last month's work.

### 2.13 Time Logs (`/pms/timesheets`)

Field time entries. Opens on the current week (Saturday–Friday).

### 2.14 Approvals (`/pms/approvals`)

Team allocation requests from IMs, and plan cancellation requests. Approving a cancellation cancels the plan and returns the line to Dispatched.

### 2.15 Teams (`/pms/teams`)

Every INET team: its members, category (field or backend), subcontractor, daily cost, the IM it belongs to and its status.

A team's status controls where it can be picked, not where it appears. An inactive team is kept out of assignment and forecast pickers, but stays in reports, because the work it did is still the company's work.

### 2.16 Expenses (`/pms/expenses`)

Project expense claims after IM approval.

### 2.17 Search / Overview (`/pms/overview`)

One search box across POIDs, DUIDs, projects, plans and executions.

### 2.18 PIC Overview (`/pms/pic-overview`)

A read-only roll-up of the invoicing side — the PIC pipeline without the controls.

### 2.19 Subcon PO (`/pms/pic-subcon-po`)

The supplier side: Purchase Orders raised to subcontractors. See section 5.9 — the page is the same one PIC uses.

### 2.20 Material Management (`/pms/im-material-request`)

Warehouse and material requests across all teams.

### 2.21 Masters (`/pms/masters`)

Reference data: subcontract masters, DUIDs, projects, domains, Huawei IMs, activity types, visit multipliers and settings.

---

## 3. Implementation Manager (IM)

Fourteen pages, plus **Backend** when your IM record allows backend assignment.

### 3.1 My Dashboard (`/pms/im-dashboard`)

Your own work for the chosen date range.

**Tiles:** Assigned Plans · Completed Plans · In Execution · Delayed Plans · Today's Target · Today Completed.

**Direct & Backend Closes** appears when you have closed lines without a plan: how many, how many today, the revenue and the average per line, then breakdowns by route, by subcontractor and by milestone. Plan-based tiles read zero for that work because it never had a plan — this section is where it shows.

**My Performance** counts a directly-closed line on both sides: it was assigned to you and finished by you.

Other panels: Project Progress · Team Performance · Site Status · Issues & Escalations · Activity Timeline · Site Map.

You do not need a team to use the dashboard. An IM who only closes lines directly still sees revenue and performance.

### 3.2 My Projects (`/pms/im-projects`)

The projects assigned to you, with progress and budget.

### 3.3 My Teams (`/pms/im-teams`)

Your teams, their members, daily cost and status. Request a team from another IM here; the PM approves it under Approvals.

### 3.4 PO Control (`/pms/im-po-intake`)

Where lines arrive and are prepared for rollout.

**Tabs:** PO Intake · Dummy POs · All POIDs · Transfers. Dummy POs and Transfers carry a count badge when something needs attention.

**Setting the forecast** promotes lines from PO Intake into My Dispatches. It asks for:

- **Month** — required.
- **Week** — required. Weeks run Saturday to Friday and the picker lists every week that touches the month, so the first option often begins in the previous one.
- **Date** — optional, and must fall inside the chosen week.
- **Team** — optional; must be one of yours, Active, and not a backend team.

The forecast is a commitment, not a constraint: planning pre-fills from it and you can change anything. A slip is reported, never blocked. Forecast figures are never overwritten by planning or execution, so forecast against planned against executed stays a real comparison.

**Direct Close** finishes a line without a rollout. It requires the close type, the subcontractor, and the **date the work actually closed** — not the day you press the button, because every milestone and period report reads that date. You can close one milestone or the whole line.

A line already committed to the rollout — one with a live plan, or one that has been dispatched with a forecast week — cannot be direct-closed. Cancel the plan or clear the forecast first.

### 3.5 Rollout Planning (`/pms/im-dispatch`)

Four views of the same work:

- **Unplanned** — lines with no plan.
- **All POIDs (re-plan)** — everything, for adding a further visit.
- **🗓 Weekly Plan** — the week's plans as a grid, Saturday to Friday.
- **📈 Weekly Forecast** — what you committed to, against what was planned and executed.

**Create Plans** needs the team, the dates, the access window (time and period), and the visit type. Huawei IM and Project Domain are required too — taken from the line, or from its project — and the modal asks for them only when they are missing. Internal work is exempt from both.

A line that was already closed by Direct Close or Backend cannot be planned.

### 3.6 Rollout Execution (`/pms/im-planning`)

Your plans and their progress: status, team, visit, dates, completion. Reschedule, extend, request cancellation, or raise an issue from here.

### 3.7 Rollout Work Done (`/pms/im-execution`)

Completed executions waiting to become Work Done.

**Create Work Done** turns a finished visit into the line's revenue record. Before it will run:

- the execution must be **Completed**, and QC settled if the plan requires QC;
- **every plan in that visit** must be finished — if the visit ran to two dates, both need a completed execution. The refusal names the plan, its date and team, and which of the two is outstanding;
- the plan must not be cancelled.

One Work Done per line, always. It attaches to the **last completed execution of the visit**, so the record is the same whichever row you click and carries the date the work actually finished.

If the line already has a Work Done from a **Direct Close or Backend**, the page says so rather than doing nothing. To make the rollout the record instead, tick **"There is already a Direct Close record for this line"** and confirm: the existing record moves onto this execution, and the amount, the PIC status and anything already invoiced stay exactly as they are.

Rows drop off the list once the visit's Work Done exists and QC and CIAG are settled.

### 3.8 Execution Analytics (`/pms/im-exec-analytics`)

Your own execution analysis: attention buckets, breakdowns, repeat-visit concentration and a monthly trend. Read-only.

### 3.9 Work Done (`/pms/im-work-done`)

Your Work Done records and their journey through PIC.

**Tabs:** All · Active · Confirmation Done · PIC Rejected · Resubmit to PIC.

**All** shows everything in your scope, closed and invoiced included. The other tabs are working queues and hide rows whose milestones have all reached a terminal PIC status — if a row seems to have vanished, look in **All**.

Select rows to submit to PIC, attach documents, or set an issue flag.

### 3.10 Issues & Risks (`/pms/im-issues-risks`)

Your flagged plans. Re-plan from here; the modal asks for Huawei IM or Project Domain only when the selected lines have neither their own value nor one from their project.

### 3.11 Material Management (`/pms/im-material-request`)

Request material, track deliveries into the team warehouse, and handle returns.

### 3.12 Backend (`/pms/im-backend`)

Visible when your IM record allows backend assignment. Hand a line to a non-field team and mark it done when they finish. A line with a live plan cannot be sent to backend — finish it through the rollout, or cancel the plan first.

### 3.13 Expense Approvals (`/pms/im-expense`)

Field expense claims from your teams. Approve or reject; approved claims go on to the PM.

### 3.14 Reports (`/pms/im-reports`)

The same catalogue the PM has, narrowed to your own work — 19 reports across **My Work**, **Teams & Utilization**, **Performance**, **Project Reports**, **Rollout & Delivery**, **Client / Domain**, **CIAG Site Sign & Verify**, **Material Reports** and **Commercial**.

Scope follows the IM recorded on each record, so a team moving to another manager does not take its history with it. Team reports include every team whatever its status.

### 3.15 Time Logs (`/pms/im-timesheets`)

Time entries for your teams, opening on the current week.

---

## 4. Field Team

Built for a phone on site: cards, large touch targets, one thing at a time.

### 4.1 Today's Work (`/pms/today`)

Your home screen — everything your team has planned for today.

Chips across the top count **Total**, **In Progress**, **Planned** and **Done**. Cards are ordered by urgency: in progress first, then planned, then completed.

Each card's left border tells you where it stands — amber in progress, blue planned, green completed, grey cancelled — and carries the item, the POID, the site, the activity type, the project, the visit type and your share of the quantity. A purple `+N teams` badge means other teams are on the same plan.

Also on the card when they apply: the access time and period, **QC Not Required** or **CIAG Not Required**, a green **IM ✓** once your IM has confirmed the execution, and your IM's note.

Tap a card to open the execution form.

If you see "No team assigned", your account is not linked to a field team — ask your IM.

### 4.2 Execute (`/pms/field-execute`)

The on-site form. Opened from a card, or on its own to pick from your actionable plans.

**Timer** — Start and Stop log your time against the plan. Only one timer runs at a time; if one is going on another plan you can stop it from here.

**Plan header** — item, POID, site, activity, project, visit type and target quantity, plus your IM's note and, on a shared plan, every team's assigned quantity.

**The form**

| Field | Notes |
|---|---|
| Execution Status | In Progress · Completed · Hold · Cancelled · Postponed |
| Achieved Quantity | Pre-filled from the plan's target; change it if the real figure differs |
| QC Status | Only when the plan requires QC — Pending · Pass · Fail · N/A |
| CIAG Status | Only when the plan requires CIAG — Open · Submitted · Accepted · Rejected |
| GPS | **Capture GPS** reads your device location and shows the accuracy, or type coordinates |

**Team Lead Remark** — pick from saved remark templates (searchable, several at once, each removable), and add free text underneath for anything they don't cover. Typing something new offers **+ Add as new remark**, which saves it as a template and selects it. Remarks you saved earlier load back in so re-editing never loses them.

**Materials** — every item transferred to your team warehouse for this POID, with what was sent and a **Used qty** you can reduce if you used less.

**Expenses** — log site costs here without leaving the form. Add type, amount and an optional description; they are submitted with the execution.

**Photos** — take or attach photos; thumbnails appear immediately and can be removed.

**Save** submits everything together.

> Marking an execution **Completed** does not create the Work Done record. It tells your IM the work is finished; the IM creates Work Done from Rollout Work Done once QC and CIAG are settled and every plan in the visit is done.

### 4.3 QC / CIAG (`/pms/field-qc-ciag`)

For completing the checks on their own, away from the execution form. Each plan gets a QC section (Pass / Fail / N/A, remark, photos) and a CIAG section (Submitted / Accepted / Rejected / Open, remark, photos), each saved separately.

### 4.4 History (`/pms/field-history`)

Read-only record of your team's completed work, filterable by date, activity type and status, and exportable.

### 4.5 Materials (`/pms/field-my-stock`)

What your team warehouse holds: quantity in stock, what has been used, and what is due back. Raise returns for anything unused.

### 4.6 Expenses (`/pms/field-expense`)

Submit and track your own claims. Each shows where it is — pending with your IM, approved, or paid. Attach the receipt.

### 4.7 Time Log (`/pms/field-timesheet`)

Your logged hours, opening on the current week (Saturday–Friday).

---

## 5. PIC (Project Invoice Controller)

Eleven pages covering both sides of the money: customer invoicing and subcontractor payment.

### 5.1 PIC Dashboard (`/pms/pic-dashboard`)

The invoicing position at a glance — what is waiting, what is in progress, what has been billed, and what is still to collect.

### 5.2 PO Dump (`/pms/po-dump`)

The same full PO line export the PM has.

### 5.3 Pending (`/pms/pic-pending`)

POIDs that have not reached PIC yet. Use it to see what is coming.

### 5.4 PIC Tracker (`/pms/pic-tracker`)

The main working page: every milestone and its position in the billing ladder.

MS1 and MS2 are tracked separately, because a line can have one milestone invoiced while the other is still open. Move a milestone along the ladder, record invoice references and dates, attach documents, and reject back to the IM with a reason when something is wrong.

A rejection returns the line to the IM's Work Done page under **PIC Rejected**.

### 5.5 Closed (`/pms/pic-closed`)

Fully closed POIDs — every milestone finished.

### 5.6 Cancelled (`/pms/pic-cancelled`)

Cancelled POIDs, kept for the record.

### 5.7 Invoice Detail (`/pms/pic-invoice-detail`)

Line-by-line invoice view: which invoice covers which milestone, for how much, and when.

### 5.8 Invoicing Summary (`/pms/pic-invoicing-summary`)

The monthly roll-up, split by **MS1 — 1st Payment Milestone** and **MS2 — 2nd Payment Milestone**. A milestone is counted in the month it was invoiced.

### 5.9 Subcon PO (`/pms/pic-subcon-po`)

Purchase Orders to subcontractors — the supplier mirror of customer invoicing.

**Tabs:** To Order · Ordered · Invoiced · Closed · All.

Select ready milestones and raise the Purchase Order. One PO per **supplier**, so a single PO can span several subcontract masters and carries one item row per milestone. Record the supplier's invoice against the PO when it arrives, and attach it.

PMs and admins reach this page too, and can raise the same documents.

### 5.10 Subcon Payout Summary (`/pms/pic-subcon-payout`)

What is owed to each subcontractor and what has been paid.

### 5.11 Reports (`/pms/pic-reports`)

The invoicing and collection reports.

### 5.12 How PIC status drives Work Done billing

Work Done does not carry its own billing state — it reads the line's PIC status:

| PIC status | Work Done shows |
|---|---|
| Commercial Invoice Closed · PO Line Canceled | **Closed** |
| Commercial Invoice Submitted · Ready for Invoice · Under I-BUY · Under ISDP | **Invoiced** |
| Anything else PIC has set | **Pending** |

So moving a milestone forward in PIC Tracker changes what the IM and the PM see, with nothing else to update.

---

## 6. A line from start to finish

A single PO line, through every hand that touches it.

| # | Who | Where | What happens |
|---|---|---|---|
| 1 | PM | PO Upload | The customer's PO is imported. Each line becomes a POID. |
| 2 | PM | Dispatch | The line is assigned to an IM. |
| 3 | IM | PO Control | A forecast month, week and optionally a date and team are set. The line moves into My Dispatches. |
| 4 | IM | Rollout Planning | A plan is created: team, dates, access window, visit type. |
| 5 | Field | Today's Work → Execute | The team does the work and records quantity, QC, CIAG, photos, materials and expenses. |
| 6 | IM | Rollout Execution | Progress is watched; issues are raised or the plan rescheduled. |
| 7 | IM | Rollout Work Done | Once the whole visit is finished and QC settled, Work Done is created — the line's revenue record. |
| 8 | IM | Work Done | The record is submitted to PIC with its documents. |
| 9 | PIC | PIC Tracker | Milestones move along the billing ladder to invoiced and closed. |
| 10 | PIC | Subcon PO | The subcontractor's Purchase Order is raised and their invoice recorded. |

**The short route.** A line that needs no field visit can be closed at step 3 with **Direct Close**, or handed to a non-field team through **Backend**. Either way the Work Done is recorded straight away and the line rejoins at step 9. A line can take one route or the other — never both at once.

---

## 7. Common questions

**A row disappeared from my list.**
Most working lists hide what is finished. On Work Done, the **All** tab shows everything including closed and invoiced rows. On Rollout Work Done, rows leave once the visit's Work Done exists and QC and CIAG are settled.

**Create Work Done says the visit has another plan outstanding.**
A visit can run to more than one plan — two dates, or two teams on two dates. All of them need a completed execution, with QC settled, before the line's Work Done can be recorded. The message names the plan, its date and team.

**Create Work Done says a Direct Close record already exists.**
The line was closed without a rollout, and that record holds the revenue. If the rollout is the version that should stand, tick the box in the confirmation to move the existing record onto this execution — the amount, the PIC status and anything already invoiced are untouched.

**I can't plan a line.**
Three things stop it: the line has no IM; it has no Huawei IM or Project Domain (its own, or from its project); or it was already closed by Direct Close or Backend. The message says which.

**I can't Direct Close a line.**
It is already committed to the rollout — it has a live plan, or it was dispatched with a forecast week. Cancel the plan or clear the forecast first.

**The week doesn't start where I expect.**
Weeks run Saturday to Friday. In a month picker the first week usually begins in the previous month, which is why every option shows its real dates.

**My dashboard is empty.**
If you only close lines directly, the plan-based tiles read zero because that work never had a plan. Look at **Direct & Backend Closes** on your dashboard for it.

**My attachment won't upload.**
It is over the site's limit. The message gives the file's size and the limit; use **Attach via web link** and paste a shared link instead.

**Pasting a list into search finds nothing.**
It should work — POIDs separated by spaces, commas, tabs or new lines all match. If it doesn't, tell your administrator rather than retyping them one by one.

**Two people see different numbers for the same thing.**
Check the date range and, on Work Done, which tab. A PM's list includes closed rows that an IM's working tabs hide.

**Reports show a team that has left or is on leave.**
Deliberately. A team on leave this week still did last month's work, and dropping it would make last month's totals wrong.
