import { useState } from "react";
import { pmApi } from "../services/api";

const money = new Intl.NumberFormat("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * View a Direct Close request, and — for an admin — decide it.
 *
 * Every line is listed, not a count: approving closes all of them at once and
 * writes revenue against each, so the decision is only informed if the whole
 * batch is on screen. Lines carrying a live issue are flagged in place rather
 * than summarised at the top, because which line has the problem is the part
 * that matters.
 *
 * `canDecide` comes from the server (`list_direct_close_requests.can_decide`),
 * never from the role in the browser — a PM raises these and cannot approve
 * them, and the button must agree with what the endpoint will actually allow.
 */
export default function DirectCloseApprovalModal({ request, canDecide, onClose, onDone }) {
  const [remark, setRemark] = useState("");
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  if (!request) return null;

  const lines = request.lines || [];
  const pending = request.request_status === "Pending Admin Approval";
  const blocked = lines.filter((l) => l.issue_severity === "hard").length;
  const warned = lines.filter((l) => l.issue_severity === "warn").length;

  async function decide(action) {
    setBusy(action);
    setError(null);
    try {
      const res = await pmApi.adminDecideDirectClose(request.name, action, remark);
      await onDone?.(res, action);
    } catch (err) {
      setError(err.message || `Could not ${action} this request`);
    } finally {
      setBusy(null);
    }
  }

  const tone = request.request_status === "Approved"
    ? { bg: "#ecfdf5", fg: "#047857", bd: "#a7f3d0" }
    : String(request.request_status || "").startsWith("Rejected")
    ? { bg: "#fef2f2", fg: "#b91c1c", bd: "#fecaca" }
    : { bg: "#fffbeb", fg: "#b45309", bd: "#fde68a" };

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={onClose}
    >
      <div
        style={{ background: "#fff", borderRadius: 12, padding: 20, width: "min(900px, 100%)", maxHeight: "88vh", overflow: "auto", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <h3 style={{ margin: 0, fontSize: "1rem" }}>Direct Close · {request.name}</h3>
          <button type="button" onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#94a3b8", lineHeight: 1 }}>&times;</button>
        </div>

        <div style={{ fontSize: "0.82rem", color: "#64748b", marginBottom: 12 }}>
          {request.poid_count} POID{request.poid_count !== 1 ? "s" : ""} · SAR {money.format(request.total_amount || 0)} ·{" "}
          <span style={{ display: "inline-block", padding: "2px 9px", borderRadius: 999, fontSize: "0.7rem", fontWeight: 700, background: tone.bg, color: tone.fg, border: `1px solid ${tone.bd}` }}>
            {request.request_status}
          </span>
          {request.request_status === "Approved" && <> · {request.closed_count ?? 0} closed</>}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, marginBottom: 12 }}>
          {[
            ["Close type", request.close_type],
            ["Subcontractor", request.subcontractor],
            ["Milestone", request.milestone || "Full close"],
            ["Closing date", request.closed_on],
            ["Huawei IM", request.huawei_im],
            ["Project domain", request.project_domain],
            ["Requested by", request.requested_by],
            ["IM", request.im],
          ].map(([label, value]) => (
            <div key={label} style={{ background: "#f8fafc", border: "1px solid #eef2f7", borderRadius: 8, padding: "8px 11px" }}>
              <div style={{ fontSize: "0.63rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
              <div style={{ fontSize: "0.82rem", color: "#0f172a", wordBreak: "break-word" }}>{value || "—"}</div>
            </div>
          ))}
        </div>

        {request.reason && (
          <div style={{ marginBottom: 10, padding: "8px 10px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: "0.82rem", color: "#334155" }}>
            <div style={{ fontSize: "0.66rem", fontWeight: 700, color: "#94a3b8", marginBottom: 2 }}>REASON</div>
            {request.reason}
          </div>
        )}
        {request.admin_remark && (
          <div style={{ marginBottom: 10, padding: "8px 10px", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, fontSize: "0.82rem", color: "#1e40af" }}>
            <div style={{ fontSize: "0.66rem", fontWeight: 700, color: "#60a5fa", marginBottom: 2 }}>ADMIN REMARK</div>
            {request.admin_remark}
          </div>
        )}

        {pending && (blocked > 0 || warned > 0) && (
          <div className={blocked > 0 ? "notice error" : "notice"} style={{ marginBottom: 10 }}>
            <span>{blocked > 0 ? "!" : "⚠"}</span>{" "}
            {blocked > 0 && <><strong>{blocked}</strong> line{blocked !== 1 ? "s" : ""} cannot be closed and will be refused. </>}
            {warned > 0 && <><strong>{warned}</strong> line{warned !== 1 ? "s" : ""} need{warned === 1 ? "s" : ""} a look — approving is the decision to go ahead anyway.</>}
          </div>
        )}

        {/* overflowX, not hidden: the POID + DUID + item description columns run
            past 900px on a real request and the Status / Note columns were
            simply clipped off the right-hand edge with no way to reach them. */}
        <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, overflowX: "auto", marginBottom: 12 }}>
          <table className="data-table" style={{ margin: 0, minWidth: 760 }}>
            <thead>
              <tr>
                <th>POID</th>
                <th>DUID</th>
                <th>Item</th>
                <th style={{ textAlign: "right" }}>Qty</th>
                <th style={{ textAlign: "right" }}>Amount</th>
                <th>Status</th>
                <th style={{ minWidth: 180 }}>Note</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.po_dispatch} style={l.issue_severity === "hard" ? { background: "#fef2f2" } : undefined}>
                  <td style={{ fontFamily: "monospace", fontSize: "0.76rem", whiteSpace: "nowrap" }}>{l.poid}</td>
                  <td style={{ fontFamily: "monospace", fontSize: "0.76rem" }}>{l.site_code || "—"}</td>
                  <td style={{ fontSize: "0.78rem", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={l.item_description || ""}>
                    {l.item_code || "—"}
                  </td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{l.qty ?? "—"}</td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money.format(l.line_amount || 0)}</td>
                  <td style={{ fontSize: "0.76rem" }}>{l.line_status || "Pending"}</td>
                  <td style={{ fontSize: "0.74rem", color: l.issue_severity === "hard" ? "#b91c1c" : l.issue ? "#b45309" : "#64748b" }}
                      title={l.issue_detail || l.line_note || ""}>
                    {l.issue || l.line_note || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {error && <div className="notice error" style={{ marginBottom: 10 }}><span>!</span> {error}</div>}

        {pending && canDecide && (
          <>
            <label style={{ display: "block", fontSize: "0.74rem", fontWeight: 700, color: "#64748b", marginBottom: 4 }}>REMARK (optional)</label>
            <textarea
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              rows={2}
              placeholder="Why you approved or rejected this…"
              style={{ width: "100%", padding: 8, border: "1px solid #e2e8f0", borderRadius: 8, fontSize: "0.84rem", resize: "vertical", marginBottom: 12 }}
            />
          </>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8 }}>
          {pending && !canDecide && (
            <span style={{ fontSize: "0.78rem", color: "#94a3b8" }}>
              Waiting for an Admin to decide.
            </span>
          )}
          {pending && canDecide && (
            <button type="button" className="btn-secondary" disabled={!!busy} onClick={() => decide("reject")}
                    style={{ borderColor: "#fecaca", color: "#b91c1c" }}>
              {busy === "reject" ? "Rejecting…" : "Reject"}
            </button>
          )}
          <button type="button" className="btn-secondary" onClick={onClose}>Close</button>
          {pending && canDecide && (
            <button type="button" className="btn-primary" disabled={!!busy} onClick={() => decide("approve")}>
              {busy === "approve" ? "Approving…" : `Approve & close ${lines.length - blocked} line${lines.length - blocked !== 1 ? "s" : ""}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
