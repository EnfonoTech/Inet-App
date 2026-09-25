import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { pmApi } from "../services/api";
import { isoLocal as iso, weekStartOfLocal as weekStartOf, parseLocal } from "../utils/weeks";

/**
 * Rollout Planning — weekly dashboard.
 *
 * Five readings of one week's Rollout Plans (grid, status tiles, activity
 * split, team workload, day calendar) all come from a single backend call, so
 * they cannot disagree with each other. The commercial rail is a second call
 * over the current quarter — a different period on purpose, and the heading
 * says so, because the money picture is quarterly even when the plan is weekly.
 */

const money = (v) => new Intl.NumberFormat("en", { maximumFractionDigits: 0 }).format(Number(v) || 0);
const pct = (n, d) => (d ? Math.round((Number(n) || 0) * 100 / d) : 0);

const C = {
  purple: "#6D5AE6", teal: "#12A79A", green: "#1DAA5C", amber: "#E8992A",
  blue: "#2F7BE0", red: "#E4534A", gray: "#9AA1B4",
  blueText: "#1D5AAE", amberText: "#A5680E", greenText: "#177A44",
  redText: "#B23A32", purpleText: "#4B3FB0", tealText: "#0C7B71",
  border: "#E4E6EF", muted: "#6B7280",
};

const BUCKETS = [
  { key: "planned", label: "Planned", color: C.blue, text: C.blueText },
  { key: "in_progress", label: "In progress", color: C.amber, text: C.amberText },
  { key: "completed", label: "Completed", color: C.green, text: C.greenText },
  { key: "delayed", label: "Delayed", color: C.red, text: C.redText },
];

const DONUT_COLORS = [C.amber, C.blue, C.teal, C.purple, C.gray];


function Card({ title, right, children, style }) {
  return (
    <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: 10, ...style }}>
      {(title || right) && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 11 }}>
          <h4 style={{ margin: 0, fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: ".04em", textTransform: "uppercase" }}>
            {title}
          </h4>
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

/** conic-gradient donut driven by [{label,count,color}] — no chart library. */
function Donut({ slices, total, size = 76 }) {
  let at = 0;
  const stops = slices.map((s) => {
    const from = at;
    at += total ? (s.value * 100) / total : 0;
    return `${s.color} ${from}% ${at}%`;
  });
  if (!total) stops.push("#EDEEF4 0% 100%");
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", flexShrink: 0, position: "relative", background: `conic-gradient(${stops.join(",")})` }}>
      <div style={{ position: "absolute", inset: size * 0.2, background: "#fff", borderRadius: "50%" }} />
    </div>
  );
}

function Gauge({ value, caption, sub, color }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: "9px 11px", flex: "1 1 190px", minWidth: 178 }}>
      <div style={{ width: 58, height: 58, borderRadius: "50%", flexShrink: 0, position: "relative", background: `conic-gradient(${color} 0% ${v}%, #EDEEF4 ${v}% 100%)` }}>
        <div style={{ position: "absolute", inset: 9, background: "#fff", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800 }}>
          {v}%
        </div>
      </div>
      <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.45 }}>
        <b style={{ color: "#1A1F36", fontSize: 12.5 }}>{caption}</b><br />{sub}
      </div>
    </div>
  );
}

// The seven day columns stay equal — the plan bars span them by multiplying
// one cell's width, so unequal days would misdraw a multi-day plan. Everything
// either side of them is the user's to resize.
const DETAIL_COLS = [
  { key: "poid", label: "POID", w: 132 },
  { key: "mode", label: "Mode", w: 70 },
  { key: "project", label: "Project", w: 78 },
  { key: "domain", label: "Domain", w: 84 },
  { key: "activity", label: "Activity type", w: 104 },
];
const TAIL_COLS = [
  { key: "status", label: "Status", w: 92 },
  { key: "prog", label: "Prog.", w: 48 },
];
const WIDTH_STORE = "inet.rolloutWeek.colWidths";
const MIN_COL_PX = 44;

