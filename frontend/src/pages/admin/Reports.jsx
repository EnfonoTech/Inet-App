import { useEffect, useMemo, useState } from "react";
import DataTableWrapper from "../../components/DataTableWrapper";
import { pmApi } from "../../services/api";
import SearchableSelect from "../../components/SearchableSelect";
import DateRangePicker from "../../components/DateRangePicker";
import useFilterOptions from "../../hooks/useFilterOptions";
import ExportExcelButton from "../../components/ExportExcelButton";

// ≥90 green, ≥75 light-green, ≥60 yellow, <60 red, 0 neutral
function pctCellStyle(value) {
  const v = parseFloat(value);
  if (isNaN(v) || v === 0) return {};
  if (v >= 90) return { background: "#dcfce7", color: "#166534", fontWeight: 600 };
  if (v >= 75) return { background: "#d1fae5", color: "#065f46", fontWeight: 600 };
  if (v >= 60) return { background: "#fef9c3", color: "#854d0e", fontWeight: 600 };
  return { background: "#fee2e2", color: "#991b1b", fontWeight: 600 };
}

// Matches Percent fieldtype cols AND the w1-w5 weekly Float cols
function isPctCol(col) {
  return col.fieldtype === "Percent" || /^w[1-5]$/.test(col.fieldname || "");
}

