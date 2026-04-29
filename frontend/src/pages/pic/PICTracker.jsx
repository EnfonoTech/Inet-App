import { useCallback, useEffect, useMemo, useState } from "react";
import DataTableWrapper from "../../components/DataTableWrapper";
import TableRowsLimitFooter from "../../components/TableRowsLimitFooter";
import { useTableRowLimit } from "../../context/TableRowLimitContext";
import { useDebounced } from "../../hooks/useDebounced";
import { pmApi } from "../../services/api";
import useFilterOptions from "../../hooks/useFilterOptions";
import SearchableSelect from "../../components/SearchableSelect";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const fmtInt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

const PIC_STATUSES = [
  "Work Not Done",
  "Under Process to Apply",
  "Under I-BUY",
  "Under ISDP",
  "I-BUY Rejected",
  "ISDP Rejected",
  "Ready for Invoice",
  "Commercial Invoice Submitted",
  "Commercial Invoice Closed",
  "PO Need to Cancel",
  "PO Line Canceled",
];

function StatusPill({ value }) {
  if (!value) return <span style={{ color: "#94a3b8" }}>—</span>;
  const v = String(value);
  let bg = "rgba(100,116,139,0.10)", fg = "#475569";
  if (/Closed|Accepted|Done|Submitted/i.test(v) && /Invoice|PAT/i.test(v)) { bg = "rgba(16,185,129,0.12)"; fg = "#047857"; }
  else if (/Ready/i.test(v))  { bg = "rgba(59,130,246,0.10)";  fg = "#1d4ed8"; }
  else if (/Under I-BUY/i.test(v)) { bg = "rgba(139,92,246,0.10)"; fg = "#6d28d9"; }
  else if (/Under ISDP/i.test(v))  { bg = "rgba(168,85,247,0.10)"; fg = "#7e22ce"; }
  else if (/Process|Apply|Pending/i.test(v)) { bg = "rgba(245,158,11,0.10)"; fg = "#b45309"; }
  else if (/Rejected|Cancel/i.test(v))       { bg = "rgba(239,68,68,0.10)"; fg = "#b91c1c"; }
  return (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: "0.72rem", fontWeight: 700, background: bg, color: fg }}>
      {v}
    </span>
  );
}

