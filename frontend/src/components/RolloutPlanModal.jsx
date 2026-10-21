import { useEffect, useMemo, useState } from "react";
import Modal from "./Modal";
import SearchableSelect from "./SearchableSelect";
import AttachmentsSection from "./AttachmentsSection";
import { pmApi } from "../services/api";
import { missingFields, missingFieldsMessage } from "../utils/requiredFields";
import { qty } from "../utils/numberFormat";
import { isoLocal, weekRangeLabel } from "../utils/weeks";

/**
 * The rollout planning dialog, shared by every page that creates a plan.
 *
 * It used to live inside IMDispatch, which meant the only way to plan the
 * outstanding part of a short-confirmed line was to send the user back to
 * Rollout Planning to find it. Lifting it here lets Work Done open the same
 * form — the same one, not a copy, so the two cannot drift.
 *
 * `rows` are the dispatch rows being planned. `qtyOf` says which quantity a
 * row contributes: the whole line normally, the outstanding part when the
 * caller is closing a remainder.
 *
 * Material dispatch stays with the caller via `materialSlot` — it is a
 * separate feature that happens to share this dialog, and it has no meaning
 * on a Work Done remainder.
 */

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const VISIT_TYPES = ["Execution", "Re-Visit", "Extra Visit"];

export default function RolloutPlanModal({
  open,
  rows = [],
  imName,
  teamsList = [],
  teamsLoading = false,
  huaweiIms = [],
  projectDomains = [],
  qtyOf = (r) => Number(r.qty || 0),
  defaultVisitType = "Execution",
  title = "Create rollout plans for selected DUIDs",
  submitLabel = "Create",
  materialSlot = null,
  onClose,
  onCreated,
}) {
  const [planDate, setPlanDate] = useState(isoLocal(new Date()));
  const [planEndDate, setPlanEndDate] = useState(isoLocal(new Date()));
  const [planTeam, setPlanTeam] = useState("");
  const [planTeams, setPlanTeams] = useState([]);
  const [accessTime, setAccessTime] = useState("");
  const [accessPeriod, setAccessPeriod] = useState("");
  const [huaweiImOverride, setHuaweiImOverride] = useState("");
  const [projectDomainOverride, setProjectDomainOverride] = useState("");
  const [qcRequired, setQcRequired] = useState(true);
  const [ciagRequired, setCiagRequired] = useState(true);
  // DSA at planning time. The modal creates one plan per dispatch, and a
  // DSA belongs to a DUID, so this is only offered when the whole
  // selection is one site -- the backend decides that, not this component.
  const [dsaInfo, setDsaInfo] = useState(null);
  const [dsaPicked, setDsaPicked] = useState({});
  const [dsaOpenDuid, setDsaOpenDuid] = useState("");
  // One pickup for the whole DSA selection, the same way the material
  // dispatch panel above takes one pickup for the whole dispatch.
  const [dsaPickupDate, setDsaPickupDate] = useState("");
  const [dsaPickupTime, setDsaPickupTime] = useState("");
  const dispatchKey = (rows || []).map((r) => r.name).join(",");
  useEffect(() => {
    // No CIAG means no material was used, so there is no DSA to map.
    if (!open || !ciagRequired || !dispatchKey) { setDsaInfo(null); setDsaPicked({}); return; }
    let dead = false;
    pmApi.listDsaForDispatches(dispatchKey.split(","))
      .then((res) => { if (!dead) setDsaInfo(res || null); })
      .catch(() => { if (!dead) setDsaInfo(null); });
    return () => { dead = true; };
  }, [open, ciagRequired, dispatchKey]);
  const [visitType, setVisitType] = useState(defaultVisitType);
  const [planQty, setPlanQty] = useState("");
  const [managerRemark, setManagerRemark] = useState("");
  const [planDocUrls, setPlanDocUrls] = useState([]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);

  // Teams: use the caller's list when it has one, otherwise fetch. A caller
  // that forgets to pass them would otherwise show an empty dropdown with no
  // hint that anything is wrong.
  const [ownTeams, setOwnTeams] = useState([]);
  const [ownTeamsLoading, setOwnTeamsLoading] = useState(false);
  useEffect(() => {
    if (!open || teamsList.length || !imName) return;
    let cancelled = false;
    setOwnTeamsLoading(true);
    pmApi.listINETTeams({ im: imName, status: "Active" })
      .then((list) => {
        if (cancelled) return;
        // Same filter IMDispatch applies: backend teams do not plan rollouts.
        const arr = Array.isArray(list) ? list : [];
        setOwnTeams(arr.filter((t) => (t.team_category || "Field Team") !== "Backend Team"));
      })
      .catch(() => { if (!cancelled) setOwnTeams([]); })
      .finally(() => { if (!cancelled) setOwnTeamsLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, imName, teamsList.length]);

  const teams = teamsList.length ? teamsList : ownTeams;
  const loadingTeams = teamsList.length ? teamsLoading : ownTeamsLoading;

  // Seed on open. Pre-fill only where every selected row already agrees,
  // otherwise leave blank — submitting must not silently unify a mixed batch
  // under one row's value.
  useEffect(() => {
    if (!open) return;
    setCreateError(null);
    setPlanTeams([]);
    setAccessTime("");
    setAccessPeriod("");
    setVisitType(defaultVisitType);
    // Pre-filled with the whole line rather than left blank: planning all of
    // it is the normal case, so the field states what will happen instead of
    // asking the user to infer it from a placeholder. Only one line can carry
    // a quantity — see singleLine below.
    const _only = rows.length === 1 ? Number(qtyOf(rows[0]) || 0) : 0;
    setPlanQty(_only > 0 ? String(_only) : "");
    const fcTeams = [...new Set(rows.map((r) => r.target_team).filter(Boolean))];
    setPlanTeam(fcTeams.length === 1 ? fcTeams[0] : "");
    const fcDates = [...new Set(rows.map((r) => r.target_date).filter(Boolean))];
    const fcWeeks = [...new Set(rows.map((r) => r.target_week).filter(Boolean))];
    const today = isoLocal(new Date());
    let seedDate = today;
    if (fcDates.length === 1) {
      seedDate = String(fcDates[0]).slice(0, 10);
    } else if (fcWeeks.length === 1) {
      const wk = String(fcWeeks[0]).slice(0, 10);
      seedDate = wk > today ? wk : today;
    }
    setPlanDate(seedDate);
    setPlanEndDate(seedDate);
    const huaweiVals = [...new Set(rows.map((r) => r.huawei_im).filter(Boolean))];
    setHuaweiImOverride(huaweiVals.length === 1 ? huaweiVals[0] : "");
    const domainVals = [...new Set(rows.map((r) => r.project_domain).filter(Boolean))];
    setProjectDomainOverride(domainVals.length === 1 ? domainVals[0] : "");
    setQcRequired(true);
    setCiagRequired(true);
    setManagerRemark("");
    setPlanDocUrls([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const forecastHint = useMemo(() => {
    if (!open || !rows.length) return null;
    const teams = [...new Set(rows.map((r) => r.target_team_name || r.target_team).filter(Boolean))];
    const dates = [...new Set(rows.map((r) => r.target_date).filter(Boolean))];
    const weeks = [...new Set(rows.map((r) => r.target_week).filter(Boolean))];
    if (!teams.length && !dates.length && !weeks.length) return null;
    return {
      team: teams.length === 1 ? teams[0] : teams.length ? "mixed" : "no team",
      when: dates.length === 1
        ? String(dates[0]).slice(0, 10)
        : weeks.length === 1
          ? weekRangeLabel(String(weeks[0]).slice(0, 10))
          : "",
    };
  }, [open, rows]);

  const createPlanDuids = [...new Set(rows.map((r) => r.site_code || r.name).filter(Boolean))];
  const lineTotalQty = rows.reduce((s, r) => s + Number(qtyOf(r) || 0), 0);
  // How much of the line THIS plan covers. The whole of it by default, which
  // is what every plan did before this existed. Offered on a single line only:
  // across a bulk selection one number has no shared meaning, and each line
  // keeps its own quantity.
  const singleLine = rows.length === 1;
  const createPlanTotalQty = singleLine && planQty !== "" && Number(planQty) > 0
    ? Number(planQty)
    : lineTotalQty;
  const selectedAmt = rows.reduce((s, r) => s + Number(r.line_amount || 0), 0);
  const pctAssigned = (planTeams || [])
    .filter((r) => r.team)
    .reduce((t, r) => t + (Number(r.assigned_pct) || 0), 0);
  const planTeamsAssignedQty = (planTeams || [])
    .filter((r) => r.team)
    .reduce((s, r) => s + (Number(r.assigned_qty) || 0), 0);
  const planTeamsRemaining = createPlanTotalQty - planTeamsAssignedQty;

  async function handleCreate() {
    if (!rows.length || !planDate || !planEndDate || !visitType || !planTeam) return;
    if (planEndDate < planDate) {
      setCreateError("Planned end date cannot be before start date.");
      return;
    }
    // Internal work has no customer engagement behind it, so Huawei IM and
    // Project Domain have nothing to point at — matching _require_line_attributes.
    const customerLines = rows.some((r) => !Number(r.is_internal_work || 0));
    const missing = missingFields({
      "Plan Date": planDate,
      "Planned End Date": planEndDate,
      "Visit Type": visitType,
      "Team": planTeam,
      "Access Time": accessTime,
      "Access Period": accessPeriod,
      ...(customerLines
        ? { "Huawei IM": huaweiImOverride, "Project Domain": projectDomainOverride }
        : {}),
    });
    if (missing.length > 0) {
      setCreateError(missingFieldsMessage(missing, "plan"));
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const dispatches = rows.map((r) => r.name);
      const validExtras = (planTeams || []).filter((r) => r.team);
      // `assigned_qty: 0` on the lead team means "give it whatever is left of
      // the LINE" — _sync_plan_teams auto-distributes the remainder across any
      // row left at zero. That is right when the plan covers the whole line,
      // and wrong the moment it covers only part of it, so a partial plan
      // states the lead team's share outright.
      const partialPlan = singleLine && createPlanTotalQty < lineTotalQty - 0.00005;
      const leadShare = Math.max(0, createPlanTotalQty - planTeamsAssignedQty);
      // ONE plan is created per selected line, and this payload goes to every
      // one of them. So a typed quantity only means something on a single
      // line: planning two 1-unit lines with "Irfan 1, Sharban 1" sent BOTH
      // teams' full quantities to BOTH lines — each plan read as 2 on a line
      // of 1, and the lead team ended up with 0 on both. Across several lines
      // the teams are sent at zero, which is _sync_plan_teams' instruction to
      // divide each line's own quantity between them.
      const teamsPayload = validExtras.length > 0
        ? [
            ...(validExtras.some((r) => r.team === planTeam)
              ? []
              : [{ team: planTeam, assigned_qty: partialPlan ? leadShare : 0 }]),
            ...validExtras.map((r) => (singleLine
              ? { team: r.team, assigned_qty: Number(r.assigned_qty) || 0 }
              // Several lines: a quantity cannot be shared between lines of
              // different sizes, but a percentage can. The backend resolves
              // it against each line's own quantity, so 60/40 is 60/40 of
              // every line. Left blank, it stays 0 and the line is divided
              // evenly, as before.
              : { team: r.team, assigned_pct: Number(r.assigned_pct) || 0 })),
          ]
        : (partialPlan ? [{ team: planTeam, assigned_qty: leadShare }] : []);
      const result = await pmApi.createRolloutPlans({
        dispatches,
        plan_date: planDate,
        plan_end_date: planEndDate,
        team: planTeam,
        teams: teamsPayload,
        access_time: accessTime,
        access_period: accessPeriod,
        huawei_im: huaweiImOverride || undefined,
        project_domain: projectDomainOverride || undefined,
        qc_required: qcRequired ? 1 : 0,
        ciag_required: ciagRequired ? 1 : 0,
        visit_type: visitType,
        manager_remark: managerRemark || undefined,
        plan_documents: planDocUrls.length ? JSON.stringify(planDocUrls) : undefined,
      });
      // The plans exist now, so the DSAs can be attached. Every plan in
      // this batch shares the DUID -- that is the condition for the picker
      // being offered at all -- so each one is a valid home for the DSA.
      // Which plan belongs to which site is resolved server-side —
      // create_rollout_plans returns a flat list of names, and guessing
      // the pairing here would be guessing.
      const anyPicked = Object.values(dsaPicked).some((v) => (v || []).length);
      if (anyPicked && Array.isArray(result?.names) && result.names.length) {
        try {
          const pickup = {};
          if (dsaPickupDate || dsaPickupTime) {
            for (const [duid, names] of Object.entries(dsaPicked)) {
              pickup[duid] = {};
              for (const n of (names || [])) {
                pickup[duid][n] = { pickup_date: dsaPickupDate, pickup_time: dsaPickupTime };
              }
            }
          }
          await pmApi.mapDsasToPlans(result.names, dsaPicked, pickup);
        } catch (e) {
          // The plans exist; a failed mapping must not read as failed
          // planning. It is re-doable on Rollout Execution.
          console.warn("DSA mapping failed", e);
        }
      }
      await onCreated?.(result, { team: planTeam, dispatches });
      onClose?.();
    } catch (err) {
      setCreateError(err.message || "Failed to create rollout plans");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => !creating && onClose?.()}
      title={title}
      width={840}
      footer={
        <>
          <button type="button" className="btn-secondary" disabled={creating} onClick={() => onClose?.()}>Cancel</button>
          <button
            type="button"
            className="btn-primary"
            disabled={creating || !planDate || !planEndDate || !visitType || !planTeam || !accessTime || !accessPeriod}
            onClick={handleCreate}
          >
            {creating ? "Creating…" : submitLabel}
          </button>
        </>
      }
    >
        {createError && <div className="notice error" style={{ marginBottom: 12 }}>{createError}</div>}
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: "0.72rem", fontWeight: 600, color: "#94a3b8", letterSpacing: "0.06em", marginBottom: 8 }}>SELECTED DUIDs</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, maxHeight: 120, overflowY: "auto", padding: 4 }}>
            {createPlanDuids.map((d) => (
              <span
                key={d}
                style={{
                  display: "inline-block",
                  maxWidth: "100%",
                  padding: "6px 10px",
                  borderRadius: 8,
                  background: "#f1f5f9",
                  border: "1px solid #e2e8f0",
                  fontSize: "0.78rem",
                  fontWeight: 600,
                  color: "#334155",
                  fontFamily: "ui-monospace, monospace",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                title={d}
              >
                {d}
              </span>
            ))}
          </div>
          <p style={{ fontSize: "0.78rem", color: "#64748b", margin: "8px 0 0" }}>
            IM <strong>{imName || "—"}</strong> · {rows.length} line{rows.length !== 1 ? "s" : ""} · Qty <strong style={{ color: "#0f172a" }}>{qty.format(createPlanTotalQty)}</strong> → <strong>Planned</strong> · SAR {qty.format(selectedAmt)}
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px 16px", marginBottom: 14 }}>
          <div>
            <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, marginBottom: 6, color: "#475569" }}>Lead team</label>
            <select
              value={planTeam}
              onChange={(e) => setPlanTeam(e.target.value)}
              disabled={loadingTeams || !imName}
              style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e2e8f0", boxSizing: "border-box" }}
            >
              <option value="">{loadingTeams ? "Loading teams…" : !imName ? "Link IM to load teams" : "Select team"}</option>
              {teams.map((t) => (
                <option key={t.team_id} value={t.team_id}>{t.team_name || t.team_id}</option>
              ))}
              {/* The team list loads AFTER planTeam is seeded from the
                  forecast, and a <select> whose value isn't among its options
                  renders blank — so a forecast team outside the IM's active
                  field teams would look unset while actually being set. */}
              {planTeam && !teams.some((t) => t.team_id === planTeam) && (
                <option value={planTeam}>{planTeam} — forecast team</option>
              )}
            </select>
            {forecastHint && (
              <div style={{ fontSize: "0.72rem", color: "#64748b", marginTop: 5 }}>
                Forecast: <strong style={{ color: "#0f172a" }}>{forecastHint.team}</strong>
                {forecastHint.when ? ` · ${forecastHint.when}` : ""}
              </div>
            )}
          </div>
          {/* How much of the line this plan covers. Blank = all of it, which
              is what every plan did before this field existed. Sits beside
              Lead team because the two are read together. */}
          {singleLine && lineTotalQty > 0 && (
            <div>
              <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, marginBottom: 6, color: "#475569" }}>
                Qty for this plan
              </label>
              <input
                type="number" min="0" max={lineTotalQty} step="any"
                value={planQty}
                placeholder={`All ${qty.format(lineTotalQty)}`}
                title="How much of the line this plan covers. Change it to plan part of the line now and the rest later."
                onChange={(e) => setPlanQty(e.target.value)}
                style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e2e8f0", boxSizing: "border-box" }}
              />
              <div style={{ marginTop: 4, fontSize: "0.74rem",
                            color: createPlanTotalQty > lineTotalQty + 0.00005 ? "#b91c1c" : "#64748b" }}>
                {createPlanTotalQty > lineTotalQty + 0.00005
                  ? `The line only carries ${qty.format(lineTotalQty)}.`
                  : createPlanTotalQty < lineTotalQty - 0.00005
                    ? `${qty.format(createPlanTotalQty)} of ${qty.format(lineTotalQty)} · `
                      + `${qty.format(lineTotalQty - createPlanTotalQty)} left to plan later`
                    : "Covers the whole line."}
              </div>
            </div>
          )}
          <div>
            <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, marginBottom: 6, color: "#475569" }}>Visit type</label>
            <select value={visitType} onChange={(e) => setVisitType(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e2e8f0", boxSizing: "border-box" }}>
              {VISIT_TYPES.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
        </div>


        {/* Optional multi-team split */}
        <div style={{ background: "#fafbfc", border: "1px solid #e5e7eb", borderRadius: 8, padding: 12, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontSize: "0.74rem", fontWeight: 700, color: "#475569" }}>ADDITIONAL TEAMS (optional)</div>
            <button
              type="button"
              onClick={() => setPlanTeams((arr) => [...arr, { team: "", assigned_qty: 0 }])}
              style={{ fontSize: "0.74rem", padding: "4px 10px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer", fontWeight: 600, color: "#1d4ed8" }}
            >
              + Add team
            </button>
          </div>
          <div style={{
            fontSize: "0.74rem", color: "#475569", marginBottom: 8,
            padding: "6px 8px", borderRadius: 6,
            background: planTeamsRemaining < 0 ? "#fef2f2" : "#eef2ff",
            border: planTeamsRemaining < 0 ? "1px solid #fecaca" : "1px solid #c7d2fe",
          }}>
            {!singleLine ? (
              <>
                <div style={{ color: "#b45309", fontWeight: 600, marginBottom: 4 }}>
                  {rows.length} lines selected — each gets its own plan. Shares are
                  entered as percentages and applied to each line's own quantity.
                </div>
                Total qty across the lines <strong>{qty.format(createPlanTotalQty)}</strong>
                {pctAssigned > 0 && (
                  <>
                    {" · Extras take "}<strong>{qty.format(pctAssigned)}%</strong>
                    {" · Lead team "}
                    <strong style={{ color: pctAssigned > 100.00005 ? "#b91c1c" : "#1d4ed8" }}>
                      {qty.format(Math.max(0, 100 - pctAssigned))}%
                    </strong>
                  </>
                )}
              </>
            ) : (
              <>
                Total qty <strong>{qty.format(createPlanTotalQty)}</strong>
                {" · Assigned to extras "}
                <strong>{fmt.format(planTeamsAssignedQty)}</strong>
                {" · Remaining for lead team "}
                <strong style={{ color: planTeamsRemaining < 0 ? "#b91c1c" : "#1d4ed8" }}>
                  {fmt.format(planTeamsRemaining)}
                </strong>
                {planTeamsRemaining < 0 && (
                  <span style={{ marginLeft: 8, color: "#b91c1c", fontWeight: 700 }}>⚠ over total</span>
                )}
              </>
            )}
          </div>
          {planTeams.length === 0 ? (
            <div style={{ fontSize: "0.74rem", color: "#94a3b8" }}>
              Single-team plan. Add another team to split the line.
            </div>
          ) : (
            <div>
              {planTeams.map((row, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                  <select
                    value={row.team || ""}
                    onChange={(e) => setPlanTeams((arr) => arr.map((x, j) => j === i ? { ...x, team: e.target.value } : x))}
                    style={{ flex: 2, padding: "6px 10px", borderRadius: 6, border: "1px solid #e2e8f0" }}
                  >
                    <option value="">Select team</option>
                    {teams.filter((t) => t.team_id !== planTeam || row.team === t.team_id).map((t) => (
                      <option key={t.team_id} value={t.team_id}>{t.team_name || t.team_id}</option>
                    ))}
                  </select>
                  <input
                    // type=text + inputMode=decimal — type=number breaks
                    // mid-decimal entry in Chrome (it reports "" while the
                    // user is typing "0.", which clears the controlled input).
                    type="text"
                    inputMode="decimal"
                    pattern="[0-9]*\.?[0-9]*"
                    value={(singleLine ? row.assigned_qty : row.assigned_pct) ?? ""}
                    title={singleLine
                      ? "This team's share of the line, as a quantity."
                      : "This team's share as a percentage, applied to each selected line's own quantity. Leave blank to divide every line evenly."}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v !== "" && !/^\d*\.?\d*$/.test(v)) return;
                      const field = singleLine ? "assigned_qty" : "assigned_pct";
                      setPlanTeams((arr) => arr.map((x, j) => j === i ? { ...x, [field]: v } : x));
                    }}
                    placeholder={singleLine ? "Qty" : "% · even"}
                    style={{ flex: 1, padding: "6px 10px", borderRadius: 6, border: "1px solid #e2e8f0" }}
                  />
                  <button
                    type="button"
                    onClick={() => setPlanTeams((arr) => arr.filter((_, j) => j !== i))}
                    style={{ fontSize: "0.78rem", padding: "4px 8px", borderRadius: 6, border: "1px solid #fecaca", background: "#fff", cursor: "pointer", color: "#b91c1c" }}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <div style={{ fontSize: "0.7rem", color: "#64748b", marginTop: 4 }}>
                {singleLine
                  ? "Lead team gets the remaining qty if you leave it blank."
                  : `Shares are percentages of each line's own quantity — 60 and 40 split every line 60/40. `
                    + `Lead team takes the rest${pctAssigned > 0 ? ` (${qty.format(Math.max(0, 100 - pctAssigned))}%)` : ""}.`}
              </div>
              {!singleLine && pctAssigned > 100.00005 && (
                <div style={{ fontSize: "0.72rem", color: "#b91c1c", marginTop: 4 }}>
                  The shares add up to {qty.format(pctAssigned)}% — more than a line holds.
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ fontSize: "0.72rem", fontWeight: 600, color: "#94a3b8", letterSpacing: "0.06em", marginBottom: 10 }}>ACCESS DETAILS</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px 16px", marginBottom: 16 }}>
          <div>
            <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, marginBottom: 6, color: "#475569" }}>Planned start date</label>
            <input
              type="date"
              value={planDate}
              onChange={(e) => {
                const v = e.target.value;
                setPlanDate(v);
                setPlanEndDate((ed) => (ed < v ? v : ed));
              }}
              style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e2e8f0", boxSizing: "border-box" }}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, marginBottom: 6, color: "#475569" }}>Planned end date</label>
            <input type="date" value={planEndDate} min={planDate} onChange={(e) => setPlanEndDate(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e2e8f0", boxSizing: "border-box" }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, marginBottom: 6, color: "#475569" }}>Access time *</label>
            <input type="time" value={accessTime} onChange={(e) => setAccessTime(e.target.value)} style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e2e8f0", boxSizing: "border-box" }} />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, marginBottom: 6, color: "#475569" }}>Access period *</label>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", padding: "9px 0" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.86rem", cursor: "pointer" }}>
                <input type="radio" name="access_period_im" checked={accessPeriod === ""} onChange={() => setAccessPeriod("")} />
                Not set
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.86rem", cursor: "pointer" }}>
                <input type="radio" name="access_period_im" checked={accessPeriod === "Day"} onChange={() => setAccessPeriod("Day")} />
                Day
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.86rem", cursor: "pointer" }}>
                <input type="radio" name="access_period_im" checked={accessPeriod === "Night"} onChange={() => setAccessPeriod("Night")} />
                Night
              </label>
            </div>
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, marginBottom: 6, color: "#475569" }}>Huawei IM</label>
            <SearchableSelect
              value={huaweiImOverride}
              onChange={setHuaweiImOverride}
              options={huaweiIms.map((h) => ({ id: h.name, label: `${h.full_name}${h.email ? ` (${h.email})` : ""}` }))}
              placeholder="Defaults from project — set to override"
              style={{ width: "100%" }}
              minWidth={0}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, marginBottom: 6, color: "#475569" }}>Project Domain</label>
            <SearchableSelect
              value={projectDomainOverride}
              onChange={setProjectDomainOverride}
              options={projectDomains.map((d) => ({ id: d.name, label: d.domain_name || d.name }))}
              placeholder="Defaults from project — set to override"
              style={{ width: "100%" }}
              minWidth={0}
            />
          </div>
        </div>

        {/* Per-plan workflow toggles. When unchecked, the field
            team isn't asked for that step and the IM can close the
            plan to Work Done without recording it. */}
        <div style={{
          display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap",
          padding: "10px 12px", background: "#f8fafc",
          border: "1px solid #e2e8f0", borderRadius: 6, marginBottom: 16,
        }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.86rem", cursor: "pointer", fontWeight: 600 }}>
            <input type="checkbox" checked={qcRequired} onChange={(e) => setQcRequired(e.target.checked)} />
            QC Required
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.86rem", cursor: "pointer", fontWeight: 600 }}>
            <input type="checkbox" checked={ciagRequired} onChange={(e) => setCiagRequired(e.target.checked)} />
            CIAG Required
          </label>
        </div>

        {ciagRequired && dsaInfo?.offered && (
          <div style={{ background: "#fafbfc", border: "1px solid #e5e7eb", borderRadius: 8, padding: 12, marginBottom: 16 }}>
            <div style={{ fontSize: "0.74rem", fontWeight: 700, color: "#475569", marginBottom: 8 }}>MATERIAL (DSA)</div>
            <div style={{ display: "flex", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 140px" }}>
                <label style={{ display: "block", fontSize: "0.72rem", fontWeight: 600, color: "#64748b", marginBottom: 3 }}>Pickup Date</label>
                <input type="date" value={dsaPickupDate} onChange={(e) => setDsaPickupDate(e.target.value)}
                  style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #e2e8f0", fontSize: "0.82rem", boxSizing: "border-box" }} />
              </div>
              <div style={{ flex: "1 1 140px" }}>
                <label style={{ display: "block", fontSize: "0.72rem", fontWeight: 600, color: "#64748b", marginBottom: 3 }}>Pickup Time</label>
                <input type="time" value={dsaPickupTime} onChange={(e) => setDsaPickupTime(e.target.value)}
                  style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #e2e8f0", fontSize: "0.82rem", boxSizing: "border-box" }} />
              </div>
            </div>
            {/* One section per DUID, the same shape the material dispatch
                panel in this modal uses. A DSA belongs to a site, and
                planning several sites together is the normal case. */}
            {(dsaInfo.groups || []).map((g) => {
              const picked = dsaPicked[g.duid] || [];
              const expanded = dsaOpenDuid === g.duid;
              return (
                <div key={g.duid} style={{ border: "1px solid #e2e8f0", borderRadius: 8, marginBottom: 8, overflow: "hidden" }}>
                  <button type="button" onClick={() => setDsaOpenDuid(expanded ? "" : g.duid)}
                    style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: "#fff", border: "none", cursor: "pointer", textAlign: "left" }}>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ fontSize: "0.82rem", fontWeight: 600, fontFamily: "ui-monospace, monospace" }}>{g.duid}</span>
                      <span style={{ fontSize: "0.72rem", color: "#94a3b8", marginLeft: 8 }}>{g.count} line{g.count !== 1 ? "s" : ""}</span>
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {picked.length > 0 && (
                        <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#1d4ed8", background: "#eff6ff", padding: "2px 8px", borderRadius: 999 }}>
                          {picked.length} DSA{picked.length !== 1 ? "s" : ""} selected
                        </span>
                      )}
                      <span style={{ fontSize: "0.72rem", color: "#94a3b8" }}>
                        {g.note || `${(g.rows || []).length} available`}
                      </span>
                      <span style={{ color: "#94a3b8" }}>{expanded ? "\u25b2" : "\u25bc"}</span>
                    </span>
                  </button>
                  {expanded && (
                    <div style={{ padding: "8px 12px", borderTop: "1px solid #f1f5f9", display: "flex", flexDirection: "column", gap: 6 }}>
                      {(g.rows || []).length === 0 ? (
                        <div style={{ fontSize: "0.78rem", color: "#94a3b8" }}>
                          {g.note || "No DSA recorded for this site."}
                        </div>
                      ) : g.rows.map((d) => {
                        const on = picked.includes(d.name);
                        return (
                          <label key={d.name}
                                 style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "7px 9px",
                                          border: `1px solid ${on ? "#bfdbfe" : "#e2e8f0"}`, borderRadius: 6,
                                          background: on ? "#eff6ff" : "#fff", cursor: "pointer" }}>
                            <input type="checkbox" checked={on} style={{ marginTop: 2 }}
                                   onChange={() => setDsaPicked((cur) => {
                                     const was = cur[g.duid] || [];
                                     const next = was.includes(d.name)
                                       ? was.filter((x) => x !== d.name) : [...was, d.name];
                                     return { ...cur, [g.duid]: next };
                                   })} />
                            <span style={{ minWidth: 0 }}>
                              <span style={{ fontFamily: "monospace", fontSize: "0.78rem", fontWeight: 700 }}>{d.bill_no}</span>
                              <span style={{ fontSize: "0.73rem", color: "#64748b" }}>{"  MSA "}{d.request_no || "\u2014"}</span>
                              <div style={{ fontSize: "0.71rem", color: "#94a3b8", marginTop: 1 }}>
                                {[d.outbound_status, d.outbound_date ? String(d.outbound_date).slice(0, 10) : null].filter(Boolean).join(" \u00b7 ")}
                                {(d.mapped_on || []).length > 0 && (
                                  <span style={{ color: "#b45309" }}> \u00b7 already on {d.mapped_on.length} plan{d.mapped_on.length > 1 ? "s" : ""}</span>
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
        )}

        <div className="form-group" style={{ marginBottom: 16 }}>
          <label>Remark</label>
          <textarea
            rows={3}
            value={managerRemark}
            onChange={(e) => setManagerRemark(e.target.value)}
            placeholder="Remark for these rollout plans…"
            style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", fontSize: "0.86rem", border: "1px solid #e2e8f0", borderRadius: 6, resize: "vertical", minHeight: 60 }}
          />
        </div>
        <AttachmentsSection
          urls={planDocUrls}
          onChange={setPlanDocUrls}
          title="Planning Documents"
          noCamera
        />
      {materialSlot}
    </Modal>
  );
}
