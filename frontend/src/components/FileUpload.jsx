import { useRef, useState } from "react";

/**
 * Drag-and-drop file upload zone.
 * Props:
 *   onFileUploaded(file_url) — called with the uploaded file URL on success
 *   accept — file types (default ".xlsx,.csv")
 */
export default function FileUpload({ onFileUploaded, accept = ".xlsx,.csv" }) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [fileName, setFileName] = useState(null);
  const inputRef = useRef(null);

  function getCsrf() {
    const match = document.cookie.match(/frappe_csrf_token=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : "fetch";
  }

  async function uploadFile(file) {
    setUploading(true);
    setError(null);
    setFileName(file.name);

    const form = new FormData();
    form.append("file", file, file.name);
    form.append("is_private", "1");
    form.append("folder", "Home");

    try {
      const res = await fetch("/api/method/upload_file", {
        method: "POST",
        credentials: "include",
        headers: { "X-Frappe-CSRF-Token": getCsrf() },
        body: form,
      });
      const json = await res.json();
      if (!res.ok || json.exc) {
        throw new Error(json.message || "Upload failed");
      }
      const file_url = json.message?.file_url || json.message;
      if (!file_url) throw new Error("No file URL returned from server");
      onFileUploaded(file_url);
    } catch (err) {
      setError(err.message || "Upload failed");
      setFileName(null);
    } finally {
      setUploading(false);
    }
  }

  function handleDragOver(e) {
    e.preventDefault();
    setDragging(true);
  }

  function handleDragLeave(e) {
    e.preventDefault();
    setDragging(false);
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) uploadFile(file);
  }

  function handleChange(e) {
    const file = e.target.files[0];
    if (file) uploadFile(file);
  }

  return (
    <div>
      <div
        className={`file-upload-zone ${dragging ? "dragover" : ""}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !uploading && inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
      >
        <div className="upload-icon">
          {uploading ? "⏳" : fileName ? "✅" : "📂"}
        </div>
        {uploading ? (
          <div className="upload-text">Uploading {fileName}…</div>
        ) : fileName ? (
          <div className="upload-text" style={{ color: "var(--green)" }}>
            {fileName} uploaded
          </div>
        ) : (
          <>
            <div className="upload-text">
              Drop your file here or{" "}
              <span className="upload-link">browse</span>
            </div>
            <div className="upload-hint">Accepts {accept} files</div>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          style={{ display: "none" }}
          onChange={handleChange}
        />
      </div>

      {error && (
        <div className="notice error" style={{ marginTop: 12 }}>
          <span>⚠</span> {error}
        </div>
      )}
    </div>
  );
}
