# Payout deduction

**Status:** built 27 Oct 2026, all five phases. Tested on `inet` (feature
site) and against production figures on `inet_backup`. Client questions
settled 26 Oct 2026.

## The need

Some lines pay out less than the line value because part of the work is done
by someone other than the subcontractor. The first case is survey report
preparation:

```
line 880, payout 80%
PMS before             880 × 80%            = 704
what the client pays   (880 − 100) × 80%    = 624
```

The client confirmed two cases (26 Oct 2026):

1. **Report preparation is outsourced.** SAR 100 is paid to another party.
2. **INET prepares the report itself.** The SAR 100 does not go out.

In both cases the subcontractor is paid on 780. The only difference is whether
the 100 leaves the company:

| | subcontractor | the 100 | INET margin |
|---|---|---|---|
| outsourced — **Paid Out** | 624 | paid to the preparer | 880 − 624 − 100 = **156** |
| INET prepares — **Retained** | 624 | stays with INET | 880 − 624 = **256** |

Until now they corrected this by editing the payout on the PO by hand. That
does not hold: a later rate correction (`_fix_order`) puts it back, it cannot
be done before a PO exists, and the PO then contradicts its own payout %.

## Principles

- **General, not survey-specific.** "Report Preparation" is the first
  *deduction type*. A penalty, a material recovery, a tool charge — each is a
  new row in a master, not new code. Nothing keys off item codes or the word
  "survey".
- **Any milestone.** A deduction follows the line's MS1/MS2 split unless it is
  pinned to one milestone.
- **Any quantity.** A deduction is spread over the line's quantity the same
  way the line amount is, so a PO for part of the quantity takes its part.
- **Per line or per report — both.** Entered per line; a report covering
  several lines is entered once across the selected lines and split.
- **Small.** It is a rare case. PIC enters it. No approval, no PO, no backfill.
- **Every report reads one definition.**

## Why a child table on the line, not its own document

Every report already starts from the line. With the deductions on the line,
every report reads them through the same helper, and there is no document
status to filter. A separate document (draft / cancelled / approved) would
need each report to filter its status correctly — one more place for the
figures to drift apart, for a case that does not need a lifecycle.

## The rule that keeps every report consistent

**A deduction can be added, edited or removed only while the milestones it
falls on are unordered** (`sub_po_status_ms{n}` blank or Ready to Order).

A supplier PO raised afterwards carries the deduction, so the PO, its stamped
amount, the payout column and the margin all say the same thing. Once a
milestone is ordered, its deductions are locked, and the form and popup say
why. The two POIDs from the original report (`1011HG3692387-264-1-1`, `-265`)
are already Closed, so they are locked — they were settled by hand.

## Data

### `Deduction Type` — master

| field | |
|---|---|
| `deduction_type` | name, e.g. *Report Preparation* |
| `deduct_from` | **Line Value** — comes off the line value, then the % applies: (880 − 100) × 80%. **Payout** — comes off the payout itself: a SAR 500 penalty is 500. |
| `default_amount` | optional; pre-fills the entry form |
| `default_settlement` | optional; pre-fills the entry form |
| `expense_item` | Link, Item, optional — used on the Paid Out purchase invoice. If it is blank, Raise Invoice says so instead of failing. |
| `enabled` | |

Only `deduction_type` and `deduct_from` are mandatory. On the **Masters** page
(it opens Desk to create and edit, like every other master there).

**Shipped, so every site has it after `migrate`** — the fixture is meant for
the first production update only and is to be removed from `hooks.py` after
it (decided 27 Oct 2026), so later edits on the site stick:

| record | how |
|---|---|
| **Deduction Type** `Report Preparation` — Line Value, 100, Retained, expense item → `Report Preparation` | fixture, `fixtures/deduction_type.json` (hooks.py, filtered by name) |
| **Item** `Report Preparation` — non-stock, purchase item, `Services`, `Nos` | `setup._ensure_report_preparation_item`, run from `after_migrate`: created when missing, never touched after |

The Item is deliberately not a fixture. Frappe loads a fixture by deleting
the record and inserting it again on every `migrate`; an ERPNext Item behind
real purchase invoices must not go through that, and its accounts and
defaults set on the site would be lost each time.

The fixture side of that applies to the Deduction Type: **an edit to Report
Preparation on a site (say 100 → 120) is reverted at the next migrate.**
Change it in `fixtures/deduction_type.json` instead. Other deduction types
created on a site are not fixtures and are never touched.

### `PO Payout Deduction` — child table `payout_deductions` on PO Dispatch

