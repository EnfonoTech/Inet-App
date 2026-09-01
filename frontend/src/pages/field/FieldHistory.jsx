import { useEffect, useRef, useState } from "react";
import DataTableWrapper from "../../components/DataTableWrapper";
import { useAuth } from "../../context/AuthContext";
import { useTableRowLimit, TABLE_ROW_LIMIT_ALL } from "../../context/TableRowLimitContext";
import { useProgressiveRows } from "../../hooks/useProgressiveRows";
import TableRowsLimitFooter from "../../components/TableRowsLimitFooter";
import { pmApi } from "../../services/api";
import { isNotRequired } from "../../utils/qcCiagFlags";
import { useDebounced } from "../../hooks/useDebounced";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

function statusBadgeClass(s) {
  const v = (s || "").toLowerCase().replace(/\s+/g, "-");
  if (v === "completed") return "completed";
  if (v === "in-progress" || v === "in-execution") return "in-progress";
  if (v === "cancelled") return "cancelled";
  return "new";
}

function statusAccent(s) {
  const v = (s || "").toLowerCase();
  if (v === "completed") return "status-completed";
  if (v.includes("progress") || v.includes("execution")) return "status-in-progress";
  if (v === "cancelled") return "status-cancelled";
  return "";
}

function formatDate(v) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch { return String(v); }
}

/* Mobile card for a single history record. Each row is a plan + its
   latest execution, joined server-side. Shows the field team's
   tl_status ("My Status") plus the IM's execution_status ("IM Status")
   so the team lead can see whether the IM has confirmed. */
