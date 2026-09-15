import { useCallback, useRef, useEffect, useMemo, useState } from "react";
import DataTableWrapper from "../../components/DataTableWrapper";
import PageSummary from "../../components/PageSummary";
import { usePublishedQuery } from "../../hooks/usePublishedQuery";
import TableRowsLimitFooter from "../../components/TableRowsLimitFooter";
import { useDebounced } from "../../hooks/useDebounced";
import { pmApi } from "../../services/api";
import { missingImRows, imRequiredMessage } from "../../utils/requireIm";
import useFilterOptions from "../../hooks/useFilterOptions";
import SearchableSelect from "../../components/SearchableSelect";
import ExportExcelButton from "../../components/ExportExcelButton";
import { handleSearchPaste } from "../../utils/searchPaste";
import { money, qty } from "../../utils/numberFormat";


const STATUS_TABS = [
  { id: "pending", label: "Pending" },
  { id: "done",    label: "Work Done" },
  { id: "all",     label: "All" },
];

function StatusPill({ value }) {
  const v = value || "";
  const bg = v === "Work Done" ? "rgba(16,185,129,0.12)" : "rgba(245,158,11,0.12)";
  const fg = v === "Work Done" ? "#047857" : "#b45309";
  return (
    <span style={{
      display: "inline-block", padding: "2px 8px", borderRadius: 999,
      fontSize: "0.72rem", fontWeight: 700, background: bg, color: fg,
    }}>
      {v || "—"}
    </span>
  );
}

