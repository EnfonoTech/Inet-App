import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import DashboardSwitcher from "../../components/DashboardSwitcher";
import DateRangePicker, { DATE_PRESETS } from "../../components/DateRangePicker";
import { Card, ChartCard, Tile, TopTable, fmt } from "../../components/ReportDashboard";
import { pmApi } from "../../services/api";
import DashHeader from "../../components/DashHeader";

/**
 * Projects & Operations — PM View and Operations merged into one page.
 *
 * Project health is read off delivery: how much of each project's PO value
 * is done (Project Profitability). PM View read Project Control Center's
 * project_status instead, which is "Active" on every project, so it always
 * showed 100% on track and 0 at risk / delayed, and its Rating column read
 * a field the server never sends.
 *
 * Periods, each labelled:
 *   · the chosen DATE RANGE (the standard picker) — work done, field work,
 *     team cost vs revenue (Command payload), revenue by IM (Command's own
 *     Revenue split by IM, the Executive page's table);
 *   · NOW / ALL TIME — projects, PO value, the PO line pipeline, lines still
 *     to do;
 *   · TODAY / LIVE — teams idle today, and what needs attention now
 *     (Execution Analytics buckets, the same predicates the Execution
 *     Monitor filters on, so each count opens exactly its own rows).
 *
 * Audit, 2 Nov 2026:
 *   · "Work done" hid every Work Done already closed in PIC (430 of 476 in
 *     October, SAR 417,798 of 474,333); it now counts them all, as the Work
 *     Done page does with finished rows shown.
 *   · "Open PO lines … not yet done" was the order book — lines not CLOSED —
 *     so it counted 2,651 lines already done or being invoiced. Replaced by
 *     the lines still to do (Pending / Dispatched / Planned / Backend
 *     Assigned), the same lines as the pipeline chart's first two stages and
 *     the projects' remaining value.
 *   · "Active teams by type" put 12 active SUBCONTRACTS beside INET teams;
 *     the subcontractor slice now counts teams.
 *   · "Projects with open work" counted a fully delivered project as open
 *     when a line was confirmed short; it now means lines not done.
 *   · Revenue by IM is Command's Revenue split by IM, so it adds up to the
 *     Revenue the Command and Executive pages show.
 */

const n = (v) => Number(v) || 0;
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const sar = (v) => `SAR ${fmt(v, "int")}`;
const BANDS = [
  { label: "under 50%", test: (p) => p < 50, color: "#b42318" },
  { label: "50–75%", test: (p) => p >= 50 && p < 75, color: "#e0a320" },
  { label: "75–95%", test: (p) => p >= 75 && p < 95, color: "#3f9b5c" },
  { label: "95%+", test: (p) => p >= 95, color: "#15803d" },
];

// Live attention items: Execution Analytics bucket key → label. The issues
// total is not a bucket (issue plans leave the analytics base) and opens
// Issues & Risks instead.
const ATTENTION = [
  { key: "overdue_by_date", label: "Overdue plans", tone: "red" },
  { key: "im_confirmation_pending", label: "Waiting on IM confirmation", tone: "amber" },
  { key: "qc_pending", label: "QC pending", tone: "amber" },
  { key: "ciag_pending", label: "CIAG pending", tone: "amber" },
  { key: "work_done_missing", label: "Work Done not created", tone: "amber" },
];
// Dummy POs are not an analytics bucket here: that bucket only sees dummies
// that already have a plan (201 of 260). The count is Rollout Planning's own
// Dummy POs › Open list, which is where they are mapped.
const TONE = {
  red: { bd: "#f3c7c3", bg: "#fff8f7", fg: "#b42318" },
  amber: { bd: "#f6d4bf", bg: "#fffaf5", fg: "#b54708" },
  grey: { bd: "#e3e9f2", bg: "#f8fafd", fg: "#475569" },
};