export default function RolloutWeeklyPlan({ imName, portal, refreshKey, reportHref }) {
  const navigate = useNavigate();

  // Per-viewer, remembered between visits. localStorage rather than the table
  // prefs doctype: this is a layout preference for one grid, not a saved view.
  const [colWidths, setColWidths] = useState(() => {
    const base = {};
    [...DETAIL_COLS, ...TAIL_COLS].forEach((c) => { base[c.key] = c.w; });
    try {
      const saved = JSON.parse(localStorage.getItem(WIDTH_STORE) || "{}");
      Object.entries(saved).forEach(([k, v]) => {
        if (base[k] != null && Number(v) >= MIN_COL_PX) base[k] = Number(v);
      });
    } catch { /* private mode / cleared storage — defaults are fine */ }
    return base;
  });

  const startResize = (key) => (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const startX = ev.clientX;
    const startW = colWidths[key];
    const onMove = (e) => {
      const next = Math.max(MIN_COL_PX, Math.round(startW + (e.clientX - startX)));
      setColWidths((w) => (w[key] === next ? w : { ...w, [key]: next }));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("mouseup", onUp, true);
      setColWidths((w) => {
        try { localStorage.setItem(WIDTH_STORE, JSON.stringify(w)); } catch { /* ignore */ }
        return w;
      });
    };
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("mouseup", onUp, true);
  };

  const resetWidths = () => {
    const base = {};
    [...DETAIL_COLS, ...TAIL_COLS].forEach((c) => { base[c.key] = c.w; });
    setColWidths(base);
    try { localStorage.removeItem(WIDTH_STORE); } catch { /* ignore */ }
  };
  const [weekStart, setWeekStart] = useState(() => iso(weekStartOf(new Date())));
  // The quarter containing the week ON SCREEN, and a FISCAL quarter, not a
  // calendar one: this bench's fiscal year runs Apr–Mar, so Jul–Sep is Q2, not
  // Q3. The backend reads the start month off the Fiscal Year record, so the
  // label can't drift from what Accounts means by "Q2".
  const [quarter, setQuarter] = useState(null);
  useEffect(() => {
    let cancelled = false;
    pmApi.getRolloutFiscalQuarter(weekStart)
      .then((q) => { if (!cancelled) setQuarter(q); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [weekStart]);
  const [data, setData] = useState(null);
  const [commercial, setCommercial] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Scopes ONLY the commercial rail — the plan grid keeps the page filters.
  const [commProject, setCommProject] = useState("");
  // Built from the unfiltered project list so choosing one doesn't shrink the
  // dropdown to just that one.
  const [projectChoices, setProjectChoices] = useState([]);
  const portalKey = JSON.stringify(portal || {});

  useEffect(() => {
    if (!quarter) return undefined;
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      pmApi.getRolloutWeekDashboard({ im: imName || "", week_start: weekStart, portal_filters: portal || {} }),
      pmApi.getRolloutCommercialSummary({
        im: imName || "", from_date: quarter.from, to_date: quarter.to,
        project_code: commProject ? [commProject] : portal?.project_code,
        filter_im: portal?.im,
      }).catch(() => null),
    ]).then(([week, comm]) => {
      if (cancelled) return;
      setData(week);
      setCommercial(comm);
      if (!commProject && comm?.projects) {
        setProjectChoices(comm.projects.map((p) => p.project_code).filter((c) => c && c !== "—"));
      }
    }).catch((e) => {
      if (!cancelled) setError(e?.message || "Failed to load the weekly plan");
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [imName, weekStart, portalKey, refreshKey, quarter, commProject]);

  const shiftWeek = (weeks) => {
    const d = parseLocal(weekStart);
    if (!d) return;
    d.setDate(d.getDate() + weeks * 7);
    setWeekStart(iso(d));
  };

  const s = data?.summary || { total: 0, planned: 0, in_progress: 0, completed: 0, delayed: 0 };
  const days = data?.week?.days || [];
  const rows = data?.rows || [];
  const total = s.total || 0;

  // Always carries the year: a week label without one is unreadable next to a
  // quarter label that has one, and paging back a year looks identical.
  const weekLabel = useMemo(() => {
    if (!data?.week) return "";
    const d = (x) => new Date(`${x}T00:00:00`);
    const f = (x) => d(x).toLocaleDateString("en", { month: "short", day: "numeric" });
    return `${f(data.week.start)} – ${f(data.week.end)}, ${d(data.week.end).getFullYear()}`;
  }, [data]);
  // Short form for the cramped ‹ › pager in the summary card header.
  const weekLabelShort = useMemo(() => {
    if (!data?.week) return "";
    const d = (x) => new Date(`${x}T00:00:00`);
    const f = (x) => d(x).toLocaleDateString("en", { month: "short", day: "numeric" });
    return `${f(data.week.start)} – ${f(data.week.end)} ’${String(d(data.week.end).getFullYear()).slice(2)}`;
  }, [data]);

  const activitySlices = (data?.activity || []).slice(0, 5).map((a, i) => ({
    label: a.label, value: a.count, pct: a.pct, color: DONUT_COLORS[i % DONUT_COLORS.length],
  }));
  const maxTeam = Math.max(1, ...(data?.teams || []).map((t) => t.planned));

  const ct = commercial?.top;
  // Top 5 by planned value, with everything else folded into one "Others" row.
  // Without it the Total describes rows that aren't on screen — the same trap
  // as a truncated table whose footer reads as the whole answer.
  const topProjects = useMemo(
    () => (commercial?.projects || []).filter((p) => p.planned > 0).slice(0, 5),
    [commercial]
  );
  const othersRow = useMemo(() => {
    const shown = new Set(topProjects.map((p) => p.project_code));
    const rest = (commercial?.projects || []).filter((p) => !shown.has(p.project_code));
    if (!rest.length) return null;
    return {
      count: rest.length,
      planned: rest.reduce((a, p) => a + p.planned, 0),
      invoiced: rest.reduce((a, p) => a + p.invoiced, 0),
      collected: rest.reduce((a, p) => a + p.collected, 0),
    };
  }, [commercial, topProjects]);
  // Answers from the client: forecast = planned - invoiced; health = invoiced / planned.
  const forecast = ct ? Math.max(ct.planned - ct.invoiced, 0) : 0;
  const health = ct && ct.planned ? (ct.invoiced * 100) / ct.planned : 0;
  const onTrack = s.planned + s.in_progress + s.completed;

  return (
    <div style={{ padding: "0 16px 16px" }}>
      {error && <div className="notice error" style={{ marginBottom: 10 }}><span>!</span> {error}</div>}

      <div style={{ display: "flex", gap: 9, alignItems: "flex-start", flexWrap: "wrap", opacity: loading ? 0.6 : 1, transition: "opacity 120ms ease" }}>
        {/* ── LEFT RAIL ── */}
        <div style={{ width: 186, flexShrink: 0, display: "flex", flexDirection: "column", gap: 9 }}>
          <Card
            title="Weekly summary"
            right={
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: C.muted }}>
                <button type="button" onClick={() => shiftWeek(-1)} style={navBtn}>‹</button>
                <span title={weekLabel}>{weekLabelShort}</span>
                <button type="button" onClick={() => shiftWeek(1)} style={navBtn}>›</button>
              </div>
            }
          >
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div style={{ ...tile, gridColumn: "1 / -1" }}>
                <div style={tileN}>{total}</div><div style={tileL}>Total POIDs</div>
              </div>
              {BUCKETS.map((b) => (
                <div key={b.key} style={tile}>
                  <div style={{ ...tileN, color: b.text }}>{s[b.key]}</div>
                  <div style={tileL}>{b.label} · {pct(s[b.key], total)}%</div>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Activity type breakdown">
            {activitySlices.length ? (
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <Donut slices={activitySlices} total={total} />
                <div style={{ fontSize: 11, color: C.muted, display: "flex", flexDirection: "column", gap: 5 }}>
                  {activitySlices.map((a) => (
                    <div key={a.label}>
                      <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, marginRight: 6, background: a.color }} />
                      {a.label} · {a.value} ({a.pct}%)
                    </div>
                  ))}
                </div>
              </div>
            ) : <Empty />}
          </Card>

          <Card title="Team workload (this week)">
            {(data?.teams || []).length ? (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: C.muted, textTransform: "uppercase", marginBottom: 8 }}>
                  <span>Team</span><span>Planned</span>
                </div>
                {data.teams.map((t) => (
                  <div key={t.team} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 12, width: 78, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={t.team_name}>
                      {t.team_name}
                    </span>
                    <div style={{ flex: 1, height: 6, borderRadius: 3, background: "#EDEEF4", overflow: "hidden" }}>
                      <i style={{ display: "block", height: "100%", background: C.purple, width: `${(t.planned * 100) / maxTeam}%` }} />
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 700, width: 24, textAlign: "right" }}>{t.planned}</span>
                  </div>
                ))}
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 700, borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
                  <span>Total planned</span>
                  <span>{data.teams.reduce((a, t) => a + t.planned, 0)}</span>
                </div>
              </>
            ) : <Empty />}
          </Card>
        </div>

        {/* ── CENTRE: the week grid ── */}
        <div style={{ flex: "1 1 440px", minWidth: 0, display: "flex", flexDirection: "column", gap: 9 }}>
          <Card
            title={`Weekly plan (${weekLabel})`}
            right={
              <button type="button" onClick={resetWidths} style={resetBtn} title="Reset column widths">
                Reset widths
              </button>
            }
          >
            <div style={{ overflow: "auto", maxHeight: "clamp(180px, 38vh, 430px)" }}>
              <div style={{
                display: "grid",
                gridTemplateColumns: [
                  ...DETAIL_COLS.map((c) => `${colWidths[c.key]}px`),
                  "repeat(7, minmax(30px, 1fr))",
                  ...TAIL_COLS.map((c) => `${colWidths[c.key]}px`),
                ].join(" "),
                minWidth: "100%", fontSize: 11.5,
              }}>
                {DETAIL_COLS.map((c) => (
                  <div key={c.key} style={{ ...ghSticky, position: "sticky" }} title={c.label}>
                    {c.label}
                    <span onMouseDown={startResize(c.key)} style={grip} />
                  </div>
                ))}
                {days.map((d) => <div key={d.date} style={ghDaySticky} title={d.label}>{d.label}</div>)}
                {TAIL_COLS.map((c) => (
                  <div key={c.key} style={{ ...ghSticky, position: "sticky" }} title={c.label}>
                    {c.label}
                    <span onMouseDown={startResize(c.key)} style={grip} />
                  </div>
                ))}
                {rows.map((r) => {
                  const b = BUCKETS.find((x) => x.key === r.bucket) || BUCKETS[0];
                  return (
                    <RowCells key={r.plan} row={r} bucket={b} />
                  );
                })}
              </div>
            </div>
            {!rows.length && !loading && (
              <div style={{ padding: 34, textAlign: "center", color: C.muted, fontSize: 13 }}>
                No plans scheduled in this week.
              </div>
            )}
            <div style={{ display: "flex", gap: 14, marginTop: 12, fontSize: 11.5, color: C.muted, flexWrap: "wrap" }}>
              <span>Showing {rows.length} row{rows.length !== 1 ? "s" : ""}</span>
              <span style={{ marginLeft: "auto", display: "flex", gap: 14 }}>
                {BUCKETS.map((b) => (
                  <span key={b.key}>
                    <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: b.color, marginRight: 5 }} />
                    {b.label}
                  </span>
                ))}
              </span>
            </div>
          </Card>
        </div>

        {/* ── RIGHT RAIL: commercial ── */}
        <div style={{ width: 210, flexShrink: 0, display: "flex", flexDirection: "column", gap: 9 }}>
          <Card
            title={`Commercial summary · ${quarter?.label || "…"}${quarter?.span ? ` (${quarter.span})` : ""}`}
            right={
              <select
                value={commProject}
                onChange={(e) => setCommProject(e.target.value)}
                style={{ border: `1px solid ${C.border}`, borderRadius: 6, padding: "3px 6px", fontSize: 11, maxWidth: 118, color: C.muted }}
              >
                <option value="">All Projects</option>
                {projectChoices.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            }
          >
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {[["Planned value (SAR)", ct?.planned], ["Forecast to complete (SAR)", forecast],
                ["Invoiced (SAR)", ct?.invoiced], ["Collected (SAR)", ct?.collected]].map(([label, v]) => (
                <div key={label} style={tile} title={`${label}: ${money(v)}`}>
                  <div style={moneyN}>{money(v)}</div>
                  <div style={tileL}>{label}</div>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Commercial breakdown">
            {ct?.planned ? (
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <Donut
                  total={ct.planned}
                  slices={[
                    { value: ct.collected, color: C.green },
                    { value: ct.pending, color: C.blue },
                    { value: ct.not_invoiced, color: C.gray },
                  ]}
                />
                <div style={{ fontSize: 11, color: C.muted, display: "flex", flexDirection: "column", gap: 5 }}>
                  {[["Invoiced & collected", ct.collected, C.green],
                    ["Invoiced pending", ct.pending, C.blue],
                    ["Not invoiced (planned)", ct.not_invoiced, C.gray]].map(([l, v, col]) => (
                    <div key={l}>
                      <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, marginRight: 6, background: col }} />
                      {l} · {pct(v, ct.planned)}% ({money(v)})
                    </div>
                  ))}
                </div>
              </div>
            ) : <Empty />}
          </Card>

          <Card title="Top projects by value">
            {commercial?.projects?.length ? (
              // Four money columns do not fit a 255px rail, so the table gets
              // its own scroller rather than spilling its last column outside
              // the card.
              <div style={{ overflowX: "auto", margin: "0 -4px" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10.5 }}>
                  <thead>
                    <tr>
                      <th style={pth}>Project</th>
                      <th style={pthR}>Planned</th>
                      <th style={pthR}>Invoiced</th>
                      <th style={pthR}>Collected</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topProjects.map((p) => (
                      <tr key={p.project_code}>
                        <td style={ptd} title={p.project_code}>{p.project_code}</td>
                        <td style={ptdR}>{money(p.planned)}</td>
                        <td style={ptdR}>{money(p.invoiced)}</td>
                        <td style={ptdR}>{money(p.collected)}</td>
                      </tr>
                    ))}
                    {othersRow && (
                      <tr>
                        <td style={{ ...ptd, color: C.muted }}>Others · {othersRow.count}</td>
                        <td style={ptdR}>{money(othersRow.planned)}</td>
                        <td style={ptdR}>{money(othersRow.invoiced)}</td>
                        <td style={ptdR}>{money(othersRow.collected)}</td>
                      </tr>
                    )}
                    <tr>
                      <td style={ptf}>Total</td>
                      <td style={ptfR}>{money(ct?.planned)}</td>
                      <td style={ptfR}>{money(ct?.invoiced)}</td>
                      <td style={ptfR}>{money(ct?.collected)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : <Empty />}
            <button
              type="button"
              onClick={() => navigate(
                reportHref
                || `/im-reports?tab=commercial${commProject ? `&project=${encodeURIComponent(commProject)}` : ""}`
              )}
              style={{
                width: "100%", marginTop: 10, padding: "8px 10px", borderRadius: 8,
                border: `1px solid ${C.blue}`, background: "#fff", color: C.blueText,
                fontSize: 12, fontWeight: 700, cursor: "pointer",
              }}
            >
              View commercial report
            </button>

          </Card>
        </div>
      </div>

      {/* ── BOTTOM: headline tiles + gauges ── */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 9 }}>
        {BUCKETS.map((b) => (
          <div key={b.key} style={bstat}>
            <div style={bstatL}>{b.label === "Planned" ? "Planned this week" : b.label}</div>
            <div style={{ ...bstatN, color: b.text }}>{s[b.key]}</div>
            <div style={bstatS}>{pct(s[b.key], total)}% of total</div>
          </div>
        ))}
        <div style={bstat}>
          <div style={bstatL}>Total POIDs</div>
          <div style={bstatN}>{total}</div>
          <div style={bstatS}>100%</div>
        </div>
        <Gauge
          value={pct(onTrack, total)} color={C.teal} caption="Weekly progress"
          sub={`${onTrack} of ${total} POIDs are on track`}
        />
        <Gauge
          value={health} color={C.amber} caption="Commercial health"
          sub={ct?.planned
            ? `Invoiced ${money(ct.invoiced)} of ${money(ct.planned)} planned`
            : `No planned value in ${quarter?.label || "this quarter"}`}
        />
      </div>

      {/* ── WEEKLY CALENDAR ── */}
      <div style={{ marginTop: 18 }}>
        <h4 style={{ margin: "0 0 10px", fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: ".04em", textTransform: "uppercase" }}>
          Weekly calendar overview
        </h4>
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(132px, 1fr))" }}>
          {days.map((d) => (
            <div key={d.date} style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>{d.label}</div>
              {[["Planned", d.planned, C.blueText], ["In progress", d.in_progress, C.amberText], ["Delayed", d.delayed, C.redText]].map(([l, v, col]) => (
                <div key={l} style={{ display: "flex", alignItems: "center", fontSize: 11.5, color: C.muted, marginBottom: 3 }}>
                  <i style={{ width: 6, height: 6, borderRadius: "50%", background: col, marginRight: 6, display: "inline-block" }} />
                  {l}<b style={{ marginLeft: "auto", color: "#1A1F36" }}>{v}</b>
                </div>
              ))}
            </div>
          ))}
          <Highlights days={days} summary={s} />
        </div>
      </div>
    </div>
  );
}

