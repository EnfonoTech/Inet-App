# INET Operations Command Center — User Guide

**Portal URL:** `https://<your-site>/pms/` (path prefix is always `/pms`)  
**Login:** Same email and password as Frappe / ERPNext (Desk).

**Desk:** Use **Workspace → PMS** for DocType shortcuts. The shortcut **INET PMS** opens the portal at `/pms/dashboard`.

**Styled HTML guide (browser, same site as Frappe):**  
`https://<your-site>/assets/inet_app/user-guide.html`  
Example: `https://mysite.example.com/assets/inet_app/user-guide.html`  
That file is copied from `docs/user-guide.html` into `inet_app/public/` when you run **`npm run build`** in `apps/inet_app/frontend` (or copy it manually after editing the doc).

---

## 1. System overview

The portal manages the telecom field pipeline end to end:

```
PO Upload → Dispatch → Planning → Execution → Work Done → Dashboards & reports
```

Optional admin tools: **Projects** (PCC list and detail), **PO dump**, **Issues & Risks**, **Time logs**, **Search / Overview**.

### Roles (how login chooses the UI)

The portal calls `get_logged_user` after Frappe login. Role is **not** guessed from name alone.

| Portal role | Frappe roles / rules | What you see |
|-------------|----------------------|----------------|
| **Admin** | `Administrator`, **or** `System Manager`, **or** `INET Admin` | Full sidebar: dashboard, projects, PO upload, PO dump, dispatch, planning, execution, work done, issues & risks, reports, time logs, overview, masters |
| **IM** | User has **`INET IM`** | IM sidebar: My Dashboard, My Projects, My Teams, Dispatches, Sub-Contract, Planning, Execution, Work Done, Issues & Risks, Reports, Time logs |
| **PIC** | User has **`INET PIC`** (Project Invoice Controller) | PIC sidebar: Dashboard, Tracker, Reports |
| **Field** | User has **`INET Field Team`** | Field sidebar: Today’s Work, Execute, QC / CIAG, History, Time log |

**Role priority** (when a user has more than one): **PIC → IM → Field → Admin**. The portal picks the most specific layout. PIC therefore wins over Admin if both are present — assign roles deliberately.

**IM identity for data:** If DocType **IM Master** exists, the server resolves the IM from **IM Master.user** (link to User) first, then **IM Master.full_name** matching the user’s full name, then falls back to the user’s display name. **INET Team.im** should match that IM identifier so teams and KPIs line up.

**Field team identity:** Prefer **INET Team.field_user** = your User. A legacy fallback may match **team_name** to the first word of the user’s full name.

Everyone else (no `INET Admin`, no `INET IM`, no `INET Field Team`) gets the **field** layout by default — assign the correct role in **User** for production users.

---

## 2. Admin guide

### 2.1 Command Dashboard (`/pms/dashboard`)

Operations wall screen. **Refreshes every 60 seconds.**

**Row 1 — Operational overview**

| KPI | Meaning |
|-----|--------|
| Open PO lines | Count of **PO Dispatch** rows not in *Completed* / *Cancelled* |
| Open PO line value (SAR) | Sum of **line amount** on those open dispatch lines |
| Idle Teams | Active **INET Team** headcount minus teams with a non-cancelled execution today |
| Planned Activities | Rollout plans in *Planned* (approx.) |
| Closed Activities | Closed activity count |
| ReVisits | Re-visit count |

**Row 2 — INET teams performance**

Active INET teams, monthly cost, monthly target, target today (prorated), achieved revenue, gap today.

**Row 3 — Subcontractor performance**

Sub teams, target, revenue, expense, INET margin, gap.

**Row 4 — Company financial summary**

Company target, achieved, gap, total cost, profit/loss, coverage %.

**Bottom panels**

| Panel | Content |
|-------|--------|
| Top 5 Teams | Top teams by target/achievement (month) |
| IM Performance | Revenue, cost, profit per IM |
| Team Status | Active / idle / planned / in progress + donut |
| Action Watchlist | Rule-based alerts (wording depends on backend) |

**Colours:** Green = favourable, red = risk/gap, amber = warning. Negative numbers may show in parentheses on cards.

---

### 2.2 Projects (`/pms/projects`, `/pms/projects/:projectCode`)

