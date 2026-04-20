import { useEffect, useState } from "react";
import { pmApi } from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import KPICard from "../../components/KPICard";
import { BarChart, DonutChart } from "../../components/Charts";
import DateRangePicker, { DATE_PRESETS } from "../../components/DateRangePicker";

function defaultRange() {
  const r = DATE_PRESETS.this_month.range(new Date());
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { from: iso(r.from), to: iso(r.to) };
}

function LoadingState() {
  return (
    <div className="dashboard">
      <div className="dash-header shimmer" style={{ height: 80 }} />
      <div className="kpi-row" style={{ marginBottom: 8 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="shimmer-block" style={{ height: 80, borderRadius: 8 }} />
        ))}
      </div>
    </div>
  );
}

export default function IMDashboard() {
  const { imName } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [range, setRange] = useState(defaultRange);

  async function loadData(r = range) {
    setError(null);
    try {
      // Always call — backend resolves the IM even if imName is null/wrong
      const result = await pmApi.getIMDashboard(imName, { from_date: r.from, to_date: r.to });
      setData(result);
    } catch (err) {
      setError(err.message || "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imName, range.from, range.to]);

  if (loading) return <LoadingState />;

  if (error) {
    return (
      <div className="dashboard">
        <div className="notice error" style={{ margin: "24px 28px" }}>
          <span>⚠</span> {error}
          {" "}
          <button type="button" className="btn-secondary" style={{ marginLeft: 12 }} onClick={() => { setLoading(true); loadData(); }}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="dashboard">
        <div className="notice error" style={{ margin: "24px 28px" }}>
          <span>⚠</span> No dashboard payload.
          {" "}
          <button type="button" className="btn-secondary" style={{ marginLeft: 12 }} onClick={() => { setLoading(true); loadData(); }}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  const kpis = data?.kpi || data?.kpis || {};
  const message = data?.message || null;
  const action = data?.action_items || {};
  /* Always define these — get_im_dashboard returns them; stale bundles or partial edits
   * must not hit a bare `projects` / `teams` ReferenceError in render. */
  const teams = Array.isArray(data?.teams) ? data.teams : [];
  const projects = Array.isArray(data?.projects) ? data.projects : [];

  const monthPct = (() => {
    const target = kpis.monthly_target || 0;
    const rev = kpis.revenue || 0;
    if (!target) return 0;
    return Math.round(Math.min(100, Math.max(0, (rev / target) * 100)));
  })();

  const todayPct = (() => {
    const target = kpis.target_today || 0;
    const rev = kpis.revenue || 0;
    if (!target) return 0;
    return Math.round(Math.min(100, Math.max(0, (rev / target) * 100)));
  })();

  const financeBars = [
    { label: "Target", value: Math.round(kpis.monthly_target || 0), color: "" },
    { label: "Revenue", value: Math.round(kpis.revenue || 0), color: "green" },
    { label: "Cost", value: Math.round(kpis.cost || 0), color: "amber" },
    { label: "Profit", value: Math.round(kpis.profit || 0), color: (kpis.profit || 0) >= 0 ? "green" : "red" },
  ];

  const actionBars = [
    { label: "Pending", value: action.pending_plan_dispatches || 0, color: "amber" },
    { label: "QC Fail", value: action.qc_fail_needs_action || 0, color: (action.qc_fail_needs_action || 0) > 0 ? "red" : "green" },
    { label: "Ready", value: action.planned_ready_execution || 0, color: "blue" },
  ];

  return (
    <div className="dashboard">
      {/* ── Header ──────────────────────────────────────────── */}
      <div className="dash-header" style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h1 style={{ margin: 0 }}>My Dashboard</h1>
          <div className="subtitle">
          <span style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
            {data?.im || imName || "Installation Manager"}
            {(teams.length > 0 || projects.length > 0) && (
              <span style={{ marginLeft: 10, opacity: 0.9 }}>
                · {teams.length} team{teams.length !== 1 ? "s" : ""} · {projects.length} project
                {projects.length !== 1 ? "s" : ""}
              </span>
            )}
          </span>
          </div>
        </div>
        <DateRangePicker
          value={range}
          onChange={(r) => setRange({ from: r.from, to: r.to })}
        />
      </div>

      {/* ── Backend message ─────────────────────────────────── */}
      {message && (
        <div className="notice" style={{ margin: "0 28px 12px", borderColor: "#fbbf24", background: "rgba(251,191,36,0.08)" }}>
          <span>ℹ</span> {message}
        </div>
      )}

      {/* ── KPI Row ─────────────────────────────────────────── */}
      <div className="section-label">INET Teams Performance</div>
      <div className="kpi-row kpi-row-inet">
        <KPICard label="Monthly Target" value={kpis.monthly_target || 0} />
        <KPICard label="Target Today" value={kpis.target_today || 0} />
        <KPICard label="Achieved" value={kpis.revenue || 0} colorClass="text-green" />
        <KPICard label="Gap Today" value={kpis.gap_today || 0} colorClass={(kpis.gap_today || 0) <= 0 ? "text-green" : "text-red"} />
        <KPICard label="Active Teams" value={kpis.active_teams_today || 0} colorClass="text-green" />
        <KPICard label="Planned Activities" value={kpis.planned_activities || 0} />
      </div>

      {/* ── Action strip (PM-like) ─────────────────────────── */}
      <div className="section-label">Action Items</div>
      <div className="kpi-row kpi-row-top" style={{ marginBottom: 10 }}>
        <KPICard label="Pending Dispatches" value={action.pending_plan_dispatches || 0} colorClass={(action.pending_plan_dispatches || 0) > 0 ? "text-amber" : ""} />
        <KPICard label="QC Fail Needs Action" value={action.qc_fail_needs_action || 0} colorClass={(action.qc_fail_needs_action || 0) > 0 ? "text-red" : "text-green"} />
        <KPICard label="Ready to Execute" value={action.planned_ready_execution || 0} />
      </div>

      {/* ── Charts ─────────────────────────────────────────── */}
      <div className="section-label">Charts</div>
      <div className="bottom-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <div className="panel">
          <div className="panel-header">
            <h3>Month completion</h3>
          </div>
          <div className="panel-body" style={{ display: "flex", justifyContent: "center", padding: 18 }}>
            <DonutChart value={monthPct} label="This month" />
          </div>
        </div>
        <div className="panel">
          <div className="panel-header">
            <h3>Today completion</h3>
          </div>
          <div className="panel-body" style={{ display: "flex", justifyContent: "center", padding: 18 }}>
            <DonutChart value={todayPct} label="Today" />
          </div>
        </div>
        <div className="panel">
          <div className="panel-header">
            <h3>Action items</h3>
          </div>
          <div className="panel-body">
            <BarChart bars={actionBars} />
          </div>
        </div>
      </div>

      <div className="bottom-grid" style={{ gridTemplateColumns: "1fr" }}>
        <div className="panel">
          <div className="panel-header">
            <h3>Financial snapshot</h3>
            <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
              Updated {data?.last_updated ? String(data.last_updated) : ""}
            </span>
          </div>
          <div className="panel-body">
            <BarChart bars={financeBars} />
          </div>
        </div>
      </div>
    </div>
  );
}
