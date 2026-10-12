// Shared visual language for the 3 PIC pages (Pending / PIC Tracker / Cancelled)
// so status columns render identically everywhere instead of each page
// inventing its own pill. Not a global /components file — this coloring is
// specific to PO Dispatch's dispatch_status / pic_status vocab.

export function StatusBadge({ value, bg, fg, bd }) {
  if (!value) return <span style={{ color: "#94a3b8" }}>—</span>;
  const b = bg || "#f1f5f9", f = fg || "#475569", border = bd || "#e2e8f0";
  return (
    <span style={{ display: "inline-block", padding: "2px 9px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: b, color: f, border: `1px solid ${border}` }}>
      {value}
    </span>
  );
}

// Same mapping as IMPOIntake.jsx's dispatchStatusColor — PO Dispatch's
// dispatch_status is the same field/vocab everywhere, so the color must match.
export function dispatchStatusColor(status) {
  const s = (status || "").toLowerCase().replace(/\s+/g, "-");
  const map = {
    "new": { bg: "#f1f5f9", fg: "#475569", bd: "#e2e8f0" },
    "pending": { bg: "#f1f5f9", fg: "#475569", bd: "#e2e8f0" },
    "dispatched": { bg: "#eff6ff", fg: "#1d4ed8", bd: "#bfdbfe" },
    "planned": { bg: "#f0f9ff", fg: "#0369a1", bd: "#bae6fd" },
    "in-execution": { bg: "#f0fdf4", fg: "#15803d", bd: "#bbf7d0" },
    "backend-assigned": { bg: "#faf5ff", fg: "#7c3aed", bd: "#ddd6fe" },
    "completed": { bg: "#ecfdf5", fg: "#047857", bd: "#a7f3d0" },
    "partially-submitted": { bg: "#fffbeb", fg: "#b45309", bd: "#fde68a" },
    "submitted": { bg: "#eef2ff", fg: "#4338ca", bd: "#c7d2fe" },
    "partially-closed": { bg: "#ecfeff", fg: "#0e7490", bd: "#a5f3fc" },
    "closed": { bg: "#f8fafc", fg: "#94a3b8", bd: "#e2e8f0" },
    "cancelled": { bg: "#fef2f2", fg: "#b91c1c", bd: "#fecaca" },
    "cancelled-(in-system)": { bg: "#fef2f2", fg: "#b91c1c", bd: "#fecaca" },
  };
  return map[s] || { bg: "#fefce8", fg: "#92400e", bd: "#fde68a" };
}

export function PoStatusBadge({ value }) {
  const c = dispatchStatusColor(value);
  return <StatusBadge value={value} bg={c.bg} fg={c.fg} bd={c.bd} />;
}

// One color rule for all 11 pic_status / pic_status_ms2 values — same regex
// logic PICTracker's local StatusPill used, now shared so Pending/Cancelled
// render identically instead of falling back to plain text.
export function picStatusColor(value) {
  const v = String(value || "");
  if (!v) return { bg: "#f1f5f9", fg: "#94a3b8", bd: "#e2e8f0" };
  if (/Closed|Submitted/i.test(v) && /Invoice/i.test(v)) return { bg: "#ecfdf5", fg: "#047857", bd: "#a7f3d0" };
  if (/Ready/i.test(v)) return { bg: "#eff6ff", fg: "#1d4ed8", bd: "#bfdbfe" };
  if (/Under I-BUY/i.test(v)) return { bg: "#f5f3ff", fg: "#6d28d9", bd: "#ddd6fe" };
  if (/Under ISDP/i.test(v)) return { bg: "#faf5ff", fg: "#7e22ce", bd: "#e9d5ff" };
  if (/Process|Apply/i.test(v)) return { bg: "#fffbeb", fg: "#b45309", bd: "#fde68a" };
  if (/PO Need to Cancel/i.test(v)) return { bg: "#fffbeb", fg: "#92400e", bd: "#fde68a" };
  if (/Rejected|Cancel/i.test(v)) return { bg: "#fef2f2", fg: "#b91c1c", bd: "#fecaca" };
  return { bg: "#f1f5f9", fg: "#475569", bd: "#e2e8f0" };
}

export function PicStatusBadge({ value }) {
  const c = picStatusColor(value || "Work Not Done");
  return <StatusBadge value={value || "Work Not Done"} bg={c.bg} fg={c.fg} bd={c.bd} />;
}

// ---------------------------------------------------------------------------
// MS2 on a line that has no MS2
//
// Most lines never had a second milestone. The PO's payment terms decide it:
// "AC1 (100.00%)" is one milestone, "AC1 (70%) / AC2 (30%)" is two. In
// production 19,544 of 22,340 lines (87.5%) are AC1 100%, and only three
// splits exist at all — 100/0, 70/30, 80/20.
//
// On those lines pic_status_ms2 is simply empty (18,838 of them; just 3 hold
// a stored "Work Not Done"), and PicStatusBadge prints "Work Not Done" for an
// empty value. So the column announced pending work on 87% of the book for a
// milestone that was never ordered. The client asked for "NIL" instead, and
// they are right — this is a property of the purchase order, not a stage
// anyone has to move.
//
// Derived, never stored: a PO revision can turn a 100/0 line into 70/30, and
// a status written into the field would go stale silently. Same reason the
// subcontractor is resolved rather than copied.
//
// ms2_pct, NOT ms2_amount: 199 genuine 70/30 and 80/20 lines are zero-value,
// so their MS2 amount is legitimately 0. Testing the amount would label a real
// milestone NIL.
//
// The ~704 no-MS2 lines that do carry a status are mirrors of MS1 (604 "PO
// Line Canceled", 99 "Commercial Invoice Closed"), written when PIC settled
// both milestones in one action. None holds a riyal of MS2 value, and the MS1
// column still shows the same word, so NIL loses nothing.

/** "NIL" when this line has no MS2, otherwise the status unchanged.
 *
 *  A missing/undefined ms2Pct means the caller's payload does not carry the
 *  field — fall through to normal rendering rather than mislabel 2,796 real
 *  MS2 lines as NIL on a page that simply wasn't wired up.
 */
export function picMs2Label(value, ms2Pct) {
  if (ms2Pct === undefined || ms2Pct === null || ms2Pct === "") return value;
  return Number(ms2Pct) > 0 ? value : "NIL";
}

export function PicMs2Badge({ value, ms2Pct }) {
  const label = picMs2Label(value, ms2Pct);
  if (label === "NIL") {
    // Deliberately the muted grey of "Closed"/"Not Ordered" — nothing is
    // outstanding here, so it must not compete with a live status.
    return <StatusBadge value="NIL" bg="#f8fafc" fg="#94a3b8" bd="#e2e8f0" />;
  }
  return <PicStatusBadge value={label} />;
}

// Subcon PO (supplier side) — PO Dispatch.sub_po_status_ms1 / sub_po_status_ms2,
// see SUB_PO_STATUSES in inet_app/api/subcon_po.py. Colors deliberately reuse
// the same hues picStatusColor above already assigns to the equivalent stage
// of the customer flow, so "submitted" and "closed" read the same on both
// sides of a POID instead of two unrelated palettes.
// Also covers the derived line-level rollup (SUB_PO_OVERALL_STATUSES) — the
// "Partially …" values share the hue of the stage they've partially reached,
// at the lighter amber/teal end, so a half-done line is visibly distinct from
// a finished one without being a whole new color.
export function subPoStatusColor(value) {
  const v = String(value || "");
  if (!v || /^Not Ordered$/i.test(v)) return { bg: "#f1f5f9", fg: "#94a3b8", bd: "#e2e8f0" };
  if (/^Partially Cancelled/i.test(v)) return { bg: "#fef2f2", fg: "#dc2626", bd: "#fecaca" };
  if (/^Partially Closed/i.test(v)) return { bg: "#f0fdfa", fg: "#0f766e", bd: "#99f6e4" };
  if (/^Partially Invoiced/i.test(v)) return { bg: "#faf5ff", fg: "#7e22ce", bd: "#e9d5ff" };
  if (/^Partially Ordered/i.test(v)) return { bg: "#eff6ff", fg: "#60a5fa", bd: "#dbeafe" };
  // Draft-PO shade, deliberately the same amber family as "PO Created" — a
  // draft has not gone to the supplier, so it must not look "ordered".
  if (/^Partially Created/i.test(v)) return { bg: "#fffbeb", fg: "#d97706", bd: "#fde68a" };
  // Sky, not the #eff6ff blue picStatusColor gives "Ready for Invoice" — that
  // exact blue is already "PO Submitted" below, and two states sharing one
  // colour in the same column is worse than not matching the sales side.
  if (/^Partially Ready/i.test(v)) return { bg: "#f0f9ff", fg: "#7dd3fc", bd: "#e0f2fe" };
  if (/^Ready to Order/i.test(v)) return { bg: "#f0f9ff", fg: "#0369a1", bd: "#bae6fd" };
  if (/^PO Created/i.test(v)) return { bg: "#fffbeb", fg: "#b45309", bd: "#fde68a" };
  if (/^PO Submitted/i.test(v)) return { bg: "#eff6ff", fg: "#1d4ed8", bd: "#bfdbfe" };
  if (/^Invoice Received/i.test(v)) return { bg: "#eef2ff", fg: "#4338ca", bd: "#c7d2fe" };
  if (/^Purchase Invoice Submitted/i.test(v)) return { bg: "#f5f3ff", fg: "#6d28d9", bd: "#ddd6fe" };
  if (/^Closed$/i.test(v)) return { bg: "#ecfdf5", fg: "#047857", bd: "#a7f3d0" };
  if (/Cancel/i.test(v)) return { bg: "#fef2f2", fg: "#b91c1c", bd: "#fecaca" };
  return { bg: "#f1f5f9", fg: "#475569", bd: "#e2e8f0" };
}

// Blank is a real state ("not ordered yet"), same convention as
// PicStatusBadge rendering blank as "Work Not Done".
export function SubPoStatusBadge({ value }) {
  const c = subPoStatusColor(value);
  return <StatusBadge value={value || "Not Ordered"} bg={c.bg} fg={c.fg} bd={c.bd} />;
}

export function IMStatusBadge({ value }) {
  if (!value) return <span style={{ color: "#94a3b8" }}>—</span>;
  const v = String(value);
  let bg, fg, bd;
  if (/Confirmation Done/i.test(v)) { bg = "#ecfdf5"; fg = "#047857"; bd = "#a7f3d0"; }
  else if (/PIC Rejected/i.test(v)) { bg = "#fef2f2"; fg = "#b91c1c"; bd = "#fecaca"; }
  else if (/Ready for Confirmation/i.test(v)) { bg = "#eff6ff"; fg = "#1d4ed8"; bd = "#bfdbfe"; }
  else { bg = "#f1f5f9"; fg = "#475569"; bd = "#e2e8f0"; }
  return <StatusBadge value={v} bg={bg} fg={fg} bd={bd} />;
}

// ---------------------------------------------------------------------------
// A line worked by more than one subcontractor
//
// Most lines have one. 20,430 of 20,439 on the production copy, in fact — so
// tables are NOT restructured for the handful that do. The cell keeps showing
// one name exactly as it always has, with a small marker when there is more,
// and the full breakdown lives in the row's View popup, which has the room.
//
// `rows` is PO Dispatch.subcontract_allocations: one entry per subcontractor,
// carrying that supplier's share of the quantity and value.

/** The single name a table cell should show — the largest share. */
export function primarySubcontractor(rows, fallback) {
  const list = Array.isArray(rows) ? rows.filter((r) => r && r.subcontractor) : [];
  if (!list.length) return fallback || "";
  return list.reduce(
    (best, r) => (Number(r.qty) > Number(best.qty) ? r : best), list[0],
  ).subcontractor;
}

/** Table cell: today's value, plus a muted marker when the line is split.
 *
 * The NAME is whatever the row already resolved — `fallback` — not the biggest
 * allocation. The column filter builds its options from that same SQL column,
 * and a cell that renders a different name than the filter offers is the
 * single most repeated bug on these tables. The marker carries the extra
 * information instead; the View popup carries the detail.
 */
export function SubcontractorCell({ rows, fallback }) {
  const list = Array.isArray(rows) ? rows.filter((r) => r && r.subcontractor) : [];
  const name = fallback || primarySubcontractor(list, fallback);
  if (!name) return <span style={{ color: "#94a3b8" }}>—</span>;
  const extra = list.length - 1;
  return (
    <span style={{ whiteSpace: "nowrap" }}>
      <span title={name}>{name}</span>
      {extra > 0 && (
        <span
          title={`${list.length} subcontractors worked this line — open View for the split`}
          style={{
            marginLeft: 5, padding: "0 5px", borderRadius: 999,
            background: "#f1f5f9", border: "1px solid #e2e8f0", color: "#475569",
            fontSize: "0.66rem", fontWeight: 700, verticalAlign: "middle",
          }}
        >
          +{extra}
        </span>
      )}
    </span>
  );
}

/** Popup breakdown: who did how much, and where their PO stands. */
export function SubcontractorSplitTable({ rows, rate, compact = false }) {
  const list = Array.isArray(rows) ? rows.filter((r) => r && r.subcontractor) : [];
  if (list.length < 2) return null;
  const pad = compact ? "4px 8px" : "6px 10px";
  const money = (v) => (v == null || v === "" ? "—"
    : Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const totalQty = list.reduce((s, r) => s + (Number(r.qty) || 0), 0);
  const totalAmt = list.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#475569", marginBottom: 6, letterSpacing: 0.4 }}>
        SUBCONTRACTORS ({list.length})
      </div>
      {/* overflowX, not hidden: five columns in a narrow popup clipped the
          milestone badges off the right-hand edge with no way to reach them. */}
      <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, overflowX: "auto", background: "#fff" }}>
        <table style={{ width: "100%", minWidth: 420, borderCollapse: "collapse", fontSize: "0.82rem" }}>
          <thead>
            <tr style={{ background: "#f8fafc", color: "#475569", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: 0.4 }}>
              <th style={{ textAlign: "left", padding: pad }}>Subcontractor</th>
              <th style={{ textAlign: "right", padding: pad }}>Qty</th>
              <th style={{ textAlign: "right", padding: pad }}>Amount</th>
              <th style={{ textAlign: "left", padding: pad }}>MS1</th>
              <th style={{ textAlign: "left", padding: pad }}>MS2</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r, i) => (
              <tr key={r.subcontractor} style={{ borderTop: i === 0 ? "none" : "1px solid #f1f5f9" }}>
                <td style={{ padding: pad, fontWeight: 600, color: "#0f172a", minWidth: 150 }}>
                  {r.subcontractor}
                </td>
                <td style={{ padding: pad, textAlign: "right", whiteSpace: "nowrap",
                             fontVariantNumeric: "tabular-nums" }}>
                  {Number(r.qty ?? 0)}
                </td>
                <td style={{ padding: pad, textAlign: "right", whiteSpace: "nowrap",
                             fontVariantNumeric: "tabular-nums" }}>
                  {money(r.amount)}
                </td>
                <td style={{ padding: pad, whiteSpace: "nowrap" }}><SubPoStatusBadge value={r.sub_po_status_ms1} /></td>
                <td style={{ padding: pad, whiteSpace: "nowrap" }}><SubPoStatusBadge value={r.sub_po_status_ms2} /></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: "#f8fafc", fontWeight: 700, borderTop: "1px solid #e2e8f0" }}>
              <td style={{ padding: pad }}>Total</td>
              <td style={{ padding: pad, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {Math.round(totalQty * 10000) / 10000}
              </td>
              <td style={{ padding: pad, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {money(totalAmt)}
              </td>
              <td /><td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/**
 * The two PIC statuses that mean "the IM has to fix something".
 * Mirrors `_PIC_REJECTED_STATUSES` in `api/pic.py`.
 */
export const PIC_REJECTED_STATUSES = ["I-BUY Rejected", "ISDP Rejected"];

export function isPicRejection(status) {
  return PIC_REJECTED_STATUSES.includes(String(status || "").trim());
}

/**
 * Where the reason lives for a milestone. MS1 has a dedicated field; MS2 has
 * no equivalent, so its general-purpose detail remark carries it — the same
 * split `reject_pic_line` uses.
 */
export function picRejectionReasonKey(milestone) {
  return String(milestone || "MS1").toUpperCase() === "MS2"
    ? "pic_detail_remark_ms2"
    : "pic_rejection_remark";
}

/**
 * The complaint to show when a rejection carries no reason, or null when
 * there is nothing to complain about. The server refuses these too; this
 * exists so the user is told before the round-trip.
 */
export function picRejectionReasonError(status, remark) {
  if (!isPicRejection(status)) return null;
  if (String(remark || "").trim()) return null;
  return `A reason is required to set ${String(status).trim()}. `
    + "The IM sees this as the correction to make.";
}
