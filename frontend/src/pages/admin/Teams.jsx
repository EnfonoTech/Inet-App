import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import DataTableWrapper from "../../components/DataTableWrapper";
import { pmApi } from "../../services/api";
import SearchableSelect from "../../components/SearchableSelect";
import ExportExcelButton from "../../components/ExportExcelButton";
import { useDebounced } from "../../hooks/useDebounced";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

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
    <div
      onClick={onClick}
      style={{
        display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
        padding: "7px 13px", cursor: onClick ? "pointer" : "default",
        borderRadius: 6, transition: "background 0.12s",
        background: active ? "#f1f5f9" : "transparent",
      }}
      onMouseEnter={(e) => { if (onClick) e.currentTarget.style.background = active ? "#e2e8f0" : "#f8fafc"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = active ? "#f1f5f9" : "transparent"; }}
    >
      <div style={{
        fontSize: 18, fontWeight: 800, color: color || "#0f172a", lineHeight: 1,
        ...(accent ? { borderBottom: `2px solid ${accent}`, paddingBottom: 1 } : {}),
      }}>{value}</div>
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

function EditField({ label, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 11, color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</label>
      {children}
    </div>
  );
}

const inputStyle = {
  padding: "6px 10px",
  border: "1px solid #e2e8f0",
  borderRadius: 6,
  fontSize: 13,
  outline: "none",
  background: "#fff",
  width: "100%",
  boxSizing: "border-box",
};

const EMPTY_MEMBER = { employee: "", employee_name: "", designation: "", is_team_lead: 0 };

