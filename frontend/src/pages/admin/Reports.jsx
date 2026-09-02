import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import DataTableWrapper from "../../components/DataTableWrapper";
import { pmApi } from "../../services/api";
import SearchableSelect from "../../components/SearchableSelect";
import DateRangePicker from "../../components/DateRangePicker";
import ExportExcelButton from "../../components/ExportExcelButton";
import useFilterOptions from "../../hooks/useFilterOptions";
import ReportChart from "../../components/ReportChart";

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
const DEFAULT_DATE  = isoDate(today);
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

/* Reports that render their own grid rather than the shared {columns,data}
   table. Lazily imported so a report's code only downloads when opened. */
const TeamIdleDomainReport = lazy(() => import("./TeamDomainReport"));
const RolloutCommercialReport = lazy(() => import("../../components/RolloutCommercialReport"));

/* Every report declares a `category` purely for grouping in the catalog.
   Adding a report = one entry here; nothing else needs touching. */
const REPORTS = [
  {
    key: "team_utilization_report",
    category: "Teams & Utilization",
    title: "Team Utilization",
    api: "reportTeamUtilizationReport",
    description: "Team activity and utilization — Planned vs Actual",
    hasFilters: true,
  },
  {
    key: "monthly_team_details",
    category: "Teams & Utilization",
    title: "Monthly Team Details",
    api: "reportMonthlyTeamDetails",
    description: "Monthly team utilization — weekly breakdown per team",
    hasFilters: true,
    filterType: "month",
  },
  {
    key: "team_planning_report",
    category: "Teams & Utilization",
    title: "Planning Report",
    api: "reportTeamPlanningReport",
    description: "Daily team plan status — what each team is scheduled to do",
    hasFilters: true,
    filterType: "teamdate",
  },
  {
    key: "team_utilization_report_daily",
    category: "Teams & Utilization",
    title: "Utilization Report",
    api: "reportTeamUtilizationDaily",
    description: "Daily team utilization — what each team actually executed",
    hasFilters: true,
    filterType: "teamdate",
  },
  {
    key: "team_implementation_report",
    category: "Teams & Utilization",
    title: "Implementation Report",
    api: "reportTeamImplementationReport",
    description: "Daily team implementation status with QC, CIAG and remarks",
    hasFilters: true,
    filterType: "teamdate",
  },
  {
    key: "im_performance",
    category: "Performance",
    title: "IM Performance",
    api: "reportIMPerformance",
    description: "Revenue, completion % and rating per Implementation Manager",
    hasFilters: true,
    filterType: "dateonly",
  },
  {
    key: "top_teams",
    category: "Performance",
    title: "Top Teams",
    api: "reportTopTeams",
    description: "Teams ranked by revenue — completion % and achievement %",
    hasFilters: true,
    filterType: "dateonly",
  },
  {
    key: "team_pva",
    category: "Teams & Utilization",
    title: "Team PVA",
    api: "reportTeamPVA",
    description: "Planned vs Actual per team per day — daily utilization breakdown",
    hasFilters: true,
    filterType: "teamdate",
  },
  {
    key: "weekly_performance",
    category: "Performance",
    title: "Weekly Performance",
    api: "reportWeeklyPerformance",
    description: "Weekly aggregated performance — lines, revenue, re-visits",
    hasFilters: true,
    filterType: "dateonly",
  },
  {
    key: "revenue_forecast",
    category: "Commercial",
    title: "Revenue Forecast",
    api: "reportRevenueForecast",
    description: "6-month rolling forecast — run-rate projection vs planned revenue",
    hasFilters: false,
  },
  {
    key: "rollout_commercial",
    category: "Client / Domain Reports",
    title: "Rollout Commercial",
    // Renders its own filters + grid; same component the IM's Reports page
    // uses, with no IM passed so it spans every IM.
    component: RolloutCommercialReport,
    description: "Planned vs invoiced vs collected on planned rollout work, by project",
  },
  {
    key: "team_idle_domain",
    category: "Client / Domain Reports",
    title: "Team Idle by Domain",
    // Renders its own grid + filters + export; not a {columns,data} table.
    component: TeamIdleDomainReport,
    description: "Daily idle / project-domain matrix per team — the monthly sheet handed to the domains",
  },
  {
    key: "site_sign_status",
    category: "CIAG Site Sign & Verify",
    title: "Site Sign Status",
    api: "reportSiteSignStatus",
    description: "Bills received but not yet fully consumed at site — Normal/Warning/Overdue by days pending",
    hasFilters: true,
    filterType: "sitestatus",
  },
  {
    key: "site_verify_status",
    category: "CIAG Site Sign & Verify",
    title: "Site Verify Status",
    api: "reportSiteVerifyStatus",
    description: "Sites where work is done but client CIAG approval is still pending",
    hasFilters: true,
    filterType: "sitestatus",
  },
  {
    key: "bill_wise_status",
    category: "Material Reports",
    title: "Bill Wise Material Status",
    api: "reportBillWiseStatus",
    description: "Per bill and item — received vs. used vs. remaining, with SLA status. Also in Desk as a Script Report.",
    hasFilters: true,
    filterType: "sitestatus",
  },
  {
    key: "huawei_outbound_analytics",
    category: "Material Reports",
    title: "Huawei Outbound Analytics",
    api: "reportHuaweiOutboundAnalytics",
    description: "Shipment count and volume by subcontractor, project or domain — filter to one project/domain to see its subcontractor split. Also in Desk as a Script Report.",
    hasFilters: true,
    filterType: "subcondate",
  },
];