- **Projects:** Table of **Project Control Center** rows; open a row for **Project detail** (summary for that project code).
- Use Desk for full form editing where needed; the portal focuses on read/update flows your build exposes on the detail page.

---

### 2.3 PO Upload (`/pms/po-upload`)

The PO Upload page now has **two modes**:

#### 2.3a Standard upload (live POs — default)

1. Obtain the Huawei (or compatible) **`.xlsx`** export.
2. Upload in the portal; review row-level validation (valid vs error rows).
3. **Confirm import** to create **PO Intake** (and related lines as implemented).

Validation uses live masters (**Customer Item Master**, **Project Control Center**, etc.) — counts change per site; there are no fixed “820 items / 74 projects” guarantees. Item code is mandatory in this mode and unknown items block the row.

#### 2.3b Archive upload (Master Tracker `.xlsb` — closed/cancelled history)

Use this mode to back-fill historical PO lines that are already **CLOSED** or **CANCELLED IN SYSTEM** so dashboards and reports reflect total business volume.

- File: the operations “Master Tracker” `.xlsb` (per-month sheets).
- The header row is auto-detected from milestone-context columns (MS1 / MS2 / Acceptance %, planned/actual dates).
- **Item code is optional** in this mode. Rows with unknown items still load; they’re just excluded from financial roll-up until reconciled.
- Only rows whose **PO status** in the sheet is **CLOSED** or **CANCELLED IN SYSTEM** are imported; live/in-flight rows are skipped.
- Imported lines:
  - Get **`dispatch_status = Closed`** or **`Cancelled (in System)`** (kept distinct from active **Cancelled**).
  - **Skip the dispatch / planning / execution workflow** entirely.
  - Have PIC fields (MS1 %, MS2 %, Acceptance %, dates, statuses, payment terms) stamped from the sheet.
- Imports run as a background job (`frappe.enqueue` long queue, 3600 s timeout). Progress shows in the Background Jobs list — close the page safely; the job continues.

> **Tip:** Run the standard upload first for the current month, then run archive uploads for prior months in chronological order. Cancelled-in-system rows are visible everywhere but tagged so they don’t leak into open-line KPIs.

---

### 2.4 PO dump (`/pms/po-dump`)

Export / inspect PO line data for analysis (admin).

**Recent UX changes:**
- Filter chips (status, dispatch, billing, team category) now **toggle** — click again to clear.
- Filter changes **auto-fetch** (no more “Apply” button).
- Default view shows **OPEN** rows only; switch the status chip to see Closed/Cancelled history.
- Row-limit “**All**” returns the full result set (the older 500-row cap is gone).
- Filter state persists across navigation via `sessionStorage` so coming back from a detail view keeps your filter.

---

### 2.5 PO Dispatch (`/pms/dispatch`) and PO Control

1. Select PO intake lines (typically status **New**).
2. Choose **INET team** from the dropdown (all active teams from **INET Team**, not only “Team-01 … Team-60”).
3. Set **target month** / planning fields as shown in the UI.
4. **Dispatch** creates **PO Dispatch** rows (tracking IDs / dummy POID rules follow your site configuration).

The **PO Control** list (admin) excludes terminal statuses (**Completed**, **Closed**, **Cancelled**, **Cancelled (in System)**) by default so day-to-day operators see only actionable lines. Toggle the status filter to inspect terminal rows.

IM users use **`/pms/im-dispatch`** for the IM-scoped dispatch UI.

**Sub-Contract option:** When a team has **`can_subcon = 1`** in **INET Team** *and* a **team_category** is set, the dispatch UI shows a **Sub-Contract** action that routes the line into the IM Sub-Contract flow (see section 3.2). Without `can_subcon`, the option is hidden.

---

### 2.6 Rollout Planning (`/pms/planning`)

1. Select dispatched lines.
2. Set **plan date** and **visit type** (e.g. Execution, Re-Visit, Extra Visit).
3. **Create plans** → **Rollout Plan** records; visit multipliers come from **Visit Multiplier Master** where applicable.

**Visit types (typical multipliers)**

| Type | Multiplier | Use |
|------|------------|-----|
| Execution | 1.0× | First execution visit |
| Re-Visit | 0.5× | Rework / return |
| Extra Visit | 1.5× | Extra mobilisation |

---

### 2.7 Execution monitor (`/pms/execution`)

