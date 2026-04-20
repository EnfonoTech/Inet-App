import { useCallback, useEffect, useMemo, useState } from "react";
import DataTableWrapper from "../../components/DataTableWrapper";
import { useAuth } from "../../context/AuthContext";
import { useTableRowLimit, useResetOnRowLimitChange } from "../../context/TableRowLimitContext";
import TableRowsLimitFooter from "../../components/TableRowsLimitFooter";
import { useDebounced } from "../../hooks/useDebounced";
import { pmApi } from "../../services/api";
import IMPlanningExecutionModal from "./IMPlanningExecutionModal";
import useFilterOptions from "../../hooks/useFilterOptions";
import SearchableSelect from "../../components/SearchableSelect";
import RecordDetailView from "../../components/RecordDetailView";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

function statusTone(value) {
  const s = String(value || "").toLowerCase();
  if (s.includes("complete") || s.includes("approved") || s.includes("dispatched")) return { bg: "#ecfdf5", fg: "#047857" };
  if (s.includes("cancel") || s.includes("reject") || s.includes("fail")) return { bg: "#fef2f2", fg: "#b91c1c" };
  if (s.includes("progress") || s.includes("planned") || s.includes("auto")) return { bg: "#eff6ff", fg: "#1d4ed8" };
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

function canImExecuteFromPlan(status) {
  const s = (status || "").trim();
  return ["Planned", "In Execution", "Planning with Issue", "Ready for Execution"].includes(s);
}

/** Single plan object when exactly one row is selected in the list, else null. */
function singleSelectedPlan(planList, selected) {
  if (selected.size !== 1) return null;
  const name = Array.from(selected)[0];
  return planList.find((p) => p.name === name) || null;
}

export default function IMPlanning() {
  const { imName } = useAuth();
  const { rowLimit } = useTableRowLimit();
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("Planned");
  const [visitFilter, setVisitFilter] = useState("");
  const [search, setSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [teamFilter, setTeamFilter] = useState("");
  const [duidFilter, setDuidFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const searchDebounced = useDebounced(search, 300);
  const [detailRow, setDetailRow] = useState(null);
  const [executionModalOpen, setExecutionModalOpen] = useState(false);
  const [selected, setSelected] = useState(() => new Set());

  useResetOnRowLimitChange(() => {
    setPlans([]);
    setLoading(true);
  });

  const loadPlans = useCallback(async () => {
    setLoading(true);
    try {
      const portal = {};
      if (searchDebounced.trim()) portal.search = searchDebounced.trim();
      if (visitFilter) portal.visit_type = visitFilter;
      if (projectFilter) portal.project_code = projectFilter;
      if (teamFilter) portal.team = teamFilter;
      if (duidFilter) portal.site_code = duidFilter;
      if (fromDate) portal.from_date = fromDate;
      if (toDate) portal.to_date = toDate;
      const portalArg = Object.keys(portal).length ? portal : undefined;
      const res = await pmApi.listIMRolloutPlans(imName, statusFilter || undefined, rowLimit, portalArg);
      setPlans(Array.isArray(res) ? res : []);
    } catch {
      setPlans([]);
    }
    setLoading(false);
  }, [
    imName,
    statusFilter,
    rowLimit,
    searchDebounced,
    visitFilter,
    projectFilter,
    teamFilter,
    duidFilter,
    fromDate,
    toDate,
  ]);

  useEffect(() => {
    loadPlans();
  }, [loadPlans]);

  // Distinct master values so dropdowns show all options regardless of row limit.
  const { options: planOpts } = useFilterOptions("Rollout Plan", ["visit_type"]);
  const { options: dispOpts } = useFilterOptions("PO Dispatch", ["project_code", "site_code"]);
  const visitTypes = planOpts.visit_type || [];
  const projectOptions = dispOpts.project_code || [];
  const teamEntries = useMemo(() => {
    const m = new Map();
    plans.forEach((p) => {
      if (!p.team) return;
      m.set(p.team, p.team_name || p.team);
    });
    return [...m.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1]), undefined, { sensitivity: "base" }));
  }, [plans]);
  const duidOptions = dispOpts.site_code || [];

  const visibleNames = useMemo(() => new Set(plans.map((p) => p.name)), [plans]);

  useEffect(() => {
    setSelected((prev) => {
      const next = new Set([...prev].filter((n) => visibleNames.has(n)));
      if (next.size === prev.size && [...next].every((n) => prev.has(n))) return prev;
      return next;
    });
  }, [visibleNames]);

  function toggleRow(name) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === plans.length && plans.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(plans.map((p) => p.name)));
    }
  }

  const hasFilters = visitFilter || search || projectFilter || teamFilter || duidFilter || fromDate || toDate;
  const totalAmt = plans.reduce((s, p) => s + (p.target_amount || 0), 0);
  const selectedAmt = plans
    .filter((p) => selected.has(p.name))
    .reduce((s, p) => s + (p.target_amount || 0), 0);

  const oneSelected = useMemo(() => singleSelectedPlan(plans, selected), [plans, selected]);
  const executionSelectionOk = oneSelected && canImExecuteFromPlan(oneSelected.plan_status);

  function recordExecutionTitle() {
    if (selected.size === 0) return "Select plans using the checkboxes";
    if (selected.size > 1) return "Select exactly one rollout plan to record execution";
    if (!canImExecuteFromPlan(oneSelected?.plan_status)) return "This plan status cannot be recorded from Planning";
    return undefined;
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Planning</h1>
          <div className="page-subtitle">
            Rollout plans for your teams. Select lines with the checkboxes, then use Record execution for exactly one plan in an executable status.
          </div>
        </div>
        <div className="page-actions">
          <button type="button" className="btn-secondary" onClick={() => loadPlans()} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      <div className="toolbar">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input
            type="search"
            placeholder="Search Plan ID, POID, DUID, PO, Team, Center area, Region…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              padding: "7px 14px", borderRadius: 8,
              border: "1px solid #e2e8f0", fontSize: "0.84rem", minWidth: 260,
            }}
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem" }}
          >
            <option value="">All Statuses</option>
            <option value="Planned">Planned</option>
            <option value="Planning with Issue">Planning with Issue</option>
            <option value="In Execution">In Execution</option>
            <option value="Completed">Completed</option>
            <option value="Cancelled">Cancelled</option>
          </select>
          <SearchableSelect
            value={visitFilter}
            onChange={setVisitFilter}
            options={visitTypes}
            placeholder="All Visit Types"
            minWidth={160}
          />
          <SearchableSelect
            value={projectFilter}
            onChange={setProjectFilter}
            options={projectOptions}
            placeholder="All Projects"
            minWidth={170}
          />
          <SearchableSelect
            value={teamFilter}
            onChange={setTeamFilter}
            options={teamEntries.map(([id, label]) => ({ id, label }))}
            placeholder="All Teams"
            minWidth={150}
          />
          <SearchableSelect
            value={duidFilter}
            onChange={setDuidFilter}
            options={duidOptions}
            placeholder="All DUIDs"
            minWidth={150}
          />
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem" }} />
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem" }} />
          {(hasFilters) && (
            <button
              className="btn-secondary"
              style={{ fontSize: "0.78rem", padding: "5px 12px" }}
              onClick={() => { setSearch(""); setVisitFilter(""); setProjectFilter(""); setTeamFilter(""); setDuidFilter(""); setFromDate(""); setToDate(""); }}
            >
              Clear
            </button>
          )}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          {selected.size > 0 && (
            <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
              {selected.size} selected · SAR {fmt.format(selectedAmt)}
            </span>
          )}
          <button
            type="button"
            className="btn-primary"
            disabled={!executionSelectionOk}
            title={recordExecutionTitle()}
            onClick={() => setExecutionModalOpen(true)}
          >
            Record execution ({selected.size})
          </button>
        </div>
      </div>

      <div className="page-content">
        <DataTableWrapper>
          {loading ? (
            <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Loading...</div>
          ) : plans.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📅</div>
              <h3>{hasFilters ? "No results match your filters" : "No rollout plans yet"}</h3>
              <p>
                {hasFilters
                  ? "Try adjusting your search or filter criteria."
                  : "No plans found for your current data."}
              </p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={selected.size === plans.length && plans.length > 0}
                      onChange={toggleAll}
                    />
                  </th>
                  <th>Plan ID</th>
                  <th>POID</th>
                  <th>DUID</th>
                  <th>Center area</th>
                  <th>Region</th>
                  <th>PO</th>
                  <th>Team</th>
                  <th>IM</th>
                  <th>Plan Date</th>
                  <th>Visit</th>
                  <th>Status</th>
                  <th style={{ textAlign: "right" }}>Target (SAR)</th>
                  <th>View</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((p) => (
                  <tr
                    key={p.name}
                    className={selected.has(p.name) ? "row-selected" : ""}
                    onClick={() => toggleRow(p.name)}
                    style={{ cursor: "pointer" }}
                  >
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(p.name)}
                        onChange={() => toggleRow(p.name)}
                      />
                    </td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{p.name}</td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{p.po_dispatch || "—"}</td>
                    <td>{p.site_code || "—"}</td>
                    <td style={{ fontSize: "0.82rem", maxWidth: 120 }} title={p.center_area || ""}>
                      {p.center_area || "—"}
                    </td>
                    <td style={{ fontSize: "0.82rem" }}>{p.region_type || "—"}</td>
                    <td>{p.po_no || "—"}</td>
                    <td style={{ fontSize: "0.82rem" }}>{p.team_name || p.team || "—"}</td>
                    <td style={{ fontSize: "0.82rem" }}>{p.im_full_name || p.dispatch_im || "—"}</td>
                    <td>{p.plan_date}</td>
                    <td>{p.visit_type}</td>
                    <td>
                      <span className={`status-badge ${(p.plan_status || "").toLowerCase().replace(/\s/g, "-")}`}>
                        <span className="status-dot" />
                        {p.plan_status}
                      </span>
                    </td>
                    <td style={{ textAlign: "right" }}>{fmt.format(p.target_amount || 0)}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="btn-secondary"
                        style={{ fontSize: "0.72rem", padding: "4px 10px" }}
                        onClick={() => setDetailRow(p)}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={12} style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", fontWeight: 700, fontSize: "0.78rem" }}>
                    <strong>{plans.length}</strong>
                    {" "}plan{plans.length !== 1 ? "s" : ""}
                    {selected.size > 0 && (
                      <span style={{ marginLeft: 16, color: "#6366f1", fontWeight: 600, fontSize: "0.82rem" }}>
                        {selected.size} selected
                      </span>
                    )}
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 700, padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0" }}>
                    {fmt.format(totalAmt)}
                  </td>
                  <td style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0" }} />
                </tr>
              </tfoot>
            </table>
          )}
        </DataTableWrapper>
        <TableRowsLimitFooter
          placement="tableCard"
          loadedCount={plans.length}
          filteredCount={plans.length}
          filterActive={!!hasFilters}
        />
      </div>
      <IMPlanningExecutionModal
        open={executionModalOpen}
        onClose={() => setExecutionModalOpen(false)}
        selectedPlan={executionSelectionOk ? oneSelected : null}
        onSubmitted={async () => {
          setSelected(new Set());
          await loadPlans();
        }}
      />

      {detailRow && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setDetailRow(null)}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 20, width: "min(840px, 94vw)", maxHeight: "78vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ margin: 0, fontSize: "1rem" }}>Plan Details</h3>
              <button type="button" onClick={() => setDetailRow(null)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8" }}>&times;</button>
            </div>
            <RecordDetailView
              row={detailRow}
              pills={[
                { label: "POID", value: detailRow.po_dispatch || "—", tone: "blue" },
                { label: "Team", value: detailRow.team_name || detailRow.team || "—", tone: "amber" },
                { label: "DUID", value: detailRow.site_code || "—", tone: "green" },
                detailRow.plan_status ? { label: "Status", value: detailRow.plan_status, tone: /complete/i.test(detailRow.plan_status) ? "green" : /cancel/i.test(detailRow.plan_status) ? "rose" : /issue/i.test(detailRow.plan_status) ? "amber" : "slate" } : null,
              ].filter(Boolean)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
