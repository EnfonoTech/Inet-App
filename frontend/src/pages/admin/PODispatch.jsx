import { useEffect, useState } from "react";
import { pmApi } from "../../services/api";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

function today() {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

export default function PODispatch() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [teams, setTeams] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [team, setTeam] = useState("");
  const [targetMonth, setTargetMonth] = useState(today());
  const [dispatching, setDispatching] = useState(false);
  const [successMsg, setSuccessMsg] = useState(null);
  const [dispatchError, setDispatchError] = useState(null);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [poLines, teamList] = await Promise.all([
        pmApi.listPOIntakeLines("New"),
        pmApi.listINETTeams(),
      ]);
      setRows(Array.isArray(poLines) ? poLines : []);
      setTeams(Array.isArray(teamList) ? teamList : []);
    } catch (err) {
      setError(err.message || "Failed to load data");
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

  async function handleDispatch() {
    if (selected.size === 0 || !team || !targetMonth) return;
    setDispatching(true);
    setDispatchError(null);
    setSuccessMsg(null);
    try {
      const selectedLines = rows.filter((r) => selected.has(r.name));
      const result = await pmApi.dispatchPOLines({
        lines: selectedLines,
        team,
        target_month: targetMonth,
      });
      const count = result?.created ?? selected.size;
      setSuccessMsg(`Successfully dispatched ${count} line${count !== 1 ? "s" : ""} to team.`);
      setSelected(new Set());
      await loadData();
    } catch (err) {
      setDispatchError(err.message || "Dispatch failed");
    } finally {
      setDispatching(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">PO Dispatch</h1>
          <div className="page-subtitle">Select lines to dispatch to field teams</div>
        </div>
        <div className="page-actions">
          <button className="btn-secondary" onClick={loadData} disabled={loading}>
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="toolbar">
        <select
          value={team}
          onChange={(e) => setTeam(e.target.value)}
          style={{ minWidth: 180 }}
        >
          <option value="">Select Team...</option>
          {teams.map((t) => (
            <option key={t.team_id} value={t.team_id}>
              {t.team_name || t.team_id}
            </option>
          ))}
        </select>

        <input
          type="month"
          value={targetMonth}
          onChange={(e) => setTargetMonth(e.target.value)}
          style={{
            background: "var(--bg-input, #f6f8fb)",
            border: "1px solid var(--border-medium, #e2e8f0)",
            borderRadius: "var(--radius-sm, 6px)",
            color: "var(--text, #1e293b)",
            padding: "7px 12px",
            fontSize: "0.82rem",
          }}
        />

        <div style={{ flex: 1 }} />

        {selected.size > 0 && (
          <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
            {selected.size} selected
          </span>
        )}

        <button
          className="btn-primary"
          onClick={handleDispatch}
          disabled={dispatching || selected.size === 0 || !team || !targetMonth}
        >
          {dispatching ? "Dispatching..." : "Dispatch Selected"}
        </button>
      </div>

      {successMsg && (
        <div className="notice success" style={{ margin: "0 28px 16px" }}>
          <span>OK</span> {successMsg}
        </div>
      )}
      {dispatchError && (
        <div className="notice error" style={{ margin: "0 28px 16px" }}>
          <span>!</span> {dispatchError}
        </div>
      )}

      {/* Table */}
      <div className="page-content">
        {error && (
          <div className="notice error" style={{ marginBottom: 16 }}>
            <span>!</span> {error}
          </div>
        )}

        <div className="data-table-wrapper">
          {loading ? (
            <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)" }}>
              Loading PO lines...
            </div>
          ) : rows.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📋</div>
              <h3>No lines ready for dispatch</h3>
              <p>All PO Intake lines have been dispatched or there are no new entries.</p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}>
                    <input
                      type="checkbox"
                      checked={selected.size === rows.length && rows.length > 0}
                      onChange={toggleAll}
                    />
                  </th>
                  <th>PO No</th>
                  <th>Item Code</th>
                  <th>Item Description</th>
                  <th style={{ textAlign: "right" }}>Qty</th>
                  <th style={{ textAlign: "right" }}>Rate</th>
                  <th style={{ textAlign: "right" }}>Amount</th>
                  <th>Project Code</th>
                  <th>Site Code</th>
                  <th>Area</th>
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
                    <td>{row.po_no}</td>
                    <td>{row.item_code}</td>
                    <td style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {row.item_description}
                    </td>
                    <td style={{ textAlign: "right" }}>{row.qty}</td>
                    <td style={{ textAlign: "right" }}>{fmt.format(row.rate || 0)}</td>
                    <td style={{ textAlign: "right" }}>{fmt.format(row.line_amount || 0)}</td>
                    <td>{row.project_code}</td>
                    <td>{row.site_code}</td>
                    <td>{row.area}</td>
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
