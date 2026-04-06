import { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

export default function IMTeams() {
  const { imName } = useAuth();
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(
          `/api/resource/INET Team?filters=${encodeURIComponent(JSON.stringify([["im","=",imName]]))}` +
          `&fields=${encodeURIComponent(JSON.stringify(["name","team_id","team_name","team_type","status","daily_cost","area"]))}` +
          `&limit_page_length=100&order_by=team_id+asc`,
          { credentials: "include" }
        );
        const json = await res.json();
        setTeams(json?.data || []);
      } catch { setTeams([]); }
      setLoading(false);
    }
    if (imName) load();
  }, [imName]);

  const totalCost = teams.reduce((s, t) => s + (t.daily_cost || 0), 0);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">My Teams</h1>
          <div className="page-subtitle">{teams.length} teams managed by {imName}</div>
        </div>
        <div className="page-actions">
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "0.72rem", color: "#94a3b8" }}>Total Daily Cost</div>
            <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "#1e293b" }}>SAR {fmt.format(totalCost)}</div>
          </div>
        </div>
      </div>
      <div className="page-content">
        <div className="data-table-wrapper">
          {loading ? (
            <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Loading...</div>
          ) : teams.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">👥</div>
              <h3>No teams assigned</h3>
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
                {teams.map((t) => (
                  <tr key={t.name}>
                    <td style={{ fontFamily: "monospace" }}>{t.team_id}</td>
                    <td style={{ fontWeight: 600 }}>{t.team_name}</td>
                    <td>{t.team_type}</td>
                    <td>{t.area || "-"}</td>
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
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
