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
function Stat({ label, value, sub, color = "", onClick }) {
  return (
    <div
      className={`dash-stat${onClick ? " clickable" : ""}`}
      onClick={onClick}
      title={onClick ? `Go to ${label}` : undefined}
    >
      <div className="dash-stat-label">{label}</div>
      <div className={["dash-stat-value", color].filter(Boolean).join(" ")}>{value}</div>
      {sub && <div className="dash-stat-sub">{sub}</div>}
    </div>
  );
}

/* ── Section card wrapper ───────────────────────────────────────── */
function Section({ title, accent, children, style }) {
  return (
    <div className="dash-section" style={style}>
      <div className={`dash-section-hd dash-section-hd--${accent}`}>{title}</div>
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
    { label: "Team", key: "team_name" },
    { label: "Target", key: "target", align: "right" },
    { label: "Achieved", key: "achieved", align: "right", colorFn: (v) => v > 0 ? "text-green" : "" },
    {
      label: "Completion %", key: "_pct", align: "right",
      colorFn: (v) => v >= 80 ? "text-green" : v >= 40 ? "text-amber" : "text-red",
    },
  ];
  const teamRows = (top_teams || []).slice(0, 5).map((t) => ({
    ...t,
    _pct: t.target > 0 ? Math.round((t.achieved / t.target) * 100) : t.achieved > 0 ? 100 : 0,
  }));

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
      <div className="dash-header" style={{ display: "flex", alignItems: "center", gap: 16, padding: "12px 20px" }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 800, letterSpacing: "-0.2px" }}>
            Command Dashboard
          </h1>
          <div className="subtitle" style={{ justifyContent: "flex-start", marginTop: 3 }}>
            <span className="live-dot" />
            <span className="dash-timestamp">
              Last updated: {last_updated ? fmtTimestamp(last_updated) : "—"}
            </span>
          </div>
        </div>
        <DateRangePicker value={range} onChange={(r) => setRange({ from: r.from, to: r.to })} />
      </div>

      {/* ── Company Financial Summary ────────────────────────────── */}
      <Section title="Company Financial Summary" accent="company" style={{ marginBottom: 14 }}>
        <div className="dash-kpi-grid dash-kpi-grid--7">
          <Stat label="Total INET Target"  value={sar(company.company_target)} />
          <Stat label="Target as of Today" value={sar(company.total_target_today)} />
          <Stat label="Total Revenue"      value={sar(company.total_achieved)}   color="text-green" />
          <Stat label="Gap"                value={sar(company.company_gap)}
            color={(company.company_gap ?? 0) > 0 ? "text-red" : "text-green"} />
          <Stat label="Total Cost Today"   value={sar(company.total_cost_today)} />
          <Stat label="Profit / Loss"      value={sar(company.profit_loss)}
            color={profitColor(company.profit_loss)} />
          <Stat label="Coverage %"
            value={`${Number(company.coverage_pct ?? 0).toFixed(1)}%`}
            color={(company.coverage_pct ?? 0) >= 50 ? "text-green" : (company.coverage_pct ?? 0) >= 20 ? "text-amber" : "text-red"} />
        </div>
      </Section>

      {/* ── 3-column middle grid ────────────────────────────────── */}
      <div className="dash-mid-grid">

        {/* Col 1 — Operational Today */}
        <Section title="Operational Today" accent="ops">
          <div className="dash-kpi-grid dash-kpi-grid--2">
            <Stat label="Open PO Lines"  value={fv(operational.total_open_po_lines ?? 0)}
              onClick={() => navigate("/po-dump", { state: { poDumpFilters: { showOpen: true, showClosed: false, showCancelled: false } } })} />
            <Stat label="Open PO Value"  value={sar(operational.total_open_po_line_value ?? 0)}
              onClick={() => navigate("/po-dump", { state: { poDumpFilters: { showOpen: true, showClosed: false, showCancelled: false } } })} />
            <Stat label="Planned Activities" value={sar(operational.planned_amount ?? 0)}
              sub={`${operational.planned_activities ?? 0} plans`}
              onClick={() => navigate("/execution", { state: { execFilters: { planStatusFilter: ["Planned"] } } })} />
            <Stat label="Closed Activities" value={sar(operational.closed_amount ?? 0)}
              sub={`${operational.closed_activities ?? 0} closed`} color="text-green"
              onClick={() => navigate("/work-done", { state: { workDoneFilters: { fromDate: range.from, toDate: range.to, excludeBackend: true } } })} />
            <Stat label="Re-Visits" value={fv(operational.revisits ?? 0)}
              color={(operational.revisits ?? 0) > 0 ? "text-amber" : ""}
              sub={(operational.revisits ?? 0) > 0 ? "Needs follow-up" : "None this period"} />
            <Stat label="Dummy POs" value={fv(operational.open_dummy_pos ?? 0)}
              color={(operational.open_dummy_pos ?? 0) > 0 ? "text-amber" : ""}
              sub={(operational.open_dummy_pos ?? 0) > 0 ? "Pending IM mapping" : "All mapped"}
              onClick={() => navigate("/planning", { state: { planScope: "open_dummy" } })} />
          </div>
          <div className="dash-divider" />
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <div className="dash-kpi-grid dash-kpi-grid--2" style={{ flex: 1 }}>
              <Stat label="Active Teams"  value={fv(ts.active ?? 0)} color="text-green"
                onClick={() => goTeams({})} />
              <Stat label="Planned"       value={fv(ts.teams_planned ?? 0)} />
              <Stat label="In Progress"   value={fv(ts.in_progress ?? 0)} color="text-green" />
              <Stat label="Idle Teams"    value={fv(ts.idle ?? operational.idle_teams ?? 0)}
                color={(ts.idle ?? 0) > 0 ? "text-amber" : ""}
                onClick={() => goTeams({ statFilter: { field: "today_status", value: "Idle" } })} />
            </div>
            <div style={{ flexShrink: 0 }}>
              <DonutChart value={activePct} label="Working" size="sm" />
            </div>
          </div>
        </Section>

        {/* Col 2 — INET Teams */}
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
            <Stat label="Monthly Cost"         value={sar(inetMonthlyCost)} />
            <Stat label="Monthly Target"       value={sar(inetMonthlyTarget)} />
            <Stat label="Target as of Today"   value={sar(inetTargetToday)} />
            <Stat label="Achieved as of Today" value={sar(inetAchieved)} color="text-green" />
            <Stat label="Gap as of Today"      value={sar(inetGapToday)}
              color={inetGapToday >= 0 ? "text-green" : "text-red"}
              sub={inetGapToday >= 0 ? "Ahead of target" : "Behind target"} />
            <Stat label="Profit / Loss Today"  value={sar(inetProfitLossToday)}
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

        {/* Col 3 — Sub-Con + Backend stacked */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          <Section title="Sub-Contractor" accent="sub">
            <div className="dash-section-metric">
              <span className="dash-section-metric-label">Active Teams</span>
              <span className="dash-section-metric-value text-green"
                style={{ cursor: "pointer" }}
                onClick={() => goTeams({ typeFilter: ["SUB"] })}>
                {fv(subcon.active_sub_teams ?? 0)}
              </span>
            </div>
            <div className="dash-kpi-grid dash-kpi-grid--2">
              <Stat label="Target"        value={sar(subcon.sub_target)} />
              <Stat label="Margin Target" value={sar(subcon.inet_margin_target_sub)} />
              <Stat label="Revenue"       value={sar(subcon.sub_revenue)}    color="text-green" />
              <Stat label="Expense"       value={sar(subcon.sub_expense)} />
              <Stat label="INET Margin"   value={sar(subcon.inet_margin_sub)}
                color={(subcon.inet_margin_sub ?? 0) >= 0 ? "text-green" : "text-red"} />
              <Stat label="Gap"           value={sar(subcon.sub_gap)}        color="text-red" />
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

          <Section title="Backend Teams" accent="backend">
            <div className="dash-kpi-grid dash-kpi-grid--3">
              <Stat label="Active"        value={fv(backend.active_teams ?? 0)} color="text-green"
                onClick={() => goTeams({ categoryFilter: ["Backend Team"] })} />
              <Stat label="Pending"       value={sar(backend.pending_value ?? 0)} color="text-amber"
                sub={`${backend.assigned_pending ?? 0} lines`}
                onClick={() => navigate("/backend")} />
              <Stat label="Completed MTD" value={sar(backend.completed_value ?? 0)} color="text-green"
                sub={`${backend.completed_mtd ?? 0} lines`} />
            </div>
          </Section>

        </div>
      </div>

      {/* ── Bottom panels ────────────────────────────────────────── */}
      <div className="bottom-grid">

        <Section title="Top 5 Teams" accent="teams">
          <MiniTable columns={teamCols} rows={teamRows} emptyText="No team data" />
        </Section>

        <Section title="IM Performance" accent="im">
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
