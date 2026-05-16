import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { pmApi } from "../../services/api";
import DataTableWrapper from "../../components/DataTableWrapper";

// ─── Status helpers ───────────────────────────────────────────────────────────

const STATUS_COLORS = {
  "Pending Approval": { bg: "#fffbeb", fg: "#b45309", dot: "#f59e0b" },
  "Approved":         { bg: "#ecfdf5", fg: "#047857", dot: "#10b981" },
  "Rejected":         { bg: "#fef2f2", fg: "#b91c1c", dot: "#ef4444" },
  "Issued":           { bg: "#eff6ff", fg: "#1d4ed8", dot: "#3b82f6" },
};

function StatusBadge({ status }) {
  const c = STATUS_COLORS[status] || { bg: "#f1f5f9", fg: "#475569", dot: "#94a3b8" };
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "3px 10px", borderRadius: 999,
      fontSize: "0.72rem", fontWeight: 700,
      background: c.bg, color: c.fg,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: c.dot, flexShrink: 0 }} />
      {status}
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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 24px", borderBottom: "1px solid #e2e8f0", flexShrink: 0 }}>
          <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 700 }}>{title}</h3>
          <button type="button" onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8" }}>&times;</button>
        </div>
        <div style={{ padding: "20px 24px", overflowY: "auto", flex: "1 1 auto", minHeight: 0 }}>
          {children}
        </div>
        {footer && (
          <div style={{ padding: "14px 24px", borderTop: "1px solid #e2e8f0", display: "flex", gap: 10, justifyContent: "flex-end", flexShrink: 0, background: "#fff" }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Form field helpers ───────────────────────────────────────────────────────

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "#475569", marginBottom: 5 }}>{label}</label>
      {children}
    </div>
  );
}

const inputStyle = {
  width: "100%", padding: "8px 10px", borderRadius: 8,
  border: "1px solid #e2e8f0", fontSize: "0.86rem", boxSizing: "border-box",
};

// ─── Detail row ───────────────────────────────────────────────────────────────

function DetailItem({ label, value }) {
  return (
    <div style={{ background: "#f8fafc", borderRadius: 8, padding: "8px 10px", marginBottom: 8 }}>
      <div style={{ fontSize: "0.7rem", color: "#94a3b8", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: "0.86rem", color: "#0f172a", fontWeight: 500 }}>{value || "—"}</div>
    </div>
  );
}

// ─── New Request Form ─────────────────────────────────────────────────────────

const EMPTY_ITEM = { item_code: "", qty: "", uom: "", valuation_rate: "" };

