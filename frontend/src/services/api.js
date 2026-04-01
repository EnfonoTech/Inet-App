async function call(method, args = {}) {
  const params = new URLSearchParams();
  Object.entries(args).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") params.append(k, String(v));
  });
  const res = await fetch(`/api/method/${method}?${params.toString()}`, {
    credentials: "include",
  });
  const json = await res.json();
  if (!res.ok || json.exc) throw new Error(json.message || "API request failed");
  return json.message;
}

export const pmApi = {
  listProjects: (args) => call("inet_app.api.project_management.list_projects", args),
  projectKpis: () => call("inet_app.api.project_management.get_project_kpis"),
  overview: () => call("inet_app.api.project_management.get_pms_overview"),
  charts: () => call("inet_app.api.project_management.dashboard_charts"),
  listUpdates: (args) => call("inet_app.api.project_management.list_daily_work_updates", args),
  listAssignments: (args) => call("inet_app.api.project_management.list_team_assignments", args),
};
