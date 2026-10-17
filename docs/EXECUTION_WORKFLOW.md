# Execution Workflow — the design as the code actually implements it

**What this is.** The rollout workflow was built feature by feature, without a
single written design. The rules are real and mostly deliberate, but they live
scattered across `command_center.py`, a dozen React pages and a lot of good
code comments — so when something looks wrong there is no baseline to compare
it against, and nobody can say whether a given behaviour was intended.

This file is that baseline. Every rule below was read out of the code and is
cited `file:line`. It describes **what the system does today**, not what it
should do.

**How to use it.** Before changing anything in the execution flow, find the
rule here. If the change contradicts a rule marked **[D]**, that is a design
decision being reversed — say so out loud. If it contradicts one marked
**[?]**, you are resolving an open question, and this file should be updated
with the answer.

| Mark | Meaning |
|---|---|
| **[D]** | Deliberate. The code states the reasoning, usually in a comment explaining what broke before. |
| **[?]** | Unverified. The behaviour is real, the intent is not recorded anywhere. Treat as an open question. |

Last reviewed: 16 October 2026, against `inet_backup` (a production copy).
Companion documents: `SYSTEM_OVERVIEW.md` (architecture, roles, navigation),
`PARTIAL_QTY_AND_TRACKING_PLAN.md` (the partial-quantity build plan).

---

## 1. The documents and their grain

Grain is the single most common source of confusion — two pages can disagree
simply because they count different things.

| Doctype | One row per | Key fields |
|---|---|---|
| **PO Dispatch** | **a PO line (POID)** — the spine | `qty`, `confirmed_qty`, `remaining_qty`, `remaining_qty_action`, `dispatch_status`, `pic_status`, `pic_status_ms2` |
| **Rollout Plan** | **one planned slice of one attempt** | `plan_date`, `plan_status`, `visit_number`, `visit_type`, `qc_required`, `ciag_required`, `issue_status`, `source_rollout_plan` |
| **Rollout Plan Team** | **a team on that plan** (child) | `team`, `assigned_qty`, `achieved_qty` |
| **Daily Execution** | **one team's work on one plan** | `execution_status`, `tl_status`, `qc_status`, `ciag_status`, `achieved_qty`, `revisit_flag` |
| **Work Done** | **one revenue record per visit** | `source`, `executed_qty`, `billing_status`, `submission_status`, `ms1_closed`, `ms2_closed` |
| **Execution Time Log** | **one timer run** | `rollout_plan`, `start_time`, `end_time`, `duration_minutes` |

Consequences that bite:

- One POID can have **many** Rollout Plans.
- One Rollout Plan can have **many** Daily Executions (one per team).
- One **visit** yields **exactly one** Work Done, no matter how many plans or
  teams it took. **[D]** — `command_center.py` → `generate_work_done()`, idempotent by design:
  clicking a second team's row returns the existing record rather than erroring.
- `Work Done.system_id` links to **PO Dispatch**, not to Rollout Plan. There is
  no `Work Done.rollout_plan` field.

---

## 2. The three closure routes

A line reaches Work Done by exactly one of:

1. **Rollout** — Plan → Daily Execution → QC → Work Done. The normal path.
2. **Direct Close** — IM records the work immediately, no plan.
3. **Backend** — back-office closure, no field work.

**A line is closed by the rollout OR by a shortcut, never both. [D]** A line
with a shortcut Work Done cannot be planned, forecast or dispatched; a line
with a live plan or forecast week cannot be direct-closed or sent to backend.
`adopt_existing` is the one supported crossing, and it **moves** the existing
record rather than creating a second.

`Work Done.source` records which route was used: `Rollout Execution`,
`Backend`, `Direct Close`.

---

## 3. Visits, companion plans and multi-team plans

This is the part most often misread.

### A visit is an attempt. A plan is a slice of an attempt.

`_next_visit_number_for_dispatch` — `command_center.py` → `_next_visit_number_for_dispatch()` **[D]**

- Work that needs **two dates**, or **two teams on two dates**, is still the
  **first** visit. Those plans are *companions* and share `visit_number = 1`.
- Only `visit_type` in **Re-Visit** or **Extra Visit** advances the number.
- Advancing is `MAX(visit_number) + 1`, never `COUNT`. The comment records why:
  with companions, `COUNT` made the next Re-Visit #3 and skipped #2.
