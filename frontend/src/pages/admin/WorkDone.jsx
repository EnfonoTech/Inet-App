import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useDebounced } from "../../hooks/useDebounced";
import DataTableWrapper from "../../components/DataTableWrapper";
import PageSummary from "../../components/PageSummary";
import { pmApi } from "../../services/api";
import { useTableRowLimit, TABLE_ROW_LIMIT_ALL } from "../../context/TableRowLimitContext";
import TableRowsLimitFooter from "../../components/TableRowsLimitFooter";
import useFilterOptions from "../../hooks/useFilterOptions";
import SearchableSelect from "../../components/SearchableSelect";
import RecordDetailView, { DetailHero, DetailStatTile } from "../../components/RecordDetailView";
import IMNoteCallout from "../../components/IMNoteCallout";
import PlanTeamsBreakdown from "../../components/PlanTeamsBreakdown";
import DispatchVisitHistory from "../../components/DispatchVisitHistory";
import RemarksCell from "../../components/RemarksCell";
import DateRangePicker from "../../components/DateRangePicker";
import ExportExcelButton from "../../components/ExportExcelButton";
import { handleSearchPaste } from "../../utils/searchPaste";
import { useProgressiveRows } from "../../hooks/useProgressiveRows";
import { PoStatusBadge } from "../pic/picShared";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

// Full PO Dispatch.dispatch_status vocabulary (matches the doctype's actual
// Select options exactly) — a Work Done row's underlying PO Dispatch can
// still show an earlier status than Completed (e.g. legacy/imported rows,
// or a dispatch_status that was changed independently afterward), so the
// filter needs every value the column can actually render, not just the
// "operationally done" subset.
const PO_STATUSES = ["Pending", "Dispatched", "Planned", "Backend Assigned", "Completed", "Partially Submitted", "Submitted", "Partially Closed", "Closed", "Cancelled"];

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
          : <span>Click to select</span>}
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

