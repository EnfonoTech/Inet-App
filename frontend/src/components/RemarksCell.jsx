import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { pmApi } from "../services/api";
import { useAuth } from "../context/AuthContext";

/**
 * Inline pill row that fits as many remarks as possible into the cell
 * width, then shows a "+N" counter for the rest. Implementation:
 *   1. Render all pills with the counter at the end, all visible.
 *   2. After layout, if we're overflowing the container, decrement
 *      visibleCount and re-measure. Repeat until no overflow.
 *   3. Reset to "all" on container resize so widening the column
 *      reveals more.
 */
function AdaptivePillRow({ lines, dot }) {
  const wrapRef = useRef(null);
  const [visibleCount, setVisibleCount] = useState(lines.length);

  // After every render, check if we still overflow; shrink one pill if so.
  useLayoutEffect(() => {
    if (!wrapRef.current) return;
    const el = wrapRef.current;
    if (el.scrollWidth > el.clientWidth + 1 && visibleCount > 1) {
      setVisibleCount((c) => Math.max(1, c - 1));
    }
  }, [visibleCount, lines]);

  // On column-width change, optimistically reset to all and let the
  // shrink loop run again.
  useEffect(() => {
    if (!wrapRef.current) return;
    let raf = null;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setVisibleCount(lines.length));
    });
    ro.observe(wrapRef.current);
    return () => { ro.disconnect(); cancelAnimationFrame(raf); };
  }, [lines.length]);

  const visible = lines.slice(0, visibleCount);
  const overflow = lines.length - visibleCount;

  return (
    <span
      ref={wrapRef}
      style={{
        display: "flex", alignItems: "center", gap: 6,
        flex: 1, minWidth: 0,
        overflow: "hidden", whiteSpace: "nowrap",
      }}
    >
      {visible.map((ln, i) => (
        <span
          key={i}
          style={{
            flexShrink: 0,
            display: "inline-block",
            padding: "1px 8px", borderRadius: 999,
            background: "#fff", border: "1px solid #e2e8f0",
            fontSize: "0.74rem",
            maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {ln}
        </span>
      ))}
      {overflow > 0 && (
        <span style={{
          flexShrink: 0, fontSize: "0.7rem", fontWeight: 700,
          padding: "1px 7px", borderRadius: 999,
          background: dot + "20", color: dot,
          border: `1px solid ${dot}40`,
        }}>
          +{overflow}
        </span>
      )}
    </span>
  );
}

/**
 * Edit rules — kept in sync with the backend `update_po_remark`:
 *   general:   PM only
 *   manager:   PM + IM
 *   team_lead: PM + IM + Field
 * If the current user can't edit, the cell becomes non-clickable.
 */
function canEditRemark(role, tone) {
  const r = String(role || "").toLowerCase();
  const isPm = r === "admin" || r === "pm";
  const isIm = r === "im";
  const isField = r === "field";
  if (tone === "general") return isPm;
  if (tone === "manager") return isPm || isIm;
  if (tone === "team_lead") return isPm || isIm || isField;
  return false;
}

/**
 * Compact, hoverable, click-to-edit cell for one of the three remark fields.
 *
 * Read mode: truncated text with hover tooltip (full text), or `—` when empty.
 * Click → centered modal with a textarea so editing isn't clipped by table
 * edges or scroll containers. Permissions are enforced server-side: a save
 * to a field the role can't write returns a clear error.
 *
 * Props:
 *   value      — current value
 *   tone       — "general" | "manager" | "team_lead"  → accent + remark_type
 *   poDispatch — PO Dispatch name (or business POID); required to save
 *   onSaved    — optional callback (newValue) after a successful save
 */
const TONES = {
  general:   { dot: "#64748b", label: "General"   },
  manager:   { dot: "#3b82f6", label: "Manager"   },
  team_lead: { dot: "#10b981", label: "Team Lead" },
};

export default function RemarksCell({ value, tone = "general", poDispatch, poid, onSaved }) {
  const { role } = useAuth();
  const editable = canEditRemark(role, tone);
  const clickable = editable && !!poDispatch;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const textareaRef = useRef(null);

  useEffect(() => { setDraft(value || ""); }, [value]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape" && !busy) setOpen(false); };
    document.addEventListener("keydown", onKey);
    setTimeout(() => textareaRef.current?.focus(), 0);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy]);

  const text = (value || "").toString().trim();
  const t = TONES[tone] || TONES.general;
  const remarkType = tone;
  // Multiple remarks (TL flow) are stored newline-separated. The
  // single-row list cell shows the first one + a "+N" counter; the
  // edit modal expands them into a chip list.
  const lines = text
    ? text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
    : [];

  async function doSave() {
    if (!poDispatch) { setOpen(false); return; }
    setBusy(true);
    setError(null);
    try {
      await pmApi.updatePoRemark(poDispatch, remarkType, draft);
      setOpen(false);
      onSaved?.(draft);
    } catch (err) {
      setError(err?.message || "Save failed");
    } finally {
      setBusy(false);
    }
  }

  const fullText = lines.join(" • ");
  return (
    <>
      <span
        title={fullText || (clickable ? `Click to set ${t.label.toLowerCase()} remark` : `${t.label} (read-only)`)}
        onClick={() => clickable && setOpen(true)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          width: "100%",
          minWidth: 0,
          fontSize: "0.78rem",
          color: text ? "#1e293b" : "#94a3b8",
          cursor: clickable ? "pointer" : "default",
          padding: "2px 4px",
          borderRadius: 4,
          overflow: "hidden",
        }}
        onMouseEnter={(e) => { if (clickable) e.currentTarget.style.background = "#f1f5f9"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
      >
        <span style={{ width: 6, height: 6, borderRadius: 999, background: t.dot, flexShrink: 0 }} />
        {lines.length === 0 ? (
          <span style={{ whiteSpace: "nowrap" }}>—</span>
        ) : lines.length === 1 ? (
          <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {lines[0]}
          </span>
        ) : (
          <AdaptivePillRow lines={lines} dot={t.dot} />
        )}
      </span>

      {open && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 10000,
            background: "rgba(15,23,42,0.45)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 16,
          }}
          onClick={() => !busy && setOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff", borderRadius: 10,
              width: "min(520px, 96vw)",
              boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)",
              padding: 18,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 10, height: 10, borderRadius: 999, background: t.dot }} />
                <span style={{ fontSize: "0.95rem", fontWeight: 700, color: "#0f172a" }}>{t.label} remark</span>
              </div>
              <button
                type="button"
                onClick={() => !busy && setOpen(false)}
                disabled={busy}
                style={{ border: "none", background: "none", color: "#94a3b8", cursor: busy ? "default" : "pointer", fontSize: 22, lineHeight: 1 }}
                aria-label="Close"
              >
                &times;
              </button>
            </div>
            {(poid || poDispatch) && (
              <div style={{ fontSize: "0.72rem", color: "#64748b", marginBottom: 8, fontFamily: "ui-monospace, monospace" }}>
                POID: {poid || poDispatch}
              </div>
            )}
            {/* Rendered list view of the current value above the editor —
                each newline-separated remark gets its own pill so the
                reader sees the items as a checklist. */}
            {lines.length > 0 && (
              <div style={{
                display: "flex", flexWrap: "wrap", gap: 6,
                padding: 10, background: "#f8fafc",
                border: "1px solid #f1f5f9", borderRadius: 8,
                marginBottom: 10,
              }}>
                {lines.map((ln, i) => (
                  <span key={i} style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "5px 10px", borderRadius: 999,
                    background: "#fff", border: "1px solid #e2e8f0",
                    fontSize: "0.78rem", color: "#1e293b",
                  }}>
                    <span style={{ width: 6, height: 6, borderRadius: 999, background: t.dot }} />
                    {ln}
                  </span>
                ))}
              </div>
            )}
            <label style={{ fontSize: "0.74rem", color: "#64748b", display: "block", marginBottom: 4 }}>
              Edit remark (one per line):
            </label>
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={6}
              placeholder={`${t.label} remark…`}
              style={{
                width: "100%", boxSizing: "border-box",
                padding: "8px 10px", fontSize: "0.88rem",
                border: "1px solid #e2e8f0", borderRadius: 8,
                resize: "vertical", minHeight: 120,
                fontFamily: "inherit",
              }}
            />
            {error && (
              <div style={{ color: "#b91c1c", fontSize: "0.78rem", marginTop: 6, padding: "6px 8px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6 }}>
                {error}
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
              <button
                type="button"
                onClick={() => !busy && setOpen(false)}
                disabled={busy}
                style={{ padding: "7px 14px", fontSize: "0.82rem", borderRadius: 7, border: "1px solid #e2e8f0", background: "#fff", cursor: busy ? "default" : "pointer", fontWeight: 600, color: "#475569" }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={doSave}
                disabled={busy || draft === (value || "")}
                style={{
                  padding: "7px 18px", fontSize: "0.82rem", borderRadius: 7,
                  border: "1px solid #2563eb",
                  background: busy || draft === (value || "") ? "#94a3b8" : "#2563eb",
                  color: "#fff", cursor: busy ? "default" : "pointer", fontWeight: 700,
                }}
              >
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
