import { useCallback, useEffect, useMemo, useState } from "react";
import DataTableWrapper from "../../components/DataTableWrapper";
import SearchableSelect from "../../components/SearchableSelect";
import DateRangePicker from "../../components/DateRangePicker";
import ExportExcelButton from "../../components/ExportExcelButton";
import { pmApi } from "../../services/api";
import { SubPoStatusBadge } from "./picShared";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const fmtInt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });
const NUM = { textAlign: "right", fontVariantNumeric: "tabular-nums" };

export default function SubconPayout() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [options, setOptions] = useState({});
  const [tab, setTab] = useState("line");

  const [subconFilter, setSubconFilter] = useState([]);
  const [supplierFilter, setSupplierFilter] = useState([]);
  const [modelFilter, setModelFilter] = useState([]);
  const [projectFilter, setProjectFilter] = useState([]);
  const [dateRange, setDateRange] = useState({ from: "", to: "" });
  const [refreshKey, setRefreshKey] = useState(0);
  const reload = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    pmApi.getSubconPoFilterOptions().then(setOptions).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const portal = {};
      if (subconFilter.length) portal.subcontract = subconFilter;
      if (supplierFilter.length) portal.supplier = supplierFilter;
      if (modelFilter.length) portal.contract_model = modelFilter;
      if (projectFilter.length) portal.project_code = projectFilter;
      if (dateRange.from) portal.from_date = dateRange.from;
      if (dateRange.to) portal.to_date = dateRange.to;
      try {
        const res = await pmApi.subconPayoutSummary(portal);
        if (!cancelled) setData(res);
      } catch (err) {
        if (!cancelled) setError(err.message || "Failed to load payout summary");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subconFilter, supplierFilter, modelFilter, projectFilter, dateRange, refreshKey]);

  const bySupplier = data?.by_supplier || [];
  const byStatus = data?.by_status || [];
  const byLineStatus = data?.by_line_status || [];

  const hasFilters = !!(subconFilter.length || supplierFilter.length || modelFilter.length
    || projectFilter.length || dateRange.from || dateRange.to);

  // Footer = the column sum, key for key. Every numeric column below reads its
  // total from here, so a footer cell can't drift from the column above it.
  const NUM_COLS = ["row_count", "ms_amount", "inet_amount", "payout", "vat",
                    "not_ordered", "ready", "ordered", "invoiced",
                    "closed", "closed_no_po"];
  const totalsFor = (list) => {
    const out = {};
    NUM_COLS.forEach((k) => {
      out[k] = list.reduce((a, r) => a + (Number(r[k]) || 0), 0);
    });
    out.gross = out.payout + out.vat;
    return out;
  };
  const supplierTotals = useMemo(() => totalsFor(bySupplier), [bySupplier]);
  const statusTotals = useMemo(() => totalsFor(byStatus), [byStatus]);
  const lineTotals = useMemo(() => totalsFor(byLineStatus), [byLineStatus]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Subcon Payout Summary</h1>

        </div>
        <div className="page-actions">
          <ExportExcelButton filename="subcon-payout-by-supplier" rows={bySupplier} />
          <button type="button" className="btn-secondary" onClick={reload} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      <div role="tablist" style={{ display: "flex", gap: 4, padding: 4, background: "#f1f5f9", borderRadius: 8, border: "1px solid #e2e8f0", margin: "0 16px 8px", width: "fit-content" }}>
        {[{ id: "line", label: "Line Status" },
          { id: "status", label: "Milestone Status" },
          { id: "supplier", label: "Supplier" }].map((t) => {
          const active = tab === t.id;
          return (
            <button key={t.id} type="button" role="tab" aria-selected={active} onClick={() => setTab(t.id)}
              style={{ padding: "5px 14px", fontSize: "0.78rem", fontWeight: 700, border: "none", borderRadius: 6, cursor: "pointer", background: active ? "#1d4ed8" : "transparent", color: active ? "#fff" : "#475569" }}>
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="toolbar">
        <SearchableSelect multi value={subconFilter} onChange={setSubconFilter}
          options={(options.subcontract || []).map((v) => ({ id: v, label: v }))}
          placeholder="Subcontract" minWidth={180} />
        <SearchableSelect multi value={supplierFilter} onChange={setSupplierFilter}
          options={(options.supplier || []).map((v) => ({ id: v, label: v }))}
          placeholder="Supplier" minWidth={170} />
        <SearchableSelect multi value={modelFilter} onChange={setModelFilter}
          options={options.contract_model || []} placeholder="Contract Model" minWidth={160} />
        <SearchableSelect multi value={projectFilter} onChange={setProjectFilter}
          options={options.project_code || []} placeholder="All Projects" minWidth={150} />
        <DateRangePicker value={dateRange} onChange={setDateRange} />
        {hasFilters && (
          <button className="btn-secondary" onClick={() => {
            setSubconFilter([]); setSupplierFilter([]); setModelFilter([]);
            setProjectFilter([]); setDateRange({ from: "", to: "" });
          }}>Clear</button>
        )}
      </div>

      {error && (
        <div className="notice error" style={{ margin: "0 16px 8px" }}><span>!</span> {error}</div>
      )}

      {/* ONE page-content / ONE DataTableWrapper across both tabs */}
      <div className="page-content">
        <DataTableWrapper loading={loading && !!data}>
          {tab === "supplier" ? (
            <table key="supplier" className="data-table" data-excel-filter-all="1" data-table-key="subcon-payout-supplier-v5">
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th>Subcontract</th>
                  <th>Contract Model</th>
                  <th style={{ textAlign: "right" }}>Milestones</th>
                  <th style={{ textAlign: "right" }}>Customer MS Amount</th>
                  <th style={{ textAlign: "right" }}>INET Amount</th>
                  <th style={{ textAlign: "right" }}>Payout</th>
                  <th style={{ textAlign: "right" }}>VAT</th>
                  <th style={{ textAlign: "right" }}>Total incl. VAT</th>
                  {/* These five partition Payout — same stages as the Subcon PO tabs. */}
                  <th style={{ textAlign: "right" }}>Not Ordered</th>
                  <th style={{ textAlign: "right" }}>Ready</th>
                  <th style={{ textAlign: "right" }}>Ordered</th>
                  <th style={{ textAlign: "right" }}>Invoiced</th>
                  <th style={{ textAlign: "right" }}>Closed</th>
                  <th style={{ textAlign: "right" }}>Closed (no PO)</th>
                </tr>
              </thead>
              <tbody>
                {bySupplier.length === 0 ? (
                  <tr>
                    <td colSpan={15} style={{ padding: 0 }}>
                      {loading ? (
                        <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Loading…</div>
                      ) : (
                        <div className="empty-state">
                          <div className="empty-icon">📊</div>
                          <h3>No subcontractor lines</h3>
                          <p>Only SUB-type contracts with a milestone amount appear here.</p>
                        </div>
                      )}
                    </td>
                  </tr>
                ) : bySupplier.map((r) => (
                  <tr key={`${r.supplier}|${r.subcontract}`}>
                    <td style={{ fontSize: "0.84rem", fontWeight: 600 }}>
                      {r.supplier || <span style={{ color: "#b45309", fontWeight: 700 }} title="No Supplier linked on the Subcontract Master">⚠ Not linked</span>}
                    </td>
                    <td style={{ fontSize: "0.82rem" }}>{r.subcontract || "—"}</td>
                    <td style={{ fontSize: "0.82rem" }}>{r.contract_model || "—"}</td>
                    <td style={NUM}>{fmtInt.format(r.row_count || 0)}</td>
                    <td style={NUM}>{fmt.format(r.ms_amount || 0)}</td>
                    <td style={{ ...NUM, color: "#1d4ed8" }}>{fmt.format(r.inet_amount || 0)}</td>
                    <td style={{ ...NUM, fontWeight: 700 }}>{fmt.format(r.payout || 0)}</td>
                    <td style={{ ...NUM, color: "#64748b" }}>{fmt.format(r.vat || 0)}</td>
                    <td style={{ ...NUM, fontWeight: 700 }}>{fmt.format((Number(r.payout) || 0) + (Number(r.vat) || 0))}</td>
                    <td style={{ ...NUM, color: "#b45309" }}>{fmt.format(r.not_ordered || 0)}</td>
                    <td style={{ ...NUM, color: "#0369a1" }}>{fmt.format(r.ready || 0)}</td>
                    <td style={{ ...NUM, color: "#1d4ed8" }}>{fmt.format(r.ordered || 0)}</td>
                    <td style={{ ...NUM, color: "#6d28d9" }}>{fmt.format(r.invoiced || 0)}</td>
                    <td style={{ ...NUM, color: "#047857" }}>{fmt.format(r.closed || 0)}</td>
                    <td style={{ ...NUM, color: "#94a3b8" }}>{fmt.format(r.closed_no_po || 0)}</td>
                  </tr>
                ))}
              </tbody>
              {bySupplier.length > 0 && (
                <tfoot>
                  <tr style={{ background: "#f1f5f9", fontWeight: 800 }}>
                    <td>Total</td>
                    <td></td>{/* Subcontract */}
                    <td></td>{/* Contract Model */}
                    <td style={NUM}>{fmtInt.format(supplierTotals.row_count)}</td>
                    <td style={NUM}>{fmt.format(supplierTotals.ms_amount)}</td>
                    <td style={NUM}>{fmt.format(supplierTotals.inet_amount)}</td>
                    <td style={NUM}>{fmt.format(supplierTotals.payout)}</td>
                    <td style={NUM}>{fmt.format(supplierTotals.vat)}</td>
                    <td style={NUM}>{fmt.format(supplierTotals.gross)}</td>
                    <td style={NUM}>{fmt.format(supplierTotals.not_ordered)}</td>
                    <td style={NUM}>{fmt.format(supplierTotals.ready)}</td>
                    <td style={NUM}>{fmt.format(supplierTotals.ordered)}</td>
                    <td style={NUM}>{fmt.format(supplierTotals.invoiced)}</td>
                    <td style={NUM}>{fmt.format(supplierTotals.closed)}</td>
                    <td style={NUM}>{fmt.format(supplierTotals.closed_no_po)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          ) : tab === "line" ? (
            <table key="line" className="data-table" data-excel-filter-all="1" data-table-key="subcon-payout-line-v2">
              <thead>
                <tr>
                  <th>Line Status</th>
                  <th style={{ textAlign: "right" }}>Lines</th>
                  <th style={{ textAlign: "right" }}>Customer MS Amount</th>
                  <th style={{ textAlign: "right" }}>INET Amount</th>
                  <th style={{ textAlign: "right" }}>Payout</th>
                  <th style={{ textAlign: "right" }}>VAT</th>
                  <th style={{ textAlign: "right" }}>Total incl. VAT</th>
                </tr>
              </thead>
              <tbody>
                {byLineStatus.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ padding: 0 }}>
                      {loading ? (
                        <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Loading…</div>
                      ) : (
                        <div className="empty-state">
                          <div className="empty-icon">📊</div>
                          <h3>No subcontractor lines</h3>
                          <p>Only SUB-type contracts with a milestone amount appear here.</p>
                        </div>
                      )}
                    </td>
                  </tr>
                ) : byLineStatus.map((r) => (
                  <tr key={r.status} style={r.row_count ? undefined : { color: "#94a3b8" }}>
                    <td><SubPoStatusBadge value={r.status === "Not Ordered" ? "" : r.status} /></td>
                    <td style={NUM}>{fmtInt.format(r.row_count || 0)}</td>
                    <td style={NUM}>{fmt.format(r.ms_amount || 0)}</td>
                    <td style={{ ...NUM, color: "#1d4ed8" }}>{fmt.format(r.inet_amount || 0)}</td>
                    <td style={{ ...NUM, fontWeight: 700 }}>{fmt.format(r.payout || 0)}</td>
                    <td style={{ ...NUM, color: "#64748b" }}>{fmt.format(r.vat || 0)}</td>
                    <td style={{ ...NUM, fontWeight: 700 }}>{fmt.format((Number(r.payout) || 0) + (Number(r.vat) || 0))}</td>
                  </tr>
                ))}
              </tbody>
              {byLineStatus.length > 0 && (
                <tfoot>
                  <tr style={{ background: "#f1f5f9", fontWeight: 800 }}>
                    <td>Total</td>
                    <td style={NUM}>{fmtInt.format(lineTotals.row_count)}</td>
                    <td style={NUM}>{fmt.format(lineTotals.ms_amount)}</td>
                    <td style={NUM}>{fmt.format(lineTotals.inet_amount)}</td>
                    <td style={NUM}>{fmt.format(lineTotals.payout)}</td>
                    <td style={NUM}>{fmt.format(lineTotals.vat)}</td>
                    <td style={NUM}>{fmt.format(lineTotals.gross)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          ) : (
            <table key="status" className="data-table" data-excel-filter-all="1" data-table-key="subcon-payout-status-v5">
              <thead>
                <tr>
                  <th>Milestone Status</th>
                  <th style={{ textAlign: "right" }}>Milestones</th>
                  <th style={{ textAlign: "right" }}>Customer MS Amount</th>
                  <th style={{ textAlign: "right" }}>INET Amount</th>
                  <th style={{ textAlign: "right" }}>Payout</th>
                  <th style={{ textAlign: "right" }}>VAT</th>
                  <th style={{ textAlign: "right" }}>Total incl. VAT</th>
                  <th style={{ textAlign: "right" }}>Closed (no PO)</th>
                </tr>
              </thead>
              <tbody>
                {byStatus.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ padding: 0 }}>
                      {loading ? (
                        <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Loading…</div>
                      ) : (
                        <div className="empty-state">
                          <div className="empty-icon">📊</div>
                          <h3>No subcontractor lines</h3>
                          <p>Only SUB-type contracts with a milestone amount appear here.</p>
                        </div>
                      )}
                    </td>
                  </tr>
                ) : byStatus.map((r) => (
                  // Zero rows are meaningful ("nothing is at this stage"), just muted.
                  <tr key={r.status} style={r.row_count ? undefined : { color: "#94a3b8" }}>
                    <td><SubPoStatusBadge value={r.status === "Not Ordered" ? "" : r.status} /></td>
                    <td style={NUM}>{fmtInt.format(r.row_count || 0)}</td>
                    <td style={NUM}>{fmt.format(r.ms_amount || 0)}</td>
                    <td style={{ ...NUM, color: "#1d4ed8" }}>{fmt.format(r.inet_amount || 0)}</td>
                    <td style={{ ...NUM, fontWeight: 700 }}>{fmt.format(r.payout || 0)}</td>
                    <td style={{ ...NUM, color: "#64748b" }}>{fmt.format(r.vat || 0)}</td>
                    <td style={{ ...NUM, fontWeight: 700 }}>{fmt.format((Number(r.payout) || 0) + (Number(r.vat) || 0))}</td>
                    <td style={{ ...NUM, color: "#94a3b8" }}>{fmt.format(r.closed_no_po || 0)}</td>
                  </tr>
                ))}
              </tbody>
              {byStatus.length > 0 && (
                <tfoot>
                  <tr style={{ background: "#f1f5f9", fontWeight: 800 }}>
                    <td>Total</td>
                    <td style={NUM}>{fmtInt.format(statusTotals.row_count)}</td>
                    <td style={NUM}>{fmt.format(statusTotals.ms_amount)}</td>
                    <td style={NUM}>{fmt.format(statusTotals.inet_amount)}</td>
                    <td style={NUM}>{fmt.format(statusTotals.payout)}</td>
                    <td style={NUM}>{fmt.format(statusTotals.vat)}</td>
                    <td style={NUM}>{fmt.format(statusTotals.gross)}</td>
                    <td style={NUM}>{fmt.format(statusTotals.closed_no_po)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          )}
        </DataTableWrapper>
      </div>
    </div>
  );
}
