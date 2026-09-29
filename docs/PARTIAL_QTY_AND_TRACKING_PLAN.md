# Partial Quantity, POID Cancellation and Status Ageing — build plan

Status: **built on dev, awaiting manual testing.** Written 2026-09-28.

| Part | State |
|---|---|
| A — status event log | Built. New `PO Status Event` doctype, `inet_app/api/status_log.py`, `stage_entered_at` on PO Dispatch, compound index, 2,259 events backfilled from PIC Activity Log. Every `dispatch_status` write in the app now routes through `set_dispatch_status()`. |
| B — confirmation with quantity | Built. Six fields on PO Dispatch, `_compute_confirmed_amount()` re-bases MS1/MS2, `confirm_line_qty()` endpoint, both submission endpoints accept `confirmed_qty` / `remaining_action`, PIC shows ordered and confirmed separately. |
| C — POID cancellation | Built. Seven cancel fields, `request_cancel_dispatch` / `pm_decide_cancel_dispatch` / `list_pending_dispatch_cancels`, guards for invoiced lines and live plans, cascade to PIC status + PO Intake Line + dormant plans. |
| D — closure events | Built. `Work Done Closure` child table; Work Done stays one row per POID with `executed_qty` / `revenue_sar` as the sum of its closures. |
| Reports and dashboards | **Not started.** See section 3 — deferred deliberately, not optional. |

Frontend: `ConfirmedQtyFields` component wired into both Work Done submission
modals, POID cancels added to the PM approvals inbox as a fourth request type,
a Cancel POID bulk action on the IM's PO Intake page, confirmed columns on five
PIC pages.

Three features that have to ship together, because each one is incomplete
without the others:

1. **Partial quantity** — a POID ordered for 3 where only 2 are executable.
2. **POID cancellation** — PM directly, IM with PM approval.
3. **Status change dates / ageing** — when each transition happened, and how
   long a line sat at each stage.

---

## 1. What the system does today

### A PO line is atomic

Work Done always books the whole line. `executed_qty = flt(dispatch.qty) or 1.0`
([command_center.py:8148][wd]) with a comment stating this is deliberate so
`revenue_sar` always equals `line_amount` — it discards the `achieved_qty` the
TL entered on the Daily Execution. Direct Close does the same
([command_center.py:21890][dc]).

Rollout Plan carries no quantity at all. `assigned_qty` on Rollout Plan Team is
a *split between teams* of the same full line, used to prorate revenue — not a
record of how much was actually delivered.

MS1/MS2 cannot express it either: they are **percentages of `line_amount`**
parsed from payment terms ([po_dispatch.py:104][ms]). "Partially Closed" means
MS1 done / MS2 open — never "2 of 3 qty".

**Scale:** 1,692 of 17,458 dispatch lines have qty > 1 (738 at qty 2, 499 at
qty 3). Roughly 10% of the order book.

### A revised quantity from Huawei is silently dropped

The PO upload skips any line whose POID already exists, counting it as a
duplicate ([command_center.py:2529][dup]). If Huawei re-sends the line at qty 2
with `quantity_cancel = 1`, it is discarded and the line stays at qty 3.

This is exactly how Huawei expresses a cancel — every cancelled line in the
data carries `qty = 0`, `quantity_cancel = N`, `po_line_status = 'Cancelled'`.
A partial cancel would arrive the same way and be ignored.

`quantity_cancel` and `billed_quantity` are imported onto PO Intake Line and
shown in PO Dump exports. **No logic reads either.**

**Do not use `due_qty` for remaining quantity.** On real lines it is 30% of qty
(`qty 4 → due_qty 1.2`) — it is the MS2 payment residual, not a quantity.

### Nobody but PIC can cancel a POID

1,452 lines already sit at `dispatch_status = 'Cancelled'`. Every one arrived
there either from the archive import or as a **side effect** of PIC setting
`pic_status = 'PO Line Canceled'` ([pic.py:1698][pc]). There is no user-facing
cancel endpoint. PM and IM have no route at all.

