# Dashboard rules — what every figure means and where it comes from

The working agreement behind the dashboards, settled with the client in the
Oct–Nov 2026 audits (IM View, Executive, Projects & Operations, Command).
Read this before adding a tile, a chart or a report figure. It supersedes
`DASHBOARD_API_MAPPING.md`, which describes the pre-merge CEO / Ops /
Financial pages.

Short version: **a figure must be the row count (or sum) of the page it opens,
and that page must open already filtered to the same set.** Everything below
is how that is achieved.

---

## 1. The dashboards

| Page | Route | Frontend | Data |
|---|---|---|---|
| Command | `/dashboard` | `admin/CommandDashboard.jsx` | `get_command_dashboard(from, to)` |
| Executive | `/executive-dashboard` | `admin/ExecutiveDashboard.jsx` | Command payload + `get_executive_extras` + `get_commercial_dashboard` + `get_top_teams_report` |
| Projects & Operations | `/projects-operations` | `admin/ProjectsOpsDashboard.jsx` | Command payload + `get_executive_extras` + Project Profitability + PO Dispatch Status + `get_execution_analytics` |
| PIC & Finance | `/pic-dashboard` | `pic/PICDashboard.jsx` | `pic_dashboard_payload` (kept in its old purple style on purpose) |
| IM View / My Dashboard | `/im-dashboard-view`, `/im-dashboard` | `im/IMDashboard.jsx` | `get_im_dashboard` + `get_execution_analytics` |

Command's own layout and figures are client-approved. Change them only after
the user has verified the change; adding tiles or a link target is fine.

---

## 2. Reuse the page's own query — never a second definition

A tile that runs its own COUNT drifts from the list it opens (a tile saying 18
that opens 33). So:

- **Call the function the target page calls**, with the filters the click
  passes: `list_im_rollout_plans`, `list_work_done_rows(..., _count=1)`,
  `list_po_dispatches`, `monthly_team_details.build`,
  `_project_performance_report(im_ids)`, `_top_teams_report`.
- If a raw SQL count is unavoidable, copy the page's WHERE exactly and
  **verify the two numbers are equal** on `inet_backup` before calling it done.
- Company figures are **composed, not re-queried**: `get_executive_extras`
  splits Command's Revenue and Cost by IM from the same four terms, so the IM
  rows add up to the tiles. Never put a second "revenue" beside the first.

### Drill-through: the state each page accepts

A link must carry the filters that made the number. These are the keys the
target pages read on mount:

| Target | How | Keys |
|---|---|---|
| `/work-done` (PM) | `state.workDoneFilters` | `tab`, `imFilter`, `includeFinished`, `fromDate`, `toDate`, `workTypeFilter`, `teamFilter`, `subconFilter`, `issueFlagFilter` |
| `/im-work-done` | `state.workDoneFilters` | `tab`, `fromDate`, `toDate`, `sourceFilter` |
| `/execution`, `/im-planning`, `/im-execution` | `state.execFilters` | `bucket`, `bucketLabel`, `planStatusFilter`, `fromDate`, `toDate`, `imFilter`, `closure`, `tab` |
| `/planning` (PM Rollout Planning) | `state.planFilters` | `imFilter`, `planScope` (`unplanned` / `all` / `open_dummy`), `dummyFilter`, `portal` (extra `list_po_dispatches` filters), `label` |
| `/im-dispatch` | `state.dispatchFilters` | `fromDate`, `toDate` (target-month window) |
| `/im-po-intake` | `state` | `tab`, `ovStatusFilter` |
| `/issues-risks`, `/approvals` | `state.imFilter` | IM Master names |
| `/im-teams` | `state.tab` | `incoming`, `outgoing`, `my` |
| `/teams` | `state.teamFilters` | `statusFilter`, `typeFilter`, `categoryFilter`, `imFilter`, `statFilter` |
| `/dashboard` | `state.range` | `{from, to}` |
| `/reports`, `/im-reports` | URL | `?tab=&from=&to=&month=&im=` |

When extra hidden conditions are applied (`planFilters.portal`,
`includeFinished`, an IM-only approvals view), the page shows a blue notice
"…as counted on the dashboard" with a **Show all** button.

**From the PM's IM View every link must carry the IM.** A link that lands on
an unfiltered company-wide list is a bug.

---

## 3. Date bases — which date puts a thing in a period

| Thing | Dated by |
|---|---|
| INET's own work, Work Done, team revenue | the execution date: `COALESCE(exe.execution_date, DATE(wd.creation))` (Direct Close: the IM's stated close date where the report uses it) |
| Subcontracted work (company revenue, payout) | the customer invoice: `subcon_payout_events_sql().event_date` |
| Invoiced (PIC, Executive) | the customer invoice date, via `pic_dashboard_payload(from, to)` |
| PO received | `_po_line_published_on()` (upload date, else publish date, else start date) |
| Plans — assigned / completed / overdue counts | `rp.plan_date` (these count plans, not money) |
| Revenue of any kind | **never** the plan date |

