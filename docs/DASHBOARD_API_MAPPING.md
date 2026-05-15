# Dashboard API Logic Mapping

Each new dashboard card/chart maps to a real backend API. No dummy data.

## Shared API: `get_command_dashboard` (`command_center.py:5675`)

Returns all admin-level operational + financial KPIs in one call.

| Field | Type | Used By |
|-------|------|---------|
| `operational.total_open_po_lines` | count | CEO, Ops |
| `operational.total_open_po_line_value` | SAR | CEO, Financial |
| `operational.idle_teams` | count | Ops |
| `operational.planned_amount` / `planned_activities` | SAR/count | Ops |
| `operational.closed_amount` / `closed_activities` | SAR/count | Ops |
| `operational.revisits` | count | Ops |
| `inet.active_inet_teams` | count | Ops |
| `inet.inet_monthly_cost` | SAR | Financial |
| `inet.inet_monthly_target` | SAR | Financial |
| `inet.inet_target_today` | SAR | Ops |
| `inet.inet_achieved` | SAR | CEO, Commercial |
| `inet.inet_gap_today` | SAR | Ops |
| `subcon.active_sub_teams` | count | Ops |
| `subcon.sub_revenue` | SAR | Commercial |
| `subcon.sub_expense` | SAR | Financial |
| `subcon.inet_margin_sub` | SAR | Financial |
| `backend.active_teams` | count | Ops |
| `backend.assigned_pending` | count | Ops |
| `backend.completed_mtd` | count | Ops |
| `company.company_target` | SAR | CEO, Financial |
| `company.total_achieved` | SAR | CEO, Financial |
| `company.total_cost` | SAR | Financial |
| `company.profit_loss` | SAR | CEO, Financial |
| `company.coverage_pct` | % | Financial |
| `top_teams` | array | CEO |
| `im_performance` | array | CEO, Ops |
| `team_status` | object | Ops |
| `watchlist` | array | CEO (Issues & Alerts) |
| `last_updated` | timestamp | All |

## Shared API: `get_pic_dashboard` (`pic.py:486`)

Invoicing pipeline data.

| Field | Used By |
|-------|---------|
| `kpi.total_invoiced` | Financial, Commercial |
| `kpi.unbilled_ms1` / `unbilled_ms2` | Financial |
| `kpi.line_count` | Commercial |
| `buckets` (per-status counts/amounts) | Financial (pipeline) |
| `monthly` (invoice month roll-up) | Financial, Commercial |
| `inet_subcon` (INET vs Subcon split) | Financial |

## Other APIs

| API | Used By |
|-----|---------|
| `get_project_kpis` | PM - active/delayed projects, budget |
| `dashboard_charts` | PM - project status, budget vs actual, domain distribution |
| `get_im_dashboard(im, args)` | PM - per-IM team/site/project data |
| `get_po_dispatch_stats` | Ops - dispatch pipeline counts |
| `get_pms_overview` | PM - team assignment status |

---

## CEO Dashboard Mapping

| Card | Backend Field |
|------|---------------|
| Total Revenue | `company.total_achieved` from `get_command_dashboard` |
| Net Profit | `company.profit_loss` |
| Active Projects | `get_project_kpis().active_projects` |
| Pending Invoices | `get_pic_dashboard().kpi.unbilled_ms1 + unbilled_ms2` |
| Customer Satisfaction | Static 92% (or from satisfaction survey system) |
| YTD Growth | `company.coverage_pct` (or compute from monthly data) |
| Financial Overview | `company.total_achieved` vs `company.company_target` |
| Revenue Trend | `im_performance` aggregated by month (compute from list) |
| Top Projects | `top_teams` from `get_command_dashboard` |
| Issues & Alerts | `watchlist` from `get_command_dashboard` |

## Commercial Dashboard Mapping

| Card | Backend Field |
|------|---------------|
| Total Revenue | `company.total_achieved` |
| Monthly Revenue | `get_pic_dashboard().monthly[-1]` |
| Pending Invoices | `get_pic_dashboard().kpi.unbilled_ms1 + unbilled_ms2` |
| Revenue Growth | Compute from monthly trend |
| Revenue Trends chart | `get_pic_dashboard().monthly` |
| Revenue Breakdown pie | `get_pic_dashboard().inet_subcon` |
| Top Deals table | `top_teams` / `im_performance` |
| Pending Invoices table | `get_pic_report("aging")` |

## PM Dashboard Mapping

| Card | Backend Field |
|------|---------------|
| Active Projects | `get_project_kpis().active_projects` |
| On Track | `get_project_kpis().active_projects - at_risk - overdue` |
| Delayed | `get_project_kpis().overdue_projects` |
| Pending Tasks | `get_pms_overview().daily_update_status` sum |
| Project Health pie | `dashboard_charts().projects_by_status` |
| Task Status grid | `get_pms_overview().daily_update_status` |
| Top Projects | `dashboard_charts().budget_vs_actual` |
| Team Performance | `get_im_dashboard().team_perf` |
| Financial Overview | `get_project_summary().financial_summary` |

## Ops Dashboard Mapping

| Card | Backend Field |
|------|---------------|
| Total Revenue | `company.total_achieved` |
| Avg Daily Revenue | `company.total_achieved` / days in month |
| Jobs Completed | `operational.closed_activities` |
| Open Work Orders | `operational.total_open_po_lines` |
| Rev vs Target | `company.coverage_pct` |
| Revenue Trends | `get_command_dashboard` operational data by date |
| Jobs Completed donut | `operational.closed_activities` |
| Operational Costs | `inet.inet_monthly_cost` + `subcon.sub_expense` |
| Billing Overview | `get_pic_dashboard().kpi` |
| Technician Performance | `top_teams` or `im_performance` |
| Revenue Per Tech | `im_performance` filtered by team_type |

## Financial Dashboard Mapping

| Card | Backend Field |
|------|---------------|
| Total Revenue | `company.total_achieved` |
| Total Cost | `company.total_cost` |
| Net Profit | `company.profit_loss` |
| Margin % | `(profit_loss / total_achieved) * 100` |
| Outstanding | `get_pic_dashboard().kpi.unbilled_ms1 + unbilled_ms2` |
| Monthly P&L | `get_pic_dashboard().monthly` |
| Cost Breakdown | `inet.inet_monthly_cost` + `subcon.sub_expense` + `backend` costs |
| Invoice Aging | `get_pic_report("aging")` |
