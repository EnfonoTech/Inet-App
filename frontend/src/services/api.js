/**
 * CSRF for POST /api/method/* — Frappe v15 stores the real token in the session.
 * Loading Desk (/app) calls get_csrf_token() and rotates it; the SPA must use the
 * same token. We load it via GET get_logged_user (no CSRF) and refresh on tab focus.
 */
let portalCsrfToken = "";

export async function fetchPortalSession() {
  const res = await fetch("/api/method/inet_app.api.project_management.get_logged_user", {
    method: "GET",
    credentials: "include",
    cache: "no-store",
  });
  const json = await res.json();
  if (!res.ok) {
    portalCsrfToken = "";
    throw new Error(json.message || "Session check failed");
  }
  const msg = json.message;
  if (msg && msg.csrf_token) {
    portalCsrfToken = msg.csrf_token;
  } else {
    portalCsrfToken = "";
  }
  return msg;
}

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
  await fetchPortalSession().catch(() => {});
  return json;
}

export async function frappe_logout() {
  await fetch("/api/method/logout", {
    method: "POST",
    credentials: "include",
    headers: { "X-Frappe-CSRF-Token": getCsrf() },
  });
  portalCsrfToken = "";
}

/**
 * Current CSRF for non-`call()` requests (e.g. multipart `upload_file`).
 * Uses session token from fetchPortalSession; keep in sync with api.js only.
 */
