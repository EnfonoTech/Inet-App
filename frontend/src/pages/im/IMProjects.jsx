import { useEffect, useMemo, useRef, useState } from "react";
import DataTableWrapper from "../../components/DataTableWrapper";
import PageSummary from "../../components/PageSummary";
import { useAuth } from "../../context/AuthContext";
import { useTableRowLimit, TABLE_ROW_LIMIT_ALL } from "../../context/TableRowLimitContext";
import { useProgressiveRows } from "../../hooks/useProgressiveRows";
import TableRowsLimitFooter from "../../components/TableRowsLimitFooter";
import { useDebounced } from "../../hooks/useDebounced";
import RecordDetailView from "../../components/RecordDetailView";
import { pmApi } from "../../services/api";
import ExportExcelButton from "../../components/ExportExcelButton";
import SearchableSelect from "../../components/SearchableSelect";
import { handleSearchPaste } from "../../utils/searchPaste";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

function statusTone(value) {
  const s = String(value || "").toLowerCase();
  if (s.includes("complete") || s.includes("approved") || s.includes("active")) return { bg: "#ecfdf5", fg: "#047857" };
  if (s.includes("cancel") || s.includes("reject") || s.includes("risk")) return { bg: "#fef2f2", fg: "#b91c1c" };
  if (s.includes("progress") || s.includes("planned")) return { bg: "#eff6ff", fg: "#1d4ed8" };
  return { bg: "#fffbeb", fg: "#b45309" };
}

