# IM Performance — rework plan

**Status:** plan only, nothing built. Raised 24 Oct 2026 — "this report is not
reliable now … we need to replan and rework". Every figure below was measured
on `inet_backup`, a production copy, for **September 2026**.

## What it renders today

```
IM                Teams Assigned Completed Compl%   D/B  Overall%    Target   Revenue  Ach%      Cost    Profit  Rating
Ajmal Muhammed        9      327       215   65.7  5/39      60.1   293,967   270,734  92.1   276,324    -5,590  Good
Majid Ali            12      322       310   96.3 10/52      85.6   292,429   262,506  89.8   204,007    58,499  Good
Waqas Ahmed           0        0         0    0.0 16/219      7.3   253,409   226,634  89.4         0   226,634  Good
Manukrishnan PV       7      142       107   75.4  5/37      62.6   118,436    89,607  75.7   100,729   -11,122  Need Improvement
Jehan Zaib            0        0         0    0.0  0/55       0.0    36,074    36,074 100.0         0    36,074  Excellent
Shahul MS / Test IM   0        0         0    0.0     —       0.0         0         0   0.0         0         0  Idle
```

Read it honestly and it says: the person with no team is the most profitable,
the person who closed 55 lines completed 0% of them, and the one rated
*Excellent* is the one with nothing measurable. That is not a reporting polish
problem. The report asks one narrow question — revenue against a target it
derives from the revenue — and gets most of the rest wrong on the way.

## What the report has to cover

The brief is "this report needs to show all of their working of the system and
the workflow". So the spine of the new report is the IM's actual job, stage by
stage. Everything already has a record; nothing new has to be captured.

| # | stage | record | the IM's own act | who else can hold it |
|---|---|---|---|---|
| 1 | line arrives | `PO Dispatch` → `Dispatched` | accept it, map a dummy PO | PM dispatches |
| 2 | plan | `Rollout Plan` | team, date, access window, material request, DSA | — |
| 3 | execute | `Daily Execution` | oversee; chase | team lead files it |
| 4 | QC | `Daily Execution.qc_status` | chase | team lead |
| 5 | CIAG | `Daily Execution.ciag_status` | chase | the customer |
| 6 | confirm execution | `execution_status` | the IM's click | — |
| 7 | Work Done | `Work Done` | generate | — |
| 8 | hand to PIC | `submission_status = Confirmation Done` | the IM's click | — |
| 9 | PIC rejection | `submission_status = PIC Rejected` | fix and re-confirm | PIC |
| 10 | shortcut close | `Work Done.source` = Direct Close / Backend | instead of 1–8 | PM approves a Direct Close |
| 11 | issue | `Rollout Plan.issue_status` | raise, resolve, re-plan | — |
| 12 | extend | `reschedule_count` / `reschedule_log` | push the date | — |
| 13 | cancel | `cancel_request_status` | request | PM approves |
| 14 | part delivery | `confirmed_qty` / `remaining_qty_action` | confirm short, close the rest | — |

Stages 3, 4, 5, 10 and 13 are **not the IM's to finish**. Any metric that
punishes an IM for them is wrong, and the report currently has no idea which is
which. That distinction is the single most important thing the rework has to
get right — it is the difference between a scorecard people trust and one they
argue with.

## The faults, measured

### 1. "Completed" is tested against a status the line has already left

```sql
COUNT(DISTINCT CASE WHEN pd.dispatch_status = 'Completed' THEN pd.name END)
```

`Completed` is a **transient** stage. The moment PIC submits the invoice,
`_compute_dispatch_status_from_pic` moves the line to Submitted / Partially
Submitted / Partially Closed / Closed. So *the further a line gets, the more it
counts as not closed.*

| IM | counted | where the others actually are |
|---|---|---|
| Waqas | **16 of 219** | 68 Submitted, 62 Closed, 45 Partially Closed, 22 Partially Submitted |
| Jehan | **0 of 55** | 26 Partially Submitted, 25 Submitted, 4 Closed |
| Majid | 10 of 52 | 25 Closed, 17 Submitted |

"Overall Completion %" of 7.3 and 0.0 describes work that is not merely
finished but **invoiced**.

### 2. "Assigned" counts plans, not lines

`COUNT(DISTINCT rp.name)`, despite the label and the code's own comment.

| IM | plans | distinct lines |
|---|---|---|
| Ajmal | 327 | **210** |
| Majid | 322 | **291** |
| Manu | 142 | **106** |

Ajmal looks busier than Majid (327 vs 322) while carrying 81 fewer lines. A
re-visit counts twice; companion plans on one visit count once each. Completion
% is plans-over-plans, so the IM who needed a second visit is measured on two.

### 3. "Achievement %" is circular, and Rating is nothing but Achievement %

For the direct/backend branch, Target is the `line_amount` of **the same lines**
whose Work Done supplies Revenue. It measures "what share of what I closed did
I close in full". Jehan lands on exactly **100.0% → Excellent** with Overall
Completion 0.0%. Waqas's 89.4% is below 100 only because some of his are
MS1-only closes — Target takes the whole line, Revenue only MS1 — so the number
punishes milestone closing, not performance.

### 4. The roster is every `IM Master` row

`Test IM` and `Shahul MS` appear every period as Idle. `IM Master.status`
exists and is ignored — though all seven read Active, so status alone would not
drop the test record.

### 5. Four more that are wrong in code but measure zero today

Checked, not assumed. All latent, all one bad week from biting:

* both Revenue queries have **no `is_internal_work` filter** while Target and
  Assigned do — 0 internal Work Done rows exist today
