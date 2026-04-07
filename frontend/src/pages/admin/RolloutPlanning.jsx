import { useEffect, useState } from "react";
import { pmApi } from "../../services/api";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

const VISIT_TYPES = ["Work Done", "Re-Visit", "Extra Visit"];

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

/* ── Modal ──────────────────────────────────────────────────────── */
function Modal({ open, onClose, title, children, width = 460 }) {
  if (!open) return null;
  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(15,23,42,0.5)", display: "flex",
        alignItems: "center", justifyContent: "center",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#fff", borderRadius: 14, padding: "28px 32px",
          width, maxWidth: "95vw", boxShadow: "0 20px 60px rgba(0,0,0,0.22)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700 }}>{title}</h3>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8", lineHeight: 1 }}
          >
            &times;
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const fieldStyle = {
  width: "100%", padding: "9px 12px",
  border: "1px solid #e2e8f0", borderRadius: 7,
  fontSize: "0.88rem", background: "#f8fafc",
  boxSizing: "border-box",
};
const labelStyle = { display: "block", fontSize: "0.78rem", fontWeight: 600, marginBottom: 5, color: "#475569" };

export default function RolloutPlanning() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");

  const [selected, setSelected] = useState(new Set());
  const [showModal, setShowModal] = useState(false);
  const [planDate, setPlanDate] = useState(todayDate());
  const [visitType, setVisitType] = useState("Work Done");
  const [creating, setCreating] = useState(false);
  const [successMsg, setSuccessMsg] = useState(null);
  const [createError, setCreateError] = useState(null);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const list = await pmApi.listPODispatches({ dispatch_status: "Dispatched" });
      setRows(Array.isArray(list) ? list : []);
    } catch (err) {
      setError(err.message || "Failed to load dispatches");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, []);

  function toggleRow(name) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  const filtered = rows.filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (r.name || "").toLowerCase().includes(q) ||
      (r.po_no || "").toLowerCase().includes(q) ||
      (r.item_code || "").toLowerCase().includes(q) ||
      (r.project_code || "").toLowerCase().includes(q) ||
      (r.team || "").toLowerCase().includes(q) ||
      (r.im || "").toLowerCase().includes(q) ||
      (r.site_code || "").toLowerCase().includes(q)
    );
  });

  function toggleAll() {
    if (selected.size === filtered.length && filtered.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((r) => r.name)));
    }
  }

  async function handleCreate() {
    if (selected.size === 0 || !planDate || !visitType) return;
    setCreating(true);
    setCreateError(null);
    setSuccessMsg(null);
    try {
      const dispatches = Array.from(selected);
      const result = await pmApi.createRolloutPlans({
        dispatches,
        plan_date: planDate,
        visit_type: visitType,
      });
      const count = result?.created ?? selected.size;
      setSuccessMsg(`Created ${count} rollout plan${count !== 1 ? "s" : ""} successfully.`);
      setSelected(new Set());
      setShowModal(false);
      await loadData();
    } catch (err) {
      setCreateError(err.message || "Failed to create plans");
    } finally {
      setCreating(false);
    }
  }

  const totalAmt = filtered.reduce((s, r) => s + (r.line_amount || 0), 0);
  const selectedAmt = filtered
    .filter((r) => selected.has(r.name))
    .reduce((s, r) => s + (r.line_amount || 0), 0);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Rollout Planning</h1>
          <div className="page-subtitle">Create execution plans from dispatched PO lines</div>
        </div>
        <div className="page-actions">
          <button className="btn-secondary" onClick={loadData} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* ── Toolbar ─────────────────────────────────────────── */}
      <div className="toolbar">
        <input
          type="search"
          placeholder="Search System ID, PO No, Item, Project, Team, DUID…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: "7px 14px",
            borderRadius: 8,
            border: "1px solid #e2e8f0",
            fontSize: "0.84rem",
            minWidth: 300,
          }}
        />
        {search && (
          <button
            className="btn-secondary"
            style={{ fontSize: "0.78rem", padding: "5px 12px" }}
            onClick={() => setSearch("")}
          >
            Clear
          </button>
        )}
        <div style={{ flex: 1 }} />
        {selected.size > 0 && (
          <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
            {selected.size} selected · SAR {fmt.format(selectedAmt)}
          </span>
        )}
        <button
          className="btn-primary"
          onClick={() => setShowModal(true)}
          disabled={selected.size === 0}
        >
          Create Plans ({selected.size})
        </button>
      </div>

      {/* ── Notices ─────────────────────────────────────────── */}
      {successMsg && (
        <div className="notice success" style={{ margin: "0 28px 16px" }}>
          <span>✅</span> {successMsg}
        </div>
      )}
      {createError && (
        <div className="notice error" style={{ margin: "0 28px 16px" }}>
          <span>⚠</span> {createError}
        </div>
      )}

      {/* ── Table ───────────────────────────────────────────── */}
      <div className="page-content">
        {error && (
          <div className="notice error" style={{ marginBottom: 16 }}>
            <span>⚠</span> {error}
          </div>
        )}

        <div className="data-table-wrapper">
          {loading ? (
            <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)" }}>
              Loading dispatches…
            </div>
          ) : filtered.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📦</div>
              <h3>{search ? "No results match your search" : "No dispatched lines ready for planning"}</h3>
              <p>
                {search
                  ? "Try a different search term."
                  : "Dispatch PO Intake lines first before creating rollout plans."}
              </p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={selected.size === filtered.length && filtered.length > 0}
                      onChange={toggleAll}
                    />
                  </th>
                  <th>System ID</th>
                  <th>PO No</th>
                  <th>Item Code</th>
                  <th>Project</th>
                  <th>DUID</th>
                  <th>Team</th>
                  <th>IM</th>
                  <th>Target Month</th>
                  <th style={{ textAlign: "right" }}>Line Amount</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr
                    key={row.name}
                    className={selected.has(row.name) ? "row-selected" : ""}
                    onClick={() => toggleRow(row.name)}
                    style={{ cursor: "pointer" }}
                  >
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(row.name)}
                        onChange={() => toggleRow(row.name)}
                      />
                    </td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{row.name}</td>
                    <td>{row.po_no}</td>
                    <td>{row.item_code}</td>
                    <td>{row.project_code}</td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{row.site_code || "—"}</td>
                    <td>{row.team}</td>
                    <td>{row.im}</td>
                    <td style={{ fontSize: "0.82rem" }}>
                      {row.target_month
                        ? new Date(row.target_month).toLocaleDateString("en", { month: "short", year: "numeric" })
                        : "—"}
                    </td>
                    <td style={{ textAlign: "right" }}>{fmt.format(row.line_amount || 0)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={9} style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0" }}>
                    <strong>{filtered.length}</strong>
                    {search && ` of ${rows.length}`}
                    {" "}row{filtered.length !== 1 ? "s" : ""}
                    {selected.size > 0 && (
                      <span style={{ marginLeft: 16, color: "#6366f1", fontWeight: 600, fontSize: "0.82rem" }}>
                        {selected.size} selected
                      </span>
                    )}
                  </td>
                  <td style={{ textAlign: "right", padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", fontWeight: 700 }}>
                    {fmt.format(totalAmt)}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>

      {/* ── Create Plans Modal ────────────────────────────────── */}
      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title="Create Rollout Plans"
      >
        <div style={{ marginBottom: 20, padding: "12px 16px", background: "#f1f5f9", borderRadius: 8 }}>
          <div style={{ fontSize: "0.82rem", color: "#475569" }}>Creating plans for</div>
          <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "#1e293b" }}>
            {selected.size} dispatch{selected.size !== 1 ? "es" : ""}
          </div>
          <div style={{ fontSize: "0.78rem", color: "#64748b", marginTop: 2 }}>
            Total: SAR {fmt.format(selectedAmt)}
          </div>
        </div>

        <div style={{ display: "grid", gap: 16, marginBottom: 24 }}>
          <div>
            <label style={labelStyle}>Plan Date</label>
            <input
              type="date"
              value={planDate}
              onChange={(e) => setPlanDate(e.target.value)}
              style={fieldStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Visit Type</label>
            <select
              value={visitType}
              onChange={(e) => setVisitType(e.target.value)}
              style={fieldStyle}
            >
              {VISIT_TYPES.map((vt) => (
                <option key={vt} value={vt}>{vt}</option>
              ))}
            </select>
          </div>
        </div>

        {createError && (
          <div className="notice error" style={{ marginBottom: 14 }}>
            <span>⚠</span> {createError}
          </div>
        )}

        <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
          <button className="btn-secondary" onClick={() => setShowModal(false)} disabled={creating}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={handleCreate}
            disabled={creating || !planDate || !visitType}
          >
            {creating ? "Creating…" : `Create ${selected.size} Plan${selected.size !== 1 ? "s" : ""}`}
          </button>
        </div>
      </Modal>
    </div>
  );
}