function HistoryCard({ r, hidden }) {
  const dateStr = r.execution_date || r.plan_date;
  return (
    <div className={`history-card ${statusAccent(r.tl_status || r.execution_status)}`} style={hidden ? { display: "none" } : undefined}>
      <div className="history-card-row">
        <div style={{ fontWeight: 700, fontSize: "0.82rem", color: "var(--text)" }}>
          {r.poid || r.name}
        </div>
        <span style={{ fontSize: "0.74rem", color: "var(--text-muted)" }}>
          {dateStr ? formatDate(dateStr) : "—"}
        </span>
      </div>
      {r.execution_name && (
        <div style={{ fontFamily: "monospace", fontSize: "0.7rem", color: "var(--text-muted)", marginTop: 2 }}>
          {r.execution_name}
        </div>
      )}
      {r.item_description && (
        <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)", marginTop: 2, lineHeight: 1.35 }}>
          {r.item_description}
        </div>
      )}
      <div className="history-card-meta" style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", fontSize: "0.74rem", color: "var(--text-muted)", marginTop: 6 }}>
        {r.project_code && <span>Project: <strong style={{ color: "var(--text)" }}>{r.project_code}</strong></span>}
        {r.site_code && <span>DUID: <strong style={{ color: "var(--text)" }}>{r.site_code}</strong></span>}
        {r.item_code && <span>Item: <strong style={{ color: "var(--text)" }}>{r.item_code}</strong></span>}
        {r.visit_type && <span>{r.visit_type}</span>}
      </div>
      <div className="history-card-detail" style={{ marginTop: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", marginBottom: 4 }}>
          <span style={{ color: "var(--text-muted)", fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: 0.4 }}>My Status</span>
          <span className={`status-badge ${statusBadgeClass(r.tl_status)}`}>
            <span className="status-dot" />
            {r.tl_status || "—"}
          </span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", marginBottom: 4 }}>
          <span style={{ color: "var(--text-muted)", fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: 0.4 }}>IM Status</span>
          <span className={`status-badge ${statusBadgeClass(r.execution_status)}`}>
            <span className="status-dot" />
            {r.execution_status || "—"}
          </span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", marginBottom: 4 }}>
          <span style={{ color: "var(--text-muted)", fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: 0.4 }}>QC / CIAG</span>
          <span style={{ display: "flex", gap: 4 }}>
            <span className={`status-badge ${statusBadgeClass(isNotRequired(r.qc_required) ? "Not Applicable" : r.qc_status)}`} style={{ fontSize: "0.7rem" }}>
              <span className="status-dot" />{isNotRequired(r.qc_required) ? "Not Applicable" : (r.qc_status || "—")}
            </span>
            <span className={`status-badge ${statusBadgeClass(isNotRequired(r.ciag_required) ? "Not Applicable" : r.ciag_status)}`} style={{ fontSize: "0.7rem" }}>
              <span className="status-dot" />{isNotRequired(r.ciag_required) ? "Not Applicable" : (r.ciag_status || "—")}
            </span>
          </span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <span style={{ color: "var(--text-muted)" }}>Achieved Qty</span>
          <span style={{ fontWeight: 700, color: "var(--text)" }}>{fmt.format(r.execution_achieved_qty || 0)}</span>
        </div>
        {r.gps_location && (
          <div style={{ display: "flex", gap: 6, marginTop: 4, fontSize: "0.72rem", color: "var(--text-muted)", alignItems: "flex-start" }}>
            <svg viewBox="0 0 20 20" fill="currentColor" width="12" height="12" style={{ flexShrink: 0, marginTop: 2 }}>
              <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd"/>
            </svg>
            <span style={{ fontFamily: "monospace", wordBreak: "break-all" }}>{r.gps_location}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function FieldHistory() {
  const { teamId } = useAuth();
  const { rowLimit } = useTableRowLimit();
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  // See useProgressiveRows — mounts large row sets in chunks so the browser
  // doesn't show "Page Unresponsive" on tables with "All" rows loaded.
  const visibleRecords = useProgressiveRows(records, { paused: loading });
  // How many of `visibleRecords` to actually show — anything beyond this is
  // hidden via CSS in the render below rather than removed from `records`
  // (see the skip-fetch logic in the fetch effect: shrinking the limit after
  // "All" already loaded everything doesn't trim `records`, since slicing it
  // would still force React to tear down however many rows that drops).
  const displayLimit = rowLimit === TABLE_ROW_LIMIT_ALL ? Infinity : rowLimit;
  const displayedCount = Math.min(records.length, displayLimit);

  // ── Manage Table column filters ──────────────────────────────────────
  // Each column's typed value is matched only against that column's own
  // value on the backend (see column_filters / col_filter_map in
  // list_execution_monitor_rows).
  const [columnFilters, setColumnFilters] = useState({});
  useEffect(() => {
    const onFiltersChanged = (e) => {
      if (e.detail?.tableKey !== "field-history-v1") return;
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
      if (e.detail?.tableKey !== "field-history-v1") return;
      e.detail.respond(pmApi.getColumnFilterOptions({
        source: "execution_monitor",
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

  // Remembers what the LAST real fetch actually returned, and under what
  // limit + filters. Shrinking the row limit (e.g. All -> 20) never needs
  // another round-trip — whatever's being asked for is already sitting in
  // `records` from the larger fetch; the render below just hides the extra
  // rows via CSS (see displayLimit/displayedCount above) instead of slicing
  // the array, which would still force React to unmount however many rows
  // that drops. Only growing the limit — or teamId/column filters actually
  // changing — hits the server.
  const lastFetchRef = useRef({ signature: null, limit: null, rows: [] });

  useEffect(() => {
    let cancelled = false;
    if (!teamId) { setRecords([]); setLoading(false); return; }

    const colFilters = JSON.parse(columnFiltersDebounced);
    const signature = JSON.stringify([teamId, colFilters]);
    const prev = lastFetchRef.current;
    const alreadyHaveEnough = prev.signature === signature && (
      prev.limit === TABLE_ROW_LIMIT_ALL
      || (rowLimit !== TABLE_ROW_LIMIT_ALL && rowLimit <= prev.limit)
    );
    if (alreadyHaveEnough) {
      // Deliberately not touching `records` — leave it (and whatever's
      // already mounted in the DOM) exactly as-is; the render hides the
      // rows past the new limit via style instead.
      return;
    }

    setLoading(true);
    (async () => {
      try {
        // listExecutionMonitorRows joins Rollout Plan + PO Dispatch +
        // Daily Execution server-side, so we get POID, item code,
        // project, DUID, qty, etc. enriched for free. Bare
        // /api/resource/Daily Execution returned only DE columns and
        // forced the table to render with mostly empty cells.
        const teamFilters = { team: teamId };
        if (Object.keys(colFilters).length) teamFilters.column_filters = colFilters;
        queryArgsRef.current = teamFilters;
        const list = await pmApi.listExecutionMonitorRows(teamFilters, rowLimit);
        // History = rows where the field team has actually started or
        // recorded execution. Plain plans with no Daily Execution yet
        // (no execution_name) are still in "today's work" territory and
        // shouldn't clutter the history list.
        const onlyExecuted = (Array.isArray(list) ? list : []).filter(
          (r) => !!r.execution_name
        );
        if (!cancelled) {
          setRecords(onlyExecuted);
          lastFetchRef.current = { signature, limit: rowLimit, rows: onlyExecuted };
        }
      } catch {
        if (!cancelled) setRecords([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [teamId, rowLimit, columnFiltersDebounced]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Execution History</h1>
          <div className="page-subtitle">Past execution records for {teamId || "your team"}</div>
        </div>
        <div className="page-actions">
          <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{displayedCount} records</span>
        </div>
      </div>

      {/* ── Mobile card list ──────────────────────────────── */}
      <div className="field-mobile-only">
        {records.length > 0 ? (
          <div className="field-card-list">
            {visibleRecords.map((r, idx) => <HistoryCard key={r.name} r={r} hidden={idx >= displayLimit} />)}
          </div>
        ) : loading ? (
          <div className="field-card-list">
            {[1, 2, 3].map((i) => (
              <div key={i} className="history-card">
                <div className="skeleton-line" style={{ width: "60%", height: 13, marginBottom: 8 }} />
                <div className="skeleton-line" style={{ width: "40%", height: 10, marginBottom: 12 }} />
                <div className="skeleton-line" style={{ width: "100%", height: 10 }} />
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state" style={{ marginTop: 40 }}>
            <div className="empty-icon">📜</div>
            <h3>No execution history</h3>
            <p>Complete today's tasks to see history here.</p>
          </div>
        )}
      </div>

      {/* ── Desktop table ─────────────────────────────────── */}
      <div className="page-content field-desktop-only">
        <DataTableWrapper loading={loading && records.length > 0}>
          <table className="data-table" data-excel-filter-all="1" data-table-key="field-history-v1">
            <thead>
              <tr>
                <th>Execution ID</th>
                <th>POID</th>
                <th>Project</th>
                <th>DUID</th>
                <th>Item</th>
                <th>Description</th>
                <th>Visit</th>
                <th>Date</th>
                <th title="The status you (Team Lead) submitted">My Status</th>
                <th title="The IM's confirmation of your work">IM Status</th>
                <th>QC</th>
                <th>CIAG</th>
                <th style={{ textAlign: "right" }}>Achieved Qty</th>
                <th>GPS</th>
              </tr>
            </thead>
            <tbody>
              {records.length === 0 ? (
                <tr>
                  <td colSpan={14} style={{ padding: 0 }}>
                    {loading ? (
                      <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)" }}>Loading...</div>
                    ) : (
                      <div className="empty-state">
                        <div className="empty-icon">📜</div>
                        <h3>No execution history</h3>
                        <p>Complete today's tasks to see history here.</p>
                      </div>
                    )}
                  </td>
                </tr>
              ) : visibleRecords.map((r, idx) => (
                <tr key={r.name} style={idx >= displayLimit ? { display: "none" } : undefined}>
                  <td style={{ fontFamily: "monospace", fontSize: "0.74rem" }} title={r.execution_name ? "" : "No execution recorded yet"}>
                    {r.execution_name || "—"}
                  </td>
                  <td style={{ fontFamily: "monospace", fontSize: "0.78rem", fontWeight: 600 }}>{r.poid || r.name}</td>
                  <td>{r.project_code || "—"}</td>
                  <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{r.site_code || "—"}</td>
                  <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{r.item_code || "—"}</td>
                  <td style={{ fontSize: "0.8rem", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }} title={r.item_description || ""}>
                    {r.item_description || "—"}
                  </td>
                  <td style={{ fontSize: "0.8rem" }}>{r.visit_type || "—"}</td>
                  <td>{r.execution_date || r.plan_date || "—"}</td>
                  <td>
                    <span className={`status-badge ${statusBadgeClass(r.tl_status)}`}>
                      <span className="status-dot" />{r.tl_status || "—"}
                    </span>
                  </td>
                  <td>
                    <span className={`status-badge ${statusBadgeClass(r.execution_status)}`}>
                      <span className="status-dot" />{r.execution_status || "—"}
                    </span>
                  </td>
                  <td>
                    <span className={`status-badge ${statusBadgeClass(isNotRequired(r.qc_required) ? "Not Applicable" : r.qc_status)}`}>
                      <span className="status-dot" />{isNotRequired(r.qc_required) ? "Not Applicable" : (r.qc_status || "—")}
                    </span>
                  </td>
                  <td>
                    <span className={`status-badge ${statusBadgeClass(isNotRequired(r.ciag_required) ? "Not Applicable" : r.ciag_status)}`}>
                      <span className="status-dot" />{isNotRequired(r.ciag_required) ? "Not Applicable" : (r.ciag_status || "—")}
                    </span>
                  </td>
                  <td style={{ textAlign: "right" }}>{fmt.format(r.execution_achieved_qty || 0)}</td>
                  <td style={{ fontSize: "0.72rem", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {r.gps_location || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataTableWrapper>
        <TableRowsLimitFooter placement="tableCard" loadedCount={displayedCount} />
      </div>
    </div>
  );
}
