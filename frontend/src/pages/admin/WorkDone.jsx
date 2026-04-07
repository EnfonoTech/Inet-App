import { useEffect, useState } from "react";
import { pmApi } from "../../services/api";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

const BILLING_STATUSES = ["", "Pending", "Billed", "Cancelled"];

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

  const [search, setSearch] = useState("");
  const [billingFilter, setBillingFilter] = useState("");

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const list = await pmApi.listPoIntake({ po_line_status: "Completed" });
      setRows(Array.isArray(list) ? list : []);
    } catch {
      try {
        const wdList = await pmApi.listPODispatches({});
        setRows(Array.isArray(wdList) ? wdList : []);
      } catch (err) {
        setError(err.message || "Failed to load work done data");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, []);

  const filtered = rows.filter((r) => {
    if (billingFilter && (r.billing_status || "Pending") !== billingFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        (r.name || "").toLowerCase().includes(q) ||
        (r.item_code || "").toLowerCase().includes(q) ||
        (r.project_code || "").toLowerCase().includes(q) ||
        (r.po_no || "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  const hasFilters = search || billingFilter;

  const totals = filtered.reduce(
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

      {/* ── Toolbar ─────────────────────────────────────────── */}
      <div className="toolbar">
        <input
          type="search"
          placeholder="Search System ID, Item, Project, PO No…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: "7px 14px", borderRadius: 8,
            border: "1px solid #e2e8f0", fontSize: "0.84rem", minWidth: 280,
          }}
        />
        <select
          value={billingFilter}
          onChange={(e) => setBillingFilter(e.target.value)}
          style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem" }}
        >
          <option value="">All Billing Status</option>
          {BILLING_STATUSES.filter(Boolean).map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        {hasFilters && (
          <button
            className="btn-secondary"
            style={{ fontSize: "0.78rem", padding: "5px 12px" }}
            onClick={() => { setSearch(""); setBillingFilter(""); }}
          >
            Clear
          </button>
        )}
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
          ) : filtered.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">✅</div>
              <h3>{hasFilters ? "No results match your filters" : "No completed work records"}</h3>
              <p>
                {hasFilters
                  ? "Try adjusting your search or filter criteria."
                  : "Completed execution records will appear here."}
              </p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>System ID</th>
                  <th>Item Code</th>
                  <th>Project</th>
                  <th>PO No</th>
                  <th style={{ textAlign: "right" }}>Qty</th>
                  <th style={{ textAlign: "right" }}>Revenue</th>
                  <th style={{ textAlign: "right" }}>Cost</th>
                  <th style={{ textAlign: "right" }}>Margin</th>
                  <th>Billing Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const revenue = parseFloat(row.revenue || row.line_amount) || 0;
                  const cost = parseFloat(row.cost) || 0;
                  const margin = parseFloat(row.margin) || revenue - cost;
                  return (
                    <tr key={row.name}>
                      <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{row.name}</td>
                      <td>{row.item_code}</td>
                      <td>{row.project_code}</td>
                      <td>{row.po_no}</td>
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
              <tfoot>
                <tr style={{ borderTop: "2px solid var(--border-medium)", background: "#f8fafc" }}>
                  <td colSpan={4} style={{ fontWeight: 700, color: "var(--text-secondary)", fontSize: "0.78rem", padding: "10px 16px" }}>
                    TOTALS ({filtered.length}{hasFilters && ` of ${rows.length}`} rows)
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 700, padding: "10px 16px" }}>{fmt.format(totals.qty)}</td>
                  <td style={{ textAlign: "right", fontWeight: 700, color: "var(--green)", padding: "10px 16px" }}>
                    {fmt.format(totals.revenue)}
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 700, padding: "10px 16px" }}>{fmt.format(totals.cost)}</td>
                  <td style={{
                    textAlign: "right", fontWeight: 700, padding: "10px 16px",
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
