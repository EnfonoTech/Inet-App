import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DataTableWrapper from "../../components/DataTableWrapper";
import PageSummary from "../../components/PageSummary";
import { usePublishedQuery } from "../../hooks/usePublishedQuery";
import { useAuth } from "../../context/AuthContext";
import { useTableRowLimit, TABLE_ROW_LIMIT_ALL, TABLE_ROW_LIMIT_DEFAULT } from "../../context/TableRowLimitContext";
import TableRowsLimitFooter from "../../components/TableRowsLimitFooter";
import { useDebounced } from "../../hooks/useDebounced";
import { pmApi } from "../../services/api";
import useFilterOptions from "../../hooks/useFilterOptions";
import SearchableSelect from "../../components/SearchableSelect";
import DateRangePicker from "../../components/DateRangePicker";
import ExportExcelButton from "../../components/ExportExcelButton";
import PlanTeamsBreakdown from "../../components/PlanTeamsBreakdown";
import DispatchVisitHistory from "../../components/DispatchVisitHistory";
import { EXECUTION_STATUS_OPTIONS } from "../../constants/executionStatuses";
import RemarksCell from "../../components/RemarksCell";
import IMNoteCallout from "../../components/IMNoteCallout";
import { handleSearchPaste } from "../../utils/searchPaste";
import { useProgressiveRows } from "../../hooks/useProgressiveRows";
import { PoStatusBadge, PicStatusBadge } from "../pic/picShared";

/* Money is never rounded to whole SAR: ms2_amount alone is fractional on
   1,550 of 1,983 dispatches, so a milestone split of an odd line amount
   displayed as a whole number that did not match its own line. Max 4 dp is
   the deepest precision the data carries (275.1684, 251.2805), so every
   stored amount renders exactly; min 2 keeps a clean figure reading as
   3,250.00. Counts use the shared `count`/plain numbers — a row count
   must never read "29.00". */
const money = new Intl.NumberFormat("en", { minimumFractionDigits: 2, maximumFractionDigits: 4 });

// Required documents per activity type.
// doc2: null → Not applicable (only DOC1 needed)
// doc2: { label, accept } → second doc required with those accepted formats
const DOC_REQUIREMENTS = {
  "installation":    { doc1Label: "Confirmation Mail", doc2: null },
  "Dismantle":       { doc1Label: "Confirmation Mail", doc2: { label: "Supporting Documents", parts: [{ label: "Dismantling Checklist", slot: "im_doc2a" }, { label: "PPT", slot: "im_doc2b" }, { label: "POD", slot: "im_doc2c" }], accept: ".pdf,.xls,.xlsx,.doc,.docx,.ppt,.pptx" } },
  "Survey & Design": { doc1Label: "Confirmation Mail", doc2: { label: "Survey Report", accept: ".pdf" } },
  "PAT":             { doc1Label: "Confirmation Mail", doc2: { label: "PAT Document", accept: ".pdf" } },
  "Design":          { doc1Label: "Confirmation Mail", doc2: { label: "MOP / SED", accept: ".pdf" } },
  "test":            { doc1Label: "Confirmation Mail", doc2: { label: "Test Report", accept: ".pdf,.xls,.xlsx,.doc,.docx,.csv" } },
  "Visit":           { doc1Label: "Confirmation Mail", doc2: { label: "Visit Justification Mail", accept: ".msg" } },
  "Local Material":  { doc1Label: "Confirmation Mail", doc2: { label: "POD", accept: ".pdf" } },
  "commission":      { doc1Label: "Confirmation", doc2: null },
  "Acquizision":     { doc1Label: "Confirmation", doc2: null },
  "Batteries":       { doc1Label: "Confirmation Mail", doc2: null },
  "Migration":       { doc1Label: "Confirmation Mail", doc2: null },
  "Document":        { doc1Label: "Confirmation Mail", doc2: { label: "Document", accept: ".pdf" } },
};

function badgeTone(value) {
  const s = String(value || "").toLowerCase();
  if (!s) return { bg: "#f1f5f9", fg: "#334155", dot: "#64748b" };
  const tones = {
    "in progress": { bg: "#eff6ff", fg: "#1d4ed8", dot: "#3b82f6" },
    completed: { bg: "#ecfdf5", fg: "#047857", dot: "#10b981" },
    hold: { bg: "#fffbeb", fg: "#b45309", dot: "#f59e0b" },
    cancelled: { bg: "#fef2f2", fg: "#b91c1c", dot: "#ef4444" },
    postponed: { bg: "#fefce8", fg: "#a16207", dot: "#eab308" },
    pending: { bg: "#fffbeb", fg: "#b45309", dot: "#f59e0b" },
    invoiced: { bg: "#eff6ff", fg: "#1d4ed8", dot: "#3b82f6" },
    closed: { bg: "#ecfdf5", fg: "#047857", dot: "#10b981" },
    "ready for confirmation": { bg: "#eff6ff", fg: "#1d4ed8", dot: "#3b82f6" },
    "confirmation done": { bg: "#ecfdf5", fg: "#047857", dot: "#10b981" },
  };
  if (tones[s]) return tones[s];
  if (s.includes("complete") || s.includes("approved") || s.includes("done") || s.includes("pass")) return { bg: "#ecfdf5", fg: "#047857", dot: "#10b981" };
  if (s.includes("cancel") || s.includes("reject") || s.includes("fail")) return { bg: "#fef2f2", fg: "#b91c1c", dot: "#ef4444" };
  if (s.includes("progress") || s.includes("review") || s.includes("open")) return { bg: "#eff6ff", fg: "#1d4ed8", dot: "#3b82f6" };
  if (s.includes("hold") || s.includes("pending") || s.includes("wait") || s.includes("postponed")) return { bg: "#fffbeb", fg: "#b45309", dot: "#f59e0b" };
  return { bg: "#f8fafc", fg: "#334155", dot: "#64748b" };
}