* direct/backend revenue is dated by `wd.creation`, not by the IM's **stated**
  closing date `ms1_closed_at` — which contradicts the deliberate decision in
  `_direct_close_one` ("the business date the work closed, not the moment the
  button was pressed"). 0 of 803 differ today
* Target is per-period, so a line planned in two months is targeted twice — 0
  such lines
* plan month vs execution month — 0 of 4,226 crossed

## Cost — the part that is most wrong

> "the cost calculation is also not okay because the team count is also not
> okay — a team is planned by the IM doesn't mean the full team cost for the IM"

Correct, and it is worse than it looks. Today the model is: take each team's
**whole period salary**, and split it between IMs **in proportion to their
share of that team's plan count**.

Three separate errors fall out of that.

**It does not reconcile with the real salary bill — in both directions.**

| | SAR |
|---|---|
| real INET team salary for September (every team) | **517,316** |
| of which the report hands to IMs | 466,466 |
| real salary landing on **no IM at all** (2 teams with no plans) | **50,850** |
| SUB payout mixed into the same column | 114,594 |
| so the column totals | **581,060** |

A column labelled "Team Cost" that totals 581,060 against a 517,316 salary bill
is not a cost column. The SUB payout is a real cost but a different kind — it
follows revenue, not time — and merging them hides both.

**It bills idle capacity to whoever happened to plan the team.** A team planned
9 days out of ~26 charges its IM the entire month:

| team | days planned | charged now | charged if by day |
|---|---|---|---|
| Team-35 | 9 | 16,016 | 9,009 |
| Team-10 | 13 | 30,030 | 13,013 |
| Team-08 | 17 | 30,030 | 17,017 |
| … 13 more | 18–23 | | |
| **total** | | **466,466** | **310,310** |

**SAR 156,156 — a third of the column — is idle capacity**, charged to an IM as
if they had used it.

**The split is by plan count, not by use.** Six of the 22 planned teams serve
more than one IM (Team-26 serves three). Plan *count* is not days, is not
value, and is not effort: 20 small plans and 3 big ones split a salary 87/13.

**And it never looks at `INET Team.im`** — the team's own home IM, which is
the obvious ownership answer and is set on every team but three (all
Disbanded).

Two things that look like faults here and are **not**, checked before writing
them down: charging an *Inactive* or *On Vacation* team is correct — the
company is still paying it, and only a Disbanded team stops (through its
`end_date`, which `_team_cost_days` already handles). And the one team whose
`daily_cost_applies` is unticked while it carries SAR 1,000/day is a **SUB**
team, which takes the payout branch, so today's report does not charge it.
That flag still has to be honoured by the new model, but it is not costing
anything right now.


## Decisions taken (24 Oct 2026)

| # | question | answer |
|---|---|---|
| 1 | Assigned — lines or plans? | **lines**. "the PM needs the count of lines, not plans" |
| 2 | where does Target come from? | **the Command Dashboard's model** — reuse it, do not invent a second one |
| 3 | cost model | **Option A**, improved: planned days, idle charged to the team's **custodian on that day** (not today's owner), every team counted, reconciles to the monthly total, INET and SUB treated differently |
| 3b | in-house targets | **parked** — M&D / M&W have no plans and no team, so no cost and no derived target exists. A manual target is the answer |
| 3c | SUB target per IM | share of the contract's `monthly_target` by **Work Done days** — the one record every route produces, so direct closes count without a special case |
| 4 | who appears | **every IM**. Waqas is a PM *and* an IM; the report is wanted for IM Waqas |
| 5 | Rating | left to this document — see *Rating* below |

## Target — taken from the Command Dashboard, not reinvented

`get_command_dashboard` already carries a target model the business recognises,
and it treats the two kinds of team differently. The IM report uses the same
expressions so the two screens cannot disagree.

**INET (salaried) work**

```
inet_monthly_cost   = SUM(daily_cost x _team_cost_days(...))         -- every INET team,
                      WHERE team_type = 'INET'                          any status; Disbanded
                        AND team_category <> 'Backend Team'              stops via end_date
inet_monthly_target = inet_monthly_cost x 1.25                       -- 25% margin
target_today        = inet_monthly_target x elapsed_fraction_of_range
```

September: cost **517,316**, target **646,645**.

**Per IM**, the same formula on their own attributed cost:

```
IM's INET target = (that IM's used cost + idle cost) x 1.25
```

so Σ over IMs = the company figure. Two consequences have to be printed on the
page, not left for someone to discover:

* **an IM's target rises with their idle cost** — defensible, since idle
  capacity is capacity they were given, but nobody should meet it by surprise
* Commercial achievement then behaves as a **margin ratio**, which overlaps
  with the Profit column; do not read them as two independent facts

One mixed case, already handled upstream and measured small: an INET team
working a line that belongs to a subcontract. Its revenue counts against the
SUB target while its salary created INET target that nothing offsets — the
Command Dashboard excludes such lines from `inet_achieved` for exactly this
reason, and there were **3 of them, SAR 1,744**.

Two notes on this, both deliberate in the existing code and worth not
"fixing":

* a Backend team of type INET carries a `daily_cost` but is **excluded** — the
  record is an IM, not a crew, so charging it would invent an expense
* status is not filtered: Active / Inactive / On Vacation all still cost money

**The 1.25 is hardcoded in two places** (`command_center.py:15032` and the
Command Dashboard frontend). Move it to Inet Settings as
`inet_target_margin_pct` before a third copy exists.

**Subcontracted work**

Target is **not derivable** — it is a commercial commitment typed into
`Subcontract Master.monthly_target`, scaled by how many months the range
spans. Deriving it from rollout plans was tried and put Target below Revenue,
because a direct-closed line has revenue and no plan. Only contracts with
`sub_payout_pct > 0` count; the in-house ones (`INet Telecom F&C / M&D / M&W`,
payout 0) are INET's own work and are already covered by cost × 1.25.

September: SUB target **492,500** across 7 contracts.

### Splitting a subcontract's target between IMs

**The question this answers.** A subcontractor's `monthly_target` is one
number for the whole company — Protech 200,000, Wabranco 120,000. The report
is per IM. So *how much of Protech's 200,000 is Majid's target and how much is
Manu's?* Nothing in the system records it, and without an answer there is no
Achievement % for subcontracted work at all.

> "can we calculate based on the IM plan days for the subcontractor … if the
> IM planned 8 days, monthly target / 8 … this may be wrong logic, use as
> suggestion"

Days are the right proxy — nothing else in the data says who is responsible
for how much of a contract. The arithmetic is what needs correcting:
`200,000 / 8` is money **per day**, and if two IMs each worked 8 days they
would get 25,000 each, totalling 50,000 against a 200,000 commitment. The
parts have to add back up to the whole, so take a **share**:

```
IM's target on a contract = contract monthly_target x (this IM's share)
                                                    / (all IMs' shares)
```

Σ over IMs = the contract's target exactly, whatever the share is measured in.
**What that share should be is the one thing in this plan still undecided** —
three candidates, measured against each other below. Days were the first
answer and are now ruled out.

### Which record, and which date — Work Done, not plans

The first draft of this section counted **planned** days. That is wrong, and
the measurement below shows why: plans only exist for work that went through
the rollout track, and most subcontracted money does not.

**Work Done is the one record every route produces** — there is no fifth way
to finish a line:

| source | rows | execution |
|---|---|---|
| Rollout Execution | 2,019 | yes |
| (blank source, legacy) | 550 | yes |
| Direct Close | 1,670 | no |
| Backend | 140 | no |
| | **4,379** | |

