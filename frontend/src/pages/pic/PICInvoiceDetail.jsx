import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DataTableWrapper from "../../components/DataTableWrapper";
import TableRowsLimitFooter from "../../components/TableRowsLimitFooter";
import RecordDetailView, { DetailHero, DetailStatTile } from "../../components/RecordDetailView";
import { useTableRowLimit, TABLE_ROW_LIMIT_ALL } from "../../context/TableRowLimitContext";
import { useDebounced } from "../../hooks/useDebounced";
import { pmApi } from "../../services/api";
import useFilterOptions from "../../hooks/useFilterOptions";
import SearchableSelect from "../../components/SearchableSelect";
import ExportExcelButton from "../../components/ExportExcelButton";
import { handleSearchPaste } from "../../utils/searchPaste";
import { useProgressiveRows } from "../../hooks/useProgressiveRows";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const fmtInt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

const INV_MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];
function fmtMonthLabel(ym) {
  if (!ym) return "—";
  const [y, m] = String(ym).slice(0, 7).split("-");
  return `${INV_MONTH_NAMES[parseInt(m, 10) - 1]} ${y}`;
}
// Exact invoice date (day precision) — distinct from the coarser
// Invoicing Month filter, which still buckets by year-month.
function fmtDate(d) {
  if (!d) return "—";
  const [y, m, day] = String(d).slice(0, 10).split("-");
  if (!y || !m || !day) return String(d).slice(0, 10);
  return `${day} ${INV_MONTH_NAMES[parseInt(m, 10) - 1].slice(0, 3)} ${y}`;
}

const ACCEPTANCE_OPTIONS = ["MS1", "MS2"];

function AcceptanceBadge({ value }) {
  const tone = value === "MS2" ? { bg: "#eef2ff", fg: "#4338ca", bd: "#c7d2fe" } : { bg: "#ecfdf5", fg: "#047857", bd: "#a7f3d0" };
  return (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: "0.72rem", fontWeight: 700, background: tone.bg, color: tone.fg, border: `1px solid ${tone.bd}` }}>
      {value || "—"}
    </span>
  );
}

// row.source ("Legacy" vs "System") decides only whether Invoice No. links
// out to a real Sales Invoice — it's not shown to the user as a badge or
// filter.
function InvoiceNoCell({ row }) {
  if (!row.invoice_no) return <span style={{ color: "#cbd5e1" }}>—</span>;
  if (row.source !== "System") {
    return <span style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{row.invoice_no}</span>;
  }
  const names = row.invoice_no.split(", ").filter(Boolean);
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {names.map((n) => (
        <a key={n} href={`/app/sales-invoice/${n}`} target="_blank" rel="noopener noreferrer"
          style={{ fontFamily: "monospace", fontSize: "0.78rem", fontWeight: 600, color: "#1d4ed8" }}>
          {n}
        </a>
      ))}
    </div>
  );
}

function DetailModal({ row, onClose }) {
  if (!row) return null;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div style={{ width: "min(760px, 100%)", maxHeight: "88vh", overflow: "auto", background: "#fff", borderRadius: 14, padding: 20, boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700 }}>{row.poid || row.po_dispatch}</h3>
          <button className="btn-secondary" onClick={onClose}>Close</button>
        </div>
        <RecordDetailView
          row={row}
          pills={[
            { label: "Milestone", value: row.acceptance, tone: row.acceptance === "MS2" ? "violet" : "green" },
            row.project_code ? { label: "Project", value: row.project_code, tone: "amber" } : null,
          ].filter(Boolean)}
          hero={
            <DetailHero>
              <DetailStatTile label="Invoiced Amount" value={fmt.format(row.invoiced_amount || 0)} tone="green" />
              <DetailStatTile label="VAT" value={fmt.format(row.vat_amount || 0)} />
              <DetailStatTile label="Grand Total" value={fmt.format(row.grand_total || 0)} tone="green" />
              <DetailStatTile label="Invoice Date" value={fmtDate(row.invoice_date)} />
            </DetailHero>
          }
          hiddenFields={[
            "po_dispatch", "poid", "acceptance", "source", "project_code",
            "invoiced_amount", "vat_amount", "grand_total", "invoice_date",
          ]}
          keyOrder={[
            "invoice_no", "contract", "sub_contract", "project_domain", "duid",
            "customer", "po_type", "po_no", "subcontract_no",
            "item_code", "item_description", "qty", "rate",
            "invoice_tax_amount", "invoice_amount_incl_tax",
            "im_full_name", "payment_terms", "dispatch_status",
          ]}
        />
      </div>
    </div>
  );
}

