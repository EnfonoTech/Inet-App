import { useEffect, useRef, useState } from "react";
import { pmApi } from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { useTableRowLimit, TABLE_ROW_LIMIT_ALL } from "../../context/TableRowLimitContext";
import { useProgressiveRows } from "../../hooks/useProgressiveRows";
import TableRowsLimitFooter from "../../components/TableRowsLimitFooter";
import DataTableWrapper from "../../components/DataTableWrapper";
import {
  elapsedSecondsFromServerEpoch,
  formatElapsedSeconds,
  makeSkewMs,
} from "../../utils/executionTimerDisplay";
import { useDebounced } from "../../hooks/useDebounced";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });

function shortDt(v) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch { return String(v); }
}

function timeOnly(v) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch { return String(v); }
}

function dateOnly(v) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch { return String(v); }
}

/* Mobile time log card */
function TimelogCard({ row, style }) {
  return (
    <div className="timelog-card" style={style}>
      <div className="timelog-card-header">
        <div>
          <div className="timelog-duration" style={row.is_running ? { color: "var(--amber)" } : {}}>
            {row.is_running ? "Running…" : `${fmt.format(row.duration_hours || 0)} h`}
          </div>
          <div className="timelog-rollout">{row.rollout_plan || "—"}</div>
        </div>
        <span style={{
          display: "inline-block",
          padding: "3px 10px",
          borderRadius: 999,
          fontSize: "0.68rem",
          fontWeight: 700,
          textTransform: "uppercase",
          background: row.is_running ? "var(--amber-bg)" : "var(--green-bg)",
          color: row.is_running ? "var(--amber)" : "var(--green)",
          border: `1px solid ${row.is_running ? "var(--amber-border)" : "var(--green-border)"}`,
          flexShrink: 0,
        }}>
          {row.is_running ? "Running" : "Done"}
        </span>
      </div>
      {(row.item_description || row.project_code) && (
        <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)", marginTop: 4 }}>
          {row.item_description || row.project_code}
        </div>
      )}
      <div className="timelog-range">
        <svg viewBox="0 0 20 20" fill="currentColor" width="12" height="12" style={{ opacity: 0.4, flexShrink: 0 }}>
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd"/>
        </svg>
        <span style={{ fontSize: "0.72rem" }}>
          {dateOnly(row.start_time)} · {timeOnly(row.start_time)}
          {!row.is_running && <> → {timeOnly(row.end_time)}</>}
        </span>
      </div>
    </div>
  );
}

