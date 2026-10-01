import { useCallback, useEffect, useState } from "react";
import DataTableWrapper from "../../components/DataTableWrapper";
import { pmApi } from "../../services/api";
import ExportExcelButton from "../../components/ExportExcelButton";
import DirectCloseApprovalModal from "../../components/DirectCloseApprovalModal";
import { money } from "../../utils/numberFormat";

// PM / Admin queue for Team Allocation Requests that have cleared the
// source IM and are awaiting PM approval, plus Rollout Plan cancel requests,
// PO Transfer Requests and POID cancel requests — one shared inbox for all
// four. Approving fires the relevant atomic flip on the backend (INET Team.im,
// PO Dispatch.dispatch_status, or PO Dispatch.im).


// Two vocabularies land in this inbox: everything else waits on a PM, a
// Direct Close waits on an ADMIN (inet_app.roles — a PM raising one cannot
// decide it). Both are "pending" here; who may actually press Approve is
// decided per row below, from the server's own answer.
const PENDING_STATUSES = new Set(["Pending PM Approval", "Pending Admin Approval"]);

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
  const [canDecideDirectClose, setCanDecideDirectClose] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [teamList, cancelList, transferList, poidCancelList, directCloseRes] = await Promise.all([
        pmApi.listTeamAllocationRequests("all"),
        pmApi.listAllCancelRequests(),
        pmApi.listPoTransferRequests("all"),
        pmApi.listPoCancelRequests().catch(() => []),
        pmApi.listDirectCloseRequests().catch(() => ({ rows: [], can_decide: false })),
      ]);
      setCanDecideDirectClose(!!directCloseRes?.can_decide);
      const all = [
        ...(Array.isArray(teamList) ? teamList : []).map((r) => ({ ...r, _type: "team" })),
        ...(Array.isArray(cancelList) ? cancelList : []).map((r) => ({ ...r, _type: "cancel" })),
        ...(Array.isArray(transferList) ? transferList : []).map((r) => ({ ...r, _type: "transfer" })),
        // PO Cancel Requests carry their lines the same way a transfer does,
        // so the shared row rendering and decide modal need no special case
        // beyond the _type check.
        ...(Array.isArray(poidCancelList) ? poidCancelList : []).map((r) => ({
          ...r, _type: "poid_cancel",
        })),
        // Only for someone who can actually decide one. This is an approval
        // inbox, and a PM-only account can never act on a Direct Close — it
        // would be a row they can only look at. Their own requests are on the
        // Direct Close tab in PO Control, which is where they track them.
        ...(directCloseRes?.can_decide && Array.isArray(directCloseRes?.rows)
          ? directCloseRes.rows : []).map((r) => ({ ...r, _type: "direct_close" })),
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
      } else if (decideTarget._type === "poid_cancel") {
        const res = await pmApi.pmDecideCancelRequest(decideTarget.name, decideAction, decideRemark);
        if (decideAction === "approve") {
          const parts = [`${res?.cancelled ?? 0} POID(s) cancelled.`];
          // A line that picked up an invoice or a plan while the request sat in
          // the queue is refused at approval time, so say which ones.
          if (res?.refused?.length) {
            parts.push(`${res.refused.length} refused: ${res.refused.map((r) => r.poid).join(", ")}.`);
          }
          if (res?.cancelled_plans?.length) {
            parts.push(`${res.cancelled_plans.length} dormant plan(s) cancelled with them.`);
          }
          setMsg(parts.join(" "));
        } else {
          setMsg("POID cancellation rejected.");
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

  const pending = rows.filter((r) => PENDING_STATUSES.has(getStatus(r)));
  const history = rows.filter((r) => !PENDING_STATUSES.has(getStatus(r)));
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
                  const isPoidCancel = r._type === "poid_cancel";
                  const isTransfer = r._type === "transfer";
                  const isDirectClose = r._type === "direct_close";
                  const statusField = isCancel ? r.cancel_request_status : r.request_status;
                  const tone = statusTone(statusField);
                  const noteCellStyle = { fontSize: "0.78rem", color: "#475569", maxWidth: 280, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
                  const isPending = PENDING_STATUSES.has(statusField);
                  const typeLabel = isCancel ? "Plan Cancel"
                    : isPoidCancel ? "POID Cancel"
                    : isDirectClose ? "Direct Close"
                    : isTransfer ? "POID Transfer" : "Team Transfer";
                  const typeTone = isCancel
                    ? { bg: "#ecfdf5", fg: "#047857", bd: "#a7f3d0" }
                    : isPoidCancel
                    ? { bg: "#fef2f2", fg: "#b91c1c", bd: "#fecaca" }
                    : isDirectClose
                    ? { bg: "#f0f9ff", fg: "#0369a1", bd: "#bae6fd" }
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
                        {(isTransfer || isPoidCancel || isDirectClose) ? `${r.poid_count ?? r.lines?.length ?? "?"} POID(s)`
                          : (r.team_name || r.team || "—")}
                      </td>
                      <td style={{ fontSize: "0.78rem", maxWidth: 220, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {isCancel ? (
                          <>Plan: {r.plan_status || "—"} · {r.plan_date || "—"} · IM: {r.im_name || r.im || "—"} · PO: {r.poid || r.po_dispatch || "—"}</>
                        ) : isPoidCancel ? (
                          <>SAR {money.format(r.total_amount || 0)} · IM: {r.im || "—"} · {r.poid_list || "—"}</>
                        ) : isDirectClose ? (
                          <>SAR {money.format(r.total_amount || 0)} · {r.close_type || "—"}{r.milestone ? ` ${r.milestone}` : " full"} · {r.subcontractor || "—"} · {r.poid_list || "—"}</>
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
                      <td style={{ ...noteCellStyle, color: r.cancel_pm_remark || r.pm_remark || r.admin_remark ? "#1d4ed8" : "#cbd5e1" }} title={r.cancel_pm_remark || r.pm_remark || r.admin_remark || ""}>
                        {r.cancel_pm_remark || r.pm_remark || r.admin_remark || "—"}
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

      {/* A Direct Close has its own dialog — it shows the close parameters and
          every line's live issues, which the generic one has no shape for. It
          was falling through this chain to the team-transfer default, so it
          rendered "View team transfer" with nothing in it. */}
      {decideTarget && decideTarget._type === "direct_close" && (
        <DirectCloseApprovalModal
          request={decideTarget}
          canDecide={canDecideDirectClose}
          onClose={() => setDecideTarget(null)}
          onDone={async (res, action) => {
            setDecideTarget(null);
            if (action === "approve") {
              const parts = [`${res?.closed ?? 0} POID(s) closed.`];
              if (res?.refused?.length) {
                parts.push(`${res.refused.length} refused: ${res.refused.map((x) => x.poid).join(", ")}.`);
              }
              setMsg(parts.join(" "));
            } else {
              setMsg("Direct Close rejected.");
            }
            await load();
            window.dispatchEvent(new Event("inet:approvals-changed"));
            window.dispatchEvent(new CustomEvent("inet:notifications-changed"));
          }}
        />
      )}

      {/* PM decide modal */}
      {decideTarget && decideTarget._type !== "direct_close" && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={() => !busy && setDecideTarget(null)}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 20, width: (decideTarget._type === "transfer" || decideTarget._type === "poid_cancel") ? "min(760px, 96vw)" : "min(520px, 96vw)" }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 12px", fontSize: "1.05rem" }}>
              {decideAction === "view" ? "View" : decideAction === "approve" ? "Approve" : "Reject"} {decideTarget._type === "cancel" ? "plan cancellation" : decideTarget._type === "poid_cancel" ? "POID cancellation" : decideTarget._type === "transfer" ? "POID transfer" : "team transfer"}
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
              ) : decideTarget._type === "poid_cancel" ? (
                <>
                  <strong>{decideTarget.poid_count ?? decideTarget.lines?.length ?? 0} POID(s)</strong>
                  , SAR {money.format(decideTarget.total_amount || 0)}
                  {decideTarget.im && <> · IM: <strong>{decideTarget.im}</strong></>}
                  {/* Live, not as they stood when the request was raised. */}
                  {(decideTarget.blocked_count > 0 || decideTarget.warn_count > 0) && (
                    <div style={{ marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {decideTarget.blocked_count > 0 && (
                        <span style={{ padding: "2px 8px", borderRadius: 999, fontSize: "0.72rem", fontWeight: 700, background: "#fef2f2", color: "#b91c1c", border: "1px solid #fecaca" }}>
                          ⛔ {decideTarget.blocked_count} will be refused
                        </span>
                      )}
                      {decideTarget.warn_count > 0 && (
                        <span style={{ padding: "2px 8px", borderRadius: 999, fontSize: "0.72rem", fontWeight: 700, background: "#fffbeb", color: "#92400e", border: "1px solid #fde68a" }}>
                          ⚠ {decideTarget.warn_count} need a second look
                        </span>
                      )}
                    </div>
                  )}
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
                            <th style={{ textAlign: "right" }}>Qty</th>
                            <th style={{ textAlign: "right" }}>Amount</th>
                            <th>Outcome</th>
                          </tr>
                        </thead>
                        <tbody>
                          {decideTarget.lines.map((l, i) => {
                            // Per line, because approval re-checks each one's
                            // blockers: a POID invoiced while the request sat
                            // in the queue is Refused, the rest still cancel.
                            const ls = l.line_status || "Pending";
                            const t = ls === "Cancelled" ? { bg: "#fef2f2", fg: "#b91c1c", bd: "#fecaca" }
                              : ls === "Refused" ? { bg: "#fffbeb", fg: "#b45309", bd: "#fde68a" }
                              : { bg: "#f1f5f9", fg: "#475569", bd: "#e2e8f0" };
                            return (
                            <tr key={l.po_dispatch || i}>
                              <td style={{ fontFamily: "ui-monospace, monospace" }}>{l.poid || l.po_dispatch}</td>
                              <td style={{ fontFamily: "ui-monospace, monospace" }}>{l.site_code || "—"}</td>
                              <td>{l.project_code || "—"}</td>
                              <td>{l.item_code || "—"}</td>
                              <td style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={l.item_description || ""}>
                                {l.item_description || "—"}
                              </td>
                              <td style={{ textAlign: "right" }}>{l.qty ?? "—"}</td>
                              <td style={{ textAlign: "right" }}>{money.format(l.line_amount || 0)}</td>
                              <td>
                                {l.issue ? (
                                  <span title={l.issue_detail || ""} style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: "0.68rem", fontWeight: 700,
                                    background: l.issue_severity === "hard" ? "#fef2f2" : "#fffbeb",
                                    color: l.issue_severity === "hard" ? "#b91c1c" : "#92400e",
                                    border: `1px solid ${l.issue_severity === "hard" ? "#fecaca" : "#fde68a"}` }}>
                                    {l.issue_severity === "hard" ? "⛔" : "⚠"} {l.issue}
                                  </span>
                                ) : (
                                  <span title={l.line_note || ""} style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: "0.68rem", fontWeight: 700, background: t.bg, color: t.fg, border: `1px solid ${t.bd}` }}>{ls}</span>
                                )}
                              </td>
                            </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    ) : (
                      <div style={{ padding: 12, color: "#94a3b8", fontSize: "0.78rem" }}>No lines on this request.</div>
                    )}
                  </div>
                </>
              ) : decideTarget._type === "transfer" ? (
                <>
                  <strong>{decideTarget.from_im_name || decideTarget.from_im}</strong> → <strong>{decideTarget.to_im_name || decideTarget.to_im}</strong>
                  <br />
                  {decideTarget.poid_count ?? decideTarget.lines?.length ?? 0} POID(s), SAR {money.format(decideTarget.total_amount || 0)}
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
                    {busy ? "…" : (decideAction === "approve" ? ((decideTarget._type === "cancel" || decideTarget._type === "poid_cancel") ? "Approve cancellation" : "Approve transfer") : "Reject")}
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