function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function isoMonth(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthToRange(ym) {
  // ym = "2026-06"
  const [y, m] = ym.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const last = endOfMonth(first);
  return { from: isoDate(first), to: isoDate(last) };
}

const today = new Date();
const DEFAULT_RANGE = { from: isoDate(startOfMonth(today)), to: isoDate(today) };
const DEFAULT_MONTH = isoMonth(today);

// Generate month options: 2 months ahead → 24 months back, most recent first
const MONTH_OPTIONS = (() => {
  const opts = [];
  for (let i = 2; i >= -24; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
    const value = isoMonth(d);
    const label = d.toLocaleString("default", { month: "long", year: "numeric" });
    opts.push({ id: value, label });
  }
  return opts;
})();

const REPORTS = [
  {
    key: "project_status_summary",
    title: "Project Status Summary",
    api: "reportProjectStatusSummary",
    description: "Overview of all projects by status",
  },
  {
    key: "budget_vs_actual_by_project",
    title: "Budget vs Actual",
    api: "reportBudgetVsActualByProject",
    description: "Budget vs actual spend by project",
  },
  {
    key: "team_utilization_report",
    title: "Team Utilization",
    api: "reportTeamUtilizationReport",
    description: "Team activity and utilization — Planned vs Actual",
    hasFilters: true,
  },
  {
    key: "monthly_team_details",
    title: "Monthly Team Details",
    api: "reportMonthlyTeamDetails",
    description: "Monthly team utilization — weekly breakdown per team",
    hasFilters: true,
    filterType: "month",
  },
];

export default function Reports() {
  const [activeKey, setActiveKey] = useState(REPORTS[0].key);
  const [columns, setColumns] = useState([]);
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Shared filters
  const [teamFilter, setTeamFilter] = useState([]);
  const [imFilter, setImFilter] = useState([]);
  const [dateRange, setDateRange] = useState(DEFAULT_RANGE);
  const [selectedMonth, setSelectedMonth] = useState(DEFAULT_MONTH);

  const { options: teamOpts } = useFilterOptions("INET Team", ["team_id", "team_name"]);
  const [teamNameMap, setTeamNameMap] = useState({});
  const [imOptions, setImOptions] = useState([]);

  const active = useMemo(
    () => REPORTS.find((r) => r.key === activeKey) || REPORTS[0],
    [activeKey]
  );

  // Build team options with id → name mapping
  useEffect(() => {
    const map = {};
    (teamOpts.team_id || []).forEach((tid, i) => {
      map[tid] = (teamOpts.team_name || [])[i] || tid;
    });
    setTeamNameMap(map);
  }, [teamOpts]);

  const teamOptions = (teamOpts.team_id || []).map((tid) => ({
    id: tid,
    label: teamNameMap[tid] || tid,
  }));

  // Load IM options once
  useEffect(() => {
    pmApi.listIMsForPicker("").then((rows) => {
      if (Array.isArray(rows)) {
        setImOptions(rows.map((r) => ({ id: r.name, label: r.full_name || r.name })));
      }
    }).catch(() => {});
  }, []);

  async function loadReport(filters) {
    setLoading(true);
    setError(null);
    try {
      const fn = pmApi[active.api];
      const result = await fn(filters);
      setColumns(result?.columns || []);
      setData(result?.data || []);
    } catch (err) {
      setColumns([]);
      setData([]);
      setError(err?.message || "Failed to load report.");
    } finally {
      setLoading(false);
    }
  }

  // Reset filters when switching reports
  useEffect(() => {
    setTeamFilter([]);
    setImFilter([]);
    setDateRange(DEFAULT_RANGE);
    setSelectedMonth(DEFAULT_MONTH);
  }, [activeKey]);

  // Auto-reload when active report or filters change
  useEffect(() => {
    const f = {};
    if (active.hasFilters) {
      if (teamFilter.length) f.team = teamFilter;
      if (imFilter.length) f.im = imFilter;
      if (active.filterType === "month") {
        const range = monthToRange(selectedMonth);
        f.from_date = range.from;
        f.to_date = range.to;
      } else {
        if (dateRange.from) f.from_date = dateRange.from;
        if (dateRange.to) f.to_date = dateRange.to;
      }
    }
    loadReport(f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, teamFilter, imFilter, dateRange, selectedMonth]);

  const hasFilters = teamFilter.length > 0 || imFilter.length > 0;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Reports</h1>
          <div className="page-subtitle">{active.description}</div>
        </div>
        <div className="page-actions">
          <ExportExcelButton
            rows={data}
            columns={columns.map((c) => ({ key: c.fieldname || c.name, label: c.label }))}
            filename={active.key}
          />
          <button className="btn-secondary" onClick={() => setDateRange((d) => ({ ...d }))} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* ── Report Selector Tabs ──────────────────────────────── */}
      <div className="tabs" style={active.hasFilters ? { marginBottom: 0 } : {}}>
        {REPORTS.map((r) => (
          <button
            key={r.key}
            type="button"
            className={`tab ${r.key === activeKey ? "active" : ""}`}
            onClick={() => setActiveKey(r.key)}
          >
            {r.title}
          </button>
        ))}
      </div>

      {/* ── Filters toolbar (Team Utilization only) ───────────── */}
      {active.hasFilters && (
        <div className="toolbar">
          <SearchableSelect
            multi
            value={teamFilter}
            onChange={setTeamFilter}
            options={teamOptions}
            placeholder="All Teams"
            minWidth={170}
          />
          <SearchableSelect
            multi
            value={imFilter}
            onChange={setImFilter}
            options={imOptions}
            placeholder="All IMs"
            minWidth={160}
          />
          {active.filterType === "month" ? (
            <SearchableSelect
              value={selectedMonth}
              onChange={(val) => setSelectedMonth(val || DEFAULT_MONTH)}
              options={MONTH_OPTIONS}
              placeholder="Select Month"
              minWidth={180}
            />
          ) : (
            <DateRangePicker
              value={dateRange}
              onChange={({ from, to }) => setDateRange({ from, to })}
            />
          )}
          {hasFilters && (
            <button
              className="btn-secondary"
              style={{ fontSize: "0.78rem", padding: "5px 12px" }}
              onClick={() => {
                setTeamFilter([]);
                setImFilter([]);
                setDateRange(DEFAULT_RANGE);
              }}
            >
              Clear
            </button>
          )}
        </div>
      )}

      <div className="page-content">
        {error && (
          <div className="notice error" style={{ marginBottom: 16 }}>
            <span>⚠</span> {error}
          </div>
        )}

        <DataTableWrapper>
          {loading ? (
            <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)" }}>
              Loading report…
            </div>
          ) : columns.length === 0 && data.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📈</div>
              <h3>No data available</h3>
              <p>No report data was returned from the server.</p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  {(columns || []).map((col) => (
                    <th key={col.fieldname || col.label}>{col.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(data || []).map((row, idx) => (
                  <tr key={idx}>
                    {(columns || []).map((col) => {
                      const key = col.fieldname || col.name;
                      const raw = row?.[key];
                      const pct = isPctCol(col);
                      const style = pct && raw != null ? { ...pctCellStyle(raw), textAlign: "center", borderRadius: 4 } : {};
                      const display = pct && raw != null ? `${raw}%` : (raw ?? "—");
                      return (
                        <td key={col.fieldname || col.label} style={style}>
                          {display}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </DataTableWrapper>
      </div>
    </div>
  );
}
