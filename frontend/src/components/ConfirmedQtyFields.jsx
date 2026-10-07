import { useEffect, useMemo, useState } from "react";
import { pmApi } from "../services/api";

/**
 * Confirmed-quantity block for the IM's submission modal.
 *
 * A POID ordered for 3 where only 2 turn out to be executable: the IM confirms
 * what was actually delivered at the moment they hand the line to PIC, which is
 * the last gate before invoicing and the first point at which anyone knows.
 *
 * The ordered quantity is shown beside the input rather than replaced by it —
 * "2 of 3" is the fact the business wants, and the backend keeps line_amount at
 * Huawei's figure for the same reason.
 *
 * What becomes of the leftover is NOT asked for here. At confirmation the IM
 * knows what was delivered; whether the rest is coming usually depends on the
 * customer and is only known later. The line is left with an undecided
 * remainder and the IM answers it from the follow-up queue when they can.
 *
 * Presentational only: the caller owns the state and does the submitting.
 */

/**
 * The three ends a leftover quantity can come to.
 *
 * `effect` is what actually changes in the system, written so the IM can pick
 * without having to know the data model. Only "to be invoiced" moves money:
 * it restores the line's full ordered value as the invoice base, because the
 * customer has agreed to pay for the part that was never delivered.
 */
// What "close the rest" means for a line, by the route that closed it first.
// _remainder_close enforces same-route-only, so this is a statement of fact,
// not a choice the user gets to make.
const REMAINDER_ROUTE_LABEL = {
  "Direct Close": "Direct Close",
  "Backend": "Backend assign",
  "Rollout Execution": "a new plan",
};

export function remainderActionFor(action, source) {
  // Returns the action unchanged unless it is the "close the rest" one.
  const route = REMAINDER_ROUTE_LABEL[(source || "").trim()];
  if (action.value !== "Pending \u2013 to be worked" || !route) return action;
  return { ...action, effect: `Opens ${route}. Can go to a different subcontractor.` };
}

export const REMAINING_ACTIONS = [
  {
    value: "Cancelled",
    label: "Cancel remaining",
    effect: "Line finished. Invoice stays at what was delivered.",
    billsFull: false,
  },
  {
    value: "Pending – to be worked",
    label: "Close remaining",
    // Filled in per row by remainderActionFor(): a line is closed again by the
    // route that closed it first, so naming that route is the useful part.
    effect: "Close the rest of this line.",
    billsFull: false,
    // A POID is closed again by the SAME route that closed it first
    // (_remainder_close and _require_no_shortcut_close both enforce that), so
    // this list is about which closing dialogs are finished — all three now
    // are. Rollout was held back until the planning side was exercised: a
    // remainder plan takes team rows like any other, so the leftover can be
    // split across suppliers again rather than going to one.
    routes: ["Direct Close", "Backend", "Rollout Execution"],
    // Which switch governs the form this opens, by route. Rollout planning is
    // the core track and has no switch — it is not something to turn off.
    feature: (source) => {
      const s = (source || "").trim();
      if (s === "Backend") return "enable_backend_assign";
      if (s === "Direct Close") return "enable_direct_close";
      return null;
    },
  },
  {
    value: "Pending – to be invoiced",
    // The remaining quantity joins what gets invoiced without anyone going
    // back to site. confirmed_qty still records what was really delivered —
    // only the billable base moves — so "delivered 0.5, billed 1" stays visible.
    label: "Add to confirmation",
    effect: "No more work. Invoice goes back to the full ordered amount.",
    billsFull: true,
  },
];

// Mirrors _QTY_EDITABLE_PIC_STATUSES in command_center.py. Once PIC has moved
// past these, a reduction would drive ms*_unbilled negative, so the backend
// refuses it and the UI must say so before the user types a number.
const QTY_EDITABLE_PIC_STATUSES = new Set(["", "Work Not Done", "Under Process to Apply"]);

