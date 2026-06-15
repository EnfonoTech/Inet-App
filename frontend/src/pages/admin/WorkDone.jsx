import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { useDebounced } from "../../hooks/useDebounced";
import DataTableWrapper from "../../components/DataTableWrapper";
import { pmApi } from "../../services/api";
import { useTableRowLimit } from "../../context/TableRowLimitContext";
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

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

const BILLING_STATUSES = ["", "Pending", "Invoiced", "Closed"];

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
              return (
                <a key={f.name} href={f.file_url} download={isMsgFile ? f.file_name : undefined}
                  target={isMsgFile ? undefined : "_blank"} rel="noopener noreferrer"
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", background: i % 2 === 0 ? "#fff" : bg, textDecoration: "none", borderTop: i > 0 ? `1px solid ${bd}` : "none" }}>
                  <span style={{ fontSize: "1rem", flexShrink: 0 }}>{isMsgFile ? "✉️" : "📎"}</span>
                  <div style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.85rem", color: "#1d4ed8" }}>{f.file_name}</div>
                  {f.file_size ? <span style={{ fontSize: "0.72rem", color: "#94a3b8", flexShrink: 0 }}>{f.file_size < 1048576 ? `${Math.round(f.file_size / 1024)} KB` : `${(f.file_size / 1048576).toFixed(1)} MB`}</span> : null}
                  {isMsgFile && <span style={{ fontSize: "0.68rem", color: "#64748b", flexShrink: 0 }}>↓ download</span>}
                </a>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function FileSlot({ slotKey, slotLabel, accept, files, setFiles, required }) {
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
  const [billingFilter, setBillingFilter] = useState([]);
  const [imFilter, setImFilter] = useState([]);
  const [teamFilter, setTeamFilter] = useState([]);
  const [projectFilter, setProjectFilter] = useState([]);
  const [duidFilter, setDuidFilter] = useState([]);
  const [fromDate, setFromDate] = useState(_navWD?.fromDate ?? "");
  const [toDate, setToDate] = useState(_navWD?.toDate ?? "");
  const [excludeBackend, setExcludeBackend] = useState(_navWD?.excludeBackend ?? false);
  const [detailRow, setDetailRow] = useState(null);
  const [selectedRow, setSelectedRow] = useState(null);
  const [submissionFor, setSubmissionFor] = useState(null);
  const [submissionPick, setSubmissionPick] = useState("");
  const [submissionBusy, setSubmissionBusy] = useState(false);
  const [submissionErr, setSubmissionErr] = useState(null);
  const [submissionWarn, setSubmissionWarn] = useState(null);
  const [doc1Files, setDoc1Files] = useState([]);
  const [doc2Files, setDoc2Files] = useState([]);
  const [doc2PartFiles, setDoc2PartFiles] = useState([]);
  const [imNote, setImNote] = useState("");
  const [existingAttachments, setExistingAttachments] = useState([]);
  const [attachLoading, setAttachLoading] = useState(false);

  function openSubmissionModal(r) {
    setSubmissionErr(null);
    setSubmissionPick(r.submission_status || "");
    setDoc1Files([]);
    setDoc2Files([]);
    setDoc2PartFiles([]);
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
      if (doc1Files.length === 0) {
        setSubmissionErr(`DOC1 (${docReq?.doc1Label || "Confirmation Mail"}) is required for Confirmation Done.`);
        return;
      }
      if (docReq?.doc2) {
        const hasDoc2 = docReq.doc2.parts ? doc2PartFiles.flat().length > 0 : doc2Files.length > 0;
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
      if (docReqUp?.doc2?.parts) {
        for (let i = 0; i < docReqUp.doc2.parts.length; i++) {
          for (const file of (doc2PartFiles[i] || [])) {
            await pmApi.uploadImAttachment(po_dispatch, file, docReqUp.doc2.parts[i].slot);
          }
        }
      } else {
        for (const file of doc2Files) await pmApi.uploadImAttachment(po_dispatch, file, "im_doc2");
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

  // Single useEffect with cancellation guard. Replaces the older
  // useResetOnRowLimitChange + separate-load pattern that left the table
  // blank when going from a higher to a lower row limit.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const filters = {};
        if (billingFilter.length) filters.billing_status = billingFilter;
        if (imFilter.length) filters.im = imFilter;
        if (teamFilter.length) filters.team = teamFilter;
        if (projectFilter.length) filters.project_code = projectFilter;
        if (duidFilter.length) filters.site_code = duidFilter;
        if (fromDate) filters.from_date = fromDate;
        if (toDate) filters.to_date = toDate;
        if (excludeBackend) filters.exclude_backend = true;
        if (searchDebounced.trim()) filters.search = searchDebounced.trim();
        const list = await pmApi.listWorkDoneRows(filters, rowLimit);
        if (cancelled) return;
        setRows(Array.isArray(list) ? list : []);
      } catch (err) {
        if (!cancelled) setError(err.message || "Failed to load work done data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [rowLimit, searchDebounced, billingFilter, imFilter, teamFilter, projectFilter, duidFilter, fromDate, toDate, excludeBackend, refreshKey]);

  const hasFilters = !!(searchDebounced || billingFilter.length || imFilter.length || teamFilter.length || projectFilter.length || duidFilter.length || fromDate || toDate);
  // Distinct values across the full master tables — not row-limited.
  const { options: teamOpts } = useFilterOptions("INET Team", ["team_id"]);
  const { options: dispOpts } = useFilterOptions("PO Dispatch", ["project_code", "site_code"]);
  const teams = (teamOpts.team_id || []).map((tid) => {
    const hit = rows.find((r) => r.team === tid);
    return { id: tid, label: hit?.team_name || tid };
  });
  const projects = dispOpts.project_code || [];
  const duids = dispOpts.site_code || [];
  const [knownImOptions, setKnownImOptions] = useState([]);
  useEffect(() => {
    if (!rows.length) return;
    setKnownImOptions((prev) => {
      const seen = new Map(prev.map((o) => [o.id, o.label]));
      for (const r of rows) { if (r.im) seen.set(r.im, r.im_full_name || r.im); }
      return Array.from(seen.entries()).map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
    });
  }, [rows]);

  const totals = rows.reduce(
    (acc, r) => ({
      qty: acc.qty + (parseFloat(r.executed_qty) || 0),
      revenue: acc.revenue + (parseFloat(r.revenue_sar || r.revenue || r.line_amount) || 0),
    }),
    { qty: 0, revenue: 0 }
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Work Done</h1>
          <div className="page-subtitle">Completed work entries with billing status</div>
        </div>
        <div className="page-actions">
          <ExportExcelButton filename="work-done" rows={rows} />
          <button className="btn-secondary" onClick={loadData} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* ── Toolbar ─────────────────────────────────────────── */}
      <div className="toolbar">
        <input
          type="search"
          placeholder="Search POID, dummy POID, Item, Project, Team, IM, Center area, Region…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: "7px 14px", borderRadius: 8,
            border: "1px solid #e2e8f0", fontSize: "0.84rem", minWidth: 280,
          }}
        />
        <SearchableSelect
          multi
          value={billingFilter}
          onChange={setBillingFilter}
          options={BILLING_STATUSES.filter(Boolean)}
          placeholder="All Billing Status"
          minWidth={170}
        />
        <SearchableSelect
          multi
          value={imFilter}
          onChange={setImFilter}
          options={knownImOptions}
          placeholder="All IMs"
          minWidth={150}
        />
        <SearchableSelect
          multi
          value={teamFilter}
          onChange={setTeamFilter}
          options={teams}
          placeholder="All Teams"
          minWidth={150}
        />
        <SearchableSelect
          multi
          value={projectFilter}
          onChange={setProjectFilter}
          options={projects}
          placeholder="All Projects"
          minWidth={170}
        />
        <SearchableSelect
          multi
          value={duidFilter}
          onChange={setDuidFilter}
          options={duids}
          placeholder="All DUIDs"
          minWidth={150}
        />
        <DateRangePicker value={{ from: fromDate, to: toDate }} onChange={({ from, to }) => { setFromDate(from); setToDate(to); }} />
        <button
          type="button"
          onClick={() => setExcludeBackend(!excludeBackend)}
          title={excludeBackend ? "Showing field work only — click to show all" : "Click to hide backend work"}
          style={{
            padding: "6px 12px", fontSize: "0.8rem", fontWeight: 600,
            borderRadius: 7, cursor: "pointer", whiteSpace: "nowrap",
            border: `1px solid ${excludeBackend ? "#1d4ed8" : "#e2e8f0"}`,
            background: excludeBackend ? "#eff6ff" : "#f8fafc",
            color: excludeBackend ? "#1d4ed8" : "#94a3b8",
            transition: "all 0.12s",
          }}
        >
          Field Only
        </button>
        {(hasFilters || excludeBackend) && (
          <button
            className="btn-secondary"
            style={{ fontSize: "0.78rem", padding: "5px 12px" }}
            onClick={() => { setSearch(""); setBillingFilter([]); setImFilter([]); setTeamFilter([]); setProjectFilter([]); setDuidFilter([]); setFromDate(""); setToDate(""); setExcludeBackend(false); }}
          >
            Clear
          </button>
        )}
        <div className="toolbar-actions">
          {selectedRow && (
            <span style={{ fontSize: "0.78rem", color: "#64748b", whiteSpace: "nowrap" }}>
              {selectedRow.poid || selectedRow.po_dispatch} selected
            </span>
          )}
          <button
            type="button"
            className="btn-primary"
            disabled={!selectedRow}
            onClick={() => openSubmissionModal(selectedRow)}
          >
            Update Submission
          </button>
        </div>
      </div>

      <div className="page-content">
        {error && (
          <div className="notice error" style={{ marginBottom: 16 }}>
            <span>⚠</span> {error}
          </div>
        )}

        <DataTableWrapper>
          {loading ? (
            <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)" }}>
              Loading work done records…
            </div>
          ) : rows.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">✅</div>
              <h3>{hasFilters ? "No results match your filters" : "No completed work records"}</h3>
              <p>
                {hasFilters
                  ? "Try adjusting your search or filter criteria."
                  : "Completed execution records will appear here."}
              </p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}>
                    <input
                      type="checkbox"
                      checked={selectedRow != null}
                      onChange={() => setSelectedRow(null)}
                      title="Clear selection"
                    />
                  </th>
                  <th>POID</th>
                  <th>Dummy POID</th>
                  <th>Execution</th>
                  <th>Item Code</th>
                  <th>Description</th>
                  <th>Activity Type</th>
                  <th>Project</th>
                  <th>Site</th>
                  <th>Center area</th>
                  <th>Region</th>
                  <th>Team</th>
                  <th>IM</th>
                  <th>Exec Date</th>
                  <th style={{ textAlign: "right" }} title="Which visit this work-done is (1, 2, 3…)">Visit #</th>
                  <th style={{ textAlign: "right" }}>Qty</th>
                  <th style={{ textAlign: "right" }}>Revenue</th>
                  <th>Submission Status</th>
                  <th>Billing Status</th>
                  <th title="Remark set by PM">General</th>
                  <th title="Remark set by IM">Manager</th>
                  <th title="Remark set by Field Team Lead">Team Lead</th>
                  <th>Open</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const revenue = parseFloat(row.revenue_sar || row.revenue || row.line_amount) || 0;
                  return (
                    <tr key={row.name}
                      className={selectedRow?.name === row.name ? "row-selected" : ""}
                      style={{ ...(row.is_dummy_po ? { background: "#fffbeb" } : {}), cursor: "pointer" }}
                      onClick={() => setSelectedRow((prev) => prev?.name === row.name ? null : row)}
                    >
                      <td onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedRow?.name === row.name}
                          onChange={() => setSelectedRow((prev) => prev?.name === row.name ? null : row)}
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
                      <td>{row.site_name || "—"}</td>
                      <td style={{ fontSize: "0.82rem", maxWidth: 120 }} title={row.center_area || ""}>
                        {row.center_area || "—"}
                      </td>
                      <td style={{ fontSize: "0.82rem" }}>{row.region_type || "—"}</td>
                      <td>{row.team_name || row.team || "—"}</td>
                      <td>{row.im_full_name || row.im || "—"}</td>
                      <td>{row.execution_date || "—"}</td>
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{row.visit_number != null ? row.visit_number : "—"}</td>
                      <td style={{ textAlign: "right" }}>{row.executed_qty}</td>
                      <td style={{ textAlign: "right", color: "var(--green)" }}>{fmt.format(revenue)}</td>
                      <td><StatusPill value={row.submission_status} /></td>
                      <td title={row.pic_status ? `PIC status: ${row.pic_status}` : ""}><StatusPill value={row.billing_status} /></td>
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
              <tfoot>
                <tr style={{ borderTop: "2px solid var(--border-medium)", background: "#f8fafc" }}>
                  <td style={{ fontWeight: 700, color: "var(--text-secondary)", fontSize: "0.75rem", padding: "8px 16px", whiteSpace: "nowrap" }}>
                    {rows.length} rows
                  </td>
                  <td /><td /><td /><td /><td /><td /><td /><td /><td /><td /><td /><td /><td />
                  <td style={{ textAlign: "right", padding: "8px 16px" }} />
                  <td style={{ textAlign: "right", fontWeight: 700, padding: "8px 16px" }}>{fmt.format(totals.qty)}</td>
                  <td style={{ textAlign: "right", fontWeight: 700, color: "var(--green)", padding: "8px 16px" }}>
                    {fmt.format(totals.revenue)}
                  </td>
                  <td /><td /><td /><td /><td /><td />
                </tr>
              </tfoot>
            </table>
          )}
        </DataTableWrapper>
        <TableRowsLimitFooter
          placement="tableCard"
          loadedCount={rows.length}
          filteredCount={rows.length}
          filterActive={!!hasFilters}
        />
      </div>

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
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                        <FileSlot slotKey="DOC2" slotLabel={docReq.doc2.label} accept={docReq.doc2.accept} files={doc2Files} setFiles={setDoc2Files} required={isConfDone && !hasExisting} />
                      )
                    ) : (
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>DOC2</div>
                        <div style={{ fontSize: "0.8rem", color: "#94a3b8", padding: "8px 12px", border: "1px dashed #e2e8f0", borderRadius: 8, background: "#f8fafc" }}>
                          Not required for this activity type
                          <FileSlot slotKey="" slotLabel="Optional attachment" accept="" files={doc2Files} setFiles={setDoc2Files} required={false} />
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
