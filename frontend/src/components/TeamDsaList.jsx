import { useEffect, useState } from "react";
import { pmApi } from "../services/api";

/**
 * The DSAs a field team has to collect — see docs/DSA_MAPPING.md.
 *
 * Read-only. The team sees a DSA because one of THEIR plans was mapped to
 * it; they never see the outbound table and never another team's material.
 *
 * Renders nothing when the feature is off or there is nothing mapped, so
 * it can sit on a page unconditionally without adding an empty heading.
 *
 * Pass `rolloutPlan` for one plan (the execution form) or `team` for the
 * team's window around today.
 *
 * `showPickup` is off on the execution form: by the time someone is filling
 * that in they are on site, so WHEN to collect is behind them. Collection
 * belongs on My Stock's Awaiting tab, which is the list of things still to
 * fetch — and that list carries both Material Requests and DSAs through
 * one card, so a single pickup line means the same thing either way.
 */
export default function TeamDsaList({ team, rolloutPlan, title = "Material (DSA)", compact = false, showPickup = true }) {
  const [rows, setRows] = useState(null);

  useEffect(() => {
    if (!team && !rolloutPlan) { setRows(null); return; }
    let dead = false;
    pmApi.listTeamDsas(rolloutPlan ? { rollout_plan: rolloutPlan } : { team })
      .then((res) => { if (!dead) setRows(res?.enabled ? (res.rows || []) : null); })
      .catch(() => { if (!dead) setRows(null); });
    return () => { dead = true; };
  }, [team, rolloutPlan]);

  if (!rows || rows.length === 0) return null;

  return (
    <div style={{ marginTop: compact ? 12 : 20 }}>
      <div style={{ fontSize: "0.74rem", fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>
        {title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {rows.map((r) => (
          <div key={r.row_name}
               style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px",
                        background: r.closed ? "#f8fafc" : "#fff" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
              <span>
                <span style={{ fontFamily: "ui-monospace, monospace", fontSize: "0.8rem", fontWeight: 700 }}>{r.bill_no}</span>
                <span style={{ fontSize: "0.73rem", color: "#64748b" }}>{"  MSA "}{r.request_no || "—"}</span>
              </span>
              {r.closed ? (
                <span style={{ fontSize: "0.68rem", fontWeight: 700, color: "#047857", background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 999, padding: "1px 7px" }}>Closed</span>
              ) : (
                <span style={{ fontSize: "0.68rem", fontWeight: 700, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 999, padding: "1px 7px" }}>
                  CIAG {r.ciag_status || "Open"}
                </span>
              )}
            </div>
            {showPickup && (r.pickup_date || r.pickup_time) && (
              <div style={{ fontSize: "0.74rem", color: "#1d4ed8", fontWeight: 600, marginTop: 3 }}>
                Pickup {r.pickup_date ? String(r.pickup_date).slice(0, 10) : ""}
                {r.pickup_time ? ` at ${String(r.pickup_time).slice(0, 5)}` : ""}
              </div>
            )}
            <div style={{ fontSize: "0.71rem", color: "#94a3b8", marginTop: 2 }}>
              {[r.du_id || r.site_code, r.outbound_status,
                !rolloutPlan && r.plan_date ? `plan ${String(r.plan_date).slice(0, 10)}` : null,
                !rolloutPlan && r.poid ? r.poid : null].filter(Boolean).join(" · ")}
            </div>
            {r.remark && (
              <div style={{ fontSize: "0.72rem", color: "#64748b", marginTop: 2 }}>{r.remark}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
