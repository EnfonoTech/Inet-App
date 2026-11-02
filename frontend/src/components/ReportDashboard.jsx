import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

/**
 * The dashboard half of a report page: headline tiles, chart cards and top-N
 * tables, laid out to the client's reference. The table underneath stays the
 * catalog's own.
 *
 * It draws only what the server sends as `dashboard` — every number is
 * computed there over the same rows the table shows, so a tile can never
 * disagree with the column it summarises:
 *
 *   tiles   [{label, value, format, sub, tone, icon}]
 *   charts  [{kind: bar|hbar|donut|line, title, sub, x, series:[{key,label,color}],
 *             data, format, stacked}]
 *   tops    [{title, columns:[{key,label,format}], rows}]
 *
 * format: int | qty | money | pct | text.  tone: blue | green | red | grey | amber.
 * A pct column in a top table is heat-coloured on the catalog's 90/75/60 bands.
 */

export const PALETTE = ["#1d5fd1", "#e08a2c", "#15803d", "#6d4bd1", "#0e8a8a", "#b42318", "#94a3b8", "#163a7a"];

const intFmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });
const qtyFmt = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });
const moneyFmt = new Intl.NumberFormat("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function fmt(v, format = "int") {
  if (v === null || v === undefined || v === "") return "—";
  if (format === "text") return String(v);
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  if (format === "pct") return `${n.toFixed(1)}%`;
  if (format === "money") return moneyFmt.format(n);
  if (format === "qty") return qtyFmt.format(n);
  return intFmt.format(n);
}

// Axis ticks: money in K / M so the axis stays narrow; the bars carry exact labels.
function axisFmt(v, format) {
  if (format === "pct") return `${v}%`;
  const n = Math.abs(v);
  if (format === "money" && n >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (format === "money" && n >= 1e3) return `${Math.round(v / 1e3)}K`;
  return intFmt.format(v);
}

// Tooltip rows in dark text: the default paints each row in its series colour,
// and the pale "Target" / "Planned" blue was unreadable on white.
export const TIP = {
  itemStyle: { color: "#0f1e36" },
  labelStyle: { color: "#5b6b82", fontWeight: 600 },
  contentStyle: { borderRadius: 8, borderColor: "#e3e9f2", fontSize: 12, background: "#fff" },
};

// Long category names (team · lead) are cut on the axis; the tooltip has them whole.
const shortTick = (v) => { const t = String(v ?? ""); return t.length > 26 ? `${t.slice(0, 25)}…` : t; };
const shortXTick = (v) => { const t = String(v ?? ""); return t.length > 14 ? `${t.slice(0, 13)}…` : t; };

// Value labels sit just past the bar's RIGHT end. For a negative bar that end is
// the zero line, so the label lands in the empty space beside it instead of on
// top of the category name, which is where "position=right" put it.
function HbarLabel({ x, y, width, height, value, format }) {
  const right = Math.max(x, x + width);
  return (
    <text x={right + 6} y={y + height / 2} dy={4} fontSize={11} fontWeight={700} fill={Number(value) < 0 ? "#b42318" : "#0f1e36"}>
      {format === "money" ? axisFmt(value, format) : fmt(value, format)}
    </text>
  );
}

// Same bands as the rest of the report catalog: ≥90 / ≥75 / ≥60 / below.
export function heat(v) {
  const n = Number(v);
  if (n >= 90) return "rdash-h4";
  if (n >= 75) return "rdash-h3";
  if (n >= 60) return "rdash-h2";
  return "rdash-h1";
}

export const ICONS = {
  teams: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5" /><circle cx="17.5" cy="9" r="2.5" /><path d="M17 14.5c2.4.2 4 1.8 4.5 4.5" /></>,
  planned: <><rect x="4" y="5" width="16" height="16" rx="2" /><path d="M8 3v4M16 3v4M4 10h16" /></>,
  done: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  rate: <><path d="M12 3a9 9 0 109 9h-9z" /><path d="M15 3.5A9 9 0 0120.5 9H15z" /></>,
  avg: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  up: <><path d="M3 17l6-6 4 4 8-8" /><path d="M15 7h6v6" /></>,
  down: <><path d="M3 7l6 6 4-4 8 8" /><path d="M15 17h6v-6" /></>,
  money: <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></>,
  doc: <><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5M10 13h6M10 17h6" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  alert: <><path d="M12 8v5M12 16.5v.5" /><path d="M10.3 3.9L2.5 18a2 2 0 001.7 3h15.6a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" /></>,
  target: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></>,
  folder: <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />,
  box: <><path d="M12 3l9 4.5v9L12 21l-9-4.5v-9z" /><path d="M3 7.5l9 4.5 9-4.5M12 12v9" /></>,
  star: <path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z" />,
};

export function Tile({ icon = "avg", tone = "blue", label, value, sub, onClick, title, delta }) {
  // With onClick the tile opens the page its figure comes from.
  const Tag = onClick ? "button" : "div";
  return (
    <Tag type={onClick ? "button" : undefined} onClick={onClick} title={title}
      className={`rdash-tile tone-${tone}${onClick ? " rdash-tile-link" : ""}`}>
      <div className="rdash-tile-ic">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[icon] || ICONS.avg}</svg>
      </div>
      <div className="rdash-tile-body">
        <div className="rdash-tile-label">{label}</div>
        <div className="rdash-tile-value">{value}</div>
        {sub && <div className="rdash-tile-sub">{sub}</div>}
        {/* delta = { text, dir: "up" | "down" | "flat" } — the change against an earlier period. */}
        {delta && <div className={`rdash-tile-delta ${delta.dir || "flat"}`}>{delta.text}</div>}
      </div>
    </Tag>
  );
}

