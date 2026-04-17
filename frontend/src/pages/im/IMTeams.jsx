import { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { pmApi } from "../../services/api";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

function statusTone(value) {
  const s = String(value || "").toLowerCase();
  if (s.includes("active") || s.includes("approved")) return { bg: "#ecfdf5", fg: "#047857" };
  if (s.includes("cancel") || s.includes("reject") || s.includes("inactive")) return { bg: "#fef2f2", fg: "#b91c1c" };
  if (s.includes("progress") || s.includes("planned")) return { bg: "#eff6ff", fg: "#1d4ed8" };
  return { bg: "#fffbeb", fg: "#b45309" };
}

function DetailItem({ label, value }) {
  const isStatus = /status|mode/i.test(label);
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

export default function IMTeams() {
  const { imName, user } = useAuth();
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [detailRow, setDetailRow] = useState(null);

  useEffect(() => {
    async function load() {
      try {
        const imCandidates = [imName, user?.full_name].filter(Boolean);
        const filters =
          imCandidates.length > 1
            ? { im: ["in", imCandidates] }
            : { im: imCandidates[0] || "__none__" };
        const rows = await pmApi.listINETTeams(filters);
        setTeams(rows || []);
      } catch {
        setTeams([]);
      }
      setLoading(false);
    }
    if (imName || user?.full_name) load();
    else setLoading(false);
  }, [imName, user?.full_name]);

  const teamTypes = [...new Set(teams.map((t) => t.team_type).filter(Boolean))].sort();

  const filtered = teams.filter((t) => {
    if (typeFilter && t.team_type !== typeFilter) return false;
    if (statusFilter && t.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        (t.team_id || "").toLowerCase().includes(q) ||
        (t.team_name || "").toLowerCase().includes(q) ||
        (t.team_type || "").toLowerCase().includes(q) ||
        (t.area || "").toLowerCase().includes(q) ||
        (t.isdp_account || "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  const hasFilters = search || typeFilter || statusFilter;
  const totalCost = filtered.reduce((s, t) => s + (t.daily_cost || 0), 0);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">My Teams</h1>
          <div className="page-subtitle">{filtered.length} teams managed by {imName}</div>
        </div>
        <div className="page-actions">
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "0.72rem", color: "#94a3b8" }}>Total Daily Cost</div>
            <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "#1e293b" }}>SAR {fmt.format(totalCost)}</div>
          </div>
        </div>
      </div>

      {/* ── Toolbar ─────────────────────────────────────────── */}
      <div className="toolbar">
        <input
          type="search"
          placeholder="Search team name, type, area…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: "7px 14px", borderRadius: 8,
            border: "1px solid #e2e8f0", fontSize: "0.84rem", minWidth: 220,
          }}
        />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem" }}
        >
          <option value="">All Types</option>
          {teamTypes.map((tt) => (
            <option key={tt} value={tt}>{tt}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem" }}
        >
          <option value="">All Status</option>
          <option value="Active">Active</option>
          <option value="Inactive">Inactive</option>
        </select>
        {hasFilters && (
          <button
            className="btn-secondary"
            style={{ fontSize: "0.78rem", padding: "5px 12px" }}
            onClick={() => { setSearch(""); setTypeFilter(""); setStatusFilter(""); }}
          >
            Clear
          </button>
        )}
      </div>

      <div className="page-content">
        <div className="data-table-wrapper">
          {loading ? (
            <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">👥</div>
              <h3>{hasFilters ? "No results match your filters" : "No teams assigned"}</h3>
              {hasFilters && <p>Try adjusting your search or filter criteria.</p>}
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Team</th>
                  <th>Type</th>
                  <th>Area</th>
                  <th>ISDP Account</th>
                  <th>Status</th>
                  <th style={{ textAlign: "right" }}>Daily Cost</th>
                  <th>View</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => (
                  <tr key={t.name}>
                    <td style={{ fontWeight: 600 }}>{t.team_name || "—"}</td>
                    <td>{t.team_type}</td>
                    <td>{t.area || "—"}</td>
                    <td style={{ fontSize: "0.82rem" }}>{t.isdp_account || "—"}</td>
                    <td>
                      <span className={`status-badge ${t.status === "Active" ? "completed" : "cancelled"}`}>
                        <span className="status-dot" />
                        {t.status}
                      </span>
                    </td>
                    <td style={{ textAlign: "right", fontWeight: 600 }}>{fmt.format(t.daily_cost || 0)}</td>
                    <td>
                      <button type="button" className="btn-secondary" style={{ fontSize: "0.72rem", padding: "4px 10px" }} onClick={() => setDetailRow(t)}>
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={6} style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", fontWeight: 700, fontSize: "0.78rem" }}>
                    {filtered.length}{hasFilters && ` of ${teams.length}`} teams
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 700, padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0" }}>
                    SAR {fmt.format(totalCost)}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
      {detailRow && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setDetailRow(null)}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 20, width: "min(860px, 94vw)", maxHeight: "78vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ margin: 0, fontSize: "1rem" }}>Team Details</h3>
              <button type="button" onClick={() => setDetailRow(null)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8" }}>&times;</button>
            </div>
            <div style={{ maxHeight: "65vh", overflow: "auto", background: "#f8fafc", borderRadius: 8, padding: 12 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                <div style={{ border: "1px solid #bfdbfe", background: "#eff6ff", color: "#1d4ed8", borderRadius: 999, padding: "4px 10px", fontSize: 12, fontWeight: 700 }}>
                  Team: {detailRow.team_name || "—"}
                </div>
                <div style={{ border: "1px solid #a7f3d0", background: "#ecfdf5", color: "#047857", borderRadius: 999, padding: "4px 10px", fontSize: 12, fontWeight: 700 }}>
                  Area: {detailRow.area || "—"}
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                {Object.entries(detailRow)
                  .filter(([k]) => k !== "team_id" && k !== "team_name")
                  .map(([k, v]) => (
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
