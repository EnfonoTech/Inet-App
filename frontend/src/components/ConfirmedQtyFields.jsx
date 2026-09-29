import { useMemo } from "react";

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
export const REMAINING_ACTIONS = [
  {
    value: "Cancelled",
    label: "Cancel remaining",
    effect: "Line finished. Invoice stays at what was delivered.",
    billsFull: false,
  },
  {
    value: "Pending – to be worked",
    label: "Plan remaining",
    effect: "Line stays open for another visit. Confirm again when it is done.",
    billsFull: false,
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
    ? { bg: "#fef3c7", bd: "#fcd34d", fg: "#92400e", text: `${n} left` }
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
}) {
  const ordered = Number(orderedQty) || 0;
  const entered = qty === "" || qty == null ? null : Number(qty);

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
            disabled={disabled}
            onChange={(e) => onQtyChange(e.target.value)}
            style={{ ...INPUT, borderColor: error ? "#fca5a5" : "#e2e8f0" }}
            placeholder={ordered ? String(ordered) : "Qty delivered"}
          />
        </div>
      </div>

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
