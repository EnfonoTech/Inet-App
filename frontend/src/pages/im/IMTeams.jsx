import { useEffect, useMemo, useState } from "react";
import DataTableWrapper from "../../components/DataTableWrapper";
import { useAuth } from "../../context/AuthContext";
import { pmApi } from "../../services/api";
import ExportExcelButton from "../../components/ExportExcelButton";
import SearchableSelect from "../../components/SearchableSelect";
import { useDebounced } from "../../hooks/useDebounced";

function badgeTone(value) {
  const s = String(value || "").toLowerCase();
  if (s === "active" || s === "approved" || s === "inet") return { bg: "#ecfdf5", fg: "#047857", dot: "#10b981" };
  if (s === "inactive" || s === "cancelled" || s === "reject") return { bg: "#fef2f2", fg: "#b91c1c", dot: "#ef4444" };
  if (s === "sub") return { bg: "#eff6ff", fg: "#1d4ed8", dot: "#3b82f6" };
  if (s === "field team") return { bg: "#f5f3ff", fg: "#6d28d9", dot: "#8b5cf6" };
  if (s === "backend team") return { bg: "#fff7ed", fg: "#c2410c", dot: "#f97316" };
  if (s === "in execution") return { bg: "#ecfdf5", fg: "#047857", dot: "#10b981" };
  if (s === "planned") return { bg: "#eff6ff", fg: "#1d4ed8", dot: "#3b82f6" };
  if (s === "idle") return { bg: "#f1f5f9", fg: "#64748b", dot: "#94a3b8" };
  return { bg: "#f1f5f9", fg: "#334155", dot: "#94a3b8" };
}

function StatItem({ label, value, color, accent, onClick, active }) {
  return (
    <div onClick={onClick}
      style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, padding: "7px 13px", cursor: onClick ? "pointer" : "default", borderRadius: 6, transition: "background 0.12s", background: active ? "#f1f5f9" : "transparent" }}
      onMouseEnter={(e) => { if (onClick) e.currentTarget.style.background = active ? "#e2e8f0" : "#f8fafc"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = active ? "#f1f5f9" : "transparent"; }}>
      <div style={{ fontSize: 18, fontWeight: 800, color: color || "#0f172a", lineHeight: 1, ...(accent ? { borderBottom: `2px solid ${accent}`, paddingBottom: 1 } : {}) }}>{value}</div>
      <div style={{ fontSize: 9.5, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>{label}</div>
    </div>
  );
}

function StatDivider() {
  return <div style={{ width: 1, background: "#e2e8f0", margin: "8px 2px", alignSelf: "stretch" }} />;
}

function StatusPill({ value }) {
  if (!value) return <span style={{ color: "#94a3b8" }}>—</span>;
  const t = badgeTone(value);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 9px", borderRadius: 999, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em", background: t.bg, color: t.fg }}>
      <span style={{ width: 5, height: 5, borderRadius: 999, background: t.dot, flexShrink: 0 }} />
      {value}
    </span>
  );
}

function FieldRow({ label, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ fontSize: 13, color: "#0f172a", fontWeight: 500 }}>{children || <span style={{ color: "#cbd5e1" }}>—</span>}</div>
    </div>
  );
}

