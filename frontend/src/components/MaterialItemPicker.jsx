import { useEffect, useState } from "react";
import { pmApi } from "../services/api";

// Shared with IMMaterialRequest.jsx's own request-detail/stock-balance views —
// keep this the single source of truth for how a Huawei vs Company item is
// badged, rather than each page defining its own copy.
export function HuaweiBadge() {
  return (
    <span style={{ padding: "2px 8px", borderRadius: 999, fontSize: "0.65rem", fontWeight: 700, background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe", whiteSpace: "nowrap" }}>
      Huawei
    </span>
  );
}
export function CompanyBadge() {
  return (
    <span style={{ padding: "2px 8px", borderRadius: 999, fontSize: "0.65rem", fontWeight: 700, background: "#ecfdf5", color: "#047857", border: "1px solid #6ee7b7", whiteSpace: "nowrap" }}>
      Company
    </span>
  );
}

const inp = {
  width: "100%", padding: "8px 10px", borderRadius: 8,
  border: "1px solid #e2e8f0", fontSize: "0.86rem", boxSizing: "border-box",
  fontFamily: "inherit",
};

/**
 * Item-selection half of the material request flow — Huawei materials
 * received for a DUID (auto-filled, remaining qty only) plus manually
 * searched Company items. Fires `onItemsChange` with the combined list
 * (shape matching pmApi.createMaterialRequest's `items` param) any time the
 * selection changes; the caller owns DUID/POID/team and the actual submit.
 *
 * Extracted from IMMaterialRequest.jsx's NewRequestForm so IMDispatch.jsx's
 * "create plan" flow can embed the exact same picker, one instance per DUID
 * group, without duplicating ~150 lines of fetch/state logic.
 */
export default function MaterialItemPicker({ duid, sourceWh, onItemsChange }) {
  const [huaweiItems, setHuaweiItems] = useState([]);
  const [huaweiQtys, setHuaweiQtys] = useState({});
  const [removedHuawei, setRemovedHuawei] = useState(new Set());
  const [huaweiLoading, setHuaweiLoading] = useState(false);
  const [companyItems, setCompanyItems] = useState([]);
  const [itemSearch, setItemSearch] = useState("");
  const [itemOptions, setItemOptions] = useState([]);
  const [itemFocused, setItemFocused] = useState(false);

  // Load Huawei items received for this DUID (remaining/unrequested only).
  useEffect(() => {
    if (!duid) { setHuaweiItems([]); setHuaweiQtys({}); setRemovedHuawei(new Set()); return; }
    let cancelled = false;
    setHuaweiLoading(true);
    pmApi.getDuidReceivedItems(duid)
      .then((res) => {
        if (cancelled) return;
        const list = Array.isArray(res) ? res : [];
        setHuaweiItems(list);
        setRemovedHuawei(new Set());
        // Default requested qty = received qty
        const qtys = {};
        list.forEach((i) => { qtys[i.item_code] = i.qty; });
        setHuaweiQtys(qtys);
      })
      .catch(() => { if (!cancelled) setHuaweiItems([]); })
      .finally(() => { if (!cancelled) setHuaweiLoading(false); });
    return () => { cancelled = true; };
  }, [duid]);

  // Search company items — an empty query still fetches (search_items()
  // treats "" as "no code filter", returning the first N items by code) so
  // clicking into the box with nothing typed yet shows a browsable default
  // list with stock, rather than nothing until the user starts typing.
  useEffect(() => {
    let cancelled = false;
    pmApi.searchItems({ query: itemSearch, warehouse: sourceWh || undefined, limit: 20 })
      .then((r) => { if (!cancelled) setItemOptions(Array.isArray(r) ? r : []); })
      .catch(() => { if (!cancelled) setItemOptions([]); });
    return () => { cancelled = true; };
  }, [itemSearch, sourceWh]);

  // Report the combined selection up to the caller whenever it changes.
  // onItemsChange intentionally left out of deps — callers pass an inline
  // setter, including it would just re-fire this on every parent render.
  useEffect(() => {
    const huaweiSelected = huaweiItems
      .filter((h) => !removedHuawei.has(h.item_code))
      .map((h) => ({ ...h, requestedQty: Number(huaweiQtys[h.item_code] || 0) }))
      .filter((h) => h.requestedQty > 0);
    const companySelected = companyItems.filter((r) => r.item_code.trim() && Number(r.qty) > 0);
    const allItems = [
      ...huaweiSelected.map((h) => ({
        item_code: h.item_code,
        qty: h.requestedQty,
        uom: h.uom || "Nos",
        is_huawei: true,
      })),
      ...companySelected.map((c) => ({
        item_code: c.item_code.trim(),
        qty: Number(c.qty),
        uom: c.uom.trim() || undefined,
        is_huawei: false,
      })),
    ];
    onItemsChange?.(allItems);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [huaweiItems, huaweiQtys, removedHuawei, companyItems]);

  function removeHuaweiItem(itemCode) {
    setRemovedHuawei((p) => new Set(p).add(itemCode));
  }

  function setCompanyItem(i, f, v) {
    setCompanyItems((p) => p.map((r, idx) => idx === i ? { ...r, [f]: v } : r));
  }

  function addCompanyItemFromSearch(item) {
    if (companyItems.some((r) => r.item_code === item.item_code)) return;
    setCompanyItems((p) => [...p, {
      item_code: item.item_code,
      item_name: item.item_name,
      qty: "",
      uom: item.stock_uom || "",
      actual_qty: item.actual_qty ?? null,
    }]);
    setItemSearch("");
    setItemOptions([]);
  }

  const visibleHuaweiItems = huaweiItems.filter((h) => !removedHuawei.has(h.item_code));

  return (
    <div>
      {/* ── Huawei Materials (auto-filled) ── */}
      <div style={{ marginBottom: 16, padding: 14, borderRadius: 10, background: "#eff6ff", border: "1px solid #bfdbfe" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <HuaweiBadge />
          <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "#1d4ed8" }}>Huawei Materials</span>
        </div>
        {huaweiLoading ? (
          <div style={{ fontSize: "0.78rem", color: "#94a3b8" }}>Loading received items…</div>
        ) : visibleHuaweiItems.length === 0 ? (
          <div style={{ fontSize: "0.78rem", color: "#64748b" }}>
            {duid
              ? "No remaining Huawei items to request for this DUID — all received items have already been requested."
              : "Select a DUID to see received materials."}
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
            <thead>
              <tr>
                <th style={{ padding: "5px 8px", textAlign: "left", fontWeight: 600, color: "#1d4ed8", fontSize: "0.72rem" }}>Item</th>
                <th style={{ padding: "5px 8px", textAlign: "right", fontWeight: 600, color: "#1d4ed8", fontSize: "0.72rem", width: 90 }}>Remaining</th>
                <th style={{ padding: "5px 8px", textAlign: "right", fontWeight: 600, color: "#1d4ed8", fontSize: "0.72rem", width: 90 }}>Request Qty</th>
                <th style={{ padding: "5px 8px", textAlign: "left", fontWeight: 600, color: "#1d4ed8", fontSize: "0.72rem", width: 60 }}>UOM</th>
                <th style={{ width: 28 }} />
              </tr>
            </thead>
            <tbody>
              {visibleHuaweiItems.map((h) => (
                <tr key={h.item_code}>
                  <td style={{ padding: "5px 8px" }}>
                    <div style={{ fontWeight: 600, color: "#0f172a" }}>{h.item_code}</div>
                    {h.item_name !== h.item_code && <div style={{ fontSize: "0.72rem", color: "#64748b", overflowWrap: "anywhere" }}>{h.item_name}</div>}
                  </td>
                  <td style={{ padding: "5px 8px", textAlign: "right", color: "#475569" }}>{h.qty}</td>
                  <td style={{ padding: "5px 8px" }}>
                    <input type="number" min="0" max={h.qty}
                      style={{ ...inp, padding: "4px 6px", textAlign: "right", width: "100%", boxSizing: "border-box" }}
                      value={huaweiQtys[h.item_code] ?? h.qty}
                      onChange={(e) => setHuaweiQtys((q) => ({ ...q, [h.item_code]: e.target.value }))} />
                  </td>
                  <td style={{ padding: "5px 8px", color: "#64748b" }}>{h.uom}</td>
                  <td style={{ padding: "5px 6px", textAlign: "center" }}>
                    <button type="button" title="Remove from this request" onClick={() => removeHuaweiItem(h.item_code)}
                      style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: 17, lineHeight: 1 }}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Additional Materials (manual select, company-owned stock) ── */}
      <div style={{ marginBottom: 8, padding: 14, borderRadius: 10, background: "#f0fdf4", border: "1px solid #6ee7b7" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <CompanyBadge />
          <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "#047857" }}>Additional Materials</span>
        </div>

        {/* Item search */}
        <div style={{ position: "relative", marginBottom: 8 }}>
          <input style={{ ...inp, borderColor: "#6ee7b7" }} value={itemSearch}
            onChange={(e) => setItemSearch(e.target.value)}
            onFocus={() => setItemFocused(true)}
            // Delayed so a click on a dropdown option (which blurs the
            // input first) still registers before the list disappears.
            onBlur={() => setTimeout(() => setItemFocused(false), 150)}
            placeholder="Search item code or name (or click to browse)…" />
          {itemFocused && itemOptions.length > 0 && (
            <div style={{
              position: "absolute", top: "100%", left: 0, right: 0, zIndex: 200,
              background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8,
              boxShadow: "0 4px 16px rgba(0,0,0,0.12)", maxHeight: 220, overflowY: "auto",
            }}>
              {itemOptions.map((opt) => (
                <div key={opt.item_code}
                  onClick={() => addCompanyItemFromSearch(opt)}
                  style={{ padding: "8px 12px", cursor: "pointer", borderBottom: "1px solid #f1f5f9" }}
                  onMouseEnter={(e) => e.currentTarget.style.background = "#f8fafc"}
                  onMouseLeave={(e) => e.currentTarget.style.background = "#fff"}
                >
                  <div style={{ fontWeight: 600, fontSize: "0.84rem" }}>{opt.item_code}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 12, fontSize: "0.72rem", color: "#64748b" }}>
                    <span style={{ overflowWrap: "anywhere", minWidth: 0 }}>{opt.item_name}</span>
                    {opt.actual_qty != null && (
                      <span style={{ color: opt.actual_qty > 0 ? "#047857" : "#b91c1c", whiteSpace: "nowrap" }}>
                        Stock: {opt.actual_qty} {opt.stock_uom}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {companyItems.length === 0 ? (
          <div style={{ fontSize: "0.78rem", color: "#64748b" }}>Search and select company items above.</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
            <thead>
              <tr>
                <th style={{ padding: "5px 8px", textAlign: "left", fontWeight: 600, color: "#047857", fontSize: "0.72rem" }}>Item</th>
                <th style={{ padding: "5px 8px", textAlign: "right", fontWeight: 600, color: "#047857", fontSize: "0.72rem", width: 90 }}>Qty</th>
                <th style={{ padding: "5px 8px", textAlign: "left", fontWeight: 600, color: "#047857", fontSize: "0.72rem", width: 60 }}>UOM</th>
                <th style={{ width: 30 }} />
              </tr>
            </thead>
            <tbody>
              {companyItems.map((row, i) => (
                <tr key={i} style={{ borderTop: i > 0 ? "1px solid #d1fae5" : undefined }}>
                  <td style={{ padding: "5px 8px" }}>
                    <div style={{ fontWeight: 600 }}>{row.item_code}</div>
                    {row.item_name && row.item_name !== row.item_code && (
                      <div style={{ fontSize: "0.72rem", color: "#64748b", overflowWrap: "anywhere" }}>{row.item_name}</div>
                    )}
                  </td>
                  <td style={{ padding: "5px 8px" }}>
                    <input type="number" min="0"
                      style={{ ...inp, padding: "4px 6px", textAlign: "right", width: "100%", boxSizing: "border-box", borderColor: "#6ee7b7" }}
                      value={row.qty} onChange={(e) => setCompanyItem(i, "qty", e.target.value)} placeholder="0" />
                  </td>
                  <td style={{ padding: "5px 8px" }}>
                    <input style={{ ...inp, padding: "4px 6px", borderColor: "#6ee7b7" }}
                      value={row.uom} onChange={(e) => setCompanyItem(i, "uom", e.target.value)} placeholder="Nos" />
                  </td>
                  <td style={{ padding: "5px 6px", textAlign: "center" }}>
                    <button type="button" onClick={() => setCompanyItems((p) => p.filter((_, j) => j !== i))}
                      style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: 17, lineHeight: 1 }}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
