import { useCallback, useEffect, useState } from "react";
import DataTableWrapper from "../../components/DataTableWrapper";
import { pmApi } from "../../services/api";
import { useTableRowLimit, useResetOnRowLimitChange } from "../../context/TableRowLimitContext";
import TableRowsLimitFooter from "../../components/TableRowsLimitFooter";
import useFilterOptions from "../../hooks/useFilterOptions";
import SearchableSelect from "../../components/SearchableSelect";
import RecordDetailView, { DetailHero, DetailStatTile } from "../../components/RecordDetailView";
import RemarksCell from "../../components/RemarksCell";
import DateRangePicker from "../../components/DateRangePicker";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

const BILLING_STATUSES = ["", "Pending", "Invoiced", "Closed"];

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
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [search, setSearch] = useState("");
  const [billingFilter, setBillingFilter] = useState([]);
  const [teamFilter, setTeamFilter] = useState([]);
  const [projectFilter, setProjectFilter] = useState([]);
  const [duidFilter, setDuidFilter] = useState([]);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [detailRow, setDetailRow] = useState(null);
  const [submissionFor, setSubmissionFor] = useState(null);
  const [submissionPick, setSubmissionPick] = useState("");
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

  useResetOnRowLimitChange(() => {
    setRows([]);
    setLoading(true);
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const filters = {};
      if (billingFilter.length) filters.billing_status = billingFilter;
      if (teamFilter.length) filters.team = teamFilter;
      if (projectFilter.length) filters.project_code = projectFilter;
      if (duidFilter.length) filters.site_code = duidFilter;
      if (fromDate) filters.from_date = fromDate;
      if (toDate) filters.to_date = toDate;
      if (search.trim()) filters.search = search.trim();
      const list = await pmApi.listWorkDoneRows(filters, rowLimit);
      setRows(Array.isArray(list) ? list : []);
    } catch (err) {
      setError(err.message || "Failed to load work done data");
    } finally {
      setLoading(false);
    }
  }, [rowLimit, search, billingFilter, teamFilter, projectFilter, duidFilter, fromDate, toDate]);

  useEffect(() => { loadData(); }, [loadData]);

  const hasFilters = !!(search || billingFilter.length || teamFilter.length || projectFilter.length || duidFilter.length || fromDate || toDate);
  // Distinct values across the full master tables — not row-limited.
  const { options: teamOpts } = useFilterOptions("INET Team", ["team_id"]);
  const { options: dispOpts } = useFilterOptions("PO Dispatch", ["project_code", "site_code"]);
  const teams = (teamOpts.team_id || []).map((tid) => {
    const hit = rows.find((r) => r.team === tid);
    return { id: tid, label: hit?.team_name || tid };
  });
  const projects = dispOpts.project_code || [];
  const duids = dispOpts.site_code || [];

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
        {hasFilters && (
          <button
            className="btn-secondary"
            style={{ fontSize: "0.78rem", padding: "5px 12px" }}
            onClick={() => { setSearch(""); setBillingFilter([]); setTeamFilter([]); setProjectFilter([]); setDuidFilter([]); setFromDate(""); setToDate(""); }}
          >
            Clear
          </button>
        )}
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
                    <tr key={row.name}>
                      <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{row.poid || row.po_dispatch || "—"}</td>
                      <td style={{ fontFamily: "monospace", fontSize: "0.72rem", maxWidth: 140 }} title={(row.original_dummy_poid || "").trim() ? `Dummy POID: ${row.original_dummy_poid}` : ""}>
                        {(row.original_dummy_poid || "").trim() || "—"}
                      </td>
                      <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{row.execution || "—"}</td>
                      <td>{row.item_code}</td>
                      <td>{row.item_description || "—"}</td>
                      <td style={{ fontSize: "0.82rem" }}>{row.customer_activity_type || "—"}</td>
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
                      <td>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSubmissionErr(null);
                            setSubmissionPick(row.submission_status || "");
                            setSubmissionFor(row);
                          }}
                          style={{ border: "none", background: "none", padding: 0, cursor: "pointer" }}
                          title="Click to change submission status"
                        >
                          <StatusPill value={row.submission_status} />
                        </button>
                      </td>
                      <td title={row.pic_status ? `PIC status: ${row.pic_status}` : ""}><StatusPill value={row.billing_status} /></td>
                      <td><RemarksCell value={row.general_remark} tone="general" poDispatch={row.po_dispatch || row.poid} poid={row.poid || row.po_dispatch} onSaved={(v) => { row.general_remark = v; }} /></td>
                      <td><RemarksCell value={row.manager_remark} tone="manager" poDispatch={row.po_dispatch || row.poid} poid={row.poid || row.po_dispatch} onSaved={(v) => { row.manager_remark = v; }} /></td>
                      <td><RemarksCell value={row.team_lead_remark} tone="team_lead" poDispatch={row.po_dispatch || row.poid} poid={row.poid || row.po_dispatch} onSaved={(v) => { row.team_lead_remark = v; }} /></td>
                      <td>
                        <button
                          type="button"
                          className="btn-secondary"
                          style={{ fontSize: "0.72rem", padding: "4px 10px" }}
                          onClick={() => setDetailRow(row)}
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
                  <td colSpan={14} style={{ fontWeight: 700, color: "var(--text-secondary)", fontSize: "0.78rem", padding: "10px 16px" }}>
                    TOTALS ({rows.length} rows)
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 700, padding: "10px 16px" }}>{fmt.format(totals.qty)}</td>
                  <td style={{ textAlign: "right", fontWeight: 700, color: "var(--green)", padding: "10px 16px" }}>
                    {fmt.format(totals.revenue)}
                  </td>
                  <td />
                  <td />
                  <td />
                  <td />
                  <td />
                  <td />
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
                  <DetailStatTile label="Cost (SAR)" value={fmt.format(detailRow.total_cost_sar || 0)} tone="amber" />
                  <DetailStatTile
                    label="Margin (SAR)"
                    value={fmt.format(detailRow.margin_sar || 0)}
                    tone={(detailRow.margin_sar || 0) < 0 ? "rose" : "green"}
                  />
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
          </div>
        </div>
      )}
    </div>
  );
}