// Row-level Invoice Detail report — deliberately mirrors the historical
// "Invoices Data" Excel import 1:1 (same columns, same order, same sort:
// Invoice No. then POID) rather than a monthly roll-up, per direct request.
// Grain is (PO Dispatch, milestone): a POID with both MS1 and MS2 invoiced
// appears as 2 rows, exactly like the Excel's AC1/AC2 rows did. "Source"
// distinguishes pre-system invoices (Legacy — from a one-time historical
// import into legacy_ms{1,2}_invoice_no etc. on PO Dispatch) from real
// Sales Invoices going forward (System) — see list_invoice_detail_rows in
// pic.py. Read-only report; no bulk actions.
export default function PICInvoiceDetail() {
  const { rowLimit } = useTableRowLimit();
  const [rows, setRows] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const visibleRows = useProgressiveRows(rows, { paused: loading });
  const displayLimit = rowLimit === TABLE_ROW_LIMIT_ALL ? Infinity : rowLimit;
  const displayedCount = Math.min(rows.length, displayLimit);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const searchDebounced = useDebounced(search, 300);

  // Per-column "Manage Table" filters, applied on the report's outer wrapper
  // (see _INVOICE_DETAIL_COL_MAP in pic.py) so they cover all 13k+ rows, not
  // just the page currently loaded.
  const [columnFilters, setColumnFilters] = useState({});
  useEffect(() => {
    const onFiltersChanged = (e) => {
      if (e.detail?.tableKey !== "pic-invoice-detail-v1") return;
      setColumnFilters(e.detail.filters || {});
    };
    document.addEventListener("tablepro:filters-changed", onFiltersChanged);
    return () => document.removeEventListener("tablepro:filters-changed", onFiltersChanged);
  }, []);
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

  const queryArgsRef = useRef({});
  useEffect(() => {
    const onRequestOptions = (e) => {
      if (e.detail?.tableKey !== "pic-invoice-detail-v1") return;
      e.detail.respond(pmApi.getColumnFilterOptions({
        source: "invoice_detail",
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
  const [projectFilter, setProjectFilter] = useState([]);
  const [duidFilter, setDuidFilter] = useState([]);
  const [imFilter, setImFilter] = useState([]);
  const [monthFilter, setMonthFilter] = useState([]);
  const [acceptanceFilter, setAcceptanceFilter] = useState([]);
  const [detailRow, setDetailRow] = useState(null);

  const [refreshKey, setRefreshKey] = useState(0);
  const load = useCallback(() => setRefreshKey((k) => k + 1), []);

  const lastFetchRef = useRef({ signature: null, limit: null, rows: [] });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const portal = {};
      if (searchDebounced.trim()) portal.search = searchDebounced.trim();
      if (projectFilter.length) portal.project_code = projectFilter;
      if (duidFilter.length) portal.site_code = duidFilter;
      if (imFilter.length) portal.im = imFilter;
      if (monthFilter.length) portal.invoice_month = monthFilter;
      if (acceptanceFilter.length) portal.acceptance = acceptanceFilter;
      // Must fold in BEFORE the signature — the skip-refetch guard below
      // compares it, so a column-filter change added afterwards would look
      // identical and the fetch would be skipped entirely.
      const colFilters = JSON.parse(columnFiltersDebounced);
      if (Object.keys(colFilters).length) portal.column_filters = colFilters;
      queryArgsRef.current = portal;
      const signature = JSON.stringify([portal, refreshKey]);

      const prev = lastFetchRef.current;
      const alreadyHaveEnough = prev.signature === signature && (
        prev.limit === TABLE_ROW_LIMIT_ALL
        || (rowLimit !== TABLE_ROW_LIMIT_ALL && rowLimit <= prev.limit)
      );
      if (alreadyHaveEnough) return;

      setLoading(true);
      setError(null);
      try {
        const res = await pmApi.listInvoiceDetailRows(portal, rowLimit);
        if (cancelled) return;
        const fetchedRows = Array.isArray(res?.rows) ? res.rows : [];
        setRows(fetchedRows);
        setTotalCount(Number(res?.total_count) || 0);
        lastFetchRef.current = { signature, limit: rowLimit, rows: fetchedRows };
      } catch (err) {
        if (cancelled) return;
        setError(err.message || "Failed to load invoice detail rows");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDebounced, columnFiltersDebounced, projectFilter, duidFilter, imFilter, monthFilter, acceptanceFilter, rowLimit, refreshKey]);

  const { options: dispOpts } = useFilterOptions("PO Dispatch", ["project_code", "site_code"]);
  const projectOptions = dispOpts.project_code || [];
  const duidOptions = dispOpts.site_code || [];
  const imOptions = useMemo(() => {
    const seen = new Map();
    for (const r of rows) {
      if (r.im && !seen.has(r.im)) seen.set(r.im, r.im_full_name || r.im);
    }
    return Array.from(seen.entries()).map(([id, label]) => ({ id, label }));
  }, [rows]);
  const monthOptions = useMemo(() => {
    const seen = new Set();
    for (const r of rows) {
      if (r.invoice_date) seen.add(String(r.invoice_date).slice(0, 7));
    }
    return Array.from(seen).sort().reverse().map((ym) => ({ id: ym, label: fmtMonthLabel(ym) }));
  }, [rows]);

  const hasFilters = !!(search || projectFilter.length || duidFilter.length || imFilter.length
    || monthFilter.length || acceptanceFilter.length);

  const totals = useMemo(() => {
    const sum = (k) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
    return { qty: sum("qty"), invoiced_amount: sum("invoiced_amount"), vat_amount: sum("vat_amount"), grand_total: sum("grand_total") };
  }, [rows]);

  return (
    <div>
      <div className="page-header">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h1 className="page-title">Invoice Detail</h1>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 999, background: "#f1f5f9", color: "#334155", border: "1px solid #e2e8f0", fontSize: "0.74rem", fontWeight: 700 }}>
              <span style={{ opacity: 0.85 }}>Total Lines</span> <span>{fmtInt.format(totalCount)}</span>
            </div>
          </div>
        </div>
        <div className="page-actions">
          <ExportExcelButton filename="pic-invoice-detail" rows={rows.slice(0, displayedCount)} />
          <button type="button" className="btn-secondary" onClick={load} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      <div className="toolbar">
        <input
          type="search"
          placeholder="Search POID, PO, Invoice No, Item, Project, DUID…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onPaste={(e) => handleSearchPaste(e, setSearch)}
          style={{ minWidth: 280 }}
        />
        <SearchableSelect multi value={monthFilter} onChange={setMonthFilter} options={monthOptions} placeholder="All Months" minWidth={160} />
        <SearchableSelect multi value={acceptanceFilter} onChange={setAcceptanceFilter} options={ACCEPTANCE_OPTIONS} placeholder="MS1 + MS2" minWidth={130} />
        <SearchableSelect multi value={imFilter} onChange={setImFilter} options={imOptions} placeholder="All IMs" minWidth={160} />
        <SearchableSelect multi value={projectFilter} onChange={setProjectFilter} options={projectOptions} placeholder="All Projects" minWidth={170} />
        <SearchableSelect multi value={duidFilter} onChange={setDuidFilter} options={duidOptions} placeholder="All DUIDs" minWidth={150} />
        {hasFilters && (
          <button className="btn-secondary" onClick={() => { setSearch(""); setProjectFilter([]); setDuidFilter([]); setImFilter([]); setMonthFilter([]); setAcceptanceFilter([]); }}>
            Clear
          </button>
        )}
      </div>

      {error && (
        <div className="notice error" style={{ margin: "0 16px 8px" }}>
          <span>!</span> {error}
        </div>
      )}

      <div className="page-content">
        <DataTableWrapper loading={loading && rows.length > 0}>
          <table className="data-table" data-excel-filter-all="1" data-table-key="pic-invoice-detail-v1">
            <thead>
              <tr>
                <th>Contract</th>
                <th>Sub Contract</th>
                <th>Project Domain</th>
                <th>POID</th>
                <th>DUID</th>
                <th>Invoice No.</th>
                <th>Invoice Date</th>
                <th>Customer</th>
                <th>Currency</th>
                <th style={{ textAlign: "right" }}>Tax Amount</th>
                <th style={{ textAlign: "right" }}>Invoice Amt (Incl. Tax)</th>
                <th>PO Type</th>
                <th>PO No</th>
                <th>Item</th>
                <th>Description</th>
                <th style={{ textAlign: "right" }}>Qty</th>
                <th style={{ textAlign: "right" }}>Rate</th>
                <th style={{ textAlign: "right" }}>Invoiced Amount</th>
                <th>Project</th>
                <th>Sub Contract No.</th>
                <th>Acceptance</th>
                <th style={{ textAlign: "right" }}>VAT Amount</th>
                <th style={{ textAlign: "right" }}>Grand Total</th>
                <th>IM</th>
                <th>Payment Terms</th>
                <th>View</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={25} style={{ padding: 0 }}>
                    {loading ? (
                      <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Loading…</div>
                    ) : (
                      <div className="empty-state">
                        <div className="empty-icon">🧾</div>
                        <h3>{hasFilters ? "No matching invoice lines" : "No invoiced lines yet"}</h3>
                        <p>{hasFilters ? "Adjust your filters." : "Invoiced milestones will appear here."}</p>
                      </div>
                    )}
                  </td>
                </tr>
              ) : visibleRows.map((r, idx) => (
                <tr key={`${r.po_dispatch}-${r.acceptance}`}
                    data-doc-name={r.po_dispatch}
                    style={idx >= displayLimit ? { display: "none" } : undefined}>
                  <td style={{ fontSize: "0.82rem" }}>{r.contract || "—"}</td>
                  <td style={{ fontSize: "0.82rem" }}>{r.sub_contract || "—"}</td>
                  <td style={{ fontSize: "0.82rem" }}>{r.project_domain || "—"}</td>
                  <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{r.poid || r.po_dispatch}</td>
                  <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{r.duid || "—"}</td>
                  <td><InvoiceNoCell row={r} /></td>
                  <td style={{ fontSize: "0.78rem" }}>{fmtDate(r.invoice_date)}</td>
                  <td style={{ fontSize: "0.82rem" }}>{r.customer || "—"}</td>
                  <td style={{ fontSize: "0.82rem" }}>SAR</td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#64748b" }}>
                    {r.invoice_tax_amount != null ? fmt.format(r.invoice_tax_amount) : "—"}
                  </td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {r.invoice_amount_incl_tax != null ? fmt.format(r.invoice_amount_incl_tax) : "—"}
                  </td>
                  <td style={{ fontSize: "0.82rem" }}>{r.po_type || "—"}</td>
                  <td>{r.po_no || "—"}</td>
                  <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{r.item_code || "—"}</td>
                  <td style={{ fontSize: "0.82rem", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.item_description || ""}>{r.item_description || "—"}</td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.qty != null ? fmtInt.format(r.qty) : "—"}</td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.rate != null ? fmt.format(r.rate) : "—"}</td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{fmt.format(r.invoiced_amount || 0)}</td>
                  <td>{r.project_code || "—"}</td>
                  <td style={{ fontSize: "0.82rem" }}>{r.subcontract_no || "—"}</td>
                  <td><AcceptanceBadge value={r.acceptance} /></td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#64748b" }}>{fmt.format(r.vat_amount || 0)}</td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{fmt.format(r.grand_total || 0)}</td>
                  <td style={{ fontSize: "0.82rem" }} title={r.im || ""}>{r.im_full_name || "—"}</td>
                  <td style={{ fontSize: "0.78rem", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.payment_terms || ""}>{r.payment_terms || "—"}</td>
                  <td>
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
                  <td style={{ fontSize: "0.78rem", color: "#475569" }}>
                    {fmtInt.format(displayedCount)} row{displayedCount !== 1 ? "s" : ""}
                  </td>
                    <td style={{ fontSize: "0.78rem", color: "#475569" }} />
                    <td style={{ fontSize: "0.78rem", color: "#475569" }} />
                    <td style={{ fontSize: "0.78rem", color: "#475569" }} />
                    <td style={{ fontSize: "0.78rem", color: "#475569" }} />{/* Contract, Sub Contract, Project Domain, POID, DUID */}
                  <td></td>{/* Invoice No */}
                  <td></td>{/* Invoice Date */}
                  <td></td>{/* Customer */}
                  <td></td>{/* Currency */}
                  <td></td>{/* Tax Amount */}
                  <td></td>{/* Invoice Amt Incl Tax */}
                  <td></td>{/* PO Type */}
                  <td></td>{/* PO No */}
                  <td></td>{/* Item */}
                  <td></td>{/* Description */}
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtInt.format(totals.qty)}</td>{/* Qty */}
                  <td></td>{/* Rate */}
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt.format(totals.invoiced_amount)}</td>{/* Invoiced Amount */}
                  <td></td>{/* Project */}
                  <td></td>{/* Sub Contract No */}
                  <td></td>{/* Acceptance */}
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt.format(totals.vat_amount)}</td>{/* VAT Amount */}
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt.format(totals.grand_total)}</td>{/* Grand Total */}
                  <td></td>{/* IM */}
                  <td></td>{/* Payment Terms */}
                  <td></td>{/* View */}
                </tr>
              </tfoot>
            )}
          </table>
        </DataTableWrapper>
        <TableRowsLimitFooter
          placement="tableCard"
          loadedCount={displayedCount}
          filteredCount={displayedCount}
          filterActive={!!hasFilters}
        />
      </div>

      <DetailModal row={detailRow} onClose={() => setDetailRow(null)} />
    </div>
  );
}