export function qtyLockReason(picStatus, picStatusMs2, confirmedQty) {
  // Raising the quantity stays allowed once something is confirmed: that is
  // how a "still to be done" leftover gets closed out, and it happens after
  // PIC has normally moved past the editable statuses. Only a reduction is
  // locked, so the field is hidden only when there is a value to reduce.
  if (!(Number(confirmedQty) > 0)) return null;
  for (const [value, label] of [[picStatus, "MS1"], [picStatusMs2, "MS2"]]) {
    const v = (value || "").trim();
    if (v && !QTY_EDITABLE_PIC_STATUSES.has(v)) {
      return `${label} is at "${v}"`;
    }
  }
  return null;
}

/**
 * Small badge for a settled leftover: what was left and what was decided.
 *
 * Without it a short-confirmed line shows "1 ordered / 0.5 confirmed" and no
 * trace of what became of the other 0.5 — the decision existed only in the
 * database. `onClick` lets it be changed later, since the answer can.
 */
export function RemainderBadge({ remainingQty, action, onClick, fmt }) {
  const qty = Number(remainingQty) || 0;
  if (qty <= 0) return null;
  const chosen = REMAINING_ACTIONS.find((a) => a.value === action);
  const n = fmt ? fmt.format(qty) : qty;
  const tone = !chosen
    // Indigo for "undecided", matching the row tint. Amber is the dummy-PO
    // colour elsewhere on this table, so it cannot also mean this.
    ? { bg: "#e0e7ff", bd: "#c7d2fe", fg: "#4338ca", text: `${n} left` }
    : chosen.value === "Cancelled"
      ? { bg: "#fee2e2", bd: "#fecaca", fg: "#b91c1c", text: `${n} cancelled` }
      : chosen.billsFull
        ? { bg: "#d1fae5", bd: "#a7f3d0", fg: "#047857", text: `${n} billed` }
        : { bg: "#e0f2fe", bd: "#bae6fd", fg: "#0369a1", text: `${n} to plan` };
  return (
    <span
      onClick={onClick}
      title={chosen ? `${chosen.label} — ${chosen.effect}` : `${n} left over — click to decide`}
      style={{
        marginLeft: 6, padding: "1px 7px", borderRadius: 999,
        background: tone.bg, border: `1px solid ${tone.bd}`, color: tone.fg,
        fontSize: "0.66rem", fontWeight: 700, whiteSpace: "nowrap",
        cursor: onClick ? "pointer" : "default",
      }}
    >
      {tone.text}
    </span>
  );
}

const L = {
  fontSize: "0.78rem", fontWeight: 700, color: "#475569",
  textTransform: "uppercase", letterSpacing: "0.04em",
  display: "block", marginBottom: 4,
};
const INPUT = {
  padding: 8, width: "100%", border: "1px solid #e2e8f0",
  borderRadius: 6, fontSize: "0.9rem",
};