### Status history exists but is not usable

| Source | Reality |
|---|---|
| `tabVersion` (`track_changes = 1` on PO Dispatch, Work Done, Rollout Plan, Daily Execution) | Only **508** version rows for 17,458 dispatches. See below — not usable, and not fixable by a flag. |
| `PIC Activity Log` (2,316 rows) | Purpose-built and working — but only records `pic_status` (2,305) and `pic_status_ms2` (11), and only from PIC's own update functions in `pic.py`. |

**Frappe Version cannot be made to work here, and `update_modified=False` is not
the reason.** `save_version()` is called from exactly one place —
`Document.save()` (`frappe/model/document.py:1199`). `frappe.db.set_value()`
runs a raw UPDATE and never reaches the document layer; its own docstring says
*"this function will not call Document events and should be avoided in normal
cases."* `update_modified` only controls whether the `modified` column is
written. Setting it to `True` would still produce no version.

Using Version would therefore mean moving all 175 `db.set_value` calls to
`doc.save()`. Every PO Dispatch save runs `_ensure_duid_master()` (a DB check
plus possible insert), the payment-terms regex, `_compute_ms_amounts()`, and
fires `_cascade_im_on_dispatch` from `on_update` — so a PIC bulk update of 47
rows becomes 47 document loads and saves instead of 47 UPDATEs.

And the shape is wrong regardless. Version stores one JSON blob per save:

```json
{"changed":[["im","","456"],["remaining_milestone_pct","100.0%",0.0]]}
```

No indexed column for field, old value or new value. "Days under I-BUY" would
mean JSON-parsing every Version row on every report load. It is an audit trail
for a human reading one document, not a reporting source.

**Date columns per status are also rejected**, except for two hot ones. PIC
status has 11 values × 2 milestones = 22 columns, on a doctype already carrying
~100 fields — and a single column keeps only the *last* entry into that status.
`I-BUY Rejected` and `ISDP Rejected` are real statuses, so lines genuinely
bounce (I-BUY → Rejected → I-BUY) and the first visit is lost, which is exactly
the case being investigated when someone asks why a line took so long. No user,
no remark either.

**Decision: an event log is the record; two denormalised columns are the index.**
`db.set_value` stays as it is — the fix is an explicit `log_status_event()` call
beside each status write, not a change of write mechanism.

**There is no confirmation date field anywhere.** Every date column on Work Done
and PO Dispatch was checked. The nearest are `subcon_completed_on` (subcon work
finished, before confirmation), `ms1_applied_date` / `ms2_applied_date` (PIC
applied, after confirmation) and `ms1_closed_at` / `ms2_closed_at` (milestone
close). None is the IM→PIC handoff moment. `im_confirmation_note` stores a note
with no timestamp.

### Caution: today's transition data would make ageing meaningless

Grouping the PIC Activity Log by transition:

```
old_value                  new_value                     count
(blank)                 -> PO Line Canceled              1437
(blank)                 -> Commercial Invoice Closed      755
Commercial Invoice Closed -> Commercial Invoice Closed      25
(blank)                 -> Ready for Invoice               14
Under Process to Apply  -> Ready for Invoice                7
Under I-BUY             -> Ready for Invoice                3
```

The ladder is **jumped, not walked** — roughly 13 rows in 2,316 show a genuine
intermediate step. Ageing built on this measures nothing until PIC actually
moves lines stage by stage. The tracking is worth building, but the process
change has to come with it or the reports will be empty.

---

## 2. Design

### Part A — Status event log (build first)

Both the quantity flow and the cancellation flow need to record *when*, and
ageing needs it for every stage. Build the recorder once.

New module `inet_app/api/status_log.py`, new doctype **PO Status Event**:

