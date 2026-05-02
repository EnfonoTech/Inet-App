import { useEffect, useState, useRef } from "react";
import { pmApi } from "../../services/api";
import KPICard from "../../components/KPICard";
import MiniTable from "../../components/MiniTable";
import { BarChart, DonutChart } from "../../components/Charts";
import DateRangePicker, { DATE_PRESETS } from "../../components/DateRangePicker";

/* ── Helpers ───────────────────────────────────────────────── */

const fmt = new Intl.NumberFormat("en-US");

function fmtTimestamp(ts) {
  if (!ts) return "";
  const d = new Date(String(ts).replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return String(ts);
  const day = d.getDate();
  const mon = d.toLocaleString("en-US", { month: "short" });
  const year = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${day} ${mon} ${year} · ${hh}:${mm}`;
}

/** Map watchlist status string to CSS class */
function statusClass(status) {
  const s = (status || "").toLowerCase();
  if (s === "optimized") return "status-optimized";
  if (s === "recover" || s === "monitor") return "status-recover";
  if (s === "behind") return "status-behind";
  if (s === "ahead") return "status-ahead";
  return "status-normal";
}

/** Map watchlist status to indicator dot color */
function dotColor(status) {
  const s = (status || "").toLowerCase();
  if (s === "optimized") return "green";
  if (s === "recover" || s === "monitor") return "red";
  if (s === "behind") return "amber";
  if (s === "ahead") return "blue";
  return "amber";
}

/** Profit color helper */
function profitColor(v) {
  if (v === null || v === undefined) return "";
  return v < 0 ? "text-red" : v > 0 ? "text-green" : "";
}

/* ── Shimmer Loading State ─────────────────────────────────── */

function ShimmerRow() {
  return (
    <div className="kpi-row" style={{ marginBottom: 8 }}>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="shimmer-block" style={{ height: 80, borderRadius: 8 }} />
      ))}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="dashboard">
      <div className="dash-header shimmer" style={{ height: 80 }} />
      <ShimmerRow />
      <ShimmerRow />
      <ShimmerRow />
      <ShimmerRow />
    </div>
  );
}

/* ── Main Dashboard ────────────────────────────────────────── */

/** Default range = This Month (matches the pre-existing backend default). */
function defaultRange() {
  const r = DATE_PRESETS.this_month.range(new Date());
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { from: iso(r.from), to: iso(r.to) };
}

export default function CommandDashboard() {
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
      // Server short-circuits with {unchanged: true} when underlying data
      // hasn't moved since our last poll — keep current state, just bump
      // last_updated so the timestamp UI doesn't lie.
      if (res && res.unchanged) {
        setData((prev) => (prev ? { ...prev, last_updated: res.last_updated } : prev));
      } else {
        setData(res);
      }
    } catch (err) {
      console.error("Command Dashboard fetch error:", err);
      setFetchError(err.message || "Failed to load dashboard");
      setData((prev) => prev);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData(range);
    // Dashboards refresh every 5 minutes so KPIs stay current without manual
    // clicks. List pages stay manual — surprise re-fetches there interrupt
    // long edit sessions.
    intervalRef.current = setInterval(() => fetchData(range), 5 * 60_000);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to]);

  if (loading && !data) return <LoadingState />;

  if (!data) {
    return (
      <div className="dashboard">
        <div className="notice error" style={{ margin: "24px 28px" }}>
          <span>⚠</span> {fetchError || "Dashboard could not be loaded."}
          {" "}
          <button
            type="button"
            className="btn-secondary"
            style={{ marginLeft: 12 }}
            onClick={() => {
              setLoading(true);
              fetchData();
            }}
          >
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

  /* ── Top 5 Teams table config ────────────────────────────── */
  const top5 = (top_teams || []).slice(0, 5);
  const teamCols = [
    { label: "Team", key: "team_name" },
    { label: "Target", key: "target", align: "right" },
    { label: "Achieved", key: "achieved", align: "right", colorFn: (v) => (v > 0 ? "text-green" : "") },
    {
      label: "Completion %",
      key: "_pct",
      align: "right",
      colorFn: (v) => (v >= 80 ? "text-green" : v >= 40 ? "text-amber" : "text-red"),
    },
  ];
  const teamRows = top5.map((t) => ({
    ...t,
    _pct: t.target > 0 ? Math.round((t.achieved / t.target) * 100) : t.achieved > 0 ? 100 : 0,
  }));

  /* ── IM Performance table config ─────────────────────────── */
  const imCols = [
    { label: "IM", key: "im" },
    { label: "Teams", key: "teams", align: "right" },
    { label: "Revenue", key: "revenue", align: "right", colorFn: (v) => (v > 0 ? "text-green" : "") },
    { label: "Cost", key: "team_cost", align: "right" },
    { label: "Profit", key: "profit", align: "right", colorFn: (v) => profitColor(v) },
  ];

  /* ── Team Status charts ──────────────────────────────────── */
  const ts = team_status || {};
  const totalTeams = (ts.active || 0) + (ts.idle || 0);
  const activePct = totalTeams > 0 ? Math.round(((ts.active || 0) / totalTeams) * 100) : 0;
  const statusBars = [
    { label: "Active", value: ts.active || 0, color: "green" },
    { label: "Idle", value: ts.idle || 0, color: "amber" },
    { label: "Planned", value: ts.planned || 0, color: "" },
    { label: "In Progress", value: ts.in_progress || 0, color: "green" },
  ];


  return (
    <div className="dashboard">
      {/* ── Header ──────────────────────────────────────────── */}
      <div className="dash-header" style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h1 style={{ margin: 0 }}>INet Telecom Operations Command Dashboard</h1>
          <div className="subtitle">
            <span className="live-dot" />
            <span className="dash-timestamp">Last updated: {last_updated ? fmtTimestamp(last_updated) : "—"}</span>
          </div>
        </div>
        <DateRangePicker
          value={range}
          onChange={(r) => setRange({ from: r.from, to: r.to })}
        />
      </div>

      {/* ── Row 1: Operational Overview ─────────────────────── */}
      <div className="section-label">Operational Overview</div>
      <div className="kpi-row kpi-row-top">
        <KPICard label="Open PO lines" value={operational.total_open_po_lines ?? 0} />
        <KPICard label="Open PO line value (SAR)" value={operational.total_open_po_line_value ?? operational.total_open_po ?? 0} />
        <KPICard label="Idle Teams" value={operational.idle_teams} colorClass="text-amber" />
        <KPICard label="Planned Activities" value={operational.planned_activities} />
        <KPICard label="Closed Activities" value={operational.closed_activities} colorClass="text-green" />
        <KPICard label="ReVisits" value={operational.revisits} colorClass="text-amber" />
      </div>

      {/* ── Row 2: INET Teams Performance ──────────────────── */}
      <div className="section-label">INET Teams Performance</div>
      <div className="kpi-row kpi-row-inet">
        <KPICard label="Active Teams" value={inet.active_inet_teams} colorClass="text-green" />
        <KPICard label="Monthly Cost" value={inet.inet_monthly_cost} />
        <KPICard label="Monthly Target" value={inet.inet_monthly_target} />
        <KPICard label="Target Today" value={inet.inet_target_today} />
        <KPICard label="Achieved" value={inet.inet_achieved} colorClass="text-green" />
        <KPICard label="Gap Today" value={inet.inet_gap_today} colorClass="text-red" />
      </div>

      {/* ── Row 3: Subcontractor Performance ───────────────── */}
      <div className="section-label">Subcontractor Performance</div>
      <div className="kpi-row kpi-row-sub">
        <KPICard label="Sub Teams" value={subcon.active_sub_teams} colorClass="text-green" />
        <KPICard label="Target" value={subcon.sub_target} />
        <KPICard label="Revenue" value={subcon.sub_revenue} colorClass="text-green" />
        <KPICard label="Expense" value={subcon.sub_expense} />
        <KPICard label="INET Margin" value={subcon.inet_margin_sub} colorClass={(subcon.inet_margin_sub ?? 0) >= 0 ? "text-green" : "text-red"} />
        <KPICard label="Gap" value={subcon.sub_gap} colorClass="text-red" />
      </div>

      {/* ── Row 3b: Backend Teams ──────────────────────────── */}
      <div className="section-label">Backend Teams</div>
      <div className="kpi-row kpi-row-backend">
        <KPICard label="Active Teams" value={backend.active_teams ?? 0} colorClass="text-green" />
        <KPICard label="Pending" value={backend.assigned_pending ?? 0} colorClass="text-amber" />
        <KPICard label="Completed" value={backend.completed_mtd ?? 0} colorClass="text-green" />
      </div>

      {/* ── Row 4: Company Financial Summary ───────────────── */}
      <div className="section-label">Company Financial Summary</div>
      <div className="kpi-row kpi-row-company">
        <KPICard label="Company Target" value={company.company_target} />
        <KPICard label="Achieved" value={company.total_achieved} colorClass="text-green" />
        <KPICard label="Gap" value={company.company_gap} colorClass="text-red" />
        <KPICard label="Total Cost" value={company.total_cost} />
        <KPICard label="Profit / Loss" value={company.profit_loss} colorClass={(company.profit_loss ?? 0) >= 0 ? "text-green" : "text-red"} />
        <KPICard label="Coverage %" value={`${Number(company.coverage_pct ?? 0).toFixed(1)}%`} colorClass={(company.coverage_pct ?? 0) >= 50 ? "text-green" : (company.coverage_pct ?? 0) >= 20 ? "text-amber" : "text-red"} />
      </div>

      {/* ── Bottom Grid: 4 Panels ──────────────────────────── */}
      <div className="bottom-grid">
        {/* Panel 1: Top 5 Teams */}
        <div className="panel panel--teams">
          <div className="panel-header">
            <h3>Top 5 Teams</h3>
          </div>
          <div className="panel-body">
            <MiniTable columns={teamCols} rows={teamRows} emptyText="No team data" />
          </div>
        </div>

        {/* Panel 2: IM Performance */}
        <div className="panel panel--im">
          <div className="panel-header">
            <h3>IM Performance</h3>
          </div>
          <div className="panel-body">
            <MiniTable columns={imCols} rows={im_performance || []} emptyText="No IM data" />
          </div>
        </div>

        {/* Panel 3: Team Status */}
        <div className="panel panel--status">
          <div className="panel-header">
            <h3>Team Status</h3>
          </div>
          <div className="panel-body" style={{ display: "flex", gap: 16, alignItems: "center" }}>
            <div style={{ flex: 1 }}>
              <BarChart bars={statusBars} />
            </div>
            <DonutChart value={activePct} label="Active" />
          </div>
        </div>

        {/* Panel 4: Action Watchlist */}
        <div className="panel panel--watch">
          <div className="panel-header">
            <h3>Action Watchlist</h3>
          </div>
          <div className="panel-body">
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
                  <span className={`watchlist-status ${statusClass(item.status)}`}>
                    {item.status}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
