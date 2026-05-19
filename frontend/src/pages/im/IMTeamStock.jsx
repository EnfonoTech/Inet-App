import { useEffect, useState } from "react";
import { pmApi } from "../../services/api";

export default function IMTeamStock() {
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState({});

  useEffect(() => {
    setLoading(true);
    pmApi.getTeamMaterialStock()
      .then(data => { setTeams(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  function toggleTeam(teamId) {
    setExpanded(prev => ({ ...prev, [teamId]: !prev[teamId] }));
  }

  const totalTeams = teams.length;
  const teamsWithStock = teams.filter(t => t.items?.length > 0).length;

  return (
    <div className="page-wrapper" style={{ maxWidth: 900, margin: "0 auto", padding: "0 16px 40px" }}>
      <div className="page-header" style={{ marginBottom: 20 }}>
        <div>
          <h1 className="page-title">Team Material Stock</h1>
          <div className="page-subtitle">Current warehouse stock for all teams</div>
        </div>
      </div>

      {/* Summary chips */}
      {!loading && (
        <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
          <div style={{ padding: "8px 16px", background: "#eff6ff", borderRadius: 8, fontSize: 13 }}>
            <strong style={{ color: "#1d4ed8" }}>{totalTeams}</strong>
            <span style={{ color: "#64748b", marginLeft: 6 }}>Teams</span>
          </div>
          <div style={{ padding: "8px 16px", background: "#ecfdf5", borderRadius: 8, fontSize: 13 }}>
            <strong style={{ color: "#047857" }}>{teamsWithStock}</strong>
            <span style={{ color: "#64748b", marginLeft: 6 }}>Have Stock</span>
          </div>
          <div style={{ padding: "8px 16px", background: "#fef9c3", borderRadius: 8, fontSize: 13 }}>
            <strong style={{ color: "#92400e" }}>{totalTeams - teamsWithStock}</strong>
            <span style={{ color: "#64748b", marginLeft: 6 }}>No Stock</span>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ color: "#64748b", padding: 24, textAlign: "center" }}>Loading…</div>
      ) : teams.length === 0 ? (
        <div style={{ color: "#64748b", padding: 24, textAlign: "center" }}>No teams found.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {teams.map(team => {
            const open = !!expanded[team.team_id];
            const hasItems = team.items?.length > 0;
            return (
              <div key={team.team_id} style={{
                border: "1px solid #e2e8f0", borderRadius: 10,
                background: "#fff", overflow: "hidden",
              }}>
                {/* Header row */}
                <button
                  type="button"
                  onClick={() => toggleTeam(team.team_id)}
                  style={{
                    width: "100%", textAlign: "left",
                    padding: "12px 16px",
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    background: "none", border: "none", cursor: "pointer",
                    borderBottom: open ? "1px solid #e2e8f0" : "none",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14, color: "#0f172a" }}>
                        {team.team_name || team.team_id}
                      </div>
                      <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                        {team.warehouse || "No warehouse"}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{
                      padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700,
                      background: hasItems ? "#ecfdf5" : "#f1f5f9",
                      color: hasItems ? "#047857" : "#64748b",
                    }}>
                      {hasItems ? `${team.items.length} item${team.items.length > 1 ? "s" : ""}` : "No stock"}
                    </span>
                    <span style={{ color: "#94a3b8", fontSize: 14 }}>{open ? "▲" : "▼"}</span>
                  </div>
                </button>

                {/* Items table */}
                {open && (
                  <div style={{ padding: "0 16px 12px" }}>
                    {!hasItems ? (
                      <div style={{ color: "#94a3b8", fontSize: 13, padding: "12px 0" }}>
                        No items in stock.
                      </div>
                    ) : (
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginTop: 8 }}>
                        <thead>
                          <tr>
                            <th style={{ textAlign: "left", padding: "6px 8px", color: "#64748b", borderBottom: "1px solid #f1f5f9", fontWeight: 600 }}>Item</th>
                            <th style={{ textAlign: "right", padding: "6px 8px", color: "#64748b", borderBottom: "1px solid #f1f5f9", fontWeight: 600 }}>Qty</th>
                            <th style={{ textAlign: "left", padding: "6px 8px", color: "#64748b", borderBottom: "1px solid #f1f5f9", fontWeight: 600 }}>UOM</th>
                          </tr>
                        </thead>
                        <tbody>
                          {team.items.map((it, i) => (
                            <tr key={it.item_code} style={{ background: i % 2 === 0 ? "#fff" : "#f8fafc" }}>
                              <td style={{ padding: "6px 8px", color: "#334155" }}>
                                <div style={{ fontWeight: 500 }}>{it.item_name || it.item_code}</div>
                                <div style={{ fontSize: 11, color: "#94a3b8" }}>{it.item_code}</div>
                              </td>
                              <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 700, color: "#0f172a" }}>
                                {Number(it.qty).toLocaleString()}
                              </td>
                              <td style={{ padding: "6px 8px", color: "#64748b" }}>{it.uom}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
