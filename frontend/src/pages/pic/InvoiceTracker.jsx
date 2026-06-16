import { useCallback, useEffect, useMemo, useState } from "react";
import DataTableWrapper from "../../components/DataTableWrapper";
import { useTableRowLimit } from "../../context/TableRowLimitContext";
import { useDebounced } from "../../hooks/useDebounced";
import { pmApi } from "../../services/api";
import useFilterOptions from "../../hooks/useFilterOptions";
import SearchableSelect from "../../components/SearchableSelect";
import ExportExcelButton from "../../components/ExportExcelButton";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 2, minimumFractionDigits: 2 });

function statusTone(status) {
  const s = (status || "").trim();
  if (s === "Ready for Invoice") return { bg: "#eff6ff", fg: "#1d4ed8" };
  if (s === "Commercial Invoice Submitted") return { bg: "#fffbeb", fg: "#b45309" };
  if (s === "Commercial Invoice Closed") return { bg: "#ecfdf5", fg: "#047857" };
  return { bg: "#f1f5f9", fg: "#475569" };
}

export default function InvoiceTracker() {
  const { rowLimit } = useTableRowLimit();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const searchDebounced = useDebounced(search, 300);
  const [projectFilter, setProjectFilter] = useState([]);
  const [duidFilter, setDuidFilter] = useState([]);
  const [ms1StatusFilter, setMs1StatusFilter] = useState([]);
  const [ms2StatusFilter, setMs2StatusFilter] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [invoiceBusy, setInvoiceBusy] = useState(false);
  const [invoiceResult, setInvoiceResult] = useState(null);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const filters = {};
      if (searchDebounced.trim()) filters.search = searchDebounced.trim();
      if (projectFilter.length) filters.project_code = projectFilter;
      if (duidFilter.length) filters.site_code = duidFilter;
      if (ms1StatusFilter.length) filters.pic_status_ms1 = ms1StatusFilter;
      if (ms2StatusFilter.length) filters.pic_status_ms2 = ms2StatusFilter;
      const list = await pmApi.listInvoiceTrackerRows(filters, rowLimit);
      setRows(Array.isArray(list) ? list : []);
    } catch (e) {
      setError(e?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [searchDebounced, projectFilter, duidFilter, ms1StatusFilter, ms2StatusFilter, rowLimit]);

  useEffect(() => { load(); }, [load]);

  const { options: dispOpts } = useFilterOptions("PO Dispatch", ["project_code", "site_code"]);
  const projectOptions = dispOpts.project_code || [];
  const duidOptions = dispOpts.site_code || [];

  const PIC_STATUS_OPTIONS = [
    { id: "Ready for Invoice",              label: "Ready for Invoice" },
    { id: "Commercial Invoice Submitted",   label: "Invoice Submitted" },
    { id: "Commercial Invoice Closed",      label: "Invoice Closed" },
  ];

  const hasFilters = !!(search || projectFilter.length || duidFilter.length || ms1StatusFilter.length || ms2StatusFilter.length);

  const selectedRows = useMemo(
    () => rows.filter((r) => selected.has(r.name)),
    [rows, selected],
  );

  // Only allow invoicing when at least one selected row has a Ready milestone
  const canInvoice = useMemo(() => {
    if (selectedRows.length === 0) return false;
    return selectedRows.every((r) => {
      const ms1Ready = (r.pic_status || "").trim() === "Ready for Invoice";
      const ms2Ready = (r.pic_status_ms2 || "").trim() === "Ready for Invoice";
      const ms1Done = (r.pic_status || "").trim() === "Commercial Invoice Submitted"
                    || (r.pic_status || "").trim() === "Commercial Invoice Closed";
      const ms2Zero = !(r.ms2_amount > 0);
      // Allow if MS1 ready, or MS2 ready, or MS1 done but MS2 ready
      if (ms1Ready || ms2Ready) return true;
      if (ms1Done && ms2Zero) return false; // MS1 done, no MS2 — nothing to invoice
      if (ms1Done && !ms2Ready) return false; // MS1 done, MS2 not ready — nothing to invoice
      return false;
    });
  }, [selectedRows]);

  function toggleRow(name) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function openInvoiceModal() {
    setInvoiceResult(null);
    setShowInvoiceModal(true);
  }

  async function createInvoice() {
    if (!canInvoice) return;
    setInvoiceBusy(true);
    setInvoiceResult(null);
    try {
      const poList = selectedRows.map((r) => r.name);
      const res = await pmApi.createSalesInvoiceFromPic(poList, null);
      setInvoiceResult(res);
      setMsg(null);
      await load();
    } catch (e) {
      setError(e?.message || "Invoice creation failed");
      setShowInvoiceModal(false);
    } finally {
      setInvoiceBusy(false);
    }
  }

  async function markStatus(newStatus) {
    if (selectedRows.length === 0) return;
    setInvoiceBusy(true);
    try {
      let ms1Count = 0;
      let ms2Count = 0;
      for (const r of selectedRows) {
        const ms1Ready = (r.pic_status || "").trim() === "Ready for Invoice";
        const ms2Ready = (r.pic_status_ms2 || "").trim() === "Ready for Invoice";
        const ms1Submitted = (r.pic_status || "").trim() === "Commercial Invoice Submitted";
        const ms2Submitted = (r.pic_status_ms2 || "").trim() === "Commercial Invoice Submitted";

        if (newStatus === "Commercial Invoice Submitted") {
          if (ms1Ready) {
            await pmApi.updatePicRow(r.name, { pic_status: newStatus });
            ms1Count++;
          } else if (ms2Ready) {
            await pmApi.updatePicRow(r.name, { pic_status_ms2: newStatus });
            ms2Count++;
          }
        } else if (newStatus === "Commercial Invoice Closed") {
          if (ms1Submitted) {
            await pmApi.updatePicRow(r.name, { pic_status: newStatus });
            ms1Count++;
          } else if (ms2Submitted) {
            await pmApi.updatePicRow(r.name, { pic_status_ms2: newStatus });
            ms2Count++;
          }
        }
      }
      const parts = [];
      if (ms1Count) parts.push(`${ms1Count} MS1`);
      if (ms2Count) parts.push(`${ms2Count} MS2`);
      setMsg(`Marked ${parts.join(" + ")} as "${newStatus}"`);
      setSelected(new Set());
      await load();
    } catch (e) {
      setError(e?.message || "Status update failed");
    } finally {
      setInvoiceBusy(false);
    }
  }

  const totalMs1 = useMemo(() => rows.reduce((s, r) => s + (r.ms1_amount || 0), 0), [rows]);
  const totalMs2 = useMemo(() => rows.reduce((s, r) => s + (r.ms2_amount || 0), 0), [rows]);
  const totalInvMs1 = useMemo(() => rows.reduce((s, r) => s + (r.ms1_invoiced || 0), 0), [rows]);
  const totalInvMs2 = useMemo(() => rows.reduce((s, r) => s + (r.ms2_invoiced || 0), 0), [rows]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Invoice Tracker</h1>
          <div className="page-subtitle">Lines ready for invoicing and submitted.</div>
        </div>
        <div className="page-actions">
          <ExportExcelButton filename="invoice-tracker" rows={rows} />
          <button className="btn-secondary" onClick={load} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {msg && (
        <div className="notice success" style={{ margin: "0 16px 8px" }}>
          <span>✓</span> {msg}
          <button type="button" className="btn-secondary" style={{ marginLeft: 12, fontSize: "0.7rem", padding: "2px 8px" }} onClick={() => setMsg(null)}>Dismiss</button>
        </div>
      )}
      {error && (
        <div className="notice error" style={{ margin: "0 16px 8px" }}>
          <span>!</span> {error}
          <button type="button" className="btn-secondary" style={{ marginLeft: 12, fontSize: "0.7rem", padding: "2px 8px" }} onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      {/* KPI row */}
      <div style={{ display: "flex", gap: 8, margin: "0 16px 6px", flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 999, background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe", fontSize: "0.74rem", fontWeight: 700 }}>
          <span style={{ opacity: 0.85 }}>MS1 Total</span> <span>SAR {fmt.format(totalMs1)}</span>
        </div>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 999, background: "#fef2f2", color: "#b91c1c", border: "1px solid #fecaca", fontSize: "0.74rem", fontWeight: 700 }}>
          <span style={{ opacity: 0.85 }}>MS1 Invoiced</span> <span>SAR {fmt.format(totalInvMs1)}</span>
        </div>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 999, background: "#ecfdf5", color: "#047857", border: "1px solid #a7f3d0", fontSize: "0.74rem", fontWeight: 700 }}>
          <span style={{ opacity: 0.85 }}>MS2 Total</span> <span>SAR {fmt.format(totalMs2)}</span>
        </div>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 999, background: "#fffbeb", color: "#b45309", border: "1px solid #fde68a", fontSize: "0.74rem", fontWeight: 700 }}>
          <span style={{ opacity: 0.85 }}>MS2 Invoiced</span> <span>SAR {fmt.format(totalInvMs2)}</span>
        </div>
      </div>

      <div className="toolbar">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input
            type="search"
            placeholder="Search POID, PO, Item, Project, DUID, Customer…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem", minWidth: 260 }}
          />
          <SearchableSelect multi value={projectFilter} onChange={setProjectFilter} options={projectOptions} placeholder="All Projects" minWidth={170} />
          <SearchableSelect multi value={duidFilter} onChange={setDuidFilter} options={duidOptions} placeholder="All DUIDs" minWidth={150} />
          <SearchableSelect multi value={ms1StatusFilter} onChange={setMs1StatusFilter} options={PIC_STATUS_OPTIONS} placeholder="MS1 Status" minWidth={150} />
          <SearchableSelect multi value={ms2StatusFilter} onChange={setMs2StatusFilter} options={PIC_STATUS_OPTIONS} placeholder="MS2 Status" minWidth={150} />
          {hasFilters && (
            <button className="btn-secondary" style={{ fontSize: "0.78rem", padding: "5px 12px" }} onClick={() => { setSearch(""); setProjectFilter([]); setDuidFilter([]); setMs1StatusFilter([]); setMs2StatusFilter([]); }}>
              Clear
            </button>
          )}
        </div>
        <div className="toolbar-actions">
          {selected.size > 0 && (
            <span style={{ fontSize: "0.78rem", color: "#64748b" }}>
              {selected.size} selected
            </span>
          )}
          <button
            type="button"
            className="btn-primary"
            disabled={!canInvoice}
            onClick={openInvoiceModal}
          >
            Create Sales Invoice
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={selected.size === 0}
            onClick={() => markStatus("Commercial Invoice Submitted")}
            style={{ color: "#b45309" }}
          >
            Mark Submitted
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={selected.size === 0}
            onClick={() => markStatus("Commercial Invoice Closed")}
            style={{ color: "#047857" }}
          >
            Mark Closed
          </button>
        </div>
      </div>

      <div className="page-content">
        <DataTableWrapper>
          {loading ? (
            <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Loading...</div>
          ) : rows.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📄</div>
              <h3>{hasFilters ? "No results match your filters" : "No invoice-tracker rows yet"}</h3>
              <p>{hasFilters ? "Try adjusting your search or filter criteria." : "No lines have reached the invoicing stage."}</p>
            </div>
          ) : (
            <table className="data-table" data-table-key="invoice-tracker-v2">
              <thead>
                <tr>
                  <th style={{ width: 32 }}>
                    <input type="checkbox" onChange={() => {}} checked={false} style={{ visibility: "hidden" }} />
                  </th>
                  <th>Contract</th>
                  <th>POID</th>
                  <th>Customer</th>
                  <th>Project</th>
                  <th>Item</th>
                  <th>DUID</th>
                  <th style={{ textAlign: "right" }}>MS1 Amount</th>
                  <th style={{ textAlign: "right" }}>MS2 Amount</th>
                  <th style={{ textAlign: "right" }}>Remaining %</th>
                  <th>PIC Status (MS1)</th>
                  <th>PIC Status (MS2)</th>
                  <th>Linked Invoice</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const ms1Tone = statusTone(r.pic_status);
                  const ms2Tone = statusTone(r.pic_status_ms2);
                  return (
                    <tr
                      key={r.name}
                      className={selected.has(r.name) ? "row-selected" : ""}
                      onClick={() => toggleRow(r.name)}
                      style={{ cursor: "pointer" }}
                    >
                      <td onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={selected.has(r.name)} onChange={() => toggleRow(r.name)} />
                      </td>
                      <td style={{ fontSize: "0.82rem" }}>{r.contract_model || "—"}</td>
                      <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{r.poid || r.name}</td>
                      <td>{r.customer || "—"}</td>
                      <td>{r.project_code || "—"}</td>
                      <td style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.item_description}>{r.item_code || "—"}</td>
                      <td>{r.site_code || "—"}</td>
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt.format(r.ms1_amount || 0)}</td>
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt.format(r.ms2_amount || 0)}</td>
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.remaining_milestone_pct != null ? `${Number(r.remaining_milestone_pct).toFixed(0)}%` : "—"}</td>
                      <td>
                        <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 999, fontSize: "0.7rem", fontWeight: 700, background: ms1Tone.bg, color: ms1Tone.fg, whiteSpace: "nowrap" }}>
                          {r.pic_status || "—"}
                        </span>
                      </td>
                      <td>
                        <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 999, fontSize: "0.7rem", fontWeight: 700, background: ms2Tone.bg, color: ms2Tone.fg, whiteSpace: "nowrap" }}>
                          {r.pic_status_ms2 || "—"}
                        </span>
                      </td>
                      <td>
                        {(() => {
                          const csv = r.linked_invoices_csv;
                          if (!csv) return <span style={{ color: "#cbd5e1", fontSize: "0.78rem" }}>—</span>;
                          const entries = csv.split(", ").map((entry) => {
                            const parts = entry.split("|");
                            return { name: parts[0], status: parts[1] || "?" };
                          });
                          return (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                              {entries.map((inv) => (
                                <a key={inv.name} href={`/app/sales-invoice/${inv.name}`} target="_blank" rel="noopener noreferrer"
                                  style={{ fontSize: "0.78rem", fontWeight: 600, color: "#1d4ed8", whiteSpace: "nowrap" }}>
                                  {inv.name}
                                  <span style={{ fontSize: "0.66rem", color: inv.status === "Submitted" ? "#047857" : "#b45309", marginLeft: 6 }}>
                                    ({inv.status})
                                  </span>
                                </a>
                              ))}
                            </div>
                          );
                        })()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </DataTableWrapper>
      </div>

      {/* Create Invoice Modal */}
      {showInvoiceModal && selectedRows.length >= 1 && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={() => !invoiceBusy && setShowInvoiceModal(false)}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 24, width: "min(500px, 96vw)", maxHeight: "90vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 14px", fontSize: "1.05rem" }}>Create Sales Invoice — {selectedRows.length} line(s)</h3>

            {invoiceResult ? (
              <>
                <div className="notice success" style={{ marginBottom: 12 }}>
                  <span>✓</span> Sales Invoice <strong>{invoiceResult.sales_invoice}</strong> created with {invoiceResult.line_count || 1} item(s) — {invoiceResult.milestone}
                </div>
                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                  <button type="button" className="btn-secondary" onClick={() => { setShowInvoiceModal(false); setInvoiceResult(null); }}>Close</button>
                  <a href={invoiceResult.invoice_url} target="_blank" rel="noopener noreferrer" className="btn-primary" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", padding: "8px 16px", borderRadius: 8, fontSize: "0.84rem" }}>
                    Open Invoice →
                  </a>
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: "0.84rem", color: "#475569", marginBottom: 12 }}>
                  <strong>{selectedRows.length} line(s)</strong> selected
                  <div style={{ maxHeight: 120, overflow: "auto", marginTop: 6 }}>
                    {selectedRows.map((r) => (
                      <div key={r.name} style={{ fontSize: "0.76rem", padding: "3px 0" }}>
                        {r.poid || r.name} · {r.customer || "—"} · MS1: SAR {fmt.format(r.ms1_amount || 0)} · MS2: SAR {fmt.format(r.ms2_amount || 0)}
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                  <button type="button" className="btn-secondary" disabled={invoiceBusy} onClick={() => setShowInvoiceModal(false)}>Cancel</button>
                  <button type="button" className="btn-primary" disabled={invoiceBusy} onClick={createInvoice}>
                    {invoiceBusy ? "Creating…" : "Create Draft Invoice"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