| Field | Type | Notes |
|---|---|---|
| `po_dispatch` | Link PO Dispatch | always set, the anchor |
| `entity` | Select | `PO Dispatch` / `Work Done` |
| `field_changed` | Data | `dispatch_status`, `pic_status`, `submission_status`, … |
| `old_value` / `new_value` | Data | |
| `milestone` | Select | blank / MS1 / MS2 |
| `changed_by` | Link User | |
| `changed_at` | Datetime | |
| `days_in_previous` | Float | computed on write from the prior event for the same field |
| `remark` | Small Text | |
| `batch_id` / `row_count` | Data / Int | carried over from PIC Activity Log's bulk pattern |

Plus one denormalised column on PO Dispatch — `stage_entered_at` (Datetime) —
so list views show ageing without a join.

Single helper `log_status_event(po_dispatch, field, old, new, *, milestone=None,
remark=None, batch_id=None)`. Wrapped in try/except and never allowed to block
the user's action — the existing `_write_pic_activity_log` already takes this
approach ([pic.py:1737][log]) and it is the right one.

**Call sites to wire:**

| Where | Field logged |
|---|---|
| `update_work_done_submission` ([:10569][uws]) | `submission_status` |
| `update_subcon_submission` ([:11023][uss]) | `subcon_submission_status` |
| `bulk_update_pic_status` / single setter in `pic.py` | `pic_status`, `pic_status_ms2` — migrate off `_write_pic_activity_log` onto the shared writer |
| `direct_close_dispatches` ([:21603][dcl]) | `dispatch_status` |
| `dispatch_po_lines` ([:5586][dpl]) | `dispatch_status` |
| new cancel endpoints (Part C) | `cancel_request_status`, `dispatch_status` |

Keep `PIC Activity Log` and its 2,316 rows. Backfill them into PO Status Event
in a patch rather than migrating the doctype, so nothing that reads the old
table breaks.

**Ageing then falls out of one query** — "days under I-BUY" is
`SUM(days_in_previous) WHERE old_value = 'Under I-BUY'`.

### Part B — Confirmation with quantity

