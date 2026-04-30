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
import { EXECUTION_STATUS_OPTIONS } from "../../constants/executionStatuses";
import RemarksCell from "../../components/RemarksCell";

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
  const [submissionFor, setSubmissionFor] = useState(null);
  const [submissionPick, setSubmissionPick] = useState("Ready for Confirmation");
  const [submissionBusy, setSubmissionBusy] = useState(false);
  const [submissionErr, setSubmissionErr] = useState(null);

  async function submitSubmission() {
    if (!submissionFor) return;
    setSubmissionBusy(true);
    setSubmissionErr(null);
    try {
      if (submissionFor.is_subcon) {
        const dispatch = submissionFor.po_dispatch || submissionFor.poid;
        if (!dispatch) throw new Error("Missing PO Dispatch reference for sub-contract row");
        await pmApi.updateSubconSubmission(dispatch, submissionPick);
      } else {
        if (!submissionFor.name) throw new Error("Missing Work Done name");
        await pmApi.updateWorkDoneSubmission(submissionFor.name, submissionPick);
      }
      setSubmissionFor(null);
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
      </div>
      <div className="page-content">
        <DataTableWrapper>
          {loading ? (
            <div style={{ padding: 32, textAlign: "center", color: "#94a3b8" }}>Loading work done…</div>
          ) : filteredRows.length === 0 ? (
            <div className="empty-state"><h3>{hasFilters ? "No results match your filters" : "No work done rows"}</h3></div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
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
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r) => (
                  <tr key={r.name}>
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
                    <td><RemarksCell value={r.general_remark} tone="general" poDispatch={r.po_dispatch || r.poid} poid={r.poid || r.po_dispatch} onSaved={(v) => { r.general_remark = v; }} /></td>
                    <td><RemarksCell value={r.manager_remark} tone="manager" poDispatch={r.po_dispatch || r.poid} poid={r.poid || r.po_dispatch} onSaved={(v) => { r.manager_remark = v; }} /></td>
                    <td><RemarksCell value={r.team_lead_remark} tone="team_lead" poDispatch={r.po_dispatch || r.poid} poid={r.poid || r.po_dispatch} onSaved={(v) => { r.team_lead_remark = v; }} /></td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt.format(r.revenue_sar || 0)}</td>
                    <td title={r.pic_status ? `PIC status: ${r.pic_status}` : ""}><StatusPill value={r.billing_status} /></td>
                    <td>
                      <button
                        type="button"
                        onClick={() => {
                          setSubmissionErr(null);
                          setSubmissionPick(r.submission_status || "");
                          setSubmissionFor(r);
                        }}
                        style={{ border: "none", background: "none", padding: 0, cursor: "pointer" }}
                        title="Click to set submission status"
                      >
                        <StatusPill value={r.submission_status} />
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

      {submissionFor && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setSubmissionFor(null)}>
          <div style={{ width: "min(520px, 94vw)", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 20 }} onClick={(e) => e.stopPropagation()}>
            <h4 style={{ margin: "0 0 12px" }}>
              Submission status: {submissionFor.is_subcon
                ? (submissionFor.poid || submissionFor.po_dispatch)
                : submissionFor.name}
              {submissionFor.is_subcon && (
                <span style={{ marginLeft: 8, fontSize: "0.7rem", padding: "2px 8px", borderRadius: 999, background: "rgba(167,139,250,0.15)", color: "#7c3aed", fontWeight: 700 }}>Sub-Contract</span>
              )}
            </h4>
            {submissionErr && <div className="notice error" style={{ marginBottom: 10 }}>{submissionErr}</div>}
            <div className="form-group" style={{ marginBottom: 12 }}>
              <label>Status</label>
              <select value={submissionPick} onChange={(e) => setSubmissionPick(e.target.value)} style={{ padding: 8, minWidth: 280, width: "100%" }}>
                <option value="">— Not set —</option>
                <option value="Ready for Confirmation">Ready for Confirmation</option>
                <option value="Confirmation Done">Confirmation Done</option>
              </select>
            </div>
            <button className="btn-primary" disabled={submissionBusy} onClick={submitSubmission}>{submissionBusy ? "…" : "Save"}</button>
            <button type="button" className="btn-secondary" style={{ marginLeft: 8 }} onClick={() => setSubmissionFor(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
