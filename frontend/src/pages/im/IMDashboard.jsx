import { useEffect, useState } from "react";
import { pmApi } from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import KPICard from "../../components/KPICard";
import { BarChart, DonutChart } from "../../components/Charts";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

function statusTone(status) {
  const s = String(status || "").toLowerCase();
  if (s.includes("risk")) return "red";
  if (s.includes("hold")) return "amber";
  if (s.includes("active")) return "green";
  return "blue";
}

function StatusBadge({ status }) {
  const tone = statusTone(status);
  const styles = {
    red:   { bg: "#fef2f2", fg: "#991b1b", bd: "#fecaca" },
    amber: { bg: "#fffbeb", fg: "#92400e", bd: "#fde68a" },
    green: { bg: "#ecfdf5", fg: "#065f46", bd: "#a7f3d0" },
    blue:  { bg: "#eff6ff", fg: "#1e40af", bd: "#bfdbfe" },
  }[tone];

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 10px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 800,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        background: styles.bg,
        color: styles.fg,
        border: `1px solid ${styles.bd}`,
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 999, background: styles.fg, opacity: 0.7 }} />
      {status || "—"}
    </span>
  );
}

function SetupGuide({ debug, imName }) {
  const resolved    = debug?.im_resolved || imName || "—";
  const identifiers = debug?.im_identifiers || [resolved];
  const teamsFound  = debug?.teams_found ?? 0;
  const projectsFound = debug?.projects_found ?? 0;

  return (
    <div style={{
      margin: "20px 28px",
      background: "rgba(99,102,241,0.08)",
      border: "1px solid rgba(99,102,241,0.3)",
      borderRadius: 12,
      padding: "20px 24px",
    }}>
      <div style={{ fontWeight: 700, fontSize: "1rem", marginBottom: 12, color: "#6366f1" }}>
        IM Account Diagnostic
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 16 }}>
        {[
          { label: "Resolved as",    value: resolved,       ok: resolved !== "—" },
          { label: "Teams linked",   value: teamsFound,     ok: teamsFound > 0 },
          { label: "Projects linked",value: projectsFound,  ok: projectsFound > 0 },
        ].map((item) => (
          <div key={item.label} style={{
            background: "rgba(15,30,55,0.4)",
            borderRadius: 8, padding: "10px 14px",
            border: `1px solid ${item.ok ? "rgba(74,222,128,0.3)" : "rgba(248,113,113,0.3)"}`,
          }}>
            <div style={{ fontSize: "0.72rem", color: "#94a3b8", marginBottom: 4 }}>{item.label}</div>
            <div style={{ fontWeight: 700, fontSize: "0.95rem", color: item.ok ? "#4ade80" : "#f87171", fontFamily: "monospace" }}>
              {String(item.value)}
            </div>
          </div>
        ))}
      </div>

      {/* Identifiers list */}
      <div style={{ marginBottom: 14, padding: "10px 14px", background: "rgba(15,30,55,0.4)", borderRadius: 8, fontSize: "0.82rem" }}>
        <span style={{ color: "#94a3b8" }}>Searching teams &amp; projects using: </span>
        {identifiers.map((id) => (
          <code key={id} style={{ marginRight: 8, color: "#fbbf24", background: "rgba(251,191,36,0.1)", padding: "2px 6px", borderRadius: 4 }}>{id}</code>
        ))}
        <span style={{ color: "#64748b", fontSize: "0.72rem" }}>
          — make sure INET Team → Implementation Manager matches one of these exactly
        </span>
      </div>

      <div style={{ fontSize: "0.82rem", color: "#94a3b8", lineHeight: 1.8 }}>
        <strong style={{ color: "#e8ecf4" }}>Setup checklist:</strong>
        <ol style={{ margin: "8px 0 0 16px", padding: 0 }}>
          <li>
            <strong style={{ color: "#e8ecf4" }}>IM Master</strong> —{" "}
            <a href="/app/im-master" target="_blank" rel="noreferrer" style={{ color: "#60a5fa" }}>Open your IM Master record</a>{" "}
            → set <code style={{ color: "#fbbf24" }}>User Account</code> to your login email
          </li>
          <li>
            <strong style={{ color: "#e8ecf4" }}>INET Teams</strong> —{" "}
            <a href="/app/inet-team" target="_blank" rel="noreferrer" style={{ color: "#60a5fa" }}>Open each INET Team</a>{" "}
            → set <code style={{ color: "#fbbf24" }}>Implementation Manager</code> by selecting your IM Master record (<strong>{resolved}</strong>)
          </li>
          <li>
            <strong style={{ color: "#e8ecf4" }}>Projects</strong> —{" "}
            <a href="/app/project-control-center" target="_blank" rel="noreferrer" style={{ color: "#60a5fa" }}>Open each Project</a>{" "}
            → set <code style={{ color: "#fbbf24" }}>Implementation Manager</code> by selecting your IM Master record (<strong>{resolved}</strong>)
          </li>
        </ol>
      </div>
    </div>
  );
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

  async function loadData() {
    setError(null);
    try {
      // Always call — backend resolves the IM even if imName is null/wrong
      const result = await pmApi.getIMDashboard(imName);
      setData(result);
    } catch (err) {
      setError(err.message || "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imName]);

  if (loading) return <LoadingState />;

  if (error) {
    return (
      <div className="dashboard">
        <div className="notice error" style={{ margin: "24px 28px" }}>
          <span>⚠</span> {error}
        </div>
        <SetupGuide debug={null} imName={imName} />
      </div>
    );
  }

  const kpis     = data?.kpi || data?.kpis || {};
  const teams    = data?.teams    || [];
  const debug    = data?.debug    || null;
  const message  = data?.message  || null;
  const action   = data?.action_items || {};

  // Show setup guide when there is no data at all
  const isEmpty = teams.length === 0 && projects.length === 0;

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
      <div className="dash-header">
        <h1>My Dashboard</h1>
        <div className="subtitle">
          <span style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
            {data?.im || imName || "Installation Manager"}
          </span>
        </div>
      </div>

      {/* ── Backend message ─────────────────────────────────── */}
      {message && (
        <div className="notice" style={{ margin: "0 28px 12px", borderColor: "#fbbf24", background: "rgba(251,191,36,0.08)" }}>
          <span>ℹ</span> {message}
        </div>
      )}

      {/* ── Setup guide if no data ──────────────────────────── */}
      {isEmpty && <SetupGuide debug={debug} imName={imName} />}

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
