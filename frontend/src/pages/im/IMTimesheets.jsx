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

  async function loadTimesheets() {
    setLoading(true);
    try {
      const filters = { im: imName };
      if (dateFrom) filters.from_date = dateFrom;
      if (dateTo) filters.to_date = dateTo;
      const res = await pmApi.listTimesheets(filters);
      setTimesheets(res || []);
    } catch {
      setTimesheets([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadTimesheets(); }, [dateFrom, dateTo, imName]);

  const totalHours = timesheets.reduce((sum, ts) => sum + (ts.total_hours || 0), 0);

  const inputStyle = {
    padding: "9px 14px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
    background: "var(--bg-white)", fontSize: 13, color: "var(--text)",
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Team Timesheets</h1>
          <div className="page-subtitle">
            {timesheets.length} entries | {fmt.format(totalHours)} total hours
          </div>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ fontSize: 13, fontWeight: 600, color: "var(--text-muted)" }}>From:</label>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={inputStyle} />
        <label style={{ fontSize: 13, fontWeight: 600, color: "var(--text-muted)" }}>To:</label>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={inputStyle} />
        {(dateFrom || dateTo) && (
          <button className="btn-secondary" onClick={() => { setDateFrom(""); setDateTo(""); }} style={{ fontSize: 12 }}>Clear</button>
        )}
      </div>

      {/* Table */}
      <div style={{ background: "var(--bg-white)", border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "hidden", boxShadow: "var(--shadow-sm)" }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Loading timesheets...</div>
        ) : timesheets.length === 0 ? (
          <div className="empty-state" style={{ marginTop: 20 }}>
            <div className="empty-icon">&#x1F4CB;</div>
            <h3>No timesheets found</h3>
            <p>Timesheets submitted by your teams will appear here.</p>
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
              {timesheets.map(ts => (
                <tr key={ts.name}>
                  <td style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>{ts.name}</td>
                  <td>{ts.employee_name || "\u2014"}</td>
                  <td>{ts.start_date || "\u2014"}</td>
                  <td style={{ textAlign: "right", fontFamily: "'JetBrains Mono', monospace" }}>
                    {ts.total_hours != null ? fmt.format(ts.total_hours) : "\u2014"}
                  </td>
                  <td style={{ textAlign: "right", fontFamily: "'JetBrains Mono', monospace" }}>
                    {ts.total_billable_hours != null ? fmt.format(ts.total_billable_hours) : "\u2014"}
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
          </table>
        )}
      </div>
    </div>
  );
}
