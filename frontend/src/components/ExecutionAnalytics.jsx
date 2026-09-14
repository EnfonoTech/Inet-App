import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { pmApi } from "../services/api";
import DateRangePicker from "./DateRangePicker";
import {
  C, DONUT_COLORS, Card, Donut, Bar, Empty, money,
  tile, tileN, tileL, pth, pthR, ptd, ptdR, bstat, bstatL, bstatN, bstatS,
} from "./dashboardKit";

/**
 * Execution Analytics — the Execution Monitor dataset, read analytically.
 *
 * The monitor lists open lines. This answers the questions a list cannot:
 * what needs attention, how it splits across any dimension, where work is
 * concentrated, and how it has moved month to month — over closed and
 * historical work too, which the monitor hides by design.
 *
 * Every tile and every breakdown row is one filtered set, computed in a
 * single backend call, so nothing on the page can disagree with anything
 * else. Tiles drill through to the monitor using the SAME predicate they
 * counted with, so a number and the list it opens always match.
 *
 * Not a `.data-table`: no DataTablePro, no row limit, no Excel filters. Same
 * choice as the weekly dashboards — there are no rows to page through.
 */

const CLOSURE = [
  { id: "all", label: "All" },
  { id: "open", label: "Open" },
  { id: "closed", label: "Closed" },
];
const VISITS = [
  { id: "current", label: "Current visit" },
  { id: "all", label: "All visits" },
];
const BASES = [
  { id: "plan", label: "Plan date" },
  { id: "execution", label: "Execution date" },
  { id: "work_done", label: "Work done date" },
];
// Preference order for the default six. A page that hides a dimension (the
// IM rail on an IM page, say) falls through to the next one, so every page
// still opens with six filled in rather than five.
const DEFAULT_DIM_ORDER = [
  "project_domain", "project", "im", "execution_status", "plan_status", "team",
  "visit_type", "duid", "qc_status", "work_mode",
];
const DEFAULT_DIM_COUNT = 6;

const TONE = {
  bad: { fg: C.redText, bg: "#FDF2F1", bd: "#F1CFCC" },
  warn: { fg: C.amberText, bg: "#FFF8EC", bd: "#F0DCB4" },
  info: { fg: C.blueText, bg: "#EEF4FE", bd: "#CFE0F8" },
};