export default function PICTracker() {
  const { rowLimit } = useTableRowLimit();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [toastMsg, setToastMsg] = useState(null);

  const [search, setSearch] = useState("");
  const searchDebounced = useDebounced(search, 300);
  const [picFilter, setPicFilter] = useState([]);
  const [picMs2Filter, setPicMs2Filter] = useState([]);
  const [projectFilter, setProjectFilter] = useState([]);
  const [duidFilter, setDuidFilter] = useState([]);

  // Per-row edit popover
  const [editFor, setEditFor] = useState(null);
  const [editFields, setEditFields] = useState({});
  const [editBusy, setEditBusy] = useState(false);
  const [editErr, setEditErr] = useState(null);

  // Bulk action modal
  const [showBulk, setShowBulk] = useState(false);
  const [bulkMilestone, setBulkMilestone] = useState("MS1");
  const [bulkStatus, setBulkStatus] = useState("Under Process to Apply");
  const [bulkRemark, setBulkRemark] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkErr, setBulkErr] = useState(null);

  // refreshKey bumps fire a manual reload (Refresh button) without changing
  // any filter state. The single useEffect below is the only place that
  // fetches; its cancellation guard prevents a slow earlier fetch from
  // overwriting a fast newer one when the user changes the row limit.
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
        if (picFilter.length) portal.pic_status = picFilter;
        if (picMs2Filter.length) portal.pic_status_ms2 = picMs2Filter;
        if (projectFilter.length) portal.project_code = projectFilter;
        if (duidFilter.length) portal.site_code = duidFilter;
        const list = await pmApi.listPicRows(portal, rowLimit);
        if (cancelled) return;
        setRows(Array.isArray(list) ? list : []);
        setSelected(new Set());
      } catch (err) {
        if (cancelled) return;
        setError(err.message || "Failed to load PIC rows");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDebounced, picFilter, picMs2Filter, projectFilter, duidFilter, rowLimit, refreshKey]);

  const { options: dispOpts } = useFilterOptions("PO Dispatch", ["project_code", "site_code"]);
  const projectOptions = dispOpts.project_code || [];
  const duidOptions = dispOpts.site_code || [];

  const hasFilters = !!(search || picFilter.length || picMs2Filter.length || projectFilter.length || duidFilter.length);

  // Totals row — sums numeric columns across the loaded rows. DataTablePro
  // reorders / hides tfoot cells the same way it does the body, so the totals
  // stay aligned with their columns even after a Manage Table reshuffle.
  const totals = useMemo(() => {
    const sum = (k) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
    return {
      qty: sum("qty"),
      line_amount: sum("line_amount"),
      ms1_amount: sum("ms1_amount"),
      ms1_invoiced: sum("ms1_invoiced"),
      ms1_unbilled: sum("ms1_unbilled"),
      ms2_amount: sum("ms2_amount"),
      ms2_invoiced: sum("ms2_invoiced"),
      ms2_unbilled: sum("ms2_unbilled"),
    };
  }, [rows]);

  function toggleRow(name) {
    setSelected((p) => {
      const next = new Set(p);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }
  function toggleAll() {
    if (rows.length === 0) return;
    const all = rows.every((r) => selected.has(r.po_dispatch));
    setSelected(all ? new Set() : new Set(rows.map((r) => r.po_dispatch)));
  }

  function openEdit(row) {
    setEditFor(row);
    setEditFields({
      pic_status: row.pic_status_stored || row.pic_status_effective || "",
      pic_status_ms2: row.pic_status_ms2 || "",
      isdp_ibuy_owner: row.isdp_ibuy_owner || "",
      isdp_owner_ms2: row.isdp_owner_ms2 || "",
      pic_detail_remark: row.pic_detail_remark || "",
      pic_detail_remark_ms2: row.pic_detail_remark_ms2 || "",
      ms1_applied_date: row.ms1_applied_date || "",
      ms2_applied_date: row.ms2_applied_date || "",
      ms1_invoiced: row.ms1_invoiced || 0,
      ms2_invoiced: row.ms2_invoiced || 0,
      remaining_milestone_pct: row.remaining_milestone_pct || 0,
      sqc_status: row.sqc_status || "",
      pat_status: row.pat_status || "",
      ms1_invoice_month: row.ms1_invoice_month || "",
      ms2_invoice_month: row.ms2_invoice_month || "",
      ms1_ibuy_inv_date: row.ms1_ibuy_inv_date || "",
      ms2_ibuy_inv_date: row.ms2_ibuy_inv_date || "",
      ms1_payment_received_date: row.ms1_payment_received_date || "",
      ms2_payment_received_date: row.ms2_payment_received_date || "",
    });
    setEditErr(null);
  }
  async function submitEdit() {
    if (!editFor) return;
    setEditBusy(true);
    setEditErr(null);
    try {
      // Empty strings on date / number fields → null so backend doesn't try to parse "".
      const payload = {};
      Object.entries(editFields).forEach(([k, v]) => {
        if (v === "" || v == null) payload[k] = null;
        else payload[k] = v;
      });
      const res = await pmApi.updatePicRow(editFor.po_dispatch, payload);
      setEditFor(null);
      setToastMsg(`Saved ${res?.poid || editFor.po_dispatch}.`);
      setTimeout(() => setToastMsg(null), 4500);
      await load();
    } catch (err) {
      setEditErr(err.message || "Save failed");
    } finally {
      setEditBusy(false);
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

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Invoice Tracker (PIC)</h1>
          <div className="page-subtitle">
            POIDs flow through the acceptance pipeline. Click a row to edit, or select rows for a bulk status change.
          </div>
        </div>
        <div className="page-actions">
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
          placeholder="Search POID, PO, Item, Project, DUID, Owner…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ minWidth: 280 }}
        />
        <SearchableSelect multi value={picFilter} onChange={setPicFilter} options={PIC_STATUSES} placeholder="All PIC Status (MS1)" minWidth={180} />
        <SearchableSelect multi value={picMs2Filter} onChange={setPicMs2Filter} options={PIC_STATUSES} placeholder="All PIC Status (MS2)" minWidth={180} />
        <SearchableSelect multi value={projectFilter} onChange={setProjectFilter} options={projectOptions} placeholder="All Projects" minWidth={170} />
        <SearchableSelect multi value={duidFilter} onChange={setDuidFilter} options={duidOptions} placeholder="All DUIDs" minWidth={150} />
        {hasFilters && (
          <button className="btn-secondary" onClick={() => { setSearch(""); setPicFilter([]); setPicMs2Filter([]); setProjectFilter([]); setDuidFilter([]); }}>
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
            onClick={() => { setBulkErr(null); setShowBulk(true); }}
          >
            Bulk Set Status ({selected.size})
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
          {loading ? (
            <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Loading…</div>
          ) : rows.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📑</div>
              <h3>{hasFilters ? "No matching POIDs" : "No POIDs in the pipeline yet"}</h3>
              <p>{hasFilters ? "Adjust your filters." : "POIDs appear here when their PO Dispatch is created."}</p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>
                    <input type="checkbox" checked={rows.length > 0 && rows.every((r) => selected.has(r.po_dispatch))} onChange={toggleAll} />
                  </th>
                  <th>POID</th>
                  <th>PO No</th>
                  <th>PO Status</th>
                  <th>Project Domain</th>
                  <th>Project</th>
                  <th>Item</th>
                  <th>Description</th>
                  <th>DUID</th>
                  <th style={{ textAlign: "right" }}>Qty</th>
                  <th style={{ textAlign: "right" }}>Unit Price</th>
                  <th style={{ textAlign: "right" }}>Line Amount</th>
                  <th>Tax Rate</th>
                  <th>Payment Terms</th>
                  <th>PIC Status (MS1)</th>
                  <th>I-BUY/ISDP Owner</th>
                  <th>Applied Date (MS1)</th>
                  <th style={{ textAlign: "right" }}>MS1 %</th>
                  <th style={{ textAlign: "right" }}>MS1 Amt</th>
                  <th style={{ textAlign: "right" }}>MS1 Invoiced</th>
                  <th style={{ textAlign: "right" }}>MS1 Unbilled</th>
                  <th>PIC Status (MS2)</th>
                  <th>Applied Date (MS2)</th>
                  <th style={{ textAlign: "right" }}>MS2 %</th>
                  <th style={{ textAlign: "right" }}>MS2 Amt</th>
                  <th style={{ textAlign: "right" }}>MS2 Invoiced</th>
                  <th>Edit</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.po_dispatch}
                      className={selected.has(r.po_dispatch) ? "row-selected" : ""}>
                    <td onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(r.po_dispatch)} onChange={() => toggleRow(r.po_dispatch)} />
                    </td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{r.poid || r.po_dispatch}</td>
                    <td>{r.po_no || "—"}</td>
                    <td style={{ fontSize: "0.78rem" }}>{r.dispatch_status || "—"}</td>
                    <td style={{ fontSize: "0.82rem" }}>{r.project_domain || "—"}</td>
                    <td title={r.project_name || ""}>{r.project_code || "—"}</td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }} title={r.item_description || ""}>{r.item_code || "—"}</td>
                    <td style={{ fontSize: "0.82rem", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.item_description || ""}>{r.item_description || "—"}</td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }} title={r.site_name || ""}>{r.site_code || "—"}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.qty != null ? fmtInt.format(r.qty) : "—"}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.rate != null ? fmt.format(r.rate) : "—"}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{fmt.format(r.line_amount || 0)}</td>
                    <td style={{ fontSize: "0.78rem" }}>{r.tax_rate || "—"}</td>
                    <td style={{ fontSize: "0.78rem", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.payment_terms || ""}>{r.payment_terms || "—"}</td>
                    <td><StatusPill value={r.pic_status_effective} /></td>
                    <td style={{ fontSize: "0.78rem", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.isdp_ibuy_owner || ""}>{r.isdp_ibuy_owner || "—"}</td>
                    <td style={{ fontSize: "0.78rem" }}>{r.ms1_applied_date ? String(r.ms1_applied_date).slice(0, 10) : "—"}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.ms1_pct != null ? `${fmtInt.format(r.ms1_pct)}%` : "—"}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt.format(r.ms1_amount || 0)}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: (r.ms1_invoiced || 0) > 0 ? "#047857" : "#94a3b8" }}>{fmt.format(r.ms1_invoiced || 0)}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: (r.ms1_unbilled || 0) > 0 ? "#b45309" : "#94a3b8" }}>{fmt.format(r.ms1_unbilled || 0)}</td>
                    <td><StatusPill value={r.pic_status_ms2} /></td>
                    <td style={{ fontSize: "0.78rem" }}>{r.ms2_applied_date ? String(r.ms2_applied_date).slice(0, 10) : "—"}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.ms2_pct != null ? `${fmtInt.format(r.ms2_pct)}%` : "—"}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt.format(r.ms2_amount || 0)}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: (r.ms2_invoiced || 0) > 0 ? "#047857" : "#94a3b8" }}>{fmt.format(r.ms2_invoiced || 0)}</td>
                    <td>
                      <button type="button" className="btn-secondary" style={{ padding: "3px 10px", fontSize: "0.78rem" }} onClick={() => openEdit(r)}>
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: "#f1f5f9", fontWeight: 700 }}>
                  <td></td>
                  <td colSpan={2} style={{ fontSize: "0.78rem", color: "#475569" }}>
                    {fmtInt.format(rows.length)} row{rows.length !== 1 ? "s" : ""}
                  </td>
                  <td></td>
                  <td></td>
                  <td></td>
                  <td></td>
                  <td></td>
                  <td></td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtInt.format(totals.qty)}</td>
                  <td></td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt.format(totals.line_amount)}</td>
                  <td></td>
                  <td></td>
                  <td></td>
                  <td></td>
                  <td></td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt.format(totals.ms1_amount)}</td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#047857" }}>{fmt.format(totals.ms1_invoiced)}</td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#b45309" }}>{fmt.format(totals.ms1_unbilled)}</td>
                  <td></td>
                  <td></td>
                  <td></td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt.format(totals.ms2_amount)}</td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#047857" }}>{fmt.format(totals.ms2_invoiced)}</td>
                  <td></td>
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

      {editFor && (
        <EditPopover
          row={editFor}
          fields={editFields}
          setFields={setEditFields}
          onClose={() => setEditFor(null)}
          onSave={submitEdit}
          busy={editBusy}
          err={editErr}
        />
      )}

      {showBulk && (
        <div style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
             onClick={bulkBusy ? undefined : () => setShowBulk(false)}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 20, width: "min(440px, 100%)", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)" }}
               onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: "1rem" }}>Bulk Set PIC Status <span style={{ color: "#64748b", fontWeight: 500 }}>· {selected.size}</span></h3>
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
                {PIC_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
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
    </div>
  );
}

