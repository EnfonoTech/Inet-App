import { useEffect, useRef, useState } from "react";
import DataTableWrapper from "../../components/DataTableWrapper";
import PageSummary from "../../components/PageSummary";
import { usePublishedQuery } from "../../hooks/usePublishedQuery";
import { pmApi } from "../../services/api";
import { useTableRowLimit, TABLE_ROW_LIMIT_ALL } from "../../context/TableRowLimitContext";
import TableRowsLimitFooter from "../../components/TableRowsLimitFooter";
import { useDebounced } from "../../hooks/useDebounced";
import DateRangePicker from "../../components/DateRangePicker";
import ExportExcelButton from "../../components/ExportExcelButton";
import SearchableSelect from "../../components/SearchableSelect";
import { handleSearchPaste } from "../../utils/searchPaste";
import { useProgressiveRows } from "../../hooks/useProgressiveRows";
import useFilterOptions from "../../hooks/useFilterOptions";

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

// This week, Monday–Sunday. A timesheet page opening on "all time" makes the
// first paint both slow and meaningless; the week is what a manager checks.
function thisWeek() {
  const now = new Date();
  const mon = new Date(now);
  mon.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  const iso = (d) => d.toISOString().slice(0, 10);
  return { from: iso(mon), to: iso(sun) };
}