function Seg({ options, value, onChange }) {
  return (
    <div style={{ display: "inline-flex", padding: 2, background: "#f1f5f9", borderRadius: 7, border: `1px solid ${C.border}` }}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          style={{
            padding: "3px 10px", fontSize: 11, fontWeight: 700, border: "none",
            borderRadius: 5, cursor: "pointer",
            background: value === o.id ? "#1d4ed8" : "transparent",
            color: value === o.id ? "#fff" : "#475569",
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function ExecutionAnalytics({ imName, monitorHref, onDrill, hideDimensions }) {
  const navigate = useNavigate();
  const [closure, setClosure] = useState("all");
  const [visits, setVisits] = useState("current");
  const [basis, setBasis] = useState("plan");
  const [range, setRange] = useState({ from: "", to: "" });
  const hidden = useMemo(() => new Set(hideDimensions || []), [hideDimensions]);
  const [dims, setDims] = useState(() =>
    DEFAULT_DIM_ORDER.filter((d) => !(hideDimensions || []).includes(d)).slice(0, DEFAULT_DIM_COUNT)
  );
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const portal = useMemo(() => ({
    closure, visits, date_basis: basis,
    from_date: range.from || "", to_date: range.to || "",
  }), [closure, visits, basis, range.from, range.to]);
  const portalKey = JSON.stringify(portal);
  const dimsKey = JSON.stringify(dims);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    pmApi
      .getExecutionAnalytics({ im: imName || "", portal_filters: portal, dimensions: dims })
      .then((res) => { if (!cancelled) setData(res || null); })
      .catch((e) => { if (!cancelled) setError(e.message || "Failed to load analytics"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imName, portalKey, dimsKey]);

  const t = data?.totals || {};
  const available = (data?.meta?.available_dimensions || []).filter((d) => !hidden.has(d.key));

  const canDrill = !!(onDrill || monitorHref);

  function openMonitor(extra) {
    if (!canDrill) return;
    const execFilters = {
      // Empty = every status. The monitor otherwise defaults to a 4-of-8
      // subset that silently hides Overdue / Not Attended / Cancelled, which
      // would make the list disagree with the tile that opened it.
      planStatusFilter: [],
      closure, visits, tab: "all",
      fromDate: range.from || "", toDate: range.to || "",
      ...extra,
    };
    // On the monitor's own page this is a tab switch, not a navigation.
    if (onDrill) onDrill(execFilters);
    else navigate(monitorHref, { state: { execFilters } });
  }

  function toggleDim(key) {
    setDims((cur) => (cur.includes(key)
      ? (cur.length > 1 ? cur.filter((k) => k !== key) : cur)
      : [...cur, key].slice(-DEFAULT_DIM_COUNT)));
  }

  if (error) {
    return <div className="notice error" style={{ marginBottom: 16 }}><span>!</span> {error}</div>;
  }

  const closureSlices = [
    { label: "Open", value: t.open || 0, color: C.amber },
    { label: "Closed", value: t.closed || 0, color: C.green },
  ];
  const maxTrend = Math.max(1, ...(data?.trend || []).map((x) => x.lines));

  return (
    <div style={{ opacity: loading ? 0.6 : 1, transition: "opacity .15s" }}>
      {/* Controls — a plain row, not `.toolbar`: that class exists to give a
          data-table full height, and there is no table on this page. */}
      <div style={{ display: "flex", gap: 9, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
        <Seg options={CLOSURE} value={closure} onChange={setClosure} />
        <Seg options={VISITS} value={visits} onChange={setVisits} />
        <select
          value={basis}
          onChange={(e) => setBasis(e.target.value)}
          style={{ fontSize: 11.5, padding: "4px 7px", borderRadius: 7, border: `1px solid ${C.border}` }}
        >
          {BASES.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
        </select>
        <DateRangePicker value={range} onChange={setRange} />
        {(range.from || range.to) && (
          <button type="button" className="btn-secondary" style={{ padding: "3px 9px", fontSize: 11 }} onClick={() => setRange({ from: "", to: "" })}>
            All time
          </button>
        )}
      </div>

      {/* Headline */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        {[
          ["Lines", t.lines], ["POIDs", t.poids], ["DUIDs", t.duids],
          ["Projects", t.projects],
        ].map(([l, v]) => (
          <div key={l} style={bstat}>
            <div style={bstatL}>{l}</div>
            <div style={bstatN}>{v || 0}</div>
          </div>
        ))}
        <div style={bstat}>
          <div style={bstatL}>Value</div>
          <div style={{ ...bstatN, fontSize: 20 }}>SAR {money(t.value)}</div>
          <div style={bstatS}>{t.open || 0} open · {t.closed || 0} closed</div>
        </div>
      </div>

      {/* Attention rail — the five-second answer, so it sits above everything */}
      <Card
        title="Needs attention"
        right={<span style={{ fontSize: 10.5, color: C.muted }}>buckets overlap — a line can appear in more than one</span>}
        style={{ marginBottom: 10 }}
      >
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
          {(data?.buckets || []).filter((b) => b.value > 0).map((b) => {
            const tone = TONE[b.tone] || TONE.info;
            return (
              <button
                key={b.key}
                type="button"
                onClick={() => openMonitor({ bucket: b.key })}
                title={`${b.hint}${canDrill ? " · click to open these lines" : ""}`}
                style={{
                  ...bstat, flex: "1 1 132px", minWidth: 128, textAlign: "left",
                  background: tone.bg, borderColor: tone.bd,
                  cursor: canDrill ? "pointer" : "default",
                }}
              >
                <div style={{ ...bstatL, color: tone.fg }}>{b.label}</div>
                <div style={{ ...bstatN, color: tone.fg }}>{b.value}</div>
                <div style={{ ...bstatS, color: tone.fg, opacity: 0.85 }}>SAR {money(b.amount)}</div>
              </button>
            );
          })}
          {!(data?.buckets || []).some((b) => b.value > 0) && <Empty text="Nothing outstanding in this range." />}
        </div>
      </Card>

      <div style={{ display: "flex", gap: 9, alignItems: "flex-start", flexWrap: "wrap" }}>
        {/* Left: closure split + concentration */}
        <div style={{ flex: "0 0 208px", display: "flex", flexDirection: "column", gap: 9 }}>
          <Card title="Open vs closed">
            <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
              <Donut size={68} total={t.lines || 0} slices={closureSlices} />
              <div style={{ fontSize: 11, lineHeight: 1.6 }}>
                {closureSlices.map((s) => (
                  <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color }} />
                    {s.label}<b style={{ marginLeft: "auto" }}>{s.value}</b>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          <Card title="Repeat visits per POID" right={<span style={{ fontSize: 9.5, color: C.muted }}>all visits</span>}>
            {(data?.concentration?.visits || []).length === 0 ? <Empty /> : (
              <>
                {(data.concentration.visits || []).map((v) => (
                  <div key={v.visits} style={{ marginBottom: 6 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                      <span>{v.visits} visit{v.visits !== 1 ? "s" : ""}</span><b>{v.poids}</b>
                    </div>
                    <Bar value={v.poids} total={Math.max(...data.concentration.visits.map((x) => x.poids))} color={v.visits > 2 ? C.red : C.blue} />
                  </div>
                ))}
                {(data.concentration.top_poids || []).length > 0 && (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10.5, marginTop: 8 }}>
                    <thead><tr><th style={pth}>Most re-planned</th><th style={pthR}>×</th></tr></thead>
                    <tbody>
                      {data.concentration.top_poids.slice(0, 6).map((p) => (
                        <tr key={p.po_dispatch}>
                          <td style={{ ...ptd, maxWidth: 118, overflow: "hidden", textOverflow: "ellipsis" }} title={`${p.poid} · ${p.duid}`}>{p.poid}</td>
                          <td style={{ ...ptdR, color: C.redText, fontWeight: 700 }}>{p.visits}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            )}
          </Card>

          <Card title="Busiest DUIDs">
            {(data?.concentration?.top_duids || []).length === 0 ? <Empty /> : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10.5 }}>
                <thead><tr><th style={pth}>DUID</th><th style={pthR}>Lines</th></tr></thead>
                <tbody>
                  {data.concentration.top_duids.slice(0, 8).map((d) => (
                    <tr key={d.duid}>
                      <td style={{ ...ptd, maxWidth: 118, overflow: "hidden", textOverflow: "ellipsis" }} title={`${d.duid} · ${d.site_name}`}>{d.duid}</td>
                      <td style={ptdR}><b>{d.lines_n}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>

        {/* Centre: dimension switcher + breakdowns */}
        <div style={{ flex: "1 1 440px", minWidth: 0, display: "flex", flexDirection: "column", gap: 9 }}>
          <Card title="Break down by" right={<span style={{ fontSize: 10.5, color: C.muted }}>pick up to {DEFAULT_DIM_COUNT} · {dims.length} selected</span>}>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {available.map((d) => {
                const on = dims.includes(d.key);
                return (
                  <button
                    key={d.key}
                    type="button"
                    onClick={() => toggleDim(d.key)}
                    style={{
                      padding: "3px 9px", fontSize: 10.5, fontWeight: 600, borderRadius: 20,
                      cursor: "pointer",
                      border: `1px solid ${on ? "#1d4ed8" : C.border}`,
                      background: on ? "#1d4ed8" : "#fff",
                      color: on ? "#fff" : "#475569",
                    }}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
          </Card>

          <div style={{ display: "grid", gap: 9, gridTemplateColumns: "repeat(auto-fit, minmax(330px, 1fr))" }}>
            {(data?.dimensions || []).map((dim) => {
              const max = Math.max(1, ...dim.items.map((i) => i.n));
              return (
                <Card key={dim.key} title={dim.label}>
                  {dim.items.length === 0 ? <Empty /> : (
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                      <thead>
                        <tr>
                          <th style={pth}>{dim.label}</th>
                          <th style={pthR}>Lines</th>
                          <th style={pthR}>%</th>
                          <th style={pthR}>DUIDs</th>
                          <th style={pthR}>SAR</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dim.items.map((it) => (
                          <tr
                            key={it.key || it.label}
                            onClick={it.is_others ? undefined : () => openMonitor(dimFilter(dim.key, it))}
                            style={{ cursor: !it.is_others && canDrill && dimFilter(dim.key, it) ? "pointer" : "default" }}
                          >
                            <td style={{ ...ptd, maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis" }} title={it.label}>
                              <span style={{ color: it.is_blank || it.is_others ? C.muted : "inherit" }}>{it.label}</span>
                              <div style={{ marginTop: 3 }}><Bar value={it.n} total={max} color={C.blue} height={4} /></div>
                            </td>
                            <td style={ptdR}><b>{it.n}</b></td>
                            <td style={{ ...ptdR, color: C.muted }}>{it.pct}%</td>
                            <td style={{ ...ptdR, color: C.muted }}>{it.duids || "—"}</td>
                            <td style={ptdR}>{it.value ? money(it.value) : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </Card>
              );
            })}
          </div>

          <Card title={`Monthly trend · ${(BASES.find((b) => b.id === basis) || {}).label}`}>
            {(data?.trend || []).length === 0 ? <Empty text="No dated lines in this range." /> : (
              <div style={{ display: "flex", gap: 5, alignItems: "flex-end", overflowX: "auto", paddingBottom: 4 }}>
                {data.trend.map((m) => (
                  <div key={m.month} style={{ flex: "1 0 40px", textAlign: "center" }} title={`${m.month} · ${m.lines} lines · ${m.work_done} work done · SAR ${money(m.value)}`}>
                    <div style={{ height: 74, display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 1 }}>
                      <div style={{ height: `${(m.lines / maxTrend) * 100}%`, background: C.blue, borderRadius: "3px 3px 0 0", minHeight: 2 }} />
                      <div style={{ height: `${(m.work_done / maxTrend) * 100}%`, background: C.green, minHeight: m.work_done ? 2 : 0 }} />
                    </div>
                    <div style={{ fontSize: 9, color: C.muted, marginTop: 3, whiteSpace: "nowrap" }}>{m.month.slice(2)}</div>
                    <div style={{ fontSize: 10, fontWeight: 700 }}>{m.lines}</div>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: 11, fontSize: 10, color: C.muted, marginTop: 6 }}>
              <span><span style={{ display: "inline-block", width: 8, height: 8, background: C.blue, borderRadius: 2, marginRight: 4 }} />lines</span>
              <span><span style={{ display: "inline-block", width: 8, height: 8, background: C.green, borderRadius: 2, marginRight: 4 }} />work done</span>
            </div>
          </Card>
        </div>
      </div>

      {!canDrill && (
        <div style={{ fontSize: 10.5, color: C.muted, marginTop: 9 }}>
          Figures are read-only here — the Execution Monitor this would open is a PM view.
        </div>
      )}
    </div>
  );
}

/** Monitor filter for a breakdown row, or null when it cannot be expressed. */
function dimFilter(dimKey, item) {
  if (item.is_blank || item.is_others) return null;
  const v = [item.key];
  switch (dimKey) {
    case "project": return { projectFilter: v };
    case "duid": return { duidFilter: v };
    case "plan_status": return { planStatusFilter: v };
    case "visit_type": return { visitFilter: v };
    case "execution_status": return { executionStatusFilter: v };
    case "im": return { imFilter: v };
    // Everything else is a concept the monitor's toolbar cannot express;
    // returning null leaves the row non-clickable rather than opening a list
    // that disagrees with the number.
    default: return null;
  }
}