function Attention({ count, label, sub, tone, onClick }) {
  const t = TONE[tone] || TONE.grey;
  return (
    <button type="button" onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left", cursor: "pointer",
      padding: "9px 12px", border: `1px solid ${t.bd}`, background: t.bg, borderRadius: 9, font: "inherit",
    }}>
      <span style={{ fontSize: "1.3rem", fontWeight: 800, color: t.fg, minWidth: 64, flexShrink: 0, whiteSpace: "nowrap" }}>{fmt(count, "int")}</span>
      <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <b style={{ fontSize: "0.8rem", color: "#0f1e36" }}>{label}</b>
        <span className="rdash-muted">{sub}</span>
      </span>
    </button>
  );
}

const TODO_STATUSES = ["Pending", "Dispatched", "Planned", "Backend Assigned"];
const TODO_STAGES = new Set(["Not Started", "In Rollout"]);
const pad = (v) => String(v).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function defaultRange() {
  const r = DATE_PRESETS.this_month.range(new Date());
  return { from: iso(r.from), to: iso(r.to) };
}
// "Oct", "5–20 Oct", "28 Sep – 4 Oct".
function rangeLabel(from, to) {
  if (!from || !to) return "";
  const f = new Date(`${from}T00:00:00`), t = new Date(`${to}T00:00:00`);
  const m = (d) => d.toLocaleString("en", { month: "short" });
  const monthEnd = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1).getDate() === 1;
  const same = f.getMonth() === t.getMonth() && f.getFullYear() === t.getFullYear();
  if (f.getDate() === 1 && monthEnd) return same ? m(f) : `${m(f)} – ${m(t)}`;
  return same ? `${f.getDate()}–${t.getDate()} ${m(f)}` : `${f.getDate()} ${m(f)} – ${t.getDate()} ${m(t)}`;
}

