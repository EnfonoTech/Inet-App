import { useEffect, useState } from "react";
import { pmApi } from "../../services/api";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

const BILLING_STATUSES = ["", "Pending", "Invoiced", "Closed"];

function billingBadgeClass(status) {
  if (!status) return "new";
  const s = status.toLowerCase();
  if (s === "closed") return "completed";
  if (s === "invoiced") return "in-progress";
  if (s === "pending") return "in-progress";
  return "new";
}

function DetailItem({ label, value }) {
  const txt = String(value || "");
  const isStatus = /status/i.test(label);
  const tone = txt.toLowerCase().includes("closed") || txt.toLowerCase().includes("complete")
    ? { bg: "#ecfdf5", fg: "#047857" }
    : txt.toLowerCase().includes("cancel") || txt.toLowerCase().includes("reject")
      ? { bg: "#fef2f2", fg: "#b91c1c" }
      : txt.toLowerCase().includes("pending") || txt.toLowerCase().includes("invoic")
        ? { bg: "#fffbeb", fg: "#b45309" }
        : { bg: "#eff6ff", fg: "#1d4ed8" };
  return (
    <div style={{ padding: "8px 10px" }}>
      <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>{label}</div>
      {isStatus ? (
        <span style={{ display: "inline-block", borderRadius: 999, padding: "3px 10px", fontSize: 12, fontWeight: 700, background: tone.bg, color: tone.fg }}>
          {value || "—"}
        </span>
      ) : (
        <div style={{ fontSize: 13, color: "#0f172a", fontWeight: 500 }}>{value || "—"}</div>
      )}
    </div>
  );
}

function Pill({ label, value, tone = "blue" }) {
  const palette = {
    blue: { bg: "#eff6ff", fg: "#1d4ed8", bd: "#bfdbfe" },
    green: { bg: "#ecfdf5", fg: "#047857", bd: "#a7f3d0" },
    amber: { bg: "#fffbeb", fg: "#b45309", bd: "#fde68a" },
  }[tone];
  return (
    <div style={{ border: `1px solid ${palette.bd}`, background: palette.bg, color: palette.fg, borderRadius: 999, padding: "4px 10px", fontSize: 12, fontWeight: 700 }}>
      {label}: {value || "—"}
    </div>
  );
}

