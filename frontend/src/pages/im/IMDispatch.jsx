import { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { pmApi } from "../../services/api";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 2, minimumFractionDigits: 2 });

function DispatchModeBadge({ mode }) {
  const isAuto = mode === "Auto";
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 5,
      padding: "3px 11px",
      borderRadius: 12,
      fontSize: "0.72rem",
      fontWeight: 700,
      background: isAuto
        ? "linear-gradient(90deg,#6366f1 0%,#8b5cf6 100%)"
        : "linear-gradient(90deg,#0ea5e9 0%,#06b6d4 100%)",
      color: "#fff",
      boxShadow: isAuto
        ? "0 1px 6px rgba(99,102,241,0.3)"
        : "0 1px 6px rgba(14,165,233,0.25)",
    }}>
      {isAuto ? "⚡ Auto Dispatched" : "✋ Manual Dispatch"}
    </span>
  );
}

export default function IMDispatch() {
  const { imName } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modeFilter, setModeFilter] = useState("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    load();
  }, [imName]); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const filters = [];
      if (imName) filters.push(["im", "=", imName]);
      const res = await pmApi.listPODispatches(filters);
      setRows(Array.isArray(res) ? res : []);
    } catch (err) {
      setError(err.message || "Failed to load dispatches");
    } finally {
      setLoading(false);
    }
  }

  const filtered = rows.filter((r) => {
    if (modeFilter !== "all" && r.dispatch_mode !== modeFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        (r.po_no || "").toLowerCase().includes(q) ||
        (r.project_code || "").toLowerCase().includes(q) ||
        (r.item_code || "").toLowerCase().includes(q) ||
        (r.site_code || "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  const autoCount = rows.filter((r) => r.dispatch_mode === "Auto").length;
  const manualCount = rows.filter((r) => r.dispatch_mode === "Manual").length;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">My Dispatches</h1>
          <div className="page-subtitle">PO lines dispatched to you — Auto & Manual</div>
        </div>
        <div className="page-actions">
          <button className="btn-secondary" onClick={load} disabled={loading}>
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
      </div>

      {/* Summary cards */}
      {!loading && rows.length > 0 && (
        <div style={{ display: "flex", gap: 16, margin: "0 28px 20px", flexWrap: "wrap" }}>
          <div style={{
            flex: 1, minWidth: 160, padding: "16px 20px", borderRadius: 12,
            background: "linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%)",
            color: "#fff", boxShadow: "0 4px 16px rgba(99,102,241,0.2)",
          }}>
            <div style={{ fontSize: "0.75rem", fontWeight: 600, opacity: 0.85, marginBottom: 6 }}>⚡ Auto Dispatched</div>
            <div style={{ fontSize: "2rem", fontWeight: 800 }}>{autoCount}</div>
          </div>
          <div style={{
            flex: 1, minWidth: 160, padding: "16px 20px", borderRadius: 12,
            background: "linear-gradient(135deg,#0ea5e9 0%,#06b6d4 100%)",
            color: "#fff", boxShadow: "0 4px 16px rgba(14,165,233,0.2)",
          }}>
            <div style={{ fontSize: "0.75rem", fontWeight: 600, opacity: 0.85, marginBottom: 6 }}>✋ Manual Dispatch</div>
            <div style={{ fontSize: "2rem", fontWeight: 800 }}>{manualCount}</div>
          </div>
          <div style={{
            flex: 1, minWidth: 160, padding: "16px 20px", borderRadius: 12,
            background: "linear-gradient(135deg,#10b981 0%,#059669 100%)",
            color: "#fff", boxShadow: "0 4px 16px rgba(16,185,129,0.2)",
          }}>
            <div style={{ fontSize: "0.75rem", fontWeight: 600, opacity: 0.85, marginBottom: 6 }}>📋 Total Lines</div>
            <div style={{ fontSize: "2rem", fontWeight: 800 }}>{rows.length}</div>
          </div>
        </div>
      )}

      {/* Filter bar */}
      <div className="toolbar">
        <div style={{ display: "flex", gap: 8 }}>
          {[
            { key: "all",    label: "All" },
            { key: "Auto",   label: "⚡ Auto Dispatched" },
            { key: "Manual", label: "✋ Manual" },
          ].map((f) => (
            <button
              key={f.key}
              onClick={() => setModeFilter(f.key)}
              style={{
                padding: "6px 16px",
                borderRadius: 20,
                border: "1.5px solid",
                borderColor: modeFilter === f.key ? "#6366f1" : "#e2e8f0",
                background: modeFilter === f.key ? "#6366f1" : "#fff",
                color: modeFilter === f.key ? "#fff" : "#64748b",
                fontWeight: 600,
                fontSize: "0.8rem",
                cursor: "pointer",
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <input
          type="search"
          placeholder="Search PO No, Project, Item..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: "7px 14px",
            borderRadius: 8,
            border: "1px solid #e2e8f0",
            fontSize: "0.84rem",
            minWidth: 240,
          }}
        />
      </div>

      <div className="page-content">
        {error && (
          <div className="notice error" style={{ marginBottom: 16 }}>
            <span>!</span> {error}
          </div>
        )}

        <div className="data-table-wrapper">
          {loading ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
              Loading dispatches...
            </div>
          ) : filtered.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📋</div>
              <h3>No dispatch records found</h3>
              <p>
                {modeFilter !== "all"
                  ? `No ${modeFilter} dispatch records found.`
                  : "No PO lines have been dispatched to you yet."}
              </p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>System ID</th>
                  <th>Dispatch Mode</th>
                  <th>PO No</th>
                  <th>Project</th>
                  <th>Item Code</th>
                  <th>Description</th>
                  <th style={{ textAlign: "right" }}>Qty</th>
                  <th style={{ textAlign: "right" }}>Amount (SAR)</th>
                  <th>Team</th>
                  <th>DUID</th>
                  <th>Target Month</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr
                    key={row.name}
                    style={{
                      background: row.dispatch_mode === "Auto"
                        ? "rgba(99,102,241,0.04)"
                        : undefined,
                    }}
                  >
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{row.system_id || row.name}</td>
                    <td><DispatchModeBadge mode={row.dispatch_mode || "Manual"} /></td>
                    <td>{row.po_no}</td>
                    <td>{row.project_code}</td>
                    <td>{row.item_code}</td>
                    <td style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.82rem" }}>
                      {row.item_description}
                    </td>
                    <td style={{ textAlign: "right" }}>{row.qty}</td>
                    <td style={{ textAlign: "right" }}>{fmt.format(row.line_amount || 0)}</td>
                    <td>{row.team}</td>
                    <td>{row.site_code}</td>
                    <td style={{ fontSize: "0.82rem" }}>
                      {row.target_month
                        ? new Date(row.target_month).toLocaleDateString("en", { month: "short", year: "numeric" })
                        : "—"}
                    </td>
                    <td>
                      <span className={`status-badge ${(row.dispatch_status || "pending").toLowerCase()}`}>
                        <span className="status-dot" />
                        {row.dispatch_status || "Pending"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={12} style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0" }}>
                    <strong>{filtered.length} row{filtered.length !== 1 ? "s" : ""}</strong>
                    {modeFilter === "all" && (
                      <span style={{ marginLeft: 16, color: "#6366f1", fontWeight: 600, fontSize: "0.82rem" }}>
                        ⚡ {autoCount} Auto · ✋ {manualCount} Manual
                      </span>
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
