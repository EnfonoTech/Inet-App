// The app's own confirmation dialog — instead of the browser's
// window.confirm(), which cannot be styled, shows the site's hostname as its
// title, and looks like a security prompt rather than part of the app.
//
//   const confirm = useConfirm();
//   if (await confirm({
//     title: "Remove deduction?",
//     message: "The payout goes back up by 100.00.",
//     confirmLabel: "Remove",
//     tone: "danger",            // "danger" | "primary" (default)
//   })) { ...do it... }
//
// One <ConfirmProvider> at the app root (App.jsx) serves every page. It sits
// above every modal in the app (z-index), so it can be raised from inside one.
// Esc / backdrop = cancel, Enter = confirm. A danger dialog focuses Cancel, so
// a stray Enter never deletes anything.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

const ConfirmContext = createContext(null);

const TONES = {
  danger: { bg: "#dc2626", bd: "#dc2626", icon: "!", iconBg: "#fef2f2", iconFg: "#dc2626" },
  primary: { bg: "#2563eb", bd: "#2563eb", icon: "?", iconBg: "#eff6ff", iconFg: "#2563eb" },
};

export function ConfirmProvider({ children }) {
  const [req, setReq] = useState(null);
  const confirm = useCallback((opts = {}) => new Promise((resolve) => {
    setReq({ ...opts, resolve });
  }), []);
  const close = useCallback((answer) => {
    setReq((r) => { r?.resolve(answer); return null; });
  }, []);
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {req && <Dialog req={req} onAnswer={close} />}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  // Outside the provider (a page rendered on its own) still works.
  return ctx || ((o = {}) => Promise.resolve(window.confirm(
    [o.title, typeof o.message === "string" ? o.message : ""].filter(Boolean).join("\n\n"))));
}

function Dialog({ req, onAnswer }) {
  const tone = TONES[req.tone] || TONES.primary;
  const cancelRef = useRef(null);
  const okRef = useRef(null);
  useEffect(() => {
    (req.tone === "danger" ? cancelRef : okRef).current?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); onAnswer(false); }
    };
    // Capture phase: an open modal underneath must not also see this Esc.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [req, onAnswer]);

  return (
    <div role="presentation" onClick={() => onAnswer(false)}
         style={{ position: "fixed", inset: 0, zIndex: 10050, background: "rgba(15,23,42,0.45)",
                  display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-title"
           onClick={(e) => e.stopPropagation()}
           style={{ background: "#fff", borderRadius: 12, width: "min(440px, 100%)",
                    boxShadow: "0 25px 50px -12px rgba(0,0,0,0.3)", overflow: "hidden" }}>
        <div style={{ display: "flex", gap: 14, padding: "20px 20px 6px" }}>
          <div aria-hidden style={{ flexShrink: 0, width: 36, height: 36, borderRadius: 999, background: tone.iconBg,
                                     color: tone.iconFg, display: "flex", alignItems: "center", justifyContent: "center",
                                     fontWeight: 800, fontSize: "1.05rem" }}>{tone.icon}</div>
          <div style={{ minWidth: 0 }}>
            <h3 id="confirm-title" style={{ margin: "6px 0 6px", fontSize: "1rem", fontWeight: 700, color: "#0f172a" }}>
              {req.title || "Are you sure?"}
            </h3>
            {req.message && (
              <div style={{ fontSize: "0.86rem", color: "#475569", lineHeight: 1.5 }}>{req.message}</div>
            )}
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, padding: "16px 20px 18px" }}>
          <button ref={cancelRef} type="button" className="btn-secondary" onClick={() => onAnswer(false)}>
            {req.cancelLabel || "Cancel"}
          </button>
          <button ref={okRef} type="button" className="btn-primary" onClick={() => onAnswer(true)}
                  style={{ background: tone.bg, borderColor: tone.bd }}>
            {req.confirmLabel || "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}
