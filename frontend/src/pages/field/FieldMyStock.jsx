import { useCallback, useEffect, useState } from "react";
import { pmApi } from "../../services/api";
import { useAuth } from "../../context/AuthContext";

function fmt(n) {
  return Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function StockCard({ item }) {
  const [open, setOpen] = useState(false);
  const isCustomer = item.item_type === "customer";
  const sources = (item.sources || []).filter(s => s.duid);

  return (
    <div
      className="history-card"
      style={{ borderLeftColor: isCustomer ? "var(--amber)" : "var(--blue)" }}
    >
      {/* Row 1: name + total qty */}
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

      {/* Item code */}
      <div style={{ fontFamily: "monospace", fontSize: "0.72rem", color: "var(--text-muted)", marginTop: 2 }}>
        {item.item_code}
      </div>

      {/* Type badge + expand */}
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

      {/* Expandable per-DUID actual balance */}
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

export default function FieldMyStock() {
  const { teamId } = useAuth();
  const [teamData, setTeamData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      // Pass teamId explicitly so the backend doesn't need to reverse-lookup
      // the team from frappe.session.user (which may not match field_user).
      const data = await pmApi.getTeamMaterialStock(teamId || undefined);
      setTeamData((Array.isArray(data) ? data : [])[0] || null);
      setLastUpdated(new Date());
    } catch { /* keep existing */ }
    finally { setLoading(false); setRefreshing(false); }
  }, [teamId]);

  useEffect(() => { load(); }, [load]);

  const items = teamData?.items || [];
  const filtered = search
    ? items.filter(it =>
        (it.item_name || "").toLowerCase().includes(search.toLowerCase()) ||
        (it.item_code || "").toLowerCase().includes(search.toLowerCase())
      )
    : items;

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
        <div className="page-actions">
          <button
            className="btn-secondary"
            type="button"
            onClick={() => load(true)}
            disabled={refreshing}
            style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.78rem" }}
          >
            <span style={{
              display: "inline-block",
              animation: refreshing ? "spin 0.7s linear infinite" : "none",
            }}>↻</span>
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      <div className="exec-body">

        {/* Loading skeleton */}
        {loading ? (
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
            {/* Summary chips */}
            {items.length > 0 && <SummaryBar items={items} />}

            {/* Last updated */}
            {lastUpdated && (
              <div style={{
                padding: "0 16px 6px",
                fontSize: "0.72rem",
                color: "var(--text-muted)",
              }}>
                Updated {lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </div>
            )}

            {/* Search */}
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

            {/* Cards */}
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
                <div style={{
                  textAlign: "center", marginTop: 10,
                  fontSize: "0.78rem", color: "var(--text-muted)",
                }}>
                  {filtered.length} of {items.length} items
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
