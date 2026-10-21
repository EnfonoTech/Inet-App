# DSA mapping — a temporary flow, until Material Management is used

**Status:** designed, not built. Agreed 20–21 Oct 2026.

Material Management is the final design and it is not in use. On the
production copy: **9,866 Huawei Outbound Plans imported, 0 material
receipts, 0 Stock Entries, 0 Batches, 0 Stock Ledger Entries, 1 Material
Request.** Not "barely used" — untouched.

This gives the IM the one piece of it that is wanted now — recording which
DSA a plan draws on — without a receipt, a stock entry, a batch, an item
line or a quantity. Behind a setting, removable without unwinding any
ledger data.

## Only iNet's own material

`Huawei Outbound Plan.subcon` is the contractor the material went **out
to**, and most of it is not ours: **568 of 9,866** outbound plans are
INET's. The rest belong to REZAIK, GTEL, ALPHA, SAMHAN and the other
forty-odd Huawei subcontractors.

`get_bill_wise_status` has always carried `subcon = 'INET'`. The DSA
mapping shipped without it and listed all 9,866 — showing an IM another
contractor's material, which is not a filter miss but somebody else's
delivery. `DSA_OWN_SUBCON` now gates both the picker and the register.
Reported from the screen; the per-IM counts had looked plausible because
the DSAs on an IM's own sites are mostly ours anyway (AJMAL 158 → 156,
Manu 67 → 57).

## The vocabulary

| | field | doctype |
|---|---|---|
| **DSA** | `bill_no` | Huawei Outbound Plan |
| **MSA** | `request_no` | Huawei Outbound Plan |
| the site | `duid_master` → DUID Master | Huawei Outbound Plan |

`Huawei Outbound Plan` is flat — one row per DSA, with a `total_volume` and
no item lines. The material module calls a DSA a **"bill"** throughout
(`get_bill_candidates`, `get_duid_bill_materials`, `get_bill_wise_status`).

## CIAG is the closure — there is no separate "close DSA"

`get_site_verify_status()` lives in `material_management.py`, and its
docstring says why:

> *Sites where the TL has completed work (**material used**) but the client
> hasn't yet approved CIAG.*

So the existing chain is:

```
bill (DSA) → material at the DUID → issued to team → used on execution
                                                   → CIAG approved by client
```

CIAG is the client's sign-off that the site's material and work are
accepted. It is not *like* closing the DSA; it **is** that step. **[D]**

Consequences, all deliberate:

- **No status field on the mapping**, no `closed_by`, no `closed_on`. A
  second definition of "done" beside an existing one is the mistake this
  bench keeps paying for (see §8 of EXECUTION_WORKFLOW.md).
- The existing QC/CIAG screen and the `qc_ciag` update mode already do the
  work; no new role, no new action.
- `get_site_verify_status` and the Site Verify report cover mapped DSAs for
  free, and `ciag_status_date` already drives "pending days".

### The pool and the record are two different lists

A closed DSA leaves the **pool** — `_dsa_rows` excludes it, so it is never
offered again. It does **not** leave the **record**: the plan still consumed
that material and must say which.

Reading the box off the pool alone broke exactly that. A signed-off plan
showed *Closed · CIAG approved* over the words **"No DSA recorded for this
site"**, which is the one case where the mapping matters most. The picker
now renders the mapped rows first, always, and the pool only while the plan
is still open. `get_plan_dsas` joins back to `Huawei Outbound Plan` for the
outbound date and project so a record row stands on its own once the
candidate row is gone.

The closing date is on the badge — *Closed · CIAG approved 2026-10-21* —
not hidden in a tooltip, because "when was this signed off" is the first
thing asked of a closed line.

### Shown where CIAG is set

Approving CIAG is what closes a DSA, so the **Set CIAG** dialog carries the
DSA it is about to close: `PlanDsaMapping` in `recordOnly` mode — the
record, no pool, nothing editable — above the Submit button, with the line
*"Approving CIAG closes this DSA."* The IM should not have to leave the
dialog to find out what they are signing off.

### No CIAG, no DSA

**`ciag_required = 0` means no material was used, so there is no DSA to
map and the box is not offered at all.** **[D]** Not shown-and-disabled —
absent. A DSA attached to a plan that can never reach CIAG would be a
mapping nothing could ever close.

It is a narrow gate, which is the point: 4,030 of 4,389 plans have
`ciag_required = 1`, and of the 1,371 plans whose DUID carries a DSA,
**1,274 would offer the box**. The ~7% it removes are exactly the ones
with no material behind them. CIAG itself stands at 2,394 Approved, 956
Open, 876 Not Applicable.

## What the IM sees

**Only DSAs for DUIDs on that IM's own PO lines.** **[D]** Never the whole
outbound table. The scope is:

