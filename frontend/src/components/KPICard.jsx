/**
 * KPICard — reusable metric card for the Command Dashboard.
 *
 * Props:
 *   label      (string)            — uppercase label above the number
 *   value      (number|string)     — the metric value
 *   sub        (string, optional)  — smaller line below the value (e.g. SAR amount)
 *   colorClass (string, optional)  — e.g. "text-green", "text-red", "text-amber"
 */

import { count as fmt, money } from "../utils/numberFormat";

function formatValue(v) {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number") {
    if (v < 0) return `(${fmt.format(Math.abs(v))})`;
    // Always through the formatter: the old `String(v)` shortcut for values
    // under 1000 printed a raw float ("414.9") beside larger figures that had
    // been formatted, so two cards in a row disagreed on their own format.
    return fmt.format(v);
  }
  return String(v);
}

function formatSar(v) {
  if (v === null || v === undefined || v === "") return "";
  return `SAR ${money.format(Number(v))}`;
}

export default function KPICard({ label, value, sub, colorClass = "", onClick }) {
  return (
    <div
      className="kpi-card"
      onClick={onClick}
      style={onClick ? { cursor: "pointer" } : undefined}
      title={onClick ? `Go to ${label}` : undefined}
    >
      <div className="kpi-label">{label}{onClick && <span style={{ marginLeft: 5, fontSize: "0.6rem", opacity: 0.5 }}>↗</span>}</div>
      <div className={`kpi-value ${colorClass}`.trim()}>{formatValue(value)}</div>
      {sub ? <div style={{ fontSize: "0.82rem", fontWeight: 600, color: "#475569", marginTop: 4 }}>{sub}</div> : null}
    </div>
  );
}