function StockRowWithSources({ it, isCustomer, sources }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr style={{ borderTop: "1px solid #f1f5f9" }}>
        <td style={{ padding: "8px 10px" }}>
          <div style={{ fontWeight: 600, color: "#1e293b" }}>{it.item_name || it.item_code}</div>
          <div style={{ fontSize: "0.7rem", color: "#94a3b8", fontFamily: "ui-monospace, monospace" }}>{it.item_code}</div>
        </td>
        <td style={{ padding: "8px 10px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-start" }}>
            <span style={{ fontSize: "0.68rem", fontWeight: 700, padding: "1px 7px", borderRadius: 999, background: isCustomer ? "rgba(245,158,11,0.12)" : "rgba(59,130,246,0.12)", color: isCustomer ? "#b45309" : "#1d4ed8" }}>
              {isCustomer ? "Huawei" : "Company (INET)"}
            </span>
            {sources.length > 0 && (
              <button type="button" onClick={() => setOpen(o => !o)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: "0.68rem", color: "#94a3b8" }}>
                {open ? "▲ hide" : `▼ ${sources.length} source${sources.length > 1 ? "s" : ""}`}
              </button>
            )}
          </div>
        </td>
        <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 700, color: it.qty <= 2 ? "#ef4444" : "#0f172a" }}>
          {Number(it.qty).toLocaleString()}
          {it.qty <= 2 && <span style={{ marginLeft: 4, fontSize: "0.68rem", color: "#ef4444" }}>⚠</span>}
        </td>
        <td style={{ padding: "8px 10px", color: "#64748b" }}>{it.uom}</td>
      </tr>
      {open && sources.length > 0 && (
        <tr style={{ background: "#fafafa" }}>
          <td colSpan={4} style={{ padding: "6px 16px 8px 24px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {sources.map((s, i) => (
                <div key={i} style={{ fontSize: "0.76rem", display: "flex", flexWrap: "wrap", gap: "2px 14px", color: "#475569", alignItems: "center" }}>
                  {s.poid && <span>POID: <strong style={{ fontFamily: "ui-monospace, monospace" }}>{s.poid}</strong></span>}
                  {s.duid && <span>DUID: <strong style={{ fontFamily: "ui-monospace, monospace" }}>{s.duid}</strong></span>}
                  {s.qty > 0 && <span>Qty: <strong>{s.qty} {s.uom}</strong></span>}
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

const EMPTY_MEMBER = { employee: "", employee_name: "", designation: "", is_team_lead: 0 };

export default function IMTeams() {
  const { imName, user } = useAuth();
  const today = new Date().toISOString().slice(0, 10);

  const [teams, setTeams] = useState([]);
  const [allTeams, setAllTeams] = useState([]);
  const [imLabels, setImLabels] = useState({});
  const [requests, setRequests] = useState([]);
  const [tab, setTab] = useState("my");
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const searchDebounced = useDebounced(search, 300);
  const [typeFilter, setTypeFilter] = useState([]);
  const [statusFilter, setStatusFilter] = useState([]);
  const [categoryFilter, setCategoryFilter] = useState([]);
  const [statFilter, setStatFilter] = useState(null);

  const [detailRow, setDetailRow] = useState(null);
  const [detailData, setDetailData] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailStock, setDetailStock] = useState([]);
  const [detailStockLoading, setDetailStockLoading] = useState(false);

  const [editRow, setEditRow] = useState(null);
  const [editLoading, setEditLoading] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [members, setMembers] = useState([]);
  const [editBusy, setEditBusy] = useState(false);
  const [editErr, setEditErr] = useState(null);
  const [employees, setEmployees] = useState([]);

  const [requestTarget, setRequestTarget] = useState(null);
  const [requestReason, setRequestReason] = useState("");
  const [respondTarget, setRespondTarget] = useState(null);
  const [respondRemark, setRespondRemark] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [actionErr, setActionErr] = useState(null);
  const [actionMsg, setActionMsg] = useState(null);

  const myIm = imName || user?.full_name || "";

  async function loadAll() {
    setLoading(true);
    try {
      const imCandidates = [imName, user?.full_name].filter(Boolean);
      const myFilters = imCandidates.length > 1
        ? { im: ["in", imCandidates] }
        : { im: imCandidates[0] || "__none__" };
      const today = new Date().toISOString().slice(0, 10);
      const [my, all, ims, reqs] = await Promise.all([
        // My teams: use enriched API (today_status, projects, active_plan_count, member_count)
        pmApi.listImTeams({ im: imCandidates[0] || "__none__", for_date: today }).catch(() => []),
        // All teams: basic list (no enriched data needed for the All tab)
        pmApi.listINETTeams({}).catch(() => []),
        pmApi.genericList("IM Master", ["name", "full_name"], 500).catch(() => []),
        pmApi.listTeamAllocationRequests("all").catch(() => []),
      ]);
      setTeams(my || []);
      setAllTeams(all || []);
      const labelMap = {};
      for (const m of ims || []) labelMap[m.name] = m.full_name || m.name;
      setImLabels(labelMap);
      setRequests(reqs || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (myIm) loadAll();
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myIm]);

  useEffect(() => {
    if (!detailRow?.name) { setDetailData(null); setDetailStock([]); return; }
    let alive = true;
    setDetailData(null); setDetailStock([]);
    setDetailLoading(true); setDetailStockLoading(true);
    pmApi.getIMTeamDetail(detailRow.name)
      .then((d) => { if (alive) setDetailData(d); })
      .catch(() => { if (alive) setDetailData(null); })
      .finally(() => { if (alive) setDetailLoading(false); });
    pmApi.getTeamMaterialStock(detailRow.name)
      .then((data) => { if (alive) setDetailStock((Array.isArray(data) ? data : [])[0]?.items || []); })
      .catch(() => { if (alive) setDetailStock([]); })
      .finally(() => { if (alive) setDetailStockLoading(false); });
    return () => { alive = false; };
  }, [detailRow?.name]);

  async function openEdit(t) {
    setEditErr(null); setEditRow(t); setEditLoading(true);
    setEditForm({ team_name: t.team_name || "", status: t.status || "Active", note: t.note || "" });
    setMembers([]);
    try {
      const d = await pmApi.getIMTeamDetail(t.name);
      setEditForm((f) => ({ ...f, team_name: d.team_name || f.team_name, status: d.status || f.status, note: d.note || "" }));
      setMembers(Array.isArray(d.team_members) ? d.team_members : []);
    } catch (err) { setEditErr(err?.message || "Failed to load team detail"); }
    finally { setEditLoading(false); }
    if (!employees.length) pmApi.listEmployeesForPicker("").then((e) => setEmployees(e || [])).catch(() => {});
  }

  function memberSet(idx, patch) { setMembers((p) => { const n = [...p]; n[idx] = { ...n[idx], ...patch }; return n; }); }
  function memberRemove(idx) { setMembers((p) => p.filter((_, i) => i !== idx)); }
  function memberAdd() { setMembers((p) => [...p, { ...EMPTY_MEMBER }]); }
  function memberSetLead(idx) { setMembers((p) => p.map((m, i) => ({ ...m, is_team_lead: i === idx ? 1 : 0 }))); }

  async function submitEdit() {
    if (!editRow?.name) return;
    if (!editForm.team_name?.trim()) { setEditErr("Team Name is required."); return; }
    setEditBusy(true); setEditErr(null);
    try {
      const cleanMembers = members.filter((m) => m.employee).map((m) => ({ employee: m.employee, designation: m.designation || "", is_team_lead: m.is_team_lead ? 1 : 0 }));
      await pmApi.updateIMTeam(editRow.name, { ...editForm, team_members: cleanMembers });
      setEditRow(null);
      await loadAll();
      window.dispatchEvent(new Event("inet:approvals-changed"));
    } catch (err) { setEditErr(err?.message || "Failed to update team"); }
    finally { setEditBusy(false); }
  }

  function openRequestModal(t) { setActionErr(null); setRequestReason(""); setRequestTarget(t); }
  async function submitRequest() {
    if (!requestTarget) return;
    setActionBusy(true); setActionErr(null);
    try {
      await pmApi.requestTeamAllocation(requestTarget.name, requestReason);
      setActionMsg(`Request raised for ${requestTarget.team_name || requestTarget.name}. Awaiting source IM.`);
      setRequestTarget(null);
      await loadAll();
      window.dispatchEvent(new Event("inet:approvals-changed"));
    } catch (err) { setActionErr(err?.message || "Could not raise request"); }
    finally { setActionBusy(false); }
  }

  function openRespondModal(r) { setActionErr(null); setRespondRemark(""); setRespondTarget(r); }
  async function submitRespond(action) {
    if (!respondTarget) return;
    setActionBusy(true); setActionErr(null);
    try {
      await pmApi.respondTeamAllocation(respondTarget.name, action, respondRemark);
      setActionMsg(`Request ${action === "accept" ? "accepted — awaiting PM" : "rejected"}.`);
      setRespondTarget(null);
      await loadAll();
      window.dispatchEvent(new Event("inet:approvals-changed"));
    } catch (err) { setActionErr(err?.message || "Action failed"); }
    finally { setActionBusy(false); }
  }

  async function doCancel(req) {
    if (!confirm(`Cancel allocation request for ${req.team_name || req.team}?`)) return;
    setActionBusy(true); setActionErr(null);
    try {
      await pmApi.cancelTeamAllocation(req.name);
      setActionMsg("Request cancelled.");
      await loadAll();
      window.dispatchEvent(new Event("inet:approvals-changed"));
    } catch (err) { setActionErr(err?.message || "Cancel failed"); }
    finally { setActionBusy(false); }
  }

  function reqTone(status) {
    const s = (status || "").toLowerCase();
    if (s.includes("approved")) return { bg: "#ecfdf5", fg: "#047857", bd: "#a7f3d0" };
    if (s.includes("reject") || s.includes("cancel")) return { bg: "#fef2f2", fg: "#b91c1c", bd: "#fecaca" };
    if (s.includes("pm")) return { bg: "#eff6ff", fg: "#1d4ed8", bd: "#bfdbfe" };
    return { bg: "#fffbeb", fg: "#b45309", bd: "#fde68a" };
  }

  const stats = useMemo(() => {
    const active = teams.filter((r) => (r.status || "Active") === "Active");
    const field = active.filter((r) => r.team_category === "Field Team");
    return {
      total: active.length,
      field: field.length,
      backend: active.filter((r) => r.team_category === "Backend Team").length,
      inet: active.filter((r) => r.team_type === "INET").length,
      sub: active.filter((r) => r.team_type === "SUB").length,
      inExecution: field.filter((r) => (r.today_status || "").toLowerCase() === "in execution").length,
      planned: field.filter((r) => (r.today_status || "").toLowerCase() === "planned").length,
      idle: field.filter((r) => !r.today_status || r.today_status === "Idle").length,
    };
  }, [teams]);

  function clickStat(field, value) { setStatFilter((p) => (p?.field === field && p?.value === value) ? null : { field, value }); }

  const outgoing = requests.filter((r) => r.to_im === myIm);
  const incoming = requests.filter((r) => r.from_im === myIm);
  const outgoingPendingCount = outgoing.filter((r) => r.request_status === "Pending Source IM" || r.request_status === "Pending PM Approval").length;
  const incomingPendingCount = incoming.filter((r) => r.request_status === "Pending Source IM").length;

  const openRequestByTeam = {};
  for (const r of requests) {
    if (r.request_status === "Pending Source IM" || r.request_status === "Pending PM Approval") {
      const prior = openRequestByTeam[r.team];
      if (!prior || (r.modified || "") > (prior.modified || "")) openRequestByTeam[r.team] = r;
    }
  }

  const sourceList = tab === "all" ? allTeams : teams;

  const filtered = useMemo(() => {
    return sourceList.filter((t) => {
      if (typeFilter.length && !typeFilter.includes(t.team_type)) return false;
      if (statusFilter.length && !statusFilter.includes(t.status)) return false;
      if (categoryFilter.length && !categoryFilter.includes(t.team_category)) return false;
      if (statFilter) {
        const fieldVal = t[statFilter.field];
        if (statFilter.field === "today_status" && statFilter.value === "Idle") {
          if (fieldVal && fieldVal !== "Idle") return false;
        } else if (fieldVal !== statFilter.value) {
          return false;
        }
      }
      if (searchDebounced) {
        const q = searchDebounced.toLowerCase();
        return (
          (t.team_id || "").toLowerCase().includes(q) ||
          (t.team_name || "").toLowerCase().includes(q) ||
          (t.isdp_account || "").toLowerCase().includes(q) ||
          (t.im_name || imLabels[t.im] || t.im || "").toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [sourceList, typeFilter, statusFilter, categoryFilter, statFilter, searchDebounced, imLabels]);

  const hasFilters = !!(search || typeFilter.length || statusFilter.length || categoryFilter.length || statFilter);

  const isMine = (t) => tab === "my" || t.im === myIm || t.im_name === myIm;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">My Teams</h1>
          <div className="page-subtitle">{teams.length} teams managed by {imName}</div>
        </div>
        <div className="page-actions">
          <button className="btn-secondary" onClick={loadAll} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
          <ExportExcelButton filename="im-teams" rows={filtered} />
        </div>
      </div>

      {/* Tab bar */}
      <div role="tablist" style={{ display: "flex", gap: 4, padding: 4, background: "#f1f5f9", borderRadius: 8, border: "1px solid #e2e8f0", margin: "0 16px 8px", width: "fit-content" }}>
        {[
          { id: "my", label: "My Teams" },
          { id: "all", label: "All Teams" },
          { id: "outgoing", label: "Outgoing", count: outgoingPendingCount },
          { id: "incoming", label: "Incoming", count: incomingPendingCount },
        ].map((tt) => {
          const active = tab === tt.id;
          return (
            <button key={tt.id} type="button" role="tab" aria-selected={active} onClick={() => setTab(tt.id)}
              style={{ padding: "5px 14px", fontSize: "0.78rem", fontWeight: 700, border: "none", borderRadius: 6, cursor: "pointer", background: active ? "#1d4ed8" : "transparent", color: active ? "#fff" : "#475569", display: "inline-flex", alignItems: "center", gap: 6 }}>
              {tt.label}
              {!!tt.count && (
                <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 18, height: 18, padding: "0 6px", borderRadius: 999, fontSize: "0.66rem", fontWeight: 800, background: active ? "#fff" : "#f59e0b", color: active ? "#1d4ed8" : "#fff" }}>
                  {tt.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {actionMsg && (
        <div className="notice success" style={{ margin: "0 16px 8px" }}>
          <span>✓</span> {actionMsg}
          <button type="button" className="btn-secondary" style={{ marginLeft: 12, fontSize: "0.7rem", padding: "2px 8px" }} onClick={() => setActionMsg(null)}>Dismiss</button>
        </div>
      )}
      {actionErr && (
        <div className="notice error" style={{ margin: "0 16px 8px" }}>
          <span>!</span> {actionErr}
          <button type="button" className="btn-secondary" style={{ marginLeft: 12, fontSize: "0.7rem", padding: "2px 8px" }} onClick={() => setActionErr(null)}>Dismiss</button>
        </div>
      )}

      {(tab === "my" || tab === "all") && (
        <div className="toolbar">
          <input type="search" placeholder="Search team, area, ISDP…" value={search} onChange={(e) => setSearch(e.target.value)}
            style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem", minWidth: 200 }} />
          <SearchableSelect multi value={typeFilter} onChange={setTypeFilter}
            options={[{ id: "INET", label: "INET" }, { id: "SUB", label: "SUB" }]} placeholder="All Types" minWidth={110} />
          <SearchableSelect multi value={categoryFilter} onChange={setCategoryFilter}
            options={[{ id: "Field Team", label: "Field Team" }, { id: "Backend Team", label: "Backend Team" }]} placeholder="All Categories" minWidth={150} />
          <SearchableSelect multi value={statusFilter} onChange={setStatusFilter}
            options={[{ id: "Active", label: "Active" }, { id: "Inactive", label: "Inactive" }]} placeholder="All Status" minWidth={130} />
          {hasFilters && (
            <button className="btn-secondary" style={{ fontSize: "0.78rem", padding: "5px 12px" }}
              onClick={() => { setSearch(""); setTypeFilter([]); setStatusFilter([]); setCategoryFilter([]); setStatFilter(null); }}>
              Clear
            </button>
          )}
        </div>
      )}

      {/* Stats — My Teams only */}
      {tab === "my" && !loading && teams.length > 0 && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {/* Teams overview */}
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, display: "flex", alignItems: "center", overflow: "hidden", flex: "0 0 auto" }}>
            <div style={{ padding: "6px 14px", borderRight: "1px solid #f1f5f9", background: "#f8fafc", alignSelf: "stretch", display: "flex", alignItems: "center" }}>
              <div style={{ fontSize: 9.5, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", whiteSpace: "nowrap" }}>Teams</div>
            </div>
            <StatItem label="Total Active" value={stats.total} color="#0f172a" onClick={() => clickStat("status", "Active")} active={statFilter?.field === "status" && statFilter?.value === "Active"} />
            <StatDivider />
            <StatItem label="Field" value={stats.field} color="#6d28d9" accent="#8b5cf6" onClick={() => clickStat("team_category", "Field Team")} active={statFilter?.field === "team_category" && statFilter?.value === "Field Team"} />
            <StatItem label="Backend" value={stats.backend} color="#c2410c" accent="#f97316" onClick={() => clickStat("team_category", "Backend Team")} active={statFilter?.field === "team_category" && statFilter?.value === "Backend Team"} />
            <StatDivider />
            <StatItem label="INET" value={stats.inet} color="#047857" accent="#10b981" onClick={() => clickStat("team_type", "INET")} active={statFilter?.field === "team_type" && statFilter?.value === "INET"} />
            <StatItem label="SUB" value={stats.sub} color="#1d4ed8" accent="#3b82f6" onClick={() => clickStat("team_type", "SUB")} active={statFilter?.field === "team_type" && statFilter?.value === "SUB"} />
          </div>
          {/* Field teams — today status */}
          {stats.field > 0 && (
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, display: "flex", alignItems: "center", overflow: "hidden", flex: "0 0 auto" }}>
              <div style={{ padding: "6px 14px", borderRight: "1px solid #f1f5f9", background: "#f8fafc", alignSelf: "stretch", display: "flex", alignItems: "center" }}>
                <div style={{ fontSize: 9.5, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", whiteSpace: "nowrap" }}>Field Today</div>
              </div>
              <StatItem label="In Execution" value={stats.inExecution} color="#047857" accent="#10b981" onClick={() => clickStat("today_status", "In Execution")} active={statFilter?.field === "today_status" && statFilter?.value === "In Execution"} />
              <StatItem label="Planned" value={stats.planned} color="#1d4ed8" accent="#3b82f6" onClick={() => clickStat("today_status", "Planned")} active={statFilter?.field === "today_status" && statFilter?.value === "Planned"} />
              <StatItem label="Idle" value={stats.idle} color="#64748b" onClick={() => clickStat("today_status", "Idle")} active={statFilter?.field === "today_status" && statFilter?.value === "Idle"} />
            </div>
          )}
        </div>
      )}

      <div className="page-content">
        <DataTableWrapper loadedCount={loading ? null : sourceList.length} filteredCount={filtered.length} filterActive={hasFilters}>
          {loading ? (
            <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Loading...</div>
          ) : (tab === "my" || tab === "all") ? (
            filtered.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">👥</div>
                <h3>{hasFilters ? "No results match your filters" : tab === "all" ? "No teams" : "No teams assigned"}</h3>
                {hasFilters && <p>Try adjusting your search or filter criteria.</p>}
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Team ID</th>
                    <th>Team</th>
                    <th>Category</th>
                    <th>Type</th>
                    {tab === "all" && <th>Owner IM</th>}
                    <th>ISDP Account</th>
                    <th>Status</th>
                    {tab === "my" && <th>Today</th>}
                    {tab === "my" && <th>Members</th>}
                    {tab === "my" && <th>Projects</th>}
                    {tab === "my" && <th>Active Plans</th>}
                    <th style={{ minWidth: 140 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((t) => {
                    const mine = isMine(t);
                    const openReq = openRequestByTeam[t.name];
                    return (
                      <tr key={t.name}>
                        <td><span style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, color: "#475569", fontWeight: 600 }}>{t.team_id || "—"}</span></td>
                        <td style={{ fontWeight: 600, color: "#0f172a" }}>{t.team_name || "—"}</td>
                        <td><StatusPill value={t.team_category} /></td>
                        <td><StatusPill value={t.team_type} /></td>
                        {tab === "all" && (
                          <td style={{ fontSize: "0.82rem" }}>
                            {mine
                              ? <span style={{ color: "#1d4ed8", fontWeight: 700 }}>You</span>
                              : (t.im_name || imLabels[t.im] || t.im || "—")}
                          </td>
                        )}
                        <td style={{ fontSize: "0.82rem", color: "#475569" }}>{t.isdp_account || "—"}</td>
                        <td><StatusPill value={t.status} /></td>
                        {tab === "my" && (
                          <td><StatusPill value={t.today_status || "Idle"} /></td>
                        )}
                        {tab === "my" && (
                          <td style={{ textAlign: "center", fontSize: "0.82rem", fontWeight: 600, color: "#334155" }}>
                            {t.member_count != null ? t.member_count : "—"}
                          </td>
                        )}
                        {tab === "my" && (
                          <td style={{ fontSize: "0.78rem", color: "#475569", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={t.current_projects || ""}>
                            {t.current_projects || <span style={{ color: "#cbd5e1" }}>—</span>}
                          </td>
                        )}
                        {tab === "my" && (
                          <td style={{ textAlign: "center" }}>
                            {t.active_plan_count > 0
                              ? <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 22, height: 22, borderRadius: 999, background: "#eff6ff", color: "#1d4ed8", fontSize: "0.75rem", fontWeight: 800, border: "1px solid #bfdbfe" }}>{t.active_plan_count}</span>
                              : <span style={{ color: "#cbd5e1", fontSize: "0.78rem" }}>—</span>}
                          </td>
                        )}
                        <td>
                          <div style={{ display: "flex", gap: 6, flexWrap: "nowrap", alignItems: "center" }}>
                            <button type="button" className="btn-secondary" style={{ fontSize: "0.72rem", padding: "4px 8px", whiteSpace: "nowrap" }} onClick={() => setDetailRow(t)}>View</button>
                            {mine
                              ? <button type="button" className="btn-primary" style={{ fontSize: "0.72rem", padding: "4px 8px", whiteSpace: "nowrap" }} onClick={() => openEdit(t)}>Edit</button>
                              : openReq
                                ? <span title={`${openReq.name} — ${openReq.request_status}`} style={{ fontSize: "0.68rem", fontWeight: 700, padding: "3px 8px", borderRadius: 999, ...(() => { const x = reqTone(openReq.request_status); return { background: x.bg, color: x.fg, border: `1px solid ${x.bd}` }; })() }}>
                                    {openReq.request_status === "Pending Source IM" ? "Pending IM" : "Pending PM"}
                                  </span>
                                : <button type="button" className="btn-primary" style={{ fontSize: "0.72rem", padding: "4px 8px", whiteSpace: "nowrap" }} onClick={() => openRequestModal(t)} disabled={!t.im} title={!t.im ? "No current IM" : "Request transfer"}>Request</button>
                            }
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={tab === "all" ? 8 : 11} style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", fontWeight: 700, fontSize: "0.78rem" }}>
                      {filtered.length}{hasFilters && ` of ${sourceList.length}`} teams
                    </td>
                  </tr>
                </tfoot>
              </table>
            )
          ) : (
            (() => {
              const list = tab === "outgoing" ? outgoing : incoming;
              if (list.length === 0) {
                return (
                  <div className="empty-state">
                    <div className="empty-icon">📨</div>
                    <h3>{tab === "outgoing" ? "No requests raised" : "No incoming requests"}</h3>
                    <p>{tab === "outgoing"
                      ? "Switch to All Teams and click Request on a team owned by another IM."
                      : "When another IM requests one of your teams, it'll show up here for you to accept or reject."}</p>
                  </div>
                );
              }
              return (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Team</th>
                      <th>{tab === "outgoing" ? "Source IM" : "Requester IM"}</th>
                      <th>Status</th>
                      <th>Reason</th>
                      <th>Requested</th>
                      <th style={{ minWidth: 180 }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((r) => {
                      const tone = reqTone(r.request_status);
                      const otherIm = tab === "outgoing" ? r.from_im : r.to_im;
                      return (
                        <tr key={r.name}>
                          <td style={{ fontWeight: 600 }}>{r.team_name || r.team || "—"}</td>
                          <td style={{ fontSize: "0.82rem" }}>{(tab === "outgoing" ? r.from_im_name : r.to_im_name) || otherIm || "—"}</td>
                          <td>
                            <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 999, fontSize: "0.7rem", fontWeight: 700, background: tone.bg, color: tone.fg, border: `1px solid ${tone.bd}` }}>
                              {r.request_status}
                            </span>
                          </td>
                          <td style={{ fontSize: "0.82rem", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.reason || ""}>{r.reason || "—"}</td>
                          <td style={{ fontSize: "0.78rem", color: "#64748b" }}>
                            {r.creation ? new Date(r.creation).toLocaleString("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                          </td>
                          <td>
                            <div style={{ display: "flex", gap: 6, flexWrap: "nowrap" }}>
                              {tab === "incoming" && r.request_status === "Pending Source IM" && (
                                <button type="button" className="btn-primary" style={{ fontSize: "0.72rem", padding: "4px 10px" }} disabled={actionBusy} onClick={() => openRespondModal(r)}>Respond</button>
                              )}
                              {tab === "outgoing" && r.request_status === "Pending Source IM" && (
                                <button type="button" className="btn-secondary" style={{ fontSize: "0.72rem", padding: "4px 10px", color: "#b91c1c" }} disabled={actionBusy} onClick={() => doCancel(r)}>Cancel</button>
                              )}
                              {(r.source_im_remark || r.pm_remark) && (
                                <span title={`Source IM: ${r.source_im_remark || "—"}\nPM: ${r.pm_remark || "—"}`} style={{ fontSize: "0.7rem", color: "#94a3b8", cursor: "help" }}>ℹ remarks</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              );
            })()
          )}
        </DataTableWrapper>
      </div>

      {/* Request Transfer modal */}
      {requestTarget && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={() => !actionBusy && setRequestTarget(null)}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 20, width: "min(480px, 96vw)" }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 12px", fontSize: "1rem" }}>Request team transfer</h3>
            <div style={{ fontSize: "0.84rem", color: "#475569", marginBottom: 14 }}>
              Request to transfer <strong>{requestTarget.team_name || requestTarget.name}</strong> from <strong>{requestTarget.im_name || imLabels[requestTarget.im] || requestTarget.im || "—"}</strong> to <strong>you</strong>.
            </div>
            <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, marginBottom: 6, color: "#475569" }}>Reason (optional)</label>
            <textarea value={requestReason} onChange={(e) => setRequestReason(e.target.value)} rows={3}
              style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e2e8f0", boxSizing: "border-box", fontSize: "0.84rem", fontFamily: "inherit", resize: "vertical" }} />
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 14 }}>
              <button type="button" className="btn-secondary" disabled={actionBusy} onClick={() => setRequestTarget(null)}>Cancel</button>
              <button type="button" className="btn-primary" disabled={actionBusy} onClick={submitRequest}>{actionBusy ? "Submitting…" : "Submit request"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Respond modal */}
      {respondTarget && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={() => !actionBusy && setRespondTarget(null)}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 20, width: "min(480px, 96vw)" }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 12px", fontSize: "1rem" }}>Respond to allocation request</h3>
            <div style={{ fontSize: "0.84rem", color: "#475569", marginBottom: 14 }}>
              <strong>{respondTarget.to_im_name || respondTarget.to_im}</strong> is requesting <strong>{respondTarget.team_name || respondTarget.team}</strong> from you.
              {respondTarget.reason && (
                <div style={{ marginTop: 8, padding: "8px 10px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: "0.82rem", color: "#334155", whiteSpace: "pre-wrap" }}>
                  <div style={{ fontSize: "0.66rem", fontWeight: 700, color: "#94a3b8", marginBottom: 2 }}>REASON</div>
                  {respondTarget.reason}
                </div>
              )}
            </div>
            <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, marginBottom: 6, color: "#475569" }}>Remark (optional)</label>
            <textarea value={respondRemark} onChange={(e) => setRespondRemark(e.target.value)} rows={3}
              style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e2e8f0", boxSizing: "border-box", fontSize: "0.84rem", fontFamily: "inherit", resize: "vertical" }} />
            <div style={{ display: "flex", gap: 10, justifyContent: "space-between", marginTop: 14 }}>
              <button type="button" className="btn-secondary" disabled={actionBusy} onClick={() => setRespondTarget(null)}>Close</button>
              <div style={{ display: "flex", gap: 10 }}>
                <button type="button" className="btn-secondary" style={{ color: "#b91c1c" }} disabled={actionBusy} onClick={() => submitRespond("reject")}>{actionBusy ? "…" : "Reject"}</button>
                <button type="button" className="btn-primary" disabled={actionBusy} onClick={() => submitRespond("accept")}>{actionBusy ? "…" : "Accept (forward to PM)"}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editRow && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => !editBusy && setEditRow(null)}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 20, width: "min(720px, 96vw)", maxHeight: "88vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: "1rem" }}>Edit Team — <span style={{ fontFamily: "ui-monospace, monospace", color: "#64748b" }}>{editRow.team_id}</span></h3>
              <button type="button" disabled={editBusy} onClick={() => setEditRow(null)} style={{ background: "none", border: "none", fontSize: 20, cursor: editBusy ? "default" : "pointer", color: "#94a3b8" }}>&times;</button>
            </div>
            {editErr && <div className="notice error" style={{ marginBottom: 10 }}>{editErr}</div>}
            {editLoading && <div style={{ padding: 16, textAlign: "center", color: "#94a3b8" }}>Loading…</div>}
            {!editLoading && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div className="form-group">
                    <label>Team Name</label>
                    <input type="text" value={editForm.team_name} onChange={(e) => setEditForm((f) => ({ ...f, team_name: e.target.value }))} />
                  </div>
                  <div className="form-group">
                    <label>Status</label>
                    <select value={editForm.status} onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value }))}>
                      <option value="Active">Active</option>
                      <option value="Inactive">Inactive</option>
                    </select>
                  </div>
                  <div className="form-group" style={{ gridColumn: "1 / span 2" }}>
                    <label>Note</label>
                    <textarea value={editForm.note} onChange={(e) => setEditForm((f) => ({ ...f, note: e.target.value }))} rows={3} style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid #e2e8f0", fontSize: "0.84rem", resize: "vertical", boxSizing: "border-box" }} />
                  </div>
                </div>
                <div style={{ marginTop: 18 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                    <h4 style={{ margin: 0, fontSize: "0.88rem", fontWeight: 700 }}>Team members <span style={{ color: "#94a3b8", fontWeight: 500, fontSize: "0.78rem" }}>({members.length})</span></h4>
                    <button type="button" className="btn-secondary" style={{ fontSize: "0.78rem", padding: "4px 10px" }} onClick={memberAdd}>+ Add member</button>
                  </div>
                  {members.length === 0 ? (
                    <div style={{ padding: 12, textAlign: "center", color: "#94a3b8", fontSize: "0.82rem", border: "1px dashed #e2e8f0", borderRadius: 8 }}>No members yet. Click "Add member".</div>
                  ) : (
                    <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                        <thead>
                          <tr style={{ background: "#f8fafc" }}>
                            <th style={{ textAlign: "left", padding: "8px 10px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", fontSize: "0.68rem" }}>Employee</th>
                            <th style={{ textAlign: "left", padding: "8px 10px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", fontSize: "0.68rem" }}>Designation</th>
                            <th style={{ textAlign: "center", padding: "8px 10px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", fontSize: "0.68rem", width: 80 }}>Lead</th>
                            <th style={{ width: 40 }} />
                          </tr>
                        </thead>
                        <tbody>
                          {members.map((m, idx) => (
                            <tr key={idx} style={{ borderTop: "1px solid #f1f5f9" }}>
                              <td style={{ padding: "6px 10px" }}>
                                <select value={m.employee || ""} onChange={(e) => {
                                  const empName = e.target.value;
                                  const hit = employees.find((x) => x.name === empName);
                                  memberSet(idx, { employee: empName, employee_name: hit?.employee_name || "", designation: hit?.designation || m.designation || "" });
                                }} style={{ width: "100%", padding: 6, fontSize: "0.82rem" }}>
                                  <option value="">— Select employee —</option>
                                  {employees.map((e) => <option key={e.name} value={e.name}>{e.employee_name ? `${e.employee_name} (${e.name})` : e.name}</option>)}
                                </select>
                              </td>
                              <td style={{ padding: "6px 10px" }}>
                                <input type="text" value={m.designation || ""} onChange={(e) => memberSet(idx, { designation: e.target.value })} placeholder="Auto-filled" style={{ width: "100%", padding: 6, fontSize: "0.82rem" }} />
                              </td>
                              <td style={{ padding: "6px 10px", textAlign: "center" }}>
                                <input type="checkbox" checked={!!m.is_team_lead} onChange={() => memberSetLead(idx)} title="Team Lead" />
                              </td>
                              <td style={{ padding: "6px 10px", textAlign: "center" }}>
                                <button type="button" onClick={() => memberRemove(idx)} style={{ background: "none", border: "none", color: "#ef4444", fontSize: 18, cursor: "pointer", padding: 0 }}>&times;</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
                  <button type="button" className="btn-secondary" disabled={editBusy} onClick={() => setEditRow(null)}>Cancel</button>
                  <button type="button" className="btn-primary" disabled={editBusy} onClick={submitEdit}>{editBusy ? "Saving…" : "Save"}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* View Detail modal */}
      {detailRow && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.5)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 16px" }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) setDetailRow(null); }}>
          <div style={{ background: "#fff", borderRadius: 14, width: "min(960px, 100%)", height: "90vh", display: "flex", flexDirection: "column", boxShadow: "0 25px 60px rgba(15,23,42,0.3)", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 24px", borderBottom: "1px solid #e2e8f0", flexShrink: 0 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 16, color: "#0f172a" }}>{detailRow.team_name}</div>
                <div style={{ fontSize: 12, color: "#94a3b8", fontFamily: "ui-monospace, monospace", marginTop: 2 }}>{detailRow.team_id}</div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                {isMine(detailRow) && (
                  <button className="btn-secondary" style={{ fontSize: "0.8rem", padding: "5px 14px" }} onClick={() => { setDetailRow(null); openEdit(detailRow); }}>Edit</button>
                )}
                <button onClick={() => setDetailRow(null)} style={{ background: "none", border: "1px solid #e2e8f0", cursor: "pointer", padding: "4px 8px", color: "#64748b", fontSize: 15, lineHeight: 1, borderRadius: 6 }}>✕</button>
              </div>
            </div>
            <div style={{ overflowY: "auto", flex: "1 1 0px" }}>
              {detailLoading ? (
                <div style={{ padding: 48, textAlign: "center", color: "#94a3b8" }}>Loading…</div>
              ) : detailData ? (
                <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>

                  {/* Team Info + Members */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                    <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden" }}>
                      <div style={{ padding: "10px 16px", borderBottom: "1px solid #f1f5f9", fontWeight: 700, fontSize: 13, color: "#475569", background: "#f8fafc" }}>Team Info</div>
                      <div style={{ padding: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                        <FieldRow label="Team Name">{detailData.team_name}</FieldRow>
                        <FieldRow label="Status"><StatusPill value={detailData.status} /></FieldRow>
                        <FieldRow label="Team Type"><StatusPill value={detailData.team_type} /></FieldRow>
                        <FieldRow label="Category"><StatusPill value={detailData.team_category} /></FieldRow>
                        <FieldRow label="Area">{detailData.area || "—"}</FieldRow>
                        <FieldRow label="ISDP Account">{detailData.isdp_account || "—"}</FieldRow>
                        <FieldRow label="Subcontractor">{detailData.subcontractor || "—"}</FieldRow>
                        <FieldRow label="Field User">{detailData.field_user || "—"}</FieldRow>
                        <FieldRow label="Warehouse">{detailData.warehouse || "—"}</FieldRow>
                        {detailData.note && (
                          <div style={{ gridColumn: "1 / -1" }}>
                            <FieldRow label="Note">{detailData.note}</FieldRow>
                          </div>
                        )}
                      </div>
                    </div>

                    <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden" }}>
                      <div style={{ padding: "10px 16px", borderBottom: "1px solid #f1f5f9", fontWeight: 700, fontSize: 13, color: "#475569", background: "#f8fafc" }}>
                        Members ({(detailData.team_members || []).length})
                      </div>
                      <div style={{ overflowY: "auto", maxHeight: 280 }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                          <thead>
                            <tr style={{ background: "#f8fafc" }}>
                              <th style={{ padding: "6px 10px", textAlign: "left", color: "#64748b", fontWeight: 600 }}>Employee</th>
                              <th style={{ padding: "6px 10px", textAlign: "left", color: "#64748b", fontWeight: 600 }}>Designation</th>
                              <th style={{ padding: "6px 8px", textAlign: "center", color: "#64748b", fontWeight: 600 }}>Lead</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(detailData.team_members || []).map((m, i) => (
                              <tr key={i} style={{ borderTop: "1px solid #f1f5f9" }}>
                                <td style={{ padding: "8px 10px" }}>
                                  <div style={{ fontWeight: 600, color: "#0f172a" }}>{m.employee_name || m.employee}</div>
                                  <div style={{ fontSize: 10, color: "#94a3b8", fontFamily: "ui-monospace, monospace" }}>{m.employee}</div>
                                </td>
                                <td style={{ padding: "8px 10px", color: "#475569" }}>{m.designation || "—"}</td>
                                <td style={{ padding: "8px 10px", textAlign: "center" }}>
                                  {m.is_team_lead
                                    ? <span style={{ background: "#fef9c3", color: "#a16207", borderRadius: 999, padding: "1px 8px", fontSize: 11, fontWeight: 700 }}>Lead</span>
                                    : "—"}
                                </td>
                              </tr>
                            ))}
                            {(detailData.team_members || []).length === 0 && (
                              <tr><td colSpan={3} style={{ padding: 16, textAlign: "center", color: "#94a3b8" }}>No members</td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>

                  {/* Warehouse Stock */}
                  <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden" }}>
                    <div style={{ padding: "10px 16px", borderBottom: "1px solid #f1f5f9", fontWeight: 700, fontSize: 13, color: "#475569", background: "#f8fafc", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span>Warehouse Stock {!detailStockLoading && <span style={{ color: "#94a3b8", fontWeight: 500, fontSize: 12 }}>({detailStock.length} items)</span>}</span>
                      {detailRow.warehouse && <span style={{ fontSize: 11, color: "#64748b", background: "#f1f5f9", borderRadius: 6, padding: "2px 8px", fontFamily: "ui-monospace, monospace" }}>{detailRow.warehouse}</span>}
                    </div>
                    {detailStockLoading ? (
                      <div style={{ padding: 20, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>Loading stock…</div>
                    ) : detailStock.length === 0 ? (
                      <div style={{ padding: 20, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>No materials in warehouse.</div>
                    ) : (
                      <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                          <thead>
                            <tr style={{ background: "#f8fafc" }}>
                              <th style={{ padding: "6px 10px", textAlign: "left", color: "#64748b", fontWeight: 600 }}>Item</th>
                              <th style={{ padding: "6px 10px", textAlign: "left", color: "#64748b", fontWeight: 600 }}>Type</th>
                              <th style={{ padding: "6px 10px", textAlign: "right", color: "#64748b", fontWeight: 600 }}>Qty</th>
                              <th style={{ padding: "6px 10px", textAlign: "left", color: "#64748b", fontWeight: 600 }}>UOM</th>
                            </tr>
                          </thead>
                          <tbody>
                            {detailStock.map((it) => {
                              const isCustomer = it.item_type === "customer";
                              const sources = (it.sources || []).filter((s) => s.poid || s.duid);
                              return <StockRowWithSources key={it.item_code} it={it} isCustomer={isCustomer} sources={sources} />;
                            })}
                          </tbody>
                          <tfoot>
                            <tr style={{ borderTop: "2px solid #e2e8f0", background: "#f8fafc" }}>
                              <td colSpan={2} style={{ padding: "7px 10px", fontWeight: 700, fontSize: "0.78rem", color: "#475569" }}>{detailStock.length} item{detailStock.length !== 1 ? "s" : ""}</td>
                              <td style={{ padding: "7px 10px", textAlign: "right", fontWeight: 700, fontSize: "0.78rem", color: "#475569" }}>{detailStock.reduce((s, it) => s + Number(it.qty || 0), 0).toLocaleString()}</td>
                              <td />
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    )}
                  </div>

                </div>
              ) : (
                <div style={{ padding: 48, textAlign: "center", color: "#94a3b8" }}>Failed to load team details.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
