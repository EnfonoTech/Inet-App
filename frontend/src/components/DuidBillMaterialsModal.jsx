import { useEffect, useState } from "react";
import { pmApi } from "../services/api";
import Modal from "./Modal";

function ReceiptStatusBadge({ status }) {
  if (status === "Received") {
    return (
      <span style={{ fontSize: "0.68rem", fontWeight: 700, padding: "2px 9px", borderRadius: 999, background: "#ecfdf5", color: "#047857", whiteSpace: "nowrap" }}>
        Received
      </span>
    );
  }
  if (status === "Draft") {
    return (
      <span style={{ fontSize: "0.68rem", fontWeight: 700, padding: "2px 9px", borderRadius: 999, background: "#fffbeb", color: "#b45309", whiteSpace: "nowrap" }}>
        Incoming (Draft)
      </span>
    );
  }
  return (
    <span style={{ fontSize: "0.68rem", fontWeight: 700, padding: "2px 9px", borderRadius: 999, background: "#f1f5f9", color: "#94a3b8", whiteSpace: "nowrap" }}>
      Not Received
    </span>
  );
}

/**
 * Shared "click a DUID to see its bills" popup — per-bill item breakdown
 * with bill_no, used by both IMMaterialRequest.jsx's DUID Stock tab and
 * IMDispatch.jsx's material-dispatch DUID groups. A bill whose Material
 * Receipt is still Draft is included and flagged "Incoming (Draft)" rather
 * than omitted, since that material physically exists but hasn't been
 * confirmed into the warehouse yet.
 */
export default function DuidBillMaterialsModal({ duid, onClose }) {
  const [bills, setBills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!duid) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    pmApi.getDuidBillMaterials(duid)
      .then((res) => { if (!cancelled) setBills(Array.isArray(res) ? res : []); })
      .catch((e) => { if (!cancelled) setError(e.message || "Failed to load"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [duid]);

  return (
    <Modal open={!!duid} onClose={onClose} title={`Bills — ${duid}`} width={920}>
      {loading ? (
        <div style={{ padding: 24, textAlign: "center", color: "#94a3b8" }}>Loading…</div>
      ) : error ? (
        <div className="notice error">{error}</div>
      ) : bills.length === 0 ? (
        <div style={{ padding: 20, textAlign: "center", color: "#94a3b8", fontSize: "0.84rem" }}>
          No bills found for this DUID.
        </div>
      ) : (
        bills.map((b) => (
          <div key={b.bill_no} style={{ border: "1px solid #e2e8f0", borderRadius: 8, marginBottom: 10, overflow: "hidden" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "8px 12px", background: "#f8fafc" }}>
              <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700, fontSize: "0.82rem" }}>{b.bill_no}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: "0.72rem", color: "#64748b" }}>{b.outbound_date}</span>
                <ReceiptStatusBadge status={b.receipt_status} />
              </span>
            </div>
            {b.items.length > 0 ? (
              <table style={{ width: "100%", tableLayout: "fixed", borderCollapse: "collapse", fontSize: "0.8rem" }}>
                <colgroup>
                  <col style={{ width: "auto" }} />
                  <col style={{ width: 80 }} />
                  <col style={{ width: 90 }} />
                  <col style={{ width: 80 }} />
                  <col style={{ width: 100 }} />
                  <col style={{ width: 55 }} />
                </colgroup>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "5px 10px", fontSize: "0.7rem", color: "#94a3b8" }}>Item</th>
                    <th style={{ textAlign: "right", padding: "5px 10px", fontSize: "0.7rem", color: "#94a3b8" }}>Received</th>
                    <th style={{ textAlign: "right", padding: "5px 10px", fontSize: "0.7rem", color: "#94a3b8" }}>Transferred</th>
                    <th style={{ textAlign: "right", padding: "5px 10px", fontSize: "0.7rem", color: "#94a3b8" }}>Used</th>
                    <th style={{ textAlign: "right", padding: "5px 10px", fontSize: "0.7rem", color: "#94a3b8" }}>Left (Main WH)</th>
                    <th style={{ textAlign: "left", padding: "5px 10px", fontSize: "0.7rem", color: "#94a3b8" }}>UOM</th>
                  </tr>
                </thead>
                <tbody>
                  {b.items.map((it) => (
                    <tr key={it.item_code} style={{ borderTop: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "5px 10px", overflowWrap: "anywhere" }}>
                        <div style={{ fontWeight: 600 }}>{it.item_code}</div>
                        {it.item_name && it.item_name !== it.item_code && (
                          <div style={{ fontSize: "0.7rem", color: "#64748b", overflowWrap: "anywhere" }}>{it.item_name}</div>
                        )}
                      </td>
                      <td style={{ padding: "5px 10px", textAlign: "right", fontWeight: 600 }}>{it.received_qty}</td>
                      <td style={{ padding: "5px 10px", textAlign: "right", color: "#1d4ed8" }}>{it.transferred_qty}</td>
                      <td style={{ padding: "5px 10px", textAlign: "right", color: "#047857" }}>{it.issued_qty}</td>
                      <td style={{ padding: "5px 10px", textAlign: "right", color: it.remaining_main_qty > 0 ? "#b45309" : "#94a3b8", fontWeight: it.remaining_main_qty > 0 ? 700 : 400 }}>
                        {it.remaining_main_qty}
                      </td>
                      <td style={{ padding: "5px 10px", color: "#64748b" }}>{it.uom}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div style={{ padding: "8px 12px", fontSize: "0.76rem", color: "#94a3b8" }}>
                Not yet received — no Material Receipt created for this bill.
              </div>
            )}
          </div>
        ))
      )}
    </Modal>
  );
}