const CATEGORIES = [...new Set(REPORTS.map((r) => r.category))];

export default function Reports() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get("tab");
  // A report is always open — the first of the first category by default, or
  // whatever ?tab= asks for. Only that one report is fetched, and only its
  // code is downloaded; the rest stay unloaded until picked.
  const [activeKey, setActiveKey] = useState(
    REPORTS.find((r) => r.key === initialTab) ? initialTab : REPORTS[0].key
  );
  const [search, setSearch] = useState("");
  // A custom report publishes its export rows here so the page keeps ONE
  // Export button in the header rather than each report growing its own.
  const [customExport, setCustomExport] = useState(null);
  // Which category's report chips are on show. Kept separate from activeKey so
  // the chip row stays put while a report is open — switching within a
  // category is then one click, which is the whole point of the row.
  const [activeCat, setActiveCat] = useState(() => {
    const r = REPORTS.find((x) => x.key === initialTab);
    return r ? r.category : REPORTS[0].category;
  });
  const [columns, setColumns] = useState([]);
  const [data, setData] = useState([]);
  // Per-column overall figure for columns a plain SUM would misrepresent
  // (Percent columns — e.g. Completion %/Utilization %) — keyed by
  // fieldname, computed server-side from the real underlying totals
  // (e.g. SUM(completed)/SUM(assigned)*100), never averaged/summed
  // client-side from the already-aggregated per-row percentages.
  const [totals, setTotals] = useState({});
  // Optional {data:{labels,datasets:[{name,values}]}, type, colors} —
  // same frappe-charts shape Desk Script Reports already return. Only a
  // handful of reports provide one today; ReportChart renders nothing when
  // absent, so every other report is unaffected.
  const [chart, setChart] = useState(null);
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
  // Huawei Outbound Analytics — subcontractor filter, alongside the shared
  // dateRange state. Options come from Huawei Outbound Plan's own subcon
  // values rather than the Huawei Subcon Master list, so only subcons that
  // actually appear in outbound data show up.
  const [subconFilter, setSubconFilter] = useState("");
  const { options: subconFilterOptions } = useFilterOptions("Huawei Outbound Plan", ["subcon"]);
  const subconOptions = subconFilterOptions.subcon || [];
  // Project/Domain filters — every row is already a (Project, Subcontractor)
  // pair, so picking a project narrows straight to "how many subcontractors
  // work on it and how much each is doing"; a domain filter works the same
  // way one level up.
  // Not from useFilterOptions (that resolves a Link's raw code, not its
  // name) — a small dedicated endpoint joins to Project Control Center once
  // and returns real project names, scoped to projects that actually
  // appear in Huawei Outbound Plan data.
  const [huaweiProjectFilter, setHuaweiProjectFilter] = useState("");
  const [huaweiDomainFilter, setHuaweiDomainFilter] = useState("");
  // Off (default): one row per (Project, Subcontractor) pair. On: collapses
  // to one row per subcontractor, summed across every project it touched —
  // a plain top-line rollup for when the project/domain split isn't needed.
  const [huaweiBySubcon, setHuaweiBySubcon] = useState(false);
  const [huaweiProjectOptions, setHuaweiProjectOptions] = useState([]);
  const [huaweiDomainOptions, setHuaweiDomainOptions] = useState([]);

  const [teamOptions, setTeamOptions] = useState([]);
  const [imOptions, setImOptions] = useState([]);

  const active = useMemo(
    () => (activeKey ? REPORTS.find((r) => r.key === activeKey) || null : null),
    [activeKey]
  );
  // A report that brings its own renderer also brings its own filters/export.
  const CustomReport = active?.component || null;
  const isCustom = Boolean(CustomReport);

  function openReport(key) {
    if (!key) return;
    setActiveKey(key);
    const r = REPORTS.find((x) => x.key === key);
    if (r) setActiveCat(r.category);
    setSearchParams({ tab: key }, { replace: true });
  }

  /* Picking a category opens its first report straight away. Without this the
     page would sit on a "now choose a report" limbo state, which is the extra
     click this layout exists to remove. */
  function openCategory(cat) {
    setSearch("");
    setActiveCat(cat);
    const first = REPORTS.find((r) => r.category === cat);
    if (first) openReport(first.key);
  }

  // A search spans every category; otherwise the row is the active category.
  const chipReports = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q) {
      return REPORTS.filter((r) =>
        r.title.toLowerCase().includes(q)
        || (r.description || "").toLowerCase().includes(q)
        || r.category.toLowerCase().includes(q));
    }
    return REPORTS.filter((r) => r.category === activeCat);
  }, [search, activeCat]);


  // Team/IM options feed the SHARED filter toolbar only, so they are not
  // fetched on the catalog or for a self-filtering custom report.
  const needsSharedFilters = Boolean(active && !isCustom && active.hasFilters);

  useEffect(() => {
    if (!needsSharedFilters || teamOptions.length) return;
    pmApi.getTeamOptions().then((opts) => {
      if (Array.isArray(opts)) setTeamOptions(opts);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsSharedFilters]);

  useEffect(() => {
    if (!needsSharedFilters || imOptions.length) return;
    pmApi.listIMsForPicker("").then((rows) => {
      if (Array.isArray(rows)) {
        setImOptions(rows.map((r) => ({ id: r.name, label: r.full_name || r.name })));
      }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsSharedFilters]);

  useEffect(() => {
    if (active?.key !== "huawei_outbound_analytics" || huaweiProjectOptions.length) return;
    pmApi.getHuaweiOutboundProjectDomainOptions().then((res) => {
      setHuaweiProjectOptions(res?.projects || []);
      setHuaweiDomainOptions(res?.domains || []);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.key]);

  async function loadReport(filters) {
    setLoading(true);
    setError(null);
    try {
      const fn = pmApi[active.api];
      const result = await fn(filters);
      setColumns(result?.columns || []);
      setData(result?.data || []);
      setTotals(result?.totals || {});
      setChart(result?.chart || null);
    } catch (err) {
      setColumns([]);
      setData([]);
      setTotals({});
      setChart(null);
      setError(err?.message || "Failed to load report.");
    } finally {
      setLoading(false);
      // The one <table> here is reused across every report with a totally
      // different column set each time — React replaces every <th> (they're
      // keyed by fieldname/label), so DataTablePro's resize handles/colKey
      // mapping on the old headers are gone. Its own tbody MutationObserver
      // doesn't cover thead-only changes, so nothing else tells it to
      // re-scan. See switchTab() in IMMaterialRequest.jsx for the same
      // pattern; the delay lets React commit the new headers first.
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
    // Clear the previous report's columns immediately (not just when the new
    // report's fetch resolves) — the <table> below only mounts once columns
    // is non-empty, specifically so DataTablePro never gets a chance to
    // initialize against a table showing the wrong (stale or empty) headers
    // for the report we're switching to. See the <table> comment for why
    // that first scan matters — it can only ever happen once per mount.
    setColumns([]);
    setData([]);
    setTotals({});
    setChart(null);
  }, [activeKey]);

  // Auto-reload when active report or filters change. Skipped entirely on the
  // catalog and for custom reports, which fetch their own data.
  useEffect(() => {
    if (!active || isCustom) return;
    const f = {};
    if (active.hasFilters) {
      if (teamFilter.length) f.team = teamFilter;
      if (imFilter.length) f.im = imFilter;
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
  // isn't aggregable (text/date/label columns stay blank in the footer).
  // - Percent columns ONLY ever use the server-computed `totals` map — never
  //   summed or averaged from the per-row percentages here, which would be
  //   wrong (e.g. averaging 5 teams' Completion % ignores that they have
  //   very different line counts; summing is meaningless either way).
  // - Currency/Int columns are summed directly — always correct for a total.
  // - `sn`/`#`-style row-number columns are explicitly excluded (see below).
  const footerValues = useMemo(() => {
    if (!columns.length) return {};
    const out = {};
    for (const col of columns) {
      const key = col.fieldname || col.name;
      if (!key || key === "sn") continue;
      if (isPctCol(col)) {
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
          <h1 className="page-title">{active?.title || "Reports"}</h1>
          <div className="page-subtitle">{active?.description || ""}</div>
        </div>
        <div className="page-actions">
          <input
            className="rpt-search"
            placeholder="Search reports…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {active && isCustom && (
            <ExportExcelButton
              rows={customExport?.rows || []}
              filename={customExport?.filename || active.key}
            />
          )}
          {active && !isCustom && (
            <>
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
            <span className="rpt-tab-count">{REPORTS.filter((r) => r.category === c).length}</span>
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
          <CustomReport onExportReady={setCustomExport} />
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
                options={subconOptions.map((s) => ({ id: s, label: s }))}
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

        {chart && <ReportChart chart={chart} />}

        {/* This page renders a chart above the table (most other pages using
            DataTableWrapper don't), so unlike them it needs the PAGE itself
            to scroll rather than locking the table into the app's usual
            "fixed viewport height, only the table scrolls internally" layout
            (pages.css's `:has(.page-content > .data-table-wrapper)` chain —
            keyed off .data-table-wrapper being a DIRECT child of
            .page-content). Wrapping it in this shell div breaks that exact
            selector match, so .page-content falls back to normal block flow
            and the whole page scrolls — both the chart and the table show in
            full instead of fighting over one fixed-height budget. */}
        <div className="rpt-table-shell">
        {/* .data-table-wrapper's own base CSS caps it at min(92vh, 100dvh-5rem)
            as a fallback for pages outside the app's usual fixed-viewport
            table layout (which this page just opted out of, above) — without
            overriding it here the table would still show its own internal
            scrollbar capped near full-viewport height instead of rendering
            in full within the now-scrollable page. */}
        <DataTableWrapper style={{ maxHeight: "none" }}>
          {/* The <table> itself only mounts once columns for the CURRENT
              report have actually arrived — not gated on data.length (rows),
              which DataTablePro genuinely needs to stay mounted through zero-
              result states; gated on columns.length (do we even have the
              right schema loaded yet). Without this, on a cold page load —
              or right after switching reports, once the previous report's
              columns are cleared above — DataTablePro's own scan runs almost
              instantly (it only checks the table exists, not that it has
              real headers) and marks the table "initialized" against zero
              or stale <th>s. That flag is permanent for as long as the DOM
              node lives, so the real headers that show up moments later,
              once the report actually loads, never get scanned or get
              resize handles. Keeping the table entirely absent until the
              real columns exist means DataTablePro's very first look at it
              is always the right one. */}
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
          /* Keyed per report — this one table is reused across 10 report
              types with completely different column sets. Without a distinct
              key per report, DataTablePro falls back to one shared
              positional key and every report's saved column widths/order
              collide with each other (and it scales automatically to any
              report added to REPORTS in the future — no extra wiring). */
          <table key={activeKey} className="data-table" data-excel-filter-all="1" data-table-key={`admin-report-${activeKey}`}>
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
                    // (pctCellStyle centers Percent cells; everything else is
                    // left-aligned by default) — the totals row must line up
                    // under the values above it, not invent its own layout.
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
