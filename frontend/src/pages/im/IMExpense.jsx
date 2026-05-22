import { useCallback, useEffect, useMemo, useState } from "react";
import { pmApi } from "../../services/api";
import DataTableWrapper from "../../components/DataTableWrapper";
import DateRangePicker from "../../components/DateRangePicker";
import { useTableRowLimit } from "../../context/TableRowLimitContext";

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtAmt = (n) =>
  Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function effectiveStatus(claim) {
  if (!claim) return "Pending";
  const s = (claim.approval_status || "").toLowerCase();
  if (s === "draft") return "Pending";
  if (s === "approved" && claim.docstatus !== 1) return "Pending";
  return claim.approval_status || "Pending";
}

function paymentStatus(claim) {
  if (!claim) return null;
  if ((claim.status || "").toLowerCase() === "paid") return "Paid";
  if (effectiveStatus(claim) === "Approved") return "Unpaid";
  return null;
}

function PaymentBadge({ claim }) {
  const ps = paymentStatus(claim);
  if (!ps) return <span style={{ color: "#94a3b8", fontSize: "0.78rem" }}>—</span>;
  const isPaid = ps === "Paid";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 8px", borderRadius: 999, fontSize: "0.72rem", fontWeight: 700,
      background: isPaid ? "#dcfce7" : "#fef9c3",
      color: isPaid ? "#15803d" : "#92400e",
    }}>
      {isPaid ? "Paid" : "Unpaid"}
    </span>
  );
}

function statusClass(s) {
  const v = (s || "").toLowerCase();
  if (v === "approved") return "completed";
  if (v === "rejected") return "cancelled";
  if (v === "pending approval" || v === "draft") return "in-progress";
  return "new";
}

function StatusBadge({ status }) {
  return (
    <span className={`status-badge ${statusClass(status)}`}>
      <span className="status-dot" />
      {status || "Draft"}
    </span>
  );
}

// ── Expense Lines Detail ──────────────────────────────────────────────────────

function ExpenseLines({ lines }) {
  if (!lines || lines.length === 0)
    return <div style={{ color: "#94a3b8", fontSize: "0.82rem" }}>No lines</div>;
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.81rem" }}>
      <thead>
        <tr style={{ background: "#f1f5f9" }}>
          <th style={{ padding: "6px 10px", textAlign: "left", fontWeight: 700, color: "#475569" }}>Expense Type</th>
          <th style={{ padding: "6px 10px", textAlign: "left", fontWeight: 700, color: "#475569" }}>POID</th>
          <th style={{ padding: "6px 10px", textAlign: "left", fontWeight: 700, color: "#475569" }}>Description</th>
          <th style={{ padding: "6px 10px", textAlign: "right", fontWeight: 700, color: "#475569" }}>Amount (SAR)</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l, i) => (
          <tr key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
            <td style={{ padding: "6px 10px" }}>{l.expense_type}</td>
            <td style={{ padding: "6px 10px", fontFamily: "monospace", color: "#1e40af", fontSize: "0.78rem" }}>{l.poid || "—"}</td>
            <td style={{ padding: "6px 10px", color: "#64748b" }}>{l.description || "—"}</td>
            <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: 600 }}>{fmtAmt(l.amount)}</td>
          </tr>
        ))}
        <tr style={{ borderTop: "2px solid #e2e8f0", background: "#f8fafc" }}>
          <td colSpan={3} style={{ padding: "6px 10px", fontWeight: 700, textAlign: "right", color: "#334155" }}>Total</td>
          <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: 800, color: "#1d4ed8" }}>
            {fmtAmt(lines.reduce((s, l) => s + (Number(l.amount) || 0), 0))}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

// ── Claim Detail Modal ────────────────────────────────────────────────────────

function ClaimDetailModal({ open, claim, onClose }) {
  if (!open || !claim) return null;
  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}
    >
      <div
        style={{ background: "#fff", borderRadius: 12, padding: 20, width: "min(640px, 94vw)", maxHeight: "78vh", overflow: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: "1rem" }}>Expense Claim — {claim.name}</h3>
          <button type="button" onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8" }}>&times;</button>
        </div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 14 }}>
          {[
            { label: "Date", value: claim.posting_date },
            { label: "Team Lead", value: claim.employee_name || claim.employee },
            { label: "Team", value: claim.team_name || claim.inet_team || "—" },
            { label: "IM", value: claim.im_name || "—" },
            { label: "Amount", value: `SAR ${fmtAmt(claim.total_claimed_amount)}` },
            { label: "Payment", value: paymentStatus(claim) || "—" },
          ].map(({ label, value }) => (
            <div key={label} style={{ flex: "1 1 110px", background: "#f8fafc", borderRadius: 8, padding: "8px 10px" }}>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>{label}</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#0f172a" }}>{value}</div>
            </div>
          ))}
          <div style={{ flex: "1 1 110px", background: "#f8fafc", borderRadius: 8, padding: "8px 10px" }}>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>Status</div>
            <StatusBadge status={effectiveStatus(claim)} />
          </div>
        </div>
        {claim.remark && (
          <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "8px 12px", fontSize: "0.82rem", color: "#78350f", marginBottom: 14, fontStyle: "italic" }}>
            {claim.remark}
          </div>
        )}
        <ExpenseLines lines={claim.lines} />
      </div>
    </div>
  );
}

