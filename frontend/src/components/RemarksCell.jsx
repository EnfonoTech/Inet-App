import { useEffect, useRef, useState } from "react";
import { pmApi } from "../services/api";
import { useAuth } from "../context/AuthContext";

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

  return (
    <>
      <span
        title={text || (clickable ? `Click to set ${t.label.toLowerCase()} remark` : `${t.label} (read-only)`)}
        onClick={() => clickable && setOpen(true)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          maxWidth: 220,
          fontSize: "0.78rem",
          color: text ? "#1e293b" : "#94a3b8",
          cursor: clickable ? "pointer" : "default",
          padding: "2px 4px",
          borderRadius: 4,
        }}
        onMouseEnter={(e) => { if (clickable) e.currentTarget.style.background = "#f1f5f9"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
      >
        <span style={{ width: 6, height: 6, borderRadius: 999, background: t.dot, flexShrink: 0 }} />
        <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {text || "—"}
        </span>
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
