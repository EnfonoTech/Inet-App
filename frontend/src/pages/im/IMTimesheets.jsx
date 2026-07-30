import { useEffect, useState } from "react";
import DataTableWrapper from "../../components/DataTableWrapper";
import { pmApi } from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { useTableRowLimit } from "../../context/TableRowLimitContext";
import TableRowsLimitFooter from "../../components/TableRowsLimitFooter";
import RecordDetailView from "../../components/RecordDetailView";
import DateRangePicker from "../../components/DateRangePicker";
import ExportExcelButton from "../../components/ExportExcelButton";
import { useDebounced } from "../../hooks/useDebounced";
import SearchableSelect from "../../components/SearchableSelect";
import { handleSearchPaste } from "../../utils/searchPaste";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });

function statusTone(value) {
  const s = String(value || "").toLowerCase();
  if (s.includes("complete") || s.includes("approved") || s.includes("done")) return { bg: "#ecfdf5", fg: "#047857" };
  if (s.includes("cancel") || s.includes("reject") || s.includes("fail")) return { bg: "#fef2f2", fg: "#b91c1c" };
  if (s.includes("progress") || s.includes("planned") || s.includes("running")) return { bg: "#eff6ff", fg: "#1d4ed8" };
  return { bg: "#fffbeb", fg: "#b45309" };
}

function DetailItem({ label, value }) {
  const isStatus = /status|mode|state/i.test(label);
  const tone = statusTone(value);
  return (
    <div style={{ background: "#fff", borderRadius: 8, padding: "8px 10px" }}>
      <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>{label}</div>
      {isStatus ? (
        <span style={{ display: "inline-block", borderRadius: 999, padding: "3px 10px", fontSize: 12, fontWeight: 700, background: tone.bg, color: tone.fg }}>
          {value == null || value === "" ? "—" : String(value)}
        </span>
      ) : (
        <div style={{ fontSize: 13, color: "#0f172a", fontWeight: 500 }}>{value == null || value === "" ? "—" : String(value)}</div>
      )}
    </div>
  );
}

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

export default function IMTimesheets() {
  const { imName } = useAuth();
  const { rowLimit } = useTableRowLimit();
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");
  const searchDebounced = useDebounced(search, 300);
  const [teamFilter, setTeamFilter] = useState([]);
  const [teamOptions, setTeamOptions] = useState([]);
  const [detailRow, setDetailRow] = useState(null);

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
      if (e.detail?.tableKey !== "im-timesheets-v1") return;
      setColumnFilters(e.detail.filters || {});
    };
    document.addEventListener("tablepro:filters-changed", onFiltersChanged);
    return () => document.removeEventListener("tablepro:filters-changed", onFiltersChanged);
  }, []);
  const activeColumnFilters = Object.fromEntries(
    Object.entries(columnFilters).filter(([, v]) => String(v || "").trim())
  );
  const columnFiltersKey = JSON.stringify(activeColumnFilters);
  const columnFiltersDebounced = useDebounced(columnFiltersKey, 300);

  useEffect(() => {
    let cancelled = false;
    if (!imName) {
      setLogs([]);
      setTotal(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    (async () => {
      try {
        const filters = { im: imName };
        if (dateFrom) filters.from_date = dateFrom;
        if (dateTo) filters.to_date = dateTo;
        if (teamFilter.length) filters.team_id = teamFilter;
        if (searchDebounced.trim()) filters.search = searchDebounced.trim();
        const colFilters = JSON.parse(columnFiltersDebounced);
        if (Object.keys(colFilters).length) filters.column_filters = colFilters;
        const res = await pmApi.listExecutionTimeLogs(filters, rowLimit, 0);
        if (!cancelled) {
          setLogs(res?.logs || []);
          setTotal(res?.total ?? (res?.logs || []).length);
        }
      } catch {
        if (!cancelled) { setLogs([]); setTotal(0); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [dateFrom, dateTo, imName, rowLimit, searchDebounced, teamFilter, columnFiltersDebounced]);

  const totalHours = logs.reduce((sum, row) => sum + (parseFloat(row.duration_hours) || 0), 0);
  const hasFilters = dateFrom || dateTo || search || teamFilter.length;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Team time logs</h1>
          <div className="page-subtitle">
            Execution time for your teams · {searchDebounced.trim() ? `${total} matching · ` : ""}{logs.length} loaded · {fmt.format(totalHours)} h
          </div>
        </div>
        <div className="page-actions">
          <ExportExcelButton filename="im-timesheets" rows={logs} />
        </div>
      </div>

      <div className="toolbar">
        <input
          type="search"
          placeholder="Search user, plan, team…"
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
              setSearch("");
              setTeamFilter([]);
            }}
          >
            Clear
          </button>
        )}
      </div>

      <div className="page-content">
        <DataTableWrapper>
          <table className="data-table" data-table-key="im-timesheets-v1">
            <thead>
              <tr>
                <th>ID</th>
                <th>User</th>
                <th>Team</th>
                <th>Rollout</th>
                <th>Work</th>
                <th>Start</th>
                <th>End</th>
                <th style={{ textAlign: "right" }}>Hours</th>
                <th>State</th>
                <th>View</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={10} style={{ padding: 0 }}>
                    {loading ? (
                      <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)" }}>Loading…</div>
                    ) : (
                      <div className="empty-state" style={{ marginTop: 20 }}>
                        <div className="empty-icon">&#x1F553;</div>
                        <h3>{hasFilters ? "No results" : "No time logs for your teams"}</h3>
                      </div>
                    )}
                  </td>
                </tr>
              ) : logs.map((row) => (
                  <tr key={row.name}>
                    <td style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>{row.name}</td>
                    <td>{row.user_full_name || row.user}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 12 }}>{row.team_id || "—"}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 11 }}>{row.rollout_plan}</td>
                    <td style={{ fontSize: "0.78rem", maxWidth: 200 }}>{row.item_description || "—"}</td>
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
                    <td>
                      <button type="button" className="btn-secondary" style={{ fontSize: "0.72rem", padding: "4px 10px" }} onClick={() => setDetailRow(row)}>
                        View
                      </button>
                    </td>
                  </tr>
              ))}
            </tbody>
          </table>
        </DataTableWrapper>
        <TableRowsLimitFooter
          placement="tableCard"
          loadedCount={logs.length}
          filteredCount={searchDebounced.trim() ? total : logs.length}
          filterActive={!!hasFilters}
        />
      </div>
      {detailRow && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setDetailRow(null)}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 20, width: "min(860px, 94vw)", maxHeight: "78vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ margin: 0, fontSize: "1rem" }}>Time Log Details</h3>
              <button type="button" onClick={() => setDetailRow(null)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8" }}>&times;</button>
            </div>
            <RecordDetailView
              row={detailRow}
              pills={[
                { label: "Log", value: detailRow.name || "—", tone: "blue" },
                { label: "User", value: detailRow.user_full_name || detailRow.user || "—", tone: "amber" },
                detailRow.team_id ? { label: "Team", value: detailRow.team_id, tone: "green" } : null,
                detailRow.is_running ? { label: "Status", value: "Running", tone: "green" } : null,
              ].filter(Boolean)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
