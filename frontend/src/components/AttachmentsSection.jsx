/**
 * Reusable document/photo attachment section.
 *
 * Props:
 *   urls     : string[]
 *   onChange : (urls: string[]) => void
 *   title    : string   (default "Documents")
 *   readOnly : bool
 *   noCamera : bool — desktop mode: compact list UI, no Camera button
 */

import { useRef, useState } from "react";
import { fetchPortalSession, getCsrf } from "../services/api";

function buildUploadForm(file) {
  const form = new FormData();
  form.append("file", file, file.name);
  form.append("is_private", "0");
  form.append("folder", "Home");
  return form;
}

export function parseFileList(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean).map((v) => String(v).trim()).filter(Boolean);
  const text = String(raw).trim();
  if (!text) return [];
  if (text.startsWith("[")) {
    try {
      const a = JSON.parse(text);
      if (Array.isArray(a)) return a.filter(Boolean).map((v) => String(v).trim()).filter(Boolean);
    } catch { /* fallthrough */ }
  }
  return text.split(/\r?\n|,/).map((v) => v.trim()).filter(Boolean);
}

function isImageUrl(url) {
  return /\.(jpe?g|png|gif|webp|bmp|svg)(\?|$)/i.test(url);
}

function SmallFileIcon({ size = 14 }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" width={size} height={size} style={{ flexShrink: 0, color: "#64748b" }}>
      <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
    </svg>
  );
}

function ImgIcon({ size = 14 }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" width={size} height={size} style={{ flexShrink: 0, color: "#64748b" }}>
      <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
    </svg>
  );
}

function AttachIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
      <path fillRule="evenodd" d="M8 4a3 3 0 00-3 3v4.5a4.5 4.5 0 009 0V6a1 1 0 112 0v5.5a6.5 6.5 0 01-13 0V7a5 5 0 0110 0v4.5a3.5 3.5 0 01-7 0V7a1 1 0 012 0v4.5a1.5 1.5 0 003 0V7a3 3 0 00-3-3z" clipRule="evenodd" />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" width="20" height="20">
      <path fillRule="evenodd" d="M4 5a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2V7a2 2 0 00-2-2h-1.586a1 1 0 01-.707-.293l-1.121-1.121A2 2 0 0011.172 3H8.828a2 2 0 00-1.414.586L6.293 4.707A1 1 0 015.586 5H4zm6 9a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
    </svg>
  );
}

function DocPickIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" width="20" height="20">
      <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
    </svg>
  );
}

function WarnIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16" style={{ flexShrink: 0 }}>
      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      width="28" height="28" style={{ color: "#64748b" }}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  );
}