So the basis is one date off the Work Done, preferring the **stated business
date** over the audit stamp — which also settles the separate fault where
direct closes were dated by `wd.creation`:

```
work_done_date = COALESCE(
    `Work Done Closure`.closed_on,      -- per-close ledger: partial / remainder closes
    wd.ms1_closed_at / ms2_closed_at,   -- the IM's stated closing date on a direct close
    de.execution_date,                  -- rollout: when the field work happened
    DATE(wd.creation))                  -- last resort
```

```
IM's days on a contract = COUNT(DISTINCT work_done_date)
                          over lines carrying that contract and that IM
```

Two things this buys beyond covering direct closes. **Target and revenue land
on the same clock** — revenue is already Work-Done-dated, so achievement
compares like with like. And there is **one definition of "when the work
happened"**, not two; every time this codebase has defined that twice, the
copies drifted.

**Coverage caveat, measured.** Overall only 37% of subcontracted lines have a
Work Done — but that is the archive import, not current practice:

| line created | with a Work Done |
|---|---|
| 2026-06 | 53% |
| 2026-07 | **7%** |
| 2026-08 | 86% |
| 2026-09 | **99%** |
| 2026-10 | **100%** |

The 1,900 `Closed` lines with no Work Done were invoiced historically and
loaded with their PIC status only. From August the portal captures
essentially everything, so the basis is complete for any current month. A
report run back over June or July will under-count days and **must say so on
the page** rather than quietly showing a thin number.

**Keep this separate from the cost side.** Cost counts *planned team-days*
because it asks "did this team have work that day" — a capacity question.
The target split counts *Work Done days* because it asks "how much of this
contract did this IM carry" — an output question. They are different
questions and must not be unified later; Work Done cannot help the cost side
anyway, since it names no team.

### Why planned days alone were not enough

Measured for September — only 3 of the 7 targeted contracts were planned at
all, which is what sent this section back to Work Done:

| contract | target | planned days by IM | how the work actually arrived |
|---|---|---|---|
| Shabakath Saudia | 50,000 | Ajmal 7, Majid 6, Manu 3 | all via plans |
| Saleh Al Dosari | 37,500 | Majid 22 | 29 planned, 4 direct |
| Mabran 80% | 25,000 | Manu 23 | 22 planned; Majid direct-closed 7 more with no plan |
| **Protech** | **200,000** | **none** | 179 lines, all direct, all Waqas |
| **Wabranco** | **120,000** | **none** | 40 lines, all direct, all Waqas |
| Jereesh Moosa | 40,000 | none | 21 direct |
| Smart Trends | 20,000 | none | 20 backend, Jehan |

Split by planned days alone and **SAR 320,000 of 492,500 — 65% — goes to
"unassigned"** while Waqas delivers 173,745 of it against a target of nothing.

Counting Work Done days instead needs no special case: Protech's 179 closes
fall on roughly 27 distinct dates under Waqas, and the 200,000 follows him.

A sanity check that the day proxy behaves: on Shabakath the day split gives
Ajmal 21,875 / Majid 18,750 / Manu 9,375, and their actual revenue came in at
53,097 / 20,556 / 7,020 — same order, same rough proportions, without the
target being derived from the revenue.

If a contract has **nothing** in the period, its whole target sits in an
Unassigned row — and an untouched contract showing its full commitment as
unassigned is itself the signal a PM wants.

### Days are ruled out — the share must be value, not days

Reviewed 26 Oct 2026 and confirmed on the data. Counting *days* rewards
batch-closing. Jereesh Moosa in September:

| IM | lines | days | target by days | by lines |
|---|---|---|---|---|
| Manu | 17 | 1 | **20,000** | 32,381 |
| Jehan | 4 | 1 | **20,000** | 7,619 |

Four times the work, identical target. It is systematic, not noise —
lines-closed-per-day across the targeted contracts ranges from 3.7 (Majid) to
12.0 (Jehan).

Three candidate bases, each answering a different question:

| basis | question it answers | problem |
|---|---|---|
| Work Done **days** | who was active | unfair across batch sizes — above |
| Work Done **value** | who produced | circular: target follows revenue |
| **assigned value** (`PO Dispatch.im`) | who holds the contract | needs a period cohort |

Assignment is the only non-circular one, and it has the property the others
lack: **an IM who never works a contract they hold still carries its target**,
so inactivity costs something. But measured raw it pulls the whole backlog —
Protech shows 2,775 lines and SAR 2.39M assigned to Waqas against a *monthly*
200,000 — and on Mabran and Jereesh it inverts the ranking relative to who
actually did September's work.

**Decided 26 Oct 2026: assigned value, restricted to the lines open in the
period** — the same cohort Delivery uses (see *What the new report should
measure*). Defined once, taken by both. Work Done days remain the fallback for
a contract with no assignment at all, and the manual override is the sanctioned
answer whenever the business disagrees with the split.

### In-house contracts — parked, and here is why it is hard

The in-house contracts also carry a `monthly_target` (626,625) which disagrees
with salary × 1.25 (646,645) by SAR 20,020. **Decision: leave in-house
`monthly_target` out of scope for now.** But the question underneath it is
real and has to be written down, because the Command Dashboard does not
answer it either:

| contract | work via a plan | direct / backend | revenue |
|---|---|---|---|
| INet Telecom F&C | 2,077 | 433 | 2,232,625 |
| **INet Telecom M&D** | **0** | 48 | 29,067 |
| **INet Telecom M&W** | **0** | 28 | 23,515 |

**M&D and M&W have never had a single plan.** Every line is direct-closed, so
there is no team, no team-day and no `daily_cost` — which means cost × 1.25
gives them a target of **zero**, and a cost of zero gives them a *profit equal
to their whole revenue*. That is the same distortion that makes Waqas look
like the most profitable person in the company.

The honest position: **their cost is not in `INET Team` at all.** Whoever does
M&D and M&W work is backend staff, not a crew with a `daily_cost`. So:

* show **"no attributable cost"**, not SAR 0 — and therefore no profit figure
  either, rather than printing revenue as profit
* their target can only be typed in, which is what
  `Subcontract Master.monthly_target` already is (M&D 26,025, M&W 0)

### Manual target override — the escape hatch

> "for target we can switch give target manually if we want, if it complicated"

Agreed, and it is the right answer for every case the data cannot express.
A small `IM Monthly Target` record — IM, month, amount, note — which **wins
over anything derived** when present. The derived figure stays the default, so
nothing has to be typed in for it to work, and the report says per row which
source it used.

