import { useEffect, useMemo, useState } from "react";
import { pmApi } from "../services/api";
import RolloutPlanModal from "./RolloutPlanModal";
import { money, qty as qtyFmt } from "../utils/numberFormat";

/**
 * Close the outstanding quantity on a line that was confirmed short.
 *
 * The route is not a choice: a POID keeps ONE Work Done for its whole life,
 * and the backend only accepts a further closure through the route that closed
 * it first ("this line was closed by Rollout Execution. Close the remaining
 * 0.5 the same way"). So the form shows the matching shape and nothing else —
 * offering three buttons where two always fail would be a menu of mistakes.
 *
 *   Rollout Execution -> plan the remainder (team, dates, access, visit type)
 *   Direct Close      -> close it directly (milestone, optional subcontractor)
 *   Backend           -> hand it to a backend team
 */

const L = {
  fontSize: "0.72rem", fontWeight: 700, color: "#475569",
  textTransform: "uppercase", letterSpacing: "0.04em",
  display: "block", marginBottom: 4,
};
const F = {
  padding: 8, width: "100%", border: "1px solid #e2e8f0",
  borderRadius: 6, fontSize: "0.86rem", boxSizing: "border-box",
};

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function CloseRemainderModal({ row, onClose, onDone }) {
  const source = (row?.source || "").trim();
  const outstanding = Number(row?.remaining_qty) || 0;
  const ordered = Number(row?.ordered_qty) || 0;
  const rate = Number(row?.rate) || 0;

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [teams, setTeams] = useState([]);
  const [note, setNote] = useState("");

  // rollout
  const [team, setTeam] = useState("");
  const [startDate, setStartDate] = useState(todayISO());
  const [endDate, setEndDate] = useState(todayISO());
  const [accessTime, setAccessTime] = useState("09:00:00");
  const [accessPeriod, setAccessPeriod] = useState("Day");
  const [visitType, setVisitType] = useState("Re-Visit");
  // direct close
  const [milestone, setMilestone] = useState("full");
  const [closeType, setCloseType] = useState("INET");
  const [subcontractor, setSubcontractor] = useState("");
  const [subcons, setSubcons] = useState([]);
  const [huaweiIms, setHuaweiIms] = useState([]);
  const [projectDomains, setProjectDomains] = useState([]);

  useEffect(() => {
    if (!row) return;
    setErr(null);
    if (source === "Rollout Execution" || source === "Backend") {
      pmApi.getTeamOptions?.().then((r) => setTeams(r || [])).catch(() => setTeams([]));
    }
    if (source === "Rollout Execution") {
      pmApi.listHuaweiIMs?.().then((r) => setHuaweiIms(r || [])).catch(() => setHuaweiIms([]));
      pmApi.listProjectDomains?.().then((r) => setProjectDomains(r || [])).catch(() => setProjectDomains([]));
    }
    if (source === "Direct Close") {
      pmApi.listSubcontractors?.().then((r) => setSubcons(r || [])).catch(() => setSubcons([]));
    }
  }, [row, source]);

  const value = useMemo(
    () => (rate ? Math.round(rate * outstanding * 100) / 100 : null),
    [rate, outstanding],
  );

  if (!row) return null;

  // Rollout lines get the real planning dialog — the same component IMDispatch
  // renders, not a reduced copy — with the quantity read from what is still
  // outstanding rather than from the whole line.
  if (source === "Rollout Execution") {
    return (
      <RolloutPlanModal
        open
        rows={[{
          name: row.po_dispatch || row.system_id,
          poid: row.poid,
          site_code: row.site_code,
          qty: outstanding,
          remaining_qty: outstanding,
          line_amount: value ?? row.line_amount,
          huawei_im: row.huawei_im,
          project_domain: row.project_domain,
          is_internal_work: row.is_internal_work,
        }]}
        imName={row.im}
        teamsList={teams}
        huaweiIms={huaweiIms}
        projectDomains={projectDomains}
        qtyOf={(r) => Number(r.remaining_qty ?? r.qty ?? 0)}
        defaultVisitType="Re-Visit"
        title={`Plan the remaining ${qtyFmt.format(outstanding)} of ${row.poid || ""}`}
        submitLabel="Create plan"
        onClose={onClose}
        onCreated={() => onDone?.()}
      />
    );
  }

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const target = row.po_dispatch || row.system_id;
      if (source === "Rollout Execution") {
        if (!team) throw new Error("Pick a team.");
        await pmApi.createRolloutPlans({
          dispatches: [target],
          team,
          plan_date: startDate,
          plan_end_date: endDate,
          access_time: accessTime,
          access_period: accessPeriod,
          visit_type: visitType,
          remark: note || undefined,
        });
      } else if (source === "Backend") {
        if (!team) throw new Error("Pick a backend team.");
        await pmApi.assignBackend([target], team, note || undefined);
      } else if (source === "Direct Close") {
        if (closeType === "SUB" && !subcontractor) throw new Error("Pick a subcontractor.");
        await pmApi.directCloseDispatches(
          [target], closeType, closeType === "SUB" ? subcontractor : undefined,
          note || undefined, milestone === "full" ? undefined : milestone,
        );
      } else {
        throw new Error(`This line has no closing route recorded (source is "${source || "unset"}").`);
      }
      onDone?.();
      onClose?.();
    } catch (e) {
      setErr(e?.message || "Failed");
    } finally {
      setBusy(false);
    }
  }

  const heading = source === "Rollout Execution" ? "Plan the remaining work"
    : source === "Backend" ? "Send the rest to a backend team"
    : source === "Direct Close" ? "Close the rest directly"
    : "Close the remaining quantity";

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
         onClick={() => !busy && onClose?.()}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 22, width: "min(560px, 100%)", maxHeight: "90dvh", overflowY: "auto", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)" }}
           onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: "0 0 4px", fontSize: "1rem" }}>{heading}</h3>
        <div style={{ fontSize: "0.82rem", color: "#64748b", marginBottom: 16 }}>
          <strong style={{ fontFamily: "ui-monospace, monospace" }}>{row.poid || row.po_dispatch}</strong>
          {" — "}{qtyFmt.format(outstanding)} of {qtyFmt.format(ordered)} still to close
          {value != null && <> · {money.format(value)}</>}
        </div>

        {err && <div className="notice error" style={{ marginBottom: 12 }}>{err}</div>}

        {source === "Rollout Execution" && (
          <>
            <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={L}>Team</label>
                <select value={team} onChange={(e) => setTeam(e.target.value)} style={F} disabled={busy}>
                  <option value="">Select team</option>
                  {teams.map((t) => (
                    <option key={t.name || t.value || t} value={t.name || t.value || t}>
                      {t.team_name || t.label || t.name || t}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ flex: "0 0 150px" }}>
                <label style={L}>Visit type</label>
                {/* Re-Visit by default: going back to site is a further attempt,
                    and Re-Visit / Extra Visit are what advance the visit number. */}
                <select value={visitType} onChange={(e) => setVisitType(e.target.value)} style={F} disabled={busy}>
                  <option value="Re-Visit">Re-Visit</option>
                  <option value="Extra Visit">Extra Visit</option>
                  <option value="Execution">Execution</option>
                </select>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={L}>Start date</label>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={F} disabled={busy} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={L}>End date</label>
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={F} disabled={busy} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={L}>Access time</label>
                <input type="time" value={accessTime} onChange={(e) => setAccessTime(e.target.value)} style={F} disabled={busy} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={L}>Access period</label>
                <select value={accessPeriod} onChange={(e) => setAccessPeriod(e.target.value)} style={F} disabled={busy}>
                  <option value="Day">Day</option>
                  <option value="Night">Night</option>
                </select>
              </div>
            </div>
          </>
        )}

        {source === "Backend" && (
          <div style={{ marginBottom: 12 }}>
            <label style={L}>Backend team</label>
            <select value={team} onChange={(e) => setTeam(e.target.value)} style={F} disabled={busy}>
              <option value="">Select team</option>
              {teams.map((t) => (
                <option key={t.name || t.value || t} value={t.name || t.value || t}>
                  {t.team_name || t.label || t.name || t}
                </option>
              ))}
            </select>
          </div>
        )}

        {source === "Direct Close" && (
          <>
            <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={L}>Milestone</label>
                <select value={milestone} onChange={(e) => setMilestone(e.target.value)} style={F} disabled={busy}>
                  <option value="full">Whole line</option>
                  <option value="MS1">MS1 only</option>
                  <option value="MS2">MS2 only</option>
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={L}>Closed by</label>
                <select value={closeType} onChange={(e) => setCloseType(e.target.value)} style={F} disabled={busy}>
                  <option value="INET">INET</option>
                  <option value="SUB">Subcontractor</option>
                </select>
              </div>
            </div>
            {closeType === "SUB" && (
              <div style={{ marginBottom: 12 }}>
                <label style={L}>Subcontractor</label>
                <select value={subcontractor} onChange={(e) => setSubcontractor(e.target.value)} style={F} disabled={busy}>
                  <option value="">Select subcontractor</option>
                  {subcons.map((x) => (
                    <option key={x.name || x} value={x.name || x}>{x.subcontractor_name || x.name || x}</option>
                  ))}
                </select>
              </div>
            )}
          </>
        )}

        <div style={{ marginBottom: 16 }}>
          <label style={L}>Note</label>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} style={{ ...F, resize: "vertical", fontFamily: "inherit" }} disabled={busy} />
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => onClose?.()}>Cancel</button>
          <button type="button" className="btn-primary" disabled={busy} onClick={submit}>
            {busy ? "Working…" : heading}
          </button>
        </div>
      </div>
    </div>
  );
}
