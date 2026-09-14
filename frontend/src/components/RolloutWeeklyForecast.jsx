import { useEffect, useMemo, useState } from "react";
import { pmApi } from "../services/api";
import { weekRangeLabel } from "../utils/weeks";
import {
  C, DONUT_COLORS, Card, Donut, Gauge, Bar, Empty, money,
  navBtn, tile, tileN, tileL, moneyN, gh, ghDay, gc,
  pth, pthR, ptd, ptdR, bstat, bstatL, bstatN, bstatS,
} from "./dashboardKit";

/**
 * Rollout Planning — MONTHLY forecast, broken down by week.
 *
 * The forecast is a monthly commitment the IM splits across that month's
 * weeks, so the month is the unit of the page and the weeks are how it reads
 * inside. The month strip along the bottom shows the pipeline either side.
 *
 * The whole page is one backend call, so the tiles, the grid, the team rail
 * and the gauges are readings of one set and cannot disagree.
 *
 * Nothing here constrains planning. A slip is reported, never blocked.
 */

const STATES = [
  { key: "not_planned", label: "Not planned", color: C.gray, text: C.muted },
  { key: "planned", label: "Planned", color: C.blue, text: C.blueText },
  { key: "executed", label: "Executed", color: C.green, text: C.greenText },
];
const STATE_BY = Object.fromEntries(STATES.map((s) => [s.key, s]));

