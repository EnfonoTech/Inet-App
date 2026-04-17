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
| **IM** | User has **`INET IM`** | IM sidebar: My Dashboard, My Projects, My Teams, Dispatches, Planning, Execution, Work Done, Issues & Risks, Reports, Time logs |
| **Field** | User has **`INET Field Team`** | Field sidebar: Today’s Work, Execute, QC / CIAG, History, Time log |

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
| Total Open PO | Sum of **line amount** (SAR) on PO Dispatch rows not in *Completed* / *Cancelled* |
| Active Teams | Teams currently active |
| Idle Teams | Idle teams |
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

1. Obtain the Huawei (or compatible) **`.xlsx`** export.
2. Upload in the portal; review row-level validation (valid vs error rows).
3. **Confirm import** to create **PO Intake** (and related lines as implemented).

Validation uses live masters (**Customer Item Master**, **Project Control Center**, etc.) — counts change per site; there are no fixed “820 items / 74 projects” guarantees.

---

### 2.4 PO dump (`/pms/po-dump`)

Export / inspect PO line data for analysis (admin). Exact columns follow your deployment’s API and UI.

---

### 2.5 PO Dispatch (`/pms/dispatch`)

1. Select PO intake lines (typically status **New**).
2. Choose **INET team** from the dropdown (all active teams from **INET Team**, not only “Team-01 … Team-60”).
3. Set **target month** / planning fields as shown in the UI.
4. **Dispatch** creates **PO Dispatch** rows (tracking IDs / dummy POID rules follow your site configuration).

IM users use **`/pms/im-dispatch`** for the IM-scoped dispatch UI.

---

### 2.6 Rollout Planning (`/pms/planning`)

1. Select dispatched lines.
2. Set **plan date** and **visit type** (e.g. Work Done, Re-Visit, Extra Visit).
3. **Create plans** → **Rollout Plan** records; visit multipliers come from **Visit Multiplier Master** where applicable.

**Visit types (typical multipliers)**

| Type | Multiplier | Use |
|------|------------|-----|
| Work Done | 1.0× | First execution visit |
| Re-Visit | 0.5× | Rework / return |
| Extra Visit | 1.5× | Extra mobilisation |

---

### 2.7 Execution monitor (`/pms/execution`)

Read-only monitor of rollout/execution progress. **Auto-refresh every 30 seconds.**

---

### 2.8 Work Done (`/pms/work-done`)

Lists completed work with billing and financial columns. Filters may include team, project, billing, dates, POID / **dummy POID** (if used on your site).

**Rates:** Revenue uses **Customer Item Master** (e.g. standard vs hard region) per your item/site rules.

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

| Page | URL | Purpose |
|------|-----|--------|
| My Dashboard | `/pms/im-dashboard` | KPIs, action items, month/today completion charts, financial snapshot; subtitle shows team/project counts from API |
| My Projects | `/pms/im-projects` | PCC rows where **Implementation Manager** = you |
| My Teams | `/pms/im-teams` | Your INET teams |
| Dispatches | `/pms/im-dispatch` | IM-scoped dispatches |
| Planning | `/pms/im-planning` | IM-scoped planning |
| Execution | `/pms/im-execution` | IM-scoped execution monitor |
| Work Done | `/pms/im-work-done` | IM-scoped work done list |
| Issues & Risks | `/pms/im-issues-risks` | IM-scoped issues/risks |
| Reports | `/pms/im-reports` | Tabs: PO dispatches summary, rollout plans, executions (MTD), work done (MTD), projects table |
| Time logs | `/pms/im-timesheets` | IM-scoped time entries |

If the API cannot resolve an IM, the dashboard may show an informational **message** from the server (e.g. no active teams).

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

## 5. Desk workspace (PMS)

In **ERPNext / Frappe Desk**, open workspace **PMS**:

- **INET PMS** — browser goes to **`/pms/dashboard`** (portal).
- Other shortcuts — standard **DocType** list views (PO Intake, PO Dispatch, Rollout Plan, Daily Execution, Work Done, Execution Time Log, masters, Daily Work Update, etc.).

Run **`bench migrate`** (or reload the Workspace doc) after pulling app changes so Desk matches the packaged JSON.

---

## 6. First-time setup (reference)

1. **Roles:** Assign `INET Admin`, `INET IM`, or `INET Field Team` as appropriate. Link **IM Master.user** to IM users; link **INET Team.field_user** to field users where possible.
2. **Masters:** Import or create master data (areas, teams, items, projects, multipliers, etc.). Optional: use your **`CONTROL_CENTER.xlsx`** import path if `inet_app.api.data_import` is part of your deployment (`import_control_center_xlsx` from bench console — paths and file names per ops runbook).
3. **Smoke test:** `PO Upload` → `Dispatch` → `Planning` → field **Execute** → confirm **Work Done** and dashboard movement.

---

## 7. Example workflow (conceptual)

1. PO file uploaded → PO Intake lines.  
2. Dispatch → PO Dispatch per team/month.  
3. Planning → Rollout plans with dates and visit types.  
4. Field completes execution → Work Done + financials.  
5. Command / IM dashboards and reports refresh on timers or reload.

---

## 8. Key financial ideas (high level)

| Idea | Typical source |
|------|------------------|
| Revenue | Customer item rates × executed qty (± region rules) |
| Cost | Team daily cost, subcontract rules, activity costs |
| Margin | Revenue − cost |
| Visit multipliers | Visit Multiplier Master |

Exact formulas live in DocTypes, server scripts, and reports — treat this table as a map, not a spec.

---

## 9. Navigation reference (portal)

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

Prefix paths with `/pms/im-…` as in section 3 (e.g. `/pms/im-dashboard`).

### Field

`/pms/today`, `/pms/field-execute`, `/pms/field-qc-ciag`, `/pms/field-history`, `/pms/field-timesheet`.

### Cache

After deployments, use a **hard refresh** (e.g. Ctrl+Shift+R / Cmd+Shift+R) so the browser loads the new `index.js` bundle.

---

## 10. Troubleshooting

| Issue | What to check |
|-------|----------------|
| Blank or stuck after login | Bench running; browser console/network errors; `get_logged_user` returns `authenticated: true` |
| Wrong portal role | User role list: `INET Admin` / `INET IM` / `INET Field Team` |
| IM dashboard empty / message | IM Master link; INET Team **im** matches resolved IM; active teams exist |
| IM “not linked” on My Projects | PCC **Implementation Manager** must match your IM identifier |
| Field user sees wrong team | **INET Team.field_user** should point to that user |
| Desk PMS shortcuts outdated | `bench migrate` or re-import **Workspace PMS** |
| Old UI after release | Hard refresh; ensure `inet_app/public/portal/assets/` was rebuilt (`npm run build` in `frontend`) and deployed |

---

**Stack (typical):** Frappe / ERPNext 15 · React portal (Vite) · MariaDB.

**Doc maintenance:** This file is the canonical text guide. The styled **`docs/user-guide.html`** is a companion; if both exist, prefer this Markdown for the newest behaviour.
