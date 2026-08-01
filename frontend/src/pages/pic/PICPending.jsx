import { useCallback, useEffect, useMemo, useState } from "react";
import DataTableWrapper from "../../components/DataTableWrapper";
import TableRowsLimitFooter from "../../components/TableRowsLimitFooter";
import RecordDetailView, { DetailHero, DetailStatTile } from "../../components/RecordDetailView";
import { useTableRowLimit } from "../../context/TableRowLimitContext";
import { useDebounced } from "../../hooks/useDebounced";
import { pmApi } from "../../services/api";
import useFilterOptions from "../../hooks/useFilterOptions";
import SearchableSelect from "../../components/SearchableSelect";
import ExportExcelButton from "../../components/ExportExcelButton";
import { handleSearchPaste } from "../../utils/searchPaste";
import { PoStatusBadge, PicStatusBadge, IMStatusBadge } from "./picShared";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const fmtInt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

// The only 2 statuses a Pending row can ever carry — see _PIC_PENDING_SQL in
// pic.py. This page's one job: move a line from "not yet reached PIC" to
// flagged-for-cancel, and from flagged to actually cancelled (which moves it
// off this page entirely, onto the Cancelled page).
const TARGET_STATUSES = ["PO Need to Cancel", "PO Line Canceled"];

// PO Dispatch's dispatch_status field — see po_dispatch.json.
const PO_STATUSES = [
  "Pending",
  "Dispatched",
  "Planned",
  "Backend Assigned",
  "Completed",
  "Closed",
  "Cancelled",
];

function DetailModal({ row, onClose }) {
  if (!row) return null;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div style={{ width: "min(820px, 100%)", maxHeight: "88vh", overflow: "auto", background: "#fff", borderRadius: 14, padding: 20, boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700 }}>
            {row.poid || row.po_dispatch}
          </h3>
          <button className="btn-secondary" onClick={onClose}>Close</button>
        </div>
        <RecordDetailView
          row={row}
          pills={[
            row.project_code ? { label: "Project", value: row.project_code, tone: "amber" } : null,
            row.site_code ? { label: "DUID", value: row.site_code, tone: "green" } : null,
            row.dispatch_status ? { label: "PO Status", value: row.dispatch_status, tone: "slate" } : null,
          ].filter(Boolean)}
          hero={
            <DetailHero>
              <DetailStatTile label="Qty" value={row.qty != null ? fmtInt.format(row.qty) : "—"} />
              <DetailStatTile label="Rate" value={row.rate != null ? fmt.format(row.rate) : "—"} />
              <DetailStatTile label="Line Amount" value={fmt.format(row.line_amount || 0)} tone="green" />
              <DetailStatTile label="PIC Status (MS1)" value={row.pic_status_effective || "Work Not Done"} tone="amber" />
            </DetailHero>
          }
          hiddenFields={[
            "po_dispatch", "poid", "project_code", "site_code", "dispatch_status",
            "qty", "rate", "line_amount", "pic_status_effective",
          ]}
          keyOrder={[
            "po_no", "customer", "subcontractor", "contract_model", "im_full_name",
            "project_name", "project_domain", "site_name", "item_code", "item_description",
            "tax_rate", "payment_terms", "im_submission_status", "im_confirmation_note",
            "pic_status_ms2", "pic_detail_remark", "pic_detail_remark_ms2",
          ]}
        />
      </div>
    </div>
  );
}

