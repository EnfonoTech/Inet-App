import { useEffect, useRef, useState } from "react";
import { pmApi } from "../../services/api";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

const STATUS_OPTIONS = ["", "Planned", "In Execution", "Completed", "Cancelled", "Planning with Issue"];

function statusBadgeClass(status) {
  if (!status) return "";
  const s = status.toLowerCase().replace(/\s+/g, "-");
  if (s === "planned") return "planned";
  if (s === "in-execution" || s === "in-progress") return "in-progress";
  if (s === "completed") return "completed";
  if (s === "cancelled") return "cancelled";
  return "new";
}

function DetailItem({ label, value }) {
  const txt = String(value || "");
  const isStatus = /status/i.test(label);
  const tone = txt.toLowerCase().includes("complete") || txt.toLowerCase().includes("pass")
    ? { bg: "#ecfdf5", fg: "#047857" }
    : txt.toLowerCase().includes("cancel") || txt.toLowerCase().includes("fail")
      ? { bg: "#fef2f2", fg: "#b91c1c" }
      : txt.toLowerCase().includes("progress") || txt.toLowerCase().includes("execution")
        ? { bg: "#eff6ff", fg: "#1d4ed8" }
        : { bg: "#fffbeb", fg: "#b45309" };
  return (
    <div style={{ padding: "8px 10px" }}>
      <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>{label}</div>
      {isStatus ? (
        <span style={{ display: "inline-block", borderRadius: 999, padding: "3px 10px", fontSize: 12, fontWeight: 700, background: tone.bg, color: tone.fg }}>
          {value || "—"}
        </span>
      ) : (
        <div style={{ fontSize: 13, color: "#0f172a", fontWeight: 500 }}>{value || "—"}</div>
      )}
    </div>
  );
}

function Pill({ label, value, tone = "blue" }) {
  const palette = {
    blue: { bg: "#eff6ff", fg: "#1d4ed8", bd: "#bfdbfe" },
    green: { bg: "#ecfdf5", fg: "#047857", bd: "#a7f3d0" },
    amber: { bg: "#fffbeb", fg: "#b45309", bd: "#fde68a" },
  }[tone];
  return (
    <div style={{ border: `1px solid ${palette.bd}`, background: palette.bg, color: palette.fg, borderRadius: 999, padding: "4px 10px", fontSize: 12, fontWeight: 700 }}>
      {label}: {value || "—"}
    </div>
  );
}

function parseAttachments(raw) {
  if (!raw) return [];
  const text = String(raw).trim();
  if (!text) return [];
  if (text.startsWith("[")) {
    try {
      const arr = JSON.parse(text);
      if (Array.isArray(arr)) return arr.map((v) => String(v || "").trim()).filter(Boolean);
    } catch {
      // ignore and fallback
    }
  }
  return text.split(/\r?\n|,/).map((v) => v.trim()).filter(Boolean);
}

