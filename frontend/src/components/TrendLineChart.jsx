import { useId, useMemo } from "react";
import { money } from "../utils/numberFormat";
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";

/**
 * Monthly trend line chart — shared by the Commercial dashboard's
 * "PO Published vs Invoiced" and "Monthly Invoicing" charts.
 *
 * Deliberate choices:
 *  - `type="linear"`. A monotone/smoothed curve on a monthly money series
 *    invents values between months that were never invoiced.
 *  - ONE y-axis. Both series are SAR, so they share a scale; a second axis
 *    would let two unrelated scales fake a correlation.
 *  - Labels are placed on the endpoint + the max + the min only, never on
 *    every point — a number beside every dot goes unread. The crosshair
 *    tooltip carries the rest.
 *  - Label text uses ink colors, not the series color; the colored dot beside
 *    it carries identity.
 *
 * Props:
 *   data       — [{ label, <key>: number }] — must be DENSE. A month missing
 *                from the array is drawn straight across by recharts, which
 *                silently hides the gap; the backend emits explicit zeros.
 *   series     — [{ key, name, color, dashed?, showLabels? }]
 *   height     — px
 *   showYAxis  — hide when direct labels carry the scale
 *   showLegend — omitted automatically for a single series (title names it)
 */

const fmtInt = new Intl.NumberFormat("en-US");

const INK = "#334155";      // label text
const INK_MUTED = "#94a3b8"; // axis text
const GRID = "#eef2f6";

/** 830430 -> "830K" */
export function compactSar(v) {
  const n = Number(v) || 0;
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${Math.round(n / 1000)}K`;
  return String(Math.round(n));
}

/**
 * Indices worth a direct label: last point with a value, plus the max and the
 * min among non-zero points. Returns a Set so the dot renderer can check O(1).
 */
function labelIndices(data, key) {
  const withValue = data
    .map((d, i) => ({ i, v: Number(d[key]) || 0 }))
    .filter((d) => d.v > 0);
  if (!withValue.length) return new Set();
  let max = withValue[0], min = withValue[0];
  for (const d of withValue) {
    if (d.v > max.v) max = d;
    if (d.v < min.v) min = d;
  }
  return new Set([withValue[withValue.length - 1].i, max.i, min.i]);
}

function CrosshairTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "#fff", border: "1px solid #e2e8f0", borderRadius: 6,
      padding: "6px 9px", fontSize: 11, boxShadow: "0 4px 12px rgba(15,23,42,0.08)",
    }}>
      <div style={{ fontWeight: 700, color: INK, marginBottom: 3 }}>{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color, flex: "0 0 auto" }} />
          <span style={{ color: "#64748b" }}>{p.name}</span>
          <strong style={{ color: INK, marginLeft: "auto" }}>SAR {money.format(p.value || 0)}</strong>
        </div>
      ))}
    </div>
  );
}

export default function TrendLineChart({
  data = [],
  series = [],
  height = 300,
  showYAxis = true,
  showLegend,
  /** number, or "auto" to rotate only when the labels would collide */
  xAngle = "auto",
  /** low-opacity gradient under each line — reads better on a tall panel */
  area = false,
}) {
  // Gradient ids must be unique per chart INSTANCE. Two charts on one page can
  // share a series key ("invoiced"), and SVG url(#id) resolves to the first
  // match in the document — without this, the second chart silently paints
  // itself with the first chart's gradient colour.
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const gradId = (key) => `grad-${uid}-${key}`;
  // A single series needs no legend box — the panel title already names it.
  const legend = showLegend ?? series.length > 1;

  const labelSets = useMemo(
    () => series.map((s) => (s.showLabels ? labelIndices(data, s.key) : null)),
    [data, series],
  );

  if (!data.length || !series.length) {
    return (
      <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: INK_MUTED, fontSize: 12 }}>
        No data for this range.
      </div>
    );
  }

  // Month labels are ~6 chars; past ~14 of them across a panel they touch.
  const angle = xAngle === "auto" ? (data.length > 14 ? -45 : 0) : xAngle;
  const rotated = angle !== 0;

  return (
    <div style={{ height }}>
      <ResponsiveContainer>
        <ComposedChart
          data={data}
          margin={{ top: 22, right: 16, left: showYAxis ? 4 : 8, bottom: rotated ? 16 : 0 }}
        >
          {area && (
            <defs>
              {series.map((s) => (
                <linearGradient key={s.key} id={gradId(s.key)} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
                </linearGradient>
              ))}
            </defs>
          )}
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: INK_MUTED }}
            angle={angle}
            textAnchor={rotated ? "end" : "middle"}
            height={rotated ? 50 : 24}
            interval="preserveStartEnd"
            minTickGap={4}
            tickMargin={4}
            stroke="#e2e8f0"
          />
          {showYAxis && (
            <YAxis
              tick={{ fontSize: 10, fill: INK_MUTED }}
              width={56}
              tickFormatter={(v) => compactSar(v)}
              stroke="#e2e8f0"
            />
          )}
          <Tooltip
            content={<CrosshairTooltip />}
            cursor={{ stroke: "#cbd5e1", strokeWidth: 1, strokeDasharray: "3 3" }}
          />
          {legend && (
            <Legend
              verticalAlign="top" align="left" height={22} iconType="plainline"
              wrapperStyle={{ fontSize: 11, fontWeight: 600, color: INK }}
            />
          )}
          {area && series.map((s) => (
            <Area
              key={`area-${s.key}`}
              type="linear"
              dataKey={s.key}
              stroke="none"
              fill={`url(#${gradId(s.key)})`}
              isAnimationActive={false}
              legendType="none"
              tooltipType="none"
              activeDot={false}
            />
          ))}
          {series.map((s, si) => (
            <Line
              key={s.key}
              type="linear"
              dataKey={s.key}
              name={s.name}
              stroke={s.color}
              strokeWidth={2}
              strokeDasharray={s.dashed ? "6 4" : undefined}
              dot={{ r: 2.5, fill: s.color, strokeWidth: 0 }}
              activeDot={{ r: 5, fill: s.color, stroke: "#fff", strokeWidth: 2 }}
              isAnimationActive={false}
              label={
                labelSets[si]
                  ? (props) => {
                      const { x, y, index, value } = props;
                      if (!labelSets[si].has(index) || !value) return null;
                      return (
                        <text
                          x={x} y={y - 9} textAnchor="middle"
                          fontSize={10} fontWeight={700} fill={INK}
                        >
                          {compactSar(value)}
                        </text>
                      );
                    }
                  : undefined
              }
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