export function getCsrf() {
  if (portalCsrfToken) return portalCsrfToken;
  const match = document.cookie.match(/frappe_csrf_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "fetch";
}

function _parseApiError(json) {
  let msg = json._server_messages
    ? (() => { try { return JSON.parse(JSON.parse(json._server_messages)[0]).message; } catch { return null; } })()
    : null;
  if (!msg && json.exception) msg = String(json.exception);
  if (!msg && json.exc) {
    try {
      const parsed = JSON.parse(json.exc);
      if (Array.isArray(parsed) && parsed[0]) msg = String(parsed[0]);
    } catch { /* ignore */ }
  }
  return msg || json.message || "API request failed";
}

function _isLikelyCsrfError(msg) {
  const s = String(msg || "").toLowerCase();
  return s.includes("invalid request") || s.includes("csrf");
}

/**
 * Tiny in-memory API response cache keyed by method + args JSON.
 * Stays in process memory — cleared on full page reload. TTL is per-call.
 * Goal: skip repeat network round-trips for lookup/reference data that
 * rarely changes within a browsing session (customers, doctype fields, etc).
 */
const _apiCache = new Map();

function _cacheKey(method, args) {
  try { return method + ":" + JSON.stringify(args || {}); }
  catch { return method + ":" + String(args); }
}

/** Wrap `call` with time-bounded memoization. Awaited callers share the same in-flight promise. */
async function callCached(method, args = {}, ttlMs = 60_000) {
  const key = _cacheKey(method, args);
  const now = Date.now();
  const hit = _apiCache.get(key);
  if (hit) {
    if (hit.promise) return hit.promise;             // in-flight request dedupe
    if (hit.expiresAt > now) return hit.value;       // fresh cached value
  }
  const promise = call(method, args)
    .then((value) => {
      _apiCache.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    })
    .catch((err) => {
      _apiCache.delete(key);
      throw err;
    });
  _apiCache.set(key, { promise });
  return promise;
}

/** Drop cached entries (exported for tests / manual invalidation). */
export function invalidateApiCache(methodPrefix) {
  if (!methodPrefix) { _apiCache.clear(); return; }
  for (const k of Array.from(_apiCache.keys())) {
    if (k.startsWith(methodPrefix + ":")) _apiCache.delete(k);
  }
}

async function call(method, args = {}) {
  const body = new URLSearchParams();
  Object.entries(args).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") {
      body.append(k, typeof v === "object" ? JSON.stringify(v) : String(v));
    }
  });

  const url = `/api/method/${method}`;
  const opts = () => ({
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Frappe-CSRF-Token": getCsrf(),
    },
    body: body.toString(),
  });

  let res = await fetch(url, opts());
  let json = await res.json();

  if ((!res.ok || json.exc) && _isLikelyCsrfError(_parseApiError(json))) {
    await fetchPortalSession().catch(() => {});
    res = await fetch(url, opts());
    json = await res.json();
  }

  if (!res.ok || json.exc) {
    throw new Error(_parseApiError(json));
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
  listIMMasters:   (args)    => call("inet_app.api.project_management.list_im_masters", args),
  listCustomers:   (args)    => callCached("inet_app.api.project_management.list_customers", args || {}, 60_000),
  createCustomer:  (payload) => call("inet_app.api.project_management.create_customer", { payload: JSON.stringify(payload) }),
  listItemCatalog: (args)    => call("inet_app.api.project_management.list_item_catalog", args),

  // Auth — GET so no CSRF; returns csrf_token for subsequent POSTs
  getLoggedUser:   ()        => fetchPortalSession(),

  // Reports
  reportProjectStatusSummary:    (f) => call("inet_app.api.project_management.report_project_status_summary",    { filters: JSON.stringify(f || {}) }),
  reportBudgetVsActualByProject: (f) => call("inet_app.api.project_management.report_budget_vs_actual_by_project", { filters: JSON.stringify(f || {}) }),
  reportTeamUtilizationReport:   (f) => call("inet_app.api.project_management.report_team_utilization_report",   { filters: JSON.stringify(f || {}) }),
  reportDailyWorkProgressReport: (f) => call("inet_app.api.project_management.report_daily_work_progress_report", { filters: JSON.stringify(f || {}) }),

  // ── Command Center APIs ────────────────────────────────────
  getProjectSummary:    (projectCode) => call("inet_app.api.command_center.get_project_summary", { project_code: projectCode }),
  getCommandDashboard:  (args = {})  => call("inet_app.api.command_center.get_command_dashboard", args),
  getIMDashboard:       (im, args = {}) => call("inet_app.api.command_center.get_im_dashboard", { im, ...args }),
  getIMReports:         ()          => call("inet_app.api.command_center.get_im_reports"),
  listIMRolloutPlans:   (im, planStatus, limit, portalFilters) => {
    const args = {
      im: im || "",
      ...(planStatus ? { plan_status: planStatus } : {}),
      ...(limit != null ? { limit } : {}),
    };
    if (portalFilters && typeof portalFilters === "object" && Object.keys(portalFilters).length > 0) {
      args.portal_filters = JSON.stringify(portalFilters);
    }
    return call("inet_app.api.command_center.list_im_rollout_plans", args);
  },
  listIMDailyExecutions:(im, execStatus, limit, portalFilters) => {
    const args = {
      im: im || "",
      ...(execStatus ? { execution_status: execStatus } : {}),
      ...(limit != null ? { limit } : {}),
    };
    if (portalFilters && typeof portalFilters === "object" && Object.keys(portalFilters).length > 0) {
      args.portal_filters = JSON.stringify(portalFilters);
    }
    return call("inet_app.api.command_center.list_im_daily_executions", args);
  },
  getDuidOverview:      (duid, poNo) =>
    call("inet_app.api.command_center.get_duid_overview", { duid: duid || "", po_no: poNo || "" }),
  reopenRolloutForRevisit: (rolloutPlan, issueCategory, issueRemarks) =>
    call("inet_app.api.command_center.reopen_rollout_for_revisit", {
      rollout_plan: rolloutPlan,
      issue_category: issueCategory || "",
      issue_remarks: issueRemarks || "",
    }),
  createIMDummyPODispatch: (payload) =>
    call("inet_app.api.command_center.create_im_dummy_po_dispatch", {
      payload: JSON.stringify(payload || {}),
    }),
  listPoIntakeLinesForIMMap: (projectCode) =>
    call("inet_app.api.command_center.list_po_intake_lines_for_im_map", {
      project_code: projectCode || "",
    }),
  mapIMDummyPoToIntakeLine: (payload) =>
    call("inet_app.api.command_center.map_im_dummy_po_to_intake_line", {
      payload: JSON.stringify(payload || {}),
    }),
  getFieldTeamDashboard:(team_id)   => call("inet_app.api.command_center.get_field_team_dashboard", { team_id }),
  uploadPOFile:         (file_url, customer)  => call("inet_app.api.command_center.upload_po_file", { file_url, customer: customer || "" }),
  confirmPOUpload:      async (rows, onProgress) => {
    // Chunk upload to stay under Werkzeug max_form_memory_size (500 KB default)
    // and nginx client_max_body_size (1 MB default). 500 rows ≈ 200 KB JSON.
    // Backend groups by po_no and appends to existing PO Intake, so chunking is safe.
    const all = Array.isArray(rows) ? rows : [];
    if (all.length === 0) {
      return await call("inet_app.api.command_center.confirm_po_upload", { rows: JSON.stringify([]) });
    }
    const CHUNK = 500;
    const totals = { created: 0, lines_imported: 0, lines_skipped_duplicate: 0, auto_dispatched: 0, names: [], po_summary: [] };
    // Merge per-PO rows across chunks (same po_no may appear in multiple chunks)
    const byPo = new Map();
    for (let i = 0; i < all.length; i += CHUNK) {
      const slice = all.slice(i, i + CHUNK);
      const r = await call("inet_app.api.command_center.confirm_po_upload", { rows: JSON.stringify(slice) });
      if (r) {
        totals.created += r.created || 0;
        totals.lines_imported += r.lines_imported || 0;
        totals.lines_skipped_duplicate += r.lines_skipped_duplicate || 0;
        totals.auto_dispatched += r.auto_dispatched || 0;
        if (Array.isArray(r.names)) totals.names.push(...r.names);
        if (Array.isArray(r.po_summary)) {
          r.po_summary.forEach((p) => {
            const existing = byPo.get(p.po_no);
            if (existing) {
              existing.lines_added += p.lines_added || 0;
              existing.lines_skipped += p.lines_skipped || 0;
              // First chunk that reported a new PO wins; later chunks for same PO are appends.
              if (!existing.intake_name && p.intake_name) existing.intake_name = p.intake_name;
            } else {
              byPo.set(p.po_no, { ...p });
            }
          });
        }
      }
      if (typeof onProgress === "function") {
        onProgress({ done: Math.min(i + CHUNK, all.length), total: all.length });
      }
    }
    totals.po_summary = Array.from(byPo.values());
    return totals;
  },
  recordPOUploadLog:    (payload)   => call("inet_app.api.command_center.record_po_upload_log", { payload: JSON.stringify(payload || {}) }),
  listPOUploadLogs:     (limit = 50) => call("inet_app.api.command_center.list_po_upload_logs", { limit }),
  getPOUploadLog:       (name)      => call("inet_app.api.command_center.get_po_upload_log", { name }),
  listPOIntakeLines:    (status, limit, portalFilters) => {
    const args = { status: status || "New", limit: limit == null ? null : limit };
    if (portalFilters && typeof portalFilters === "object" && Object.keys(portalFilters).length > 0) {
      args.portal_filters = JSON.stringify(portalFilters);
    }
    return call("inet_app.api.command_center.list_po_intake_lines", args);
  },
  dispatchPOLines:      (payload)   => call("inet_app.api.command_center.dispatch_po_lines", { payload: JSON.stringify(payload) }),
  convertDispatchMode:  (payload)   => call("inet_app.api.command_center.convert_dispatch_mode", { payload: JSON.stringify(payload) }),
  createRolloutPlans:   (payload)   => call("inet_app.api.command_center.create_rollout_plans", { payload: JSON.stringify(payload) }),
  updateExecution:      (payload)   => call("inet_app.api.command_center.update_execution", { payload: JSON.stringify(payload) }),
  generateWorkDone:     (execution_name) => call("inet_app.api.command_center.generate_work_done", { execution_name }),
  getFieldExecutionForRollout: (rollout_plan) =>
    call("inet_app.api.command_center.get_field_execution_for_rollout", { rollout_plan }),
  exportPODump: (from_date, to_date) =>
    call("inet_app.api.command_center.export_po_dump", {
      from_date: from_date || "",
      to_date: to_date || "",
    }),

  // ── Activity Cost Master ───────────────────────────────────
  listActivityCosts:    ()              => call("inet_app.api.command_center.list_activity_costs"),
  listExecutionMonitorRows: (filters, limit) =>
    call("inet_app.api.command_center.list_execution_monitor_rows", {
      filters: JSON.stringify(filters || {}),
      ...(limit != null ? { limit } : {}),
    }),
  listWorkDoneRows: (filters, limit) =>
    call("inet_app.api.command_center.list_work_done_rows", {
      filters: JSON.stringify(filters || {}),
      ...(limit != null ? { limit } : {}),
    }),
  listIssueRiskRows: (im, limit, search, portalFilters) => {
    const args = {
      im: im || "",
      ...(limit != null ? { limit } : {}),
      ...(search ? { search } : {}),
    };
    if (portalFilters && typeof portalFilters === "object" && Object.keys(portalFilters).length > 0) {
      args.portal_filters = JSON.stringify(portalFilters);
    }
    return call("inet_app.api.command_center.list_issue_risk_rows", args);
  },

  // ── Execution Time Log (field work time on rollout; not ERPNext Timesheet) ──
  startExecutionTimer:        (rollout_plan) =>
    call("inet_app.api.command_center.start_execution_timer", { rollout_plan }),
  stopExecutionTimer:         (log_name) =>
    call("inet_app.api.command_center.stop_execution_timer", { log_name }),
  getRunningExecutionTimer:   () =>
    call("inet_app.api.command_center.get_running_execution_timer"),
  listExecutionTimeLogs:      (filters, limit, offset) =>
    call("inet_app.api.command_center.list_execution_time_logs", {
      filters: JSON.stringify(filters || {}),
      limit: limit ?? 100,
      offset: offset ?? 0,
    }),
  saveExecutionTimeLogManual: (rollout_plan, start_time, end_time, notes) =>
    call("inet_app.api.command_center.save_execution_time_log_manual", {
      rollout_plan,
      start_time,
      end_time,
      notes: notes || "",
    }),

  // ── ERPNext Timesheet (legacy; avoid for portal) ───────────
  createTimesheet:      (payload) => call("inet_app.api.command_center.create_timesheet", { payload: JSON.stringify(payload) }),
  listTimesheets:       (filters) => call("inet_app.api.command_center.list_timesheets", { filters: JSON.stringify(filters || {}) }),
  approveTimesheet:     (name)    => call("inet_app.api.command_center.approve_timesheet", { name }),
  getTimesheetDetail:   (name)    => call("inet_app.api.command_center.get_timesheet_detail", { name }),
  getTablePreferences:  (table_id) => call("inet_app.api.command_center.get_table_preferences", { table_id }),
  getAllTablePreferences: () => call("inet_app.api.command_center.get_all_table_preferences"),
  assignIMTargetMonth: (payload) => call("inet_app.api.command_center.assign_im_target_month", { payload: JSON.stringify(payload || {}) }),
  updateWorkDoneSubmission: (name, submission_status) => call("inet_app.api.command_center.update_work_done_submission", { name, submission_status }),
  updateSubconSubmission: (po_dispatch, submission_status) => call("inet_app.api.command_center.update_subcon_submission", { po_dispatch, submission_status }),
  getDistinctFieldValues: (doctype, fields) =>
    callCached(
      "inet_app.api.command_center.get_distinct_field_values",
      { doctype, fields: JSON.stringify(fields || []) },
      300_000,
    ),
  saveTablePreferences: (table_id, config) =>
    call("inet_app.api.command_center.save_table_preferences", {
      table_id,
      config: JSON.stringify(config || {}),
    }),
  getTableFieldValues: (doctype, fieldname, names) =>
    call("inet_app.api.command_center.get_table_field_values", {
      doctype,
      fieldname,
      names: JSON.stringify(names || []),
    }),
  getDoctypeFields: (doctype) =>
    callCached("inet_app.api.command_center.get_doctype_fields", { doctype }, 300_000),

  // ── List APIs (Command Center doctypes) ────────────────────
  listINETTeams:     (filters) => call("frappe.client.get_list", { doctype: "INET Team", filters: filters || {}, fields: ["name", "team_id", "team_name", "im", "team_type", "team_category", "department", "status", "daily_cost", "isdp_account", "subcontractor", "field_user", "daily_cost_applies", "note"], limit_page_length: 100 }),
  getIMTeamDetail:   (name) => call("inet_app.api.command_center.get_im_team_detail", { name }),
  updateIMTeam:      (name, payload) => call("inet_app.api.command_center.update_im_team", { name, payload: JSON.stringify(payload || {}) }),
  listEmployeesForPicker: (search) => call("inet_app.api.command_center.list_employees_for_picker", { search: search || "", limit: 100 }),
  listFrappeUsers:   (search) => call("frappe.client.get_list", { doctype: "User", filters: search ? [["full_name", "like", `%${search}%`]] : [["enabled", "=", 1]], fields: ["name", "full_name", "email"], limit_page_length: 50, order_by: "full_name asc" }),
  listSubcontractors: () => call("frappe.client.get_list", { doctype: "Subcontractor Master", filters: {}, fields: ["name", "subcontractor_name"], limit_page_length: 100 }),
  // Generic helpers used by the Masters page (and anywhere else needing a
  // robust, CSRF-retrying frappe.client.get_list / get_count).
  genericList: (doctype, fields, limit, orderBy = "modified desc") =>
    call("frappe.client.get_list", {
      doctype,
      fields: fields && fields.length ? fields : ["name"],
      limit_page_length: Number(limit) > 0 ? Math.min(Number(limit), 10000) : 200,
      order_by: orderBy,
    }),
  genericCount: (doctype) => call("frappe.client.get_count", { doctype }),

  // POID-level remarks (general / manager / team_lead) — role-scoped
  getPoRemarks: (po_dispatch) => call("inet_app.api.command_center.get_po_remarks", { po_dispatch }),
  updatePoRemark: (po_dispatch, remark_type, value) => call("inet_app.api.command_center.update_po_remark", { po_dispatch, remark_type, value }),

  // Sub-Contract flow — IM-driven, lives outside the rollout chain
  getMySubconCapability: (im) => call("inet_app.api.command_center.get_my_subcon_capability", im ? { im } : {}),
  listSubconTeamsForPicker: (search) => call("inet_app.api.command_center.list_subcon_teams_for_picker", { search: search || "", limit: 200 }),
  assignSubcon: (po_dispatches, subcon_team, remark) => call("inet_app.api.command_center.assign_subcon", {
    po_dispatches: JSON.stringify(Array.isArray(po_dispatches) ? po_dispatches : [po_dispatches]),
    subcon_team,
    remark: remark || "",
  }),
  markSubconWorkDone: (po_dispatches, completed_on, remark) => call("inet_app.api.command_center.mark_subcon_work_done", {
    po_dispatches: JSON.stringify(Array.isArray(po_dispatches) ? po_dispatches : [po_dispatches]),
    completed_on: completed_on || "",
    remark: remark || "",
  }),
  listSubconDispatches: (params) => {
    const args = { ...(params || {}) };
    ["project_code", "site_code", "subcon_team"].forEach((k) => {
      if (Array.isArray(args[k])) args[k] = JSON.stringify(args[k]);
    });
    return call("inet_app.api.command_center.list_subcon_dispatches", args);
  },

  listPODispatches:  (filters, limitPageLength, portalFilters) => {
    const args = {
      filters: filters || {},
      order_by: "modified desc",
      limit_page_length: limitPageLength ?? 100,
    };
    if (portalFilters && typeof portalFilters === "object" && Object.keys(portalFilters).length > 0) {
      args.portal_filters = JSON.stringify(portalFilters);
    }
    return call("inet_app.api.command_center.list_po_dispatches", args);
  },
  getPODispatchStats: (filters, portalFilters) => {
    const args = { filters: filters || {} };
    if (portalFilters && typeof portalFilters === "object" && Object.keys(portalFilters).length > 0) {
      args.portal_filters = JSON.stringify(portalFilters);
    }
    return call("inet_app.api.command_center.get_po_dispatch_stats", args);
  },
  listRolloutPlans:  (filters) => call("frappe.client.get_list", { doctype: "Rollout Plan", filters: filters || {}, fields: ["*"], order_by: "plan_date desc", limit_page_length: 100 }),
  listProjectDomains:(filters) => call("frappe.client.get_list", { doctype: "Project Domain", filters: filters || { status: "Active" }, fields: ["name", "domain_name", "status"], order_by: "domain_name asc", limit_page_length: 100 }),
  listHuaweiIMs:     (filters) => call("frappe.client.get_list", { doctype: "Huawei IM", filters: filters || { status: "Active" }, fields: ["name", "full_name", "email", "phone"], order_by: "full_name asc", limit_page_length: 100 }),

  // ── Role Detection helpers ─────────────────────────────────
  getUserRoles:      (user)    => call("frappe.client.get_list", { doctype: "Has Role", filters: { parent: user, role: "System Manager" }, fields: ["role"], limit_page_length: 1 }),
  getTeamByIM:       (im)      => call("frappe.client.get_list", { doctype: "INET Team", filters: { im }, fields: ["team_id", "team_name", "im"], limit_page_length: 1 }),
  getTeamByMember:   (user)    => call("frappe.client.get_list", { doctype: "INET Team", filters: { status: "Active" }, fields: ["team_id", "team_name"], limit_page_length: 100 }),
};
