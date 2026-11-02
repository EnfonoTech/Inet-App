import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { pmApi } from "../../services/api";
import DashHeader from "../../components/DashHeader";
import { useAuth } from "../../context/AuthContext";
import DateRangePicker, { DATE_PRESETS } from "../../components/DateRangePicker";
import { Card, ChartCard, Tile, TopTable, fmt } from "../../components/ReportDashboard";

/**
 * IM Dashboard — one IM's range: their plans, the teams that worked them,
 * their projects' delivery, their money against target, and what is waiting
 * on them. Used by the IM (My Dashboard) and by the PM (IM View, with an IM
 * picked — `overrideIm`).
 *
 * Everything is scoped off the IM stamped on the work (see get_im_dashboard).
 * "Waiting on you" reads Execution Analytics for this IM, the same buckets
 * and predicates as the IM's Execution Analytics page, so a count here opens
 * exactly its own rows.
 */

function defaultRange() {
  const r = DATE_PRESETS.this_month.range(new Date());
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { from: iso(r.from), to: iso(r.to) };
}

const n = (v) => Number(v) || 0;
const isoToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const sar = (v) => `SAR ${fmt(v, "int")}`;

const STATUS_COLORS = {
  Completed: "#15803d", "In Execution": "#1d5fd1", Planned: "#9db8ea", Extended: "#6d4bd1",
  Overdue: "#b42318", "Not Attended": "#c2410c", "Planning with Issue": "#e0a320", Cancelled: "#c7d0dc",
};

// Execution Analytics buckets worth an IM's attention, in the order to act.
const BUCKETS = [
  { key: "im_confirmation_pending", label: "Confirm execution", tone: "amber" },
  // The part of the above with nothing else open (QC / CIAG settled) — one click from done.
  { key: "im_confirmation_only", label: "Only IM confirmation left", tone: "red" },
  { key: "qc_failed", label: "QC failed", tone: "red" },
  { key: "qc_pending", label: "QC pending", tone: "amber" },
  { key: "ciag_pending", label: "CIAG pending", tone: "amber" },
  { key: "work_done_missing", label: "Work Done not created", tone: "amber" },
  { key: "overdue_by_date", label: "Overdue plans", tone: "red" },
];
const TONE = {
  red: { bd: "#f3c7c3", bg: "#fff8f7", fg: "#b42318" },
  amber: { bd: "#f6d4bf", bg: "#fffaf5", fg: "#b54708" },
  grey: { bd: "#e3e9f2", bg: "#f8fafd", fg: "#475569" },
};

function ActionRow({ count, label, sub, tone, onClick }) {
  const t = TONE[n(count) ? tone : "grey"] || TONE.grey;
  return (
    <button type="button" onClick={onClick} disabled={!onClick} style={{
      display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left",
      cursor: onClick ? "pointer" : "default", padding: "8px 12px", border: `1px solid ${t.bd}`,
      background: t.bg, borderRadius: 9, font: "inherit", opacity: n(count) ? 1 : 0.65,
    }}>
      <span style={{ fontSize: "1.2rem", fontWeight: 800, color: t.fg, minWidth: 40 }}>{fmt(count, "int")}</span>
      <span style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
        <b style={{ fontSize: "0.8rem", color: "#0f1e36" }}>{label}</b>
        {sub && <span className="rdash-muted">{sub}</span>}
      </span>
    </button>
  );
}