export default function ProjectsOpsDashboard() {
  const navigate = useNavigate();
  const [range, setRange] = useState(defaultRange);
  const [extras, setExtras] = useState(null);
  const [cmd, setCmd] = useState(null);
  const [projects, setProjects] = useState(null);
  const [pipeline, setPipeline] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const { from, to } = range;
    setLoading(true);
    setError(null);
    setExtras(null);
    pmApi.getCommandDashboard({ from_date: from, to_date: to })
      .then((d) => { if (!cancelled) setCmd(d); })
      .catch((e) => { if (!cancelled) { setCmd(null); setError(e?.message || "Could not load the dashboard."); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    pmApi.getExecutiveExtras({ from_date: from, to_date: to })
      .then((d) => { if (!cancelled) setExtras(d || {}); }).catch(() => { if (!cancelled) setExtras({}); });
    return () => { cancelled = true; };
  }, [range.from, range.to, reload]);

  // All-time and live sources: independent of the month, so they load once
  // per refresh and never wait on the Command payload.
  useEffect(() => {
    let cancelled = false;
    pmApi.reportProjectProfitability({}).then((r) => { if (!cancelled) setProjects(r?.data || []); }).catch(() => {});
    pmApi.reportPoDispatchStatus().then((r) => { if (!cancelled) setPipeline(r?.data || []); }).catch(() => {});
    pmApi.getExecutionAnalytics({ portal_filters: {}, dimensions: [] }).then((r) => { if (!cancelled) setAnalytics(r || null); }).catch(() => {});
    return () => { cancelled = true; };
  }, [reload]);

  const mon = rangeLabel(range.from, range.to);
  const op = cmd?.operational || {};
  const ts = cmd?.team_status || {};

  const proj = useMemo(() => {
    const rows = (projects || []).filter((p) => n(p.po_value) > 0);
    const po = rows.reduce((a, p) => a + n(p.po_value), 0);
    const achieved = rows.reduce((a, p) => a + n(p.achieved), 0);
    // Open = lines not done yet. Remaining value also carries the shortfall
    // on lines confirmed short, so a fully delivered project read as open.
    const open = rows.filter((p) => n(p.assigned_lines) > n(p.completed_lines));
    const domains = new Map();
    for (const p of open) {
      const d = p.project_domain || "No domain";
      domains.set(d, (domains.get(d) || 0) + n(p.remaining_value));
    }
    return {
      rows, po, achieved, open,
      lines: rows.reduce((a, p) => a + n(p.assigned_lines), 0),
      bands: BANDS.map((b) => ({ label: b.label, count: rows.filter((p) => b.test(n(p.delivery_pct))).length, color: b.color })),
      byDomain: [...domains.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 8),
      top: [...rows].sort((a, b) => n(b.po_value) - n(a.po_value)).slice(0, 10).map((p) => ({
        ...p, lines_done: `${fmt(p.completed_lines, "int")} / ${fmt(p.assigned_lines, "int")}`,
      })),
    };
  }, [projects]);

  const stages = useMemo(() => {
    const m = new Map();
    for (const r of pipeline || []) {
      const g = m.get(r.stage) || { label: r.stage, lines: 0, value: 0, statuses: [] };
      g.statuses.push(r.status);
      g.lines += n(r.lines_count);
      g.value += n(r.value);
      m.set(r.stage, g);
    }
    return [...m.values()];
  }, [pipeline]);
  // Lines still to do — the pipeline's first two stages, which are exactly
  // the lines Pending / Dispatched / Planned / Backend Assigned.
  const todo = useMemo(() => stages.filter((g) => TODO_STAGES.has(g.label))
    .reduce((a, g) => ({ lines: a.lines + g.lines, value: a.value + g.value }), { lines: 0, value: 0 }), [stages]);
  const wd = extras?.work_done || {};
  const toForecast = extras?.to_forecast || {};
  const [band, setBand] = useState(null);
  const bandRows = useMemo(() => {
    if (!band) return proj.top;
    const b = BANDS.find((x) => x.label === band);
    return proj.rows.filter((p) => b.test(n(p.delivery_pct))).sort((a, c) => n(c.po_value) - n(a.po_value))
      .map((p) => ({ ...p, lines_done: `${fmt(p.completed_lines, "int")} / ${fmt(p.assigned_lines, "int")}` }));
  }, [band, proj]);

  const buckets = useMemo(() => Object.fromEntries((analytics?.buckets || []).map((b) => [b.key, b])), [analytics]);
  const drill = (b) => navigate("/execution", {
    state: { execFilters: { bucket: b.key, bucketLabel: b.label, planStatusFilter: [], closure: "all" } },
  });

  const teams = useMemo(() => (cmd?.top_teams || []).map((t) => ({ ...t, label: t.team_name || t.team })), [cmd]);
  // Command's Revenue split by IM (get_executive_extras) — the rows add up to
  // the Revenue the Command and Executive pages show.
  const ims = useMemo(() => (extras?.revenue_by_im || []).filter((r) => n(r.revenue))
    .map((r) => ({ label: r.im_full_name || r.im, revenue: n(r.revenue) })), [extras]);
  // Subcontractor FIELD teams: the Active non-backend teams (team_status.active)
  // less the INET ones. backend.active_teams is every Active backend team.
  const subTeams = Math.max(0, n(ts.active) - n(cmd?.inet?.active_inet_teams));
  const go = (path, state) => () => navigate(path, state ? { state } : undefined);

  return (
    <div className="nd-dashboard">
      <DashboardSwitcher />
      <DashHeader title="Projects & Operations" hint="How far each project has been delivered, and what the field is doing about the rest" lastUpdated={cmd?.last_updated}>
        <DateRangePicker value={range} onChange={(r) => setRange({ from: r.from, to: r.to })} />
        <button type="button" className="btn-secondary" disabled={loading} onClick={() => setReload((k) => k + 1)}>{loading ? "Loading…" : "Refresh"}</button>
      </DashHeader>

      {error && <div className="notice error"><span>⚠</span> {error}</div>}

      <div className="rdash">
        <div className="rdash-tiles">
          <Tile icon="folder" tone="blue" label="Projects with open work" value={projects ? fmt(proj.open.length, "int") : "…"}
            sub={projects ? `of ${fmt(proj.rows.length, "int")} projects · lines not done` : "loading…"} onClick={go("/reports?tab=project_profitability")} />
          <Tile icon="doc" tone="blue" label="PO value (SAR) · all time" value={projects ? fmt(proj.po, "int") : "…"} sub={projects ? `${fmt(proj.lines, "int")} lines` : ""}
            onClick={go("/reports?tab=project_profitability")} />
          <Tile icon="done" tone="green" label="Delivered · all time" value={projects ? fmt(pct(proj.achieved, proj.po), "pct") : "…"} sub={projects ? `${sar(proj.achieved)} of PO value` : ""}
            onClick={go("/reports?tab=project_profitability")} />
          <Tile icon="clock" tone="amber" label="Lines still to do · now" value={pipeline ? fmt(todo.lines, "int") : "…"}
            sub={pipeline ? `${sar(todo.value)} · not started or in rollout` : ""}
            onClick={go("/planning", { planFilters: { planScope: "all", portal: { dispatch_status: TODO_STATUSES }, label: "lines still to do (Pending, Dispatched, Planned, Backend Assigned)" } })} />
          <Tile icon="up" tone="green" label={`Work done · ${mon}`} value={extras ? fmt(wd.n, "int") : "…"}
            sub={extras ? `${sar(wd.value)} · every route, closed included${cmd ? ` · ${fmt(op.revisits, "int")} re-visits planned` : ""}` : ""}
            onClick={go("/work-done", { workDoneFilters: { tab: "list", includeFinished: true, fromDate: range.from, toDate: range.to } })} />
          <Tile icon="teams" tone={n(ts.idle) ? "amber" : "green"} label="Teams idle today" value={cmd ? fmt(ts.idle, "int") : "…"} sub={cmd ? `of ${fmt(ts.active, "int")} active teams` : ""}
            // Active field teams only, as the count is: without these two the
            // Teams page's "Idle" also listed backend and inactive teams (26 vs 20).
            onClick={go("/teams", { teamFilters: { statusFilter: ["Active"], categoryFilter: ["Field Team"], statFilter: { field: "today_status", value: "Idle" } } })} />
        </div>

        <div className="rdash-row rdash-row-3">
          <ChartCard chart={{
            kind: "bar", title: "Where every PO line is", sub: "now · click a bar", x: "label",
            data: stages, series: [{ key: "lines", label: "Lines", color: "#1d5fd1" }],
            onBarClick: (g) => g?.statuses?.length && navigate("/planning", { state: { planFilters: {
              planScope: "all", portal: { dispatch_status: g.statuses },
              label: `${g.label} lines (${g.statuses.join(", ")})` } } }),
          }} />
          <ChartCard chart={{
            kind: "hbar", title: `Field work · ${mon}`, sub: "activities", x: "label",
            data: cmd ? [
              { label: "Planned", value: n(op.planned_activities) },
              { label: "In progress", value: n(op.in_progress_activities) },
              // Every Work Done in the range split in two, so the bars add up:
              // closed = its delivered quantity is invoiced and closed in PIC
              // (Command's Closed figure), the rest is not closed yet. A line
              // delivered short counts as closed for what was delivered; any
              // remaining quantity is future work, or cancelled.
              { label: "Done, not closed", value: Math.max(0, n(wd.n) - n(op.closed_activities)) },
              { label: "Done, closed in PIC", value: n(op.closed_activities) },
            ] : [],
            series: [{ key: "value", label: "Activities", color: "#163a7a" }],
          }} />
          <ChartCard chart={{
            kind: "donut", title: "Active teams", sub: "by type", x: "label", centerLabel: "teams",
            data: cmd ? [
              { label: "INET field", value: n(cmd.inet?.active_inet_teams), color: "#1d5fd1" },
              { label: "Subcon field", value: subTeams, color: "#e08a2c" },
              { label: "Backend", value: n(cmd.backend?.active_teams), color: "#6d4bd1" },
            ] : [],
            note: cmd ? `${fmt(cmd.subcon?.active_sub_teams, "int")} active subcontracts` : "",
            series: [{ key: "value", label: "Teams" }],
          }} />
        </div>

        <div className="rdash-row" style={{ gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr)" }}>
          <Card title={band ? `Projects delivered ${band}` : "Project delivery"} aside={band
            ? <button type="button" className="rdash-link" onClick={() => setBand(null)}>Show top 10 ×</button>
            : <button type="button" className="rdash-link" onClick={go("/reports?tab=project_profitability")}>Project Profitability →</button>}>
            <TopTable rowKey="project_code" rows={bandRows} empty={projects ? "No projects" : "Loading…"} cols={[
              { key: "project_code", label: "Project" }, { key: "project_domain", label: "Domain" },
              { key: "lines_done", label: "Lines done", render: (r) => r.lines_done },
              { key: "po_value", label: "PO value", num: true }, { key: "achieved", label: "Delivered", num: true },
              { key: "delivery_pct", label: "Delivery", pct: true },
            ]} />
          </Card>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
            <ChartCard chart={{
              kind: "bar", title: "Projects by delivery", sub: "click a bar to list them", x: "label",
              data: proj.bands, series: [{ key: "count", label: "Projects", color: "#1d5fd1" }],
              onBarClick: (b) => b?.label && setBand(b.label),
            }} />
            <ChartCard chart={{
              kind: "hbar", title: "Open value by domain", format: "money", x: "label",
              data: proj.byDomain, series: [{ key: "value", label: "SAR" }],
            }} />
          </div>
        </div>

        {/* Full width, its items in a grid: as one tall column it left the
            two cards beside it half empty. */}
        <Card title="Needs attention" aside={<span className="rdash-muted">live · opens the list</span>}>
          <div style={{ padding: "4px 14px 14px", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 8 }}>
            {!analytics && <div className="rdash-muted">Loading…</div>}
            {analytics && (
              <Attention count={analytics.totals?.issues_open} label="Open issues" tone={n(analytics.totals?.issues_open) ? "red" : "grey"}
                sub={`${sar(analytics.totals?.issues_value)} on hold · Issues & Risks`} onClick={() => navigate("/issues-risks")} />
            )}
            {cmd && (
              <Attention count={op.open_dummy_pos} label="Dummy POs to map" tone={n(op.open_dummy_pos) ? "amber" : "grey"}
                sub="planned or not · Rollout Planning › Dummy POs › Open"
                onClick={go("/planning", { planFilters: { planScope: "open_dummy", dummyFilter: "open" } })} />
            )}
            {extras?.to_forecast && (
              <Attention count={toForecast.n} label="Lines to forecast" tone={n(toForecast.n) ? "amber" : "grey"}
                sub={`${sar(toForecast.value)} · no target month yet · Rollout Planning`}
                onClick={go("/planning", { planFilters: { planScope: "all", portal: { has_target_month: "no", dispatch_status: ["Pending", "Dispatched"] }, label: "lines with no target month yet (Pending, Dispatched)" } })} />
            )}
            {analytics && ATTENTION.map((a) => {
              const b = buckets[a.key];
              if (!b) return null;
              return (
                <Attention key={a.key} count={b.value} label={a.label} tone={n(b.value) ? a.tone : "grey"}
                  sub={`${sar(b.amount)} · Execution Monitor`} onClick={() => drill(b)} />
              );
            })}
          </div>
        </Card>

        <div className="rdash-row rdash-row-2">
          <Card title={`Team cost vs revenue · ${mon}`} aside={<button type="button" className="rdash-link" onClick={go(`/reports?tab=top_teams&from=${range.from}&to=${range.to}`)}>Top 5 by revenue →</button>}>
            <TopTable rowKey="label" rows={teams} empty="No team activity" cols={[
              { key: "label", label: "Team" }, { key: "revenue", label: "Revenue", num: true },
              { key: "team_cost", label: "Cost", num: true },
              { key: "profit", label: "Profit", render: (r) => <span style={{ color: n(r.profit) < 0 ? "#b42318" : "#15803d", fontWeight: 700 }}>{fmt(r.profit, "int")}</span> },
            ]} />
          </Card>
          <ChartCard chart={{
            kind: "hbar", title: `Revenue by IM · ${mon}`, sub: "adds up to Revenue", format: "money", x: "label",
            data: [...ims].sort((a, b) => b.revenue - a.revenue), series: [{ key: "revenue", label: "Revenue" }],
          }} />
        </div>
      </div>
    </div>
  );
}
