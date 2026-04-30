import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { pmApi } from "../../services/api";
import MiniTable from "../../components/MiniTable";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });
const fmtDec = new Intl.NumberFormat("en", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

const TABS = [
  { key: "overview", label: "PO dispatches" },
  { key: "rollouts", label: "Rollout plans" },
  { key: "executions", label: "Executions (MTD)" },
  { key: "work_done", label: "Work done (MTD)" },
  { key: "projects", label: "Projects" },
];

export default function IMReports() {
  const { imName } = useAuth();
  const [activeTab, setActiveTab] = useState("overview");
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!imName) {
      setPayload(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await pmApi.getIMReports();
      setPayload(res);
    } catch (e) {
      setPayload(null);
      setError(e.message || "Could not load reports");
    } finally {
      setLoading(false);
    }
  }, [imName]);

  useEffect(() => {
    load();
  }, [load]);

  const ds = payload?.dispatch_summary;
  const period = payload?.period;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Reports</h1>
          <div className="page-subtitle">
            {imName ? (
              <>
                Scope: <strong>{payload?.im || imName}</strong>
                {period?.from && period?.to && (
                  <span style={{ color: "#64748b", fontWeight: 400 }}>
                    {" "}
                    · MTD {period.from} → {period.to}
                  </span>
                )}
              </>
            ) : (
              "IM account not linked"
            )}
          </div>
        </div>
        <div className="page-actions">
          <button type="button" className="btn-secondary" onClick={load} disabled={loading || !imName}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {error && (
        <div className="notice error" style={{ margin: "0 28px 16px" }}>
          <span>⚠</span> {error}
        </div>
      )}

      {!imName ? (
        <div className="page-content">
          <div className="empty-state">
            <div className="empty-icon">📊</div>
            <h3>IM account not linked</h3>
            <p style={{ color: "#64748b", fontSize: "0.88rem", maxWidth: 460, margin: "8px auto 0" }}>
              Sign in with an INET IM user linked to IM Master, or open My Dashboard to verify setup.
            </p>
          </div>
        </div>
      ) : loading ? (
        <div style={{ padding: 48, textAlign: "center", color: "#94a3b8" }}>Loading reports…</div>
      ) : !payload ? (
        <div className="page-content">
          <div className="empty-state">
            <div className="empty-icon">📊</div>
            <h3>No data returned</h3>
          </div>
        </div>
      ) : (
        <div className="page-content">
          <div className="tabs" style={{ marginBottom: 18 }}>
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                className={`tab ${activeTab === t.key ? "active" : ""}`}
                onClick={() => setActiveTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {activeTab === "overview" && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16, marginBottom: 22 }}>
                <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "18px 20px", borderLeft: "4px solid #3b82f6" }}>
                  <div style={{ fontSize: "0.72rem", color: "#94a3b8", textTransform: "uppercase", fontWeight: 600, marginBottom: 4 }}>PO lines</div>
                  <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#1e293b" }}>{ds?.total_lines ?? 0}</div>
                </div>
                <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "18px 20px", borderLeft: "4px solid #22c55e" }}>
                  <div style={{ fontSize: "0.72rem", color: "#94a3b8", textTransform: "uppercase", fontWeight: 600, marginBottom: 4 }}>Line amount (sum)</div>
                  <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#1e293b" }}>SAR {fmt.format(ds?.total_amount ?? 0)}</div>
                </div>
                <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "18px 20px", borderLeft: "4px solid #6366f1" }}>
                  <div style={{ fontSize: "0.72rem", color: "#94a3b8", textTransform: "uppercase", fontWeight: 600, marginBottom: 4 }}>Active teams</div>
                  <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#1e293b" }}>{(payload.teams || []).length}</div>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, alignItems: "start" }}>
                <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "16px 18px" }}>
                  <h3 style={{ fontSize: "0.88rem", fontWeight: 700, marginBottom: 12, color: "#1e293b" }}>By dispatch status</h3>
                  {Object.keys(ds?.by_status || {}).length === 0 ? (
                    <p style={{ color: "#94a3b8", fontSize: "0.82rem", margin: 0 }}>No rows.</p>
                  ) : (
                    Object.entries(ds.by_status).map(([k, v]) => (
                      <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #f1f5f9", fontSize: "0.84rem" }}>
                        <span style={{ color: "#475569" }}>{k}</span>
                        <span style={{ fontWeight: 700 }}>{v}</span>
                      </div>
                    ))
                  )}
                </div>
                <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "16px 18px" }}>
                  <h3 style={{ fontSize: "0.88rem", fontWeight: 700, marginBottom: 12, color: "#1e293b" }}>By project (amount)</h3>
                  {Object.keys(ds?.by_project || {}).length === 0 ? (
                    <p style={{ color: "#94a3b8", fontSize: "0.82rem", margin: 0 }}>No rows.</p>
                  ) : (
                    Object.entries(ds.by_project)
                      .sort((a, b) => b[1] - a[1])
                      .map(([k, v]) => (
                        <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #f1f5f9", fontSize: "0.84rem" }}>
                          <span style={{ color: "#475569" }}>{k}</span>
                          <span style={{ fontWeight: 700 }}>SAR {fmt.format(v)}</span>
                        </div>
                      ))
                  )}
                </div>
                <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "16px 18px" }}>
                  <h3 style={{ fontSize: "0.88rem", fontWeight: 700, marginBottom: 12, color: "#1e293b" }}>By dispatch mode</h3>
                  {Object.keys(ds?.by_dispatch_mode || {}).length === 0 ? (
                    <p style={{ color: "#94a3b8", fontSize: "0.82rem", margin: 0 }}>No rows.</p>
                  ) : (
                    Object.entries(ds.by_dispatch_mode).map(([k, v]) => (
                      <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #f1f5f9", fontSize: "0.84rem" }}>
                        <span style={{ color: "#475569" }}>{k}</span>
                        <span style={{ fontWeight: 700 }}>{v}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          )}

          {activeTab === "rollouts" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "16px 18px" }}>
                <h3 style={{ fontSize: "0.88rem", fontWeight: 700, marginBottom: 12, color: "#1e293b" }}>Plans by status (all dates)</h3>
                <MiniTable
                  columns={[
                    { label: "Status", key: "status_key" },
                    { label: "Count", key: "cnt", align: "right" },
                  ]}
                  rows={payload.rollout_status_counts || []}
                  emptyText="No rollout plans for your teams."
                />
              </div>
              <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "16px 18px" }}>
                <h3 style={{ fontSize: "0.88rem", fontWeight: 700, marginBottom: 12, color: "#1e293b" }}>Recent plans (latest 80)</h3>
                <MiniTable
                  columns={[
                    { label: "Plan", key: "name" },
                    { label: "Date", key: "plan_date" },
                    { label: "Status", key: "plan_status" },
                    { label: "Team", key: "team_name" },
                    { label: "POID", key: "po_dispatch" },
                    { label: "Visit", key: "visit_type" },
                    { label: "Target", key: "target_amount", align: "right", render: (v) => fmtDec.format(Number(v) || 0) },
                  ]}
                  rows={payload.rollouts_recent || []}
                  emptyText="No rollout rows."
                />
              </div>
            </div>
          )}

          {activeTab === "executions" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "16px 18px" }}>
                <h3 style={{ fontSize: "0.88rem", fontWeight: 700, marginBottom: 12, color: "#1e293b" }}>Executions by status (MTD)</h3>
                <MiniTable
                  columns={[
                    { label: "Status", key: "status_key" },
                    { label: "Count", key: "cnt", align: "right" },
                  ]}
                  rows={payload.execution_status_counts || []}
                  emptyText="No executions this month."
                />
              </div>
              <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "16px 18px" }}>
                <h3 style={{ fontSize: "0.88rem", fontWeight: 700, marginBottom: 12, color: "#1e293b" }}>Recent executions (MTD, latest 60)</h3>
                <MiniTable
                  columns={[
                    { label: "Execution", key: "name" },
                    { label: "Date", key: "execution_date" },
                    { label: "Status", key: "execution_status" },
                    { label: "QC", key: "qc_status" },
                    { label: "Plan", key: "rollout_plan" },
                    { label: "POID", key: "po_dispatch" },
                  ]}
                  rows={payload.executions_recent || []}
                  emptyText="No execution rows."
                />
              </div>
            </div>
          )}

          {activeTab === "work_done" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16 }}>
                <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "18px 20px", borderLeft: "4px solid #0ea5e9" }}>
                  <div style={{ fontSize: "0.72rem", color: "#94a3b8", textTransform: "uppercase", fontWeight: 600, marginBottom: 4 }}>Work done rows (MTD)</div>
                  <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#1e293b" }}>{payload.work_done_mtd?.count ?? 0}</div>
                </div>
                <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "18px 20px", borderLeft: "4px solid #22c55e" }}>
                  <div style={{ fontSize: "0.72rem", color: "#94a3b8", textTransform: "uppercase", fontWeight: 600, marginBottom: 4 }}>Revenue SAR (MTD)</div>
                  <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#1e293b" }}>{fmt.format(payload.work_done_mtd?.revenue_sar ?? 0)}</div>
                </div>
              </div>
              <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "16px 18px" }}>
                <h3 style={{ fontSize: "0.88rem", fontWeight: 700, marginBottom: 12, color: "#1e293b" }}>By billing status</h3>
                <MiniTable
                  columns={[
                    { label: "Billing", key: "billing" },
                    { label: "Rows", key: "count", align: "right" },
                    { label: "Revenue SAR", key: "revenue_sar", align: "right", render: (v) => fmt.format(Number(v) || 0) },
                  ]}
                  rows={Object.entries(payload.work_done_mtd?.by_billing || {}).map(([billing, o]) => ({
                    billing,
                    count: o.count,
                    revenue_sar: o.revenue_sar,
                  }))}
                  emptyText="No work done this month."
                />
              </div>
            </div>
          )}

          {activeTab === "projects" && (
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "16px 18px" }}>
              <h3 style={{ fontSize: "0.88rem", fontWeight: 700, marginBottom: 12, color: "#1e293b" }}>Projects (IM on PCC)</h3>
              <MiniTable
                columns={[
                  { label: "Code", key: "project_code" },
                  { label: "Name", key: "project_name" },
                  { label: "Status", key: "status" },
                  { label: "Completion %", key: "completion_pct", align: "right", render: (v) => `${Number(v) || 0}%` },
                  { label: "Budget SAR", key: "budget", align: "right", render: (v) => fmt.format(Number(v) || 0) },
                  { label: "Actual SAR", key: "actual_cost", align: "right", render: (v) => fmt.format(Number(v) || 0) },
                ]}
                rows={payload.projects || []}
                emptyText="No projects linked to this IM."
              />
            </div>
          )}

          {payload.last_updated && (
            <p style={{ fontSize: "0.72rem", color: "#94a3b8", marginTop: 20 }}>
              Last updated: {(() => {
                const d = new Date(String(payload.last_updated).replace(" ", "T"));
                return Number.isNaN(d.getTime())
                  ? String(payload.last_updated)
                  : d.toLocaleString();
              })()}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
