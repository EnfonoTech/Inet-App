# Payout deduction — parked, waiting on the client

**Status:** not built. Q1 answered 22 Oct 2026, Q2 and Q3 still open, and the
answer raised a new one (bottom of this file). Raised 20 Oct 2026 from a
report on two POIDs; the findings below are measured on `inet_backup`, a
production copy.

## What the client asked for

On some survey pay items, SAR 100 is taken off the line before the
subcontractor's payout is worked out:

```
line 880 → payout (880 − 100) × 80% = 624      what they pay
PMS       → payout  880        × 80% = 704      what PMS shows
```

Reported on `1011HG3692387-264-1-1` and `-265-1-1` — both *Site survey for TX
Equipment, per site*, 880 at 80% under Saleh Abdul Aziz Al Dosari. The 160
difference they saw (39,644 against 39,484) is exactly 2 × 80.

They had been correcting it by editing the payout amount on the purchase
order by hand.

## Why editing the PO by hand does not hold

1. **Any later rate correction wipes it.** `_fix_order` (`subcon_fixes.py`)
   computes `rate = PO Dispatch.rate × pct / 100`, so a hand-set 624 becomes
   704 again. That code ran on the Imdad and Jereesh orders on 19–20 Oct; it
   would have reverted these edits without saying so.
2. **It cannot be applied before a PO exists.** The To Order figure comes
   from `_expected_payout_sql` = `line × pct`. There is nothing to edit yet.
3. **It makes the document contradict itself** — amount 624 carrying
   `payout_pct` 80 on an 880 line. Every report that recomputes disagrees
   with the order.

`_payout_shown_sql` shows the stamped PO amount when it is non-zero and falls
back to `line × pct`, so a hand-set amount only ever holds on an already
ordered milestone, and only until something re-rates it.

## Scope — it is not two lines

Re-measured 23 Oct 2026 through the Subcon page's own master resolution
(`_SUBCON_FROM_JOIN`, allocation → contract → last live plan's team →
backend team), over all 767 survey lines:

| resolved contract | lines | line value |
|---|---|---|
| **SUB — a subcontractor is paid** | **78** | **SAR 65,658** |
| INET — own crew, no payout, deduction irrelevant | 614 | SAR 475,454 |
| not assigned yet — could become either | 76 | SAR 57,678 |
| **total** | **767** | **SAR 597,990** |

So **78 lines are affected today**, with SAR 7,800 riding on the answer,
and up to 154 if every unassigned line goes to a subcontractor. There is
**no deduction field in PMS**.

An earlier pass in this file said 133 lines / SAR 111,134. That figure
could not be reproduced by any variant of the count and is withdrawn —
use the table above.

Five distinct survey item codes are involved, so the rule has to key on item
code, not on the word "survey" in a description:

```
8812363035  Site survey for TX Equipment, per site
8812363036  Site survey for TX expansion, per site
8812420869  Site survey for TX Equipment (11-20 nodes)
8812363006  Site Survey for indoor/outdoor MDU Site
8812363005  Site Survey for access product indoor/outdoor
8812397292  Site Survey Only
```

## What the client answered — and what it costs

> *"Its allocated for report preparation."*  — 22 Oct 2026

So **not INET revenue.** That rules out the cheap branch, where the 100
simply stays with INET and margin rises. It is money earmarked against a
cost, and a cost has to land somewhere.

This matters more than it looks, because the naive implementation moves
the margin the **wrong way**:

```
today in PMS     880 − (880 × 80%)             = 176   margin shown
deduction only   880 − ((880 − 100) × 80%)     = 256   margin APPEARS to rise
with the cost    880 − 624 − 100              = 156   margin actually falls
```

Deducting the 100 from the payout without booking it as a cost would
overstate INET's margin by **100 per line** — ~SAR 13,300 across the 133
lines — and the figure would look *better* than today's, which is the
opposite of the truth. A deduction field alone is therefore not a correct
build; the allocation has to be recorded as well.

## The shape to build

A `payout_deduction` currency field on **PO Dispatch**, **typed in per
line** — *not* defaulted from the Item. Decided 23 Oct 2026: a figure
somebody enters needs no list of which item codes qualify, no rule for
whether it scales with quantity, and no migration when the client adds a
seventh survey item. The amount entered *is* the amount deducted.

One change of base everywhere the payout is derived:

```
payout = (line_amount − payout_deduction) × pct
```

Survives re-rates, works before a PO exists, and keeps the order consistent
with its own percentage.

**The sweep that must go with it** — a feature is not finished when the
feature works (see CLAUDE.md). Each of these derives the payout and will keep
meaning the old thing until it is edited:

- `_expected_payout_sql`, `_payout_shown_sql`, `_vat_sql` — `subcon_po.py`
- the PO creation rate — `_po_item_pricing`
- `_target_rate` — `subcon_fixes.py`, or a correction re-introduces the error
- the allocation amount — `_write_allocations` in `subcon_reconcile.py`
- `subcon_payout_summary` and the PIC Overview payout table
- Commercial / PIC / Command dashboards, wherever INET-vs-Subcon is split

Then a backfill for the 133 existing lines.

## Questions out with the client

1. ~~**Is the SAR 100 INET's revenue, or allocated for report
   preparation?**~~ **Answered 22 Oct 2026: report preparation.** Not
   revenue. See above.
2. **Who actually receives it?** The answer settles what the 100 is *for*,
   not who is paid, and the two live readings build differently:
   - *INET prepares the report* → the 100 stays with INET but against an
     internal cost, so margin must not show the full 256
   - *another party prepares the report* → it leaves the company and needs
     its own payout line, a second supplier on the same POID
   **This is now the blocker.** Book the two the same way and the profit
   figure is wrong by 100 on every one of the 133 lines.

   A third reading — *withheld from the subcontractor until they hand the
   report in*, i.e. a retention rather than a deduction — was **ruled out
   by the user from knowledge of the business, not by the client**. Worth
   re-testing if the client's answer to (2) reads oddly, since it is an
   assumption and not a confirmation.
3. **Per line, or per report?** If one survey report covers several sites,
   taking 100 off every line over-deducts. Still open.
4. ~~**Off the line total, or per unit?**~~ **Dropped** — the field is
   typed in per line, so the person entering it decides the amount. (It
   was moot anyway: of 767 survey lines, not one has qty > 1.)
5. ~~**Which pay items?**~~ **Dropped** for the same reason: nothing keys
   off the item code, so the six-code list above is background, not
   configuration.

**Recount settled 23 Oct 2026** — 78 SUB lines, not 133. See the scope
table above; the old figure is withdrawn.