The confirmation step is the right gate: it is the last point before money
([pic.py:49][picpop] defines PIC's whole population by this status), it is the
moment the IM actually knows the delivered quantity, and the confirmation mail
is already mandatory there ([IMWorkDone.jsx:746][doc1]).

New fields on **PO Dispatch**:

| Field | Type | Notes |
|---|---|---|
| `confirmed_qty` | Float | what the IM confirms was delivered |
| `confirmed_amount` | Currency | `rate × confirmed_qty` |
| `confirmation_date` | Datetime | the IM→PIC handoff moment |
| `confirmed_by` | Link User | |
| `remaining_qty_action` | Select | blank / `Cancelled` / `Pending – to be worked` / `Pending – to be invoiced` |
| `remaining_qty_remark` | Small Text | |

**`line_amount` is not touched.** It stays Huawei's ordered figure. Overwriting
it would erase the fact that 3 were ordered — the PO Published Value vs Invoiced
Value chart would silently shrink instead of showing the gap, and a re-upload
could restore the old figure behind the change. Keeping both makes
"ordered 3 / confirmed 2" visible, which is the number the business wants.

**`_compute_ms_amounts` changes one line** ([po_dispatch.py:104][ms]): the base
becomes `confirmed_amount` when set, else `line_amount`. MS1/MS2 percentages
then apply to the corrected amount automatically — no PIC rework.

**Both confirmation paths take the quantity.** `update_work_done_submission`
covers rollout and direct close; the subcon path at
[command_center.py:11023][uss] has no Work Done row at all and sets
`subcon_submission_status` on PO Dispatch. Wiring only the first leaves every
backend/subcon line at full quantity.

**Work Done** stops hard-coding `flt(pd.qty) or 1.0` at the two sites
([:8148][wd], [:21890][dc]) and takes the confirmed values, falling back to the
current behaviour when nothing is confirmed — so the ~90% of lines at qty 1 are
byte-identical.

**Locking.** Editable while `pic_status` is blank / `Work Not Done` /
`Under Process to Apply`. After that it takes a PIC reject back —
`PIC Rejected` already exists as a status for exactly this. Without the lock, an
edit after MS1 is invoiced drives `ms1_unbilled` negative and the invoiced
amount stops matching the line.

**Validation.** `0 < confirmed_qty <= qty`; `confirmed_amount` may not fall
below `ms1_invoiced + ms2_invoiced`.

### Part C — POID cancellation with PM approval

Clone the pattern that already works on Rollout Plan — `request_cancel_plan` /
`pm_decide_cancel_plan` / `list_pending_cancel_requests`
([command_center.py:24666+][cancel]) — onto PO Dispatch.

New fields, same names as Rollout Plan's so the UI components carry over:
`cancel_request_status` (blank / `Pending PM Approval` / `Approved` /
`Rejected`), `cancel_reason`, `cancel_requested_by`, `cancel_requested_at`,
`cancel_responded_by`, `cancel_responded_at`, `cancel_pm_remark`.

Endpoints:
- `request_cancel_dispatch(po_dispatch, reason)` — IM, raises the request.
- `pm_decide_cancel_dispatch(po_dispatch, action, remark)` — PM approves or rejects.
- PM cancelling directly skips the request and goes straight to approved — no self-approval round trip.
- `list_pending_dispatch_cancels()` — PM queue, mirroring the plan version.

**Guards before a cancel is allowed:**
- Any milestone already invoiced (`ms1_invoiced` or `ms2_invoiced` > 0) → refuse. That is a credit note with Huawei, not a cancel.
- An active Rollout Plan exists → refuse, cancel the plan first. Mirrors the existing sub-contract guard at [command_center.py:21996][sub].
- Already `Cancelled` or `Closed` → refuse.

**On approval, one transaction:** `dispatch_status = 'Cancelled'`,
`pic_status` / `pic_status_ms2` → `PO Line Canceled`, `PO Intake Line.po_line_status`
→ `Cancelled` (the existing cascade at [pic.py:1698][pc] already does this
mapping — reuse it, do not duplicate), cancel any open Rollout Plans, and log
every transition through Part A.

### Part D — Where the leftover quantity goes

`remaining_qty_action` decides, and the three values match the three real
outcomes:

| Action | Effect |
|---|---|
| `Cancelled` | Line closes at `confirmed_amount`. Remainder recorded and never reappears. Uses Part C's cascade. |
| `Pending – to be invoiced` | Line stays open for PIC. `confirmed_amount` covers what is billable now; the gap to `line_amount` stays visible as unbilled. |
| `Pending – to be worked` | Line stays open for planning, and is closed by a **second confirmation** later. |

**Decided: one Work Done, plus a child table of closures.**

The measured constraint: **60 queries** touch `tabWork Done`, and **28 of them
are `SUM(wd.…)` aggregates**. Those double-count the moment a POID can carry two
Work Done rows — which is why a second row per closing event was rejected. It
would also mean reworking the ~20 one-per-POID lookups
(`exists("Work Done", {"system_id": …})`, `existing_wd_name`) and the duplicate
guards shipped in the current release.

New child table **Work Done Closure** on Work Done:

| Field | Type | Notes |
|---|---|---|
| `closed_qty` | Float | quantity confirmed by this event |
| `closed_amount` | Currency | `rate × closed_qty` |
| `closed_on` | Datetime | when this portion was confirmed |
| `milestone` | Select | blank / MS1 / MS2 |
| `source` | Select | `Rollout Execution` / `Backend` / `Direct Close` |
| `closed_by` | Link User | |
| `remark` | Small Text | |

The parent Work Done stays **one row per POID**. `executed_qty` and
`revenue_sar` become the sum of the child rows, so all 28 aggregates keep
working untouched and nothing double-counts.

Reports that need month-accurate revenue join the child table instead of the
parent. That is **opt-in, one report at a time** — not a migration. Until a
report is converted it behaves exactly as it does today.

Rejected alternatives, for the record:

- *Raise `confirmed_qty` on the same Work Done with no child table* — cheapest, but the line's whole revenue sits at one date, so September work plus December work lands entirely in one month.
- *A second Work Done per closing event* — correct by month, but the 28 aggregates and ~20 one-per-POID lookups all need auditing first.

---

## 3. Reports and dashboards — do not skip this

Every part below changes something a report reads. None of them pick it up on
their own. Deferred deliberately for now, but **not optional before the feature
is considered shipped** — see the rule in `CLAUDE.md`
("A feature is not finished when the feature works").

| Change | What must be revisited |
|---|---|
| `confirmed_amount` becoming the MS1/MS2 base | Every revenue figure sourced from `line_amount` or `ms1_amount` / `ms2_amount`: commercial dashboard, revenue tracking, revenue forecast, PO milestone status, project profitability. PO Published Value vs Invoiced Value is the one that should now show a real gap rather than hiding it. |
| Work Done revenue becoming a sum of closures | The 28 `SUM(wd.…)` aggregates keep working against the parent; each report then has to be judged on whether it wants parent (line total) or child (per-month) figures. |
| New `dispatch_status` / cancel states | `LINE_DONE_STATUSES` in `command_center.py`, and the status lists plus `pic_status_order()` in `pic.py`. A value missing from these silently drops out of the reports that use them. |
| New PO Dispatch fields | Explicit column lists in list endpoints, detail modals and Excel exports; frontend filter option lists that hard-code Select values. |
| Status event log | New ageing reports are the *point* of Part A, not a side effect — days-per-stage per line, and the stage a line is currently stuck in. |

---

## 4. Build order

**A → B → C → D.** Part A first because B and C both write to it, and
retrofitting the log afterwards means touching the same call sites twice.

Parts A–C plus the `Cancelled` and `Pending – to be invoiced` halves of D cover
the common case with no structural change to the Work Done model.

**Per part: build → Claude tests → user tests manually → fix.** Each part is
verified before the next one starts, rather than testing the whole thing at the
end. Anything the manual pass turns up gets folded in before moving on.

## 5. Decisions taken

**The PO upload is not changed.** A Huawei re-upload that revises an existing
line's quantity stays ignored, as it does today. The finding in section 1 is
recorded as documentation only — the shortfall is discovered and recorded by the
IM at confirmation, not by the import. Revisit only if it turns out IMs are not
catching it.

**PIC does not approve a confirmed-quantity reduction.** The IM's entry is
final. PIC sees it and invoices against it.

**PIC shows ordered and confirmed quantity as two separate columns**, never one
merged figure — so the reduction is visible to the person raising the invoice
rather than implied. Concretely:

- `list_pic_rows` (`pic.py:208`) — add `pd.confirmed_qty` beside the existing
  `pd.qty` in the select at `pic.py:495`, and to the searchable-field map at
  `pic.py:370`.
- `list_invoice_detail_rows` (`pic.py:864`) — same, beside `pd.qty` at
  `pic.py:835`.
- The PIC frontend tables render both, with confirmed quantity visually distinct
  when it differs from ordered.
- Same pairing for the amounts: `line_amount` (ordered) and `confirmed_amount`
  (to invoice).

[wd]: ../inet_app/api/command_center.py#L8148
[dc]: ../inet_app/api/command_center.py#L21890
[dup]: ../inet_app/api/command_center.py#L2529
[uws]: ../inet_app/api/command_center.py#L10569
[uss]: ../inet_app/api/command_center.py#L11023
[dcl]: ../inet_app/api/command_center.py#L21603
[dpl]: ../inet_app/api/command_center.py#L5586
[cancel]: ../inet_app/api/command_center.py#L24666
[sub]: ../inet_app/api/command_center.py#L21996
[ms]: ../inet_app/inet_app/doctype/po_dispatch/po_dispatch.py#L104
[pc]: ../inet_app/api/pic.py#L1698
[log]: ../inet_app/api/pic.py#L1737
[picpop]: ../inet_app/api/pic.py#L49
[doc1]: ../frontend/src/pages/im/IMWorkDone.jsx#L746
