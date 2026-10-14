import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { pmApi } from "../../services/api";
import MiniTable from "../../components/MiniTable";
import { BarChart, DonutChart } from "../../components/Charts";
import DateRangePicker, { DATE_PRESETS } from "../../components/DateRangePicker";
import DashboardSwitcher from "../../components/DashboardSwitcher";
import { money } from "../../utils/numberFormat";

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

// Format as SAR; negatives shown as (SAR 123). Not rounded — Math.round
// here discarded the halalas on every money tile on this dashboard.
function sar(v) {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  const s = `SAR ${money.format(Math.abs(n))}`;
  return n < 0 ? `(${s})` : s;
}

// Watchlist rows mix units: pick the formatter the row declares.
function wlFmt(item) {
  return item?.unit === "sar" ? money : fmt;
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

  // Subcon PO, carrying the customer-invoice window these tiles were built
  // on. The page's own from/to is the SUPPLIER PO date — a different
  // question — so the window travels under its own keys.
  function goSubconPO() {
    // "all": these tiles count every stage, so landing on To Order would show
    // a fraction of the money they just reported.
    navigate("/pic-subcon-po", {
      state: { subconFilters: { invoiceFrom: range.from, invoiceTo: range.to, tab: "all" } },
    });
  }

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
  const inetCostToday       = inet.inet_cost_today ?? 0;
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
              plus the SUB contracts' own full targets), so the team list is
              its drill-down. Its pro-rated twin and the gap/coverage figures
              beside it are arithmetic on top and have no list of their own. */}
          <Stat label="Total Target"  value={sar(company.company_target)}
            hint="What the company has committed to earn this period: the field teams' cost plus 25%, and each subcontract's agreed monthly target. Click to see the teams."
            onClick={() => goTeams({})} />
          <Stat label="Target (as of today)"   value={sar(company.total_target_today)}
            hint={`The share of the target that falls in the ${Number(company.day_progress_pct ?? 0).toFixed(1)}% of the period gone so far, so earnings to date are compared fairly.`} />
          {/* True gross top-line: every SAR of work recognized this period,
              INET's own and subcontracted alike, at full value — including
              the share that's owed out to the subcontractor. Target, Gap and
              Coverage % are all measured against this same gross figure. */}
          <Stat label="Total Revenue"      value={sar(company.total_revenue)}   color="text-green"
            hint="Everything earned this period. The sections below add up to exactly this figure. Our own work counts on the day it is done; subcontracted work counts on the day the customer is invoiced, so its cost lands in the same month as its income." />
          <Stat label="Gap"                value={sar(company.company_gap)}
            hint="How far the company is short of its target for the period."
            color={(company.company_gap ?? 0) > 0 ? "text-red" : "text-green"} />
          <Stat label="Cost (as of today)"     value={sar(company.total_cost_today)}
            hint={`Field-team salary for the ${Number(company.day_progress_pct ?? 0).toFixed(1)}% of the period gone so far, plus what is owed to subcontractors on the work invoiced in it. Click to see the teams.`}
            onClick={() => goTeams({})} />
          <Stat label="Profit / Loss"      value={sar(company.profit_loss)}
            hint="What is left after the costs beside it — the company's margin for the period."
            color={profitColor(company.profit_loss)} />
          <Stat label="Coverage %"
            value={`${Number(company.coverage_pct ?? 0).toFixed(1)}%`}
            hint="How much of the target has been earned so far."
            color={(company.coverage_pct ?? 0) >= 50 ? "text-green" : (company.coverage_pct ?? 0) >= 20 ? "text-amber" : "text-red"} />
        </div>
      </Section>

      {/* ── 3-column middle grid ────────────────────────────────── */}
      <div className="dash-mid-grid">

        {/* Col 1 — Operational Today */}
        <Section title="Operational Today" accent="ops">
          <div className="dash-kpi-grid dash-kpi-grid--2">
            {/* A backlog, not a flow: the whole open order book as it stands
                at the END of the range, with no start bound. Only the range's
                end date applies, and only to whether a line had been
                published yet (COALESCE(publish_date, start_date, creation) —
                the same basis the PO-vs-Invoice trend buckets by, since
                publish_date lands on only a minority of lines). */}
            <Stat label="Open PO Lines"  value={fv(operational.total_open_po_lines ?? 0)}
              hint="Every PO line still open, as it stood at the end of the selected period — not only the lines published inside it. Click to see them."
              onClick={() => navigate("/po-dump", { state: { poDumpFilters: { showOpen: true, showClosed: false, showCancelled: false } } })} />
            <Stat label="Open PO Value"  value={sar(operational.total_open_po_line_value ?? 0)}
              hint="Value of those open lines — the whole order book still to deliver. Click to see them."
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
              hint="Lines whose billing is finished — every milestone closed." />
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
          {/* The teams this section's money is built from — every team on the
              payroll during the range, not the status headcount. Those two
              differ: a team On Vacation or marked Inactive is still paid, so
              "Active Teams: 15" sat above a cost built from 17 and the
              arithmetic underneath it did not work. The status count is still
              shown, as the smaller half of the same line. Drill-through
              matches: every status except Disbanded, which is the one that
              stops costing. */}
          <div className="dash-section-metric">
            <span className="dash-section-metric-label">Teams on Payroll</span>
            <span className="dash-section-metric-value text-green"
              style={{ cursor: "pointer" }}
              title={`The teams Monthly Cost is built from. ${fv(inet.active_inet_teams ?? 0)} are Active; the rest are on vacation or inactive and still paid. A Disbanded team is excluded.`}
              onClick={() => goTeams({ typeFilter: ["INET"], categoryFilter: ["Field Team"], statusFilter: ["Active", "On Vacation", "Inactive"] })}>
              {fv(inet.inet_cost_teams ?? inet.active_inet_teams ?? 0)}
              {(inet.inet_paid_not_active ?? 0) > 0 && (
                <span style={{ fontSize: "0.62rem", fontWeight: 600, color: "var(--text-muted)", marginLeft: 6 }}>
                  {fv(inet.active_inet_teams ?? 0)} active
                </span>
              )}
            </span>
          </div>
          <div className="dash-kpi-grid dash-kpi-grid--2">
            {/* Both are computed straight off the INET field-team list, so
                that list is the exact drill-down for them. */}
            <Stat label="Monthly Cost"         value={sar(inetMonthlyCost)}
              hint="What the field teams cost for the period. A full month is one month's salary, however many days it has. Click to see the teams."
              onClick={() => goTeams({ typeFilter: ["INET"], categoryFilter: ["Field Team"] })} />
            <Stat label="Monthly Target"       value={sar(inetMonthlyTarget)}
              hint="What the field teams need to earn: their cost plus 25%. Click to see the teams."
              onClick={() => goTeams({ typeFilter: ["INET"], categoryFilter: ["Field Team"] })} />
            {/* The cost side of the same pro-rated pair, and what Profit /
                Loss below is built from — it was the one term in this section
                with no tile of its own. */}
            <Stat label="Cost (as of today)"       value={sar(inetCostToday)}
              hint={`What the field teams have cost for the ${Number(company.day_progress_pct ?? 0).toFixed(1)}% of the period gone so far. Click to see the teams.`}
              onClick={() => goTeams({ typeFilter: ["INET"], categoryFilter: ["Field Team"] })} />
            <Stat label="Target (as of today)"     value={sar(inetTargetToday)}
              hint={`The share of the target that falls in the ${Number(company.day_progress_pct ?? 0).toFixed(1)}% of the period gone so far.`} />
            <Stat label="Achieved"             value={sar(inetAchieved)} color="text-green"
              hint="Earned by our own field teams this period, counted on the day the work was done. Subcontracted work and closes with no team are shown in their own sections. Click to see the work."
              onClick={(inet.team_names || []).length
                ? () => navigate("/work-done", { state: { workDoneFilters: { teamFilter: inet.team_names, fromDate: range.from, toDate: range.to } } })
                : undefined} />
            <Stat label="Gap (as of today)"        value={sar(inetGapToday)}
              color={inetGapToday >= 0 ? "text-green" : "text-red"}
              hint="How far ahead of, or behind, the target for the days gone so far."
              sub={inetGapToday >= 0 ? "Ahead of target" : "Behind target"} />
            <Stat label="Profit / Loss (as of today)"  value={sar(inetProfitLossToday)}
              hint="What the field teams earned, less what they cost, for the days gone so far."
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
                  ? `SAR ${money.format(subcon.monthly_target)}/month agreed`
                  : "not set on Subcontract Master"}
                hint="The monthly amount agreed with each subcontractor, for the months this period covers. It is a commercial figure and has to be entered. Click to set it."
                onClick={() => navigate("/masters?expand=" + encodeURIComponent("Subcontract Master"))} />
              <Stat label="Margin Target" value={sar(subcon.inet_margin_target_sub)}
                sub={(subcon.monthly_target ?? 0) > 0 ? undefined : "needs Monthly Target"}
                hint="What we would keep if every subcontract met its monthly target. Click to set the targets."
                onClick={() => navigate("/masters?expand=" + encodeURIComponent("Subcontract Master"))} />
              {/* Filtered to the SUB teams this figure is computed from.
                  Without the team filter this landed on every Work Done row,
                  so a 0 tile opened a list with rows in it. */}
              <Stat label="Revenue"       value={sar(subcon.sub_revenue)}    color="text-green"
                sub={subcon.contracts_with_activity ? `${fv(subcon.contracts_with_activity)} contracts` : undefined}
                hint="Value of subcontracted work invoiced to the customer this period. Click to see those lines; the page shows the same total."
                onClick={goSubconPO} />
              <Stat label="Expense"       value={sar(subcon.sub_expense)}
                hint="What we owe the subcontractors for the work invoiced this period — the supplier PO amount where one has been raised, the agreed share otherwise. Click to see those lines; the page shows the same total."
                onClick={goSubconPO} />
              <Stat label="INET Margin"   value={sar(subcon.inet_margin_sub)}
                hint="Our share of that same invoiced work, at each contract's agreed percentage."
                color={(subcon.inet_margin_sub ?? 0) >= 0 ? "text-green" : "text-red"}
                onClick={goSubconPO} />
              <Stat label="Gap"           value={sar(subcon.sub_gap)}        color="text-red"
                hint="How far subcontract revenue is short of the agreed monthly commitment."
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
              hint="Work closed directly on the line by the IM, with no plan and no team. Shown in full here; the two tiles beside it say how much is ours and how much is subcontracted. Click to see the work."
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
              hint="The subcontracted part. It is counted in Total Revenue through the Sub-Con section, on the day the customer is invoiced, so it is not added again here. Click to see the work."
              onClick={(direct_close.sub_contract_names || []).length
                ? () => navigate("/work-done", { state: { workDoneFilters: { subconFilter: direct_close.sub_contract_names, workTypeFilter: ["Direct Close"], fromDate: range.from, toDate: range.to } } })
                : undefined} />
            <Stat label="Via INET" value={sar(direct_close.inet_revenue ?? 0)} color="text-green"
              sub={`${fv(direct_close.inet_lines ?? 0)} of ${fv(direct_close.lines ?? 0)} lines`}
              hint="Our own part, which counts in Total Revenue on the day it was closed. Click to see the work."
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
            {/* Pending was here. Dropped in favour of the INET / Sub-Con
                split below: which side of a close the money belongs to
                decides whether it counts in Total Revenue, and nothing on
                screen said so. The pending order book is still a click away
                on the Backend page. */}
            {/* Completed MTD was here, next to Pending. Both were order-book
                measures — contracted line value dated by subcon_completed_on
                — sitting beside realized revenue on a different date basis,
                which is what made the section hard to read. The three that
                remain are one measure and its two parts, exactly like the
                Direct Close section. Both old figures are on the Backend
                page. */}
            {/* Backend closes recorded as Work Done — teamless like a
                direct close, but they belong to this section, not the
                Direct Close one. Different measure from Completed MTD:
                realized revenue, not contracted line value. */}
            <Stat label="Close Revenue" value={sar(backend.close_revenue ?? 0)} color="text-green"
              sub={`${fv(backend.close_lines ?? 0)} work done lines`}
              hint="Backend work closed without a field team. Shown in full here; the two tiles beside it say how much is ours and how much is subcontracted. Click to see the work."
              onClick={() => navigate("/work-done", { state: { workDoneFilters: { workTypeFilter: ["Backend"], fromDate: range.from, toDate: range.to } } })} />
            {/* The same two tiles the Direct Close section carries, built
                from the same split, so both teamless channels read alike. */}
            <Stat label="Via Sub-Con" value={sar(backend.close_sub_revenue ?? 0)}
              color={(backend.close_sub_revenue ?? 0) > 0 ? "text-amber" : ""}
              sub={`${fv(backend.close_sub_lines ?? 0)} of ${fv(backend.close_lines ?? 0)} lines`}
              hint="The subcontracted part. It is counted in Total Revenue through the Sub-Con section, on the day the customer is invoiced, so it is not added again here. Click to see the work."
              onClick={(backend.sub_contract_names || []).length
                ? () => navigate("/work-done", { state: { workDoneFilters: { subconFilter: backend.sub_contract_names, workTypeFilter: ["Backend"], fromDate: range.from, toDate: range.to } } })
                : undefined} />
            <Stat label="Via INET" value={sar(backend.close_inet_revenue ?? 0)} color="text-green"
              sub={`${fv(backend.close_inet_lines ?? 0)} of ${fv(backend.close_lines ?? 0)} lines`}
              hint="Our own part, which counts in Total Revenue on the day it was closed. Click to see the work."
              onClick={(backend.inet_contract_names || []).length
                ? () => navigate("/work-done", { state: { workDoneFilters: { subconFilter: backend.inet_contract_names, workTypeFilter: ["Backend"], fromDate: range.from, toDate: range.to } } })
                : undefined} />
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
                  {/* `current`/`target` are SAR on the revenue-gap rows and a
                      plain count on the QC/idle-team rows, so the row's own
                      `unit` picks the formatter. Formatting both the same way
                      either dropped halalas off a gap or printed "3.00" idle
                      teams. */}
                  <div className="watchlist-detail">
                    Current: <span className="mono">{wlFmt(item).format(item.current)}</span>
                    {item.target !== null && item.target !== undefined && (
                      <> &middot; Target: <span className="mono">{wlFmt(item).format(item.target)}</span></>
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
