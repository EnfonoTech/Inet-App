/**
 * Before / After site photos for the field app — camera only.
 *
 * Two of these sit side by side in one row, just above GPS Location, because
 * that is the moment the TL is standing at the site with the phone in hand.
 *
 * Deliberately NOT AttachmentsSection: that offers a file picker, and a photo
 * chosen from the gallery is not evidence that anyone was on site. The input
 * here is `capture="environment"`, which opens the rear camera straight away.
 * (A determined user can still work around it — this is a nudge toward the
 * honest path, not a security control.)
 *
 * Props:
 *   label    : "Before" | "After"
 *   urls     : string[]
 *   onChange : (urls) => void
 *   at       : server-stamped upload time, shown small
 *   required : bool — red outline while empty
 *   disabled : bool
 */

import { useRef, useState } from "react";
import { PhotoLightbox, uploadPortalFile } from "./AttachmentsSection";

function shortWhen(v) {
  if (!v) return null;
  const d = new Date(String(v).replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString("en", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

export default function SitePhotoCapture({
  label, urls = [], onChange, at, required = false, disabled = false,
}) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [lightbox, setLightbox] = useState(null);
  const empty = urls.length === 0;

  async function onPick(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    setBusy(true);
    setError(null);
    try {
      const added = [];
      for (const f of files) added.push(await uploadPortalFile(f));
      onChange([...urls, ...added]);
    } catch (err) {
      setError(err.message || "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{
      flex: 1, minWidth: 0, padding: 10, borderRadius: 10,
      border: `1px solid ${required && empty ? "#fca5a5" : "#e2e8f0"}`,
      background: required && empty ? "#fef2f2" : "#fff",
    }}>
      <PhotoLightbox url={lightbox} onClose={() => setLightbox(null)} />
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#334155" }}>
          {label}{required && empty ? " *" : ""}
        </span>
        {urls.length > 0 && (
          <span style={{ fontSize: 11, color: "#94a3b8" }}>({urls.length})</span>
        )}
      </div>

      {urls.length > 0 && (
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 6 }}>
          {urls.map((u, i) => (
            <span key={`${u}-${i}`} style={{ position: "relative", display: "inline-block" }}>
              {/* Tappable: a 46px thumbnail is enough to tell there IS a
                  photo and nothing else, so the person who just took it has
                  to be able to open it and check what they actually got. */}
              <button type="button" onClick={() => setLightbox(u)} title="View full size"
                 style={{ display: "block", padding: 0, border: "none", background: "none", cursor: "zoom-in" }}>
                <img src={u} alt={`${label} ${i + 1}`} loading="lazy"
                     style={{ width: 46, height: 46, objectFit: "cover", borderRadius: 6, border: "1px solid #e2e8f0", display: "block" }} />
              </button>
              {!disabled && (
                <button type="button" aria-label="Remove"
                  // Sits on top of the thumbnail button: without stopping here,
                  // removing a photo would also open the lightbox.
                  onClick={(e) => { e.preventDefault(); e.stopPropagation();
                                    onChange(urls.filter((_, j) => j !== i)); }}
                  style={{
                    position: "absolute", top: -5, right: -5, width: 17, height: 17,
                    borderRadius: 999, border: "none", background: "#ef4444", color: "#fff",
                    fontSize: 11, lineHeight: "17px", padding: 0, cursor: "pointer",
                  }}>×</button>
              )}
            </span>
          ))}
        </div>
      )}

      <button type="button" disabled={disabled || busy}
        onClick={() => inputRef.current?.click()}
        style={{
          width: "100%", padding: "7px 8px", borderRadius: 8, cursor: "pointer",
          border: "1px solid #cbd5e1", background: "#f8fafc",
          fontSize: 12, fontWeight: 600, color: "#334155",
        }}>
        {busy ? "Uploading…" : urls.length ? "Add photo" : "Take photo"}
      </button>
      <input ref={inputRef} type="file" accept="image/*" capture="environment"
             multiple onChange={onPick} style={{ display: "none" }} />

      {at && (
        <div style={{ fontSize: 10.5, color: "#94a3b8", marginTop: 5 }}>{shortWhen(at)}</div>
      )}
      {error && (
        <div style={{ fontSize: 10.5, color: "#b91c1c", marginTop: 4 }}>{error}</div>
      )}
    </div>
  );
}
