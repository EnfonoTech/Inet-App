import { useEffect, useState } from "react";
import DataTableWrapper from "../../components/DataTableWrapper";
import { useAuth } from "../../context/AuthContext";
import { pmApi } from "../../services/api";
import RecordDetailView from "../../components/RecordDetailView";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

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
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [detailRow, setDetailRow] = useState(null);
  const [detailMembers, setDetailMembers] = useState([]);
  const [detailMembersLoading, setDetailMembersLoading] = useState(false);

  // Edit modal state
  const [editRow, setEditRow] = useState(null);     // shows the modal when set
  const [editLoading, setEditLoading] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [members, setMembers] = useState([]);
  const [editBusy, setEditBusy] = useState(false);
  const [editErr, setEditErr] = useState(null);

  // Picker option caches
  const [employees, setEmployees] = useState([]);

  async function loadTeams() {
    try {
      const imCandidates = [imName, user?.full_name].filter(Boolean);
      const filters =
        imCandidates.length > 1
          ? { im: ["in", imCandidates] }
          : { im: imCandidates[0] || "__none__" };
      const rows = await pmApi.listINETTeams(filters);
      setTeams(rows || []);
    } catch {
      setTeams([]);
    }
    setLoading(false);
  }

  useEffect(() => {
    if (imName || user?.full_name) loadTeams();
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imName, user?.full_name]);

  // Pull full team detail (incl. members) when the View modal opens.
  useEffect(() => {
    if (!detailRow?.name) return;
    let alive = true;
    setDetailMembers([]);
    setDetailMembersLoading(true);
    pmApi.getIMTeamDetail(detailRow.name)
      .then((d) => {
        if (!alive) return;
        setDetailMembers(Array.isArray(d?.team_members) ? d.team_members : []);
      })
      .catch(() => { if (alive) setDetailMembers([]); })
      .finally(() => { if (alive) setDetailMembersLoading(false); });
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
      await loadTeams();
    } catch (err) {
      setEditErr(err?.message || "Failed to update team");
    } finally {
      setEditBusy(false);
    }
  }

  const teamTypes = [...new Set(teams.map((t) => t.team_type).filter(Boolean))].sort();

  const filtered = teams.filter((t) => {
    if (typeFilter && t.team_type !== typeFilter) return false;
    if (statusFilter && t.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        (t.team_id || "").toLowerCase().includes(q) ||
        (t.team_name || "").toLowerCase().includes(q) ||
        (t.team_type || "").toLowerCase().includes(q) ||
        (t.area || "").toLowerCase().includes(q) ||
        (t.isdp_account || "").toLowerCase().includes(q)
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
        </div>
      </div>

      <div className="toolbar">
        <input
          type="search"
          placeholder="Search team name, type, area…"
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

      <div className="page-content">
        <DataTableWrapper>
          {loading ? (
            <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">👥</div>
              <h3>{hasFilters ? "No results match your filters" : "No teams assigned"}</h3>
              {hasFilters && <p>Try adjusting your search or filter criteria.</p>}
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Team</th>
                  <th>Type</th>
                  <th>Area</th>
                  <th>ISDP Account</th>
                  <th>Status</th>
                  <th style={{ textAlign: "right" }}>Daily Cost</th>
                  <th style={{ minWidth: 140 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => (
                  <tr key={t.name}>
                    <td style={{ fontWeight: 600 }}>{t.team_name || "—"}</td>
                    <td>{t.team_type}</td>
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
                      <div style={{ display: "flex", gap: 6, flexWrap: "nowrap" }}>
                        <button type="button" className="btn-secondary" style={{ fontSize: "0.72rem", padding: "4px 8px", whiteSpace: "nowrap" }} onClick={() => setDetailRow(t)}>View</button>
                        <button type="button" className="btn-primary" style={{ fontSize: "0.72rem", padding: "4px 8px", whiteSpace: "nowrap" }} onClick={() => openEdit(t)}>Edit</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={6} style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", fontWeight: 700, fontSize: "0.78rem" }}>
                    {filtered.length}{hasFilters && ` of ${teams.length}`} teams
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 700, padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0" }}>
                    SAR {fmt.format(totalCost)}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </DataTableWrapper>
      </div>

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
                  <p style={{ marginTop: 6, fontSize: "0.7rem", color: "#94a3b8" }}>
                    Mark exactly one Team Lead. The lead's linked User becomes the Field App login.
                  </p>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
                  <button type="button" className="btn-secondary" disabled={editBusy} onClick={() => setEditRow(null)}>Cancel</button>
                  <button type="button" className="btn-primary" disabled={editBusy} onClick={submitEdit}>{editBusy ? "Saving…" : "Save"}</button>
                </div>
                <p style={{ marginTop: 10, fontSize: "0.72rem", color: "#94a3b8" }}>
                  Team ID, IM owner, type, subcontractor, Field App user, ISDP account and daily cost are admin-only.
                </p>
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
          </div>
        </div>
      )}
    </div>
  );
}
