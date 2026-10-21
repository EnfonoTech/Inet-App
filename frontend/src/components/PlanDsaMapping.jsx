import { useCallback, useEffect, useState } from "react";
import { pmApi } from "../services/api";

/**
 * DSA / MSA on one Rollout Plan — the temporary flow while Material
 * Management is unused. See docs/DSA_MAPPING.md.
 *
 * Renders NOTHING unless the backend says the box is offered. Off by
 * setting, and absent on a plan with `ciag_required = 0`: no CIAG means no
 * material was used, so there is no DSA to map and an empty box would only
 * invite someone to look for one.
 *
 * There is no "close" button here on purpose. CIAG is the closure — the
 * same gate `get_site_verify_status` reports on — so the state is read off
 * the execution rather than stored a second time beside it.
 *
 * ``recordOnly`` drops the candidate pool and shows just what is mapped,
 * with the closing date once CIAG is approved. That is the shape wanted
 * where the DSA is context rather than the task -- the Set CIAG dialog,
 * where approving is what closes it.
 *
 * The candidate list is scoped server-side to the IM's own sites and then
 * to this plan's DUID, which on the production copy leaves 1 DSA on 1,082
 * of 1,274 plans and 3 at worst. That is why this is a short list of
 * checkboxes and not a search.
 */