**Scope rule:** the override is **per component** — an INET amount and a SUB
amount, either of which may be left blank to keep the derived one — plus an
optional total that replaces both. Without this rule a single number is
ambiguous the first time someone only means to correct half of it.

That one feature retires most of the hard cases: M&D/M&W, a new IM with no
history, a month where someone was on leave, and any target the business
simply wants to set by hand.

## Cost — three solutions

All three share the same pot, which is the number that must be matched:

```
pot = SUM over every INET non-backend team of daily_cost x _team_cost_days(...)
    = SAR 517,316 for September
```

Identical to the Command Dashboard's `inet_monthly_cost`, so the two reports
agree by construction rather than by coincidence.

A **team-day is "used"** when that team worked that day; every other day it
existed is **idle**. Used days are split between the IMs whose lines the team
worked on.

**Do not invent that day rule — `_team_domain_utilization` already has it**
(`command_center.py:14146`), in production, and it is more careful than
anything written from scratch here would be:

* **Fridays are dropped** (`include_fridays = 0`) — the working week is
  Saturday to Thursday, so a flat calendar month invents about four idle days
  a team never had
* days outside a team's start/end render `-` and **never count as idle** —
  a team cannot be idle before it existed
* **future days are never idle** — they show the plan instead, so a mid-month
  view does not report the rest of the month as already wasted
* attendance is the Daily Execution span `execution_date` →
  `last_progress_date`, so a multi-day job covers every day it ran
* **no internal-work exclusion** — internal work makes a day *not idle*, which
  is correct: the team was working
* scoped by team roster and deliberately **not** by IM — "a team that spent
  the day on another IM's plan was not idle"

Two consequences for this model, both corrections to the first draft:
**"used" means executed, not planned** — a past day is judged on what actually
happened, never on what was scheduled — and **Fridays leave the denominator**.
The 186,186 idle figure in the table below was built on raw calendar days and
must be rebuilt on this engine before anyone quotes it.

### Option A — executed days, idle charged to whoever held the team *(chosen)*

```
IM cost = SUM over (team, day) used by that IM  of daily_cost / IMs sharing the day
        + SUM over (team, day) idle             of daily_cost, for the team's CUSTODIAN that day
```

Σ over IMs = the pot, exactly. The column shows **two numbers, Used and Idle**,
so an IM can see which half is theirs to fix.

"Custodian that day" — not `INET Team.im` as it reads today — is the
improvement that makes this work. See the next section; it is the answer to
"a team is borrowed 5 days and works 2, who carries the other 3".

* **For:** reconciles; the SAR 156,156 of idle finally has a name against it;
  whoever asked for the team carries the cost of not using it.
* **Against:** nothing structural left. The one objection to the first
  draft — "an IM is charged for a team somebody else had" — is exactly what
  the custody timeline removes.

### Option B — executed days, idle in its own row

Same used-day rule, but idle goes to a single **Idle capacity** row and onto no
IM.

* **For:** nobody is charged for something they may not control; easiest to
  defend in a review.
* **Against:** idle has no owner, so nothing changes because of it.

### Option C — whole team to its home IM

The team's entire cost sits with `INET Team.im`; borrowing shows as a memo, not
a charge.

* **For:** simplest; matches payroll responsibility.
* **Against:** answers "who owns the team", not "was the capacity used" — the
  question actually worth asking.

**Recommendation: A**, with B available as a setting if it causes arguments.
A is the only one that both reconciles and makes idle actionable.

### Custody — who held the team on each day

> "if a team is borrowed for 5 days but only 2 days worked, that worked days
> cost we get correctly but the non-worked 3 days — where do we put the cost,
> for which IM?"

**On the borrower.** They asked for the team and held it; the three unworked
days are their idle, not the owner's. That needs a custody timeline rather
than `INET Team.im`, which holds only today's owner and so would push the
whole month's idle onto whoever happens to hold the team now.

**The timeline is already recordable today** — no new doctype:

| source | rows | what it gives |
|---|---|---|
| `Team Allocation Request` where `request_status = 'Approved'` | **92**, May–Oct 2026 | `team`, `from_im`, `to_im`, `approved_at` — one handover event each |
| `tabVersion` on `INET Team`, `im` field changed | 24 | the Desk edits that bypassed a request, including the original April setup |

Replay those in order and you have the owner of every team on every day.

#### One hole, and how to close it

**The Admin Teams page leaves no trace.** `im` is in
`_ADMIN_TEAM_EDITABLE_FIELDS` and is written with
`frappe.db.set_value` (`command_center.py:30670`), which creates neither a
Version row nor a request. A reassignment made there is invisible to both
sources above.

Measured, the damage today is one team:

```
teams whose recorded timeline predicts their current im :  22
mismatched (an untracked change)                        :   1   (Team 33)
teams with no event at all (never moved)                :   7
broken links in the chain                               :   0
```

**Fix — collapse three sources into one.** In `admin_update_team`, when `im`
changes, insert a `Team Allocation Request` with `request_status = 'Approved'`,
`from_im` = old, `to_im` = new, `approved_at` = now, reason "Changed on Admin
Teams". The timeline then reads **one table** instead of requests plus
Version plus silent edits, and the same guard covers `daily_cost`, which has
the identical portal-path gap (Desk edits of it *are* in Version — 54 of
them — so the history is only partly missing, not absent).

**Where the timeline starts.** Before a team's first recorded event the holder
is that event's `from_im`; if that is blank, or there are no events at all,
it is the team's `im` as created. Unambiguous for all 7 of the no-event teams,
none of which has ever moved.

Backfill: Team 33.

**Transfers are not rare, and they are short** — this is the normal working
pattern, not an edge case:

* **27 approved transfers in September alone**, across 7 teams
* 93 handover intervals overall: **median 5 days**, and **61% are 7 days or
  less**
* Team-26 moved 9 times, Team-30 about 10

**It changes the answer.** Rebuilding September with the real timeline against
using today's owner:

