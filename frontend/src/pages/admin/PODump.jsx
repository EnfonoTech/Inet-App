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
  const [uniqueUid, setUniqueUid] = useState(true);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [meta, setMeta] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await pmApi.exportPODump(fromDate, toDate, uniqueUid);
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

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">PO dump</h1>
          <div className="page-subtitle">
            PO Intake lines by upload date (parent creation). INET Line UID is an internal stable id; POID stays on each
            line. Line SL is the row index on the PO.
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
        <label style={{ fontSize: "0.84rem", display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={uniqueUid} onChange={(e) => setUniqueUid(e.target.checked)} />
          Unique INET Line UID only
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
              <p>Choose dates and click Run (run bench migrate if INET Line UID column is missing).</p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>INET Line UID</th>
                  <th style={{ textAlign: "right" }}>Line SL</th>
                  <th>POID</th>
                  <th>PO No</th>
                  <th>Upload date</th>
                  <th>Project</th>
                  <th>Item</th>
                  <th style={{ textAlign: "right" }}>Qty</th>
                  <th style={{ textAlign: "right" }}>Amount</th>
                  <th>DUID</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.inet_line_uid || r.poid}-${i}`}>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{r.inet_line_uid || "—"}</td>
                    <td style={{ textAlign: "right" }}>{r.line_sl ?? "—"}</td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{r.poid || "—"}</td>
                    <td>{r.po_no || "—"}</td>
                    <td>{r.upload_date || "—"}</td>
                    <td>{r.project_code || "—"}</td>
                    <td>{r.item_code || "—"}</td>
                    <td style={{ textAlign: "right" }}>{r.qty ?? "—"}</td>
                    <td style={{ textAlign: "right" }}>{r.line_amount ?? "—"}</td>
                    <td>{r.site_code || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
