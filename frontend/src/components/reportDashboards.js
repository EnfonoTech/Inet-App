/**
 * One dashboard builder per report key, for the catalog's tiles / charts /
 * top-N block (ReportDashboard.jsx).
 *
 * Each builder reads ONLY the rows and totals the report endpoint returned —
 * the same rows the table under it shows — so the dashboard can never tell a
 * different story from the table, and a filter that narrows the table
 * narrows the dashboard with it. Reports return their whole result set (no
 * row limit), which is what makes computing here safe.
 *
 * Planning / Utilization (daily) / Implementation have no builder on purpose:
 * those three stay plain tables.
 */

const n = (v) => Number(v) || 0;
const sum = (rows, k) => rows.reduce((a, r) => a + n(r[k]), 0);
const pct = (num, den) => (den ? Math.round((num / den) * 1000) / 10 : 0);
const top = (rows, k, count = 5, asc = false) =>
  [...rows].sort((a, b) => (asc ? n(a[k]) - n(b[k]) : n(b[k]) - n(a[k]))).slice(0, count);

function groupBy(rows, key, fields, keep = []) {
  const out = new Map();
  for (const r of rows) {
    const k = r[key] || "—";
    if (!out.has(k)) out.set(k, { [key]: k, ...Object.fromEntries(fields.map((f) => [f, 0])), ...Object.fromEntries(keep.map((f) => [f, r[f]])) });
    const g = out.get(k);
    for (const f of fields) g[f] += n(r[f]);
  }
  return [...out.values()];
}

const tile = (label, value, format = "int", sub, tone = "blue", icon = "avg") => ({ label, value, format, sub, tone, icon });
const chart = (kind, title, data, series, x = "label", format = "int", extra = {}) => ({
  kind, title, data, x, format,
  series: series.map(([key, label, color]) => ({ key, label, color })),
  ...extra,
});
const topTable = (title, rows, columns, sub) => ({
  title, sub, rows, columns: columns.map(([key, label, format = "text"]) => ({ key, label, format })),
});
const band = (rows, k, edges = [50, 75, 95]) => {
  const labels = [`under ${edges[0]}%`, `${edges[0]}–${edges[1]}%`, `${edges[1]}–${edges[2]}%`, `${edges[2]}%+`];
  const counts = [0, 0, 0, 0];
  rows.forEach((r) => { const v = n(r[k]); counts[v < edges[0] ? 0 : v < edges[1] ? 1 : v < edges[2] ? 2 : 3] += 1; });
  const colors = ["#b42318", "#e0a320", "#3f9b5c", "#15803d"];
  return labels.map((label, i) => ({ label, count: counts[i], color: colors[i] }));
};
const statusDonut = (rows, k, order, colors) => {
  const counts = groupBy(rows.map((r) => ({ ...r, __one: 1 })), k, ["__one"]);
  const byKey = Object.fromEntries(counts.map((c) => [String(c[k]).toUpperCase(), c.__one]));
  return order.map((s, i) => ({ label: s, value: byKey[s.toUpperCase()] || 0, color: colors[i] }));
};

