import { useEffect, useState } from "react";
import DataTableWrapper from "../../components/DataTableWrapper";
import { useAuth } from "../../context/AuthContext";
import { pmApi } from "../../services/api";
import RecordDetailView from "../../components/RecordDetailView";
import ExportExcelButton from "../../components/ExportExcelButton";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

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
            <span style={{
              fontSize: "0.68rem", fontWeight: 700, padding: "1px 7px", borderRadius: 999,
              background: isCustomer ? "rgba(245,158,11,0.12)" : "rgba(59,130,246,0.12)",
              color: isCustomer ? "#b45309" : "#1d4ed8",
            }}>
              {isCustomer ? "Huawei" : "Company (INET)"}
            </span>
            {sources.length > 0 && (
              <button type="button" onClick={() => setOpen(o => !o)} style={{
                background: "none", border: "none", cursor: "pointer", padding: 0,
                fontSize: "0.68rem", color: "#94a3b8",
              }}>
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

function statusTone(value) {
  const s = String(value || "").toLowerCase();
  if (s.includes("active") || s.includes("approved")) return { bg: "#ecfdf5", fg: "#047857" };
  if (s.includes("cancel") || s.includes("reject") || s.includes("inactive")) return { bg: "#fef2f2", fg: "#b91c1c" };
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

const EMPTY_MEMBER = { employee: "", employee_name: "", designation: "", is_team_lead: 0 };

export default function IMTeams() {
  const { imName, user } = useAuth();
  const [teams, setTeams] = useState([]);
  const [allTeams, setAllTeams] = useState([]);
  const [imLabels, setImLabels] = useState({}); // im name → display label
  const [requests, setRequests] = useState([]); // all visible Team Allocation Requests
  const [tab, setTab] = useState("my"); // "my" | "all" | "outgoing" | "incoming"
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [detailRow, setDetailRow] = useState(null);
  const [detailMembers, setDetailMembers] = useState([]);
  const [detailMembersLoading, setDetailMembersLoading] = useState(false);
  const [detailStock, setDetailStock] = useState([]);
  const [detailStockLoading, setDetailStockLoading] = useState(false);

  // Edit modal state
  const [editRow, setEditRow] = useState(null);     // shows the modal when set
  const [editLoading, setEditLoading] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [members, setMembers] = useState([]);
  const [editBusy, setEditBusy] = useState(false);
  const [editErr, setEditErr] = useState(null);

  // Team Allocation Request flows.
  const [requestTarget, setRequestTarget] = useState(null);   // team row being requested
  const [requestReason, setRequestReason] = useState("");
  const [respondTarget, setRespondTarget] = useState(null);   // request row being responded to
  const [respondRemark, setRespondRemark] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [actionErr, setActionErr] = useState(null);
  const [actionMsg, setActionMsg] = useState(null);

  // Picker option caches
  const [employees, setEmployees] = useState([]);

  async function loadAll() {
    setLoading(true);
    try {
      const myFilters = (() => {
        const imCandidates = [imName, user?.full_name].filter(Boolean);
        if (imCandidates.length > 1) return { im: ["in", imCandidates] };
        return { im: imCandidates[0] || "__none__" };
      })();
      const [my, all, ims, reqs] = await Promise.all([
        pmApi.listINETTeams(myFilters).catch(() => []),
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
    if (imName || user?.full_name) loadAll();
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imName, user?.full_name]);

  // Pull full team detail (incl. members + stock) when the View modal opens.
  useEffect(() => {
    if (!detailRow?.name) return;
    let alive = true;
    setDetailMembers([]);
    setDetailStock([]);
    setDetailMembersLoading(true);
    setDetailStockLoading(true);
    pmApi.getIMTeamDetail(detailRow.name)
      .then((d) => {
        if (!alive) return;
        setDetailMembers(Array.isArray(d?.team_members) ? d.team_members : []);
      })
      .catch(() => { if (alive) setDetailMembers([]); })
      .finally(() => { if (alive) setDetailMembersLoading(false); });
    pmApi.getTeamMaterialStock(detailRow.name)
      .then((data) => {
        if (!alive) return;
        setDetailStock((Array.isArray(data) ? data : [])[0]?.items || []);
      })
      .catch(() => { if (alive) setDetailStock([]); })
      .finally(() => { if (alive) setDetailStockLoading(false); });
    return () => { alive = false; };
  }, [detailRow?.name]);

  async function openEdit(t) {
    setEditErr(null);
    setEditRow(t);
    setEditLoading(true);
    setEditForm({
      team_name: t.team_name || "",
      status: t.status || "Active",
      note: t.note || "",
    });
    setMembers([]);
    try {
      const detail = await pmApi.getIMTeamDetail(t.name);
      setEditForm((f) => ({
        ...f,
        team_name: detail.team_name || f.team_name,
        status: detail.status || f.status,
        note: detail.note || "",
      }));
      setMembers(Array.isArray(detail.team_members) ? detail.team_members : []);
    } catch (err) {
      setEditErr(err?.message || "Failed to load team detail");
    } finally {
      setEditLoading(false);
    }
    if (!employees.length) {
      pmApi.listEmployeesForPicker("").then((e) => setEmployees(e || [])).catch(() => {});
    }
  }

  function memberSet(idx, patch) {
    setMembers((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  }
  function memberRemove(idx) {
    setMembers((prev) => prev.filter((_, i) => i !== idx));
  }
  function memberAdd() {
    setMembers((prev) => [...prev, { ...EMPTY_MEMBER }]);
  }
  function memberSetLead(idx) {
    // Only one team lead allowed; setting checks others off.
    setMembers((prev) => prev.map((m, i) => ({ ...m, is_team_lead: i === idx ? 1 : 0 })));
  }

  async function submitEdit() {
    if (!editRow?.name) return;
    setEditBusy(true);
    setEditErr(null);
    try {
      const cleanMembers = members
        .filter((m) => m.employee)
        .map((m) => ({
          employee: m.employee,
          designation: m.designation || "",
          is_team_lead: m.is_team_lead ? 1 : 0,
        }));
      await pmApi.updateIMTeam(editRow.name, { ...editForm, team_members: cleanMembers });
      setEditRow(null);
      await loadAll();
      window.dispatchEvent(new Event("inet:approvals-changed"));
    } catch (err) {
      setEditErr(err?.message || "Failed to update team");
    } finally {
      setEditBusy(false);
    }
  }

  // ─── Team Allocation Request handlers ────────────────────────
  function openRequestModal(t) {
    setActionErr(null);
    setRequestReason("");
    setRequestTarget(t);
  }
  async function submitRequest() {
    if (!requestTarget) return;
    setActionBusy(true);
    setActionErr(null);
    try {
      await pmApi.requestTeamAllocation(requestTarget.name, requestReason);
      setActionMsg(`Request raised for ${requestTarget.team_name || requestTarget.name}. Awaiting source IM.`);
      setRequestTarget(null);
      await loadAll();
      window.dispatchEvent(new Event("inet:approvals-changed"));
    } catch (err) {
      setActionErr(err?.message || "Could not raise request");
    } finally {
      setActionBusy(false);
    }
  }

  function openRespondModal(r) {
    setActionErr(null);
    setRespondRemark("");
    setRespondTarget(r);
  }
  async function submitRespond(action) {
    if (!respondTarget) return;
    setActionBusy(true);
    setActionErr(null);
    try {
      await pmApi.respondTeamAllocation(respondTarget.name, action, respondRemark);
      setActionMsg(`Request ${action === "accept" ? "accepted — awaiting PM" : "rejected"}.`);
      setRespondTarget(null);
      await loadAll();
      window.dispatchEvent(new Event("inet:approvals-changed"));
    } catch (err) {
      setActionErr(err?.message || "Action failed");
    } finally {
      setActionBusy(false);
    }
  }

  async function doCancel(req) {
    if (!confirm(`Cancel allocation request for ${req.team_name || req.team}?`)) return;
    setActionBusy(true);
    setActionErr(null);
    try {
      await pmApi.cancelTeamAllocation(req.name);
      setActionMsg("Request cancelled.");
      await loadAll();
      window.dispatchEvent(new Event("inet:approvals-changed"));
    } catch (err) {
      setActionErr(err?.message || "Cancel failed");
    } finally {
      setActionBusy(false);
    }
  }

  function statusTone(status) {
    const s = (status || "").toLowerCase();
    if (s.includes("approved")) return { bg: "#ecfdf5", fg: "#047857", bd: "#a7f3d0" };
    if (s.includes("reject") || s.includes("cancel")) return { bg: "#fef2f2", fg: "#b91c1c", bd: "#fecaca" };
    if (s.includes("pm")) return { bg: "#eff6ff", fg: "#1d4ed8", bd: "#bfdbfe" };
    return { bg: "#fffbeb", fg: "#b45309", bd: "#fde68a" };
  }

  // Outgoing / incoming counts for tab pill badges.
  const myImName = imName || "";
  const outgoing = requests.filter((r) => r.to_im === myImName);
  const incoming = requests.filter((r) => r.from_im === myImName);
  const outgoingPendingCount = outgoing.filter((r) =>
    r.request_status === "Pending Source IM" || r.request_status === "Pending PM Approval",
  ).length;
  const incomingPendingCount = incoming.filter((r) => r.request_status === "Pending Source IM").length;

  // Map of team → most-recent open request, so the "All Teams" tab can
  // disable the Request button and show the in-flight status instead.
  const openRequestByTeam = {};
  for (const r of requests) {
    if (r.request_status === "Pending Source IM" || r.request_status === "Pending PM Approval") {
      const prior = openRequestByTeam[r.team];
      if (!prior || (r.modified || "") > (prior.modified || "")) {
        openRequestByTeam[r.team] = r;
      }
    }
  }

  const teamTypes = [...new Set(teams.map((t) => t.team_type).filter(Boolean))].sort();

  const sourceList = tab === "all" ? allTeams : teams;
  const filtered = sourceList.filter((t) => {
    if (typeFilter && t.team_type !== typeFilter) return false;
    if (statusFilter && t.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        (t.team_id || "").toLowerCase().includes(q) ||
        (t.team_name || "").toLowerCase().includes(q) ||
        (t.team_type || "").toLowerCase().includes(q) ||
        (t.area || "").toLowerCase().includes(q) ||
        (t.isdp_account || "").toLowerCase().includes(q) ||
        (imLabels[t.im] || t.im || "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  const hasFilters = search || typeFilter || statusFilter;
  const totalCost = filtered.reduce((s, t) => s + (t.daily_cost || 0), 0);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">My Teams</h1>
          <div className="page-subtitle">{filtered.length} teams managed by {imName}</div>
        </div>
        <div className="page-actions">
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "0.72rem", color: "#94a3b8" }}>Total Daily Cost</div>
            <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "#1e293b" }}>SAR {fmt.format(totalCost)}</div>
          </div>
          <ExportExcelButton filename="im-teams" rows={filtered} />
        </div>
      </div>

      {/* Tab bar — switches the list source between My Teams / All Teams
          (cross-IM, with Request action) and Outgoing / Incoming queues
          for in-flight allocation requests. */}
      <div role="tablist" style={{ display: "flex", gap: 4, padding: 4, background: "#f1f5f9", borderRadius: 8, border: "1px solid #e2e8f0", margin: "0 16px 8px", width: "fit-content" }}>
        {[
          { id: "my", label: "My Teams" },
          { id: "all", label: "All Teams" },
          { id: "outgoing", label: "Outgoing", count: outgoingPendingCount },
          { id: "incoming", label: "Incoming", count: incomingPendingCount },
        ].map((tt) => {
          const active = tab === tt.id;
          return (
            <button
              key={tt.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(tt.id)}
              style={{
                padding: "5px 14px", fontSize: "0.78rem", fontWeight: 700,
                border: "none", borderRadius: 6, cursor: "pointer",
                background: active ? "#1d4ed8" : "transparent",
                color: active ? "#fff" : "#475569",
                display: "inline-flex", alignItems: "center", gap: 6,
              }}
            >
              {tt.label}
              {!!tt.count && (
                <span style={{
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  minWidth: 18, height: 18, padding: "0 6px",
                  borderRadius: 999, fontSize: "0.66rem", fontWeight: 800,
                  background: active ? "#fff" : "#f59e0b",
                  color: active ? "#1d4ed8" : "#fff",
                }}>
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
          <input
            type="search"
            placeholder="Search team name, type, area, owner IM…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem", minWidth: 220 }}
          />
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem" }}>
            <option value="">All Types</option>
            {teamTypes.map((tt) => <option key={tt} value={tt}>{tt}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem" }}>
            <option value="">All Status</option>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </select>
          {hasFilters && (
            <button className="btn-secondary" style={{ fontSize: "0.78rem", padding: "5px 12px" }} onClick={() => { setSearch(""); setTypeFilter(""); setStatusFilter(""); }}>Clear</button>
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
                    <th>Team</th>
                    <th>Type</th>
                    {tab === "all" && <th>Owner IM</th>}
                    <th>Area</th>
                    <th>ISDP Account</th>
                    <th>Status</th>
                    <th style={{ textAlign: "right" }}>Daily Cost</th>
                    <th style={{ minWidth: 160 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((t) => {
                    const mine = t.im === myImName;
                    const openReq = openRequestByTeam[t.name];
                    return (
                      <tr key={t.name}>
                        <td style={{ fontWeight: 600 }}>{t.team_name || "—"}</td>
                        <td>{t.team_type}</td>
                        {tab === "all" && (
                          <td style={{ fontSize: "0.82rem" }}>
                            {mine
                              ? <span style={{ color: "#1d4ed8", fontWeight: 700 }}>You</span>
                              : (imLabels[t.im] || t.im || "—")}
                          </td>
                        )}
                        <td>{t.area || "—"}</td>
                        <td style={{ fontSize: "0.82rem" }}>{t.isdp_account || "—"}</td>
                        <td>
                          <span className={`status-badge ${t.status === "Active" ? "completed" : "cancelled"}`}>
                            <span className="status-dot" />
                            {t.status}
                          </span>
                        </td>
                        <td style={{ textAlign: "right", fontWeight: 600 }}>{fmt.format(t.daily_cost || 0)}</td>
                        <td>
                          <div style={{ display: "flex", gap: 6, flexWrap: "nowrap", alignItems: "center" }}>
                            <button type="button" className="btn-secondary" style={{ fontSize: "0.72rem", padding: "4px 8px", whiteSpace: "nowrap" }} onClick={() => setDetailRow(t)}>View</button>
                            {mine
                              ? (
                                <button type="button" className="btn-primary" style={{ fontSize: "0.72rem", padding: "4px 8px", whiteSpace: "nowrap" }} onClick={() => openEdit(t)}>Edit</button>
                              )
                              : openReq
                                ? (
                                  <span title={`Request ${openReq.name} — ${openReq.request_status}`} style={{
                                    fontSize: "0.68rem", fontWeight: 700, padding: "3px 8px",
                                    borderRadius: 999,
                                    ...(() => { const t2 = statusTone(openReq.request_status); return { background: t2.bg, color: t2.fg, border: `1px solid ${t2.bd}` }; })(),
                                  }}>
                                    {openReq.request_status === "Pending Source IM" ? "Pending IM" : "Pending PM"}
                                  </span>
                                )
                                : (
                                  <button
                                    type="button"
                                    className="btn-primary"
                                    style={{ fontSize: "0.72rem", padding: "4px 8px", whiteSpace: "nowrap" }}
                                    onClick={() => openRequestModal(t)}
                                    disabled={!t.im}
                                    title={!t.im ? "Team has no current IM — cannot request" : "Request transfer"}
                                  >
                                    Request
                                  </button>
                                )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={tab === "all" ? 7 : 6} style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", fontWeight: 700, fontSize: "0.78rem" }}>
                      {filtered.length}{hasFilters && ` of ${sourceList.length}`} teams
                    </td>
                    <td style={{ textAlign: "right", fontWeight: 700, padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0" }}>
                      SAR {fmt.format(totalCost)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            )
          ) : (
            // Outgoing / Incoming request queues.
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
                      const tone = statusTone(r.request_status);
                      const otherIm = tab === "outgoing" ? r.from_im : r.to_im;
                      return (
                        <tr key={r.name}>
                          <td style={{ fontWeight: 600 }}>{r.team_name || r.team || "—"}</td>
                          <td style={{ fontSize: "0.82rem" }}>{(tab === "outgoing" ? r.from_im_name : r.to_im_name) || otherIm || "—"}</td>
                          <td>
                            <span style={{
                              display: "inline-block", padding: "3px 10px", borderRadius: 999,
                              fontSize: "0.7rem", fontWeight: 700,
                              background: tone.bg, color: tone.fg, border: `1px solid ${tone.bd}`,
                            }}>
                              {r.request_status}
                            </span>
                          </td>
                          <td style={{ fontSize: "0.82rem", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.reason || ""}>
                            {r.reason || "—"}
                          </td>
                          <td style={{ fontSize: "0.78rem", color: "#64748b" }}>
                            {r.creation ? new Date(r.creation).toLocaleString("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                          </td>
                          <td>
                            <div style={{ display: "flex", gap: 6, flexWrap: "nowrap" }}>
                              {tab === "incoming" && r.request_status === "Pending Source IM" && (
                                <button type="button" className="btn-primary" style={{ fontSize: "0.72rem", padding: "4px 10px" }} disabled={actionBusy} onClick={() => openRespondModal(r)}>
                                  Respond
                                </button>
                              )}
                              {tab === "outgoing" && r.request_status === "Pending Source IM" && (
                                <button type="button" className="btn-secondary" style={{ fontSize: "0.72rem", padding: "4px 10px", color: "#b91c1c" }} disabled={actionBusy} onClick={() => doCancel(r)}>
                                  Cancel
                                </button>
                              )}
                              {(r.source_im_remark || r.pm_remark) && (
                                <span title={`Source IM: ${r.source_im_remark || "—"}\nPM: ${r.pm_remark || "—"}`} style={{ fontSize: "0.7rem", color: "#94a3b8", cursor: "help" }}>
                                  ℹ remarks
                                </span>
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

      {/* ── Request Transfer modal ──────────────────────────── */}
      {requestTarget && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={() => !actionBusy && setRequestTarget(null)}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 20, width: "min(480px, 96vw)" }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 12px", fontSize: "1rem" }}>Request team transfer</h3>
            <div style={{ fontSize: "0.84rem", color: "#475569", marginBottom: 14 }}>
              Request to transfer <strong>{requestTarget.team_name || requestTarget.name}</strong>
              {" "}from{" "}
              <strong>{imLabels[requestTarget.im] || requestTarget.im || "—"}</strong>{" "}to{" "}
              <strong>you</strong>.
            </div>
            <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, marginBottom: 6, color: "#475569" }}>Reason (optional)</label>
            <textarea
              value={requestReason}
              onChange={(e) => setRequestReason(e.target.value)}
              rows={3}
              style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e2e8f0", boxSizing: "border-box", fontSize: "0.84rem", fontFamily: "inherit", resize: "vertical" }}
            />
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 14 }}>
              <button type="button" className="btn-secondary" disabled={actionBusy} onClick={() => setRequestTarget(null)}>Cancel</button>
              <button type="button" className="btn-primary" disabled={actionBusy} onClick={submitRequest}>
                {actionBusy ? "Submitting…" : "Submit request"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Source-IM Respond modal ─────────────────────────── */}
      {respondTarget && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={() => !actionBusy && setRespondTarget(null)}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 20, width: "min(480px, 96vw)" }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 12px", fontSize: "1rem" }}>Respond to allocation request</h3>
            <div style={{ fontSize: "0.84rem", color: "#475569", marginBottom: 14 }}>
              <strong>{respondTarget.to_im_name || respondTarget.to_im}</strong> is requesting{" "}
              <strong>{respondTarget.team_name || respondTarget.team}</strong> from you.
              {respondTarget.reason && (
                <div style={{ marginTop: 8, padding: "8px 10px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: "0.82rem", color: "#334155", whiteSpace: "pre-wrap" }}>
                  <div style={{ fontSize: "0.66rem", fontWeight: 700, color: "#94a3b8", marginBottom: 2 }}>REASON</div>
                  {respondTarget.reason}
                </div>
              )}
            </div>
            <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 600, marginBottom: 6, color: "#475569" }}>Remark (optional)</label>
            <textarea
              value={respondRemark}
              onChange={(e) => setRespondRemark(e.target.value)}
              rows={3}
              style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #e2e8f0", boxSizing: "border-box", fontSize: "0.84rem", fontFamily: "inherit", resize: "vertical" }}
            />
            <div style={{ display: "flex", gap: 10, justifyContent: "space-between", marginTop: 14 }}>
              <button type="button" className="btn-secondary" disabled={actionBusy} onClick={() => setRespondTarget(null)}>Close</button>
              <div style={{ display: "flex", gap: 10 }}>
                <button type="button" className="btn-secondary" style={{ color: "#b91c1c" }} disabled={actionBusy} onClick={() => submitRespond("reject")}>
                  {actionBusy ? "…" : "Reject"}
                </button>
                <button type="button" className="btn-primary" disabled={actionBusy} onClick={() => submitRespond("accept")}>
                  {actionBusy ? "…" : "Accept (forward to PM)"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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

                {/* Team members editor */}
                <div style={{ marginTop: 18 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                    <h4 style={{ margin: 0, fontSize: "0.88rem", fontWeight: 700, color: "#0f172a" }}>Team members <span style={{ color: "#94a3b8", fontWeight: 500, fontSize: "0.78rem" }}>({members.length})</span></h4>
                    <button type="button" className="btn-secondary" style={{ fontSize: "0.78rem", padding: "4px 10px" }} onClick={memberAdd}>+ Add member</button>
                  </div>
                  {members.length === 0 ? (
                    <div style={{ padding: 12, textAlign: "center", color: "#94a3b8", fontSize: "0.82rem", border: "1px dashed #e2e8f0", borderRadius: 8 }}>
                      No members yet. Click "Add member" to assign employees.
                    </div>
                  ) : (
                    <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                        <thead>
                          <tr style={{ background: "#f8fafc" }}>
                            <th style={{ textAlign: "left", padding: "8px 10px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", fontSize: "0.68rem", letterSpacing: "0.04em" }}>Employee</th>
                            <th style={{ textAlign: "left", padding: "8px 10px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", fontSize: "0.68rem", letterSpacing: "0.04em" }}>Designation</th>
                            <th style={{ textAlign: "center", padding: "8px 10px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", fontSize: "0.68rem", letterSpacing: "0.04em", width: 80 }}>Lead</th>
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
                                  memberSet(idx, {
                                    employee: empName,
                                    employee_name: hit?.employee_name || "",
                                    designation: hit?.designation || m.designation || "",
                                  });
                                }} style={{ width: "100%", padding: 6, fontSize: "0.82rem" }}>
                                  <option value="">— Select employee —</option>
                                  {employees.map((e) => (
                                    <option key={e.name} value={e.name}>{e.employee_name ? `${e.employee_name} (${e.name})` : e.name}</option>
                                  ))}
                                </select>
                              </td>
                              <td style={{ padding: "6px 10px" }}>
                                <input type="text" value={m.designation || ""} onChange={(e) => memberSet(idx, { designation: e.target.value })} placeholder="Auto-filled from employee" style={{ width: "100%", padding: 6, fontSize: "0.82rem" }} />
                              </td>
                              <td style={{ padding: "6px 10px", textAlign: "center" }}>
                                <input type="checkbox" checked={!!m.is_team_lead} onChange={() => memberSetLead(idx)} title="Mark as Team Lead (only one allowed)" />
                              </td>
                              <td style={{ padding: "6px 10px", textAlign: "center" }}>
                                <button type="button" onClick={() => memberRemove(idx)} title="Remove" style={{ background: "none", border: "none", color: "#ef4444", fontSize: 18, cursor: "pointer", padding: 0 }}>&times;</button>
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

      {detailRow && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setDetailRow(null)}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 20, width: "min(860px, 94vw)", maxHeight: "78vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ margin: 0, fontSize: "1rem" }}>Team Details</h3>
              <button type="button" onClick={() => setDetailRow(null)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8" }}>&times;</button>
            </div>
            <RecordDetailView
              row={detailRow}
              pills={[
                { label: "Team", value: detailRow.team_name || "—", tone: "blue" },
                detailRow.area ? { label: "Area", value: detailRow.area, tone: "green" } : null,
                detailRow.status ? { label: "Status", value: detailRow.status, tone: /active/i.test(detailRow.status) ? "green" : "slate" } : null,
              ].filter(Boolean)}
              hiddenFields={["team_id", "team_name"]}
            />

            <div style={{ marginTop: 16 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <h4 style={{ margin: 0, fontSize: "0.88rem", fontWeight: 700, color: "#0f172a" }}>
                  Team members <span style={{ color: "#94a3b8", fontWeight: 500, fontSize: "0.78rem" }}>({detailMembers.length})</span>
                </h4>
              </div>
              {detailMembersLoading ? (
                <div style={{ padding: 12, textAlign: "center", color: "#94a3b8", fontSize: "0.82rem" }}>Loading members…</div>
              ) : detailMembers.length === 0 ? (
                <div style={{ padding: 12, textAlign: "center", color: "#94a3b8", fontSize: "0.82rem", border: "1px dashed #e2e8f0", borderRadius: 8 }}>
                  No members assigned. Use Edit to add some.
                </div>
              ) : (
                <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                    <thead>
                      <tr style={{ background: "#f8fafc" }}>
                        <th style={{ textAlign: "left", padding: "8px 10px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", fontSize: "0.68rem", letterSpacing: "0.04em" }}>Employee</th>
                        <th style={{ textAlign: "left", padding: "8px 10px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", fontSize: "0.68rem", letterSpacing: "0.04em" }}>Designation</th>
                        <th style={{ textAlign: "center", padding: "8px 10px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", fontSize: "0.68rem", letterSpacing: "0.04em" }}>Lead</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailMembers.map((m, idx) => (
                        <tr key={`${m.employee || idx}`} style={{ borderTop: "1px solid #f1f5f9" }}>
                          <td style={{ padding: "8px 10px" }}>
                            <div style={{ fontWeight: 600, color: "#1e293b" }}>{m.employee_name || m.employee || "—"}</div>
                            {m.employee && m.employee_name && (
                              <div style={{ fontSize: "0.7rem", color: "#94a3b8", fontFamily: "ui-monospace, monospace" }}>{m.employee}</div>
                            )}
                          </td>
                          <td style={{ padding: "8px 10px", color: "#475569" }}>{m.designation || "—"}</td>
                          <td style={{ padding: "8px 10px", textAlign: "center" }}>
                            {m.is_team_lead
                              ? <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, background: "#eff6ff", color: "#1d4ed8", fontWeight: 700, fontSize: "0.7rem" }}>Lead</span>
                              : <span style={{ color: "#cbd5e1" }}>—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* ── Material Stock ─────────────────────────────── */}
            <div style={{ marginTop: 20 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <h4 style={{ margin: 0, fontSize: "0.88rem", fontWeight: 700, color: "#0f172a" }}>
                  Warehouse Stock
                  {!detailStockLoading && (
                    <span style={{ color: "#94a3b8", fontWeight: 500, fontSize: "0.78rem", marginLeft: 6 }}>
                      ({detailStock.length} item{detailStock.length !== 1 ? "s" : ""})
                    </span>
                  )}
                </h4>
                {detailRow?.warehouse && (
                  <span style={{ fontSize: "0.72rem", color: "#64748b", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: "2px 8px" }}>
                    {detailRow.warehouse}
                  </span>
                )}
              </div>
              {detailStockLoading ? (
                <div style={{ padding: 12, textAlign: "center", color: "#94a3b8", fontSize: "0.82rem" }}>Loading stock…</div>
              ) : detailStock.length === 0 ? (
                <div style={{ padding: 12, textAlign: "center", color: "#94a3b8", fontSize: "0.82rem", border: "1px dashed #e2e8f0", borderRadius: 8 }}>
                  No materials in warehouse.
                </div>
              ) : (
                <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                    <thead>
                      <tr style={{ background: "#f8fafc" }}>
                        <th style={{ textAlign: "left", padding: "8px 10px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", fontSize: "0.68rem", letterSpacing: "0.04em" }}>Item</th>
                        <th style={{ textAlign: "left", padding: "8px 10px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", fontSize: "0.68rem", letterSpacing: "0.04em" }}>Type</th>
                        <th style={{ textAlign: "right", padding: "8px 10px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", fontSize: "0.68rem", letterSpacing: "0.04em" }}>Qty</th>
                        <th style={{ textAlign: "left", padding: "8px 10px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", fontSize: "0.68rem", letterSpacing: "0.04em" }}>UOM</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailStock.map((it) => {
                        const isCustomer = it.item_type === "customer";
                        const sources = (it.sources || []).filter(s => s.poid || s.duid);
                        return (
                          <StockRowWithSources key={it.item_code} it={it} isCustomer={isCustomer} sources={sources} />
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{ borderTop: "2px solid #e2e8f0", background: "#f8fafc" }}>
                        <td colSpan={2} style={{ padding: "7px 10px", fontWeight: 700, fontSize: "0.78rem", color: "#475569" }}>
                          {detailStock.length} item{detailStock.length !== 1 ? "s" : ""}
                        </td>
                        <td style={{ padding: "7px 10px", textAlign: "right", fontWeight: 700, fontSize: "0.78rem", color: "#475569" }}>
                          {detailStock.reduce((s, it) => s + Number(it.qty || 0), 0).toLocaleString()}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