export default function AttachmentsSection({ urls = [], onChange, title = "Documents", readOnly = false, noCamera = false }) {
  const [pending, setPending] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const previewMapRef = useRef({});

  async function uploadFile(file) {
    if (!file) return;
    setError(null);
    const isImg = file.type.startsWith("image/");
    const previewUrl = isImg ? URL.createObjectURL(file) : null;
    const pendingId = `p-${Date.now()}-${Math.random()}`;
    setPending((prev) => [...prev, { id: pendingId, name: file.name, preview: previewUrl }]);
    setBusy(true);
    try {
      await fetchPortalSession().catch(() => {});
      let token = getCsrf();
      const doFetch = (body) =>
        fetch("/api/method/upload_file", {
          method: "POST", credentials: "include",
          headers: { "X-Frappe-CSRF-Token": token }, body,
        });
      let res = await doFetch(buildUploadForm(file));
      let json = await res.json();
      const errText = `${json.message || ""} ${json.exc || ""}`.toLowerCase();
      if ((!res.ok || json.exc) && (errText.includes("invalid request") || errText.includes("csrf"))) {
        await fetchPortalSession().catch(() => {});
        token = getCsrf();
        res = await doFetch(buildUploadForm(file));
        json = await res.json();
      }
      if (!res.ok || json.exc) throw new Error(json.message || "Upload failed");
      const fileUrl = json.message?.file_url;
      if (!fileUrl) throw new Error("No file URL received");
      if (previewUrl) previewMapRef.current[fileUrl] = previewUrl;
      onChange([...urls, fileUrl]);
    } catch (err) {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setError(err.message || "Upload failed");
    } finally {
      setPending((prev) => prev.filter((p) => p.id !== pendingId));
      setBusy(false);
    }
  }

  function removeFile(idx) {
    const url = urls[idx];
    if (previewMapRef.current[url]) {
      URL.revokeObjectURL(previewMapRef.current[url]);
      delete previewMapRef.current[url];
    }
    onChange(urls.filter((_, i) => i !== idx));
  }

  const totalCount = urls.length + pending.length;

  /* ── Desktop / compact mode (noCamera) ──────────────────────── */
  if (noCamera) {
    return (
      <div style={{ marginTop: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <span style={{ fontSize: "0.78rem", fontWeight: 600, color: "#475569" }}>{title}</span>
          {!readOnly && (
            <label style={{
              display: "inline-flex", alignItems: "center", gap: 5, cursor: busy ? "not-allowed" : "pointer",
              fontSize: "0.78rem", fontWeight: 600, color: busy ? "#94a3b8" : "#1d4ed8",
              padding: "4px 10px", borderRadius: 6, border: "1px solid #bfdbfe",
              background: busy ? "#f8fafc" : "#eff6ff", userSelect: "none",
            }}>
              <AttachIcon />
              {busy ? "Uploading…" : "Attach"}
              <input
                type="file" multiple style={{ display: "none" }}
                onChange={(e) => { Array.from(e.target.files || []).forEach((f) => uploadFile(f)); e.target.value = ""; }}
                disabled={busy}
              />
            </label>
          )}
        </div>

        {error && (
          <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: "0.78rem", color: "#b91c1c", marginBottom: 6 }}>
            <WarnIcon /> {error}
          </div>
        )}

        {totalCount === 0 && !readOnly && (
          <div style={{ fontSize: "0.78rem", color: "#94a3b8" }}>No files attached yet.</div>
        )}
        {totalCount === 0 && readOnly && (
          <div style={{ fontSize: "0.78rem", color: "#94a3b8" }}>No documents attached.</div>
        )}

        {(pending.length > 0 || urls.length > 0) && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {pending.map((p) => (
              <div key={p.id} style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "5px 8px", borderRadius: 6,
                background: "#f8fafc", border: "1px solid #e2e8f0",
              }}>
                <SmallFileIcon />
                <span style={{ flex: 1, fontSize: "0.8rem", color: "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                <span style={{ fontSize: "0.72rem", color: "#94a3b8" }}>uploading…</span>
              </div>
            ))}
            {urls.map((url, idx) => {
              const isImg = isImageUrl(url);
              const fileName = decodeURIComponent(url.split("/").pop().split("?")[0]);
              return (
                <div key={`${url}-${idx}`} style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "5px 8px", borderRadius: 6,
                  background: "#f8fafc", border: "1px solid #e2e8f0",
                }}>
                  {isImg ? <ImgIcon /> : <SmallFileIcon />}
                  <a href={url} target="_blank" rel="noopener noreferrer" style={{
                    flex: 1, fontSize: "0.8rem", color: "#1d4ed8", overflow: "hidden",
                    textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: "none",
                  }}
                    title={fileName}
                  >{fileName}</a>
                  {!readOnly && (
                    <button type="button" onClick={() => removeFile(idx)} style={{
                      background: "none", border: "none", cursor: "pointer",
                      color: "#94a3b8", fontSize: "1rem", lineHeight: 1, padding: "0 2px",
                      flexShrink: 0,
                    }} title="Remove">×</button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  /* ── Mobile / PWA mode (default) ────────────────────────────── */
  return (
    <div className="exec-section">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div className="exec-section-title" style={{ marginBottom: 0 }}>{title}</div>
        {totalCount > 0 && (
          <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", fontWeight: 600 }}>
            {totalCount} file{totalCount !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {!readOnly && (
        <div className="photo-action-row">
          <label className="photo-add-btn photo-add-btn--camera" title="Take a photo">
            <CameraIcon />
            <span>Camera</span>
            <input
              type="file" accept="image/*" capture="environment"
              onChange={(e) => { uploadFile(e.target.files?.[0]); e.target.value = ""; }}
              disabled={busy}
            />
          </label>
          <label className="photo-add-btn photo-add-btn--gallery" title="Attach document or photo">
            <DocPickIcon />
            <span>Document</span>
            <input
              type="file" multiple
              onChange={(e) => { Array.from(e.target.files || []).forEach((f) => uploadFile(f)); e.target.value = ""; }}
              disabled={busy}
            />
          </label>
        </div>
      )}

      {error && (
        <div className="notice error" style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
          <WarnIcon /> {error}
        </div>
      )}

      {(pending.length > 0 || urls.length > 0) && (
        <div className="photo-thumb-grid" style={{ marginTop: 12 }}>
          {pending.map((p) => (
            <div key={p.id} className="photo-thumb photo-thumb--uploading">
              {p.preview
                ? <img src={p.preview} alt="uploading" />
                : (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 4, padding: 8 }}>
                    <FileIcon />
                    <span style={{ fontSize: "0.6rem", color: "#64748b", textAlign: "center", wordBreak: "break-all", lineHeight: 1.2 }}>{p.name}</span>
                  </div>
                )
              }
              <div className="photo-upload-overlay"><div className="photo-upload-spinner" /></div>
            </div>
          ))}
          {urls.map((url, idx) => {
            const isImg = isImageUrl(url);
            const fileName = decodeURIComponent(url.split("/").pop().split("?")[0]);
            return (
              <div key={`${url}-${idx}`} className="photo-thumb" style={{ position: "relative" }}>
                {isImg ? (
                  <a href={url} target="_blank" rel="noopener noreferrer" style={{ display: "contents" }}>
                    <img
                      src={previewMapRef.current[url] || url}
                      alt={`File ${idx + 1}`}
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      onError={(e) => { e.target.style.display = "none"; e.target.nextSibling.style.display = "flex"; }}
                    />
                    <div style={{ display: "none", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 4, padding: 8 }}>
                      <FileIcon />
                      <span style={{ fontSize: "0.6rem", color: "#64748b", textAlign: "center", wordBreak: "break-all", lineHeight: 1.2 }}>{fileName}</span>
                    </div>
                  </a>
                ) : (
                  <a href={url} target="_blank" rel="noopener noreferrer"
                    style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 4, padding: 8, textDecoration: "none" }}>
                    <FileIcon />
                    <span style={{ fontSize: "0.6rem", color: "#64748b", textAlign: "center", wordBreak: "break-all", lineHeight: 1.2 }}>{fileName}</span>
                  </a>
                )}
                {!readOnly && (
                  <button type="button" className="photo-thumb-remove" onClick={() => removeFile(idx)}>×</button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {totalCount === 0 && readOnly && (
        <div style={{ color: "#94a3b8", fontSize: "0.8rem" }}>No documents attached.</div>
      )}
    </div>
  );
}
