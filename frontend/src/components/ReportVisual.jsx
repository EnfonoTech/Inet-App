import { useMemo } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer,
  Tooltip, XAxis, YAxis, Legend,
} from "recharts";

/**
 * Visual view for the {columns, data, totals, chart} report contract.
 *
 * Every report gets one without the backend having to supply anything. The
 * shape is derived from each column's fieldtype — sniffed from the data for
 * the reports that declare none — and matched to what the report is for:
 *
 *   measures      -> KPI cards from the server's `totals`
 *   a ranking     -> top-N bars, largest first
 *   a time series -> the same bars in row order, so months stay in sequence
 *   a percentage  -> ranked horizontal bars, colour-graded
 *   a status      -> row counts per value, which is the entire point of the
 *                    pending/overdue reports (Site Sign, Site Verify, Bill
 *                    Wise) — they carry no measure worth charting
 *
 * A report that returns an explicit `chart` (the frappe-charts
 * {labels, datasets} shape Desk uses) has that honoured instead of the
 * derived bars, so an author can always override the guess.
 *
 * Deliberately not a second copy of the numbers: the KPI cards read the
 * server-computed `totals` map, the same one the table footer uses. Percent
 * totals in particular are ratios of the underlying totals computed
 * server-side — never re-derived here, because averaging per-row percentages
 * across rows of unequal weight is wrong.
 */

const COLORS = ["#1565C0", "#0d9488", "#c2410c", "#7c3aed", "#b45309",
                "#0891b2", "#be123c", "#16a34a", "#4f46e5", "#059669",
                "#db2777", "#0284c7"];
const TOP_N = 12;

const key = (c) => c.fieldname || c.name;

/* Several reports (Site Sign / Site Verify / Bill Wise) declare no fieldtype
   on any column, so nothing could be recognised as a number and they got no
   visual at all. Sniff the data when the type is missing, and cache it on the
   column so every helper below agrees. */
const NUMERIC_NAME = /(qty|days|count|amount|value|total|lines|sar)$|^(qty|days)/i;
function resolveType(col, data = []) {
  if (col.fieldtype) return col.fieldtype;
  const k = key(col);
  const vals = data.slice(0, 60).map((r) => r?.[k]).filter((v) => v !== null && v !== "" && v !== undefined);
  if (!vals.length) return "Data";
  const allNum = vals.every((v) => typeof v === "number" || (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))));
  if (!allNum) return "Data";
  // A numeric-looking id column (bill no, site id) is not a measure.
  if (!NUMERIC_NAME.test(k)) return "Data";
  return vals.every((v) => Number.isInteger(Number(v))) ? "Int" : "Float";
}
const isPct = (c) => c._t === "Percent" || /^w[1-5]$/.test(c.fieldname || "");
const isMoney = (c) => c._t === "Currency";
const isNum = (c) => ["Currency", "Int", "Float"].includes(c._t) || isPct(c);

/* Overdue / behind reads red, on-track green — same sense the PIC and
   dispatch badges use elsewhere, so a status keeps its colour across pages. */
function STATUS_COLOR(v) {
  const t = String(v || "").toLowerCase();
  if (/overdue|behind|reject|cancel|fail|no progress|long delay/.test(t)) return "#be123c";
  if (/warning|watch|pending|need improvement|moderate/.test(t)) return "#b45309";
  if (/excellent|closed|complete|done|on time|good|ok|normal/.test(t)) return "#16a34a";
  return "#1565C0";
}

