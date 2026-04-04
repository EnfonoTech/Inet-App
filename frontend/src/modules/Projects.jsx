import { useEffect, useState } from "react";
import { pmApi } from "../services/api";
import Modal from "../components/Modal";

export default function Projects() {
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");

  const load = (q = search, s = status) =>
    pmApi.listProjects({ limit: 50, search: q, status: s }).then(setRows).catch(() => setRows([]));
  const [form, setForm] = useState({
    project_code: "",
    project_name: "",
    project_status: "Active",
    completion_percentage: 0,
    budget_amount: 0,
    actual_cost: 0,
  });
  const [openCreate, setOpenCreate] = useState(false);

  useEffect(() => {
    load("", "");
  }, []);

  const saveProject = async () => {
    if (!form.project_code || !form.project_name) return;
    await pmApi.upsertProject(form);
    setForm({
      project_code: "",
      project_name: "",
      project_status: "Active",
      completion_percentage: 0,
      budget_amount: 0,
      actual_cost: 0,
    });
    load();
    setOpenCreate(false);
  };

  return (
    <div className="page-wrap">
      <div className="page-header">
        <h1 className="page-title">Projects</h1>
        <button className="btn-primary" onClick={() => setOpenCreate(true)}>New Project</button>
      </div>
      <div className="toolbar">
        <input
          placeholder="Search by code/name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All Status</option>
          <option value="Active">Active</option>
          <option value="At Risk">At Risk</option>
          <option value="On Hold">On Hold</option>
          <option value="Completed">Completed</option>
        </select>
        <button className="btn-secondary" onClick={() => load()}>Apply</button>
      </div>
      <div className="card table-card">
        <div className="table-title">Project Registry</div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Status</th>
              <th>Progress</th>
              <th>Budget</th>
              <th>Actual</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={6} className="empty-state">No projects found.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.name}>
                <td className="mono">{r.project_code}</td>
                <td>{r.project_name}</td>
                <td><span className={`badge ${r.project_status === "Completed" ? "badge-done" : r.project_status === "At Risk" ? "badge-risk" : r.project_status === "On Hold" ? "badge-hold" : "badge-active"}`}>{r.project_status}</span></td>
                <td>{r.completion_percentage || 0}%</td>
                <td>{r.budget_amount || 0}</td>
                <td>{r.actual_cost || 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={openCreate} title="Create Project" onClose={() => setOpenCreate(false)}>
        <div className="form-grid">
          <input placeholder="Project Code" value={form.project_code} onChange={(e) => setForm((p) => ({ ...p, project_code: e.target.value }))} />
          <input placeholder="Project Name" value={form.project_name} onChange={(e) => setForm((p) => ({ ...p, project_name: e.target.value }))} />
          <select value={form.project_status} onChange={(e) => setForm((p) => ({ ...p, project_status: e.target.value }))}>
            <option>Active</option>
            <option>At Risk</option>
            <option>On Hold</option>
            <option>Completed</option>
          </select>
          <input type="number" placeholder="Progress %" value={form.completion_percentage} onChange={(e) => setForm((p) => ({ ...p, completion_percentage: Number(e.target.value || 0) }))} />
          <input type="number" placeholder="Budget" value={form.budget_amount} onChange={(e) => setForm((p) => ({ ...p, budget_amount: Number(e.target.value || 0) }))} />
          <input type="number" placeholder="Actual" value={form.actual_cost} onChange={(e) => setForm((p) => ({ ...p, actual_cost: Number(e.target.value || 0) }))} />
        </div>
        <button className="btn-primary" onClick={saveProject}>Save Project</button>
      </Modal>
    </div>
  );
}
