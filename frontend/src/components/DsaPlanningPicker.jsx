import { useCallback, useEffect, useState } from "react";
import { pmApi } from "../services/api";

/**
 * Picking DSAs while PLANNING — shared by every screen that creates
 * rollout plans. See docs/DSA_MAPPING.md.
 *
 * There is more than one planning form in this app (Rollout Planning, the
 * PM's copy, Close Remainder, and Issues & Risks on both sides), and they
 * do NOT share a component — Issues & Risks hand-rolls its own. So this
 * lives here, as a hook plus the UI it drives, and each form wires the
 * same two lines rather than growing its own version of the picker.
 *
 *   const dsa = useDsaPlanning({ open, enabled: ciagRequired, dispatchNames });
 *   <DsaPlanningPicker state={dsa} />
 *   ... after creating the plans ...
 *   await dsa.mapToPlans(result?.names);
 *
 * Grouped per DUID because a DSA belongs to a site and planning several
 * sites together is the normal case — the same shape the material
 * dispatch panel uses. One pickup pair covers the whole selection, again
 * matching dispatch.
 */
export function useDsaPlanning({ open, enabled, dispatchNames }) {
  const [info, setInfo] = useState(null);
  const [picked, setPicked] = useState({});
  const [openDuid, setOpenDuid] = useState("");
  const [pickupDate, setPickupDate] = useState("");
  const [pickupTime, setPickupTime] = useState("");

  const key = (dispatchNames || []).filter(Boolean).join(",");

  useEffect(() => {
    // No CIAG means no material was used, so there is no DSA to map.
    if (!open || !enabled || !key) { setInfo(null); setPicked({}); return; }
    let dead = false;
    pmApi.listDsaForDispatches(key.split(","))
      .then((res) => { if (!dead) setInfo(res || null); })
      .catch(() => { if (!dead) setInfo(null); });
    return () => { dead = true; };
  }, [open, enabled, key]);

  // Attach after the plans exist. Which plan belongs to which site is
  // resolved server-side — create_rollout_plans returns a flat list of
  // names, and guessing the pairing here would be guessing.
  const mapToPlans = useCallback(async (planNames) => {
    const anyPicked = Object.values(picked).some((v) => (v || []).length);
    if (!anyPicked || !Array.isArray(planNames) || !planNames.length) return;
    try {
      const pickup = {};
      if (pickupDate || pickupTime) {
        for (const [duid, names] of Object.entries(picked)) {
          pickup[duid] = {};
          for (const n of (names || [])) {
            pickup[duid][n] = { pickup_date: pickupDate, pickup_time: pickupTime };
          }
        }
      }
      await pmApi.mapDsasToPlans(planNames, picked, pickup);
    } catch (e) {
      // The plans exist; a failed mapping must not read as failed
      // planning. It is re-doable on Rollout Execution.
      console.warn("DSA mapping failed", e);
    }
  }, [picked, pickupDate, pickupTime]);

  return { info, picked, setPicked, openDuid, setOpenDuid,
           pickupDate, setPickupDate, pickupTime, setPickupTime, mapToPlans };
}

