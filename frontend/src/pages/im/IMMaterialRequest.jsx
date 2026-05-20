import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { pmApi } from "../../services/api";
import DataTableWrapper from "../../components/DataTableWrapper";
import SearchableSelect from "../../components/SearchableSelect";

// ─── Status ───────────────────────────────────────────────────────────────────

function statusClass(status) {
  const s = (status || "").toLowerCase().replace(/\s+/g, "-");
  if (s === "transferred" || s === "issued") return "completed";
  if (s === "pending-approval") return "in-progress";
  if (s === "rejected") return "cancelled";
  return "new";
}

function StatusBadge({ status }) {
  return (
    <span className={`status-badge ${statusClass(status)}`}>
      <span className="status-dot" />
      {status || "—"}
    </span>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

function Modal({ open, onClose, title, children, footer, width = 560 }) {
  if (!open) return null;
  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
      onClick={onClose}
    >
      <div
        style={{ background: "#fff", borderRadius: 14, width, maxWidth: "calc(100vw - 40px)", maxHeight: "calc(100dvh - 40px)", boxShadow: "0 20px 60px rgba(0,0,0,0.22)", display: "flex", flexDirection: "column", overflow: "hidden" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 22px", borderBottom: "1px solid #e2e8f0", flexShrink: 0 }}>
          <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 700 }}>{title}</h3>
          <button type="button" onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#94a3b8", lineHeight: 1 }}>&times;</button>
        </div>
        <div style={{ padding: "18px 22px", overflowY: "auto", flex: "1 1 auto", minHeight: 0 }}>
          {children}
        </div>
        {footer && (
          <div style={{ padding: "12px 22px", borderTop: "1px solid #e2e8f0", display: "flex", gap: 10, justifyContent: "flex-end", flexShrink: 0, background: "#fafbfc" }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

const inp = {
  width: "100%", padding: "8px 10px", borderRadius: 8,
  border: "1px solid #e2e8f0", fontSize: "0.86rem", boxSizing: "border-box",
  fontFamily: "inherit",
};
const label = (text, required) => (
  <label style={{ display: "block", fontSize: "0.76rem", fontWeight: 600, color: "#475569", marginBottom: 4 }}>
    {text}{required && <span style={{ color: "#ef4444", marginLeft: 2 }}>*</span>}
  </label>
);

// ─── Item type badges ─────────────────────────────────────────────────────────

function HuaweiBadge() {
  return (
    <span style={{ padding: "2px 8px", borderRadius: 999, fontSize: "0.65rem", fontWeight: 700, background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe", whiteSpace: "nowrap" }}>
      Huawei
    </span>
  );
}
function CompanyBadge() {
  return (
    <span style={{ padding: "2px 8px", borderRadius: 999, fontSize: "0.65rem", fontWeight: 700, background: "#ecfdf5", color: "#047857", border: "1px solid #6ee7b7", whiteSpace: "nowrap" }}>
      Company
    </span>
  );
}

// ─── New Request Form ─────────────────────────────────────────────────────────

function NewRequestForm({ imName, prefillDuid, onClose, onDone }) {
  // POID
  const [selectedPoid, setSelectedPoid] = useState("");
  const [poidSearch, setPoidSearch]     = useState("");
  const [poidOptions, setPoidOptions]   = useState([]);
  const [poidInfo, setPoidInfo]         = useState(null);
  const [poidLoading, setPoidLoading]   = useState(false);

  // DUID / team / IM (IM auto-fetched from POID for admin users who have no IM record)
  const [duid, setDuid]   = useState(prefillDuid || "");
  const [team, setTeam]   = useState("");
  const [teams, setTeams] = useState([]);
  const [poidIm, setPoidIm] = useState("");

  // Items — two separate lists
  const [huaweiItems, setHuaweiItems]   = useState([]);   // auto-filled from DUID receipt
  const [huaweiQtys, setHuaweiQtys]     = useState({});   // item_code → requested qty
  const [huaweiLoading, setHuaweiLoading] = useState(false);
  const [companyItems, setCompanyItems] = useState([]);   // manually added company items
  const [itemSearch, setItemSearch]     = useState("");
  const [itemOptions, setItemOptions]   = useState([]);
  const [sourceWh, setSourceWh]         = useState("");

  const [remark, setRemark] = useState("");
  const [busy, setBusy]     = useState(false);
  const [err, setErr]       = useState("");

  // Load teams + source warehouse on mount
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      pmApi.getImTeams(imName).catch(() => []),
      pmApi.getSourceWarehouse().catch(() => ""),
    ]).then(([t, sw]) => {
      if (cancelled) return;
      setTeams(Array.isArray(t) ? t : []);
      setSourceWh(sw || "");
    });
    return () => { cancelled = true; };
  }, [imName]);

  // Load Huawei items when DUID is set
  useEffect(() => {
    if (!duid) { setHuaweiItems([]); setHuaweiQtys({}); return; }
    let cancelled = false;
    setHuaweiLoading(true);
    pmApi.getDuidReceivedItems(duid)
      .then((res) => {
        if (cancelled) return;
        const list = Array.isArray(res) ? res : [];
        setHuaweiItems(list);
        // Default requested qty = received qty
        const qtys = {};
        list.forEach((i) => { qtys[i.item_code] = i.qty; });
        setHuaweiQtys(qtys);
      })
      .catch(() => { if (!cancelled) setHuaweiItems([]); })
      .finally(() => { if (!cancelled) setHuaweiLoading(false); });
    return () => { cancelled = true; };
  }, [duid]);

  // Search PO Dispatches for the IM
  useEffect(() => {
    let cancelled = false;
    pmApi.searchPoDispatches({ query: poidSearch, im: imName, limit: 30 })
      .then((r) => { if (!cancelled) setPoidOptions(Array.isArray(r) ? r : []); })
      .catch(() => { if (!cancelled) setPoidOptions([]); });
    return () => { cancelled = true; };
  }, [poidSearch, imName]);

  // Search company items
  useEffect(() => {
    let cancelled = false;
    if (!itemSearch.trim()) { setItemOptions([]); return; }
    pmApi.searchItems({ query: itemSearch, warehouse: sourceWh || undefined, limit: 20 })
      .then((r) => { if (!cancelled) setItemOptions(Array.isArray(r) ? r : []); })
      .catch(() => { if (!cancelled) setItemOptions([]); });
    return () => { cancelled = true; };
  }, [itemSearch, sourceWh]);

  async function handlePoidSelect(poidValue) {
    setSelectedPoid(poidValue);
    if (!poidValue) { setPoidInfo(null); setDuid(prefillDuid || ""); setTeam(""); setPoidIm(""); return; }
    setPoidLoading(true);
    try {
      const res = await pmApi.getPoidDetails(poidValue);
      setPoidInfo(res);
      if (res.site_code) setDuid(res.site_code);
      setTeam(res.team || "");
      // For admin users who have no IM record, fetch IM from the POID
      setPoidIm(res.im || "");
    } catch { setPoidInfo(null); }
    finally { setPoidLoading(false); }
  }

  function setCompanyItem(i, f, v) {
    setCompanyItems((p) => p.map((r, idx) => idx === i ? { ...r, [f]: v } : r));
  }

  function addCompanyItemFromSearch(item) {
    // Avoid duplicates
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

  async function submit() {
    setErr("");
    if (!selectedPoid) { setErr("Please select a POID."); return; }
    if (!team.trim()) { setErr("Please select a team."); return; }

    // Huawei items: only include those with qty > 0
    const huaweiSelected = huaweiItems
      .map((h) => ({ ...h, requestedQty: Number(huaweiQtys[h.item_code] || 0) }))
      .filter((h) => h.requestedQty > 0);

    // Company items: only include those with code + qty
    const companySelected = companyItems.filter((r) => r.item_code.trim() && Number(r.qty) > 0);

    if (!huaweiSelected.length && !companySelected.length) {
      setErr("Add at least one item to request.");
      return;
    }

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

    setBusy(true);
    try {
      await pmApi.createMaterialRequest({
        poid: selectedPoid || undefined,
        duid: duid.trim(),
        im: imName || poidIm || undefined,  // admin: IM from POID; IM user: from auth
        team,
        remark: remark.trim() || undefined,
        items: allItems,
      });
      onDone("Material request submitted successfully.");
    } catch (e) {
      setErr(e.message || "Submission failed");
      setBusy(false);
    }
  }

  const poidSelectOptions = poidOptions.map((p) => ({
    id: p.poid,
    label: p.poid + (p.project_code ? ` — ${p.project_code}` : "") + (p.site_code ? ` · ${p.site_code}` : ""),
  }));

  return (
    <div>
      {err && <div className="notice error" style={{ marginBottom: 12 }}>{err}</div>}

      {/* POID */}
      <div style={{ marginBottom: 14 }}>
        {label("POID", true)}
        <SearchableSelect
          value={selectedPoid}
          onChange={handlePoidSelect}
          onSearch={setPoidSearch}
          options={poidSelectOptions}
          placeholder="Search POID…"
          allLabel="Search POID…"
          style={{ display: "block", width: "100%" }}
          minWidth={0}
          triggerStyle={{ width: "100%", padding: "8px 28px 8px 10px", borderRadius: 8, fontSize: "0.86rem", boxSizing: "border-box" }}
          panelStyle={{ width: "100%", minWidth: 0, maxWidth: "none", right: 0 }}
        />
        {poidLoading && <div style={{ fontSize: "0.74rem", color: "#94a3b8", marginTop: 3 }}>Loading POID details…</div>}
        {poidInfo && (
          <div style={{ marginTop: 5, padding: "6px 10px", borderRadius: 6, background: "#ecfdf5", fontSize: "0.78rem", color: "#047857" }}>
            DUID: <strong>{poidInfo.site_code || "—"}</strong>
            {poidInfo.project_code && <> · Project: <strong>{poidInfo.project_code}</strong></>}
            {poidInfo.im && <> · IM: <strong>{poidInfo.im}</strong></>}
            {poidInfo.team
              ? <> · Team: <strong>{poidInfo.team}</strong> ✓</>
              : <span style={{ color: "#b45309" }}> · No rollout plan found — select team below</span>
            }
            {!imName && !poidInfo.im && (
              <span style={{ color: "#b91c1c" }}> · No IM on this POID — IM will not be set</span>
            )}
          </div>
        )}
      </div>

      {/* DUID */}
      <div style={{ marginBottom: 14 }}>
        {label("DUID")}
        <input style={{ ...inp, background: poidInfo ? "#f8fafc" : "#fff" }}
          value={duid} onChange={(e) => { if (!poidInfo) setDuid(e.target.value); }}
          readOnly={!!poidInfo} placeholder="Auto-filled from POID" />
      </div>

      {/* Team */}
      <div style={{ marginBottom: 14 }}>
        {label("Team", true)}
        <select style={inp} value={team} onChange={(e) => setTeam(e.target.value)}>
          <option value="">— Select team —</option>
          {teams.map((t) => (
            <option key={t.team_id} value={t.team_id}>{t.team_name || t.team_id}</option>
          ))}
        </select>
      </div>

      <div style={{ marginBottom: 14 }}>
        {label("Remark")}
        <textarea style={{ ...inp, resize: "vertical", minHeight: 44 }} value={remark}
          onChange={(e) => setRemark(e.target.value)} placeholder="Optional note…" />
      </div>

      {/* ── Huawei Materials (auto-filled) ── */}
      <div style={{ marginBottom: 16, padding: 14, borderRadius: 10, background: "#eff6ff", border: "1px solid #bfdbfe" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <HuaweiBadge />
          <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "#1d4ed8" }}>Huawei Materials</span>
        </div>
        {huaweiLoading ? (
          <div style={{ fontSize: "0.78rem", color: "#94a3b8" }}>Loading received items…</div>
        ) : huaweiItems.length === 0 ? (
          <div style={{ fontSize: "0.78rem", color: "#64748b" }}>
            {duid ? "No received materials found for this DUID yet." : "Select a POID or enter a DUID to see received materials."}
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
            <thead>
              <tr>
                <th style={{ padding: "5px 8px", textAlign: "left", fontWeight: 600, color: "#1d4ed8", fontSize: "0.72rem" }}>Item</th>
                <th style={{ padding: "5px 8px", textAlign: "right", fontWeight: 600, color: "#1d4ed8", fontSize: "0.72rem", width: 90 }}>Received</th>
                <th style={{ padding: "5px 8px", textAlign: "right", fontWeight: 600, color: "#1d4ed8", fontSize: "0.72rem", width: 90 }}>Request Qty</th>
                <th style={{ padding: "5px 8px", textAlign: "left", fontWeight: 600, color: "#1d4ed8", fontSize: "0.72rem", width: 60 }}>UOM</th>
              </tr>
            </thead>
            <tbody>
              {huaweiItems.map((h) => (
                <tr key={h.item_code}>
                  <td style={{ padding: "5px 8px" }}>
                    <div style={{ fontWeight: 600, color: "#0f172a" }}>{h.item_code}</div>
                    {h.item_name !== h.item_code && <div style={{ fontSize: "0.72rem", color: "#64748b" }}>{h.item_name}</div>}
                  </td>
                  <td style={{ padding: "5px 8px", textAlign: "right", color: "#475569" }}>{h.qty}</td>
                  <td style={{ padding: "5px 8px" }}>
                    <input type="number" min="0" max={h.qty}
                      style={{ ...inp, padding: "4px 6px", textAlign: "right", width: "100%", boxSizing: "border-box" }}
                      value={huaweiQtys[h.item_code] ?? h.qty}
                      onChange={(e) => setHuaweiQtys((q) => ({ ...q, [h.item_code]: e.target.value }))} />
                  </td>
                  <td style={{ padding: "5px 8px", color: "#64748b" }}>{h.uom}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Company Materials (manual select) ── */}
      <div style={{ marginBottom: 20, padding: 14, borderRadius: 10, background: "#f0fdf4", border: "1px solid #6ee7b7" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <CompanyBadge />
          <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "#047857" }}>Company Materials</span>
        </div>

        {/* Item search */}
        <div style={{ position: "relative", marginBottom: 8 }}>
          <input style={{ ...inp, borderColor: "#6ee7b7" }} value={itemSearch}
            onChange={(e) => setItemSearch(e.target.value)} placeholder="Search item code or name…" />
          {itemOptions.length > 0 && (
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
                  <div style={{ display: "flex", gap: 12, fontSize: "0.72rem", color: "#64748b" }}>
                    <span>{opt.item_name}</span>
                    {opt.actual_qty != null && (
                      <span style={{ color: opt.actual_qty > 0 ? "#047857" : "#b91c1c" }}>
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
                      <div style={{ fontSize: "0.72rem", color: "#64748b" }}>{row.item_name}</div>
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

      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="btn-primary" onClick={submit} disabled={busy}>
          {busy ? "Submitting…" : "Submit Request"}
        </button>
      </div>
    </div>
  );
}

// ─── Request Detail ───────────────────────────────────────────────────────────

function RequestDetail({ row, onClose }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    pmApi.getMaterialRequest(row.name).then((d) => {
      if (!cancelled) { setDetail(d); setLoading(false); }
    }).catch((e) => {
      if (!cancelled) { setErr(e.message || "Failed to load"); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [row.name]);

  const status = detail?.request_status || row.request_status;
  function DItem({ label: l, value }) {
    return value ? (
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: "0.7rem", color: "#94a3b8", marginBottom: 1 }}>{l}</div>
        <div style={{ fontSize: "0.86rem", color: "#0f172a", fontWeight: 500 }}>{value}</div>
      </div>
    ) : null;
  }

  return (
    <div>
      {err && <div className="notice error" style={{ marginBottom: 12 }}>{err}</div>}
      {loading ? (
        <div style={{ padding: 24, textAlign: "center", color: "#94a3b8" }}>Loading…</div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "center" }}>
            <StatusBadge status={status} />
            <span style={{ fontSize: "0.75rem", color: "#94a3b8", fontFamily: "monospace" }}>{detail?.name}</span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
            <DItem label="POID" value={detail?.poid} />
            <DItem label="DUID" value={detail?.duid} />
            <DItem label="IM" value={detail?.im} />
            <DItem label="Source Warehouse" value={detail?.source_warehouse} />
            <DItem label="Team Warehouse" value={detail?.team_warehouse} />
            {detail?.rejection_reason && <DItem label="Rejection Reason" value={detail.rejection_reason} />}
            {detail?.stock_entry_transfer && <DItem label="Transfer Entry" value={detail.stock_entry_transfer} />}
            {detail?.stock_entry_issue && <DItem label="Issue Entry" value={detail.stock_entry_issue} />}
          </div>

          {detail?.items?.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "#94a3b8", marginBottom: 6, letterSpacing: "0.05em" }}>ITEMS</div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem", border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden" }}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    <th style={{ padding: "7px 10px", textAlign: "left", fontWeight: 600, color: "#475569" }}>Item</th>
                    <th style={{ padding: "7px 10px", textAlign: "right", fontWeight: 600, color: "#475569" }}>Qty</th>
                    <th style={{ padding: "7px 10px", textAlign: "left", fontWeight: 600, color: "#475569" }}>UOM</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.items.map((item, i) => (
                    <tr key={i} style={{ borderTop: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "6px 10px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontWeight: 600 }}>{item.item_code}</span>
                          {item.valuation_rate === 0 || item.valuation_rate == null
                            ? <HuaweiBadge />
                            : <CompanyBadge />}
                        </div>
                        {item.item_name && item.item_name !== item.item_code && (
                          <div style={{ fontSize: "0.73rem", color: "#64748b" }}>{item.item_name}</div>
                        )}
                      </td>
                      <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: 600 }}>{item.qty}</td>
                      <td style={{ padding: "6px 10px", color: "#64748b" }}>{item.uom || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

        </>
      )}
    </div>
  );
}

// ─── DUID Stock Tab ───────────────────────────────────────────────────────────

function DuidStockTab({ onRequest }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState(""); // "" | "received" | "pending"

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const res = await pmApi.getDuidStockSummary();
      setRows(Array.isArray(res) ? res : []);
    } catch (e) {
      setError(e.message || "Failed to load");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const projects = [...new Set(rows.map((r) => r.project_name).filter(Boolean))].sort();

  const visible = rows.filter((r) => {
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      if (!r.duid.toLowerCase().includes(q) && !(r.project_name || "").toLowerCase().includes(q)) return false;
    }
    if (projectFilter && r.project_name !== projectFilter) return false;
    if (statusFilter === "received" && r.received_count === 0) return false;
    if (statusFilter === "pending" && r.prepared_count === 0) return false;
    return true;
  });

  const hasFilters = search.trim() || projectFilter || statusFilter;

  return (
    <>
      <div className="toolbar">
        <input type="search" placeholder="Search DUID…"
          value={search} onChange={(e) => setSearch(e.target.value)}
          style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem", minWidth: 200 }} />
        {projects.length > 0 && (
          <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}
            style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem", background: "#fff" }}>
            <option value="">All Projects</option>
            {projects.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        )}
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem", background: "#fff" }}>
          <option value="">All Status</option>
          <option value="received">Received</option>
          <option value="pending">Pending</option>
        </select>
        {hasFilters && (
          <button className="btn-secondary" style={{ fontSize: "0.78rem", padding: "5px 12px" }}
            onClick={() => { setSearch(""); setProjectFilter(""); setStatusFilter(""); }}>
            Clear
          </button>
        )}
        <span style={{ fontSize: "0.78rem", color: "#94a3b8" }}>{visible.length} DUIDs</span>
        <button className="btn-secondary" style={{ marginLeft: "auto", fontSize: "0.78rem", padding: "5px 12px" }}
          onClick={() => load(true)} disabled={refreshing}>
          {refreshing ? "…" : "Refresh"}
        </button>
      </div>

      {error && <div className="notice error" style={{ margin: "0 16px 12px" }}>{error}</div>}

      <div className="page-content">
      <DataTableWrapper>
        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Loading…</div>
        ) : visible.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📦</div>
            <h3>No INET materials found</h3>
            <p>Huawei Outbound Plans for INET subcon will appear here.</p>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>DUID</th>
                <th>Project</th>
                <th style={{ textAlign: "center" }}>Received</th>
                <th style={{ textAlign: "center" }}>Pending</th>
                <th style={{ textAlign: "right" }}>Volume (m³)</th>
                <th>Latest Date</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.duid}>
                  <td style={{ fontFamily: "monospace", fontSize: "0.8rem", fontWeight: 600 }}>{row.duid}</td>
                  <td style={{ fontSize: "0.82rem", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.project_name}>{row.project_name || "—"}</td>
                  <td style={{ textAlign: "center" }}>
                    {row.received_count > 0 ? (
                      <span style={{ padding: "2px 10px", borderRadius: 999, background: "#ecfdf5", color: "#047857", fontSize: "0.74rem", fontWeight: 700 }}>
                        {row.received_count}
                      </span>
                    ) : <span style={{ color: "#cbd5e1" }}>0</span>}
                  </td>
                  <td style={{ textAlign: "center" }}>
                    {row.prepared_count > 0 ? (
                      <span style={{ padding: "2px 10px", borderRadius: 999, background: "#fffbeb", color: "#b45309", fontSize: "0.74rem", fontWeight: 700 }}>
                        {row.prepared_count}
                      </span>
                    ) : <span style={{ color: "#cbd5e1" }}>0</span>}
                  </td>
                  <td style={{ textAlign: "right", fontFamily: "monospace", fontSize: "0.82rem" }}>{row.total_volume}</td>
                  <td style={{ fontSize: "0.78rem", color: "#64748b" }}>{row.latest_date}</td>
                  <td>
                    <button
                      type="button"
                      className="btn-primary"
                      style={{ fontSize: "0.72rem", padding: "4px 12px", whiteSpace: "nowrap" }}
                      onClick={() => onRequest(row.duid)}
                    >
                      Request
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </DataTableWrapper>
      </div>
    </>
  );
}

// ─── Requests Tab ─────────────────────────────────────────────────────────────

const ALL_STATUSES = ["Pending Approval", "Transferred", "Rejected", "Issued"];

function RequestsTab({ isAdmin, imName, refresh, onPendingCount }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [detailRow, setDetailRow] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const args = { limit: 100 };
      if (statusFilter) args.status = statusFilter;
      if (!isAdmin && imName) args.im = imName;
      const res = await pmApi.listMaterialRequests(args);
      const list = Array.isArray(res) ? res : [];
      setRows(list);
      onPendingCount?.(list.filter((r) => r.request_status === "Pending Approval").length);
    } catch (e) {
      setError(e.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [isAdmin, imName, statusFilter]);

  useEffect(() => { load(); }, [load, refresh]);

  return (
    <>
      <div className="toolbar">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid #dbe3ef", fontSize: "0.84rem", background: "#fff" }}>
          <option value="">All Statuses</option>
          {ALL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {statusFilter && (
          <button className="btn-secondary" style={{ fontSize: "0.78rem", padding: "5px 12px" }} onClick={() => setStatusFilter("")}>Clear</button>
        )}
        <button className="btn-secondary" style={{ marginLeft: "auto", fontSize: "0.78rem", padding: "5px 12px" }} onClick={load} disabled={loading}>
          {loading ? "…" : "Refresh"}
        </button>
      </div>

      {error && <div className="notice error" style={{ margin: "0 16px 12px" }}>{error}</div>}

      <div className="page-content">
      <DataTableWrapper>
        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Loading…</div>
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📋</div>
            <h3>No requests{statusFilter ? ` with status "${statusFilter}"` : ""}</h3>
            <p>Click "+ New Request" to submit your first request.</p>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Request No.</th>
                <th>Date</th>
                <th>POID</th>
                <th>DUID</th>
                {isAdmin && <th>IM</th>}
                <th>Team Warehouse</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.name}>
                  <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{row.name}</td>
                  <td style={{ fontSize: "0.82rem" }}>{row.request_date}</td>
                  <td style={{ fontSize: "0.82rem" }}>{row.poid || "—"}</td>
                  <td style={{ fontSize: "0.78rem", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis" }} title={row.duid}>{row.duid || "—"}</td>
                  {isAdmin && <td style={{ fontSize: "0.82rem" }}>{row.im || "—"}</td>}
                  <td style={{ fontSize: "0.82rem" }}>{row.team_warehouse || "—"}</td>
                  <td><StatusBadge status={row.request_status} /></td>
                  <td>
                    <button type="button" className="btn-secondary" style={{ fontSize: "0.7rem", padding: "3px 10px" }}
                      onClick={() => setDetailRow(row)}>
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </DataTableWrapper>
      </div>

      <Modal open={!!detailRow} onClose={() => setDetailRow(null)}
        title={`Request · ${detailRow?.name || ""}`} width={660}>
        {detailRow && (
          <RequestDetail row={detailRow} onClose={() => setDetailRow(null)} />
        )}
      </Modal>
    </>
  );
}

// ─── Direct Return Form (IM only) ────────────────────────────────────────────

function DirectReturnForm({ teams, onClose, onDone }) {
  const [teamId, setTeamId] = useState("");
  const [stockItems, setStockItems] = useState([]);
  const [stockLoading, setStockLoading] = useState(false);
  const [returnQtys, setReturnQtys] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function loadTeamStock(id) {
    setTeamId(id);
    setStockItems([]);
    setReturnQtys({});
    if (!id) return;
    setStockLoading(true);
    try {
      const res = await pmApi.getTeamMaterialStock(id);
      const team = (Array.isArray(res) ? res : [])[0];
      setStockItems(team?.items || []);
    } catch { setStockItems([]); }
    finally { setStockLoading(false); }
  }

  async function submit() {
    setErr("");
    const items = stockItems
      .map(it => ({ item_code: it.item_code, qty: parseFloat(returnQtys[it.item_code] || 0), uom: it.uom || "pcs" }))
      .filter(i => i.qty > 0);

    if (!teamId) { setErr("Please select a team."); return; }
    if (items.length === 0) { setErr("Enter return quantity for at least one item."); return; }

    for (const it of items) {
      const avail = Number(stockItems.find(s => s.item_code === it.item_code)?.qty || 0);
      if (it.qty > avail) {
        const name = stockItems.find(s => s.item_code === it.item_code)?.item_name || it.item_code;
        setErr(`Return qty for "${name}" (${it.qty}) exceeds available stock (${avail}).`);
        return;
      }
    }

    setBusy(true);
    try {
      const res = await pmApi.createDirectReturn({ team_id: teamId, items });
      onDone(`Materials returned to main warehouse. Stock Entry: ${res.stock_entry}`);
    } catch (e) {
      setErr(e.message || "Transfer failed.");
    } finally { setBusy(false); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <p style={{ margin: 0, fontSize: "0.84rem", color: "#475569" }}>
        Creates a Material Transfer SE directly from team warehouse → main warehouse. No approval needed.
      </p>

      <div>
        {label("Team", true)}
        <select style={inp} value={teamId} onChange={e => loadTeamStock(e.target.value)}>
          <option value="">— Select team —</option>
          {teams.map(t => <option key={t.team_id} value={t.team_id}>{t.team_name || t.team_id}</option>)}
        </select>
      </div>

      {stockLoading && (
        <div style={{ fontSize: "0.82rem", color: "#94a3b8", textAlign: "center", padding: 12 }}>Loading team stock…</div>
      )}

      {teamId && !stockLoading && stockItems.length === 0 && (
        <div style={{ fontSize: "0.82rem", color: "#94a3b8", textAlign: "center", padding: 12 }}>No stock in this team's warehouse.</div>
      )}

      {stockItems.length > 0 && (
        <div>
          {label("Items to Return")}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {stockItems.map(it => (
              <div key={it.item_code} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: returnQtys[it.item_code] > 0 ? "rgba(29,78,216,0.04)" : "var(--surface)" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: "0.84rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.item_name || it.item_code}</div>
                  <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>Available: {Number(it.qty || 0).toLocaleString()} {it.uom || "pcs"}</div>
                </div>
                <input
                  type="number" min="0" step="0.01" max={it.qty}
                  placeholder="0"
                  inputMode="decimal"
                  value={returnQtys[it.item_code] || ""}
                  onChange={e => setReturnQtys(p => ({ ...p, [it.item_code]: e.target.value }))}
                  style={{ width: 80, padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border)", fontSize: "0.86rem", textAlign: "right" }}
                />
                <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", flexShrink: 0 }}>{it.uom || "pcs"}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {err && (
        <div style={{ padding: "8px 12px", borderRadius: 8, background: "#fef2f2", color: "#dc2626", fontSize: "0.82rem", border: "1px solid #fecaca" }}>
          {err}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button type="button" className="btn-secondary" onClick={onClose} disabled={busy} style={{ fontSize: "0.84rem" }}>Cancel</button>
        <button type="button" className="btn-primary" onClick={submit} disabled={busy || !teamId || stockItems.length === 0} style={{ fontSize: "0.84rem" }}>
          {busy ? "Transferring…" : "Transfer to Main Warehouse"}
        </button>
      </div>
    </div>
  );
}

// ─── Return Requests Tab ──────────────────────────────────────────────────────

const RETURN_STATUSES = ["Pending Approval", "Transferred", "Rejected"];

function ReturnRequestsTab({ isAdmin, imName, refresh, onPendingCount, teams }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [actionRow, setActionRow] = useState(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionErr, setActionErr] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [showDirectReturn, setShowDirectReturn] = useState(false);
  const [directSuccessMsg, setDirectSuccessMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const args = { limit: 100 };
      if (statusFilter) args.status = statusFilter;
      if (!isAdmin && imName) args.im = imName;
      const res = await pmApi.listReturnRequests(args);
      const list = Array.isArray(res) ? res : [];
      setRows(list);
      onPendingCount?.(list.filter(r => r.request_status === "Pending Approval").length);
    } catch (e) {
      setError(e.message || "Failed to load");
    } finally { setLoading(false); }
  }, [isAdmin, imName, statusFilter]);

  useEffect(() => { load(); }, [load, refresh]);

  async function approve(name) {
    setActionBusy(true);
    setActionErr("");
    try {
      await pmApi.approveReturnRequest(name);
      setActionRow(null);
      load();
    } catch (e) {
      setActionErr(e.message || "Approval failed.");
    } finally { setActionBusy(false); }
  }

  async function reject(name) {
    if (!rejectReason.trim()) { setActionErr("Please enter a rejection reason."); return; }
    setActionBusy(true);
    setActionErr("");
    try {
      await pmApi.rejectReturnRequest(name, rejectReason.trim());
      setActionRow(null);
      setRejectReason("");
      load();
    } catch (e) {
      setActionErr(e.message || "Rejection failed.");
    } finally { setActionBusy(false); }
  }

  function openAction(row) {
    setActionRow(row);
    setActionErr("");
    setRejectReason("");
  }

  function handleDirectDone(msg) {
    setShowDirectReturn(false);
    setDirectSuccessMsg(msg);
    load();
    setTimeout(() => setDirectSuccessMsg(""), 6000);
  }

  return (
    <>
      <div className="toolbar">
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid #dbe3ef", fontSize: "0.84rem", background: "#fff" }}>
          <option value="">All Statuses</option>
          {RETURN_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {statusFilter && (
          <button className="btn-secondary" style={{ fontSize: "0.78rem", padding: "5px 12px" }} onClick={() => setStatusFilter("")}>Clear</button>
        )}
        <button className="btn-secondary" style={{ marginLeft: "auto", fontSize: "0.78rem", padding: "5px 12px" }} onClick={load} disabled={loading}>
          {loading ? "…" : "Refresh"}
        </button>
        <button className="btn-primary" style={{ fontSize: "0.78rem", padding: "5px 14px" }} onClick={() => setShowDirectReturn(true)}>
          + Direct Return
        </button>
      </div>

      {directSuccessMsg && (
        <div className="notice success" style={{ margin: "0 16px 12px" }}>✓ {directSuccessMsg}</div>
      )}

      {error && <div className="notice error" style={{ margin: "0 16px 12px" }}>{error}</div>}

      <div className="page-content">
      <DataTableWrapper>
        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Loading…</div>
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">↩</div>
            <h3>No return requests{statusFilter ? ` with status "${statusFilter}"` : ""}</h3>
            <p>Field teams can request to return excess materials from their stock page.</p>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Request No.</th>
                <th>Date</th>
                <th>Team</th>
                <th>Team Warehouse</th>
                {isAdmin && <th>IM</th>}
                <th>Reason</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.name}>
                  <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{row.name}</td>
                  <td style={{ fontSize: "0.82rem" }}>{row.request_date}</td>
                  <td style={{ fontSize: "0.82rem", fontWeight: 600 }}>{row.team_name || "—"}</td>
                  <td style={{ fontSize: "0.78rem", color: "#64748b" }}>{row.team_warehouse || "—"}</td>
                  {isAdmin && <td style={{ fontSize: "0.82rem" }}>{row.im || "—"}</td>}
                  <td style={{ fontSize: "0.82rem", color: "#64748b", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.reason}>{row.reason || "—"}</td>
                  <td><StatusBadge status={row.request_status} /></td>
                  <td>
                    {row.request_status === "Pending Approval" ? (
                      <button type="button" className="btn-primary" style={{ fontSize: "0.7rem", padding: "3px 10px" }}
                        onClick={() => openAction(row)}>
                        Review
                      </button>
                    ) : (
                      <button type="button" className="btn-secondary" style={{ fontSize: "0.7rem", padding: "3px 10px" }}
                        onClick={() => openAction(row)}>
                        View
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </DataTableWrapper>
      </div>

      {/* Review / view modal */}
      <Modal open={!!actionRow} onClose={() => { setActionRow(null); setActionErr(""); setRejectReason(""); }}
        title={`Return Request · ${actionRow?.name || ""}`} width={520}>
        {actionRow && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <StatusBadge status={actionRow.request_status} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 16px", fontSize: "0.84rem" }}>
              <div><span style={{ color: "#94a3b8", fontSize: "0.72rem" }}>Team</span><br /><strong>{actionRow.team_name}</strong></div>
              <div><span style={{ color: "#94a3b8", fontSize: "0.72rem" }}>Date</span><br />{actionRow.request_date}</div>
              {actionRow.team_warehouse && <div><span style={{ color: "#94a3b8", fontSize: "0.72rem" }}>Team WH</span><br />{actionRow.team_warehouse}</div>}
              {actionRow.reason && <div style={{ gridColumn: "1 / -1" }}><span style={{ color: "#94a3b8", fontSize: "0.72rem" }}>Reason</span><br />{actionRow.reason}</div>}
            </div>

            {actionRow.request_status === "Pending Approval" && (
              <>
                <div>
                  {label("Rejection reason (required to reject)")}
                  <input style={inp} value={rejectReason} onChange={e => setRejectReason(e.target.value)}
                    placeholder="Enter reason if rejecting…" disabled={actionBusy} />
                </div>
                {actionErr && <div style={{ color: "#dc2626", fontSize: "0.82rem" }}>{actionErr}</div>}
                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                  <button type="button" className="btn-secondary" style={{ color: "#dc2626", borderColor: "#fca5a5" }}
                    onClick={() => reject(actionRow.name)} disabled={actionBusy || !rejectReason.trim()}>
                    {actionBusy ? "…" : "Reject"}
                  </button>
                  <button type="button" className="btn-primary"
                    onClick={() => approve(actionRow.name)} disabled={actionBusy}>
                    {actionBusy ? "Processing…" : "Approve & Transfer"}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </Modal>

      {/* IM direct return modal */}
      <Modal open={showDirectReturn} onClose={() => setShowDirectReturn(false)}
        title="Direct Material Return" width={560}>
        <DirectReturnForm
          teams={teams}
          onClose={() => setShowDirectReturn(false)}
          onDone={handleDirectDone}
        />
      </Modal>
    </>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function IMMaterialRequest() {
  const { imName, role } = useAuth();
  const isAdmin = role === "admin";

  const [tab, setTab] = useState("requests");
  const [showNew, setShowNew] = useState(false);
  const [prefillDuid, setPrefillDuid] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingReturnCount, setPendingReturnCount] = useState(0);
  const [teams, setTeams] = useState([]);

  // Pre-load teams for the direct-return form so it doesn't need to fetch again
  useEffect(() => {
    pmApi.getImTeams(imName).then(t => setTeams(Array.isArray(t) ? t : [])).catch(() => {});
  }, [imName]);

  function switchTab(id) {
    setTab(id);
    setTimeout(() => document.dispatchEvent(new CustomEvent("tablepro:check")), 60);
  }

  function openNew(duid = "") {
    setPrefillDuid(duid);
    setShowNew(true);
  }

  function handleDone(msg) {
    setShowNew(false);
    setSuccessMsg(msg);
    setRefreshKey((k) => k + 1);
    setTab("requests");
    setTimeout(() => setSuccessMsg(""), 5000);
  }

  const TABS = [
    { id: "requests", label: "Requests", count: pendingCount },
    { id: "duid", label: "DUID Stock" },
    { id: "returns", label: "Returns", count: pendingReturnCount },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Material Requests</h1>
          <div className="page-subtitle">
            {isAdmin ? "Review and approve material transfer requests." : "Request materials from main warehouse to your team."}
          </div>
        </div>
        <div className="page-actions">
          <button className="btn-primary" onClick={() => openNew()}>+ New Request</button>
        </div>
      </div>

      {successMsg && (
        <div className="notice success" style={{ margin: "0 16px 12px" }}>
          <span>✓</span> {successMsg}
        </div>
      )}

      <div role="tablist" style={{ display: "flex", gap: 4, padding: 4, background: "#f1f5f9", borderRadius: 8, border: "1px solid #e2e8f0", margin: "0 16px 8px", width: "fit-content" }}>
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => switchTab(t.id)}
              style={{
                padding: "5px 14px", fontSize: "0.78rem", fontWeight: 700,
                border: "none", borderRadius: 6, cursor: "pointer",
                background: active ? "#1d4ed8" : "transparent",
                color: active ? "#fff" : "#475569",
                display: "inline-flex", alignItems: "center", gap: 6,
              }}
            >
              {t.label}
              {!!t.count && (
                <span style={{
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  minWidth: 18, height: 18, padding: "0 6px",
                  borderRadius: 999, fontSize: "0.66rem", fontWeight: 800,
                  background: active ? "#fff" : "#f59e0b",
                  color: active ? "#1d4ed8" : "#fff",
                }}>
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {tab === "requests" && (
        <RequestsTab isAdmin={isAdmin} imName={imName} refresh={refreshKey} onPendingCount={setPendingCount} />
      )}
      {tab === "duid" && (
        <DuidStockTab onRequest={(duid) => openNew(duid)} />
      )}
      {tab === "returns" && (
        <ReturnRequestsTab
          isAdmin={isAdmin}
          imName={imName}
          refresh={refreshKey}
          onPendingCount={setPendingReturnCount}
          teams={teams}
        />
      )}

      <Modal open={showNew} onClose={() => setShowNew(false)}
        title="New Material Request" width={640}>
        <NewRequestForm
          imName={imName}
          prefillDuid={prefillDuid}
          onClose={() => setShowNew(false)}
          onDone={handleDone}
        />
      </Modal>
    </div>
  );
}
