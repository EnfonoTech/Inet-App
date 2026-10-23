# Plan close-out SLA — say what happened within 24 hours

**Status:** plan only, nothing built. Raised by the client 23 Oct 2026.
Numbers measured on `inet_backup`, a production copy.

## What the client asked for

Every plan must be closed out within 24 hours of being planned. An IM who
has not cleared their table cannot plan new work. Closing out means the IM
states an outcome, by one of three routes they already have:

* **Work Done** — the work is finished and recorded
* **Extend** — it did not happen, push it to a new date
* **Issue & Risk** — it is blocked, raise it as an issue

## Does the Execution Monitor already do this?

**Yes. No new page is needed.** It is already the pending-work list, and it
already has most of the machinery:

| already there | where |
|---|---|
| every non-closed plan, with status, team, IM, dates | `list_execution_monitor_rows` |
| 15 "why is this still open" buckets, incl. `overdue_by_date`, `no_execution`, `work_done_missing` | `EXECUTION_ATTENTION_BUCKETS` |
| the same predicates feeding Analytics, so tile and list cannot disagree | `_execution_analytics_where` |
| an `Overdue` plan status and a nightly job that sets it | `auto_mark_overdue_plans` |
| all three close-out routes | `generate_work_done`, `reschedule_rollout_plan`, `issue_status` |

Nothing on the close-out side has to be invented. The three routes the
client describes map one-to-one onto actions that exist today.

Three things are missing, and all three are small:

1. **A 24-hour clock.** Today's overdue is date-based, and the nightly job
   only touches plans still at `Planned` — a plan sitting at
   `In Execution` for three months is never marked.
2. **One definition of "closed out"** that counts all three routes. There
   isn't one; each screen asks its own question.
3. **The block itself.** Nothing stops planning today.

## The measured case for it — the client is right

226 plans on the production copy are past their end date by more than a
day, have no Work Done, are not Completed or Cancelled, and carry no
issue. What is actually holding them:

| | plans |
|---|---|
| no execution filed at all | 87 |
| execution open, team lead never completed it | 136 |
| waiting on QC (team lead) | 3 |
| **waiting on CIAG — the client's own approval** | **0** |
| **only the IM's confirmation left** | **0** |

**Not one of them is stuck on the customer.** Every single one is the field
side not reporting, which is exactly the complaint. So "the IM can clear
this" is true, and the rule is fair. Had a third of them been sitting on
CIAG the rule would have punished IMs for the client's own delay, and this
document would be recommending against it.

## The three dangers, and what each needs

### 1. Switching it on freezes the business

The 226 are spread across all three IMs — MAJID 114, AJMAL 87, Manu 24 —
and they are old:

| age past due | plans |
|---|---|
| 2–7 days | 13 |
| 8–30 days | 48 |
| 31–90 days | 74 |
| **90+ days** | **91** |

Enforce it tomorrow and no IM can plan anything until they have cleared a
backlog going back three months. **The rule must apply only to plans whose
end date falls on or after a stated go-live date**, kept in Inet Settings.
The history is a separate clean-up, not a blocker.

### 2. "24 hours after planning" is ambiguous

* from the plan's **creation** — a plan made today for next week is
  overdue the moment it is saved. Wrong.
* from the plan's **end date** — the day after the work was due, say what
  happened. Right.

Recommended: `COALESCE(plan_end_date, plan_date) + 1 day < today`. Confirm
with the client before building, because it is the whole rule.

### 3. A hard block with no way out

Someone must be able to override it. A genuine emergency does not wait for
a tidy table. PM-only, logged, and visible.

## The smallest thing that works

A hard block couples two things that are independent: planning tomorrow's
work, and tidying yesterday's. Couple them and one bad week stops the
rollout — and the costs are lopsided. A wrongly blocked IM means work not
planned and the client's own programme slipping; a stale row on a list
means a stale row on a list.

So get the behaviour without the stoppage: make it **visible and
accountable** rather than **blocked**. An IM who plans with 40 strays
open clicks through a confirmation that is recorded and shows on the PM's
screen. Nobody is stopped; everybody is seen. That changes behaviour about
as well as a block and cannot halt the programme.

