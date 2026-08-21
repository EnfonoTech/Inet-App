import { useCallback, useEffect, useState } from "react";
import { pmApi } from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import Modal from "../../components/Modal";

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
        <div style={{ fontWeight: 700, fontSize: "0.88rem", color: "var(--text)", fontFamily: "monospace" }}>
          {item.item_code}
        </div>
        <span style={{ fontSize: "1.4rem", fontWeight: 800, color: "var(--text)", lineHeight: 1 }}>
          {fmt(item.qty)}
          <span style={{ fontSize: "0.72rem", fontWeight: 600, color: "var(--text-muted)", marginLeft: 4 }}>
            {item.uom || "pcs"}
          </span>
        </span>
      </div>

      {item.item_name && item.item_name !== item.item_code && (
        <div style={{ fontSize: "0.78rem", fontWeight: 400, color: "var(--text-muted)", marginTop: 2 }}>
          {item.item_name}
        </div>
      )}

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

// ─── Return request detail modal ────────────────────────────────────────────

function ReturnDetailSheet({ row, onClose, onActioned }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [actionErr, setActionErr] = useState("");

  useEffect(() => {
    if (!row) return;
    setLoading(true);
    setShowReject(false);
    setRejectReason("");
    setActionErr("");
    pmApi.getMaterialRequest(row.name)
      .then(d => setDetail(d))
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }, [row?.name]);

  if (!row) return null;

  const needsMyApproval = row.is_direct_return_by_im && row.request_status === "Pending Approval";

  async function approve() {
    setBusy(true);
    setActionErr("");
    try {
      await pmApi.approveReturnRequest(row.name);
      onActioned?.(`${row.name} approved — the Warehouse Manager will confirm receipt next.`);
    } catch (e) {
      setActionErr(e.message || "Approval failed.");
      setBusy(false);
    }
  }

  async function reject() {
    if (!rejectReason.trim()) { setActionErr("Please enter a reason."); return; }
    setBusy(true);
    setActionErr("");
    try {
      await pmApi.rejectReturnRequest(row.name, rejectReason.trim());
      onActioned?.(`${row.name} rejected.`);
    } catch (e) {
      setActionErr(e.message || "Rejection failed.");
      setBusy(false);
    }
  }

  const borderColor = returnStatusClass(row.request_status) === "completed" ? "var(--green)" : returnStatusClass(row.request_status) === "cancelled" ? "var(--red, #ef4444)" : "var(--amber)";

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}
      onClick={onClose}
    >
      <div
        style={{ background: "#fff", borderRadius: "14px 14px 0 0", width: "100%", maxWidth: 560, maxHeight: "80dvh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 -8px 40px rgba(0,0,0,0.18)" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: "16px 18px 12px", borderBottom: "1px solid #e2e8f0", borderTop: `3px solid ${borderColor}`, display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
          <div>
            <div style={{ fontFamily: "monospace", fontSize: "0.84rem", fontWeight: 700, color: "#1e40af" }}>{row.name}</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
              <ReturnStatusBadge status={row.request_status} />
              <span style={{ fontSize: "0.74rem", color: "#64748b" }}>{row.request_date}</span>
            </div>
          </div>
          <button type="button" onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#94a3b8", lineHeight: 1 }}>&times;</button>
        </div>

        {/* Body */}
        <div style={{ overflowY: "auto", flex: "1 1 auto", padding: "14px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
          {row.reason && (
            <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "8px 12px", fontSize: "0.82rem", color: "#78350f" }}>
              <span style={{ fontWeight: 600 }}>Reason: </span>{row.reason}
            </div>
          )}

          {detail?.items?.length ? (
            <div>
              <div style={{ fontSize: "0.74rem", fontWeight: 700, color: "#475569", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                Items · {detail.items.length}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {detail.items.map((it, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: "0.84rem", fontWeight: 600, color: "#0f172a" }}>{it.item_name || it.item_code}</div>
                      <div style={{ fontSize: "0.72rem", color: "#64748b", fontFamily: "monospace", marginTop: 1 }}>{it.item_code}</div>
                    </div>
                    <div style={{ fontWeight: 800, fontSize: "1rem", color: "#1d4ed8", flexShrink: 0, marginLeft: 12 }}>
                      {fmt(it.qty)} <span style={{ fontSize: "0.72rem", fontWeight: 600, color: "#64748b" }}>{it.uom || "pcs"}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : loading ? (
            <div style={{ textAlign: "center", padding: "24px 0", color: "#94a3b8", fontSize: "0.84rem" }}>Loading items…</div>
          ) : (
            <div style={{ textAlign: "center", padding: "16px 0", color: "#94a3b8", fontSize: "0.84rem" }}>No item details available.</div>
          )}

          {detail && (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {detail.im_full_name && (
                <div style={{ flex: "1 1 120px", background: "#f8fafc", borderRadius: 8, padding: "8px 10px" }}>
                  <div style={{ fontSize: "0.7rem", color: "#64748b", marginBottom: 2 }}>IM</div>
                  <div style={{ fontSize: "0.82rem", fontWeight: 600 }}>{detail.im_full_name}</div>
                </div>
              )}
              {detail.team_warehouse && (
                <div style={{ flex: "1 1 120px", background: "#f8fafc", borderRadius: 8, padding: "8px 10px" }}>
                  <div style={{ fontSize: "0.7rem", color: "#64748b", marginBottom: 2 }}>From Warehouse</div>
                  <div style={{ fontSize: "0.78rem", fontWeight: 600, fontFamily: "monospace" }}>{detail.team_warehouse}</div>
                </div>
              )}
            </div>
          )}

          {needsMyApproval && (
            <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: "0.8rem", color: "#1e40af", marginBottom: 10 }}>
                Your IM initiated this return on your team's behalf. Approve only if you agree to release these materials back to the main warehouse.
              </div>

              {actionErr && (
                <div style={{ marginBottom: 8, padding: "6px 10px", borderRadius: 6, background: "#fef2f2", color: "#dc2626", fontSize: "0.78rem" }}>
                  {actionErr}
                </div>
              )}

              {showReject ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <input
                    value={rejectReason}
                    onChange={e => setRejectReason(e.target.value)}
                    placeholder="Reason for declining…"
                    disabled={busy}
                    style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid var(--border)", fontSize: "0.84rem" }}
                  />
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <button type="button" className="btn-secondary" style={{ fontSize: "0.84rem", padding: "9px 18px" }}
                      onClick={() => { setShowReject(false); setActionErr(""); }} disabled={busy}>
                      Cancel
                    </button>
                    <button type="button" className="btn-secondary" style={{ fontSize: "0.84rem", padding: "9px 18px", color: "#dc2626", borderColor: "#fca5a5" }}
                      onClick={reject} disabled={busy || !rejectReason.trim()}>
                      {busy ? "…" : "Confirm Decline"}
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button type="button" className="btn-secondary" style={{ fontSize: "0.84rem", padding: "9px 18px", color: "#dc2626", borderColor: "#fca5a5" }}
                    onClick={() => setShowReject(true)} disabled={busy}>
                    Reject
                  </button>
                  <button type="button" className="btn-primary" style={{ fontSize: "0.84rem", padding: "9px 18px" }}
                    onClick={approve} disabled={busy}>
                    {busy ? "Approving…" : "Approve Release"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Incoming transfers (staged outbound — Team Lead confirms/rejects) ──────

function IncomingTransferCard({ row, onOpen }) {
  const items = row.items || [];
  const totalQty = items.reduce((s, it) => s + Number(it.qty || 0), 0);
  return (
    <div className="history-card" style={{ borderLeftColor: "var(--amber)", cursor: "pointer" }} onClick={() => onOpen(row)}>
      <div className="history-card-row">
        <span style={{ fontFamily: "monospace", fontSize: "0.78rem", fontWeight: 700 }}>{row.name}</span>
        <span style={{ fontSize: "0.74rem", color: "var(--text-muted)" }}>{row.request_date}</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 14px", marginTop: 3, fontSize: "0.76rem", color: "var(--text-muted)" }}>
        {row.duid && <span>DUID: <strong style={{ color: "#0f172a" }}>{row.duid}</strong></span>}
        {row.poid && <span>POID: {row.poid}</span>}
      </div>
      <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: "0.82rem" }}>
          {items.length} item{items.length !== 1 ? "s" : ""} · <strong>{fmt(totalQty)}</strong> qty
        </span>
        <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "#2563eb" }}>View & Confirm →</span>
      </div>
    </div>
  );
}

function IncomingTransferDetailModal({ row, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");

  // Reset per-open state whenever a different (or no) row is shown.
  useEffect(() => { setShowReject(false); setReason(""); setErr(""); setBusy(false); }, [row]);

  async function confirm() {
    setBusy(true);
    setErr("");
    try {
      await pmApi.confirmMaterialTransfer(row.name);
      onDone(`${row.name} confirmed — materials added to your stock.`);
    } catch (e) {
      setErr(e.message || "Confirmation failed.");
      setBusy(false);
    }
  }

  async function reject() {
    if (!reason.trim()) { setErr("Please enter a reason."); return; }
    setBusy(true);
    setErr("");
    try {
      await pmApi.rejectMaterialTransferConfirmation(row.name, reason.trim());
      onDone(`${row.name} declined — sent back to the Warehouse Manager.`);
    } catch (e) {
      setErr(e.message || "Rejection failed.");
      setBusy(false);
    }
  }

  return (
    <Modal open={!!row} onClose={onClose} title={row?.name || ""} width={560}>
      {row && (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 18px", marginBottom: 12, fontSize: "0.82rem", color: "#475569" }}>
            {row.duid && <span>DUID: <strong style={{ color: "#0f172a" }}>{row.duid}</strong></span>}
            {row.poid && <span>POID: <strong style={{ color: "#0f172a" }}>{row.poid}</strong></span>}
            <span>Date: <strong style={{ color: "#0f172a" }}>{row.request_date}</strong></span>
          </div>

          <table style={{ width: "100%", tableLayout: "fixed", borderCollapse: "collapse", fontSize: "0.82rem" }}>
            <colgroup>
              <col style={{ width: "auto" }} />
              <col style={{ width: 75 }} />
              <col style={{ width: 55 }} />
            </colgroup>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "5px 8px", fontSize: "0.7rem", color: "#94a3b8" }}>Item</th>
                <th style={{ textAlign: "right", padding: "5px 8px", fontSize: "0.7rem", color: "#94a3b8" }}>Qty</th>
                <th style={{ textAlign: "left", padding: "5px 8px", fontSize: "0.7rem", color: "#94a3b8" }}>UOM</th>
              </tr>
            </thead>
            <tbody>
              {(row.items || []).map((it, i) => (
                <tr key={i} style={{ borderTop: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "5px 8px", overflowWrap: "anywhere" }}>
                    <div style={{ fontWeight: 600 }}>{it.item_code}</div>
                    {it.item_name && it.item_name !== it.item_code && (
                      <div style={{ fontSize: "0.72rem", color: "#64748b" }}>{it.item_name}</div>
                    )}
                  </td>
                  <td style={{ padding: "5px 8px", textAlign: "right", fontWeight: 600 }}>{fmt(it.qty)}</td>
                  <td style={{ padding: "5px 8px", color: "#64748b" }}>{it.uom || "pcs"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {err && (
            <div style={{ marginTop: 10, padding: "6px 10px", borderRadius: 6, background: "#fef2f2", color: "#dc2626", fontSize: "0.78rem" }}>
              {err}
            </div>
          )}

          {showReject ? (
            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
              <input
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="Reason for declining…"
                disabled={busy}
                style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid var(--border)", fontSize: "0.84rem" }}
              />
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button type="button" className="btn-secondary" style={{ fontSize: "0.84rem", padding: "9px 18px" }}
                  onClick={() => { setShowReject(false); setErr(""); }} disabled={busy}>
                  Cancel
                </button>
                <button type="button" className="btn-secondary" style={{ fontSize: "0.84rem", padding: "9px 18px", color: "#dc2626", borderColor: "#fca5a5" }}
                  onClick={reject} disabled={busy || !reason.trim()}>
                  {busy ? "…" : "Confirm Decline"}
                </button>
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 14, display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="btn-secondary" style={{ fontSize: "0.84rem", padding: "9px 18px", color: "#dc2626", borderColor: "#fca5a5" }}
                onClick={() => setShowReject(true)} disabled={busy}>
                Decline
              </button>
              <button type="button" className="btn-primary" style={{ fontSize: "0.84rem", padding: "9px 18px" }}
                onClick={confirm} disabled={busy}>
                {busy ? "Confirming…" : "Confirm Receipt"}
              </button>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

function IncomingTransfers({ refresh, onCount, onDone }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openRow, setOpenRow] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await pmApi.listPendingTeamConfirmations();
      const list = Array.isArray(res) ? res : [];
      setRows(list);
      onCount?.(list.length);
    } catch { setRows([]); }
    finally { setLoading(false); }
  }, [onCount]);

  useEffect(() => { load(); }, [load, refresh]);

  function handleDone(msg) {
    setOpenRow(null);
    onDone(msg);
    load();
  }

  return (
    <>
      {rows.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {rows.map(r => <IncomingTransferCard key={r.name} row={r} onOpen={setOpenRow} />)}
        </div>
      ) : loading ? (
        <div className="history-card" style={{ textAlign: "center", color: "var(--text-muted)", fontSize: "0.82rem", padding: 18 }}>
          Loading incoming transfers…
        </div>
      ) : (
        <div className="empty-state" style={{ padding: "24px 0" }}>
          <div className="empty-icon">📥</div>
          <h3>Nothing awaiting confirmation</h3>
          <p>Transfers the Warehouse Manager stages for your team will show up here for you to confirm before stock moves.</p>
        </div>
      )}

      <IncomingTransferDetailModal row={openRow} onClose={() => setOpenRow(null)} onDone={handleDone} />
    </>
  );
}

// ─── Return request history ──────────────────────────────────────────────────

function ReturnHistory({ refresh, onDone }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await pmApi.listReturnRequests({ limit: 50 });
      setRows(Array.isArray(res) ? res : []);
    } catch { setRows([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load, refresh]);

  function handleActioned(msg) {
    setSelected(null);
    onDone?.(msg);
    load();
  }

  if (rows.length === 0 && loading) return (
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
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map(r => {
          const sc = returnStatusClass(r.request_status);
          const needsMyApproval = r.is_direct_return_by_im && r.request_status === "Pending Approval";
          return (
            <button
              key={r.name}
              type="button"
              onClick={() => setSelected(r)}
              style={{ all: "unset", display: "block", cursor: "pointer" }}
            >
              <div className="history-card" style={{ borderLeftColor: needsMyApproval ? "#1d4ed8" : sc === "completed" ? "var(--green)" : sc === "cancelled" ? "var(--red, #ef4444)" : "var(--amber)" }}>
                <div className="history-card-row">
                  <span style={{ fontFamily: "monospace", fontSize: "0.78rem", fontWeight: 600 }}>{r.name}</span>
                  <ReturnStatusBadge status={r.request_status} />
                </div>
                <div style={{ fontSize: "0.76rem", color: "var(--text-muted)", marginTop: 4 }}>
                  {r.request_date}
                  {r.reason && <span style={{ marginLeft: 8 }}>· {r.reason}</span>}
                </div>
                {needsMyApproval ? (
                  <div style={{ fontSize: "0.72rem", color: "#1d4ed8", fontWeight: 700, marginTop: 4 }}>Needs your approval →</div>
                ) : (
                  <div style={{ fontSize: "0.72rem", color: "#3b82f6", marginTop: 4 }}>Tap to view items →</div>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <ReturnDetailSheet row={selected} onClose={() => setSelected(null)} onActioned={handleActioned} />
    </>
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
  const [incomingRefresh, setIncomingRefresh] = useState(0);
  const [incomingCount, setIncomingCount] = useState(0);

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

  function handleIncomingDone(msg) {
    setSuccessMsg(msg);
    setIncomingRefresh(k => k + 1);
    load(true);
    setTimeout(() => setSuccessMsg(""), 6000);
  }

  function handleReturnActioned(msg) {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(""), 6000);
  }

  const items = teamData?.items || [];
  const totalQty = items.reduce((s, it) => s + Number(it.qty || 0), 0);
  const filtered = search
    ? items.filter(it =>
        (it.item_name || "").toLowerCase().includes(search.toLowerCase()) ||
        (it.item_code || "").toLowerCase().includes(search.toLowerCase())
      )
    : items;

  const tabStyle = (key) => ({
    padding: "8px 14px",
    fontSize: "0.83rem",
    fontWeight: tab === key ? 700 : 500,
    color: tab === key ? "#2563eb" : "#64748b",
    background: "none",
    border: "none",
    borderBottom: tab === key ? "2px solid #2563eb" : "2px solid transparent",
    cursor: "pointer",
    marginBottom: -1,
    whiteSpace: "nowrap",
  });

  return (
    <div className="exec-page" style={{ paddingBottom: 80 }}>
      {/* Sticky header — title + stats + actions + tabs */}
      <div style={{
        position: "sticky", top: 0, zIndex: 39,
        background: "var(--bg, #fff)",
        borderBottom: "1px solid var(--border, #e2e8f0)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px 6px" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 800 }}>My Stock</h2>
            {!loading && teamData && (
              <div style={{ fontSize: "0.76rem", color: "#64748b", marginTop: 1 }}>
                {items.length > 0
                  ? <><strong style={{ color: "#0f172a" }}>{items.length}</strong> items · <strong style={{ color: "#0f172a" }}>{fmt(totalQty)}</strong> qty{lastUpdated ? ` · Updated ${lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}</>
                  : "No materials in stock"
                }
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
            {items.length > 0 && (
              <button className="btn-primary" type="button" onClick={() => setShowReturn(true)} style={{ fontSize: "0.84rem", fontWeight: 700, padding: "9px 16px", borderRadius: 9 }}>
                Return
              </button>
            )}
            {tab === "stock" && (
              <button className="btn-secondary" type="button" onClick={() => load(true)} disabled={refreshing} style={{ fontSize: "0.78rem", padding: "6px 10px" }}>
                <span style={{ display: "inline-block", animation: refreshing ? "spin 0.7s linear infinite" : "none" }}>↻</span>
              </button>
            )}
          </div>
        </div>
        <div style={{ display: "flex", padding: "0 16px" }}>
          <button type="button" style={tabStyle("stock")} onClick={() => setTab("stock")}>Stock</button>
          <button type="button" style={tabStyle("incoming")} onClick={() => setTab("incoming")}>
            Incoming
            {incomingCount > 0 && (
              <span style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                minWidth: 19, height: 19, padding: "0 6px", marginLeft: 5,
                borderRadius: 999, fontSize: "0.68rem", fontWeight: 800,
                background: "linear-gradient(180deg, #f87171, #ef4444)", color: "#fff",
                boxShadow: "0 2px 6px rgba(239,68,68,0.45)",
              }}>
                {incomingCount}
              </span>
            )}
          </button>
          <button type="button" style={tabStyle("returns")} onClick={() => setTab("returns")}>Return Requests</button>
        </div>
      </div>

      <div className="exec-body" style={{ paddingTop: 8 }}>

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
          teamData ? (
            <>
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
          ) : loading ? (
            <div className="exec-section">
              {[1, 2, 3].map(i => (
                <div key={i} className="history-card" style={{ marginBottom: 10 }}>
                  <div className="skeleton-line" style={{ width: "60%", height: 14, marginBottom: 8 }} />
                  <div className="skeleton-line" style={{ width: "25%", height: 22 }} />
                </div>
              ))}
            </div>
          ) : (
            <div className="exec-section">
              <div className="empty-state">
                <div className="empty-icon">📦</div>
                <h3>No team found</h3>
                <p>Your account isn't linked to an active team warehouse. Contact your IM.</p>
              </div>
            </div>
          )
        )}

        {/* Incoming transfers tab — always mounted (not gated on tab === "incoming")
            so its pending count keeps loading/updating in the background and the
            tab badge is accurate even before the user ever opens this tab. */}
        <div className="exec-section" style={{ display: tab === "incoming" ? "block" : "none" }}>
          <IncomingTransfers refresh={incomingRefresh} onCount={setIncomingCount} onDone={handleIncomingDone} />
        </div>

        {/* Return requests tab */}
        {tab === "returns" && (
          <div className="exec-section">
            <ReturnHistory refresh={returnRefresh} onDone={handleReturnActioned} />
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