A plan cannot be executed before its plan date: `update_execution` and
`start_execution_timer` refuse it. Plans that slipped through before that
check were re-dated by the patch `fix_plan_date_after_execution` (completed
plans worked in an earlier month only).

**Stocks have no date** and are labelled "now" / "as of today": open lines,
lines still to do, order book, not yet invoiced, dummy POs. A date range on
them would zero the backlog or push billed % to 100.

---

## 4. Company money (Command's definitions)

```
Revenue = INET teams' work (execution date, INET side of split lines)
        + Direct Close, INET side   + Backend close, INET side
        + Subcontracted work at full value (customer invoice date)
Cost    = INET team salary to date + subcontractor payout + deductions Paid Out
Profit  = Revenue − Cost
Target  = INET team cost × 1.25 (confirmed 2 Nov 2026) + each subcontract's monthly_target
```

- **As of today:** target to date = target × the share of the range gone;
  salary stops at today. Every gap and coverage while a period is running is
  compared with the target **to date**, never the whole period's (Command's
  Subcontractor gap used to be whole-month beside a to-date INET gap).
- **Comparisons are like for like:** a range from the 1st compares with the
  same days of the month(s) before (1–2 Nov with 1–2 Oct, October with
  September); any other range with the same number of days just before it.
- Team cost in reports also stops at today (`_top_teams_report`) and honours
  `INET Team.daily_cost_applies`, as Command and the IM report do.

---

## 5. Lines, plans and Work Done — named sets

| Name on screen | Definition | Opens |
|---|---|---|
| Open PO lines (IM) | IM's `PO Dispatch` not done (`LINE_DONE_STATUSES`) and not Cancelled, internal work excluded | PO Control › All POIDs / Rollout Planning |
| Lines still to do | Pending, Dispatched, Planned, Backend Assigned (= PO Dispatch Status stages Not Started + In Rollout) | Rollout Planning |
| Order book | PO **Intake** lines not Closed/Cancelled — includes done and invoicing lines; not "to do" | — |
| Lines to plan | Dispatched, target month **this month or earlier** | IM Dispatch / Rollout Planning |
| Lines forecast for later | Dispatched, target month after this month | same, `fromDate` next month |
| Lines to forecast | Pending/Dispatched with **no** target month, internal excluded | PO Intake / Rollout Planning |
| Dummy POs to map | `is_dummy_po = 1` — planned or not | Rollout Planning › Dummy POs › Open, PO Control › Dummy |
| Plans on dummy PO · not mapped | Execution Analytics bucket: **plans** on a dummy PO | Execution Monitor |
| Work done | every Work Done in range, closed in PIC included: `list_work_done_rows({tab:"all", include_finished:1})` | Work Done with finished shown |
| Done, closed in PIC | its delivered quantity's milestones are terminal (Command's Closed) | — |
| Done, not closed | Work done − closed | — |

A line delivered short is **closed for what was delivered**; the remaining
quantity is future work or cancelled. The Work Done page still lists such a
line while quantity remains, unless the remainder is marked **Cancelled** or
**to be invoiced**.

---

## 6. IM and team scoping

- An IM's figures use the IM **stamped on the record** (`PO Dispatch.im`,
  `Rollout Plan.im`, `Daily Execution.im`), never `INET Team.im` (the team's
  current manager). Never filter teams by status for history.
- Team counts: **INET field** (`team_type INET`, not Backend), **Subcon field**
  (`SUB`, not Backend), **Backend** (`team_category = Backend Team`).
  `subcon.active_sub_teams` is a count of active *subcontracts*, not teams.
- Idle today = Active field teams with no execution and no live plan today;
  its link filters the Teams page to Active + Field Team + Idle.

---

## 7. UI conventions

- Header: `components/DashHeader.jsx` — title centred with "Last updated",
  filters on the right, like Command. PIC & Finance keeps its purple hero.
- One date filter per page: the standard `DateRangePicker` (presets + any
  dates). No second picker for the same page.
- `Tile` takes `onClick` (opens the source) and `delta` (`{text, dir}`, the
  change against the period before). Charts take `onBarClick(row)`.
- Every "waiting / needs attention" row is clickable and hides when zero.
- Label the period on every figure: the range ("· Oct", "· 5–20 Oct"),
  "now", "today", or "all time".

---

## 8. Before calling a figure done

1. Compare it with the page it opens on `inet_backup` (the production copy),
   with the same filters — numbers must be equal.
2. Click it in a browser (headless recipe in the bench memory notes) and
   check the landing page's filters and row count.
3. Sweep the other dashboards and reports that show the same thing
   (`CLAUDE.md` › "A feature is not finished when the feature works").
