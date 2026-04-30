import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { pmApi } from "../../services/api";
import { useAuth } from "../../context/AuthContext";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function statusBadgeClass(status) {
  if (!status) return "new";
  const s = status.toLowerCase().replace(/\s+/g, "-");
  if (s === "planned") return "planned";
  if (s === "in-execution" || s === "in-progress") return "in-progress";
  if (s === "completed") return "completed";
  if (s === "cancelled") return "cancelled";
  return "new";
}

function statusSortKey(status) {
  if (!status) return 2;
  const s = status.toLowerCase();
  if (s === "in-execution" || s === "in-progress") return 0;
  if (s === "planned") return 1;
  if (s === "completed") return 3;
  if (s === "cancelled") return 4;
  return 2;
}

function cardAccentColor(status) {
  if (!status) return "var(--blue)";
  const s = status.toLowerCase();
  if (s === "in-execution" || s === "in-progress") return "var(--amber)";
  if (s === "completed") return "var(--green)";
  if (s === "cancelled") return "#cbd5e1";
  return "var(--blue)";
}

function SkeletonCard() {
  return (
    <div className="work-card" style={{ cursor: "default", pointerEvents: "none" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ flex: 1, marginRight: 12 }}>
          <div className="skeleton-line" style={{ width: "70%", height: 14, marginBottom: 6 }} />
          <div className="skeleton-line" style={{ width: "40%", height: 10 }} />
        </div>
        <div className="skeleton-line" style={{ width: 64, height: 22, borderRadius: 999 }} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div className="skeleton-line" style={{ width: "55%", height: 11 }} />
        <div className="skeleton-line" style={{ width: "45%", height: 11 }} />
      </div>
      <div className="skeleton-line" style={{ width: "100%", height: 6, marginTop: 14, borderRadius: 3 }} />
    </div>
  );
}

function SummaryChips({ plans }) {
  const total = plans.length;
  const inExec = plans.filter(p => {
    const s = (p.plan_status || "").toLowerCase();
    return s === "in-execution" || s === "in-progress";
  }).length;
  const done = plans.filter(p => (p.plan_status || "").toLowerCase() === "completed").length;
  const planned = plans.filter(p => (p.plan_status || "").toLowerCase() === "planned" || !p.plan_status).length;

  return (
    <div className="today-summary-bar">
      <div className="today-chip today-chip--total">
        <span className="today-chip-value">{total}</span>
        <span className="today-chip-label">Total</span>
      </div>
      {inExec > 0 && (
        <div className="today-chip today-chip--active">
          <span className="today-chip-dot" style={{ background: "var(--amber)" }} />
          <span className="today-chip-value">{inExec}</span>
          <span className="today-chip-label">In Progress</span>
        </div>
      )}
      {planned > 0 && (
        <div className="today-chip today-chip--planned">
          <span className="today-chip-dot" style={{ background: "var(--blue)" }} />
          <span className="today-chip-value">{planned}</span>
          <span className="today-chip-label">Planned</span>
        </div>
      )}
      {done > 0 && (
        <div className="today-chip today-chip--done">
          <span className="today-chip-dot" style={{ background: "var(--green)" }} />
          <span className="today-chip-value">{done}</span>
          <span className="today-chip-label">Done</span>
        </div>
      )}
    </div>
  );
}

