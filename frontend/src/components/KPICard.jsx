/**
 * KPICard — reusable metric card for the Command Dashboard.
 *
 * Props:
 *   label      (string)            — uppercase label above the number
 *   value      (number|string)     — the metric value
 *   colorClass (string, optional)  — e.g. "text-green", "text-red", "text-amber"
 */

const fmt = new Intl.NumberFormat("en-US");

function formatValue(v) {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number") {
    if (v < 0) return `(${fmt.format(Math.abs(v))})`;
    return Math.abs(v) > 999 ? fmt.format(v) : String(v);
  }
  return String(v);
}

export default function KPICard({ label, value, colorClass = "" }) {
  return (
    <div className="kpi-card">
      <div className="kpi-label">{label}</div>
      <div className={`kpi-value ${colorClass}`.trim()}>{formatValue(value)}</div>
    </div>
  );
}
