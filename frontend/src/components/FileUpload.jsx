import { useRef, useState } from "react";
import { fetchPortalSession, getCsrf } from "../services/api";

function buildUploadForm(file) {
  const form = new FormData();
  form.append("file", file, file.name);
  form.append("is_private", "1");
  form.append("folder", "Home");
  return form;
}

function uploadJsonErrorText(json) {
  if (json._server_messages) {
    try {
      return JSON.parse(JSON.parse(json._server_messages)[0]).message;
    } catch {
      /* ignore */
    }
  }
  if (json.exc && typeof json.exception === "string") return json.exception;
  return json.message || "";
}

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

  async function uploadFile(file) {
    setUploading(true);
    setError(null);
    setFileName(file.name);

    try {
      await fetchPortalSession().catch(() => {});
      let token = getCsrf();
      const doFetch = (formBody) =>
        fetch("/api/method/upload_file", {
          method: "POST",
          credentials: "include",
          headers: { "X-Frappe-CSRF-Token": token },
          body: formBody,
        });

      let form = buildUploadForm(file);
      let res = await doFetch(form);
      let json = await res.json();

      const errText = `${uploadJsonErrorText(json)} ${json.exc || ""}`.toLowerCase();
      if ((!res.ok || json.exc) && (errText.includes("invalid request") || errText.includes("csrftoken"))) {
        await fetchPortalSession().catch(() => {});
        token = getCsrf();
        form = buildUploadForm(file);
        res = await doFetch(form);
        json = await res.json();
      }

      if (!res.ok || json.exc) {
        let errMsg = uploadJsonErrorText(json) || "Upload failed";
        if (!errMsg || errMsg === "undefined") errMsg = typeof json.message === "string" ? json.message : "Upload failed";
        throw new Error(errMsg);
      }
      // Frappe returns { message: { file_url: "..." } }
      const file_url = json.message?.file_url;
      if (!file_url) throw new Error("No file URL returned from server");
      onFileUploaded(file_url, file.name);
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