```sql
Huawei Outbound Plan h
  JOIN PO Dispatch pd ON pd.site_code = h.duid_master
 WHERE pd.im = <this IM>
```

That is the same shape `get_site_verify_status(im_ids)` already uses, and it
matches the rule that IM scoping reads the `im` stamped on the record.

Measured on the production copy, that alone cuts 9,866 DSAs to what one
person should see:

| IM | DSAs visible | across DUIDs |
|---|---|---|
| PC-Jehan | 431 | 302 |
| PM-Waqas Ahmed | 209 | 157 |
| IM-AJMAL | 158 | 150 |
| IM-MAJID | 126 | 117 |
| IM-Manu | 67 | 49 |

**Then narrowed again to the plan's own DUID**, and that is what makes the
feature simple: 786 DUIDs carry both a DSA and a POID, **1,371 rollout
plans have at least one DSA on their site** (40 currently live), and the
picker is nearly always a single row —

```
1 DSA  -> 5,934 DUIDs        average per plan : 1.2
2 DSAs -> 1,712 DUIDs        worst case       : 3
3+     ->    25 DUIDs
```

The three DUIDs holding 5, 20 and 376 DSAs (`Non HW Delivery-DU` and
friends) carry **0 POIDs**, so they never reach a plan's picker at all —
the pseudo-DUIDs exclude themselves.

So this is not a search problem. It is "confirm the DSA for this site",
with a second one to choose from occasionally. An earlier reading of
157 shared DUIDs / 29 mappable plans came from the `inet` dev site and
understated it badly — dev data underrepresents production, as ever.

**A closed DSA is not offered again.** **[D]** Once its mapping's execution
has CIAG `Approved`, it leaves the picker. On the copy, 270 DSAs sit on a
DUID whose execution is already CIAG-approved.

## The data

One child table, `Rollout Plan DSA`, on Rollout Plan:

| field | |
|---|---|
| `outbound_plan` | Link → Huawei Outbound Plan |
| `bill_no` | fetched, read-only — the DSA |
| `request_no` | fetched, read-only — the MSA |
| `remark` | optional |

A child table because one plan can draw on several DSAs. Nothing is written
back to `Huawei Outbound Plan`; re-imports skip bills they already hold, so
a stamp there would survive, but there is no reason to add one.

**One DSA on two plans is allowed, not enforced.** **[?]** The picker shows
a muted marker when a DSA is already mapped elsewhere — visible without
being blocked. The rule gets decided from real usage rather than guessed
now.

**Nothing is blocked.** **[?]** An unmapped or unclosed DSA does not stop
Work Done or anything else. Observational first.

## Surfaces

| where | what |
|---|---|
| **Every planning form** | IM attaches DSAs when creating the plans — see below |
| Rollout Execution | attach or change afterwards |
| Rollout Work Done | DSA + MSA read-only |
| QC / CIAG screen, and the **Set CIAG** dialog | DSA + MSA read-only, so whoever approves CIAG sees what they are signing off |
| **Execution form** (field) | which DSA this plan draws on, read-only, **no pickup** |
| **My Stock → Incoming** (field) | the DSAs still to collect, in the SAME list and the SAME card as Material Requests |
| Material Management | a temporary DSA list — see below |

### Every planning form, not just the one

Plans are created from **five** places, and they do **not** share a
component:

| form | how it gets the picker |
|---|---|
| Rollout Planning (`IMDispatch`) | `RolloutPlanModal` |
| Rollout Planning, PM (`admin/RolloutPlanning`) | `RolloutPlanModal` |
| Close Remainder, from Work Done | `RolloutPlanModal` |
| Issues & Risks, IM | its **own** form — wires the hook itself |
| Issues & Risks, PM | its **own** form — wires the hook itself |

The last two hand-roll their planning modal and call
`create_rollout_plans` directly, so anything added only to
`RolloutPlanModal` silently skips them. That is why the picker is
`components/DsaPlanningPicker.jsx` — a hook plus the UI it drives — and
each form wires two lines instead of growing its own copy:

```js
const dsa = useDsaPlanning({ open, enabled: ciagRequired, dispatchNames });
<DsaPlanningPicker state={dsa} />
await dsa.mapToPlans(result?.names);   // after the plans exist
```

Which created plan gets which DSA is resolved server-side by
`map_dsas_to_plans`: `create_rollout_plans` returns a flat list of names,
and pairing them in the browser would be guessing.

The PM's Issues & Risks form had no QC/CIAG toggles at all, while the IM's
copy of the same form did. It has them now, defaulting to on, which is
what its plans already got by omission — `_truthy(None)` is True in
`create_rollout_plans`, not False. The picker follows the CIAG switch
there as everywhere else.

**Nothing shown is ambiguous.** An IM who sees no DSA box cannot tell
"this site has no DSA" from "this screen does not do DSAs" — and most
sites have no DSA, since only 374 of 6,750 outbound plans are iNet's. So
once the backend has answered for a real selection, a site with nothing
says one muted line rather than rendering nothing at all.