function DetailItem({ label, value }) {
  const isStatus = /status|mode/i.test(label);
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

function statusStyle(status) {
  const s = String(status || "").toLowerCase();
  if (s.includes("risk")) {
    return { bg: "#fef2f2", fg: "#991b1b", bd: "#fecaca" };
  }
  if (s.includes("hold")) {
    return { bg: "#fffbeb", fg: "#92400e", bd: "#fde68a" };
  }
  if (s.includes("active")) {
    return { bg: "#ecfdf5", fg: "#065f46", bd: "#a7f3d0" };
  }
  if (s.includes("complete")) {
    return { bg: "#eff6ff", fg: "#1d4ed8", bd: "#bfdbfe" };
  }
  return { bg: "#f8fafc", fg: "#334155", bd: "#cbd5e1" };
}

export default function IMProjects() {
  const { imName } = useAuth();
  const { rowLimit } = useTableRowLimit();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading]   = useState(true);
  // See useProgressiveRows — mounts large row sets in chunks so the browser
  // doesn't show "Page Unresponsive" on tables with "All" rows loaded.
  const visibleProjects = useProgressiveRows(projects, { paused: loading });
  // How many of `visibleProjects` to actually show — anything beyond this is
  // hidden via CSS in the render below rather than removed from `projects`.
  // `projects` itself may hold MORE than this after a shrink (see
  // lastFetchRef below: shrinking the limit doesn't trim `projects`, since
  // slicing it would still force React to tear down however many rows that
  // drops — real DOM-removal cost regardless of how the diffing gets there).
  const displayLimit = rowLimit === TABLE_ROW_LIMIT_ALL ? Infinity : rowLimit;
  const displayedCount = Math.min(projects.length, displayLimit);
  const [search, setSearch]     = useState("");
  const searchDebounced = useDebounced(search, 300);
  const [statusFilter, setStatusFilter] = useState("");
  const [domainFilter, setDomainFilter] = useState("");
  const [huaweiImFilter, setHuaweiImFilter] = useState("");
  const [detailRow, setDetailRow] = useState(null);
  const [metaProjects, setMetaProjects] = useState([]);
  // The page is inherently scoped to this IM — nothing else to publish.
  const summaryQuery = useMemo(() => ({ implementation_manager: imName }), [imName]);
  const [allDomains, setAllDomains] = useState([]);
  const [huaweiIms, setHuaweiIms] = useState([]);

  useEffect(() => {
    pmApi.listProjectDomains().then(res => setAllDomains(res || [])).catch(() => {});
    pmApi.listHuaweiIMs().then(res => setHuaweiIms(res || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!imName) {
      setMetaProjects([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const list = await pmApi.listProjects({
          limit: 5000,
          implementation_manager: imName,
        });
        if (!cancelled) setMetaProjects(Array.isArray(list) ? list : []);
      } catch {
        if (!cancelled) setMetaProjects([]);
      }
    })();
    return () => { cancelled = true; };
  }, [imName]);

  // ── Manage Table column filters ──────────────────────────────────────
  // Each column's typed value is matched only against that column's own
  // value on the backend (see column_filters / col_filter_map in
  // list_projects), not blended into the top search box's wide
  // multi-column search.
  const [columnFilters, setColumnFilters] = useState({});
  useEffect(() => {
    const onFiltersChanged = (e) => {
      if (e.detail?.tableKey !== "im-projects-v1") return;
      setColumnFilters(e.detail.filters || {});
    };
    document.addEventListener("tablepro:filters-changed", onFiltersChanged);
    return () => document.removeEventListener("tablepro:filters-changed", onFiltersChanged);
  }, []);
  // Excel column-filter dropdowns. These sources filter through the ORM, so
  // options come straight from the doctype rather than a list-function call.
  useEffect(() => {
    const onRequestOptions = (e) => {
      if (e.detail?.tableKey !== "im-projects-v1") return;
      e.detail.respond(pmApi.getColumnFilterOptions({
        source: "projects",
        col_key: e.detail.colKey,
        bucket: e.detail.bucket,
        search: e.detail.search,
        limit: e.detail.limit,
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
  // what limit + filters. Shrinking the row limit (e.g. All -> 20) never
  // needs another round-trip — whatever's being asked for is already sitting
  // in memory from the larger fetch; just show fewer of the same rows via
  // the CSS-hide render below. Only growing the limit, or any OTHER filter
  // actually changing, hits the server. See PICTracker.jsx for the reference
  // implementation of this pattern.
  const lastFetchRef = useRef({ signature: null, limit: null, rows: [] });

  useEffect(() => {
    let cancelled = false;
    if (!imName) { setLoading(false); return; }

    const colFilters = JSON.parse(columnFiltersDebounced);
    const params = {
      implementation_manager: imName,
      search: searchDebounced.trim() || undefined,
      status: statusFilter || undefined,
      domain: domainFilter || undefined,
      huawei_im: huaweiImFilter || undefined,
      column_filters: Object.keys(colFilters).length ? colFilters : undefined,
    };
    const signature = JSON.stringify([params]);

    const prev = lastFetchRef.current;
    const alreadyHaveEnough = prev.signature === signature && (
      prev.limit === TABLE_ROW_LIMIT_ALL
      || (rowLimit !== TABLE_ROW_LIMIT_ALL && rowLimit <= prev.limit)
    );
    if (alreadyHaveEnough) {
      // Leave `projects` (and whatever's already mounted) exactly as-is —
      // the render below hides anything beyond the new limit via CSS.
      return;
    }

    setLoading(true);
    (async () => {
      try {
        const list = await pmApi.listProjects({ limit: rowLimit, ...params });
        if (!cancelled) {
          const fetchedRows = Array.isArray(list) ? list : [];
          setProjects(fetchedRows);
          lastFetchRef.current = { signature, limit: rowLimit, rows: fetchedRows };
        }
      } catch {
        if (!cancelled) setProjects([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [imName, rowLimit, searchDebounced, statusFilter, domainFilter, huaweiImFilter, columnFiltersDebounced]);

  const statuses = [...new Set(metaProjects.map((p) => p.project_status).filter(Boolean))].sort();
  const hasFilters = search || statusFilter || domainFilter || huaweiImFilter;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">My Projects</h1>
          <div className="page-subtitle">IM: <strong>{imName || "—"}</strong></div>
        </div>
        <PageSummary source="projects" filters={summaryQuery} />
        <div className="page-actions">
          <span style={{ fontSize: "0.8rem", color: "#64748b" }}>
            {displayedCount} project{displayedCount !== 1 ? "s" : ""}
          </span>
          <ExportExcelButton filename="im-projects" rows={projects.slice(0, displayedCount)} />
        </div>
      </div>

      {/* Toolbar */}
      <div className="toolbar">
        <input
          type="search"
          placeholder="Search project code, name, customer…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onPaste={(e) => handleSearchPaste(e, setSearch)}
          style={{
            padding: "7px 14px", borderRadius: 8,
            border: "1px solid #e2e8f0", fontSize: "0.84rem", minWidth: 280,
          }}
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem" }}
        >
          <option value="">All Status</option>
          {statuses.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <SearchableSelect
          value={domainFilter}
          onChange={setDomainFilter}
          options={allDomains.map(d => ({ id: d.name, label: d.name }))}
          placeholder="All Domains"
          minWidth={160}
        />
        <SearchableSelect
          value={huaweiImFilter}
          onChange={setHuaweiImFilter}
          options={huaweiIms.map(h => ({ id: h.name, label: h.full_name || h.name }))}
          placeholder="All Huawei IMs"
          minWidth={170}
        />
        {hasFilters && (
          <button
            className="btn-secondary"
            style={{ fontSize: "0.78rem", padding: "5px 12px" }}
            onClick={() => { setSearch(""); setStatusFilter(""); setDomainFilter(""); setHuaweiImFilter(""); }}
          >
            Clear
          </button>
        )}
        <div style={{ flex: 1 }} />
        {!loading && projects.length === 0 && imName && (
          <span style={{ fontSize: "0.78rem", color: "#f59e0b" }}>
            No records found — set Implementation Manager = <strong>{imName}</strong> in Project Control Center
          </span>
        )}
      </div>

      <div className="page-content">
        <DataTableWrapper loading={loading && projects.length > 0}>
          <table className="data-table" data-excel-filter-all="1" data-table-key="im-projects-v1">
            <thead>
              <tr>
                <th>Project Code</th>
                <th>Project Name</th>
                <th>Customer</th>
                <th>Domain</th>
                <th>Huawei IM</th>
                <th>Status</th>
                <th style={{ textAlign: "right" }}>Completion</th>
                <th style={{ textAlign: "right" }}>Budget</th>
                <th data-excel-filter="0">View</th>
              </tr>
            </thead>
            <tbody>
              {projects.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ padding: 0 }}>
                    {loading ? (
                      <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)" }}>Loading...</div>
                    ) : !imName ? (
                      <div className="empty-state">
                        <div className="empty-icon">👤</div>
                        <h3>IM account not set up</h3>
                        <p>Your user is not linked to an IM Master record. Link IM Master → User Account to your login, and set Implementation Manager on INET Teams and projects.</p>
                      </div>
                    ) : (
                      <div className="empty-state">
                        <div className="empty-icon">📋</div>
                        <h3>{search ? "No results" : "No projects assigned"}</h3>
                        <p>
                          {search
                            ? "Try a different search."
                            : <>Open each project in <a href="/app/project-control-center" target="_blank" rel="noreferrer">Project Control Center</a> and set <strong>Implementation Manager</strong> = <code>{imName}</code></>}
                        </p>
                      </div>
                    )}
                  </td>
                </tr>
              ) : visibleProjects.map((p, idx) => (
                  <tr key={p.name} style={idx >= displayLimit ? { display: "none" } : undefined}>
                    <td style={{ fontFamily: "monospace", fontSize: "0.8rem" }}>{p.project_code}</td>
                    <td style={{ fontWeight: 600 }}>{p.project_name}</td>
                    <td>{p.customer}</td>
                    <td>{p.project_domain}</td>
                    <td>{p.huawei_im || "—"}</td>
                    <td>
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "3px 10px",
                          borderRadius: 999,
                          fontSize: 11,
                          fontWeight: 800,
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                          background: statusStyle(p.project_status).bg,
                          color: statusStyle(p.project_status).fg,
                          border: `1px solid ${statusStyle(p.project_status).bd}`,
                        }}
                      >
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: 999,
                            background: statusStyle(p.project_status).fg,
                            opacity: 0.75,
                          }}
                        />
                        {p.project_status || "Active"}
                      </span>
                    </td>
                    <td style={{ textAlign: "right" }}>{p.completion_percentage ?? 0}%</td>
                    <td style={{ textAlign: "right" }}>{fmt.format(p.budget_amount || 0)}</td>
                    <td>
                      <button type="button" className="btn-secondary" style={{ fontSize: "0.72rem", padding: "4px 10px" }} onClick={() => setDetailRow(p)}>
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
          loadedCount={displayedCount}
          filteredCount={displayedCount}
          filterActive={!!hasFilters}
        />
      </div>
      {detailRow && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setDetailRow(null)}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 20, width: "min(860px, 94vw)", maxHeight: "78vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ margin: 0, fontSize: "1rem" }}>Project Details</h3>
              <button type="button" onClick={() => setDetailRow(null)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8" }}>&times;</button>
            </div>
            <RecordDetailView
              row={detailRow}
              pills={[
                { label: "Project", value: detailRow.project_code || "—", tone: "blue" },
                { label: "Customer", value: detailRow.customer || "—", tone: "amber" },
                { label: "IM", value: detailRow.implementation_manager || "—", tone: "green" },
                detailRow.project_status ? { label: "Status", value: detailRow.project_status, tone: /active/i.test(detailRow.project_status) ? "green" : /hold|risk/i.test(detailRow.project_status) ? "amber" : "slate" } : null,
              ].filter(Boolean)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