Read-only monitor of rollout/execution progress. (Auto-refresh has been **removed** from list pages to keep edits stable; reload manually after team updates. Dashboards still refresh on a 3–5 minute timer.)

---

### 2.8 Work Done (`/pms/work-done`)

Lists completed work with billing and financial columns. Filters may include team, project, billing, dates, POID / **dummy POID** (if used on your site).

**Rates:** Revenue uses **Customer Item Master** (e.g. standard vs hard region) per your item/site rules.

**Billing status now follows PIC.** The **Billing Status** column on PM/IM Work Done is computed from PO Dispatch **`pic_status`** rolled up into three buckets:

| Billing Status | PIC `pic_status` source values |
|----------------|---------------------------------|
| **Pending** | *(blank)*, **Work Not Done**, **Under Process to Apply** |
| **Submitted** | **Submitted to Operator (MS1)**, **Submitted to Operator (MS2)**, **Submitted to Operator (Acceptance)** |
| **Invoiced** | **Approved (MS1/MS2/Acceptance)**, **Invoiced (MS1/MS2/Acceptance)** |

Hover the cell for a tooltip showing the raw `pic_status`. If PIC fields are missing (legacy column not yet migrated), the row falls back to **Pending** automatically — no error.

**Sub-Contract rows** (where `dispatch_status = Sub-Contracted`) appear in Work Done as soon as the IM submits the subcon team’s output; their execution status is synthesised as **Completed** so they participate in financials and PIC roll-up.

---

### 2.9 Issues & Risks (`/pms/issues-risks`)

Track and manage issues/risks (admin). Content is driven by your DocTypes and portal implementation.

---

### 2.10 Reports (`/pms/reports`)

Tabbed **script/query reports** (server-side):

| Tab | Report |
|-----|--------|
| Project Status Summary | Projects by status, budget, actuals |
| Budget vs Actual | Budget vs actual by project |
| Team Utilization | Team utilisation |
| Daily Work Progress | Daily work / progress |

Use **Refresh** to reload the active tab.

---

### 2.11 Time logs (`/pms/timesheets`)

Admin view of execution time logs (wording and columns per your build).

---

### 2.12 Search / Overview (`/pms/overview`)

Cross-cutting search / overview (admin).

---

### 2.13 Masters (`/pms/masters`)

Card grid of masters with **live counts**. Click a card to expand **read-only** rows in the portal; use **+ New** / row links to open **Frappe Desk** for create/edit.

**Cards include (among others):** Area, INET Team, IM Master, Project Domain, Huawei IM, Subcontractor, Customer Item, Activity Cost, Item, Project Control Center, Customer, Visit Multiplier.

**Deep link:** `/pms/masters?expand=<DocType%20Name>` opens that card expanded, e.g. `?expand=IM%20Master`.

---

## 3. IM (Implementation Manager) guide

IM layout mirrors the pipeline but **scoped to the logged-in IM** (teams/projects/Dispatch where `im` matches).

### 3.1 IM pages

| Page | URL | Purpose |
|------|-----|--------|
| My Dashboard | `/pms/im-dashboard` | KPIs, action items, month/today completion charts, financial snapshot; subtitle shows team/project counts from API |
| My Projects | `/pms/im-projects` | PCC rows where **Implementation Manager** = you |
| My Teams | `/pms/im-teams` | Your INET teams |
| Dispatches | `/pms/im-dispatch` | IM-scoped dispatches |
| **Sub-Contract** | **`/pms/im-subcon`** | Sub-Contract list (separate from main dispatch) |
| Planning | `/pms/im-planning` | IM-scoped planning |
| Execution | `/pms/im-execution` | IM-scoped execution monitor |
| Work Done | `/pms/im-work-done` | IM-scoped work done list (includes synthesised subcon rows) |
| Issues & Risks | `/pms/im-issues-risks` | IM-scoped issues/risks |
| Reports | `/pms/im-reports` | Tabs: PO dispatches summary, rollout plans, executions (MTD), work done (MTD), projects table |
| Time logs | `/pms/im-timesheets` | IM-scoped time entries |

If the API cannot resolve an IM, the dashboard may show an informational **message** from the server (e.g. no active teams).

### 3.2 Sub-Contract flow (`/pms/im-subcon`)

Use Sub-Contract when a line will be executed by an external partner instead of an INET field team.

