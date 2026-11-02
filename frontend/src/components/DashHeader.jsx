/**
 * The dashboard page header, laid out like the Command Dashboard's (which is
 * client-approved): the title centred with a live "Last updated" line under
 * it, the filters on the right. Executive, Projects & Operations and IM View
 * use it so the dashboards switched between read as one set.
 *
 * `hint` is the page's one-line description — shown on hover over the title
 * rather than as a second line, as Command has none.
 */

function fmtTimestamp(ts) {
  if (!ts) return "";
  const d = new Date(String(ts).replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return String(ts);
  return `${d.getDate()} ${d.toLocaleString("en-US", { month: "short" })} ${d.getFullYear()} · ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function DashHeader({ title, hint, lastUpdated, left, children }) {
  return (
    <div className="dash-header" style={{ display: "flex", alignItems: "center", padding: "12px 20px", gap: 12 }}>
      {/* `left` fills the empty side, e.g. IM View's IM picker. */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>{left}</div>
      <div style={{ textAlign: "center", minWidth: 0 }}>
        <h1 title={hint} style={{ margin: 0, fontSize: "1.1rem", fontWeight: 800, letterSpacing: "-0.2px" }}>
          {title}
        </h1>
        <div className="subtitle" style={{ justifyContent: "center", marginTop: 3 }}>
          <span className="live-dot" />
          <span className="dash-timestamp">Last updated: {lastUpdated ? fmtTimestamp(lastUpdated) : "—"}</span>
        </div>
      </div>
      <div style={{ flex: 1, display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {children}
      </div>
    </div>
  );
}
