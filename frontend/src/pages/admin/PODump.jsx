import { useEffect, useMemo, useRef, useState } from "react";
import DataTableWrapper from "../../components/DataTableWrapper";
import { pmApi } from "../../services/api";
import RecordDetailView, { DetailHero, DetailStatTile } from "../../components/RecordDetailView";
import DateRangePicker from "../../components/DateRangePicker";
import { useTableRowLimit, useResetOnRowLimitChange } from "../../context/TableRowLimitContext";
import TableRowsLimitFooter from "../../components/TableRowsLimitFooter";

const fmtNum = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function monthStartISO() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

const PO_DUMP_CACHE_KEY = "inet_po_dump_cache_v2";

function readCache() {
  try {
    const raw = sessionStorage.getItem(PO_DUMP_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function writeCache(payload) {
  try { sessionStorage.setItem(PO_DUMP_CACHE_KEY, JSON.stringify(payload)); }
  catch { /* sessionStorage may be full; non-fatal */ }
}

export default function PODump() {
  const { rowLimit } = useTableRowLimit();
  const cached = useRef(readCache());

  const [fromDate, setFromDate] = useState(cached.current?.fromDate || monthStartISO());
  const [toDate, setToDate] = useState(cached.current?.toDate || todayISO());
  const [rows, setRows] = useState(cached.current?.rows || []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [meta, setMeta] = useState(cached.current?.meta || null);
  const [detailRow, setDetailRow] = useState(null);
  const [search, setSearch] = useState("");

  useResetOnRowLimitChange(() => {
    setRows([]);
    setMeta(null);
  });
  // Default: hide closed/cancelled archive lines unless explicitly toggled.
  const [showClosed, setShowClosed] = useState(cached.current?.showClosed ?? false);
  const [showCancelled, setShowCancelled] = useState(cached.current?.showCancelled ?? false);
  const [showOpen, setShowOpen] = useState(cached.current?.showOpen ?? true);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const hay = [
        r.id, r.po_no, r.poid, r.po_line_no, r.shipment_no,
        r.site_code, r.site_name, r.item_code, r.item_description,
        r.project_code, r.project_name, r.po_status, r.po_line_status, r.center_area,
        r.sub_contract_no, r.currency, r.payment_terms,
      ]
        .map((v) => (v == null ? "" : String(v)))
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [rows, search]);


  const activeStatuses = useMemo(() => {
    const out = [];
    if (showOpen) out.push("OPEN");
    if (showClosed) out.push("CLOSED");
    if (showCancelled) out.push("CANCELLED");
    return out;
  }, [showOpen, showClosed, showCancelled]);

  async function load() {
    const statuses = activeStatuses;
    if (!statuses.length) {
      setRows([]);
      setMeta(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await pmApi.exportPODump(fromDate, toDate, statuses, rowLimit);
      const nextRows = Array.isArray(res?.rows) ? res.rows : [];
      setMeta(res);
      setRows(nextRows);
      writeCache({
        fromDate, toDate, rowLimit,
        showOpen, showClosed, showCancelled,
        rows: nextRows, meta: res,
        savedAt: Date.now(),
      });
    } catch (e) {
      setRows([]);
      setMeta(null);
      setError(e.message || "Failed to load dump");
    } finally {
      setLoading(false);
    }
  }

  // Auto-fetch on any param change. A short debounce keeps rapid checkbox /
  // date-picker toggles from firing multiple requests in flight.
  useEffect(() => {
    if (!activeStatuses.length) return;
    const t = setTimeout(() => { load(); }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate, rowLimit, showOpen, showClosed, showCancelled]);

  function downloadCsv() {
    const exportRows = filteredRows.length ? filteredRows : rows;
    if (!exportRows.length) return;
    const keys = Object.keys(exportRows[0]);
    const esc = (v) => {
      const s = v == null ? "" : String(v);
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const lines = [keys.join(","), ...exportRows.map((r) => keys.map((k) => esc(r[k])).join(","))];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `po-dump-${fromDate}-to-${toDate}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function DetailModal({ row, onClose }) {
    if (!row) return null;
    return (
      <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
        <div style={{ width: "min(920px, 100%)", maxHeight: "88vh", overflow: "auto", background: "#fff", borderRadius: 14, padding: 20, boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)" }} onClick={(e) => e.stopPropagation()}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700 }}>
              PO Dump Details {row.po_no ? <span style={{ color: "#94a3b8", fontWeight: 500 }}>· {row.po_no}</span> : null}
            </h3>
            <button className="btn-secondary" onClick={onClose}>Close</button>
          </div>
          <RecordDetailView
            row={row}
            pills={[
              row.po_no ? { label: "PO", value: row.po_no, tone: "blue" } : null,
              row.project_code ? { label: "Project", value: row.project_code, tone: "amber" } : null,
              row.site_code ? { label: "DUID", value: row.site_code, tone: "green" } : null,
              row.po_status ? { label: "Status", value: row.po_status, tone: /complete/i.test(row.po_status) ? "green" : /cancel/i.test(row.po_status) ? "rose" : /new|pending/i.test(row.po_status) ? "amber" : "slate" } : null,
            ].filter(Boolean)}
            hero={
              <DetailHero>
                <DetailStatTile label="Item Code" value={row.item_code || "—"} />
                <DetailStatTile label="Requested Qty" value={row.requested_qty != null ? fmtNum.format(row.requested_qty) : "—"} tone="blue" />
                <DetailStatTile label={`Unit Price${row.currency ? ` (${row.currency})` : ""}`} value={row.unit_price != null ? fmtNum.format(row.unit_price) : "—"} />
                <DetailStatTile label={`Line Amount${row.currency ? ` (${row.currency})` : ""}`} value={row.line_amount != null ? fmtNum.format(row.line_amount) : "—"} tone="green" />
              </DetailHero>
            }
            hiddenFields={[
              "po_no", "project_code", "site_code", "po_status",
              "item_code", "requested_qty", "unit_price", "line_amount", "currency",
            ]}
            keyOrder={[
              "item_description",
              "id", "po_line_no", "shipment_no",
              "site_name",
              "unit", "due_qty", "billed_quantity", "quantity_cancel",
              "start_date", "end_date", "publish_date",
              "sub_contract_no",
              "tax_rate", "payment_terms",
              "project_name", "center_area",
            ]}
          />
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">PO dump</h1>
          <div className="page-subtitle">
            PO Intake lines by upload date. Table is compact; click View to see full source columns.
          </div>
        </div>
      </div>

      <div className="toolbar">
        <input
          type="search"
          placeholder="Search PO, POID, Item, Project, DUID, Site, Status…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          disabled={!rows.length}
        />
        {search && (
          <button type="button" className="btn-secondary" onClick={() => setSearch("")}>
            Clear
          </button>
        )}
        <DateRangePicker
          value={{ from: fromDate, to: toDate }}
          onChange={({ from, to }) => { setFromDate(from); setToDate(to); }}
        />
        <div style={{ display: "inline-flex", alignItems: "stretch", border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden", background: "#f8fafc" }}>
          {[
            { id: "open", label: "Open", state: showOpen, set: setShowOpen, total: meta?.totals?.open, activeBg: "#10b981", activeFg: "#fff" },
            { id: "closed", label: "Closed", state: showClosed, set: setShowClosed, total: meta?.totals?.closed, activeBg: "#64748b", activeFg: "#fff" },
            { id: "cancelled", label: "Cancelled", state: showCancelled, set: setShowCancelled, total: meta?.totals?.cancelled, activeBg: "#ef4444", activeFg: "#fff" },
          ].map((t, i) => (
            <button
              key={t.id}
              type="button"
              onClick={() => t.set(!t.state)}
              style={{
                padding: "6px 14px",
                fontSize: "0.82rem",
                fontWeight: t.state ? 700 : 500,
                border: "none",
                borderLeft: i === 0 ? "none" : "1px solid #e2e8f0",
                background: t.state ? t.activeBg : "transparent",
                color: t.state ? t.activeFg : "#475569",
                cursor: "pointer",
                whiteSpace: "nowrap",
                transition: "background 0.12s",
              }}
              title={`${t.state ? "Hide" : "Show"} ${t.label}${t.total != null ? ` (${t.total})` : ""}`}
            >
              {t.label}{t.total != null ? <span style={{ marginLeft: 6, opacity: 0.85, fontWeight: 600 }}>· {t.total}</span> : null}
            </button>
          ))}
        </div>
        <div className="toolbar-actions">
          {loading && (
            <span style={{ fontSize: "0.78rem", color: "#64748b" }}>Loading…</span>
          )}
          <button type="button" className="btn-secondary" onClick={downloadCsv} disabled={!rows.length}>
            Download CSV
          </button>
        </div>
      </div>

      {error && (
        <div className="notice error" style={{ margin: "0 28px 16px" }}>
          <span>!</span> {error}
        </div>
      )}

      {meta && !error && (
        <div style={{ margin: "0 28px 12px", fontSize: "0.84rem", color: "var(--text-muted)" }}>
          Range {meta.from_date} → {meta.to_date} ·{" "}
          {activeStatuses.join(" + ")} ·{" "}
          {search
            ? <><strong>{filteredRows.length}</strong> matching of {rows.length} row{rows.length !== 1 ? "s" : ""}</>
            : <>{rows.length} row{rows.length !== 1 ? "s" : ""}</>}
        </div>
      )}

      <div className="page-content">
        <DataTableWrapper>
          {!rows.length && !loading ? (
            <div className="empty-state">
              <div className="empty-icon">📄</div>
              <h3>No rows</h3>
              <p>Pick a date range and at least one status above.</p>
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">🔍</div>
              <h3>No matches</h3>
              <p>No rows match "{search}". Try a different search term.</p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>POID</th>
                  <th>Line Status</th>
                  <th>PO No</th>
                  <th>Project</th>
                  <th>Project Name</th>
                  <th>DUID</th>
                  <th>Item Code</th>
                  <th>Item Description</th>
                  <th style={{ textAlign: "right" }}>Qty</th>
                  <th style={{ textAlign: "right" }}>Unit Price</th>
                  <th style={{ textAlign: "right" }}>Amount</th>
                  <th>Start Date</th>
                  <th>End Date</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r, i) => (
                  <tr key={`${r.id || r.poid || r.po_no || "line"}-${i}`}>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{r.poid || r.id || "—"}</td>
                    <td>{r.po_line_status || r.po_status || "—"}</td>
                    <td>{r.po_no || "—"}</td>
                    <td>{r.project_code || "—"}</td>
                    <td style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.project_name || ""}>{r.project_name || "—"}</td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }} title={r.site_name || ""}>{r.site_code || "—"}</td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{r.item_code || "—"}</td>
                    <td style={{ maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.item_description || ""}>{r.item_description || "—"}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.requested_qty ?? "—"}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.unit_price != null ? fmtNum.format(r.unit_price) : "—"}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.line_amount != null ? fmtNum.format(r.line_amount) : "—"}</td>
                    <td style={{ fontSize: "0.78rem" }}>{r.start_date ? String(r.start_date).slice(0, 10) : "—"}</td>
                    <td style={{ fontSize: "0.78rem" }}>{r.end_date ? String(r.end_date).slice(0, 10) : "—"}</td>
                    <td>
                      <button type="button" className="btn-secondary" style={{ padding: "4px 10px", fontSize: "0.75rem" }} onClick={() => setDetailRow(r)}>
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
          filterActive={!!search || activeStatuses.length < 3}
        />
      </div>
      <DetailModal row={detailRow} onClose={() => setDetailRow(null)} />
    </div>
  );
}
