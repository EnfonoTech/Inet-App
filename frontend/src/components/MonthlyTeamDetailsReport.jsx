import { useEffect, useMemo, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import DataTableWrapper from "./DataTableWrapper";
import SearchableSelect from "./SearchableSelect";
import { Card, TIP, Tile, TopTable, heat } from "./ReportDashboard";

/**
 * Monthly Team Details as a dashboard: headline tiles, three charts, three
 * top-5 tables and the full team table — laid out to the client's reference.
 *
 * Every figure comes from the server's `summary`, so the tiles, the charts
 * and the table's Total row agree. It is a team report: a plan two teams
 * worked counts for both, in their rows and in the totals alike. Cancelled
 * plans are excluded server-side.
 *
 * Used by both Reports pages; what differs is passed in:
 *   api              pmApi or imReportsApi — both expose reportMonthlyTeamDetails
 *   loadTeamOptions  async () => [{id,label}]
 *   loadImOptions    PM only; the IM side has one IM and omits the filter
 */

const WEEKS = ["w1", "w2", "w3", "w4", "w5"];
const C = {
  blue: "#1d5fd1", navy: "#163a7a", light: "#b9cdf3",
  green: "#15803d", amber: "#e0a320", grey: "#c7d0dc", red: "#b42318",
};

function isoMonth(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthRange(ym) {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, "0")}` };
}
const MONTHS = (() => {
  const now = new Date();
  const out = [];
  for (let i = 2; i >= -24; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    out.push({ id: isoMonth(d), label: d.toLocaleString("en", { month: "long", year: "numeric" }) });
  }
  return out;
})();

const fmtInt = (v) => Number(v || 0).toLocaleString("en");
const fmtPct = (v) => `${Number(v || 0).toFixed(1)}%`;

function ImCell({ row }) {
  if (!row.im_name) return <span className="rdash-muted">—</span>;
  const others = row.im_others || [];
  return (
    <span title={others.length ? `Also: ${others.join(", ")}` : undefined}>
      {row.im_name}
      {others.length > 0 && <span className="rdash-more"> +{others.length}</span>}
    </span>
  );
}

export default function MonthlyTeamDetailsReport({ api, loadTeamOptions, loadImOptions, onExportReady }) {
  const [month, setMonth] = useState(isoMonth(new Date()));
  const [teamFilter, setTeamFilter] = useState([]);
  const [imFilter, setImFilter] = useState([]);
  const [teamOptions, setTeamOptions] = useState([]);
  const [imOptions, setImOptions] = useState([]);
  const [search, setSearch] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    loadTeamOptions?.().then((o) => Array.isArray(o) && setTeamOptions(o)).catch(() => {});
    loadImOptions?.().then((o) => Array.isArray(o) && setImOptions(o)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    const { from, to } = monthRange(month);
    const f = { from_date: from, to_date: to };
    if (teamFilter.length) f.team = teamFilter;
    if (imFilter.length) f.im = imFilter;
    setLoading(true);
    setError(null);
    api.reportMonthlyTeamDetails(f)
      .then((res) => { if (!cancelled) setResult(res || null); })
      .catch((e) => { if (!cancelled) { setResult(null); setError(e?.message || "Failed to load report."); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [api, month, teamFilter, imFilter, reloadKey]);

  const rows = result?.data || [];
  const s = result?.summary || null;
  const monthLabel = MONTHS.find((m) => m.id === month)?.label || month;

  const derived = useMemo(() => {
    if (!rows.length) return null;
    const util = rows.map((r) => Number(r.utilization_pct) || 0);
    const planned = rows.map((r) => r.total_planned || 0);
    const completed = rows.map((r) => r.total_completed || 0);
    const byUtil = [...rows].sort((a, b) => b.utilization_pct - a.utilization_pct || b.total_planned - a.total_planned);
    const sum = (a) => a.reduce((x, y) => x + y, 0);
    return {
      avgUtil: sum(util) / rows.length,
      best: byUtil[0],
      worst: byUtil[byUtil.length - 1],
      topUtil: byUtil.slice(0, 5),
      topPlanned: [...rows].sort((a, b) => b.total_planned - a.total_planned).slice(0, 5),
      topCompleted: [...rows].sort((a, b) => b.total_completed - a.total_completed).slice(0, 5),
      perTeam: [
        { label: "Total", planned: s?.planned || 0, completed: s?.completed || 0 },
        { label: "Avg per team", planned: +(sum(planned) / rows.length).toFixed(1), completed: +(sum(completed) / rows.length).toFixed(1) },
        { label: "Max per team", planned: Math.max(...planned), completed: Math.max(...completed) },
        { label: "Min per team", planned: Math.min(...planned), completed: Math.min(...completed) },
      ],
    };
  }, [rows, s]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => `${r.team_id} ${r.team_name} ${r.im_name} ${(r.im_others || []).join(" ")}`.toLowerCase().includes(q));
  }, [rows, search]);

  useEffect(() => {
    onExportReady?.({
      filename: `monthly_team_details_${month}`,
      rows: rows.map((r) => ({
        "Team No.": r.team_id,
        "Team Lead": r.team_name,
        "INET IM": [r.im_name, ...(r.im_others || [])].filter(Boolean).join(", "),
        ...Object.fromEntries(WEEKS.map((w, i) => [`W-${i + 1} %`, r[`${w}_planned`] ? r[w] : ""])),
        "Total Planned": r.total_planned,
        Completed: r.total_completed,
        "Monthly Utilization %": r.utilization_pct,
      })),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, month]);

  const status = s ? [
    { name: "Completed", value: s.completed, color: C.green },
    { name: "Pending", value: s.pending, color: C.amber },
    { name: "Not started", value: s.not_started, color: C.grey },
  ] : [];
  const pctOf = (v) => (s?.planned ? `${((v / s.planned) * 100).toFixed(1)}%` : "0%");

  return (
    <>
      <div className="toolbar">
        <SearchableSelect value={month} onChange={(v) => setMonth(v || isoMonth(new Date()))} options={MONTHS} placeholder="Month" minWidth={180} />
        <SearchableSelect multi value={teamFilter} onChange={setTeamFilter} options={teamOptions} placeholder="All Teams" minWidth={170} />
        {loadImOptions && (
          <SearchableSelect multi value={imFilter} onChange={setImFilter} options={imOptions} placeholder="All IMs" minWidth={170} />
        )}
        {(teamFilter.length > 0 || imFilter.length > 0) && (
          <button type="button" className="btn-secondary" style={{ fontSize: "0.78rem", padding: "5px 12px" }}
            onClick={() => { setTeamFilter([]); setImFilter([]); }}>Clear</button>
        )}
        <div className="toolbar-actions">
          <button type="button" className="btn-secondary" disabled={loading} onClick={() => setReloadKey((k) => k + 1)}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      <div className="page-content">
        <div className="rdash">
          {error && <div className="notice error"><span>⚠</span> {error}</div>}

          {!s && loading && <div className="rpt-empty">Loading report…</div>}

          {s && (
            <>
              <div className="rdash-tiles">
                <Tile icon="teams" tone="blue" label="Total teams" value={fmtInt(s.teams)} sub="with a plan this month" />
                <Tile icon="planned" tone="grey" label="Total planned" value={fmtInt(s.planned)} sub="cancelled left out" />
                <Tile icon="done" tone="green" label="Total completed" value={fmtInt(s.completed)} sub={`${fmtInt(s.planned - s.completed)} still open`} />
                <Tile icon="rate" tone="blue" label="Completion rate" value={fmtPct(s.completion_pct)} sub="of planned" />
                <Tile icon="avg" tone="blue" label="Average utilization" value={derived ? fmtPct(derived.avgUtil) : "—"} sub={`mean of ${s.teams} teams`} />
                <Tile icon="up" tone="green" label="Highest utilization" value={derived ? fmtPct(derived.best.utilization_pct) : "—"} sub={derived ? `${derived.best.team_id} · ${derived.best.total_completed} of ${derived.best.total_planned}` : ""} />
                <Tile icon="down" tone="red" label="Lowest utilization" value={derived ? fmtPct(derived.worst.utilization_pct) : "—"} sub={derived ? `${derived.worst.team_id} · ${derived.worst.total_completed} of ${derived.worst.total_planned}` : ""} />
              </div>

              <div className="rdash-row rdash-row-3">
                <Card title="Weekly utilization" aside={<span className="rdash-muted">completed ÷ planned, all teams</span>}>
                  <div className="rdash-chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={s.weeks} margin={{ top: 22, right: 8, left: -12, bottom: 0 }}>
                        <CartesianGrid vertical={false} stroke="#eef2f7" />
                        <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#5b6b82" }} axisLine={{ stroke: "#d5deeb" }} tickLine={false} />
                        <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11, fill: "#8a97a8" }} axisLine={false} tickLine={false} />
                        <Tooltip {...TIP} formatter={(v, _n, p) => [`${v}% · ${p.payload.completed} of ${p.payload.planned}`, `${p.payload.from} → ${p.payload.to}`]} cursor={{ fill: "#f4f7fb" }} />
                        <Bar dataKey="pct" fill={C.blue} radius={[6, 6, 0, 0]} maxBarSize={56}>
                          <LabelList dataKey="pct" position="top" formatter={(v) => `${v}%`} style={{ fontSize: 12, fontWeight: 700, fill: "#0f1e36" }} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Card>

                <Card title="Planned vs completed">
                  <div className="rdash-chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={derived?.perTeam || []} margin={{ top: 22, right: 8, left: -12, bottom: 0 }}>
                        <CartesianGrid vertical={false} stroke="#eef2f7" />
                        <XAxis dataKey="label" tick={{ fontSize: 11.5, fill: "#5b6b82" }} axisLine={{ stroke: "#d5deeb" }} tickLine={false} interval={0} />
                        <YAxis tick={{ fontSize: 11, fill: "#8a97a8" }} axisLine={false} tickLine={false} />
                        <Tooltip {...TIP} cursor={{ fill: "#f4f7fb" }} />
                        <Legend formatter={(v) => <span style={{ color: "#33445e" }}>{v}</span>} iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12 }} verticalAlign="top" align="right" height={24} />
                        <Bar dataKey="planned" name="Planned" fill={C.light} radius={[4, 4, 0, 0]} maxBarSize={34}>
                          <LabelList dataKey="planned" position="top" style={{ fontSize: 11, fontWeight: 700, fill: "#0f1e36" }} />
                        </Bar>
                        <Bar dataKey="completed" name="Completed" fill={C.navy} radius={[4, 4, 0, 0]} maxBarSize={34}>
                          <LabelList dataKey="completed" position="top" style={{ fontSize: 11, fontWeight: 700, fill: "#0f1e36" }} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Card>

                <Card title="Team completion status">
                  <div className="rdash-donut">
                    <div className="rdash-donut-chart">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={status} dataKey="value" nameKey="name" innerRadius="64%" outerRadius="96%" startAngle={90} endAngle={-270} stroke="none">
                            {status.map((d) => <Cell key={d.name} fill={d.color} />)}
                          </Pie>
                          <Tooltip {...TIP} formatter={(v, n) => [`${fmtInt(v)} · ${pctOf(v)}`, n]} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="rdash-donut-center"><b>{fmtInt(s.planned)}</b><span>team plans</span></div>
                    </div>
                    <ul className="rdash-legend">
                      {status.map((d) => (
                        <li key={d.name}>
                          <span><i style={{ background: d.color }} />{d.name}</span>
                          <b>{fmtInt(d.value)} <span className="rdash-muted">({pctOf(d.value)})</span></b>
                        </li>
                      ))}
                      <li className="rdash-legend-note">Pending = work started, not completed. Not started = no execution yet.</li>
                    </ul>
                  </div>
                </Card>
              </div>

              <div className="rdash-row rdash-row-3">
                <Card title="Top 5 teams by utilization">
                  <TopTable rowKey="team" empty="No teams" rows={derived?.topUtil || []} cols={[
                    { key: "team_id", label: "Team" },
                    { key: "team_name", label: "Lead" },
                    { key: "im_name", label: "IM", render: (r) => <ImCell row={r} /> },
                    { key: "total_planned", label: "Planned", num: true },
                    { key: "total_completed", label: "Done", num: true },
                    { key: "utilization_pct", label: "Util. %", pct: true },
                  ]} />
                </Card>
                <Card title="Top 5 teams by planned activities">
                  <TopTable rowKey="team" empty="No teams" rows={derived?.topPlanned || []} cols={[
                    { key: "team_id", label: "Team" },
                    { key: "team_name", label: "Lead" },
                    { key: "total_planned", label: "Planned", num: true },
                    { key: "total_completed", label: "Done", num: true },
                    { key: "utilization_pct", label: "Util. %", pct: true },
                  ]} />
                </Card>
                <Card title="Top 5 teams by completed activities">
                  <TopTable rowKey="team" empty="No teams" rows={derived?.topCompleted || []} cols={[
                    { key: "team_id", label: "Team" },
                    { key: "team_name", label: "Lead" },
                    { key: "total_completed", label: "Done", num: true },
                    { key: "total_planned", label: "Planned", num: true },
                    { key: "utilization_pct", label: "Util. %", pct: true },
                  ]} />
                </Card>
              </div>

              <Card title={`Monthly team details · ${monthLabel}`} className="rdash-card-table" aside={
                <input type="search" className="rpt-search" placeholder="Search team, lead or IM…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search teams" />
              }>
                <DataTableWrapper style={{ maxHeight: "none" }}>
                  <table className="data-table" data-excel-filter-all="1" data-table-key="report-monthly-team-details-v2">
                    <thead>
                      <tr>
                        <th data-excel-filter="0">#</th>
                        <th>Team No.</th>
                        <th>Team Lead</th>
                        <th>INET IM</th>
                        {WEEKS.map((w, i) => {
                          const wk = s.weeks[i];
                          return <th key={w} title={`${wk.from} → ${wk.to}`} style={{ textAlign: "center" }}>W-{i + 1} %</th>;
                        })}
                        <th style={{ textAlign: "right" }}>Total Planned</th>
                        <th style={{ textAlign: "right" }}>Completed</th>
                        <th style={{ textAlign: "center" }}>Monthly Utilization %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.length === 0 ? (
                        <tr><td colSpan={12} style={{ textAlign: "center", color: "var(--text-muted)", padding: 32 }}>No teams with a plan in {monthLabel}.</td></tr>
                      ) : shown.map((r, idx) => (
                        <tr key={r.team}>
                          <td>{idx + 1}</td>
                          <td>{r.team_id}</td>
                          <td>{r.team_name}</td>
                          <td><ImCell row={r} /></td>
                          {WEEKS.map((w) => (
                            r[`${w}_planned`]
                              ? <td key={w} className={`rdash-heat ${heat(r[w])}`} title={`${r[`${w}_completed`]} of ${r[`${w}_planned`]}`}>{fmtPct(r[w])}</td>
                              : <td key={w} className="rdash-heat rdash-h0" title="No plans this week">—</td>
                          ))}
                          <td style={{ textAlign: "right" }}>{fmtInt(r.total_planned)}</td>
                          <td style={{ textAlign: "right" }}>{fmtInt(r.total_completed)}</td>
                          <td className={`rdash-heat ${heat(r.utilization_pct)}`}>{fmtPct(r.utilization_pct)}</td>
                        </tr>
                      ))}
                    </tbody>
                    {shown.length > 0 && (
                      <tfoot>
                        <tr className="rdash-total">
                          <td />
                          <td>Total</td>
                          <td />
                          <td />
                          {s.weeks.map((wk) => (
                            wk.planned
                              ? <td key={wk.key} className={`rdash-heat ${heat(wk.pct)}`}>{fmtPct(wk.pct)}</td>
                              : <td key={wk.key} className="rdash-heat rdash-h0">—</td>
                          ))}
                          <td style={{ textAlign: "right" }}>{fmtInt(s.planned)}</td>
                          <td style={{ textAlign: "right" }}>{fmtInt(s.completed)}</td>
                          <td className={`rdash-heat ${heat(s.completion_pct)}`}>{fmtPct(s.completion_pct)}</td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </DataTableWrapper>
                <div className="rdash-foot">
                  Weeks are days 1–7, 8–14, 15–21, 22–28 and 29–end. A plan worked by two teams counts for each team. Cancelled plans are not counted.
                </div>
              </Card>
            </>
          )}
        </div>
      </div>
    </>
  );
}