function badgeTone(value) {
  const s = String(value || "").toLowerCase();
  if (!s) return { bg: "#f1f5f9", fg: "#334155", dot: "#64748b" };
  const tones = {
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

function DetailItem({ label, value }) {
  const txt = String(value || "");
  const isStatus = /status/i.test(label);
  const tone = txt.toLowerCase().includes("closed") || txt.toLowerCase().includes("complete")
    ? { bg: "#ecfdf5", fg: "#047857" }
    : txt.toLowerCase().includes("cancel") || txt.toLowerCase().includes("reject")
      ? { bg: "#fef2f2", fg: "#b91c1c" }
      : txt.toLowerCase().includes("pending") || txt.toLowerCase().includes("invoic")
        ? { bg: "#fffbeb", fg: "#b45309" }
        : { bg: "#eff6ff", fg: "#1d4ed8" };
  return (
    <div style={{ padding: "8px 10px" }}>
      <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>{label}</div>
      {isStatus ? (
        <span style={{ display: "inline-block", borderRadius: 999, padding: "3px 10px", fontSize: 12, fontWeight: 700, background: tone.bg, color: tone.fg }}>
          {value || "—"}
        </span>
      ) : (
        <div style={{ fontSize: 13, color: "#0f172a", fontWeight: 500 }}>{value || "—"}</div>
      )}
    </div>
  );
}

function Pill({ label, value, tone = "blue" }) {
  const palette = {
    blue: { bg: "#eff6ff", fg: "#1d4ed8", bd: "#bfdbfe" },
    green: { bg: "#ecfdf5", fg: "#047857", bd: "#a7f3d0" },
    amber: { bg: "#fffbeb", fg: "#b45309", bd: "#fde68a" },
  }[tone];
  return (
    <div style={{ border: `1px solid ${palette.bd}`, background: palette.bg, color: palette.fg, borderRadius: 999, padding: "4px 10px", fontSize: 12, fontWeight: 700 }}>
      {label}: {value || "—"}
    </div>
  );
}

export default function WorkDone() {
  const { rowLimit } = useTableRowLimit();
  const location = useLocation();
  const _navWD = location.state?.workDoneFilters;

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [search, setSearch] = useState("");
  const searchDebounced = useDebounced(search, 300);
  const [poStatusFilter, setPoStatusFilter] = useState([]);
  const [imFilter, setImFilter] = useState([]);
  // Accepts a team list from dashboard drill-through (Command dashboard's
  // INET Achieved / Sub-Con Revenue tiles). Without this the passed filter
  // was dropped, so a tile reading 0 opened a list with rows in it.
  const [teamFilter, setTeamFilter] = useState(_navWD?.teamFilter ?? []);
  const [projectFilter, setProjectFilter] = useState([]);
  const [duidFilter, setDuidFilter] = useState([]);
  // Accepts a subcontract list from dashboard drill-through (Sub-Contractor
  // block), matched against the POID's own `contract` link server-side.
  const [subconFilter, setSubconFilter] = useState(_navWD?.subconFilter ?? []);
  const [fromDate, setFromDate] = useState(_navWD?.fromDate ?? "");
  const [toDate, setToDate] = useState(_navWD?.toDate ?? "");
  const [detailRow, setDetailRow] = useState(null);
  const [selectedRows, setSelectedRows] = useState(new Set());
  const [issueFlagFilter, setIssueFlagFilter] = useState([]);
  const [submissionFilter, setSubmissionFilter] = useState([]);
  // Accepts a work type from dashboard drill-through (Command dashboard's
  // Direct Close section), same as fromDate/toDate above.
  const [workTypeFilter, setWorkTypeFilter] = useState(_navWD?.workTypeFilter ?? []);
  const [tab, setTab] = useState("list");

  // The single <DataTableWrapper> below is always mounted — List and
  // Summary both render as its children, switched by tab, so its inner
  // .data-table-scroll (the thing that actually scrolls on desktop; see
  // pages.css's .content-outlet:has(...) lock) never unmounts between
  // tabs and just carries its scroll position over unchanged. Reset that
  // directly, plus window/.content-outlet as a fallback for narrower
  // viewports where that CSS lock doesn't apply and the window itself
  // scrolls instead (same fallback PullToRefresh.jsx already uses).
  useEffect(() => {
    document.querySelector(".page-content > .data-table-wrapper > .data-table-scroll")?.scrollTo(0, 0);
    document.querySelector(".content-outlet")?.scrollTo(0, 0);
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
  }, [tab]);

  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkErr, setBulkErr] = useState(null);
  const [bulkResult, setBulkResult] = useState(null);
  const [submissionFor, setSubmissionFor] = useState(null);
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
  const [issueFlagFor, setIssueFlagFor] = useState(null);
  const [bulkIssueFlagOpen, setBulkIssueFlagOpen] = useState(false);
  const [bulkIssueFlagPick, setBulkIssueFlagPick] = useState("");
  const [bulkIssueFlagBusy, setBulkIssueFlagBusy] = useState(false);
  const [bulkIssueFlagErr, setBulkIssueFlagErr] = useState(null);
  const [bulkIssueFlagResult, setBulkIssueFlagResult] = useState(null);
  const [issueFlagPick, setIssueFlagPick] = useState("");
  const [issueFlagBusy, setIssueFlagBusy] = useState(false);
  const [issueFlagErr, setIssueFlagErr] = useState(null);

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
        setSubmissionErr(`DOC1 (${docReq?.doc1Label || "Confirmation Mail"}) is required for Confirmation Done.`);
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
      const po_dispatch = submissionFor.po_dispatch || submissionFor.poid;
      if (!po_dispatch) throw new Error("Missing PO Dispatch reference");
      const docReqUp = DOC_REQUIREMENTS[submissionFor?.activity_type];
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
      if (submissionFor.is_subcon) {
        res = await pmApi.updateSubconSubmission(po_dispatch, submissionPick, imNote || undefined);
      } else {
        if (!submissionFor.name) throw new Error("Missing Work Done name");
        res = await pmApi.updateWorkDoneSubmission(submissionFor.name, submissionPick, imNote || undefined);
      }
      setSubmissionFor(null);
      if (res?.pic_warning) setSubmissionWarn(res.pic_warning);
      loadData();
    } catch (err) {
      setSubmissionErr(err.message || "Failed to update submission status");
    } finally {
      setSubmissionBusy(false);
    }
  }

  const [refreshKey, setRefreshKey] = useState(0);
  const loadData = useCallback(() => setRefreshKey((k) => k + 1), []);

  async function submitBulk() {
    setBulkBusy(true);
    setBulkErr(null);
    let updated = 0;
    const errors = [];
    const selectedList = filteredRows.filter((r) => selectedRows.has(r.name));
    for (const row of selectedList) {
      try {
        if (row.is_subcon) {
          await pmApi.updateSubconSubmission(row.po_dispatch || row.poid, bulkStatus, undefined);
        } else {
          await pmApi.updateWorkDoneSubmission(row.name, bulkStatus, undefined);
        }
        updated++;
      } catch (err) {
        errors.push({ name: row.poid || row.name, error: err.message || "Failed" });
      }
    }
    setBulkResult({ updated, errors });
    setBulkBusy(false);
    if (updated > 0) { loadData(); }
  }

  // ── Manage Table column filters ──────────────────────────────────────
  // Each column's typed value is matched only against that column's own
  // value on the backend (see column_filters / col_filter_map in
  // list_work_done_rows), not blended into the top search box's wide
  // multi-column search.
  const [columnFilters, setColumnFilters] = useState({});
  useEffect(() => {
    const onFiltersChanged = (e) => {
      if (e.detail?.tableKey !== "admin-workdone") return;
      setColumnFilters(e.detail.filters || {});
    };
    document.addEventListener("tablepro:filters-changed", onFiltersChanged);
    return () => document.removeEventListener("tablepro:filters-changed", onFiltersChanged);
  }, []);
  // Excel column-filter dropdowns cascade off exactly the query the rows
  // were fetched with (recorded by the fetch effect below).
  const queryArgsRef = useRef({});
  useEffect(() => {
    const onRequestOptions = (e) => {
      if (e.detail?.tableKey !== "admin-workdone") return;
      e.detail.respond(pmApi.getColumnFilterOptions({
        source: "work_done",
        col_key: e.detail.colKey,
        bucket: e.detail.bucket,
        search: e.detail.search,
        limit: e.detail.limit,
        portal_filters: queryArgsRef.current,
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

  // Remembers what the LAST real server fetch actually returned, and under
  // what limit + filters. Shrinking the row limit (e.g. All -> 20) never
  // needs another round-trip — whatever's being asked for is already sitting
  // in memory from the larger fetch; just show fewer of the same rows via
  // CSS (see displayLimit/displayedCount below). Only growing the limit, or
  // any OTHER filter actually changing, hits the server.
  const lastFetchRef = useRef({ signature: null, limit: null, rows: [] });

  // Single useEffect with cancellation guard. Replaces the older
  // useResetOnRowLimitChange + separate-load pattern that left the table
  // blank when going from a higher to a lower row limit.
  // One definition of "what this view is", shared by the row fetch and the
  // header summary — they must describe the same set or the chips contradict
  // the table underneath them.
  const queryFilters = useMemo(() => {
      // list_work_done_rows defaults an unset "tab" to "active", which
      // excludes Confirmation-Done / PIC-Rejected rows — a default built for
      // IMWorkDone.jsx's 3-tab UI (Active/Confirmed/PIC Rejected). This page
      // has no such tabs and is meant to show the complete Work Done list,
      // so it was silently inheriting that exclusion (e.g. a summary tile
      // showing the true all-time total while this list quietly dropped
      // some of those same rows). "all" matches none of that function's
      // tab branches, so no exclusion is applied.
      const filters = { tab: "all" };
      if (poStatusFilter.length) filters.dispatch_status = poStatusFilter;
      if (imFilter.length) filters.im = imFilter;
      if (teamFilter.length) filters.team = teamFilter;
      if (projectFilter.length) filters.project_code = projectFilter;
      if (duidFilter.length) filters.site_code = duidFilter;
      if (subconFilter.length) filters.subcontractor = subconFilter;
      if (fromDate) filters.from_date = fromDate;
      if (toDate) filters.to_date = toDate;
      if (searchDebounced.trim()) filters.search = searchDebounced.trim();
      if (workTypeFilter.length) {
        // "Field Work" (Rollout Execution) also covers legacy rows with no
        // source stamped at all — mirrors the display default used below
        // (`row.source || "Rollout Execution"`).
        filters.source = workTypeFilter.includes("Rollout Execution")
          ? [...workTypeFilter, ""]
          : workTypeFilter;
      }
      if (issueFlagFilter.length) filters.issue_flag = issueFlagFilter;
      if (submissionFilter.length) filters.submission_status = submissionFilter;
      const colFilters = JSON.parse(columnFiltersDebounced);
      if (Object.keys(colFilters).length) filters.column_filters = colFilters;
      return filters;
  }, [poStatusFilter, imFilter, teamFilter, projectFilter, duidFilter, subconFilter,
      fromDate, toDate, searchDebounced, workTypeFilter, issueFlagFilter, submissionFilter,
      columnFiltersDebounced]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const filters = queryFilters;
      const signature = JSON.stringify([filters, refreshKey]);

      const prev = lastFetchRef.current;
      const alreadyHaveEnough = prev.signature === signature && (
        prev.limit === TABLE_ROW_LIMIT_ALL
        || (rowLimit !== TABLE_ROW_LIMIT_ALL && rowLimit <= prev.limit)
      );
      if (alreadyHaveEnough) {
        // Deliberately NOT calling setRows() here — leave `rows` exactly as
        // is. Slicing it down would still force React to unmount however
        // many rows that drops — real DOM-teardown cost regardless of how
        // cheaply React's own diffing decides to do it. The render below
        // just hides anything beyond the new limit via CSS instead.
        return;
      }

      setLoading(true);
      setError(null);
      try {
        queryArgsRef.current = filters;
        const list = await pmApi.listWorkDoneRows(filters, rowLimit);
        if (cancelled) return;
        const fetchedRows = Array.isArray(list) ? list : [];
        setRows(fetchedRows);
        lastFetchRef.current = { signature, limit: rowLimit, rows: fetchedRows };
      } catch (err) {
        if (!cancelled) setError(err.message || "Failed to load work done data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [rowLimit, queryFilters, refreshKey]);

  // Drill down from a Work Done Summary tile/card into the List tab. The
  // summary is a full-dataset, unfiltered aggregate (see get_work_done_summary)
  // — any OTHER filter left active on the list (date range, project, billing,
  // etc.) would make the resulting row count not match the number the user
  // just clicked, which is exactly the confusing-looking mismatch this is
  // meant to avoid. So this clears every other filter before applying just
  // the one that corresponds to what was clicked.
  function goToWorkDoneList(issueFlagValues) {
    setSearch("");
    setPoStatusFilter([]);
    setImFilter([]);
    setTeamFilter([]);
    setProjectFilter([]);
    setDuidFilter([]);
    setSubconFilter([]);
    setFromDate("");
    setToDate("");
    setWorkTypeFilter([]);
    setSubmissionFilter([]);
    setIssueFlagFilter(issueFlagValues || []);
    setTab("list");
  }

  const filteredRows = useMemo(() => {
    let r = rows;
    if (issueFlagFilter.length) {
      const wantsNone = issueFlagFilter.includes("__NONE__");
      const nonNone = issueFlagFilter.filter((v) => v !== "__NONE__");
      r = r.filter((row) => {
        const flag = row.issue_flag || "";
        return (wantsNone && !flag) || nonNone.includes(flag);
      });
    }
    if (workTypeFilter.length) {
      r = r.filter((row) => {
        const src = row.source || "Rollout Execution";
        return workTypeFilter.includes(src);
      });
    }
    return r;
  }, [rows, issueFlagFilter, workTypeFilter]);

  // See useProgressiveRows — mounts large row sets in chunks so the browser
  // doesn't show "Page Unresponsive" on tables with "All" rows loaded.
  const visibleRows = useProgressiveRows(filteredRows, { paused: loading });
  // How many of `filteredRows` to actually show — anything beyond this is
  // hidden via CSS in the render below rather than removed from `rows`
  // (see the skip-fetch logic above for why `rows` itself isn't trimmed).
  const displayLimit = rowLimit === TABLE_ROW_LIMIT_ALL ? Infinity : rowLimit;
  const displayedCount = Math.min(filteredRows.length, displayLimit);

  const selectedRow = selectedRows.size === 1 ? (filteredRows.find((r) => selectedRows.has(r.name)) || null) : null;

  const hasFilters = !!(searchDebounced || poStatusFilter.length || imFilter.length || teamFilter.length || projectFilter.length || duidFilter.length || subconFilter.length || issueFlagFilter.length || submissionFilter.length || workTypeFilter.length || fromDate || toDate);
  // Distinct values across the full master tables — not row-limited.
  const [teams, setTeams] = useState([]);
  useEffect(() => {
    pmApi.getTeamOptions().then((opts) => {
      if (Array.isArray(opts)) setTeams(opts);
    }).catch(() => {});
  }, []);
  const { options: dispOpts } = useFilterOptions("PO Dispatch", ["project_code", "site_code", "contract"]);
  const projects = dispOpts.project_code || [];
  const duids = dispOpts.site_code || [];
  const subconOptions = (dispOpts.contract || []).filter(Boolean).map((v) => ({ id: v, label: v }));
  const [knownImOptions, setKnownImOptions] = useState([]);
  useEffect(() => {
    if (!rows.length) return;
    setKnownImOptions((prev) => {
      const seen = new Map(prev.map((o) => [o.id, o.label]));
      for (const r of rows) { if (r.im) seen.set(r.im, r.im_full_name || r.im); }
      return Array.from(seen.entries()).map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
    });
  }, [rows]);

  const totals = filteredRows.reduce(
    (acc, r) => ({
      qty: acc.qty + (parseFloat(r.executed_qty) || 0),
      revenue: acc.revenue + (parseFloat(r.revenue_sar || r.revenue || r.line_amount) || 0),
    }),
    { qty: 0, revenue: 0 }
  );

  useEffect(() => {
    if (tab !== "summary") return;
    if (summary) return;
    let cancelled = false;
    setSummaryLoading(true);
    pmApi.getWorkDoneSummary().then((res) => {
      if (!cancelled) setSummary(res);
    }).catch(() => {
      if (!cancelled) setSummary({ operational: [], commercial: [], operational_order: [], commercial_order: [] });
    }).finally(() => { if (!cancelled) setSummaryLoading(false); });
    return () => { cancelled = true; };
  }, [tab, summary]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Work Done</h1>
          <div className="page-subtitle">Completed work entries</div>
        </div>
        <PageSummary source="work_done" filters={queryFilters} refreshKey={refreshKey} />
        <div className="page-actions">
          <ExportExcelButton filename="work-done" rows={filteredRows.slice(0, displayedCount)} />
          <button className="btn-secondary" onClick={loadData} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* ── Tab bar ─────────────────────────────────────────── */}
      <div style={{ display: "flex", borderBottom: "2px solid #e2e8f0", marginBottom: 0 }}>
        {[
          { id: "list", label: "Work Done" },
          { id: "summary", label: "Work Done Summary" },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            style={{
              padding: "9px 20px",
              fontSize: "0.84rem",
              fontWeight: tab === t.id ? 700 : 500,
              color: tab === t.id ? "#2563eb" : "#64748b",
              background: "none",
              border: "none",
              borderBottom: tab === t.id ? "2px solid #2563eb" : "2px solid transparent",
              marginBottom: -2,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "list" && (
      <div className="toolbar">
        <input
          type="search"
          placeholder="Search POID, dummy POID, Item, Project, Team, IM, Center area, Region…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onPaste={(e) => handleSearchPaste(e, setSearch)}
          style={{
            padding: "7px 14px", borderRadius: 8,
            border: "1px solid #e2e8f0", fontSize: "0.84rem", minWidth: 280,
          }}
        />
        <SearchableSelect
              allowBlank
          multi
          value={poStatusFilter}
          onChange={setPoStatusFilter}
          options={PO_STATUSES}
          placeholder="All PO Status"
          minWidth={160}
        />
        <SearchableSelect
              allowBlank
          multi
          value={imFilter}
          onChange={setImFilter}
          options={knownImOptions}
          placeholder="All IMs"
          minWidth={150}
        />
        <SearchableSelect
              allowBlank
          multi
          value={teamFilter}
          onChange={setTeamFilter}
          options={teams}
          placeholder="All Teams"
          minWidth={150}
        />
        <SearchableSelect
              allowBlank
          multi
          value={projectFilter}
          onChange={setProjectFilter}
          options={projects}
          placeholder="All Projects"
          minWidth={170}
        />
        <SearchableSelect
              allowBlank
          multi
          value={duidFilter}
          onChange={setDuidFilter}
          options={duids}
          placeholder="All DUIDs"
          minWidth={150}
        />
        <SearchableSelect
              allowBlank
          multi
          value={subconFilter}
          onChange={setSubconFilter}
          options={subconOptions}
          placeholder="All Subcontractors"
          minWidth={170}
        />
        <SearchableSelect
          multi
          value={submissionFilter}
          onChange={setSubmissionFilter}
          options={[
            { id: "__NONE__", label: "Not set" },
            { id: "Ready for Confirmation", label: "Ready for Confirmation" },
            { id: "Confirmation Done", label: "Confirmation Done" },
            { id: "PIC Rejected", label: "PIC Rejected" },
          ]}
          placeholder="All Submission"
          minWidth={170}
        />
        <SearchableSelect
              allowBlank
          multi
          value={issueFlagFilter}
          onChange={setIssueFlagFilter}
          options={[{ id: "__NONE__", label: "No flag" }, ...["POD/PPT required","TFM Check list","Spare part return","PAT/HO Final Approval","FPDC/FM Survey report Approval","Partial Work done"].map((o) => ({ id: o, label: o }))]}
          placeholder="All Issue Flags"
          minWidth={150}
        />
        <DateRangePicker value={{ from: fromDate, to: toDate }} onChange={({ from, to }) => { setFromDate(from); setToDate(to); }} />
        <div style={{ display: "flex", gap: 5, alignItems: "center", flexShrink: 0 }}>
          {[
            { id: "Rollout Execution", label: "Field Work",    activeBg: "#16a34a", activeBd: "#15803d", inactiveBg: "#f0fdf4", inactiveBd: "#86efac", inactiveFg: "#15803d" },
            { id: "Backend",           label: "Backend",       activeBg: "#7c3aed", activeBd: "#6d28d9", inactiveBg: "#faf5ff", inactiveBd: "#c4b5fd", inactiveFg: "#6d28d9" },
            { id: "Direct Close",      label: "Direct Close",  activeBg: "#0369a1", activeBd: "#0284c7", inactiveBg: "#f0f9ff", inactiveBd: "#93c5fd", inactiveFg: "#0284c7" },
          ].map((opt) => {
            const active = workTypeFilter.includes(opt.id);
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setWorkTypeFilter((prev) =>
                  prev.includes(opt.id) ? prev.filter((v) => v !== opt.id) : [...prev, opt.id]
                )}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  padding: "4px 11px", fontSize: "0.76rem", fontWeight: 700,
                  borderRadius: 999, cursor: "pointer", whiteSpace: "nowrap",
                  border: `1.5px solid ${active ? opt.activeBd : opt.inactiveBd}`,
                  background: active ? opt.activeBg : opt.inactiveBg,
                  color: active ? "#fff" : opt.inactiveFg,
                  boxShadow: active ? `0 1px 4px ${opt.activeBg}55` : "none",
                  transition: "all 0.15s",
                }}
              >
                {active && <span style={{ fontSize: "0.65rem", lineHeight: 1 }}>✓</span>}
                {opt.label}
              </button>
            );
          })}
        </div>
        {hasFilters && (
          <button
            className="btn-secondary"
            style={{ fontSize: "0.78rem", padding: "5px 12px" }}
            onClick={() => { setSearch(""); setPoStatusFilter([]); setImFilter([]); setTeamFilter([]); setProjectFilter([]); setDuidFilter([]); setSubconFilter([]); setIssueFlagFilter([]); setSubmissionFilter([]); setWorkTypeFilter([]); setFromDate(""); setToDate(""); }}
          >
            Clear
          </button>
        )}
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
              if (selectedRows.size === 1 && selectedRow) {
                openSubmissionModal(selectedRow);
              } else {
                setBulkErr(null); setBulkStatus(""); setBulkResult(null);
                setBulkModalOpen(true);
              }
            }}
          >
            Update Submission{selectedRows.size > 1 ? ` (${selectedRows.size})` : ""}
          </button>
        </div>
      </div>
      )}

      <div className="page-content">
        {error && (
          <div className="notice error" style={{ marginBottom: 16 }}>
            <span>⚠</span> {error}
          </div>
        )}

        <DataTableWrapper loading={loading && filteredRows.length > 0}>
        {tab === "summary" ? (
          <div style={{ padding: "20px 20px 40px", background: "#f8fafc" }}>
            {summaryLoading ? (
              <div style={{ padding: "60px", textAlign: "center", color: "var(--text-muted)" }}>Loading summary…</div>
            ) : !summary ? (
              <div style={{ color: "#94a3b8", fontSize: "0.85rem" }}>No data loaded.</div>
            ) : (() => {
              /* ── helpers ── */
              const SectionHeader = ({ accent, title, sub }) => (
                <div style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: 16 }}>
                  <div style={{ width: 4, minWidth: 4, height: 22, borderRadius: 3, background: accent, marginRight: 10 }} />
                  <span style={{ fontSize: "0.78rem", fontWeight: 800, color: "#1e293b", textTransform: "uppercase", letterSpacing: "0.07em" }}>{title}</span>
                  {sub && <span style={{ fontSize: "0.7rem", color: "#94a3b8", marginLeft: 8, fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>{sub}</span>}
                </div>
              );

              const ProportionBar = ({ segments }) => (
                <div style={{ marginTop: 10 }}>
                  <div style={{ display: "flex", height: 7, borderRadius: 999, overflow: "hidden", background: "#e2e8f0" }}>
                    {segments.map((s, i) => s.value > 0 && (
                      <div key={i} style={{ flex: s.value, background: s.color, transition: "flex 0.5s" }} />
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 14, marginTop: 5, flexWrap: "wrap" }}>
                    {segments.map((s, i) => (
                      <span key={i} style={{ fontSize: "0.66rem", color: "#64748b", display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: s.color, flexShrink: 0 }} />
                        {s.label}
                      </span>
                    ))}
                  </div>
                </div>
              );

              const TotalsRow = ({ tiles }) => (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                  {tiles.map((s) => (
                    <div
                      key={s.label}
                      onClick={s.onClick}
                      title={s.onClick ? `View ${s.label} in Work Done` : undefined}
                      style={{
                        border: `1px solid ${s.bd}`, background: s.bg, borderRadius: 8, padding: "10px 18px", display: "flex", flexDirection: "column", gap: 2, minWidth: 140, flex: "1 1 140px", maxWidth: 240,
                        cursor: s.onClick ? "pointer" : "default", transition: "box-shadow 0.15s, transform 0.15s",
                      }}
                      onMouseEnter={(e) => { if (s.onClick) { e.currentTarget.style.boxShadow = "0 4px 10px rgba(0,0,0,0.12)"; e.currentTarget.style.transform = "translateY(-1px)"; } }}
                      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "none"; e.currentTarget.style.transform = "none"; }}
                    >
                      <span style={{ fontSize: "0.64rem", fontWeight: 700, color: s.fg, textTransform: "uppercase", letterSpacing: "0.06em" }}>{s.label}</span>
                      <span style={{ fontSize: "1.35rem", fontWeight: 800, color: s.fg, lineHeight: 1.1 }}>{fmt.format(s.lines)}</span>
                      <span style={{ fontSize: "0.72rem", color: s.fg, opacity: 0.75, fontWeight: 500 }}>SAR {fmt.format(s.revenue)}</span>
                    </div>
                  ))}
                </div>
              );

              const StatCard = ({ label, count, revenue, accentColor, bdColor, bgColor, barColor, totalLines, totalRev, onClick }) => {
                const pct    = totalLines > 0 ? Math.round((count / totalLines) * 100) : 0;
                const revPct = totalRev   > 0 ? Math.round((revenue / totalRev)   * 100) : 0;
                return (
                  <div
                    onClick={onClick}
                    title={onClick ? `View ${label} in Work Done` : undefined}
                    style={{
                      border: `1px solid ${bdColor}`, borderRadius: 8, overflow: "hidden", background: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,0.07)",
                      cursor: onClick ? "pointer" : "default", transition: "box-shadow 0.15s, transform 0.15s",
                    }}
                    onMouseEnter={(e) => { if (onClick) { e.currentTarget.style.boxShadow = "0 4px 10px rgba(0,0,0,0.12)"; e.currentTarget.style.transform = "translateY(-1px)"; } }}
                    onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "0 1px 4px rgba(0,0,0,0.07)"; e.currentTarget.style.transform = "none"; }}
                  >
                    <div style={{ background: bgColor, padding: "8px 12px", borderBottom: `1px solid ${bdColor}`, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 4 }}>
                      <span style={{ fontSize: "0.74rem", fontWeight: 700, color: accentColor, lineHeight: 1.3 }}>{label}</span>
                      <span style={{ fontSize: "0.65rem", fontWeight: 800, color: accentColor, background: "#fff", borderRadius: 999, padding: "2px 7px", border: `1px solid ${bdColor}`, flexShrink: 0 }}>{pct}%</span>
                    </div>
                    <div style={{ padding: "10px 12px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                        <span style={{ fontSize: "0.68rem", color: "#94a3b8" }}>Lines</span>
                        <span style={{ fontWeight: 800, fontSize: "1.1rem", color: accentColor }}>{fmt.format(count)}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                        <span style={{ fontSize: "0.68rem", color: "#94a3b8" }}>Revenue</span>
                        <span style={{ fontWeight: 600, fontSize: "0.82rem", color: "#1e293b" }}>SAR {fmt.format(revenue)}</span>
                      </div>
                      <div style={{ height: 5, borderRadius: 999, background: "#f1f5f9", overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${pct}%`, background: barColor, borderRadius: 999, transition: "width 0.5s" }} />
                      </div>
                      <div style={{ fontSize: "0.62rem", color: "#94a3b8", textAlign: "right", marginTop: 3 }}>{revPct}% of rev</div>
                    </div>
                  </div>
                );
              };

              const ZeroChips = ({ keys, label = "No activity" }) => keys.length === 0 ? null : (
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 10, padding: "8px 10px", background: "#f1f5f9", borderRadius: 6 }}>
                  <span style={{ fontSize: "0.66rem", color: "#94a3b8", fontWeight: 600, flexShrink: 0 }}>{label}:</span>
                  {keys.map((k) => (
                    <span key={k} style={{ fontSize: "0.68rem", padding: "2px 8px", borderRadius: 4, background: "#fff", color: "#94a3b8", border: "1px solid #e2e8f0" }}>{k}</span>
                  ))}
                </div>
              );

              /* ─────────────── OPERATIONAL ─────────────── */
              const opMap = Object.fromEntries((summary.operational || []).map((r) => [r.key || "", r]));
              const opKeys = summary.operational_order.length ? summary.operational_order : (summary.operational || []).map((r) => r.key || "").filter(Boolean);
              const nonFlagged   = opMap[""] || { count: 0, revenue: 0 };
              const flaggedLines = opKeys.reduce((s, k) => s + (opMap[k]?.count || 0), 0);
              const flaggedRev   = opKeys.reduce((s, k) => s + (opMap[k]?.revenue || 0), 0);
              const totalOpLines = flaggedLines + nonFlagged.count;
              const totalOpRev   = flaggedRev + (nonFlagged.revenue || 0);
              const activeOpKeys = opKeys.filter((k) => (opMap[k]?.count || 0) > 0);
              const zeroOpKeys   = opKeys.filter((k) => !(opMap[k]?.count || 0));

              /* ─────────────── COMMERCIAL ─────────────── */
              const doneStatuses = new Set(summary.pic_done_statuses || ["Commercial Invoice Submitted", "Commercial Invoice Closed"]);
              const activeKeys   = (summary.pic_status_order || summary.commercial_order || []);
              // "Done"/"Active" headline reuses PIC's own Pending/Active/Closed/
              // Cancelled stage classification (same logic PIC's own pages use
              // to route rows) instead of an MS1-only rule — a line's real
              // commercial state depends on BOTH milestones together.
              // Population here matches PIC Tracker's own page exactly: NOT
              // Pending AND NOT Cancelled — i.e. Closed + Active only. Pending
              // (hasn't reached PIC yet — includes POs with no operational
              // work done at all) and Cancelled are both excluded entirely,
              // not folded into "Still Active".
              const stageData    = summary.commercial_stage || [];
              const stageMap     = Object.fromEntries(stageData.map((r) => [r.key || "", r]));
              const comDoneLines  = stageMap["Closed"]?.count || 0;
              const comDoneRev    = stageMap["Closed"]?.revenue || 0;
              const comActiveLines = stageMap["Active"]?.count || 0;
              const comActiveRev   = stageMap["Active"]?.revenue || 0;
              const comGrandTotal = comDoneLines + comActiveLines;
              const comGrandRev   = comDoneRev + comActiveRev;
              const msList = [
                { ms: "MS1", label: "PIC Status (MS1)", data: summary.commercial_ms1 || summary.commercial || [], color: "#0369a1", bd: "#bae6fd", bg: "#f0f9ff", bar: "#0369a1" },
                { ms: "MS2", label: "PIC Status (MS2)", data: summary.commercial_ms2 || [],                       color: "#7c3aed", bd: "#ddd6fe", bg: "#f5f3ff", bar: "#7c3aed" },
              ];

              return (
                <>
                  {/* ══ OPERATIONAL ══ */}
                  <div style={{ marginBottom: 0 }}>
                    <SectionHeader accent="#047857" title="Operational Work Done Categories" sub="by Issue Flag" />
                    <TotalsRow tiles={[
                      { label: "Total Work Done", lines: totalOpLines, revenue: totalOpRev,        bg: "#f0fdf4", fg: "#047857", bd: "#a7f3d0", onClick: () => goToWorkDoneList([]) },
                      { label: "Flagged Lines",   lines: flaggedLines,  revenue: flaggedRev,        bg: "#fff7ed", fg: "#c2410c", bd: "#fed7aa", onClick: () => goToWorkDoneList(opKeys) },
                      { label: "Not Flagged",     lines: nonFlagged.count, revenue: nonFlagged.revenue || 0, bg: "#f8fafc", fg: "#475569", bd: "#e2e8f0", onClick: () => goToWorkDoneList(["__NONE__"]) },
                    ]} />
                    <ProportionBar segments={[
                      { value: flaggedLines, color: "#f97316", label: `Flagged ${totalOpLines > 0 ? Math.round(flaggedLines/totalOpLines*100) : 0}%` },
                      { value: nonFlagged.count, color: "#cbd5e1", label: `Not Flagged ${totalOpLines > 0 ? Math.round(nonFlagged.count/totalOpLines*100) : 0}%` },
                    ]} />
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10, marginTop: 16 }}>
                      {opKeys.map((key) => {
                        const { count = 0, revenue = 0 } = opMap[key] || {};
                        const p = ISSUE_FLAG_PALETTE[key] || { bg: "#f8fafc", fg: "#475569", bd: "#e2e8f0" };
                        return (
                          <StatCard
                            key={key}
                            label={key || "No Flag"}
                            count={count}
                            revenue={revenue}
                            accentColor={p.fg}
                            bdColor={p.bd}
                            bgColor={p.bg}
                            barColor={p.fg}
                            totalLines={flaggedLines}
                            totalRev={flaggedRev}
                            onClick={() => goToWorkDoneList([key || "__NONE__"])}
                          />
                        );
                      })}
                    </div>
                  </div>

                  {/* divider */}
                  <div style={{ height: 1, background: "#e2e8f0", margin: "28px 0" }} />

                  {/* ══ COMMERCIAL ══ */}
                  <div>
                    <SectionHeader accent="#0369a1" title="Commercial Work Done Categories" sub="by PIC Status (MS1 & MS2)" />
                    <TotalsRow tiles={[
                      { label: "Total Work Done Lines", lines: comGrandTotal,  revenue: comGrandRev,   bg: "#eff6ff", fg: "#1d4ed8", bd: "#bfdbfe" },
                      { label: "Commercially Done",     lines: comDoneLines,   revenue: comDoneRev,    bg: "#ecfdf5", fg: "#047857", bd: "#a7f3d0" },
                      { label: "Still Active",          lines: comActiveLines, revenue: comActiveRev,  bg: "#fff7ed", fg: "#c2410c", bd: "#fed7aa" },
                    ]} />
                    <ProportionBar segments={[
                      { value: comDoneLines,   color: "#10b981", label: `Done ${comGrandTotal > 0 ? Math.round(comDoneLines/comGrandTotal*100) : 0}%` },
                      { value: comActiveLines, color: "#f59e0b", label: `Active ${comGrandTotal > 0 ? Math.round(comActiveLines/comGrandTotal*100) : 0}%` },
                    ]} />

                    <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 20 }}>
                      {msList.map(({ ms, label, data, color, bd, bg, bar }) => {
                        const msMap      = Object.fromEntries((data || []).map((r) => [r.key || "", r]));
                        const msTotalL   = (data || []).reduce((s, r) => s + (r.count || 0), 0);
                        const msTotalR   = (data || []).reduce((s, r) => s + (r.revenue || 0), 0);
                        const msDoneL    = (data || []).filter(r => doneStatuses.has(r.key)).reduce((s, r) => s + (r.count || 0), 0);
                        const msDoneR    = (data || []).filter(r => doneStatuses.has(r.key)).reduce((s, r) => s + (r.revenue || 0), 0);
                        return (
                          <div key={ms} style={{ borderLeft: `3px solid ${color}`, paddingLeft: 14 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                              <span style={{ fontSize: "0.72rem", fontWeight: 800, color, textTransform: "uppercase", letterSpacing: "0.06em" }}>{ms}</span>
                              <span style={{ fontSize: "0.72rem", color: "#64748b", fontWeight: 500 }}>{label}</span>
                              <span style={{ fontSize: "0.7rem", color: "#64748b" }}>— {fmt.format(msTotalL)} lines · SAR {fmt.format(msTotalR)}</span>
                              {msDoneL > 0 && (
                                <span style={{ fontSize: "0.68rem", background: "#ecfdf5", color: "#047857", border: "1px solid #a7f3d0", borderRadius: 999, padding: "1px 8px", fontWeight: 600 }}>
                                  ✓ {fmt.format(msDoneL)} done · SAR {fmt.format(msDoneR)}
                                </span>
                              )}
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8 }}>
                              {activeKeys.map((key) => {
                                const { count = 0, revenue = 0 } = msMap[key] || {};
                                return <StatCard key={key} label={key} count={count} revenue={revenue} accentColor={color} bdColor={bd} bgColor={bg} barColor={bar} totalLines={msTotalL} totalRev={msTotalR} />;
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        ) : (
          <>
            <table className="data-table" data-excel-filter-all="1" data-table-key="admin-workdone">
              <thead>
                <tr>
                  <th style={{ width: 36 }}>
                    <input
                      type="checkbox"
                      checked={displayedCount > 0 && filteredRows.slice(0, displayedCount).every((r) => selectedRows.has(r.name))}
                      ref={(el) => { if (el) el.indeterminate = selectedRows.size > 0 && !filteredRows.slice(0, displayedCount).every((r) => selectedRows.has(r.name)); }}
                      onChange={() => {
                        const dtpHidden = new Set(Array.from(document.querySelectorAll("tbody tr[data-tablepro-filtered]")).map((tr) => tr.dataset.docName).filter(Boolean));
                        // Only rows within the current display limit — anything
                        // beyond it is hidden via CSS (see displayLimit above),
                        // not a real filter, but "select all" should still only
                        // ever act on what's actually shown.
                        const visible = filteredRows.slice(0, displayedCount).filter((r) => !dtpHidden.has(r.name));
                        const allSel = visible.length > 0 && visible.every((r) => selectedRows.has(r.name));
                        setSelectedRows(allSel ? new Set() : new Set(visible.map((r) => r.name)));
                      }}
                      title={filteredRows.slice(0, displayedCount).every((r) => selectedRows.has(r.name)) ? "Deselect all" : "Select all"}
                    />
                  </th>
                  <th>POID</th>
                  <th>Dummy POID</th>
                  <th>Execution</th>
                  <th>Item Code</th>
                  <th>Description</th>
                  <th>Activity Type</th>
                  <th>Project</th>
                  <th>Domain</th>
                  <th>Huawei IM</th>
                  <th>Site</th>
                  <th>PO Status</th>
                  <th>Center area</th>
                  <th>Region</th>
                  <th>Team</th>
                  <th>Subcontract</th>
                  <th>Contract Model</th>
                  <th>IM</th>
                  <th>Exec Date</th>
                  <th style={{ textAlign: "right" }} title="Which visit this work-done is (1, 2, 3…)">Visit #</th>
                  <th style={{ textAlign: "right" }}>Qty</th>
                  <th style={{ textAlign: "right" }}>Revenue</th>
                  <th>Submission Status</th>
                  <th>PIC Rejection Reason</th>
                  <th>Work Type</th>
                  <th title="Which milestones are closed for this Work Done">Milestone</th>
                  <th>Issue Flag</th>
                  <th title="Remark set by PM">General</th>
                  <th title="Remark set by IM">Manager</th>
                  <th title="Remark set by Field Team Lead">Team Lead</th>
                  <th data-excel-filter="0">Open</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row, idx) => {
                  const revenue = parseFloat(row.revenue_sar || row.revenue || row.line_amount) || 0;
                  return (
                    <tr key={row.name}
                      data-doc-name={row.name}
                      data-modified={row.modified}
                      className={selectedRows.has(row.name) ? "row-selected" : ""}
                      style={idx >= displayLimit ? { display: "none" } : { ...(row.is_dummy_po ? { background: "#fffbeb" } : {}), cursor: "pointer" }}
                      onClick={() => setSelectedRows((prev) => { const next = new Set(prev); next.has(row.name) ? next.delete(row.name) : next.add(row.name); return next; })}
                    >
                      <td onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedRows.has(row.name)}
                          onChange={() => setSelectedRows((prev) => { const next = new Set(prev); next.has(row.name) ? next.delete(row.name) : next.add(row.name); return next; })}
                        />
                      </td>
                      <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{row.poid || row.po_dispatch || "—"}</td>
                      <td style={{ fontFamily: "monospace", fontSize: "0.72rem", maxWidth: 140 }} title={(row.original_dummy_poid || "").trim() ? `Dummy POID: ${row.original_dummy_poid}` : ""}>
                        {(row.original_dummy_poid || "").trim() || "—"}
                      </td>
                      <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{row.execution || "—"}</td>
                      <td>{row.item_code}</td>
                      <td>{row.item_description || "—"}</td>
                      <td style={{ fontSize: "0.82rem" }}>{row.activity_type || "—"}</td>
                      <td>{row.project_code}</td>
                      <td>{row.project_domain || "—"}</td>
                      <td>{row.huawei_im || "—"}</td>
                      <td>{row.site_name || "—"}</td>
                      <td><PoStatusBadge value={row.dispatch_status} /></td>
                      <td style={{ fontSize: "0.82rem", maxWidth: 120 }} title={row.center_area || ""}>
                        {row.center_area || "—"}
                      </td>
                      <td style={{ fontSize: "0.82rem" }}>{row.region_type || "—"}</td>
                      <td>{row.team_name || row.team || "—"}</td>
                      <td style={{ fontSize: "0.82rem" }}>{row.subcontractor || "—"}</td>
                      <td style={{ fontSize: "0.82rem" }}>{row.contract_model || "—"}</td>
                      <td>{row.im_full_name || row.im || "—"}</td>
                      <td>{row.execution_date || "—"}</td>
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{row.visit_number != null ? row.visit_number : "—"}</td>
                      <td style={{ textAlign: "right" }}>{row.executed_qty}</td>
                      <td style={{ textAlign: "right", color: "var(--green)" }}>{fmt.format(revenue)}</td>
                      <td><StatusPill value={row.submission_status} /></td>
                      <td style={{ fontSize: "0.78rem", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: row.pic_rejection_remark ? "#b91c1c" : "#94a3b8" }} title={row.pic_rejection_remark || ""}>{row.pic_rejection_remark || "—"}</td>
                      <td>
                        {row.source === "Direct Close" && <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: "0.72rem", fontWeight: 700, background: "#dbeafe", color: "#0369a1", border: "1px solid #93c5fd", whiteSpace: "nowrap" }} title={row.direct_close_by ? `Closed by: ${row.direct_close_by_full_name || row.direct_close_by}` : ""}>Direct Close</span>}
                        {row.source === "Backend" && <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: "0.72rem", fontWeight: 700, background: "#ede9fe", color: "#7c3aed", border: "1px solid #c4b5fd", whiteSpace: "nowrap" }}>Backend</span>}
                        {(row.source === "Rollout Execution" || !row.source) && <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: "0.72rem", fontWeight: 700, background: "#dcfce7", color: "#16a34a", border: "1px solid #86efac", whiteSpace: "nowrap" }}>Field Work</span>}
                      </td>
                      <td style={{ fontSize: "0.74rem", whiteSpace: "nowrap" }}>
                        {(() => {
                          const m1 = !!row.ms1_closed, m2 = !!row.ms2_closed;
                          if (!m1 && !m2) return <span style={{ color: "#94a3b8", fontSize: "0.72rem" }}>—</span>;
                          // Per-milestone chip: PIC submission state (empty PIC status = not submitted to PIC)
                          const inv = (s) => {
                            const v = (s || "").trim();
                            if (!v || v === "Work Not Done") return { t: "Not Submitted", bg: "#fef3c7", fg: "#b45309", bd: "#fde68a" };
                            if (v === "Commercial Invoice Closed") return { t: "Inv. Closed", bg: "#dcfce7", fg: "#16a34a", bd: "#86efac" };
                            if (v === "Commercial Invoice Submitted") return { t: "Invoiced", bg: "#dbeafe", fg: "#1d4ed8", bd: "#93c5fd" };
                            if (v.includes("Rejected") || v.includes("Cancel")) return { t: v, bg: "#fee2e2", fg: "#dc2626", bd: "#fecaca" };
                            return { t: "In PIC", bg: "#ede9fe", fg: "#7c3aed", bd: "#c4b5fd" };
                          };
                          const chip = (label, closedAt, pic) => {
                            const c = inv(pic);
                            return (
                              <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: "0.7rem", fontWeight: 700, background: c.bg, color: c.fg, border: `1px solid ${c.bd}`, marginRight: 4, whiteSpace: "nowrap" }}
                                title={`${label} closed: ${String(closedAt || "").slice(0, 10)} · PIC: ${pic || "—"}`}>
                                {label} ✓ · {c.t}
                              </span>
                            );
                          };
                          return <>{m1 ? chip("MS1", row.ms1_closed_at, row.pic_status) : null}{m2 ? chip("MS2", row.ms2_closed_at, row.pic_status_ms2) : null}</>;
                        })()}
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <IssueFlagCell flag={row.issue_flag} onClick={() => openIssueFlagModal(row)} />
                      </td>
                      <td><RemarksCell value={row.general_remark} tone="general" poDispatch={row.po_dispatch || row.poid} poid={row.poid || row.po_dispatch} onSaved={(v) => { row.general_remark = v; }} /></td>
                      <td><RemarksCell value={row.manager_remark} tone="manager" poDispatch={row.po_dispatch || row.poid} poid={row.poid || row.po_dispatch} onSaved={(v) => { row.manager_remark = v; }} /></td>
                      <td><RemarksCell value={row.team_lead_remark} tone="team_lead" poDispatch={row.po_dispatch || row.poid} poid={row.poid || row.po_dispatch} onSaved={(v) => { row.team_lead_remark = v; }} /></td>
                      <td>
                        <button
                          type="button"
                          className="btn-secondary"
                          style={{ fontSize: "0.72rem", padding: "4px 10px" }}
                          onClick={(e) => { e.stopPropagation(); setDetailRow(row); }}
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {filteredRows.length > 0 && (
                <tfoot>
                  <tr style={{ borderTop: "2px solid var(--border-medium)", background: "#f8fafc" }}>
                    <td />
                    <td style={{ fontWeight: 700, color: "var(--text-secondary)", fontSize: "0.75rem", padding: "8px 16px", whiteSpace: "nowrap" }}>
                      {displayedCount} rows
                    </td>
                    <td /><td /><td /><td /><td /><td /><td /><td /><td /><td /><td /><td /><td /><td /><td /><td /><td /><td />
                    <td style={{ textAlign: "right", fontWeight: 700, padding: "8px 16px" }}>{fmt.format(totals.qty)}</td>
                    <td style={{ textAlign: "right", fontWeight: 700, color: "var(--green)", padding: "8px 16px" }}>
                      {fmt.format(totals.revenue)}
                    </td>
                    <td /><td /><td /><td /><td /><td /><td /><td /><td />
                  </tr>
                </tfoot>
              )}
            </table>
            {loading && filteredRows.length === 0 ? (
              <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)" }}>
                Loading work done records…
              </div>
            ) : !loading && filteredRows.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">✅</div>
                <h3>{hasFilters ? "No results match your filters" : "No completed work records"}</h3>
                <p>
                  {hasFilters
                    ? "Try adjusting your search or filter criteria."
                    : "Completed execution records will appear here."}
                </p>
              </div>
            ) : null}
          </>
        )}
        </DataTableWrapper>
        {tab === "list" && (
        <TableRowsLimitFooter
          placement="tableCard"
          loadedCount={displayedCount}
          filteredCount={displayedCount}
          filterActive={!!hasFilters}
        />
        )}
      </div>

      {submissionWarn && (
        <div style={{ margin: "12px 0", padding: "10px 14px", background: "#fffbeb", border: "1px solid #fbbf24", borderRadius: 8, color: "#92400e", fontSize: "0.85rem", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <span>{submissionWarn}</span>
          <button type="button" onClick={() => setSubmissionWarn(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#92400e", fontWeight: 700, flexShrink: 0 }}>✕</button>
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
            style={{ background: "#fff", borderRadius: 12, padding: 24, width: "min(440px, 96vw)", boxShadow: "0 20px 60px rgba(0,0,0,0.22)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: "1rem" }}>Update Submission — {selectedRows.size} rows</h3>
              <button type="button" onClick={() => setBulkModalOpen(false)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8", lineHeight: 1 }} disabled={bulkBusy}>&times;</button>
            </div>
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
                <div className="form-group" style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: 4 }}>Status</label>
                  <select value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)} style={{ padding: "8px 10px", width: "100%", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: "0.9rem" }} disabled={bulkBusy}>
                    <option value="">— Not set —</option>
                    <option value="Ready for Confirmation">Ready for Confirmation</option>
                    <option value="Confirmation Done">Confirmation Done</option>
                  </select>
                </div>
                <div style={{ fontSize: "0.75rem", color: "#64748b", marginBottom: 16 }}>
                  Note: file attachments are not uploaded in bulk. For &quot;Confirmation Done&quot; rows requiring documents, open each row individually.
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                  <button type="button" className="btn-secondary" onClick={() => setBulkModalOpen(false)} disabled={bulkBusy}>Cancel</button>
                  <button type="button" className="btn-primary" onClick={submitBulk} disabled={bulkBusy || !bulkStatus}>
                    {bulkBusy ? "Saving…" : `Apply to ${selectedRows.size} rows`}
                  </button>
                </div>
              </>
            )}
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

      {submissionFor && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setSubmissionFor(null)}>
          <div style={{ width: "min(560px, 94vw)", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 20, maxHeight: "90dvh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
              <h4 style={{ margin: 0, fontSize: "0.95rem" }}>
                Submission Status
                <span style={{ marginLeft: 8, fontFamily: "monospace", color: "#64748b", fontWeight: 500, fontSize: "0.82rem" }}>
                  {submissionFor.poid || submissionFor.po_dispatch || submissionFor.name}
                </span>
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

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>
                Attachments
              </div>

              {attachLoading ? (
                <div style={{ color: "#94a3b8", fontSize: "0.82rem", padding: "6px 0" }}>Loading…</div>
              ) : existingAttachments.length > 0 ? (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 5 }}>Existing Documents</div>
                  <AttachmentSlotList attachments={existingAttachments} docReq={DOC_REQUIREMENTS[submissionFor?.activity_type] || null} />
                </div>
              ) : null}

              {(() => {
                const docReq = DOC_REQUIREMENTS[submissionFor?.activity_type] || null;
                const isConfDone = submissionPick === "Confirmation Done";
                const hasExisting = existingAttachments.length > 0;
                return (
                  <>
                    <FileSlot
                      slotKey="DOC1"
                      slotLabel={docReq?.doc1Label || "Confirmation Mail"}
                      accept=".msg"
                      files={doc1Files}
                      setFiles={setDoc1Files}
                      required={isConfDone && !hasExisting}
                      links={doc1Links}
                      setLinks={setDoc1Links}
                    />
                    {docReq?.doc2 ? (
                      docReq.doc2.parts ? (
                        <div style={{ marginBottom: 10 }}>
                          <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
                            DOC2 — {docReq.doc2.label}
                            {isConfDone && !hasExisting && <span style={{ fontSize: "0.7rem", color: "#ef4444", fontWeight: 600, textTransform: "none", letterSpacing: 0 }}>* required</span>}
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 6, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px" }}>
                            {docReq.doc2.parts.map((part, i) => {
                              const partFiles = doc2PartFiles[i] || [];
                              return (
                                <div key={part.slot}>
                                  <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#1d4ed8", marginBottom: 3 }}>{part.label}</div>
                                  <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", border: `1.5px dashed ${partFiles.length ? "#86efac" : "#cbd5e1"}`, borderRadius: 6, cursor: "pointer", background: partFiles.length ? "#f0fdf4" : "#fff", fontSize: "0.8rem", color: "#64748b" }}>
                                    <span>{partFiles.length ? "✅" : "📁"}</span>
                                    <span style={{ flex: 1 }}>{partFiles.length ? partFiles.map(f => f.name).join(", ") : `Select ${part.label} file`}</span>
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
                        <FileSlot slotKey="DOC2" slotLabel={docReq.doc2.label} accept={docReq.doc2.accept} files={doc2Files} setFiles={setDoc2Files} required={isConfDone && !hasExisting}
                          links={doc2Links} setLinks={setDoc2Links} />
                      )
                    ) : (
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>DOC2</div>
                        <div style={{ fontSize: "0.8rem", color: "#94a3b8", padding: "8px 12px", border: "1px dashed #e2e8f0", borderRadius: 8, background: "#f8fafc" }}>
                          Not required for this activity type
                          <FileSlot slotKey="" slotLabel="Optional attachment" accept="" files={doc2Files} setFiles={setDoc2Files} required={false}
                            links={doc2Links} setLinks={setDoc2Links} />
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>

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

      {detailRow && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setDetailRow(null)}
        >
          <div
            style={{ background: "#fff", borderRadius: 12, padding: 20, width: "min(860px, 94vw)", maxHeight: "78vh", overflow: "auto" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ margin: 0, fontSize: "1rem" }}>Work Done Details</h3>
              <button type="button" onClick={() => setDetailRow(null)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8" }}>&times;</button>
            </div>
            <RecordDetailView
              row={{
                ...detailRow,
                // Hide duplicate dummy POID when it matches the current POID
                original_dummy_poid: (detailRow.original_dummy_poid || "").trim() && String(detailRow.original_dummy_poid).trim() !== String(detailRow.po_dispatch || "").trim()
                  ? detailRow.original_dummy_poid
                  : null,
              }}
              pills={[
                { label: "POID", value: detailRow.poid || detailRow.po_dispatch || "—", tone: "blue" },
                { label: "Work Done", value: detailRow.name || "—", tone: "amber" },
                detailRow.execution ? { label: "Execution", value: detailRow.execution, tone: "green" } : null,
                detailRow.billing_status ? { label: "Billing", value: detailRow.billing_status, tone: /invoiced|closed/i.test(detailRow.billing_status) ? "green" : /pending/i.test(detailRow.billing_status) ? "amber" : "slate" } : null,
                detailRow.source === "Direct Close" && detailRow.direct_close_by ? { label: "Closed By", value: detailRow.direct_close_by_full_name || detailRow.direct_close_by, tone: "blue" } : null,
              ].filter(Boolean)}
              hero={
                <DetailHero>
                  <DetailStatTile label="Item Code" value={detailRow.item_code || "—"} />
                  <DetailStatTile label="Executed Qty" value={detailRow.executed_qty != null ? fmt.format(detailRow.executed_qty) : "—"} tone="blue" />
                  <DetailStatTile label="Revenue (SAR)" value={fmt.format(detailRow.revenue_sar || 0)} tone="green" />
                </DetailHero>
              }
              hiddenFields={[
                "po_dispatch", "item_code",
                "executed_qty", "revenue_sar", "total_cost_sar", "margin_sar",
                "billing_status",
                "im", "im_full_name",
                "direct_close_by", "direct_close_by_full_name",
              ]}
              keyOrder={[
                "item_description",
                "name", "execution", "original_dummy_poid",
                "project_code", "site_code", "site_name",
                "center_area", "region_type", "area",
                "team", "team_name",
                "visit_type", "execution_date",
                "modified",
              ]}
            />
            <IMNoteCallout note={detailRow.manager_remark} />
            <PlanTeamsBreakdown rolloutPlan={detailRow.rollout_plan} />
            <DispatchVisitHistory
              poDispatch={detailRow.po_dispatch}
              rolloutPlan={detailRow.rollout_plan}
              currentPlanName={detailRow.rollout_plan}
            />
          </div>
        </div>
      )}
    </div>
  );
}
