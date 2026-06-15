import { useEffect, useState } from "react";
import { pmApi } from "../services/api";

/**
 * Workflow #2 — POID stays unique to one active plan but can have
 * many sequential visits over time (Visit 1, 2, 3, …). This component
 * lists every visit for a single POID so the IM/PM can see the full
 * attempt history from the plan / execution detail modal.
 *
 * Props:
 *   - poDispatch?: string (PO Dispatch name)
 *   - rolloutPlan?: string (any plan for the POID — backend resolves
 *     the dispatch from this if poDispatch is omitted)
 *   - currentPlanName?: string (highlight this row)
 */
export default function DispatchVisitHistory({ poDispatch, rolloutPlan, currentPlanName }) {
  const [visits, setVisits] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!poDispatch && !rolloutPlan) {
      setVisits([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    pmApi.listDispatchVisits(poDispatch || "", rolloutPlan || "")
      .then((res) => { if (!cancelled) setVisits(Array.isArray(res) ? res : []); })
      .catch(() => { if (!cancelled) setVisits([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [poDispatch, rolloutPlan]);

  if (loading) {
    return (
      <div style={{ fontSize: "0.78rem", color: "#94a3b8", padding: 8 }}>
        Loading visits…
      </div>
    );
  }
  if (!visits || visits.length <= 1) {
    // 0 = no data; 1 = single-visit POID (no history worth showing).
    return null;
  }

  const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#475569", marginBottom: 6, letterSpacing: 0.4 }}>
        VISITS FOR THIS POID ({visits.length})
      </div>
      <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden", background: "#fff" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
          <thead>
            <tr style={{ background: "#f8fafc", color: "#475569", fontSize: "0.72rem", textTransform: "uppercase" }}>
              <th style={{ textAlign: "left", padding: "6px 10px" }}>Visit</th>
              <th style={{ textAlign: "left", padding: "6px 10px" }}>Plan</th>
              <th style={{ textAlign: "left", padding: "6px 10px" }}>Date</th>
              <th style={{ textAlign: "left", padding: "6px 10px" }}>Team</th>
              <th style={{ textAlign: "left", padding: "6px 10px" }}>Status</th>
              <th style={{ textAlign: "right", padding: "6px 10px" }}>Target</th>
              <th style={{ textAlign: "left", padding: "6px 10px" }}>WD</th>
            </tr>
          </thead>
          <tbody>
            {visits.map((v, i) => {
              const status = (v.plan_status || "").toLowerCase();
              const statusColor = status === "completed" ? "#047857"
                : status === "cancelled" ? "#b91c1c"
                : status === "in execution" ? "#1d4ed8"
                : status === "planning with issue" ? "#b45309"
                : "#64748b";
              const isCurrent = currentPlanName && v.name === currentPlanName;
              return (
                <tr key={v.name || i} style={{
                  borderTop: i === 0 ? "none" : "1px solid #f1f5f9",
                  background: isCurrent ? "#eff6ff" : (v.is_current ? "#fff" : "#fafbfc"),
                }}>
                  <td style={{ padding: "6px 10px", fontWeight: 700, color: "#0f172a" }}>
                    #{v.visit_number}
                    {v.is_current && (
                      <span style={{ marginLeft: 6, fontSize: "0.66rem", padding: "1px 6px", borderRadius: 999, background: "#dcfce7", color: "#15803d", fontWeight: 700 }}>
                        Current
                      </span>
                    )}
                  </td>
                  <td style={{ padding: "6px 10px", fontFamily: "ui-monospace, monospace", fontSize: "0.74rem" }}>
                    {v.name || "—"}
                  </td>
                  <td style={{ padding: "6px 10px", fontSize: "0.78rem", color: "#475569" }}>
                    {v.plan_date || "—"}
                  </td>
                  <td style={{ padding: "6px 10px", fontSize: "0.78rem" }}>
                    {v.team_name || v.team || "—"}
                  </td>
                  <td style={{ padding: "6px 10px", color: statusColor, fontWeight: 600, fontSize: "0.78rem" }}>
                    {v.plan_status || "—"}
                    {v.issue_category ? (
                      <span style={{ marginLeft: 6, fontSize: "0.68rem", color: "#b45309" }}>
                        ({v.issue_category})
                      </span>
                    ) : null}
                  </td>
                  <td style={{ padding: "6px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {fmt.format(Number(v.target_amount || 0))}
                  </td>
                  <td style={{ padding: "6px 10px", fontSize: "0.74rem", fontFamily: "ui-monospace, monospace" }}>
                    {v.work_done ? (
                      <span style={{ color: "#047857" }}>{v.work_done}</span>
                    ) : (
                      <span style={{ color: "#94a3b8" }}>—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
