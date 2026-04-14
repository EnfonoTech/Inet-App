import { useState } from "react";
import { pmApi } from "../../services/api";

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
    const ordered = [
      ["ID", row.id],
      ["PO Status", row.po_status],
      ["PO NO.", row.po_no],
      ["PO Line NO.", row.po_line_no],
      ["Shipment NO.", row.shipment_no],
      ["Site Name", row.site_name],
      ["Site Code", row.site_code],
      ["Item Code", row.item_code],
      ["Item Description", row.item_description],
      ["Unit", row.unit],
      ["Requested Qty", row.requested_qty],
      ["Due Qty", row.due_qty],
      ["Billed Quantity", row.billed_quantity],
      ["Quantity Cancel", row.quantity_cancel],
      ["Start Date", row.start_date],
      ["End Date", row.end_date],
      ["Sub Contract NO.", row.sub_contract_no],
      ["Currency", row.currency],
      ["Unit Price", row.unit_price],
      ["Line Amount", row.line_amount],
      ["Tax Rate", row.tax_rate],
      ["Payment Terms", row.payment_terms],
      ["Project Code", row.project_code],
      ["Project Name", row.project_name],
      ["Center Area", row.center_area],
      ["Publish Date", row.publish_date],
    ];
    return (
      <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
        <div style={{ width: "min(920px, 95vw)", maxHeight: "84vh", overflow: "auto", background: "#fff", borderRadius: 12, padding: 18 }} onClick={(e) => e.stopPropagation()}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>PO Dump Details</h3>
            <button className="btn-secondary" onClick={onClose}>Close</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {ordered.map(([k, v]) => (
              <div key={k} style={{ background: "#f8fafc", borderRadius: 8, padding: "8px 10px" }}>
                <div style={{ fontSize: 11, color: "#64748b" }}>{k}</div>
                <div style={{ fontSize: 13, color: "#0f172a", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{v == null || v === "" ? "—" : String(v)}</div>
              </div>
            ))}
          </div>
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

      <div className="toolbar" style={{ flexWrap: "wrap", gap: 12 }}>
        <label style={{ fontSize: "0.84rem", display: "flex", alignItems: "center", gap: 8 }}>
          From
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} style={{ padding: "6px 10px" }} />
        </label>
        <label style={{ fontSize: "0.84rem", display: "flex", alignItems: "center", gap: 8 }}>
          To
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} style={{ padding: "6px 10px" }} />
        </label>
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
        <div className="data-table-wrapper">
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
        </div>
      </div>
      <DetailModal row={detailRow} onClose={() => setDetailRow(null)} />
    </div>
  );
}