export default function WorkDone() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [search, setSearch] = useState("");
  const [billingFilter, setBillingFilter] = useState("");
  const [teamFilter, setTeamFilter] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [detailRow, setDetailRow] = useState(null);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const list = await pmApi.listWorkDoneRows({});
      setRows(Array.isArray(list) ? list : []);
    } catch (err) {
      setError(err.message || "Failed to load work done data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, []);

  const filtered = rows.filter((r) => {
    if (billingFilter && (r.billing_status || "Pending") !== billingFilter) return false;
    if (teamFilter && (r.team || "") !== teamFilter) return false;
    if (projectFilter && (r.project_code || "") !== projectFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        (r.name || "").toLowerCase().includes(q) ||
        (r.execution || "").toLowerCase().includes(q) ||
        (r.item_code || "").toLowerCase().includes(q) ||
        (r.item_description || "").toLowerCase().includes(q) ||
        (r.site_name || "").toLowerCase().includes(q) ||
        (r.po_dispatch || "").toLowerCase().includes(q) ||
        (r.project_code || "").toLowerCase().includes(q) ||
        (r.po_no || "").toLowerCase().includes(q) ||
        (r.center_area || "").toLowerCase().includes(q) ||
        (r.region_type || "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  const hasFilters = search || billingFilter || teamFilter || projectFilter;
  const teams = [...new Set(rows.map((r) => r.team).filter(Boolean))].sort();
  const projects = [...new Set(rows.map((r) => r.project_code).filter(Boolean))].sort();

  const totals = filtered.reduce(
    (acc, r) => ({
      qty: acc.qty + (parseFloat(r.executed_qty) || 0),
      revenue: acc.revenue + (parseFloat(r.revenue_sar || r.revenue || r.line_amount) || 0),
      cost: acc.cost + (parseFloat(r.total_cost_sar || r.cost) || 0),
      margin: acc.margin + (parseFloat(r.margin_sar || r.margin) || 0),
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
          placeholder="Search POID, Item, Project, Team, Center area, Region…"
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
        <select
          value={teamFilter}
          onChange={(e) => setTeamFilter(e.target.value)}
          style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem" }}
        >
          <option value="">All Teams</option>
          {teams.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem" }}
        >
          <option value="">All Projects</option>
          {projects.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        {hasFilters && (
          <button
            className="btn-secondary"
            style={{ fontSize: "0.78rem", padding: "5px 12px" }}
            onClick={() => { setSearch(""); setBillingFilter(""); setTeamFilter(""); setProjectFilter(""); }}
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
                  <th>POID</th>
                  <th>Execution</th>
                  <th>Item Code</th>
                  <th>Description</th>
                  <th>Project</th>
                  <th>Site</th>
                  <th>Center area</th>
                  <th>Region</th>
                  <th>Team</th>
                  <th>Exec Date</th>
                  <th style={{ textAlign: "right" }}>Qty</th>
                  <th style={{ textAlign: "right" }}>Revenue</th>
                  <th style={{ textAlign: "right" }}>Cost</th>
                  <th style={{ textAlign: "right" }}>Margin</th>
                  <th>Billing Status</th>
                  <th>Open</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const revenue = parseFloat(row.revenue_sar || row.revenue || row.line_amount) || 0;
                  const cost = parseFloat(row.total_cost_sar || row.cost) || 0;
                  const margin = parseFloat(row.margin_sar || row.margin) || revenue - cost;
                  return (
                    <tr key={row.name}>
                      <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{row.po_dispatch || "—"}</td>
                      <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{row.execution || "—"}</td>
                      <td>{row.item_code}</td>
                      <td>{row.item_description || "—"}</td>
                      <td>{row.project_code}</td>
                      <td>{row.site_name || "—"}</td>
                      <td style={{ fontSize: "0.82rem", maxWidth: 120 }} title={row.center_area || ""}>
                        {row.center_area || "—"}
                      </td>
                      <td style={{ fontSize: "0.82rem" }}>{row.region_type || "—"}</td>
                      <td>{row.team || "—"}</td>
                      <td>{row.execution_date || "—"}</td>
                      <td style={{ textAlign: "right" }}>{row.executed_qty}</td>
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
                      <td>
                        <button
                          type="button"
                          className="btn-secondary"
                          style={{ fontSize: "0.72rem", padding: "4px 10px" }}
                          onClick={() => setDetailRow(row)}
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: "2px solid var(--border-medium)", background: "#f8fafc" }}>
                  <td colSpan={10} style={{ fontWeight: 700, color: "var(--text-secondary)", fontSize: "0.78rem", padding: "10px 16px" }}>
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
                  <td />
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
      {detailRow && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setDetailRow(null)}
        >
          <div
            style={{ background: "#fff", borderRadius: 12, padding: 20, width: "min(860px, 94vw)", maxHeight: "78vh", overflow: "auto" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ margin: 0, fontSize: "1rem" }}>Work Done Details</h3>
              <button type="button" onClick={() => setDetailRow(null)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8" }}>&times;</button>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              <Pill label="POID" value={detailRow.po_dispatch} tone="blue" />
              <Pill label="Work Done" value={detailRow.name} tone="amber" />
              <Pill label="Execution" value={detailRow.execution} tone="green" />
            </div>
            <div style={{ margin: 0, fontSize: 12, background: "#f8fafc", borderRadius: 8, padding: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, borderRadius: 8, background: "#fff" }}>
                <DetailItem label="Work Done ID" value={detailRow.name} />
                <DetailItem label="POID" value={detailRow.po_dispatch} />
                <DetailItem label="Execution ID" value={detailRow.execution} />
                <DetailItem label="Execution Date" value={detailRow.execution_date} />
                <DetailItem label="Item Code" value={detailRow.item_code} />
                <DetailItem label="Description" value={detailRow.item_description} />
                <DetailItem label="Project" value={detailRow.project_code} />
                <DetailItem label="Site" value={detailRow.site_name} />
                <DetailItem label="Center area" value={detailRow.center_area} />
                <DetailItem label="Region type" value={detailRow.region_type} />
                <DetailItem label="Team" value={detailRow.team} />
                <DetailItem label="Visit Type" value={detailRow.visit_type} />
                <DetailItem label="Executed Qty" value={fmt.format(detailRow.executed_qty || 0)} />
                <DetailItem label="Revenue (SAR)" value={fmt.format(detailRow.revenue_sar || 0)} />
                <DetailItem label="Cost (SAR)" value={fmt.format(detailRow.total_cost_sar || 0)} />
                <DetailItem label="Margin (SAR)" value={fmt.format(detailRow.margin_sar || 0)} />
                <DetailItem label="Billing Status" value={detailRow.billing_status} />
                <DetailItem label="Last Updated" value={detailRow.modified} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
