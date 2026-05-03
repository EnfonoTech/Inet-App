import { Fragment, useEffect, useState } from "react";
import { pmApi } from "../services/api";

/**
 * Renders a small per-team breakdown table for a Rollout Plan.
 * Used by IM/PM Plan Details modals so they can see how the IM split the
 * line across teams + each team's live status.
 *
 * Props:
 *   - rolloutPlan: string (Rollout Plan name like "RPL-2026-…")
 *   - compact: boolean (smaller padding)
 */
export default function PlanTeamsBreakdown({ rolloutPlan, compact = false }) {
  const [teams, setTeams] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!rolloutPlan) { setTeams([]); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    pmApi.getRolloutPlanDetails(rolloutPlan)
      .then((res) => {
        if (cancelled) return;
        setTeams(Array.isArray(res?.teams) ? res.teams : []);
      })
      .catch(() => { if (!cancelled) setTeams([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [rolloutPlan]);

  if (loading) {
    return (
      <div style={{ fontSize: "0.78rem", color: "#94a3b8", padding: 8 }}>
        Loading teams…
      </div>
    );
  }
  if (!teams || teams.length === 0) {
    return null; // single-team plan or no team data — nothing to show
  }

  const cellPad = compact ? "4px 8px" : "6px 10px";

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#475569", marginBottom: 6, letterSpacing: 0.4 }}>
        TEAMS ({teams.length})
      </div>
      <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden", background: "#fff" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
          <thead>
            <tr style={{ background: "#f8fafc", color: "#475569", fontSize: "0.72rem", textTransform: "uppercase" }}>
              <th style={{ textAlign: "left", padding: cellPad }}>Team</th>
              <th style={{ textAlign: "right", padding: cellPad }}>Assigned</th>
              <th style={{ textAlign: "right", padding: cellPad }}>%</th>
              <th style={{ textAlign: "right", padding: cellPad }}>Achieved</th>
              <th style={{ textAlign: "left", padding: cellPad }}>TL Status</th>
            </tr>
          </thead>
          <tbody>
            {teams.map((t, i) => {
              const status = (t.tl_status || "").toLowerCase();
              const statusColor = status.includes("complete") ? "#047857"
                : status.includes("cancel") ? "#b91c1c"
                : status.includes("hold") ? "#b45309"
                : status.includes("progress") ? "#1d4ed8"
                : "#64748b";
              const remark = (t.team_lead_remark || "").trim();
              return (
                <Fragment key={i}>
                  <tr style={{ borderTop: i === 0 ? "none" : "1px solid #f1f5f9" }}>
                    <td style={{ padding: cellPad, fontWeight: 600, color: "#0f172a" }}>
                      {t.team_name || t.team || "—"}
                    </td>
                    <td style={{ padding: cellPad, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {Number(t.assigned_qty ?? 0)}
                    </td>
                    <td style={{ padding: cellPad, textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#64748b" }}>
                      {Number(t.assigned_pct ?? 0).toFixed(1)}%
                    </td>
                    <td style={{ padding: cellPad, textAlign: "right", fontVariantNumeric: "tabular-nums", color: Number(t.achieved_qty ?? 0) > 0 ? "#047857" : "#94a3b8" }}>
                      {Number(t.achieved_qty ?? 0)}
                    </td>
                    <td style={{ padding: cellPad, color: statusColor, fontWeight: 600 }}>
                      {t.tl_status || "—"}
                    </td>
                  </tr>
                  {remark && (
                    <tr style={{ background: "#fafbfc" }}>
                      <td colSpan={5} style={{ padding: `${compact ? "4px" : "6px"} ${compact ? "10px" : "14px"}`, fontSize: "0.78rem", color: "#475569", borderTop: "1px dashed #e2e8f0" }}>
                        <span style={{ fontWeight: 700, color: "#7c3aed" }}>TL remark:</span>{" "}
                        <span style={{ whiteSpace: "pre-wrap" }}>{remark}</span>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
