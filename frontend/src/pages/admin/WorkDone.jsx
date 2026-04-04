import { useEffect, useState } from "react";
import { pmApi } from "../../services/api";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

function billingBadgeClass(status) {
  if (!status) return "new";
  const s = status.toLowerCase();
  if (s === "billed") return "completed";
  if (s === "pending") return "in-progress";
  if (s === "cancelled") return "cancelled";
  return "new";
}

export default function WorkDone() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const list = await pmApi.listPoIntake({ po_line_status: "Completed" });
      // Fallback: try generic get_list for "Work Done" doctype
      setRows(Array.isArray(list) ? list : []);
    } catch {
      try {
        // Try direct frappe client get_list for Work Done doctype
        const { pmApi: api } = await import("../../services/api");
        const wdList = await api.listPODispatches({});
        setRows(Array.isArray(wdList) ? wdList : []);
      } catch (err) {
        setError(err.message || "Failed to load work done data");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, []);

  /* ── Totals row ────────────────────────────────────────────── */
  const totals = rows.reduce(
    (acc, r) => ({
      qty: acc.qty + (parseFloat(r.qty) || 0),
      revenue: acc.revenue + (parseFloat(r.revenue || r.line_amount) || 0),
      cost: acc.cost + (parseFloat(r.cost) || 0),
      margin: acc.margin + (parseFloat(r.margin) || 0),
    }),
    { qty: 0, revenue: 0, cost: 0, margin: 0 }
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Work Done</h1>
          <div className="page-subtitle">Completed work entries with billing status</div>
        </div>
        <div className="page-actions">
          <button className="btn-secondary" onClick={loadData} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      <div className="page-content">
        {error && (
          <div className="notice error" style={{ marginBottom: 16 }}>
            <span>⚠</span> {error}
          </div>
        )}

        <div className="data-table-wrapper">
          {loading ? (
            <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)" }}>
              Loading work done records…
            </div>
          ) : rows.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">✅</div>
              <h3>No completed work records</h3>
              <p>Completed execution records will appear here.</p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>System ID</th>
                  <th>Item Code</th>
                  <th style={{ textAlign: "right" }}>Qty</th>
                  <th style={{ textAlign: "right" }}>Revenue</th>
                  <th style={{ textAlign: "right" }}>Cost</th>
                  <th style={{ textAlign: "right" }}>Margin</th>
                  <th>Billing Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const revenue = parseFloat(row.revenue || row.line_amount) || 0;
                  const cost = parseFloat(row.cost) || 0;
                  const margin = parseFloat(row.margin) || revenue - cost;
                  return (
                    <tr key={row.name}>
                      <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{row.name}</td>
                      <td>{row.item_code}</td>
                      <td style={{ textAlign: "right" }}>{row.qty}</td>
                      <td style={{ textAlign: "right", color: "var(--green)" }}>{fmt.format(revenue)}</td>
                      <td style={{ textAlign: "right" }}>{fmt.format(cost)}</td>
                      <td style={{ textAlign: "right", color: margin >= 0 ? "var(--green)" : "var(--red)" }}>
                        {fmt.format(margin)}
                      </td>
                      <td>
                        <span className={`status-badge ${billingBadgeClass(row.billing_status)}`}>
                          <span className="status-dot" />
                          {row.billing_status || "Pending"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>

              {/* Totals row */}
              <tfoot>
                <tr style={{
                  borderTop: "2px solid var(--border-medium)",
                  background: "rgba(10, 22, 40, 0.5)",
                }}>
                  <td colSpan={2} style={{ fontWeight: 700, color: "var(--text-secondary)", fontSize: "0.78rem" }}>
                    TOTALS
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 700 }}>{fmt.format(totals.qty)}</td>
                  <td style={{ textAlign: "right", fontWeight: 700, color: "var(--green)" }}>
                    {fmt.format(totals.revenue)}
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 700 }}>{fmt.format(totals.cost)}</td>
                  <td style={{
                    textAlign: "right",
                    fontWeight: 700,
                    color: totals.margin >= 0 ? "var(--green)" : "var(--red)",
                  }}>
                    {fmt.format(totals.margin)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
