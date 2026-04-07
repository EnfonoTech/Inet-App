import { useEffect, useState } from "react";
import { pmApi } from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import KPICard from "../../components/KPICard";
import MiniTable from "../../components/MiniTable";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

const teamCols = [
  { label: "Team Name", key: "team_name" },
  { label: "Type", key: "team_type" },
  { label: "Status", key: "status" },
  {
    label: "Daily Cost",
    key: "daily_cost",
    align: "right",
    render: (v) => fmt.format(v || 0),
  },
];

const projectCols = [
  { label: "Code", key: "project_code" },
  { label: "Name", key: "project_name" },
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
      const result = await pmApi.getIMDashboard(imName);
      setData(result);
    } catch (err) {
      setError(err.message || "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (imName) loadData();
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imName]);

  if (loading) return <LoadingState />;

  if (!imName) {
    return (
      <div className="dashboard">
        <div className="notice error" style={{ margin: "24px 28px" }}>
          <span>⚠</span> Your user account is not linked to an IM Master record.
          Go to <strong>Frappe Desk → INET App → IM Master</strong>, open your record and set <strong>User Account</strong> to your login email.
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="dashboard">
        <div className="notice error" style={{ margin: "24px 28px" }}>
          <span>⚠</span> {error}
        </div>
      </div>
    );
  }

  const kpis = data?.kpi || data?.kpis || {};
  const teams = data?.teams || [];
  const projects = data?.projects || [];

  return (
    <div className="dashboard">
      {/* ── Header ──────────────────────────────────────────── */}
      <div className="dash-header">
        <h1>My Dashboard</h1>
        <div className="subtitle">
          <span style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
            {imName || "Installation Manager"}
          </span>
        </div>
      </div>

      {/* ── KPI Row ─────────────────────────────────────────── */}
      <div className="section-label">Performance Overview</div>
      <div className="kpi-row" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <KPICard
          label="Revenue"
          value={fmt.format(kpis.revenue || 0)}
          colorClass="text-green"
        />
        <KPICard
          label="Cost"
          value={fmt.format(kpis.cost || 0)}
        />
        <KPICard
          label="Profit"
          value={fmt.format(kpis.profit || 0)}
          colorClass={(kpis.profit || 0) >= 0 ? "text-green" : "text-red"}
        />
        <KPICard
          label="Team Count"
          value={kpis.team_count || 0}
        />
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
            <MiniTable
              columns={teamCols}
              rows={teams}
              emptyText="No teams assigned"
            />
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
            <MiniTable
              columns={projectCols}
              rows={projects}
              emptyText="No projects assigned"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
