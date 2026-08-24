import { useEffect, useState } from "react";
import { pmApi } from "../services/api";
import { HuaweiBadge, CompanyBadge } from "./MaterialItemPicker";

function IssueStatusPill({ qtyUsed, qtyIssued, issueDocstatus }) {
  const used = Number(qtyUsed) || 0;
  const issued = Number(qtyIssued) || 0;
  if (used <= 0) return null;
  if (issued >= used && issued > 0) {
    return <span style={{ fontSize: "0.68rem", fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "#ecfdf5", color: "#047857", whiteSpace: "nowrap" }}>Issued</span>;
  }
  if (issued > 0) {
    return <span style={{ fontSize: "0.68rem", fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "#fffbeb", color: "#b45309", whiteSpace: "nowrap" }}>Partially Issued</span>;
  }
  // Nothing issued yet: normal if a Draft is still staged (TL hasn't
  // marked the work Completed) — that's expected, not a problem. Only
  // flag it red when there's no draft at all despite qty_used > 0, which
  // means something actually went wrong.
  if (issueDocstatus === 0) {
    return <span style={{ fontSize: "0.68rem", fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "#eff6ff", color: "#1d4ed8", whiteSpace: "nowrap" }}>Draft — awaiting completion</span>;
  }
  return <span style={{ fontSize: "0.68rem", fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "#fef2f2", color: "#b91c1c", whiteSpace: "nowrap" }}>Not Issued</span>;
}

/**
 * IM/PM-facing view of what a TL reported using on an execution, and
 * whether it was actually stocked out (issue_material_for_execution runs
 * silently inside update_execution — this is the only place that surfaces
 * the result). "Not Issued" with qty_used > 0 is a real signal something
 * needs attention: it means the delta was never issued, most commonly
 * because the row was added/edited directly on the Daily Execution record
 * outside the normal TL-submit flow.
 */
export default function ExecutionMaterialUsage({ execution }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!execution) { setRows([]); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    pmApi.getExecutionMaterialUsage(execution)
      .then((res) => { if (!cancelled) setRows(Array.isArray(res) ? res : []); })
      .catch(() => { if (!cancelled) setRows([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [execution]);

  if (loading) return null;
  if (rows.length === 0) return null;

  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "#334155", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>
        Materials Used
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #e2e8f0" }}>
              <th style={{ textAlign: "left", padding: "5px 8px", color: "#64748b", fontWeight: 600 }}>Item</th>
              <th style={{ textAlign: "right", padding: "5px 8px", color: "#64748b", fontWeight: 600 }}>Used</th>
              <th style={{ textAlign: "right", padding: "5px 8px", color: "#64748b", fontWeight: 600 }}>Issued</th>
              <th style={{ textAlign: "left", padding: "5px 8px", color: "#64748b", fontWeight: 600 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.item_code}-${i}`} style={{ borderBottom: "1px solid #f1f5f9" }}>
                <td style={{ padding: "6px 8px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontWeight: 600 }}>{r.item_code}</span>
                    {r.is_huawei ? <HuaweiBadge /> : <CompanyBadge />}
                  </div>
                  {r.item_name && r.item_name !== r.item_code && (
                    <div style={{ fontSize: "0.72rem", color: "#64748b" }}>{r.item_name}</div>
                  )}
                </td>
                <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 600 }}>{r.qty_used} {r.uom || ""}</td>
                <td style={{ padding: "6px 8px", textAlign: "right", color: "#64748b" }}>{r.qty_issued || 0} {r.uom || ""}</td>
                <td style={{ padding: "6px 8px", textAlign: "right" }}>
                  <IssueStatusPill qtyUsed={r.qty_used} qtyIssued={r.qty_issued} issueDocstatus={r.issue_docstatus} />
                  {r.material_issue && (
                    <div style={{ fontSize: "0.68rem", color: "#94a3b8", fontFamily: "monospace", marginTop: 2 }}>{r.material_issue}</div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
