import { useEffect, useState } from "react";
import { pmApi } from "../services/api";
import { HuaweiBadge, CompanyBadge } from "./MaterialItemPicker";

/**
 * IM-facing "what's been dispatched for this DUID/POID" panel — for the
 * Rollout Execution (IMPlanning.jsx) and IM Dispatch detail views, where
 * the IM needs to see what material has actually gone to the team before
 * (or while) execution happens, not just what the TL later reports using.
 * Reuses get_poid_materials, which already covers both POID-specific and
 * DUID-level (no POID picked) requests.
 */
export default function PoidMaterialsDispatched({ poDispatch }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!poDispatch) { setRows([]); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    pmApi.getPoidMaterials(poDispatch)
      .then((res) => { if (!cancelled) setRows(Array.isArray(res) ? res : []); })
      .catch(() => { if (!cancelled) setRows([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [poDispatch]);

  if (loading || rows.length === 0) return null;

  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "#334155", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>
        Materials Dispatched
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #e2e8f0" }}>
              <th style={{ textAlign: "left", padding: "5px 8px", color: "#64748b", fontWeight: 600 }}>Item</th>
              <th style={{ textAlign: "right", padding: "5px 8px", color: "#64748b", fontWeight: 600 }}>Qty</th>
              <th style={{ textAlign: "right", padding: "5px 8px", color: "#64748b", fontWeight: 600 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.item_code}-${i}`} style={{ borderBottom: "1px solid #f1f5f9" }}>
                <td style={{ padding: "6px 8px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 600 }}>{r.item_code}</span>
                    {r.is_huawei ? <HuaweiBadge /> : <CompanyBadge />}
                  </div>
                  {r.item_name && r.item_name !== r.item_code && (
                    <div style={{ fontSize: "0.72rem", color: "#64748b" }}>{r.item_name}</div>
                  )}
                </td>
                <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 600, whiteSpace: "nowrap" }}>{r.qty_transferred} {r.uom || ""}</td>
                <td style={{ padding: "6px 8px", textAlign: "right" }}>
                  {r.transferred ? (
                    <span style={{ fontSize: "0.68rem", fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "#ecfdf5", color: "#047857", whiteSpace: "nowrap" }}>Transferred</span>
                  ) : (
                    <span style={{ fontSize: "0.68rem", fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "#fffbeb", color: "#b45309", whiteSpace: "nowrap" }}>Pending</span>
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