**Prerequisites**
- The selected **INET Team** must have **`can_subcon = 1`** and a **`team_category`** set.
- Subcontractor record(s) exist in the **Subcontractor** master.

**Steps**
1. Open **Sub-Contract** from the IM sidebar (`/pms/im-subcon`).
2. The list shows your dispatched lines that are eligible for subcontracting (separate from the main IM Dispatch list).
3. Multi-select rows → choose a **Subcontractor** + agreed amount → **Mark as Sub-Contracted**.
4. The dispatch row’s `dispatch_status` flips to **Sub-Contracted** and the line moves out of the active dispatch view.
5. When the subcontractor returns the work, edit the row and set **subcon_submission_status** = *Submitted* (or the equivalent value in your build). The system **synthesises a Work Done row** with `execution_status = Completed` so the line participates in revenue, margin, and PIC roll-up.
6. The PIC sees the subcon line in PIC Tracker the same as INET-team lines; the **INET-vs-Subcon** breakdown on the PIC Dashboard separates them.

> Sub-Contract rows keep `dispatch_status = Sub-Contracted` permanently — that flag is what the synthesised Work Done feed reads. Do **not** flip it back to *Dispatched* once subcontracted.

---

## 4. Field team guide

| Page | URL | Purpose |
|------|-----|--------|
| Today’s Work | `/pms/today` | Cards for today’s planned work |
| Execute | `/pms/field-execute` or `/pms/field-execute/<id>` | Execution form (status, qty, GPS, remarks, etc.) |
| QC / CIAG | `/pms/field-qc-ciag` | QC / CIAG queue for the team |
| History | `/pms/field-history` | Past work |
| Time log | `/pms/field-timesheet` | Time logging |

Completing an execution as **Completed** (per your validation rules) drives **Work Done** and downstream KPIs.

---

## 5. PIC (Project Invoice Controller) guide

The **PIC** role owns the path from “Work Done” → invoice received from the customer. PIC tracks Milestone-1 (MS1), Milestone-2 (MS2), and Acceptance billing percentages, dates, statuses, and remarks for every PO line.

**Role**: `INET PIC`. Assign in **User → Roles**. Once assigned, the user logs in to the same `/pms/` portal and sees the PIC sidebar (Dashboard / Tracker / Reports). PIC has a **higher routing priority than Admin** — to keep both views, use a separate user.

**What PIC sees** (PO Dispatch fields, role-scoped):

| Section | Fields |
|---------|--------|
| Payment Terms | Free-text terms (e.g. `AC1 (40%) + AC2 (60%)`); the system parses **AC1** and **AC2** percentages automatically |
| MS1 / MS2 / Acceptance | Each milestone has: **% (auto from payment terms)**, **amount (auto = line × %)**, **planned date**, **submission date**, **approval/invoice date**, **status** (one of *Submitted to Operator*, *Approved*, *Invoiced*) |
| Tax & domain | `tax_rate`, `project_domain` |
| Role-scoped remarks | **General remark** (visible to all roles), **Manager remark** (PIC/Admin), **Team Lead remark** (IM/Admin) |
| Computed `pic_status` | One of 11 values rolled up from the milestone statuses; drives the Work Done **Billing Status** column |

> **Initial-state rule:** If a line has no PIC progress yet, `pic_status` shows as **“Under Process to Apply”** when execution is **Completed** and **“Work Not Done”** otherwise. As soon as a milestone status is set, the rule yields to the actual progress.

### 5.1 PIC Dashboard (`/pms/pic-dashboard`)

Top-line view for the PIC role, refreshes every **5 minutes**.

- **Hero KPIs** — total open value, MS1 / MS2 / Acceptance amount in pipeline, invoiced this month.
- **Acceptance Pipeline** — flat 4-column spreadsheet-style table (POID, Project, Acceptance %, Status). Compact on small screens (no card layout).
- **Monthly Invoicing** — by month, how much was invoiced vs in-progress.
- **INET vs Subcon** — split of the same numbers by team category.
- **Pending owner tables** — lines waiting on a specific person (PM/IM/Subcon) sorted by age.

The dashboard has **no export button** by design (use the Tracker/Reports for CSV).

### 5.2 PIC Tracker (`/pms/pic-tracker`)

The day-to-day list view. PIC works mostly here.