function NewRequestForm({ onSubmit, onCancel, imName }) {
  const [poid, setPoid] = useState("");
  const [poidDetails, setPoidDetails] = useState(null);
  const [poidLoading, setPoidLoading] = useState(false);
  const [poidError, setPoidError] = useState("");
  const [teamWarehouse, setTeamWarehouse] = useState("");
  const [sourceWarehouse, setSourceWarehouse] = useState("Stores - INET");
  const [team, setTeam] = useState("");
  const [remark, setRemark] = useState("");
  const [items, setItems] = useState([{ ...EMPTY_ITEM }]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function loadPoid() {
    const p = poid.trim();
    if (!p) return;
    setPoidLoading(true);
    setPoidError("");
    setPoidDetails(null);
    try {
      const res = await pmApi.getPoidDetails(p);
      setPoidDetails(res);
    } catch (e) {
      setPoidError(e.message || "POID not found");
    } finally {
      setPoidLoading(false);
    }
  }

  function setItem(i, field, value) {
    setItems((prev) => prev.map((row, idx) => idx === i ? { ...row, [field]: value } : row));
  }

  function addItem() {
    setItems((prev) => [...prev, { ...EMPTY_ITEM }]);
  }

  function removeItem(i) {
    setItems((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function handleSubmit() {
    setError("");
    if (!teamWarehouse.trim()) { setError("Team Warehouse is required."); return; }
    const validItems = items.filter((r) => r.item_code.trim() && Number(r.qty) > 0);
    if (!validItems.length) { setError("Add at least one item with item code and qty > 0."); return; }

    setSubmitting(true);
    try {
      await onSubmit({
        poid: poid.trim() || undefined,
        duid: poidDetails?.site_code || "",
        im: imName,
        team: team.trim() || undefined,
        team_warehouse: teamWarehouse.trim(),
        source_warehouse: sourceWarehouse.trim() || "Stores - INET",
        remark: remark.trim() || undefined,
        items: validItems.map((r) => ({
          item_code: r.item_code.trim(),
          qty: Number(r.qty),
          uom: r.uom.trim() || undefined,
          valuation_rate: Number(r.valuation_rate) || 0,
        })),
      });
    } catch (e) {
      setError(e.message || "Submission failed");
      setSubmitting(false);
    }
  }

  return (
    <div>
      {error && <div className="notice error" style={{ marginBottom: 12 }}>{error}</div>}

      <Field label="POID (optional)">
        <div style={{ display: "flex", gap: 8 }}>
          <input style={{ ...inputStyle, flex: 1 }} value={poid} onChange={(e) => setPoid(e.target.value)} placeholder="e.g. W-4178-ATN-01-REL-01" />
          <button type="button" className="btn-secondary" style={{ whiteSpace: "nowrap" }} onClick={loadPoid} disabled={poidLoading || !poid.trim()}>
            {poidLoading ? "…" : "Load"}
          </button>
        </div>
        {poidError && <div style={{ fontSize: "0.78rem", color: "#b91c1c", marginTop: 4 }}>{poidError}</div>}
        {poidDetails && (
          <div style={{ marginTop: 6, padding: "8px 10px", borderRadius: 8, background: "#ecfdf5", fontSize: "0.8rem", color: "#047857" }}>
            DUID: <strong>{poidDetails.site_code || "—"}</strong> · Project: <strong>{poidDetails.project_code || "—"}</strong>
          </div>
        )}
      </Field>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
        <Field label="Team Warehouse *">
          <input style={inputStyle} value={teamWarehouse} onChange={(e) => setTeamWarehouse(e.target.value)} placeholder="Team Warehouse name" />
        </Field>
        <Field label="Source Warehouse">
          <input style={inputStyle} value={sourceWarehouse} onChange={(e) => setSourceWarehouse(e.target.value)} placeholder="Stores - INET" />
        </Field>
        <Field label="Team (optional)">
          <input style={inputStyle} value={team} onChange={(e) => setTeam(e.target.value)} placeholder="Team ID" />
        </Field>
      </div>

      <Field label="Remark">
        <textarea style={{ ...inputStyle, resize: "vertical", minHeight: 56, fontFamily: "inherit" }} value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="Reason for request…" />
      </Field>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569" }}>ITEMS</div>
        <button type="button" className="btn-secondary" style={{ fontSize: "0.74rem", padding: "4px 10px" }} onClick={addItem}>+ Add row</button>
      </div>

      <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
          <thead>
            <tr style={{ background: "#f8fafc" }}>
              <th style={{ padding: "8px 10px", textAlign: "left", fontWeight: 600, color: "#475569" }}>Item Code</th>
              <th style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600, color: "#475569", width: 80 }}>Qty</th>
              <th style={{ padding: "8px 10px", textAlign: "left", fontWeight: 600, color: "#475569", width: 80 }}>UOM</th>
              <th style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600, color: "#475569", width: 110 }}>Val. Rate</th>
              <th style={{ width: 36 }} />
            </tr>
          </thead>
          <tbody>
            {items.map((row, i) => (
              <tr key={i} style={{ borderTop: i > 0 ? "1px solid #f1f5f9" : undefined }}>
                <td style={{ padding: "6px 10px" }}>
                  <input
                    style={{ ...inputStyle, padding: "5px 8px" }}
                    value={row.item_code}
                    onChange={(e) => setItem(i, "item_code", e.target.value)}
                    placeholder="Item code"
                  />
                </td>
                <td style={{ padding: "6px 10px" }}>
                  <input
                    type="number"
                    min="0"
                    style={{ ...inputStyle, padding: "5px 8px", textAlign: "right" }}
                    value={row.qty}
                    onChange={(e) => setItem(i, "qty", e.target.value)}
                    placeholder="0"
                  />
                </td>
                <td style={{ padding: "6px 10px" }}>
                  <input
                    style={{ ...inputStyle, padding: "5px 8px" }}
                    value={row.uom}
                    onChange={(e) => setItem(i, "uom", e.target.value)}
                    placeholder="Nos"
                  />
                </td>
                <td style={{ padding: "6px 10px" }}>
                  <input
                    type="number"
                    min="0"
                    style={{ ...inputStyle, padding: "5px 8px", textAlign: "right" }}
                    value={row.valuation_rate}
                    onChange={(e) => setItem(i, "valuation_rate", e.target.value)}
                    placeholder="0"
                  />
                </td>
                <td style={{ padding: "6px 6px", textAlign: "center" }}>
                  {items.length > 1 && (
                    <button type="button" onClick={() => removeItem(i)} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: 16, padding: 2 }}>×</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20 }}>
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={submitting}>Cancel</button>
        <button type="button" className="btn-primary" onClick={handleSubmit} disabled={submitting}>
          {submitting ? "Submitting…" : "Submit Request"}
        </button>
      </div>
    </div>
  );
}

// ─── Request Detail Modal ─────────────────────────────────────────────────────

function RequestDetail({ row, isAdmin, onApprove, onReject, onIssue, onClose }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await pmApi.getMaterialRequest(row.name);
        if (!cancelled) { setDetail(d); setLoading(false); }
      } catch (e) {
        if (!cancelled) { setErr(e.message || "Failed to load"); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [row.name]);

  async function handleApprove() {
    setBusy(true); setErr("");
    try { await onApprove(row.name); onClose(); }
    catch (e) { setErr(e.message || "Approve failed"); setBusy(false); }
  }

  async function handleReject() {
    setBusy(true); setErr("");
    try { await onReject(row.name, rejectReason); onClose(); }
    catch (e) { setErr(e.message || "Reject failed"); setBusy(false); }
  }

  async function handleIssue() {
    setBusy(true); setErr("");
    try { await onIssue(row.name); onClose(); }
    catch (e) { setErr(e.message || "Issue failed"); setBusy(false); }
  }

  const status = detail?.request_status || row.request_status;
  const isPending = status === "Pending Approval";
  const isApproved = status === "Approved";

  return (
    <div>
      {err && <div className="notice error" style={{ marginBottom: 12 }}>{err}</div>}
      {loading ? (
        <div style={{ padding: 24, textAlign: "center", color: "#94a3b8" }}>Loading…</div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
            <StatusBadge status={status} />
            <span style={{ fontSize: "0.78rem", color: "#94a3b8" }}>{detail?.name}</span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
            <DetailItem label="POID" value={detail?.poid} />
            <DetailItem label="DUID" value={detail?.duid} />
            <DetailItem label="IM" value={detail?.im} />
            <DetailItem label="Team" value={detail?.team} />
            <DetailItem label="Source Warehouse" value={detail?.source_warehouse} />
            <DetailItem label="Team Warehouse" value={detail?.team_warehouse} />
            {detail?.remark && <DetailItem label="Remark" value={detail.remark} />}
            {status === "Rejected" && detail?.rejection_reason && (
              <DetailItem label="Rejection Reason" value={detail.rejection_reason} />
            )}
            {detail?.stock_entry_transfer && <DetailItem label="Material Transfer" value={detail.stock_entry_transfer} />}
            {detail?.stock_entry_issue && <DetailItem label="Material Issue" value={detail.stock_entry_issue} />}
          </div>

          {detail?.items?.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#94a3b8", marginBottom: 8 }}>ITEMS</div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem", border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden" }}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    <th style={{ padding: "8px 10px", textAlign: "left", fontWeight: 600, color: "#475569" }}>Item</th>
                    <th style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600, color: "#475569" }}>Qty</th>
                    <th style={{ padding: "8px 10px", textAlign: "left", fontWeight: 600, color: "#475569" }}>UOM</th>
                    <th style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600, color: "#475569" }}>Val. Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.items.map((item, i) => (
                    <tr key={i} style={{ borderTop: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "7px 10px" }}>
                        <div style={{ fontWeight: 600 }}>{item.item_code}</div>
                        {item.item_name && item.item_name !== item.item_code && (
                          <div style={{ fontSize: "0.75rem", color: "#64748b" }}>{item.item_name}</div>
                        )}
                      </td>
                      <td style={{ padding: "7px 10px", textAlign: "right", fontWeight: 600 }}>{item.qty}</td>
                      <td style={{ padding: "7px 10px" }}>{item.uom || "—"}</td>
                      <td style={{ padding: "7px 10px", textAlign: "right" }}>{item.valuation_rate ? Number(item.valuation_rate).toLocaleString() : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {isAdmin && isPending && !rejectOpen && (
            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button type="button" className="btn-primary" onClick={handleApprove} disabled={busy}>
                {busy ? "Processing…" : "Approve & Transfer"}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setRejectOpen(true)} disabled={busy}
                style={{ color: "#b91c1c", borderColor: "#fecaca" }}>
                Reject
              </button>
            </div>
          )}

          {isAdmin && isPending && rejectOpen && (
            <div style={{ marginTop: 16, padding: 14, background: "#fef2f2", borderRadius: 8, border: "1px solid #fecaca" }}>
              <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, color: "#b91c1c", marginBottom: 6 }}>Rejection Reason</label>
              <textarea
                style={{ ...inputStyle, minHeight: 60, resize: "vertical", fontFamily: "inherit", borderColor: "#fecaca" }}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="State the reason…"
              />
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button type="button" onClick={() => setRejectOpen(false)} className="btn-secondary" disabled={busy}>Cancel</button>
                <button type="button" onClick={handleReject} disabled={busy}
                  style={{ padding: "8px 18px", borderRadius: 8, background: "#b91c1c", color: "#fff", border: "none", cursor: "pointer", fontWeight: 700 }}>
                  {busy ? "Rejecting…" : "Confirm Reject"}
                </button>
              </div>
            </div>
          )}

          {isAdmin && isApproved && !detail?.stock_entry_issue && (
            <div style={{ marginTop: 20 }}>
              <button type="button" className="btn-primary" onClick={handleIssue} disabled={busy}>
                {busy ? "Processing…" : "Issue Materials (Work Done)"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const ALL_STATUSES = ["Pending Approval", "Approved", "Rejected", "Issued"];

export default function IMMaterialRequest() {
  const { imName, role } = useAuth();
  const isAdmin = role === "admin";

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [detailRow, setDetailRow] = useState(null);
  const [successMsg, setSuccessMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const args = { limit: 100 };
      if (statusFilter) args.status = statusFilter;
      if (!isAdmin && imName) args.im = imName;
      const res = await pmApi.listMaterialRequests(args);
      setRows(Array.isArray(res) ? res : []);
    } catch (e) {
      setError(e.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [imName, isAdmin, statusFilter]);

  useEffect(() => { load(); }, [load]);

  async function handleCreate(payload) {
    await pmApi.createMaterialRequest(payload);
    setShowNew(false);
    setSuccessMsg("Material request submitted successfully.");
    await load();
  }

  async function handleApprove(name) {
    await pmApi.approveMaterialRequest(name);
    setSuccessMsg("Request approved. Material Transfer created.");
    await load();
  }

  async function handleReject(name, reason) {
    await pmApi.rejectMaterialRequest(name, reason);
    setSuccessMsg("Request rejected.");
    await load();
  }

  async function handleIssue(name) {
    await pmApi.issueMaterialsWorkDone(name);
    setSuccessMsg("Materials issued. Stock Entry created.");
    await load();
  }

  // Count pending for admin badge
  const pendingCount = rows.filter((r) => r.request_status === "Pending Approval").length;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Material Requests</h1>
          <div className="page-subtitle">
            {isAdmin ? "Review and approve material requests from IMs." : "Request materials for your POID/DUID."}
          </div>
        </div>
        <div className="page-actions" style={{ display: "flex", gap: 8 }}>
          <button className="btn-secondary" onClick={load} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
          <button className="btn-primary" onClick={() => setShowNew(true)}>
            + New Request
          </button>
        </div>
      </div>

      {successMsg && (
        <div className="notice success" style={{ margin: "0 28px 16px" }}>
          <span>✓</span> {successMsg}
        </div>
      )}

      {isAdmin && pendingCount > 0 && !statusFilter && (
        <div style={{ margin: "0 16px 12px", padding: "10px 14px", borderRadius: 10, background: "#fffbeb", border: "1px solid #fcd34d", fontSize: "0.84rem", color: "#92400e", fontWeight: 600 }}>
          {pendingCount} request{pendingCount !== 1 ? "s" : ""} pending approval
        </div>
      )}

      <div className="toolbar">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid #dbe3ef", fontSize: "0.84rem", background: "#fff" }}
          >
            <option value="">All Statuses</option>
            {ALL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {statusFilter && (
            <button className="btn-secondary" style={{ fontSize: "0.78rem", padding: "5px 12px" }} onClick={() => setStatusFilter("")}>
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="page-content">
        {error && <div className="notice error" style={{ marginBottom: 16 }}>{error}</div>}

        <DataTableWrapper>
          {loading ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Loading requests…</div>
          ) : rows.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📦</div>
              <h3>No material requests</h3>
              <p>{statusFilter ? `No requests with status "${statusFilter}".` : "Click \"+ New Request\" to submit your first request."}</p>
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
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.name}>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{row.name}</td>
                    <td>{row.request_date}</td>
                    <td>{row.poid || "—"}</td>
                    <td>{row.duid || "—"}</td>
                    {isAdmin && <td>{row.im || "—"}</td>}
                    <td>{row.team_warehouse || "—"}</td>
                    <td><StatusBadge status={row.request_status} /></td>
                    <td>
                      <button
                        type="button"
                        className="btn-secondary"
                        style={{ fontSize: "0.7rem", padding: "3px 10px" }}
                        onClick={() => { setSuccessMsg(""); setDetailRow(row); }}
                      >
                        {isAdmin && row.request_status === "Pending Approval" ? "Review" : "View"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </DataTableWrapper>
      </div>

      {/* New Request Modal */}
      <Modal
        open={showNew}
        onClose={() => setShowNew(false)}
        title="New Material Request"
        width={680}
      >
        <NewRequestForm
          imName={imName}
          onSubmit={handleCreate}
          onCancel={() => setShowNew(false)}
        />
      </Modal>

      {/* Detail / Review Modal */}
      <Modal
        open={!!detailRow}
        onClose={() => setDetailRow(null)}
        title={`Request · ${detailRow?.name || ""}`}
        width={680}
      >
        {detailRow && (
          <RequestDetail
            row={detailRow}
            isAdmin={isAdmin}
            onApprove={handleApprove}
            onReject={handleReject}
            onIssue={handleIssue}
            onClose={() => { setDetailRow(null); }}
          />
        )}
      </Modal>
    </div>
  );
}
