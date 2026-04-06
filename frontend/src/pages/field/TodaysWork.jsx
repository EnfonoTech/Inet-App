import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { pmApi } from "../../services/api";
import { useAuth } from "../../context/AuthContext";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

function statusBadgeClass(status) {
  if (!status) return "new";
  const s = status.toLowerCase().replace(/\s+/g, "-");
  if (s === "planned") return "planned";
  if (s === "in-execution" || s === "in-progress") return "in-progress";
  if (s === "completed") return "completed";
  if (s === "cancelled") return "cancelled";
  return "new";
}

function WorkCard({ plan, onClick }) {
  return (
    <div className="work-card" onClick={onClick}>
      <div className="work-card-header">
        <div>
          <div className="work-card-title">{plan.item_description || plan.item_code || "Work Item"}</div>
          <div className="work-card-id">{plan.name}</div>
        </div>
        <span className={`status-badge ${statusBadgeClass(plan.plan_status)}`}>
          <span className="status-dot" />
          {plan.plan_status || "Planned"}
        </span>
      </div>

      <div className="work-card-meta">
        {plan.site_name && (
          <div className="meta-row">
            <span className="meta-icon">📍</span>
            {plan.site_name}
          </div>
        )}
        {plan.project_code && (
          <div className="meta-row">
            <span className="meta-icon">📋</span>
            {plan.project_code}
          </div>
        )}
        {plan.visit_type && (
          <div className="meta-row">
            <span className="meta-icon">🔁</span>
            {plan.visit_type}
          </div>
        )}
      </div>

      {(plan.target_amount || plan.target) > 0 && (
        <>
          <div style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 12,
            fontSize: "0.75rem",
            color: "var(--text-muted)",
          }}>
            <span>Target</span>
            <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>
              {fmt.format(plan.target_amount || plan.target || 0)}
            </span>
          </div>
          <div className="progress-bar">
            <div
              className={`progress-bar-fill ${
                (plan.achieved || 0) >= (plan.target_amount || plan.target || 1)
                  ? "green"
                  : "blue"
              }`}
              style={{
                width: `${Math.min(
                  100,
                  Math.round(
                    ((plan.achieved || 0) /
                      (plan.target_amount || plan.target || 1)) *
                      100
                  )
                )}%`,
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}

export default function TodaysWork() {
  const { teamId } = useAuth();
  const navigate = useNavigate();
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function loadData() {
      setError(null);
      try {
        const result = await pmApi.getFieldTeamDashboard(teamId);
        const items = result?.plans || result?.today_plans || result || [];
        setPlans(Array.isArray(items) ? items : []);
      } catch (err) {
        setError(err.message || "Failed to load today's work");
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [teamId]);

  if (loading) {
    return (
      <div>
        <div className="page-header">
          <h1 className="page-title">Today's Work</h1>
        </div>
        <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)" }}>
          Loading your work for today…
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Today's Work</h1>
          <div className="page-subtitle">
            {new Date().toLocaleDateString("en-US", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </div>
        </div>
        <div className="page-actions">
          <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
            {plans.length} item{plans.length !== 1 ? "s" : ""} planned
          </span>
        </div>
      </div>

      {error && (
        <div className="notice error" style={{ margin: "0 28px 16px" }}>
          <span>⚠</span> {error}
        </div>
      )}

      {plans.length === 0 ? (
        <div className="empty-state" style={{ marginTop: 40 }}>
          <div className="empty-icon">🗓</div>
          <h3>No work planned for today</h3>
          <p>Your team has no planned activities for today. Check back later or contact your IM.</p>
        </div>
      ) : (
        <div className="card-grid">
          {plans.map((plan) => (
            <WorkCard
              key={plan.name}
              plan={plan}
              onClick={() => navigate(`/field-execute/${plan.name}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
