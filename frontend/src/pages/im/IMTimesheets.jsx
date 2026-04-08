import { useEffect, useState } from "react";
import { pmApi } from "../../services/api";
import { useAuth } from "../../context/AuthContext";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });

function statusTone(value) {
  const s = String(value || "").toLowerCase();
  if (s.includes("complete") || s.includes("approved") || s.includes("done")) return { bg: "#ecfdf5", fg: "#047857" };
  if (s.includes("cancel") || s.includes("reject") || s.includes("fail")) return { bg: "#fef2f2", fg: "#b91c1c" };
  if (s.includes("progress") || s.includes("planned") || s.includes("running")) return { bg: "#eff6ff", fg: "#1d4ed8" };
  return { bg: "#fffbeb", fg: "#b45309" };
}

function DetailItem({ label, value }) {
  const isStatus = /status|mode|state/i.test(label);
  const tone = statusTone(value);
  return (
    <div style={{ background: "#fff", borderRadius: 8, padding: "8px 10px" }}>
      <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>{label}</div>
      {isStatus ? (
        <span style={{ display: "inline-block", borderRadius: 999, padding: "3px 10px", fontSize: 12, fontWeight: 700, background: tone.bg, color: tone.fg }}>
          {value == null || value === "" ? "—" : String(value)}
        </span>
      ) : (
        <div style={{ fontSize: 13, color: "#0f172a", fontWeight: 500 }}>{value == null || value === "" ? "—" : String(value)}</div>
      )}
    </div>
  );
}

function shortDt(v) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(v);
  }
}

export default function IMTimesheets() {
  const { imName } = useAuth();
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");
  const [detailRow, setDetailRow] = useState(null);

  async function loadLogs() {
    setLoading(true);
    try {
      const filters = { im: imName };
      if (dateFrom) filters.from_date = dateFrom;
      if (dateTo) filters.to_date = dateTo;
      const res = await pmApi.listExecutionTimeLogs(filters, 500, 0);
      setLogs(res?.logs || []);
      setTotal(res?.total ?? (res?.logs || []).length);
    } catch {
      setLogs([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (imName) loadLogs();
    else {
      setLogs([]);
      setTotal(0);
      setLoading(false);
    }
  }, [dateFrom, dateTo, imName]);

  const filtered = logs.filter((row) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (row.name || "").toLowerCase().includes(q) ||
      (row.user_full_name || "").toLowerCase().includes(q) ||
      (row.rollout_plan || "").toLowerCase().includes(q) ||
      (row.team_id || "").toLowerCase().includes(q)
    );
  });

  const totalHours = filtered.reduce((sum, row) => sum + (parseFloat(row.duration_hours) || 0), 0);
  const hasFilters = dateFrom || dateTo || search;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Team time logs</h1>
          <div className="page-subtitle">
            Execution time for your teams · {filtered.length} rows · {fmt.format(totalHours)} h
          </div>
        </div>
      </div>

      <div className="toolbar">
        <input
          type="search"
          placeholder="Search user, plan, team…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: "7px 14px",
            borderRadius: 8,
            border: "1px solid #e2e8f0",
            fontSize: "0.84rem",
            minWidth: 200,
          }}
        />
        <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-muted)", whiteSpace: "nowrap" }}>From:</label>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem" }}
        />
        <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-muted)", whiteSpace: "nowrap" }}>To:</label>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem" }}
        />
        {hasFilters && (
          <button
            className="btn-secondary"
            style={{ fontSize: "0.78rem", padding: "5px 12px" }}
            onClick={() => {
              setDateFrom("");
              setDateTo("");
              setSearch("");
            }}
          >
            Clear
          </button>
        )}
      </div>

      <div className="page-content">
        <div className="data-table-wrapper">
          {loading ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="empty-state" style={{ marginTop: 20 }}>
              <div className="empty-icon">&#x1F553;</div>
              <h3>{hasFilters ? "No results" : "No time logs for your teams"}</h3>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>User</th>
                  <th>Team</th>
                  <th>Rollout</th>
                  <th>Work</th>
                  <th>Start</th>
                  <th>End</th>
                  <th style={{ textAlign: "right" }}>Hours</th>
                  <th>State</th>
                  <th>View</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.name}>
                    <td style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>{row.name}</td>
                    <td>{row.user_full_name || row.user}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 12 }}>{row.team_id || "—"}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 11 }}>{row.rollout_plan}</td>
                    <td style={{ fontSize: "0.78rem", maxWidth: 200 }}>{row.item_description || "—"}</td>
                    <td style={{ fontSize: "0.78rem" }}>{shortDt(row.start_time)}</td>
                    <td style={{ fontSize: "0.78rem" }}>{row.is_running ? "—" : shortDt(row.end_time)}</td>
                    <td style={{ textAlign: "right", fontFamily: "'JetBrains Mono', monospace" }}>
                      {row.is_running ? "—" : fmt.format(row.duration_hours || 0)}
                    </td>
                    <td>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "3px 10px",
                          borderRadius: 12,
                          fontSize: 11,
                          fontWeight: 700,
                          textTransform: "uppercase",
                          background: row.is_running ? "#fef3c7" : "#ecfdf5",
                          color: row.is_running ? "#92400e" : "#065f46",
                        }}
                      >
                        {row.is_running ? "Running" : "Done"}
                      </span>
                    </td>
                    <td>
                      <button type="button" className="btn-secondary" style={{ fontSize: "0.72rem", padding: "4px 10px" }} onClick={() => setDetailRow(row)}>
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
      {detailRow && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setDetailRow(null)}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 20, width: "min(860px, 94vw)", maxHeight: "78vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ margin: 0, fontSize: "1rem" }}>Time Log Details</h3>
              <button type="button" onClick={() => setDetailRow(null)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8" }}>&times;</button>
            </div>
            <div style={{ maxHeight: "65vh", overflow: "auto", background: "#f8fafc", borderRadius: 8, padding: 12 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                <div style={{ border: "1px solid #bfdbfe", background: "#eff6ff", color: "#1d4ed8", borderRadius: 999, padding: "4px 10px", fontSize: 12, fontWeight: 700 }}>
                  Log: {detailRow.name || "—"}
                </div>
                <div style={{ border: "1px solid #fde68a", background: "#fffbeb", color: "#b45309", borderRadius: 999, padding: "4px 10px", fontSize: 12, fontWeight: 700 }}>
                  User: {detailRow.user_full_name || detailRow.user || "—"}
                </div>
                <div style={{ border: "1px solid #a7f3d0", background: "#ecfdf5", color: "#047857", borderRadius: 999, padding: "4px 10px", fontSize: 12, fontWeight: 700 }}>
                  Team: {detailRow.team_id || "—"}
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                {Object.entries(detailRow).map(([k, v]) => (
                  <DetailItem
                    key={k}
                    label={String(k).toLowerCase() === "system_id" ? "POID" : k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                    value={v}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