/** One plan's row: five detail cells, seven day cells, status and progress. */
function RowCells({ row, bucket }) {
  const cells = [];
  cells.push(<div key="poid" style={{ ...gc, fontFamily: "ui-monospace, monospace", fontSize: 10.8 }} title={row.poid}>{row.poid}</div>);
  cells.push(
    <div key="mode" style={gc}>
      <span style={{
        display: "inline-block", padding: "3px 8px", borderRadius: 999, fontSize: 10, fontWeight: 700, color: "#fff",
        background: row.mode === "Auto" ? C.purple : C.teal,
      }}>{row.mode || "—"}</span>
    </div>
  );
  cells.push(<div key="proj" style={gc} title={row.project_code}>{row.project_code || "—"}</div>);
  cells.push(<div key="dom" style={gc} title={row.domain}>{row.domain || "—"}</div>);
  cells.push(<div key="act" style={gc} title={row.activity_type || row.item_description}>{row.activity_type || "—"}</div>);
  for (let i = 0; i < 7; i += 1) {
    const isStart = i === row.day_offset;
    cells.push(
      <div key={`d${i}`} style={{ ...gc, position: "relative", minHeight: 34, overflow: "visible" }}>
        {isStart && (
          // One bar spanning its own cell plus the cells it runs into, so a
          // multi-day plan reads as one block rather than repeated chips.
          <div style={{
            position: "absolute", left: 4, top: "50%", transform: "translateY(-50%)",
            height: 9, borderRadius: 5, background: bucket.color, pointerEvents: "none",
            width: `calc(${row.day_span * 100}% - 8px)`,
          }} title={`${row.plan_date} → ${row.plan_end_date} · ${row.plan_status}`} />
        )}
      </div>
    );
  }
  cells.push(
    <div key="st" style={gc}>
      <span style={{
        display: "inline-block", padding: "3px 8px", borderRadius: 999, fontSize: 10, fontWeight: 700,
        color: bucket.text, background: `${bucket.color}1f`, whiteSpace: "nowrap",
      }}>{row.plan_status}</span>
    </div>
  );
  cells.push(<div key="pg" style={gc}>{Math.round(row.completion_pct)}%</div>);
  return cells;
}

