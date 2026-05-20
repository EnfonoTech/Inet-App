import { useCallback, useEffect, useState } from "react";
import { pmApi } from "../../services/api";
import { useAuth } from "../../context/AuthContext";

function fmt(n) {
  return Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

// ─── Return status helper ────────────────────────────────────────────────────

function returnStatusClass(status) {
  const s = (status || "").toLowerCase().replace(/\s+/g, "-");
  if (s === "transferred") return "completed";
  if (s === "pending-approval") return "in-progress";
  if (s === "rejected") return "cancelled";
  return "new";
}

function ReturnStatusBadge({ status }) {
  return (
    <span className={`status-badge ${returnStatusClass(status)}`} style={{ fontSize: "0.72rem" }}>
      <span className="status-dot" />
      {status || "—"}
    </span>
  );
}

// ─── Stock card ──────────────────────────────────────────────────────────────

function StockCard({ item }) {
  const [open, setOpen] = useState(false);
  const isCustomer = item.item_type === "customer";
  const sources = (item.sources || []).filter(s => s.duid);

  return (
    <div
      className="history-card"
      style={{ borderLeftColor: isCustomer ? "var(--amber)" : "var(--blue)" }}
    >
      <div className="history-card-row">
        <div style={{ fontWeight: 700, fontSize: "0.88rem", color: "var(--text)" }}>
          {item.item_name || item.item_code}
        </div>
        <span style={{ fontSize: "1.4rem", fontWeight: 800, color: "var(--text)", lineHeight: 1 }}>
          {fmt(item.qty)}
          <span style={{ fontSize: "0.72rem", fontWeight: 600, color: "var(--text-muted)", marginLeft: 4 }}>
            {item.uom || "pcs"}
          </span>
        </span>
      </div>

      <div style={{ fontFamily: "monospace", fontSize: "0.72rem", color: "var(--text-muted)", marginTop: 2 }}>
        {item.item_code}
      </div>

      <div className="history-card-meta" style={{ marginTop: 7, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{
          fontSize: "0.68rem", fontWeight: 700, padding: "2px 8px", borderRadius: 999,
          background: isCustomer ? "rgba(245,158,11,0.12)" : "rgba(59,130,246,0.12)",
          color: isCustomer ? "#b45309" : "#1d4ed8",
        }}>
          {isCustomer ? "Huawei" : "Company (INET)"}
        </span>

        {sources.length > 0 && (
          <button type="button" onClick={() => setOpen(o => !o)} style={{
            background: "none", border: "none", cursor: "pointer", padding: 0,
            fontSize: "0.72rem", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 3,
          }}>
            {open ? "▲ hide" : `▼ ${sources.length} DUID${sources.length > 1 ? "s" : ""}`}
          </button>
        )}
      </div>

      {open && sources.length > 0 && (
        <div style={{
          marginTop: 8, padding: "8px 10px",
          background: "rgba(0,0,0,0.03)", borderRadius: 6,
          display: "flex", flexDirection: "column", gap: 5,
        }}>
          {sources.map((s, i) => (
            <div key={i} style={{ fontSize: "0.78rem", display: "flex", flexWrap: "wrap", gap: "3px 14px", alignItems: "center" }}>
              {s.poid && (
                <span style={{ color: "var(--text-muted)" }}>
                  POID: <strong style={{ color: "var(--text)", fontFamily: "monospace" }}>{s.poid}</strong>
                </span>
              )}
              <span style={{ color: "var(--text-muted)" }}>
                DUID: <strong style={{ color: "var(--text)", fontFamily: "monospace" }}>{s.duid}</strong>
              </span>
              <span style={{ color: "var(--text-muted)" }}>
                Balance: <strong style={{ color: "var(--text)" }}>{s.qty} {s.uom}</strong>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryBar({ items }) {
  const totalQty = items.reduce((s, it) => s + Number(it.qty || 0), 0);
  return (
    <div className="today-summary-bar">
      <div className="today-chip today-chip--total">
        <span className="today-chip-value">{items.length}</span>
        <span className="today-chip-label">Items</span>
      </div>
      <div className="today-chip today-chip--planned">
        <span className="today-chip-dot" style={{ background: "var(--blue)" }} />
        <span className="today-chip-value">{fmt(totalQty)}</span>
        <span className="today-chip-label">Total Qty</span>
      </div>
    </div>
  );
}

// ─── Return request form (modal) ─────────────────────────────────────────────

function ReturnForm({ items, teamId, onClose, onDone }) {
  const [selected, setSelected] = useState(() => {
    const m = {};
    items.forEach(it => { m[it.item_code] = { checked: false, qty: "", uom: it.uom || "pcs" }; });
    return m;
  });
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  function toggle(ic) {
    setSelected(p => ({
      ...p,
      [ic]: { ...p[ic], checked: !p[ic].checked, qty: !p[ic].checked ? String(items.find(i => i.item_code === ic)?.qty || "") : p[ic].qty },
    }));
  }

  function setQty(ic, v) {
    setSelected(p => ({ ...p, [ic]: { ...p[ic], qty: v } }));
  }

  async function submit() {
    setErr("");
    const returnItems = items
      .filter(it => selected[it.item_code]?.checked)
      .map(it => ({
        item_code: it.item_code,
        qty: parseFloat(selected[it.item_code]?.qty || 0),
        uom: it.uom || "pcs",
      }))
      .filter(i => i.qty > 0);

    if (returnItems.length === 0) {
      setErr("Select at least one item with quantity > 0.");
      return;
    }

    for (const it of returnItems) {
      const avail = Number(items.find(i => i.item_code === it.item_code)?.qty || 0);
      if (it.qty > avail) {
        const name = items.find(i => i.item_code === it.item_code)?.item_name || it.item_code;
        setErr(`Return qty for "${name}" (${it.qty}) exceeds available stock (${avail}).`);
        return;
      }
    }

    setBusy(true);
    try {
      const res = await pmApi.createReturnRequest({ team_id: teamId, items: returnItems, reason });
      onDone(`Return request ${res.name} submitted. Awaiting IM approval.`);
    } catch (e) {
      setErr(e.message || "Failed to submit return request.");
    } finally {
      setBusy(false);
    }
  }

  const checkedCount = items.filter(it => selected[it.item_code]?.checked).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <p style={{ margin: 0, fontSize: "0.84rem", color: "var(--text-muted)" }}>
        Select items to return to the main warehouse. Your IM will review and approve.
      </p>

      {/* Item list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {items.map(it => {
          const sel = selected[it.item_code] || {};
          return (
            <div key={it.item_code} style={{
              padding: "10px 12px", borderRadius: 8,
              border: `1.5px solid ${sel.checked ? "#1d4ed8" : "var(--border)"}`,
              background: sel.checked ? "rgba(29,78,216,0.04)" : "var(--surface)",
            }}>
              <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
                <input type="checkbox" checked={!!sel.checked} onChange={() => toggle(it.item_code)}
                  style={{ marginTop: 3, cursor: "pointer", accentColor: "#1d4ed8", flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: "0.84rem" }}>
                    {it.item_name || it.item_code}
                  </div>
                  <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", fontFamily: "monospace" }}>
                    {it.item_code} · Available: {fmt(it.qty)} {it.uom || "pcs"}
                  </div>
                </div>
                {sel.checked && (
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    max={it.qty}
                    value={sel.qty}
                    onChange={e => setQty(it.item_code, e.target.value)}
                    onClick={e => e.stopPropagation()}
                    placeholder="Qty"
                    inputMode="decimal"
                    style={{
                      width: 80, padding: "6px 8px", borderRadius: 6,
                      border: "1px solid var(--border)", fontSize: "0.86rem",
                      textAlign: "right", flexShrink: 0,
                    }}
                  />
                )}
              </label>
            </div>
          );
        })}
      </div>

      {/* Reason */}
      <div>
        <label style={{ display: "block", fontSize: "0.76rem", fontWeight: 600, color: "#475569", marginBottom: 4 }}>
          Reason (optional)
        </label>
        <textarea
          rows={2}
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="e.g. Excess materials after job completion"
          style={{
            width: "100%", padding: "8px 10px", borderRadius: 8,
            border: "1px solid var(--border)", fontSize: "0.84rem",
            fontFamily: "inherit", resize: "vertical", boxSizing: "border-box",
          }}
        />
      </div>

      {err && (
        <div style={{ padding: "8px 12px", borderRadius: 8, background: "#fef2f2", color: "#dc2626", fontSize: "0.82rem", border: "1px solid #fecaca" }}>
          {err}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}
          style={{ fontSize: "0.84rem", padding: "7px 16px" }}>
          Cancel
        </button>
        <button type="button" className="btn-primary" onClick={submit} disabled={busy || checkedCount === 0}
          style={{ fontSize: "0.84rem", padding: "7px 16px" }}>
          {busy ? "Submitting…" : `Submit Return (${checkedCount} item${checkedCount !== 1 ? "s" : ""})`}
        </button>
      </div>
    </div>
  );
}

// ─── Return request history ──────────────────────────────────────────────────

function ReturnHistory({ refresh }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await pmApi.listReturnRequests({ limit: 20 });
      setRows(Array.isArray(res) ? res : []);
    } catch { setRows([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load, refresh]);

  if (loading) return (
    <div className="history-card" style={{ textAlign: "center", color: "var(--text-muted)", fontSize: "0.82rem", padding: 18 }}>
      Loading return requests…
    </div>
  );

  if (rows.length === 0) return (
    <div style={{ textAlign: "center", color: "var(--text-muted)", fontSize: "0.82rem", padding: "16px 0" }}>
      No return requests yet.
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {rows.map(r => (
        <div key={r.name} className="history-card" style={{ borderLeftColor: returnStatusClass(r.request_status) === "completed" ? "var(--green)" : returnStatusClass(r.request_status) === "cancelled" ? "var(--red, #ef4444)" : "var(--amber)" }}>
          <div className="history-card-row">
            <span style={{ fontFamily: "monospace", fontSize: "0.78rem", fontWeight: 600 }}>{r.name}</span>
            <ReturnStatusBadge status={r.request_status} />
          </div>
          <div style={{ fontSize: "0.76rem", color: "var(--text-muted)", marginTop: 4 }}>
            {r.request_date}
            {r.reason && <span style={{ marginLeft: 8 }}>· {r.reason}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function FieldMyStock() {
  const { teamId } = useAuth();
  const [tab, setTab] = useState("stock");
  const [teamData, setTeamData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [search, setSearch] = useState("");
  const [showReturn, setShowReturn] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [returnRefresh, setReturnRefresh] = useState(0);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const data = await pmApi.getTeamMaterialStock(teamId || undefined);
      setTeamData((Array.isArray(data) ? data : [])[0] || null);
      setLastUpdated(new Date());
    } catch { /* keep existing */ }
    finally { setLoading(false); setRefreshing(false); }
  }, [teamId]);

  useEffect(() => { load(); }, [load]);

  function handleReturnDone(msg) {
    setShowReturn(false);
    setSuccessMsg(msg);
    setReturnRefresh(k => k + 1);
    setTab("returns");
    load(true);
    setTimeout(() => setSuccessMsg(""), 6000);
  }

  const items = teamData?.items || [];
  const filtered = search
    ? items.filter(it =>
        (it.item_name || "").toLowerCase().includes(search.toLowerCase()) ||
        (it.item_code || "").toLowerCase().includes(search.toLowerCase())
      )
    : items;

  const tabStyle = (key) => ({
    padding: "9px 18px",
    fontSize: "0.84rem",
    fontWeight: tab === key ? 700 : 500,
    color: tab === key ? "#2563eb" : "#64748b",
    background: "none",
    border: "none",
    borderBottom: tab === key ? "2px solid #2563eb" : "2px solid transparent",
    cursor: "pointer",
    marginBottom: -1,
  });

  return (
    <div className="exec-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Materials</h1>
          <div className="page-subtitle">
            {teamData
              ? `${teamData.team_name || teamData.team_id} · ${teamData.warehouse || "—"}`
              : "Current stock in your team's warehouse"}
          </div>
        </div>
        <div className="page-actions" style={{ display: "flex", gap: 8 }}>
          {tab === "stock" && items.length > 0 && (
            <button
              className="btn-primary"
              type="button"
              onClick={() => setShowReturn(true)}
              style={{ fontSize: "0.78rem" }}
            >
              Return Materials
            </button>
          )}
          {tab === "stock" && (
            <button
              className="btn-secondary"
              type="button"
              onClick={() => load(true)}
              disabled={refreshing}
              style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.78rem" }}
            >
              <span style={{ display: "inline-block", animation: refreshing ? "spin 0.7s linear infinite" : "none" }}>↻</span>
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", borderBottom: "1px solid var(--border)", padding: "0 16px" }}>
        <button type="button" style={tabStyle("stock")} onClick={() => setTab("stock")}>Stock</button>
        <button type="button" style={tabStyle("returns")} onClick={() => setTab("returns")}>Return Requests</button>
      </div>

      <div className="exec-body">

        {successMsg && (
          <div style={{
            margin: "0 16px 10px",
            padding: "10px 14px", borderRadius: 8,
            background: "#ecfdf5", color: "#047857",
            border: "1px solid #6ee7b7", fontSize: "0.84rem",
          }}>
            ✓ {successMsg}
          </div>
        )}

        {/* Stock tab */}
        {tab === "stock" && (
          loading ? (
            <div className="exec-section">
              {[1, 2, 3].map(i => (
                <div key={i} className="history-card" style={{ marginBottom: 10 }}>
                  <div className="skeleton-line" style={{ width: "60%", height: 14, marginBottom: 8 }} />
                  <div className="skeleton-line" style={{ width: "25%", height: 22 }} />
                </div>
              ))}
            </div>
          ) : !teamData ? (
            <div className="exec-section">
              <div className="empty-state">
                <div className="empty-icon">📦</div>
                <h3>No team found</h3>
                <p>Your account isn't linked to an active team warehouse. Contact your IM.</p>
              </div>
            </div>
          ) : (
            <>
              {items.length > 0 && <SummaryBar items={items} />}

              {lastUpdated && (
                <div style={{ padding: "0 16px 6px", fontSize: "0.72rem", color: "var(--text-muted)" }}>
                  Updated {lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </div>
              )}

              {items.length > 5 && (
                <div style={{ padding: "0 16px 10px" }}>
                  <input
                    type="search"
                    className="exec-field input"
                    placeholder="Search by item name or code…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    style={{
                      width: "100%", boxSizing: "border-box",
                      padding: "9px 14px", borderRadius: 10,
                      border: "1px solid var(--border)", fontSize: "0.88rem",
                      background: "var(--surface)",
                    }}
                  />
                </div>
              )}

              <div className="exec-section" style={{ paddingTop: 4 }}>
                {filtered.length === 0 ? (
                  <div className="empty-state" style={{ padding: "24px 0" }}>
                    <div className="empty-icon">🔍</div>
                    <h3>{search ? "No items match" : "No materials in stock"}</h3>
                    {search && <p>Try a different search term.</p>}
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {filtered.map(it => <StockCard key={it.item_code} item={it} />)}
                  </div>
                )}
                {search && filtered.length > 0 && (
                  <div style={{ textAlign: "center", marginTop: 10, fontSize: "0.78rem", color: "var(--text-muted)" }}>
                    {filtered.length} of {items.length} items
                  </div>
                )}
              </div>
            </>
          )
        )}

        {/* Return requests tab */}
        {tab === "returns" && (
          <div className="exec-section">
            <ReturnHistory refresh={returnRefresh} />
          </div>
        )}
      </div>

      {/* Return form modal */}
      {showReturn && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "flex-end", justifyContent: "center", padding: "0 0 0 0" }}
          onClick={() => setShowReturn(false)}
        >
          <div
            style={{
              background: "#fff", borderRadius: "14px 14px 0 0", width: "100%", maxWidth: 560,
              maxHeight: "90dvh", display: "flex", flexDirection: "column", overflow: "hidden",
              boxShadow: "0 -8px 40px rgba(0,0,0,0.18)",
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ padding: "16px 18px 12px", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
              <span style={{ fontWeight: 700, fontSize: "0.96rem" }}>Return Materials</span>
              <button type="button" onClick={() => setShowReturn(false)}
                style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#94a3b8", lineHeight: 1 }}>
                &times;
              </button>
            </div>
            <div style={{ padding: "14px 18px", overflowY: "auto", flex: "1 1 auto", minHeight: 0 }}>
              <ReturnForm
                items={items}
                teamId={teamId}
                onClose={() => setShowReturn(false)}
                onDone={handleReturnDone}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
