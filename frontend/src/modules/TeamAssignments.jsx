import { useEffect, useState } from "react";
import { pmApi } from "../services/api";
import Modal from "../components/Modal";

export default function TeamAssignments() {
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState("");
  const [team, setTeam] = useState("");
  const [projects, setProjects] = useState([]);
  const [form, setForm] = useState({
    team_id: "",
    project: "",
    assignment_date: new Date().toISOString().slice(0, 10),
    end_date: "",
    utilization_percentage: 0,
    status: "Active",
  });
  const [openCreate, setOpenCreate] = useState(false);
  const load = (s = status, t = team) =>
    pmApi.listAssignments({ limit: 50, status: s, team_id: t }).then(setRows).catch(() => setRows([]));

  useEffect(() => {
    load("", "");
    pmApi.listProjects({ limit: 200 }).then(setProjects).catch(() => setProjects([]));
  }, []);

  const saveAssignment = async () => {
    if (!form.team_id || !form.project) return;
    await pmApi.upsertAssignment(form);
    setForm((p) => ({ ...p, team_id: "", utilization_percentage: 0 }));
    load();
    setOpenCreate(false);
  };

  return (
    <div className="page-wrap">
      <div className="page-header">
        <h1 className="page-title">Team Assignments</h1>
        <button className="btn-primary" onClick={() => setOpenCreate(true)}>New Assignment</button>
      </div>
      <div className="toolbar">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All Status</option>
          <option value="Active">Active</option>
          <option value="Completed">Completed</option>
        </select>
        <input placeholder="Team ID" value={team} onChange={(e) => setTeam(e.target.value)} />
        <button className="btn-secondary" onClick={() => load()}>Apply</button>
      </div>
      <div className="card table-card">
        <div className="table-title">Team Utilization</div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Team</th>
              <th>Project</th>
              <th>Assignment Date</th>
              <th>End Date</th>
              <th>Utilization</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={6} className="empty-state">No assignments found.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.name}>
                <td className="mono">{r.team_id}</td>
                <td>{r.project}</td>
                <td>{r.assignment_date}</td>
                <td>{r.end_date || "-"}</td>
                <td>{r.utilization_percentage || 0}%</td>
                <td><span className={`badge ${r.status === "Completed" ? "badge-done" : "badge-active"}`}>{r.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={openCreate} title="Create Team Assignment" onClose={() => setOpenCreate(false)}>
        <div className="form-grid">
          <input placeholder="Team ID" value={form.team_id} onChange={(e) => setForm((p) => ({ ...p, team_id: e.target.value }))} />
          <select value={form.project} onChange={(e) => setForm((p) => ({ ...p, project: e.target.value }))}>
            <option value="">Select Project</option>
            {projects.map((p) => (
              <option key={p.name} value={p.name}>{p.project_code || p.name}</option>
            ))}
          </select>
          <input type="date" value={form.assignment_date} onChange={(e) => setForm((p) => ({ ...p, assignment_date: e.target.value }))} />
          <input type="date" value={form.end_date} onChange={(e) => setForm((p) => ({ ...p, end_date: e.target.value }))} />
          <input type="number" placeholder="Utilization %" value={form.utilization_percentage} onChange={(e) => setForm((p) => ({ ...p, utilization_percentage: Number(e.target.value || 0) }))} />
          <select value={form.status} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))}>
            <option>Active</option>
            <option>Completed</option>
          </select>
        </div>
        <button className="btn-primary" onClick={saveAssignment}>Save Assignment</button>
      </Modal>
    </div>
  );
}