function EditPopover({ row, fields, setFields, onClose, onSave, busy, err }) {
  const [tab, setTab] = useState("MS1");
  const set = (k, v) => setFields((f) => ({ ...f, [k]: v }));

  const ms1Status = fields.pic_status || row.pic_status_effective || "Work Not Done";
  const ms2Status = fields.pic_status_ms2 || "";
  const ms1Pct = Number(row.ms1_pct || 0);
  const ms2Pct = Number(row.ms2_pct || 0);
  const ms1Amt = Number(row.ms1_amount || 0);
  const ms2Amt = Number(row.ms2_amount || 0);
  const ms1Inv = Number(fields.ms1_invoiced ?? row.ms1_invoiced ?? 0);
  const ms2Inv = Number(fields.ms2_invoiced ?? row.ms2_invoiced ?? 0);
  const ms1Unb = Math.max(ms1Amt - ms1Inv, 0);
  const ms2Unb = Math.max(ms2Amt - ms2Inv, 0);
  const totalAmt = ms1Amt + ms2Amt;
  const totalInv = ms1Inv + ms2Inv;
  const invPct = totalAmt > 0 ? Math.round((totalInv / totalAmt) * 100) : 0;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(15,23,42,0.55)", backdropFilter: "blur(2px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
         onClick={busy ? undefined : onClose}>
      <div style={{ background: "#f8fafc", borderRadius: 14, width: "min(820px, 100%)", maxHeight: "94vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.35)" }}
           onClick={(e) => e.stopPropagation()}>

        {/* Hero header — gradient strip with key facts */}
        <div style={{
          padding: "16px 22px",
          background: "linear-gradient(135deg, #1e3a8a 0%, #4338ca 60%, #7c3aed 100%)",
          color: "#fff",
        }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.08em", opacity: 0.75, fontWeight: 700 }}>Invoice Tracking · POID</div>
              <div style={{ fontSize: "1.05rem", fontFamily: "ui-monospace, SFMono-Regular, monospace", fontWeight: 700, marginTop: 3, wordBreak: "break-all" }}>
                {row.poid || row.po_dispatch}
              </div>
              <div style={{ fontSize: "0.82rem", opacity: 0.9, marginTop: 6 }}>
                {row.project_code || "—"}{row.project_name ? <span style={{ opacity: 0.75 }}> · {row.project_name}</span> : null}
              </div>
              {row.item_description && (
                <div style={{ fontSize: "0.8rem", opacity: 0.82, marginTop: 4, maxWidth: 540, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.item_description}>
                  {row.item_code ? <span style={{ fontFamily: "monospace", marginRight: 6 }}>{row.item_code}</span> : null}
                  {row.item_description}
                </div>
              )}
            </div>
            <button type="button" onClick={onClose} disabled={busy}
              style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", fontSize: 22, lineHeight: 1, padding: "4px 10px", borderRadius: 6, cursor: busy ? "default" : "pointer" }}>&times;</button>
          </div>

          {/* KPI strip */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 8, marginTop: 12 }}>
            <HeroKPI label="Line Amount" value={fmt.format(row.line_amount || 0)} suffix="SAR" />
            <HeroKPI label="MS1 / MS2" value={`${ms1Pct.toFixed(0)}% / ${ms2Pct.toFixed(0)}%`} />
            <HeroKPI label="Invoiced" value={fmt.format(totalInv)} suffix="SAR" />
            <HeroKPI label="Progress" value={`${invPct}%`}>
              <div style={{ height: 4, background: "rgba(255,255,255,0.25)", borderRadius: 99, marginTop: 6, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${invPct}%`, background: invPct >= 100 ? "#10b981" : "#fff" }} />
              </div>
            </HeroKPI>
          </div>

          {/* Status chips */}
          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            <HeroChip label="PIC MS1" value={ms1Status} active={tab === "MS1"} onClick={() => setTab("MS1")} />
            <HeroChip label="PIC MS2" value={ms2Status || "—"} active={tab === "MS2"} onClick={() => setTab("MS2")} disabled={ms2Pct <= 0 && !ms2Status} />
            <HeroChip label="Acceptance" value={`${row.sqc_status || "SQC ?"} · ${row.pat_status || "PAT ?"}`} active={tab === "ACC"} onClick={() => setTab("ACC")} />
          </div>
        </div>

        {/* Body — single tab visible at a time, keeps the form short and focused. */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 22px" }}>
          {tab === "MS1" && (
            <MilestonePanel
              tone="blue"
              title="MS1 — 1st Payment"
              statusKey="pic_status"
              ownerKey="isdp_ibuy_owner"
              detailKey="pic_detail_remark"
              appliedKey="ms1_applied_date"
              invoicedKey="ms1_invoiced"
              invoiceMonthKey="ms1_invoice_month"
              ibuyDateKey="ms1_ibuy_inv_date"
              receivedKey="ms1_payment_received_date"
              pctLabel={`${ms1Pct.toFixed(0)}% of line`}
              amount={ms1Amt}
              invoiced={ms1Inv}
              unbilled={ms1Unb}
              fields={fields}
              set={set}
              busy={busy}
            />
          )}
          {tab === "MS2" && (
            <MilestonePanel
              tone="violet"
              title="MS2 — 2nd Payment"
              statusKey="pic_status_ms2"
              ownerKey="isdp_owner_ms2"
              detailKey="pic_detail_remark_ms2"
              appliedKey="ms2_applied_date"
              invoicedKey="ms2_invoiced"
              invoiceMonthKey="ms2_invoice_month"
              ibuyDateKey="ms2_ibuy_inv_date"
              receivedKey="ms2_payment_received_date"
              pctLabel={`${ms2Pct.toFixed(0)}% of line`}
              amount={ms2Amt}
              invoiced={ms2Inv}
              unbilled={ms2Unb}
              fields={fields}
              set={set}
              busy={busy}
            />
          )}
          {tab === "ACC" && (
            <Card title="Acceptance Gates">
              <div style={{ fontSize: "0.78rem", color: "#64748b", marginBottom: 10 }}>
                Huawei's site / acceptance gates. Both must pass before MS1 can move past <strong>Under Process to Apply</strong>.
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
                <Field label="SQC Status">
                  <input type="text" value={fields.sqc_status || ""} onChange={(e) => set("sqc_status", e.target.value)} disabled={busy}
                    placeholder="e.g. SQC Closed" style={fieldInputStyle} />
                </Field>
                <Field label="PAT Status">
                  <input type="text" value={fields.pat_status || ""} onChange={(e) => set("pat_status", e.target.value)} disabled={busy}
                    placeholder="e.g. Accepted" style={fieldInputStyle} />
                </Field>
                <Field label="Remaining Milestone %">
                  <input type="number" step="1" min="0" max="100" value={fields.remaining_milestone_pct || 0}
                    onChange={(e) => set("remaining_milestone_pct", parseFloat(e.target.value) || 0)} disabled={busy} style={fieldInputStyle} />
                </Field>
              </div>
              {row.im_rejection_remark && (
                <div style={{ marginTop: 14, padding: "10px 12px", background: "rgba(239,68,68,0.06)", border: "1px solid #fecaca", borderRadius: 8, fontSize: "0.82rem", color: "#7f1d1d" }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>IM Rejection Remark</div>
                  <div>{row.im_rejection_remark}</div>
                </div>
              )}
            </Card>
          )}
        </div>

        {/* Sticky footer with errors + save */}
        <div style={{ borderTop: "1px solid #e2e8f0", background: "#fff", padding: "12px 22px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0, fontSize: "0.78rem", color: "#94a3b8" }}>
            {err
              ? <span style={{ color: "#b91c1c", fontWeight: 600 }}>⚠ {err}</span>
              : <span>Changes save with audit trail · validate hook recomputes amounts.</span>}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="button" className="btn-primary" onClick={onSave} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function HeroKPI({ label, value, suffix, children }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.10)", borderRadius: 8, padding: "8px 10px" }}>
      <div style={{ fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: "0.08em", opacity: 0.75, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: "0.92rem", fontWeight: 700, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
        {value}{suffix ? <span style={{ marginLeft: 4, fontSize: "0.7rem", opacity: 0.75, fontWeight: 600 }}>{suffix}</span> : null}
      </div>
      {children}
    </div>
  );
}

function HeroChip({ label, value, active, onClick, disabled }) {
  return (
    <button type="button" onClick={disabled ? undefined : onClick} disabled={disabled}
      style={{
        background: active ? "#fff" : "rgba(255,255,255,0.12)",
        color: active ? "#1e3a8a" : "#fff",
        border: "none",
        padding: "6px 12px",
        borderRadius: 999,
        fontSize: "0.74rem",
        fontWeight: 700,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.45 : 1,
        display: "inline-flex",
        gap: 6,
        alignItems: "center",
      }}>
      <span style={{ opacity: 0.75 }}>{label}</span>
      <span>{value || "—"}</span>
    </button>
  );
}

function Card({ title, children, accent }) {
  return (
    <div style={{ background: "#fff", border: `1px solid ${accent || "#e2e8f0"}`, borderRadius: 10, padding: "14px 16px", boxShadow: "0 1px 2px rgba(15,23,42,0.04)" }}>
      {title && (
        <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "#0f172a", marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
          {title}
        </div>
      )}
      {children}
    </div>
  );
}

const fieldInputStyle = {
  width: "100%",
  boxSizing: "border-box",
  padding: "7px 10px",
  fontSize: "0.85rem",
  border: "1px solid #e2e8f0",
  borderRadius: 6,
  background: "#fff",
};
const fieldTextareaStyle = { ...fieldInputStyle, resize: "vertical", minHeight: 60 };

function MilestonePanel({
  tone, title, pctLabel, amount, invoiced, unbilled,
  statusKey, ownerKey, detailKey, appliedKey, invoicedKey,
  invoiceMonthKey, ibuyDateKey, receivedKey,
  fields, set, busy,
}) {
  const accentBorder = tone === "violet" ? "#ddd6fe" : "#bfdbfe";
  const accentTextColor = tone === "violet" ? "#6d28d9" : "#1d4ed8";
  return (
    <Card accent={accentBorder} title={
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: "0.7rem", fontWeight: 700,
          background: tone === "violet" ? "rgba(139,92,246,0.10)" : "rgba(59,130,246,0.10)",
          color: accentTextColor }}>{title}</span>
        <span style={{ color: "#94a3b8", fontWeight: 500, fontSize: "0.74rem" }}>{pctLabel}</span>
      </span>
    }>
      {/* Mini stat row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 12 }}>
        <Stat label="Amount" value={fmt.format(amount)} fg="#0f172a" />
        <Stat label="Invoiced" value={fmt.format(invoiced)} fg={invoiced > 0 ? "#047857" : "#94a3b8"} />
        <Stat label="Unbilled" value={fmt.format(unbilled)} fg={unbilled > 0 ? "#b45309" : "#94a3b8"} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="PIC Status">
          <select value={fields[statusKey] || ""} onChange={(e) => set(statusKey, e.target.value)} disabled={busy} style={fieldInputStyle}>
            <option value="">—</option>
            {PIC_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="ISDP / I-Buy Owner">
          <input type="text" value={fields[ownerKey] || ""} onChange={(e) => set(ownerKey, e.target.value)} disabled={busy}
            placeholder="Huawei owner name" style={fieldInputStyle} />
        </Field>
        <div style={{ gridColumn: "1 / -1" }}>
          <Field label="Detail Remarks / Dependency">
            <textarea rows={2} value={fields[detailKey] || ""} onChange={(e) => set(detailKey, e.target.value)} disabled={busy}
              style={fieldTextareaStyle} placeholder="Outstanding dependency, blocker, or note" />
          </Field>
        </div>
        <Field label="Applied Date">
          <input type="date" value={fields[appliedKey] || ""} onChange={(e) => set(appliedKey, e.target.value)} disabled={busy} style={fieldInputStyle} />
        </Field>
        <Field label="Invoiced Amount (SAR)">
          <input type="number" step="0.01" value={fields[invoicedKey] || 0}
            onChange={(e) => set(invoicedKey, parseFloat(e.target.value) || 0)} disabled={busy} style={fieldInputStyle} />
        </Field>
        <Field label="Invoicing Month">
          <input type="month" value={(fields[invoiceMonthKey] || "").slice(0, 7)}
            onChange={(e) => set(invoiceMonthKey, e.target.value ? `${e.target.value}-01` : "")} disabled={busy} style={fieldInputStyle} />
        </Field>
        <Field label="IBUY / INV Date">
          <input type="date" value={fields[ibuyDateKey] || ""} onChange={(e) => set(ibuyDateKey, e.target.value)} disabled={busy} style={fieldInputStyle} />
        </Field>
        <Field label="Payment Received Date">
          <input type="date" value={fields[receivedKey] || ""} onChange={(e) => set(receivedKey, e.target.value)} disabled={busy} style={fieldInputStyle} />
        </Field>
      </div>
    </Card>
  );
}

function Stat({ label, value, fg }) {
  return (
    <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px" }}>
      <div style={{ fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: "0.06em", color: "#64748b", fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: "0.95rem", fontWeight: 700, color: fg || "#0f172a", marginTop: 2, fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: "block" }}>
      <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#475569", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
      {children}
    </label>
  );
}