function Highlights({ days, summary }) {
  const busiest = days.reduce((a, d) => (d.planned > (a?.planned ?? -1) ? d : a), null);
  const items = [
    busiest && busiest.planned > 0 && `Highest workload on ${busiest.label}`,
    summary.delayed > 0 && `${summary.delayed} POID${summary.delayed !== 1 ? "s" : ""} delayed — take action`,
    summary.total > 0 && `${pct(summary.completed, summary.total)}% completed so far this week`,
  ].filter(Boolean);
  return (
    <div style={{ background: "#0B1330", color: "#C7CBE0", borderRadius: 10, padding: "10px 12px" }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: "#fff", marginBottom: 6 }}>This week highlights</div>
      {items.length ? (
        <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11.5, lineHeight: 1.7 }}>
          {items.map((t) => <li key={t}>{t}</li>)}
        </ul>
      ) : <div style={{ fontSize: 11.5 }}>Nothing scheduled this week.</div>}
    </div>
  );
}

function Empty() {
  return <div style={{ padding: "18px 0", textAlign: "center", color: C.muted, fontSize: 12 }}>No data for this week.</div>;
}

const navBtn = { border: `1px solid ${C.border}`, background: "#fff", borderRadius: 6, width: 20, height: 20, fontSize: 11, cursor: "pointer", lineHeight: 1 };
const tile = { background: "#FAFAFD", border: `1px solid ${C.border}`, borderRadius: 8, padding: "9px 10px" };
const tileN = { fontSize: 19, fontWeight: 700, fontVariantNumeric: "tabular-nums" };
const tileL = { fontSize: 10.5, color: C.muted, marginTop: 1 };
const moneyN = { ...tileN, fontSize: 15.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
// Sticky header variants: the grid scrolls vertically, so the header row has
// to stay put. Needs an opaque background or rows show through it.
const ghSticky = { padding: "8px 7px", fontSize: 10, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: ".03em", borderBottom: "1px solid #E4E6EF", background: "#FAFAFD", whiteSpace: "nowrap", top: 0, zIndex: 3 };
const ghDaySticky = { padding: "8px 4px", fontSize: 9.5, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", borderBottom: "1px solid #E4E6EF", background: "#FAFAFD", whiteSpace: "nowrap", textAlign: "center", overflow: "hidden", position: "sticky", top: 0, zIndex: 3 };
const gh = { padding: "8px 7px", fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".03em", borderBottom: `1px solid ${C.border}`, background: "#FAFAFD", whiteSpace: "nowrap" };
const grip = {
  position: "absolute", top: 0, right: -3, width: 7, height: "100%",
  cursor: "col-resize", userSelect: "none", zIndex: 2,
};
const resetBtn = {
  border: `1px solid ${C.border}`, background: "#fff", borderRadius: 6,
  padding: "3px 8px", fontSize: 10.5, color: C.muted, cursor: "pointer",
};
const ghDay = { padding: "8px 4px", fontSize: 9.5, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 0, borderBottom: `1px solid ${C.border}`, background: "#FAFAFD", whiteSpace: "nowrap", textAlign: "center", overflow: "hidden" };
const gc = { padding: "9px 7px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const pth = { padding: "6px 3px", textAlign: "left", fontSize: 10, textTransform: "uppercase", color: C.muted, borderBottom: `1px solid ${C.border}` };
const pthR = { ...pth, textAlign: "right" };
const ptd = { padding: "5px 3px", borderBottom: "1px solid #F1F5F9", whiteSpace: "nowrap" };
const ptdR = { ...ptd, textAlign: "right", fontVariantNumeric: "tabular-nums" };
const ptf = { ...ptd, fontWeight: 800, borderTop: `2px solid ${C.border}`, borderBottom: "none" };
const ptfR = { ...ptdR, fontWeight: 800, borderTop: `2px solid ${C.border}`, borderBottom: "none" };
const bstat = { background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: "9px 11px", flex: "1 1 118px", minWidth: 114 };
const bstatL = { fontSize: 11, color: C.muted, fontWeight: 600 };
const bstatN = { fontSize: 26, fontWeight: 800, letterSpacing: "-0.5px", lineHeight: 1.15, marginTop: 2 };
const bstatS = { fontSize: 11, color: C.muted, marginTop: 1 };