export default function Timesheets() {
  const { rowLimit } = useTableRowLimit();
  const [tab, setTab] = useState("logs"); // "logs" | "team" | "daily" | "duid"
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
  const [dateFrom, setDateFrom] = useState(() => thisWeek().from);
  const [dateTo, setDateTo] = useState(() => thisWeek().to);
  const [search, setSearch] = useState("");
  const searchDebounced = useDebounced(search, 300);
  const [teamFilter, setTeamFilter] = useState([]);
  // PM-only: narrow to one IM's teams. The backend resolves the IM to its
  // team_ids, so this lands on the same set that IM sees on their own page.
  const [imFilter, setImFilter] = useState("");
  const [imOptions, setImOptions] = useState([]);
  const [teamOptions, setTeamOptions] = useState([]);
  // DUID filter — every distinct site code, not just what's in the loaded
  // page, so the dropdown always offers the full list (see useFilterOptions).
  const [duidFilter, setDuidFilter] = useState([]);
  const { options: duidOpts } = useFilterOptions("PO Dispatch", ["site_code"]);
  const duidOptions = duidOpts.site_code || [];
  useEffect(() => {
    pmApi.getTeamOptions().then((opts) => {
      if (Array.isArray(opts)) setTeamOptions(opts);
    }).catch(() => {});
    pmApi.listIMMasters({ status: "Active" })
      .then((r) => setImOptions((Array.isArray(r) ? r : []).map((x) => ({
        id: x.name, label: x.full_name || x.im_id || x.name,
      }))))
      .catch(() => setImOptions([]));
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
  // Published for the header summary — see usePublishedQuery.
  const [summaryQuery, publishSummaryQuery] = usePublishedQuery();
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
      if (imFilter) filters.im = imFilter;
      if (duidFilter.length) filters.duid = duidFilter;
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
        publishSummaryQuery(filters);
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
  }, [dateFrom, dateTo, teamFilter, imFilter, duidFilter, rowLimit, searchDebounced, columnFiltersDebounced]);

  // Daily Totals — a separate aggregate fetch (first-start to last-end per
  // user per day), not something derivable from `logs` above: `logs` is
  // capped by the row-limit selector, so summing/spanning from whatever
  // happens to already be loaded would silently under-count on any day
  // outside that window. Only fetched once the tab is actually opened.
  const [dailyRows, setDailyRows] = useState([]);
  const [teamRows, setTeamRows] = useState([]);
  const [teamTotals, setTeamTotals] = useState(null);
  const [teamLoading, setTeamLoading] = useState(false);
  const [duidRows, setDuidRows] = useState([]);
  const [duidTotals, setDuidTotals] = useState(null);
  const [duidLoading, setDuidLoading] = useState(false);
  const [dailyLoading, setDailyLoading] = useState(false);
  const dailyFetchedOnce = useRef(false);
  useEffect(() => {
    if (tab !== "daily") return;
    let cancelled = false;
    (async () => {
      const filters = {};
      if (dateFrom) filters.from_date = dateFrom;
      if (dateTo) filters.to_date = dateTo;
      if (teamFilter.length) filters.team_id = teamFilter;
      if (imFilter) filters.im = imFilter;
      if (duidFilter.length) filters.duid = duidFilter;
      if (searchDebounced.trim()) filters.search = searchDebounced.trim();
      setDailyLoading(true);
      try {
        const res = await pmApi.getDailyTimeTotals(filters);
        if (!cancelled) setDailyRows(res?.rows || []);
      } catch {
        if (!cancelled) setDailyRows([]);
      } finally {
        if (!cancelled) { setDailyLoading(false); dailyFetchedOnce.current = true; }
      }
    })();
    return () => { cancelled = true; };
  }, [tab, dateFrom, dateTo, teamFilter, imFilter, duidFilter, searchDebounced]);

  // Team-wise roll-up over the same range. Built on the daily rows server
  // side, so it can never disagree with the Daily Totals tab.
  useEffect(() => {
    if (tab !== "team") return undefined;
    let cancelled = false;
    (async () => {
      const filters = {};
      if (dateFrom) filters.from_date = dateFrom;
      if (dateTo) filters.to_date = dateTo;
      if (teamFilter.length) filters.team_id = teamFilter;
      if (imFilter) filters.im = imFilter;
      if (duidFilter.length) filters.duid = duidFilter;
      if (searchDebounced.trim()) filters.search = searchDebounced.trim();
      setTeamLoading(true);
      try {
        const res = await pmApi.getTeamTimeTotals(filters);
        if (!cancelled) { setTeamRows(res?.rows || []); setTeamTotals(res?.totals || null); }
      } catch {
        if (!cancelled) { setTeamRows([]); setTeamTotals(null); }
      } finally {
        if (!cancelled) setTeamLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tab, dateFrom, dateTo, teamFilter, imFilter, duidFilter, searchDebounced]);

  // DUID-wise roll-up — its own aggregate (not built on the daily rows,
  // which carry no DUID at all — see get_duid_time_totals).
  useEffect(() => {
    if (tab !== "duid") return undefined;
    let cancelled = false;
    (async () => {
      const filters = {};
      if (dateFrom) filters.from_date = dateFrom;
      if (dateTo) filters.to_date = dateTo;
      if (teamFilter.length) filters.team_id = teamFilter;
      if (imFilter) filters.im = imFilter;
      if (duidFilter.length) filters.duid = duidFilter;
      if (searchDebounced.trim()) filters.search = searchDebounced.trim();
      setDuidLoading(true);
      try {
        const res = await pmApi.getDuidTimeTotals(filters);
        if (!cancelled) { setDuidRows(res?.rows || []); setDuidTotals(res?.totals || null); }
      } catch {
        if (!cancelled) { setDuidRows([]); setDuidTotals(null); }
      } finally {
        if (!cancelled) setDuidLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tab, dateFrom, dateTo, teamFilter, imFilter, duidFilter, searchDebounced]);

  const tf = { padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0" };
  const tfR = { ...tf, textAlign: "right", fontWeight: 700 };

  const totalHours = logs.reduce((sum, row) => sum + (parseFloat(row.duration_hours) || 0), 0);
  const hasFilters = dateFrom || dateTo || teamFilter.length || imFilter || duidFilter.length || search;
  const dailySpanTotal = dailyRows.reduce((sum, row) => sum + (parseFloat(row.span_hours) || 0), 0);
  const dailyLoggedTotal = dailyRows.reduce((sum, row) => sum + (parseFloat(row.logged_hours) || 0), 0);
  const dailySessionsTotal = dailyRows.reduce((sum, row) => sum + (parseInt(row.sessions, 10) || 0), 0);
  const dailyTeamsCount = new Set(dailyRows.map((r) => r.team_id).filter(Boolean)).size;
  const dailyAvgSpan = dailyRows.length ? dailySpanTotal / dailyRows.length : 0;
  const dailyLiveCount = dailyRows.filter((r) => r.has_running).length;
  const teamLiveCount = teamRows.filter((r) => r.has_running).length;
  const duidLiveCount = duidRows.filter((r) => r.has_running).length;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Execution time logs</h1>
          <div className="page-subtitle">
            Rollout time · {searchDebounced.trim() ? `${total} matching · ` : ""}{displayedCount} loaded · {fmt.format(totalHours)} h
          </div>
        </div>
        {tab === "logs" ? (
          <PageSummary source="execution_time_logs" filters={summaryQuery} />
        ) : tab === "team" ? (
          <div className="page-summary" role="group" aria-label="Team totals summary">
            <div className="page-summary-chip tone-info">
              <span className="page-summary-value">{teamTotals?.teams ?? teamRows.length}</span>
              <span className="page-summary-label">Teams</span>
            </div>
            <div className="page-summary-chip tone-info">
              <span className="page-summary-value">{teamTotals?.members ?? 0}</span>
              <span className="page-summary-label">Members</span>
            </div>
            <div className="page-summary-chip tone-good">
              <span className="page-summary-value">{teamTotals?.sessions ?? 0}</span>
              <span className="page-summary-label">Sessions</span>
            </div>
            <div className={`page-summary-chip ${teamLiveCount > 0 ? "tone-warn" : "tone-good"}`}>
              <span className="page-summary-value">{teamLiveCount}</span>
              <span className="page-summary-label">Live Now</span>
            </div>
          </div>
        ) : tab === "duid" ? (
          <div className="page-summary" role="group" aria-label="DUID totals summary">
            <div className="page-summary-chip tone-info">
              <span className="page-summary-value">{duidTotals?.duids ?? duidRows.length}</span>
              <span className="page-summary-label">DUIDs</span>
            </div>
            <div className="page-summary-chip tone-info">
              <span className="page-summary-value">{duidTotals?.poids ?? 0}</span>
              <span className="page-summary-label">POIDs</span>
            </div>
            <div className="page-summary-chip tone-good">
              <span className="page-summary-value">{duidTotals?.sessions ?? 0}</span>
              <span className="page-summary-label">Sessions</span>
            </div>
            <div className={`page-summary-chip ${duidLiveCount > 0 ? "tone-warn" : "tone-good"}`}>
              <span className="page-summary-value">{duidLiveCount}</span>
              <span className="page-summary-label">Live Now</span>
            </div>
          </div>
        ) : (
          <div className="page-summary" role="group" aria-label="Daily totals summary">
            <div className="page-summary-chip tone-info">
              <span className="page-summary-value">{dailyRows.length}</span>
              <span className="page-summary-label">Team Days</span>
            </div>
            <div className="page-summary-chip tone-info">
              <span className="page-summary-value">{dailyTeamsCount}</span>
              <span className="page-summary-label">Teams</span>
            </div>
            <div className="page-summary-chip tone-good">
              <span className="page-summary-value">{fmt.format(dailyAvgSpan)}</span>
              <span className="page-summary-label">Avg Hrs / Day</span>
            </div>
            <div className={`page-summary-chip ${dailyLiveCount > 0 ? "tone-warn" : "tone-good"}`}>
              <span className="page-summary-value">{dailyLiveCount}</span>
              <span className="page-summary-label">Live Now</span>
            </div>
          </div>
        )}
        <div className="page-actions">
          <ExportExcelButton filename="timesheets" rows={logs.slice(0, displayedCount)} />
        </div>
      </div>

      <div style={{ display: "flex", borderBottom: "1px solid #e2e8f0", margin: "0 28px 2px", paddingLeft: 4 }}>
        <button type="button" onClick={() => setTab("logs")}
          style={{ padding: "8px 20px", fontSize: "0.86rem", fontWeight: 700, border: "none", borderBottom: tab === "logs" ? "2px solid #1d4ed8" : "2px solid transparent", background: "none", cursor: "pointer", color: tab === "logs" ? "#1d4ed8" : "#64748b" }}>
          Log Entries
        </button>
        <button type="button" onClick={() => setTab("daily")}
          style={{ padding: "8px 20px", fontSize: "0.86rem", fontWeight: 700, border: "none", borderBottom: tab === "daily" ? "2px solid #1d4ed8" : "2px solid transparent", background: "none", cursor: "pointer", color: tab === "daily" ? "#1d4ed8" : "#64748b" }}>
          Daily Totals
        </button>
        <button type="button" onClick={() => setTab("team")}
          style={{ padding: "8px 20px", fontSize: "0.86rem", fontWeight: 700, border: "none", borderBottom: tab === "team" ? "2px solid #1d4ed8" : "2px solid transparent", background: "none", cursor: "pointer", color: tab === "team" ? "#1d4ed8" : "#64748b" }}>
          Team Totals
        </button>
        <button type="button" onClick={() => setTab("duid")}
          style={{ padding: "8px 20px", fontSize: "0.86rem", fontWeight: 700, border: "none", borderBottom: tab === "duid" ? "2px solid #1d4ed8" : "2px solid transparent", background: "none", cursor: "pointer", color: tab === "duid" ? "#1d4ed8" : "#64748b" }}>
          DUID Totals
        </button>
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
        <SearchableSelect
          value={imFilter}
          onChange={setImFilter}
          options={imOptions}
          placeholder="All IMs"
          minWidth={150}
        />
        <SearchableSelect
          allowBlank
          multi
          value={duidFilter}
          onChange={setDuidFilter}
          options={duidOptions}
          placeholder="All DUIDs"
          minWidth={160}
        />
        <DateRangePicker value={{ from: dateFrom, to: dateTo }} onChange={({ from, to }) => { setDateFrom(from); setDateTo(to); }} />
        {hasFilters && (
          <button
            className="btn-secondary"
            style={{ fontSize: "0.78rem", padding: "5px 12px" }}
            onClick={() => {
              setDateFrom("");
              setDateTo("");
              setTeamFilter([]); setImFilter(""); setDuidFilter([]);
              setSearch("");
            }}
          >
            Clear
          </button>
        )}
      </div>

      <div className="page-content">
        <DataTableWrapper loading={
          tab === "logs" ? (loading && logs.length > 0)
            : tab === "team" ? (teamLoading && teamRows.length > 0)
              : tab === "duid" ? (duidLoading && duidRows.length > 0)
                : (dailyLoading && dailyRows.length > 0)
        }>
          {tab === "team" ? (
            <table key="admin-timesheets-v1-team" className="data-table" data-excel-filter-all="1" data-table-key="admin-timesheets-v1-team">
              <thead>
                <tr>
                  <th>Team</th>
                  <th style={{ textAlign: "right" }}>Days</th>
                  <th style={{ textAlign: "right" }}>Members</th>
                  <th style={{ textAlign: "right" }}>Sessions</th>
                  <th style={{ textAlign: "right" }}>Span (hrs)</th>
                  <th style={{ textAlign: "right" }}>Logged (hrs)</th>
                  <th style={{ textAlign: "right" }}>Idle (hrs)</th>
                  <th style={{ textAlign: "right" }}>Avg/day (hrs)</th>
                </tr>
              </thead>
              <tbody>
                {teamRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ padding: 0 }}>
                      {teamLoading ? (
                        <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Loading…</div>
                      ) : (
                        <div className="empty-state">
                          <div className="empty-icon">⏱</div>
                          <h3>No time logged in this range</h3>
                          <p>Pick a wider date range, or clear the filters.</p>
                        </div>
                      )}
                    </td>
                  </tr>
                ) : teamRows.map((r) => (
                  <tr key={r.team_id || "none"}>
                    <td style={{ fontWeight: 600 }}>
                      {r.team_name}
                      {r.has_running && (
                        <span style={{ marginLeft: 8, fontSize: "0.68rem", fontWeight: 700, color: "#15803d" }}>● live</span>
                      )}
                    </td>
                    <td style={{ textAlign: "right" }}>{r.days}</td>
                    <td style={{ textAlign: "right" }}>{r.members}</td>
                    <td style={{ textAlign: "right" }}>{r.sessions}</td>
                    <td style={{ textAlign: "right", fontWeight: 700 }}>{fmt.format(r.span_hours)}</td>
                    <td style={{ textAlign: "right" }}>{fmt.format(r.logged_hours)}</td>
                    <td style={{ textAlign: "right", color: r.idle_hours > 0 ? "#b45309" : undefined }}>{fmt.format(r.idle_hours)}</td>
                    <td style={{ textAlign: "right" }}>{fmt.format(r.avg_span_per_day)}</td>
                  </tr>
                ))}
              </tbody>
              {teamRows.length > 0 && teamTotals && (
                <tfoot>
                  <tr>
                    <td style={tf}><strong>Total</strong></td>
                    <td style={tfR}>{teamTotals.days}</td>
                    <td style={tfR}>{teamTotals.members}</td>
                    <td style={tfR}>{teamTotals.sessions}</td>
                    <td style={tfR}>{fmt.format(teamTotals.span_hours)}</td>
                    <td style={tfR}>{fmt.format(teamTotals.logged_hours)}</td>
                    <td style={tf} /><td style={tf} />
                  </tr>
                </tfoot>
              )}
            </table>
          ) : tab === "logs" ? (
            <table key="admin-timesheets-v1-logs" className="data-table" data-excel-filter-all="1" data-table-key="admin-timesheets-v1-logs">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>User</th>
                  <th>Team</th>
                  <th>DUID</th>
                  <th>POID</th>
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
                    <td colSpan={11} style={{ padding: 0 }}>
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
                    <td style={{ fontFamily: "monospace", fontSize: "0.76rem" }}>{row.duid || "—"}</td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.76rem" }}>{row.poid || "—"}</td>
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
                    <td style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", fontWeight: 700, fontSize: "0.78rem" }}>
                      Total{displayedCount < total ? ` (${displayedCount} loaded of ${total})` : ` (${total})`}
                    </td>
                    <td style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0" }} />
                    <td style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0" }} />
                    <td style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0" }} />
                    <td style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0" }} />
                    <td style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0" }} />
                    <td style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0" }} />
                    <td style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0" }} />
                    <td style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0" }} />
                    <td style={{ textAlign: "right", fontWeight: 700, padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0" }}>
                      {fmt.format(totalHours)}
                    </td>
                    <td style={{ background: "#f8fafc", borderTop: "1px solid #e2e8f0" }} />
                  </tr>
                </tfoot>
              )}
            </table>
          ) : tab === "duid" ? (
            <table key="admin-timesheets-v1-duid" className="data-table" data-excel-filter-all="1" data-table-key="admin-timesheets-v1-duid">
              <thead>
                <tr>
                  <th>DUID</th>
                  <th>Project</th>
                  <th style={{ textAlign: "right" }}>POIDs</th>
                  <th style={{ textAlign: "right" }}>Teams</th>
                  <th style={{ textAlign: "right" }}>Days</th>
                  <th style={{ textAlign: "right" }}>Sessions</th>
                  <th style={{ textAlign: "right" }}>Logged (hrs)</th>
                  <th>First</th>
                  <th>Last</th>
                </tr>
              </thead>
              <tbody>
                {duidRows.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ padding: 0 }}>
                      {duidLoading ? (
                        <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Loading…</div>
                      ) : (
                        <div className="empty-state">
                          <div className="empty-icon">📍</div>
                          <h3>No time logged in this range</h3>
                          <p>Pick a wider date range, or clear the filters.</p>
                        </div>
                      )}
                    </td>
                  </tr>
                ) : duidRows.map((r) => (
                  <tr key={r.duid}>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem", fontWeight: 600 }} title={r.site_name || ""}>
                      {r.duid}
                      {r.has_running && (
                        <span style={{ marginLeft: 8, fontSize: "0.68rem", fontWeight: 700, color: "#15803d" }}>● live</span>
                      )}
                    </td>
                    <td style={{ fontSize: "0.82rem" }}>{r.project_code || "—"}</td>
                    <td style={{ textAlign: "right" }}>{r.poids}</td>
                    <td style={{ textAlign: "right" }}>{r.teams}</td>
                    <td style={{ textAlign: "right" }}>{r.days}</td>
                    <td style={{ textAlign: "right" }}>{r.sessions}</td>
                    <td style={{ textAlign: "right", fontWeight: 700 }}>{fmt.format(r.logged_hours)}</td>
                    <td style={{ fontSize: "0.78rem" }}>{r.first_date || "—"}</td>
                    <td style={{ fontSize: "0.78rem" }}>{r.last_date || "—"}</td>
                  </tr>
                ))}
              </tbody>
              {duidRows.length > 0 && duidTotals && (
                <tfoot>
                  <tr>
                    <td style={tf}><strong>Total</strong></td>
                    <td style={tf} />
                    <td style={tfR}>{duidTotals.poids}</td>
                    <td style={tf} />
                    <td style={tf} />
                    <td style={tfR}>{duidTotals.sessions}</td>
                    <td style={tfR}>{fmt.format(duidTotals.logged_hours)}</td>
                    <td style={tf} /><td style={tf} />
                  </tr>
                </tfoot>
              )}
            </table>
          ) : (
            <table key="admin-timesheets-v1-daily" className="data-table" data-excel-filter-all="1" data-table-key="admin-timesheets-v1-daily">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>User</th>
                  <th>Team</th>
                  <th>First Start</th>
                  <th>Last End</th>
                  <th style={{ textAlign: "right" }}>Span (hrs)</th>
                  <th style={{ textAlign: "right" }}>Logged (hrs)</th>
                  <th style={{ textAlign: "right" }}>Sessions</th>
                </tr>
              </thead>
              <tbody>
                {dailyRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ padding: 0 }}>
                      {dailyLoading ? (
                        <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Loading…</div>
                      ) : (
                        <div className="empty-state" style={{ marginTop: 20 }}>
                          <div className="empty-icon">&#x1F553;</div>
                          <h3>{hasFilters ? "No results" : "No time logs in range"}</h3>
                          <p>First clock-in to last clock-out per team per day.</p>
                        </div>
                      )}
                    </td>
                  </tr>
                ) : dailyRows.map((row, idx) => (
                  <tr key={`${row.log_date}-${row.user}-${row.team_id}-${idx}`}>
                    <td style={{ fontSize: "0.78rem" }}>{row.log_date}</td>
                    <td>{row.user_full_name || row.user}</td>
                    <td>{row.team_name || row.team_id || "—"}</td>
                    <td style={{ fontSize: "0.78rem" }}>{shortDt(row.first_start)}</td>
                    <td style={{ fontSize: "0.78rem" }}>
                      {row.last_end ? shortDt(row.last_end) : (
                        <span style={{ color: "#b45309", fontWeight: 700 }}>Ongoing</span>
                      )}
                    </td>
                    <td style={{ textAlign: "right", fontFamily: "'JetBrains Mono', monospace", fontWeight: 700 }}>
                      {row.span_hours == null ? "—" : fmt.format(row.span_hours)}
                      {row.has_running && <span title="A session that day is still running — this total can still grow" style={{ marginLeft: 4, color: "#b45309" }}>●</span>}
                    </td>
                    <td style={{ textAlign: "right", fontFamily: "'JetBrains Mono', monospace" }}>
                      {fmt.format(row.logged_hours || 0)}
                    </td>
                    <td style={{ textAlign: "right" }}>{row.sessions}</td>
                  </tr>
                ))}
              </tbody>
              {dailyRows.length > 0 && (
                <tfoot>
                  <tr>
                    <td style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", fontWeight: 700, fontSize: "0.78rem" }}>
                      Total
                    </td>
                    <td style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0" }} />
                    <td style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0" }} />
                    <td style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0" }} />
                    <td style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0" }} />
                    <td style={{ textAlign: "right", fontWeight: 700, padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0" }}>
                      {fmt.format(dailySpanTotal)}
                    </td>
                    <td style={{ textAlign: "right", fontWeight: 700, padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0" }}>
                      {fmt.format(dailyLoggedTotal)}
                    </td>
                    <td style={{ textAlign: "right", fontWeight: 700, padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0" }}>
                      {dailySessionsTotal}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          )}
        </DataTableWrapper>
        {tab === "logs" ? (
          <TableRowsLimitFooter
            placement="tableCard"
            loadedCount={displayedCount}
            filteredCount={searchDebounced.trim() ? total : displayedCount}
            filterActive={!!(search || dateFrom || dateTo || teamFilter.length || imFilter || duidFilter.length)}
          />
        ) : (
          // One shared bar for team/daily/duid — none of them are paged by
          // rowLimit (each endpoint always returns every matching row for
          // the current filters), so there is no "rows to load" control to
          // show. Said explicitly rather than just omitting the control,
          // which otherwise reads as broken next to the Logs tab's real one.
          // Styled to match TableRowsLimitFooter's own "tableCard" card
          // look (border/radius/background come from the SAME
          // .table-rowlimit-footer CSS class both use) so switching tabs
          // doesn't shift the footer's appearance.
          // Business totals (span/logged/sessions/etc.) live in each
          // table's own <tfoot>, column-aligned — not repeated here.
          <div
            className="table-rowlimit-footer"
            style={{
              display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10,
              padding: "10px 14px", fontSize: "0.78rem", color: "var(--text-muted, #64748b)",
              borderTop: "1px solid var(--border, #e2e8f0)",
              background: "var(--bg-white, #fff)",
              borderRadius: "0 0 var(--radius, 10px) var(--radius, 10px)",
            }}
          >
            <span>
              Loaded{" "}
              <strong style={{ color: "var(--text, #0f172a)" }}>
                {tab === "team" ? teamRows.length : tab === "duid" ? duidRows.length : dailyRows.length}
              </strong>{" "}
              {tab === "team" ? `team${teamRows.length !== 1 ? "s" : ""}`
                : tab === "duid" ? `DUID${duidRows.length !== 1 ? "s" : ""}`
                  : `row${dailyRows.length !== 1 ? "s" : ""}`}
            </span>
            <span style={{ color: "var(--text-muted, #94a3b8)" }}>
              Loads every matching row — no row limit on this tab
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