export default function Timesheet() {
  const { teamId } = useAuth();
  const { rowLimit } = useTableRowLimit();
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  // See useProgressiveRows — mounts large row sets in chunks so the browser
  // doesn't show "Page Unresponsive" on tables with "All" rows loaded.
  const tableScrollRef = useRef(null);
  const visibleLogs = useProgressiveRows(logs, { paused: loading, scrollRef: tableScrollRef, chunk: 400 });
  // How many of `visibleLogs` to actually show — anything beyond this is
  // hidden via CSS in the render below rather than removed from `logs`. See
  // the skip-fetch logic in the fetch effect below / PICTracker.jsx.
  const displayLimit = rowLimit === TABLE_ROW_LIMIT_ALL ? Infinity : rowLimit;
  const displayedCount = Math.min(logs.length, displayLimit);
  const [runningTimers, setRunningTimers] = useState([]);
  const [, tick] = useState(0);

  const [planned, setPlanned] = useState([]);
  const [manualPlan, setManualPlan] = useState("");
  const [manualDate, setManualDate] = useState("");
  const [manualStart, setManualStart] = useState("");
  const [manualEnd, setManualEnd] = useState("");
  const [manualNotes, setManualNotes] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const [refreshKey, setRefreshKey] = useState(0);

  function loadLogs() { setRefreshKey((k) => k + 1); }

  useEffect(() => {
    if (runningTimers.length === 0) return;
    const id = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, [runningTimers.length]);

  async function refreshRunning() {
    try {
      const res = await pmApi.getRunningExecutionTimer();
      const list = Array.isArray(res) ? res : (res?.log_name ? [res] : []);
      setRunningTimers(list);
    } catch { setRunningTimers([]); }
  }

  // ── Manage Table column filters ──────────────────────────────────────
  // Each column's typed value is matched only against that column's own
  // value on the backend (see column_filters / col_filter_map_etl in
  // list_execution_time_logs).
  const [columnFilters, setColumnFilters] = useState({});
  useEffect(() => {
    const onFiltersChanged = (e) => {
      if (e.detail?.tableKey !== "field-timesheet-v1") return;
      setColumnFilters(e.detail.filters || {});
    };
    document.addEventListener("tablepro:filters-changed", onFiltersChanged);
    return () => document.removeEventListener("tablepro:filters-changed", onFiltersChanged);
  }, []);
  // Excel column-filter dropdowns cascade off exactly the query the rows
  // were fetched with (recorded by the fetch effect below).
  const queryArgsRef = useRef({});
  useEffect(() => {
    const onRequestOptions = (e) => {
      if (e.detail?.tableKey !== "field-timesheet-v1") return;
      e.detail.respond(pmApi.getColumnFilterOptions({
        source: "execution_time_logs",
        col_key: e.detail.colKey,
        bucket: e.detail.bucket,
        search: e.detail.search,
        limit: e.detail.limit,
        portal_filters: queryArgsRef.current,
        exclude_column: e.detail.colKey,
      }));
    };
    document.addEventListener("tablepro:request-column-options", onRequestOptions);
    return () => document.removeEventListener("tablepro:request-column-options", onRequestOptions);
  }, []);

  // Either a legacy substring string or the Excel-style { values, blanks,
  // contains } object. String(obj) is "[object Object]" — always truthy — so
  // an emptied Excel selection would never clear without this.
  const activeColumnFilters = Object.fromEntries(
    Object.entries(columnFilters).filter(([, v]) => (
      v && typeof v === "object"
        ? (Array.isArray(v.values) && v.values.some((x) => String(x ?? "").trim()))
          || !!v.blanks || !!String(v.contains || "").trim()
        : String(v || "").trim()
    ))
  );
  const columnFiltersKey = JSON.stringify(activeColumnFilters);
  const columnFiltersDebounced = useDebounced(columnFiltersKey, 300);

  // Remembers what the LAST real server fetch actually returned, and under
  // what limit + filters. Shrinking the row limit (e.g. All -> 20, or
  // 2500 -> 20) never needs another round-trip — whatever's being asked for
  // is already sitting in memory from the larger fetch; just show fewer of
  // the same rows. Only growing the limit (needing rows that were never
  // fetched at all) — or any OTHER filter actually changing, or an explicit
  // Refresh (refreshKey) — hits the server. See PICTracker.jsx for the
  // reference implementation.
  const lastFetchRef = useRef({ signature: null, limit: null, rows: [] });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const filters = {};
      const colFilters = JSON.parse(columnFiltersDebounced);
      if (Object.keys(colFilters).length) filters.column_filters = colFilters;
      const signature = JSON.stringify([teamId, filters, refreshKey]);

      const prev = lastFetchRef.current;
      const alreadyHaveEnough = prev.signature === signature && (
        prev.limit === TABLE_ROW_LIMIT_ALL
        || (rowLimit !== TABLE_ROW_LIMIT_ALL && rowLimit <= prev.limit)
      );
      if (alreadyHaveEnough) {
        // Already have at least this many rows in memory from a larger (or
        // equal) fetch under the same filters — just show fewer of them via
        // the CSS-hide render below, no re-fetch and no state mutation.
        return;
      }

      setLoading(true);
      try {
        queryArgsRef.current = filters;
        const res = await pmApi.listExecutionTimeLogs(filters, rowLimit, 0);
        if (!cancelled) {
          const fetchedRows = res?.logs || [];
          setLogs(fetchedRows);
          setTotal(res?.total ?? fetchedRows.length);
          lastFetchRef.current = { signature, limit: rowLimit, rows: fetchedRows };
        }
      } catch {
        if (!cancelled) { setLogs([]); setTotal(0); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [teamId, rowLimit, refreshKey, columnFiltersDebounced]);

  useEffect(() => { refreshRunning(); }, [teamId, rowLimit]);

  useEffect(() => {
    if (!showManual || manualDate) return;
    const today = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    setManualDate(`${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`);
  }, [showManual, manualDate]);

  useEffect(() => {
    if (!teamId) return;
    pmApi.getFieldTeamDashboard(teamId).then((r) => {
      const items = r?.planned ?? r?.plans ?? [];
      setPlanned(Array.isArray(items) ? items : []);
    }).catch(() => setPlanned([]));
  }, [teamId]);

  async function stopRunning(logName) {
    if (!logName) return;
    setError(null);
    try {
      await pmApi.stopExecutionTimer(logName);
      setRunningTimers((prev) => prev.filter((t) => t.log_name !== logName));
      window.dispatchEvent(new Event("inet-timer-changed"));
      loadLogs();
    } catch (e) { setError(e.message || "Stop failed"); }
  }

  async function handleManualSubmit(e) {
    e.preventDefault();
    setError(null); setSuccess(null);
    if (!manualPlan || !manualDate || !manualStart || !manualEnd) {
      setError("Choose a rollout plan, date, start time, and end time.");
      return;
    }
    setSubmitting(true);
    try {
      await pmApi.saveExecutionTimeLogManual(
        manualPlan,
        `${manualDate} ${manualStart}:00`,
        `${manualDate} ${manualEnd}:00`,
        manualNotes
      );
      setSuccess("Time log saved.");
      setManualDate(""); setManualStart(""); setManualEnd("");
      setManualNotes(""); setManualPlan(""); setShowManual(false);
      loadLogs();
    } catch (err) { setError(err.message || "Save failed"); }
    finally { setSubmitting(false); }
  }

  const totalHours = logs.reduce((s, r) => s + (parseFloat(r.duration_hours) || 0), 0);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Time Log</h1>
          <div className="page-subtitle">Time tracked per rollout / execution</div>
        </div>
        <div className="page-actions">
          <button className="btn-primary btn-sm" type="button" onClick={() => { setShowManual(true); setError(null); setSuccess(null); }}>
            + Manual entry
          </button>
        </div>
      </div>

      {success && (
        <div className="notice success" style={{ margin: "0 16px 12px", display: "flex", gap: 8 }}>
          <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg>
          {success}
        </div>
      )}

      {!teamId && (
        <div className="notice error" style={{ margin: "0 16px 12px" }}>
          No team linked — time logs cannot be created until your account is assigned to a field team.
        </div>
      )}

      {/* ── Running timer cards ─────────────────────────────── */}
      {runningTimers.length > 0 && (
        <div style={{ padding: "0 14px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
          {runningTimers.map((timer) => (
            <div key={timer.log_name} className="field-running-timer-card">
              <div className="field-running-timer-info">
                <div className="field-running-timer-label">
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#ef4444", animation: "timer-pulse 1.2s ease-in-out infinite", display: "inline-block" }} />
                  Running Timer
                </div>
                <div className="field-running-timer-clock">
                  {formatElapsedSeconds(
                    elapsedSecondsFromServerEpoch(timer.start_time_ms, makeSkewMs(timer.server_time_ms))
                  )}
                </div>
                <div className="field-running-timer-plan">
                  {timer.rollout_plan}
                  {timer.item_description ? ` · ${timer.item_description}` : ""}
                </div>
              </div>
              <button
                type="button"
                style={{
                  background: "#dc2626", border: "none", borderRadius: "var(--radius)",
                  color: "#fff", padding: "10px 16px", fontWeight: 700, fontSize: "0.85rem",
                  cursor: "pointer", flexShrink: 0,
                }}
                onClick={() => stopRunning(timer.log_name)}
              >
                Stop
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── Manual entry form ───────────────────────────────── */}
      {showManual && teamId && (
        <div style={{ padding: "0 14px 12px" }}>
          <div className="exec-section">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div className="exec-section-title" style={{ marginBottom: 0 }}>Manual Time Entry</div>
              <button
                type="button"
                onClick={() => setShowManual(false)}
                style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "var(--text-muted)", lineHeight: 1, padding: 0 }}
              >
                ×
              </button>
            </div>
            {error && <div className="notice error" style={{ marginBottom: 12 }}>{error}</div>}
            <form onSubmit={handleManualSubmit}>
              <div className="exec-field">
                <label>Rollout Plan *</label>
                <select value={manualPlan} onChange={(e) => setManualPlan(e.target.value)} required>
                  <option value="">— Select —</option>
                  {planned.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name} · {p.item_description || p.item_code || "Work"}
                    </option>
                  ))}
                </select>
                {planned.length === 0 && (
                  <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: 6 }}>
                    No plans for today — open a plan from Today's Work first.
                  </p>
                )}
              </div>
              <div className="exec-field">
                <label>Date *</label>
                <input type="date" value={manualDate} onChange={(e) => setManualDate(e.target.value)} required />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div className="exec-field">
                  <label>Start Time *</label>
                  <input type="time" value={manualStart} onChange={(e) => setManualStart(e.target.value)} required />
                </div>
                <div className="exec-field">
                  <label>End Time *</label>
                  <input type="time" value={manualEnd} onChange={(e) => setManualEnd(e.target.value)} required />
                </div>
              </div>
              <div className="exec-field">
                <label>Notes</label>
                <textarea value={manualNotes} onChange={(e) => setManualNotes(e.target.value)} rows={2} placeholder="Optional" />
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button type="button" className="btn-secondary" style={{ flex: 1, minHeight: 44 }} onClick={() => setShowManual(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" style={{ flex: 2, minHeight: 44 }} disabled={submitting}>
                  {submitting ? "Saving…" : "Save Log"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Log summary header ──────────────────────────────── */}
      {!loading && logs.length > 0 && (
        <div style={{ padding: "0 14px 8px" }}>
          <div style={{
            padding: "10px 14px",
            background: "var(--bg-white)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: "0.8rem",
          }}>
            <span style={{ color: "var(--text-muted)" }}>{displayedCount} of {total} log{total !== 1 ? "s" : ""}</span>
            <span style={{ fontFamily: "monospace", fontWeight: 700, color: "var(--blue)" }}>
              {fmt.format(totalHours)} h total
            </span>
          </div>
        </div>
      )}

      {/* ── Mobile card list ──────────────────────────────────── */}
      <div className="field-mobile-only">
        {logs.length > 0 ? (
          <div className="field-card-list">
            {visibleLogs.map((row, idx) => (
              <TimelogCard key={row.name} row={row} style={idx >= displayLimit ? { display: "none" } : undefined} />
            ))}
          </div>
        ) : loading ? (
          <div className="field-card-list">
            {[1, 2, 3].map((i) => (
              <div key={i} className="timelog-card">
                <div className="skeleton-line" style={{ width: "30%", height: 20, marginBottom: 6 }} />
                <div className="skeleton-line" style={{ width: "60%", height: 11, marginBottom: 10 }} />
                <div className="skeleton-line" style={{ width: "50%", height: 10 }} />
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state" style={{ marginTop: 20 }}>
            <div className="empty-icon">⏱</div>
            <h3>No time logs yet</h3>
            <p>Use Start Timer on an execution, or add a manual entry.</p>
          </div>
        )}
      </div>

      {/* ── Desktop table ─────────────────────────────────────── */}
      <div className="page-content field-desktop-only">
        <div style={{ background: "var(--bg-white)", border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "hidden", boxShadow: "var(--shadow-sm)" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", fontSize: "0.82rem", color: "var(--text-muted)" }}>
            {loading ? "Loading…" : `${displayedCount} of ${total} log(s) · ${fmt.format(totalHours)} h total`}
          </div>
          <DataTableWrapper scrollRef={tableScrollRef} className="data-table-wrapper--nested" loading={loading && logs.length > 0}>
            <table className="data-table" data-excel-filter-all="1" data-table-key="field-timesheet-v1">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Rollout</th>
                  <th>Work</th>
                  <th>Start</th>
                  <th>End</th>
                  <th style={{ textAlign: "right" }}>Hours</th>
                  <th data-excel-filter="0">Status</th>
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ padding: 0 }}>
                      {loading ? (
                        <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Loading time logs…</div>
                      ) : (
                        <div className="empty-state" style={{ marginTop: 20 }}>
                          <div className="empty-icon">⏱</div>
                          <h3>No time logs yet</h3>
                          <p>Use Start timer on an execution, or add a manual entry.</p>
                        </div>
                      )}
                    </td>
                  </tr>
                ) : visibleLogs.map((row, idx) => (
                  <tr key={row.name} style={idx >= displayLimit ? { display: "none" } : undefined}>
                    <td style={{ fontFamily: "monospace", fontSize: 11 }}>{row.name}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 11 }}>{row.rollout_plan}</td>
                    <td style={{ fontSize: "0.78rem", maxWidth: 200 }}>{row.item_description || row.project_code || "—"}</td>
                    <td style={{ fontSize: "0.78rem" }}>{shortDt(row.start_time)}</td>
                    <td style={{ fontSize: "0.78rem" }}>{row.is_running ? "…" : shortDt(row.end_time)}</td>
                    <td style={{ textAlign: "right", fontFamily: "monospace" }}>
                      {row.is_running ? "—" : fmt.format(row.duration_hours || 0)}
                    </td>
                    <td>
                      <span style={{
                        display: "inline-block", padding: "3px 10px", borderRadius: 12,
                        fontSize: 11, fontWeight: 700, textTransform: "uppercase",
                        background: row.is_running ? "var(--amber-bg)" : "var(--green-bg)",
                        color: row.is_running ? "var(--amber)" : "var(--green)",
                      }}>
                        {row.is_running ? "Running" : "Done"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataTableWrapper>
          <TableRowsLimitFooter placement="tableCard" loadedCount={displayedCount} />
        </div>
      </div>
    </div>
  );
}