export default function IMBackend() {
  const [canBackend, setCanBackend] = useState(true);
  const [capChecked, setCapChecked] = useState(false);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(new Set());

  const [statusFilter, setStatusFilter] = useState("pending");
  const [search, setSearch] = useState("");
  const searchDebounced = useDebounced(search, 300);
  const [projectFilter, setProjectFilter] = useState([]);
  const [duidFilter, setDuidFilter] = useState([]);
  const [teamFilter, setTeamFilter] = useState([]);

  const [showDoneModal, setShowDoneModal] = useState(false);
  const [doneRemark, setDoneRemark] = useState("");
  const [doneDate, setDoneDate] = useState("");
  const [doneBusy, setDoneBusy] = useState(false);
  const [doneError, setDoneError] = useState(null);
  const [toastMsg, setToastMsg] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await pmApi.getMyBackendCapability();
        if (!cancelled) setCanBackend(!!res?.can_assign_backend);
      } catch {
        if (!cancelled) setCanBackend(false);
      } finally {
        if (!cancelled) setCapChecked(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Manage Table column filters ──────────────────────────────────────
  // Each column's typed value is matched only against that column's own
  // value on the backend (see column_filters / col_filter_map_backend in
  // list_backend_dispatches), not blended into the top search box's wide
  // multi-column search.
  const [columnFilters, setColumnFilters] = useState({});
  useEffect(() => {
    const onFiltersChanged = (e) => {
      if (e.detail?.tableKey !== "im-backend-v1") return;
      setColumnFilters(e.detail.filters || {});
    };
    document.addEventListener("tablepro:filters-changed", onFiltersChanged);
    return () => document.removeEventListener("tablepro:filters-changed", onFiltersChanged);
  }, []);
  // Excel column-filter dropdowns cascade off exactly the query the rows
  // were fetched with (recorded by the fetch below).
  // Published for the header summary — see usePublishedQuery.
  const [summaryQuery, publishSummaryQuery] = usePublishedQuery();
  const queryArgsRef = useRef({});
  useEffect(() => {
    const onRequestOptions = (e) => {
      if (e.detail?.tableKey !== "im-backend-v1") return;
      e.detail.respond(pmApi.getColumnFilterOptions({
        source: "backend_dispatches",
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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = { status: statusFilter };
      if (searchDebounced.trim()) params.search = searchDebounced.trim();
      if (projectFilter.length) params.project_code = projectFilter;
      if (duidFilter.length) params.site_code = duidFilter;
      if (teamFilter.length) params.backend_team = teamFilter;
      const colFilters = JSON.parse(columnFiltersDebounced);
      if (Object.keys(colFilters).length) params.column_filters = colFilters;
      queryArgsRef.current = params;
      publishSummaryQuery(params);
      const res = await pmApi.listBackendDispatches(params);
      setRows(Array.isArray(res) ? res : []);
      setSelected(new Set());
    } catch (err) {
      setError(err.message || "Failed to load backend-assignment list");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, searchDebounced, projectFilter, duidFilter, teamFilter, columnFiltersDebounced]);

  useEffect(() => { load(); }, [load]);

  const { options: dispOpts } = useFilterOptions("PO Dispatch", ["project_code", "site_code"]);
  const projectOptions = dispOpts.project_code || [];
  const duidOptions = dispOpts.site_code || [];
  const [teamOptions, setTeamOptions] = useState([]);
  useEffect(() => {
    pmApi.getBackendTeamOptions().then((opts) => {
      if (Array.isArray(opts)) setTeamOptions(opts);
    }).catch(() => {});
  }, []);

  const hasFilters = !!(search || projectFilter.length || duidFilter.length || teamFilter.length);

  const totalAmount = useMemo(
    () => rows.reduce((s, r) => s + (Number(r.line_amount) || 0), 0),
    [rows],
  );
  const totalQty = useMemo(
    () => rows.reduce((s, r) => s + (Number(r.qty) || 0), 0),
    [rows],
  );

  // Only Pending rows are selectable for Mark Work Done.
  const selectableNames = useMemo(
    () => rows.filter((r) => r.subcon_status === "Pending").map((r) => r.po_dispatch),
    [rows],
  );

  function toggleRow(name) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function toggleAll() {
    const dtpHidden = new Set(Array.from(document.querySelectorAll("tbody tr[data-tablepro-filtered]")).map((tr) => tr.dataset.docName).filter(Boolean));
    const visibleNames = selectableNames.filter((n) => !dtpHidden.has(n));
    if (visibleNames.length === 0) return;
    if (visibleNames.every((n) => selected.has(n))) {
      setSelected(new Set());
    } else {
      setSelected(new Set(visibleNames));
    }
  }

  const selectedAmount = useMemo(() => {
    let total = 0;
    rows.forEach((r) => {
      if (selected.has(r.po_dispatch)) total += Number(r.line_amount) || 0;
    });
    return total;
  }, [rows, selected]);

  function openDoneModal() {
    if (selected.size < 1) return;
    setDoneRemark("");
    setDoneError(null);
    setDoneDate(new Date().toISOString().slice(0, 10));
    setShowDoneModal(true);
  }

  async function submitDone() {
    if (selected.size < 1) return;
    const ids = Array.from(selected);
    const blocked = rows.filter((r) => selected.has(r.po_dispatch) && ["Closed", "Partially Closed", "Submitted", "Partially Submitted", "Cancelled"].includes(r.dispatch_status));
    if (blocked.length > 0) {
      const statuses = [...new Set(blocked.map((r) => r.dispatch_status))].join(", ");
      setDoneError(`Cannot mark done: ${blocked.length} POID${blocked.length !== 1 ? "s have" : " has"} status ${statuses}. Deselect to continue.`);
      return;
    }
    const noIm = missingImRows(rows, selected, "po_dispatch");
    if (noIm.length > 0) {
      setDoneError(imRequiredMessage(noIm, "mark done"));
      return;
    }
    setDoneBusy(true);
    setDoneError(null);
    try {
      const res = await pmApi.markBackendWorkDone(ids, doneDate || "", doneRemark || "");
      const summary = res?.summary || {};
      const okN = summary.updated_count ?? 0;
      const errN = summary.error_count ?? 0;
      if (errN === 0) {
        setShowDoneModal(false);
        setToastMsg(`Marked ${okN} POID${okN !== 1 ? "s" : ""} as Work Done.`);
        setTimeout(() => setToastMsg(null), 4500);
        setSelected(new Set());
        await load();
      } else {
        const firstErr = (res?.errors || [])[0];
        const tail = firstErr ? `${firstErr.poid || firstErr.po_dispatch}: ${firstErr.error}` : "see errors";
        setDoneError(`${okN} marked, ${errN} failed (${tail})`);
        if (okN > 0) await load();
      }
    } catch (err) {
      setDoneError(err.message || "Failed to mark Work Done");
    } finally {
      setDoneBusy(false);
    }
  }

  if (capChecked && !canBackend) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1 className="page-title">Backend</h1>
          </div>
        </div>
        <div className="empty-state" style={{ margin: 16 }}>
          <div className="empty-icon">🔒</div>
          <h3>Backend assignment is not enabled</h3>
          <p>Ask the admin to enable "Can Assign Backend Team" on your IM Master record.</p>
        </div>
      </div>
    );
  }

  const allSelectableSelected = selectableNames.length > 0
    && selectableNames.every((n) => selected.has(n));

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Backend</h1>
        </div>
        <PageSummary source="backend_dispatches" filters={summaryQuery} />
        <div className="page-actions">
          <ExportExcelButton filename="im-backend" rows={rows} />
          <button type="button" className="btn-secondary" onClick={load} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {toastMsg && (
        <div className="notice success" style={{ margin: "0 16px 8px" }}>
          <span>✓</span> {toastMsg}
        </div>
      )}

      <div className="toolbar">
        <input
          type="search"
          placeholder="Search POID, PO, Item, Project, DUID, Team…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onPaste={(e) => handleSearchPaste(e, setSearch)}
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          {STATUS_TABS.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
        <SearchableSelect
              allowBlank multi value={projectFilter} onChange={setProjectFilter} options={projectOptions} placeholder="All Projects" minWidth={170} />
        <SearchableSelect
              allowBlank multi value={duidFilter} onChange={setDuidFilter} options={duidOptions} placeholder="All DUIDs" minWidth={150} />
        <SearchableSelect multi value={teamFilter} onChange={setTeamFilter} options={teamOptions} placeholder="All Teams" minWidth={150} />
        {hasFilters && (
          <button
            className="btn-secondary"
            onClick={() => { setSearch(""); setProjectFilter([]); setDuidFilter([]); setTeamFilter([]); }}
          >
            Clear
          </button>
        )}
        <div className="toolbar-actions">
          {selected.size > 0 && (
            <span style={{ fontSize: "0.78rem", color: "#64748b", whiteSpace: "nowrap" }}>
              {selected.size} selected · SAR {money.format(selectedAmount)}
            </span>
          )}
          <button
            type="button"
            className="btn-primary"
            disabled={selected.size === 0}
            onClick={openDoneModal}
          >
            Mark Work Done ({selected.size})
          </button>
        </div>
      </div>

      {error && (
        <div className="notice error" style={{ margin: "0 16px 8px" }}>
          <span>!</span> {error}
        </div>
      )}

      <div className="page-content">
        <DataTableWrapper>
          <table className="data-table" data-excel-filter-all="1" data-table-key="im-backend-v1">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={allSelectableSelected}
                      disabled={selectableNames.length === 0}
                      onChange={toggleAll}
                    />
                  </th>
                  <th>POID</th>
                  <th>PO No</th>
                  <th>Project</th>
                  <th>Domain</th>
                  <th>Huawei IM</th>
                  <th>Item</th>
                  <th>Description</th>
                  <th style={{ textAlign: "right" }}>Qty</th>
                  <th style={{ textAlign: "right" }}>Amount (SAR)</th>
                  <th>DUID</th>
                  <th>Center area</th>
                  <th>Backend Team</th>
                  <th>Status</th>
                  <th>Completed</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={16} style={{ padding: 0 }}>
                      {loading ? (
                        <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Loading…</div>
                      ) : (
                        <div className="empty-state">
                          <div className="empty-icon">📤</div>
                          <h3>{hasFilters ? "No matching backend-assigned POIDs" : "No backend-assigned POIDs"}</h3>
                          <p>
                            {hasFilters
                              ? "Try adjusting your search or filters."
                              : "Assign POIDs to a backend team from the PO Control page. They'll show up here for tracking and Mark Work Done."}
                          </p>
                        </div>
                      )}
                    </td>
                  </tr>
                ) : rows.map((r) => {
                  const isPending = r.subcon_status === "Pending";
                  return (
                    <tr key={r.po_dispatch}
                        data-doc-name={r.po_dispatch}
                        className={selected.has(r.po_dispatch) ? "row-selected" : ""}
                        onClick={isPending ? () => toggleRow(r.po_dispatch) : undefined}
                        style={{ cursor: isPending ? "pointer" : "default" }}>
                      <td onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selected.has(r.po_dispatch)}
                          disabled={!isPending}
                          onChange={() => toggleRow(r.po_dispatch)}
                          title={isPending ? "" : "Already marked Work Done"}
                        />
                      </td>
                      <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{r.poid || r.po_dispatch}</td>
                      <td>{r.po_no || "—"}</td>
                      <td>{r.project_code || "—"}</td>
                      <td>{r.project_domain || "—"}</td>
                      <td>{r.huawei_im || "—"}</td>
                      <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{r.item_code || "—"}</td>
                      <td style={{ fontSize: "0.82rem", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.item_description || ""}>
                        {r.item_description || "—"}
                      </td>
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.qty != null ? qty.format(r.qty) : "—"}</td>
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money.format(r.line_amount || 0)}</td>
                      <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }} title={r.site_name || ""}>{r.site_code || "—"}</td>
                      <td style={{ fontSize: "0.82rem", maxWidth: 140 }} title={r.center_area || ""}>{r.center_area || "—"}</td>
                      <td style={{ fontSize: "0.82rem" }}>{r.backend_team_name || r.backend_team || "—"}</td>
                      <td><StatusPill value={r.subcon_status} /></td>
                      <td style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
                        {r.subcon_completed_on ? String(r.subcon_completed_on).slice(0, 10) : "—"}
                      </td>
                      <td style={{ fontSize: "0.78rem", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.subcon_remark || ""}>
                        {r.subcon_remark || "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {rows.length > 0 && (
                <tfoot>
                  {/* checkbox·POID·PO No·Project·Domain·Huawei IM·Item·Description = 8 columns,
                      then Qty·Amount (SAR), then DUID..Note = 6 columns */}
                  <tr style={{ borderTop: "2px solid #e2e8f0", background: "#f8fafc" }}>
                    <td style={{ padding: "8px 12px", fontSize: "0.78rem", fontWeight: 700, color: "#64748b", whiteSpace: "nowrap" }} />
                    <td style={{ padding: "8px 12px", fontSize: "0.78rem", fontWeight: 700, color: "#64748b", whiteSpace: "nowrap" }}>
                      {rows.length} row{rows.length !== 1 ? "s" : ""}
                    </td>
                    <td style={{ padding: "8px 12px", fontSize: "0.78rem", fontWeight: 700, color: "#64748b", whiteSpace: "nowrap" }} />
                    <td style={{ padding: "8px 12px", fontSize: "0.78rem", fontWeight: 700, color: "#64748b", whiteSpace: "nowrap" }} />
                    <td style={{ padding: "8px 12px", fontSize: "0.78rem", fontWeight: 700, color: "#64748b", whiteSpace: "nowrap" }} />
                    <td style={{ padding: "8px 12px", fontSize: "0.78rem", fontWeight: 700, color: "#64748b", whiteSpace: "nowrap" }} />
                    <td style={{ padding: "8px 12px", fontSize: "0.78rem", fontWeight: 700, color: "#64748b", whiteSpace: "nowrap" }} />
                    <td style={{ padding: "8px 12px", fontSize: "0.78rem", fontWeight: 700, color: "#64748b", whiteSpace: "nowrap" }} />
                    <td style={{ textAlign: "right", fontWeight: 700, padding: "8px 12px" }}>{qty.format(totalQty)}</td>{/* Qty */}
                    <td style={{ textAlign: "right", fontWeight: 700, padding: "8px 12px" }}>{money.format(totalAmount)}</td>{/* Amount (SAR) */}
                    <td /><td /><td /><td /><td /><td />{/* DUID..Note */}
                  </tr>
                </tfoot>
              )}
            </table>
        </DataTableWrapper>
        <TableRowsLimitFooter
          placement="tableCard"
          loadedCount={rows.length}
          filteredCount={rows.length}
          filterActive={!!hasFilters}
        />
        <div style={{ padding: "6px 16px", fontSize: "0.78rem", color: "#64748b", textAlign: "right" }}>
          {rows.length} row{rows.length !== 1 ? "s" : ""} · Total SAR {money.format(totalAmount)}
        </div>
      </div>

      {showDoneModal && (
        <div style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
             onClick={doneBusy ? undefined : () => setShowDoneModal(false)}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 20, width: "min(480px, 100%)", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)" }}
               onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: "1rem" }}>
                Mark as Work Done <span style={{ color: "#64748b", fontWeight: 500 }}>· {selected.size} POID{selected.size !== 1 ? "s" : ""}</span>
              </h3>
              <button type="button" onClick={() => setShowDoneModal(false)} disabled={doneBusy} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#94a3b8", lineHeight: 1 }}>&times;</button>
            </div>
            <div className="form-group" style={{ marginBottom: 10 }}>
              <label>Completed on</label>
              <input
                type="date"
                value={doneDate}
                onChange={(e) => setDoneDate(e.target.value)}
                disabled={doneBusy}
              />
            </div>
            <div className="form-group" style={{ marginBottom: 10 }}>
              <label>Note (optional)</label>
              <textarea
                rows={3}
                value={doneRemark}
                onChange={(e) => setDoneRemark(e.target.value)}
                placeholder="Closing note from the backend team…"
                disabled={doneBusy}
                style={{ width: "100%", boxSizing: "border-box", padding: "6px 8px", fontSize: "0.85rem", border: "1px solid #e2e8f0", borderRadius: 6, resize: "vertical" }}
              />
            </div>
            {doneError && (
              <div className="notice error" style={{ marginBottom: 10, fontSize: "0.82rem" }}>
                <span>!</span> {doneError}
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button type="button" className="btn-secondary" onClick={() => setShowDoneModal(false)} disabled={doneBusy}>Cancel</button>
              <button type="button" className="btn-primary" onClick={submitDone} disabled={doneBusy}>
                {doneBusy ? "Saving…" : `Mark ${selected.size} as Work Done`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