const BUILDERS = {
  team_utilization_report(rows) {
    const f = ["planned_activities", "completed_activities", "achieved_qty", "achieved_amount"];
    const planned = sum(rows, "planned_activities");
    const done = sum(rows, "completed_activities");
    const teams = groupBy(rows, "team_id", f, ["team_name"]).map((t) => ({
      ...t,
      // "Team-30 · Abu Jabir" — the number alone tells nobody which team it is.
      team_label: t.team_name && t.team_name !== t.team_id ? `${t.team_id} · ${t.team_name}` : t.team_id,
      achievement_pct: pct(t.completed_activities, t.planned_activities),
    }));
    const days = groupBy(rows, "plan_date", f).sort((a, b) => String(a.plan_date).localeCompare(String(b.plan_date)))
      .map((d) => ({ ...d, label: String(d.plan_date).slice(5) }));
    const cols = [["team_id", "Team"], ["team_name", "Team lead"], ["planned_activities", "Planned", "int"],
      ["completed_activities", "Done", "int"], ["achievement_pct", "Ach. %", "pct"], ["achieved_amount", "SAR", "money"]];
    return {
      tiles: [
        tile("Teams", teams.length, "int", `${days.length} working days`, "blue", "teams"),
        tile("Planned activities", planned, "int", "cancelled left out", "grey", "planned"),
        tile("Completed activities", done, "int", `${planned - done} not completed`, "green", "done"),
        tile("Achievement", pct(done, planned), "pct", "completed ÷ planned", "blue", "rate"),
        tile("Achieved qty", sum(rows, "achieved_qty"), "qty", null, "grey", "box"),
        tile("Achieved amount", sum(rows, "achieved_amount"), "money", "SAR, completed plans", "green", "money"),
      ],
      charts: [
        chart("bar", "Planned vs completed by day", days, [["planned_activities", "Planned", "#b9cdf3"], ["completed_activities", "Completed", "#163a7a"]]),
        chart("hbar", "Achieved amount by team", top(teams, "achieved_amount", 8), [["achieved_amount", "SAR"]], "team_label", "money", { sub: "top 8" }),
        chart("donut", "Planned activities", [
          { label: "Completed", value: done, color: "#15803d" },
          { label: "Not completed", value: planned - done, color: "#e0a320" },
        ], [["value", "Activities"]], "label", "int", { centerLabel: "planned" }),
      ],
      tops: [
        topTable("Top 5 teams by achieved amount", top(teams, "achieved_amount"), cols),
        topTable("Lowest 5 teams by achievement", top(teams, "achievement_pct", 5, true), cols, "teams with a plan in the period"),
      ],
    };
  },

  team_rating(rows) {
    const jobs = sum(rows, "jobs");
    const rated = sum(rows, "rated");
    const ratedTeams = rows.filter((r) => n(r.rated) > 0);
    // Weighted by rated jobs, so a team rated once does not count as much as one rated forty times.
    const wavg = (k) => { const w = sum(ratedTeams, "rated"); return w ? Math.round((ratedTeams.reduce((a, r) => a + n(r[k]) * n(r.rated), 0) / w) * 100) / 100 : 0; };
    const cols = [["team", "Team"], ["rated", "Rated", "int"], ["overall", "Overall", "qty"], ["quality", "Quality", "qty"], ["safety", "Safety", "qty"]];
    return {
      tiles: [
        tile("Teams", rows.length, "int", `${ratedTeams.length} with ratings`, "blue", "teams"),
        tile("Jobs", jobs, "int", "in the period", "grey", "planned"),
        tile("Rated jobs", rated, "int", `${pct(rated, jobs)}% of jobs`, "green", "star"),
        tile("Not rated", jobs - rated, "int", "jobs waiting for a rating", jobs - rated ? "amber" : "grey", "alert"),
        tile("Average overall", wavg("overall"), "qty", "out of 5, weighted by jobs", "blue", "avg"),
      ],
      charts: [
        chart("bar", "Average score by area", [
          { label: "Execution", score: wavg("execution") }, { label: "Quality", score: wavg("quality") },
          { label: "Safety", score: wavg("safety") }, { label: "Timeliness", score: wavg("timeliness") },
          { label: "Overall", score: wavg("overall") },
        ], [["score", "Score", "#1d5fd1"]], "label", "qty", { sub: "out of 5" }),
        chart("hbar", "Overall by team", top(ratedTeams, "overall", 10), [["overall", "Overall"]], "team", "qty", { sub: "rated teams" }),
        chart("donut", "Jobs rated", [
          { label: "Rated", value: rated, color: "#15803d" },
          { label: "Not rated", value: jobs - rated, color: "#c7d0dc" },
        ], [["value", "Jobs"]], "label", "int", { centerLabel: "jobs" }),
      ],
      tops: [
        topTable("Top 5 rated teams", top(ratedTeams, "overall"), cols),
        topTable("Most jobs not rated", top(rows, "not_rated"), [["team", "Team"], ["jobs", "Jobs", "int"], ["not_rated", "Not rated", "int"], ["rated_pct", "Rated %", "pct"]]),
      ],
    };
  },

  im_performance(rows, totals) {
    const revenue = sum(rows, "revenue");
    const target = sum(rows, "target");
    const cols = [["im", "IM"], ["score", "Score", "pct"], ["rating", "Rating"], ["revenue", "Revenue", "money"], ["profit", "Margin", "money"]];
    return {
      tiles: [
        tile("IMs", rows.length, "int", `${sum(rows, "teams")} INET teams`, "blue", "teams"),
        tile("Completed lines", sum(rows, "completed_lines"), "int", `${totals?.completion_pct ?? pct(sum(rows, "completed_lines"), sum(rows, "assigned_lines"))}% of assigned`, "green", "done"),
        tile("Revenue", revenue, "money", "SAR", "green", "money"),
        tile("Target", target, "money", `${pct(revenue, target)}% achieved`, "blue", "target"),
        tile("Team cost", sum(rows, "team_cost"), "money", `idle ${Math.round(sum(rows, "cost_idle")).toLocaleString("en")}`, "amber", "clock"),
        tile("Margin", sum(rows, "profit"), "money", "revenue − cost − payout", sum(rows, "profit") < 0 ? "red" : "green", "rate"),
      ],
      charts: [
        chart("hbar", "Revenue vs target by IM", top(rows, "target", 10), [["target", "Target", "#b9cdf3"], ["revenue", "Revenue", "#163a7a"]], "im", "money"),
        chart("hbar", "Score by IM", top(rows, "score", 10), [["score", "Score"]], "im", "pct"),
        chart("hbar", "Margin by IM", top(rows, "profit", 10), [["profit", "Margin"]], "im", "money"),
      ],
      tops: [topTable("IM ranking", top(rows, "score", 10), cols)],
    };
  },

  project_performance(rows, totals) {
    const achieved = sum(rows, "achieved");
    const target = sum(rows, "known_target");
    const cols = [["project_code", "Project"], ["im", "IM"], ["achieved", "Achieved", "money"], ["gap", "Gap", "money"], ["achievement_pct", "Ach. %", "pct"]];
    const byIm = groupBy(rows, "im", ["achieved", "known_target"]).map((g) => ({ ...g, im: g.im === "—" ? "No IM" : g.im }));
    return {
      tiles: [
        tile("Projects", rows.length, "int", null, "blue", "folder"),
        tile("Known target", target, "money", "SAR", "grey", "target"),
        tile("Achieved", achieved, "money", `${totals?.achievement_pct ?? pct(achieved, target)}% of target`, "green", "money"),
        tile("Gap", sum(rows, "gap"), "money", "still to achieve", "amber", "alert"),
        tile("Lines completed", sum(rows, "completed_lines"), "int", `${totals?.completion_pct ?? pct(sum(rows, "completed_lines"), sum(rows, "total_lines"))}% of ${sum(rows, "total_lines").toLocaleString("en")}`, "green", "done"),
      ],
      charts: [
        chart("bar", "Target vs achieved, top 8 projects", top(rows, "known_target", 8), [["known_target", "Target", "#b9cdf3"], ["achieved", "Achieved", "#163a7a"]], "project_code", "money"),
        chart("bar", "Projects by achievement", band(rows, "achievement_pct"), [["count", "Projects", "#1d5fd1"]]),
        chart("hbar", "Achieved by IM", top(byIm, "achieved", 8), [["achieved", "Achieved"]], "im", "money"),
      ],
      tops: [
        topTable("Top 5 projects by achieved", top(rows, "achieved"), cols),
        topTable("Biggest gaps", top(rows, "gap"), cols),
      ],
    };
  },

  project_profitability(rows, totals) {
    const po = sum(rows, "po_value");
    const achieved = sum(rows, "achieved");
    const byDomain = groupBy(rows, "project_domain", ["remaining_value", "po_value"]).map((g) => ({ ...g, project_domain: g.project_domain === "—" ? "No domain" : g.project_domain }));
    const cols = [["project_code", "Project"], ["project_domain", "Domain"], ["po_value", "PO value", "money"], ["remaining_value", "Remaining", "money"], ["delivery_pct", "Delivery %", "pct"]];
    return {
      tiles: [
        tile("Projects", rows.length, "int", null, "blue", "folder"),
        tile("PO value", po, "money", "SAR", "grey", "doc"),
        tile("Revenue achieved", achieved, "money", `${totals?.delivery_pct ?? pct(achieved, po)}% of PO value`, "green", "money"),
        tile("Remaining value", sum(rows, "remaining_value"), "money", "still to deliver", "amber", "clock"),
        tile("Lines completed", sum(rows, "completed_lines"), "int", `of ${sum(rows, "assigned_lines").toLocaleString("en")} assigned`, "green", "done"),
      ],
      charts: [
        chart("bar", "PO value vs achieved, top 8 projects", top(rows, "po_value", 8), [["po_value", "PO value", "#c7d0dc"], ["achieved", "Achieved", "#15803d"]], "project_code", "money"),
        chart("hbar", "Remaining value by domain", top(byDomain, "remaining_value", 8), [["remaining_value", "Remaining"]], "project_domain", "money"),
        chart("bar", "Projects by delivery", band(rows, "delivery_pct"), [["count", "Projects", "#1d5fd1"]]),
      ],
      tops: [
        topTable("Most value still to deliver", top(rows, "remaining_value"), cols),
        topTable("Lowest delivery", top(rows.filter((r) => n(r.po_value) > 0), "delivery_pct", 5, true), cols),
      ],
    };
  },

  rollout_burn_down(rows, totals) {
    const last = rows[rows.length - 1] || {};
    return {
      tiles: [
        tile("PO lines", totals?.total_lines ?? last.total_lines, "int", "in scope", "blue", "doc"),
        tile("Closed so far", last.closed_cumulative, "int", `${pct(n(last.closed_cumulative), n(last.total_lines))}% of lines`, "green", "done"),
        tile("Closed in period", sum(rows, "new_closures"), "int", `${rows.length} weeks`, "green", "up"),
        tile("Planned in period", sum(rows, "planned_lines"), "int", `${n(last.planned_done).toLocaleString("en")} done · ${n(last.plan_adherence_pct)}%`, n(last.plan_adherence_pct) >= 90 ? "green" : "amber", "planned"),
        tile("Remaining", last.remaining_lines, "int", `target ${n(last.target_remaining).toLocaleString("en")}`, "amber", "clock"),
        tile("Progress", last.actual_pct, "pct", `target ${n(last.target_pct)}%`, n(last.actual_pct) >= n(last.target_pct) ? "green" : "red", "rate"),
      ],
      charts: [
        chart("line", "Remaining lines vs target", rows, [["remaining_lines", "Remaining", "#1d5fd1"], ["target_remaining", "Target", "#e08a2c"]], "week"),
        chart("bar", "Planned vs closed per week", rows, [["planned_lines", "Planned", "#b9cdf3"], ["new_closures", "Closed", "#15803d"]], "week"),
        chart("bar", "Re-scheduled per week", rows, [["reschedules", "Re-scheduled", "#e0a320"]], "week", "int", { sub: `${sum(rows, "reschedules")} in the period` }),
      ],
    };
  },

  po_dispatch_status(rows, totals) {
    const lines = sum(rows, "lines_count");
    const value = sum(rows, "value");
    const byStage = groupBy(rows, "stage", ["lines_count", "value"]);
    const closed = byStage.find((s) => /closed/i.test(s.stage));
    const cancelled = byStage.find((s) => /cancel/i.test(s.stage));
    return {
      tiles: [
        tile("PO lines", lines, "int", null, "blue", "doc"),
        tile("Value", value, "money", "SAR", "blue", "money"),
        tile("Avg per line", totals?.avg_value ?? (lines ? value / lines : 0), "money", "SAR", "grey", "avg"),
        tile("Closed", closed?.lines_count || 0, "int", `${pct(n(closed?.lines_count), lines)}% of lines`, "green", "done"),
        tile("Cancelled", cancelled?.lines_count || 0, "int", `${pct(n(cancelled?.lines_count), lines)}% of lines`, "red", "alert"),
      ],
      charts: [
        chart("bar", "Lines by stage", byStage, [["lines_count", "Lines", "#1d5fd1"]], "stage"),
        chart("donut", "Value by stage", byStage.map((s) => ({ label: s.stage, value: s.value })), [["value", "SAR"]], "label", "money", { centerLabel: "SAR" }),
        chart("hbar", "Value by status", top(rows, "value", 8), [["value", "SAR"]], "status", "money"),
      ],
    };
  },

  po_milestone_status(rows, totals) {
    const value = sum(rows, "value");
    const closed = rows.find((r) => /invoice closed/i.test(r.status || ""));
    return {
      tiles: [
        tile("Milestones", sum(rows, "milestones"), "int", `MS1 ${sum(rows, "ms1_count").toLocaleString("en")} · MS2 ${sum(rows, "ms2_count").toLocaleString("en")}`, "blue", "doc"),
        tile("Value", value, "money", "SAR", "blue", "money"),
        tile("MS1 value", sum(rows, "ms1_value"), "money", null, "grey", "money"),
        tile("MS2 value", sum(rows, "ms2_value"), "money", null, "grey", "money"),
        tile("Invoice closed", n(closed?.value), "money", `${pct(n(closed?.value), value)}% of value`, "green", "done"),
      ],
      charts: [
        chart("hbar", "Value by PIC status", top(rows, "value", 10), [["value", "SAR"]], "status", "money"),
        chart("hbar", "Milestones by PIC status", top(rows, "milestones", 10), [["ms1_count", "MS1", "#1d5fd1"], ["ms2_count", "MS2", "#9db8ea"]], "status", "int", { stacked: true }),
        chart("donut", "MS1 vs MS2 value", [
          { label: "MS1", value: sum(rows, "ms1_value"), color: "#1d5fd1" },
          { label: "MS2", value: sum(rows, "ms2_value"), color: "#9db8ea" },
        ], [["value", "SAR"]], "label", "money", { centerLabel: "SAR" }),
      ],
    };
  },

  top_teams(rows, totals) {
    const revenue = sum(rows, "revenue");
    const profit = sum(rows, "profit");
    // Teams with no revenue, no cost and no plans rank between the earners
    // and the loss-makers on profit (they sit at exactly 0), so they filled
    // the "Top 5 by profit" table. Rankings use the teams that did something
    // or cost something; the table below still lists every team.
    const active = rows.filter((r) => n(r.revenue) || n(r.team_cost) || n(r.assigned_lines));
    const best = top(active, "profit", 5);
    const worst = top(active, "profit", 5, true).filter((r) => !best.includes(r));
    const profitBars = [...best, ...[...worst].reverse()];
    const cols = [["team_name", "Team"], ["im", "IM"], ["revenue", "Revenue", "money"], ["profit", "Profit", "money"], ["completion_pct", "Compl. %", "pct"]];
    return {
      tiles: [
        tile("Teams", rows.length, "int", null, "blue", "teams"),
        tile("Completed lines", sum(rows, "completed_lines"), "int", `${totals?.completion_pct ?? pct(sum(rows, "completed_lines"), sum(rows, "assigned_lines"))}% of assigned`, "green", "done"),
        tile("Revenue", revenue, "money", "SAR", "green", "money"),
        tile("Team cost", sum(rows, "team_cost"), "money", "SAR", "amber", "clock"),
        tile("Profit / loss", profit, "money", `${rows.filter((r) => n(r.profit) < 0).length} teams at a loss`, profit < 0 ? "red" : "green", "rate"),
        tile("Utilization", totals?.utilization_pct ?? 0, "pct", "days worked ÷ days available", "blue", "avg"),
      ],
      charts: [
        chart("bar", "Revenue vs cost, top 8 teams", top(active, "revenue", 8), [["revenue", "Revenue", "#163a7a"], ["team_cost", "Cost", "#e08a2c"]], "team_name", "money"),
        chart("hbar", "Profit by team", profitBars, [["profit", "Profit"]], "team_name", "money", { sub: "best 5 · worst 5" }),
        chart("hbar", "Utilization by team", top(active.filter((r) => n(r.utilization_pct) > 0), "utilization_pct", 10), [["utilization_pct", "Utilization"]], "team_name", "pct", { sub: "top 10" }),
      ],
      tops: [
        topTable("Top 5 by profit", best, cols),
        topTable("Bottom 5 by profit", top(active, "profit", 5, true), cols),
      ],
    };
  },

  team_pva(rows, totals) {
    const f = ["planned_lines", "completed_lines", "target", "revenue"];
    const planned = sum(rows, "planned_lines");
    const done = sum(rows, "completed_lines");
    const target = sum(rows, "target");
    const revenue = sum(rows, "revenue");
    const teams = groupBy(rows, "team_name", f).map((t) => ({ ...t, achievement_pct: pct(t.revenue, t.target), completion_pct: pct(t.completed_lines, t.planned_lines) }));
    const days = groupBy(rows, "plan_date", f).sort((a, b) => String(a.plan_date).localeCompare(String(b.plan_date))).map((d) => ({ ...d, label: String(d.plan_date).slice(5) }));
    const cols = [["team_name", "Team"], ["planned_lines", "Planned", "int"], ["completed_lines", "Done", "int"], ["revenue", "Revenue", "money"], ["achievement_pct", "Ach. %", "pct"]];
    return {
      tiles: [
        tile("Teams", teams.length, "int", `${days.length} days`, "blue", "teams"),
        tile("Planned", planned, "int", "lines", "grey", "planned"),
        tile("Completed", done, "int", `${totals?.completion_pct ?? pct(done, planned)}% of planned`, "green", "done"),
        tile("Target", target, "money", "SAR", "grey", "target"),
        tile("Revenue", revenue, "money", `${totals?.achievement_pct ?? pct(revenue, target)}% of target`, "green", "money"),
      ],
      charts: [
        chart("bar", "Target vs revenue by day", days, [["target", "Target", "#b9cdf3"], ["revenue", "Revenue", "#163a7a"]], "label", "money"),
        chart("hbar", "Revenue by team", top(teams, "revenue", 8), [["revenue", "Revenue"]], "team_name", "money", { sub: "top 8" }),
        chart("bar", "Teams by achievement", band(teams, "achievement_pct"), [["count", "Teams", "#1d5fd1"]]),
      ],
      tops: [
        topTable("Top 5 teams by revenue", top(teams, "revenue"), cols),
        topTable("Lowest 5 by achievement", top(teams, "achievement_pct", 5, true), cols),
      ],
    };
  },

  weekly_performance(rows, totals) {
    const data = rows.map((r) => ({ ...r, label: String(r.week_start).slice(5) }));
    const revenue = sum(rows, "revenue");
    const target = sum(rows, "target");
    return {
      tiles: [
        tile("Weeks", rows.length, "int", "Saturday to Friday", "blue", "planned"),
        tile("Assigned", sum(rows, "assigned_lines"), "int", "lines", "grey", "doc"),
        tile("Completed", sum(rows, "completed_lines"), "int", `${totals?.completion_pct ?? pct(sum(rows, "completed_lines"), sum(rows, "assigned_lines"))}% of assigned`, "green", "done"),
        tile("Re-visits", sum(rows, "revisits"), "int", null, "amber", "clock"),
        tile("Revenue", revenue, "money", `${totals?.achievement_pct ?? pct(revenue, target)}% of target`, "green", "money"),
        tile("Target", target, "money", "SAR", "grey", "target"),
      ],
      charts: [
        chart("bar", "Target vs revenue by week", data, [["target", "Target", "#b9cdf3"], ["revenue", "Revenue", "#163a7a"]], "label", "money"),
        chart("line", "Completion by week", data, [["completion_pct", "Completion %", "#15803d"], ["achievement_pct", "Achievement %", "#1d5fd1"]], "label", "pct"),
        chart("bar", "Active teams and re-visits", data, [["active_teams", "Active teams", "#1d5fd1"], ["revisits", "Re-visits", "#e0a320"]]),
      ],
    };
  },

  revenue_forecast(rows) {
    const cur = rows[0] || {};
    return {
      tiles: [
        tile(`Planned · ${cur.month || ""}`, cur.planned, "money", "SAR", "grey", "planned"),
        tile("Achieved", cur.achieved, "money", `${pct(n(cur.achieved), n(cur.planned))}% of planned`, "green", "money"),
        tile("Daily run rate", cur.run_rate, "money", `${n(cur.days_passed)} of ${n(cur.total_days)} days`, "blue", "avg"),
        tile("Forecast", cur.forecast, "money", "at the current run rate", "blue", "up"),
        tile("Gap", cur.gap, "money", "forecast − planned", n(cur.gap) < 0 ? "red" : "green", "alert"),
      ],
      charts: [
        chart("bar", "Planned, achieved and forecast by month", [...rows].reverse(), [["planned", "Planned", "#c7d0dc"], ["achieved", "Achieved", "#15803d"], ["forecast", "Forecast", "#1d5fd1"]], "month", "money"),
      ],
    };
  },

  site_sign_status(rows) { return siteStatus(rows, "Bills", "bill_no"); },
  site_verify_status(rows) { return siteStatus(rows, "Sites", "du_id"); },

  bill_wise_status(rows) {
    const bills = new Set(rows.map((r) => r.bill_no)).size;
    const byProject = groupBy(rows, "project_name", ["remaining_qty", "received_qty"]);
    const statuses = [...new Set(rows.map((r) => r.status).filter(Boolean))];
    return {
      tiles: [
        tile("Bills", bills, "int", `${rows.length} item lines`, "blue", "doc"),
        tile("Received", sum(rows, "received_qty"), "qty", "qty", "grey", "box"),
        tile("Used", sum(rows, "issued_qty"), "qty", "qty", "green", "done"),
        tile("Remaining", sum(rows, "remaining_qty"), "qty", "qty still at site", "amber", "clock"),
      ],
      charts: [
        chart("donut", "Item lines by status", statusDonut(rows, "status", statuses, ["#15803d", "#e0a320", "#b42318", "#1d5fd1", "#94a3b8"]), [["value", "Lines"]], "label", "int", { centerLabel: "lines" }),
        chart("hbar", "Remaining qty by project", top(byProject, "remaining_qty", 8), [["remaining_qty", "Remaining"]], "project_name", "qty"),
      ],
    };
  },

  huawei_outbound_analytics(rows) {
    const shipments = sum(rows, "shipments");
    const volume = sum(rows, "total_volume");
    const bySub = groupBy(rows, "subcon_label", ["shipments", "total_volume"]);
    const byDomain = groupBy(rows, "domain_label", ["shipments", "total_volume"]);
    const byProject = groupBy(rows, "project_label", ["shipments", "total_volume"]);
    return {
      tiles: [
        tile("Shipments", shipments, "int", null, "blue", "box"),
        tile("Volume", volume, "qty", "m³", "blue", "box"),
        tile("Subcontractors", bySub.length, "int", null, "grey", "teams"),
        tile("Projects", byProject.length, "int", null, "grey", "folder"),
      ],
      charts: [
        chart("hbar", "Volume by subcontractor", top(bySub, "total_volume", 8), [["total_volume", "m³"]], "subcon_label", "qty"),
        chart("donut", "Shipments by domain", top(byDomain, "shipments", 6).map((d) => ({ label: d.domain_label, value: d.shipments })), [["value", "Shipments"]], "label", "int", { centerLabel: "shipments" }),
        chart("hbar", "Volume by project", top(byProject, "total_volume", 8), [["total_volume", "m³"]], "project_label", "qty"),
      ],
    };
  },
};