- The first plan on a line starts at 1; a companion joins the visit in progress.

### Superseded visits

A plan whose `visit_number` is lower than the line's maximum is a past attempt.
`_execution_superseded_exists_sql` — `command_center.py` → `_visit_closed_exists_sql()` — removes it from
the live lists. **[D]** Live work belongs to the latest visit.

### Multi-team plans

`_sync_plan_teams` — `command_center.py` → `_sync_plan_teams()` **[D]**

- `Rollout Plan Team` rows carry `assigned_qty` per team.
- The sum must be `<= total_qty`, with **1 unit of slack**.
- Rejects rather than clamps — a wrong split becomes a wrong payment.
- Idempotent: wipes and re-inserts the child rows.

Each team produces its own Daily Execution. So a two-team plan is **two rows**
on Rollout Work Done and **one** Work Done.

**[?]** Companion plans are validated one at a time, so two teams on the same
visit can each be assigned the whole line. `derive_dispatch_allocations`
scales an over-sum back at read time rather than refusing it
(`subcontractor_sync.py` → `derive_dispatch_allocations()`). Whether planning should refuse it up front is
not recorded.

---

## 4. Status: who sets what, and who wins

### Rollout Plan
`Planned` · `Planning with Issue` · `In Execution` · `Overdue` ·
`Not Attended` · `Extended` · `Completed` · `Cancelled`

### Daily Execution — two independent signals
- `execution_status`: `In Progress` · `Completed` · `Hold` · `Cancelled` ·
  `Postponed` — **the IM's authoritative confirmation**
- `tl_status`: the same values plus `Not Attended` — **the team lead's own flag**,
  which arrives before the IM confirms

### The precedence rule
`_sync_rollout_plan_from_daily_execution` — `command_center.py` → `_sync_rollout_plan_from_daily_execution()` **[D]**

> A **terminal** state from **either** side wins over a non-terminal state on
> the other.

So if the IM set `execution_status = In Progress` and the TL later marks
`tl_status = Completed`, the plan moves to Completed. Earlier code preferred
`execution_status` by truthiness and produced exactly that bug.

### Which signal has authority, and where **[D]**

| Signal | Set by | What it drives |
|---|---|---|
| `tl_status` | the field team lead | **only** `plan_status`, through the sync above. Nothing else reads it for a decision — verified: the one decision site is `_sync_rollout_plan_from_daily_execution` ((`_sync_rollout_plan_from_daily_execution()`)); every other mention is display, logging or the reschedule log. |
| `execution_status` | the IM, confirming | Work Done eligibility (section 6) and the closed rule (section 8). **This is the authority for every page's membership.** |
| `plan_status` | derived from both | the stage filters on Rollout Execution and the PM monitor |

So `tl_status = Completed` with `execution_status` still open is **normal and
expected**: the TL has finished and the IM has not yet confirmed. It is not a
sync gap, and no page should compare the two. Some transitions are automated
from the field, others are set by hand by the IM; `execution_status` is where
that confirmation lands.

### Cancelled is terminal for a plan **[D]**
Nothing un-cancels a plan; a re-attempt gets a new plan.
`_sync_rollout_plan_from_daily_execution` must never write a status onto a
cancelled plan — it used to, which resurrected plans a PM had cancelled.

---

## 5. Quantities

Five different quantities, easily confused:

| Field | Where | Means |
|---|---|---|
| `PO Dispatch.qty` | the line | **ordered** by the customer |
| `Rollout Plan Team.assigned_qty` | per team | **planned** for that team |
| `Daily Execution.achieved_qty` | per team | **done** by that team |
| `PO Dispatch.confirmed_qty` | the line | **IM-confirmed as delivered** |
| `PO Dispatch.remaining_qty` | the line | the **shortfall** still open |

### Confirmation
`confirm_line_qty` → `_apply_confirmed_qty` — `command_center.py` → `get_dispatch_subcontractor_breakdown()`, `:11679`

- Permission: PM/admin, or the IM the line is assigned to.
- **Raises rather than silently clamping [D]** — a wrong quantity here becomes
  a wrong invoice, so every rejection says what the caller must do instead.
- An optional per-subcontractor `allocation` splits the confirmed quantity;
  `_normalised_allocation` (`_remainder_close()`) rejects a split that does not add up.

