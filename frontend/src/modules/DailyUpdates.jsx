import { useEffect, useState } from "react";
import { pmApi } from "../services/api";
import Modal from "../components/Modal";

export default function DailyUpdates() {
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState("");
  const [team, setTeam] = useState("");
  const [projects, setProjects] = useState([]);
  const [form, setForm] = useState({
    project: "",
    team: "",
    update_date: new Date().toISOString().slice(0, 10),
    status: "Draft",
    approval_status: "Pending",
    work_description: "",
  });
  const [openCreate, setOpenCreate] = useState(false);
  const load = (s = status, t = team) =>
    pmApi.listUpdates({ limit: 50, status: s, team: t }).then(setRows).catch(() => setRows([]));

  useEffect(() => {
    load("", "");
    pmApi.listProjects({ limit: 200 }).then(setProjects).catch(() => setProjects([]));
  }, []);

  const saveUpdate = async () => {
    if (!form.project || !form.team) return;
    await pmApi.upsertUpdate(form);
    setForm((p) => ({ ...p, team: "", work_description: "" }));
    load();
    setOpenCreate(false);
  };

  return (
    <div className="page-wrap">
      <div className="page-header">
        <h1 className="page-title">Daily Work Updates</h1>
        <button className="btn-primary" onClick={() => setOpenCreate(true)}>New Daily Update</button>
      </div>
      <div className="toolbar">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All Status</option>
          <option value="Draft">Draft</option>
          <option value="Submitted">Submitted</option>
          <option value="Approved">Approved</option>
        </select>
        <input placeholder="Team" value={team} onChange={(e) => setTeam(e.target.value)} />
        <button className="btn-secondary" onClick={() => load()}>Apply</button>
      </div>
      <div className="card table-card">
        <div className="table-title">Execution Updates</div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Update</th>
              <th>Project</th>
              <th>Team</th>
              <th>Date</th>
              <th>Status</th>
              <th>Approval</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={6} className="empty-state">No daily updates found.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.name}>
                <td className="mono">{r.name}</td>
                <td>{r.project}</td>
                <td>{r.team}</td>
                <td>{r.update_date}</td>
                <td><span className={`badge ${r.status === "Approved" ? "badge-done" : r.status === "Submitted" ? "badge-active" : "badge-draft"}`}>{r.status}</span></td>
                <td><span className={`badge ${r.approval_status === "Approved" ? "badge-done" : "badge-draft"}`}>{r.approval_status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={openCreate} title="Create Daily Update" onClose={() => setOpenCreate(false)}>
        <div className="form-grid">
          <select value={form.project} onChange={(e) => setForm((p) => ({ ...p, project: e.target.value }))}>
            <option value="">Select Project</option>
            {projects.map((p) => (
              <option key={p.name} value={p.name}>{p.project_code || p.name}</option>
            ))}
          </select>
          <input placeholder="Team" value={form.team} onChange={(e) => setForm((p) => ({ ...p, team: e.target.value }))} />
          <input type="date" value={form.update_date} onChange={(e) => setForm((p) => ({ ...p, update_date: e.target.value }))} />
          <select value={form.status} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))}>
            <option>Draft</option>
            <option>Submitted</option>
            <option>Approved</option>
          </select>
          <textarea placeholder="Work Description" value={form.work_description} onChange={(e) => setForm((p) => ({ ...p, work_description: e.target.value }))} />
        </div>
        <button className="btn-primary" onClick={saveUpdate}>Save Daily Update</button>
      </Modal>
    </div>
  );
}
