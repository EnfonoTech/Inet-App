import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { pmApi } from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import DateRangePicker, { DATE_PRESETS } from "../../components/DateRangePicker";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

function defaultRange() {
  const r = DATE_PRESETS.this_month.range(new Date());
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { from: iso(r.from), to: iso(r.to) };
}

function relTime(ts) {
  if (!ts) return "—";
  try {
    const d = ts instanceof Date ? ts : new Date(String(ts).replace(" ", "T"));
    if (Number.isNaN(d.getTime())) return "—";
    const now = new Date();
    const diffMin = Math.round((now - d) / 60000);
    if (Math.abs(diffMin) < 1) return "just now";
    if (diffMin < 0) return "just now"; // clock skew → never show "in the future"
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffMin < 60 * 24) return `${Math.round(diffMin / 60)}h ago`;
    if (diffMin < 60 * 24 * 2) return "yesterday";
    return d.toISOString().slice(0, 10);
  } catch {
    return "—";
  }
}

function statusTone(s) {
  const v = String(s || "").toLowerCase();
  if (v === "completed") return { fg: "#047857", bg: "#ecfdf5", dot: "#10b981" };
  if (v.includes("issue") || v === "delayed" || v === "cancelled") return { fg: "#b91c1c", bg: "#fef2f2", dot: "#ef4444" };
  if (v.includes("execution") || v.includes("progress")) return { fg: "#1d4ed8", bg: "#eff6ff", dot: "#3b82f6" };
  if (v === "planned") return { fg: "#a16207", bg: "#fefce8", dot: "#eab308" };
  return { fg: "#475569", bg: "#f1f5f9", dot: "#64748b" };
}

function StatusBadge({ value }) {
  if (!value) return <span style={{ color: "#94a3b8" }}>—</span>;
  const t = statusTone(value);
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "2px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700,
      textTransform: "uppercase", letterSpacing: "0.03em",
      background: t.bg, color: t.fg,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: 999, background: t.dot }} />
      {value}
    </span>
  );
}

