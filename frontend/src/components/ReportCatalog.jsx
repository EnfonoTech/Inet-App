import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import DataTableWrapper from "./DataTableWrapper";
import SearchableSelect from "./SearchableSelect";
import DateRangePicker from "./DateRangePicker";
import ExportExcelButton from "./ExportExcelButton";
import ReportVisual from "./ReportVisual";

/**
 * The report catalog both Reports pages render.
 *
 * Extracted from pages/admin/Reports.jsx so the IM side could have the same
 * catalog without a second copy of it. Everything that is genuinely shared
 * lives here — category tabs, the report chips, the filter toolbar, the
 * {columns,data,totals,chart} table, the totals footer, Table/Chart views and
 * the single Export button. What differs between the two pages is passed in:
 *
 *   reports          the registry array. IDENTICAL SHAPE on both sides, so
 *                    adding a report stays one entry per page:
 *                      { key, category, title, api | component, description,
 *                        hasFilters, filterType, componentProps }
 *   api              object whose keys the registry's `api` names — pmApi for
 *                    the PM page, imReportsApi for the IM page. Each page's
 *                    api object decides what the server is asked for; the IM
 *                    one reaches endpoints that scope themselves from the
 *                    session, which is why no `im` filter is sent from here.
 *   tableKeyPrefix   namespaces DataTablePro's saved column widths/order, so
 *                    the PM's and the IM's version of the same report do not
 *                    fight over one stored layout.
 *   showImFilter     PM only. An IM has exactly one IM to look at — itself —
 *                    so the control is absent rather than present-and-inert.
 *   loadTeamOptions  async () => [{id,label}]. The IM's own teams on the IM
 *                    side (every status, see get_im_team_options), all teams
 *                    on the PM side.
 *   loadHuaweiOptions async () => {projects, domains}
 *   headerExtra      optional node under the title (the IM's scope line).
 */

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
  const [y, m] = ym.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  return { from: isoDate(first), to: isoDate(endOfMonth(first)) };
}

const today = new Date();
const DEFAULT_RANGE = { from: isoDate(startOfMonth(today)), to: isoDate(today) };
const DEFAULT_DATE  = isoDate(today);
const DEFAULT_MONTH = isoMonth(today);

// 2 months ahead → 24 months back, most recent first
const MONTH_OPTIONS = (() => {
  const opts = [];
  for (let i = 2; i >= -24; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
    opts.push({
      id: isoMonth(d),
      label: d.toLocaleString("default", { month: "long", year: "numeric" }),
    });
  }
  return opts;
})();