**One setting, four positions**, moved up as the number falls:

| position | what happens when an IM plans with N open |
|---|---|
| `off` | nothing (default) |
| `warn` | a banner with the count and a link |
| `confirm` | one extra click, reason optional, **logged and visible to the PM** |
| `block` | refused above a threshold — the client's rule, arrived at last |

Start at `warn`. The client gets their rule; the business never stops on
the morning it is switched on.

### What it costs — no restructuring

Everything below is additive. Nothing moves, nothing is renamed, no page
is rebuilt. **The IM's pages keep the shape they have.**

| piece | where |
|---|---|
| `_plan_closed_out_sql()` | one new function |
| `closeout_overdue` bucket | one entry in an existing dict — PM monitor **and** Analytics get it free |
| **To close out** / **Upcoming** tabs | PM Execution Monitor, beside the three tabs it has |
| **To close out** tab | IM → Rollout Work Done, beside the two it has. That page is already where the IM confirms, so it is already the clear-my-table screen for one of the three routes |
| one tile | IM Dashboard |
| one guard | `create_rollout_plans` — the only plan creator in the app |
| 4 fields | Inet Settings |

### Where the IM sees it

Not a new page. The IM keeps what they have, plus:

* **IM Dashboard** — a *To close out* tile with the count, clicking into
  the list.
* **Rollout Work Done → To close out** — a third tab on a page they are
  on every day, carrying the three actions inline.

That is the whole IM-side change.

## Workflow problems this will cause, and the answer to each

Written out because "it will cause problems" is the right instinct and the
problems are specific.

1. **The team never reported, so the IM is stuck.** They are not: all
   three routes are the IM's alone. Extending and raising an issue need
   nobody else. Measured — all 226 of today's backlog are exactly this
   case.
2. **A visit can take several plans.** Companion plans share a visit and
   only one carries the Work Done, so a plan-scoped test demands an
   outcome from companions that can never have one. Close-out must be
   **visit-scoped**, like `_visit_closed_exists_sql`.
3. **Cancel awaiting PM approval.** The IM has acted and the PM has not.
   Blocking the IM for the PM's delay is backwards. Already excluded by
   `_ACTIONABLE`; keep it excluded.
4. **Extend becomes the escape hatch.** If extending always clears the
   clock, everyone extends everything and the backlog goes invisible —
   the rule then produces tidy screens and no change in behaviour.
   `reschedule_count` and `reschedule_log` already record this, so surface
   **3 or more extensions** as its own bucket. The dodge has to cost
   something to look at.
5. **The 90+ day history.** Cut-off date. Covered above.
6. **Friday.** The working week is Saturday to Friday and Friday is the
   holiday. A flat 24 hours punishes a Thursday plan. Either count working
   days or set the grace to 48 hours — and `_week_start()` already knows
   the calendar, so do not invent a second one.
7. **Bulk planning.** An IM planning 30 lines at once must get one
   message about their own backlog, not thirty. The guard is per IM, once
   per call.

## What to build

### One new definition, not several

`_plan_closed_out_sql()` in `command_center.py`, beside
`_visit_closed_exists_sql()`: a plan is closed out when it has a Work Done
for its visit, **or** is Completed or Cancelled, **or** carries an
`issue_status`, **or** has been extended to a date that has not passed.

This has to be the only place the question is asked. Every time this
codebase has defined "done" twice, the two copies drifted — §8 of
EXECUTION_WORKFLOW.md, and the DSA mapping deliberately has no status
field for the same reason.

### Phase 1 — see it (no enforcement)

* `_plan_closed_out_sql()`
* a `closeout_overdue` bucket in `EXECUTION_ATTENTION_BUCKETS` — the
  Execution Monitor and Execution Analytics then both get it for free,
  filterable, with no new endpoint
* a per-IM "not closed out" count on the Execution Monitor header and the
  IM dashboard
* extend `auto_mark_overdue_plans` to `In Execution`, not just `Planned`

### Phase 1b — tabs, because the one list mixes two jobs

