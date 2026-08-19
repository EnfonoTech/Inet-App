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
