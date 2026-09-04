import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { pmApi } from "../../services/api";
import MiniTable from "../../components/MiniTable";
import { BarChart, DonutChart } from "../../components/Charts";
import DateRangePicker, { DATE_PRESETS } from "../../components/DateRangePicker";
import DashboardSwitcher from "../../components/DashboardSwitcher";

/* ── Formatters ─────────────────────────────────────────────────── */
const fmt = new Intl.NumberFormat("en-US");

function fmtTimestamp(ts) {
  if (!ts) return "";
  const d = new Date(String(ts).replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return String(ts);
  return `${d.getDate()} ${d.toLocaleString("en-US", { month: "short" })} ${d.getFullYear()} · ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// Format a count value; negatives shown as (123)
function fv(v) {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number") {
    const abs = Math.abs(v);
    const s = abs > 999 ? fmt.format(abs) : String(abs);
    return v < 0 ? `(${s})` : s;
  }
  return String(v);
}

// Format as SAR integer; negatives shown as (SAR 123)
function sar(v) {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  const s = `SAR ${fmt.format(Math.round(Math.abs(n)))}`;
  return n < 0 ? `(${s})` : s;
}

function profitColor(v) {
  if (v === null || v === undefined) return "";
  return v < 0 ? "text-red" : v > 0 ? "text-green" : "";
}

function statusClass(status) {
  const s = (status || "").toLowerCase();
  if (s === "optimized") return "status-optimized";
  if (s === "recover" || s === "monitor") return "status-recover";
  if (s === "behind") return "status-behind";
  if (s === "ahead") return "status-ahead";
  return "status-normal";
}

function dotColor(status) {
  const s = (status || "").toLowerCase();
  if (s === "optimized") return "green";
  if (s === "recover" || s === "monitor") return "red";
  if (s === "behind") return "amber";
  if (s === "ahead") return "blue";
  return "amber";
}

/* ── Compact stat card (inside section cards) ───────────────────── */
function Stat({ label, value, sub, color = "", onClick, hint, textValue = false }) {
  return (
    <div
      className={`dash-stat${onClick ? " clickable" : ""}`}
      onClick={onClick}
      // `hint` explains a figure that isn't self-evident (the pro-rated
      // "as of today" ones); it wins over the navigation tooltip.
      title={hint || (onClick ? `Go to ${label}` : undefined)}
    >
      <div className="dash-stat-label">{label}</div>
      <div className={["dash-stat-value", textValue && "dash-stat-value--text", color].filter(Boolean).join(" ")}>{value}</div>
      {sub && <div className="dash-stat-sub">{sub}</div>}
    </div>
  );
}

/* ── Section card wrapper ───────────────────────────────────────── */
function Section({ title, accent, children, style, onTitleClick }) {
  return (
    <div className="dash-section" style={style}>
      <div
        className={`dash-section-hd dash-section-hd--${accent}${onTitleClick ? " dash-section-hd--link" : ""}`}
        onClick={onTitleClick}
      >
        {title}{onTitleClick && <span style={{ float: "right", opacity: 0.7, fontSize: "0.75rem" }}>↗</span>}
      </div>
      <div className="dash-section-bd">{children}</div>
    </div>
  );
}

/* ── Loading state ──────────────────────────────────────────────── */
function LoadingState() {
  return (
    <div className="dashboard dashboard-loading">
      <div className="dashboard-loading-hero">
        <div className="dashboard-loading-spinner" aria-hidden="true">
          <svg viewBox="0 0 50 50" width="48" height="48">
            <circle cx="25" cy="25" r="20" fill="none" strokeWidth="4" stroke="rgba(59,130,246,0.15)" />
            <circle cx="25" cy="25" r="20" fill="none" strokeWidth="4" stroke="#2563eb"
              strokeLinecap="round" strokeDasharray="90 60" pathLength="125.6" />
          </svg>
        </div>
        <div>
          <div className="dashboard-loading-title">Loading Command Dashboard…</div>
          <div className="dashboard-loading-subtitle">Aggregating projects, KPIs, and team performance</div>
        </div>
      </div>
      <div className="dash-header shimmer" style={{ height: 60, borderRadius: 10, marginBottom: 14 }} />
      {[1, 2, 3].map((i) => (
        <div key={i} className="kpi-row" style={{ marginBottom: 10 }}>
          {Array.from({ length: 6 }).map((_, j) => (
            <div key={j} className="shimmer-block" style={{ height: 72, borderRadius: 8 }} />
          ))}
        </div>
      ))}
    </div>
  );
}

/* ── Default date range: this month ────────────────────────────── */
function defaultRange() {
  const r = DATE_PRESETS.this_month.range(new Date());
  const iso = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { from: iso(r.from), to: iso(r.to) };
}

/* ── Main ───────────────────────────────────────────────────────── */
export default function CommandDashboard() {
  const navigate = useNavigate();

  function goTeams(filters) {
    navigate("/teams", { state: { teamFilters: filters } });
  }

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const [range, setRange] = useState(defaultRange);
  const intervalRef = useRef(null);

  async function fetchData(r = range) {
    try {
      setFetchError(null);
      const res = await pmApi.getCommandDashboard({
        from_date: r.from,
        to_date: r.to,
        etag: data?.etag || "",
      });
      if (res && res.unchanged) {
        setData((prev) => (prev ? { ...prev, last_updated: res.last_updated } : prev));
      } else {
        setData(res);
      }
    } catch (err) {
      setFetchError(err.message || "Failed to load dashboard");
      setData((prev) => prev);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData(range);
    intervalRef.current = setInterval(() => fetchData(range), 5 * 60_000);
    return () => {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to]);

  if (loading && !data) return <LoadingState />;

  if (!data) {
    return (
      <div className="dashboard">
        <div className="notice error" style={{ margin: "24px 28px" }}>
          <span>⚠</span> {fetchError || "Dashboard could not be loaded."}
          <button type="button" className="btn-secondary" style={{ marginLeft: 12 }}
            onClick={() => { setLoading(true); fetchData(); }}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  const {
    operational = {},
    inet = {},
    subcon = {},
    backend = {},
    company = {},
    top_teams = [],
    im_performance = [],
    team_status = {},
    watchlist = [],
    direct_close = {},
    last_updated = null,
  } = data;

  /* ── Derived ─── */
  const ts = team_status || {};
  const inetMonthlyCost     = inet.inet_monthly_cost || 0;
  const inetMonthlyTarget   = inet.inet_monthly_target || 0;
  const inetTargetToday     = inet.inet_target_today || 0;
  const inetAchieved        = inet.inet_achieved || 0;
  const inetGapToday        = inetAchieved - inetTargetToday;
  const inetProfitLossToday = inet.inet_profit_loss_today ?? inetGapToday;

  /* ── Top 5 Teams table ─── */
  const teamCols = [
    { label: "Team",    key: "team_name" },
    { label: "Revenue", key: "revenue",   align: "right", colorFn: (v) => v > 0 ? "text-green" : "" },
    { label: "Cost",    key: "team_cost", align: "right" },
    { label: "Profit",  key: "profit",    align: "right", colorFn: (v) => v > 0 ? "text-green" : v < 0 ? "text-red" : "" },
  ];
  const teamRows = (top_teams || []).slice(0, 5);

  /* ── IM Performance table ─── */
  const imCols = [
    { label: "IM", key: "im" },
    { label: "Teams", key: "teams", align: "right" },
    { label: "Revenue", key: "revenue", align: "right", colorFn: (v) => v > 0 ? "text-green" : "" },
    { label: "Cost", key: "team_cost", align: "right" },
    { label: "Profit", key: "profit", align: "right", colorFn: (v) => profitColor(v) },
  ];

  /* ── Team Status chart ─── */
  const totalTeams  = ts.active || 0;
  const workingTeams = (ts.in_progress || 0) + (ts.teams_planned || 0);
  const activePct   = totalTeams > 0 ? Math.round((workingTeams / totalTeams) * 100) : 0;
  const statusBars  = [
    { label: "Active",      value: ts.active || 0,         color: "green" },
    { label: "Idle",        value: ts.idle || 0,           color: "amber" },
    { label: "Planned",     value: ts.teams_planned || 0,  color: "" },
    { label: "In Progress", value: ts.in_progress || 0,    color: "green" },
  ];

  return (
    <div className="dashboard">
      <DashboardSwitcher />

      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="dash-header" style={{ display: "flex", alignItems: "center", padding: "12px 20px" }}>
        <div style={{ flex: 1 }} />
        <div style={{ textAlign: "center" }}>
          <h1 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 800, letterSpacing: "-0.2px" }}>
            Command Dashboard
          </h1>
          <div className="subtitle" style={{ justifyContent: "center", marginTop: 3 }}>
            <span className="live-dot" />
            <span className="dash-timestamp">
              Last updated: {last_updated ? fmtTimestamp(last_updated) : "—"}
            </span>
          </div>
        </div>
        <div style={{ flex: 1, display: "flex", justifyContent: "flex-end" }}>
          <DateRangePicker value={range} onChange={(r) => setRange({ from: r.from, to: r.to })} />
        </div>
      </div>

      {/* ── Company Financial Summary ────────────────────────────── */}
      <Section title="Company Financial Summary" accent="company" style={{ marginBottom: 14 }}>
        <div className="dash-kpi-grid dash-kpi-grid--7">
          {/* Built from the whole active-team population (INET cost x 1.25
              plus SUB rollout targets), so the team list is its drill-down.
              Its pro-rated twin and the gap/coverage figures beside it are
              arithmetic on top and have no list of their own. */}
          <Stat label="Total INET Target"  value={sar(company.company_target)}
            hint="INET's own commitment for the whole period: team cost + 25% margin, plus INET's margin-share of the Sub-Con target (not the Sub-Con's full gross target — kept on the same basis as Total Revenue below the Cost line, so Coverage % compares like with like). Click to see the teams."
            onClick={() => goTeams({})} />
          <Stat label="Target (as of today)"   value={sar(company.total_target_today)}
            hint={`The full-period target scaled to how much of the range has passed (${Number(company.day_progress_pct ?? 0).toFixed(1)}% so far), so revenue-to-date is compared against a fair, time-adjusted number.`} />
          {/* True gross top-line: every SAR of work recognized this period,
              INET's own and subcontracted alike, at full value — including
              the share that's owed out to the subcontractor. Not the same
              number Target/Gap/Coverage % are measured against (see their
              hints) — those track INET's own retained margin, a deliberately
              smaller, different figure. */}
          <Stat label="Total Revenue"      value={sar(company.total_revenue)}   color="text-green"
            hint="Gross value of all work completed this period — INET's own work plus subcontracted work at full value (including the subcontractor's payout share). Click to see the underlying Work Done rows."
            onClick={() => navigate("/work-done", { state: { workDoneFilters: { fromDate: range.from, toDate: range.to } } })} />
          <Stat label="Gap"                value={sar(company.company_gap)}
            hint="Total INET Target minus INET's own retained revenue (in-house work plus subcontracting margin) — not Total Revenue above, which is gross."
            color={(company.company_gap ?? 0) > 0 ? "text-red" : "text-green"} />
          <Stat label="Cost (as of today)"     value={sar(company.total_cost_today)}
            hint={`Team salary cost for the part of the range already elapsed (${Number(company.day_progress_pct ?? 0).toFixed(1)}%), plus Sub-Con expense (the payout owed to subcontractors). Click to see the teams.`}
            onClick={() => goTeams({})} />
          <Stat label="Profit / Loss"      value={sar(company.profit_loss)}
            hint="Total Revenue minus Total Expense (Cost, including subcontractor payout) — the company's real margin."
            color={profitColor(company.profit_loss)} />
          <Stat label="Coverage %"
            value={`${Number(company.coverage_pct ?? 0).toFixed(1)}%`}
            hint="INET's own retained revenue (in-house + subcontracting margin) against Total INET Target — both on the same margin basis, not against gross Total Revenue."
            color={(company.coverage_pct ?? 0) >= 50 ? "text-green" : (company.coverage_pct ?? 0) >= 20 ? "text-amber" : "text-red"} />
        </div>
      </Section>

      {/* ── 3-column middle grid ────────────────────────────────── */}
      <div className="dash-mid-grid">

        {/* Col 1 — Operational Today */}
        <Section title="Operational Today" accent="ops">
          <div className="dash-kpi-grid dash-kpi-grid--2">
            {/* Follows the date range, matched on the PO's publish date
                (COALESCE(publish_date, start_date, creation) — the same basis
                the PO-vs-Invoice trend buckets by, since publish_date lands
                on only a minority of lines). */}
            <Stat label="Open PO Lines"  value={fv(operational.total_open_po_lines ?? 0)}
              hint="PO Intake Lines still open (status not Closed or Cancelled) whose PO was published in the selected range."
              onClick={() => navigate("/po-dump", { state: { poDumpFilters: { showOpen: true, showClosed: false, showCancelled: false } } })} />
            <Stat label="Open PO Value"  value={sar(operational.total_open_po_line_value ?? 0)}
              hint="Line amount of the open lines above, for POs published in the selected range."
              onClick={() => navigate("/po-dump", { state: { poDumpFilters: { showOpen: true, showClosed: false, showCancelled: false } } })} />
            <Stat label="Planned Activities" value={sar(operational.planned_amount ?? 0)}
              sub={`${operational.planned_activities ?? 0} plans`}
              onClick={() => navigate("/execution", { state: { execFilters: { planStatusFilter: ["Planned", "Extended", "Planning with Issue"], fromDate: range.from, toDate: range.to } } })} />
            <Stat label="In Progress" value={sar(operational.in_progress_amount ?? 0)}
              sub={`${operational.in_progress_activities ?? 0} activities`}
              onClick={() => navigate("/execution", { state: { execFilters: { planStatusFilter: ["In Execution", "Completed"], fromDate: range.from, toDate: range.to } } })} />
            <Stat label="Work Done" value={sar(operational.workdone_amount ?? 0)}
              sub={`${operational.workdone_activities ?? 0} lines`} color="text-green"
              onClick={() => navigate("/work-done", { state: { workDoneFilters: { fromDate: range.from, toDate: range.to } } })} />
            {/* Closed stays non-clickable on purpose: it counts Work Done
                whose every milestone reached a terminal PIC status, and no
                page can show exactly that set (list_work_done_rows has no
                "resolved only" mode). Routing it to Work Done would land on
                a list that disagrees with the number. */}
            <Stat label="Closed" value={sar(operational.closed_amount ?? 0)}
              sub={`${operational.closed_activities ?? 0} closed`} color="text-green"
              hint="Work Done whose every milestone reached a terminal PIC status. No drill-down list matches this set exactly, so it is not clickable." />
            {/* Empty planStatusFilter = all statuses, matching how the tile
                counts (it does not restrict plan_status). */}
            <Stat label="Re-Visits" value={fv(operational.revisits ?? 0)}
              color={(operational.revisits ?? 0) > 0 ? "text-amber" : ""}
              sub={(operational.revisits ?? 0) > 0 ? "Needs follow-up" : "None this period"}
              onClick={() => navigate("/execution", { state: { execFilters: { visitFilter: ["Re-Visit"], planStatusFilter: [], fromDate: range.from, toDate: range.to } } })} />
            <Stat label="Dummy POs" value={fv(operational.open_dummy_pos ?? 0)}
              color={(operational.open_dummy_pos ?? 0) > 0 ? "text-amber" : ""}
              sub={(operational.open_dummy_pos ?? 0) > 0 ? "Pending IM mapping" : "All mapped"}
              onClick={() => navigate("/planning", { state: { planScope: "open_dummy" } })} />
          </div>
        </Section>

        <Section title="INET Teams Performance" accent="inet">
          {/* Active teams count as a prominent header metric */}
          <div className="dash-section-metric">
            <span className="dash-section-metric-label">Active Teams</span>
            <span className="dash-section-metric-value text-green"
              style={{ cursor: "pointer" }}
              onClick={() => goTeams({ typeFilter: ["INET"], categoryFilter: ["Field Team"] })}>
              {fv(inet.active_inet_teams ?? 0)}
            </span>
          </div>
          <div className="dash-kpi-grid dash-kpi-grid--2">
            {/* Both are computed straight off the INET field-team list, so
                that list is the exact drill-down for them. */}
            <Stat label="Monthly Cost"         value={sar(inetMonthlyCost)}
              hint="Sum of each active INET team's daily cost x the days it was live in the range (capped at 30 - flat monthly salary). Click to see those teams."
              onClick={() => goTeams({ typeFilter: ["INET"], categoryFilter: ["Field Team"] })} />
            <Stat label="Monthly Target"       value={sar(inetMonthlyTarget)}
              hint="Monthly Cost x 1.25, i.e. cost plus a 25% margin. Click to see the teams it is built from."
              onClick={() => goTeams({ typeFilter: ["INET"], categoryFilter: ["Field Team"] })} />
            <Stat label="Target (as of today)"     value={sar(inetTargetToday)}
              hint={`Monthly Target scaled to the elapsed part of the range (${Number(company.day_progress_pct ?? 0).toFixed(1)}%).`} />
            <Stat label="Achieved"             value={sar(inetAchieved)} color="text-green"
              hint="Revenue from INET team execution only — excludes Sub-Con work and the teamless closes in the Direct Close section. Opens Work Done filtered to the INET teams; that page hides fully-invoiced work, so it lists fewer rows than this figure covers."
              onClick={(inet.team_names || []).length
                ? () => navigate("/work-done", { state: { workDoneFilters: { teamFilter: inet.team_names, fromDate: range.from, toDate: range.to } } })
                : undefined} />
            <Stat label="Gap (as of today)"        value={sar(inetGapToday)}
              color={inetGapToday >= 0 ? "text-green" : "text-red"}
              hint="Achieved minus Target (as of today). Positive = ahead of the time-adjusted target."
              sub={inetGapToday >= 0 ? "Ahead of target" : "Behind target"} />
            <Stat label="Profit / Loss (as of today)"  value={sar(inetProfitLossToday)}
              hint="Achieved minus the elapsed share of team cost."
              color={inetProfitLossToday >= 0 ? "text-green" : "text-red"} />
          </div>
          {/* Monthly achievement progress */}
          {(() => {
            const pct = inetMonthlyTarget > 0 ? Math.min(Math.round(inetAchieved / inetMonthlyTarget * 100), 100) : 0;
            const fillClass = pct >= 75 ? "green" : pct >= 40 ? "" : "red";
            return (
              <div className="dash-progress">
                <div className="dash-progress-label">
                  <span>Monthly Achievement</span>
                  <span>{pct}%</span>
                </div>
                <div className="dash-progress-track">
                  <div className={`dash-progress-fill ${fillClass}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })()}
        </Section>

          <Section title="Sub-Contractor" accent="sub">
            <div className="dash-section-metric">
              {/* Contracts, not teams: subcontracted work is identified by
                  the POID's contract link, so the count that matters is how
                  many subcontracts are active (payout > 0). */}
              <span className="dash-section-metric-label">Active Contracts</span>
              <span className="dash-section-metric-value text-green">
                {fv(subcon.active_sub_teams ?? 0)}
              </span>
            </div>
            <div className="dash-kpi-grid dash-kpi-grid--2">
              {/* Target is the sum of Rollout Plan target_amount across the
                  active SUB teams, so that team list is its drill-down.
                  Margin Target / INET Margin / Gap are derived arithmetic on
                  top and have no list of their own. */}
              <Stat label="Target"        value={sar(subcon.sub_target)}
                sub={(subcon.monthly_target ?? 0) > 0
                  ? `SAR ${fmt.format(subcon.monthly_target)}/month agreed`
                  : "not set on Subcontract Master"}
                hint="The monthly commitment agreed per subcontract, scaled to the months this range spans. A commercial figure, so it has to be entered — nothing in the data derives it. Opens Subcontract Master, where it is set."
                onClick={() => navigate("/masters?expand=" + encodeURIComponent("Subcontract Master"))} />
              <Stat label="Margin Target" value={sar(subcon.inet_margin_target_sub)}
                sub={(subcon.monthly_target ?? 0) > 0 ? undefined : "needs Monthly Target"}
                hint="Margin INET would retain if each contract hit its monthly target, at that contract's own agreed INET Margin %. Opens Subcontract Master, where both the target and the percentage are set."
                onClick={() => navigate("/masters?expand=" + encodeURIComponent("Subcontract Master"))} />
              {/* Filtered to the SUB teams this figure is computed from.
                  Without the team filter this landed on every Work Done row,
                  so a 0 tile opened a list with rows in it. */}
              <Stat label="Revenue"       value={sar(subcon.sub_revenue)}    color="text-green"
                sub={subcon.contracts_with_activity ? `${fv(subcon.contracts_with_activity)} contracts` : undefined}
                hint="Work Done revenue on POIDs whose contract is a subcontract (payout > 0). Opens Work Done filtered to those contracts; that page hides fully-invoiced work, so it lists fewer rows than this figure covers."
                onClick={(subcon.contract_names || []).length
                  ? () => navigate("/work-done", { state: { workDoneFilters: { subconFilter: subcon.contract_names, fromDate: range.from, toDate: range.to } } })
                  : undefined} />
              <Stat label="Expense"       value={sar(subcon.sub_expense)}
                hint="What INET owes the subcontractors: each line's revenue x its contract's sub_payout_pct, from Subcontract Master. No cost field is read — a SUB team has no daily cost."
                onClick={(subcon.contract_names || []).length
                  ? () => navigate("/work-done", { state: { workDoneFilters: { subconFilter: subcon.contract_names, fromDate: range.from, toDate: range.to } } })
                  : undefined} />
              <Stat label="INET Margin"   value={sar(subcon.inet_margin_sub)}
                hint="Revenue x each line's contract inet_margin_pct, from Subcontract Master."
                color={(subcon.inet_margin_sub ?? 0) >= 0 ? "text-green" : "text-red"}
                onClick={(subcon.contract_names || []).length
                  ? () => navigate("/work-done", { state: { workDoneFilters: { subconFilter: subcon.contract_names, fromDate: range.from, toDate: range.to } } })
                  : undefined} />
              <Stat label="Gap"           value={sar(subcon.sub_gap)}        color="text-red"
                hint="Target minus Revenue — how far this period's subcontract revenue is short of the agreed monthly commitment."
                onClick={(subcon.contract_names || []).length
                  ? () => navigate("/work-done", { state: { workDoneFilters: { subconFilter: subcon.contract_names, fromDate: range.from, toDate: range.to } } })
                  : undefined} />
            </div>
            {/* Sub-Con revenue vs target progress */}
            {(() => {
              const t = subcon.sub_target || 0;
              const r = subcon.sub_revenue || 0;
              const pct = t > 0 ? Math.min(Math.round(r / t * 100), 100) : 0;
              const fillClass = pct >= 75 ? "green" : pct >= 40 ? "" : "red";
              return (
                <div className="dash-progress">
                  <div className="dash-progress-label">
                    <span>Revenue vs Target</span>
                    <span>{pct}%</span>
                  </div>
                  <div className="dash-progress-track">
                    <div className={`dash-progress-fill ${fillClass}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })()}
          </Section>
      </div>

      {/* ── Row 2 — the teamless / support blocks. Three across so
             this row and the one above each sit at a uniform height,
             instead of one column running far longer than its
             neighbours. ── */}
      <div className="dash-mid-grid">

        <Section title="Teams Today" accent="teams">
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div className="dash-kpi-grid dash-kpi-grid--2" style={{ flex: 1 }}>
            <Stat label="Active Teams"  value={fv(ts.active ?? 0)} color="text-green"
              onClick={() => goTeams({})} />
            {/* today_status values on the Teams page are Planned /
                In Execution / Idle — see its statFilter handling. */}
            <Stat label="Planned"       value={fv(ts.teams_planned ?? 0)}
              onClick={() => goTeams({ statFilter: { field: "today_status", value: "Planned" } })} />
            <Stat label="In Progress"   value={fv(ts.in_progress ?? 0)} color="text-green"
              onClick={() => goTeams({ statFilter: { field: "today_status", value: "In Execution" } })} />
            <Stat label="Idle Teams"    value={fv(ts.idle ?? operational.idle_teams ?? 0)}
              color={(ts.idle ?? 0) > 0 ? "text-amber" : ""}
              onClick={() => goTeams({ statFilter: { field: "today_status", value: "Idle" } })} />
          </div>
          <div style={{ flexShrink: 0 }}>
            <DonutChart value={activePct} label="Working" size="sm" />
          </div>
        </div>
        </Section>

        {/* Direct Close — closes with no Rollout Plan, no Daily Execution
            and no team. Kept as its own section because every team block
            above is team-keyed and cannot see these by construction;
            folding them in would produce a team figure no team earned.
            These DO feed company Total Revenue. */}
        <Section title="Direct Close" accent="direct">
          <div className="dash-section-metric">
            <span className="dash-section-metric-label">Revenue (no team)</span>
            <span className="dash-section-metric-value text-green">
              {sar(direct_close.revenue ?? 0)}
            </span>
          </div>
          <div className="dash-kpi-grid dash-kpi-grid--3">
            <Stat label="Direct Close" value={sar(direct_close.revenue ?? 0)} color="text-green"
              sub={`${fv(direct_close.lines ?? 0)} lines · ${fv(direct_close.projects ?? 0)} projects`}
              hint="Work Done closed straight on the line by the IM — no plan, no execution, no team. Counts in company Total Revenue. Opens the Work Done page, which lists fewer rows because it hides fully-invoiced work."
              onClick={() => navigate("/work-done", { state: { workDoneFilters: { workTypeFilter: ["Direct Close"], fromDate: range.from, toDate: range.to } } })} />
            {/* Not clickable: the Work Done page can filter BY a
                subcontractor but cannot express "has one" / "has none", so
                neither of these has a destination that matches it. Linking
                them to the unfiltered list is what made a 0 tile open a
                list with rows in it. */}
            {/* Both drill through by CONTRACT: the page can filter by named
                contracts, so "subcontracted" is the list of payout>0
                contracts and "INET's own" the payout=0 ones. That is what
                makes these clickable at all — Work Done cannot express
                "has a subcontractor" / "has none" on its own. */}
            <Stat label="Via Sub-Con" value={sar(direct_close.sub_revenue ?? 0)}
              color={(direct_close.sub_revenue ?? 0) > 0 ? "text-amber" : ""}
              sub={`${fv(direct_close.sub_lines ?? 0)} of ${fv(direct_close.lines ?? 0)} lines`}
              hint="Direct closes whose POID sits on a subcontract (payout > 0). Opens Work Done filtered to those contracts."
              onClick={(direct_close.sub_contract_names || []).length
                ? () => navigate("/work-done", { state: { workDoneFilters: { subconFilter: direct_close.sub_contract_names, workTypeFilter: ["Direct Close"], fromDate: range.from, toDate: range.to } } })
                : undefined} />
            <Stat label="Via INET" value={sar(direct_close.inet_revenue ?? 0)} color="text-green"
              sub={`${fv(direct_close.inet_lines ?? 0)} of ${fv(direct_close.lines ?? 0)} lines`}
              hint="Direct closes on INET's own contracts (payout 0 / margin 100). Opens Work Done filtered to those contracts."
              onClick={(direct_close.inet_contract_names || []).length
                ? () => navigate("/work-done", { state: { workDoneFilters: { subconFilter: direct_close.inet_contract_names, workTypeFilter: ["Direct Close"], fromDate: range.from, toDate: range.to } } })
                : undefined} />
          </div>
        </Section>



        <Section title="Backend Teams" accent="backend">
          {/* Active team count as the header metric, the same shape INET
              Teams / Sub-Contractor / Direct Close use. It was a fourth tile
              before, which pushed the grid onto a second row and left two
              empty slots beside a lone card. */}
          <div className="dash-section-metric">
            <span className="dash-section-metric-label">Active Teams</span>
            <span className="dash-section-metric-value text-green"
              style={{ cursor: "pointer" }}
              onClick={() => goTeams({ categoryFilter: ["Backend Team"] })}>
              {fv(backend.active_teams ?? 0)}
            </span>
          </div>
          <div className="dash-kpi-grid dash-kpi-grid--3">
            <Stat label="Pending"       value={sar(backend.pending_value ?? 0)} color="text-amber"
              sub={`${backend.assigned_pending ?? 0} lines`}
              onClick={() => navigate("/backend")} />
            <Stat label="Completed MTD" value={sar(backend.completed_value ?? 0)} color="text-green"
              sub={`${backend.completed_mtd ?? 0} lines`}
              hint="Contracted PO line value for lines whose sub-contract completed in this range."
              onClick={() => navigate("/backend")} />
            {/* Backend closes recorded as Work Done — teamless like a
                direct close, but they belong to this section, not the
                Direct Close one. Different measure from Completed MTD:
                realized revenue, not contracted line value. */}
            <Stat label="Close Revenue" value={sar(backend.close_revenue ?? 0)} color="text-green"
              sub={`${fv(backend.close_lines ?? 0)} work done lines`}
              hint="Revenue from backend work closed without a field team. Counts in company Total Revenue. Opens the Work Done page, which lists fewer rows because it hides fully-invoiced work."
              onClick={() => navigate("/work-done", { state: { workDoneFilters: { workTypeFilter: ["Backend"], fromDate: range.from, toDate: range.to } } })} />
          </div>
        </Section>
      </div>

      {/* ── Bottom panels ────────────────────────────────────────── */}
      <div className="bottom-grid">

        <Section title="Top 5 Teams" accent="teams" onTitleClick={() => navigate("/reports?tab=top_teams")}>
          <MiniTable columns={teamCols} rows={teamRows} emptyText="No team data" />
        </Section>

        <Section title="IM Performance" accent="im" onTitleClick={() => navigate("/reports?tab=im_performance")}>
          <MiniTable columns={imCols} rows={im_performance || []} emptyText="No IM data" />
        </Section>

        <Section title="Action Watchlist" accent="watch">
          {(watchlist || []).length === 0 ? (
            <div style={{ padding: "16px 0", textAlign: "center", color: "var(--text-muted)", fontSize: "0.78rem" }}>
              No watchlist items
            </div>
          ) : (
            (watchlist || []).map((item, i) => (
              <div className="watchlist-item" key={i}>
                <span className={`watchlist-indicator ${dotColor(item.status)}`} />
                <div className="watchlist-info">
                  <div className="watchlist-name">{item.indicator}</div>
                  <div className="watchlist-detail">
                    Current: <span className="mono">{fmt.format(item.current)}</span>
                    {item.target !== null && item.target !== undefined && (
                      <> &middot; Target: <span className="mono">{fmt.format(item.target)}</span></>
                    )}
                  </div>
                </div>
                <span className={`watchlist-status ${statusClass(item.status)}`}>{item.status}</span>
              </div>
            ))
          )}
        </Section>

      </div>
    </div>
  );
}