// ── Approve / Reject Modal ────────────────────────────────────────────────────

function ActionModal({ open, claim, mode, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => { if (open) { setReason(""); setErr(null); } }, [open]);

  const handle = async () => {
    if (mode === "reject" && !reason.trim()) { setErr("Rejection reason is required."); return; }
    setBusy(true);
    setErr(null);
    try {
      if (mode === "approve") await pmApi.approveExpenseClaim(claim.name);
      else await pmApi.rejectExpenseClaim(claim.name, reason);
      onDone();
      onClose();
    } catch (e) {
      setErr(e.message || "Action failed.");
    } finally {
      setBusy(false);
    }
  };

  if (!open || !claim) return null;
  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}
    >
      <div
        style={{ background: "#fff", borderRadius: 12, padding: 20, width: "min(460px, 94vw)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: "1rem" }}>{mode === "approve" ? "Approve" : "Reject"} Expense Claim</h3>
          <button type="button" onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8" }}>&times;</button>
        </div>
        {err && <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, padding: "8px 12px", color: "#dc2626", fontSize: "0.83rem", marginBottom: 12 }}>{err}</div>}
        <div style={{ fontSize: "0.86rem", marginBottom: 12 }}>
          <strong>{claim.name}</strong> — {claim.employee_name || claim.employee}
          <div style={{ fontSize: "0.8rem", color: "#64748b", marginTop: 2 }}>
            {claim.team_name || claim.inet_team} · {claim.posting_date} · SAR {fmtAmt(claim.total_claimed_amount)}
          </div>
        </div>
        {mode === "reject" && (
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: "0.76rem", fontWeight: 600, color: "#475569", marginBottom: 4 }}>
              Rejection Reason <span style={{ color: "#ef4444" }}>*</span>
            </label>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain why this claim is being rejected..."
              style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.86rem", boxSizing: "border-box", fontFamily: "inherit", resize: "vertical" }}
            />
          </div>
        )}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button type="button" onClick={onClose} className="btn-secondary" style={{ fontSize: "0.86rem" }}>Cancel</button>
          <button
            type="button"
            onClick={handle}
            disabled={busy}
            style={{ padding: "8px 22px", borderRadius: 8, border: "none", background: busy ? "#94a3b8" : (mode === "approve" ? "#22c55e" : "#ef4444"), color: "#fff", fontWeight: 700, cursor: busy ? "not-allowed" : "pointer", fontSize: "0.86rem" }}
          >
            {busy ? "..." : mode === "approve" ? "Approve" : "Reject"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Tab Button ────────────────────────────────────────────────────────────────

function TabBtn({ label, count, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "11px 22px",
        fontSize: "0.86rem",
        fontWeight: active ? 700 : 500,
        color: active ? "#2563eb" : "#64748b",
        background: "none",
        border: "none",
        borderBottom: active ? "2px solid #2563eb" : "2px solid transparent",
        cursor: "pointer",
        marginBottom: -1,
        display: "flex",
        alignItems: "center",
        gap: 6,
        transition: "color 0.15s",
      }}
    >
      {label}
      {count > 0 && (
        <span style={{
          background: active ? "#dbeafe" : "#f1f5f9",
          color: active ? "#1d4ed8" : "#64748b",
          borderRadius: 10,
          padding: "1px 7px",
          fontSize: "0.72rem",
          fontWeight: 700,
        }}>
          {count}
        </span>
      )}
    </button>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function IMExpense({ isAdmin = false }) {
  const [allClaims, setAllClaims] = useState([]);
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("pending");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [imFilter, setImFilter] = useState("");
  const [teamFilter, setTeamFilter] = useState("");
  const [imList, setImList] = useState([]);
  const [teamList, setTeamList] = useState([]);
  const [viewClaim, setViewClaim] = useState(null);
  const [actionClaim, setActionClaim] = useState(null);
  const [actionMode, setActionMode] = useState(null);
  const { rowLimit } = useTableRowLimit();

  useEffect(() => {
    if (!isAdmin) return;
    Promise.all([pmApi.getImListForFilter(), pmApi.getTeamsForFilter()])
      .then(([ims, teams]) => { setImList(ims || []); setTeamList(teams || []); })
      .catch(() => {});
  }, [isAdmin]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (isAdmin) {
        const all = await pmApi.listAllExpenseClaims({});
        const rows = all || [];
        setAllClaims(rows);
        setPending(rows.filter((c) => {
          const s = effectiveStatus(c);
          return s !== "Approved" && s !== "Rejected";
        }));
      } else {
        const [pend, all] = await Promise.all([
          pmApi.listPendingExpenseApprovals(),
          pmApi.listImAllClaims(),
        ]);
        setPending(pend || []);
        setAllClaims(all || []);
      }
    } catch {
      setPending([]);
      setAllClaims([]);
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => {
    let base;
    if (tab === "pending") base = pending;
    else if (tab === "unpaid") base = allClaims.filter((c) => effectiveStatus(c) === "Approved" && (c.status || "").toLowerCase() !== "paid");
    else if (tab === "paid")   base = allClaims.filter((c) => (c.status || "").toLowerCase() === "paid");
    else base = allClaims;

    if (search.trim()) {
      const q = search.toLowerCase();
      base = base.filter((c) =>
        (c.name || "").toLowerCase().includes(q) ||
        (c.employee_name || "").toLowerCase().includes(q) ||
        (c.team_name || "").toLowerCase().includes(q) ||
        (c.im_name || "").toLowerCase().includes(q)
      );
    }
    if (tab === "all" && statusFilter) {
      base = base.filter((c) => {
        const es = effectiveStatus(c);
        if (statusFilter === "Approved") return es === "Approved";
        if (statusFilter === "Rejected") return es === "Rejected";
        if (statusFilter === "Pending") return es !== "Approved" && es !== "Rejected";
        return true;
      });
    }
    if (isAdmin && imFilter) base = base.filter((c) => c.expense_approver === imFilter);
    if (isAdmin && teamFilter) base = base.filter((c) => c.inet_team === teamFilter);
    if (dateFrom) base = base.filter((c) => c.posting_date >= dateFrom);
    if (dateTo) base = base.filter((c) => c.posting_date <= dateTo);
    return base;
  }, [tab, pending, allClaims, search, statusFilter, imFilter, teamFilter, dateFrom, dateTo, isAdmin]);

  const unpaidCount = useMemo(() => allClaims.filter((c) => effectiveStatus(c) === "Approved" && (c.status || "").toLowerCase() !== "paid").length, [allClaims]);
  const paidCount   = useMemo(() => allClaims.filter((c) => (c.status || "").toLowerCase() === "paid").length, [allClaims]);

  const totalAmt = useMemo(() => rows.reduce((s, c) => s + (Number(c.total_claimed_amount) || 0), 0), [rows]);
  const hasFilters = search || dateFrom || dateTo || (tab === "all" && statusFilter) || imFilter || teamFilter;

  const visibleRows = rowLimit === 0 ? rows : rows.slice(0, rowLimit);

  const clearFilters = () => {
    setSearch(""); setDateFrom(""); setDateTo(""); setStatusFilter("");
    setImFilter(""); setTeamFilter("");
  };

  const selStyle = {
    padding: "7px 10px", borderRadius: 8, border: "1px solid #e2e8f0",
    fontSize: "0.84rem", background: "#fff", fontFamily: "inherit",
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{isAdmin ? "Project Expense Claims" : "Expense Approvals"}</h1>
          <div className="page-subtitle">
            {`${rows.length} claim${rows.length !== 1 ? "s" : ""}${rows.length > 0 ? ` · SAR ${fmtAmt(totalAmt)}` : ""}${!isAdmin && pending.length > 0 ? ` · ${pending.length} pending` : ""}`}
          </div>
        </div>
      </div>

      <div className="tabs">
        <TabBtn label="Pending"    count={pending.length} active={tab === "pending"} onClick={() => { setTab("pending"); setStatusFilter(""); }} />
        <TabBtn label="Unpaid"     count={unpaidCount}    active={tab === "unpaid"}  onClick={() => { setTab("unpaid");  setStatusFilter(""); }} />
        <TabBtn label="Paid"       count={paidCount}      active={tab === "paid"}    onClick={() => { setTab("paid");    setStatusFilter(""); }} />
        <TabBtn label="All Claims" count={0}              active={tab === "all"}     onClick={() => { setTab("all");     setStatusFilter(""); }} />
      </div>

      <div className="toolbar">
        <input
          type="search"
          placeholder={isAdmin ? "Search claim, lead, team, IM…" : "Search claim, team lead, team…"}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem", minWidth: 200 }}
        />

        <DateRangePicker
          value={{ from: dateFrom, to: dateTo }}
          onChange={({ from, to }) => { setDateFrom(from); setDateTo(to); }}
        />

        {tab === "all" && (
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={selStyle}>
            <option value="">All Statuses</option>
            <option value="Pending">Pending</option>
            <option value="Approved">Approved</option>
            <option value="Rejected">Rejected</option>
          </select>
        )}

        {isAdmin && (
          <>
            <select value={imFilter} onChange={(e) => setImFilter(e.target.value)} style={selStyle}>
              <option value="">All IMs</option>
              {imList.map((im) => (
                <option key={im.user} value={im.user}>{im.full_name}</option>
              ))}
            </select>
            <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} style={selStyle}>
              <option value="">All Teams</option>
              {teamList.map((t) => (
                <option key={t.name} value={t.name}>{t.team_name || t.team_id}</option>
              ))}
            </select>
          </>
        )}

        {hasFilters && (
          <button className="btn-secondary" style={{ fontSize: "0.78rem", padding: "5px 12px" }} onClick={clearFilters}>
            Clear
          </button>
        )}
      </div>

      <div className="page-content">
        <DataTableWrapper
          loadedCount={loading ? null : rows.length}
          filteredCount={visibleRows.length}
          filterActive={hasFilters}
        >
          {loading ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Loading…</div>
          ) : rows.length === 0 ? (
            <div className="empty-state" style={{ marginTop: 20 }}>
              <div className="empty-icon">📋</div>
              <h3>{hasFilters ? "No results for these filters" : tab === "pending" ? "No pending expense claims" : "No expense claims found"}</h3>
            </div>
          ) : (
            <>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Claim #</th>
                    <th>Date</th>
                    <th>Team Lead</th>
                    <th>Team</th>
                    {isAdmin && <th>IM</th>}
                    <th style={{ textAlign: "right" }}>Amount (SAR)</th>
                    <th>Status</th>
                    <th>Payment</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((c) => (
                    <tr key={c.name} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "10px 14px", fontFamily: "monospace", fontSize: "0.8rem", color: "#1e40af" }}>{c.name}</td>
                      <td style={{ padding: "10px 14px", fontSize: "0.83rem" }}>{c.posting_date}</td>
                      <td style={{ padding: "10px 14px", fontSize: "0.83rem" }}>{c.employee_name || c.employee}</td>
                      <td style={{ padding: "10px 14px", fontSize: "0.83rem" }}>{c.team_name || c.inet_team || "—"}</td>
                      {isAdmin && <td style={{ padding: "10px 14px", fontSize: "0.83rem", color: "#475569" }}>{c.im_name || "—"}</td>}
                      <td style={{ padding: "10px 14px", fontWeight: 700, textAlign: "right", color: "#1d4ed8" }}>SAR {fmtAmt(c.total_claimed_amount)}</td>
                      <td style={{ padding: "10px 14px" }}><StatusBadge status={effectiveStatus(c)} /></td>
                      <td style={{ padding: "10px 14px" }}><PaymentBadge claim={c} /></td>
                      <td style={{ padding: "10px 14px" }}>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button type="button" className="btn-secondary" style={{ fontSize: "0.72rem", padding: "4px 10px" }} onClick={() => setViewClaim(c)}>View</button>
                          {!isAdmin && tab === "pending" && (
                            <>
                              <button type="button" onClick={() => { setActionClaim(c); setActionMode("approve"); }} style={{ padding: "4px 10px", borderRadius: 6, border: "none", background: "#dcfce7", color: "#15803d", fontWeight: 700, cursor: "pointer", fontSize: "0.72rem" }}>Approve</button>
                              <button type="button" onClick={() => { setActionClaim(c); setActionMode("reject"); }} style={{ padding: "4px 10px", borderRadius: 6, border: "none", background: "#fee2e2", color: "#dc2626", fontWeight: 700, cursor: "pointer", fontSize: "0.72rem" }}>Reject</button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </DataTableWrapper>
      </div>

      <ClaimDetailModal open={!!viewClaim} claim={viewClaim} onClose={() => setViewClaim(null)} />
      {!isAdmin && (
        <ActionModal
          open={!!actionClaim}
          claim={actionClaim}
          mode={actionMode}
          onClose={() => { setActionClaim(null); setActionMode(null); }}
          onDone={load}
        />
      )}
    </div>
  );
}
