import { useEffect, useState } from "react";
import { pmApi } from "../services/api";

export default function Projects() {
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");

  const load = (q = search, s = status) =>
    pmApi.listProjects({ limit: 50, search: q, status: s }).then(setRows).catch(() => setRows([]));

  useEffect(() => {
    load("", "");
  }, []);

  return (
    <div className="page-wrap">
      <h1>Projects</h1>
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
        <button onClick={() => load()}>Apply</button>
      </div>
      <table>
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
          {rows.map((r) => (
            <tr key={r.name}>
              <td>{r.project_code}</td>
              <td>{r.project_name}</td>
              <td>{r.project_status}</td>
              <td>{r.completion_percentage || 0}%</td>
              <td>{r.budget_amount || 0}</td>
              <td>{r.actual_cost || 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
