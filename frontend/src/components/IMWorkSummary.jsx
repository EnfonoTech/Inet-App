import { useCallback, useEffect, useState } from "react";
import { pmApi } from "../services/api";
import MiniTable from "./MiniTable";
import { money } from "../utils/numberFormat";

const fmtDec = new Intl.NumberFormat("en", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/**
 * "My Work Summary" — the bundle the IM Reports page used to BE, before that
 * page became a catalog: PO dispatch counts, project totals, mode breakdown,
 * rollout plans, month-to-date executions and work done.
 *
 * Kept, and moved here rather than dropped: it is the only view of these
 * particular figures the IM has, and the catalog's other reports answer
 * different questions. It is already IM-scoped server-side — get_im_reports()
 * resolves the IM from the session, same as every endpoint in
 * api/im_reports.py.
 *
 * ONE SECTION PER RENDER, chosen by `section`. These four used to be a tab
 * strip inside this component, which put a THIRD row of tabs under the
 * catalog's own category tabs and report chips — three layers to read before
 * reaching any data. Each section is now its own catalog entry, so the chips
 * ARE this choice: two layers, the same as every other report, and each
 * section gets its own ?tab= deep link.
 *
 * The Commercial tab that used to sit alongside these is likewise its own
 * entry (key "commercial"), which is what keeps Rollout Planning's
 * "View commercial report" deep link working.
 */
export default function IMWorkSummary({ imName, section = "overview" }) {
  const activeTab = section;
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
      // Cached: all four sections read ONE payload, and each is now a
      // separate catalog entry, so moving between them remounts this
      // component. Without the cache that is a fresh identical round trip
      // per click, where the old in-component tab strip fetched once.
      setPayload(await pmApi.getIMReports());
    } catch (e) {
      setPayload(null);
      setError(e.message || "Could not load reports");
    } finally {
      setLoading(false);
    }
  }, [imName]);

  useEffect(() => { load(); }, [load]);

  // Each section's MiniTables mount fresh whenever the catalog switches to a
  // different entry, so React swaps the whole .data-table-wrapper subtree in
  // one go and DataTablePro's own tbody observer never sees it. The in-
  // component tab strip used to nudge it on click; now that the sections are
  // separate catalog entries, the nudge belongs here — once the rows this
  // section renders actually exist. Same pattern as switchTab() in
  // IMMaterialRequest.jsx.
  useEffect(() => {
    if (!payload) return undefined;
    const t = setTimeout(() => document.dispatchEvent(new CustomEvent("tablepro:check")), 60);
    return () => clearTimeout(t);
  }, [payload, section]);

  const ds = payload?.dispatch_summary;

  if (error) {
    return (
      <div className="page-content">
        <div className="notice error"><span>⚠</span> {error}</div>
      </div>
    );
  }
  if (!imName) {
    return (
      <div className="page-content">
        <div className="empty-state">
          <div className="empty-icon">📊</div>
          <h3>IM account not linked</h3>
          <p style={{ color: "#64748b", fontSize: "0.88rem", maxWidth: 460, margin: "8px auto 0" }}>
            Sign in with an INET IM user linked to IM Master, or open My Dashboard to verify setup.
          </p>
        </div>
      </div>
    );
  }
  if (!payload) {
    return (
      <div style={{ padding: 48, textAlign: "center", color: "#94a3b8" }}>
        {loading ? "Loading summary…" : "No data returned"}
      </div>
    );
  }

  return (
    <div className="page-content">
          {activeTab === "overview" && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16, marginBottom: 22 }}>
                <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "18px 20px", borderLeft: "4px solid #3b82f6" }}>
                  <div style={{ fontSize: "0.72rem", color: "#94a3b8", textTransform: "uppercase", fontWeight: 600, marginBottom: 4 }}>PO lines</div>
                  <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#1e293b" }}>{ds?.total_lines ?? 0}</div>
                </div>
                <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "18px 20px", borderLeft: "4px solid #22c55e" }}>
                  <div style={{ fontSize: "0.72rem", color: "#94a3b8", textTransform: "uppercase", fontWeight: 600, marginBottom: 4 }}>Line amount (sum)</div>
                  <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#1e293b" }}>SAR {money.format(ds?.total_amount ?? 0)}</div>
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
                          <span style={{ fontWeight: 700 }}>SAR {money.format(v)}</span>
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
                  resizable
                  tableKey="im-reports-rollout-status"
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
                  resizable
                  tableKey="im-reports-recent-plans"
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
                  resizable
                  tableKey="im-reports-execution-status"
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
                  resizable
                  tableKey="im-reports-recent-executions"
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
                  <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#1e293b" }}>{money.format(payload.work_done_mtd?.revenue_sar ?? 0)}</div>
                </div>
              </div>
              <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "16px 18px" }}>
                <h3 style={{ fontSize: "0.88rem", fontWeight: 700, marginBottom: 12, color: "#1e293b" }}>By billing status</h3>
                <MiniTable
                  resizable
                  tableKey="im-reports-billing-status"
                  columns={[
                    { label: "Billing", key: "billing" },
                    { label: "Rows", key: "count", align: "right" },
                    { label: "Revenue SAR", key: "revenue_sar", align: "right", render: (v) => money.format(Number(v) || 0) },
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
  );
}