export default function PICPending() {
  const { rowLimit } = useTableRowLimit();
  const [rows, setRows] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [toastMsg, setToastMsg] = useState(null);
  const [detailRow, setDetailRow] = useState(null);

  const [search, setSearch] = useState("");
  const searchDebounced = useDebounced(search, 300);
  const [projectFilter, setProjectFilter] = useState([]);
  const [duidFilter, setDuidFilter] = useState([]);
  const [poStatusFilter, setPoStatusFilter] = useState([]);
  const [subconFilter, setSubconFilter] = useState([]);

  const [showBulk, setShowBulk] = useState(false);
  const [bulkMilestone, setBulkMilestone] = useState("MS1");
  const [bulkStatus, setBulkStatus] = useState(TARGET_STATUSES[0]);
  const [bulkRemark, setBulkRemark] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkErr, setBulkErr] = useState(null);

  // "Sync to Invoice Closed" — for lines whose PO is already Closed at the
  // dispatch level but PIC never recorded any invoicing status on them
  // (still sitting here as "Work Not Done"). Only enabled when every
  // selected row's PO Status is actually "Closed".
  const [showSyncClosed, setShowSyncClosed] = useState(false);
  const [syncMilestone, setSyncMilestone] = useState("MS1");
  const [syncRemark, setSyncRemark] = useState("");
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncErr, setSyncErr] = useState(null);

  const [refreshKey, setRefreshKey] = useState(0);
  const load = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const portal = {};
        if (searchDebounced.trim()) portal.search = searchDebounced.trim();
        if (projectFilter.length) portal.project_code = projectFilter;
        if (duidFilter.length) portal.site_code = duidFilter;
        if (poStatusFilter.length) portal.dispatch_status = poStatusFilter;
        if (subconFilter.length) portal.subcontractor = subconFilter;
        const res = await pmApi.listPicRows("pending", portal, rowLimit);
        if (cancelled) return;
        setRows(Array.isArray(res?.rows) ? res.rows : []);
        setTotalCount(Number(res?.total_count) || 0);
        setSelected(new Set());
      } catch (err) {
        if (cancelled) return;
        setError(err.message || "Failed to load pending POIDs");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [searchDebounced, projectFilter, duidFilter, poStatusFilter, subconFilter, rowLimit, refreshKey]);

  const { options: dispOpts } = useFilterOptions("PO Dispatch", ["project_code", "site_code", "contract"]);
  const projectOptions = dispOpts.project_code || [];
  const duidOptions = dispOpts.site_code || [];
  const subconOptions = (dispOpts.contract || []).filter(Boolean).map((v) => ({ id: v, label: v }));

  const hasFilters = !!(search || projectFilter.length || duidFilter.length || poStatusFilter.length || subconFilter.length);

  const totals = useMemo(() => {
    const sum = (k) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
    return { qty: sum("qty"), line_amount: sum("line_amount") };
  }, [rows]);

  const canSyncClosed = useMemo(() => {
    if (selected.size === 0) return false;
    const selectedRows = rows.filter((r) => selected.has(r.po_dispatch));
    return selectedRows.length === selected.size && selectedRows.every((r) => r.dispatch_status === "Closed");
  }, [rows, selected]);

  function toggleRow(name) {
    setSelected((p) => {
      const next = new Set(p);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }
  function toggleAll() {
    if (rows.length === 0) return;
    if (rows.every((r) => selected.has(r.po_dispatch))) {
      setSelected(new Set());
    } else {
      setSelected(new Set(rows.map((r) => r.po_dispatch)));
    }
  }

  async function submitBulk() {
    if (!selected.size) return;
    setBulkBusy(true);
    setBulkErr(null);
    try {
      const res = await pmApi.bulkUpdatePicStatus(Array.from(selected), bulkStatus, bulkMilestone, bulkRemark);
      const ok = res?.summary?.updated_count ?? 0;
      const errN = res?.summary?.error_count ?? 0;
      if (errN === 0) {
        setShowBulk(false);
        setToastMsg(`Updated ${ok} POID${ok !== 1 ? "s" : ""} → ${bulkStatus} (${bulkMilestone}).`);
        setTimeout(() => setToastMsg(null), 4500);
        setSelected(new Set());
        await load();
      } else {
        setBulkErr(`${ok} updated, ${errN} failed`);
      }
    } catch (err) {
      setBulkErr(err.message || "Bulk update failed");
    } finally {
      setBulkBusy(false);
    }
  }

  async function submitSyncClosed() {
    if (!canSyncClosed) return;
    setSyncBusy(true);
    setSyncErr(null);
    try {
      const res = await pmApi.bulkUpdatePicStatus(Array.from(selected), "Commercial Invoice Closed", syncMilestone, syncRemark);
      const ok = res?.summary?.updated_count ?? 0;
      const errN = res?.summary?.error_count ?? 0;
      if (errN === 0) {
        setShowSyncClosed(false);
        setToastMsg(`Synced ${ok} POID${ok !== 1 ? "s" : ""} → Commercial Invoice Closed (${syncMilestone}).`);
        setTimeout(() => setToastMsg(null), 4500);
        setSelected(new Set());
        await load();
      } else {
        setSyncErr(`${ok} updated, ${errN} failed`);
      }
    } catch (err) {
      setSyncErr(err.message || "Sync failed");
    } finally {
      setSyncBusy(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h1 className="page-title">Pending</h1>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 999, background: "#f1f5f9", color: "#334155", border: "1px solid #e2e8f0", fontSize: "0.74rem", fontWeight: 700 }}>
              <span style={{ opacity: 0.85 }}>Total Lines</span> <span>{fmtInt.format(totalCount)}</span>
            </div>
          </div>
          <div className="page-subtitle">
            POIDs that haven't reached PIC yet (Work Not Done / no status), plus lines flagged "PO Need to Cancel".
            Select rows to flag them for cancellation or confirm the cancellation.
          </div>
        </div>
        <div className="page-actions">
          <ExportExcelButton filename="pic-pending" rows={rows} />
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
          placeholder="Search POID, PO, Item, Project, DUID…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onPaste={(e) => handleSearchPaste(e, setSearch)}
          style={{ minWidth: 280 }}
        />
        <SearchableSelect multi value={projectFilter} onChange={setProjectFilter} options={projectOptions} placeholder="All Projects" minWidth={170} />
        <SearchableSelect multi value={duidFilter} onChange={setDuidFilter} options={duidOptions} placeholder="All DUIDs" minWidth={150} />
        <SearchableSelect multi value={poStatusFilter} onChange={setPoStatusFilter} options={PO_STATUSES} placeholder="PO Status" minWidth={150} />
        <SearchableSelect multi value={subconFilter} onChange={setSubconFilter} options={subconOptions} placeholder="Subcontract" minWidth={160} />
        {hasFilters && (
          <button className="btn-secondary" onClick={() => { setSearch(""); setProjectFilter([]); setDuidFilter([]); setPoStatusFilter([]); setSubconFilter([]); }}>
            Clear
          </button>
        )}
        <div className="toolbar-actions">
          {selected.size > 0 && (
            <span style={{ fontSize: "0.78rem", color: "#64748b", whiteSpace: "nowrap" }}>
              {selected.size} selected
            </span>
          )}
          <button
            type="button"
            className="btn-primary"
            disabled={selected.size === 0}
            onClick={() => { setBulkErr(null); setBulkStatus(TARGET_STATUSES[0]); setShowBulk(true); }}
          >
            Set Cancellation Status ({selected.size})
          </button>
          {canSyncClosed && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => { setSyncErr(null); setShowSyncClosed(true); }}
              style={{ color: "#047857" }}
            >
              Sync to Invoice Closed ({selected.size})
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="notice error" style={{ margin: "0 16px 8px" }}>
          <span>!</span> {error}
        </div>
      )}

      <div className="page-content">
        <DataTableWrapper>
          <table className="data-table" data-table-key="pic-pending-v2">
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  <input type="checkbox" checked={rows.length > 0 && rows.every((r) => selected.has(r.po_dispatch))} onChange={toggleAll} />
                </th>
                <th>Subcontract</th>
                <th>Contract Model</th>
                <th>POID</th>
                <th>PO No</th>
                <th>Customer</th>
                <th>IM</th>
                <th>PO Status</th>
                <th>Project Domain</th>
                <th>Project</th>
                <th>Item</th>
                <th>Description</th>
                <th>DUID</th>
                <th style={{ textAlign: "right" }}>Qty</th>
                <th style={{ textAlign: "right" }}>Rate</th>
                <th style={{ textAlign: "right" }}>Line Amount</th>
                <th>IM Status</th>
                <th>PIC Status (MS1)</th>
                <th>PIC Status (MS2)</th>
                <th>Remarks</th>
                <th>View</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={20} style={{ padding: 0 }}>
                    {loading ? (
                      <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Loading…</div>
                    ) : (
                      <div className="empty-state">
                        <div className="empty-icon">📥</div>
                        <h3>{hasFilters ? "No matching POIDs" : "Nothing pending"}</h3>
                        <p>{hasFilters ? "Adjust your filters." : "Every POID has either reached PIC or been cancelled."}</p>
                      </div>
                    )}
                  </td>
                </tr>
              ) : rows.map((r) => (
                <tr key={r.po_dispatch}
                    data-doc-name={r.po_dispatch}
                    className={selected.has(r.po_dispatch) ? "row-selected" : ""}
                    onClick={() => toggleRow(r.po_dispatch)}
                    style={{ cursor: "pointer" }}>
                  <td onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(r.po_dispatch)} onChange={() => toggleRow(r.po_dispatch)} />
                  </td>
                  <td style={{ fontSize: "0.82rem" }}>{r.subcontractor || "—"}</td>
                  <td style={{ fontSize: "0.82rem" }}>{r.contract_model || "—"}</td>
                  <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{r.poid || r.po_dispatch}</td>
                  <td>{r.po_no || "—"}</td>
                  <td style={{ fontSize: "0.82rem" }}>{r.customer || "—"}</td>
                  <td style={{ fontSize: "0.82rem" }} title={r.im || ""}>{r.im_full_name || "—"}</td>
                  <td><PoStatusBadge value={r.dispatch_status} /></td>
                  <td style={{ fontSize: "0.82rem" }}>{r.project_domain || "—"}</td>
                  <td title={r.project_name || ""}>{r.project_code || "—"}</td>
                  <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{r.item_code || "—"}</td>
                  <td style={{ fontSize: "0.82rem", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.item_description || ""}>{r.item_description || "—"}</td>
                  <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }} title={r.site_name || ""}>{r.site_code || "—"}</td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.qty != null ? fmtInt.format(r.qty) : "—"}</td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.rate != null ? fmt.format(r.rate) : "—"}</td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{fmt.format(r.line_amount || 0)}</td>
                  <td><IMStatusBadge value={r.im_submission_status} /></td>
                  <td><PicStatusBadge value={r.pic_status_effective} /></td>
                  <td><PicStatusBadge value={r.pic_status_ms2} /></td>
                  <td style={{ fontSize: "0.78rem", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#64748b" }} title={r.pic_detail_remark || r.pic_detail_remark_ms2 || ""}>
                    {r.pic_detail_remark || r.pic_detail_remark_ms2 || "—"}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <button type="button" className="btn-secondary" style={{ padding: "3px 10px", fontSize: "0.78rem" }} onClick={() => setDetailRow(r)}>
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr style={{ background: "#f1f5f9", fontWeight: 700 }}>
                  <td></td>{/* checkbox */}
                  <td colSpan={2} style={{ fontSize: "0.78rem", color: "#475569" }}>
                    {fmtInt.format(rows.length)} row{rows.length !== 1 ? "s" : ""}
                  </td>{/* Subcontract + Contract Model */}
                  <td></td>{/* POID */}
                  <td></td>{/* PO No */}
                  <td></td>{/* Customer */}
                  <td></td>{/* IM */}
                  <td></td>{/* PO Status */}
                  <td></td>{/* Project Domain */}
                  <td></td>{/* Project */}
                  <td></td>{/* Item */}
                  <td></td>{/* Description */}
                  <td></td>{/* DUID */}
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtInt.format(totals.qty)}</td>{/* Qty */}
                  <td></td>{/* Rate */}
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt.format(totals.line_amount)}</td>{/* Line Amount */}
                  <td></td>{/* IM Status */}
                  <td></td>{/* PIC Status MS1 */}
                  <td></td>{/* PIC Status MS2 */}
                  <td></td>{/* Remarks */}
                  <td></td>{/* View */}
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
      </div>

      {showBulk && (
        <div style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
             onClick={bulkBusy ? undefined : () => setShowBulk(false)}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 20, width: "min(440px, 100%)", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)" }}
               onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: "1rem" }}>Set Cancellation Status <span style={{ color: "#64748b", fontWeight: 500 }}>· {selected.size}</span></h3>
              <button type="button" onClick={() => setShowBulk(false)} disabled={bulkBusy} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#94a3b8", lineHeight: 1 }}>&times;</button>
            </div>
            <div className="form-group" style={{ marginBottom: 10 }}>
              <label>Milestone</label>
              <select value={bulkMilestone} onChange={(e) => setBulkMilestone(e.target.value)} disabled={bulkBusy}>
                <option value="MS1">MS1 (1st Payment)</option>
                <option value="MS2">MS2 (2nd Payment)</option>
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 10 }}>
              <label>New Status</label>
              <select value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)} disabled={bulkBusy}>
                {TARGET_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              {bulkStatus === "PO Line Canceled" && (
                <div style={{ fontSize: "0.76rem", color: "#b45309", marginTop: 6 }}>
                  This cancels the whole dispatch and moves it to the Cancelled page.
                </div>
              )}
            </div>
            <div className="form-group" style={{ marginBottom: 10 }}>
              <label>Note (optional)</label>
              <textarea rows={2} value={bulkRemark} onChange={(e) => setBulkRemark(e.target.value)} disabled={bulkBusy}
                style={{ width: "100%", boxSizing: "border-box", padding: "6px 8px", fontSize: "0.85rem", border: "1px solid #e2e8f0", borderRadius: 6, resize: "vertical" }} />
            </div>
            {bulkErr && <div className="notice error" style={{ marginBottom: 10, fontSize: "0.82rem" }}><span>!</span> {bulkErr}</div>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button type="button" className="btn-secondary" onClick={() => setShowBulk(false)} disabled={bulkBusy}>Cancel</button>
              <button type="button" className="btn-primary" onClick={submitBulk} disabled={bulkBusy}>
                {bulkBusy ? "Updating…" : `Update ${selected.size}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {showSyncClosed && (
        <div style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
             onClick={syncBusy ? undefined : () => setShowSyncClosed(false)}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 20, width: "min(440px, 100%)", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)" }}
               onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: "1rem" }}>Sync to Invoice Closed <span style={{ color: "#64748b", fontWeight: 500 }}>· {selected.size}</span></h3>
              <button type="button" onClick={() => setShowSyncClosed(false)} disabled={syncBusy} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#94a3b8", lineHeight: 1 }}>&times;</button>
            </div>
            <div style={{ fontSize: "0.82rem", color: "#64748b", marginBottom: 12 }}>
              These POIDs are already "Closed" at the PO Status level, but PIC never recorded any invoicing
              status on them. Sets the chosen milestone to "Commercial Invoice Closed" for every selected line.
            </div>
            <div className="form-group" style={{ marginBottom: 10 }}>
              <label>Milestone</label>
              <select value={syncMilestone} onChange={(e) => setSyncMilestone(e.target.value)} disabled={syncBusy}>
                <option value="MS1">MS1 (1st Payment)</option>
                <option value="MS2">MS2 (2nd Payment)</option>
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 10 }}>
              <label>Note (optional)</label>
              <textarea rows={2} value={syncRemark} onChange={(e) => setSyncRemark(e.target.value)} disabled={syncBusy}
                style={{ width: "100%", boxSizing: "border-box", padding: "6px 8px", fontSize: "0.85rem", border: "1px solid #e2e8f0", borderRadius: 6, resize: "vertical" }} />
            </div>
            {syncErr && <div className="notice error" style={{ marginBottom: 10, fontSize: "0.82rem" }}><span>!</span> {syncErr}</div>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button type="button" className="btn-secondary" onClick={() => setShowSyncClosed(false)} disabled={syncBusy}>Cancel</button>
              <button type="button" className="btn-primary" onClick={submitSyncClosed} disabled={syncBusy}>
                {syncBusy ? "Updating…" : `Update ${selected.size}`}
              </button>
            </div>
          </div>
        </div>
      )}

      <DetailModal row={detailRow} onClose={() => setDetailRow(null)} />
    </div>
  );
}
