import { useEffect, useMemo, useState } from "react";
import DataTableWrapper from "../../components/DataTableWrapper";
import DateRangePicker from "../../components/DateRangePicker";
import SearchableSelect from "../../components/SearchableSelect";
import useFilterOptions from "../../hooks/useFilterOptions";
import { pmApi } from "../../services/api";

const fmtInt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });
const fmtMoney = new Intl.NumberFormat("en", { maximumFractionDigits: 2, minimumFractionDigits: 2 });

const REPORTS = [
  {
    id: "pipeline",
    title: "Acceptance Pipeline",
    short: "Pipeline",
    icon: "📋",
    accent: "#4338ca",
    blurb: "Snapshot of all open POIDs grouped by PIC status, with MS1/MS2 amount sums.",
    filters: ["project"],
  },
  {
    id: "monthly",
    title: "Monthly Invoicing Roll-up",
    short: "Monthly",
    icon: "📅",
    accent: "#0ea5e9",
    blurb: "MS1 + MS2 invoiced amounts grouped by Invoicing Month.",
    filters: ["dateRange"],
  },
  {
    id: "aging",
    title: "Pending Aging — Under I-BUY / ISDP",
    short: "Aging",
    icon: "⌛",
    accent: "#b45309",
    blurb: "POIDs sitting in 'Under I-BUY' or 'Under ISDP' with days-since-applied — useful for chasing stale approvals.",
    filters: ["project", "owner"],
  },
  {
    id: "closed",
    title: "Closed in Range",
    short: "Closed",
    icon: "✓",
    accent: "#047857",
    blurb: "POIDs that reached 'Commercial Invoice Closed', date-bounded by Payment Received / Invoicing Month — for finance reconciliation.",
    filters: ["dateRange", "project"],
  },
  {
    id: "rejected",
    title: "Rejected POIDs",
    short: "Rejected",
    icon: "✕",
    accent: "#b91c1c",
    blurb: "POIDs sitting in 'I-BUY Rejected' or 'ISDP Rejected' with the IM rejection remark and PIC's note.",
    filters: ["project"],
  },
];

