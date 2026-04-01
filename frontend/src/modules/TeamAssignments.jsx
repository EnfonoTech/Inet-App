import { useEffect, useState } from "react";
import { pmApi } from "../services/api";

export default function TeamAssignments() {
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState("");
  const [team, setTeam] = useState("");
  const load = (s = status, t = team) =>
    pmApi.listAssignments({ limit: 50, status: s, team_id: t }).then(setRows).catch(() => setRows([]));

  useEffect(() => {
    load("", "");
  }, []);

  return (
    <div className="page-wrap">
      <h1>Team Assignments</h1>
      <div className="toolbar">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All Status</option>
          <option value="Active">Active</option>
          <option value="Completed">Completed</option>
        </select>
        <input placeholder="Team ID" value={team} onChange={(e) => setTeam(e.target.value)} />
        <button onClick={() => load()}>Apply</button>
      </div>
      <table>
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
          {rows.map((r) => (
            <tr key={r.name}>
              <td>{r.team_id}</td>
              <td>{r.project}</td>
              <td>{r.assignment_date}</td>
              <td>{r.end_date || "-"}</td>
              <td>{r.utilization_percentage || 0}%</td>
              <td>{r.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
