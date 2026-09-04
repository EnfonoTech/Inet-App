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
  reportMonthlyTeamDetails:      (f) => call("inet_app.api.project_management.report_monthly_team_details",      { filters: JSON.stringify(f || {}) }),
  reportDailyWorkProgressReport: (f) => call("inet_app.api.project_management.report_daily_work_progress_report", { filters: JSON.stringify(f || {}) }),
  reportTeamPlanningReport:       (f) => call("inet_app.api.command_center.get_team_report", { report_type: "planning",       from_date: f?.from_date, to_date: f?.to_date }),
  // Named "...Daily" to disambiguate from reportTeamUtilizationReport above —
  // two genuinely different reports (this one: get_team_report's "Planning /
  // Utilization / Implementation" family; that one: project_management's
  // Planned-vs-Actual report) that used to share the name only because one
  // was spelled "Utilisation".
  reportTeamUtilizationDaily:     (f) => call("inet_app.api.command_center.get_team_report", { report_type: "utilization",    from_date: f?.from_date, to_date: f?.to_date }),
  reportTeamImplementationReport: (f) => call("inet_app.api.command_center.get_team_report", { report_type: "implementation", from_date: f?.from_date, to_date: f?.to_date }),
  reportIMPerformance:            (f) => call("inet_app.api.command_center.get_im_performance_report",    { from_date: f?.from_date, to_date: f?.to_date }),
  reportProjectProfitability:     (f) => call("inet_app.api.command_center.get_project_profitability_report", { from_date: f?.from_date, to_date: f?.to_date }),
  reportProjectPerformance:       (f) => call("inet_app.api.command_center.get_project_performance_report", { from_date: f?.from_date, to_date: f?.to_date }),
  reportRolloutBurnDown:          (f) => call("inet_app.api.command_center.get_rollout_burn_down_report", { from_date: f?.from_date, to_date: f?.to_date }),
  reportTopTeams:                 (f) => call("inet_app.api.command_center.get_top_teams_report",         { from_date: f?.from_date, to_date: f?.to_date }),
  reportTeamPVA:                  (f) => call("inet_app.api.command_center.get_team_utilization_pva",    { from_date: f?.from_date, to_date: f?.to_date, team: JSON.stringify(f?.team || []) }),
  reportWeeklyPerformance:        (f) => call("inet_app.api.command_center.get_weekly_performance_report",   { from_date: f?.from_date, to_date: f?.to_date }),
  reportRevenueForecast:          ()  => call("inet_app.api.command_center.get_revenue_forecast_report",     {}),
  reportSiteSignStatus:           (f) => call("inet_app.api.material_management.report_site_sign_status",   { filters: JSON.stringify(f || {}) }),
  reportSiteVerifyStatus:         (f) => call("inet_app.api.material_management.report_site_verify_status", { filters: JSON.stringify(f || {}) }),
  reportBillWiseStatus:           (f) => call("inet_app.api.material_management.report_bill_wise_status",   { filters: JSON.stringify(f || {}) }),
  reportHuaweiOutboundAnalytics:  (f) => call("inet_app.api.material_management.report_huawei_outbound_analytics", { filters: JSON.stringify(f || {}) }),
  getHuaweiOutboundProjectDomainOptions: () => call("inet_app.api.material_management.get_huawei_outbound_project_domain_options"),

  // ── Command Center APIs ────────────────────────────────────
  getProjectSummary:    (projectCode) => call("inet_app.api.command_center.get_project_summary", { project_code: projectCode }),
  getCommandDashboard:  (args = {})  => call("inet_app.api.command_center.get_command_dashboard", { ...args, etag: args?.etag || "" }),
  // Daily team idle / project-domain grid (the report handed to the domains).
  getTeamDomainUtilization: (args = {}) => call("inet_app.api.command_center.get_team_domain_utilization", {
    month:           args?.month || "",
    domains:         args?.domains?.length ? JSON.stringify(args.domains) : "",
    include_fridays: args?.include_fridays ? 1 : 0,
    etag:            args?.etag || "",
  }),
  // Order book + invoicing KPIs for the Commercial dashboard. Money figures
  // come from the same computation as the PIC dashboard, so the two agree.
  getCommercialDashboard: (args = {}) => call("inet_app.api.command_center.get_commercial_dashboard", { etag: args?.etag || "" }),
  // PO published value vs invoiced value, monthly. `months` > 0 = trailing N
  // months (overrides from/to); otherwise from/to snap to whole months.
  getPoVsInvoiceTrend:  (args = {})  => call("inet_app.api.command_center.get_po_vs_invoice_trend", {
    from_date: args?.from_date || "",
    to_date:   args?.to_date   || "",
    months:    args?.months    ?? 0,
    etag:      args?.etag      || "",
  }),
  getIMDashboard:       (im, args = {}) => call("inet_app.api.command_center.get_im_dashboard", { im, ...args, etag: args?.etag || "" }),
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
  // `query` is the raw search box text — one or more DUID/POID/PO No values,
  // one per line (or comma/semicolon/tab-separated); the backend tokenizes
  // and matches every token against all three identifier fields.
  getDuidOverview:      (query) =>
    call("inet_app.api.command_center.get_duid_overview", { query: query || "" }),
  reopenRolloutForRevisit: (rolloutPlan, issueCategory, issueRemarks) =>
    call("inet_app.api.command_center.reopen_rollout_for_revisit", {
      rollout_plan: rolloutPlan,
      issue_category: issueCategory || "",
      issue_remarks: issueRemarks || "",
    }),
  rescheduleRolloutPlan: (rolloutPlan, newDate, reason, imNote, newEndDate) =>
    call("inet_app.api.command_center.reschedule_rollout_plan", {
      rollout_plan: rolloutPlan,
      new_date: newDate,
      reason,
      im_note: imNote || "",
      new_end_date: newEndDate || undefined,
    }),
  getRescheduleLogs: (rolloutPlan) =>
    call("inet_app.api.command_center.get_reschedule_logs", { rollout_plan: rolloutPlan }),
  extendPlanEndDate: (rolloutPlan, newEndDate, imNote) =>
    call("inet_app.api.command_center.extend_plan_end_date", {
      rollout_plan: rolloutPlan,
      new_end_date: newEndDate,
      im_note: imNote || "",
    }),
  markPlanNotAttended: (rolloutPlan, reason) =>
    call("inet_app.api.command_center.mark_plan_not_attended", {
      rollout_plan: rolloutPlan,
      reason: reason || "",
    }),
  searchPOItems: (query) =>
    call("inet_app.api.command_center.search_po_items", { query: query || "" }),
  createIMDummyPODispatch: (payload) =>
    call("inet_app.api.command_center.create_im_dummy_po_dispatch", {
      payload: JSON.stringify(payload || {}),
    }),
  updateIMDummyPODispatch: (payload) =>
    call("inet_app.api.command_center.update_im_dummy_po_dispatch", {
      payload: JSON.stringify(payload || {}),
    }),
  createInternalWork: (payload) =>
    call("inet_app.api.command_center.create_internal_work", {
      payload: JSON.stringify(payload || {}),
    }),
  markInternalWorkDone: (execution_name) =>
    call("inet_app.api.command_center.mark_internal_work_done", { execution_name }),
  searchInternalWorkItems: (query) =>
    call("inet_app.api.command_center.search_internal_work_items", { query: query || "" }),
  addInternalWorkItem: (item_name, description, activity_type) =>
    call("inet_app.api.command_center.add_internal_work_item", { item_name, description: description || "", activity_type: activity_type || "" }),
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
  previewPOArchiveFile: (file_url) => call("inet_app.api.command_center.preview_po_archive_file", { file_url }),
  startPOArchiveImport: (file_url, customer) => call("inet_app.api.command_center.start_po_archive_import", { file_url, customer }),
  getPOArchiveImportStatus: (log_name) => call("inet_app.api.command_center.get_po_archive_import_status", { log_name }),
  confirmPOUpload:      async (rows, onProgress) => {
    // Chunk upload to stay under Werkzeug max_form_memory_size (500 KB default)
    // and nginx client_max_body_size (1 MB default). 500 rows ≈ 200 KB JSON.
    // Backend groups by po_no and appends to existing PO Intake, so chunking is safe.
    const all = Array.isArray(rows) ? rows : [];
    if (all.length === 0) {
      return await call("inet_app.api.command_center.confirm_po_upload", { rows: JSON.stringify([]) });
    }
    const CHUNK = 500;
    const totals = {
      created: 0,
      lines_imported: 0,
      lines_skipped_duplicate: 0,
      lines_skipped_terminal: 0,
      lines_skipped_closed: 0,
      lines_skipped_cancelled: 0,
      terminal_dupe_samples: [],
      auto_dispatched: 0,
      names: [],
      po_summary: [],
    };
    // Merge per-PO rows across chunks (same po_no may appear in multiple chunks)
    const byPo = new Map();
    for (let i = 0; i < all.length; i += CHUNK) {
      const slice = all.slice(i, i + CHUNK);
      const r = await call("inet_app.api.command_center.confirm_po_upload", { rows: JSON.stringify(slice) });
      if (r) {
        totals.created += r.created || 0;
        totals.lines_imported += r.lines_imported || 0;
        totals.lines_skipped_duplicate += r.lines_skipped_duplicate || 0;
        totals.lines_skipped_terminal += r.lines_skipped_terminal || 0;
        totals.lines_skipped_closed += r.lines_skipped_closed || 0;
        totals.lines_skipped_cancelled += r.lines_skipped_cancelled || 0;
        if (Array.isArray(r.terminal_dupe_samples) && totals.terminal_dupe_samples.length < 30) {
          totals.terminal_dupe_samples.push(...r.terminal_dupe_samples.slice(0, 30 - totals.terminal_dupe_samples.length));
        }
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
  bulkAssignPODispatchIm: (payload) => call("inet_app.api.command_center.bulk_assign_po_dispatch_im", { payload: JSON.stringify(payload) }),
  checkWorkDoneForDispatches: (dispatch_names) => call("inet_app.api.command_center.check_work_done_for_dispatches", { dispatch_names: JSON.stringify(dispatch_names) }),
  createRolloutPlans:   (payload)   => call("inet_app.api.command_center.create_rollout_plans", { payload: JSON.stringify(payload) }),
  updateExecution:      (payload)   => call("inet_app.api.command_center.update_execution", { payload: JSON.stringify(payload) }),
  bulkUpdateExecutionField: (names, field, value) => call("inet_app.api.command_center.bulk_update_execution_field", { names: JSON.stringify(names), field, value }),
  generateWorkDone:     (execution_name, issue_flag) => call("inet_app.api.command_center.generate_work_done", { execution_name, issue_flag: issue_flag || "" }),
  getFieldExecutionForRollout: (rollout_plan) =>
    call("inet_app.api.command_center.get_field_execution_for_rollout", { rollout_plan }),
  getRolloutPlanDetails: (rollout_plan) =>
    call("inet_app.api.command_center.get_rollout_plan_details", { rollout_plan }),
  listDispatchVisits: (po_dispatch, rollout_plan) =>
    call("inet_app.api.command_center.list_dispatch_visits", {
      po_dispatch: po_dispatch || "",
      rollout_plan: rollout_plan || "",
    }),
  getDispatchPlanSummaries: (po_dispatches) =>
    call("inet_app.api.command_center.get_dispatch_plan_summaries", {
      po_dispatches: JSON.stringify(po_dispatches || []),
    }),
  getPoidDetailExtras: (po_dispatch) =>
    call("inet_app.api.command_center.get_poid_detail_extras", { po_dispatch }),
  listFieldTeamActionablePlans: (team_id) =>
    call("inet_app.api.command_center.list_field_team_actionable_plans", { team_id }),
  listFieldRemarkTemplates: () =>
    call("inet_app.api.command_center.list_field_remark_templates", {}),
  createFieldRemarkTemplate: (remark_text, category) =>
    call("inet_app.api.command_center.create_field_remark_template", { remark_text, category: category || "" }),
  bumpFieldRemarkTemplateUsage: (remark_texts) =>
    call("inet_app.api.command_center.bump_field_remark_template_usage", { remark_texts: JSON.stringify(remark_texts || []) }),
  exportPODump: (from_date, to_date, statuses, limit, search, columnFilters) => {
    const args = {
      from_date: from_date || "",
      to_date: to_date || "",
      statuses: JSON.stringify(Array.isArray(statuses) ? statuses : (statuses ? [statuses] : ["OPEN"])),
    };
    if (Number(limit) > 0) args.limit = Number(limit);
    if (search && search.trim()) args.search = search.trim();
    if (columnFilters && Object.keys(columnFilters).length > 0) args.column_filters = columnFilters;
    return call("inet_app.api.command_center.export_po_dump", args);
  },

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
  getWorkDoneSummary: () =>
    call("inet_app.api.command_center.get_work_done_summary"),
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
  getServerNow:               () =>
    call("inet_app.api.command_center.get_server_now"),
  saveRolloutPlanDocuments:   (rollout_plan, documents) =>
    call("inet_app.api.command_center.save_rollout_plan_documents", { rollout_plan, documents: JSON.stringify(documents) }),
  listExecutionTimeLogs:      (filters, limit, offset) =>
    call("inet_app.api.command_center.list_execution_time_logs", {
      filters: JSON.stringify(filters || {}),
      limit: limit ?? 100,
      offset: offset ?? 0,
    }),
  getTeamTimeTotals:          (filters) =>
    call("inet_app.api.command_center.get_team_time_totals", { filters: JSON.stringify(filters || {}) }),
  getDailyTimeTotals:         (filters) =>
    call("inet_app.api.command_center.get_daily_time_totals", { filters: JSON.stringify(filters || {}) }),
  getDuidTimeTotals:          (filters) =>
    call("inet_app.api.command_center.get_duid_time_totals", { filters: JSON.stringify(filters || {}) }),
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
  updateWorkDoneSubmission: (name, submission_status, note) => call("inet_app.api.command_center.update_work_done_submission", { name, submission_status, note }),
  submitMilestoneToPic: (work_done, milestone) => call("inet_app.api.command_center.submit_milestone_to_pic", { work_done, milestone }),
  // "Resubmit to PIC" tab — legacy lines whose work (and often original PIC
  // submission) already happened historically outside this system, so
  // there's no Work Done record for the IM to act through. Filtered
  // server-side (search/project/DUID/PO status/column filters), same as
  // list_work_done_rows — never filtered from an already-loaded batch.
  // limit: 0 = "All" (TABLE_ROW_LIMIT_ALL) — pass through as-is, don't
  // coerce to the 500 default with ||, which would silently cap "All".
  listLegacyMilestonesNeedingResubmission: (filters, limit) =>
    call("inet_app.api.command_center.list_legacy_milestones_needing_resubmission", {
      filters: JSON.stringify(filters || {}),
      limit: limit ?? 500,
    }),
  resubmitLegacyMilestoneToPic: (po_dispatch, milestone, note) => call("inet_app.api.command_center.resubmit_legacy_milestone_to_pic", { po_dispatch, milestone, note }),
  bulkResubmitLegacyMilestonesToPic: (payload) => call("inet_app.api.command_center.bulk_resubmit_legacy_milestones_to_pic", { payload: JSON.stringify(payload) }),
  updateWorkDoneIssue: (name, issue_flag) => call("inet_app.api.command_center.update_work_done_issue", { name, issue_flag }),
  updateSubconSubmission: (po_dispatch, submission_status, note) => call("inet_app.api.command_center.update_subcon_submission", { po_dispatch, submission_status, note }),
  getWorkDoneAttachments: (name) => call("inet_app.api.command_center.get_work_done_attachments", { name }),
  getWorkDoneAttachmentsByDispatch: (po_dispatch) => call("inet_app.api.pic.get_work_done_attachments_for_dispatch", { po_dispatch }),
  getDocAttachments: (doctype, docname) => call("frappe.client.get_list", {
    doctype: "File",
    filters: [["attached_to_doctype", "=", doctype], ["attached_to_name", "=", docname]],
    fields: ["name", "file_name", "file_url", "file_size", "is_private", "creation"],
    limit_page_length: 100,
    order_by: "creation asc",
  }),
  deleteAttachment: (fileName) => call("frappe.client.delete", { doctype: "File", name: fileName }),
  uploadDocAttachment: async (doctype, docname, file, attachedToField = "") => {
    const fd = new FormData();
    fd.append("file", file, file.name);
    fd.append("is_private", "0");
    fd.append("doctype", doctype);
    fd.append("docname", docname);
    fd.append("folder", "Home/Attachments");
    if (attachedToField) fd.append("fieldname", attachedToField);
    const res = await fetch("/api/method/upload_file", {
      method: "POST",
      credentials: "include",
      headers: { "X-Frappe-CSRF-Token": getCsrf() },
      body: fd,
    });
    const json = await res.json();
    if (!res.ok || json.exc) throw new Error(json.message || "Upload failed");
    return json.message;
  },
  uploadImAttachment: (po_dispatch, file, slot = "im_attachment") =>
    pmApi.uploadDocAttachment("PO Dispatch", po_dispatch, file, slot),
  attachDocLink: async (doctype, docname, fileUrl, fileName, attachedToField = "") => {
    const fd = new FormData();
    fd.append("file_url", fileUrl);
    if (fileName) fd.append("file_name", fileName);
    fd.append("is_private", "0");
    fd.append("doctype", doctype);
    fd.append("docname", docname);
    fd.append("folder", "Home/Attachments");
    if (attachedToField) fd.append("fieldname", attachedToField);
    const res = await fetch("/api/method/upload_file", {
      method: "POST",
      credentials: "include",
      headers: { "X-Frappe-CSRF-Token": getCsrf() },
      body: fd,
    });
    const json = await res.json();
    if (!res.ok || json.exc) throw new Error(json.message || "Failed to attach link");
    return json.message;
  },
  attachImLink: (po_dispatch, url, name, slot = "im_attachment") =>
    pmApi.attachDocLink("PO Dispatch", po_dispatch, url, name, slot),
  uploadFileGeneric: async (file) => {
    const fd = new FormData();
    fd.append("file", file, file.name);
    fd.append("is_private", "0");
    fd.append("folder", "Home/Attachments");
    const res = await fetch("/api/method/upload_file", {
      method: "POST",
      credentials: "include",
      headers: { "X-Frappe-CSRF-Token": getCsrf() },
      body: fd,
    });
    const json = await res.json();
    if (!res.ok || json.exc) throw new Error(json.message || "Upload failed");
    return json.message?.file_url || "";
  },
  bulkSubmitWorkDone: (payload) =>
    call("inet_app.api.command_center.bulk_submit_work_done", {
      payload: JSON.stringify(payload),
    }),
  uploadPicAttachment: (po_dispatch, file) =>
    pmApi.uploadDocAttachment("PO Dispatch", po_dispatch, file, "pic_attachment"),
  getPoDispatchImAttachments: (po_dispatch) =>
    call("inet_app.api.pic.get_po_dispatch_im_attachments", { po_dispatch }),
  getPoDispatchPicAttachments: (po_dispatch) =>
    call("inet_app.api.pic.get_po_dispatch_pic_attachments", { po_dispatch }),
  // milestone: "MS1" | "MS2". im is only needed/used to backfill PO Dispatch.im
  // on lines that have none — omit when not required. new_status overrides
  // the server's auto-picked rejected status ("Work Not Done" / "I-BUY
  // Rejected" / "ISDP Rejected") — omit/empty to let the server decide.
  rejectPicLine: (po_dispatches, milestone, remark, im, new_status) =>
    call("inet_app.api.pic.reject_pic_line", {
      po_dispatches: JSON.stringify(Array.isArray(po_dispatches) ? po_dispatches : [po_dispatches]),
      milestone: milestone || "MS1",
      remark,
      im: im || "",
      new_status: new_status || "",
    }),
  getTeamOptions: () =>
    callCached("inet_app.api.command_center.get_team_options", {}, 300_000),
  getBackendTeamOptions: () =>
    callCached("inet_app.api.command_center.get_backend_team_options", {}, 300_000),
  getDistinctFieldValues: (doctype, fields) =>
    callCached(
      "inet_app.api.command_center.get_distinct_field_values",
      { doctype, fields: JSON.stringify(fields || []) },
      300_000,
    ),
  // Excel-style column filter options for any registered backend source
  // (see EXCEL_OPTION_SOURCES in command_center.py). Deliberately NOT
  // callCached: the list cascades off the page's other active filters, so a
  // client cache would show values that are no longer valid. The server
  // caches it for 60s instead, keyed on the same inputs plus the user.
  // Headline figures for a page, aggregated over the full filtered set — see
  // PageSummary.jsx. `source` is the same registry key column options use.
  getPageSummary: ({ source, portal_filters, extra }) =>
    call("inet_app.api.command_center.get_page_summary", {
      source,
      portal_filters: JSON.stringify(portal_filters || {}),
      extra: JSON.stringify(extra || {}),
    }),

  getColumnFilterOptions: ({ source, col_key, bucket, filters, portal_filters,
                             exclude_column, search, limit, extra }) =>
    call("inet_app.api.command_center.get_column_filter_options", {
      source,
      col_key,
      bucket: bucket || "",
      filters: JSON.stringify(filters || {}),
      portal_filters: JSON.stringify(portal_filters || {}),
      exclude_column: exclude_column || "",
      search: search || "",
      limit: limit || 500,
      extra: JSON.stringify(extra || {}),
    }),
  // Excel-style column filter options. Deliberately NOT callCached: the list
  // cascades off the page's other active filters, which are part of the
  // input, so a cached response would show values that are no longer valid.
  getPoDispatchColumnOptions: ({ col_key, bucket, filters, portal_filters, exclude_column, search, limit }) =>
    call("inet_app.api.command_center.get_po_dispatch_column_options", {
      col_key,
      bucket: bucket || "",
      filters: JSON.stringify(filters || {}),
      portal_filters: JSON.stringify(portal_filters || {}),
      exclude_column: exclude_column || "",
      search: search || "",
      limit: limit || 500,
    }),
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
  listINETTeams:     (filters) => call("frappe.client.get_list", { doctype: "INET Team", filters: filters || {}, fields: ["name", "team_id", "team_name", "im", "team_type", "team_category", "department", "status", "daily_cost", "isdp_account", "subcontractor", "field_user", "daily_cost_applies", "note"], limit_page_length: 500 }),
  getIMTeamDetail:   (name) => call("inet_app.api.command_center.get_im_team_detail", { name }),
  // Team Allocation Request — IM-to-IM transfer with PM approval.
  requestTeamAllocation: (team, reason)        => call("inet_app.api.command_center.request_team_allocation", { team, reason: reason || "" }),
  respondTeamAllocation: (request, action, remark) => call("inet_app.api.command_center.respond_team_allocation", { request, action, remark: remark || "" }),
  pmDecideTeamAllocation: (request, action, remark) => call("inet_app.api.command_center.pm_decide_team_allocation", { request, action, remark: remark || "" }),
  cancelTeamAllocation:  (request)            => call("inet_app.api.command_center.cancel_team_allocation", { request }),
  listTeamAllocationRequests: (scope, status) => call("inet_app.api.command_center.list_team_allocation_requests", { scope: scope || "all", status: status || "" }),
  // PO Transfer Request — IM requests batch transfer of Intake-tab POIDs to another IM, one PM approval covers the whole batch.
  requestPoTransfer: (poDispatches, toIm, reason) => call("inet_app.api.command_center.request_po_transfer", {
    po_dispatches: JSON.stringify(Array.isArray(poDispatches) ? poDispatches : [poDispatches]),
    to_im: toIm, reason: reason || "",
  }),
  pmDecidePoTransfer: (request, action, remark) => call("inet_app.api.command_center.pm_decide_po_transfer", { request, action, remark: remark || "" }),
  cancelPoTransfer:   (request) => call("inet_app.api.command_center.cancel_po_transfer", { request }),
  listPoTransferRequests: (scope, status) => call("inet_app.api.command_center.list_po_transfer_requests", { scope: scope || "all", status: status || "" }),
  listMyPendingPoTransferPoids: () => call("inet_app.api.command_center.list_my_pending_po_transfer_poids", {}),
  listIMMastersForTransferPicker: (search) => call("inet_app.api.command_center.list_im_masters_for_transfer_picker", { search: search || "", limit: 200 }),
  // Data Integrity (PM/Admin) — categories: "completed_no_evidence", "closed_unresolved_milestone"
  listDataIntegrityIssues: (category) => call("inet_app.api.command_center.list_data_integrity_issues", { category }),
  fixDataIntegrityCompletedNoEvidence: (po_dispatches) => call("inet_app.api.command_center.fix_data_integrity_completed_no_evidence", {
    po_dispatches: JSON.stringify(po_dispatches),
  }),
  fixDataIntegrityReopenClosed: (po_dispatches) => call("inet_app.api.command_center.fix_data_integrity_reopen_closed", {
    po_dispatches: JSON.stringify(po_dispatches),
  }),
  // Plan Cancel Request — IM requests PM approval to cancel a Rollout Plan.
  requestCancelPlan:  (rolloutPlan, reason) => call("inet_app.api.command_center.request_cancel_plan", { rollout_plan: rolloutPlan, reason: reason || "" }),
  pmDecideCancelPlan: (rolloutPlan, action, remark) => call("inet_app.api.command_center.pm_decide_cancel_plan", { rollout_plan: rolloutPlan, action, remark: remark || "" }),
  listPendingCancelRequests: (status) => call("inet_app.api.command_center.list_pending_cancel_requests", { status: status || "" }),
  listAllCancelRequests: () => call("inet_app.api.command_center.list_pending_cancel_requests", {}),
  updateIMTeam:      (name, payload) => call("inet_app.api.command_center.update_im_team", { name, payload: JSON.stringify(payload || {}) }),
  listAdminTeams:    (filters) => call("inet_app.api.command_center.list_admin_teams", filters || {}),
  listImTeams:       (filters) => call("inet_app.api.command_center.list_im_teams", filters || {}),
  adminGetTeamDetail: (name) => call("inet_app.api.command_center.admin_get_team_detail", { name }),
  adminUpdateTeam:   (name, payload) => call("inet_app.api.command_center.admin_update_team", { name, payload: JSON.stringify(payload || {}) }),
  adminListEmployeesForPicker: (search) => call("inet_app.api.command_center.admin_list_employees_for_picker", { search: search || "", limit: 100 }),
  listIMsForPicker:  (search) => call("inet_app.api.command_center.list_im_masters_for_picker", { search: search || "", limit: 200 }),
  listEmployeesForPicker: (search) => call("inet_app.api.command_center.list_employees_for_picker", { search: search || "", limit: 100 }),
  listFrappeUsers:   (search) => call("frappe.client.get_list", { doctype: "User", filters: search ? [["full_name", "like", `%${search}%`]] : [["enabled", "=", 1]], fields: ["name", "full_name", "email"], limit_page_length: 50, order_by: "full_name asc" }),
  listSubcontractors: () => call("frappe.client.get_list", { doctype: "Subcontract Master", filters: {}, fields: ["name", "subcontractor_name"], limit_page_length: 100 }),
  // Generic helpers used by the Masters page (and anywhere else needing a
  // robust, CSRF-retrying frappe.client.get_list / get_count).
  genericList: (doctype, fields, limit, orderBy = "modified desc") =>
    call("frappe.client.get_list", {
      doctype,
      fields: fields && fields.length ? fields : ["name"],
      limit_page_length: Number(limit) > 0 ? Math.min(Number(limit), 10000) : 200,
      order_by: orderBy,
    }),
  genericListFiltered: (doctype, fields, filters, limit) =>
    call("frappe.client.get_list", {
      doctype,
      fields: fields && fields.length ? fields : ["name"],
      filters: filters || {},
      limit_page_length: Number(limit) > 0 ? Math.min(Number(limit), 10000) : 500,
    }),
  // Same as genericList, but narrows the FULL dataset server-side before the
  // row limit is applied — used by the Masters page so its search box and
  // per-column dropdown filters don't just filter whatever small batch
  // happened to load. `search` is OR'd (LIKE) across `searchFields`;
  // `colFilters` is a { field: exactValue } map AND'd together (exact match,
  // since those values come from a dropdown of known distinct values, not
  // free text).
  genericListSearch: (doctype, fields, limit, { search, searchFields, colFilters, orderBy = "modified desc" } = {}) => {
    const args = {
      doctype,
      fields: fields && fields.length ? fields : ["name"],
      limit_page_length: Number(limit) > 0 ? Math.min(Number(limit), 10000) : 200,
      order_by: orderBy,
    };
    const term = (search || "").trim();
    if (term && Array.isArray(searchFields) && searchFields.length) {
      args.or_filters = searchFields.map((f) => [f, "like", `%${term}%`]);
    }
    const activeColFilters = Object.entries(colFilters || {}).filter(([, v]) => v);
    if (activeColFilters.length) {
      args.filters = activeColFilters.map(([f, v]) => [f, "=", v]);
    }
    return call("frappe.client.get_list", args);
  },
  getItemCodesForProject: (project_code) =>
    call("inet_app.api.command_center.get_item_codes_for_project", { project_code }),
  genericCount: (doctype) => call("frappe.client.get_count", { doctype }),

  // POID-level remarks (general / manager / team_lead) — role-scoped
  getPoRemarks: (po_dispatch) => call("inet_app.api.command_center.get_po_remarks", { po_dispatch }),
  updatePoRemark: (po_dispatch, remark_type, value) => call("inet_app.api.command_center.update_po_remark", { po_dispatch, remark_type, value }),

  // PIC (Project Invoice Controller) endpoints
  picInvoicingSummary: (portalFilters) => call("inet_app.api.pic.pic_invoicing_summary", {
    portal_filters: JSON.stringify(portalFilters || {}),
  }),
  // Pipeline stage counts (Pending / Tracker / Closed / Cancelled) under an
  // arbitrary project/date scope — same portal_filters shape as above.
  getPicStageCounts: (portalFilters) => call("inet_app.api.pic.get_pic_stage_counts", {
    portal_filters: JSON.stringify(portalFilters || {}),
  }),
  getPicSummaryFilterOptions: () => call("inet_app.api.pic.get_pic_summary_filter_options"),
  // "Payment Ledger" tab: month-grain summary (always loaded) + lazy
  // itemized detail per month (fetched only when that month is expanded).
  picPaymentLedgerSummary: () => call("inet_app.api.pic.pic_payment_ledger_summary"),
  picPaymentLedgerMonthDetail: (yearMonth) => call("inet_app.api.pic.pic_payment_ledger_month_detail", {
    year_month: yearMonth,
  }),
  // stage: "pending" | "active" | "cancelled" — required. Backs the 3 PIC
  // pages (Pending / PIC Tracker / Cancelled); see list_pic_rows in pic.py.
  listPicRows: (stage, portalFilters, limit) => call("inet_app.api.pic.list_pic_rows", {
    stage,
    portal_filters: JSON.stringify(portalFilters || {}),
    // 0 = "All" (no LIMIT). Anything else is a positive cap.
    limit: Number.isFinite(Number(limit)) ? Number(limit) : 500,
  }),
  // Row-level Invoice Detail report — mirrors the historical "Invoices Data"
  // Excel import 1:1; see list_invoice_detail_rows in pic.py.
  listInvoiceDetailRows: (portalFilters, limit) => call("inet_app.api.pic.list_invoice_detail_rows", {
    portal_filters: JSON.stringify(portalFilters || {}),
    limit: Number.isFinite(Number(limit)) ? Number(limit) : 500,
  }),
  runLegacyInvoiceImport: () => call("inet_app.api.pic.run_legacy_invoice_import"),
  getLegacyInvoiceImportStatus: () => call("inet_app.api.pic.get_legacy_invoice_import_status"),
  updatePicRow: (po_dispatch, fields) => call("inet_app.api.pic.update_pic_row", {
    po_dispatch,
    fields: JSON.stringify(fields || {}),
  }),
  bulkUpdatePicStatus: (po_dispatches, pic_status, milestone, remark, applied_date) => call("inet_app.api.pic.bulk_update_pic_status", {
    po_dispatches: JSON.stringify(Array.isArray(po_dispatches) ? po_dispatches : [po_dispatches]),
    pic_status,
    milestone: milestone || "MS1",
    remark: remark || "",
    applied_date: applied_date || "",
  }),
  getPicDashboard: (from_date, to_date, etag) => call("inet_app.api.pic.get_pic_dashboard", {
    from_date: from_date || "",
    to_date: to_date || "",
    etag: etag || "",
  }),
  // Rollout Planning weekly dashboard — one call feeds the plan grid, the
  // status tiles, the activity split, team workload and the day calendar.
  getRolloutWeekDashboard: ({ im, week_start, portal_filters }) =>
    call("inet_app.api.command_center.get_rollout_week_dashboard", {
      im: im || "",
      week_start: week_start || "",
      portal_filters: JSON.stringify(portal_filters || {}),
    }),
  getRolloutFiscalQuarter: (day) =>
    call("inet_app.api.command_center.get_rollout_fiscal_quarter", { day: day || "" }),

  getRolloutCommercialSummary: ({ im, from_date, to_date, project_code, filter_im }) =>
    call("inet_app.api.command_center.get_rollout_commercial_summary", {
      im: im || "",
      from_date: from_date || "",
      to_date: to_date || "",
      project_code: project_code && project_code.length ? JSON.stringify(project_code) : "",
      // Narrows within the session's scope — the PM's toolbar IM filter.
      filter_im: filter_im && filter_im.length ? JSON.stringify(filter_im) : "",
    }),

  getPicReport: (kind, params) => call("inet_app.api.pic.get_pic_report", {
    kind: kind || "pipeline",
    from_date: params?.from_date || "",
    to_date: params?.to_date || "",
    project_code: params?.project_code || "",
    owner: params?.owner || "",
    // 0 = unlimited. Omitted -> the backend's own default cap.
    limit: params?.limit ?? "",
  }),

  // PIC creates Sales Invoices from Ready for Invoice lines (PIC Tracker page)
  createSalesInvoiceFromPic: (poDispatch, milestone) => call("inet_app.api.pic.create_sales_invoice_from_pic", {
    po_dispatch: poDispatch,
    // null/undefined → server auto-detects the Ready milestone per line
    milestone: milestone || null,
  }),

  // Subcon PO — the supplier side of PIC (subcon_po.py). Mirrors the PIC
  // endpoints above: same shapes, purchase documents instead of sales.
  // stage: "to_order" | "ordered" | "invoiced" | "closed" | "cancelled" | "all"
  // — the tabs of the Subcon PO page. Unlike listPicRows the stages OVERLAP:
  // a line with MS1 paid and MS2 unordered is in both "closed" and
  // "to_order", so use row.can_order_ms1 / can_order_ms2 to know which
  // milestone an action applies to rather than assuming MS1.
  listSubconPoRows: (stage, portalFilters, limit) => call("inet_app.api.subcon_po.list_subcon_po_rows", {
    stage: stage || "to_order",
    portal_filters: JSON.stringify(portalFilters || {}),
    // 0 = "All" (no LIMIT). Anything else is a positive cap.
    limit: Number.isFinite(Number(limit)) ? Number(limit) : 500,
  }),
  getSubconPoFilterOptions: () => call("inet_app.api.subcon_po.get_subcon_po_filter_options"),
  getSubconPoCapability: () => call("inet_app.api.subcon_po.get_subcon_po_capability"),
  // One draft Purchase Order per supplier. milestone null → every unordered
  // milestone with an amount. Status advances to "PO Submitted" only when the
  // PO is actually submitted (server hook), never here.
  createPurchaseOrderFromPic: (poDispatch, milestone) => call("inet_app.api.subcon_po.create_purchase_order_from_pic", {
    po_dispatch: JSON.stringify(Array.isArray(poDispatch) ? poDispatch : [poDispatch]),
    milestone: milestone || null,
  }),
  // POs + PIs behind one PIC line, with the supplier bill reference and the
  // invoice attachments — the list CSV can't carry those.
  getSubconLineDocuments: (poDispatch) => call("inet_app.api.subcon_po.get_subcon_line_documents", {
    po_dispatch: poDispatch,
  }),
  // Header + lines of one supplier PO, read from the document (so it carries
  // VAT, which the list rows don't) for the Receive Invoice screen.
  getPurchaseOrderSummary: (purchaseOrder) => call("inet_app.api.subcon_po.get_purchase_order_summary", {
    purchase_order: purchaseOrder,
  }),
  // Records the sub's bill: creates the draft Purchase Invoice AND moves the
  // covered milestones to "Invoice Received". Returns attach_to_doctype /
  // attach_to_name so the caller can upload the invoice file onto the PI.
  // poDispatches limits the invoice to those PIC lines of the PO — the sub
  // bills a PO in instalments, so this is the normal case. Legs already on a
  // live invoice are dropped server-side, so it can't double-bill.
  receiveSupplierInvoice: (purchaseOrder, poDispatches, billNo, billDate) => call("inet_app.api.subcon_po.receive_supplier_invoice", {
    purchase_order: purchaseOrder,
    ...(poDispatches && poDispatches.length
      ? { po_dispatches: JSON.stringify(poDispatches) } : {}),
    bill_no: billNo || "",
    bill_date: billDate || "",
  }),
  // milestone: "MS1" | "MS2" | "BOTH" (every milestone with an amount) |
  // "AUTO" (every milestone whose current status is in fromStatuses — what the
  // tab-specific actions use, so PIC never picks a leg by hand).
  // fromStatuses also guards the explicit modes; omit for a free-form fix.
  // "" as status resets a milestone to Not Ordered, making it orderable again.
  bulkUpdateSubconPoStatus: (poDispatches, status, milestone, date, remark, fromStatuses) => call("inet_app.api.subcon_po.bulk_update_subcon_po_status", {
    po_dispatches: JSON.stringify(Array.isArray(poDispatches) ? poDispatches : [poDispatches]),
    status: status ?? "",
    milestone: milestone || "MS1",
    date: date || "",
    remark: remark || "",
    ...(fromStatuses ? { from_statuses: JSON.stringify(fromStatuses) } : {}),
  }),
  subconPayoutSummary: (portalFilters) => call("inet_app.api.subcon_po.subcon_payout_summary", {
    portal_filters: JSON.stringify(portalFilters || {}),
  }),

  // Backend-team assignment flow — IM-driven, lives outside the rollout chain
  getMyBackendCapability: (im) => call("inet_app.api.command_center.get_my_backend_capability", im ? { im } : {}),
  getMyDirectCloseCapability: () => call("inet_app.api.command_center.get_my_direct_close_capability", {}),
  getMyRecordExecutionCapability: (im) => call("inet_app.api.command_center.get_my_record_execution_capability", im ? { im } : {}),
  getSubcontractorsByType: (close_type) => call("inet_app.api.command_center.get_subcontractors_by_type", { close_type }),
  directCloseDispatches: (po_dispatches, close_type, subcontractor, note, milestone, overrides) => call("inet_app.api.command_center.direct_close_dispatches", {
    po_dispatches: JSON.stringify(Array.isArray(po_dispatches) ? po_dispatches : [po_dispatches]),
    close_type,
    subcontractor: subcontractor || "",
    note: note || "",
    milestone: milestone || "",
    huawei_im: overrides?.huawei_im || "",
    project_domain: overrides?.project_domain || "",
  }),
  listBackendTeamsForPicker: (search) => call("inet_app.api.command_center.list_backend_teams_for_picker", { search: search || "", limit: 200 }),
  assignBackend: (po_dispatches, backend_team, remark, overrides) => call("inet_app.api.command_center.assign_backend", {
    po_dispatches: JSON.stringify(Array.isArray(po_dispatches) ? po_dispatches : [po_dispatches]),
    backend_team: backend_team,
    remark: remark || "",
    huawei_im: overrides?.huawei_im || "",
    project_domain: overrides?.project_domain || "",
  }),
  markBackendWorkDone: (po_dispatches, completed_on, remark) => call("inet_app.api.command_center.mark_backend_work_done", {
    po_dispatches: JSON.stringify(Array.isArray(po_dispatches) ? po_dispatches : [po_dispatches]),
    completed_on: completed_on || "",
    remark: remark || "",
  }),
  listBackendDispatches: (params) => {
    const args = { ...(params || {}) };
    // The PO Dispatch column itself stays backend_team (vendor-side concept);
    // we just renamed the user-facing terminology.
    ["project_code", "site_code", "backend_team"].forEach((k) => {
      if (Array.isArray(args[k])) args[k] = JSON.stringify(args[k]);
    });
    return call("inet_app.api.command_center.list_backend_dispatches", args);
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
  listActivityTypes: () => call("frappe.client.get_list", { doctype: "Activity Type", filters: { disabled: 0 }, fields: ["name"], order_by: "name asc", limit_page_length: 100 }),
  listHuaweiIMs:     (filters) => call("frappe.client.get_list", { doctype: "Huawei IM", filters: filters || { status: "Active" }, fields: ["name", "full_name", "email", "phone"], order_by: "full_name asc", limit_page_length: 100 }),
  listISDPOwners:    () => call("frappe.client.get_list", { doctype: "ISDP Owner", filters: { status: "Active" }, fields: ["name", "owner_name"], order_by: "owner_name asc", limit_page_length: 200 }),
  listIBuyOwners:    () => call("frappe.client.get_list", { doctype: "IBuy Owner", filters: { status: "Active" }, fields: ["name", "owner_name"], order_by: "owner_name asc", limit_page_length: 200 }),
  createISDPOwner:   (owner_name) => call("frappe.client.insert", { doc: { doctype: "ISDP Owner", owner_name, status: "Active" } }),
  createIBuyOwner:   (owner_name) => call("frappe.client.insert", { doc: { doctype: "IBuy Owner", owner_name, status: "Active" } }),

  // ── Role Detection helpers ─────────────────────────────────
  getUserRoles:      (user)    => call("frappe.client.get_list", { doctype: "Has Role", filters: { parent: user, role: "System Manager" }, fields: ["role"], limit_page_length: 1 }),
  getTeamByIM:       (im)      => call("frappe.client.get_list", { doctype: "INET Team", filters: { im }, fields: ["team_id", "team_name", "im"], limit_page_length: 1 }),
  getTeamByMember:   (user)    => call("frappe.client.get_list", { doctype: "INET Team", filters: { status: "Active" }, fields: ["team_id", "team_name"], limit_page_length: 100 }),

  // ── Material Request (INET) ────────────────────────────────
  listMaterialRequests:    (args)   => call("inet_app.api.material_management.list_material_requests", args || {}),
  getMaterialRequest:      (name)   => call("inet_app.api.material_management.get_material_request", { name }),
  getPoidDetails:          (poid)   => call("inet_app.api.material_management.get_poid_details", { poid }),
  getSourceWarehouse:      ()       => call("inet_app.api.material_management.get_source_warehouse", {}),
  getImTeams:              (im)     => call("inet_app.api.material_management.get_im_teams", im ? { im } : {}),
  searchPoDispatches:      (args)   => call("inet_app.api.material_management.search_po_dispatches", args || {}),
  searchDuids:             (args)   => call("inet_app.api.material_management.search_duids", args || {}),
  getDuidStockSummary:     (o)      => call("inet_app.api.material_management.get_duid_stock_summary", { column_filters: JSON.stringify(o?.column_filters || {}), limit: o?.limit ?? 0 }),
  getDuidReceivedItems:    (duid)   => call("inet_app.api.material_management.get_duid_received_items", { duid }),
  getDuidBillMaterials:    (duid)   => call("inet_app.api.material_management.get_duid_bill_materials", { duid }),
  searchItems:             (args)   => call("inet_app.api.material_management.search_items", args || {}),
  createMaterialRequest:   (payload) => call("inet_app.api.material_management.create_material_request", { payload: JSON.stringify(payload) }),
  approveMaterialRequest:  (name)   => call("inet_app.api.material_management.approve_material_request", { name }),
  rejectMaterialRequest:   (name, reason) => call("inet_app.api.material_management.reject_material_request", { name, reason: reason || "" }),
  confirmMaterialTransfer: (name)   => call("inet_app.api.material_management.confirm_material_transfer", { name }),
  rejectMaterialTransferConfirmation: (name, reason) => call("inet_app.api.material_management.reject_material_transfer_confirmation", { name, reason: reason || "" }),
  listPendingTeamConfirmations: ()  => call("inet_app.api.material_management.list_pending_team_confirmations", {}),
  listTeamRequestsAwaitingApproval: () => call("inet_app.api.material_management.list_team_requests_awaiting_approval", {}),
  getAvailableStock:       (item_code, warehouse)  => call("inet_app.api.material_management.get_available_stock", { item_code, ...(warehouse ? { warehouse } : {}) }),
  getPoidMaterials:        (po_dispatch)           => call("inet_app.api.material_management.get_poid_materials", { po_dispatch }),
  getExecutionMaterialUsage: (execution)            => call("inet_app.api.material_management.get_execution_material_usage", { execution }),
  getDuidHuaweiAvailability: (duid, team_id)        => call("inet_app.api.material_management.get_duid_huawei_availability", { duid, ...(team_id ? { team_id } : {}) }),
  getTeamMaterialStock:    (team_id)               => call("inet_app.api.material_management.get_team_material_stock", team_id ? { team_id } : {}),
  getMainWarehouseStock:   ()                      => call("inet_app.api.material_management.get_main_warehouse_stock", {}),
  getDuidStockBalance:     (o)                     => call("inet_app.api.material_management.get_duid_stock_balance", { column_filters: JSON.stringify(o?.column_filters || {}), limit: o?.limit ?? 0 }),
  getBillWiseMaterial:     (o)                     => call("inet_app.api.material_management.get_bill_wise_material", { filters: JSON.stringify(o?.filters || {}), column_filters: JSON.stringify(o?.column_filters || {}), limit: o?.limit ?? 0 }),
  getBillCandidates:       (item_code, duid, warehouse) => call("inet_app.api.material_management.get_bill_candidates", { item_code, duid, warehouse }),
  getBillCandidatesBulk:   (item_codes, duid, opts)     => call("inet_app.api.material_management.get_bill_candidates_bulk", { item_codes: JSON.stringify(item_codes || []), duid, ...(opts || {}) }),
  // ── Material Return Flow ────────────────────────────────────
  createReturnRequest:     (payload) => call("inet_app.api.material_management.create_material_return_request", { payload: JSON.stringify(payload) }),
  listReturnRequests:      (args)    => call("inet_app.api.material_management.list_return_requests", args || {}),
  getReturnBillCandidates: (name)    => call("inet_app.api.material_management.get_return_bill_candidates", { name }),
  approveReturnRequest:    (name, preferred_batches)    => call("inet_app.api.material_management.approve_material_return_request", { name, ...(preferred_batches ? { preferred_batches: JSON.stringify(preferred_batches) } : {}) }),
  rejectReturnRequest:     (name, reason) => call("inet_app.api.material_management.reject_material_request", { name, reason: reason || "" }),
  confirmMaterialReturn:   (name)    => call("inet_app.api.material_management.confirm_material_return", { name }),
  rejectMaterialReturnConfirmation: (name, reason) => call("inet_app.api.material_management.reject_material_return_confirmation", { name, reason: reason || "" }),
  createDirectReturn:      (payload) => call("inet_app.api.material_management.create_direct_return_transfer", { payload: JSON.stringify(payload) }),

  // ── Project Expense Claims ─────────────────────────────────
  getFieldUserTeam:        ()             => call("inet_app.api.expense.get_field_user_team"),
  getExpenseClaimTypes:    ()             => callCached("inet_app.api.expense.get_expense_claim_types", {}, 300_000),
  getAvailableDuids:       (team)         => call("inet_app.api.expense.get_available_duids", team ? { team } : {}),
  getAvailableProjects:    (team)         => call("inet_app.api.expense.get_available_projects", team ? { team } : {}),
  createProjectExpenseClaim: (payload)   => call("inet_app.api.expense.create_project_expense_claim", {
    date: payload.date || "",
    remarks: payload.remarks || "",
    inet_team: payload.inet_team || "",
    expense_lines: JSON.stringify(payload.expense_lines || []),
    attachments: JSON.stringify(payload.attachments || []),
  }),
  getExpenseTaxInfo:       ()             => callCached("inet_app.api.expense.get_expense_tax_info", {}, 300_000),
  // `limit` here is deliberately narrow: only 0 ("All") is ever passed
  // through (see IMExpense.jsx/FieldExpense.jsx) — it removes each
  // endpoint's hardcoded row cap. Any other value is ignored server-side, so
  // don't wire the other row-limit presets here; see the "Row-limit filter"
  // note in CLAUDE.md for why (tab-count badges are derived from this same
  // fetch and would silently undercount).
  listMyExpenseClaims:     (limit)        => call("inet_app.api.expense.list_my_expense_claims", limit === 0 ? { limit: 0 } : {}),
  listPendingExpenseApprovals: (columnFilters, limit) => call("inet_app.api.expense.list_pending_expense_approvals", { ...(columnFilters && Object.keys(columnFilters).length ? { column_filters: columnFilters } : {}), ...(limit === 0 ? { limit: 0 } : {}) }),
  listImAllClaims:             (columnFilters, limit) => call("inet_app.api.expense.list_im_all_claims", { ...(columnFilters && Object.keys(columnFilters).length ? { column_filters: columnFilters } : {}), ...(limit === 0 ? { limit: 0 } : {}) }),
  listAllExpenseClaims:    (filters, limit) => call("inet_app.api.expense.list_all_expense_claims", { filters: JSON.stringify(filters || {}), ...(limit === 0 ? { limit: 0 } : {}) }),
  getExpenseClaimDetail:   (claim_name)   => call("inet_app.api.expense.get_expense_claim_detail", { claim_name }),
  approveExpenseClaim:     (claim_name)   => call("inet_app.api.expense.approve_expense_claim", { claim_name }),
  rejectExpenseClaim:      (claim_name, reason) => call("inet_app.api.expense.reject_expense_claim", { claim_name, reason: reason || "" }),
  getImListForFilter:      ()             => callCached("inet_app.api.expense.get_im_list_for_filter", {}, 300_000),
  getTeamsForFilter:       (im_user)      => call("inet_app.api.expense.get_teams_for_filter", im_user ? { im_user } : {}),

  // ── Notifications ──────────────────────────────────────────
  getNotifications: (limit = 50) =>
    call("inet_app.api.notifications.get_my_notifications", { limit }),
  markNotificationRead: (name) =>
    call("inet_app.api.notifications.mark_notification_read", { name }),
  markAllNotificationsRead: () =>
    call("inet_app.api.notifications.mark_all_notifications_read", {}),
};

// NOTE: the INET HR Certificate Tracker is a standalone page
// (inet_app/inet_app/www/hr-certificates.html), separate from this PMS
// portal in UI/UX and access control — it calls inet_app.api.hr_certificates
// directly with its own fetch() helper, not through pmApi/this file.