function siteStatus(rows, noun, idKey) {
  const order = ["Normal", "Warning", "Overdue"];
  const colors = ["#15803d", "#e0a320", "#b42318"];
  const counts = statusDonut(rows, "status", order, colors);
  const byProject = groupBy(rows.map((r) => ({ ...r, __one: 1 })), "project_name", ["__one"]).map((g) => ({ project_name: g.project_name, count: g.__one }));
  const ages = [
    { label: "0–7 days", count: rows.filter((r) => n(r.pending_days) <= 7).length },
    { label: "8–30", count: rows.filter((r) => n(r.pending_days) > 7 && n(r.pending_days) <= 30).length },
    { label: "31–90", count: rows.filter((r) => n(r.pending_days) > 30 && n(r.pending_days) <= 90).length },
    { label: "90+", count: rows.filter((r) => n(r.pending_days) > 90).length },
  ];
  return {
    tiles: [
      tile(noun, new Set(rows.map((r) => r[idKey])).size, "int", "pending", "blue", "doc"),
      tile("Normal", counts[0].value, "int", null, "green", "done"),
      tile("Warning", counts[1].value, "int", null, "amber", "clock"),
      tile("Overdue", counts[2].value, "int", null, counts[2].value ? "red" : "grey", "alert"),
      tile("Average wait", rows.length ? sum(rows, "pending_days") / rows.length : 0, "int", "days pending", "grey", "clock"),
    ],
    charts: [
      chart("donut", "By status", counts, [["value", noun]], "label", "int", { centerLabel: noun.toLowerCase() }),
      chart("bar", "How long pending", ages, [["count", noun, "#1d5fd1"]]),
      chart("hbar", "Pending by project", top(byProject, "count", 8), [["count", noun]], "project_name"),
    ],
    tops: [topTable("Longest pending", top(rows, "pending_days"), [["project_name", "Project"], [idKey, idKey === "du_id" ? "DU ID" : "Bill"], ["status", "Status"], ["pending_days", "Days", "int"]])],
  };
}

export function buildReportDashboard(key, rows, totals) {
  const b = BUILDERS[key];
  if (!b || !Array.isArray(rows) || rows.length === 0) return null;
  try {
    return b(rows, totals || {});
  } catch (e) {
    // A dashboard is a summary of the table; if it cannot be built the table still stands.
    console.error(`Report dashboard for ${key} failed`, e);
    return null;
  }
}
