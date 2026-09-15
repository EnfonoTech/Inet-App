import { lazy, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import ReportCatalog from "../../components/ReportCatalog";
import { imReportsApi } from "../../services/api";

/* Reports that render their own grid rather than the shared {columns,data}
   table. Lazily imported so a report's code only downloads when opened —
   the same two the PM's catalog treats this way, reused rather than cloned. */
const TeamIdleDomainReport    = lazy(() => import("../admin/TeamDomainReport"));
const RolloutCommercialReport = lazy(() => import("../../components/RolloutCommercialReport"));
const IMWorkSummary           = lazy(() => import("../../components/IMWorkSummary"));

/* Same registry shape as the PM's Reports.jsx — adding a report stays one
   entry here, and one there.

   WHAT IS NOT HERE, and why:
     IM Performance       ranks IMs against each other; an IM must not see it
     Project Profitability / Revenue Forecast    finance and margin
     Planning / Implementation / Utilization (daily)   not wanted on this side

   Every report that IS here is scoped server-side from the session, off the
   `im` STAMPED on the record (Rollout Plan.im, Daily Execution.im,
   PO Dispatch.im) rather than off who owns the team today — so reassigning a
   team does not move its back-catalogue between IMs. See
   inet_app/api/im_reports.py. Nothing in this file decides scope; an `im` sent
   from here would be ignored. */
const REPORTS = [
  {
    key: "my_work_summary",
    category: "My Work",
    title: "My Work Summary",
    // The bundle this page used to be, kept as one catalog entry.
    component: IMWorkSummary,
    description: "PO dispatch counts and value, rollout plans, and month-to-date executions and work done",
  },
  {
    key: "team_utilization_report",
    category: "Teams & Utilization",
    title: "Team Utilization",
    api: "reportTeamUtilization",
    description: "Team activity and utilization on your own plans — Planned vs Actual",
    hasFilters: true,
  },
  {
    key: "monthly_team_details",
    category: "Teams & Utilization",
    title: "Monthly Team Details",
    api: "reportMonthlyTeamDetails",
    description: "Monthly team utilization — weekly breakdown per team",
    hasFilters: true,
    filterType: "month",
  },
  {
    key: "team_pva",
    category: "Teams & Utilization",
    title: "Team PVA",
    api: "reportTeamPVA",
    description: "Planned vs Actual per team per day — daily utilization breakdown",
    hasFilters: true,
    filterType: "teamdate",
  },
  {
    key: "weekly_performance",
    category: "Performance",
    title: "Weekly Performance",
    api: "reportWeeklyPerformance",
    description: "Your weeks aggregated — lines, revenue, re-visits",
    hasFilters: true,
    filterType: "dateonly",
  },
  {
    key: "top_teams",
    category: "Performance",
    title: "Top Teams",
    api: "reportTopTeams",
    // Ranked within YOUR teams, not company-wide — the PM's copy of this
    // report spans every IM, so the two will not agree, by design.
    description: "Your teams ranked by revenue — completion % and achievement %",
    hasFilters: true,
    filterType: "dateonly",
  },
  {
    key: "project_performance",
    category: "Project Reports",
    title: "Project Performance",
    api: "reportProjectPerformance",
    // No date filter: target is line value and achieved is line status, and
    // neither has a usable date basis. Current-state, like the PM's.
    description: "Achieved vs target on your projects — achievement %, line completion and KPI rating",
    hasFilters: false,
  },
  {
    key: "rollout_burn_down",
    category: "Rollout & Delivery",
    title: "Rollout Delivery Burn-Down",
    api: "reportRolloutBurnDown",
    // Default window is the last 8 weeks, not "this calendar month".
    description: "Weekly burn-down of your own backlog vs an even-pace target — new closures and re-scheduled lines per week",
    hasFilters: true,
    filterType: "dateonly",
  },
  {
    key: "po_dispatch_status",
    category: "Rollout & Delivery",
    title: "PO Dispatch Status",
    api: "reportPoDispatchStatus",
    // No date filter: a line's current status has no date attached to it.
    description: "Where your order book sits across the dispatch pipeline — lines, value and share per status (current state)",
    hasFilters: false,
  },
  {
    key: "po_milestone_status",
    category: "Rollout & Delivery",
    title: "PO Milestone Status",
    api: "reportPoMilestoneStatus",
    description: "Your order book counted by milestone rather than by line — MS1/MS2 split per PIC status",
    hasFilters: false,
  },
  {
    key: "team_idle_domain",
    category: "Client / Domain Reports",
    title: "Team Idle by Domain",
    // Renders its own grid + filters + export; not a {columns,data} table.
    component: TeamIdleDomainReport,
    description: "Daily idle / project-domain matrix for your teams — every team you manage, whatever its status",
  },
  {
    key: "site_sign_status",
    category: "CIAG Site Sign & Verify",
    title: "Site Sign Status",
    api: "reportSiteSignStatus",
    description: "Bills at your sites received but not yet fully consumed — Normal/Warning/Overdue by days pending",
    hasFilters: true,
    filterType: "sitestatus",
  },
  {
    key: "site_verify_status",
    category: "CIAG Site Sign & Verify",
    title: "Site Verify Status",
    api: "reportSiteVerifyStatus",
    description: "Your sites where work is done but client CIAG approval is still pending",
    hasFilters: true,
    filterType: "sitestatus",
  },
  {
    key: "bill_wise_status",
    category: "Material Reports",
    title: "Bill Wise Material Status",
    api: "reportBillWiseStatus",
    description: "Per bill and item at your sites — received vs. used vs. remaining, with SLA status",
    hasFilters: true,
    filterType: "sitestatus",
  },
  {
    key: "huawei_outbound_analytics",
    category: "Material Reports",
    title: "Huawei Outbound Analytics",
    api: "reportHuaweiOutboundAnalytics",
    description: "Shipment count and volume by subcontractor or domain across your projects",
    hasFilters: true,
    filterType: "subcondate",
  },
  {
    key: "commercial",
    category: "Commercial",
    title: "Rollout Commercial",
    // Key is "commercial" on purpose: Rollout Planning deep-links here as
    // /im-reports?tab=commercial, and that link has to keep working.
    component: RolloutCommercialReport,
    description: "Planned vs invoiced vs collected on your planned rollout work, by project",
  },
];

export default function IMReports() {
  const { imName } = useAuth();
  const [searchParams] = useSearchParams();
  // Rollout Planning deep-links with ?tab=commercial&project=… — the tab half
  // is the catalog's own param; the project half is this report's.
  const commProject = searchParams.get("project") || "";
  const [scope, setScope] = useState(null);

  useEffect(() => {
    if (!imName) return;
    imReportsApi.getScope().then(setScope).catch(() => setScope(null));
  }, [imName]);

  /* componentProps are attached here rather than inside the registry so the
     registry stays a plain data literal — the props depend on session and URL,
     which the registry cannot see. */
  const reports = useMemo(() => REPORTS.map((r) => {
    if (r.key === "commercial") {
      return { ...r, componentProps: { imName, initialProject: commProject } };
    }
    if (r.key === "team_idle_domain") {
      return { ...r, componentProps: { fetchUtilization: imReportsApi.getTeamDomainUtilization } };
    }
    if (r.key === "my_work_summary") {
      return { ...r, componentProps: { imName } };
    }
    return r;
  }), [imName, commProject]);

  /* Which teams the numbers below actually cover. Worth stating: the catalog
     deliberately does NOT drop a team for being Inactive / On Vacation /
     Disbanded — it did the work, so it keeps its rows — and without this line
     a reader would have no way to tell that from the reports themselves. */
  const headerExtra = scope ? (
    <div style={{ fontSize: "0.76rem", color: "#64748b", marginTop: 4 }}>
      Scope: <strong>{scope.im_name || imName}</strong>
      {scope.team_count > 0 && (
        <>
          {" · "}{scope.team_count} team{scope.team_count === 1 ? "" : "s"}
          {scope.active_team_count !== scope.team_count && (
            <span title="Reports include every team you manage, whatever its status — a team that is inactive today still did the work it did.">
              {" "}({scope.active_team_count} active, {scope.team_count - scope.active_team_count} not)
            </span>
          )}
        </>
      )}
    </div>
  ) : null;

  if (!imName) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1 className="page-title">Reports</h1>
            <div className="page-subtitle">IM account not linked</div>
          </div>
        </div>
        <div className="page-content">
          <div className="empty-state">
            <div className="empty-icon">📊</div>
            <h3>IM account not linked</h3>
            <p style={{ color: "#64748b", fontSize: "0.88rem", maxWidth: 460, margin: "8px auto 0" }}>
              Sign in with an INET IM user linked to IM Master, or open My Dashboard to verify setup.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ReportCatalog
      reports={reports}
      api={imReportsApi}
      title="Reports"
      // Namespaced away from "admin-report-…" so the PM's and the IM's copy of
      // the same report keep their own saved column widths.
      tableKeyPrefix="im-report"
      // No IM filter: an IM has exactly one IM to look at, and the server
      // would ignore the value anyway.
      loadTeamOptions={() => imReportsApi.getTeamOptions()}
      loadHuaweiOptions={() => imReportsApi.getHuaweiOptions()}
      headerExtra={headerExtra}
    />
  );
}
