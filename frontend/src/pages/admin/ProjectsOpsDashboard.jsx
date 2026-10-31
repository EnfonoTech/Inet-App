import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import DashboardSwitcher from "../../components/DashboardSwitcher";
import SearchableSelect from "../../components/SearchableSelect";
import { Card, ChartCard, Tile, TopTable, fmt } from "../../components/ReportDashboard";
import { pmApi } from "../../services/api";
import { MONTH_OPTIONS, isoMonth, monthBounds, shortMonth } from "../../utils/months";

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
 *   · the chosen MONTH — field work, team cost vs revenue, IM revenue
 *     (Command payload for that month);
 *   · ALL TIME — projects, PO value, the PO line pipeline;
 *   · TODAY / LIVE — teams idle today, and what needs attention now
 *     (Execution Analytics buckets, the same predicates the Execution
 *     Monitor filters on, so each count opens exactly its own rows).
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
  { key: "dummy_unmapped", label: "Dummy PO not mapped", tone: "grey" },
];
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
      <span style={{ fontSize: "1.3rem", fontWeight: 800, color: t.fg, minWidth: 44 }}>{fmt(count, "int")}</span>
      <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <b style={{ fontSize: "0.8rem", color: "#0f1e36" }}>{label}</b>
        <span className="rdash-muted">{sub}</span>
      </span>
    </button>
  );
}

