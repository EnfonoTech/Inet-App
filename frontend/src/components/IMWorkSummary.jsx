import { useCallback, useEffect, useMemo, useState } from "react";
import { pmApi } from "../services/api";
import MiniTable from "./MiniTable";
import ReportDashboard, { Card } from "./ReportDashboard";
import { money } from "../utils/numberFormat";

const fmtDec = new Intl.NumberFormat("en", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/**
 * "My Work" — the IM's own PO lines, rollout plans, this month's executions
 * and this month's Work Done, one section per catalog entry (`section`).
 *
 * Laid out like every other report: headline tiles, chart cards, then the
 * detail. All four sections read ONE cached payload (get_im_reports), which
 * is scoped server-side off the IM stamped on each record.
 */

const n = (v) => Number(v) || 0;
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const tile = (label, value, format = "int", sub, tone = "blue", icon = "avg") => ({ label, value, format, sub, tone, icon });
const chart = (kind, title, data, series, x = "label", format = "int", extra = {}) => ({
  kind, title, data, x, format, series: series.map(([key, label, color]) => ({ key, label, color })), ...extra,
});
const STATUS_COLORS = {
  Completed: "#15803d", Closed: "#14652f", "Partially Closed": "#3f9b5c", Submitted: "#0e8a8a", "Partially Submitted": "#5fb3b3",
  Dispatched: "#1d5fd1", Planned: "#9db8ea", "In Execution": "#1d5fd1", "In Progress": "#1d5fd1", Pending: "#e0a320",
  "Planning with Issue": "#e08a2c", Overdue: "#b42318", "Not Attended": "#c2410c", Hold: "#94a3b8", Postponed: "#94a3b8",
  Cancelled: "#c7d0dc", Invoiced: "#1d5fd1", Rollout: "#1d5fd1", "Direct / Backend close": "#6d4bd1",
};
const colored = (rows) => rows.map((r) => ({ ...r, color: STATUS_COLORS[r.label] }));
const countOf = (rows, label) => n(rows.find((r) => r.status_key === label)?.cnt);
// "Team-02 · Attaullah Khan" — the number and the name together, as everywhere else.
const teamLabel = (rows) => (rows || []).map((r) => ({ ...r, team_label: r.team_name && r.team_name !== r.team ? `${r.team} · ${r.team_name}` : r.team }));

function overviewDashboard(p) {
  const d = p.dispatch_summary || {};
  const projects = (d.by_project || []).map((g) => ({ ...g, done_pct: pct(g.done, g.lines) }));
  return {
    dashboard: {
      tiles: [
        tile("PO lines", d.total_lines, "int", "cancelled left out", "blue", "doc"),
        tile("Line value", d.total_amount, "money", "SAR", "blue", "money"),
        tile("Lines done", d.done_lines, "int", `${pct(n(d.done_lines), n(d.total_lines))}% of lines`, "green", "done"),
        tile("Delivered value", d.done_amount, "money", `${pct(n(d.done_amount), n(d.total_amount))}% of value`, "green", "rate"),
        tile("Cancelled", d.cancelled_lines, "int", `SAR ${money.format(n(d.cancelled_amount))}`, n(d.cancelled_lines) ? "red" : "grey", "alert"),
        tile("Projects", projects.length, "int", null, "grey", "folder"),
      ],
      charts: [
        chart("hbar", "Lines by status", colored(d.by_status || []), [["lines", "Lines"]]),
        chart("hbar", "Value by project", projects.slice(0, 10), [["amount", "SAR"]], "label", "money", { sub: "top 10" }),
        chart("donut", "Dispatch mode", (d.by_dispatch_mode || []).map((m, i) => ({ label: m.label, value: m.lines, color: ["#1d5fd1", "#e08a2c", "#94a3b8"][i] })), [["value", "Lines"]], "label", "int", { centerLabel: "lines" }),
      ],
      tops: [{
        title: "Projects", sub: `${projects.length} projects`, rows: projects,
        columns: [
          { key: "label", label: "Project", format: "text" }, { key: "lines", label: "Lines", format: "int" },
          { key: "done", label: "Done", format: "int" }, { key: "done_pct", label: "Done %", format: "pct" },
          { key: "amount", label: "Value", format: "money" },
        ],
      }],
    },
  };
}

function rolloutDashboard(p) {
  const st = p.rollout_status_counts || [];
  const total = st.reduce((a, r) => a + n(r.cnt), 0);
  const months = (p.plans_by_month || []).map((m) => ({ ...m, planned: n(m.planned) - n(m.cancelled) }));
  return {
    dashboard: {
      tiles: [
        tile("Plans", total, "int", "all dates", "blue", "planned"),
        tile("Completed", countOf(st, "Completed"), "int", `${pct(countOf(st, "Completed"), total)}% of plans`, "green", "done"),
        tile("In execution", countOf(st, "In Execution"), "int", null, "blue", "clock"),
        tile("Planned", countOf(st, "Planned"), "int", "not started yet", "grey", "planned"),
        tile("With issue", countOf(st, "Planning with Issue"), "int", "see Issues & Risks", countOf(st, "Planning with Issue") ? "amber" : "grey", "alert"),
        tile("Cancelled", countOf(st, "Cancelled"), "int", null, "grey", "alert"),
      ],
      charts: [
        chart("bar", "Plans by month", months, [["planned", "Planned", "#b9cdf3"], ["completed", "Completed", "#163a7a"]], "month", "int", { sub: "last 6 months, cancelled left out" }),
        chart("hbar", "This month by team", teamLabel(p.plans_by_team).slice(0, 10), [["planned", "Planned", "#b9cdf3"], ["completed", "Completed", "#163a7a"]], "team_label"),
        chart("donut", "Plans by status", colored(st.map((r) => ({ label: r.status_key, value: n(r.cnt) }))), [["value", "Plans"]], "label", "int", { centerLabel: "plans" }),
      ],
    },
    table: {
      title: "Recent plans", sub: "latest 80", key: "im-reports-recent-plans",
      columns: [
        { label: "Plan", key: "name" }, { label: "Date", key: "plan_date" }, { label: "Status", key: "plan_status" },
        { label: "Team", key: "team_name" }, { label: "POID", key: "po_dispatch" }, { label: "Project", key: "project_code" },
        { label: "Visit", key: "visit_type" },
        { label: "Target", key: "target_amount", align: "right", render: (v) => fmtDec.format(n(v)) },
      ],
      rows: p.rollouts_recent || [],
    },
  };
}

function executionDashboard(p) {
  const st = p.execution_status_counts || [];
  const q = p.execution_quality || {};
  const total = st.reduce((a, r) => a + n(r.cnt), 0);
  return {
    dashboard: {
      tiles: [
        tile("Executions", total, "int", `${n(q.teams)} teams this month`, "blue", "planned"),
        tile("Completed", countOf(st, "Completed"), "int", `${pct(countOf(st, "Completed"), total)}% of executions`, "green", "done"),
        tile("In progress", countOf(st, "In Progress"), "int", null, "blue", "clock"),
        tile("QC pending", q.qc_pending, "int", "not yet passed", n(q.qc_pending) ? "amber" : "grey", "clock"),
        tile("QC failed", q.qc_fail, "int", null, n(q.qc_fail) ? "red" : "grey", "alert"),
        tile("CIAG open", q.ciag_open, "int", "waiting on approval", n(q.ciag_open) ? "amber" : "grey", "doc"),
      ],
      charts: [
        chart("bar", "Executions by day", (p.executions_by_day || []).map((d) => ({ ...d, label: String(d.day).slice(5) })), [["executions", "Executions", "#b9cdf3"], ["completed", "Completed", "#163a7a"]]),
        chart("hbar", "By team", teamLabel(p.executions_by_team).slice(0, 10), [["executions", "Executions", "#b9cdf3"], ["completed", "Completed", "#163a7a"]], "team_label"),
        chart("donut", "By status", colored(st.map((r) => ({ label: r.status_key, value: n(r.cnt) }))), [["value", "Executions"]], "label", "int", { centerLabel: "executions" }),
      ],
    },
    table: {
      title: "Recent executions", sub: "this month, latest 60", key: "im-reports-recent-executions",
      columns: [
        { label: "Execution", key: "name" }, { label: "Date", key: "execution_date" }, { label: "Status", key: "execution_status" },
        { label: "QC", key: "qc_status" }, { label: "CIAG", key: "ciag_status" }, { label: "Team", key: "team_name" },
        { label: "Plan", key: "rollout_plan" }, { label: "POID", key: "po_dispatch" },
      ],
      rows: p.executions_recent || [],
    },
  };
}

function workDoneDashboard(p) {
  const w = p.work_done_mtd || {};
  const bill = w.by_billing || {};
  const entry = (k) => bill[k] || { count: 0, revenue_sar: 0 };
  const toRows = (obj, valueKey) => Object.entries(obj || {}).map(([label, o]) => ({ label, value: n(o[valueKey]), count: n(o.count), revenue: n(o.revenue_sar) }));
  const src = w.by_source || {};
  const direct = src["Direct / Backend close"] || { count: 0 };
  return {
    dashboard: {
      tiles: [
        tile("Work Done", w.count, "int", "this month", "blue", "done"),
        tile("Revenue", w.revenue_sar, "money", "SAR", "green", "money"),
        tile("Invoiced", entry("Invoiced").count, "int", `SAR ${money.format(entry("Invoiced").revenue_sar)}`, "blue", "doc"),
        tile("Pending billing", entry("Pending").count, "int", `SAR ${money.format(entry("Pending").revenue_sar)}`, entry("Pending").count ? "amber" : "grey", "clock"),
        tile("Closed", entry("Closed").count, "int", `SAR ${money.format(entry("Closed").revenue_sar)}`, "green", "rate"),
        tile("Direct / Backend", direct.count, "int", `${pct(n(direct.count), n(w.count))}% of Work Done`, "grey", "box"),
      ],
      charts: [
        chart("donut", "Revenue by billing status", colored(toRows(bill, "revenue_sar")), [["value", "SAR"]], "label", "money", { centerLabel: "SAR" }),
        chart("hbar", "Revenue by project", toRows(w.by_project, "revenue_sar").sort((a, b) => b.value - a.value).slice(0, 10), [["value", "SAR"]], "label", "money", { sub: "top 10" }),
        chart("donut", "Where it came from", colored(toRows(src, "count")), [["value", "Work Done"]], "label", "int", { centerLabel: "records" }),
      ],
      tops: [{
        title: "By billing status", rows: toRows(bill, "count"),
        columns: [
          { key: "label", label: "Billing", format: "text" }, { key: "count", label: "Records", format: "int" },
          { key: "revenue", label: "Revenue (SAR)", format: "money" },
        ],
      }],
    },
  };
}

const BUILD = { overview: overviewDashboard, rollouts: rolloutDashboard, executions: executionDashboard, work_done: workDoneDashboard };

export default function IMWorkSummary({ imName, section = "overview" }) {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!imName) {
      setPayload(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // Cached: all four sections read ONE payload, so moving between them
      // (each remounts this component) does not refetch.
      setPayload(await pmApi.getIMReports());
    } catch (e) {
      setPayload(null);
      setError(e.message || "Could not load reports");
    } finally {
      setLoading(false);
    }
  }, [imName]);

  useEffect(() => { load(); }, [load]);

  // The recent-rows MiniTable mounts fresh per section; nudge DataTablePro
  // once its rows exist (same pattern as IMMaterialRequest's switchTab).
  useEffect(() => {
    if (!payload) return undefined;
    const t = setTimeout(() => document.dispatchEvent(new CustomEvent("tablepro:check")), 60);
    return () => clearTimeout(t);
  }, [payload, section]);

  const built = useMemo(() => (payload ? (BUILD[section] || overviewDashboard)(payload) : null), [payload, section]);

  if (error) {
    return (
      <div className="page-content">
        <div className="notice error"><span>⚠</span> {error}</div>
      </div>
    );
  }
  if (!imName) {
    return (
      <div className="page-content">
        <div className="empty-state">
          <div className="empty-icon">📊</div>
          <h3>IM account not linked</h3>
          <p style={{ color: "#64748b", fontSize: "0.88rem", maxWidth: 460, margin: "8px auto 0" }}>
            Sign in with an INET IM user linked to IM Master, or open My Dashboard to verify setup.
          </p>
        </div>
      </div>
    );
  }
  if (!payload) {
    return (
      <div style={{ padding: 48, textAlign: "center", color: "#94a3b8" }}>
        {loading ? "Loading summary…" : "No data returned"}
      </div>
    );
  }

  return (
    <div className="page-content">
      <div className="rdash">
        <ReportDashboard dashboard={built.dashboard} />
        {built.table && (
          <Card title={built.table.title} aside={<span className="rdash-muted">{built.table.sub}</span>}>
            <div style={{ padding: "0 12px 12px" }}>
              <MiniTable resizable tableKey={built.table.key} columns={built.table.columns} rows={built.table.rows} emptyText="Nothing this period." />
            </div>
          </Card>
        )}
        {payload.last_updated && (
          <p style={{ fontSize: "0.72rem", color: "#94a3b8", margin: 0 }}>
            Last updated: {(() => {
              const d = new Date(String(payload.last_updated).replace(" ", "T"));
              return Number.isNaN(d.getTime()) ? String(payload.last_updated) : d.toLocaleString();
            })()}
          </p>
        )}
      </div>
    </div>
  );
}