export default function IMDashboard({ overrideIm, headerLeft }) {
  const navigate = useNavigate();
  const { imName: authIm } = useAuth();
  const isPmView = Boolean(overrideIm);
  const imName = overrideIm || authIm;
  const [range, setRange] = useState(defaultRange);
  const [data, setData] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    pmApi.getIMDashboard(imName, { from_date: range.from, to_date: range.to })
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) { setData(null); setError(e?.message || "Failed to load dashboard"); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [imName, range.from, range.to, reload]);

  // Live, not ranged: what is waiting on the IM right now.
  useEffect(() => {
    let cancelled = false;
    setAnalytics(null);
    pmApi.getExecutionAnalytics({ im: imName || "", portal_filters: {}, dimensions: [] })
      .then((r) => { if (!cancelled) setAnalytics(r || null); }).catch(() => {});
    return () => { cancelled = true; };
  }, [imName, reload]);

  // Refresh every 5 minutes so the figures stay current.
  useEffect(() => {
    const t = setInterval(() => setReload((k) => k + 1), 5 * 60_000);
    return () => clearInterval(t);
  }, []);

  const k = data?.kpi || {};
  const act = data?.action_items || {};
  const wc = data?.work_closed || {};
  const open = data?.open_lines || {};
  const dummy = data?.dummy || {};
  const buckets = useMemo(() => Object.fromEntries((analytics?.buckets || []).map((b) => [b.key, b])), [analytics]);

  // Every figure opens the page or report it comes from, already filtered to
  // the same IM, period and status, so it can be checked there row by row.
  // An IM opens their own pages; the PM (no IM pages) the PM page behind it.
  const today = isoToday();
  const ym = range.from ? range.from.slice(0, 7) : today.slice(0, 7);
  const imF = isPmView ? [overrideIm] : undefined;
  const nav = (path, state) => () => navigate(path, state ? { state } : undefined);
  const workDone = (from, to, sourceFilter) => isPmView
    ? nav("/work-done", { workDoneFilters: { tab: "list", imFilter: imF, includeFinished: true, fromDate: from, toDate: to,
        ...(sourceFilter ? { workTypeFilter: sourceFilter } : {}) } })
    : nav("/im-work-done", { workDoneFilters: { tab: "all", fromDate: from, toDate: to, ...(sourceFilter ? { sourceFilter } : {}) } });
  // The PM's Rollout Planning list takes the IM, scope and the exact extra
  // conditions a figure counted (see RolloutPlanning.jsx `planFilters`).
  const pmLines = (planScope, portal, label, extra) =>
    nav("/planning", { planFilters: { imFilter: imF, planScope, portal, label, ...extra } });
  const openStatuses = (open.by_status || []).map((s) => s.status);
  const nextMonthStart = (() => {
    if (!act.month_end) return "";
    const [y, m] = act.month_end.split("-").map(Number);
    return `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`;
  })();
  const openLines = (statuses) => isPmView
    ? pmLines("all", { dispatch_status: statuses }, `${statuses.length === 1 ? statuses[0] : "open"} lines (not done, not cancelled)`)
    : nav("/im-po-intake", { tab: "overview", ovStatusFilter: statuses });
  const plans = (from, to, statuses) => isPmView
    ? nav("/execution", { execFilters: { planStatusFilter: statuses || [], fromDate: from, toDate: to, imFilter: imF, closure: "all", tab: "all" } })
    : nav("/im-planning", { execFilters: { planStatusFilter: statuses || [], fromDate: from, toDate: to } });
  // Every plan status that is real work — the "Plans in range" tile leaves cancelled out.
  const LIVE = ["Planned", "In Execution", "Completed", "Overdue", "Not Attended", "Extended", "Planning with Issue"];
  const to = {
    workDone: workDone(range.from, range.to),
    workDoneToday: workDone(today, today),
    shortcuts: workDone(range.from, range.to, ["Direct Close", "Backend"]),
    plans: plans(range.from, range.to, LIVE),
    plansToday: plans(today, today, LIVE),
    overdue: plans(range.from, range.to, ["Overdue", "Not Attended"]),
    lines: openLines(openStatuses),
    dummy: isPmView ? pmLines("open_dummy", null, "", { dummyFilter: "open" }) : nav("/im-po-intake", { tab: "dummy" }),
    // Due = target month this month or earlier; later = forecast for a later month.
    toPlan: isPmView
      ? pmLines("unplanned", { has_target_month: "yes", internal_preset: "include", to_date: act.month_end },
          "Dispatched lines due by this month (target month this month or earlier)")
      : nav("/im-dispatch", { dispatchFilters: { toDate: act.month_end } }),
    forecastLater: isPmView
      ? pmLines("unplanned", { has_target_month: "yes", internal_preset: "include", from_date: nextMonthStart },
          "Dispatched lines forecast for a later month")
      : nav("/im-dispatch", { dispatchFilters: { fromDate: nextMonthStart } }),
    awaitingMonth: isPmView
      ? pmLines("all", { has_target_month: "no", dispatch_status: ["Pending", "Dispatched"] }, "lines with no target month yet")
      : nav("/im-po-intake", { tab: "intake" }),
    money: isPmView ? nav(`/reports?tab=im_performance&from=${range.from}&to=${range.to}`) : workDone(range.from, range.to),
    teams: nav(isPmView ? `/reports?tab=monthly_team_details&month=${ym}&im=${encodeURIComponent(overrideIm)}`
      : `/im-reports?tab=monthly_team_details&month=${ym}`),
    projects: nav(isPmView ? `/reports?tab=project_performance&im=${encodeURIComponent(overrideIm)}` : "/im-reports?tab=project_performance"),
    issues: isPmView ? nav("/issues-risks", { imFilter: imF }) : nav("/im-issues-risks"),
    teamRequests: isPmView ? undefined : nav("/im-teams", { tab: "incoming" }),
    cancelRequests: isPmView ? nav("/approvals", { imFilter: imF }) : undefined,
  };
  const More = ({ onClick, label = "Open" }) => <button type="button" className="rdash-link" onClick={onClick}>{label} →</button>;

  function openBucket(b) {
    const execFilters = { bucket: b.key, bucketLabel: b.label, planStatusFilter: [], closure: "all", visits: "current", tab: "all" };
    if (isPmView) navigate("/execution", { state: { execFilters: { ...execFilters, imFilter: imF } } });
    else navigate(b.target === "work_done" ? "/im-execution" : "/im-planning", { state: { execFilters } });
  }

  const waiting = useMemo(() => {
    if (!analytics) return [];
    const rows = BUCKETS.map((b) => {
      const bk = buckets[b.key];
      return bk && { key: b.key, count: bk.value, label: b.label, tone: b.tone, sub: sar(bk.amount), onClick: () => openBucket(bk) };
    }).filter(Boolean);
    rows.push({ key: "issues", count: analytics.totals?.issues_open, label: "Open issues", tone: "red", sub: sar(analytics.totals?.issues_value), onClick: to.issues });
    rows.push({ key: "dummy", count: dummy.count, label: "Dummy POs to map", tone: "amber", sub: "planned or not · PO Control › Dummy POs", onClick: to.dummy });
    rows.push({ key: "toplan", count: act.to_plan, label: "Lines to plan", tone: n(act.to_plan_overdue) ? "amber" : "grey",
      sub: `target month this month or earlier${n(act.to_plan_overdue) ? ` · ${fmt(act.to_plan_overdue, "int")} from past months` : ""} · Rollout Planning`,
      onClick: to.toPlan });
    rows.push({ key: "later", count: act.forecast_later, label: "Lines forecast for later", tone: "grey",
      sub: "target month after this month · Rollout Planning", onClick: to.forecastLater });
    rows.push({ key: "nomonth", count: act.awaiting_month, label: "Lines to forecast", tone: "grey", sub: "no target month yet · PO Intake", onClick: to.awaitingMonth });
    rows.push({ key: "teamreq", count: act.team_requests, label: "Team requests to answer", tone: "amber",
      sub: isPmView ? "the IM answers these in My Teams" : "My Teams › Incoming", onClick: to.teamRequests });
    rows.push({ key: "cancelreq", count: act.cancel_requests, label: "Plan cancels awaiting PM", tone: "amber",
      sub: isPmView ? "Approvals inbox" : "waiting for PM approval", onClick: to.cancelRequests });
    return rows.filter((r) => n(r.count) > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analytics, buckets, dummy.count, act, isPmView, range.from, range.to]);

  const routeCount = (r) => n((wc.by_route || []).find((g) => g.route === r)?.count);
  const rollout = routeCount("Rollout");
  const shortcut = routeCount("Direct Close") + routeCount("Backend");
  const closedDays = useMemo(() => (wc.by_day || []).map((d) => ({ ...d, label: String(d.day).slice(5) })), [wc]);
  const planDays = useMemo(() => (data?.plans_by_day || []).map((d) => ({ ...d, label: String(d.day).slice(5) })), [data]);
  const statuses = useMemo(() => (data?.plans_by_status || []).map((s) => ({ label: s.status, value: s.count, color: STATUS_COLORS[s.status] })), [data]);
  const teams = useMemo(() => (data?.teams || []).map((t) => ({
    ...t, label: t.team_name && t.team_name !== t.team_id ? `${t.team_id} · ${t.team_name}` : t.team_id,
  })), [data]);
  // Rows of the Project Performance report itself, biggest gap first.
  const projects = useMemo(() => (data?.projects || []).slice(0, 8).map((p) => ({
    ...p, lines_done: `${fmt(p.completed_lines, "int")} / ${fmt(p.total_lines, "int")}`,
  })), [data]);
  const dc = data?.direct_close || {};

  const revPct = pct(n(k.revenue), n(k.target));
  // Against the period before: the month before for a whole month, else the
  // same number of days just before the range.
  const prev = data?.previous;
  const prevLabel = useMemo(() => {
    if (!prev?.from) return "";
    const f = new Date(`${prev.from}T00:00:00`);
    const t = new Date(`${prev.to}T00:00:00`);
    const wholeMonths = f.getDate() === 1 && new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1).getDate() === 1;
    const mon = (d) => d.toLocaleString("en", { month: "short" });
    if (f.getMonth() === t.getMonth() && f.getFullYear() === t.getFullYear()) {
      return wholeMonths ? mon(f) : `${f.getDate()}–${t.getDate()} ${mon(f)}`;
    }
    return `${f.getDate()} ${mon(f)} – ${t.getDate()} ${mon(t)}`;
  }, [prev?.from, prev?.to]);
  const delta = (now, before, money) => {
    if (!prev) return undefined;
    const b = n(before);
    const was = money ? `SAR ${fmt(b, "int")}` : fmt(b, "int");
    if (!b) return { text: `${was} in ${prevLabel}`, dir: "flat" };
    const ch = ((n(now) - b) / b) * 100;
    return { text: `${ch >= 0 ? "▲" : "▼"} ${Math.abs(ch).toFixed(0)}% vs ${prevLabel} (${was})`, dir: Math.abs(ch) < 0.5 ? "flat" : ch > 0 ? "up" : "down" };
  };
  const title = isPmView ? "IM View" : "My Dashboard";
  // Rollout detail only for an IM who has live plans in the range — a Direct
  // Close IM with a few cancelled plans gets no empty rollout section.
  const hasPlans = n(k.plans) > 0;
  const todayCells = [
    { label: "Work closed today", value: data?.work_closed_today, sub: "every route", onClick: to.workDoneToday },
    { label: "Planned today", value: k.today_planned, sub: "rollout plans", onClick: to.plansToday },
    { label: "Completed today", value: k.today_completed, sub: "of today's plans", onClick: to.plansToday },
    { label: "Teams working today", value: k.teams_today, sub: "with an execution today" },
    { label: "Direct / Backend today", value: dc.today, sub: "closed without a plan", onClick: to.workDoneToday },
  ];

  return (
    <div className="nd-dashboard" style={{ padding: isPmView ? 0 : 16 }}>
      <DashHeader left={headerLeft} title={`${title}${data?.im_name ? ` · ${data.im_name}` : ""}`} hint="All the work — rollout, Direct Close and Backend — and what is waiting. Click any figure to open its list." lastUpdated={data?.last_updated}>
        <DateRangePicker value={range} onChange={(r) => setRange({ from: r.from, to: r.to })} />
        <button type="button" className="btn-secondary" disabled={loading} onClick={() => setReload((x) => x + 1)}>{loading ? "Loading…" : "Refresh"}</button>
      </DashHeader>

      {error && <div className="notice error"><span>⚠</span> {error}</div>}
      {data?.message && <div className="notice warning"><span>⚠</span> {data.message}</div>}
      {!data && loading && <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Loading dashboard…</div>}

      {data?.kpi && (
        <div className="rdash">
          {/* ── Today first — whatever the range picked above ── */}
          <section className="rdash-card" aria-label="Today">
            <div className="rdash-card-hd"><h2>Today · {today}</h2><span className="rdash-muted">whatever the range</span></div>
            <div style={{ padding: "0 14px 14px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
              {todayCells.map((c) => (
                <button key={c.label} type="button" onClick={c.onClick} disabled={!c.onClick} className="rdash-tile rdash-tile-link"
                  style={{ display: "block", cursor: c.onClick ? "pointer" : "default", background: "#f8fafd" }}>
                  <div className="rdash-tile-label">{c.label}</div>
                  <div className="rdash-tile-value">{fmt(c.value, "int")}</div>
                  <div className="rdash-tile-sub">{c.sub}</div>
                </button>
              ))}
            </div>
          </section>

          {/* ── The range: every route of work, the money, the backlog ── */}
          <div className="rdash-tiles">
            <Tile icon="done" tone="green" label="Work closed" value={fmt(wc.total, "int")} onClick={to.workDone}
              sub={`${fmt(rollout, "int")} rollout · ${fmt(shortcut, "int")} direct / backend`}
              delta={delta(wc.total, prev?.work_closed)} />
            <Tile icon="money" tone={revPct >= 90 ? "green" : "amber"} label="Revenue (SAR)" value={fmt(k.revenue, "int")} onClick={to.money}
              sub={k.target ? `${fmt(revPct, "pct")} of target ${fmt(k.target, "int")}` : "no target for this range"}
              delta={delta(k.revenue, prev?.revenue, true)} />
            <Tile icon="star" tone="blue" label="Scorecard" value={k.score != null ? fmt(k.score, "pct") : "—"} onClick={isPmView ? to.money : undefined}
              sub={k.rating || "IM Performance rating"} />
            <Tile icon="planned" tone="grey" label="Plans in range" value={fmt(k.plans, "int")} onClick={to.plans}
              sub={hasPlans ? `${fmt(pct(n(k.completed), n(k.plans)), "pct")} completed · ${fmt(k.in_execution, "int")} in execution` : "no rollout plans in range"} />
            <Tile icon="alert" tone={n(k.delayed) ? "red" : "grey"} label="Overdue / not attended" value={fmt(k.delayed, "int")} onClick={to.overdue}
              sub="plans dated in range" />
            <Tile icon="doc" tone="amber" label="Open PO lines" value={fmt(open.count, "int")} onClick={to.lines}
              sub={`SAR ${fmt(open.value, "int")} not done yet`} />
          </div>

          <div className="rdash-row rdash-row-3">
            <ChartCard chart={{
              kind: "bar", stacked: true, title: "Work closed by day", sub: "by route", x: "label", data: closedDays,
              series: [
                { key: "Rollout", label: "Rollout", color: "#1d5fd1" },
                { key: "Direct Close", label: "Direct Close", color: "#6d4bd1" },
                { key: "Backend", label: "Backend", color: "#e08a2c" },
              ],
            }} />
            <ChartCard chart={{
              kind: "donut", title: "How the work was closed", sub: "in range", x: "label", centerLabel: "lines",
              data: (wc.by_route || []).map((g) => ({ label: g.route, value: g.count, color: { Rollout: "#1d5fd1", "Direct Close": "#6d4bd1", Backend: "#e08a2c" }[g.route] })),
              series: [{ key: "value", label: "Lines" }],
              note: (wc.by_route || []).map((g) => `${g.route} SAR ${fmt(g.revenue, "int")}`).join(" · "),
            }} />
            <ChartCard chart={{
              kind: "hbar", title: "Open PO lines by status", sub: "all time · click a bar", x: "label",
              data: (open.by_status || []).slice(0, 8).map((s) => ({ label: s.status, count: s.count })),
              series: [{ key: "count", label: "Lines", color: "#e08a2c" }],
              onBarClick: (row) => row?.label && openLines([row.label])(),
            }} />
          </div>

          {/* Full width, its rows in a grid — as one tall column it left the
              cards beside it half empty. */}
          <Card title="Waiting on you" aside={<span className="rdash-muted">live · click to open</span>}>
            <div style={{ padding: "4px 14px 14px", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 8 }}>
              {!analytics && <div className="rdash-muted">Loading…</div>}
              {waiting.map((w) => <ActionRow key={w.key} {...w} />)}
              {analytics && waiting.length === 0 && <div className="rdash-muted" style={{ padding: "8px 2px" }}>Nothing waiting on you.</div>}
            </div>
          </Card>

          {(() => {
            // Projects always; Direct Close & Backend when the IM has any; Teams
            // when there is rollout work (or nothing else to show beside Projects).
            const cards = [
              <Card key="projects" title="Projects" aside={<More onClick={to.projects} label="Project Performance" />}>
                <TopTable rowKey="project_code" rows={projects} empty="No PO lines" cols={[
                  { key: "project_code", label: "Project" }, { key: "lines_done", label: "Lines done", render: (r) => r.lines_done },
                  { key: "completion_pct", label: "Done %", pct: true }, { key: "gap", label: "Gap (SAR)", num: true },
                ]} />
              </Card>,
            ];
            if (shortcut > 0) cards.push(
              <Card key="direct" title="Direct Close & Backend" aside={<More onClick={to.shortcuts} label="Work Done" />}>
                <div style={{ padding: "0 14px 10px", display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
                  {[["Lines", fmt(dc.count, "int")], ["Revenue (SAR)", fmt(dc.revenue, "int")], ["Avg / line", fmt(dc.avg_revenue, "int")]].map(([l, v]) => (
                    <div key={l} style={{ background: "#f8fafd", border: "1px solid #e3e9f2", borderRadius: 10, padding: "10px 12px" }}>
                      <div className="rdash-tile-label">{l}</div>
                      <div style={{ fontSize: "1.15rem", fontWeight: 800, color: "#0f1e36" }}>{v}</div>
                    </div>
                  ))}
                  <div className="rdash-muted" style={{ gridColumn: "1 / -1" }}>
                    {(dc.by_source || []).map((x) => `${x.source} ${fmt(x.count, "int")}`).join(" · ")}
                    {" · "}MS1 only {fmt(dc.milestones?.ms1_only, "int")} · MS2 only {fmt(dc.milestones?.ms2_only, "int")} · full line {fmt(dc.milestones?.full_line, "int")}
                  </div>
                </div>
                <TopTable rowKey="subcontractor" rows={dc.by_subcontractor || []} cols={[
                  { key: "subcontractor", label: "Subcontractor" }, { key: "count", label: "Lines", num: true },
                  { key: "revenue", label: "Revenue", num: true },
                ]} />
              </Card>,
            );
            if (hasPlans || shortcut === 0) cards.push(
              <Card key="teams" title="Teams" aside={<More onClick={to.teams} label="Monthly Team Details" />}>
                <TopTable rowKey="team" rows={teams} empty="No team worked these plans in this range" cols={[
                  { key: "label", label: "Team" }, { key: "plans", label: "Plans", num: true },
                  { key: "completed", label: "Done", num: true }, { key: "pct", label: "Util. %", pct: true },
                ]} />
              </Card>,
            );
            return <div className={`rdash-row rdash-row-${cards.length === 1 ? 2 : cards.length}`}>{cards}</div>;
          })()}

          {hasPlans && (
            <div className="rdash-row rdash-row-2">
              <ChartCard chart={{
                kind: "bar", title: "Rollout plans by day", sub: "planned vs completed", x: "label", data: planDays,
                series: [{ key: "planned", label: "Planned", color: "#b9cdf3" }, { key: "completed", label: "Completed", color: "#163a7a" }],
              }} />
              <ChartCard chart={{
                kind: "donut", title: "Rollout plans by status", sub: "in range", x: "label", centerLabel: "plans",
                data: statuses, series: [{ key: "value", label: "Plans" }],
              }} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