### What happens to the shortfall
`set_remaining_qty_action` — `command_center.py` → `_apply_confirmed_qty()` **[D]**

`remaining_qty_action` ∈ `Cancelled` · `Pending – to be worked` ·
`Pending – to be invoiced`.

Deliberately **separate from confirmation**: the delivered quantity is known at
handover, the fate of the shortfall usually is not. Callable any time after a
short confirmation, and **re-callable** if the answer changes.

### Closing a remainder later
`_remainder_close` — `command_center.py` → `_sync_work_done_closures()`; `_outstanding_remainder` — `:11510`

- `_outstanding_remainder` returns `(qty, source)` and is what the guards use
  to tell *"this line is finished, refuse"* from *"this line has a confirmed
  remainder, let the same route close it"*.
- Closing a remainder **adds** to `confirmed_qty` (`_remainder_close()`) — a POID keeps one
  Work Done for its whole life and gains another closure row.

### Planning the remainder again
A line confirmed short with `remaining_qty_action = Pending – to be worked` is
re-plannable. **[?]** Whether that new plan should be an `Execution` companion
or a `Re-Visit` is not stated anywhere — the two give different visit numbers
and therefore different Work Done scoping.

---

## 6. Work Done eligibility — the exact gates

`generate_work_done` — `command_center.py` → `generate_work_done()`

In order:

1. **Role** — PM-level or `INET IM`.
2. **Not internal work** — internal lines never get a Work Done; they use
   *Mark Done*. **[D]**
3. **`execution_status == "Completed"`** — refuses otherwise.
4. **QC** — unless the plan's `qc_required = 0`, at least one Daily Execution
   on the plan must have `qc_status` in `Pass` / `Not Applicable`.
   The OR rule across team executions is deliberate: **any Pass = plan Pass**. **[D]**
5. **CIAG** — unless the plan's `ciag_required = 0`, **this execution's**
   `ciag_status` must be `Approved` or `Not Applicable`. **[D]**
6. **Every companion PLAN of the visit must be finished** — a completed
   execution with QC settled, judged by each companion's own `qc_required`.
   Cancelled companions are ignored. **[D]**
7. **Every other EXECUTION on this plan must be finished too** — two teams on
   one plan are two Daily Executions, and the check above only ever looked at
   other *plans* (`rp2.name <> rp_name`). So the lead team finishing was
   enough to record the whole line while the second team was still in the
   field. Cancelled siblings are ignored, exactly as cancelled companions
   are. Added 17 Oct 2026; one record had been created this way
   (`1011HG3692386-2838-1-1`). **[D]**
8. **Idempotent** — if any execution of the plan already has a Work Done, it
   returns that record with `already_exists`. **[D]**

The gates fire in that order, which matters when testing: a fixture that
already has a Work Done never reaches gate 7, and one with CIAG open never
reaches it either.

### Why CIAG is checked on this execution, not OR'd across the plan