const DETAIL_COLS = [
  { key: "poid", label: "POID", w: 124 },
  { key: "project", label: "Project", w: 68 },
  { key: "domain", label: "Domain", w: 74 },
  { key: "team", label: "Fc. team", w: 78 },
];
export default function RolloutWeeklyForecast({ imName, portal, refreshKey }) {
  const [month, setMonth] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // The parent rebuilds `portal` fresh on every render, so its identity is
  // useless as a dep — key off its content instead.
  const portalKey = JSON.stringify(portal || {});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    pmApi
      .getRolloutForecastDashboard({
        im: imName || "",
        month: month || "",
        months_ahead: 6,
        portal_filters: portal || {},
      })
      .then((res) => { if (!cancelled) setData(res || null); })
      .catch((e) => { if (!cancelled) setError(e.message || "Failed to load the forecast"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imName, month, portalKey, refreshKey]);

  const buckets = data?.month?.weeks || [];
  const rows = data?.rows || [];
  const s = data?.summary || {};

  function shiftMonth(dir) {
    // Page from the server's own month, never a locally rebuilt date.
    const base = data?.month?.start || month;
    if (!base) return;
    const [y, m] = base.split("-").map(Number);
    const x = new Date(y, m - 1 + dir, 1);
    setMonth(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}`);
  }

  const activity = (data?.activity || []).slice(0, 5);
  const activityTotal = activity.reduce((a, x) => a + x.count, 0);
  const teams = (data?.teams || []).slice(0, 6);
  const maxTeam = Math.max(1, ...teams.map((t) => t.forecast));
  const maxBucket = Math.max(1, ...buckets.map((b) => b.total));

  const gridCols = `${DETAIL_COLS.map((c) => `${c.w}px`).join(" ")} repeat(${buckets.length || 1}, minmax(48px, 1fr)) 56px`;

  if (error) {
    return <div className="notice error" style={{ marginBottom: 16 }}><span>!</span> {error}</div>;
  }

  return (
    <div style={{ opacity: loading ? 0.6 : 1, transition: "opacity .15s" }}>
      <div style={{ display: "flex", gap: 9, alignItems: "flex-start", flexWrap: "wrap" }}>

        {/* ── Left rail ──────────────────────────────────────────────── */}
        <div style={{ flex: "0 0 186px", display: "flex", flexDirection: "column", gap: 9 }}>
          <Card
            title="Forecast month"
            right={
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <button type="button" style={navBtn} onClick={() => shiftMonth(-1)} aria-label="Previous month">‹</button>
                <button type="button" style={navBtn} onClick={() => shiftMonth(1)} aria-label="Next month">›</button>
              </span>
            }
          >
            <div style={{ fontSize: 15, fontWeight: 800, color: "#1A1F36", marginBottom: 9 }}>
              {data?.month?.label || "—"}
              {data?.month?.is_current && <span style={{ fontSize: 10, color: C.blueText, marginLeft: 6 }}>this month</span>}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
              <div style={tile}><div style={tileN}>{s.total || 0}</div><div style={tileL}>Forecast lines</div></div>
              <div style={tile}><div style={{ ...tileN, color: C.muted }}>{s.not_planned || 0}</div><div style={tileL}>Not planned</div></div>
              <div style={tile}><div style={{ ...tileN, color: C.blueText }}>{s.planned || 0}</div><div style={tileL}>Planned</div></div>
              <div style={tile}><div style={{ ...tileN, color: C.greenText }}>{s.executed || 0}</div><div style={tileL}>Executed</div></div>
              <div style={{ ...tile, gridColumn: "1 / -1" }}>
                <div style={{ ...tileN, color: C.redText }}>{s.slipped || 0}</div>
                <div style={tileL}>Slipped out of the forecast week</div>
              </div>
            </div>
          </Card>

          <Card title="Activity split">
            {activityTotal === 0 ? <Empty text="No forecast lines in range." /> : (
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <Donut
                  total={activityTotal}
                  slices={activity.map((a, i) => ({ value: a.count, color: DONUT_COLORS[i % DONUT_COLORS.length] }))}
                />
                <div style={{ fontSize: 11, lineHeight: 1.6, minWidth: 0 }}>
                  {activity.map((a, i) => (
                    <div key={a.label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: DONUT_COLORS[i % DONUT_COLORS.length], flexShrink: 0 }} />
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.label}</span>
                      <b style={{ marginLeft: "auto" }}>{a.count}</b>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>

          {!imName && (data?.ims || []).length > 0 && (
            <Card title="By IM">
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead>
                  <tr>
                    <th style={pth}>IM</th>
                    <th style={pthR}>Lines</th>
                    <th style={pthR}>Done</th>
                    <th style={pthR}>SAR</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.ims || []).slice(0, 12).map((x) => (
                    <tr key={x.im || "none"}>
                      <td style={{ ...ptd, maxWidth: 84, overflow: "hidden", textOverflow: "ellipsis" }} title={x.im_name}>
                        {x.im_name}
                        {x.no_week > 0 && (
                          <span style={{ color: C.amberText, marginLeft: 4 }} title={`${x.no_week} without a forecast week`}>
                            ·{x.no_week}
                          </span>
                        )}
                      </td>
                      <td style={ptdR}>{x.total}</td>
                      <td style={{ ...ptdR, color: C.greenText }}>{x.executed}</td>
                      <td style={ptdR}>{money(x.forecast_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          <Card title="Forecast team load">
            {teams.length === 0 ? <Empty text="No teams forecast yet." /> : teams.map((t) => (
              <div key={t.team || "none"} style={{ marginBottom: 9 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3 }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.team_name}</span>
                  <b style={{ flexShrink: 0, marginLeft: 6 }}>{t.forecast}</b>
                </div>
                {/* forecast above, actually-planned below: an over-committed
                    or idle team shows up before the week starts. */}
                <Bar value={t.forecast} total={maxTeam} color={C.blue} />
                <div style={{ height: 3 }} />
                <Bar value={t.planned + t.executed} total={maxTeam} color={C.green} height={4} />
              </div>
            ))}
          </Card>
        </div>

        {/* ── Centre: the horizon grid ───────────────────────────────── */}
        <div style={{ flex: "1 1 440px", minWidth: 0 }}>
          <Card
            title={`${data?.month?.label || "Forecast"} · ${rows.length} line${rows.length !== 1 ? "s" : ""}`}
            right={<span style={{ fontSize: 10.5, color: C.muted }}>solid = forecast week · outlined = where it was planned</span>}
            style={{ padding: 0, overflow: "hidden" }}
            headerStyle={{ padding: "10px 11px 0", marginBottom: 9 }}
          >
            {/* A month's worth of POIDs can be hundreds of rows, so the grid
                scrolls inside a fixed box rather than stretching the page.
                The header row and the POID column stay pinned. */}
            <div style={{ overflow: "auto", maxHeight: "clamp(180px, 38vh, 430px)" }}>
              <div style={{ minWidth: 560 }}>
                <div style={{ display: "grid", gridTemplateColumns: gridCols }}>
                  {DETAIL_COLS.map((c, i) => (
                    <div
                      key={c.key}
                      style={{
                        ...gh, position: "sticky", top: 0,
                        zIndex: i === 0 ? 4 : 3,
                        ...(i === 0 ? { left: 0, paddingLeft: 11 } : null),
                      }}
                    >
                      {c.label}
                    </div>
                  ))}
                  {buckets.map((b) => (
                    <div key={b.start} style={{ ...ghDay, position: "sticky", top: 0, zIndex: 3, background: b.is_current ? "#EEF4FE" : "#FAFAFD" }}>
                      {b.label}
                      <div style={{ fontWeight: 500, fontSize: 8.5, opacity: 0.75 }}>{b.range}</div>
                    </div>
                  ))}
                  <div style={{ ...ghDay, position: "sticky", top: 0, zIndex: 3, textAlign: "right", paddingRight: 11 }}>Var.</div>

                  {rows.length === 0 ? (
                    <div style={{ gridColumn: "1 / -1" }}><Empty text="Nothing forecast for this month." /></div>
                  ) : rows.map((r) => {
                    const st = STATE_BY[r.state] || STATE_BY.not_planned;
                    const fcIdx = buckets.findIndex((b) => b.start === String(r.target_week).slice(0, 10));
                    const planIdx = r.plan_week ? buckets.findIndex((b) => b.start === String(r.plan_week).slice(0, 10)) : -1;
                    return (
                      <div key={r.po_dispatch} style={{ display: "contents" }}>
                        <div
                          style={{ ...gc, fontSize: 11, position: "sticky", left: 0, zIndex: 1, background: "#fff", paddingLeft: 11 }}
                          title={r.item_description || ""}
                        >
                          {r.poid}
                        </div>
                        <div style={{ ...gc, fontSize: 11 }}>{r.project_code || "—"}</div>
                        <div style={{ ...gc, fontSize: 11 }}>{r.domain || "—"}</div>
                        <div style={{ ...gc, fontSize: 11 }}>{r.target_team_name || "—"}</div>
                        {buckets.map((b, i) => (
                          <div key={b.start} style={{ ...gc, justifyContent: "center", background: b.is_current ? "#FBFCFE" : undefined }}>
                            {i === fcIdx && (
                              <span
                                title={`Forecast ${weekRangeLabel(b.start)}${r.plan_date ? ` → planned ${String(r.plan_date).slice(0, 10)}` : " · not planned yet"}`}
                                style={{ width: "82%", height: 15, borderRadius: 4, background: st.color, display: "inline-block" }}
                              />
                            )}
                            {i === planIdx && i !== fcIdx && (
                              // Where it actually landed. The pair of chips IS
                              // the forecast-vs-planned story.
                              <span
                                title={`Planned ${String(r.plan_date).slice(0, 10)} (forecast ${weekRangeLabel(String(r.target_week).slice(0, 10))})`}
                                style={{ width: "82%", height: 15, borderRadius: 4, border: `2px dashed ${st.color}`, display: "inline-block" }}
                              />
                            )}
                          </div>
                        ))}
                        <div style={{ ...gc, justifyContent: "flex-end", paddingRight: 11, fontSize: 10.5, color: r.slipped ? C.redText : C.muted }}>
                          {!r.target_week
                            ? <span style={{ color: C.amberText }}>no week</span>
                            : r.week_delta === null || r.week_delta === undefined
                              ? "—"
                              : r.week_delta === 0 ? "on week" : `${r.week_delta > 0 ? "+" : ""}${r.week_delta}w`}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            {data?.rows_truncated && (
              <div style={{ padding: "7px 12px", fontSize: 10.5, color: C.amberText, background: "#FFF8EC" }}>
                Showing the first {rows.length} lines — the tiles above still count every forecast line.
              </div>
            )}
          </Card>

          {/* Per-week strip */}
          <div style={{ display: "flex", gap: 8, marginTop: 9, flexWrap: "wrap" }}>
            {buckets.map((b) => (
              <div key={b.start} style={{ ...bstat, flex: "1 1 104px", minWidth: 100, borderColor: b.is_current ? C.blue : C.border }}>
                <div style={bstatL}>{b.label} · {b.range}{b.is_current ? " · now" : ""}</div>
                <div style={{ ...bstatN, fontSize: 21 }}>{b.total}</div>
                <div style={bstatS}>
                  {b.not_planned} unplanned · {b.executed} done
                  <br />SAR {money(b.forecast_amount)}
                </div>
              </div>
            ))}
          </div>

          <Card title="Forecast by month" style={{ marginTop: 9 }}>
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
              {(data?.months || []).map((m) => (
                <button
                  key={m.month}
                  type="button"
                  onClick={() => setMonth(m.month.slice(0, 7))}
                  title={`${m.label} · SAR ${money(m.forecast_amount)}`}
                  style={{
                    ...tile, flex: "1 1 80px", minWidth: 76, cursor: "pointer", textAlign: "left",
                    background: m.is_selected ? "#EEF4FE" : "#FAFAFD",
                    borderColor: m.is_selected ? C.blue : C.border,
                  }}
                >
                  <div style={{ fontSize: 10, color: C.muted, fontWeight: 600 }}>
                    {m.label}{m.is_current ? " ·" : ""}
                  </div>
                  <div style={{ ...tileN, fontSize: 18, color: m.total ? "#1A1F36" : C.gray }}>{m.total}</div>
                  <div style={{ fontSize: 9.5, color: C.muted }}>SAR {money(m.forecast_amount)}</div>
                  {m.no_week > 0 && (
                    <div style={{ fontSize: 9.5, color: C.amberText, marginTop: 1 }}>{m.no_week} no week</div>
                  )}
                </button>
              ))}
            </div>
          </Card>

          <div style={{ display: "flex", gap: 8, marginTop: 9, flexWrap: "wrap" }}>
            <Gauge
              value={s.plan_coverage_pct || 0}
              color={C.blue}
              caption="Plan coverage"
              sub="How much of the forecast has become a real plan"
            />
            <Gauge
              value={s.week_accuracy_pct || 0}
              color={C.green}
              caption="Week accuracy"
              sub="How often the plan landed in the forecast week"
            />
          </div>
        </div>

        {/* ── Right rail: variance ───────────────────────────────────── */}
        <div style={{ flex: "0 0 210px", display: "flex", flexDirection: "column", gap: 9 }}>
          <Card title="Value this month">
            <div style={{ display: "grid", gap: 7 }}>
              <div style={tile}><div style={moneyN}>SAR {money(s.forecast_amount)}</div><div style={tileL}>Forecast</div></div>
              <div style={tile}><div style={{ ...moneyN, color: C.blueText }}>SAR {money(s.planned_amount)}</div><div style={tileL}>Planned</div></div>
              <div style={tile}><div style={{ ...moneyN, color: C.greenText }}>SAR {money(s.executed_amount)}</div><div style={tileL}>Executed</div></div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 11 }}>
              <Donut
                size={68}
                total={s.total || 0}
                slices={STATES.map((st) => ({ value: s[st.key] || 0, color: st.color }))}
              />
              <div style={{ fontSize: 11, lineHeight: 1.6 }}>
                {STATES.map((st) => (
                  <div key={st.key} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: st.color }} />
                    {st.label}<b style={{ marginLeft: "auto" }}>{s[st.key] || 0}</b>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          <Card title="Forecast vs reality">
            <div style={{ ...tile, marginBottom: 7 }}>
              <div style={{ ...tileN, color: C.redText }}>{s.slipped || 0}</div>
              <div style={tileL}>Planned outside the forecast week</div>
            </div>
            <div style={tile}>
              <div style={{ ...tileN, color: C.amberText }}>{s.team_changed || 0}</div>
              <div style={tileL}>Given to a different team at planning</div>
            </div>
          </Card>

          <Card title="Top projects by forecast value">
            {(data?.projects || []).length === 0 ? <Empty text="Nothing forecast yet." /> : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead>
                  <tr><th style={pth}>Project</th><th style={pthR}>Lines</th><th style={pthR}>SAR</th></tr>
                </thead>
                <tbody>
                  {(data.projects || []).slice(0, 7).map((p) => (
                    <tr key={p.project_code}>
                      <td style={ptd}>{p.project_code}</td>
                      <td style={ptdR}>{p.total}</td>
                      <td style={ptdR}>{money(p.forecast_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