export default function ReportCatalog({
  reports,
  api,
  title = "Reports",
  tableKeyPrefix = "report",
  showImFilter = false,
  loadTeamOptions,
  loadImOptions,
  loadHuaweiOptions,
  headerExtra = null,
}) {
  const CATEGORIES = useMemo(
    () => [...new Set(reports.map((r) => r.category))],
    [reports],
  );

  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get("tab");
  const [activeKey, setActiveKey] = useState(
    reports.find((r) => r.key === initialTab) ? initialTab : reports[0].key
  );
  const [search, setSearch] = useState("");
  // A custom report publishes its export rows here so the page keeps ONE
  // Export button in the header rather than each report growing its own.
  const [customExport, setCustomExport] = useState(null);
  const [activeCat, setActiveCat] = useState(() => {
    const r = reports.find((x) => x.key === initialTab);
    return r ? r.category : reports[0].category;
  });
  const [columns, setColumns] = useState([]);
  const [data, setData] = useState([]);
  // Per-column overall figure for columns a plain SUM would misrepresent
  // (Percent columns), keyed by fieldname and computed server-side from the
  // real underlying totals — never averaged client-side from the
  // already-aggregated per-row percentages.
  const [totals, setTotals] = useState({});
  const [chart, setChart] = useState(null);
  // A report may hand back a caveat about its own result — today, that the row
  // cap trimmed the oldest days off a too-wide range. It has to be SHOWN: a
  // truncation the reader can't see is exactly the silently-wrong total the
  // cap exists to prevent, and the totals row underneath still looks complete.
  const [message, setMessage] = useState(null);
  // Table and Chart are separate VIEWS, not a chart stacked above a table.
  // Resets to "table" on every report switch so a new report opens on data.
  const [view, setView] = useState("table");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Shared filters
  const [teamFilter, setTeamFilter] = useState([]);
  const [imFilter, setImFilter] = useState([]);
  const [dateRange, setDateRange] = useState(DEFAULT_RANGE);
  const [selectedMonth, setSelectedMonth] = useState(DEFAULT_MONTH);
  const [teamDate, setTeamDate] = useState({ from: DEFAULT_DATE, to: DEFAULT_DATE });
  // Site Sign/Verify filters — applied client-side over the already-fetched
  // rows (the dataset is small; no need to round-trip to the server).
  const [siteStatusFilter, setSiteStatusFilter] = useState("");
  const [siteSearch, setSiteSearch] = useState("");
  const [subconFilter, setSubconFilter] = useState("");
  const [huaweiProjectFilter, setHuaweiProjectFilter] = useState("");
  const [huaweiDomainFilter, setHuaweiDomainFilter] = useState("");
  const [huaweiBySubcon, setHuaweiBySubcon] = useState(false);
  const [huaweiProjectOptions, setHuaweiProjectOptions] = useState([]);
  const [huaweiDomainOptions, setHuaweiDomainOptions] = useState([]);
  const [subconOptions, setSubconOptions] = useState([]);

  const [teamOptions, setTeamOptions] = useState([]);
  const [imOptions, setImOptions] = useState([]);

  const active = useMemo(
    () => (activeKey ? reports.find((r) => r.key === activeKey) || null : null),
    [activeKey, reports]
  );
  // A report that brings its own renderer also brings its own filters/export.
  const CustomReport = active?.component || null;
  const isCustom = Boolean(CustomReport);

  function openReport(key) {
    if (!key) return;
    setActiveKey(key);
    setView("table");
    const r = reports.find((x) => x.key === key);
    if (r) setActiveCat(r.category);
    setSearchParams({ tab: key }, { replace: true });
  }

  /* Picking a category opens its first report straight away — without this the
     page would sit on a "now choose a report" limbo state, which is the extra
     click this layout exists to remove. */
  function openCategory(cat) {
    setSearch("");
    setActiveCat(cat);
    const first = reports.find((r) => r.category === cat);
    if (first) openReport(first.key);
  }

  // A search spans every category; otherwise the row is the active category.
  const chipReports = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q) {
      return reports.filter((r) =>
        r.title.toLowerCase().includes(q)
        || (r.description || "").toLowerCase().includes(q)
        || r.category.toLowerCase().includes(q));
    }
    return reports.filter((r) => r.category === activeCat);
  }, [search, activeCat, reports]);

  // Team/IM options feed the SHARED filter toolbar only, so they are not
  // fetched for a self-filtering custom report.
  const needsSharedFilters = Boolean(active && !isCustom && active.hasFilters);

  useEffect(() => {
    if (!needsSharedFilters || teamOptions.length || !loadTeamOptions) return;
    loadTeamOptions().then((opts) => {
      if (Array.isArray(opts)) setTeamOptions(opts);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsSharedFilters]);

  useEffect(() => {
    if (!needsSharedFilters || !showImFilter || imOptions.length || !loadImOptions) return;
    loadImOptions().then((opts) => {
      if (Array.isArray(opts)) setImOptions(opts);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsSharedFilters, showImFilter]);

  useEffect(() => {
    if (active?.filterType !== "subcondate" || huaweiProjectOptions.length || !loadHuaweiOptions) return;
    loadHuaweiOptions().then((res) => {
      setHuaweiProjectOptions(res?.projects || []);
      setHuaweiDomainOptions(res?.domains || []);
      setSubconOptions(res?.subcons || []);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.key]);

  async function loadReport(filters) {
    setLoading(true);
    setError(null);
    try {
      const fn = api[active.api];
      if (typeof fn !== "function") throw new Error(`No API method "${active.api}"`);
      const result = await fn(filters);
      setColumns(result?.columns || []);
      setData(result?.data || []);
      setTotals(result?.totals || {});
      setChart(result?.chart || null);
      setMessage(result?.message || null);
    } catch (err) {
      setColumns([]);
      setData([]);
      setTotals({});
      setChart(null);
      setMessage(null);
      setError(err?.message || "Failed to load report.");
    } finally {
      setLoading(false);
      // The one <table> here is reused across every report with a totally
      // different column set each time — React replaces every <th>, so
      // DataTablePro's resize handles/colKey mapping on the old headers are
      // gone and its tbody MutationObserver doesn't cover thead-only changes.
      // The delay lets React commit the new headers first.
      setTimeout(() => document.dispatchEvent(new CustomEvent("tablepro:check")), 60);
    }
  }

  // Reset filters when switching reports
  useEffect(() => {
    setCustomExport(null);
    if (!activeKey) return;
    setTeamFilter([]);
    setImFilter([]);
    setDateRange(DEFAULT_RANGE);
    setSelectedMonth(DEFAULT_MONTH);
    setTeamDate({ from: DEFAULT_DATE, to: DEFAULT_DATE });
    setSiteStatusFilter("");
    setSiteSearch("");
    setSubconFilter("");
    setHuaweiProjectFilter("");
    setHuaweiDomainFilter("");
    setHuaweiBySubcon(false);
    // Clear the previous report's columns immediately — the <table> below only
    // mounts once columns is non-empty, specifically so DataTablePro never
    // gets a chance to initialize against a table showing the wrong (stale or
    // empty) headers for the report we're switching to.
    setColumns([]);
    setData([]);
    setTotals({});
    setChart(null);
    setMessage(null);
  }, [activeKey]);

  // Auto-reload when active report or filters change. Skipped for custom
  // reports, which fetch their own data.
  useEffect(() => {
    if (!active || isCustom) return;
    const f = {};
    if (active.hasFilters) {
      if (teamFilter.length) f.team = teamFilter;
      if (showImFilter && imFilter.length) f.im = imFilter;
      if (active.filterType === "month") {
        const range = monthToRange(selectedMonth);
        f.from_date = range.from;
        f.to_date = range.to;
      } else if (active.filterType === "teamdate") {
        f.from_date = teamDate.from;
        f.to_date = teamDate.to;
      } else {
        if (dateRange.from) f.from_date = dateRange.from;
        if (dateRange.to) f.to_date = dateRange.to;
      }
      if (active.filterType === "subcondate") {
        if (subconFilter) f.subcon = subconFilter;
        if (huaweiProjectFilter) f.project = huaweiProjectFilter;
        if (huaweiDomainFilter) f.domain = huaweiDomainFilter;
        if (huaweiBySubcon) f.by_subcon = 1;
      }
    }
    loadReport(f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, teamFilter, imFilter, dateRange, selectedMonth, teamDate, subconFilter, huaweiProjectFilter, huaweiDomainFilter, huaweiBySubcon]);

  const hasFilters = teamFilter.length > 0 || imFilter.length > 0;

  const displayData = useMemo(() => {
    if (!active || active.filterType !== "sitestatus") return data;
    const q = siteSearch.trim().toLowerCase();
    return data.filter((row) => {
      if (siteStatusFilter && row.status !== siteStatusFilter) return false;
      if (q) {
        const hay = `${row.project_name || ""} ${row.du_id || ""} ${row.site_id || ""} ${row.bill_no || ""} ${row.item_code || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data, active, siteStatusFilter, siteSearch]);

  // One value per column for the totals row, or undefined for a column that
  // isn't aggregable.
  // - Percent columns ONLY ever use the server-computed `totals` map.
  // - Currency/Int columns are summed directly.
  // - A column can opt out with `no_total: true` (a snapshot repeated per
  //   row, which summing would double-count); those read `totals` instead.
  const footerValues = useMemo(() => {
    if (!columns.length) return {};
    const out = {};
    for (const col of columns) {
      const key = col.fieldname || col.name;
      if (!key || key === "sn") continue;
      if (isPctCol(col) || col.no_total) {
        const v = totals?.[key];
        if (v != null) out[key] = v;
        continue;
      }
      if (col.fieldtype === "Currency" || col.fieldtype === "Int" || col.fieldtype === "Float") {
        out[key] = displayData.reduce((acc, row) => acc + (parseFloat(row?.[key]) || 0), 0);
      }
    }
    return out;
  }, [columns, displayData, totals]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{active?.title || title}</h1>
          <div className="page-subtitle">{active?.description || ""}</div>
          {headerExtra}
        </div>
        <div className="page-actions">
          <input
            className="rpt-search"
            placeholder="Search reports…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {/* Only once the report has actually PUBLISHED rows. Not every
              self-rendering report has an export to give (Rollout Commercial
              and My Work Summary don't), and an always-on button on those
              downloaded an empty file — as it did on the PM page before this
              was shared. A report opts in simply by calling onExportReady. */}
          {active && isCustom && customExport?.rows?.length > 0 && (
            <ExportExcelButton
              rows={customExport.rows}
              filename={customExport.filename || active.key}
            />
          )}
          {active && !isCustom && (
            <>
              <div className="rpt-viewtoggle" role="group" aria-label="Report view">
                <button type="button"
                  className={`rpt-viewtoggle-btn${view === "table" ? " active" : ""}`}
                  onClick={() => setView("table")}>Table</button>
                <button type="button"
                  className={`rpt-viewtoggle-btn${view === "chart" ? " active" : ""}`}
                  onClick={() => setView("chart")}>Chart</button>
              </div>
              <ExportExcelButton
                rows={displayData}
                columns={columns.map((c) => ({ key: c.fieldname || c.name, label: c.label }))}
                filename={active.key}
              />
              <button className="btn-secondary" onClick={() => {
                if (active.filterType === "teamdate") setTeamDate((d) => ({ ...d }));
                else setDateRange((d) => ({ ...d }));
              }} disabled={loading}>
                {loading ? "Loading…" : "Refresh"}
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Switcher: always visible, so changing report is one click ──
          Row 1 picks the category, row 2 picks the report inside it. A
          search collapses row 2 into matches from every category. */}
      <div className="tabs" style={{ marginBottom: 0 }}>
        {CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            className={`tab ${!search && c === activeCat ? "active" : ""}`}
            onClick={() => openCategory(c)}
          >
            {c}
            <span className="rpt-tab-count">{reports.filter((r) => r.category === c).length}</span>
          </button>
        ))}
      </div>

      <div className="rpt-chips">
        {chipReports.length === 0 ? (
          <span className="rpt-chips-empty">No report matches “{search}”.</span>
        ) : chipReports.map((r) => (
          <button
            key={r.key}
            type="button"
            className={`rpt-chip ${r.key === activeKey ? "active" : ""}`}
            title={r.description}
            onClick={() => openReport(r.key)}
          >
            {r.title}
          </button>
        ))}
      </div>

      {/* ── A custom report owns its own toolbar, grid and export ─ */}
      {active && isCustom && (
        <Suspense fallback={<div className="page-content"><div className="rpt-empty">Loading report…</div></div>}>
          <CustomReport onExportReady={setCustomExport} {...(active.componentProps || {})} />
        </Suspense>
      )}

      {/* ── Filters toolbar ───────────────────────────────────── */}
      {active && !isCustom && active.hasFilters && (
        <div className="toolbar">
          {active.filterType === "teamdate" ? (
            <DateRangePicker
              value={teamDate}
              onChange={({ from, to }) => setTeamDate({ from, to })}
            />
          ) : active.filterType === "dateonly" ? (
            <DateRangePicker
              value={dateRange}
              onChange={({ from, to }) => setDateRange({ from, to })}
            />
          ) : active.filterType === "sitestatus" ? (
            <>
              <select
                value={siteStatusFilter}
                onChange={(e) => setSiteStatusFilter(e.target.value)}
                style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem", background: "#fff" }}
              >
                <option value="">All Status</option>
                <option value="NORMAL">Normal</option>
                <option value="WARNING">Warning</option>
                <option value="OVERDUE">Overdue</option>
                <option value="COMPLETE">Complete</option>
              </select>
              <input
                type="search"
                placeholder="Search project / DUID / site / bill…"
                value={siteSearch}
                onChange={(e) => setSiteSearch(e.target.value)}
                style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem", minWidth: 220 }}
              />
              {(siteStatusFilter || siteSearch) && (
                <button
                  className="btn-secondary"
                  style={{ fontSize: "0.78rem", padding: "5px 12px" }}
                  onClick={() => { setSiteStatusFilter(""); setSiteSearch(""); }}
                >
                  Clear
                </button>
              )}
            </>
          ) : active.filterType === "subcondate" ? (
            <>
              <DateRangePicker
                value={dateRange}
                onChange={({ from, to }) => setDateRange({ from, to })}
              />
              <SearchableSelect
                value={subconFilter}
                onChange={setSubconFilter}
                options={subconOptions.map((s) => (typeof s === "string" ? { id: s, label: s } : s))}
                placeholder="All Subcontractors"
                minWidth={170}
              />
              <SearchableSelect
                value={huaweiProjectFilter}
                onChange={setHuaweiProjectFilter}
                options={huaweiProjectOptions}
                placeholder="All Projects"
                minWidth={200}
              />
              <SearchableSelect
                value={huaweiDomainFilter}
                onChange={setHuaweiDomainFilter}
                options={huaweiDomainOptions}
                placeholder="All Domains"
                minWidth={170}
              />
              <button
                type="button"
                className="btn-secondary"
                style={{
                  fontSize: "0.78rem", padding: "5px 12px",
                  ...(huaweiBySubcon ? { borderColor: "#1d4ed8", color: "#1d4ed8", background: "#eff6ff" } : {}),
                }}
                onClick={() => setHuaweiBySubcon((v) => !v)}
                title={huaweiBySubcon ? "Showing one row per subcontractor (summed across projects)" : "Showing one row per Project × Subcontractor pair"}
              >
                {huaweiBySubcon ? "✓ " : ""}By Subcontractor Only
              </button>
              {(subconFilter || huaweiProjectFilter || huaweiDomainFilter) && (
                <button
                  className="btn-secondary"
                  style={{ fontSize: "0.78rem", padding: "5px 12px" }}
                  onClick={() => { setSubconFilter(""); setHuaweiProjectFilter(""); setHuaweiDomainFilter(""); }}
                >
                  Clear
                </button>
              )}
            </>
          ) : (
            <>
              <SearchableSelect
                multi
                value={teamFilter}
                onChange={setTeamFilter}
                options={teamOptions}
                placeholder="All Teams"
                minWidth={170}
              />
              {showImFilter && (
                <SearchableSelect
                  multi
                  value={imFilter}
                  onChange={setImFilter}
                  options={imOptions}
                  placeholder="All IMs"
                  minWidth={160}
                />
              )}
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
            </>
          )}
        </div>
      )}

      {active && !isCustom && (
      <div className="page-content">
        {error && (
          <div className="notice error" style={{ marginBottom: 16 }}>
            <span>⚠</span> {error}
          </div>
        )}

        {message && !error && (
          <div className="notice warning" style={{ marginBottom: 16 }}>
            <span>⚠</span> {message}
          </div>
        )}

        {view === "chart" && (
          <ReportVisual columns={columns} data={displayData} totals={totals} chart={chart} />
        )}

        {/* The table view keeps its own wrapper shell. This page used to render
            a chart ABOVE the table, which forced the PAGE to scroll rather
            than letting the table use the app's usual "fixed viewport height,
            only the table scrolls internally" layout (pages.css's
            `:has(.page-content > .data-table-wrapper)` chain — keyed off
            .data-table-wrapper being a DIRECT child of .page-content). This
            shell div breaks that exact selector match, so .page-content falls
            back to normal block flow. Kept as-is: the shell is also what lets
            the chart view sit in a normally-scrolling page. */}
        <div className="rpt-table-shell" hidden={view !== "table"}>
        {/* .data-table-wrapper's own base CSS caps it at min(92vh, 100dvh-5rem)
            as a fallback for pages outside the app's usual fixed-viewport
            table layout (which this page just opted out of, above) — without
            overriding it here the table would still show its own internal
            scrollbar capped near full-viewport height. */}
        <DataTableWrapper style={{ maxHeight: "none" }}>
          {/* The <table> itself only mounts once columns for the CURRENT
              report have actually arrived — not gated on data.length (rows),
              which DataTablePro genuinely needs to stay mounted through zero-
              result states; gated on columns.length (do we even have the right
              schema loaded yet). Without this, on a cold page load — or right
              after switching reports — DataTablePro's own scan runs almost
              instantly and marks the table "initialized" against zero or stale
              <th>s. That flag is permanent for as long as the DOM node lives,
              so the real headers that show up moments later never get scanned.
              Keeping the table absent until the real columns exist means
              DataTablePro's very first look at it is always the right one. */}
          {columns.length === 0 ? (
            <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)" }}>
              {loading ? "Loading report…" : (
                <div className="empty-state">
                  <div className="empty-icon">📈</div>
                  <h3>No data available</h3>
                  <p>No report data was returned from the server.</p>
                </div>
              )}
            </div>
          ) : (
          /* Keyed per report — this one table is reused across every report
             with completely different column sets. Without a distinct key per
             report, DataTablePro falls back to one shared positional key and
             every report's saved column widths/order collide. The prefix keeps
             the PM's and IM's copy of the same report apart. */
          <table key={activeKey} className="data-table" data-excel-filter-all="1" data-table-key={`${tableKeyPrefix}-${activeKey}`}>
            <thead>
              <tr>
                {columns.map((col) => (
                  <th key={col.fieldname || col.label}>{col.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayData.length === 0 ? (
                <tr>
                  <td colSpan={Math.max(columns.length, 1)} style={{ padding: 0 }}>
                    <div style={{ textAlign: "center", color: "var(--text-muted)", padding: "32px" }}>
                      No records found for the selected period.
                    </div>
                  </td>
                </tr>
              ) : displayData.map((row, idx) => (
                <tr key={idx}>
                  {columns.map((col) => {
                    const key = col.fieldname || col.name;
                    const raw = row?.[key];
                    const pct = isPctCol(col);
                    const style = pct && raw != null ? { ...pctCellStyle(raw), textAlign: "center", borderRadius: 4 } : {};
                    const display = pct
                      ? (raw != null ? `${raw}%` : "—")
                      : (raw === null || raw === undefined || raw === "" ? "—" : raw);
                    return (
                      <td key={col.fieldname || col.label} style={style}>
                        {display}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            {displayData.length > 0 && (
              <tfoot>
                <tr style={{ borderTop: "2px solid #e2e8f0", background: "#f8fafc" }}>
                  {columns.map((col, idx) => {
                    const key = col.fieldname || col.name;
                    if (idx === 0) {
                      return (
                        <td key={key} style={{ fontWeight: 700, color: "#334155", padding: "8px 12px", whiteSpace: "nowrap" }}>
                          Total
                        </td>
                      );
                    }
                    const val = footerValues[key];
                    if (val === undefined) return <td key={key} />;
                    const pct = isPctCol(col);
                    const display = pct ? `${Number(val).toFixed(1)}%` : Math.round(val).toLocaleString();
                    // Match the body cells' own alignment for this column type
                    // — the totals row must line up under the values above it.
                    return (
                      <td key={key} style={{ fontWeight: 700, padding: "8px 12px", color: "#0f172a", ...(pct ? { textAlign: "center" } : {}) }}>
                        {display}
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            )}
          </table>
          )}
        </DataTableWrapper>
        </div>
      </div>
      )}
    </div>
  );
}
