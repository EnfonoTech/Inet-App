import { useCallback, useEffect, useState } from "react";
import DataTableWrapper from "../../components/DataTableWrapper";
import { pmApi } from "../../services/api";
import ExportExcelButton from "../../components/ExportExcelButton";

// PM / Admin queue for Team Allocation Requests that have cleared the
// source IM and are awaiting PM approval, plus Rollout Plan cancel
// requests and PO Transfer Requests — one shared inbox for all three.
// Approving fires the relevant atomic flip on the backend (INET Team.im,
// PO Dispatch.dispatch_status, or PO Dispatch.im).

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 2, minimumFractionDigits: 2 });

function statusTone(status) {
  const s = (status || "").toLowerCase();
  if (s.includes("approved")) return { bg: "#ecfdf5", fg: "#047857", bd: "#a7f3d0" };
  if (s.includes("reject") || s.includes("cancel")) return { bg: "#fef2f2", fg: "#b91c1c", bd: "#fecaca" };
  if (s.includes("pm")) return { bg: "#eff6ff", fg: "#1d4ed8", bd: "#bfdbfe" };
  return { bg: "#fffbeb", fg: "#b45309", bd: "#fde68a" };
}

export default function TeamAllocationApprovals() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("pending"); // "pending" | "history"
  const [decideTarget, setDecideTarget] = useState(null);
  const [decideAction, setDecideAction] = useState("approve");
  const [decideRemark, setDecideRemark] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [teamList, cancelList, transferList] = await Promise.all([
        pmApi.listTeamAllocationRequests("all"),
        pmApi.listAllCancelRequests(),
        pmApi.listPoTransferRequests("all"),
      ]);
      const all = [
        ...(Array.isArray(teamList) ? teamList : []).map((r) => ({ ...r, _type: "team" })),
        ...(Array.isArray(cancelList) ? cancelList : []).map((r) => ({ ...r, _type: "cancel" })),
        ...(Array.isArray(transferList) ? transferList : []).map((r) => ({ ...r, _type: "transfer" })),
      ];
      all.sort((a, b) => new Date(b.cancel_requested_at || b.creation || 0) - new Date(a.cancel_requested_at || a.creation || 0));
      setRows(all);
    } catch (e) {
      setErr(e?.message || "Failed to load requests");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openDecide(row, action) {
    setErr(null);
    setDecideTarget(row);
    setDecideAction(action);
    setDecideRemark("");
  }

  async function submitDecide() {
    if (!decideTarget) return;
    setBusy(true);
    setErr(null);
    try {
      if (decideTarget._type === "cancel") {
        const res = await pmApi.pmDecideCancelPlan(decideTarget.name, decideAction, decideRemark);
        if (decideAction === "approve") {
          // Kept short — the full detail (which items, which requests) goes
          // to the requesting IM's notification instead, since they're the
          // one who'll actually follow up on it, not the approving PM.
          const parts = [`Plan cancellation approved.`];
          if (res?.auto_cancelled?.length) {
            parts.push(`${res.auto_cancelled.length} pending request(s) auto-rejected.`);
          }
          if (res?.unconsumed_material?.length) {
            parts.push(`⚠ ${res.unconsumed_material.length} item(s) still in the team's warehouse — the requesting IM has been notified to review.`);
          }
          setMsg(parts.join(" "));
        } else {
          setMsg("Plan cancellation rejected.");
        }
      } else if (decideTarget._type === "transfer") {
        await pmApi.pmDecidePoTransfer(decideTarget.name, decideAction, decideRemark);
        setMsg(`Transfer ${decideAction === "approve" ? "approved — POIDs moved" : "rejected"}.`);
      } else {
        await pmApi.pmDecideTeamAllocation(decideTarget.name, decideAction, decideRemark);
        setMsg(`Request ${decideAction === "approve" ? "approved — team transferred" : "rejected"}.`);
      }
      setDecideTarget(null);
      await load();
      window.dispatchEvent(new Event("inet:approvals-changed"));
      window.dispatchEvent(new CustomEvent("inet:notifications-changed"));
    } catch (e) {
      setErr(e?.message || "Action failed");
    } finally {
      setBusy(false);
    }
  }

  function getStatus(row) {
    return row._type === "cancel" ? row.cancel_request_status : row.request_status;
  }

  const pending = rows.filter((r) => getStatus(r) === "Pending PM Approval");
  const history = rows.filter((r) => getStatus(r) !== "Pending PM Approval");
  const visible = tab === "pending" ? pending : history;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Approvals</h1>
          <div className="page-subtitle">
            Requests needing sign-off
          </div>
        </div>
        <div className="page-actions">
          <ExportExcelButton filename="team-allocation-requests" rows={rows} />
          <button className="btn-secondary" onClick={load} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      <div role="tablist" style={{ display: "flex", gap: 4, padding: 4, background: "#f1f5f9", borderRadius: 8, border: "1px solid #e2e8f0", margin: "0 16px 8px", width: "fit-content" }}>
        {[
          { id: "pending", label: "Awaiting Approval", count: pending.length },
          { id: "history", label: "History" },
        ].map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.id)}
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
                }}>{t.count}</span>
              )}
            </button>
          );
        })}
      </div>

      {msg && (
        <div className="notice success" style={{ margin: "0 16px 8px" }}>
          <span>✓</span> {msg}
          <button type="button" className="btn-secondary" style={{ marginLeft: 12, fontSize: "0.7rem", padding: "2px 8px" }} onClick={() => setMsg(null)}>Dismiss</button>
        </div>
      )}
      {err && (
        <div className="notice error" style={{ margin: "0 16px 8px" }}>
          <span>!</span> {err}
          <button type="button" className="btn-secondary" style={{ marginLeft: 12, fontSize: "0.7rem", padding: "2px 8px" }} onClick={() => setErr(null)}>Dismiss</button>
        </div>
      )}

      <div className="page-content">
        <DataTableWrapper loadedCount={loading ? null : visible.length}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Request</th>
                  <th>Subject</th>
                  <th>Details</th>
                  <th>Status</th>
                  <th style={{ minWidth: 220 }}>Reason</th>
                  <th style={{ minWidth: 220 }}>PM Remark</th>
                  <th>Raised</th>
                  <th style={{ minWidth: 180 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ padding: 0 }}>
                      {loading ? (
                        <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Loading...</div>
                      ) : (
                        <div className="empty-state">
                          <div className="empty-icon">📨</div>
                          <h3>{tab === "pending" ? "No requests awaiting your approval" : "No history yet"}</h3>
                          <p>{tab === "pending"
                            ? "When a request needs PM sign-off, it lands here."
                            : "Approved and rejected requests show up here for audit."}</p>
                        </div>
                      )}
                    </td>
                  </tr>
                ) : visible.map((r) => {
                  const isCancel = r._type === "cancel";
                  const isTransfer = r._type === "transfer";
                  const statusField = isCancel ? r.cancel_request_status : r.request_status;
                  const tone = statusTone(statusField);
                  const noteCellStyle = { fontSize: "0.78rem", color: "#475569", maxWidth: 280, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
                  const isPending = statusField === "Pending PM Approval";
                  const typeLabel = isCancel ? "Plan Cancel" : isTransfer ? "POID Transfer" : "Team Transfer";
                  const typeTone = isCancel
                    ? { bg: "#ecfdf5", fg: "#047857", bd: "#a7f3d0" }
                    : isTransfer
                    ? { bg: "#fffbeb", fg: "#b45309", bd: "#fde68a" }
                    : { bg: "#eef2ff", fg: "#3730a3", bd: "#c7d2fe" };
                  return (
                    <tr key={`${r._type}-${r.name}`}>
                      <td>
                        <span style={{
                          display: "inline-block", padding: "2px 8px", borderRadius: 999,
                          background: typeTone.bg, color: typeTone.fg,
                          border: `1px solid ${typeTone.bd}`,
                          fontSize: "0.66rem", fontWeight: 700, whiteSpace: "nowrap",
                        }}>{typeLabel}</span>
                      </td>
                      <td style={{ fontFamily: "ui-monospace, monospace", fontSize: "0.76rem", whiteSpace: "nowrap" }}>{r.name}</td>
                      <td style={{ fontWeight: 600, whiteSpace: "nowrap" }}>
                        {isTransfer ? `${r.poid_count ?? r.lines?.length ?? "?"} POID(s)` : (r.team_name || r.team || "—")}
                      </td>
                      <td style={{ fontSize: "0.78rem", maxWidth: 220, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {isCancel ? (
                          <>Plan: {r.plan_status || "—"} · {r.plan_date || "—"} · IM: {r.im_name || r.im || "—"} · PO: {r.poid || r.po_dispatch || "—"}</>
                        ) : isTransfer ? (
                          <>{r.from_im_name || r.from_im || "—"} → {r.to_im_name || r.to_im || "—"} · {r.poid_list || "—"}</>
                        ) : (
                          <>{r.from_im_name || r.from_im || "—"} → {r.to_im_name || r.to_im || "—"}</>
                        )}
                      </td>
                      <td>
                        <span style={{
                          display: "inline-block", padding: "3px 10px", borderRadius: 999,
                          fontSize: "0.7rem", fontWeight: 700, whiteSpace: "nowrap",
                          background: tone.bg, color: tone.fg, border: `1px solid ${tone.bd}`,
                        }}>{statusField}</span>
                      </td>
                      <td style={noteCellStyle} title={r.cancel_reason || r.reason || ""}>
                        {r.cancel_reason || r.reason || <span style={{ color: "#cbd5e1" }}>—</span>}
                      </td>
                      <td style={{ ...noteCellStyle, color: r.cancel_pm_remark || r.pm_remark ? "#1d4ed8" : "#cbd5e1" }} title={r.cancel_pm_remark || r.pm_remark || ""}>
                        {r.cancel_pm_remark || r.pm_remark || "—"}
                      </td>
                      <td style={{ fontSize: "0.78rem", color: "#64748b", whiteSpace: "nowrap" }}>
                        {r.cancel_requested_at || r.creation
                          ? new Date(r.cancel_requested_at || r.creation).toLocaleString("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
                          : "—"}
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 6, flexWrap: "nowrap", alignItems: "center" }}>
                          <button type="button" className="btn-secondary"
                            style={{ fontSize: "0.72rem", padding: "4px 10px" }}
                            onClick={() => openDecide(r, "view")}>View</button>
                          {isPending ? (
                            <>
                              <button type="button" className="btn-primary"
                                style={{ fontSize: "0.72rem", padding: "4px 10px", background: "#059669" }}
                                disabled={busy} onClick={() => openDecide(r, "approve")}>Approve</button>
                              <button type="button" className="btn-secondary"
                                style={{ fontSize: "0.72rem", padding: "4px 10px", color: "#b91c1c" }}
                                disabled={busy} onClick={() => openDecide(r, "reject")}>Reject</button>
                            </>
                          ) : (
                            <span style={{ fontSize: "0.74rem", color: "#94a3b8" }}>
                              {r.cancel_responded_at
                                ? `decided ${new Date(r.cancel_responded_at).toLocaleDateString("en", { month: "short", day: "numeric" })}`
                                : r.approved_at
                                  ? `decided ${new Date(r.approved_at).toLocaleDateString("en", { month: "short", day: "numeric" })}`
                                  : "—"}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
        </DataTableWrapper>
      </div>

      {/* PM decide modal */}
      {decideTarget && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={() => !busy && setDecideTarget(null)}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 20, width: decideTarget._type === "transfer" ? "min(760px, 96vw)" : "min(520px, 96vw)" }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 12px", fontSize: "1.05rem" }}>
              {decideAction === "view" ? "View" : decideAction === "approve" ? "Approve" : "Reject"} {decideTarget._type === "cancel" ? "plan cancellation" : decideTarget._type === "transfer" ? "POID transfer" : "team transfer"}
            </h3>
            <div style={{ fontSize: "0.84rem", color: "#475569", marginBottom: 12 }}>
              {decideTarget._type === "cancel" ? (
                <>
                  <strong>{decideTarget.poid || decideTarget.po_dispatch || decideTarget.name}</strong>
                  {" — "}{decideTarget.plan_status || "—"}
                  <br />
                  Team: <strong>{decideTarget.team_name || decideTarget.team || "—"}</strong>
                  {decideTarget.im_name && <> · IM: <strong>{decideTarget.im_name}</strong></>}
                  {decideAction === "approve" && (
                    <div style={{ marginTop: 8, padding: "6px 10px", background: "#fef2f2", borderRadius: 6, fontSize: "0.78rem", color: "#b91c1c" }}>
                      This will cancel the plan and return the PO Dispatch to <strong>Dispatched</strong>.
                    </div>
                  )}
                </>
              ) : decideTarget._type === "transfer" ? (
                <>
                  <strong>{decideTarget.from_im_name || decideTarget.from_im}</strong> → <strong>{decideTarget.to_im_name || decideTarget.to_im}</strong>
                  <br />
                  {decideTarget.poid_count ?? decideTarget.lines?.length ?? 0} POID(s), SAR {fmt.format(decideTarget.total_amount || 0)}
                  <div style={{ marginTop: 8, maxHeight: 220, overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: 6 }}>
                    {(decideTarget.lines || []).length > 0 ? (
                      <table className="data-table" style={{ margin: 0, fontSize: "0.76rem" }}>
                        <thead>
                          <tr>
                            <th>POID</th>
                            <th>DUID</th>
                            <th>Project</th>
                            <th>Item</th>
                            <th>Description</th>
                          </tr>
                        </thead>
                        <tbody>
                          {decideTarget.lines.map((l, i) => (
                            <tr key={l.po_dispatch || i}>
                              <td style={{ fontFamily: "ui-monospace, monospace" }}>{l.poid || l.po_dispatch}</td>
                              <td style={{ fontFamily: "ui-monospace, monospace" }}>{l.site_code || "—"}</td>
                              <td>{l.project_code || "—"}</td>
                              <td style={{ fontFamily: "ui-monospace, monospace" }}>{l.item_code || "—"}</td>
                              <td style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={l.item_description || ""}>{l.item_description || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <div style={{ padding: "6px 8px", fontSize: "0.78rem", color: "#94a3b8" }}>{decideTarget.poid_list || "—"}</div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <strong>{decideTarget.from_im_name || decideTarget.from_im}</strong> → <strong>{decideTarget.to_im_name || decideTarget.to_im}</strong>
                  <br />
                  Team: <strong>{decideTarget.team_name || decideTarget.team}</strong>
                </>
              )}
            </div>
            {(decideTarget.cancel_reason || decideTarget.reason) && (
              <div style={{ marginBottom: 10, padding: "8px 10px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: "0.82rem", color: "#334155", whiteSpace: "pre-wrap" }}>
                <div style={{ fontSize: "0.66rem", fontWeight: 700, color: "#94a3b8", marginBottom: 2 }}>REASON</div>
                {decideTarget.cancel_reason || decideTarget.reason}
              </div>
            )}
            {decideTarget._type !== "cancel" && decideTarget.source_im_remark && (
              <div style={{ marginBottom: 10, padding: "8px 10px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, fontSize: "0.82rem", color: "#92400e", whiteSpace: "pre-wrap" }}>
                <div style={{ fontSize: "0.66rem", fontWeight: 700, marginBottom: 2 }}>SOURCE IM REMARK</div>
                {decideTarget.source_im_remark}
              </div>
            )}
            {decideAction === "view" ? (
              <>
                {(decideTarget.cancel_pm_remark || decideTarget.pm_remark) && (
                  <div style={{ marginBottom: 10, padding: "8px 10px", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, fontSize: "0.82rem", color: "#1e3a8a", whiteSpace: "pre-wrap" }}>
                    <div style={{ fontSize: "0.66rem", fontWeight: 700, color: "#3b82f6", marginBottom: 2 }}>PM REMARK</div>
                    {decideTarget.cancel_pm_remark || decideTarget.pm_remark}
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
                  <button type="button" className="btn-secondary" onClick={() => setDecideTarget(null)}>Close</button>
                </div>
              </>
            ) : (
              <>
                <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, marginBottom: 6, color: "#475569" }}>PM remark (optional)</label>
                <textarea
                  value={decideRemark}
                  onChange={(e) => setDecideRemark(e.target.value)}
                  rows={3}
                  style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e2e8f0", boxSizing: "border-box", fontSize: "0.84rem", fontFamily: "inherit", resize: "vertical" }}
                />
                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 14 }}>
                  <button type="button" className="btn-secondary" disabled={busy} onClick={() => setDecideTarget(null)}>Cancel</button>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={busy}
                    onClick={submitDecide}
                    style={decideAction === "approve" ? { background: "#059669" } : { background: "#b91c1c" }}
                  >
                    {busy ? "…" : (decideAction === "approve" ? (decideTarget._type === "cancel" ? "Approve cancellation" : "Approve transfer") : "Reject")}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