export default function DsaPlanningPicker({ state }) {
  const { info, picked, setPicked, openDuid, setOpenDuid,
          pickupDate, setPickupDate, pickupTime, setPickupTime } = state || {};
  // Silence is ambiguous: an IM who sees nothing cannot tell "this site
  // has no DSA" from "this screen does not do DSAs". One muted line,
  // only once the backend has actually answered for a real selection.
  if (info?.enabled && !info?.offered && (info?.groups || []).length > 0) {
    return (
      <div style={{ fontSize: "0.76rem", color: "#94a3b8", border: "1px dashed #e2e8f0", borderRadius: 8, padding: "8px 12px", marginBottom: 16 }}>
        <strong style={{ color: "#64748b", fontWeight: 700 }}>MATERIAL (DSA)</strong>
        {" \u00b7 "}
        {(info.groups || []).some((g) => g.note)
          ? info.groups.find((g) => g.note).note
          : `No DSA recorded for ${info.groups.length > 1 ? "these sites" : "this site"}.`}
      </div>
    );
  }
  if (!info?.offered) return null;

  return (
    <div style={{ background: "#fafbfc", border: "1px solid #e5e7eb", borderRadius: 8, padding: 12, marginBottom: 16 }}>
      <div style={{ fontSize: "0.74rem", fontWeight: 700, color: "#475569", marginBottom: 8 }}>MATERIAL (DSA)</div>
      <div style={{ display: "flex", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 140px" }}>
          <label style={{ display: "block", fontSize: "0.72rem", fontWeight: 600, color: "#64748b", marginBottom: 3 }}>Pickup Date</label>
          <input type="date" value={pickupDate} onChange={(e) => setPickupDate(e.target.value)}
            style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #e2e8f0", fontSize: "0.82rem", boxSizing: "border-box" }} />
        </div>
        <div style={{ flex: "1 1 140px" }}>
          <label style={{ display: "block", fontSize: "0.72rem", fontWeight: 600, color: "#64748b", marginBottom: 3 }}>Pickup Time</label>
          <input type="time" value={pickupTime} onChange={(e) => setPickupTime(e.target.value)}
            style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #e2e8f0", fontSize: "0.82rem", boxSizing: "border-box" }} />
        </div>
      </div>

      {(info.groups || []).map((g) => {
        const mine = picked[g.duid] || [];
        const expanded = openDuid === g.duid;
        const available = (g.rows || []).length;
        return (
          <div key={g.duid} style={{ border: "1px solid #e2e8f0", borderRadius: 8, marginBottom: 8, overflow: "hidden", opacity: available === 0 ? 0.7 : 1 }}>
            <button type="button" onClick={() => setOpenDuid(expanded ? "" : g.duid)}
              style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: "#fff", border: "none", cursor: "pointer", textAlign: "left" }}>
              <span style={{ minWidth: 0 }}>
                <span style={{ fontSize: "0.82rem", fontWeight: 600, fontFamily: "ui-monospace, monospace" }}>{g.duid}</span>
                <span style={{ fontSize: "0.72rem", color: "#94a3b8", marginLeft: 8 }}>{g.count} line{g.count !== 1 ? "s" : ""}</span>
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {mine.length > 0 && (
                  <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#1d4ed8", background: "#eff6ff", padding: "2px 8px", borderRadius: 999 }}>
                    {mine.length} DSA{mine.length !== 1 ? "s" : ""} selected
                  </span>
                )}
                {/* "0 available" read as a quantity of something. A site
                    with nothing to collect says so in words. */}
                <span style={{ fontSize: "0.72rem", color: "#94a3b8" }}>
                  {g.note || (available === 0 ? "No DSA" : `${available} available`)}
                </span>
                <span style={{ color: "#94a3b8" }}>{expanded ? "▲" : "▼"}</span>
              </span>
            </button>
            {expanded && (
              <div style={{ padding: "8px 12px", borderTop: "1px solid #f1f5f9", display: "flex", flexDirection: "column", gap: 6 }}>
                {available === 0 ? (
                  <div style={{ fontSize: "0.78rem", color: "#94a3b8" }}>
                    {g.note || "No DSA recorded for this site."}
                  </div>
                ) : g.rows.map((d) => {
                  const on = mine.includes(d.name);
                  return (
                    <label key={d.name}
                           style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "7px 9px",
                                    border: `1px solid ${on ? "#bfdbfe" : "#e2e8f0"}`, borderRadius: 6,
                                    background: on ? "#eff6ff" : "#fff", cursor: "pointer" }}>
                      <input type="checkbox" checked={on} style={{ marginTop: 2 }}
                             onChange={() => setPicked((cur) => {
                               const was = cur[g.duid] || [];
                               const next = was.includes(d.name)
                                 ? was.filter((x) => x !== d.name) : [...was, d.name];
                               return { ...cur, [g.duid]: next };
                             })} />
                      <span style={{ minWidth: 0 }}>
                        <span style={{ fontFamily: "monospace", fontSize: "0.78rem", fontWeight: 700 }}>{d.bill_no}</span>
                        <span style={{ fontSize: "0.73rem", color: "#64748b" }}>{"  MSA "}{d.request_no || "—"}</span>
                        {/* The date is labelled. Unlabelled, "Received ·
                            2026-08-13" left the reader guessing which
                            date it was. */}
                        <div style={{ fontSize: "0.71rem", color: "#94a3b8", marginTop: 1 }}>
                          {[d.outbound_status,
                            d.outbound_date ? `Outbound ${String(d.outbound_date).slice(0, 10)}` : null,
                          ].filter(Boolean).join(" · ")}
                          {(d.mapped_on || []).length > 0 && (
                            <span style={{ color: "#b45309" }}> · already on {d.mapped_on.length} plan{d.mapped_on.length > 1 ? "s" : ""}</span>
                          )}
                        </div>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
