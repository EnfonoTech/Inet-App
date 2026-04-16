import { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { pmApi } from "../../services/api";

const TEAM_QC_OPTIONS = ["Pending", "Pass", "Fail"];
const TEAM_CIAG_OPTIONS = ["Open", "In Progress", "Submitted", "Approved", "Rejected", "N/A"];

function statusBadgeClass(status) {
  const s = String(status || "").toLowerCase();
  if (s === "pass" || s === "approved") return "completed";
  if (s === "fail" || s === "rejected") return "cancelled";
  if (s === "pending" || s === "open" || s.includes("progress") || s === "submitted") return "in-progress";
  return "new";
}

export default function FieldQcCiag() {
  const { teamId } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedPlans, setSelectedPlans] = useState(new Set());
  const [editRow, setEditRow] = useState(null);
  const [executionName, setExecutionName] = useState("");
  const [qcStatus, setQcStatus] = useState("Pending");
  const [ciagStatus, setCiagStatus] = useState("Open");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!teamId) return;
      setLoading(true);
      try {
        const list = await pmApi.listExecutionMonitorRows({ status: "Completed", team: teamId });
        if (!cancelled) setRows(Array.isArray(list) ? list : []);
      } catch {
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [teamId]);

  const filtered = rows.filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (r.name || "").toLowerCase().includes(q) ||
      (r.po_dispatch || "").toLowerCase().includes(q) ||
      (r.project_code || "").toLowerCase().includes(q) ||
      (r.site_code || "").toLowerCase().includes(q) ||
      (r.site_name || "").toLowerCase().includes(q) ||
      (r.center_area || "").toLowerCase().includes(q)
    );
  });

  async function openEditor(row) {
    setEditRow(row);
    setSaveMsg(null);
    try {
      const ex = await pmApi.getFieldExecutionForRollout(row.name);
      if (!ex?.name) {
        setExecutionName("");
        setSaveMsg("No execution found for this plan yet.");
        return;
      }
      setExecutionName(ex.name);
      setQcStatus(ex.qc_status || "Pending");
      setCiagStatus(ex.ciag_status || "Open");
    } catch {
      setExecutionName("");
      setSaveMsg("Could not load execution details.");
    }
  }

  function openSelectedEditor() {
    const first = filtered.find((r) => selectedPlans.has(r.name));
    if (!first) return;
    const row = first;
    if (row) openEditor(row);
  }

  function toggleRow(name) {
    setSelectedPlans((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function toggleAll() {
    if (filtered.length > 0 && filtered.every((r) => selectedPlans.has(r.name))) {
      setSelectedPlans(new Set());
    } else {
      setSelectedPlans(new Set(filtered.map((r) => r.name)));
    }
  }

  async function saveQcCiag() {
    if (!executionName) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      await pmApi.updateExecution({ name: executionName, qc_status: qcStatus, ciag_status: ciagStatus });
      setSaveMsg("QC / CIAG saved.");
    } catch (e) {
      setSaveMsg(e.message || "Could not save QC / CIAG.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">QC / CIAG</h1>
          <div className="page-subtitle">Completed plans pending QC and CIAG updates.</div>
        </div>
      </div>
      <div className="toolbar">
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="search"
            placeholder="Search plan, POID, project, DUID, site, center area..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem", minWidth: 300 }}
          />
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          {selectedPlans.size > 0 && <span style={{ fontSize: "0.78rem", color: "#64748b" }}>{selectedPlans.size} selected</span>}
          <button
            type="button"
            className="btn-primary"
            onClick={openSelectedEditor}
            disabled={selectedPlans.size === 0}
          >
            QC / CIAG
          </button>
        </div>
      </div>
      <div className="page-content">
        <div className="data-table-wrapper">
          {loading ? (
            <div style={{ padding: 32, textAlign: "center", color: "#94a3b8" }}>Loading completed plans...</div>
          ) : filtered.length === 0 ? (
            <div className="empty-state"><h3>No completed plans found</h3></div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}>
                    <input
                      type="checkbox"
                      checked={filtered.length > 0 && filtered.every((r) => selectedPlans.has(r.name))}
                      onChange={toggleAll}
                    />
                  </th>
                  <th>Plan</th>
                  <th>POID</th>
                  <th>Project</th>
                  <th>DUID</th>
                  <th>Plan Date</th>
                  <th>Visit Type</th>
                  <th>Center Area</th>
                  <th>Region</th>
                  <th>QC</th>
                  <th>CIAG</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.name}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedPlans.has(r.name)}
                        onChange={() => toggleRow(r.name)}
                      />
                    </td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{r.name}</td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{r.po_dispatch || "—"}</td>
                    <td>{r.project_code || "—"}</td>
                    <td>{r.site_code || "—"}</td>
                    <td>{r.plan_date || "—"}</td>
                    <td>{r.visit_type || "—"}</td>
                    <td style={{ fontSize: "0.82rem", maxWidth: 120 }} title={r.center_area || ""}>{r.center_area || "—"}</td>
                    <td>{r.region_type || "—"}</td>
                    <td>
                      <span className={`status-badge ${statusBadgeClass(r.qc_status || "Pending")}`}>
                        <span className="status-dot" />
                        {r.qc_status || "Pending"}
                      </span>
                    </td>
                    <td>
                      <span className={`status-badge ${statusBadgeClass(r.ciag_status || "Open")}`}>
                        <span className="status-dot" />
                        {r.ciag_status || "Open"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      {editRow && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setEditRow(null)}>
          <div style={{ width: "min(520px, 94vw)", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 20 }} onClick={(e) => e.stopPropagation()}>
            <h4 style={{ margin: "0 0 12px" }}>QC / CIAG: {editRow.name}</h4>
            <div style={{ marginBottom: 10, fontSize: "0.82rem", color: "#475569" }}>
              POID: <strong>{editRow.po_dispatch || "—"}</strong>
            </div>
            <div style={{ marginBottom: 10, fontSize: "0.82rem", color: "#475569" }}>
              Project: <strong>{editRow.project_code || "—"}</strong> · DUID: <strong>{editRow.site_code || "—"}</strong> · Site: <strong>{editRow.site_name || "—"}</strong>
            </div>
            <div style={{ marginBottom: 10, fontSize: "0.82rem", color: "#475569" }}>
              Plan Date: <strong>{editRow.plan_date || "—"}</strong> · Visit: <strong>{editRow.visit_type || "—"}</strong>
            </div>
            <div className="form-group" style={{ marginBottom: 10 }}>
              <label>QC status</label>
              <select value={qcStatus} onChange={(e) => setQcStatus(e.target.value)}>
                {TEAM_QC_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 12 }}>
              <label>CIAG status</label>
              <select value={ciagStatus} onChange={(e) => setCiagStatus(e.target.value)}>
                {TEAM_CIAG_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            {saveMsg && <div className="notice info" style={{ marginBottom: 10 }}>{saveMsg}</div>}
            <button className="btn-primary" disabled={saving || !executionName} onClick={saveQcCiag}>{saving ? "Saving..." : "Save QC / CIAG"}</button>
            <button type="button" className="btn-secondary" style={{ marginLeft: 8 }} onClick={() => setEditRow(null)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
