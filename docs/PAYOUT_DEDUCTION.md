# Payout deduction — parked, waiting on the client

**Status:** not built. Three questions are out with the client (bottom of this
file). Raised 20 Oct 2026 from a report on two POIDs; the findings below are
measured on `inet_backup`, a production copy.

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

| | |
|---|---|
| Survey lines on SUB contracts | **133** |
| Their line value | SAR 111,134 |
| Payout overstated by | ~100 × pct per line, roughly SAR 10,600 |
| Deduction field in PMS today | **none** |

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

## The shape to build

A `payout_deduction` currency field on **PO Dispatch**, defaulted from the
Item, and one change of base everywhere the payout is derived:

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

1. **Is the SAR 100 INET's revenue, or is it allocated for report
   preparation?** Revenue → it simply stays with INET and margin rises,
   nothing more to build. Report preparation → it is a cost owed to
   somebody and has to land somewhere as a cost, not just vanish from the
   subcontractor's payout. **This decides the model and is why nothing has
   been built.**
2. **Per line, or per report?** If one survey report covers several sites,
   taking 100 off every line over-deducts.
3. **Which pay items?** They said "some cases". Confirm the item codes
   against the six above.