- DataTablePro chrome: **Manage Table**, sort menu, freeze columns, persisted preferences per user.
- **Multi-select** rows → bulk-update `pic_status` (e.g. flip 12 lines to *Submitted to Operator (MS1)*).
- **Edit popover** opens with a gradient hero and **MS1 / MS2 / Acceptance tabs** so editing each milestone is isolated.
- **CSV download** uses your current filter and sort.
- **Totals row (`tfoot`)** sums monetary columns over the visible result set.
- **Row limit “All”** loads the full set (no 500-row cap).
- The list page itself does **not** auto-refresh (intentional, to avoid wiping in-progress edits) — reload manually if a teammate has been editing.

> **Initial state:** If you change `pic_status` away from blank, the initial-state rule no longer applies — the value you set is what shows. Clear the field again to fall back to the rule.

### 5.3 PIC Reports (`/pms/pic-reports`)

Five canned reports behind a **horizontal pill bar** (no two-column layout); the active report fills a single full-width card.

| Report | Use |
|--------|-----|
| Acceptance Aging | How long each acceptance has been pending |
| Submission vs Approval | Lag between submission and approval/invoice |
| Monthly Invoicing | Invoiced + pipeline by month |
| INET vs Subcon | Split of revenue, status, aging |
| Pending by Owner | Lines waiting on PM/IM/Subcon |

Each report has its own filter strip (date range, IM, project, team, status), and **CSV export**.

### 5.4 Pic ↔ Work Done coupling

PIC edits drive the **Billing Status** column on PM and IM Work Done lists (see section 2.8). Mapping is one-way: PIC → Work Done. Field/IM users do **not** edit billing directly.

---

## 6. Desk workspace (PMS)

In **ERPNext / Frappe Desk**, open workspace **PMS**:

- **INET PMS** — browser goes to **`/pms/dashboard`** (portal).
- Other shortcuts — standard **DocType** list views (PO Intake, PO Dispatch, Rollout Plan, Daily Execution, Work Done, Execution Time Log, masters, Daily Work Update, etc.).

Run **`bench migrate`** (or reload the Workspace doc) after pulling app changes so Desk matches the packaged JSON.

---

## 7. First-time setup (reference)

1. **Roles:** Assign `INET Admin`, `INET IM`, `INET PIC`, or `INET Field Team` as appropriate. Link **IM Master.user** to IM users; link **INET Team.field_user** to field users where possible. Remember that PIC out-ranks Admin in routing — don’t assign both to the same person unless you want the PIC view.
2. **Masters:** Import or create master data (areas, teams, items, projects, multipliers, etc.). Optional: use your **`CONTROL_CENTER.xlsx`** import path if `inet_app.api.data_import` is part of your deployment (`import_control_center_xlsx` from bench console — paths and file names per ops runbook).
3. **Smoke test:** `PO Upload` → `Dispatch` → `Planning` → field **Execute** → confirm **Work Done** and dashboard movement.

---

## 8. Example workflow (end-to-end)

1. **PO upload** (Admin) — file uploaded → PO Intake lines.
2. **Dispatch** (Admin / IM) — PO Dispatch row per team/month.
   - Or **Sub-Contract** (IM) — `dispatch_status = Sub-Contracted`, executed by partner.
3. **Planning** (Admin / IM) — Rollout plans with dates and visit types (skipped for subcon).
4. **Field execution** — Field completes execution → **Work Done** + financials.
   - Subcon synthesised Work Done row appears once IM marks subcon submission *Submitted*.
5. **PIC** — milestone billing tracked through MS1 → MS2 → Acceptance; `pic_status` rolls up to **Billing Status** on Work Done.
6. **Dashboards & reports** — Admin / IM / PIC dashboards refresh every 1–5 minutes; list pages reload manually.
7. **Archive imports** (Admin) — Master Tracker `.xlsb` adds historical CLOSED / CANCELLED IN SYSTEM rows for completeness.

---

## 9. Key financial ideas (high level)

| Idea | Typical source |
|------|------------------|
| Revenue | Customer item rates × executed qty (± region rules) |
| Cost | Team daily cost, subcontract rules, activity costs |
| Margin | Revenue − cost |
| Visit multipliers | Visit Multiplier Master |
| MS1 / MS2 amount | Line amount × parsed % from `payment_terms` (regex `AC\s*([12])\s*\(\s*([\d.]+)\s*%`) |
| Acceptance amount | Remainder of line amount after MS1+MS2 (or 100% if no payment terms parse) |
| Billing status | Roll-up of `pic_status` → Pending / Submitted / Invoiced |