export default function ConfirmedQtyFields({
  orderedQty,
  qty,
  onQtyChange,
  rate,
  disabled = false,
  lockedReason = null,
  // When given, the component fetches who worked this line and — if more than
  // one subcontractor did — asks the IM to say how much each is credited with.
  // The sum of that grid IS the confirmed quantity, so `onQtyChange` still
  // drives everything downstream and callers that pass neither prop keep
  // today's single-input behaviour exactly.
  poDispatch = null,
  allocation = null,
  onAllocationChange = null,
}) {
  const ordered = Number(orderedQty) || 0;
  const entered = qty === "" || qty == null ? null : Number(qty);

  const [breakdown, setBreakdown] = useState(null);

  useEffect(() => {
    if (!poDispatch || !onAllocationChange) { setBreakdown(null); return; }
    let cancelled = false;
    pmApi.getDispatchSubcontractorBreakdown(poDispatch)
      .then((res) => { if (!cancelled) setBreakdown(res || null); })
      .catch(() => { if (!cancelled) setBreakdown(null); });
    return () => { cancelled = true; };
  }, [poDispatch, onAllocationChange]);

  // Only a line worked by more than one subcontractor needs the grid. One
  // supplier — the overwhelming majority — keeps the single box it has always
  // had, so the normal confirmation is unchanged keystroke for keystroke.
  const subRows = useMemo(() => {
    const rows = (breakdown?.rows || []).filter(
      (r) => Number(r.assigned) > 0 || Number(r.closed) > 0,
    );
    return rows.length > 1 ? rows : [];
  }, [breakdown]);

  const splitMode = subRows.length > 1;

  // What the team leads reported across the split, for the variance note. Not
  // a limit on anything — the IM's confirmation is the payable figure.
  const achievedTotal = useMemo(
    () => Math.round(subRows.reduce((s, r) => s + (Number(r.achieved) || 0), 0) * 10000) / 10000,
    [subRows],
  );

  // Seed the grid from what the IM assigned at planning, once, when the rows
  // first arrive.
  //
  // A supplier already settled by an earlier closure is seeded at that closed
  // figure PLUS whatever this visit assigns them. Seeding at the closed figure
  // alone — and freezing the row — meant a line part-closed at 23 could never
  // record the remaining 7: both rows sat locked at what they had already been
  // paid, and the total could not move. What is settled is a FLOOR, not the
  // answer: the ledger writes each leg as the delta over what it already
  // holds, so raising a row adds a closure rather than rewriting one.
  useEffect(() => {
    if (!splitMode || !onAllocationChange) return;
    if (allocation && allocation.length) return;
    onAllocationChange(subRows.map((r) => ({
      subcontractor: r.subcontractor || "",
      qty: (Number(r.closed) || 0) + (Number(r.assigned) || 0),
    })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [splitMode, subRows]);

  // The grid drives the confirmed quantity, never the other way round.
  const allocTotal = useMemo(
    () => (allocation || []).reduce((s, r) => s + (Number(r.qty) || 0), 0),
    [allocation],
  );
  useEffect(() => {
    if (!splitMode) return;
    const rounded = Math.round(allocTotal * 10000) / 10000;
    if (Number(qty) !== rounded) onQtyChange(String(rounded));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [splitMode, allocTotal]);

  const allocTotalRounded = Math.round(allocTotal * 10000) / 10000;
  const assignedTotal = useMemo(
    () => Math.round(subRows.reduce((s, r) => s + (Number(r.assigned) || 0), 0) * 10000) / 10000,
    [subRows],
  );

  // One badge that says whether the split is ready to submit, so the IM is
  // not left comparing two numbers by eye. Short is legitimate — the leftover
  // goes to the remaining-qty decision — so it reads amber, not red; only
  // exceeding the PO is an error.
  const allocTone = useMemo(() => {
    if (!splitMode) return {};
    if (ordered > 0 && allocTotalRounded > ordered + 0.00005) {
      const over = Math.round((allocTotalRounded - ordered) * 10000) / 10000;
      return {
        bg: "#fef2f2", fg: "#b91c1c", bd: "#fecaca", label: `${over} over the PO`,
        hint: `The PO only carries ${ordered}. Reduce the split by ${over}.`,
      };
    }
    if (ordered > 0 && allocTotalRounded < ordered - 0.00005) {
      const left = Math.round((ordered - allocTotalRounded) * 10000) / 10000;
      return {
        bg: "#fffbeb", fg: "#b45309", bd: "#fde68a", label: `${left} left over`,
        hint: `${left} of ${ordered} not allocated — decide what happens to it from Work Done.`,
      };
    }
    return { bg: "#ecfdf5", fg: "#047857", bd: "#a7f3d0", label: "Fully allocated", hint: null };
  }, [splitMode, ordered, allocTotalRounded]);

  function setLegQty(sub, value) {
    if (!onAllocationChange) return;
    onAllocationChange((allocation || []).map((r) =>
      r.subcontractor === sub ? { ...r, qty: value === "" ? "" : Number(value) } : r));
  }

  const { isShort, remaining, amount, error } = useMemo(() => {
    if (entered == null || Number.isNaN(entered)) {
      return { isShort: false, remaining: 0, amount: null, error: null };
    }
    if (entered <= 0) {
      return { isShort: false, remaining: 0, amount: null, error: "Must be greater than zero." };
    }
    if (ordered > 0 && entered > ordered + 0.00005) {
      return {
        isShort: false, remaining: 0, amount: null,
        error: `The PO only carries ${ordered}. Confirm at most that.`,
      };
    }
    const r = Number(rate) || 0;
    return {
      isShort: ordered > 0 && entered < ordered - 0.00005,
      remaining: Math.round((ordered - entered) * 10000) / 10000,
      amount: r ? Math.round(r * entered * 100) / 100 : null,
      error: null,
    };
  }, [entered, ordered, rate]);

  // Locked once PIC has started: the field is hidden outright rather than
  // shown with an explanation nobody needs at that point.
  if (lockedReason) return null;

  return (
    <div style={{
      marginBottom: 14, padding: "12px 14px", background: "#f8fafc",
      border: "1px solid #e2e8f0", borderRadius: 8,
    }}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <div style={{ flex: "0 0 96px" }}>
          <label style={L}>Ordered</label>
          <div style={{
            padding: 8, borderRadius: 6, background: "#eef2ff", color: "#3730a3",
            fontWeight: 700, fontSize: "0.9rem", textAlign: "center",
          }}>
            {ordered || "—"}
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <label style={L}>Confirmed Qty</label>
          <input
            type="number"
            min="0"
            step="any"
            value={qty ?? ""}
            disabled={disabled || splitMode}
            readOnly={splitMode}
            onChange={(e) => onQtyChange(e.target.value)}
            style={{
              ...INPUT,
              borderColor: error ? "#fca5a5" : "#e2e8f0",
              background: splitMode ? "#f1f5f9" : undefined,
              fontWeight: splitMode ? 700 : undefined,
            }}
            placeholder={ordered ? String(ordered) : "Qty delivered"}
            title={splitMode ? "Set by the split below" : undefined}
          />
        </div>
      </div>

      {splitMode && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <label style={{ ...L, marginBottom: 0 }}>Split by subcontractor</label>
            <span style={{
              fontSize: "0.7rem", fontWeight: 700, padding: "2px 8px", borderRadius: 999,
              background: allocTone.bg, color: allocTone.fg, border: `1px solid ${allocTone.bd}`,
              whiteSpace: "nowrap",
            }}>
              {allocTone.label}
            </span>
          </div>
          <div style={{ fontSize: "0.76rem", color: "#64748b", margin: "6px 0 8px" }}>
            What each subcontractor is paid on.
          </div>

          <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden", background: "#fff" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem", tableLayout: "fixed" }}>
              <colgroup>
                <col /><col style={{ width: "22%" }} />
                <col style={{ width: 74 }} /><col style={{ width: 74 }} /><col style={{ width: 96 }} />
              </colgroup>
              <thead>
                <tr style={{ background: "#f8fafc", color: "#475569", fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: 0.4 }}>
                  <th style={{ textAlign: "left", padding: "6px 10px" }}>Subcontractor</th>
                  <th style={{ textAlign: "left", padding: "6px 8px" }}>Team</th>
                  <th style={{ textAlign: "right", padding: "6px 8px" }} title="What the IM assigned at planning">Assigned</th>
                  <th style={{ textAlign: "right", padding: "6px 8px" }} title="What the team leads reported">Achieved</th>
                  <th style={{ textAlign: "right", padding: "6px 10px" }}>Confirm</th>
                </tr>
              </thead>
              <tbody>
                {subRows.map((r, i) => {
                  const sub = r.subcontractor || "";
                  const leg = (allocation || []).find((a) => a.subcontractor === sub);
                  // Settled quantity is a FLOOR, not a freeze: it cannot be
                  // taken back, but more can be added on a later visit.
                  const settled = Number(r.closed) || 0;
                  const belowFloor = settled > 0
                    && Number(leg?.qty ?? 0) < settled - 0.00005;
                  const assigned = Number(r.assigned) || 0;
                  const achieved = Number(r.achieved) || 0;
                  // Achieved is the TLs' number and never the payout basis, so
                  // it is only called out when it disagrees with what the IM
                  // assigned — that gap is the thing worth a second look.
                  const variance = achieved > 0 && Math.abs(achieved - assigned) > 0.00005;
                  return (
                    <tr key={sub || "(none)"} style={{
                      borderTop: i === 0 ? "none" : "1px solid #f1f5f9",
                      background: settled > 0 ? "#f8fafc" : undefined,
                    }}>
                      <td style={{ padding: "6px 10px", fontWeight: 600, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={sub}>
                        {sub || <em style={{ color: "#94a3b8", fontWeight: 400 }}>No subcontractor</em>}
                        {settled > 0 && (
                          <span style={{ marginLeft: 6, fontSize: "0.64rem", fontWeight: 700,
                                         color: belowFloor ? "#b91c1c" : "#64748b" }}
                                title={`${settled} already closed — cannot go below it`}>
                            {settled} CLOSED
                          </span>
                        )}
                      </td>
                      <td style={{ padding: "6px 8px", color: "#64748b", fontSize: "0.76rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.teams || ""}>
                        {r.teams || "—"}
                      </td>
                      <td style={{ padding: "6px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#475569" }}>
                        {assigned || "—"}
                      </td>
                      <td
                        style={{
                          padding: "6px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums",
                          color: variance ? "#b45309" : "#94a3b8", fontWeight: variance ? 700 : 400,
                        }}
                        title={variance ? `Team leads reported ${achieved}, the IM assigned ${assigned}` : undefined}
                      >
                        {achieved || "—"}
                      </td>
                      <td style={{ padding: "4px 10px", textAlign: "right" }}>
                        <input
                          type="number" min={settled || 0} step="any"
                          value={leg?.qty ?? ""}
                          disabled={disabled}
                          onChange={(e) => setLegQty(sub, e.target.value)}
                          style={{
                            width: "100%", padding: "5px 7px", textAlign: "right",
                            border: "1px solid #e2e8f0", borderRadius: 6, fontSize: "0.84rem",
                            fontVariantNumeric: "tabular-nums",
                            background: "#fff",
                            borderColor: belowFloor ? "#fca5a5" : "#e2e8f0",
                          }}
                          title={settled > 0
                            ? `${settled} is already closed and cannot be reduced`
                            : undefined}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: "#f8fafc", borderTop: "1px solid #e2e8f0" }}>
                  <td style={{ padding: "7px 10px", fontWeight: 700, color: "#0f172a" }}>Total</td>
                  <td />
                  <td style={{ padding: "7px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#64748b" }}>
                    {assignedTotal || "—"}
                  </td>
                  <td />
                  <td style={{ padding: "7px 10px", textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: allocTone.fg }}>
                    {allocTotalRounded}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {allocTone.hint && (
            <div style={{ marginTop: 6, fontSize: "0.76rem", color: allocTone.fg }}>{allocTone.hint}</div>
          )}

          {/* A note, never a block. The confirmed quantity is the IM's
              decision and is not validated against what the teams reported —
              they may confirm less (a short delivery) or more (work the TLs
              under-reported). Saying so beats silently differing. */}
          {achievedTotal > 0 && Math.abs(allocTotal - achievedTotal) > 0.00005 && (
            <div style={{ marginTop: 6, fontSize: "0.76rem", color: "#64748b" }}>
              Teams reported <strong>{achievedTotal}</strong>
              {allocTotal > achievedTotal ? " — confirming more." : " — confirming less."}
            </div>
          )}
        </div>
      )}

      {error && (
        <div style={{ marginTop: 8, color: "#b91c1c", fontSize: "0.8rem" }}>{error}</div>
      )}

      {!error && amount != null && (
        <div style={{ marginTop: 8, fontSize: "0.8rem", color: "#475569" }}>
          Invoiceable value <strong>SAR {amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
          {isShort && <span> · <strong>{remaining}</strong> left over</span>}
        </div>
      )}

      {isShort && !error && (
        <div style={{ marginTop: 8, fontSize: "0.78rem", color: "#92400e" }}>
          {remaining} left over — decide later from Work Done.
        </div>
      )}
    </div>
  );
}
