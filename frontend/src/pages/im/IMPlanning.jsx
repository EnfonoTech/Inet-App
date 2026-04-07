import { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { pmApi } from "../../services/api";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

export default function IMPlanning() {
  const { imName } = useAuth();
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("Planned");
  const [visitFilter, setVisitFilter] = useState("");
  const [search, setSearch] = useState("");

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

  const filtered = plans.filter((p) => {
    if (visitFilter && p.visit_type !== visitFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        (p.name || "").toLowerCase().includes(q) ||
        (p.system_id || "").toLowerCase().includes(q) ||
        (p.team || "").toLowerCase().includes(q) ||
        (p.plan_date || "").toLowerCase().includes(q) ||
        (p.visit_type || "").toLowerCase().includes(q) ||
        (p.site_code || "").toLowerCase().includes(q) ||
        (p.po_no || "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  const hasFilters = visitFilter || search;
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
          placeholder="Search Plan ID, System ID, DUID, PO, Team…"
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
        {(hasFilters) && (
          <button
            className="btn-secondary"
            style={{ fontSize: "0.78rem", padding: "5px 12px" }}
            onClick={() => { setSearch(""); setVisitFilter(""); }}
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
                  <th>System ID</th>
                  <th>DUID</th>
                  <th>PO</th>
                  <th>Team</th>
                  <th>Plan Date</th>
                  <th>Visit</th>
                  <th>Status</th>
                  <th style={{ textAlign: "right" }}>Target (SAR)</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.name}>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{p.name}</td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{p.system_id}</td>
                    <td>{p.site_code || "—"}</td>
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
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={8} style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", fontWeight: 700, fontSize: "0.78rem" }}>
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
    </div>
  );
}
