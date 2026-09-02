import { useEffect, useState } from "react";
import DateRangePicker from "./DateRangePicker";
import MiniTable from "./MiniTable";
import SearchableSelect from "./SearchableSelect";
import useFilterOptions from "../hooks/useFilterOptions";
import { pmApi } from "../services/api";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });


/**
 * Commercial performance of planned rollout work — planned vs invoiced vs
 * collected, per project.
 *
 * One component for both report pages. Passing `imName` scopes it to that IM
 * (the IM's own Reports tab); omitting it covers every IM and offers an IM
 * filter instead (the PM's Reports page). The backend makes the same
 * distinction, so neither side can see past what its session allows.
 */
export default function RolloutCommercialReport({ imName, initialProject = "" }) {
  // Fiscal quarter, from the same backend helper the weekly rail uses — this
  // bench's year runs Apr–Mar, so a calendar Math.floor(month/3) would label
  // Jul–Sep as Q3 when Accounts calls it Q2.
  const [quarter, setQuarter] = useState(null);
  const [commRange, setCommRange] = useState({ from: "", to: "" });
  useEffect(() => {
    let cancelled = false;
    pmApi.getRolloutFiscalQuarter().then((q) => {
      if (cancelled || !q) return;
      setQuarter(q);
      setCommRange((r) => (r.from || r.to ? r : { from: q.from, to: q.to }));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const [commProject, setCommProject] = useState(initialProject ? [initialProject] : []);
  const [imFilter, setImFilter] = useState([]);
  const [commercial, setCommercial] = useState(null);
  const [commLoading, setCommLoading] = useState(false);

  const isPm = !imName;
  const { options: opts } = useFilterOptions("PO Dispatch", isPm ? ["project_code", "im"] : ["project_code"]);

  useEffect(() => {
    if (!commRange.from && !commRange.to) return undefined;
    let cancelled = false;
    setCommLoading(true);
    pmApi.getRolloutCommercialSummary({
      im: imName || "",
      from_date: commRange.from,
      to_date: commRange.to,
      project_code: commProject.length ? commProject : undefined,
      filter_im: imFilter.length ? imFilter : undefined,
    })
      .then((r) => { if (!cancelled) setCommercial(r); })
      .catch(() => { if (!cancelled) setCommercial(null); })
      .finally(() => { if (!cancelled) setCommLoading(false); });
    return () => { cancelled = true; };
  }, [imName, commRange.from, commRange.to, JSON.stringify(commProject), JSON.stringify(imFilter)]);

  const t = commercial?.top;
  const projects = commercial?.projects || [];
  const kpi = [
    ["Planned value", t?.planned, "#1e293b"],
    ["Forecast to complete", t ? Math.max(t.planned - t.invoiced, 0) : 0, "#a16207"],
    ["Invoiced", t?.invoiced, "#0369a1"],
    ["Collected", t?.collected, "#15803d"],
    ["Invoiced pending", t?.pending, "#b45309"],
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "#334155" }}>Period</span>
        <DateRangePicker value={commRange} onChange={({ from, to }) => setCommRange({ from, to })} />
        <SearchableSelect
          allowBlank multi value={commProject} onChange={setCommProject}
          options={opts.project_code || []} placeholder="All Projects" minWidth={180}
        />
        {isPm && (
          <SearchableSelect
            allowBlank multi value={imFilter} onChange={setImFilter}
            options={opts.im || []} placeholder="All IMs" minWidth={160}
          />
        )}
        <span style={{ fontSize: "0.76rem", color: "#94a3b8" }}>
          {quarter ? `defaults to ${quarter.label} (${quarter.span})` : ""}
        </span>
        {commLoading && <span style={{ fontSize: "0.76rem", color: "#94a3b8" }}>Loading…</span>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 14 }}>
        {kpi.map(([label, value, color]) => (
          <div key={label} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "16px 18px", borderLeft: `4px solid ${color}` }}>
            <div style={{ fontSize: "0.72rem", color: "#94a3b8", textTransform: "uppercase", fontWeight: 600, marginBottom: 4 }}>{label} (SAR)</div>
            <div style={{ fontSize: "1.35rem", fontWeight: 800, color: "#1e293b", fontVariantNumeric: "tabular-nums" }}>
              {fmt.format(Number(value) || 0)}
            </div>
          </div>
        ))}
      </div>

      <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "16px 18px" }}>
        <h3 style={{ fontSize: "0.88rem", fontWeight: 700, marginBottom: 4, color: "#1e293b" }}>
          By project — planned vs invoiced vs collected
        </h3>
        <p style={{ fontSize: "0.76rem", color: "#94a3b8", margin: "0 0 12px" }}>
          Every PO line with a rollout plan in the period. Planned is the line value;
          collected counts a milestone only once its payment received date is set.
        </p>
        <MiniTable
          resizable
          tableKey="rollout-commercial-report"
          columns={[
            { label: "Project", key: "project_code" },
            { label: "Lines", key: "lines", align: "right" },
            { label: "Planned SAR", key: "planned", align: "right", render: (v) => fmt.format(Number(v) || 0) },
            { label: "Invoiced SAR", key: "invoiced", align: "right", render: (v) => fmt.format(Number(v) || 0) },
            { label: "Collected SAR", key: "collected", align: "right", render: (v) => fmt.format(Number(v) || 0) },
            { label: "Not invoiced", key: "not_invoiced", align: "right", render: (v) => fmt.format(Number(v) || 0) },
            { label: "Invoiced %", key: "invoiced_pct", align: "right", render: (v) => `${v}%` },
            { label: "Collected %", key: "collected_pct", align: "right", render: (v) => `${v}%` },
          ]}
          rows={projects.map((p) => ({
            ...p,
            not_invoiced: Math.max(p.planned - p.invoiced, 0),
            invoiced_pct: p.planned ? Math.round((p.invoiced * 100) / p.planned) : 0,
            collected_pct: p.invoiced ? Math.round((p.collected * 100) / p.invoiced) : 0,
          }))}
          emptyText={commLoading ? "Loading…" : "No planned lines in this period."}
        />
        {projects.length > 0 && (
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 12, paddingTop: 10, borderTop: "2px solid #e2e8f0", fontSize: "0.82rem", fontWeight: 700 }}>
            <span>{projects.length} project{projects.length !== 1 ? "s" : ""}</span>
            <span>Planned {fmt.format(t?.planned || 0)}</span>
            <span style={{ color: "#0369a1" }}>Invoiced {fmt.format(t?.invoiced || 0)}</span>
            <span style={{ color: "#15803d" }}>Collected {fmt.format(t?.collected || 0)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