function truncate(s, n) {
  const t = String(s ?? "");
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function fmtValue(v, col) {
  const n = Number(v);
  if (v == null || v === "" || Number.isNaN(n)) return String(v ?? "—");
  if (isPct(col)) return `${n.toFixed(1)}%`;
  if (isMoney(col)) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return Math.round(n).toLocaleString();
}

/* Status / rating / bucket columns: a small set of repeated labels. Counting
   rows per value is the whole point of the pending-and-overdue reports (Site
   Sign, Site Verify, Bill Wise), which carry no measure worth charting — and
   it is useful anywhere a report grades its rows (KPI Rating, Severity). */
const STATUS_NAME = /^(status|kpi_rating|rating|severity|delay_bucket|bucket|state)$/i;
function pickStatusCol(columns, data) {
  const cands = columns.filter((c) => key(c) !== "sn" && !isNum(c) && c._t !== "Date");
  const named = cands.filter((c) => STATUS_NAME.test(key(c)));
  // A column actually CALLED status/rating/severity is taken on its name.
  // The repetition test below exists only to stop an unnamed text column of
  // one-per-row identifiers being mistaken for a category, and it wrongly
  // rejected small reports — Site Sign has 4 rows across 3 statuses, which
  // is exactly the breakdown those pending/overdue reports exist to show.
  for (const c of named) {
    const vals = data.map((r) => String(r?.[key(c)] ?? "").trim()).filter(Boolean);
    const distinct = new Set(vals);
    if (distinct.size > 1 && distinct.size <= 8) return c;
  }
  for (const c of cands) {
    const vals = data.map((r) => String(r?.[key(c)] ?? "").trim()).filter(Boolean);
    const distinct = new Set(vals);
    if (distinct.size > 1 && distinct.size <= 8 && vals.length >= distinct.size * 2) return c;
  }
  return null;
}

/** The column rows are labelled by: the first non-numeric, non-row-number one. */
function pickLabelCol(columns) {
  return columns.find((c) => key(c) !== "sn" && !isNum(c) && c._t !== "Date")
      || columns.find((c) => key(c) !== "sn" && !isNum(c));
}

/** Numeric columns worth charting, biggest magnitude first. */
function pickValueCols(columns, data) {
  const cands = columns.filter((c) => key(c) !== "sn" && isNum(c) && !isPct(c));
  const scored = cands.map((c) => ({
    col: c,
    mag: data.reduce((a, r) => a + Math.abs(parseFloat(r?.[key(c)]) || 0), 0),
  })).filter((s) => s.mag > 0);
  scored.sort((a, b) => b.mag - a.mag);
  // Money columns are the story on these reports; fall back to counts.
  const money = scored.filter((s) => isMoney(s.col));
  return (money.length ? money : scored).slice(0, 2).map((s) => s.col);
}

export default function ReportVisual({ columns: rawColumns = [], data = [], totals = {}, chart = null }) {
  // Resolve each column's type once (sniffing the data where the report
  // declares none) so every derivation below sees the same answer.
  const columns = useMemo(
    () => rawColumns.map((c) => ({ ...c, _t: resolveType(c, data) })),
    [rawColumns, data],
  );
  const labelCol = useMemo(() => pickLabelCol(columns), [columns]);
  const valueCols = useMemo(() => pickValueCols(columns, data), [columns, data]);

  // KPI cards: every aggregable column the server produced a total for.
  const cards = useMemo(() => {
    if (!columns.length) return [];
    return columns
      .filter((c) => key(c) !== "sn" && isNum(c) && totals?.[key(c)] != null)
      .map((c) => ({ col: c, label: c.label, value: totals[key(c)] }));
  }, [columns, totals]);

  // Rows for the derived chart — top N by the primary value column.
  const rows = useMemo(() => {
    if (!labelCol || !valueCols.length) return [];
    const lk = key(labelCol);
    const pk = key(valueCols[0]);
    return [...data]
      .map((r) => ({
        label: String(r?.[lk] ?? ""),
        shortLabel: truncate(r?.[lk], 22),
        ...Object.fromEntries(valueCols.map((c) => [key(c), parseFloat(r?.[key(c)]) || 0])),
      }))
      .filter((r) => valueCols.some((c) => r[key(c)] !== 0));
  }, [data, labelCol, valueCols]);

  // A percent column makes a useful second view — how each row is doing,
  // rather than how big it is.
  const pctCol = useMemo(
    () => columns.find((c) => key(c) !== "sn" && isPct(c) && totals?.[key(c)] != null),
    [columns, totals],
  );
  const pctRows = useMemo(() => {
    if (!pctCol || !labelCol) return [];
    const lk = key(labelCol);
    const pk = key(pctCol);
    return [...data]
      .map((r) => ({
        label: String(r?.[lk] ?? ""),
        shortLabel: truncate(r?.[lk], 22),
        pct: parseFloat(r?.[pk]) || 0,
      }))
      .filter((r) => r.pct > 0)
      .sort((a, b) => b.pct - a.pct)
      .slice(0, TOP_N);
  }, [data, pctCol, labelCol]);

  // A month/week-labelled report reads chronologically; sorting it by
  // magnitude would scramble the series it exists to show.
  //
  // Declared ABOVE barRows, which lists it in a dep array. Dep arrays are
  // evaluated during render, so a `const` declared further down is a
  // temporal dead zone ReferenceError that white-screens the page — and
  // `yarn build` does not catch it.
  const isSeries = useMemo(() => {
    if (!labelCol) return false;
    return labelCol._t === "Date" || /^(month|week|week_start|period|day)$/i.test(key(labelCol));
  }, [labelCol]);

  // Sorted by size for a ranking report, left in row order for a series one.
  const barRows = useMemo(() => {
    if (!valueCols.length) return [];
    if (isSeries) return rows.slice(-TOP_N);
    const pk = key(valueCols[0]);
    return [...rows].sort((a, b) => (b[pk] || 0) - (a[pk] || 0)).slice(0, TOP_N);
  }, [rows, isSeries, valueCols]);

  // Count of rows per status / rating / bucket.
  const statusCol = useMemo(() => pickStatusCol(columns, data), [columns, data]);
  const statusRows = useMemo(() => {
    if (!statusCol) return [];
    const sk = key(statusCol);
    const counts = new Map();
    for (const r of data) {
      const v = String(r?.[sk] ?? "").trim();
      if (v) counts.set(v, (counts.get(v) || 0) + 1);
    }
    return [...counts.entries()]
      .map(([label, count]) => ({ label, shortLabel: truncate(label, 22), count }))
      .sort((a, b) => b.count - a.count);
  }, [data, statusCol]);

  // An explicit backend chart wins over the derived one.
  const explicit = useMemo(() => {
    const labels = chart?.data?.labels || [];
    const values = chart?.data?.datasets?.[0]?.values || [];
    if (!labels.length) return null;
    return {
      name: chart.data.datasets[0].name || "Value",
      rows: labels.map((l, i) => ({
        label: String(l), shortLabel: truncate(l, 22), value: Number(values[i]) || 0,
      })),
    };
  }, [chart]);

  if (!columns.length) return null;

  const noVisual = !cards.length && !barRows.length && !pctRows.length
                   && !statusRows.length && !explicit;
  if (noVisual) {
    return (
      <div className="rpt-visual-empty">
        This report has no numeric columns to chart — use the Table view.
      </div>
    );
  }

  return (
    <div className="rpt-visual">
      {cards.length > 0 && (
        <div className="rpt-visual-cards">
          {cards.map(({ col, label, value }, i) => (
            <div className="rpt-visual-card" key={key(col)}>
              <div className="rpt-visual-card-label">{label}</div>
              <div className="rpt-visual-card-value" style={{ color: COLORS[i % COLORS.length] }}>
                {fmtValue(value, col)}
              </div>
              {isMoney(col) && <div className="rpt-visual-card-sub">SAR</div>}
            </div>
          ))}
        </div>
      )}

      <div className="rpt-visual-charts">
        {explicit ? (
          <div className="rpt-visual-panel">
            <div className="rpt-visual-panel-hd">
              Top {explicit.rows.length} by {explicit.name}
            </div>
            <div className="rpt-visual-chart">
              <ResponsiveContainer>
                <BarChart data={explicit.rows} margin={{ top: 18, right: 12, bottom: 76, left: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="shortLabel" tick={{ fontSize: 10, fill: "#475569" }}
                    angle={-40} textAnchor="end" height={84} interval={0}
                    stroke="#e2e8f0" tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} width={52}
                    axisLine={false} tickLine={false} />
                  <Tooltip
                    labelFormatter={(_, p) => p?.[0]?.payload?.label || ""}
                    formatter={(v) => [Number(v).toLocaleString(), explicit.name]}
                    cursor={{ fill: "#f8fafc" }}
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }} />
                  <Bar dataKey="value" radius={[5, 5, 0, 0]} maxBarSize={52}>
                    {explicit.rows.map((r, i) => <Cell key={r.label} fill={COLORS[i % COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : barRows.length > 0 && (
          <div className="rpt-visual-panel">
            <div className="rpt-visual-panel-hd">
              {isSeries ? `${valueCols[0].label} by ${labelCol.label}`
                        : `Top ${barRows.length} by ${valueCols[0].label}`}
              {valueCols[1] && <span className="rpt-visual-panel-sub"> · vs {valueCols[1].label}</span>}
            </div>
            <div className="rpt-visual-chart">
              <ResponsiveContainer>
                <BarChart data={barRows} margin={{ top: 18, right: 12, bottom: 76, left: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="shortLabel" tick={{ fontSize: 10, fill: "#475569" }}
                    angle={-40} textAnchor="end" height={84} interval={0}
                    stroke="#e2e8f0" tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} width={52}
                    axisLine={false} tickLine={false} />
                  <Tooltip
                    labelFormatter={(_, p) => p?.[0]?.payload?.label || ""}
                    formatter={(v, n) => {
                      const c = valueCols.find((x) => key(x) === n);
                      return [fmtValue(v, c || {}), c ? c.label : n];
                    }}
                    cursor={{ fill: "#f8fafc" }}
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }} />
                  {valueCols[1] && <Legend wrapperStyle={{ fontSize: 11 }} formatter={(n) => {
                    const c = valueCols.find((x) => key(x) === n);
                    return c ? c.label : n;
                  }} />}
                  {/* Second series first so the primary draws on top of it. */}
                  {valueCols[1] && (
                    <Bar dataKey={key(valueCols[1])} fill="#cbd5e1" radius={[5, 5, 0, 0]} maxBarSize={52} />
                  )}
                  <Bar dataKey={key(valueCols[0])} fill={COLORS[0]} radius={[5, 5, 0, 0]} maxBarSize={52} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {statusRows.length > 0 && (
          <div className="rpt-visual-panel">
            <div className="rpt-visual-panel-hd">
              {statusCol.label} breakdown
              <span className="rpt-visual-panel-sub"> · {data.length.toLocaleString()} rows</span>
            </div>
            <div className="rpt-visual-chart">
              <ResponsiveContainer>
                <BarChart data={statusRows} layout="vertical"
                  margin={{ top: 8, right: 48, bottom: 8, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                  <XAxis type="number" allowDecimals={false}
                    tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="shortLabel" width={150}
                    tick={{ fontSize: 10, fill: "#475569" }} axisLine={false} tickLine={false} />
                  <Tooltip
                    labelFormatter={(_, p) => p?.[0]?.payload?.label || ""}
                    formatter={(v) => [Number(v).toLocaleString(), "Rows"]}
                    cursor={{ fill: "#f8fafc" }}
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }} />
                  <Bar dataKey="count" radius={[0, 5, 5, 0]} maxBarSize={20}>
                    {statusRows.map((r) => (
                      <Cell key={r.label} fill={STATUS_COLOR(r.label)} />
                    ))}
                    <LabelList dataKey="count" position="right"
                      style={{ fontSize: 10, fill: "#64748b" }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {pctRows.length > 0 && (
          <div className="rpt-visual-panel">
            <div className="rpt-visual-panel-hd">
              Top {pctRows.length} by {pctCol.label}
              <span className="rpt-visual-panel-sub">
                {" "}· overall {Number(totals[key(pctCol)]).toFixed(1)}%
              </span>
            </div>
            <div className="rpt-visual-chart">
              <ResponsiveContainer>
                <BarChart data={pctRows} layout="vertical"
                  margin={{ top: 8, right: 44, bottom: 8, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                  <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10, fill: "#94a3b8" }}
                    axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="shortLabel" width={150}
                    tick={{ fontSize: 10, fill: "#475569" }} axisLine={false} tickLine={false} />
                  <Tooltip
                    labelFormatter={(_, p) => p?.[0]?.payload?.label || ""}
                    formatter={(v) => [`${Number(v).toFixed(1)}%`, pctCol.label]}
                    cursor={{ fill: "#f8fafc" }}
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }} />
                  <Bar dataKey="pct" radius={[0, 5, 5, 0]} maxBarSize={18}>
                    {pctRows.map((r) => (
                      <Cell key={r.label}
                        fill={r.pct >= 95 ? "#16a34a" : r.pct >= 80 ? "#1565C0"
                              : r.pct >= 40 ? "#b45309" : "#be123c"} />
                    ))}
                    <LabelList dataKey="pct" position="right"
                      formatter={(v) => `${Number(v).toFixed(0)}%`}
                      style={{ fontSize: 10, fill: "#64748b" }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      <div className="rpt-visual-note">
        Charts show the top {TOP_N} rows of {data.length.toLocaleString()}. Switch to
        Table for the full list.
      </div>
    </div>
  );
}