export default function ExecutionMonitor() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const intervalRef = useRef(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [visitFilter, setVisitFilter] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [teamFilter, setTeamFilter] = useState("");
  const [duidFilter, setDuidFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [detailRow, setDetailRow] = useState(null);

  async function loadData() {
    setError(null);
    try {
      const list = await pmApi.listExecutionMonitorRows({});
      setRows(Array.isArray(list) ? list : []);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err.message || "Failed to load execution data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    intervalRef.current = setInterval(loadData, 30_000);
    return () => clearInterval(intervalRef.current);
  }, []);

  function formatTime(d) {
    if (!d) return "";
    return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  }

  const visitTypes = [...new Set(rows.map((r) => r.visit_type).filter(Boolean))].sort();
  const projectOptions = [...new Set(rows.map((r) => r.project_code).filter(Boolean))].sort();
  const teamOptions = [...new Set(rows.map((r) => r.team).filter(Boolean))].sort();
  const duidOptions = [...new Set(rows.map((r) => r.site_code).filter(Boolean))].sort();

  const filtered = rows.filter((r) => {
    if (statusFilter && r.plan_status !== statusFilter) return false;
    if (visitFilter && r.visit_type !== visitFilter) return false;
    if (projectFilter && (r.project_code || "") !== projectFilter) return false;
    if (teamFilter && (r.team || "") !== teamFilter) return false;
    if (duidFilter && (r.site_code || "") !== duidFilter) return false;
    if (fromDate && (r.plan_date || "").slice(0, 10) < fromDate) return false;
    if (toDate && (r.plan_date || "").slice(0, 10) > toDate) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        (r.name || "").toLowerCase().includes(q) ||
        (r.item_code || "").toLowerCase().includes(q) ||
        (r.item_description || "").toLowerCase().includes(q) ||
        (r.project_code || "").toLowerCase().includes(q) ||
        (r.site_name || "").toLowerCase().includes(q) ||
        (r.po_dispatch || "").toLowerCase().includes(q) ||
        (r.original_dummy_poid || "").toLowerCase().includes(q) ||
        (r.team || "").toLowerCase().includes(q) ||
        (r.plan_date || "").toLowerCase().includes(q) ||
        (r.visit_type || "").toLowerCase().includes(q) ||
        (r.center_area || "").toLowerCase().includes(q) ||
        (r.region_type || "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  const hasFilters = search || statusFilter || visitFilter || projectFilter || teamFilter || duidFilter || fromDate || toDate;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Execution Monitor</h1>
          <div className="page-subtitle">
            Today's live execution status
            {lastRefresh && (
              <span style={{ marginLeft: 8, color: "var(--text-muted)" }}>
                · Last refreshed {formatTime(lastRefresh)} · Auto-refreshes every 30s
              </span>
            )}
          </div>
        </div>
        <div className="page-actions">
          <span className="live-dot" style={{ marginRight: 4 }} />
          <button className="btn-secondary" onClick={loadData} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* ── Toolbar ─────────────────────────────────────────── */}
      <div className="toolbar">
        <input
          type="search"
          placeholder="Search POID, dummy POID, Plan, Team, Date, Center area, Region…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: "7px 14px", borderRadius: 8,
            border: "1px solid #e2e8f0", fontSize: "0.84rem", minWidth: 240,
          }}
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem" }}
        >
          <option value="">All Statuses</option>
          {STATUS_OPTIONS.filter(Boolean).map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select
          value={visitFilter}
          onChange={(e) => setVisitFilter(e.target.value)}
          style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem" }}
        >
          <option value="">All Visit Types</option>
          {visitTypes.map((vt) => (
            <option key={vt} value={vt}>{vt}</option>
          ))}
        </select>
        <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem" }}>
          <option value="">All Projects</option>
          {projectOptions.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem" }}>
          <option value="">All Teams</option>
          {teamOptions.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={duidFilter} onChange={(e) => setDuidFilter(e.target.value)} style={{ maxWidth: 200, padding: "7px 10px", borderRadius: 8, border: "1px solid #dbe3ef", fontSize: "0.84rem", background: "#fff" }}>
          <option value="">All DUIDs</option>
          {duidOptions.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem" }} />
        <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem" }} />
        {hasFilters && (
          <button
            className="btn-secondary"
            style={{ fontSize: "0.78rem", padding: "5px 12px" }}
            onClick={() => { setSearch(""); setStatusFilter(""); setVisitFilter(""); setProjectFilter(""); setTeamFilter(""); setDuidFilter(""); setFromDate(""); setToDate(""); }}
          >
            Clear
          </button>
        )}
      </div>

      <div className="page-content">
        {error && (
          <div className="notice error" style={{ marginBottom: 16 }}>
            <span>⚠</span> {error}
          </div>
        )}

        <div className="data-table-wrapper">
          {loading && rows.length === 0 ? (
            <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)" }}>
              Loading execution data…
            </div>
          ) : filtered.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📊</div>
              <h3>{hasFilters ? "No results match your filters" : "No active executions"}</h3>
              <p>
                {hasFilters
                  ? "Try adjusting your search or filter criteria."
                  : "No plans are currently Planned or In Execution."}
              </p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Plan</th>
                  <th>POID</th>
                  <th>Dummy POID</th>
                  <th>Item</th>
                  <th>Project / Site</th>
                  <th>Center area</th>
                  <th>Region</th>
                  <th>Team</th>
                  <th>Plan Date</th>
                  <th>Visit Type</th>
                  <th style={{ textAlign: "right" }}>Target</th>
                  <th style={{ textAlign: "right" }}>Achieved</th>
                  <th>Plan Status</th>
                  <th>Exec Status</th>
                  <th>Open</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const target = row.target_amount || 0;
                  const achieved = row.execution_achieved_amount || row.achieved_amount || 0;
                  const pct = target > 0
                    ? Math.round((achieved / target) * 100)
                    : 0;
                  return (
                    <tr key={row.name}>
                      <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{row.name}</td>
                      <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{row.po_dispatch || "—"}</td>
                      <td style={{ fontFamily: "monospace", fontSize: "0.72rem", maxWidth: 140 }} title={(row.original_dummy_poid || "").trim() && String(row.original_dummy_poid) !== String(row.po_dispatch || "") ? `Original dummy POID: ${row.original_dummy_poid}` : ""}>
                        {(row.original_dummy_poid || "").trim() && String(row.original_dummy_poid) !== String(row.po_dispatch || "")
                          ? (row.original_dummy_poid || "").trim()
                          : "—"}
                      </td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{row.item_code || "—"}</div>
                        <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>{row.item_description || "—"}</div>
                      </td>
                      <td>
                        <div>{row.project_code || "—"}</div>
                        <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>{row.site_name || row.site_code || "—"}</div>
                      </td>
                      <td style={{ fontSize: "0.78rem", maxWidth: 120 }} title={row.center_area || ""}>
                        {row.center_area || "—"}
                      </td>
                      <td style={{ fontSize: "0.78rem" }}>{row.region_type || "—"}</td>
                      <td>{row.team}</td>
                      <td>{row.plan_date}</td>
                      <td>{row.visit_type}</td>
                      <td style={{ textAlign: "right" }}>{fmt.format(target)}</td>
                      <td style={{ textAlign: "right" }}>
                        <span style={{ color: pct >= 80 ? "var(--green)" : pct >= 40 ? "var(--amber)" : "var(--red)" }}>
                          {fmt.format(achieved)}
                        </span>
                        <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginLeft: 4 }}>
                          ({pct}%)
                        </span>
                      </td>
                      <td>
                        <span className={`status-badge ${statusBadgeClass(row.plan_status)}`}>
                          <span className="status-dot" />
                          {row.plan_status}
                        </span>
                      </td>
                      <td>
                        <span className={`status-badge ${statusBadgeClass(row.execution_status || "Planned")}`}>
                          <span className="status-dot" />
                          {row.execution_status || "—"}
                        </span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn-secondary"
                          style={{ fontSize: "0.72rem", padding: "4px 10px" }}
                          onClick={() => setDetailRow(row)}
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={15} style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0" }}>
                    <strong>{filtered.length}</strong>
                    {hasFilters && ` of ${rows.length}`}
                    {" "}record{filtered.length !== 1 ? "s" : ""}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
      {detailRow && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setDetailRow(null)}
        >
          <div
            style={{ background: "#fff", borderRadius: 12, padding: 20, width: "min(860px, 94vw)", maxHeight: "78vh", overflow: "auto" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ margin: 0, fontSize: "1rem" }}>Execution Details</h3>
              <button type="button" onClick={() => setDetailRow(null)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8" }}>&times;</button>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              <Pill label="POID" value={detailRow.po_dispatch} tone="blue" />
              <Pill label="Plan" value={detailRow.name} tone="amber" />
              <Pill label="Exec" value={detailRow.execution_name} tone="green" />
            </div>
            <div style={{ margin: 0, fontSize: 12, background: "#f8fafc", borderRadius: 8, padding: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, borderRadius: 8, background: "#fff" }}>
                <DetailItem label="Plan ID" value={detailRow.name} />
                <DetailItem label="POID" value={detailRow.po_dispatch} />
                <DetailItem
                  label="Dummy POID"
                  value={
                    (detailRow.original_dummy_poid || "").trim() && String(detailRow.original_dummy_poid) !== String(detailRow.po_dispatch || "")
                      ? (detailRow.original_dummy_poid || "").trim()
                      : "—"
                  }
                />
                <DetailItem label="Item Code" value={detailRow.item_code} />
                <DetailItem label="Item Description" value={detailRow.item_description} />
                <DetailItem label="Project" value={detailRow.project_code} />
                <DetailItem label="Site" value={detailRow.site_name || detailRow.site_code} />
                <DetailItem label="Center area" value={detailRow.center_area} />
                <DetailItem label="Region type" value={detailRow.region_type} />
                <DetailItem label="Team" value={detailRow.team} />
                <DetailItem label="Visit Type" value={detailRow.visit_type} />
                <DetailItem label="Plan Date" value={detailRow.plan_date} />
                <DetailItem label="Execution Date" value={detailRow.execution_date} />
                <DetailItem label="Plan Status" value={detailRow.plan_status} />
                <DetailItem label="Execution Status" value={detailRow.execution_status} />
                <DetailItem label="Target (SAR)" value={fmt.format(detailRow.target_amount || 0)} />
                <DetailItem label="Achieved (SAR)" value={fmt.format(detailRow.execution_achieved_amount || detailRow.achieved_amount || 0)} />
                <DetailItem label="QC Status" value={detailRow.qc_status} />
                <DetailItem label="GPS" value={detailRow.gps_location} />
              </div>
              {parseAttachments(detailRow.photos).length > 0 && (
                <div style={{ marginTop: 12, borderRadius: 8, background: "#fff", padding: 10 }}>
                  <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>Attachments</div>
                  {parseAttachments(detailRow.photos).map((url, idx) => (
                    <div key={`${url}-${idx}`} style={{ marginBottom: 4 }}>
                      <a href={url} target="_blank" rel="noreferrer">{url}</a>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
