import { useEffect, useState } from "react";
import DataTableWrapper from "../../components/DataTableWrapper";
import { useAuth } from "../../context/AuthContext";
import { useTableRowLimit, useResetOnRowLimitChange } from "../../context/TableRowLimitContext";
import TableRowsLimitFooter from "../../components/TableRowsLimitFooter";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

function statusBadgeClass(s) {
  const v = (s || "").toLowerCase().replace(/\s+/g, "-");
  if (v === "completed") return "completed";
  if (v === "in-progress" || v === "in-execution") return "in-progress";
  if (v === "cancelled") return "cancelled";
  return "new";
}

function statusAccent(s) {
  const v = (s || "").toLowerCase();
  if (v === "completed") return "status-completed";
  if (v.includes("progress") || v.includes("execution")) return "status-in-progress";
  if (v === "cancelled") return "status-cancelled";
  return "";
}

function formatDate(v) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch { return String(v); }
}

/* Mobile card for a single history record */
function HistoryCard({ r }) {
  return (
    <div className={`history-card ${statusAccent(r.execution_status)}`}>
      <div className="history-card-row">
        <div style={{ fontWeight: 700, fontSize: "0.82rem", color: "var(--text)" }}>
          {r.execution_date ? formatDate(r.execution_date) : "—"}
        </div>
        <span className={`status-badge ${statusBadgeClass(r.execution_status)}`}>
          <span className="status-dot" />
          {r.execution_status || "—"}
        </span>
      </div>
      <div className="history-card-id">{r.name}</div>
      <div className="history-card-detail">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <span style={{ color: "var(--text-muted)" }}>Achieved</span>
          <span style={{ fontWeight: 700, color: "var(--text)" }}>{fmt.format(r.achieved_qty || 0)}</span>
        </div>
        {r.gps_location && (
          <div style={{ display: "flex", gap: 6, marginTop: 4, fontSize: "0.72rem", color: "var(--text-muted)", alignItems: "flex-start" }}>
            <svg viewBox="0 0 20 20" fill="currentColor" width="12" height="12" style={{ flexShrink: 0, marginTop: 2 }}>
              <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd"/>
            </svg>
            <span style={{ fontFamily: "monospace", wordBreak: "break-all" }}>{r.gps_location}</span>
          </div>
        )}
        {r.remarks && (
          <div style={{ marginTop: 6, fontSize: "0.78rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
            {r.remarks}
          </div>
        )}
      </div>
    </div>
  );
}

export default function FieldHistory() {
  const { teamId } = useAuth();
  const { rowLimit } = useTableRowLimit();
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);

  useResetOnRowLimitChange(() => {
    setRecords([]);
    setLoading(true);
  });

  useEffect(() => {
    async function load() {
      try {
        const filters = teamId ? [["team", "=", teamId]] : [];
        const res = await fetch(
          `/api/resource/Daily Execution?filters=${encodeURIComponent(JSON.stringify(filters))}` +
          `&fields=${encodeURIComponent(JSON.stringify(["name", "rollout_plan", "execution_date", "execution_status", "achieved_qty", "gps_location", "remarks"]))}` +
          `&limit_page_length=${rowLimit}&order_by=execution_date+desc`,
          { credentials: "include" }
        );
        const json = await res.json();
        setRecords(json?.data || []);
      } catch { setRecords([]); }
      setLoading(false);
    }
    load();
  }, [teamId, rowLimit]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Execution History</h1>
          <div className="page-subtitle">Past execution records for {teamId || "your team"}</div>
        </div>
        <div className="page-actions">
          <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{records.length} records</span>
        </div>
      </div>

      {/* ── Mobile card list ──────────────────────────────── */}
      <div className="field-mobile-only">
        {loading ? (
          <div className="field-card-list">
            {[1, 2, 3].map((i) => (
              <div key={i} className="history-card">
                <div className="skeleton-line" style={{ width: "60%", height: 13, marginBottom: 8 }} />
                <div className="skeleton-line" style={{ width: "40%", height: 10, marginBottom: 12 }} />
                <div className="skeleton-line" style={{ width: "100%", height: 10 }} />
              </div>
            ))}
          </div>
        ) : records.length === 0 ? (
          <div className="empty-state" style={{ marginTop: 40 }}>
            <div className="empty-icon">📜</div>
            <h3>No execution history</h3>
            <p>Complete today's tasks to see history here.</p>
          </div>
        ) : (
          <div className="field-card-list">
            {records.map((r) => <HistoryCard key={r.name} r={r} />)}
          </div>
        )}
      </div>

      {/* ── Desktop table ─────────────────────────────────── */}
      <div className="page-content field-desktop-only">
        <DataTableWrapper>
          {loading ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Loading...</div>
          ) : records.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📜</div>
              <h3>No execution history</h3>
              <p>Complete today's tasks to see history here.</p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Execution ID</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th style={{ textAlign: "right" }}>Achieved</th>
                  <th>GPS</th>
                  <th>Remarks</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.name}>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{r.name}</td>
                    <td>{r.execution_date}</td>
                    <td>
                      <span className={`status-badge ${statusBadgeClass(r.execution_status)}`}>
                        <span className="status-dot" />{r.execution_status}
                      </span>
                    </td>
                    <td style={{ textAlign: "right" }}>{fmt.format(r.achieved_qty || 0)}</td>
                    <td style={{ fontSize: "0.72rem", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {r.gps_location || "—"}
                    </td>
                    <td style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {r.remarks || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </DataTableWrapper>
        <TableRowsLimitFooter placement="tableCard" loadedCount={records.length} />
      </div>
    </div>
  );
}