// "8:30:00" from the DB is not a value <input type="time"> accepts -- it
// renders blank rather than complaining, which reads as "no pickup set".
function timeInputValue(t) {
  if (!t) return "";
  const [h, m] = String(t).split(":");
  if (h === undefined || m === undefined) return "";
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export default function PlanDsaMapping({ rolloutPlan, readOnly = false, recordOnly = false }) {
  const [state, setState] = useState(null);
  const [mapped, setMapped] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    if (!rolloutPlan) { setState(null); setMapped(null); return; }
    Promise.all([
      pmApi.listDsaCandidates(rolloutPlan, true),
      pmApi.getPlanDsas(rolloutPlan),
    ])
      .then(([cand, mine]) => { setState(cand || null); setMapped(mine || null); })
      .catch((e) => setError(e.message || "Could not load DSA information"));
  }, [rolloutPlan]);

  useEffect(() => { setError(null); load(); }, [load]);

  if (!state || !state.offered) return null;

  const pool = state.rows || [];
  const mappedRows = mapped?.rows || [];
  const chosen = new Set(mappedRows.map((r) => r.outbound_plan));
  const mine = (outboundPlan) => mappedRows.find((r) => r.outbound_plan === outboundPlan);
  const closed = !!mapped?.closed;

  // The pool is what may still be CHOSEN; what is mapped is the RECORD, and
  // the two are not the same list. A signed-off DSA leaves the pool by
  // design, so reading the box off the pool alone made a closed plan say
  // "No DSA recorded" over the very DSA it consumed. Record first, then
  // whatever is still on offer -- and on a closed plan, the record only.
  const poolByName = new Map(pool.map((c) => [c.name, c]));
  const rows = [
    ...mappedRows.map((r) => poolByName.get(r.outbound_plan) || {
      name: r.outbound_plan,
      bill_no: r.bill_no,
      request_no: r.request_no,
      outbound_status: r.outbound_status,
      outbound_date: r.outbound_date,
      project_name: r.project_name,
      mapped_on: [],
    }),
    ...((closed || recordOnly) ? [] : pool.filter((c) => !chosen.has(c.name))),
  ];
  const frozen = readOnly || recordOnly || closed;
  const closedOn = mapped?.ciag_status_date ? String(mapped.ciag_status_date).slice(0, 10) : "";

  // Pickup travels with the selection: set_plan_dsas replaces the whole
  // set, so anything already entered has to be sent again or it is lost.
  function frozenGuard() { return readOnly || recordOnly || closed || busy; }

  function pickupMap(extra) {
    const out = {};
    for (const r of (mapped?.rows || [])) {
      if (r.pickup_date || r.pickup_time) {
        out[r.outbound_plan] = { pickup_date: r.pickup_date || "", pickup_time: r.pickup_time || "" };
      }
    }
    return { ...out, ...(extra || {}) };
  }

  async function save(names, extraPickup) {
    setBusy(true);
    setError(null);
    try {
      const res = await pmApi.setPlanDsas(rolloutPlan, names, pickupMap(extraPickup));
      setMapped(res);
      const cand = await pmApi.listDsaCandidates(rolloutPlan, true);
      setState(cand);
    } catch (e) {
      setError(e.message || "Could not save");
    } finally {
      setBusy(false);
    }
  }

  function setPickup(outboundPlan, field, value) {
    if (frozenGuard()) return;
    const row = (mapped?.rows || []).find((r) => r.outbound_plan === outboundPlan) || {};
    save(Array.from(chosen), {
      [outboundPlan]: {
        pickup_date: field === "pickup_date" ? value : (row.pickup_date || ""),
        pickup_time: field === "pickup_time" ? value : (row.pickup_time || ""),
      },
    });
  }

  async function toggle(name) {
    if (frozenGuard()) return;
    const next = new Set(chosen);
    if (next.has(name)) next.delete(name); else next.add(name);
    setBusy(true);
    setError(null);
    try {
      const res = await pmApi.setPlanDsas(rolloutPlan, Array.from(next), pickupMap());
      setMapped(res);
      // A newly mapped DSA leaves the pool for other plans, and a freed one
      // rejoins it, so the list itself has to be re-read.
      const cand = await pmApi.listDsaCandidates(rolloutPlan, true);
      setState(cand);
    } catch (e) {
      setError(e.message || "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "#334155", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Material (DSA)
        </span>
        {closed && (
          <span title="CIAG approval is what closes a DSA — there is no separate close step."
                style={{ fontSize: "0.66rem", fontWeight: 700, color: "#047857", background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 999, padding: "1px 7px" }}>
            Closed · CIAG approved{closedOn ? ` ${closedOn}` : ""}
          </span>
        )}
        {!closed && mapped?.ciag_status && (
          <span style={{ fontSize: "0.66rem", fontWeight: 700, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 999, padding: "1px 7px" }}>
            CIAG {mapped.ciag_status}
          </span>
        )}
      </div>

      {error && <div className="notice error" style={{ marginBottom: 8 }}><span>!</span> {error}</div>}

      {recordOnly && !closed && rows.length > 0 && (
        <div style={{ fontSize: "0.74rem", color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 7, padding: "6px 9px", marginBottom: 8 }}>
          Approving CIAG closes {rows.length > 1 ? "these DSAs" : "this DSA"}.
        </div>
      )}

      {rows.length === 0 ? (
        <div style={{ color: "#94a3b8", fontSize: "0.82rem" }}>
          {closed ? "No DSA was mapped to this site before CIAG approval."
                  : "No DSA recorded for this site."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {rows.map((r) => {
            const on = chosen.has(r.name);
            const elsewhere = (r.mapped_on || []).filter((p) => p && p !== rolloutPlan);
            return (
              <label key={r.name}
                     style={{
                       display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 10px",
                       border: `1px solid ${on ? "#bfdbfe" : "#e2e8f0"}`, borderRadius: 8,
                       background: on ? "#eff6ff" : "#fff",
                       cursor: frozen ? "default" : "pointer",
                       opacity: busy ? 0.6 : 1,
                     }}>
                <input type="checkbox" checked={on} disabled={frozen || busy}
                       onChange={() => toggle(r.name)} style={{ marginTop: 2 }} />
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ fontFamily: "monospace", fontSize: "0.78rem", fontWeight: 700 }}>{r.bill_no}</span>
                  <span style={{ fontSize: "0.74rem", color: "#64748b" }}>
                    {"  MSA "}{r.request_no || "—"}
                  </span>
                  <div style={{ fontSize: "0.72rem", color: "#94a3b8", marginTop: 2 }}>
                    {[r.outbound_status, r.outbound_date ? String(r.outbound_date).slice(0, 10) : null,
                      r.project_name].filter(Boolean).join(" · ") || "—"}
                    {elsewhere.length > 0 && (
                      <span title={`Also mapped on ${elsewhere.join(", ")}`}
                            style={{ color: "#b45309", marginLeft: 6 }}>
                        · also on {elsewhere.length} other plan{elsewhere.length > 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                  {on && !recordOnly && (
                    <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}
                         onClick={(e) => e.preventDefault()}>
                      <label style={{ fontSize: "0.7rem", color: "#64748b", display: "flex", alignItems: "center", gap: 4 }}>
                        Pickup
                        <input type="date" disabled={frozen || busy}
                               value={(mine(r.name)?.pickup_date || "").slice(0, 10)}
                               onChange={(e) => setPickup(r.name, "pickup_date", e.target.value)}
                               style={{ padding: "3px 6px", fontSize: "0.72rem", border: "1px solid #e2e8f0", borderRadius: 5 }} />
                      </label>
                      <label style={{ fontSize: "0.7rem", color: "#64748b", display: "flex", alignItems: "center", gap: 4 }}>
                        at
                        <input type="time" disabled={frozen || busy}
                               value={timeInputValue(mine(r.name)?.pickup_time)}
                               onChange={(e) => setPickup(r.name, "pickup_time", e.target.value)}
                               style={{ padding: "3px 6px", fontSize: "0.72rem", border: "1px solid #e2e8f0", borderRadius: 5 }} />
                      </label>
                    </div>
                  )}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
