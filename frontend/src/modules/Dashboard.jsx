import { useEffect, useState } from "react";
import { pmApi } from "../services/api";

export default function Dashboard() {
  const [kpis, setKpis] = useState(null);
  const [overview, setOverview] = useState(null);
  useEffect(() => {
    pmApi.projectKpis().then(setKpis).catch(() => setKpis({}));
    pmApi.overview().then(setOverview).catch(() => setOverview({}));
  }, []);

  return (
    <div className="page-wrap">
      <div className="page-head">
        <h1 className="page-title">Project Dashboard</h1>
        <p className="page-subtitle">Control center view for planning, execution, and closure.</p>
      </div>
      <div className="grid">
        {Object.entries(kpis || {}).map(([key, value]) => (
          <div className="card" key={key}>
            <div className="label">{key.replaceAll("_", " ")}</div>
            <div className="value">{value}</div>
          </div>
        ))}
      </div>

      <div className="grid two-col">
        <div className="card">
          <h3>Workflow Stages</h3>
          <div className="chip-row">
            {(overview?.workflow_stages || []).map((stage) => (
              <span className="chip" key={stage}>{stage}</span>
            ))}
          </div>
        </div>
        <div className="card">
          <h3>Recent Daily Updates</h3>
          <div className="mini-list">
            {(overview?.recent_updates || []).map((row) => (
              <div className="mini-row" key={row.name}>
                <span>{row.name}</span>
                <span>{row.status}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
