import { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { pmApi } from "../../services/api";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

function statusTone(value) {
  const s = String(value || "").toLowerCase();
  if (s.includes("complete") || s.includes("approved") || s.includes("dispatched")) return { bg: "#ecfdf5", fg: "#047857" };
  if (s.includes("cancel") || s.includes("reject") || s.includes("fail")) return { bg: "#fef2f2", fg: "#b91c1c" };
  if (s.includes("progress") || s.includes("planned") || s.includes("auto")) return { bg: "#eff6ff", fg: "#1d4ed8" };
  return { bg: "#fffbeb", fg: "#b45309" };
}

function DetailItem({ label, value }) {
  const isStatus = /status|mode/i.test(label);
  const tone = statusTone(value);
  return (
    <div style={{ background: "#fff", borderRadius: 8, padding: "8px 10px" }}>
      <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>{label}</div>
      {isStatus ? (
        <span style={{ display: "inline-block", borderRadius: 999, padding: "3px 10px", fontSize: 12, fontWeight: 700, background: tone.bg, color: tone.fg }}>
          {value == null || value === "" ? "—" : String(value)}
        </span>
      ) : (
        <div style={{ fontSize: 13, color: "#0f172a", fontWeight: 500 }}>{value == null || value === "" ? "—" : String(value)}</div>
      )}
    </div>
  );
}

export default function IMPlanning() {
  const { imName } = useAuth();
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("Planned");
  const [visitFilter, setVisitFilter] = useState("");
  const [search, setSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [teamFilter, setTeamFilter] = useState("");
  const [duidFilter, setDuidFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [detailRow, setDetailRow] = useState(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await pmApi.listIMRolloutPlans(imName, statusFilter || undefined);
        setPlans(Array.isArray(res) ? res : []);
      } catch {
        setPlans([]);
      }
      setLoading(false);
    }
    load();
  }, [imName, statusFilter]);

  const visitTypes = [...new Set(plans.map((p) => p.visit_type).filter(Boolean))].sort();
  const projectOptions = [...new Set(plans.map((p) => p.project_code).filter(Boolean))].sort();
  const teamOptions = [...new Set(plans.map((p) => p.team).filter(Boolean))].sort();
  const duidOptions = [...new Set(plans.map((p) => p.site_code).filter(Boolean))].sort();

  const filtered = plans.filter((p) => {
    if (visitFilter && p.visit_type !== visitFilter) return false;
    if (projectFilter && (p.project_code || "") !== projectFilter) return false;
    if (teamFilter && (p.team || "") !== teamFilter) return false;
    if (duidFilter && (p.site_code || "") !== duidFilter) return false;
    if (fromDate && (p.plan_date || "").slice(0, 10) < fromDate) return false;
    if (toDate && (p.plan_date || "").slice(0, 10) > toDate) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        (p.name || "").toLowerCase().includes(q) ||
        (p.po_dispatch || "").toLowerCase().includes(q) ||
        (p.team || "").toLowerCase().includes(q) ||
        (p.plan_date || "").toLowerCase().includes(q) ||
        (p.visit_type || "").toLowerCase().includes(q) ||
        (p.site_code || "").toLowerCase().includes(q) ||
        (p.po_no || "").toLowerCase().includes(q) ||
        (p.center_area || "").toLowerCase().includes(q) ||
        (p.region_type || "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  const hasFilters = visitFilter || search || projectFilter || teamFilter || duidFilter || fromDate || toDate;
  const totalAmt = filtered.reduce((s, p) => s + (p.target_amount || 0), 0);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Planning</h1>
          <div className="page-subtitle">Rollout plans for your teams.</div>
        </div>

      </div>

      <div className="toolbar">
        <input
          type="search"
          placeholder="Search Plan ID, POID, DUID, PO, Team, Center area, Region…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: "7px 14px", borderRadius: 8,
            border: "1px solid #e2e8f0", fontSize: "0.84rem", minWidth: 260,
          }}
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem" }}
        >
          <option value="">All Statuses</option>
          <option value="Planned">Planned</option>
          <option value="Planning with Issue">Planning with Issue</option>
          <option value="In Execution">In Execution</option>
          <option value="Completed">Completed</option>
          <option value="Cancelled">Cancelled</option>
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
        {(hasFilters) && (
          <button
            className="btn-secondary"
            style={{ fontSize: "0.78rem", padding: "5px 12px" }}
            onClick={() => { setSearch(""); setVisitFilter(""); setProjectFilter(""); setTeamFilter(""); setDuidFilter(""); setFromDate(""); setToDate(""); }}
          >
            Clear
          </button>
        )}
      </div>

      <div className="page-content">
        <div className="data-table-wrapper">
          {loading ? (
            <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📅</div>
              <h3>{hasFilters ? "No results match your filters" : "No rollout plans yet"}</h3>
              <p>
                {hasFilters
                  ? "Try adjusting your search or filter criteria."
                  : "No plans found for your current data."}
              </p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Plan ID</th>
                  <th>POID</th>
                  <th>DUID</th>
                  <th>Center area</th>
                  <th>Region</th>
                  <th>PO</th>
                  <th>Team</th>
                  <th>Plan Date</th>
                  <th>Visit</th>
                  <th>Status</th>
                  <th style={{ textAlign: "right" }}>Target (SAR)</th>
                  <th>View</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.name}>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{p.name}</td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{p.po_dispatch || "—"}</td>
                    <td>{p.site_code || "—"}</td>
                    <td style={{ fontSize: "0.82rem", maxWidth: 120 }} title={p.center_area || ""}>
                      {p.center_area || "—"}
                    </td>
                    <td style={{ fontSize: "0.82rem" }}>{p.region_type || "—"}</td>
                    <td>{p.po_no || "—"}</td>
                    <td>{p.team}</td>
                    <td>{p.plan_date}</td>
                    <td>{p.visit_type}</td>
                    <td>
                      <span className={`status-badge ${(p.plan_status || "").toLowerCase().replace(/\s/g, "-")}`}>
                        <span className="status-dot" />
                        {p.plan_status}
                      </span>
                    </td>
                    <td style={{ textAlign: "right" }}>{fmt.format(p.target_amount || 0)}</td>
                    <td>
                      <button type="button" className="btn-secondary" style={{ fontSize: "0.72rem", padding: "4px 10px" }} onClick={() => setDetailRow(p)}>
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={11} style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", fontWeight: 700, fontSize: "0.78rem" }}>
                    {filtered.length}{hasFilters && ` of ${plans.length}`} plans
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 700, padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0" }}>
                    {fmt.format(totalAmt)}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
      {detailRow && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setDetailRow(null)}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 20, width: "min(840px, 94vw)", maxHeight: "78vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ margin: 0, fontSize: "1rem" }}>Plan Details</h3>
              <button type="button" onClick={() => setDetailRow(null)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8" }}>&times;</button>
            </div>
            <div style={{ maxHeight: "65vh", overflow: "auto", background: "#f8fafc", borderRadius: 8, padding: 12 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                <div style={{ border: "1px solid #bfdbfe", background: "#eff6ff", color: "#1d4ed8", borderRadius: 999, padding: "4px 10px", fontSize: 12, fontWeight: 700 }}>
                  POID: {detailRow.po_dispatch || "—"}
                </div>
                <div style={{ border: "1px solid #fde68a", background: "#fffbeb", color: "#b45309", borderRadius: 999, padding: "4px 10px", fontSize: 12, fontWeight: 700 }}>
                  Team: {detailRow.team || "—"}
                </div>
                <div style={{ border: "1px solid #a7f3d0", background: "#ecfdf5", color: "#047857", borderRadius: 999, padding: "4px 10px", fontSize: 12, fontWeight: 700 }}>
                  DUID: {detailRow.site_code || "—"}
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                {Object.entries(detailRow).map(([k, v]) => (
                  <DetailItem
                    key={k}
                    label={String(k).toLowerCase() === "system_id" ? "POID" : k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                    value={v}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
