import { useEffect, useState } from "react";
import { pmApi } from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import KPICard from "../../components/KPICard";
import MiniTable from "../../components/MiniTable";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

const teamCols = [
  { label: "Team ID",   key: "team_id" },
  { label: "Team Name", key: "team_name" },
  { label: "Type",      key: "team_type" },
  { label: "Status",    key: "status" },
  {
    label: "Daily Cost",
    key: "daily_cost",
    align: "right",
    render: (v) => fmt.format(v || 0),
  },
];

const projectCols = [
  { label: "Code",   key: "project_code" },
  { label: "Name",   key: "project_name" },
  { label: "Status", key: "status" },
  {
    label: "Completion %",
    key: "completion_pct",
    align: "right",
    colorFn: (v) => v >= 80 ? "text-green" : v >= 40 ? "text-amber" : "text-red",
    render: (v) => `${v ?? 0}%`,
  },
  {
    label: "Budget",
    key: "budget",
    align: "right",
    render: (v) => fmt.format(v || 0),
  },
];

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
  const projects = data?.projects || [];
  const debug    = data?.debug    || null;
  const message  = data?.message  || null;

  // Show setup guide when there is no data at all
  const isEmpty = teams.length === 0 && projects.length === 0;

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
      <div className="section-label">Performance Overview</div>
      <div className="kpi-row" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <KPICard label="Revenue"    value={fmt.format(kpis.revenue || 0)} colorClass="text-green" />
        <KPICard label="Cost"       value={fmt.format(kpis.cost || 0)} />
        <KPICard label="Profit"     value={fmt.format(kpis.profit || 0)}
          colorClass={(kpis.profit || 0) >= 0 ? "text-green" : "text-red"} />
        <KPICard label="Teams"      value={kpis.team_count || teams.length || 0} />
      </div>

      {/* ── Bottom Grid: 2 Panels ─────────────────────────── */}
      <div className="bottom-grid" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
        {/* Panel 1: My Teams */}
        <div className="panel">
          <div className="panel-header">
            <h3>My Teams</h3>
            <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
              {teams.length} teams
            </span>
          </div>
          <div className="panel-body">
            <MiniTable columns={teamCols} rows={teams} emptyText="No teams assigned — see setup guide above" />
          </div>
        </div>

        {/* Panel 2: My Projects */}
        <div className="panel">
          <div className="panel-header">
            <h3>My Projects</h3>
            <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
              {projects.length} projects
            </span>
          </div>
          <div className="panel-body">
            <MiniTable columns={projectCols} rows={projects} emptyText="No projects assigned — see setup guide above" />
          </div>
        </div>
      </div>
    </div>
  );
}