export default function ProjectsOpsDashboard() {
  const navigate = useNavigate();
  const [month, setMonth] = useState(isoMonth(new Date()));
  const [cmd, setCmd] = useState(null);
  const [projects, setProjects] = useState(null);
  const [pipeline, setPipeline] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const { from, to } = monthBounds(month);
    setLoading(true);
    setError(null);
    pmApi.getCommandDashboard({ from_date: from, to_date: to })
      .then((d) => { if (!cancelled) setCmd(d); })
      .catch((e) => { if (!cancelled) { setCmd(null); setError(e?.message || "Could not load the dashboard."); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [month, reload]);

  // All-time and live sources: independent of the month, so they load once
  // per refresh and never wait on the Command payload.
  useEffect(() => {
    let cancelled = false;
    pmApi.reportProjectProfitability({}).then((r) => { if (!cancelled) setProjects(r?.data || []); }).catch(() => {});
    pmApi.reportPoDispatchStatus().then((r) => { if (!cancelled) setPipeline(r?.data || []); }).catch(() => {});
    pmApi.getExecutionAnalytics({ portal_filters: {}, dimensions: [] }).then((r) => { if (!cancelled) setAnalytics(r || null); }).catch(() => {});
    return () => { cancelled = true; };
  }, [reload]);

  const mon = shortMonth(month);
  const op = cmd?.operational || {};
  const ts = cmd?.team_status || {};

  const proj = useMemo(() => {
    const rows = (projects || []).filter((p) => n(p.po_value) > 0);
    const po = rows.reduce((a, p) => a + n(p.po_value), 0);
    const achieved = rows.reduce((a, p) => a + n(p.achieved), 0);
    const open = rows.filter((p) => n(p.remaining_value) > 0);
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
      const g = m.get(r.stage) || { label: r.stage, lines: 0, value: 0 };
      g.lines += n(r.lines_count);
      g.value += n(r.value);
      m.set(r.stage, g);
    }
    return [...m.values()];
  }, [pipeline]);

  const buckets = useMemo(() => Object.fromEntries((analytics?.buckets || []).map((b) => [b.key, b])), [analytics]);
  const drill = (b) => navigate("/execution", {
    state: { execFilters: { bucket: b.key, bucketLabel: b.label, planStatusFilter: [], closure: "all" } },
  });

  const teams = useMemo(() => (cmd?.top_teams || []).map((t) => ({ ...t, label: t.team_name || t.team })), [cmd]);
  const ims = useMemo(() => (cmd?.im_performance || []).filter((r) => n(r.revenue))
    .map((r) => ({ label: r.im_full_name || r.im, revenue: n(r.revenue) })), [cmd]);

  return (
    <div className="nd-dashboard">
      <DashboardSwitcher />
      <div className="page-header" style={{ padding: 0, marginBottom: 12 }}>
        <div>
          <h1 className="page-title">Projects &amp; Operations</h1>
          <div className="page-subtitle">How far each project has been delivered, and what the field is doing about the rest</div>
        </div>
        <div className="page-actions" style={{ gap: 8 }}>
          <SearchableSelect value={month} onChange={(v) => setMonth(v || isoMonth(new Date()))} options={MONTH_OPTIONS} placeholder="Month" minWidth={180} />
          <button type="button" className="btn-secondary" disabled={loading} onClick={() => setReload((k) => k + 1)}>{loading ? "Loading…" : "Refresh"}</button>
        </div>
      </div>

      {error && <div className="notice error"><span>⚠</span> {error}</div>}

      <div className="rdash">
        <div className="rdash-tiles">
          <Tile icon="folder" tone="blue" label="Projects with open work" value={projects ? fmt(proj.open.length, "int") : "…"} sub={projects ? `of ${fmt(proj.rows.length, "int")} projects` : "loading…"} />
          <Tile icon="doc" tone="blue" label="PO value (SAR) · all time" value={projects ? fmt(proj.po, "int") : "…"} sub={projects ? `${fmt(proj.lines, "int")} lines` : ""} />
          <Tile icon="done" tone="green" label="Delivered · all time" value={projects ? fmt(pct(proj.achieved, proj.po), "pct") : "…"} sub={projects ? `${sar(proj.achieved)} of PO value` : ""} />
          <Tile icon="clock" tone="amber" label="Open PO lines" value={cmd ? fmt(op.total_open_po_lines, "int") : "…"} sub={cmd ? `${sar(op.total_open_po_line_value)} not yet done` : ""} />
          <Tile icon="up" tone="green" label={`Work done · ${mon}`} value={cmd ? fmt(op.workdone_activities, "int") : "…"} sub={cmd ? `${sar(op.workdone_amount)} · ${fmt(op.revisits, "int")} re-visits` : ""} />
          <Tile icon="teams" tone={n(ts.idle) ? "amber" : "green"} label="Teams idle today" value={cmd ? fmt(ts.idle, "int") : "…"} sub={cmd ? `of ${fmt(ts.active, "int")} active teams` : ""} />
        </div>

        <div className="rdash-row rdash-row-3">
          <ChartCard chart={{
            kind: "bar", title: "Where every PO line is", sub: "all time", x: "label",
            data: stages, series: [{ key: "lines", label: "Lines", color: "#1d5fd1" }],
          }} />
          <ChartCard chart={{
            kind: "hbar", title: `Field work · ${mon}`, sub: "activities", x: "label",
            data: cmd ? [
              { label: "Planned", value: n(op.planned_activities) },
              { label: "In progress", value: n(op.in_progress_activities) },
              { label: "Work done", value: n(op.workdone_activities) },
              { label: "Closed", value: n(op.closed_activities) },
            ] : [],
            series: [{ key: "value", label: "Activities", color: "#163a7a" }],
          }} />
          <ChartCard chart={{
            kind: "donut", title: "Active teams", sub: "by type", x: "label", centerLabel: "teams",
            data: cmd ? [
              { label: "INET", value: n(cmd.inet?.active_inet_teams), color: "#1d5fd1" },
              { label: "Subcon", value: n(cmd.subcon?.active_sub_teams), color: "#e08a2c" },
              { label: "Backend", value: n(cmd.backend?.active_teams), color: "#6d4bd1" },
            ] : [],
            series: [{ key: "value", label: "Teams" }],
          }} />
        </div>

        <div className="rdash-row" style={{ gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr)" }}>
          <Card title="Project delivery" aside={<span className="rdash-muted">top 10 by PO value · all time</span>}>
            <TopTable rowKey="project_code" rows={proj.top} empty={projects ? "No projects" : "Loading…"} cols={[
              { key: "project_code", label: "Project" }, { key: "project_domain", label: "Domain" },
              { key: "lines_done", label: "Lines done", render: (r) => r.lines_done },
              { key: "po_value", label: "PO value", num: true }, { key: "achieved", label: "Delivered", num: true },
              { key: "delivery_pct", label: "Delivery", pct: true },
            ]} />
          </Card>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
            <ChartCard chart={{
              kind: "bar", title: "Projects by delivery", sub: "replaces On track / At risk", x: "label",
              data: proj.bands, series: [{ key: "count", label: "Projects", color: "#1d5fd1" }],
            }} />
            <ChartCard chart={{
              kind: "hbar", title: "Open value by domain", format: "money", x: "label",
              data: proj.byDomain, series: [{ key: "value", label: "SAR" }],
            }} />
          </div>
        </div>

        <div className="rdash-row rdash-row-3">
          <Card title={`Team cost vs revenue · ${mon}`}>
            <TopTable rowKey="label" rows={teams} empty="No team activity" cols={[
              { key: "label", label: "Team" }, { key: "revenue", label: "Revenue", num: true },
              { key: "team_cost", label: "Cost", num: true },
              { key: "profit", label: "Profit", render: (r) => <span style={{ color: n(r.profit) < 0 ? "#b42318" : "#15803d", fontWeight: 700 }}>{fmt(r.profit, "int")}</span> },
            ]} />
          </Card>
          <ChartCard chart={{
            kind: "hbar", title: `Revenue by IM · ${mon}`, format: "money", x: "label",
            data: [...ims].sort((a, b) => b.revenue - a.revenue), series: [{ key: "revenue", label: "Revenue" }],
          }} />
          <Card title="Needs attention" aside={<span className="rdash-muted">live · opens the list</span>}>
            <div style={{ padding: "4px 14px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
              {!analytics && <div className="rdash-muted">Loading…</div>}
              {analytics && (
                <Attention count={analytics.totals?.issues_open} label="Open issues" tone={n(analytics.totals?.issues_open) ? "red" : "grey"}
                  sub={`${sar(analytics.totals?.issues_value)} on hold · Issues & Risks`} onClick={() => navigate("/issues-risks")} />
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
        </div>
        {cmd?.last_updated && <div className="rdash-muted">Last updated {String(cmd.last_updated).replace("T", " ").slice(0, 16)}</div>}
      </div>
    </div>
  );
}
