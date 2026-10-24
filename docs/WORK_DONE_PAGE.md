# The PM Work Done page — what each number means

Written after a long session of the same questions being asked twice. Every
figure below was measured on `inet_backup`, the production copy, in
October 2026; the shape is what matters, not the exact counts.

## Who sets what

**`Work Done.submission_status` is the IM's field, not PIC's.** This is the
single most mis-read thing on the page, and it was mis-read repeatedly
during the work that built it.

* `Confirmation Done` means **the IM has finished and handed the line to
  PIC**. It is not PIC confirming anything.
* `PO Dispatch.pic_status` / `pic_status_ms2` are PIC's own columns, and
  describe the invoicing pipeline.

So "the Commercial tab" means *handed over*, and handover is where PIC's
work starts.

## The three tabs

| tab | rule | why |
|---|---|---|
| **Operational Work Done** | `submission_status <> 'Confirmation Done'` | what the IM still owes |
| **Commercial Work Done** | `submission_status = 'Confirmation Done'` | what PIC holds |
| **All Work Done** | no slice | the two above, exactly |

They partition: 726 + 520 = 1,246, no overlap, nothing in between.

**1,246 is not every Work Done row.** The table holds 4,379. The page hides
rows whose milestones have all reached a terminal PIC status — 3,133 of
them — because they are finished. Quoting a raw `tabWork Done` count at
anybody will not match their screen; this mistake was made and had to be
retracted.

## The commercial pipeline

One SQL CASE, `wd_pipeline_case()`, used for the tile counts **and** the
filter behind them, so a tile cannot count rows its click disagrees with.

| bucket | meaning |
|---|---|
| **Handed over, PIC not started** | the stuck state — see below |
| Under Process to Apply / Under ISDP / Under I-BUY / Ready for Invoice | PIC's own statuses, in flight |
| **Rejected at ISDP / I-BUY** | a milestone bounced by the customer's system |
| **Partly invoiced** | claimed at PIC, balance outstanding: MS2 owed, quantity still to deliver, or value still to bill |
| Cancelled | |

Three things this deliberately does **not** have:

* **No "In progress at PIC" lump.** Every line on the tab is at PIC — the
  rejected ones too — so the words separated nothing. They hid 284 lines
  sitting at Under I-BUY, which is the fact worth seeing.
* **No "Fully invoiced".** It cannot legitimately exist: a fully settled
  line is already hidden from the page. The four that once carried the
  label had 1–3 units still to deliver, or SAR 126 of a 189 milestone
  unbilled.
* **No "Not started at PIC" as a normal state.** A blank MS2 is not
  "no MS2" — `ms2_pct > 0` decides whether MS2 exists. Eight lines read MS1
  Submitted at 80% with MS2 blank and 20% owed; treating blank as N/A
  called them fully invoiced.

### The stuck bucket, and the guard

`Handed over, PIC not started` is a line the IM finished while PIC's column
still literally reads `Work Not Done`.

It is **not** rescued by `_PIC_INITIAL_RULE_SQL`. That rule promotes a
handed-over line to *Under Process to Apply* only when `pic_status` is
genuinely EMPTY — its first branch is `pic_status != ''`, and
`'Work Not Done'` is not empty.

It is **not** a code bug either. The handover advance
(`command_center.py`, on setting `Confirmation Done`) has worked since
June 2026, and the `PO Status Event` log shows every one of the twelve was
advanced correctly and then moved back **by hand**, by PIC, two of them
from as far along as Under ISDP. No reason is recorded, the IM is never
told, and the line parks in PIC's *Pending* pile — where you look for work
that has not been done, so nobody looks.

`_refuse_unsubmit_confirmed()` now blocks that move on both write paths
(`update_pic_row` throws; `bulk_update_pic_status` reports per row so one
line cannot abort a bulk) and points at **Reject**, which demands a reason
and notifies the IM. **Worth asking PIC why they were doing it** — if the
Reject flow does not serve some case, the guard will surface it as a
complaint rather than as silent data.

## Days in Status

One column, Excel-filterable, meaning per half:

* operational → since `submission_status_changed_at` (the stamp)
* commercial → since PIC last moved the milestone status, because once a
  line is handed over the thing that stops moving is PIC's status

Backed by four stamps on **Work Done** — `ready_for_confirmation_at`,
`confirmed_at`, `pic_rejected_at`, `submission_status_changed_at` — written
by one helper called from all three places the status changes, so a date
cannot disagree with the status beside it.

Derived answers were tried first and both failed, which is why the stamps
exist: `modified` moves on any edit, and `PO Status Event` covered 49 of
936 operational rows because the PIC rejection path wrote the status with a
bare `set_value` and logged nothing (now fixed — `submission_status` was in
`TRACKED_FIELDS` the whole time).

## The Summary

Both halves derive from `list_work_done_rows`, so they count the page's
rows and no others, and they take the page's filters.

It was not always so. The commercial half ran its own query over **every PO
Dispatch on the site** — 22,873 lines across the stages — which put a
"Total Work Done" tile reading 1,246 beside a "Total Work Done Lines" tile
reading 16,359 on one screen. And `get_work_done_summary()` accepted no
arguments at all, so setting an IM narrowed the table and left every tile
counting the whole site.

Other things it learned the hard way:

* **Flags do not stop at the tab boundary** — 136 operational, 28
  commercial. A "Flagged" tile in one half alone drops the other's.
* **Two different rejections, never both called "Rejected".**
  *Submission rejected* is PIC returning the work done; *Rejected at ISDP /
  I-BUY* is the customer's system bouncing a milestone.
* **Every tile clicks through**, and a tile sets only its own dimension —
  the toolbar filters (IM, project, dates, search) are the user's context
  and are left alone, so a filter and a card stack instead of one wiping
  the other.
