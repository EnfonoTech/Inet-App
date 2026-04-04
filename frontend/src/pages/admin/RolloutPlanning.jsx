import { useEffect, useState } from "react";
import { pmApi } from "../../services/api";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

const VISIT_TYPES = ["Work Done", "Re-Visit", "Extra Visit"];

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

export default function RolloutPlanning() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [selected, setSelected] = useState(new Set());
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

  function toggleAll() {
    if (selected.size === rows.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(rows.map((r) => r.name)));
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
      await loadData();
    } catch (err) {
      setCreateError(err.message || "Failed to create plans");
    } finally {
      setCreating(false);
    }
  }

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
          type="date"
          value={planDate}
          onChange={(e) => setPlanDate(e.target.value)}
          style={{
            background: "var(--bg-input)",
            border: "1px solid var(--border-medium)",
            borderRadius: "var(--radius-sm)",
            color: "var(--text-primary)",
            padding: "7px 12px",
            fontSize: "0.82rem",
          }}
        />

        <select
          value={visitType}
          onChange={(e) => setVisitType(e.target.value)}
          style={{ minWidth: 150 }}
        >
          {VISIT_TYPES.map((vt) => (
            <option key={vt} value={vt}>{vt}</option>
          ))}
        </select>

        <div className="spacer" />

        {selected.size > 0 && (
          <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
            {selected.size} selected
          </span>
        )}

        <button
          className="btn-primary"
          onClick={handleCreate}
          disabled={creating || selected.size === 0 || !planDate || !visitType}
        >
          {creating ? "Creating…" : "Create Plans"}
        </button>
      </div>

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
          ) : rows.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📦</div>
              <h3>No dispatched lines ready for planning</h3>
              <p>Dispatch PO Intake lines first before creating rollout plans.</p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={selected.size === rows.length && rows.length > 0}
                      onChange={toggleAll}
                    />
                  </th>
                  <th>System ID</th>
                  <th>PO No</th>
                  <th>Item Code</th>
                  <th>Team</th>
                  <th>IM</th>
                  <th>Project Code</th>
                  <th style={{ textAlign: "right" }}>Line Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
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
                    <td>{row.team}</td>
                    <td>{row.im}</td>
                    <td>{row.project_code}</td>
                    <td style={{ textAlign: "right" }}>{fmt.format(row.line_amount || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