export default function Teams() {
  const location = useLocation();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const searchDebounced = useDebounced(search, 300);
  const [statusFilter, setStatusFilter] = useState(() => location.state?.teamFilters?.statusFilter || []);
  const [typeFilter, setTypeFilter] = useState(() => location.state?.teamFilters?.typeFilter || []);
  const [categoryFilter, setCategoryFilter] = useState(() => location.state?.teamFilters?.categoryFilter || []);
  const [imFilter, setImFilter] = useState(() => location.state?.teamFilters?.imFilter || []);
  const [statFilter, setStatFilter] = useState(() => location.state?.teamFilters?.statFilter || null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [knownImOptions, setKnownImOptions] = useState([]);

  // Modal state
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Edit state
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [members, setMembers] = useState([]);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveErr, setSaveErr] = useState(null);
  const [saveOk, setSaveOk] = useState(false);

  // Employee picker (server-side search, includes designation for auto-fill)
  const [empSearch, setEmpSearch] = useState("");
  const [empOptions, setEmpOptions] = useState([]);

  // IM picker (server-side search)
  const [imPickerSearch, setImPickerSearch] = useState("");
  const [imPickerOptions, setImPickerOptions] = useState([]);

  // Field User picker (server-side search)
  const [userPickerSearch, setUserPickerSearch] = useState("");
  const [userPickerOptions, setUserPickerOptions] = useState([]);

  // Subcontractor picker (small list, loaded once)
  const [subOptions, setSubOptions] = useState([]);

  // Load team list
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const filters = {};
        if (statusFilter.length === 1) filters.status = statusFilter[0];
        if (typeFilter.length === 1) filters.team_type = typeFilter[0];
        if (categoryFilter.length === 1) filters.team_category = categoryFilter[0];
        if (imFilter.length === 1) filters.im = imFilter[0];
        if (searchDebounced.trim()) filters.search = searchDebounced.trim();
        const res = await pmApi.listAdminTeams(filters);
        if (!cancelled) setRows(Array.isArray(res) ? res : []);
      } catch {
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [searchDebounced, statusFilter, typeFilter, categoryFilter, imFilter, refreshKey]);

  // Accumulate IM options
  useEffect(() => {
    if (!rows.length) return;
    setKnownImOptions((prev) => {
      const seen = new Map(prev.map((o) => [o.id, o.label]));
      for (const r of rows) { if (r.im) seen.set(r.im, r.im_name || r.im); }
      return Array.from(seen.entries()).map(([id, label]) => ({ id, label }))
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
    });
  }, [rows]);

  // Load detail when row selected
  useEffect(() => {
    if (!selected) { setDetail(null); setEditing(false); return; }
    let cancelled = false;
    setDetailLoading(true);
    setSaveErr(null);
    setSaveOk(false);
    (async () => {
      try {
        const d = await pmApi.adminGetTeamDetail(selected.name);
        if (!cancelled) {
          setDetail(d);
          resetForm(d);
        }
      } catch {
        if (!cancelled) setDetail(null);
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selected]);

  // Pre-load employees + IMs + users when edit mode starts
  useEffect(() => {
    if (!editing) return;
    pmApi.adminListEmployeesForPicker("").then((res) => {
      setEmpOptions(Array.isArray(res) ? res.map((e) => ({ id: e.name, label: e.employee_name || e.name, designation: e.designation || "" })) : []);
    }).catch(() => {});
    pmApi.listIMsForPicker("").then((res) => {
      setImPickerOptions(Array.isArray(res) ? res.map((m) => ({ id: m.name, label: m.full_name || m.name })) : []);
    }).catch(() => {});
    pmApi.listFrappeUsers("").then((res) => {
      setUserPickerOptions(Array.isArray(res) ? res.map((u) => ({ id: u.name, label: u.full_name || u.name })) : []);
    }).catch(() => {});
    pmApi.listSubcontractors().then((res) => {
      setSubOptions(Array.isArray(res) ? res.map((s) => ({ id: s.name, label: s.subcontractor_name || s.name })) : []);
    }).catch(() => {});
  }, [editing]);

  // Dynamic employee search when user types
  useEffect(() => {
    if (!empSearch.trim()) return;
    let cancelled = false;
    pmApi.adminListEmployeesForPicker(empSearch.trim()).then((res) => {
      if (!cancelled) setEmpOptions(Array.isArray(res) ? res.map((e) => ({ id: e.name, label: e.employee_name || e.name, designation: e.designation || "" })) : []);
    }).catch(() => { if (!cancelled) setEmpOptions([]); });
    return () => { cancelled = true; };
  }, [empSearch]);

  // Dynamic IM search when user types
  useEffect(() => {
    if (!imPickerSearch.trim()) return;
    pmApi.listIMsForPicker(imPickerSearch.trim()).then((res) => {
      setImPickerOptions(Array.isArray(res) ? res.map((m) => ({ id: m.name, label: m.full_name || m.name })) : []);
    }).catch(() => {});
  }, [imPickerSearch]);

  // Dynamic user search when user types
  useEffect(() => {
    if (!userPickerSearch.trim()) return;
    pmApi.listFrappeUsers(userPickerSearch.trim()).then((res) => {
      setUserPickerOptions(Array.isArray(res) ? res.map((u) => ({ id: u.name, label: u.full_name || u.name })) : []);
    }).catch(() => {});
  }, [userPickerSearch]);

  // Lock body scroll when modal is open
  useEffect(() => {
    if (selected) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [selected]);

  function resetForm(d) {
    setForm({
      team_name: d.team_name || "",
      team_type: d.team_type || "",
      team_category: d.team_category || "",
      im: d.im || "",
      status: d.status || "Active",
      subcontractor: d.subcontractor || "",
      field_user: d.field_user || "",
      isdp_account: d.isdp_account || "",
      daily_cost_applies: d.daily_cost_applies ? true : false,
      daily_cost: d.daily_cost || 0,
      note: d.note || "",
    });
    setMembers((d.team_members || []).map((m) => ({ ...m })));
  }

  function closeModal() {
    setSelected(null);
    setDetail(null);
    setEditing(false);
    setSaveErr(null);
    setSaveOk(false);
  }

  async function handleSave() {
    if (!detail) return;
    setSaveBusy(true);
    setSaveErr(null);
    setSaveOk(false);
    try {
      await pmApi.adminUpdateTeam(detail.name, { ...form, team_members: members });
      setSaveOk(true);
      setEditing(false);
      setRefreshKey((k) => k + 1);
      const d = await pmApi.adminGetTeamDetail(detail.name);
      setDetail(d);
      resetForm(d);
    } catch (e) {
      setSaveErr(e?.message || "Save failed");
    } finally {
      setSaveBusy(false);
    }
  }

  function cancelEdit() {
    if (!detail) return;
    setEditing(false);
    setSaveErr(null);
    resetForm(detail);
  }

  function setMemberField(idx, field, value) {
    setMembers((prev) => prev.map((m, i) => {
      if (i !== idx) return field === "is_team_lead" && value ? { ...m, is_team_lead: 0 } : m;
      return { ...m, [field]: value };
    }));
  }

  const hasFilters = !!(search || statusFilter.length || typeFilter.length || categoryFilter.length || imFilter.length || statFilter);

  // Stats always computed from raw rows — never affected by filters
  const stats = useMemo(() => {
    const active = rows.filter((r) => (r.status || "Active") === "Active");
    const field = active.filter((r) => r.team_category === "Field Team");
    const backend = active.filter((r) => r.team_category === "Backend Team");
    return {
      total: active.length,
      field: field.length,
      backend: backend.length,
      inet: active.filter((r) => r.team_type === "INET").length,
      sub: active.filter((r) => r.team_type === "SUB").length,
      inExecution: field.filter((r) => r.today_status === "In Execution").length,
      planned: field.filter((r) => r.today_status === "Planned").length,
      idle: field.filter((r) => r.today_status === "Idle").length,
    };
  }, [rows]);

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (statusFilter.length > 1 && !statusFilter.includes(r.status)) return false;
      if (typeFilter.length > 1 && !typeFilter.includes(r.team_type)) return false;
      if (categoryFilter.length > 1 && !categoryFilter.includes(r.team_category)) return false;
      if (imFilter.length > 1 && !imFilter.includes(r.im)) return false;
      if (statFilter) {
        const v = r[statFilter.field];
        if (v !== statFilter.value) return false;
      }
      return true;
    });
  }, [rows, statusFilter, typeFilter, categoryFilter, imFilter, statFilter]);

  function clickStat(field, value) {
    setStatFilter((prev) => (prev?.field === field && prev?.value === value) ? null : { field, value });
  }

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Teams</h1>
          <div className="page-subtitle">All INET teams — active projects, domains, and members.</div>
        </div>
        <div className="page-actions">
          <ExportExcelButton filename="teams" rows={filteredRows} />
          <button className="btn-secondary" onClick={() => setRefreshKey((k) => k + 1)} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="toolbar">
        <input
          type="search"
          placeholder="Search team, IM…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem", minWidth: 200 }}
        />
        <SearchableSelect multi value={statusFilter} onChange={setStatusFilter}
          options={["Active", "Inactive"]} placeholder="All Status" minWidth={130} />
        <SearchableSelect multi value={typeFilter} onChange={setTypeFilter}
          options={["INET", "SUB"]} placeholder="All Types" minWidth={110} />
        <SearchableSelect multi value={categoryFilter} onChange={setCategoryFilter}
          options={["Field Team", "Backend Team"]} placeholder="All Categories" minWidth={150} />
        <SearchableSelect multi value={imFilter} onChange={setImFilter}
          options={knownImOptions} placeholder="All IMs" minWidth={150} />
        {hasFilters && (
          <button className="btn-secondary" style={{ fontSize: "0.78rem", padding: "5px 12px" }}
            onClick={() => { setSearch(""); setStatusFilter([]); setTypeFilter([]); setCategoryFilter([]); setImFilter([]); setStatFilter(null); }}>
            Clear
          </button>
        )}
      </div>

      {/* Summary card */}
      {!loading && rows.length > 0 && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>

          {/* Left group: Team breakdown */}
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, display: "flex", alignItems: "center", overflow: "hidden", flex: "0 0 auto" }}>
            <div style={{ padding: "6px 14px", display: "flex", flexDirection: "column", justifyContent: "center", borderRight: "1px solid #f1f5f9", background: "#f8fafc", alignSelf: "stretch" }}>
              <div style={{ fontSize: 9.5, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", whiteSpace: "nowrap" }}>Teams</div>
            </div>
            <StatItem label="Total Active" value={stats.total} color="#0f172a"
              onClick={() => clickStat("status", "Active")}
              active={statFilter?.field === "status" && statFilter?.value === "Active"} />
            <StatDivider />
            <StatItem label="Field" value={stats.field} color="#6d28d9" accent="#8b5cf6"
              onClick={() => clickStat("team_category", "Field Team")}
              active={statFilter?.field === "team_category" && statFilter?.value === "Field Team"} />
            <StatItem label="Backend" value={stats.backend} color="#c2410c" accent="#f97316"
              onClick={() => clickStat("team_category", "Backend Team")}
              active={statFilter?.field === "team_category" && statFilter?.value === "Backend Team"} />
            <StatDivider />
            <StatItem label="INET" value={stats.inet} color="#047857" accent="#10b981"
              onClick={() => clickStat("team_type", "INET")}
              active={statFilter?.field === "team_type" && statFilter?.value === "INET"} />
            <StatItem label="SUB" value={stats.sub} color="#1d4ed8" accent="#3b82f6"
              onClick={() => clickStat("team_type", "SUB")}
              active={statFilter?.field === "team_type" && statFilter?.value === "SUB"} />
          </div>

          {/* Right group: Field today */}
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, display: "flex", alignItems: "center", overflow: "hidden", flex: "0 0 auto" }}>
            <div style={{ padding: "6px 14px", display: "flex", flexDirection: "column", justifyContent: "center", borderRight: "1px solid #f1f5f9", background: "#f8fafc", alignSelf: "stretch" }}>
              <div style={{ fontSize: 9.5, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", whiteSpace: "nowrap" }}>Field Today</div>
            </div>
            <StatItem label="Active Field" value={stats.field} color="#6d28d9" accent="#8b5cf6"
              onClick={() => clickStat("team_category", "Field Team")}
              active={statFilter?.field === "team_category" && statFilter?.value === "Field Team"} />
            <StatDivider />
            <StatItem label="In Execution" value={stats.inExecution} color="#047857" accent="#10b981"
              onClick={() => clickStat("today_status", "In Execution")}
              active={statFilter?.field === "today_status" && statFilter?.value === "In Execution"} />
            <StatItem label="Planned" value={stats.planned} color="#1d4ed8" accent="#3b82f6"
              onClick={() => clickStat("today_status", "Planned")}
              active={statFilter?.field === "today_status" && statFilter?.value === "Planned"} />
            <StatItem label="Idle" value={stats.idle} color="#64748b" accent="#94a3b8"
              onClick={() => clickStat("today_status", "Idle")}
              active={statFilter?.field === "today_status" && statFilter?.value === "Idle"} />
          </div>

        </div>
      )}

      {/* Table */}
      <div className="page-content">
        <DataTableWrapper>
          {loading ? (
            <div style={{ padding: 32, textAlign: "center", color: "#94a3b8" }}>Loading teams…</div>
          ) : filteredRows.length === 0 ? (
            <div className="empty-state"><h3>{hasFilters ? "No teams match your filters" : "No teams found"}</h3></div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Team ID</th>
                  <th>Name</th>
                  <th>Category</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Today</th>
                  <th>IM</th>
                  <th>Current Project</th>
                  <th>Current Domain</th>
                  <th>Active Plans</th>
                  <th style={{ textAlign: "right" }}>Members</th>
                  <th style={{ textAlign: "right" }}>Daily Cost</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r) => (
                  <tr
                    key={r.name}
                    style={{ cursor: "pointer" }}
                    onClick={() => setSelected(r)}
                  >
                    <td>
                      <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, color: "#475569", fontWeight: 600 }}>
                        {r.team_id}
                      </span>
                    </td>
                    <td style={{ fontWeight: 600, color: "#0f172a" }}>{r.team_name}</td>
                    <td><StatusPill value={r.team_category} /></td>
                    <td><StatusPill value={r.team_type} /></td>
                    <td><StatusPill value={r.status} /></td>
                    <td>
                      {r.today_status
                        ? <StatusPill value={r.today_status} />
                        : <span style={{ color: "#cbd5e1", fontSize: 12 }}>—</span>}
                    </td>
                    <td style={{ color: "#475569" }}>{r.im_name || "—"}</td>
                    <td>
                      {r.current_projects
                        ? <span style={{ fontSize: 12, color: "#0369a1", fontWeight: 600, fontFamily: "ui-monospace, monospace" }}>{r.current_projects}</span>
                        : <span style={{ color: "#cbd5e1", fontSize: 12 }}>—</span>}
                    </td>
                    <td>
                      {r.current_domains
                        ? <span style={{ fontSize: 12, color: "#7c3aed", fontWeight: 600 }}>{r.current_domains}</span>
                        : <span style={{ color: "#cbd5e1", fontSize: 12 }}>—</span>}
                    </td>
                    <td>
                      {r.active_plan_count > 0
                        ? <span style={{ display: "inline-flex", alignItems: "center", background: "#eff6ff", color: "#1d4ed8", borderRadius: 999, padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>{r.active_plan_count}</span>
                        : <span style={{ color: "#cbd5e1", fontSize: 12 }}>—</span>}
                    </td>
                    <td style={{ textAlign: "right", color: "#475569" }}>{r.member_count ?? "—"}</td>
                    <td style={{ textAlign: "right", color: r.daily_cost_applies ? "#0f172a" : "#94a3b8" }}>
                      {r.daily_cost_applies ? `SAR ${fmt.format(r.daily_cost)}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </DataTableWrapper>
      </div>

      {/* Modal */}
      {selected && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.5)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 16px" }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) closeModal(); }}
        >
          <div style={{
            background: "#fff",
            borderRadius: 14,
            width: "min(960px, 100%)",
            maxHeight: "88vh",
            display: "flex",
            flexDirection: "column",
            boxShadow: "0 25px 60px rgba(15,23,42,0.3)",
            overflow: "hidden",
          }}>
            {/* Modal header */}
            <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 24px", borderBottom: "1px solid #e2e8f0", flexShrink: 0 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 16, color: "#0f172a" }}>{selected.team_name}</div>
                <div style={{ fontSize: 12, color: "#94a3b8", fontFamily: "ui-monospace, monospace", marginTop: 2 }}>{selected.team_id}</div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                {saveOk && !editing && (
                  <span style={{ fontSize: 12, color: "#047857", fontWeight: 600 }}>Saved</span>
                )}
                {saveErr && (
                  <span style={{ fontSize: 12, color: "#b91c1c", maxWidth: 200 }}>{saveErr}</span>
                )}
                {editing ? (
                  <>
                    <button className="btn-secondary" style={{ fontSize: "0.8rem", padding: "5px 14px" }} onClick={cancelEdit} disabled={saveBusy}>Cancel</button>
                    <button className="btn-primary" style={{ fontSize: "0.8rem", padding: "5px 14px" }} onClick={handleSave} disabled={saveBusy}>
                      {saveBusy ? "Saving…" : "Save"}
                    </button>
                  </>
                ) : (
                  <button className="btn-secondary" style={{ fontSize: "0.8rem", padding: "5px 14px" }} onClick={() => { setEditing(true); setSaveOk(false); }}>Edit</button>
                )}
                <button
                  onClick={closeModal}
                  style={{ background: "none", border: "1px solid #e2e8f0", cursor: "pointer", padding: "4px 8px", color: "#64748b", fontSize: 15, lineHeight: 1, borderRadius: 6 }}
                  title="Close"
                >✕</button>
              </div>
            </div>

            {/* Modal body */}
            <div style={{ overflowY: "auto", flex: 1, padding: 24 }}>
              {detailLoading ? (
                <div style={{ padding: 48, textAlign: "center", color: "#94a3b8" }}>Loading…</div>
              ) : detail ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

                  {/* Team Info + Members */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>

                    {/* Team Info card */}
                    <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden" }}>
                      <div style={{ padding: "10px 16px", borderBottom: "1px solid #f1f5f9", fontWeight: 700, fontSize: 13, color: "#475569", background: "#f8fafc" }}>Team Info</div>
                      <div style={{ padding: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                        {editing ? (
                          <>
                            <EditField label="Team Name">
                              <input style={inputStyle} value={form.team_name} onChange={(e) => setForm((f) => ({ ...f, team_name: e.target.value }))} />
                            </EditField>
                            <EditField label="Status">
                              <select style={inputStyle} value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                                <option value="Active">Active</option>
                                <option value="Inactive">Inactive</option>
                              </select>
                            </EditField>
                            <EditField label="Team Type">
                              <select style={inputStyle} value={form.team_type} onChange={(e) => setForm((f) => ({ ...f, team_type: e.target.value }))}>
                                <option value="INET">INET</option>
                                <option value="SUB">SUB</option>
                              </select>
                            </EditField>
                            <EditField label="Category">
                              <select style={inputStyle} value={form.team_category} onChange={(e) => setForm((f) => ({ ...f, team_category: e.target.value }))}>
                                <option value="Field Team">Field Team</option>
                                <option value="Backend Team">Backend Team</option>
                              </select>
                            </EditField>
                            <EditField label="IM">
                              <SearchableSelect
                                value={form.im}
                                onChange={(id) => setForm((f) => ({ ...f, im: id }))}
                                options={imPickerOptions}
                                onSearch={setImPickerSearch}
                                placeholder="Search IM…"
                                minWidth={160}
                              />
                            </EditField>
                            <EditField label="Subcontractor">
                              <SearchableSelect
                                value={form.subcontractor}
                                onChange={(id) => setForm((f) => ({ ...f, subcontractor: id }))}
                                options={subOptions}
                                placeholder="Search subcontractor…"
                                minWidth={160}
                              />
                            </EditField>
                            <EditField label="Field User">
                              <SearchableSelect
                                value={form.field_user}
                                onChange={(id) => setForm((f) => ({ ...f, field_user: id }))}
                                options={userPickerOptions}
                                onSearch={setUserPickerSearch}
                                placeholder="Search user…"
                                minWidth={160}
                              />
                            </EditField>
                            <EditField label="ISDP Account">
                              <input style={inputStyle} value={form.isdp_account} onChange={(e) => setForm((f) => ({ ...f, isdp_account: e.target.value }))} />
                            </EditField>
                            <EditField label="Daily Cost Applies">
                              <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                                <input type="checkbox" checked={!!form.daily_cost_applies} onChange={(e) => setForm((f) => ({ ...f, daily_cost_applies: e.target.checked }))} />
                                <span style={{ fontSize: 13 }}>Applies</span>
                              </label>
                            </EditField>
                            <EditField label="Daily Cost (SAR)">
                              <input style={inputStyle} type="number" value={form.daily_cost} onChange={(e) => setForm((f) => ({ ...f, daily_cost: e.target.value }))} disabled={!form.daily_cost_applies} />
                            </EditField>
                            <div style={{ gridColumn: "1 / -1" }}>
                              <EditField label="Note">
                                <textarea style={{ ...inputStyle, minHeight: 60, resize: "vertical" }} value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
                              </EditField>
                            </div>
                          </>
                        ) : (
                          <>
                            <FieldRow label="Team Name">{detail.team_name}</FieldRow>
                            <FieldRow label="Status"><StatusPill value={detail.status} /></FieldRow>
                            <FieldRow label="Team Type"><StatusPill value={detail.team_type} /></FieldRow>
                            <FieldRow label="Category"><StatusPill value={detail.team_category} /></FieldRow>
                            <FieldRow label="IM">{detail.im_name || detail.im || "—"}</FieldRow>
                            <FieldRow label="Subcontractor">{detail.subcontractor || "—"}</FieldRow>
                            <FieldRow label="Field User">{detail.field_user || "—"}</FieldRow>
                            <FieldRow label="ISDP Account">{detail.isdp_account || "—"}</FieldRow>
                            <FieldRow label="Daily Cost">
                              {detail.daily_cost_applies ? `SAR ${fmt.format(detail.daily_cost)}` : "—"}
                            </FieldRow>
                            <FieldRow label="Warehouse">{detail.warehouse || "—"}</FieldRow>
                            {detail.note && (
                              <div style={{ gridColumn: "1 / -1" }}>
                                <FieldRow label="Note">{detail.note}</FieldRow>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    {/* Members card */}
                    <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, overflow: editing ? "visible" : "hidden" }}>
                      <div style={{ padding: "10px 16px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", justifyContent: "space-between", background: "#f8fafc", borderRadius: editing ? "10px 10px 0 0" : undefined }}>
                        <span style={{ fontWeight: 700, fontSize: 13, color: "#475569" }}>
                          Members ({editing ? members.length : (detail.team_members || []).length})
                        </span>
                        {editing && (
                          <button
                            type="button"
                            style={{ background: "none", border: "1px solid #bfdbfe", color: "#2563eb", borderRadius: 6, padding: "2px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                            onClick={() => setMembers((prev) => [...prev, { ...EMPTY_MEMBER }])}
                          >+ Add</button>
                        )}
                      </div>
                      <div style={editing ? {} : { overflowY: "auto", maxHeight: 300 }}>
                        {editing ? (
                          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                            <thead>
                              <tr style={{ background: "#f8fafc" }}>
                                <th style={{ padding: "6px 10px", textAlign: "left", color: "#64748b", fontWeight: 600 }}>Employee</th>
                                <th style={{ padding: "6px 10px", textAlign: "left", color: "#64748b", fontWeight: 600 }}>Designation</th>
                                <th style={{ padding: "6px 8px", textAlign: "center", color: "#64748b", fontWeight: 600 }}>Lead</th>
                                <th style={{ width: 28 }} />
                              </tr>
                            </thead>
                            <tbody>
                              {members.map((m, idx) => (
                                <tr key={idx} style={{ borderTop: "1px solid #f1f5f9" }}>
                                  <td style={{ padding: "4px 8px" }}>
                                    <SearchableSelect
                                      value={m.employee}
                                      onChange={(id) => {
                                        const hit = empOptions.find((o) => o.id === id);
                                        setMembers((prev) => prev.map((row, i) => i !== idx ? row : {
                                          ...row,
                                          employee: id,
                                          employee_name: hit?.label || id,
                                          designation: hit?.designation || "",
                                        }));
                                      }}
                                      options={empOptions}
                                      onSearch={setEmpSearch}
                                      placeholder={m.employee_name || m.employee || "Search employee…"}
                                      minWidth={140}
                                      panelStyle={{ minWidth: 220 }}
                                    />
                                  </td>
                                  <td style={{ padding: "7px 10px", color: "#475569", fontSize: 12 }}>
                                    {m.designation || <span style={{ color: "#cbd5e1" }}>—</span>}
                                  </td>
                                  <td style={{ padding: "4px 8px", textAlign: "center" }}>
                                    <input
                                      type="checkbox"
                                      checked={!!m.is_team_lead}
                                      onChange={(e) => setMemberField(idx, "is_team_lead", e.target.checked ? 1 : 0)}
                                    />
                                  </td>
                                  <td style={{ padding: "4px 4px" }}>
                                    <button
                                      type="button"
                                      onClick={() => setMembers((prev) => prev.filter((_, i) => i !== idx))}
                                      style={{ background: "none", border: "none", cursor: "pointer", color: "#94a3b8", fontSize: 14, padding: "2px 4px", lineHeight: 1 }}
                                      title="Remove"
                                    >✕</button>
                                  </td>
                                </tr>
                              ))}
                              {members.length === 0 && (
                                <tr><td colSpan={4} style={{ padding: 16, textAlign: "center", color: "#94a3b8" }}>No members — click + Add</td></tr>
                              )}
                            </tbody>
                          </table>
                        ) : (
                          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                            <thead>
                              <tr style={{ background: "#f8fafc" }}>
                                <th style={{ padding: "6px 10px", textAlign: "left", color: "#64748b", fontWeight: 600 }}>Employee</th>
                                <th style={{ padding: "6px 10px", textAlign: "left", color: "#64748b", fontWeight: 600 }}>Designation</th>
                                <th style={{ padding: "6px 8px", textAlign: "center", color: "#64748b", fontWeight: 600 }}>Lead</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(detail.team_members || []).map((m, i) => (
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
                              {(detail.team_members || []).length === 0 && (
                                <tr><td colSpan={3} style={{ padding: 16, textAlign: "center", color: "#94a3b8" }}>No members</td></tr>
                              )}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Active Plans */}
                  {(detail.active_plans || []).length > 0 && (
                    <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden" }}>
                      <div style={{ padding: "10px 16px", borderBottom: "1px solid #f1f5f9", fontWeight: 700, fontSize: 13, color: "#475569", background: "#f8fafc" }}>
                        Active Plans ({detail.active_plans.length})
                      </div>
                      <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                          <thead>
                            <tr style={{ background: "#f8fafc" }}>
                              <th style={{ padding: "6px 12px", textAlign: "left", color: "#64748b", fontWeight: 600 }}>Plan</th>
                              <th style={{ padding: "6px 12px", textAlign: "left", color: "#64748b", fontWeight: 600 }}>POID</th>
                              <th style={{ padding: "6px 12px", textAlign: "left", color: "#64748b", fontWeight: 600 }}>Project</th>
                              <th style={{ padding: "6px 12px", textAlign: "left", color: "#64748b", fontWeight: 600 }}>Domain</th>
                              <th style={{ padding: "6px 12px", textAlign: "left", color: "#64748b", fontWeight: 600 }}>DUID</th>
                              <th style={{ padding: "6px 12px", textAlign: "left", color: "#64748b", fontWeight: 600 }}>Plan Date</th>
                              <th style={{ padding: "6px 12px", textAlign: "left", color: "#64748b", fontWeight: 600 }}>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {detail.active_plans.map((p, i) => (
                              <tr key={i} style={{ borderTop: "1px solid #f1f5f9" }}>
                                <td style={{ padding: "7px 12px", fontFamily: "ui-monospace, monospace", fontSize: 11, color: "#64748b" }}>{p.plan_name}</td>
                                <td style={{ padding: "7px 12px", fontFamily: "ui-monospace, monospace", fontSize: 11, fontWeight: 600, color: "#0f172a" }}>{p.poid || "—"}</td>
                                <td style={{ padding: "7px 12px", color: "#475569" }}>{p.project_code || "—"}</td>
                                <td style={{ padding: "7px 12px" }}>
                                  {p.project_domain
                                    ? <span style={{ color: "#7c3aed", fontWeight: 600, fontSize: 11 }}>{p.project_domain}</span>
                                    : "—"}
                                </td>
                                <td style={{ padding: "7px 12px", fontFamily: "ui-monospace, monospace", fontSize: 11, color: "#64748b" }}>{p.site_code || "—"}</td>
                                <td style={{ padding: "7px 12px", color: "#475569" }}>{p.plan_date || "—"}</td>
                                <td style={{ padding: "7px 12px" }}><StatusPill value={p.plan_status} /></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

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
