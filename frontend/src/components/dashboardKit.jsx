// Shared visual vocabulary for the rollout dashboards (Weekly Plan, Weekly
// Forecast, Execution Analytics).
//
// Lifted verbatim from RolloutWeeklyPlan.jsx so the pages read as one system
// rather than three that merely looked alike on the day they shipped. That
// file keeps its own copies for now — extracting them from a working page is
// a separate, riskier change — so treat THIS as the source of truth for
// anything new.
//
// No chart library: every shape here is a conic-gradient or a div width,
// which costs nothing on a lazy-loaded route and matches the sibling page.

export const money = (v) =>
  new Intl.NumberFormat("en", { maximumFractionDigits: 0 }).format(Number(v) || 0);

export const pct = (n, d) => (d ? Math.round(((Number(n) || 0) * 100) / d) : 0);

export const C = {
  purple: "#6D5AE6", teal: "#12A79A", green: "#1DAA5C", amber: "#E8992A",
  blue: "#2F7BE0", red: "#E4534A", gray: "#9AA1B4",
  blueText: "#1D5AAE", amberText: "#A5680E", greenText: "#177A44",
  redText: "#B23A32", purpleText: "#4B3FB0", tealText: "#0C7B71",
  border: "#E4E6EF", muted: "#6B7280",
};

export const DONUT_COLORS = [C.amber, C.blue, C.teal, C.purple, C.gray];

export function Card({ title, right, children, style, headerStyle }) {
  return (
    <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: 10, ...style }}>
      {(title || right) && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 8, ...headerStyle }}>
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

/** conic-gradient donut driven by [{label, value, color}] — no chart library. */
export function Donut({ slices, total, size = 76 }) {
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

export function Gauge({ value, caption, sub, color }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: "12px 14px", flex: "1 1 240px", minWidth: 220 }}>
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

/** Horizontal bar meter — the team-workload shape, reused for any ranking. */
export function Bar({ value, total, color = C.blue, height = 6 }) {
  const w = total ? Math.max(2, Math.round((value * 100) / total)) : 0;
  return (
    <div style={{ background: "#EDEEF4", borderRadius: 4, height, overflow: "hidden" }}>
      <div style={{ width: `${w}%`, height: "100%", background: color, borderRadius: 4 }} />
    </div>
  );
}

export function Empty({ text = "Nothing to show." }) {
  return <div style={{ padding: "18px 0", textAlign: "center", color: C.muted, fontSize: 12 }}>{text}</div>;
}

export const navBtn = { border: `1px solid ${C.border}`, background: "#fff", borderRadius: 6, width: 20, height: 20, fontSize: 11, cursor: "pointer", lineHeight: 1 };
export const tile = { background: "#FAFAFD", border: `1px solid ${C.border}`, borderRadius: 8, padding: "9px 10px" };
export const tileN = { fontSize: 19, fontWeight: 700, fontVariantNumeric: "tabular-nums" };
export const tileL = { fontSize: 10.5, color: C.muted, marginTop: 1 };
export const moneyN = { ...tileN, fontSize: 15.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
export const gh = { padding: "8px 7px", fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: ".03em", borderBottom: `1px solid ${C.border}`, background: "#FAFAFD", whiteSpace: "nowrap" };
export const ghDay = { padding: "8px 4px", fontSize: 9.5, fontWeight: 700, color: C.muted, textTransform: "uppercase", borderBottom: `1px solid ${C.border}`, background: "#FAFAFD", whiteSpace: "nowrap", textAlign: "center", overflow: "hidden" };
export const gc = { padding: "9px 7px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
export const grip = { position: "absolute", top: 0, right: -3, width: 7, height: "100%", cursor: "col-resize", userSelect: "none", zIndex: 2 };
export const resetBtn = { border: `1px solid ${C.border}`, background: "#fff", borderRadius: 6, padding: "3px 8px", fontSize: 10.5, color: C.muted, cursor: "pointer" };
export const pth = { padding: "6px 3px", textAlign: "left", fontSize: 10, textTransform: "uppercase", color: C.muted, borderBottom: `1px solid ${C.border}` };
export const pthR = { ...pth, textAlign: "right" };
export const ptd = { padding: "5px 3px", borderBottom: "1px solid #F1F5F9", whiteSpace: "nowrap" };
export const ptdR = { ...ptd, textAlign: "right", fontVariantNumeric: "tabular-nums" };
export const bstat = { background: "#fff", border: `1px solid ${C.border}`, borderRadius: 12, padding: "12px 14px", flex: "1 1 150px", minWidth: 145 };
export const bstatL = { fontSize: 11, color: C.muted, fontWeight: 600 };
export const bstatN = { fontSize: 26, fontWeight: 800, letterSpacing: "-0.5px", lineHeight: 1.15, marginTop: 2 };
export const bstatS = { fontSize: 11, color: C.muted, marginTop: 1 };
