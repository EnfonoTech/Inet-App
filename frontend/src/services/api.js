export async function frappe_login(usr, pwd) {
  const body = new URLSearchParams({ usr, pwd });
  const res = await fetch("/api/method/login", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Frappe-CSRF-Token": "fetch" },
    body,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.message || "Login failed");
  return json;
}

export async function frappe_logout() {
  await fetch("/api/method/logout", {
    method: "POST",
    credentials: "include",
    headers: { "X-Frappe-CSRF-Token": getCsrf() },
  });
}

/** Read Frappe's CSRF token from the browser cookie set at login time. */
function getCsrf() {
  const match = document.cookie.match(/frappe_csrf_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "fetch";
}

/**
 * Universal Frappe API caller.
 * Always uses POST so large payloads never hit URL length limits,
 * and includes the CSRF token required for write operations in v15.
 */
async function call(method, args = {}) {
  const body = new URLSearchParams();
  Object.entries(args).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") {
      body.append(k, typeof v === "object" ? JSON.stringify(v) : String(v));
    }
  });

  const res = await fetch(`/api/method/${method}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Frappe-CSRF-Token": getCsrf(),
    },
    body: body.toString(),
  });

  const json = await res.json();
  if (!res.ok || json.exc) {
    const msg = json._server_messages
      ? (() => { try { return JSON.parse(JSON.parse(json._server_messages)[0]).message; } catch { return null; } })()
      : null;
    throw new Error(msg || json.message || "API request failed");
  }
  return json.message;
}

export const pmApi = {
  // Projects
  listProjects:    (args)    => call("inet_app.api.project_management.list_projects", args),
  upsertProject:   (payload) => call("inet_app.api.project_management.upsert_project", { payload: JSON.stringify(payload) }),
  getProjectDetail:(name)    => call("inet_app.api.project_management.get_project_detail", { name }),
  projectKpis:     ()        => call("inet_app.api.project_management.get_project_kpis"),
  overview:        ()        => call("inet_app.api.project_management.get_pms_overview"),
  charts:          ()        => call("inet_app.api.project_management.dashboard_charts"),

  // Daily Work Updates
  listUpdates:     (args)    => call("inet_app.api.project_management.list_daily_work_updates", args),
  upsertUpdate:    (payload) => call("inet_app.api.project_management.upsert_daily_work_update", { payload: JSON.stringify(payload) }),

  // Team Assignments
  listAssignments: (args)    => call("inet_app.api.project_management.list_team_assignments", args),
  upsertAssignment:(payload) => call("inet_app.api.project_management.upsert_team_assignment", { payload: JSON.stringify(payload) }),

  // PO Intake
  listPoIntake:    (args)    => call("inet_app.api.project_management.list_po_intake", args),
  createPoIntake:  (payload) => call("inet_app.api.project_management.create_po_intake", { payload: JSON.stringify(payload) }),
  importPoIntake:  (rows)    => call("inet_app.api.project_management.import_po_intake", { rows: JSON.stringify(rows) }),

  // Masters
  listCustomers:   (args)    => call("inet_app.api.project_management.list_customers", args),
  createCustomer:  (payload) => call("inet_app.api.project_management.create_customer", { payload: JSON.stringify(payload) }),
  listItemCatalog: (args)    => call("inet_app.api.project_management.list_item_catalog", args),

  // Auth
  getLoggedUser:   ()        => call("inet_app.api.project_management.get_logged_user"),

  // Reports
  reportProjectStatusSummary:    (f) => call("inet_app.api.project_management.report_project_status_summary",    { filters: JSON.stringify(f || {}) }),
  reportBudgetVsActualByProject: (f) => call("inet_app.api.project_management.report_budget_vs_actual_by_project", { filters: JSON.stringify(f || {}) }),
  reportTeamUtilizationReport:   (f) => call("inet_app.api.project_management.report_team_utilization_report",   { filters: JSON.stringify(f || {}) }),
  reportDailyWorkProgressReport: (f) => call("inet_app.api.project_management.report_daily_work_progress_report", { filters: JSON.stringify(f || {}) }),
};