Two things the group header must not say:

* **"0 available"** on a site with nothing to collect. It reads as a
  quantity of something; it says **"No DSA"**. The box as a whole is
  hidden unless at least one DUID in the selection has a DSA, so "No DSA"
  only ever appears beside a site that does.
* **an unlabelled date.** `Received · 2026-08-13` left the reader to guess
  which date that was; it is the DSA's **Outbound Date**, and now says so.

### What the field user sees

Two places, both read-only, both scoped to the team's own plans — a team
sees a DSA because one of THEIR plans was mapped to it, never the outbound
table and never another team's material. Verified: two teams mapped, a
third sees 0.

`list_team_dsas` serves both. Given `rollout_plan` it answers for one plan
(the execution form); given `team` it answers for the team's plans in a
window around today (My Stock), so the list is a day's work rather than a
history.

### Pickup date and time — one field, either source

Material Request carries pickup as `schedule_date` plus a `pickup_time`
Custom Field, and **My Stock → Incoming** already renders it: a
`🕐 Pickup: date · time` line with a `PickupUrgencyMark` badge (Overdue /
Due today / Due tomorrow / In Nd), feeding the tab's amber count.

There is no Material Request in this flow, so the mapping carries its own
`pickup_date` and `pickup_time`. **Both flows then feed the same list,
through the same card.** `list_pending_team_confirmations` returns DSA rows
alongside Material Request rows, each tagged `source`, so one pickup line
means the same thing whichever flow produced it — which is the point when
both are running at once. A DSA row drops what does not apply: no item
lines, and no *View & Confirm*, because CIAG closes it.

**Incoming, not Awaiting.** The two tabs look alike and both carry pickup.
*Awaiting* is for a Material Request the Warehouse Manager has not staged
yet — "nothing to do yet". A DSA is never in that state: the material has
already gone out, and the only open question is when the team fetches it.
That is *Incoming*. The DSA card drops the one thing Incoming otherwise
offers, *View & Confirm*, because there is no stock entry to make.

A first attempt put a separate "Material to collect (DSA)" block at the top
of the **Stock** tab. That was wrong twice over: Stock is what you already
hold, not what you are going to fetch, and a second block with its own
layout competes with the pickup UI that was already there. Removed.

**Not on the execution form.** By the time someone is filling that in they
are on site, so when to collect is behind them. That page shows which DSA
the plan draws on, so the item numbers can be checked against it, and
nothing about collection.

Set by the IM: per DSA on Rollout Execution; one pair for the whole
selection in the planning modal, the same way the material dispatch panel
beside it takes one pickup for the whole dispatch.

Two things that bite:

* `set_plan_dsas` replaces the whole set, so the picker re-sends the pickup
  values it already holds — otherwise changing a selection would silently
  drop times already entered.
* The card is keyed on the mapping row, not the bill, because one DSA bill
  can be mapped to two plans of the same team.
* `list_pending_team_confirmations` used to return early when the team had
  no warehouse. **Only 3 of 30 teams have one** — the DSA flow exists
  because material management is not set up — so that guard now gates the
  Material Request half alone, or DSAs would be invisible to 27 teams.

MSA shows wherever the DSA shows. It is fetched, never entered.

## A DSA view in Material Management

Asked for as part of the same temporary step: somewhere to see and control
the DSAs themselves while the full flow is unused.

`list_dsa_register()`, purpose-built. **Reusing `get_bill_wise_status()`
was the plan and it does not work** — an earlier draft of this file claimed
it "reads Huawei Outbound Plan directly, not Batch", which is only half
true. It takes the bill LIST from the outbound plan but joins Stock Entry
and Batch for the quantities, and its own docstring says only bills that
went through the batch-tracked Receipt flow appear. It also filters to
`subcon = 'INET'`. Measured: **0 rows out of 9,866**, and 568 plans pass
the subcon filter. A flow with no receipts is exactly the case it cannot
serve.

So the register is its own query: DSA, MSA, DUID, project, subcon,
outbound status and date, which plan (if any) has claimed it, and whether
that plan's CIAG is approved. Scoped per IM exactly as the picker is —
568 becomes 156 for IM-AJMAL, 114 for IM-MAJID, 57 for IM-Manu.
Filterable on mapped / unmapped.

## The setting

`enable_dsa_mapping`, a checkbox in INET Settings → Features, beside
`enable_direct_close`, `enable_backend_assign`, `enable_partial_close` and
`enable_subcontractor_split`. Off by default; every surface above is absent
until it is on.

## Open

- **[?]** One DSA across several plans — allowed for now, decide from usage.
- **[?]** Whether anything should block on an unmapped DSA.
- Both scoping readings are now taken and the picker is small (above), so
  nothing is blocking the build.
