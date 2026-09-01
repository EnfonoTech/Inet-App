import { useEffect, useRef, useState } from "react";
import DataTableWrapper from "../../components/DataTableWrapper";
import { pmApi } from "../../services/api";
import { useTableRowLimit, TABLE_ROW_LIMIT_ALL } from "../../context/TableRowLimitContext";
import TableRowsLimitFooter from "../../components/TableRowsLimitFooter";
import { useDebounced } from "../../hooks/useDebounced";
import DateRangePicker from "../../components/DateRangePicker";
import ExportExcelButton from "../../components/ExportExcelButton";
import SearchableSelect from "../../components/SearchableSelect";
import { handleSearchPaste } from "../../utils/searchPaste";
import { useProgressiveRows } from "../../hooks/useProgressiveRows";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });

function shortDt(v) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(v);
  }
}

export default function Timesheets() {
  const { rowLimit } = useTableRowLimit();
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  // See useProgressiveRows — mounts large row sets in chunks so the browser
  // doesn't show "Page Unresponsive" on tables with "All" rows loaded.
  const visibleLogs = useProgressiveRows(logs, { paused: loading });
  // How many of `visibleLogs` to actually show — anything beyond this is
  // hidden via CSS in the render below rather than removed from `logs`. See
  // the skip-fetch logic in the fetch effect below / PICTracker.jsx.
  const displayLimit = rowLimit === TABLE_ROW_LIMIT_ALL ? Infinity : rowLimit;
  const displayedCount = Math.min(logs.length, displayLimit);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");
  const searchDebounced = useDebounced(search, 300);
  const [teamFilter, setTeamFilter] = useState([]);
  const [teamOptions, setTeamOptions] = useState([]);
  useEffect(() => {
    pmApi.getTeamOptions().then((opts) => {
      if (Array.isArray(opts)) setTeamOptions(opts);
    }).catch(() => {});
  }, []);

  // ── Manage Table column filters ──────────────────────────────────────
  // Each column's typed value is matched only against that column's own
  // value on the backend (see column_filters / col_filter_map_etl in
  // list_execution_time_logs), not blended into the top search box's wide
  // multi-column search.
  const [columnFilters, setColumnFilters] = useState({});
  useEffect(() => {
    const onFiltersChanged = (e) => {
      if (e.detail?.tableKey !== "admin-timesheets-v1") return;
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
      if (e.detail?.tableKey !== "admin-timesheets-v1") return;
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
  // fetched at all) — or any OTHER filter actually changing — hits the
  // server. See PICTracker.jsx for the reference implementation.
  const lastFetchRef = useRef({ signature: null, limit: null, rows: [] });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const filters = {};
      if (dateFrom) filters.from_date = dateFrom;
      if (dateTo) filters.to_date = dateTo;
      if (teamFilter.length) filters.team_id = teamFilter;
      if (searchDebounced.trim()) filters.search = searchDebounced.trim();
      const colFilters = JSON.parse(columnFiltersDebounced);
      if (Object.keys(colFilters).length) filters.column_filters = colFilters;
      const signature = JSON.stringify([filters]);

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
  }, [dateFrom, dateTo, teamFilter, rowLimit, searchDebounced, columnFiltersDebounced]);

  const totalHours = logs.reduce((sum, row) => sum + (parseFloat(row.duration_hours) || 0), 0);
  const hasFilters = dateFrom || dateTo || teamFilter.length || search;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Execution time logs</h1>
          <div className="page-subtitle">
            Field time on rollouts · {searchDebounced.trim() ? `${total} matching · ` : ""}{displayedCount} loaded · {fmt.format(totalHours)} h
          </div>
        </div>
        <div className="page-actions">
          <ExportExcelButton filename="timesheets" rows={logs.slice(0, displayedCount)} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14, margin: "0 28px 20px" }}>
        <div className="summary-card accent-blue">
          <div className="card-label">Log lines</div>
          <div className="card-value">{searchDebounced.trim() ? total : displayedCount}</div>
        </div>
        <div className="summary-card accent-green">
          <div className="card-label">Total hours</div>
          <div className="card-value">{fmt.format(totalHours)}</div>
        </div>
      </div>

      <div className="toolbar">
        <input
          type="search"
          placeholder="Search user, plan, team, project…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onPaste={(e) => handleSearchPaste(e, setSearch)}
          style={{
            padding: "7px 14px",
            borderRadius: 8,
            border: "1px solid #e2e8f0",
            fontSize: "0.84rem",
            minWidth: 200,
          }}
        />
        <SearchableSelect
          multi
          value={teamFilter}
          onChange={setTeamFilter}
          options={teamOptions}
          placeholder="All Teams"
          minWidth={150}
        />
        <DateRangePicker value={{ from: dateFrom, to: dateTo }} onChange={({ from, to }) => { setDateFrom(from); setDateTo(to); }} />
        {hasFilters && (
          <button
            className="btn-secondary"
            style={{ fontSize: "0.78rem", padding: "5px 12px" }}
            onClick={() => {
              setDateFrom("");
              setDateTo("");
              setTeamFilter([]);
              setSearch("");
            }}
          >
            Clear
          </button>
        )}
      </div>

      <div className="page-content">
        <DataTableWrapper loading={loading && logs.length > 0}>
            <table className="data-table" data-excel-filter-all="1" data-table-key="admin-timesheets-v1">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>User</th>
                  <th>Team</th>
                  <th>Rollout</th>
                  <th>Work / project</th>
                  <th>Start</th>
                  <th>End</th>
                  <th style={{ textAlign: "right" }}>Hours</th>
                  <th data-excel-filter="0">State</th>
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ padding: 0 }}>
                      {loading ? (
                        <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Loading…</div>
                      ) : (
                        <div className="empty-state" style={{ marginTop: 20 }}>
                          <div className="empty-icon">&#x1F553;</div>
                          <h3>{hasFilters ? "No results" : "No execution time logs"}</h3>
                          <p>Logs appear when field users start/stop timers or add manual entries on rollouts.</p>
                        </div>
                      )}
                    </td>
                  </tr>
                ) : visibleLogs.map((row, idx) => (
                  <tr key={row.name} style={idx >= displayLimit ? { display: "none" } : undefined}>
                    <td style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>{row.name}</td>
                    <td>{row.user_full_name || row.user}</td>
                    <td>{row.team_name || row.team_id || "—"}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 11 }}>{row.rollout_plan}</td>
                    <td style={{ fontSize: "0.78rem", maxWidth: 220 }}>
                      {row.item_description || row.project_code || "—"}
                    </td>
                    <td style={{ fontSize: "0.78rem" }}>{shortDt(row.start_time)}</td>
                    <td style={{ fontSize: "0.78rem" }}>{row.is_running ? "—" : shortDt(row.end_time)}</td>
                    <td style={{ textAlign: "right", fontFamily: "'JetBrains Mono', monospace" }}>
                      {row.is_running ? "—" : fmt.format(row.duration_hours || 0)}
                    </td>
                    <td>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "3px 10px",
                          borderRadius: 12,
                          fontSize: 11,
                          fontWeight: 700,
                          textTransform: "uppercase",
                          background: row.is_running ? "#fef3c7" : "#ecfdf5",
                          color: row.is_running ? "#92400e" : "#065f46",
                        }}
                      >
                        {row.is_running ? "Running" : "Done"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              {logs.length > 0 && (
                <tfoot>
                  <tr>
                    <td
                      style={{
                        padding: "10px 16px",
                        background: "#f8fafc",
                        borderTop: "1px solid #e2e8f0",
                        fontWeight: 700,
                        fontSize: "0.78rem",
                      }}>
                      TOTALS ({displayedCount}
                      {hasFilters && ` of ${displayedCount}`} / {total} in range)
                    </td>
                    <td
                      style={{
                        padding: "10px 16px",
                        background: "#f8fafc",
                        borderTop: "1px solid #e2e8f0",
                        fontWeight: 700,
                        fontSize: "0.78rem",
                      }} />
                    <td
                      style={{
                        padding: "10px 16px",
                        background: "#f8fafc",
                        borderTop: "1px solid #e2e8f0",
                        fontWeight: 700,
                        fontSize: "0.78rem",
                      }} />
                    <td
                      style={{
                        padding: "10px 16px",
                        background: "#f8fafc",
                        borderTop: "1px solid #e2e8f0",
                        fontWeight: 700,
                        fontSize: "0.78rem",
                      }} />
                    <td
                      style={{
                        padding: "10px 16px",
                        background: "#f8fafc",
                        borderTop: "1px solid #e2e8f0",
                        fontWeight: 700,
                        fontSize: "0.78rem",
                      }} />
                    <td
                      style={{
                        padding: "10px 16px",
                        background: "#f8fafc",
                        borderTop: "1px solid #e2e8f0",
                        fontWeight: 700,
                        fontSize: "0.78rem",
                      }} />
                    <td
                      style={{
                        padding: "10px 16px",
                        background: "#f8fafc",
                        borderTop: "1px solid #e2e8f0",
                        fontWeight: 700,
                        fontSize: "0.78rem",
                      }} />
                    <td
                      style={{
                        textAlign: "right",
                        fontWeight: 700,
                        padding: "10px 16px",
                        background: "#f8fafc",
                        borderTop: "1px solid #e2e8f0",
                      }}
                    >
                      {fmt.format(totalHours)}
                    </td>
                    <td style={{ background: "#f8fafc", borderTop: "1px solid #e2e8f0" }} />
                  </tr>
                </tfoot>
              )}
            </table>
        </DataTableWrapper>
        <TableRowsLimitFooter
          placement="tableCard"
          loadedCount={displayedCount}
          filteredCount={searchDebounced.trim() ? total : displayedCount}
          filterActive={!!(search || dateFrom || dateTo || teamFilter)}
        />
      </div>
    </div>
  );
}
