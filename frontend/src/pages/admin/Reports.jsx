import { lazy } from "react";
import ReportCatalog from "../../components/ReportCatalog";
import { pmApi } from "../../services/api";

/* Reports that render their own grid rather than the shared {columns,data}
   table. Lazily imported so a report's code only downloads when opened. */
const TeamIdleDomainReport = lazy(() => import("./TeamDomainReport"));
const RolloutCommercialReport = lazy(() => import("../../components/RolloutCommercialReport"));

/* Every report declares a `category` purely for grouping in the catalog.
   Adding a report = one entry here; nothing else needs touching. */
const REPORTS = [
  {
    key: "team_utilization_report",
    category: "Teams & Utilization",
    title: "Team Utilization",
    api: "reportTeamUtilizationReport",
    description: "Team activity and utilization — Planned vs Actual",
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
    key: "team_planning_report",
    category: "Teams & Utilization",
    title: "Planning Report",
    api: "reportTeamPlanningReport",
    description: "Daily team plan status — what each team is scheduled to do",
    hasFilters: true,
    filterType: "teamdate",
  },
  {
    key: "team_utilization_report_daily",
    category: "Teams & Utilization",
    title: "Utilization Report",
    api: "reportTeamUtilizationDaily",
    description: "Daily team utilization — what each team actually executed",
    hasFilters: true,
    filterType: "teamdate",
  },
  {
    key: "team_implementation_report",
    category: "Teams & Utilization",
    title: "Implementation Report",
    api: "reportTeamImplementationReport",
    description: "Daily team implementation status with QC, CIAG and remarks",
    hasFilters: true,
    filterType: "teamdate",
  },
  {
    key: "im_performance",
    category: "Performance",
    title: "IM Performance",
    api: "reportIMPerformance",
    description: "Revenue, completion % and rating per Implementation Manager",
    hasFilters: true,
    filterType: "dateonly",
  },
  {
    key: "project_performance",
    category: "Project Reports",
    title: "Project Performance",
    api: "reportProjectPerformance",
    // No date filter: target is line value and achieved is line status, and
    // neither has a usable date basis. Current-state, like the workbook.
    description: "Achieved vs target per project — achievement %, line completion and KPI rating",
    hasFilters: false,
  },
  {
    key: "project_profitability",
    category: "Project Reports",
    title: "Project Profitability",
    api: "reportProjectProfitability",
    // No date filter: PO value has no usable date basis, so both sides are
    // current-state. A filter here would only ever skew Delivery %.
    description: "Revenue delivered against contracted PO value per project — remaining value and delivery % (to date)",
    hasFilters: false,
  },
  {
    key: "rollout_burn_down",
    category: "Rollout & Delivery",
    title: "Rollout Delivery Burn-Down",
    api: "reportRolloutBurnDown",
    // Default window is the last 8 weeks, not "this calendar month" — see
    // the backend docstring. An explicit range overrides it.
    description: "Weekly backlog burn-down vs an even-pace target — actual vs target progress on the open backlog, new closures and re-scheduled lines per week",
    hasFilters: true,
    filterType: "dateonly",
  },
  {
    key: "po_dispatch_status",
    category: "Rollout & Delivery",
    title: "PO Dispatch Status",
    api: "reportPoDispatchStatus",
    // No date filter: this is where every line stands right now. A line's
    // current status has no date attached to it, so any range would answer a
    // different question — see the backend docstring.
    description: "Where the order book sits across the dispatch pipeline — lines, value and share per status, grouped by stage (current state)",
    hasFilters: false,
  },
  {
    key: "po_milestone_status",
    category: "Rollout & Delivery",
    title: "PO Milestone Status",
    api: "reportPoMilestoneStatus",
    // Companion to PO Dispatch Status, and the one to trust for money in
    // flight: billing is per milestone, and a line's MS1/MS2 are routinely at
    // different stages, which a single line-level status cannot express.
    description: "The order book counted by milestone rather than by line — MS1/MS2 split per PIC status, so a part-closed line's closed half is not counted as still in flight",
    hasFilters: false,
  },
  {
    key: "top_teams",
    category: "Performance",
    title: "Top Teams",
    api: "reportTopTeams",
    description: "Teams ranked by revenue — completion % and achievement %",
    hasFilters: true,
    filterType: "dateonly",
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
    description: "Weekly aggregated performance — lines, revenue, re-visits",
    hasFilters: true,
    filterType: "dateonly",
  },
  {
    key: "revenue_forecast",
    category: "Commercial",
    title: "Revenue Forecast",
    api: "reportRevenueForecast",
    description: "6-month rolling forecast — run-rate projection vs planned revenue",
    hasFilters: false,
  },
  {
    key: "rollout_commercial",
    category: "Commercial",
    title: "Rollout Commercial",
    // Renders its own filters + grid; same component the IM's Reports page
    // uses, with no IM passed so it spans every IM.
    component: RolloutCommercialReport,
    description: "Planned vs invoiced vs collected on planned rollout work, by project",
  },
  {
    key: "team_idle_domain",
    category: "Client / Domain Reports",
    title: "Team Idle by Domain",
    // Renders its own grid + filters + export; not a {columns,data} table.
    component: TeamIdleDomainReport,
    description: "Daily idle / project-domain matrix per team — the monthly sheet handed to the domains",
  },
  {
    key: "site_sign_status",
    category: "CIAG Site Sign & Verify",
    title: "Site Sign Status",
    api: "reportSiteSignStatus",
    description: "Bills received but not yet fully consumed at site — Normal/Warning/Overdue by days pending",
    hasFilters: true,
    filterType: "sitestatus",
  },
  {
    key: "site_verify_status",
    category: "CIAG Site Sign & Verify",
    title: "Site Verify Status",
    api: "reportSiteVerifyStatus",
    description: "Sites where work is done but client CIAG approval is still pending",
    hasFilters: true,
    filterType: "sitestatus",
  },
  {
    key: "bill_wise_status",
    category: "Material Reports",
    title: "Bill Wise Material Status",
    api: "reportBillWiseStatus",
    description: "Per bill and item — received vs. used vs. remaining, with SLA status. Also in Desk as a Script Report.",
    hasFilters: true,
    filterType: "sitestatus",
  },
  {
    key: "huawei_outbound_analytics",
    category: "Material Reports",
    title: "Huawei Outbound Analytics",
    api: "reportHuaweiOutboundAnalytics",
    description: "Shipment count and volume by subcontractor, project or domain — filter to one project/domain to see its subcontractor split. Also in Desk as a Script Report.",
    hasFilters: true,
    filterType: "subcondate",
  },
];


