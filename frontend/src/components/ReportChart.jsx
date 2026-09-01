import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const DEFAULT_COLORS = ["#1565C0", "#0d9488", "#c2410c", "#7c3aed", "#b45309", "#0891b2", "#be123c", "#16a34a", "#4f46e5", "#059669", "#db2777", "#0284c7"];

function truncate(s, n) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/**
 * Generic vertical bar-chart renderer for the {columns,data,chart} report
 * contract — consumes the same frappe-charts shape ({labels[],
 * datasets:[{name,values}]}) Desk already renders natively, so a Script
 * Report's chart works unmodified on both Desk and the portal.
 */
export default function ReportChart({ chart }) {
  const labels = chart?.data?.labels || [];
  const values = chart?.data?.datasets?.[0]?.values || [];
  const valueLabel = chart?.data?.datasets?.[0]?.name || "Value";
  const colors = chart?.colors?.length && chart.colors.length > 1 ? chart.colors : DEFAULT_COLORS;
  if (!labels.length) return null;

  const rows = labels.map((label, i) => ({ label, shortLabel: truncate(label, 26), value: Number(values[i]) || 0 }));
  const maxValue = Math.max(...rows.map((r) => r.value), 0);

  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "18px 22px 8px", marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b", marginBottom: 2 }}>
        Top {rows.length} by {valueLabel}
      </div>
      <div style={{ fontSize: 11.5, color: "#94a3b8", marginBottom: 12 }}>
        Full table below shows every row — this chart is the top slice only.
      </div>
      <div style={{ height: 360 }}>
        <ResponsiveContainer>
          <BarChart data={rows} margin={{ top: 20, right: 12, bottom: 84, left: 4 }} barCategoryGap="28%">
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis
              dataKey="shortLabel"
              tick={{ fontSize: 10.5, fill: "#475569" }}
              angle={-40}
              textAnchor="end"
              height={90}
              interval={0}
              stroke="#e2e8f0"
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "#94a3b8" }}
              width={44}
              axisLine={false}
              tickLine={false}
              domain={[0, Math.ceil(maxValue * 1.15) || "auto"]}
            />
            <Tooltip
              labelFormatter={(_, payload) => payload?.[0]?.payload?.label || ""}
              formatter={(v) => [Number(v).toLocaleString(), valueLabel]}
              cursor={{ fill: "#f8fafc" }}
              contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
            />
            <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={56}>
              <LabelList dataKey="value" position="top" style={{ fontSize: 10.5, fill: "#334155", fontWeight: 600 }} formatter={(v) => Number(v).toLocaleString()} />
              {rows.map((_, i) => (
                <Cell key={i} fill={colors[i % colors.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
