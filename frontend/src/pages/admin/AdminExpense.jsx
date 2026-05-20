import { useCallback, useEffect, useRef, useState } from "react";
import { pmApi } from "../../services/api";
import DataTableWrapper from "../../components/DataTableWrapper";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtAmt(n) {
  return Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function effectiveStatus(claim) {
  if (!claim) return "Draft";
  const s = (claim.approval_status || "").toLowerCase();
  if (s === "approved" && claim.docstatus !== 1) return "Pending Approval";
  return claim.approval_status || "Draft";
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

// ── Expense Lines ─────────────────────────────────────────────────────────────

function ExpenseLines({ lines }) {
  if (!lines || lines.length === 0) return <div style={{ color: "#94a3b8", fontSize: "0.82rem" }}>No lines</div>;
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

function Modal({ open, onClose, title, children, width = 560 }) {
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
      </div>
    </div>
  );
}

function ClaimDetailModal({ open, claim, onClose }) {
  if (!claim) return null;
  return (
    <Modal open={open} onClose={onClose} title={`Expense Claim — ${claim.name}`} width={640}>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
        <div style={{ flex: 1, minWidth: 100 }}>
          <div style={{ fontSize: "0.72rem", color: "#64748b", marginBottom: 3 }}>Date</div>
          <div style={{ fontWeight: 600, fontSize: "0.88rem" }}>{claim.posting_date}</div>
        </div>
        <div style={{ flex: 1, minWidth: 100 }}>
          <div style={{ fontSize: "0.72rem", color: "#64748b", marginBottom: 3 }}>Team Lead</div>
          <div style={{ fontWeight: 600, fontSize: "0.88rem" }}>{claim.employee_name || claim.employee}</div>
        </div>
        <div style={{ flex: 1, minWidth: 100 }}>
          <div style={{ fontSize: "0.72rem", color: "#64748b", marginBottom: 3 }}>Team</div>
          <div style={{ fontWeight: 600, fontSize: "0.88rem" }}>{claim.team_name || claim.inet_team || "—"}</div>
        </div>
        <div style={{ flex: 1, minWidth: 100 }}>
          <div style={{ fontSize: "0.72rem", color: "#64748b", marginBottom: 3 }}>IM</div>
          <div style={{ fontWeight: 600, fontSize: "0.88rem" }}>{claim.im_name || "—"}</div>
        </div>
        <div style={{ flex: 1, minWidth: 100 }}>
          <div style={{ fontSize: "0.72rem", color: "#64748b", marginBottom: 3 }}>Total Amount</div>
          <div style={{ fontWeight: 800, fontSize: "0.95rem", color: "#1d4ed8" }}>SAR {fmtAmt(claim.total_claimed_amount)}</div>
        </div>
        <div style={{ flex: 1, minWidth: 100 }}>
          <div style={{ fontSize: "0.72rem", color: "#64748b", marginBottom: 3 }}>Status</div>
          <StatusBadge status={effectiveStatus(claim)} />
        </div>
      </div>
      {claim.remark && (
        <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 12px", fontSize: "0.82rem", color: "#475569", marginBottom: 14, fontStyle: "italic" }}>
          {claim.remark}
        </div>
      )}
      <ExpenseLines lines={claim.lines} />
    </Modal>
  );
}

// ── Claim Row ─────────────────────────────────────────────────────────────────

function ClaimRow({ claim, onView }) {
  return (
    <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
      <td style={{ padding: "10px 14px", fontFamily: "monospace", fontSize: "0.8rem", color: "#1e40af" }}>{claim.name}</td>
      <td style={{ padding: "10px 14px", fontSize: "0.83rem" }}>{claim.posting_date}</td>
      <td style={{ padding: "10px 14px", fontSize: "0.83rem" }}>{claim.employee_name || claim.employee}</td>
      <td style={{ padding: "10px 14px", fontSize: "0.83rem" }}>{claim.team_name || claim.inet_team || "—"}</td>
      <td style={{ padding: "10px 14px", fontSize: "0.83rem", color: "#475569" }}>{claim.im_name || "—"}</td>
      <td style={{ padding: "10px 14px", fontWeight: 700, textAlign: "right", color: "#1d4ed8" }}>SAR {fmtAmt(claim.total_claimed_amount)}</td>
      <td style={{ padding: "10px 14px" }}><StatusBadge status={effectiveStatus(claim)} /></td>
      <td style={{ padding: "10px 14px" }}>
        <button
          type="button"
          onClick={() => onView(claim)}
          style={{ padding: "5px 12px", borderRadius: 6, border: "1px solid #e2e8f0", background: "#fff", color: "#475569", cursor: "pointer", fontSize: "0.78rem", fontWeight: 600 }}
        >
          View
        </button>
      </td>
    </tr>
  );
}

// ── Filter Bar ────────────────────────────────────────────────────────────────

const inp = {
  padding: "7px 10px",
  borderRadius: 8,
  border: "1px solid #e2e8f0",
  fontSize: "0.83rem",
  fontFamily: "inherit",
  background: "#fff",
  minWidth: 140,
};

function FilterBar({ filters, setFilters, imList, teamList, onSearch, loading }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
      <div>
        <div style={{ fontSize: "0.72rem", fontWeight: 600, color: "#475569", marginBottom: 3 }}>IM</div>
        <select style={inp} value={filters.im_user || ""} onChange={(e) => setFilters((f) => ({ ...f, im_user: e.target.value }))}>
          <option value="">All IMs</option>
          {imList.map((im) => (
            <option key={im.user} value={im.user}>{im.full_name}</option>
          ))}
        </select>
      </div>
      <div>
        <div style={{ fontSize: "0.72rem", fontWeight: 600, color: "#475569", marginBottom: 3 }}>Team</div>
        <select style={inp} value={filters.inet_team || ""} onChange={(e) => setFilters((f) => ({ ...f, inet_team: e.target.value }))}>
          <option value="">All Teams</option>
          {teamList.map((t) => (
            <option key={t.name} value={t.name}>{t.team_name || t.team_id}</option>
          ))}
        </select>
      </div>
      <div>
        <div style={{ fontSize: "0.72rem", fontWeight: 600, color: "#475569", marginBottom: 3 }}>Status</div>
        <select style={inp} value={filters.approval_status || ""} onChange={(e) => setFilters((f) => ({ ...f, approval_status: e.target.value }))}>
          <option value="">All</option>
          <option value="Draft">Pending</option>
          <option value="Approved">Approved</option>
          <option value="Rejected">Rejected</option>
        </select>
      </div>
      <div>
        <div style={{ fontSize: "0.72rem", fontWeight: 600, color: "#475569", marginBottom: 3 }}>From Date</div>
        <input type="date" style={inp} value={filters.from_date || ""} onChange={(e) => setFilters((f) => ({ ...f, from_date: e.target.value }))} />
      </div>
      <div>
        <div style={{ fontSize: "0.72rem", fontWeight: 600, color: "#475569", marginBottom: 3 }}>To Date</div>
        <input type="date" style={inp} value={filters.to_date || ""} onChange={(e) => setFilters((f) => ({ ...f, to_date: e.target.value }))} />
      </div>
      <button
        type="button"
        onClick={onSearch}
        disabled={loading}
        style={{ padding: "7px 18px", borderRadius: 8, border: "none", background: "#3b82f6", color: "#fff", fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", fontSize: "0.83rem", alignSelf: "flex-end" }}
      >
        {loading ? "..." : "Search"}
      </button>
      <button
        type="button"
        onClick={() => { setFilters({}); }}
        style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", cursor: "pointer", fontSize: "0.83rem", alignSelf: "flex-end" }}
      >
        Reset
      </button>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminExpense() {
  const [tab, setTab] = useState("pending");
  const [claims, setClaims] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({});
  const [imList, setImList] = useState([]);
  const [teamList, setTeamList] = useState([]);
  const [viewClaim, setViewClaim] = useState(null);
  const tableRef = useRef(null);

  useEffect(() => {
    Promise.all([pmApi.getImListForFilter(), pmApi.getTeamsForFilter()])
      .then(([ims, teams]) => {
        setImList(ims || []);
        setTeamList(teams || []);
      })
      .catch(() => {});
  }, []);

  const load = useCallback(
    async (activeTab = tab, activeFilters = filters) => {
      setLoading(true);
      try {
        const f = { ...activeFilters };
        if (activeTab === "pending") f.approval_status = "Draft";
        const rows = await pmApi.listAllExpenseClaims(f);
        setClaims(rows || []);
      } catch {
        setClaims([]);
      } finally {
        setLoading(false);
      }
    },
    [tab, filters],
  );

  useEffect(() => { load(tab, filters); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const switchTab = (t) => {
    setTab(t);
    setFilters((f) => {
      const next = { ...f };
      delete next.approval_status;
      return next;
    });
    setTimeout(() => document.dispatchEvent(new CustomEvent("tablepro:check")), 60);
    setTimeout(() => load(t, {}), 0);
  };

  const totalAmt = claims.reduce((s, c) => s + (Number(c.total_claimed_amount) || 0), 0);

  const tabDefs = [
    { key: "pending", label: "Pending Approval" },
    { key: "all", label: "All Claims" },
  ];

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Project Expense Claims</h1>
          <p className="page-subtitle">Overview of all team project expense claims across all IMs.</p>
        </div>
      </div>

      <div className="tabs">
        {tabDefs.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            className={`tab ${tab === key ? "active" : ""}`}
            onClick={() => switchTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "all" && (
        <div className="toolbar">
          <FilterBar
            filters={filters}
            setFilters={setFilters}
            imList={imList}
            teamList={teamList}
            onSearch={() => load(tab, filters)}
            loading={loading}
          />
        </div>
      )}

      <div className="page-content">
        {!loading && claims.length > 0 && (
          <div style={{ display: "flex", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
            <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "6px 14px", fontSize: "0.82rem" }}>
              <span style={{ color: "#64748b" }}>Records: </span>
              <strong>{claims.length}</strong>
            </div>
            <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, padding: "6px 14px", fontSize: "0.82rem" }}>
              <span style={{ color: "#1d4ed8" }}>Total: </span>
              <strong>SAR {fmtAmt(totalAmt)}</strong>
            </div>
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: "center", padding: 60, color: "#94a3b8" }}>Loading...</div>
        ) : claims.length === 0 ? (
          <div style={{ textAlign: "center", padding: 60, color: "#94a3b8" }}>No expense claims found.</div>
        ) : (
          <DataTableWrapper ref={tableRef}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Claim #</th>
                  <th>Date</th>
                  <th>Team Lead</th>
                  <th>Team</th>
                  <th>IM</th>
                  <th style={{ textAlign: "right" }}>Amount (SAR)</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {claims.map((c) => (
                  <ClaimRow key={c.name} claim={c} onView={(cl) => setViewClaim(cl)} />
                ))}
              </tbody>
            </table>
          </DataTableWrapper>
        )}
      </div>

      <ClaimDetailModal
        open={!!viewClaim}
        claim={viewClaim}
        onClose={() => setViewClaim(null)}
      />
    </>
  );
}