| field | |
|---|---|
| `deduction_type` | Link, Deduction Type |
| `deduct_from` | copied from the type when the row is written, so editing the type later does not rewrite history |
| `amount` | Currency |
| `settlement` | **Retained** / **Paid Out** — the client's two cases |
| `payee` | Link, Supplier — required when Paid Out |
| `subcontractor` | Link, Subcontract Master — optional. Blank = shared across the line's subcontractors by allocation share |
| `milestone` | blank (spread by the MS1/MS2 amounts) / MS1 / MS2 |
| `purchase_invoice` | Link, Purchase Invoice — set by Raise Invoice |
| `remark` | Small Text |
| `added_by`, `added_on` | stored, because Frappe stamps child rows with the parent's `creation` |

Rows are written through `api/payout_deduction.py`, never by saving the whole
PO Dispatch, so the line's own save hooks do not run. Each write bumps the
line's `modified`, because the dashboards cache on an etag built from
`MAX(modified)` (`_dashboard_etag`) and a child row alone would leave them
serving the old figures.

Limits enforced on entry: the amount must be above zero and no more than the
line value; a **Payout**-basis amount no more than the line's payout. The
second is what lets reports that slice a line by invoiced amount subtract
deductions linearly and still agree with the Subcon PO page to the cent.

## One definition

`subcontractor_sync.py`, beside `ALLOC_SHARE_SQL`:

| helper | used for |
|---|---|
| `deduction_sql(n, kind, …)` | milestone *n*'s deduction of a kind — `line`, `payout`, `paid`, `all` — for one supplier leg |
| `net_payout_sql(...)` | `(amount − line-value deductions) × % − payout deductions`, never below zero |
| `payout_reduction_sql(pct, n, fraction, …)` | how much less the subcontractor is paid, over a slice of a line (an invoiced amount, a Work Done's revenue) |
| `paid_out_sql(n, fraction, …)` | money Paid Out to third parties over the same slice |

A correlated lookup on `parent` (indexed on every child table), so it drops
into any existing FROM. With no deduction rows each is an empty index probe
and every figure is exactly what it was. Measured on `inet_backup` with no
rows: Subcon PO *All* 1.45 s → 1.64 s, payout summary 2.08 s → 2.34 s.

```
payout = (allocated amount − line-value deductions) × payout % − payout deductions
margin = amount × margin % + (gross payout − payout) − Paid Out deductions
```

### Readers — updated

| where | how |
|---|---|
| `_expected_payout_sql`, `_inet_amount_sql` (`subcon_po.py`) | net payout; margin gains the reduction and loses Paid Out. `_payout_shown_sql`, `_vat_sql`, `subcon_payout_events_sql`, `subcon_payout_summary` and the PIC Overview payout table follow from these |
| Subcon PO list | new `gross_payout_ms{n}`, `deduction_amount`, `payout_deductions`; Deduction column filter |
| `_po_item_pricing` | PO keeps the agreed rate as `price_list_rate`; the per-unit deduction is the item's discount; description gains "Less: <type>" |
| `_target_rate` / `_fix_order` / `_fix_draft_invoice` (`subcon_fixes.py`) | a re-rate keeps the discount instead of paying it back |
| `pic_invoicing_summary`, PIC dashboard INET/Subcon split (`pic.py`) — also feeds the Commercial dashboard's split | scaled by the invoiced part of each milestone. These divide **invoiced value** between kept and outgoing, so Paid Out moves to the outgoing side and the two still sum to what was invoiced |
| Commercial dashboard per-subcontractor table | payout and margin, as on the Subcon PO page |
| Command dashboard Sub-Con expense / margin | via `subcon_payout_events_sql` |
| IM Performance payout, Top Teams subcon payout, Revenue Tracking sub-con expense | scaled by Work Done revenue ÷ line value; Paid Out counts as money out for the work |
| Command dashboard **Cost / Profit** | new `deduction_paid_out` in `total_cost_today`: Paid Out on subcontracted work (via `subcon_payout_events_sql.paid_out`, dated with its payout) + on INET-crew work (dated by the Work Done, like INET revenue). Without it Profit/Loss was overstated by every Paid Out amount. Financial dashboard shows it as its own cost slice |
| Search / overview → Subcon | net payout per supplier leg |

### Readers — deliberately left

- `_write_allocations` (`subcon_reconcile.py`): the allocation `amount` is the
  leg's share of the line value, not a payout. Deductions apply downstream.
- `pic.py` line-level payout % display: a percentage, not money.
- Command dashboard `total_achieved`: INET's retained REVENUE, not profit —
  a third party's cost on an INET-crew line belongs in cost, where it is.

## The third-party invoice carries the POID — but is marked

The Paid Out bill's items carry the line's **`poid`**. It is the POID
accounting dimension, so the expense reaches the General Ledger against the
line (verified: each item's Cost of Goods Sold entry carries its POID).

Every subcontractor flow reads Purchase Invoice Items by `poid`, though, and
would take the third party's bill for the subcontractor's. So the items are
also marked with **`payout_deduction`** (the row), and every such reader
excludes the mark — `not_deduction_bill_sql` in `subcon_po.py`:

| reader | without the guard |
|---|---|
| Subcon PO bill column + its filter, popup Purchase Invoices | the third party's bill listed as the subcontractor's |
| `_posted_blocker` (`subcon_fixes.py`) | re-rating the subcontractor's PO refused because of it |
| `restamp_subcontract_dimension` | the subcontractor stamped onto the third party's line |
| `_purchase_doc_lines`, payment-entry handling | (already safe — they need MS1/MS2, which these items never carry; checked anyway) |

Verified on `inet`: submitting the bill left the subcontractor's status at Not
Ordered. Readers keyed on `purchase_order` never see it — the bill has none.

The first build used a separate `deduction_poid` field instead; it existed
only on the two test sites and `setup._retire_deduction_poid_field` moved its
values into `poid` and dropped it.

A deleted draft unlinks from its row (`on_trash` hook); a cancelled one can
be raised again.

## UI

### Subcon PO toolbar: **Add Deduction (N)**

On every tab, enabled when lines are selected. The form:

- **Type** pre-fills amount and settlement, so the common case is select
  lines → Add Deduction → Add.
- **Settlement** Retained / Paid Out, each with a one-line explanation;
  Paid Out asks for the supplier (search).
- **Amount** — the same on each line, or **split a total** equally across
  the lines that can take it (a 300 report fee over three sites, one already
  ordered, is 150 on each of the other two). Each share is editable in the
  preview.
- **More options**: milestone (Auto / MS1 / MS2), remark.
- **Preview**, live: per line, deduction and payout before → after, margin
  after; overall deduction, payout change, margin change. Computed by writing
  the rows inside a savepoint, reading them through the report helpers and
  rolling back — so it cannot disagree with any report. Lines that cannot
  take it are listed with the reason and skipped.

### View popup: **Payout Deductions** section

Line payout before → after and margin, then one row per deduction with its
type, amount, settlement, payee, basis, milestone, invoice and who added it.
Buttons: **Raise Invoice** (Paid Out, draft to the payee), **Edit**,
**Remove** (also deletes a draft invoice), confirmed in the app's own dialog
(`components/ConfirmDialog.jsx` — `useConfirm()`, one provider in `App.jsx`,
for any page that needs one). Locked rows say why.

### Table

- **Deductions** column, shown by default: the amount plus a state pill —
  **Invoice Due** (a Paid Out deduction has no live invoice), **Invoiced**,
  or **Retained** (nothing to invoice). Its Excel filter offers those states,
  so "which lines still owe an invoice" is one filter. Footer total.
- A small amber `−80.00` beside a reduced payout; hover names the type and
  the figure before deductions.

### Raising the Paid Out invoices from the list

Toolbar **Raise Deduction Invoice (N)** — N is the selected lines that say
Invoice Due. It shows each payee with its line count and amount, then raises
**one draft Purchase Invoice per payee, one item per deduction**, so a report
preparer paid for ten sites gets one bill with ten lines. A cancelled invoice
counts as none, so the line becomes Invoice Due again. The popup's Raise
Invoice button does the same for a single row. Both read one expression
(`_INVOICE_DUE_SQL`), as do the column and its filter.

## Phases

1. ✅ Master, child table, helper, Subcon PO entry UI.
2. ✅ Readers sweep — tables above.
3. ✅ Supplier PO discount, and the re-rate tools keeping it.
4. ✅ Raise Invoice, with the `poid`-free invoice item.
5. ✅ **INET-crew lines.** Entry: a **Deductions** chip in the PIC Tracker's
   line form (these lines never appear on Subcon PO). Only **Paid Out** off
   the **Line Value** applies — there is no payout to retain from; the form
   offers nothing else and the backend refuses it. The cost reaches the
   Command dashboard, IM Performance, Top Teams, Revenue Tracking and the PIC
   split.

## Verification (inet_backup, 27 Oct 2026)

Lines `SYS-2026-14098` (70/30, 80%) and `SYS-2026-14133` (70/30, 90%):

1. Retained 100 spread → payout 880.80 → 800.80, margin 220.20 → 300.20.
2. Paid Out 50 pinned to MS2 → MS2 payout (460.80 − 50) × 90% = 369.72;
   MS2 margin +45 − 50.
3. Payout-basis 20 on MS1 → MS1 payout 967.68 → 947.68.
4. Subcon PO totals fell by exactly 76 (MS1) and 69 (MS2).
5. PO for MS1 (2.1 units): agreed rate 293.60, discount 26.67, net 266.93,
   "Less: Report Preparation"; stamped 560.55 against an expected 560.56 —
   2-decimal rates cannot hit a 2.1-unit figure exactly.
6. Paid Out invoice: no `poid`, no milestone; `_purchase_doc_lines` returns
   nothing for it.
7. Every report above moved by the hand-computed amount; the INET/Subcon
   split's grand total did not move.
8. Closed lines refused with the reason; a split total re-divides across the
   eligible lines.
9. All eight endpoints whitelisted; exercised over HTTP with a real session.
10. `schema_check` — no new findings.