Exact formulas live in DocTypes, server scripts, and reports — treat this table as a map, not a spec.

---

## 10. Navigation reference (portal)

### Admin

| Label | Path |
|--------|------|
| Dashboard | `/pms/dashboard` |
| Projects | `/pms/projects` |
| PO Upload | `/pms/po-upload` |
| PO dump | `/pms/po-dump` |
| Dispatch | `/pms/dispatch` |
| Planning | `/pms/planning` |
| Execution | `/pms/execution` |
| Work Done | `/pms/work-done` |
| Issues & Risks | `/pms/issues-risks` |
| Reports | `/pms/reports` |
| Time logs | `/pms/timesheets` |
| Search / Overview | `/pms/overview` |
| Masters | `/pms/masters` |

### IM

Prefix paths with `/pms/im-…` as in section 3 (e.g. `/pms/im-dashboard`). Plus **`/pms/im-subcon`** for the Sub-Contract list.

### PIC

| Label | Path |
|-------|------|
| Dashboard | `/pms/pic-dashboard` |
| Tracker | `/pms/pic-tracker` |
| Reports | `/pms/pic-reports` |

### Field

`/pms/today`, `/pms/field-execute`, `/pms/field-qc-ciag`, `/pms/field-history`, `/pms/field-timesheet`.

### DataTablePro chrome (Admin / IM / PIC list pages)

Lists rendered with **DataTablePro** share these features:
- **Manage Table** — show/hide columns, reorder, freeze, save layout per user.
- **Sort menu** — global, opens to the **right of the action bar** below the Sort button (no longer inside Manage Table).
- **Per-column sort** still available via header click.
- **Stale-pref reconciliation** — when new columns are added in a release, your saved layout is auto-merged with the current schema (you won’t see a blank table after a deploy).
- **Row limit** — *All* now means *all* (the older 500-row cap is removed).

### Cache

After deployments, use a **hard refresh** (e.g. Ctrl+Shift+R / Cmd+Shift+R) so the browser loads the new `index.js` bundle.

---

## 11. Troubleshooting

| Issue | What to check |
|-------|----------------|
| Blank or stuck after login | Bench running; browser console/network errors; `get_logged_user` returns `authenticated: true` |
| Wrong portal role | User role list: `INET Admin` / `INET IM` / `INET PIC` / `INET Field Team`. Remember PIC > IM > Field > Admin precedence |
| IM dashboard empty / message | IM Master link; INET Team **im** matches resolved IM; active teams exist |
| IM “not linked” on My Projects | PCC **Implementation Manager** must match your IM identifier |
| Field user sees wrong team | **INET Team.field_user** should point to that user |
| Sub-Contract option missing | INET Team must have `can_subcon = 1` **and** `team_category` set |
| Subcon line not in Work Done | Confirm `dispatch_status = Sub-Contracted` and the IM has set the subcon submission status; the row is *synthesised* — it won’t exist in Daily Execution |
| Billing status stuck on Pending | Open PIC Tracker → set `pic_status` to a *Submitted to Operator …* or *Invoiced …* value; the Work Done column re-roll on next list load |
| `Unknown column 'general_remark'` error after deploy | Run `bench --site <site> migrate`; the helper guards fall back automatically until migration completes |
| PIC Tracker shows blank rows after changing row limit | Reload the page; the bug from earlier builds was fixed — if you still see it, your bundle is stale (hard refresh) |
| “All” row limit returns only 500 rows | Stale frontend bundle; rebuild `frontend` and hard refresh — the cap is gone in current code |
| Archive upload didn’t finish | Check **Background Jobs** in Desk; the import runs on the *long* queue with a 3600 s timeout |
| Desk PMS shortcuts outdated | `bench migrate` or re-import **Workspace PMS** |
| Old UI after release | Hard refresh; ensure `inet_app/public/portal/assets/` was rebuilt (`npm run build` in `frontend`) and deployed |

---

**Stack (typical):** Frappe / ERPNext 15 · React portal (Vite) · MariaDB.

**Doc maintenance:** This file is the canonical text guide. The styled **`docs/user-guide.html`** is a companion; if both exist, prefer this Markdown for the newest behaviour.
