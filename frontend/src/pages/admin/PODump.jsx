import { useState } from "react";
import DataTableWrapper from "../../components/DataTableWrapper";
import { pmApi } from "../../services/api";
import RecordDetailView, { DetailHero, DetailStatTile } from "../../components/RecordDetailView";
import DateRangePicker from "../../components/DateRangePicker";

const fmtNum = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function monthStartISO() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

export default function PODump() {
  const [fromDate, setFromDate] = useState(monthStartISO());
  const [toDate, setToDate] = useState(todayISO());
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [meta, setMeta] = useState(null);
  const [detailRow, setDetailRow] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await pmApi.exportPODump(fromDate, toDate);
      setMeta(res);
      setRows(Array.isArray(res?.rows) ? res.rows : []);
    } catch (e) {
      setRows([]);
      setMeta(null);
      setError(e.message || "Failed to load dump");
    } finally {
      setLoading(false);
    }
  }

  function downloadCsv() {
    if (!rows.length) return;
    const keys = Object.keys(rows[0]);
    const esc = (v) => {
      const s = v == null ? "" : String(v);
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const lines = [keys.join(","), ...rows.map((r) => keys.map((k) => esc(r[k])).join(","))];
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
        <DateRangePicker
          value={{ from: fromDate, to: toDate }}
          onChange={({ from, to }) => { setFromDate(from); setToDate(to); }}
        />
        <button type="button" className="btn-primary" onClick={load} disabled={loading}>
          {loading ? "Loading…" : "Run"}
        </button>
        <button type="button" className="btn-secondary" onClick={downloadCsv} disabled={!rows.length}>
          Download CSV
        </button>
      </div>

      {error && (
        <div className="notice error" style={{ margin: "0 28px 16px" }}>
          <span>!</span> {error}
        </div>
      )}

      {meta && !error && (
        <div style={{ margin: "0 28px 12px", fontSize: "0.84rem", color: "var(--text-muted)" }}>
          Range {meta.from_date} → {meta.to_date} · {rows.length} row{rows.length !== 1 ? "s" : ""}
        </div>
      )}

      <div className="page-content">
        <DataTableWrapper>
          {!rows.length && !loading ? (
            <div className="empty-state">
              <div className="empty-icon">📄</div>
              <h3>No rows</h3>
              <p>Choose dates and click Run.</p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>PO Status</th>
                  <th>PO No</th>
                  <th>PO Line</th>
                  <th>Shipment</th>
                  <th>DUID</th>
                  <th>Item Code</th>
                  <th style={{ textAlign: "right" }}>Requested Qty</th>
                  <th style={{ textAlign: "right" }}>Amount</th>
                  <th>Project</th>
                  <th>Publish Date</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.id || r.poid || r.po_no || "line"}-${i}`}>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{r.id || "—"}</td>
                    <td>{r.po_status || "—"}</td>
                    <td>{r.po_no || "—"}</td>
                    <td>{r.po_line_no ?? "—"}</td>
                    <td>{r.shipment_no || "—"}</td>
                    <td>{r.site_code || "—"}</td>
                    <td>{r.item_code || "—"}</td>
                    <td style={{ textAlign: "right" }}>{r.requested_qty ?? "—"}</td>
                    <td style={{ textAlign: "right" }}>{r.line_amount ?? "—"}</td>
                    <td>{r.project_code || "—"}</td>
                    <td>{r.publish_date || "—"}</td>
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
      </div>
      <DetailModal row={detailRow} onClose={() => setDetailRow(null)} />
    </div>
  );
}
