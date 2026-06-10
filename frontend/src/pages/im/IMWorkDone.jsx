import { useEffect, useMemo, useState } from "react";
import DataTableWrapper from "../../components/DataTableWrapper";
import { useAuth } from "../../context/AuthContext";
import { useTableRowLimit } from "../../context/TableRowLimitContext";
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

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });
const money = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });

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

export default function IMWorkDone() {
  const { imName } = useAuth();
  const { rowLimit } = useTableRowLimit();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const searchDebounced = useDebounced(search, 300);
  const [billingFilter, setBillingFilter] = useState([]);
  const [submissionFilter, setSubmissionFilter] = useState([]);
  const [execStatusFilter, setExecStatusFilter] = useState([]);
  const [projectFilter, setProjectFilter] = useState([]);
  const [duidFilter, setDuidFilter] = useState([]);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [selectedRow, setSelectedRow] = useState(null);
  const [submissionFor, setSubmissionFor] = useState(null);
  const [detailRow, setDetailRow] = useState(null);
  const [submissionPick, setSubmissionPick] = useState("");
  const [submissionBusy, setSubmissionBusy] = useState(false);
  const [submissionErr, setSubmissionErr] = useState(null);
  const [submissionWarn, setSubmissionWarn] = useState(null);
  const [attachFiles, setAttachFiles] = useState([]);
  const [existingAttachments, setExistingAttachments] = useState([]);
  const [attachLoading, setAttachLoading] = useState(false);
  const [detailAttachments, setDetailAttachments] = useState([]);
  const [detailAttachLoading, setDetailAttachLoading] = useState(false);

  function openSubmissionModal(r) {
    setSubmissionErr(null);
    setSubmissionPick(r.submission_status || "");
    setAttachFiles([]);
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
    if (needsAttach && existingAttachments.length === 0 && attachFiles.length === 0) {
      setSubmissionErr("At least one attachment is required when setting Confirmation Done.");
      return;
    }
    setSubmissionBusy(true);
    setSubmissionErr(null);
    try {
      const docname = submissionFor.is_subcon ? (submissionFor.po_dispatch || submissionFor.poid) : submissionFor.name;
      const po_dispatch = submissionFor.po_dispatch || submissionFor.poid;
      if (!docname) throw new Error("Missing document reference");
      if (!po_dispatch) throw new Error("Missing PO Dispatch reference");
      for (const file of attachFiles) {
        await pmApi.uploadImAttachment(po_dispatch, file);
      }
      let res;
      if (submissionFor.is_subcon) {
        res = await pmApi.updateSubconSubmission(docname, submissionPick);
      } else {
        res = await pmApi.updateWorkDoneSubmission(submissionFor.name, submissionPick);
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
  const loadData = () => setRefreshKey((k) => k + 1);

  // Single useEffect with cancellation guard. Replaces the older
  // useResetOnRowLimitChange + separate-load pattern that left the table
  // blank when going from a higher to a lower row limit.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const filters = { im: imName || "" };
        if (searchDebounced.trim()) filters.search = searchDebounced.trim();
        if (billingFilter.length) filters.billing_status = billingFilter;
        if (projectFilter.length) filters.project_code = projectFilter;
        if (duidFilter.length) filters.site_code = duidFilter;
        if (fromDate) filters.from_date = fromDate;
        if (toDate) filters.to_date = toDate;
        const list = await pmApi.listWorkDoneRows(filters, rowLimit);
        if (cancelled) return;
        setRows(Array.isArray(list) ? list : []);
      } catch {
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [imName, rowLimit, searchDebounced, billingFilter, projectFilter, duidFilter, fromDate, toDate, refreshKey]);

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

  const filteredRows = useMemo(() => rows.filter((r) => {
    if (submissionFilter.length) {
      const sub = r.submission_status || "";
      const wantsNone = submissionFilter.includes("__NONE__");
      const nonNone = submissionFilter.filter((v) => v !== "__NONE__");
      const match = (wantsNone && !sub) || nonNone.includes(sub);
      if (!match) return false;
    }
    if (execStatusFilter.length && !execStatusFilter.includes(r.execution_status || "")) return false;
    return true;
  }), [rows, submissionFilter, execStatusFilter]);

  const { options: dispOpts } = useFilterOptions("PO Dispatch", ["project_code", "site_code"]);
  const projectOptions = dispOpts.project_code || [];
  const duidOptions = dispOpts.site_code || [];
  const hasFilters = !!(search || billingFilter.length || submissionFilter.length || execStatusFilter.length || projectFilter.length || duidFilter.length || fromDate || toDate);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Work Done</h1>
          <div className="page-subtitle">Completed work rows for your IM scope.</div>
        </div>
        <div className="page-actions">
          <ExportExcelButton filename="im-work-done" rows={filteredRows} />
          <button className="btn-secondary" onClick={loadData} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
        </div>
      </div>
      <div className="toolbar">
        <input
          type="search"
          placeholder="Search POID, dummy POID, execution, project, DUID, item…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem", minWidth: 240 }}
        />
        <SearchableSelect
          multi
          value={submissionFilter}
          onChange={setSubmissionFilter}
          options={[{ id: "__NONE__", label: "Not set" }, { id: "Ready for Confirmation", label: "Ready for Confirmation" }, { id: "Confirmation Done", label: "Confirmation Done" }]}
          placeholder="All Submission"
          minWidth={150}
        />
        <SearchableSelect
          multi
          value={billingFilter}
          onChange={setBillingFilter}
          options={["Pending", "Invoiced", "Closed"]}
          placeholder="All Billing"
          minWidth={130}
        />
        <SearchableSelect
          multi
          value={execStatusFilter}
          onChange={setExecStatusFilter}
          options={EXECUTION_STATUS_OPTIONS}
          placeholder="All Exec Status"
          minWidth={150}
        />
        <SearchableSelect multi value={projectFilter} onChange={setProjectFilter} options={projectOptions} placeholder="All Projects" minWidth={170} />
        <SearchableSelect multi value={duidFilter} onChange={setDuidFilter} options={duidOptions} placeholder="All DUIDs" minWidth={150} />
        <DateRangePicker value={{ from: fromDate, to: toDate }} onChange={({ from, to }) => { setFromDate(from); setToDate(to); }} />
        {hasFilters && (
          <button
            className="btn-secondary"
            style={{ fontSize: "0.78rem", padding: "5px 12px" }}
            onClick={() => { setSearch(""); setBillingFilter([]); setSubmissionFilter([]); setExecStatusFilter([]); setProjectFilter([]); setDuidFilter([]); setFromDate(""); setToDate(""); }}
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
        <DataTableWrapper>
          {loading ? (
            <div style={{ padding: 32, textAlign: "center", color: "#94a3b8" }}>Loading work done…</div>
          ) : filteredRows.length === 0 ? (
            <div className="empty-state"><h3>{hasFilters ? "No results match your filters" : "No work done rows"}</h3></div>
          ) : (
            <table className="data-table" data-table-key="im-workdone-v1">
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
                  <th>Project Code</th>
                  <th>Project Name</th>
                  <th>POID</th>
                  <th>DUID</th>
                  <th>Item Description</th>
                  <th style={{ textAlign: "right" }}>Line Amount</th>
                  <th>Region</th>
                  <th>Huawei IM</th>
                  <th>Planning Timestamp</th>
                  <th style={{ textAlign: "right" }}>Dispatch Seq</th>
                  <th>Plan Date</th>
                  <th>Assigned Team</th>
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
                  <th>Billing Status</th>
                  <th>Submission Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r) => (
                  <tr
                    key={r.name}
                    className={selectedRow?.name === r.name ? "row-selected" : ""}
                    onClick={() => setSelectedRow((prev) => prev?.name === r.name ? null : r)}
                    style={{ cursor: "pointer" }}
                  >
                    <td style={{ width: 36, padding: "6px 4px", textAlign: "center", boxSizing: "border-box" }} onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedRow?.name === r.name}
                        onChange={() => setSelectedRow((prev) => prev?.name === r.name ? null : r)}
                      />
                    </td>
                    <td>{r.project_code || "—"}</td>
                    <td style={{ fontSize: "0.82rem", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.project_name || ""}>{r.project_name || "—"}</td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{r.poid || r.po_dispatch || "—"}</td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{r.site_code || "—"}</td>
                    <td style={{ fontSize: "0.82rem", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.item_description || ""}>{r.item_description || "—"}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.line_amount != null ? money.format(r.line_amount) : "—"}</td>
                    <td><StatusPill value={r.region_type} /></td>
                    <td style={{ fontSize: "0.82rem" }}>{r.im_full_name || r.im || "—"}</td>
                    <td style={{ fontSize: "0.78rem", color: "#64748b" }}>{fmtTimestamp(r.planning_timestamp)}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.dispatch_seq != null ? r.dispatch_seq : "—"}</td>
                    <td>{r.plan_date || "—"}</td>
                    <td>{r.team_name || r.team || "—"}</td>
                    <td><StatusPill value={r.dispatch_status} /></td>
                    <td>{r.execution_date || "—"}</td>
                    <td><StatusPill value={r.execution_status} /></td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{r.visit_number != null ? r.visit_number : "—"}</td>
                    <td><StatusPill value={r.ciag_status} /></td>
                    <td><StatusPill value={r.qc_status} /></td>
                    <td style={{ fontSize: "0.82rem", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.execution_remarks || ""}>{r.execution_remarks || "—"}</td>
                    <td onClick={(e) => e.stopPropagation()}><RemarksCell value={r.general_remark} tone="general" poDispatch={r.po_dispatch || r.poid} poid={r.poid || r.po_dispatch} onSaved={(v) => { r.general_remark = v; }} /></td>
                    <td onClick={(e) => e.stopPropagation()}><RemarksCell value={r.manager_remark} tone="manager" poDispatch={r.po_dispatch || r.poid} poid={r.poid || r.po_dispatch} onSaved={(v) => { r.manager_remark = v; }} /></td>
                    <td onClick={(e) => e.stopPropagation()}><RemarksCell value={r.team_lead_remark} tone="team_lead" poDispatch={r.po_dispatch || r.poid} poid={r.poid || r.po_dispatch} onSaved={(v) => { r.team_lead_remark = v; }} /></td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt.format(r.revenue_sar || 0)}</td>
                    <td title={r.pic_status ? `PIC status: ${r.pic_status}` : ""}><StatusPill value={r.billing_status} /></td>
                    <td><StatusPill value={r.submission_status} /></td>
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
            </table>
          )}
        </DataTableWrapper>
        <TableRowsLimitFooter
          placement="tableCard"
          loadedCount={rows.length}
          filteredCount={filteredRows.length}
          filterActive={hasFilters}
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
              <div><strong>Revenue:</strong> {fmt.format(detailRow.revenue_sar || 0)}</div>
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
                  IM Documents ({detailAttachments.length})
                </div>
                <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px" }}>
                  {detailAttachments.map((f) => (
                    <div key={f.name} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0", fontSize: "0.82rem" }}>
                      <span style={{ color: "#64748b" }}>📎</span>
                      <a href={f.file_url} target="_blank" rel="noopener noreferrer" style={{ color: "#1d4ed8", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 460 }}>
                        {f.file_name}
                      </a>
                      {f.file_size ? (
                        <span style={{ color: "#94a3b8", fontSize: "0.72rem", flexShrink: 0 }}>
                          {f.file_size < 1024 * 1024
                            ? `${Math.round(f.file_size / 1024)} KB`
                            : `${(f.file_size / (1024 * 1024)).toFixed(1)} MB`}
                        </span>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
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
                <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
                  Attachments
                  {submissionPick === "Confirmation Done" && (
                    <span style={{ fontSize: "0.7rem", color: "#ef4444", fontWeight: 600, textTransform: "none", letterSpacing: 0 }}>* required</span>
                  )}
                  <span style={{ fontSize: "0.7rem", color: "#64748b", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>— saved to PO Dispatch</span>
                </div>

                {attachLoading ? (
                  <div style={{ color: "#94a3b8", fontSize: "0.82rem", padding: "6px 0" }}>Loading…</div>
                ) : existingAttachments.length > 0 ? (
                  <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", marginBottom: 8 }}>
                    <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#64748b", marginBottom: 4 }}>EXISTING ({existingAttachments.length})</div>
                    {existingAttachments.map((f) => (
                      <div key={f.name} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0", fontSize: "0.82rem" }}>
                        <span style={{ color: "#64748b" }}>📎</span>
                        <a href={f.file_url} target="_blank" rel="noopener noreferrer" style={{ color: "#1d4ed8", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 360 }}>
                          {f.file_name}
                        </a>
                        {f.file_size ? (
                          <span style={{ color: "#94a3b8", fontSize: "0.72rem", flexShrink: 0 }}>
                            {f.file_size < 1024 * 1024
                              ? `${Math.round(f.file_size / 1024)} KB`
                              : `${(f.file_size / (1024 * 1024)).toFixed(1)} MB`}
                          </span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}

                <label style={{
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                  gap: 6, padding: "12px 16px", border: "2px dashed #cbd5e1", borderRadius: 8,
                  cursor: "pointer", background: "#f8fafc", color: "#64748b", fontSize: "0.82rem",
                }}>
                  <span style={{ fontSize: "1.3rem" }}>📁</span>
                  <span>Click to attach files (PDF, Excel, email, images, any type)</span>
                  {attachFiles.length > 0 && (
                    <span style={{ color: "#047857", fontWeight: 600 }}>{attachFiles.length} file{attachFiles.length !== 1 ? "s" : ""} selected</span>
                  )}
                  <input
                    type="file"
                    multiple
                    style={{ display: "none" }}
                    onChange={(e) => setAttachFiles(Array.from(e.target.files))}
                  />
                </label>

                {attachFiles.length > 0 && (
                  <div style={{ marginTop: 6, background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 6, padding: "6px 10px" }}>
                    {attachFiles.map((f, i) => (
                      <div key={i} style={{ fontSize: "0.8rem", color: "#14532d", display: "flex", alignItems: "center", gap: 6 }}>
                        <span>📄</span> {f.name}
                        <span style={{ color: "#16a34a", fontSize: "0.72rem" }}>
                          {f.size < 1024 * 1024
                            ? `${Math.round(f.size / 1024)} KB`
                            : `${(f.size / (1024 * 1024)).toFixed(1)} MB`}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
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