The Execution Monitor today is one list of everything open, future plans
and three-month-old strays side by side. Filter it down to the SLA
breaches and the forward book has nowhere to live; leave it as it is and
"clear my table" is a hunt. So the page gains tabs. It has three already
— *Execution Monitor*, *Internal Work Done*, *Analytics* — and this adds
two in front:

| tab | what is in it | today |
|---|---|---|
| **To close out** | past the grace window, no outcome stated | **226** |
| **Upcoming** | dated today or later, still open | 0 on the copy |
| Execution Monitor | everything, exactly as now — **unchanged** | 621 |
| Internal Work Done | unchanged | |
| Analytics | unchanged | |

Measured on the copy: of the 621 open past-due plans, **395 already carry
an issue** and so are closed out under the client's own rule. The real
chase list is 226, not 621 — worth saying to the client, because 621
sounds unmanageable and 226 across three IMs does not.

*Upcoming* reads 0 on the copy only because the snapshot is from 15 Oct
and all 36 of its future-dated plans have since been completed or
cancelled. Live it will not be 0. The copy cannot size that tab.

**No "Raised as issue" tab.** Those 395 already have a home on Issues &
Risks. Link to it; do not build a fourth place to look at the same rows.

Three things this must get right, all of them mistakes this codebase has
already paid for:

* **The tab filter goes to the backend**, as a `tab` value on
  `list_execution_monitor_rows`, never a client-side slice of an
  already-row-limited fetch. That exact bug was swept across ~25 pages in
  `8f1451f`.
* **The three time views share one `data-table-key`.** Their columns are
  identical, so they should share a saved layout; separate keys would make
  the same table look different depending on which tab you came from.
* **The badge counts come from the summary query, not from
  `rows.length`.** *Internal Work Done* counts a loaded array today, which
  is fine at its size; a tab that can hold hundreds must not force the
  rows to load just to show a number.

### Phase 2 — clear my table

* a banner on the planning screens: *N plans past 24 hours with no
  outcome*, linking straight to the **To close out** tab
* that tab carries the three actions inline — Work Done, Extend, Raise
  issue — so closing out is one screen and not a hunt across three pages

Phase 2 is what makes Phase 3 fair: do not block someone from planning
without first giving them one place to clear the block.

### Phase 3 — the block

In `create_rollout_plans`. **It is the only code in the app that creates a
Rollout Plan** (`command_center.py:6596`), so one guard covers all five
planning screens — Rollout Planning, the PM's copy, Close Remainder, and
Issues & Risks on both sides. That is lucky, and worth not squandering by
putting the check in the frontend.

New in Inet Settings:

| field | default |
|---|---|
| `enforce_plan_closeout` | 0 — off |
| `closeout_grace_hours` | 24 |
| `closeout_enforced_from` | (date, blank = no enforcement) |
| `closeout_block_threshold` | 0 — any open plan blocks |
| PM override | per IM, time-boxed, logged |

The refusal names the blocking plans rather than just counting them.

### Phase 4 — the sweep

A feature is not finished when the feature works (CLAUDE.md). Each of
these answers "is this plan outstanding?" its own way and will keep meaning
the old thing:

* Execution Analytics — a tile, free once the bucket exists
* IM performance report
* the 18:00 daily Work Done summary email
* the IM dashboard's open-work counts

## Sequencing, and the one thing not to do

Ship Phases 1 and 2 and let them run for a week **before** turning on
Phase 3. The backlog will move on its own once it is visible and clearing
it is one click, and the number left after that week is the real number to
set the threshold against. Guessing it now, from a 226 that is mostly
three months old, would set it wrong.

**Do not** enforce this before the backlog is dealt with and a go-live date
is set. A rule that stops all three IMs working on its first morning gets
switched off that afternoon, and then it is harder to introduce properly.

## Open questions for the client

1. 24 hours from the **plan's end date** — correct? (The alternative,
   from when the plan was created, marks next week's plan overdue today.)
2. Does an **extended** plan reset the clock, or does the original plan
   still count against the IM? Resetting is the natural reading; without
   it, extending is not really an outcome.
3. Who may **override** the block, and does the override need a reason?
4. The **226 historical plans** — cleared one by one, or written off in
   bulk to a stated outcome with a date on it?