function WorkCard({ plan, onClick }) {
  // ``target_amount`` / ``achieved_amount`` are SAR (revenue), not qty —
  // the label below spells out the unit so field users (who think in qty)
  // don't read "Progress 0/525" as 0 of 525 jobs.
  const target = plan.target_amount || plan.target || 0;
  const achieved = plan.achieved_amount || plan.achieved || 0;
  const pct = target > 0 ? Math.min(100, Math.round((achieved / target) * 100)) : null;
  const accentColor = cardAccentColor(plan.plan_status);
  const isActive = ["in-execution", "in-progress"].includes((plan.plan_status || "").toLowerCase());
  const imConfirmed = plan.execution_status === "Completed";

  return (
    <div
      className={`work-card work-card--enhanced${isActive ? " work-card--active-pulse" : ""}`}
      style={{ borderLeftColor: accentColor }}
      onClick={onClick}
    >
      <div className="work-card-header">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="work-card-title">{plan.item_description || plan.item_code || "Work Item"}</div>
          <div className="work-card-id">
            {plan.poid ? <strong>{plan.poid}</strong> : plan.name}
            {plan.poid && (
              <span style={{ color: "var(--text-muted)", marginLeft: 6, fontSize: "0.7rem" }}>
                · {plan.name}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          {imConfirmed && (
            <span
              title="IM has confirmed this execution"
              style={{
                display: "inline-flex", alignItems: "center", gap: 3,
                padding: "2px 8px", borderRadius: 999,
                background: "var(--green-bg, #d1fae5)", color: "var(--green, #047857)",
                fontSize: "0.66rem", fontWeight: 700, whiteSpace: "nowrap",
              }}
            >
              IM ✓
            </span>
          )}
          <span className={`status-badge ${statusBadgeClass(plan.plan_status)}`}>
            <span className="status-dot" />
            {plan.plan_status || "Planned"}
          </span>
        </div>
      </div>

      <div className="work-card-meta">
        {(plan.site_code || plan.site_name) && (
          <div className="meta-row">
            <svg className="meta-svg-icon" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
            </svg>
            <span>
              {plan.site_code ? <strong>{plan.site_code}</strong> : null}
              {plan.site_code && plan.site_name ? " · " : ""}
              {plan.site_name || ""}
            </span>
          </div>
        )}
        {plan.customer_activity_type && (
          <div className="meta-row">
            <svg className="meta-svg-icon" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M2 5a2 2 0 012-2h7a2 2 0 012 2v4a2 2 0 01-2 2H9l-3 3v-3H4a2 2 0 01-2-2V5z" clipRule="evenodd" />
            </svg>
            <span>{plan.customer_activity_type}</span>
          </div>
        )}
        {plan.project_code && (
          <div className="meta-row">
            <svg className="meta-svg-icon" viewBox="0 0 20 20" fill="currentColor">
              <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
              <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" />
            </svg>
            <span>{plan.project_code}</span>
          </div>
        )}
        {(plan.visit_type || plan.qty != null) && (
          <div className="meta-row">
            <svg className="meta-svg-icon" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
            </svg>
            <span>
              {plan.visit_type || ""}
              {plan.visit_type && plan.qty != null ? " · " : ""}
              {plan.qty != null ? `Qty ${Number(plan.qty)}` : ""}
            </span>
          </div>
        )}
      </div>

      {target > 0 && (
        <div className="work-card-progress">
          <div className="work-card-progress-labels">
            <span className="progress-label-text">Revenue (SAR)</span>
            <span className="progress-label-stats">
              <span style={{ fontWeight: 700, color: "var(--text)" }}>{fmt.format(achieved)}</span>
              <span style={{ color: "var(--text-muted)" }}> / {fmt.format(target)}</span>
              {pct !== null && (
                <span
                  className="progress-pct-badge"
                  style={{
                    background: pct >= 100 ? "var(--green-bg)" : "var(--blue-bg)",
                    color: pct >= 100 ? "var(--green)" : "var(--blue)",
                    border: `1px solid ${pct >= 100 ? "var(--green-border)" : "var(--blue-border)"}`,
                  }}
                >
                  {pct}%
                </span>
              )}
            </span>
          </div>
          <div className="progress-bar" style={{ marginTop: 6 }}>
            <div
              className={`progress-bar-fill ${pct >= 100 ? "green" : "blue"}`}
              style={{ width: `${pct ?? 0}%` }}
            />
          </div>
        </div>
      )}

      <div className="work-card-footer">
        <span className="work-card-cta">
          {isActive ? "Continue execution" : "Tap to execute"}
          <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14" style={{ marginLeft: 4 }}>
            <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </span>
      </div>
    </div>
  );
}

export default function TodaysWork() {
  const { teamId, user } = useAuth();
  const navigate = useNavigate();
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    if (!teamId) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      const result = await pmApi.getFieldTeamDashboard(teamId);
      const items =
        result?.planned ??
        result?.plans ??
        result?.today_plans ??
        (Array.isArray(result) ? result : []);
      const sorted = (Array.isArray(items) ? items : []).slice().sort(
        (a, b) => statusSortKey(a.plan_status) - statusSortKey(b.plan_status)
      );
      setPlans(sorted);
    } catch (err) {
      setError(err.message || "Failed to load today's work");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { loadData(); }, [teamId]);

  const firstName = user?.full_name?.split(" ")[0] || user?.email?.split("@")[0] || "there";

  return (
    <div className="field-today-view">
      <div className="page-header">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 className="page-title">{greeting()}, {firstName}</h1>
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
          <button
            className="btn-icon btn-sm"
            title="Refresh"
            onClick={() => loadData(true)}
            disabled={loading || refreshing}
            style={{ opacity: refreshing ? 0.5 : 1 }}
          >
            <svg
              viewBox="0 0 20 20"
              fill="currentColor"
              width="16"
              height="16"
              style={{ animation: refreshing ? "spin 0.7s linear infinite" : "none" }}
            >
              <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      </div>

      {error && (
        <div className="notice error" style={{ margin: "0 16px 12px" }}>
          <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16" style={{ flexShrink: 0 }}>
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          {error}
        </div>
      )}

      {loading ? (
        <div className="card-grid" style={{ padding: "0 16px" }}>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : !teamId ? (
        <div className="empty-state" style={{ marginTop: 40 }}>
          <div className="empty-icon">👤</div>
          <h3>No team assigned</h3>
          <p>Your account is not linked to a field team. Please contact your Implementation Manager.</p>
        </div>
      ) : plans.length === 0 ? (
        <div className="empty-state" style={{ marginTop: 40 }}>
          <div className="empty-icon">🗓</div>
          <h3>All clear for today</h3>
          <p>Your team has no planned activities for today. Check back later or contact your IM.</p>
        </div>
      ) : (
        <>
          <SummaryChips plans={plans} />
          <div className="card-grid" style={{ padding: "0 16px 16px" }}>
            {plans.map((plan) => (
              <WorkCard
                key={plan.name}
                plan={plan}
                onClick={() => navigate(`/field-execute/${plan.name}`)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
