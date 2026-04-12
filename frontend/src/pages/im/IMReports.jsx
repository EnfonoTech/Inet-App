import { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

export default function IMReports() {
  const { imName } = useAuth();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        // Get dispatches for this IM
        const dRes = await fetch(
          `/api/resource/PO Dispatch?filters=${encodeURIComponent(JSON.stringify([["im","=",imName]]))}` +
          `&fields=${encodeURIComponent(JSON.stringify(["name","dispatch_status","line_amount","project_code"]))}` +
          `&limit_page_length=500`,
          { credentials: "include" }
        );
        const dJson = await dRes.json();
        const dispatches = dJson?.data || [];

        const totalLines = dispatches.length;
        const totalAmount = dispatches.reduce((s, d) => s + (d.line_amount || 0), 0);
        const byStatus = {};
        const byProject = {};
        for (const d of dispatches) {
          byStatus[d.dispatch_status] = (byStatus[d.dispatch_status] || 0) + 1;
          const pk = d.project_code || "(No project)";
          byProject[pk] = (byProject[pk] || 0) + (d.line_amount || 0);
        }

        setSummary({ totalLines, totalAmount, byStatus, byProject });
      } catch {
        setSummary(null);
      }
      setLoading(false);
    }
    if (imName) load();
  }, [imName]);

  if (loading) {
    return (
      <div>
        <div className="page-header"><h1 className="page-title">Reports</h1></div>
        <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Loading...</div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Reports</h1>
          <div className="page-subtitle">Performance summary for {imName}</div>
        </div>
      </div>
      <div className="page-content">
        {!summary ? (
          <div className="empty-state">
            <div className="empty-icon">📊</div>
            <h3>No data available</h3>
          </div>
        ) : (
          <>
            {/* KPI cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16, marginBottom: 24 }}>
              <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "18px 20px", borderLeft: "4px solid #3b82f6" }}>
                <div style={{ fontSize: "0.72rem", color: "#94a3b8", textTransform: "uppercase", fontWeight: 600, marginBottom: 4 }}>Total Lines</div>
                <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#1e293b" }}>{summary.totalLines}</div>
              </div>
              <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "18px 20px", borderLeft: "4px solid #22c55e" }}>
                <div style={{ fontSize: "0.72rem", color: "#94a3b8", textTransform: "uppercase", fontWeight: 600, marginBottom: 4 }}>Total Amount</div>
                <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "#1e293b" }}>SAR {fmt.format(summary.totalAmount)}</div>
              </div>
            </div>

            {/* Status Breakdown */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
              <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "20px 24px" }}>
                <h3 style={{ fontSize: "0.88rem", fontWeight: 700, marginBottom: 14, color: "#1e293b" }}>By Status</h3>
                {Object.entries(summary.byStatus).map(([status, count]) => (
                  <div key={status} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #f1f5f9" }}>
                    <span style={{ color: "#475569" }}>{status}</span>
                    <span style={{ fontWeight: 700, color: "#1e293b" }}>{count}</span>
                  </div>
                ))}
              </div>

              <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: "20px 24px" }}>
                <h3 style={{ fontSize: "0.88rem", fontWeight: 700, marginBottom: 14, color: "#1e293b" }}>Line amount by project</h3>
                {Object.entries(summary.byProject).sort((a,b) => b[1] - a[1]).map(([proj, amount]) => (
                  <div key={proj} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #f1f5f9" }}>
                    <span style={{ color: "#475569" }}>{proj}</span>
                    <span style={{ fontWeight: 700, color: "#1e293b" }}>SAR {fmt.format(amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
