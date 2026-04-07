import { useEffect, useState } from "react";
import { pmApi } from "../../services/api";
import { useAuth } from "../../context/AuthContext";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });

export default function IMTimesheets() {
  const { imName } = useAuth();
  const [timesheets, setTimesheets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");

  async function loadTimesheets() {
    setLoading(true);
    try {
      const filters = { im: imName };
      if (dateFrom) filters.from_date = dateFrom;
      if (dateTo) filters.to_date = dateTo;
      if (statusFilter) filters.status = statusFilter;
      const res = await pmApi.listTimesheets(filters);
      setTimesheets(res || []);
    } catch {
      setTimesheets([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadTimesheets(); }, [dateFrom, dateTo, statusFilter, imName]);

  const filtered = timesheets.filter((ts) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (ts.name || "").toLowerCase().includes(q) ||
      (ts.employee_name || "").toLowerCase().includes(q) ||
      (ts.start_date || "").toLowerCase().includes(q)
    );
  });

  const totalHours = filtered.reduce((sum, ts) => sum + (ts.total_hours || 0), 0);
  const billableHours = filtered.reduce((sum, ts) => sum + (ts.total_billable_hours || 0), 0);

  const hasFilters = dateFrom || dateTo || statusFilter || search;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Team Timesheets</h1>
          <div className="page-subtitle">
            {filtered.length} entries · {fmt.format(totalHours)} total hours
          </div>
        </div>
      </div>

      {/* ── Toolbar / Filters ───────────────────────────────── */}
      <div className="toolbar">
        <input
          type="search"
          placeholder="Search ID, Employee…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: "7px 14px", borderRadius: 8,
            border: "1px solid #e2e8f0", fontSize: "0.84rem", minWidth: 200,
          }}
        />
        <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-muted)", whiteSpace: "nowrap" }}>From:</label>
        <input
          type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
          style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem" }}
        />
        <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-muted)", whiteSpace: "nowrap" }}>To:</label>
        <input
          type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
          style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem" }}
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem" }}
        >
          <option value="">All Status</option>
          <option value="Draft">Draft</option>
          <option value="Submitted">Submitted</option>
        </select>
        {hasFilters && (
          <button
            className="btn-secondary"
            style={{ fontSize: "0.78rem", padding: "5px 12px" }}
            onClick={() => { setDateFrom(""); setDateTo(""); setStatusFilter(""); setSearch(""); }}
          >
            Clear
          </button>
        )}
      </div>

      <div className="page-content">
        <div className="data-table-wrapper">
          {loading ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Loading timesheets...</div>
          ) : filtered.length === 0 ? (
            <div className="empty-state" style={{ marginTop: 20 }}>
              <div className="empty-icon">&#x1F4CB;</div>
              <h3>{hasFilters ? "No results match your filters" : "No timesheets found"}</h3>
              <p>
                {hasFilters
                  ? "Try adjusting your search or filter criteria."
                  : "Timesheets submitted by your teams will appear here."}
              </p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Employee</th>
                  <th>Date</th>
                  <th style={{ textAlign: "right" }}>Total Hours</th>
                  <th style={{ textAlign: "right" }}>Billable Hours</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((ts) => (
                  <tr key={ts.name}>
                    <td style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>{ts.name}</td>
                    <td>{ts.employee_name || "—"}</td>
                    <td>{ts.start_date || "—"}</td>
                    <td style={{ textAlign: "right", fontFamily: "'JetBrains Mono', monospace" }}>
                      {ts.total_hours != null ? fmt.format(ts.total_hours) : "—"}
                    </td>
                    <td style={{ textAlign: "right", fontFamily: "'JetBrains Mono', monospace" }}>
                      {ts.total_billable_hours != null ? fmt.format(ts.total_billable_hours) : "—"}
                    </td>
                    <td>
                      <span style={{
                        display: "inline-block", padding: "3px 10px", borderRadius: 12,
                        fontSize: 11, fontWeight: 700, textTransform: "uppercase",
                        background: ts.status === "Submitted" ? "#ecfdf5" : "#eff6ff",
                        color: ts.status === "Submitted" ? "#065f46" : "#1e40af",
                      }}>
                        {ts.status || "Draft"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", fontWeight: 700, fontSize: "0.78rem" }}>
                    {filtered.length}{hasFilters && ` of ${timesheets.length}`} rows
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 700, padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0" }}>
                    {fmt.format(totalHours)}
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 700, padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0" }}>
                    {fmt.format(billableHours)}
                  </td>
                  <td style={{ background: "#f8fafc", borderTop: "1px solid #e2e8f0" }} />
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