export function Card({ title, aside, children, className = "" }) {
  return (
    <section className={`rdash-card ${className}`}>
      <div className="rdash-card-hd">
        <h2>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function TopTable({ rows, cols, rowKey, empty = "Nothing to show" }) {
  return (
    <div className="rdash-table-scroll">
      <table className="rdash-table">
        <thead>
          <tr>
            <th>#</th>
            {cols.map((c) => <th key={c.key} className={c.num ? "num" : c.pct ? "pct" : ""}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={cols.length + 1} className="rdash-muted" style={{ textAlign: "center", padding: 18 }}>{empty}</td></tr>
          ) : rows.map((r, i) => (
            <tr key={rowKey ? r[rowKey] : i}>
              <td>{i + 1}</td>
              {cols.map((c) => (
                <td key={c.key} className={c.pct ? `pct ${heat(r[c.key])}` : c.num ? "num" : ""} title={c.num || c.pct ? undefined : String(r[c.key] ?? "")}>
                  {c.render ? c.render(r) : c.pct ? fmt(r[c.key], "pct") : c.num ? fmt(r[c.key], c.format || "int") : (r[c.key] || "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChartBody({ chart }) {
  const { kind, x = "label", series = [], data = [], format = "int", stacked } = chart;
  // Profit and gap can go negative; a 0-based axis would clip those bars away.
  const hasNeg = data.some((d) => series.some((s) => Number(d[s.key]) < 0));
  const domain = format === "pct" && !hasNeg ? [0, 100] : hasNeg ? ["auto", "auto"] : [0, "auto"];
  const label = { fontSize: 11, fontWeight: 700, fill: "#0f1e36" };
  const tip = (v, n) => [fmt(v, format), n];
  // onBarClick(row) makes each bar open the list behind it.
  const barClick = chart.onBarClick
    ? { onClick: (d) => chart.onBarClick(d?.payload || d), style: { cursor: "pointer" } }
    : {};

  if (kind === "donut") {
    const valueKey = series[0]?.key || "value";
    const total = data.reduce((a, d) => a + (Number(d[valueKey]) || 0), 0);
    const pct = (v) => (total ? `${((v / total) * 100).toFixed(1)}%` : "0%");
    return (
      <div className="rdash-donut">
        <div className="rdash-donut-chart">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey={valueKey} nameKey={x} innerRadius="64%" outerRadius="96%" startAngle={90} endAngle={-270} stroke="none">
                {data.map((d, i) => <Cell key={d[x]} fill={d.color || PALETTE[i % PALETTE.length]} />)}
              </Pie>
              <Tooltip {...TIP} wrapperStyle={{ zIndex: 10 }} formatter={(v, n) => [`${fmt(v, format)} · ${pct(v)}`, n]} />
            </PieChart>
          </ResponsiveContainer>
          <div className="rdash-donut-center"><b>{chart.center ?? (format === "money" ? axisFmt(total, "money") : fmt(total, format))}</b><span>{chart.centerLabel || ""}</span></div>
        </div>
        <ul className="rdash-legend">
          {data.map((d, i) => (
            <li key={d[x]}>
              <span><i style={{ background: d.color || PALETTE[i % PALETTE.length] }} />{d[x]}</span>
              <b>{fmt(d[valueKey], format === "money" ? "int" : format)} <span className="rdash-muted">({pct(d[valueKey])})</span></b>
            </li>
          ))}
          {chart.note && <li className="rdash-legend-note">{chart.note}</li>}
        </ul>
      </div>
    );
  }

  if (kind === "hbar") {
    return (
      <div className="rdash-chart" style={{ height: Math.max(170, data.length * (stacked ? 30 : 22 * series.length + 8) + (series.length > 1 ? 54 : 30)) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 64, left: 4, bottom: 0 }}>
            <CartesianGrid horizontal={false} stroke="#eef2f7" />
            <XAxis type="number" hide domain={domain} />
            <YAxis type="category" dataKey={x} width={170} tickFormatter={shortTick} tick={{ fontSize: 11.5, fill: "#33445e" }} axisLine={false} tickLine={false} />
            <Tooltip {...TIP} formatter={tip} cursor={{ fill: "#f4f7fb" }} />
            {series.length > 1 && <Legend formatter={(v) => <span style={{ color: "#33445e" }}>{v}</span>} iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12 }} verticalAlign="top" align="right" height={24} />}
            {series.map((s, i) => (
              <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color || PALETTE[i]} radius={[0, 5, 5, 0]} maxBarSize={16} stackId={stacked ? "s" : undefined} {...barClick}>
                {!stacked && <LabelList dataKey={s.key} content={(p) => <HbarLabel {...p} format={format} />} />}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  const Chart = kind === "line" ? LineChart : BarChart;
  // Names (IMs, projects) side by side collide; tilt them once there are more than a few.
  const tilt = data.length > 4 && data.length <= 10 && data.some((d) => String(d[x] ?? "").length > 6);
  return (
    <div className="rdash-chart">
      <ResponsiveContainer width="100%" height="100%">
        <Chart data={data} margin={{ top: 22, right: 10, left: tilt ? 44 : 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="#eef2f7" />
          <XAxis dataKey={x} tickFormatter={shortXTick} tick={{ fontSize: 11, fill: "#5b6b82" }} axisLine={{ stroke: "#d5deeb" }} tickLine={false}
            interval={data.length <= 10 ? 0 : "preserveStartEnd"} minTickGap={4}
            {...(tilt ? { angle: -30, textAnchor: "end", height: 58 } : {})} />
          <YAxis allowDecimals={format !== "int"} tickFormatter={(v) => axisFmt(v, format)} domain={domain} tick={{ fontSize: 11, fill: "#8a97a8" }} axisLine={false} tickLine={false} width={46} />
          <Tooltip {...TIP} formatter={tip} cursor={{ fill: "#f4f7fb" }} />
          {series.length > 1 && <Legend formatter={(v) => <span style={{ color: "#33445e" }}>{v}</span>} iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12 }} verticalAlign="top" align="right" height={24} />}
          {series.map((s, i) => (kind === "line" ? (
            <Line key={s.key} dataKey={s.key} name={s.label} stroke={s.color || PALETTE[i]} strokeWidth={2.5} dot={{ r: 3 }} />
          ) : (
            <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color || PALETTE[i]} radius={stacked ? 0 : [5, 5, 0, 0]} maxBarSize={44} stackId={stacked ? "s" : undefined} {...barClick}>
              {!stacked && data.length * series.length <= 10 && <LabelList dataKey={s.key} position="top" formatter={(v) => (format === "money" ? axisFmt(v, format) : fmt(v, format))} style={label} />}
            </Bar>
          )))}
        </Chart>
      </ResponsiveContainer>
    </div>
  );
}

/** One chart in its card — for pages that lay out their own grid. */
export function ChartCard({ chart }) {
  return (
    <Card title={chart.title} aside={chart.sub ? <span className="rdash-muted">{chart.sub}</span> : null}>
      <ChartBody chart={chart} />
    </Card>
  );
}

export default function ReportDashboard({ dashboard }) {
  if (!dashboard) return null;
  const { tiles = [], charts = [], tops = [] } = dashboard;
  const cols = (n) => `rdash-row rdash-row-${Math.min(Math.max(n, 1), 3)}`;
  return (
    <div className="rdash">
      {tiles.length > 0 && (
        <div className="rdash-tiles">
          {tiles.map((t) => (
            // Money tiles drop the halalas: a headline figure has to fit the tile,
            // and the exact amount is in the table's Total row underneath.
            <Tile key={t.label} icon={t.icon} tone={t.tone} label={t.label} value={fmt(t.value, t.format === "money" ? "int" : t.format || "int")} sub={t.sub} />
          ))}
        </div>
      )}
      {charts.length > 0 && (
        <div className={cols(charts.length)}>
          {charts.map((c) => (
            <Card key={c.title} title={c.title} aside={c.sub ? <span className="rdash-muted">{c.sub}</span> : null}>
              <ChartBody chart={c} />
            </Card>
          ))}
        </div>
      )}
      {tops.length > 0 && (
        <div className={cols(tops.length)}>
          {tops.map((t) => (
            <Card key={t.title} title={t.title} aside={t.sub ? <span className="rdash-muted">{t.sub}</span> : null}>
              <TopTable
                rows={t.rows || []}
                cols={(t.columns || []).map((c) => ({
                  key: c.key, label: c.label,
                  pct: c.format === "pct", num: ["int", "qty", "money"].includes(c.format), format: c.format,
                }))}
              />
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