export default function PICReports() {
  const [kind, setKind] = useState("pipeline");
  const [range, setRange] = useState({ from: "", to: "" });
  const [project, setProject] = useState([]);
  const [owner, setOwner] = useState("");

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const meta = REPORTS.find((r) => r.id === kind) || REPORTS[0];
  const showDate = meta.filters.includes("dateRange");
  const showProject = meta.filters.includes("project");
  const showOwner = meta.filters.includes("owner");

  const { options: dispOpts } = useFilterOptions("PO Dispatch", ["project_code", "isdp_ibuy_owner"]);
  const projectOptions = dispOpts.project_code || [];
  const ownerOptions = dispOpts.isdp_ibuy_owner || [];

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await pmApi.getPicReport(kind, {
        from_date: showDate ? range.from : "",
        to_date: showDate ? range.to : "",
        project_code: showProject && project.length ? project : "",
        owner: showOwner ? owner : "",
      });
      setData(res || null);
    } catch (err) {
      setError(err.message || "Failed to load report");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, range.from, range.to, JSON.stringify(project), owner]);

  const totals = useMemo(() => {
    if (!data?.rows?.length) return null;
    const numericCols = (data.columns || []).filter((c) => c.numeric);
    if (!numericCols.length) return null;
    const out = {};
    numericCols.forEach((c) => {
      out[c.key] = data.rows.reduce((sum, r) => sum + (Number(r[c.key]) || 0), 0);
    });
    return out;
  }, [data]);

  function downloadCsv() {
    if (!data?.rows?.length) return;
    const cols = data.columns || [];
    const esc = (v) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [cols.map((c) => esc(c.label)).join(",")];
    data.rows.forEach((r) => {
      lines.push(cols.map((c) => {
        let v = r[c.key];
        if (v && /_date$|_month$/.test(c.key)) v = String(v).slice(0, 10);
        return esc(v);
      }).join(","));
    });
    if (totals) {
      lines.push(""); // blank line before totals
      lines.push(cols.map((c) => {
        if (totals[c.key] != null) return esc(totals[c.key]);
        return c.key === cols[0].key ? esc("TOTAL") : "";
      }).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `pic-${kind}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function renderCell(row, col) {
    const v = row[col.key];
    if (v == null || v === "") return <span style={{ color: "#94a3b8" }}>—</span>;
    if (col.money) return fmtMoney.format(Number(v) || 0);
    if (col.numeric) return fmtInt.format(Number(v) || 0);
    if (/_date$|_month$/.test(col.key)) return String(v).slice(0, 10);
    return String(v);
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">PIC Reports</h1>
          <div className="page-subtitle">Canned reports for the invoicing pipeline. Pick a report on the left.</div>
        </div>
        <div className="page-actions">
          <button type="button" className="btn-secondary" onClick={downloadCsv} disabled={!data?.rows?.length}>
            Download CSV
          </button>
          <button type="button" className="btn-secondary" onClick={load} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {error && (
        <div className="notice error" style={{ margin: "0 16px 8px" }}>
          <span>!</span> {error}
        </div>
      )}

      {/* Horizontal pill bar — replaces the old left rail. Active report
          gets a coloured accent strip + filled tab so the PIC sees at a
          glance which report they're looking at. */}
      <div style={{
        display: "flex", flexWrap: "wrap", gap: 6,
        padding: "0 16px 12px",
      }}>
        {REPORTS.map((r) => {
          const active = kind === r.id;
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => setKind(r.id)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                padding: "9px 16px",
                border: "1px solid", borderColor: active ? r.accent : "#e2e8f0",
                borderRadius: 10,
                background: active ? r.accent : "#fff",
                color: active ? "#fff" : "#0f172a",
                fontSize: "0.84rem",
                fontWeight: active ? 700 : 600,
                cursor: "pointer",
                boxShadow: active ? `0 4px 12px -4px ${r.accent}66` : "none",
                transition: "all 0.15s ease",
              }}
            >
              <span style={{ fontSize: "1rem", lineHeight: 1, opacity: active ? 1 : 0.75 }}>{r.icon}</span>
              <span>{r.short}</span>
            </button>
          );
        })}
      </div>

      <div style={{ padding: "0 16px 16px" }}>
        {/* Single full-width card — header strip with accent, filters, table */}
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 2px rgba(15,23,42,0.04)" }}>
          {/* Coloured strip at the top to anchor the active report */}
          <div style={{ height: 4, background: meta.accent }} />
          <div style={{ padding: "14px 18px", borderBottom: "1px solid #e2e8f0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10,
                background: `${meta.accent}1a`, color: meta.accent,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "1.1rem", fontWeight: 700,
              }}>{meta.icon}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: "1rem", fontWeight: 700, color: "#0f172a" }}>{meta.title}</div>
                <div style={{ fontSize: "0.78rem", color: "#64748b", marginTop: 2 }}>{meta.blurb}</div>
              </div>
              <div style={{ marginLeft: "auto", fontSize: "0.78rem", color: "#94a3b8", whiteSpace: "nowrap" }}>
                {data?.rows?.length ? `${fmtInt.format(data.rows.length)} row${data.rows.length !== 1 ? "s" : ""}` : ""}
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
              {showDate && (
                <DateRangePicker value={range} onChange={({ from, to }) => setRange({ from, to })} />
              )}
              {showProject && (
                <SearchableSelect multi value={project} onChange={setProject} options={projectOptions} placeholder="All Projects" minWidth={180} />
              )}
              {showOwner && (
                <select value={owner} onChange={(e) => setOwner(e.target.value)}
                  style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem", minWidth: 200 }}>
                  <option value="">All Owners</option>
                  {ownerOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              )}
              {!showDate && !showProject && !showOwner && (
                <span style={{ fontSize: "0.76rem", color: "#94a3b8", fontStyle: "italic" }}>No filters apply for this report.</span>
              )}
            </div>
          </div>

          <DataTableWrapper>
            {loading ? (
              <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Loading…</div>
            ) : !data?.rows?.length ? (
              <div className="empty-state">
                <div className="empty-icon">📊</div>
                <h3>No rows match the current filters</h3>
                <p>Try adjusting the filters above.</p>
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    {(data.columns || []).map((c) => (
                      <th key={c.key} style={c.numeric ? { textAlign: "right" } : undefined}>{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(data.rows || []).map((r, i) => (
                    <tr key={i}>
                      {(data.columns || []).map((c) => {
                        const isPrimary = c.key === "poid";
                        return (
                          <td key={c.key}
                              style={{
                                ...(c.numeric ? { textAlign: "right", fontVariantNumeric: "tabular-nums" } : {}),
                                ...(isPrimary ? { fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: "0.78rem" } : {}),
                              }}>
                            {renderCell(r, c)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
                {totals && (
                  <tfoot>
                    <tr style={{ background: "#f1f5f9", fontWeight: 700 }}>
                      {(data.columns || []).map((c, idx) => {
                        if (totals[c.key] != null) {
                          return (
                            <td key={c.key} style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                              {c.money ? fmtMoney.format(totals[c.key]) : fmtInt.format(totals[c.key])}
                            </td>
                          );
                        }
                        if (idx === 0) {
                          return <td key={c.key} style={{ color: "#475569", fontSize: "0.82rem" }}>TOTAL · {fmtInt.format(data.rows.length)} rows</td>;
                        }
                        return <td key={c.key}></td>;
                      })}
                    </tr>
                  </tfoot>
                )}
              </table>
            )}
          </DataTableWrapper>
        </div>
      </div>
    </div>
  );
}