QC uses the OR rule (any team's Pass counts). CIAG deliberately does not.

The Work Done is built from **this** execution, and it is **this** execution's
`ciag_status` that `_execution_closed_exists_sql` reads afterwards (section 8).
Gating on a sibling's approval would let a Work Done be created that could
never satisfy "closed" — the same mismatch in a new place.

This gate was missing until 16 Oct 2026. `ciag_required` was read into
`rp_flags` and never applied, so a Work Done could be created with CIAG still
`Open`; the line then had a Work Done but could never be closed, and sat on the
execution lists for good. Confirmed by the client as the intended rule and
closed with the gate above.

**Note the asymmetry that remains [?]:** QC is OR'd across the plan here, while
the closed rule reads the Work Done execution's own `qc_status`. A Work Done
created on an execution whose own QC is still Pending, on the strength of a
sibling's Pass, would hit the same trap CIAG just escaped. Not observed in the
data, not yet gated.

---

## 7. Issues, Re-Visits and rescheduling

Three different actions that are easy to conflate:

| Action | Creates a plan? | Advances `visit_number`? | What it does |
|---|---|---|---|
| **Report Issue** (`reopen_rollout_for_revisit`, `:19960`) | **No** | No | Marks the source plan and its executions as needing a Re-Visit. The IM then creates the Re-Visit plan from Issues & Risks. **[D]** |
| **Create Re-Visit** (from Issues & Risks) | Yes | **Yes** — `visit_type = Re-Visit` | A fresh attempt at the line |
| **Reschedule** (`reschedule_rollout_plan`, `:19995`) | **No** | **No** | Resets `plan_date` and `plan_status` to `Planned` for a plan that never executed (Not Attended / Cancelled / Overdue / Hold), logging to `reschedule_log`. `new_end_date` lets a multi-day job keep a genuine multi-day span. **[D]** |

`Rollout Plan.issue_status` ∈ `Reported` · `Re-Planned` · `In Execution` ·
`Resolved`.

A plan with `issue_status = Reported` — or a blank status with
`plan_status = Planning with Issue` — is **hidden from Rollout Work Done**
(`issue_block_clause`, `command_center.py` → `list_im_rollout_plans()`). **[D]** It needs the issue
resolved, not a Work Done.

---

## 8. "Closed" — one definition

`_visit_closed_exists_sql(alias, de_alias, pd_alias)` — `command_center.py` → `_execution_monitor_scope()`

A row is finished when **all** of:

1. the line has nothing outstanding — `remaining_qty <= 0`, **or** this plan
   predates the last closure so the ledger already counted it
   (`_settled_guard_sql`, `:9045`)
2. an execution is `Completed`
3. its **own** QC and CIAG are settled, honouring `qc_required` /
   `ciag_required`
4. a Work Done exists for this `po_dispatch` **at this `visit_number`**, on a
   plan that is not Cancelled

`de_alias` picks the grain. Omitted, the caller is at Rollout Plan grain and
any execution of the plan can satisfy it. Given one, the caller is at Daily
Execution grain and the rule reads:

```
(this execution Completed AND it finished the visit)  OR  (someone else finished the visit)
```

**The `Completed` requirement belongs only to the first arm. [D]** The second
is about someone *else* having finished, and one visit yields one Work Done —
so a two-team plan whose first team produced it leaves the second team's row
with nothing to produce. Requiring `Completed` there left that row open
forever. Corrected 17 Oct 2026; `1011HG3692386-2838-1-1` was the worked
example, with one execution Completed and carrying the Work Done while its
sibling sat In Progress.

**Why visit-scoped. [D]** One visit yields exactly one Work Done however many
companion plans it took (section 3). A plan-scoped test left the companion
that did not happen to own the Work Done stuck open forever — it can never
acquire one. `1011HG3692387-963-2-1` sat on the Execution Monitor for exactly
that reason: two companion plans at visit 1, the Work Done on one of them.

**Why the outstanding guard. [D]** A visit can gain a further plan *after* its
first confirmation — the "All POIDs (re-plan)" flow and the remainder close
both add a companion rather than a new visit. Without the guard, the Work Done
from the earlier companion hid the new executions and the outstanding quantity
could never be recorded.

### History: two definitions used to coexist

Until 17 Oct 2026 there were two. `list_im_daily_executions` hid finished rows
with this rule written inline, while `_execution_closed_exists_sql` — used by
the PM monitor, Execution Analytics, **and both IM pages whenever a `closure`
filter was passed** — was plan-scoped, ignored outstanding quantity and
counted a Work Done sitting on a cancelled plan. So the same endpoint could
apply two different rules in one query, and the PM and IM could not agree
about the same line. The weaker one is deleted; all five call sites now share
`_visit_closed_exists_sql`.

---

## 9. Page membership — what each surface shows

Four surfaces read this workflow. They now share one definition of finished;
they still differ in grain and in which stage they cover, deliberately.

| Page | Role | Endpoint | Grain | What removes a finished line |
|---|---|---|---|---|
| **Execution Monitor** | PM | `list_execution_monitor_rows` | Rollout Plan | `closure` defaults to `"open"` → `NOT _visit_closed_exists_sql()`; **plus `_issue_blocked_sql()`**, exempt on a bucket drill-through. Frontend status default is every live status except `Cancelled` and `Planning with Issue`. **[D]** |
| **Rollout Execution** | IM | `list_im_rollout_plans` | Rollout Plan | No done-rule by default; finished work is hidden by the frontend `plan_status` whitelist (`IMPlanning.jsx`). **Current visit only, by default** since 17 Oct 2026. **[?]** on the whitelist |
| **Rollout Work Done** | IM | `list_im_daily_executions` | Daily Execution | `NOT _visit_closed_exists_sql(de_alias="de")`, unless a bucket or rating-history filter is active; `_issue_blocked_sql()`; **no cancelled PLAN**. **[D]** |
| **Work Done** | IM + PM | `list_work_done_rows` | Work Done record | n/a — it is the record list. Excludes cancelled lines. **[D]** |

### Two rules that were on one page and not the other

**`_issue_blocked_sql()`** — a plan parked on a reported issue belongs on
Issues & Risks, not on an execution list. Rollout Work Done has excluded
these from the start; the PM monitor did not, so **every** issue plan
appeared both there and on the PM's own Issues & Risks page — 22 of
IM-AJMAL's 106 monitor rows, all 22 already on Issues & Risks. Shared and
applied to both, 17 Oct 2026.

**Exempt on a bucket drill-through. [D]** The tile counted a population with
its own predicate and the list must show exactly that, or `issue_flagged`
opens an empty table. Adding the block without this exemption broke 10 of 16
tiles immediately — the same reason `tab` is forced to `"all"` for a drill-in.

**Cancelled PLAN excluded from Rollout Work Done** — a cancelled plan is
terminal, so its executions are not work anyone can act on. 117 rows sat
there, 112 still showing *In Progress* or *Postponed*, none with a Work Done.
Keyed on `rp.plan_status` **only**: a cancelled *execution* or `tl_status` on
a LIVE plan is a different thing — that attempt failed and the plan still
needs an outcome — and all 20 of those stay. **[D]**

### Measured (17 Oct 2026, production copy)

| | Start of day | After |
|---|---|---|
| PM Execution Monitor | 498 | **477** |
| IM Rollout Work Done | 544 | **430** |
| IM Rollout Execution | 78 | **66** |

Per IM, plans on one surface and not another — **both directions zero**:

| IM | Rollout Execution | Rollout Work Done | PM monitor | PM-only | IM-only |
|---|---|---|---|---|---|
| IM-AJMAL | 12 | 72 | 82 | 0 | 0 |
| IM-MAJID | 47 | 328 | 358 | 0 | 0 |
| IM-Manu | 7 | 29 | 36 | 0 | 0 |

Row counts still differ from plan counts by grain: Rollout Work Done is one
row per execution, so Majid's 328 rows are 327 plans.

---

## 10. The `work_done` column is scoped to the VISIT, not the execution

Both execution lists resolve a row's Work Done with:

```sql
WHERE rp_wd.po_dispatch = rp.po_dispatch
  AND IFNULL(rp_wd.visit_number,0) = IFNULL(rp.visit_number,0)
```

**[D]** — the comment at `command_center.py` → `list_im_daily_executions()` explains: a visit can run to
several companion plans and yields one Work Done, anchored to whichever
execution finished last. Scoping to `de.rollout_plan` left every other
companion row looking eligible forever, and clicking it only ever answered
"already covers this line".

Read it as **"this visit's work is already recorded"**, not "this execution
produced it". A companion execution that is Cancelled, Postponed or In Progress
will legitimately show a Work Done it did not create. Verified: all 24 such
rows on the production copy have no Work Done of their own.

---

## 11. The access-time badge

`accessTimeBadge` — `frontend/src/utils/executionTimerDisplay.js`

- Goes live **only on the plan's own date**; any other date shows the grey
  scheduled time. **[D]**
- Arrival is `MIN(Execution Time Log.start_time)` for **that site, that day** —
  scoped to `site_code` and `CURDATE()`, not to the plan. **[D]** The IM needs
  to know whether the crew reached the *site* on time; a second job started
  after the first completes is expected.
- Both pages must supply `access_time`, `access_period`, `timer_start_ms`,
  `tl_status` and `plan_date`. `list_im_rollout_plans` did not return
  `tl_status`, so the two pages showed different badges — fixed in `edfc1c4`.

**[?]** A lateness *report* is derivable from stored data (`access_time` +
`Execution Time Log.start_time`), but only ~26% of plans are measurable today,
and a night shift crossing midnight needs an explicit day-boundary rule.

---

## 12. Open questions, in priority order

1. ~~**CIAG at Work Done creation**~~ — **resolved 16 Oct 2026**, confirmed by
   the client and gated in `generate_work_done`. See section 6.
2. ~~**IM pages do not use the shared rule**~~ — **resolved 17 Oct 2026.** The
   premise was wrong: `list_im_daily_executions` had the stronger rule inline
   all along. The weaker `_execution_closed_exists_sql` is deleted and all
   five call sites share `_visit_closed_exists_sql`. See section 8.
3. **Rollout Execution has no done-rule of its own** — `closure` defaults to
   `"all"` there against `"open"` everywhere else, so finished work is hidden
   only by the frontend `plan_status` whitelist, which a user can clear.
   Left deliberately: widening the status filter on a *planning* page is the
   IM asking for history, and defaulting `closure` to `"open"` would hide
   2,565 closed plans with no control to get them back. **[?]** if a closure
   switch is ever added to that page, revisit this.
   Its `visits` default **was** changed on 17 Oct 2026 — see section 9.
4. **Re-plan of a confirmed remainder** — `Execution` companion or `Re-Visit`?
   Unstated, and it changes visit numbering and Work Done scoping.
5. **Over-assignment at planning** — scaled back at read time rather than
   refused at entry.

---

### Closed, and why they are not defects

Two things that look like gaps and are not. Both were investigated on
17 Oct 2026 and confirmed as expected states. **[D]**

- **A Completed execution with no Work Done record** (50 plans on the monitor
  today). The IM has confirmed the execution and not yet created the Work
  Done. That is the IM's next action, and the monitor showing it is the point.
- **`plan_status = Completed` with no Completed execution** (476 plans, 461 of
  them with `tl_status = Completed`). The TL finished, the IM has not yet
  confirmed. `plan_status` moved by the precedence rule in section 4 — a
  terminal state from either side wins. Accepting `tl_status` in the closed
  rule would change nothing: only 1 of the 476 has a Work Done, and the rule
  requires one regardless.

Together these are **75% of the PM Execution Monitor** — 320 awaiting IM
confirmation, 50 awaiting a Work Done. The monitor is largely a view of the
IMs' pending queue, which is what it is for.

---

## 11b. Internal work runs on a separate closure track

Internal work **never gets a Work Done** — `generate_work_done` refuses it
outright (`generate_work_done()`): *"Internal work never gets a Work Done record — use Mark
Done instead."* **[D]** `mark_internal_work_done` (`mark_internal_work_done()`) refuses anything that
is *not* internal and simply sets `execution_status = 'Completed'` (plus
`tl_status` if blank, and clears `issue_status`).

So for internal work, **done means `execution_status = 'Completed'`** — no
Work Done, no QC/CIAG, no closed rule. `_visit_closed_exists_sql` is
therefore **always false** for internal work, because its fourth gate needs a
Work Done. Measured: 197 internal plans, 83 done, **0 with a Work Done, 0 that
the closed rule calls closed.**

Finished internal work is removed from each surface by a parallel mechanism,
written four different ways:

| Surface | Mechanism |
|---|---|
| IM Rollout Work Done | client-side split into the *Internal Work Done* tab (`IMExecution.jsx`, `filteredExecutions`) |
| PM Execution Monitor | backend `tab` main/internal_done split (`list_execution_monitor_rows()`) |
| Execution Analytics | `NOT (is_internal_work AND any_im_done)` (`get_rollout_forecast_dashboard()`) |
| IM Rollout Execution | **only on a bucket drill-through** (`get_rollout_commercial_summary()`); otherwise nothing |

They agree today — the one place they could drift, *any* execution Completed
versus *latest* execution Completed, differs on **0** plans.

**Consequence [D]:** `closure = "closed"` never returns internal work. The
monitor's closed view is 2,564 rows, 0 of them internal. Finished internal
work is reachable only through the *Internal Work Done* tab.

**[?]** Four expressions of one rule is a drift risk. A single
`_internal_done_sql()` beside `_visit_closed_exists_sql`, used by the three
backend sites, would remove it. Not done.

---

## 12b. Execution Analytics shares the rule — and the tiles reconcile

`get_execution_analytics` and `list_execution_monitor_rows` are built from the
same `_execution_analytics_where`, so a tile and the list it opens must agree.
They do: all **16 buckets** match their drill-through exactly, re-verified
after the rules below (17 Oct 2026). Any future change to
`_visit_closed_exists_sql` must re-check this — a tile that disagrees with the
list it opens is the most visible way this can break.

### `open` means what the monitor means [D]

The page used to report **777 open** against the monitor's **477** — the same
work, two numbers, which is the whole reason this file exists. Three things
were different; all three are now the same rule:

1. **Issue plans** were in the analytics base and not in the monitor's. They
   belong on Issues & Risks (§7) and are counted there, not here.
2. **Cancelled plans** (234) were in the base. `_ACTIONABLE` already kept them
   out of every bucket; they were left in the totals so the `plan_status`
   dimension could still show them. Hidden by default now — but *reachable*:
   tick `Cancelled` in the status filter and the base keeps them and the
   dimension lists them (235 lines). That mirrors the monitor, where the rule
   has always lived in the frontend's default status tick-list rather than in
   SQL. The same rule in two places, one of them a default the user can clear.
3. **IM scope.** Analytics scoped on `pd.im` while the monitor, both IM pages
   and Issues & Risks read `pd.im OR rp.im` — a plan can carry an IM its
   dispatch does not. `_rollout_scope_clause(..., include_plan_im=True)`.

Measured on the production copy, 17 Oct 2026 — analytics `open` against the
monitor under its own default statuses, and `issues_open` against the Issues &
Risks page, **per IM**:

| | analytics | the page it must match |
|---|---|---|
| all IMs, open | 477 | 477 |
| all IMs, Issues & Risks | 69 | 69 |
| IM-MAJID / IM-AJMAL / IM-Manu, open | 358 / 82 / 36 | 358 / 82 / 36 |
| the same three, Issues & Risks | 6 / 24 / 39 | 6 / 24 / 39 |

Mismatched IMs: **0**.

### Issues & Risks is a total, not a bucket [D]

A bucket is a slice of the base, and issue plans are no longer in the base —
a bucket for them would read 0. They are still open work somebody owns, so
they are counted beside the buckets as `totals.issues_open` and drawn dashed,
routing to `/issues-risks` (PM) or `/im-issues-risks` (IM).

Deliberately **not** folded into `open`: a line waiting on an issue is not
execution work. Once the issue is planned out, the follow-up plan enters the
monitor like any other, and is counted there — which is why showing the two
side by side does not double-count.

`_issue_risk_open_sql()` is now the single definition of an open issue row,
used by both the page and the tile, so they cannot drift.

### `issue_flagged` counts the Work Done flag [D]

The bucket read `rp.issue_category OR dex.any_issue` — the plan's reason a
visit went wrong — while its `target` said `work_done`, so it opened a page
that could not act on what it had counted. It now reads **Work Done's own**
`issue_flag`: POD/PPT required, TFM check list, spare part return, PAT/HO
approval — what is outstanding before a finished line can be billed.

**246** Work Done records carry a flag, on **232** distinct plans; 14 plans
have two flagged confirmations (two teams on one plan). The tile reads 232
because every tile counts plans. Nothing is dropped by an exclusion — 0 are
superseded, 0 cancelled, 0 issue-blocked, 0 internal.

This also removed an exemption: `list_execution_monitor_rows` used to skip the
issue block on a bucket drill-through, because the tile counted issue plans
and the list did not. Both apply it unconditionally now.

| Bucket | Plans | Means |
|---|---|---|
| `im_confirmation_pending` | 306 | TL finished, IM has not confirmed the execution |
| `issue_flagged` | 232 | Work Done flagged — outstanding before billing |
| `dummy_unmapped` | 201 | dummy PO never mapped to a real line |
| `ciag_pending` | 185 | CIAG still Open |
| `qc_pending` | 173 | QC not settled |
| `overdue_by_date` | 114 | past its plan date |
| `internal_pending` | 92 | internal work, IM has not confirmed |
| `no_execution` | 51 | planned, nothing filed |
| `work_done_missing` | 41 | confirmed, no Work Done record yet |

`totals` reports **3,040 lines · 2,563 closed · 477 open**, plus **69** on
Issues & Risks counted separately.

---

## 13. Keeping this file honest

- Cite `file:line` for every rule. A rule without a citation is a guess.
- When a behaviour turns out to be intended, move it from **[?]** to **[D]**
  and record *why*, not just *what*.
- When a change reverses a **[D]**, update this file in the same commit.
- Verify counts against `inet_backup`, not the `inet` dev site — dev carries
  old test entries that distort every measurement.
