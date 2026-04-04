/**
 * BarChart and DonutChart — pure CSS/SVG chart components for the Command Dashboard.
 * No external chart library required.
 */

/* ── BarChart ──────────────────────────────────────────────── */

/**
 * Props:
 *   bars — array of { label, value, color }
 *          color: "green" | "amber" | "red" | "" (default blue gradient)
 */
export function BarChart({ bars = [] }) {
  const max = Math.max(...bars.map((b) => b.value), 1);

  return (
    <div className="chart-bars">
      {bars.map((bar, i) => {
        const pct = Math.round((bar.value / max) * 100);
        return (
          <div className="chart-bar" key={i}>
            <span className="chart-bar-label">{bar.label}</span>
            <div className="chart-bar-track">
              <div
                className={`chart-bar-fill ${bar.color || ""}`.trim()}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="chart-bar-value">{bar.value}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ── DonutChart ────────────────────────────────────────────── */

/**
 * Props:
 *   value — 0-100 percentage
 *   label — text below the percentage
 */
export function DonutChart({ value = 0, label = "" }) {
  const clamped = Math.min(100, Math.max(0, value));
  const degrees = (clamped / 100) * 360;

  // Use conic-gradient for the donut ring
  const bg =
    clamped === 0
      ? "rgba(10, 22, 40, 0.5)"
      : `conic-gradient(var(--blue-bright) 0deg, var(--blue) ${degrees}deg, rgba(10, 22, 40, 0.5) ${degrees}deg)`;

  return (
    <div className="donut" style={{ background: bg }}>
      <div className="donut-inner">
        <span className="donut-value">{clamped}%</span>
        <span className="donut-label">{label}</span>
      </div>
    </div>
  );
}