function AttachmentSlotList({ attachments, docReq }) {
  if (!attachments?.length) return null;
  const doc2Parts = docReq?.doc2?.parts;
  const doc2SlotProps = { tag: "DOC2", bg: "#f0fdf4", bd: "#bbf7d0", fg: "#14532d", tagColor: "#16a34a" };
  const slots = [
    { key: "im_doc1", label: docReq?.doc1Label || "Confirmation Mail", tag: "DOC1", bg: "#eff6ff", bd: "#bfdbfe", fg: "#1e40af", tagColor: "#3b82f6" },
    ...(doc2Parts
      ? [
          ...doc2Parts.map((p) => ({ key: p.slot, label: p.label, ...doc2SlotProps })),
          { key: "im_doc2", label: docReq.doc2.label || "Supporting Documents", ...doc2SlotProps },
        ]
      : [{ key: "im_doc2", label: docReq?.doc2?.label || "Supporting Document", ...doc2SlotProps }]),
    { key: "im_attachment", label: "Other Attachments", tag: "ATT", bg: "#f8fafc", bd: "#e2e8f0", fg: "#334155", tagColor: "#64748b" },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {slots.map(({ key, label, tag, bg, bd, fg, tagColor, parts }) => {
        const files = attachments.filter((f) => f.attached_to_field === key);
        if (!files.length) return null;
        return (
          <div key={key} style={{ border: `1px solid ${bd}`, borderRadius: 8, overflow: "hidden" }}>
            <div style={{ background: bg, borderBottom: `1px solid ${bd}`, padding: "5px 10px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: "0.65rem", fontWeight: 700, color: tagColor, textTransform: "uppercase", letterSpacing: "0.06em" }}>{tag}</span>
                <span style={{ fontSize: "0.78rem", fontWeight: 600, color: fg }}>{label}</span>
              </div>
              {parts?.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginTop: 3 }}>
                  {parts.map((p) => <span key={p} style={{ fontSize: "0.62rem", padding: "1px 6px", borderRadius: 999, background: "#fff", color: fg, border: `1px solid ${bd}` }}>{p}</span>)}
                </div>
              )}
            </div>
            {files.map((f, i) => {
              const isMsgFile = (f.file_name || "").toLowerCase().endsWith(".msg");
              const isWebLink = /^https?:\/\//i.test(f.file_url || "");
              return (
                <a key={f.name} href={f.file_url} download={isMsgFile && !isWebLink ? f.file_name : undefined}
                  target={isMsgFile && !isWebLink ? undefined : "_blank"} rel="noopener noreferrer"
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", background: i % 2 === 0 ? "#fff" : bg, textDecoration: "none", borderTop: i > 0 ? `1px solid ${bd}` : "none" }}>
                  <span style={{ fontSize: "1rem", flexShrink: 0 }}>{isWebLink ? "🔗" : isMsgFile ? "✉️" : "📎"}</span>
                  <div style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.85rem", color: "#1d4ed8" }}>{f.file_name || f.file_url}</div>
                  {f.file_size ? <span style={{ fontSize: "0.72rem", color: "#94a3b8", flexShrink: 0 }}>{f.file_size < 1048576 ? `${Math.round(f.file_size / 1024)} KB` : `${(f.file_size / 1048576).toFixed(1)} MB`}</span> : null}
                  {isWebLink && <span style={{ fontSize: "0.68rem", color: "#64748b", flexShrink: 0 }}>web link ↗</span>}
                  {isMsgFile && !isWebLink && <span style={{ fontSize: "0.68rem", color: "#64748b", flexShrink: 0 }}>↓ download</span>}
                </a>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function LinkAttachInput({ links, setLinks }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");

  function addLink() {
    let u = (url || "").trim();
    if (!u) return;
    if (!/^https?:\/\//i.test(u)) u = "https://" + u;
    let n = (name || "").trim();
    if (!n) {
      try {
        const parsed = new URL(u);
        n = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() || "") || parsed.hostname;
      } catch { n = u; }
    }
    setLinks([...(links || []), { url: u, name: n }]);
    setUrl("");
    setName("");
  }

  return (
    <div style={{ marginTop: 4 }}>
      {!open ? (
        <button type="button" onClick={() => setOpen(true)}
          style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: "0.75rem", color: "#2563eb", fontWeight: 600 }}>
          🔗 Attach via web link
        </button>
      ) : (
        <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 6, padding: "8px 10px" }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…"
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLink(); } }}
              style={{ flex: "2 1 160px", minWidth: 0, padding: "5px 8px", border: "1px solid #bfdbfe", borderRadius: 5, fontSize: "0.78rem" }} />
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Display name (optional)"
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLink(); } }}
              style={{ flex: "1 1 110px", minWidth: 0, padding: "5px 8px", border: "1px solid #bfdbfe", borderRadius: 5, fontSize: "0.78rem" }} />
            <button type="button" className="btn-secondary" onClick={addLink} disabled={!url.trim()}
              style={{ padding: "4px 12px", fontSize: "0.78rem" }}>
              Add
            </button>
          </div>
        </div>
      )}
      {(links || []).length > 0 && (
        <div style={{ marginTop: 4, background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 6, padding: "5px 10px" }}>
          {links.map((l, i) => (
            <div key={i} style={{ fontSize: "0.78rem", color: "#1e40af", display: "flex", alignItems: "center", gap: 6, padding: "2px 0" }}>
              <span>🔗</span>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={l.url}>{l.name}</span>
              <button type="button" onClick={() => setLinks(links.filter((_, j) => j !== i))}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#94a3b8", fontSize: "0.85rem", lineHeight: 1, padding: 0 }}>
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FileSlot({ slotKey, slotLabel, accept, files, setFiles, required, links, setLinks }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {slotKey && <span>{slotKey} —</span>} {slotLabel}
        {required && <span style={{ fontSize: "0.7rem", color: "#ef4444", fontWeight: 600, textTransform: "none", letterSpacing: 0 }}>* required</span>}
        {accept && <span style={{ fontSize: "0.68rem", color: "#94a3b8", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>({accept})</span>}
      </div>
      <label style={{
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        gap: 4, padding: "10px 14px", border: `2px dashed ${files.length > 0 ? "#86efac" : "#cbd5e1"}`,
        borderRadius: 8, cursor: "pointer",
        background: files.length > 0 ? "#f0fdf4" : "#f8fafc",
        color: "#64748b", fontSize: "0.8rem",
      }}>
        <span style={{ fontSize: "1.1rem" }}>📁</span>
        {files.length > 0
          ? <span style={{ color: "#047857", fontWeight: 600 }}>{files.length} file{files.length !== 1 ? "s" : ""} selected</span>
          : <span>Click to select files (multiple allowed)</span>}
        <input type="file" multiple accept={accept || undefined} style={{ display: "none" }}
          onChange={(e) => setFiles(Array.from(e.target.files))} />
      </label>
      {files.length > 0 && (
        <div style={{ marginTop: 4, background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 6, padding: "5px 10px" }}>
          {files.map((f, i) => (
            <div key={i} style={{ fontSize: "0.78rem", color: "#14532d", display: "flex", alignItems: "center", gap: 6, padding: "2px 0" }}>
              <span>📄</span>{f.name}
              <span style={{ color: "#16a34a", fontSize: "0.7rem" }}>
                {f.size < 1024 * 1024 ? `${Math.round(f.size / 1024)} KB` : `${(f.size / 1024 / 1024).toFixed(1)} MB`}
              </span>
            </div>
          ))}
        </div>
      )}
      {setLinks && <LinkAttachInput links={links} setLinks={setLinks} />}
    </div>
  );
}

function StatusPill({ value }) {
  if (!value) return <span style={{ color: "#94a3b8" }}>—</span>;
  const tone = badgeTone(value);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 10px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.03em",
        background: tone.bg,
        color: tone.fg,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 999, background: tone.dot }} />
      {value}
    </span>
  );
}

function fmtTimestamp(ts) {
  if (!ts) return "—";
  const s = String(ts).slice(0, 16).replace("T", " ");
  return s;
}

const ISSUE_FLAG_PALETTE = {
  "POD/PPT required":               { bg: "#eff6ff", fg: "#1d4ed8", bd: "#bfdbfe" },
  "TFM Check list":                 { bg: "#f5f3ff", fg: "#6d28d9", bd: "#ddd6fe" },
  "Spare part return":              { bg: "#fff7ed", fg: "#c2410c", bd: "#fed7aa" },
  "PAT/HO Final Approval":          { bg: "#ecfdf5", fg: "#047857", bd: "#a7f3d0" },
  "FPDC/FM Survey report Approval": { bg: "#f0f9ff", fg: "#0369a1", bd: "#bae6fd" },
  "Partial Work done":              { bg: "#fff1f2", fg: "#be123c", bd: "#fecdd3" },
};

function IssueFlagCell({ flag, onClick }) {
  if (!flag) {
    return (
      <button type="button" onClick={onClick}
        style={{ fontSize: "0.7rem", padding: "3px 8px", background: "none", color: "#94a3b8", border: "1px dashed #e2e8f0", borderRadius: 6, cursor: "pointer", whiteSpace: "nowrap" }}>
        + flag
      </button>
    );
  }
  const p = ISSUE_FLAG_PALETTE[flag] || { bg: "#f1f5f9", fg: "#334155", bd: "#e2e8f0" };
  return (
    <button type="button" onClick={onClick}
      style={{ fontSize: "0.7rem", padding: "3px 9px", whiteSpace: "nowrap", background: p.bg, color: p.fg, border: `1px solid ${p.bd}`, borderRadius: 6, cursor: "pointer", fontWeight: 700 }}>
      {flag}
    </button>
  );
}

// "Resubmit to PIC" tab — a browsable list of ALL legacy lines (no Work
// Done record at all), shown regardless of current PIC status, so the IM
// always has a place to look up old data and submit a supporting document
// through the system if one's still missing. Checkbox-selectable like every
// other tab — the actual submit is a bulk toolbar action (per milestone),
// not a per-row button, since a single line can carry MS1, MS2, or both.
function LegacyResubmitTable({ rows, loading, selectedRows, onToggleRow, onToggleAll, onView, displayLimit = Infinity }) {
  const visible = rows.slice(0, displayLimit);
  const allSelected = visible.length > 0 && visible.every((r) => selectedRows.has(r.name));
  return (
    <table className="data-table" data-excel-filter-all="1" data-table-key="im-workdone-v1-legacy">
      <thead>
        <tr>
          <th><input type="checkbox" checked={allSelected} onChange={onToggleAll} /></th>
          <th>POID</th>
          <th>PO No</th>
          <th>Project</th>
          <th>DUID</th>
          <th>Item Code</th>
          <th>Item Description</th>
          <th>Activity Type</th>
          <th>PO Status</th>
          <th>PIC Status (MS1)</th>
          <th style={{ textAlign: "right" }}>MS1 Amount</th>
          <th>PIC Status (MS2)</th>
          <th style={{ textAlign: "right" }}>MS2 Amount</th>
          <th style={{ textAlign: "right" }}>Docs</th>
          <th>IM Note</th>
          <th>Last Updated</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={17} style={{ padding: 0 }}>
              {loading ? (
                <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Loading…</div>
              ) : (
                <div className="empty-state">
                  <div className="empty-icon">✓</div>
                  <h3>No legacy lines</h3>
                  <p>Nothing owned by you is missing a Work Done record.</p>
                </div>
              )}
            </td>
          </tr>
        ) : rows.map((r, idx) => (
          <tr key={r.name} style={idx >= displayLimit ? { display: "none" } : undefined}>
            <td><input type="checkbox" checked={selectedRows.has(r.name)} onChange={() => onToggleRow(r.name)} /></td>
            <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{r.poid || r.name}</td>
            <td>{r.po_no || "—"}</td>
            <td title={r.project_name || ""}>{r.project_code || "—"}</td>
            <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{r.site_code || "—"}</td>
            <td style={{ fontFamily: "monospace", fontSize: "0.78rem", whiteSpace: "nowrap" }}>{r.item_code || "—"}</td>
            <td style={{ fontSize: "0.82rem", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.item_description || ""}>{r.item_description || "—"}</td>
            <td style={{ fontSize: "0.82rem", whiteSpace: "nowrap" }}>{r.activity_type || "—"}</td>
            <td><PoStatusBadge value={r.dispatch_status} /></td>
            <td><PicStatusBadge value={r.pic_status} /></td>
            <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.ms1_amount != null ? money.format(r.ms1_amount) : "—"}</td>
            <td><PicStatusBadge value={r.pic_status_ms2} /></td>
            <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.ms2_amount != null ? money.format(r.ms2_amount) : "—"}</td>
            <td style={{ textAlign: "right" }}>{r.doc_count > 0 ? `📎 ${r.doc_count}` : "—"}</td>
            <td style={{ fontSize: "0.8rem", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.im_confirmation_note || ""}>{r.im_confirmation_note || "—"}</td>
            <td style={{ fontSize: "0.78rem", color: "#64748b", whiteSpace: "nowrap" }}>{fmtTimestamp(r.modified)}</td>
            <td><button type="button" className="btn-secondary" style={{ fontSize: "0.75rem", padding: "3px 10px" }} onClick={() => onView(r)}>View</button></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function IMWorkDone() {
  const { imName } = useAuth();
  const { rowLimit, setRowLimit } = useTableRowLimit();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  // Remembers what the LAST real server fetch actually returned, and under
  // what limit + filters. Shrinking the row limit (e.g. All -> 20) never
  // needs another round-trip — the rows are already in memory. Signature
  // includes `tab` (via filters.tab below) so switching tabs still always
  // refetches — only a limit-only shrink on the SAME tab is skipped. See
  // PICTracker.jsx for the reference implementation.
  const lastFetchRef = useRef({ signature: null, limit: null, rows: [], refreshKey: null });
  const [search, setSearch] = useState("");
  const searchDebounced = useDebounced(search, 300);
  const [submissionFilter, setSubmissionFilter] = useState([]);
  const [execStatusFilter, setExecStatusFilter] = useState([]);
  const [projectFilter, setProjectFilter] = useState([]);
  const [duidFilter, setDuidFilter] = useState([]);
  const [subconFilter, setSubconFilter] = useState([]);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [selectedRows, setSelectedRows] = useState(new Set());
  const [submissionFor, setSubmissionFor] = useState(null);
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkDoc1Files, setBulkDoc1Files] = useState([]);
  const [bulkDoc2Files, setBulkDoc2Files] = useState([]);
  const [bulkDoc2PartFiles, setBulkDoc2PartFiles] = useState([]);
  const [bulkImNote, setBulkImNote] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkErr, setBulkErr] = useState(null);
  const [bulkResult, setBulkResult] = useState(null);
  const [detailRow, setDetailRow] = useState(null);
  const [submissionPick, setSubmissionPick] = useState("");
  const [submissionBusy, setSubmissionBusy] = useState(false);
  const [submissionErr, setSubmissionErr] = useState(null);
  const [submissionWarn, setSubmissionWarn] = useState(null);
  const [doc1Files, setDoc1Files] = useState([]);
  const [doc2Files, setDoc2Files] = useState([]);
  const [doc2PartFiles, setDoc2PartFiles] = useState([]);
  const [doc1Links, setDoc1Links] = useState([]);
  const [doc2Links, setDoc2Links] = useState([]);
  const [doc2PartLinks, setDoc2PartLinks] = useState([]);
  const [imNote, setImNote] = useState("");
  const [existingAttachments, setExistingAttachments] = useState([]);
  const [attachLoading, setAttachLoading] = useState(false);
  const [detailAttachments, setDetailAttachments] = useState([]);
  const [detailAttachLoading, setDetailAttachLoading] = useState(false);
  const [issueFlagFor, setIssueFlagFor] = useState(null);
  const [issueFlagPick, setIssueFlagPick] = useState("");
  const [issueFlagBusy, setIssueFlagBusy] = useState(false);
  const [issueFlagErr, setIssueFlagErr] = useState(null);
  const [issueFlagFilter, setIssueFlagFilter] = useState([]);
  const [sourceFilter, setSourceFilter] = useState([]);
  const [bulkIssueFlagOpen, setBulkIssueFlagOpen] = useState(false);
  const [bulkIssueFlagPick, setBulkIssueFlagPick] = useState("");
  const [bulkIssueFlagBusy, setBulkIssueFlagBusy] = useState(false);
  const [bulkIssueFlagErr, setBulkIssueFlagErr] = useState(null);
  const [bulkIssueFlagResult, setBulkIssueFlagResult] = useState(null);
  const [tab, setTab] = useState("active"); // "all" | "active" | "confirmed" | "pic_rejected" | "legacy"
  // "All" is stored per-path, not per-tab, so without this it silently
  // carries over to whichever tab you switch to next — re-triggering an
  // unlimited fetch+render for a tab the user never asked "All" for on this
  // occasion. Track which tab "All" was actually confirmed for; any OTHER
  // tab falls back to the normal default limit until explicitly re-picked.
  const confirmedAllTabRef = useRef(rowLimit === TABLE_ROW_LIMIT_ALL ? tab : null);
  const effectiveRowLimit = rowLimit === TABLE_ROW_LIMIT_ALL && confirmedAllTabRef.current !== tab
    ? TABLE_ROW_LIMIT_DEFAULT
    : rowLimit;
  const confirmRowLimit = useCallback((n) => {
    confirmedAllTabRef.current = tab;
    setRowLimit(n);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, setRowLimit]);

  // ── Manage Table column filters ──────────────────────────────────────
  // Each column's typed value is matched only against that column's own
  // value on the backend (see column_filters / col_filter_map in
  // list_work_done_rows / list_legacy_milestones_needing_resubmission), not
  // blended into the top search box's wide multi-column search.
  // One load effect serves every tab (table-key is `im-workdone-v1-${tab}`
  // for Work Done, `im-workdone-v1-legacy` for the legacy table), so match
  // any of those variants rather than one fixed key.
  const [columnFilters, setColumnFilters] = useState({});
  useEffect(() => {
    const onFiltersChanged = (e) => {
      if (!e.detail?.tableKey?.startsWith("im-workdone-v1-")) return;
      setColumnFilters(e.detail.filters || {});
    };
    document.addEventListener("tablepro:filters-changed", onFiltersChanged);
    return () => document.removeEventListener("tablepro:filters-changed", onFiltersChanged);
  }, []);
  // Excel column-filter dropdowns cascade off exactly the query the rows
  // were fetched with (recorded by the fetch effect below). Tabs share the
  // im-workdone-v1-* key prefix, same as the filters listener above.
  // Published for the header summary — see usePublishedQuery.
  const [summaryQuery, publishSummaryQuery] = usePublishedQuery();
  const queryArgsRef = useRef({});
  const legacyQueryArgsRef = useRef({});
  useEffect(() => {
    const onRequestOptions = (e) => {
      if (!e.detail?.tableKey?.startsWith("im-workdone-v1-")) return;
      // The "Resubmit to PIC" tab is a different dataset (and backend) from
      // the other tabs, so it answers from its own source + recorded query.
      const isLegacy = e.detail.tableKey === "im-workdone-v1-legacy";
      e.detail.respond(pmApi.getColumnFilterOptions({
        source: isLegacy ? "legacy_resubmit" : "work_done",
        col_key: e.detail.colKey,
        bucket: e.detail.bucket,
        search: e.detail.search,
        limit: e.detail.limit,
        portal_filters: isLegacy ? legacyQueryArgsRef.current : queryArgsRef.current,
        exclude_column: e.detail.colKey,
      }));
    };
    document.addEventListener("tablepro:request-column-options", onRequestOptions);
    return () => document.removeEventListener("tablepro:request-column-options", onRequestOptions);
  }, []);
  // Either a legacy substring string or the Excel-style { values, blanks,
  // contains } object. String(obj) is "[object Object]" — always truthy — so
  // an emptied Excel selection would never clear without this.
  const activeColumnFilters = Object.fromEntries(
    Object.entries(columnFilters).filter(([, v]) => (
      v && typeof v === "object"
        ? (Array.isArray(v.values) && v.values.some((x) => String(x ?? "").trim()))
          || !!v.blanks || !!String(v.contains || "").trim()
        : String(v || "").trim()
    ))
  );
  const columnFiltersKey = JSON.stringify(activeColumnFilters);
  const columnFiltersDebounced = useDebounced(columnFiltersKey, 300);

  // "Resubmit to PIC" tab — legacy lines whose work (and often original PIC
  // submission) already happened historically outside this system, so
  // there's no Work Done record to act through. Separate data source from
  // the Work Done rows above (list_legacy_milestones_needing_resubmission),
  // fetched independently so its tab-badge count stays accurate regardless
  // of which tab is active. Filtered server-side (search/project/DUID/PO
  // status/Manage Table column filters), same as every other tab on this
  // page — never filtered from an already-loaded in-memory list.
  const [legacyRows, setLegacyRows] = useState([]);
  const [legacyLoading, setLegacyLoading] = useState(true);
  const [legacyRefreshKey, setLegacyRefreshKey] = useState(0);
  const loadLegacy = () => setLegacyRefreshKey((k) => k + 1);
  const [legacyPoStatusFilter, setLegacyPoStatusFilter] = useState([]);
  const lastLegacyFetchRef = useRef({ signature: null, limit: null, rows: [] });

  useEffect(() => {
    let cancelled = false;
    const filters = {};
    if (searchDebounced.trim()) filters.search = searchDebounced.trim();
    if (projectFilter.length) filters.project_code = projectFilter;
    if (duidFilter.length) filters.site_code = duidFilter;
    if (legacyPoStatusFilter.length) filters.dispatch_status = legacyPoStatusFilter;
    const colFilters = JSON.parse(columnFiltersDebounced);
    if (Object.keys(colFilters).length) filters.column_filters = colFilters;
    const signature = JSON.stringify([filters, legacyRefreshKey]);

    const prev = lastLegacyFetchRef.current;
    const alreadyHaveEnough = prev.signature === signature && (
      prev.limit === TABLE_ROW_LIMIT_ALL
      || (effectiveRowLimit !== TABLE_ROW_LIMIT_ALL && effectiveRowLimit <= prev.limit)
    );
    if (alreadyHaveEnough) {
      setLegacyLoading(false);
      return () => { cancelled = true; };
    }

    setLegacyLoading(true);
    legacyQueryArgsRef.current = filters;
    pmApi.listLegacyMilestonesNeedingResubmission(filters, effectiveRowLimit)
      .then((res) => {
        if (cancelled) return;
        const fetchedRows = Array.isArray(res) ? res : [];
        setLegacyRows(fetchedRows);
        lastLegacyFetchRef.current = { signature, limit: effectiveRowLimit, rows: fetchedRows };
      })
      .catch(() => { if (!cancelled) setLegacyRows([]); })
      .finally(() => { if (!cancelled) setLegacyLoading(false); });
    return () => { cancelled = true; };
  }, [legacyRefreshKey, effectiveRowLimit, searchDebounced, projectFilter, duidFilter, legacyPoStatusFilter, columnFiltersDebounced]);

  // Reuses the exact same modal + submitSubmission() as a real Work Done
  // confirmation — submissionFor.is_legacy branches it to
  // resubmitLegacyMilestoneToPic() instead of updateWorkDoneSubmission(),
  // since there's no Work Done record to update.
  function openResubmitLegacy(row, milestone) {
    openSubmissionModal({
      ...row,
      name: null,
      po_dispatch: row.name,
      is_legacy: true,
      milestone,
      submission_status: "Confirmation Done",
    });
  }

  // Bulk resubmit — one "Resubmit" action, milestone auto-detected per
  // selected row from ms1_needs/ms2_needs (a row can contribute 1 or 2
  // targets). Mirrors the "Update Submission" 1-vs-many convention:
  // exactly 1 target opens the full single-line modal above, 2+ opens
  // this lighter bulk modal (shared note + optional shared file).
  const [legacyBulkOpen, setLegacyBulkOpen] = useState(false);
  const [legacyBulkTargets, setLegacyBulkTargets] = useState([]);
  const [legacyBulkDoc1Files, setLegacyBulkDoc1Files] = useState([]);
  const [legacyBulkDoc2Files, setLegacyBulkDoc2Files] = useState([]);
  const [legacyBulkNote, setLegacyBulkNote] = useState("");
  const [legacyBulkBusy, setLegacyBulkBusy] = useState(false);
  const [legacyBulkErr, setLegacyBulkErr] = useState(null);
  const [legacyBulkResult, setLegacyBulkResult] = useState(null);
  const [legacyBulkExistingAttachments, setLegacyBulkExistingAttachments] = useState([]);
  const [legacyBulkAttachLoading, setLegacyBulkAttachLoading] = useState(false);

  function legacyResubmitTargets() {
    const targets = [];
    for (const r of filteredRows) {
      if (!selectedRows.has(r.name)) continue;
      if (r.ms1_needs) targets.push({ row: r, milestone: "MS1" });
      if (r.ms2_needs) targets.push({ row: r, milestone: "MS2" });
    }
    return targets;
  }

  function openLegacyBulkResubmit(targets) {
    setLegacyBulkTargets(targets);
    setLegacyBulkErr(null);
    setLegacyBulkResult(null);
    setLegacyBulkNote("");
    setLegacyBulkDoc1Files([]);
    setLegacyBulkDoc2Files([]);
    setLegacyBulkExistingAttachments([]);
    setLegacyBulkAttachLoading(true);
    const pds = [...new Set(targets.map((t) => t.row.name).filter(Boolean))];
    Promise.all(pds.map((pd) => pmApi.getPoDispatchImAttachments(pd).catch(() => [])))
      .then((results) => {
        const seen = new Set();
        const merged = [];
        results.flat().forEach((f) => { if (f.file_url && !seen.has(f.file_url)) { seen.add(f.file_url); merged.push(f); } });
        setLegacyBulkExistingAttachments(merged);
      })
      .finally(() => setLegacyBulkAttachLoading(false));
    setLegacyBulkOpen(true);
  }

  function handleLegacyResubmitClick() {
    const targets = legacyResubmitTargets();
    if (!targets.length) return;
    if (targets.length === 1) {
      openResubmitLegacy(targets[0].row, targets[0].milestone);
    } else {
      openLegacyBulkResubmit(targets);
    }
  }

  async function submitLegacyBulk() {
    setLegacyBulkBusy(true);
    setLegacyBulkErr(null);
    try {
      const fileUrls = {};
      for (const [slot, files] of [["im_doc1", legacyBulkDoc1Files], ["im_doc2", legacyBulkDoc2Files]]) {
        if (files.length === 0) continue;
        const urls = [];
        for (const file of files) {
          const url = await pmApi.uploadFileGeneric(file);
          if (url) urls.push(url);
        }
        if (urls.length) fileUrls[slot] = urls;
      }
      const items = legacyBulkTargets.map((t) => ({ po_dispatch: t.row.name, milestone: t.milestone, poid: t.row.poid }));
      const res = await pmApi.bulkResubmitLegacyMilestonesToPic({
        items,
        note: legacyBulkNote || undefined,
        file_urls: Object.keys(fileUrls).length ? fileUrls : undefined,
      });
      setLegacyBulkResult(res);
      if (res?.updated > 0) {
        loadLegacy();
        setSelectedRows(new Set());
      }
    } catch (err) {
      setLegacyBulkErr(err.message || "Bulk resubmit failed");
    } finally {
      setLegacyBulkBusy(false);
    }
  }

  const WD_ISSUE_OPTIONS = [
    "", "POD/PPT required", "TFM Check list", "Spare part return",
    "PAT/HO Final Approval", "FPDC/FM Survey report Approval", "Partial Work done",
  ];

  function openIssueFlagModal(r) {
    setIssueFlagErr(null);
    setIssueFlagPick(r.issue_flag || "");
    setIssueFlagFor(r);
  }

  async function submitIssueFlag() {
    if (!issueFlagFor) return;
    setIssueFlagBusy(true);
    setIssueFlagErr(null);
    try {
      await pmApi.updateWorkDoneIssue(issueFlagFor.name, issueFlagPick);
      setIssueFlagFor(null);
      loadData();
    } catch (err) {
      setIssueFlagErr(err.message || "Failed to update issue flag");
    } finally {
      setIssueFlagBusy(false);
    }
  }

  async function submitBulkIssueFlag() {
    setBulkIssueFlagBusy(true);
    setBulkIssueFlagErr(null);
    let updated = 0;
    const errors = [];
    for (const name of selectedRows) {
      try {
        await pmApi.updateWorkDoneIssue(name, bulkIssueFlagPick);
        updated++;
      } catch (err) {
        errors.push({ name, error: err.message || "Failed" });
      }
    }
    setBulkIssueFlagResult({ updated, errors });
    setBulkIssueFlagBusy(false);
    if (updated > 0) loadData();
  }

  function openSubmissionModal(r) {
    setSubmissionErr(null);
    setSubmissionPick(r.submission_status || "");
    setDoc1Files([]);
    setDoc2Files([]);
    setDoc2PartFiles([]);
    setDoc1Links([]);
    setDoc2Links([]);
    setDoc2PartLinks([]);
    setImNote("");
    setExistingAttachments([]);
    setSubmissionFor(r);
    const po_dispatch = r.po_dispatch || r.poid;
    if (po_dispatch) {
      setAttachLoading(true);
      pmApi.getPoDispatchImAttachments(po_dispatch)
        .then((files) => setExistingAttachments(Array.isArray(files) ? files : []))
        .catch(() => {})
        .finally(() => setAttachLoading(false));
    }
  }

  async function submitSubmission() {
    if (!submissionFor) return;
    const needsAttach = submissionPick === "Confirmation Done";
    if (needsAttach && existingAttachments.length === 0) {
      const docReq = DOC_REQUIREMENTS[submissionFor.activity_type];
      if (doc1Files.length === 0 && doc1Links.length === 0) {
        const doc1Label = docReq?.doc1Label || "Confirmation Mail";
        setSubmissionErr(`DOC1 (${doc1Label}) is required for Confirmation Done.`);
        return;
      }
      if (docReq?.doc2) {
        const hasDoc2 = docReq.doc2.parts
          ? doc2PartFiles.flat().filter(Boolean).length + doc2PartLinks.flat().filter(Boolean).length > 0
          : doc2Files.length + doc2Links.length > 0;
        if (!hasDoc2) {
          setSubmissionErr(`DOC2 (${docReq.doc2.label}) is required for this activity type.`);
          return;
        }
      }
    }
    setSubmissionBusy(true);
    setSubmissionErr(null);
    try {
      const docname = (submissionFor.is_subcon || submissionFor.is_legacy) ? (submissionFor.po_dispatch || submissionFor.poid) : submissionFor.name;
      const po_dispatch = submissionFor.po_dispatch || submissionFor.poid;
      if (!docname) throw new Error("Missing document reference");
      if (!po_dispatch) throw new Error("Missing PO Dispatch reference");
      const docReqUp = DOC_REQUIREMENTS[submissionFor.activity_type];
      for (const file of doc1Files) await pmApi.uploadImAttachment(po_dispatch, file, "im_doc1");
      for (const link of doc1Links) await pmApi.attachImLink(po_dispatch, link.url, link.name, "im_doc1");
      if (docReqUp?.doc2?.parts) {
        for (let i = 0; i < docReqUp.doc2.parts.length; i++) {
          for (const file of (doc2PartFiles[i] || [])) {
            await pmApi.uploadImAttachment(po_dispatch, file, docReqUp.doc2.parts[i].slot);
          }
          for (const link of (doc2PartLinks[i] || [])) {
            await pmApi.attachImLink(po_dispatch, link.url, link.name, docReqUp.doc2.parts[i].slot);
          }
        }
      } else {
        for (const file of doc2Files) await pmApi.uploadImAttachment(po_dispatch, file, "im_doc2");
        for (const link of doc2Links) await pmApi.attachImLink(po_dispatch, link.url, link.name, "im_doc2");
      }
      let res;
      if (submissionFor.is_legacy) {
        res = await pmApi.resubmitLegacyMilestoneToPic(po_dispatch, submissionFor.milestone, imNote || undefined);
      } else if (submissionFor.is_subcon) {
        res = await pmApi.updateSubconSubmission(docname, submissionPick, imNote || undefined);
      } else {
        res = await pmApi.updateWorkDoneSubmission(submissionFor.name, submissionPick, imNote || undefined);
      }
      window.dispatchEvent(new CustomEvent("inet:notifications-changed"));
      setSubmissionFor(null);
      if (res?.pic_warning) setSubmissionWarn(res.pic_warning);
      if (submissionFor.is_legacy) loadLegacy(); else loadData();
    } catch (err) {
      setSubmissionErr(err.message || "Failed to update submission status");
    } finally {
      setSubmissionBusy(false);
    }
  }

  const [refreshKey, setRefreshKey] = useState(0);
  const loadData = () => setRefreshKey((k) => k + 1);

  async function submitBulk() {
    setBulkBusy(true);
    setBulkErr(null);
    try {
      const fileUrls = {};
      const bulkSelectedList = filteredRows.filter((r) => selectedRows.has(r.name));
      const actTypes = [...new Set(bulkSelectedList.map((r) => r.activity_type).filter(Boolean))];
      const bulkDocReq = actTypes.length === 1 ? (DOC_REQUIREMENTS[actTypes[0]] || null) : null;

      const uploadAll = async (files) => {
        const urls = [];
        for (const file of files) {
          const url = await pmApi.uploadFileGeneric(file);
          if (url) urls.push(url);
        }
        return urls;
      };

      if (bulkDoc1Files.length > 0) {
        const urls = await uploadAll(bulkDoc1Files);
        if (urls.length) fileUrls.im_doc1 = urls;
      }
      if (bulkDocReq?.doc2?.parts) {
        for (let i = 0; i < bulkDocReq.doc2.parts.length; i++) {
          const files = bulkDoc2PartFiles[i] || [];
          if (files.length > 0) {
            const urls = await uploadAll(files);
            if (urls.length) fileUrls[bulkDocReq.doc2.parts[i].slot] = urls;
          }
        }
      } else if (bulkDoc2Files.length > 0) {
        const urls = await uploadAll(bulkDoc2Files);
        if (urls.length) fileUrls.im_doc2 = urls;
      }
      const res = await pmApi.bulkSubmitWorkDone({
        work_done_names: [...selectedRows],
        submission_status: bulkStatus,
        note: bulkImNote || undefined,
        file_urls: Object.keys(fileUrls).length ? fileUrls : undefined,
      });
      setBulkResult(res);
      loadData();
    } catch (err) {
      setBulkErr(err.message || "Bulk submit failed");
    } finally {
      setBulkBusy(false);
    }
  }

  // Single useEffect with cancellation guard. Replaces the older
  // useResetOnRowLimitChange + separate-load pattern that left the table
  // blank when going from a higher to a lower row limit.
  useEffect(() => {
    // "legacy" has its own separate fetch (list_legacy_milestones_needing_resubmission)
    // — this endpoint doesn't recognize that tab value and would just return
    // everything unfiltered, so skip the wasted round-trip entirely.
    if (tab === "legacy") { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const filters = { im: imName || "", tab };
        if (searchDebounced.trim()) filters.search = searchDebounced.trim();
        const colFilters = JSON.parse(columnFiltersDebounced);
        if (Object.keys(colFilters).length) filters.column_filters = colFilters;
        if (projectFilter.length) filters.project_code = projectFilter;
        if (duidFilter.length) filters.site_code = duidFilter;
        if (subconFilter.length) filters.subcontractor = subconFilter;
        if (fromDate) filters.from_date = fromDate;
        if (toDate) filters.to_date = toDate;
        if (sourceFilter.length) filters.source = sourceFilter;
        if (submissionFilter.length) filters.submission_status = submissionFilter;
        if (execStatusFilter.length) filters.execution_status = execStatusFilter;
        if (issueFlagFilter.length) filters.issue_flag = issueFlagFilter;
        const signature = JSON.stringify([filters]);

        const prev = lastFetchRef.current;
        // refreshKey must match too — a post-action reload bumps refreshKey
        // with filters unchanged, so a signature-only check would wrongly
        // treat that as "same filters, already have enough" and skip the
        // refetch, leaving the table showing stale data until a reload.
        const alreadyHaveEnough = prev.signature === signature && prev.refreshKey === refreshKey && (
          prev.limit === TABLE_ROW_LIMIT_ALL
          || (effectiveRowLimit !== TABLE_ROW_LIMIT_ALL && effectiveRowLimit <= prev.limit)
        );
        if (alreadyHaveEnough) {
          // Same tab + filters, already have at least this many rows from a
          // larger (or equal) fetch — show fewer via the CSS-hide render
          // below instead, no re-fetch and no state mutation.
          return;
        }

        setLoading(true);
        queryArgsRef.current = filters;
        publishSummaryQuery(filters);
        const list = await pmApi.listWorkDoneRows(filters, effectiveRowLimit);
        if (cancelled) return;
        const fetchedRows = Array.isArray(list) ? list : [];
        setRows(fetchedRows);
        lastFetchRef.current = { signature, limit: effectiveRowLimit, rows: fetchedRows, refreshKey };
      } catch {
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [imName, effectiveRowLimit, searchDebounced, projectFilter, duidFilter, subconFilter, fromDate, toDate, refreshKey, columnFiltersDebounced, sourceFilter, submissionFilter, execStatusFilter, issueFlagFilter, tab]);

  // PIC Rejected tab badge — fetched independently of `tab`/`rows` because
  // the backend now scopes list_work_done_rows to whichever tab is active
  // (see that function's own comment), so deriving the count from `rows`
  // only happened to be right while sitting on the "pic_rejected" tab
  // itself (and hidden there) — every other tab showed 0 or stale data.
  const [picRejectedBadgeCount, setPicRejectedBadgeCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    pmApi.listWorkDoneRows({ im: imName || "", tab: "pic_rejected" }, rowLimit)
      .then((list) => { if (!cancelled) setPicRejectedBadgeCount(Array.isArray(list) ? list.length : 0); })
      .catch(() => { if (!cancelled) setPicRejectedBadgeCount(0); });
    return () => { cancelled = true; };
  }, [imName, rowLimit, refreshKey]);

  useEffect(() => {
    if (!detailRow) { setDetailAttachments([]); return; }
    const po_dispatch = detailRow.po_dispatch || detailRow.poid;
    if (!po_dispatch) return;
    setDetailAttachLoading(true);
    pmApi.getPoDispatchImAttachments(po_dispatch)
      .then((files) => setDetailAttachments(Array.isArray(files) ? files : []))
      .catch(() => {})
      .finally(() => setDetailAttachLoading(false));
  }, [detailRow]);

  useEffect(() => { setSelectedRows(new Set()); setSubmissionFilter([]); setColumnFilters({}); setLegacyPoStatusFilter([]); }, [tab]);

  const tabRows = useMemo(() => {
    if (tab === "legacy") return legacyRows;
    // "all" is fetched with the backend's own tab="all" scope (bypasses the
    // active/confirmed/pic_rejected split entirely — see the fetch effect
    // below), so `rows` already IS the combined set; no client-side
    // submission_status filtering needed on top of it.
    if (tab === "all") return rows;
    if (tab === "confirmed") return rows.filter((r) => r.submission_status === "Confirmation Done");
    if (tab === "pic_rejected") return rows.filter((r) => r.submission_status === "PIC Rejected" || !!r.pic_rejection_remark);
    return rows.filter((r) => r.submission_status !== "Confirmation Done" && r.submission_status !== "PIC Rejected" && !r.pic_rejection_remark);
  }, [rows, legacyRows, tab]);

  const filteredRows = useMemo(() => tabRows.filter((r) => {
    // legacy rows are already filtered server-side (search/project/DUID/PO
    // status/column filters all passed to list_legacy_milestones_needing_resubmission)
    if (tab === "legacy") return true;
    if (submissionFilter.length) {
      const sub = r.submission_status || "";
      const wantsNone = submissionFilter.includes("__NONE__");
      const nonNone = submissionFilter.filter((v) => v !== "__NONE__");
      const match = (wantsNone && !sub) || nonNone.includes(sub);
      if (!match) return false;
    }
    if (execStatusFilter.length && !execStatusFilter.includes(r.execution_status || "")) return false;
    if (issueFlagFilter.length) {
      const wantsNone = issueFlagFilter.includes("__NONE__");
      const nonNone = issueFlagFilter.filter((v) => v !== "__NONE__");
      const flag = r.issue_flag || "";
      if (!((wantsNone && !flag) || nonNone.includes(flag))) return false;
    }
    if (sourceFilter.length && !sourceFilter.includes(r.source || "")) return false;
    return true;
  }), [tabRows, tab, submissionFilter, execStatusFilter, issueFlagFilter, sourceFilter]);

  // See useProgressiveRows — mounts large row sets in chunks so the browser
  // doesn't show "Page Unresponsive" on tables with "All" rows loaded.
  const visibleRows = useProgressiveRows(filteredRows, { paused: tab === "legacy" ? legacyLoading : loading });
  // How many of `visibleRows` to actually show — anything beyond this is
  // hidden via CSS in the render below rather than removed from `rows`/
  // `legacyRows` (see the skip-fetch caches above / PICTracker.jsx).
  const displayLimit = effectiveRowLimit === TABLE_ROW_LIMIT_ALL ? Infinity : effectiveRowLimit;
  const displayedCount = Math.min(filteredRows.length, displayLimit);
  // Pre-client-filter count, capped the same way — used for the footer's
  // "Loaded X" figure (distinct from filteredRows' "matches filter" count).
  const displayedTabCount = Math.min(tabRows.length, displayLimit);

  const selectedRow = selectedRows.size === 1 ? (filteredRows.find((r) => selectedRows.has(r.name)) || null) : null;
  const bulkActTypes = [...new Set(filteredRows.filter((r) => selectedRows.has(r.name)).map((r) => r.activity_type).filter(Boolean))];
  const bulkDocReq = bulkActTypes.length === 1 ? (DOC_REQUIREMENTS[bulkActTypes[0]] || null) : null;

  const { options: dispOpts } = useFilterOptions("PO Dispatch", ["project_code", "site_code", "contract"]);
  const projectOptions = dispOpts.project_code || [];
  const duidOptions = dispOpts.site_code || [];
  const subconOptions = (dispOpts.contract || []).filter(Boolean).map((v) => ({ id: v, label: v }));
  const hasFilters = !!(search || submissionFilter.length || execStatusFilter.length || issueFlagFilter.length || sourceFilter.length || projectFilter.length || duidFilter.length || subconFilter.length || fromDate || toDate || legacyPoStatusFilter.length);

  const totals = filteredRows.slice(0, displayedCount).reduce(
    (acc, r) => ({
      lineAmount: acc.lineAmount + (parseFloat(r.line_amount) || 0),
      revenue: acc.revenue + (parseFloat(r.revenue_sar) || 0),
    }),
    { lineAmount: 0, revenue: 0 }
  );

  function tabStyle(active) {
    return {
      padding: "8px 20px", fontSize: "0.86rem", fontWeight: 700, border: "none",
      borderBottom: active ? "2px solid #1d4ed8" : "2px solid transparent",
      background: "none", cursor: "pointer", color: active ? "#1d4ed8" : "#64748b",
      transition: "color 120ms",
    };
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Work Done</h1>
          <div className="page-subtitle">
            {tab === "all" ? "Every work row for your IM scope, including closed and fully-invoiced ones. The other tabs hide those as resolved." : tab === "confirmed" ? "Lines confirmed by PIC." : tab === "pic_rejected" ? "Lines rejected by PIC." : "Active work rows for your IM scope."}
          </div>
        </div>
        <PageSummary source="work_done" filters={summaryQuery} />
        <div className="page-actions">
          <ExportExcelButton filename="im-work-done" rows={filteredRows.slice(0, displayedCount)} />
          <button className="btn-secondary" onClick={loadData} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", borderBottom: "1px solid #e2e8f0", margin: "0 0 2px", paddingLeft: 4 }}>
        <button type="button" style={tabStyle(tab === "all")} onClick={() => setTab("all")}>All</button>
        <button type="button" style={tabStyle(tab === "active")} onClick={() => setTab("active")}>Active</button>
        <button type="button" style={tabStyle(tab === "confirmed")} onClick={() => setTab("confirmed")}>Confirmation Done</button>
        <button type="button" style={tabStyle(tab === "pic_rejected")} onClick={() => setTab("pic_rejected")}>
          PIC Rejected
          {picRejectedBadgeCount > 0 && tab !== "pic_rejected" && (
            <span style={{ marginLeft: 6, background: "#fee2e2", color: "#991b1b", borderRadius: 999, padding: "0px 7px", fontSize: 11, fontWeight: 700 }}>{picRejectedBadgeCount}</span>
          )}
        </button>
        <button type="button" style={tabStyle(tab === "legacy")} onClick={() => setTab("legacy")}>Resubmit to PIC</button>
      </div>
      <div className="toolbar">
        <input
          type="search"
          placeholder="Search POID, dummy POID, execution, project, DUID, item…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onPaste={(e) => handleSearchPaste(e, setSearch)}
          style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem", minWidth: 240 }}
        />
        {tab === "active" && (
          <SearchableSelect
              allowBlank
            multi
            value={submissionFilter}
            onChange={setSubmissionFilter}
            options={[{ id: "__NONE__", label: "Not set" }, { id: "Ready for Confirmation", label: "Ready for Confirmation" }]}
            placeholder="All Submission"
            minWidth={150}
          />
        )}
        {tab !== "legacy" && (
        <SearchableSelect
              allowBlank
          multi
          value={issueFlagFilter}
          onChange={setIssueFlagFilter}
          options={[{ id: "__NONE__", label: "No flag" }, ...WD_ISSUE_OPTIONS.filter(Boolean).map((o) => ({ id: o, label: o }))]}
          placeholder="All Issue Flags"
          minWidth={150}
        />
        )}
        {tab !== "legacy" && (
        <SearchableSelect
              allowBlank
          multi
          value={execStatusFilter}
          onChange={setExecStatusFilter}
          options={EXECUTION_STATUS_OPTIONS}
          placeholder="All Exec Status"
          minWidth={150}
        />
        )}
        <SearchableSelect
              allowBlank multi value={projectFilter} onChange={setProjectFilter} options={projectOptions} placeholder="All Projects" minWidth={170} />
        <SearchableSelect
              allowBlank multi value={duidFilter} onChange={setDuidFilter} options={duidOptions} placeholder="All DUIDs" minWidth={150} />
        {tab !== "legacy" && (
        <SearchableSelect
              allowBlank multi value={subconFilter} onChange={setSubconFilter} options={subconOptions} placeholder="All Subcontractors" minWidth={170} />
        )}
        {tab === "legacy" && (
          <SearchableSelect
              allowBlank
            multi
            value={legacyPoStatusFilter}
            onChange={setLegacyPoStatusFilter}
            options={["Completed", "Partially Submitted", "Submitted", "Partially Closed", "Closed"]}
            placeholder="All PO Status"
            minWidth={140}
          />
        )}
        {tab !== "legacy" && (
        <DateRangePicker value={{ from: fromDate, to: toDate }} onChange={({ from, to }) => { setFromDate(from); setToDate(to); }} />
        )}
        {tab !== "legacy" && (
        <SearchableSelect
              allowBlank
          multi
          value={sourceFilter}
          onChange={setSourceFilter}
          options={[
            { id: "Rollout Execution", label: "Rollout Execution" },
            { id: "Backend", label: "Backend" },
            { id: "Direct Close", label: "Direct Close" },
          ]}
          placeholder="All Sources"
          minWidth={140}
        />
        )}
        {hasFilters && (
          <button
            className="btn-secondary"
            style={{ fontSize: "0.78rem", padding: "5px 12px" }}
            onClick={() => { setSearch(""); setSubmissionFilter([]); setExecStatusFilter([]); setIssueFlagFilter([]); setSourceFilter([]); setProjectFilter([]); setDuidFilter([]); setSubconFilter([]); setFromDate(""); setToDate(""); setLegacyPoStatusFilter([]); }}
          >
            Clear
          </button>
        )}
        {tab !== "legacy" && (
        <div className="toolbar-actions">
          {selectedRows.size > 0 && (
            <span style={{ fontSize: "0.78rem", color: "#64748b", whiteSpace: "nowrap" }}>
              {selectedRows.size} selected
            </span>
          )}
          <button
            type="button"
            className="btn-secondary"
            disabled={selectedRows.size === 0}
            style={selectedRows.size > 0 ? { borderColor: "#f59e0b", color: "#b45309", background: "#fffbeb" } : {}}
            onClick={() => { setBulkIssueFlagPick(""); setBulkIssueFlagErr(null); setBulkIssueFlagResult(null); setBulkIssueFlagOpen(true); }}
          >
            Issue Flag{selectedRows.size > 0 ? ` (${selectedRows.size})` : ""}
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={selectedRows.size === 0}
            onClick={() => {
              if (selectedRows.size === 1) {
                openSubmissionModal(selectedRow);
              } else {
                setBulkErr(null); setBulkStatus(""); setBulkDoc1Files([]); setBulkDoc2Files([]);
                setBulkImNote(""); setBulkResult(null); setBulkDoc2PartFiles([]);
                setExistingAttachments([]); setAttachLoading(true);
                const pds = [...new Set(
                  filteredRows.filter((r) => selectedRows.has(r.name))
                    .map((r) => r.po_dispatch || r.poid).filter(Boolean)
                )];
                Promise.all(pds.map((pd) => pmApi.getPoDispatchImAttachments(pd).catch(() => [])))
                  .then((results) => {
                    const seen = new Set();
                    const merged = [];
                    results.flat().forEach((f) => { if (f.file_url && !seen.has(f.file_url)) { seen.add(f.file_url); merged.push(f); } });
                    setExistingAttachments(merged);
                  })
                  .finally(() => setAttachLoading(false));
                setBulkModalOpen(true);
              }
            }}
          >
            Update Submission{selectedRows.size > 1 ? ` (${selectedRows.size})` : ""}
          </button>
        </div>
        )}
        {tab === "legacy" && (
        <div className="toolbar-actions">
          {selectedRows.size > 0 && (
            <span style={{ fontSize: "0.78rem", color: "#64748b", whiteSpace: "nowrap" }}>
              {selectedRows.size} selected
            </span>
          )}
          <button
            type="button"
            className="btn-primary"
            disabled={legacyResubmitTargets().length === 0}
            onClick={handleLegacyResubmitClick}
          >
            Resubmit to PIC{(() => {
              const n = legacyResubmitTargets().length;
              return n > 0 ? ` (${n})` : "";
            })()}
          </button>
        </div>
        )}
      </div>
      <div className="page-content">
        <DataTableWrapper loading={tab === "legacy" ? (legacyLoading && legacyRows.length > 0) : (loading && rows.length > 0)}>
          {tab === "legacy" ? (
            <LegacyResubmitTable
              rows={visibleRows}
              displayLimit={displayLimit}
              loading={legacyLoading}
              selectedRows={selectedRows}
              onToggleRow={(name) => setSelectedRows((prev) => { const next = new Set(prev); next.has(name) ? next.delete(name) : next.add(name); return next; })}
              onToggleAll={() => {
                const dtpHidden = new Set(Array.from(document.querySelectorAll("tbody tr[data-tablepro-filtered]")).map((tr) => tr.dataset.docName).filter(Boolean));
                const visible = filteredRows.slice(0, displayedCount).filter((r) => !dtpHidden.has(r.name));
                const allSel = visible.length > 0 && visible.every((r) => selectedRows.has(r.name));
                setSelectedRows(allSel ? new Set() : new Set(visible.map((r) => r.name)));
              }}
              onView={(r) => setDetailRow({ ...r, po_dispatch: r.name })}
            />
          ) : (
          <>
            <table key={`im-workdone-v1-${tab}`} className="data-table" data-excel-filter-all="1" data-table-key={`im-workdone-v1-${tab}`}>
              <thead>
                <tr>
                  <th style={{ width: 36 }}>
                    <input
                      type="checkbox"
                      checked={displayedCount > 0 && filteredRows.slice(0, displayedCount).every((r) => selectedRows.has(r.name))}
                      ref={(el) => { if (el) el.indeterminate = selectedRows.size > 0 && !filteredRows.slice(0, displayedCount).every((r) => selectedRows.has(r.name)); }}
                      onChange={() => {
                        const dtpHidden = new Set(Array.from(document.querySelectorAll("tbody tr[data-tablepro-filtered]")).map((tr) => tr.dataset.docName).filter(Boolean));
                        const visible = filteredRows.slice(0, displayedCount).filter((r) => !dtpHidden.has(r.name));
                        const allSel = visible.length > 0 && visible.every((r) => selectedRows.has(r.name));
                        setSelectedRows(allSel ? new Set() : new Set(visible.map((r) => r.name)));
                      }}
                      title={filteredRows.slice(0, displayedCount).every((r) => selectedRows.has(r.name)) ? "Deselect all" : "Select all"}
                    />
                  </th>
                  <th>Project Code</th>
                  <th>Project Name</th>
                  <th>Domain</th>
                  <th>Huawei IM</th>
                  <th>POID</th>
                  <th>DUID</th>
                  <th>Item Code</th>
                  <th>Item Description</th>
                  <th>Activity Type</th>
                  <th style={{ textAlign: "right" }}>Line Amount</th>
                  <th>Region</th>
                  <th>INET IM</th>
                  <th>Planning Timestamp</th>
                  <th style={{ textAlign: "right" }}>Dispatch Seq</th>
                  <th>Plan Date</th>
                  <th>Assigned Team</th>
                  <th>Subcontract</th>
                  <th>Contract Model</th>
                  <th>Dispatch Status</th>
                  <th>Execution Date</th>
                  <th>Execution Status</th>
                  <th style={{ textAlign: "right" }} title="Attempt / visit number">Attempt #</th>
                  <th>CIAG</th>
                  <th>QC</th>
                  <th>Execution Remarks</th>
                  <th title="Remark set by PM">General</th>
                  <th title="Remark set by IM">Manager</th>
                  <th title="Remark set by Field Team Lead">Team Lead</th>
                  <th style={{ textAlign: "right" }}>Revenue</th>
                  <th>Submission Status</th>
                  <th>PIC Rejection Reason</th>
                  <th>Source</th>
                  <th title="Which milestones are closed for this Work Done">Milestone</th>
                  <th>Issue Flag</th>
                  <th data-excel-filter="0">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((r, idx) => (
                  <tr
                    key={r.name}
                    data-doc-name={r.name}
                    data-modified={r.modified}
                    className={selectedRows.has(r.name) ? "row-selected" : ""}
                    onClick={() => setSelectedRows((prev) => { const next = new Set(prev); next.has(r.name) ? next.delete(r.name) : next.add(r.name); return next; })}
                    style={idx >= displayedCount ? { display: "none" } : { cursor: "pointer", ...(r.is_dummy_po ? { background: "#fffbeb" } : {}) }}
                  >
                    <td style={{ width: 36, padding: "6px 4px", textAlign: "center", boxSizing: "border-box" }} onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedRows.has(r.name)}
                        onChange={() => setSelectedRows((prev) => { const next = new Set(prev); next.has(r.name) ? next.delete(r.name) : next.add(r.name); return next; })}
                      />
                    </td>
                    <td>{r.project_code || "—"}</td>
                    <td style={{ fontSize: "0.82rem", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.project_name || ""}>{r.project_name || "—"}</td>
                    <td>{r.project_domain || "—"}</td>
                    <td>{r.huawei_im || "—"}</td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{r.poid || r.po_dispatch || "—"}</td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{r.site_code || "—"}</td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem", whiteSpace: "nowrap" }}>{r.item_code || "—"}</td>
                    <td style={{ fontSize: "0.82rem", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.item_description || ""}>{r.item_description || "—"}</td>
                    <td style={{ fontSize: "0.82rem", whiteSpace: "nowrap" }}>{r.activity_type || "—"}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.line_amount != null ? money.format(r.line_amount) : "—"}</td>
                    <td><StatusPill value={r.region_type} /></td>
                    <td style={{ fontSize: "0.82rem" }}>{r.im_full_name || r.im || "—"}</td>
                    <td style={{ fontSize: "0.78rem", color: "#64748b" }}>{fmtTimestamp(r.planning_timestamp)}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.dispatch_seq != null ? r.dispatch_seq : "—"}</td>
                    <td>{r.plan_date || "—"}</td>
                    <td>{r.team_name || r.team || "—"}</td>
                    <td style={{ fontSize: "0.82rem" }}>{r.subcontractor || "—"}</td>
                    <td style={{ fontSize: "0.82rem" }}>{r.contract_model || "—"}</td>
                    <td><PoStatusBadge value={r.dispatch_status} /></td>
                    <td>{r.execution_date || "—"}</td>
                    <td><StatusPill value={r.execution_status} /></td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{r.visit_number != null ? r.visit_number : "—"}</td>
                    <td><StatusPill value={r.ciag_status} /></td>
                    <td><StatusPill value={r.qc_status} /></td>
                    <td style={{ fontSize: "0.82rem", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.execution_remarks || ""}>{r.execution_remarks || "—"}</td>
                    <td onClick={(e) => e.stopPropagation()}><RemarksCell value={r.general_remark} tone="general" poDispatch={r.po_dispatch || r.poid} poid={r.poid || r.po_dispatch} onSaved={(v) => { r.general_remark = v; }} /></td>
                    <td onClick={(e) => e.stopPropagation()}><RemarksCell value={r.manager_remark} tone="manager" poDispatch={r.po_dispatch || r.poid} poid={r.poid || r.po_dispatch} onSaved={(v) => { r.manager_remark = v; }} /></td>
                    <td onClick={(e) => e.stopPropagation()}><RemarksCell value={r.team_lead_remark} tone="team_lead" poDispatch={r.po_dispatch || r.poid} poid={r.poid || r.po_dispatch} onSaved={(v) => { r.team_lead_remark = v; }} /></td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money.format(r.revenue_sar || 0)}</td>
                    <td><StatusPill value={r.submission_status} /></td>
                    <td style={{ fontSize: "0.78rem", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: r.pic_rejection_remark ? "#b91c1c" : "#94a3b8" }} title={r.pic_rejection_remark || ""}>{r.pic_rejection_remark || "—"}</td>
                    <td>
                      {r.source === "Direct Close" && <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: "0.72rem", fontWeight: 700, background: "#dbeafe", color: "#0369a1", border: "1px solid #93c5fd", whiteSpace: "nowrap" }} title={r.direct_close_by ? `Closed by: ${r.direct_close_by_full_name || r.direct_close_by}` : ""}>Direct Close</span>}
                      {r.source === "Backend" && <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: "0.72rem", fontWeight: 700, background: "#ede9fe", color: "#7c3aed", border: "1px solid #c4b5fd", whiteSpace: "nowrap" }}>Backend</span>}
                      {r.source === "Rollout Execution" && <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: "0.72rem", fontWeight: 700, background: "#dcfce7", color: "#16a34a", border: "1px solid #86efac", whiteSpace: "nowrap" }}>Rollout</span>}
                      {!r.source && <span style={{ color: "#cbd5e1", fontSize: 12 }}>—</span>}
                    </td>
                    <td style={{ fontSize: "0.74rem", whiteSpace: "nowrap" }}>
                      {(() => {
                        const m1 = !!r.ms1_closed, m2 = !!r.ms2_closed;
                        if (!m1 && !m2) return <span style={{ color: "#94a3b8", fontSize: "0.72rem" }}>—</span>;
                        // Per-milestone chip: PIC submission state (empty PIC status = not submitted to PIC)
                        const picState = (s) => {
                          const v = (s || "").trim();
                          if (!v || v === "Work Not Done") return { t: "Not Submitted", bg: "#fef3c7", fg: "#b45309", bd: "#fde68a" };
                          if (v === "Commercial Invoice Closed") return { t: "Inv. Closed", bg: "#dcfce7", fg: "#16a34a", bd: "#86efac" };
                          if (v === "Commercial Invoice Submitted") return { t: "Invoiced", bg: "#dbeafe", fg: "#1d4ed8", bd: "#93c5fd" };
                          if (v.includes("Rejected") || v.includes("Cancel")) return { t: v, bg: "#fee2e2", fg: "#dc2626", bd: "#fecaca" };
                          return { t: "In PIC", bg: "#ede9fe", fg: "#7c3aed", bd: "#c4b5fd" };
                        };
                        const chip = (label, closedAt, pic) => {
                          const c = picState(pic);
                          return (
                            <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: "0.7rem", fontWeight: 700, background: c.bg, color: c.fg, border: `1px solid ${c.bd}`, marginRight: 4, whiteSpace: "nowrap" }}
                              title={`${label} closed: ${String(closedAt || "").slice(0, 10)} · PIC: ${pic || "Not submitted to PIC"}`}>
                              {label} ✓ · {c.t}
                            </span>
                          );
                        };
                        return <>{m1 ? chip("MS1", r.ms1_closed_at, r.pic_status) : null}{m2 ? chip("MS2", r.ms2_closed_at, r.pic_status_ms2) : null}</>;
                      })()}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <IssueFlagCell flag={r.issue_flag} onClick={() => openIssueFlagModal(r)} />
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="btn-secondary"
                        style={{ fontSize: "0.7rem", padding: "3px 8px", whiteSpace: "nowrap" }}
                        onClick={() => setDetailRow(r)}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              {filteredRows.length > 0 && (
                <tfoot>
                  <tr style={{ borderTop: "2px solid #e2e8f0", background: "#f8fafc" }}>
                    <td />
                    <td style={{ fontSize: "0.75rem", fontWeight: 700, color: "#64748b", padding: "8px 12px", whiteSpace: "nowrap" }}>
                      {displayedCount} rows
                    </td>
                    <td /><td /><td /><td /><td /><td /><td /><td />
                    <td style={{ textAlign: "right", fontWeight: 700, padding: "8px 12px", color: "#0f172a" }}>
                      {money.format(totals.lineAmount)}
                    </td>
                    <td /><td /><td /><td /><td /><td /><td /><td /><td /><td /><td /><td /><td /><td /><td /><td /><td /><td />
                    <td style={{ textAlign: "right", fontWeight: 700, padding: "8px 12px", color: "#047857" }}>
                      {money.format(totals.revenue)}
                    </td>
                    <td /><td /><td /><td /><td /><td />
                  </tr>
                </tfoot>
              )}
            </table>
            {loading && rows.length === 0 ? (
              <div style={{ padding: 32, textAlign: "center", color: "#94a3b8" }}>Loading work done…</div>
            ) : !loading && filteredRows.length === 0 ? (
              <div className="empty-state"><h3>{hasFilters ? "No results match your filters" : "No work done rows"}</h3></div>
            ) : null}
          </>
          )}
        </DataTableWrapper>
        <TableRowsLimitFooter
          placement="tableCard"
          loadedCount={displayedTabCount}
          filteredCount={displayedCount}
          filterActive={hasFilters}
          value={effectiveRowLimit}
          onChange={confirmRowLimit}
        />
      </div>

      {detailRow && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={() => setDetailRow(null)}>
          <div style={{ width: "min(720px, 96vw)", maxHeight: "calc(100dvh - 40px)", overflow: "auto", background: "#fff", borderRadius: 12, padding: 20 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: "1rem" }}>
                Work Done · {detailRow.poid || detailRow.po_dispatch || detailRow.name}
              </h3>
              <button type="button" onClick={() => setDetailRow(null)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8" }}>&times;</button>
            </div>
            <div style={{ fontSize: "0.84rem", color: "#475569", marginBottom: 8, display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6 }}>
              <div><strong>Plan:</strong> {detailRow.rollout_plan || "—"}</div>
              <div><strong>Execution:</strong> {detailRow.execution || detailRow.name || "—"}</div>
              <div><strong>Project:</strong> {detailRow.project_code || "—"}</div>
              <div><strong>Item:</strong> {detailRow.item_code || "—"}</div>
              <div><strong>Lead Team:</strong> {detailRow.team_name || detailRow.team || "—"}</div>
              <div><strong>Revenue:</strong> {money.format(detailRow.revenue_sar || 0)}</div>
              {detailRow.subcontractor && (
                <div><strong>Subcontract:</strong> {detailRow.subcontractor}</div>
              )}
              {detailRow.contract_model && (
                <div><strong>Contract Model:</strong> {detailRow.contract_model}</div>
              )}
              {detailRow.source && (
                <div><strong>Source:</strong> {detailRow.source}{detailRow.direct_close_by ? ` · ${detailRow.direct_close_by_full_name || detailRow.direct_close_by}` : ""}</div>
              )}
            </div>
            {detailRow.pic_rejection_remark && (
              <div style={{ margin: "8px 0 12px", padding: "10px 12px", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, color: "#991b1b", fontSize: "0.85rem" }}>
                <strong>PIC Rejected:</strong> {detailRow.pic_rejection_remark}
              </div>
            )}
            <IMNoteCallout note={detailRow.manager_remark} />
            <PlanTeamsBreakdown rolloutPlan={detailRow.rollout_plan} />
            <DispatchVisitHistory
              poDispatch={detailRow.po_dispatch}
              rolloutPlan={detailRow.rollout_plan}
              currentPlanName={detailRow.rollout_plan}
            />
            {detailAttachLoading ? (
              <div style={{ color: "#94a3b8", fontSize: "0.82rem", padding: "8px 0" }}>Loading attachments…</div>
            ) : detailAttachments.length > 0 ? (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>
                  IM Documents
                </div>
                <AttachmentSlotList attachments={detailAttachments} docReq={DOC_REQUIREMENTS[detailRow?.activity_type]} />
              </div>
            ) : null}
          </div>
        </div>
      )}

      {issueFlagFor && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={() => !issueFlagBusy && setIssueFlagFor(null)}
        >
          <div
            style={{ background: "#fff", borderRadius: 12, padding: 24, width: "min(400px, 96vw)", boxShadow: "0 20px 60px rgba(0,0,0,0.22)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: "1rem" }}>Set Issue Flag</h3>
              <button type="button" onClick={() => setIssueFlagFor(null)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8", lineHeight: 1 }} disabled={issueFlagBusy}>&times;</button>
            </div>
            <div style={{ fontSize: "0.82rem", color: "#64748b", marginBottom: 14 }}>
              {issueFlagFor.poid || issueFlagFor.po_dispatch || issueFlagFor.name}
            </div>
            {issueFlagErr && <div className="notice error" style={{ marginBottom: 12 }}>{issueFlagErr}</div>}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: 4 }}>Issue Flag</label>
              <select
                value={issueFlagPick}
                onChange={(e) => setIssueFlagPick(e.target.value)}
                style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.9rem", width: "100%" }}
                disabled={issueFlagBusy}
              >
                {WD_ISSUE_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>{opt || "— None —"}</option>
                ))}
              </select>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" className="btn-secondary" onClick={() => setIssueFlagFor(null)} disabled={issueFlagBusy}>Cancel</button>
              <button type="button" className="btn-primary" onClick={submitIssueFlag} disabled={issueFlagBusy}>
                {issueFlagBusy ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {bulkIssueFlagOpen && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={() => !bulkIssueFlagBusy && setBulkIssueFlagOpen(false)}
        >
          <div
            style={{ background: "#fff", borderRadius: 12, padding: 24, width: "min(420px, 96vw)", boxShadow: "0 20px 60px rgba(0,0,0,0.22)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: "1rem" }}>Set Issue Flag — {selectedRows.size} rows</h3>
              <button type="button" onClick={() => setBulkIssueFlagOpen(false)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8", lineHeight: 1 }} disabled={bulkIssueFlagBusy}>&times;</button>
            </div>
            {bulkIssueFlagResult ? (
              <div>
                <div style={{ padding: "12px 14px", background: "#ecfdf5", border: "1px solid #bbf7d0", borderRadius: 8, marginBottom: 14 }}>
                  <div style={{ fontWeight: 700, color: "#047857", marginBottom: 4 }}>Updated {bulkIssueFlagResult.updated} row{bulkIssueFlagResult.updated !== 1 ? "s" : ""}</div>
                  {bulkIssueFlagResult.errors?.length > 0 && (
                    <div style={{ marginTop: 6 }}>
                      <div style={{ fontSize: "0.78rem", fontWeight: 600, color: "#b91c1c", marginBottom: 4 }}>Failed ({bulkIssueFlagResult.errors.length}):</div>
                      {bulkIssueFlagResult.errors.map((e, i) => (
                        <div key={i} style={{ fontSize: "0.75rem", color: "#991b1b" }}>{e.name}: {e.error}</div>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button type="button" className="btn-primary" onClick={() => setBulkIssueFlagOpen(false)}>Close</button>
                </div>
              </div>
            ) : (
              <>
                {bulkIssueFlagErr && <div className="notice error" style={{ marginBottom: 12 }}>{bulkIssueFlagErr}</div>}
                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: 4 }}>Issue Flag</label>
                  <select
                    value={bulkIssueFlagPick}
                    onChange={(e) => setBulkIssueFlagPick(e.target.value)}
                    style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.9rem", width: "100%" }}
                    disabled={bulkIssueFlagBusy}
                  >
                    {WD_ISSUE_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>{opt || "— None (clear flag) —"}</option>
                    ))}
                  </select>
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                  <button type="button" className="btn-secondary" onClick={() => setBulkIssueFlagOpen(false)} disabled={bulkIssueFlagBusy}>Cancel</button>
                  <button type="button" className="btn-primary" onClick={submitBulkIssueFlag} disabled={bulkIssueFlagBusy}>
                    {bulkIssueFlagBusy ? "Saving…" : `Apply to ${selectedRows.size} rows`}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {bulkModalOpen && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={() => !bulkBusy && setBulkModalOpen(false)}
        >
          <div
            style={{ background: "#fff", borderRadius: 12, padding: 24, width: "min(700px, 96vw)", maxHeight: "90dvh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.22)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: "1rem" }}>Update Submission — {selectedRows.size} rows</h3>
              <button type="button" onClick={() => setBulkModalOpen(false)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8", lineHeight: 1 }} disabled={bulkBusy}>&times;</button>
            </div>

            {(() => {
              const selList = filteredRows.filter((r) => selectedRows.has(r.name));
              const byDuid = {};
              for (const r of selList) {
                const d = r.site_code || "—";
                const p = r.poid || r.po_dispatch || "—";
                if (!byDuid[d]) byDuid[d] = new Set();
                byDuid[d].add(p);
              }
              const entries = Object.entries(byDuid).sort(([a], [b]) => a.localeCompare(b));
              if (!entries.length) return null;
              return (
                <div style={{ marginBottom: 14, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: "8px 12px", maxHeight: 140, overflowY: "auto" }}>
                  {entries.map(([duid, poids], i) => (
                    <div key={duid} style={{ display: "flex", gap: 10, fontSize: "0.8rem", padding: "3px 0", borderTop: i > 0 ? "1px solid #f1f5f9" : "none" }}>
                      <span style={{ flexShrink: 0, fontFamily: "monospace", fontWeight: 700, color: "#0369a1", minWidth: 90 }}>{duid}</span>
                      <span style={{ color: "#64748b", fontFamily: "monospace", fontSize: "0.75rem", wordBreak: "break-all" }}>{[...poids].sort().join("  ·  ")}</span>
                    </div>
                  ))}
                </div>
              );
            })()}

            {bulkResult ? (
              <div>
                <div style={{ padding: "12px 14px", background: "#ecfdf5", border: "1px solid #bbf7d0", borderRadius: 8, marginBottom: 14 }}>
                  <div style={{ fontWeight: 700, color: "#047857", marginBottom: 4 }}>Updated {bulkResult.updated} row{bulkResult.updated !== 1 ? "s" : ""}</div>
                  {bulkResult.errors?.length > 0 && (
                    <div style={{ marginTop: 6 }}>
                      <div style={{ fontSize: "0.78rem", fontWeight: 600, color: "#b91c1c", marginBottom: 4 }}>Failed ({bulkResult.errors.length}):</div>
                      {bulkResult.errors.map((e, i) => (
                        <div key={i} style={{ fontSize: "0.75rem", color: "#991b1b" }}>{e.name}: {e.error}</div>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button type="button" className="btn-primary" onClick={() => setBulkModalOpen(false)}>Close</button>
                </div>
              </div>
            ) : (
              <>
                {bulkErr && <div className="notice error" style={{ marginBottom: 12 }}>{bulkErr}</div>}

                <div className="form-group" style={{ marginBottom: 14 }}>
                  <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em", display: "block", marginBottom: 4 }}>Status</label>
                  <select value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)} style={{ padding: 8, width: "100%", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: "0.9rem" }}>
                    <option value="">— Not set —</option>
                    <option value="Ready for Confirmation">Ready for Confirmation</option>
                    <option value="Confirmation Done">Confirmation Done</option>
                  </select>
                </div>

                <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>
                  Required Documents
                </div>
                {attachLoading ? (
                  <div style={{ color: "#94a3b8", fontSize: "0.82rem", padding: "6px 0", marginBottom: 8 }}>Loading existing documents…</div>
                ) : existingAttachments.length > 0 ? (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 5 }}>
                      Existing Documents
                    </div>
                    <AttachmentSlotList attachments={existingAttachments} docReq={bulkDocReq} />
                    <div style={{ fontSize: "0.72rem", color: "#64748b", marginTop: 6 }}>Add a shared file below to attach it to all selected rows:</div>
                  </div>
                ) : null}
                {(() => {
                  const doc1Label = bulkDocReq?.doc1Label || "Confirmation Mail";
                  return (
                    <>
                      {bulkActTypes.length > 1 && (
                        <div style={{ fontSize: "0.72rem", color: "#b45309", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, padding: "5px 10px", marginBottom: 8 }}>
                          Mixed activity types selected — showing generic document slots.
                        </div>
                      )}
                      <FileSlot slotKey="DOC1" slotLabel={doc1Label} accept=".msg" files={bulkDoc1Files} setFiles={setBulkDoc1Files} required={false} />
                      {bulkDocReq?.doc2 ? (
                        bulkDocReq.doc2.parts ? (
                          <div style={{ marginBottom: 10 }}>
                            <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>
                              DOC2 — {bulkDocReq.doc2.label}
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 6, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px" }}>
                              {bulkDocReq.doc2.parts.map((part, i) => {
                                const partFiles = bulkDoc2PartFiles[i] || [];
                                return (
                                  <div key={part.slot}>
                                    <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#1d4ed8", marginBottom: 3 }}>{part.label}</div>
                                    <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", border: `1.5px dashed ${partFiles.length ? "#86efac" : "#cbd5e1"}`, borderRadius: 6, cursor: "pointer", background: partFiles.length ? "#f0fdf4" : "#fff", fontSize: "0.8rem", color: "#64748b" }}>
                                      <span>{partFiles.length ? "✅" : "📁"}</span>
                                      <span style={{ flex: 1 }}>{partFiles.length ? partFiles.map((f) => f.name).join(", ") : `Select ${part.label} file`}</span>
                                      {partFiles.length > 0 && <span style={{ fontSize: "0.7rem", color: "#16a34a" }}>{partFiles.length} file{partFiles.length !== 1 ? "s" : ""}</span>}
                                      <input type="file" multiple accept={bulkDocReq.doc2.accept} style={{ display: "none" }}
                                        onChange={(e) => {
                                          const newFiles = Array.from(e.target.files);
                                          setBulkDoc2PartFiles((prev) => { const next = [...prev]; next[i] = newFiles; return next; });
                                        }} />
                                    </label>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ) : (
                          <FileSlot slotKey="DOC2" slotLabel={bulkDocReq.doc2.label} accept={bulkDocReq.doc2.accept} files={bulkDoc2Files} setFiles={setBulkDoc2Files} required={false} />
                        )
                      ) : bulkDocReq ? (
                        <FileSlot slotKey="DOC2" slotLabel="Optional supplementary document" accept={undefined} files={bulkDoc2Files} setFiles={setBulkDoc2Files} required={false} />
                      ) : (
                        <FileSlot slotKey="DOC2" slotLabel="Supporting Document" accept={undefined} files={bulkDoc2Files} setFiles={setBulkDoc2Files} required={false} />
                      )}
                    </>
                  );
                })()}

                <div className="form-group" style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em", display: "block", marginBottom: 4 }}>Note</label>
                  <textarea
                    value={bulkImNote}
                    onChange={(e) => setBulkImNote(e.target.value)}
                    placeholder="Add any instructions or remarks for PIC…"
                    rows={3}
                    style={{ width: "100%", padding: "8px 10px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: "0.88rem", resize: "vertical", boxSizing: "border-box" }}
                  />
                </div>

                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button type="button" className="btn-secondary" disabled={bulkBusy} onClick={() => setBulkModalOpen(false)}>Cancel</button>
                  <button type="button" className="btn-primary" disabled={bulkBusy} onClick={submitBulk}>
                    {bulkBusy ? "Submitting…" : `Submit All (${selectedRows.size})`}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {legacyBulkOpen && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={() => !legacyBulkBusy && setLegacyBulkOpen(false)}
        >
          <div
            style={{ background: "#fff", borderRadius: 12, padding: 24, width: "min(600px, 96vw)", maxHeight: "90dvh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.22)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: "1rem" }}>Resubmit to PIC — {legacyBulkTargets.length} milestone{legacyBulkTargets.length !== 1 ? "s" : ""}</h3>
              <button type="button" onClick={() => setLegacyBulkOpen(false)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8", lineHeight: 1 }} disabled={legacyBulkBusy}>&times;</button>
            </div>

            <div style={{ marginBottom: 14, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: "8px 12px", maxHeight: 120, overflowY: "auto", fontFamily: "monospace", fontSize: "0.78rem", color: "#475569" }}>
              {legacyBulkTargets.map((t) => `${t.row.poid || t.row.name} (${t.milestone})`).join("  ·  ")}
            </div>

            {legacyBulkResult ? (
              <div>
                <div style={{ padding: "12px 14px", background: "#ecfdf5", border: "1px solid #bbf7d0", borderRadius: 8, marginBottom: 14 }}>
                  <div style={{ fontWeight: 700, color: "#047857", marginBottom: 4 }}>Updated {legacyBulkResult.updated} row{legacyBulkResult.updated !== 1 ? "s" : ""}</div>
                  {legacyBulkResult.errors?.length > 0 && (
                    <div style={{ marginTop: 6 }}>
                      <div style={{ fontSize: "0.78rem", fontWeight: 600, color: "#b91c1c", marginBottom: 4 }}>Failed ({legacyBulkResult.errors.length}):</div>
                      {legacyBulkResult.errors.map((e, i) => (
                        <div key={i} style={{ fontSize: "0.75rem", color: "#991b1b" }}>{e.name}: {e.error}</div>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button type="button" className="btn-primary" onClick={() => setLegacyBulkOpen(false)}>Close</button>
                </div>
              </div>
            ) : (
              <>
                {legacyBulkErr && <div className="notice error" style={{ marginBottom: 12 }}>{legacyBulkErr}</div>}

                <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>
                  Documents
                </div>
                {legacyBulkAttachLoading ? (
                  <div style={{ color: "#94a3b8", fontSize: "0.82rem", padding: "6px 0", marginBottom: 8 }}>Loading existing documents…</div>
                ) : legacyBulkExistingAttachments.length > 0 ? (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 5 }}>
                      Existing Documents
                    </div>
                    <AttachmentSlotList attachments={legacyBulkExistingAttachments} docReq={null} />
                    <div style={{ fontSize: "0.72rem", color: "#64748b", marginTop: 6 }}>Add a shared file below to attach it to all selected lines:</div>
                  </div>
                ) : null}
                <FileSlot slotKey="DOC1" slotLabel="Confirmation Mail" accept=".msg" files={legacyBulkDoc1Files} setFiles={setLegacyBulkDoc1Files} required={false} />
                <FileSlot slotKey="DOC2" slotLabel="Supporting Document" accept=".pdf,.xls,.xlsx,.doc,.docx,.ppt,.pptx" files={legacyBulkDoc2Files} setFiles={setLegacyBulkDoc2Files} required={false} />

                <div className="form-group" style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em", display: "block", marginBottom: 4 }}>Note</label>
                  <textarea
                    value={legacyBulkNote}
                    onChange={(e) => setLegacyBulkNote(e.target.value)}
                    placeholder="Add any instructions or remarks for PIC…"
                    rows={3}
                    style={{ width: "100%", padding: "8px 10px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: "0.88rem", resize: "vertical", boxSizing: "border-box" }}
                  />
                </div>

                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button type="button" className="btn-secondary" disabled={legacyBulkBusy} onClick={() => setLegacyBulkOpen(false)}>Cancel</button>
                  <button type="button" className="btn-primary" disabled={legacyBulkBusy} onClick={submitLegacyBulk}>
                    {legacyBulkBusy ? "Submitting…" : `Resubmit All (${legacyBulkTargets.length})`}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {submissionWarn && (
        <div style={{ margin: "12px 0", padding: "10px 14px", background: "#fffbeb", border: "1px solid #fbbf24", borderRadius: 8, color: "#92400e", fontSize: "0.85rem", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <span>{submissionWarn}</span>
          <button type="button" onClick={() => setSubmissionWarn(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#92400e", fontWeight: 700, flexShrink: 0 }}>✕</button>
        </div>
      )}

      {submissionFor && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setSubmissionFor(null)}>
          <div style={{ width: "min(560px, 94vw)", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 20, maxHeight: "90dvh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
              <h4 style={{ margin: 0, fontSize: "0.95rem" }}>
                Submission Status
                <span style={{ marginLeft: 8, fontFamily: "monospace", color: "#64748b", fontWeight: 500, fontSize: "0.82rem" }}>
                  {submissionFor.poid || submissionFor.po_dispatch || submissionFor.name}
                </span>
                {submissionFor.site_code && (
                  <span style={{ marginLeft: 8, fontFamily: "monospace", color: "#0369a1", fontWeight: 600, fontSize: "0.82rem" }}>
                    {submissionFor.site_code}
                  </span>
                )}
                {submissionFor.is_subcon && (
                  <span style={{ marginLeft: 8, fontSize: "0.68rem", padding: "2px 8px", borderRadius: 999, background: "rgba(167,139,250,0.15)", color: "#7c3aed", fontWeight: 700 }}>Backend</span>
                )}
              </h4>
              <button type="button" onClick={() => setSubmissionFor(null)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8", lineHeight: 1 }}>&times;</button>
            </div>

            {submissionErr && <div className="notice error" style={{ marginBottom: 10 }}>{submissionErr}</div>}

            {submissionFor?.pic_rejection_remark && (
              <div style={{ marginBottom: 12, padding: "10px 12px", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, color: "#991b1b", fontSize: "0.85rem" }}>
                <strong>PIC Rejected:</strong> {submissionFor.pic_rejection_remark}
              </div>
            )}

            <div className="form-group" style={{ marginBottom: 14 }}>
              <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em", display: "block", marginBottom: 4 }}>Status</label>
              <select value={submissionPick} onChange={(e) => setSubmissionPick(e.target.value)} style={{ padding: 8, width: "100%", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: "0.9rem" }}>
                <option value="">— Not set —</option>
                <option value="Ready for Confirmation">Ready for Confirmation</option>
                <option value="Confirmation Done">Confirmation Done</option>
              </select>
            </div>

            {submissionFor && (() => {
              const docReq = DOC_REQUIREMENTS[submissionFor.activity_type];
              const isConfirm = submissionPick === "Confirmation Done";
              const doc1Label = docReq?.doc1Label || "Confirmation Mail";
              const hasExisting = existingAttachments.length > 0;
              const slotRequired = isConfirm && !hasExisting;
              return (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>
                    Required Documents
                  </div>

                  {attachLoading ? (
                    <div style={{ color: "#94a3b8", fontSize: "0.82rem", padding: "6px 0" }}>Loading…</div>
                  ) : hasExisting ? (
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 5 }}>Existing Documents</div>
                      <AttachmentSlotList attachments={existingAttachments} docReq={docReq} />
                      <div style={{ fontSize: "0.72rem", color: "#64748b", marginTop: 6 }}>Add more files below if needed:</div>
                    </div>
                  ) : null}

                  <FileSlot slotKey="DOC1" slotLabel={doc1Label} accept=".msg" files={doc1Files} setFiles={setDoc1Files} required={slotRequired}
                    links={doc1Links} setLinks={setDoc1Links} />

                  {docReq?.doc2 ? (
                    docReq.doc2.parts ? (
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
                          DOC2 — {docReq.doc2.label}
                          {slotRequired && <span style={{ fontSize: "0.7rem", color: "#ef4444", fontWeight: 600, textTransform: "none", letterSpacing: 0 }}>* required</span>}
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 6, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px" }}>
                          {docReq.doc2.parts.map((part, i) => {
                            const partFiles = doc2PartFiles[i] || [];
                            return (
                              <div key={part.slot}>
                                <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#1d4ed8", marginBottom: 3 }}>{part.label}</div>
                                <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", border: `1.5px dashed ${partFiles.length ? "#86efac" : "#cbd5e1"}`, borderRadius: 6, cursor: "pointer", background: partFiles.length ? "#f0fdf4" : "#fff", fontSize: "0.8rem", color: "#64748b" }}>
                                  <span>{partFiles.length ? "✅" : "📁"}</span>
                                  <span style={{ flex: 1 }}>
                                    {partFiles.length ? partFiles.map(f => f.name).join(", ") : `Select ${part.label} file`}
                                  </span>
                                  {partFiles.length > 0 && <span style={{ fontSize: "0.7rem", color: "#16a34a" }}>{partFiles.length} file{partFiles.length !== 1 ? "s" : ""}</span>}
                                  <input type="file" multiple accept={docReq.doc2.accept} style={{ display: "none" }}
                                    onChange={(e) => {
                                      const newFiles = Array.from(e.target.files);
                                      setDoc2PartFiles(prev => { const next = [...prev]; next[i] = newFiles; return next; });
                                    }} />
                                </label>
                                <LinkAttachInput
                                  links={doc2PartLinks[i] || []}
                                  setLinks={(ls) => setDoc2PartLinks(prev => { const next = [...prev]; next[i] = ls; return next; })}
                                />
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <FileSlot slotKey="DOC2" slotLabel={docReq.doc2.label} accept={docReq.doc2.accept} files={doc2Files} setFiles={setDoc2Files} required={slotRequired}
                        links={doc2Links} setLinks={setDoc2Links} />
                    )
                  ) : (
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>
                        DOC2 — Not Required
                        <span style={{ marginLeft: 6, fontSize: "0.68rem", fontWeight: 400, color: "#cbd5e1", textTransform: "none" }}>
                          {submissionFor.activity_type ? `(${submissionFor.activity_type})` : ""}
                        </span>
                      </div>
                      <FileSlot slotKey="" slotLabel="Optional supplementary document" accept={undefined} files={doc2Files} setFiles={setDoc2Files} required={false}
                        links={doc2Links} setLinks={setDoc2Links} />
                    </div>
                  )}
                </div>
              );
            })()}

            <div className="form-group" style={{ marginBottom: 14 }}>
              <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em", display: "block", marginBottom: 4 }}>
                Note
              </label>
              <textarea
                value={imNote}
                onChange={(e) => setImNote(e.target.value)}
                placeholder="Add any instructions or remarks for PIC…"
                rows={3}
                style={{ width: "100%", padding: "8px 10px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: "0.88rem", resize: "vertical", boxSizing: "border-box" }}
              />
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="btn-secondary" onClick={() => setSubmissionFor(null)}>Cancel</button>
              <button className="btn-primary" disabled={submissionBusy} onClick={submitSubmission}>{submissionBusy ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