/* The catalog itself — category tabs, chips, filter toolbar, table, totals,
   chart and export — lives in components/ReportCatalog.jsx, shared with the
   IM's Reports page so the two cannot drift apart. This file is now just the
   PM's registry plus the PM's own option sources. */
export default function Reports() {
  return (
    <ReportCatalog
      reports={REPORTS}
      api={pmApi}
      title="Reports"
      tableKeyPrefix="admin-report"
      // The PM spans every IM, so the IM filter is theirs alone; the IM's own
      // page has exactly one IM to look at and omits it.
      showImFilter
      loadTeamOptions={() => pmApi.getTeamOptions()}
      loadImOptions={() => pmApi.listIMsForPicker("").then((rows) =>
        (Array.isArray(rows) ? rows : []).map((r) => ({ id: r.name, label: r.full_name || r.name }))
      )}
      loadHuaweiOptions={async () => {
        // Project/domain come from a dedicated endpoint that joins to Project
        // Control Center for real project NAMES (a plain distinct-values call
        // would only ever return the raw code). Subcontractors have no such
        // hop, so they come straight off Huawei Outbound Plan's own values —
        // only subcons that actually appear in outbound data show up.
        const [pd, distinct] = await Promise.all([
          pmApi.getHuaweiOutboundProjectDomainOptions().catch(() => ({})),
          pmApi.getDistinctFieldValues("Huawei Outbound Plan", ["subcon"]).catch(() => ({})),
        ]);
        const subcons = Array.isArray(distinct?.subcon) ? [...distinct.subcon] : [];
        subcons.sort((a, b) => String(a).localeCompare(String(b), undefined, { sensitivity: "base" }));
        return { projects: pd?.projects || [], domains: pd?.domains || [], subcons };
      }}
    />
  );
}