| IM | used | idle (custody) | idle (today's owner) |
|---|---|---|---|
| Ajmal | 145,145 | **74,074** | 82,082 |
| Majid | 114,031 | **86,086** | 77,077 |
| Manu | 51,134 | **26,026** | 27,027 |
| total | 310,310 | 186,186 | 186,186 |

**SAR 9,009 of idle lands on a different IM** in one month, and used + idle
reconciles to the pot exactly.

Two implementation notes:

* **Weight the days, do not count them.** The measurement above charged raw
  calendar days and came to 496,496 against the report's 517,316, because
  `_team_cost_days` charges a flat 30 units per month. Normalise each team's
  day weights so they sum to its `_team_cost_days` result, or the IM report
  and the Command Dashboard will disagree by a few per cent for no reason.
* **A loan has no end date.** `Team Allocation Request` records the handover
  but not a return date, so a borrow is modelled as a permanent transfer until
  someone transfers back — which the data shows they do, within 5 days.
  A `valid_until` field would make a loan auto-revert and stop a forgotten
  return parking the cost on the borrower forever. Worth doing; not required
  for this report.

### "Idle" means no plan, not no work — and that is fine

402 direct/backend closes landed in September across 27 days and none of them
names a team. **That is not a capture gap, it is the point of Direct Close** —
the route exists precisely because the work did not go through a team and a
rollout plan. `Work Done Closure.team` is 0 of 44 populated because there is
nothing to write there. Do not "fix" it by inventing a team.

**The cost is unaffected.** Every day a team existed is charged either as used
or as idle, so the pot still reconciles exactly and no money goes missing — a
team that happened to spend an unplanned day on a direct close has that day
charged to its custodian, which is the right pocket either way.

What it changes is only the **reading** of the Idle number: it counts days
with no plan, which is not quite the same as days with no work. Label the
column that way and the figure stays honest.

### Splitting a day between IMs

By the count of that team's executions that day per IM — a day is a day, and
effort is time, not value. `Rollout Plan Team.assigned_amount` is there if a
value-weighted split is ever wanted, but it should not be the default.

Note this is the opposite choice from the SUB *target* split, which is moving
to value. Deliberate: a salaried team costs the same whatever it works on, so
its day divides by time; a contract's target is money, so it divides by
money.

### SUB teams — a different rule entirely

A subcontractor has **no salary and no idle cost**: if they do not work, INET
pays nothing. So:

```
SUB cost = revenue x sub_payout_pct / 100
```

* the percentage comes from the **line's** `PO Dispatch.contract`, never the
  executing team's type — the commercial arrangement lives on the line, and
  the Command Dashboard is explicit about this
* **`INET Team.daily_cost` must be ignored for SUB teams.** One SUB team
  carries SAR 1,000/day with `daily_cost_applies` unticked — harmless today
  because the payout branch never reads it, but a trap for any rewrite that
  unifies the two branches
* it is its **own column**, never added to salary — one is time, the other is
  cost of sale, and merging them hides both

### Reconciliation line, printed on the report

```
salary charged to IMs (used) + salary charged to IMs (idle)  =  pot
```

If those do not match, the report says so instead of quietly being wrong.
Today it misses in both directions: SAR 50,850 of real salary lands on no IM,
while SAR 114,594 of SUB payout is added into the same column.

## Partial quantity, and partial milestone — they are not the same thing

A line can be confirmed **short** (4 of 6 delivered) with the remainder closed
later, and its workflow is then genuinely complete. Separately, a line can be
closed on **MS1 only**, which is also complete *for that milestone*. Both make
`revenue_sar` less than `line_amount`, and the report cannot tell them apart.

Measured on the copy: 34 lines have been through quantity confirmation, 3 of
them short, and **11 of the 34 have Work Done revenue below `line_amount`** —
but only 3 for quantity reasons. The rest are milestone-only closes:

```
1011HG3068810-1461-1-1   line     68   revenue     17   confirmed 1 of 4   <- quantity
1011HG3167911-831-4-1    line    270   revenue    189   confirmed 3 of 3   <- milestone (70%)
1011HG3692386-2240-1-1   line  5,555   revenue  4,444   confirmed 1 of 1   <- milestone (80%)
```

Three rules for the new report:

1. **Target and Revenue must sit on the same basis.** Today Target uses
   `line_amount` (the whole order) and Revenue uses `revenue_sar` (what was
   earned), so a short confirmation or a milestone close reads as
   under-achievement that never recovers. Either target the earned basis, or
   carry the un-earned remainder as its own visible column — not silently.
2. **"Complete" means nothing is outstanding** — `remaining_qty = 0` and every
   milestone that exists is closed — **not** `dispatch_status = 'Completed'`.
   The same predicate as fault 1 above.
3. **Earned value comes from the closure ledger.** `Work Done Closure`
   (44 rows) carries `closed_qty`, `closed_amount`, `closed_on`, `milestone`
   and `subcontractor` per close event. That is the only place a partial close
   is recorded with its own date, so a part-month report should read it rather
   than re-deriving from the line.

### Follow-up: audit every other report for the same two cases

Requested, and to be done **after** this rework lands, so there is a correct
definition to audit against. The pattern to grep for is anything using
`line_amount` as "the value of the work done" or `dispatch_status = 'Completed'`
as "finished". Candidates: Project Performance, Project Profitability, Rollout
Burn-down, Revenue Tracking / Forecast, Weekly Performance, PO Dispatch Status,
PO Milestone Status, Top Teams, the four dashboards, and the daily Work Done
summary email.

## What the new report should measure

Four blocks. Every column states the record it comes from, and whether the IM
can actually move it.

**The cohort, defined once.** Every count below needs to say *which* lines it
is about, and "lines received this period" and "lines closed this period" give
very different numbers. One definition, used by Flow, by Delivery and by the
SUB target split: **the lines open to the IM at any point in the period** —
dispatched on or before the period end, not cancelled, and not already fully
closed before the period began. Defined in one place, not three.

**A. Flow — in lines, never plans** (decision 1)

* received, planned, executed, confirmed, handed to PIC, closed
* field execution / Direct Close / Backend kept **separate** — that visibility
  is why Contract Model gating exists
* "completed" means reached the stage **or passed it**, from one shared
  predicate
* plans keep a column of their own (plans per line shows re-visit load, which
  is worth seeing — just not labelled "Assigned")

**B. Speed — where the time goes**

* dispatch → planned, planned → executed, executed → Work Done, Work Done →
  handed to PIC
* QC / CIAG / PM-approval waits shown as **"not the IM"**, never counted
  against them

**C. Quality and rework**

* PIC rejection rate (203 rows site-wide), QC fail rate, re-visits per line,
  reschedules (137 plans), issues raised vs resolved (454 plans)
* plans not closed out within the SLA — the definition in
  `PLAN_CLOSEOUT_SLA.md`, not a second one

**D. Commercial**

* revenue, SUB payout, salary cost (used + idle), margin, utilisation %
* target per the Command Dashboard model, achievement against it

### Rating — decision 5

**Keep a rating, but stop deriving it from one ratio.** A single number is what
the client wants to read; the problem was never that it existed, it was that it
was revenue ÷ a target derived from that same revenue.

Four components, equally weighted, each already defined above:

| component | measure |
|---|---|
| Delivery | lines **complete for the IM** ÷ cohort |
| Commercial | revenue ÷ target, **capped at 100** |
| Quality | 1 − (PIC rejections + QC fails) ÷ lines confirmed |
| Discipline | plans closed out within SLA ÷ plans due |

**Delivery means complete *for the IM*** — execution confirmed and the Work
Done raised — **not** "every milestone closed". MS2 normally waits on the
customer, and this plan's own rule is that a stage the IM cannot finish must
never count against them. Milestone closure is shown as its own column, not
folded into Delivery.

**The bands have to be re-cut.** Three of the four components cap at 100%, so
a composite can only reach the old "≥100 = Excellent" if every part is perfect
or Commercial overshoots to carry the rest. Cap Commercial as above, then set
new thresholds **against September's real data before shipping** rather than
carrying over numbers tuned for a single uncapped ratio.

Three rules that matter more than the weights:

* **the weights are printed on the page**, so anyone can reconstruct the score
* a component with **no data scores nothing and is dropped from the
  denominator** — an IM with no plans is not rated 0 on Delivery, they are
  rated on the three that apply
* the band thresholds stay where they are (≥100 / ≥85 / ≥70), but they now
  apply to a composite rather than to one ratio

## What can be measured, and when

This decides the phasing, so it goes before the phases.

| source | usable from |
|---|---|
| `PO Status Event` — `pic_status` | 27 Jun 2026 |
| `PO Status Event` — `plan_status`, `execution_status`, `qc_status`, `ciag_status`, `tl_status`, `submission_status` | **29 Sep 2026** — four weeks |
| `Work Done.ready_for_confirmation_at` / `confirmed_at` / `pic_rejected_at` / `submission_status_changed_at` | **0 of 4,379 populated** — they fill only going forward, from the day `b29ce8c` reaches production |
| `Rollout Plan.plan_date`, `Daily Execution.execution_date`, `Work Done Closure.closed_on` | full history |

So **block B (Speed) cannot be backfilled.** It becomes honest a few weeks
after the stamps go live. A, C and D work on the full history today. Do not
ship a speed column that silently covers four weeks and looks like it covers a
year.

## Phases

**Phase 0 — DONE (26 Oct 2026).** `admin_update_team` now writes an
already-approved `Team Allocation Request` whenever `im` changes
(`_log_team_im_handover`), so the custody timeline has one source instead of
three. Verified end to end on `inet`: the handover is recorded with
`from_im` / `to_im` / `approved_at` / reason, a no-op re-save logs nothing,
and the helper is private — the `@frappe.whitelist()` stayed on
`admin_update_team`.

**Phase 1 — DONE (26 Oct 2026), correctness only, no new columns.** Measured
on `inet_backup`, September:

| | before | after |
|---|---|---|
| Ajmal Assigned | 327 | **210** |
| Majid Assigned | 322 | **291** |
| Manu Assigned | 142 | **106** |
| Waqas Direct/Backend closed | 16 / 219 | **213 / 219** |
| Jehan Direct/Backend closed | 0 / 55 | **55 / 55** |
| Majid Direct/Backend closed | 10 / 52 | **52 / 52** |
| Overall completion, all IMs | 56.0% | **95.0%** |

The ranking now matches reality — Majid carries 291 lines to Ajmal's 210,
where before Ajmal appeared to carry more. Waqas's 6 remaining are the
single-milestone lines still open; Ajmal's 2 are Cancelled.

Four changes, each a measured defect: Assigned/Completed count **lines**;
"completed" for the shortcut routes is **`LINE_DONE_STATUSES`**, not equality
with the transient `Completed`; Revenue excludes internal work as Target
already did; a Direct Close is dated by its **stated** closing date.
Achievement % and Rating are removed — both were revenue over a target derived
from that revenue. They return in Phase 3 as the published composite.

**Tell the client before Phase 1 ships.** Achievement % and Rating are the two
columns they actually read, and removing them without warning will come back
as "the report is broken now". The honest line: both were circular, they
return in Phase 3 on a basis that can be reconstructed.

**Between Phase 1 and Phase 2 — agree the cost model on paper.** Show the
client September's per-IM used/idle table, built on custody and the
`_team_domain_utilization` day rule. If they dispute the model it is far
cheaper to hear it from a table than after the rebuild.

**Phase 2 — DONE (26 Oct 2026).** September on `inet_backup`:

```
IM                Assign Complete Overall%    Target   Revenue     Used    Idle     Cost   Payout    Margin
Ajmal Muhammed       210      192     92.0   313,447   270,734  215,405   8,074  223,479   47,787      -532
Majid Ali            291      285     98.3   314,625   262,506  177,884  23,100  200,984   50,515    11,007
Waqas Ahmed            0        0     97.3   320,000   226,634        0       0        0  201,326    25,308
Manukrishnan PV      106       88     87.4   122,902    89,607   70,003   1,155   71,158   33,267   -14,818
Jehan Zaib             0        0    100.0    40,795    36,074        0       0        0   15,312    20,762

salary bill 496,496 | charged to IMs 496,391 | unattributed 105 | difference 0
```

**The idle figure was wrong in the first draft of this document, by a lot.**
It said SAR 156,156, a third of the bill. That came from counting *planned*
days over a *calendar* month. On the real rule — executed days, Fridays
excluded — idle is **SAR 32,329, 6.5%**. The teams are far better used than
this document originally claimed. This is exactly what building the table
before the rebuild was for.

Two things the per-team detail surfaced, both worth acting on outside this
report: **Team-07 is "On Vacation" and carries SAR 17,325 of the 32,329** —
over half the company's idle is one team being paid while off — and
**Team-10 is marked "Inactive" but worked all 26 days**, so its status is
stale.

Waqas is now readable: zero team cost because he has no team, SAR 201,326 of
payout against SAR 226,634 of revenue, **margin 25,308** — not the
SAR 226,634 "profit" the old model printed.

Delivered, in the order each piece depended on the one before:

1. **the custody timeline** — replay approved `Team Allocation Request` rows
   plus `im` changes in `tabVersion` into "who held team T on day D". One
   helper, used by cost and by the SUB target split. Nothing else can be built
   first.
2. **Option A attribution** on top of it — used days by planning IM, idle days
   by custodian, day weights normalised to `_team_cost_days`
3. SUB payout as its own column; `daily_cost_applies` honoured and SUB
   `daily_cost` ignored
4. Used / Idle columns and the reconciliation line
5. targets from the Command Dashboard model, the 1.25 moved into Inet
   Settings, SUB targets split by engagement days
6. the `IM Monthly Target` manual override, which closes M&D / M&W and
   anything else the data cannot express

**Two consequences to know about.** `Profit` is now **Margin** — revenue less
salary less subcontractor payout — so the Command Dashboard's per-IM `profit`
changed meaning with it (Ajmal September: −5,590 before, −532 now). And the
SAR 105 of `unattributed` salary is a Daily Execution whose PO Dispatch
carries no IM; it is reported rather than silently absorbed, and its
SAR 131 of derived target is likewise unassigned, which is why the targets
sum to 1,112,989 rather than 1,113,120.

**Verified:** the pot equals `get_command_dashboard`'s `inet_monthly_cost`
(496,496) exactly, so the two screens agree by construction; the manual
override works per component (an `inet_target` leaves the SUB half derived,
a `total_target` replaces both) and its duplicate guard refuses a second row
for the same IM and month; removing the override returns the derived figure.

**Phase 3 — DONE (26 Oct 2026).** Flow, Quality, Discipline and the composite
Rating. September / October on `inet_backup`:

```
Sept             Open  Exec  PIC  Rework  Re-v  Close%   Score  Rating      Rated on
Ajmal Muhammed    661   201  130      28   118   100.0    91.8  Excellent   all four
Majid Ali        1615   266  208      20     0    96.8    93.2  Excellent   all four
Waqas Ahmed       912     0  211       8     0       —    88.1  Good        3 of 4
Manukrishnan PV   586    88   88       8     5    97.7    88.1  Good        all four
Jehan Zaib        720     0   55       0     0       —    96.1  Excellent   3 of 4

Oct
Ajmal Muhammed    804   125   56      10   100    86.7    77.0  Good
Majid Ali        1665   115   47       6     0    97.8    84.4  Good
Waqas Ahmed       824     0   70       5     0   100.0    72.9  Need Improvement
Jehan Zaib        881     0   87       0     0       —   100.0  Excellent
Manukrishnan PV   635    38   10       4    34    88.4    69.1  Need Improvement
```

The bands discriminate: a strong September reads mostly Excellent, a weak
October spreads across three bands. Cut at 90 / 75 / 60 against this data,
**not** carried over from the old uncapped ratio.

**Close-out got its real definition here, not a second one.**
`plan_closed_out_sql()` is new and shared: the visit is finished
(`_visit_closed_exists_sql` — visit-scoped, QC and CIAG settled, nothing
outstanding, so a part-delivered line does **not** count), or the plan
reached Completed/Cancelled, or an issue was raised. `plan_due_sql()` dates
from the plan's END. `PLAN_CLOSEOUT_SLA.md` must use these rather than
writing its own.

**A minimum sample rule had to be added.** Waqas had exactly **two** plans
due in September, both cancelled, and scored a perfect 100 for Discipline off
that sample — which pushed him to Excellent. A component now needs at least
5 lines or 5 due plans or it is dropped from the average, the same way a
component with no data is. He reads Good on three components instead.

Worth knowing: **Cancelled counts as closed out**, per the client's own three
routes. Site-wide in September it was 101 of 892 due plans, against 632
Completed and 167 carrying an issue — so it is not what the number rests on,
but it is a way to score well by cancelling.

**Partial quantity needed no separate work.** `_visit_closed_exists_sql`
already refuses to call a part-delivered line finished, so Delivery and
close-out both honour it through the one function.

**"Lines Open" is the cohort, not the workload** — Majid shows 1,615 open
against 291 assigned, because the cohort is everything still on his plate.
The two columns answer different questions and the page should label them so.

### Twenty-four columns, eleven of them showing

Every column earns its place — each answers "why is this number what it is" —
but a 24-column wall is unreadable, and a report nobody can scan gets ignored
whatever is in it. Dropping the detail is the wrong trade: the answer to "why"
goes with it.

`DataTablePro` already solved this and nothing had used it from a report:
a `<th>` carrying `data-tablepro-default-hidden="true"` starts hidden and
appears in Manage Table. **Once the user saves a choice there, theirs wins and
the default is ignored** — so this only decides the first view.

A report now marks a column `default_hidden` in its own `columns` list and
`ReportCatalog` passes it through. Generic: any wide report gets it free.

| | |
|---|---|
| **open by default (9)** | IM, Assigned, Overall Completion %, Target, Revenue, Team Cost, Margin, Score, Rating |
| **one click away (17)** | Completed, Completion %, Direct/Backend Closed, INET Teams, Team Equivalent, SUB Teams, Lines Open, Executed, Handed to PIC, Rework, Re-visits, Closed Out %, Cost Used, Cost Idle, Subcon Payout, Target Source, Rated On |

The hidden ones are still in the payload, still filterable, still exported —
the row carries all 26 fields either way. They are also ordered so an
un-hidden column lands beside the number it explains: Used and Idle next to
Team Cost, Rework and Closed Out next to the Score they feed.

### The Teams column was wrong three ways

It counted distinct teams on a non-cancelled plan, which gave September
Ajmal 9, Majid 12, Manu 7 — **28 against 22 teams that actually worked**.

* **It double-counted.** A team shared between two IMs is one to each. That
  is fine per row and wrong as a total, and nothing said so.
* **It mixed team types.** Three of Majid's twelve were SUB teams, which
  carry no salary at all — so "12 teams" sat beside a Team Cost built from
  nine of them.
* **It was plan-based** while cost is now execution-and-custody based, so the
  two columns described different sets. Ajmal reads 11 now rather than 8,
  because custody gives him idle days on teams he held without planning.

Replaced by three, all from the cost attribution so they cannot drift from
the money:

| column | meaning |
|---|---|
| **INET Teams** | salaried teams this IM carried cost for. Honest per row, **not summable** |
| **Team Equivalent** | each team weighted by the share of its salary this IM carried — **sums to the fleet**, 17.00 in September |
| **SUB Teams** | subcontractor teams worked with. Separate, because they cost payout, not salary |

Team Equivalent is the one with a meaningful total. A count of teams can
never have one while teams are shared, so **INET Teams and SUB Teams carry
`no_total: True`** — the footer leaves them blank rather than printing a sum
that looks meaningful and is not.

### Three follow-ups, done 26 Oct 2026

**The SAR 105 of unattributed salary is gone.** It was two Daily Executions on
7 September, both Team-03, on lines carrying no `im` — the team's day is worth
1,155 and 2 of its 22 executions that day were on those lines, so 1,155 x 2/22
= 105. `backfill_missing_im_on_worked_lines` stamps an IM on any line that has
been worked but has none, taking it from the plan, then the execution, then
the project, and printing which source each line used. Both fell to the
project fallback, which is the weakest of the three, so the run names it.
Only lines with an execution are touched: 10,660 rows have no IM and no work,
which is a normal undispatched state. September and October now both
reconcile with **zero** unattributed.

**An Admin Teams edit now leaves a trail for status and cost too.** The same
`db.set_value` hole that hid IM transfers hid these: `tabVersion` held 26
status changes across 15 teams, but **Team-13, Team-14 and Team-27 read Active
while their last recorded change said Inactive** — changed on this page.
`_log_team_field_changes` writes a Version row in Frappe's own shape for
`status`, `daily_cost`, `daily_cost_applies`, `team_type`, `team_category`,
`start_date` and `end_date`. `im` is excluded deliberately — it becomes a
Team Allocation Request instead, and logging it twice would double it in the
custody replay.

**Which means a vacationing team CAN now be excluded, when that is wanted.**
Charging them is unchanged for now, by decision — the Command Dashboard
charges Inactive and On Vacation teams because the company really is paying
them. But the history to do it properly exists and is precise to the day:
Team-07 went Active -> Inactive on 25 Aug and Inactive -> On Vacation on
20 Sep, so it was **not Active for one day of September**; Team-10 went
Inactive on 4 Oct, which is exactly why it shows two worked days that month.
There is no HR source — Leave Application, Attendance and Holiday List all
hold zero rows — so Version is the only one.

**Phase 4 — Speed**, once the stamps have run long enough to mean something.

**Phase 5 — the sweep, and the partial-quantity audit.** The same ideas are
computed independently in the Command Dashboard, CEO / Ops / Financial
dashboards, the IM Dashboard's action counts, `get_top_teams_report`,
`team_utilization_*`, `monthly_team_details` and `team_idle_domain`. Each keeps
meaning the old thing until it is edited. Say which were updated and which were
deliberately left.

## One history log, not three (26 Oct 2026)

**The rule: track what the reporting depends on.** A report re-run for
September in December must give September's answer, so every master field a
report reads historically has to have a recorded history.

`PO Status Event` turned out to be **one field property away** from being the
general log it reads like — `entity` and `entity_name` were already there, and
only `po_dispatch` being `reqd=1` tied it to a PO line. Relaxing that, and
widening `entity`, made it general without touching a single one of the 31,602
existing rows or any of its 16 readers (every one scopes `WHERE po_dispatch =
%s`, so rows without a line simply never match them).

**Tracked now** (`status_log.TRACKED_MASTER_FIELDS`):

| doctype | fields |
|---|---|
| INET Team | im, status, daily_cost, daily_cost_applies, team_type, team_category, start_date, end_date |
| Subcontract Master | monthly_target, sub_payout_pct, inet_margin_pct, status, contract_model |
| IM Master | status, full_name |
| Inet Settings | inet_target_margin_pct |

**Two routes in, because one is not enough.** An `on_update` doc_event covers
every ORM save, in Desk or in code. It does **not** fire for
`frappe.db.set_value`, which bypasses the document — so the three portal
endpoints that use it (`admin_update_team`, `update_im_team`,
`pm_decide_team_allocation`) log explicitly.

`backfill_master_history_events` moved what already existed into the same
table — **252 events**: every tracked `tabVersion` change plus all 92 approved
transfers, which had been applied with set_value and so were absent from
Version entirely. The custody replay (`team_field_timeline`) now reads that
one table instead of stitching Version to Team Allocation Request, and the
report's numbers are unchanged across the switch: September still reconciles
at 496,496 with Ajmal on 215,405 used / 8,074 idle.

The `tabVersion` writer added earlier the same day is gone — it was a second
source, which is the thing this removes.

### It was already a live problem

`monthly_target` has been edited repeatedly, which is exactly the case this
was raised for:

```
Saleh Al Dosari   monthly_target  25,000 -> 37,500   23 Sep
Protech           monthly_target  40,000 -> (blank)  23 Sep
Radar Networks    monthly_target  25,000 -> (blank)  23 Sep
```

### The report reads the CURRENT target on purpose — do not "fix" this

The history is captured, but `monthly_target` is still read at its present
value, not as at the period. That is a decision (26 Oct 2026), not an
oversight, and switching it would make September **worse**.

Every edit so far is **correction, not renegotiation**. They arrive in four
tight clusters — 8 on 5 Sep, 5 on 23 Sep, 8 on 29 Sep, 2 on 1 Oct — several
setting a value from blank and several clearing one again. That is the master
being populated and cleaned up. Reading as-of would apply those blanks and
half-entered figures to a month whose numbers have since been corrected, and
every past report would move for no business reason.

**When to revisit:** once a target changes because the commitment itself
changed. At that point do not simply read the latest event before the period
— add an **effective-from** date so a correction and a renegotiation can be
told apart, the same way `closeout_enforced_from` separates a new rule from
the history it would otherwise reach back into. Treating every edit as
historical truth is what makes as-of reading dangerous here.

Capturing the history was always the prerequisite, and it is done; nothing is
lost by waiting, because the events are being recorded from now on whether or
not the report reads them.

## Parked, deliberately — nothing blocks the build

All four were raised and closed on 26 Oct 2026. None of them stops any phase;
each has a defined behaviour in the meantime. Written down so they are not
rediscovered as bugs.

**Naming a team on a Direct Close — won't do.** Not a gap: Direct Close exists
*because* the work bypassed a team and a plan, so there is no team to record.
The cost still reconciles, because every team-day is charged as used or idle
either way. Only the Idle label is affected — see above.

**A `valid_until` on `Team Allocation Request` — not now.** Teams do get
transferred back, median 5 days, so the timeline works as it stands. The
exposure is a forgotten return parking idle cost on the borrower; revisit if
that ever shows up in the data.

**In-house `monthly_target` vs salary × 1.25 — parked.** SAR 20,020 apart.
Salary × 1.25 is what the report uses, per decision 3b; the in-house
`monthly_target` values are simply not read. Settle it before anyone reads an
in-house achievement figure.

**Where M&D and M&W cost sits — parked.** Backend staff are not in
`INET Team`, so no cost model reaches them. They show **"no attributable
cost"** and no profit figure — never SAR 0, which would print revenue as
profit. A manual target covers them if one is wanted.