function KpiTile({ icon, label, value, tone = "blue", suffix }) {
  const palettes = {
    blue: { fg: "#1d4ed8", bg: "#eff6ff" },
    green: { fg: "#047857", bg: "#ecfdf5" },
    amber: { fg: "#b45309", bg: "#fffbeb" },
    red: { fg: "#b91c1c", bg: "#fef2f2" },
    indigo: { fg: "#3730a3", bg: "#eef2ff" },
    slate: { fg: "#334155", bg: "#f1f5f9" },
  };
  const p = palettes[tone] || palettes.blue;
  return (
    <div style={{
      background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10,
      padding: "12px 14px", display: "flex", flexDirection: "column", gap: 4,
      boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.7rem", color: "#64748b", fontWeight: 600 }}>
        <span style={{ color: p.fg }}>{icon}</span>
        <span style={{ textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</span>
      </div>
      <div style={{ fontSize: "1.4rem", fontWeight: 800, color: "#0f172a", lineHeight: 1.1, fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>
        {fmt.format(value || 0)}
        {suffix && <span style={{ fontSize: "0.7rem", fontWeight: 600, color: "#64748b", marginLeft: 6 }}>{suffix}</span>}
      </div>
    </div>
  );
}

function Section({ title, icon, action, children, style }) {
  return (
    <div style={{
      background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10,
      boxShadow: "0 1px 2px rgba(15,23,42,0.04)", overflow: "hidden",
      display: "flex", flexDirection: "column", ...style,
    }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 14px", borderBottom: "1px solid #f1f5f9",
        background: "linear-gradient(180deg,#fafbfd,#fff)",
      }}>
        <h3 style={{ margin: 0, fontSize: "0.82rem", fontWeight: 700, color: "#0f172a", display: "flex", alignItems: "center", gap: 8 }}>
          {icon && <span aria-hidden style={{ fontSize: "1rem" }}>{icon}</span>}
          {title}
        </h3>
        {action}
      </div>
      <div style={{ padding: 14, flex: 1, minHeight: 0 }}>{children}</div>
    </div>
  );
}

// Status-tinted CSS divIcon — avoids Leaflet's default 404'd marker images.
const SITE_PIN_COLORS = {
  completed: "#10b981",
  "in execution": "#3b82f6",
  "in progress": "#3b82f6",
  "planning with issue": "#ef4444",
  cancelled: "#ef4444",
  hold: "#f59e0b",
  postponed: "#eab308",
  planned: "#a16207",
};
function sitePinIcon(status) {
  const color = SITE_PIN_COLORS[String(status || "").toLowerCase()] || "#3b82f6";
  return L.divIcon({
    className: "im-site-pin",
    html: `<div style="width:18px;height:18px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 2px 6px rgba(15,23,42,0.35);"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -9],
  });
}

function FitBounds({ points }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    if (points.length === 1) {
      map.setView([points[0].lat, points[0].lon], 11, { animate: false });
      return;
    }
    const b = L.latLngBounds(points.map((p) => [p.lat, p.lon]));
    map.fitBounds(b, { padding: [24, 24], maxZoom: 13 });
  }, [points, map]);
  return null;
}

function ProgressBar({ pct, color = "#10b981" }) {
  const v = Math.max(0, Math.min(100, Math.round(pct || 0)));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ flex: 1, height: 14, borderRadius: 999, background: "#f1f5f9", overflow: "hidden" }}>
        <div style={{ width: `${v}%`, height: "100%", background: color, transition: "width 0.6s ease", borderRadius: 999 }} />
      </div>
      <span style={{ width: 44, textAlign: "right", fontWeight: 700, fontSize: "0.78rem", fontFamily: "ui-monospace, SFMono-Regular, monospace", color: "#1e293b" }}>{v}%</span>
    </div>
  );
}

export default function IMDashboard() {
  const { imName } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [range, setRange] = useState(defaultRange);
  const [fetchedAt, setFetchedAt] = useState(null);

  async function loadData(r = range) {
    setError(null);
    setLoading(true);
    try {
      const result = await pmApi.getIMDashboard(imName, { from_date: r.from, to_date: r.to });
      setData(result);
      // Server returns last_updated as a naive string in server-local time
      // (typically UTC), which the browser then misreads as the user's local
      // time and ends up off by the timezone offset (the "Updated 3h ago"
      // bug). The client's own clock is the truthful "freshness" anchor.
      setFetchedAt(new Date());
    } catch (err) {
      setError(err.message || "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }

  // Initial + filter changes
  useEffect(() => {
    loadData(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imName, range.from, range.to]);

  // Dashboards refresh every 5 minutes so KPIs stay current without manual
  // clicks. List pages stay manual.
  useEffect(() => {
    const t = setInterval(() => loadData(range), 5 * 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to, imName]);

  const k = data?.site_kpi || {};
  const team_perf = Array.isArray(data?.team_perf) ? data.team_perf : [];
  const projects = Array.isArray(data?.project_progress) ? data.project_progress : [];
  const sites = Array.isArray(data?.site_status) ? data.site_status : [];
  const timeline = Array.isArray(data?.timeline) ? data.timeline : [];
  const action = data?.action_items || {};
  const site_locations = Array.isArray(data?.site_locations) ? data.site_locations : [];
  const material_shortage = Number(data?.material_shortage || 0);

  const myPerformancePct = useMemo(() => {
    const t = k.total_assigned || 0;
    if (!t) return 0;
    return Math.round(((k.completed_total || 0) / t) * 100);
  }, [k.total_assigned, k.completed_total]);

  return (
    <div className="dashboard" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      {/* ── Header ──────────────────────────────────────────── */}
      <div style={{
        background: "linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)",
        color: "#fff", borderRadius: 10, padding: "14px 18px",
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap",
      }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700, letterSpacing: "0.01em" }}>
            IM Dashboard <span style={{ opacity: 0.75, fontWeight: 500 }}>– INet Telecom</span>
          </h1>
          <div style={{ marginTop: 2, fontSize: "0.78rem", opacity: 0.85 }}>
            {data?.im || imName || "Installation Manager"}
            {fetchedAt && <> · Updated {relTime(fetchedAt)}</>}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <DateRangePicker value={range} onChange={(r) => setRange({ from: r.from, to: r.to })} />
          <button
            type="button"
            onClick={() => loadData(range)}
            disabled={loading}
            title="Refresh dashboard"
            style={{
              border: "1px solid rgba(255,255,255,0.4)",
              background: "rgba(255,255,255,0.12)",
              color: "#fff",
              padding: "6px 12px",
              borderRadius: 8,
              fontSize: "0.78rem",
              fontWeight: 600,
              cursor: loading ? "default" : "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              opacity: loading ? 0.6 : 1,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ animation: loading ? "im-dash-spin 0.8s linear infinite" : "none" }}>
              <path d="M21 12a9 9 0 1 1-3-6.7" />
              <polyline points="21 4 21 10 15 10" />
            </svg>
            {loading ? "…" : "Refresh"}
          </button>
          <style>{`@keyframes im-dash-spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      </div>

      {error && (
        <div className="notice error" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span>⚠</span> {error}
          <button type="button" className="btn-secondary" style={{ marginLeft: 10 }} onClick={() => { setLoading(true); loadData(); }}>Retry</button>
        </div>
      )}
      {loading && !data && (
        <div style={{ padding: 32, textAlign: "center", color: "#94a3b8" }}>Loading dashboard…</div>
      )}

      {/* ── KPI tiles ───────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10 }}>
        <KpiTile icon="📋" label="Total Assigned Sites" value={k.total_assigned} tone="slate" />
        <KpiTile icon="✓"  label="Completed Sites"     value={k.completed_total} tone="green" />
        <KpiTile icon="⏱"  label="In Progress"          value={k.in_progress}    tone="blue" />
        <KpiTile icon="⚠"  label="Delayed Sites"        value={k.delayed}        tone="red" />
        <KpiTile icon="◎"  label="Today's Target"       value={k.today_target}   tone="indigo" suffix="Sites" />
        <KpiTile icon="✓"  label="Today Completed"      value={k.today_completed} tone="green" suffix="Sites" />
      </div>

      {/* ── Row 2: Project Progress (2/3) + Team Performance (1/3) ── */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
        <Section title="Project Progress" icon="📊">
          {projects.length === 0 ? (
            <div style={{ color: "#94a3b8", fontSize: "0.85rem" }}>No project data for this window.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {projects.map((p, i) => (
                <div key={p.project_code || i} style={{ display: "grid", gridTemplateColumns: "120px 1fr", alignItems: "center", gap: 12 }}>
                  <div style={{ fontSize: "0.82rem", fontWeight: 600, color: "#1e293b", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={p.project_name || p.project_code}>
                    {p.project_name || p.project_code}
                  </div>
                  <ProgressBar
                    pct={p.pct}
                    color={p.pct >= 70 ? "#10b981" : p.pct >= 40 ? "#f59e0b" : "#3b82f6"}
                  />
                </div>
              ))}
            </div>
          )}
        </Section>
        <Section title="Team Performance" icon="👥">
          {team_perf.length === 0 ? (
            <div style={{ color: "#94a3b8", fontSize: "0.85rem" }}>No team data.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {team_perf.slice(0, 8).map((t, i) => (
                <div key={t.team_id || i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0", borderBottom: i === team_perf.length - 1 ? "none" : "1px solid #f1f5f9" }}>
                  <span style={{ fontSize: "0.82rem", color: "#1e293b" }}>{t.team_name}</span>
                  <span style={{ fontSize: "0.85rem", fontWeight: 700, color: "#0f172a" }}>{fmt.format(t.sites_done)} <span style={{ color: "#94a3b8", fontWeight: 500, fontSize: "0.72rem" }}>Sites</span></span>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>

      {/* ── Row 3: Site Status (2/3) + Issues & Escalations (1/3) ── */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
        <Section title="Site Status" icon="📌" action={<Link to="/im-execution" style={{ fontSize: "0.72rem", color: "#1d4ed8", fontWeight: 600 }}>View all →</Link>}>
          {sites.length === 0 ? (
            <div style={{ color: "#94a3b8", fontSize: "0.85rem" }}>No sites yet.</div>
          ) : (
            <table className="data-table" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Site ID</th>
                  <th style={{ textAlign: "left" }}>Location</th>
                  <th style={{ textAlign: "left" }}>Project</th>
                  <th style={{ textAlign: "left" }}>Status</th>
                  <th style={{ textAlign: "left" }}>Last Update</th>
                  <th style={{ textAlign: "left" }}>Issue</th>
                </tr>
              </thead>
              <tbody>
                {sites.map((s) => (
                  <tr key={s.site_id}>
                    <td style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: "0.78rem" }}>{s.site_id}</td>
                    <td style={{ fontSize: "0.82rem" }}>{s.location || "—"}</td>
                    <td style={{ fontSize: "0.82rem" }}>{s.project || "—"}</td>
                    <td><StatusBadge value={s.status} /></td>
                    <td style={{ fontSize: "0.78rem", color: "#64748b" }}>{relTime(s.last_update)}</td>
                    <td style={{ fontSize: "0.78rem", color: s.issue ? "#b91c1c" : "#94a3b8" }}>{s.issue || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
        <Section title="Issues & Escalations" icon="❗">
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8, color: "#b91c1c", fontSize: "0.85rem", fontWeight: 600 }}>
                <span style={{ width: 10, height: 10, borderRadius: 999, background: "#ef4444" }} /> Critical Issues
              </span>
              <span style={{ fontSize: "1.05rem", fontWeight: 800, color: "#0f172a" }}>{fmt.format(k.delayed || 0)}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8, color: "#b45309", fontSize: "0.85rem", fontWeight: 600 }}>
                <span style={{ width: 10, height: 10, borderRadius: 999, background: "#f59e0b" }} /> Pending Approvals
              </span>
              <span style={{ fontSize: "1.05rem", fontWeight: 800, color: "#0f172a" }}>{fmt.format(action.qc_fail_needs_action || 0)}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8, color: "#047857", fontSize: "0.85rem", fontWeight: 600 }}>
                <span style={{ width: 10, height: 10, borderRadius: 999, background: "#10b981" }} /> Material Shortage
              </span>
              <span style={{ fontSize: "1.05rem", fontWeight: 800, color: "#0f172a" }}>{fmt.format(material_shortage)}</span>
            </div>
          </div>
        </Section>
      </div>

      {/* ── Row 4: Activity Timeline (1/3) + placeholder map (1/3) + My Performance (1/3) ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <Section title="Activity Timeline" icon="🕒">
          {timeline.length === 0 ? (
            <div style={{ color: "#94a3b8", fontSize: "0.85rem" }}>No recent activity.</div>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              {timeline.map((e, i) => (
                <li key={e.exec_id || i} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: "#3b82f6", marginTop: 6, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "0.7rem", color: "#94a3b8", fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>{relTime(e.ts)}</div>
                    <div style={{ fontSize: "0.82rem", color: "#1e293b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={e.label}>{e.label}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Site Map" icon="🗺">
          {site_locations.length === 0 ? (
            <div style={{ height: 240, borderRadius: 8, background: "linear-gradient(180deg, #ecfeff 0%, #f0f9ff 100%)", border: "1px dashed #bae6fd", display: "flex", alignItems: "center", justifyContent: "center", color: "#0369a1", fontSize: "0.82rem", padding: 12, textAlign: "center" }}>
              <div>
                <div style={{ fontSize: "1.6rem" }}>📍</div>
                <div style={{ marginTop: 6, fontWeight: 600 }}>No coordinates yet</div>
                <div style={{ marginTop: 4, fontSize: "0.72rem", color: "#0284c7" }}>Add latitude/longitude on DUID Master to plot sites here.</div>
              </div>
            </div>
          ) : (
            <div style={{ height: 240, borderRadius: 8, overflow: "hidden", border: "1px solid #e2e8f0" }}>
              <MapContainer center={[24.7136, 46.6753]} zoom={6} style={{ height: "100%", width: "100%" }} scrollWheelZoom={false}>
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <FitBounds points={site_locations} />
                {site_locations.map((p) => (
                  <Marker key={`${p.site_code}`} position={[p.lat, p.lon]} icon={sitePinIcon(p.status)}>
                    <Popup>
                      <div style={{ fontSize: "0.78rem", lineHeight: 1.45 }}>
                        <div style={{ fontWeight: 700, color: "#0f172a" }}>{p.site_name}</div>
                        {p.site_code && p.site_code !== p.site_name && <div style={{ fontFamily: "ui-monospace, monospace", color: "#64748b" }}>{p.site_code}</div>}
                        {p.project_code && <div>Project: <span style={{ fontFamily: "ui-monospace, monospace" }}>{p.project_code}</span></div>}
                        <div style={{ marginTop: 4 }}><StatusBadge value={p.status} /></div>
                        {p.last_update && <div style={{ color: "#64748b", fontSize: "0.72rem", marginTop: 4 }}>Updated {relTime(p.last_update)}</div>}
                      </div>
                    </Popup>
                  </Marker>
                ))}
              </MapContainer>
            </div>
          )}
        </Section>
        <Section title="My Performance" icon="📈">
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #f1f5f9", paddingBottom: 8 }}>
              <span style={{ fontSize: "0.82rem", color: "#475569" }}>Monthly Target</span>
              <span style={{ fontWeight: 700, color: "#0f172a" }}>{fmt.format(k.total_assigned || 0)} <span style={{ color: "#94a3b8", fontSize: "0.72rem", fontWeight: 500 }}>Sites</span></span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #f1f5f9", paddingBottom: 8 }}>
              <span style={{ fontSize: "0.82rem", color: "#475569" }}>Achieved</span>
              <span style={{ fontWeight: 700, color: "#0f172a" }}>{fmt.format(k.completed_total || 0)} <span style={{ color: "#94a3b8", fontSize: "0.72rem", fontWeight: 500 }}>Sites</span></span>
            </div>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontSize: "0.82rem", color: "#475569" }}>Performance</span>
                <span style={{ fontWeight: 800, color: "#047857", fontSize: "1.1rem" }}>{myPerformancePct}%</span>
              </div>
              <ProgressBar pct={myPerformancePct} color="#10b981" />
            </div>
            <div style={{ display: "flex", gap: 14, fontSize: "0.72rem", color: "#475569" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: 999, background: "#10b981" }} /> Completed</span>
              <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: 999, background: "#3b82f6" }} /> In Progress</span>
              <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: 999, background: "#ef4444" }} /> Delayed</span>
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}
