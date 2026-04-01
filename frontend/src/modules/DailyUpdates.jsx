import { useEffect, useState } from "react";
import { pmApi } from "../services/api";

export default function DailyUpdates() {
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState("");
  const [team, setTeam] = useState("");
  const load = (s = status, t = team) =>
    pmApi.listUpdates({ limit: 50, status: s, team: t }).then(setRows).catch(() => setRows([]));

  useEffect(() => {
    load("", "");
  }, []);

  return (
    <div className="page-wrap">
      <h1>Daily Work Updates</h1>
      <div className="toolbar">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All Status</option>
          <option value="Draft">Draft</option>
          <option value="Submitted">Submitted</option>
          <option value="Approved">Approved</option>
        </select>
        <input placeholder="Team" value={team} onChange={(e) => setTeam(e.target.value)} />
        <button onClick={() => load()}>Apply</button>
      </div>
      <table>
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
          {rows.map((r) => (
            <tr key={r.name}>
              <td>{r.name}</td>
              <td>{r.project}</td>
              <td>{r.team}</td>
              <td>{r.update_date}</td>
              <td>{r.status}</td>
              <td>{r.approval_status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
