import { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { pmApi } from "../../services/api";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

export default function IMTeams() {
  const { imName, user } = useAuth();
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

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
        (t.area || "").toLowerCase().includes(q)
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
          placeholder="Search Team ID, Name, Area…"
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
                  <th>Team ID</th>
                  <th>Team Name</th>
                  <th>Type</th>
                  <th>Area</th>
                  <th>Status</th>
                  <th style={{ textAlign: "right" }}>Daily Cost</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => (
                  <tr key={t.name}>
                    <td style={{ fontFamily: "monospace" }}>{t.team_id}</td>
                    <td style={{ fontWeight: 600 }}>{t.team_name}</td>
                    <td>{t.team_type}</td>
                    <td>{t.area || "—"}</td>
                    <td>
                      <span className={`status-badge ${t.status === "Active" ? "completed" : "cancelled"}`}>
                        <span className="status-dot" />
                        {t.status}
                      </span>
                    </td>
                    <td style={{ textAlign: "right", fontWeight: 600 }}>{fmt.format(t.daily_cost || 0)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5} style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", fontWeight: 700, fontSize: "0.78rem" }}>
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
    </div>
  );
}
