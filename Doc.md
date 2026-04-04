INET TELECOM ERPNext - DEVELOPER TASK BREAKDOWN
Project: ERPNext Control Center Implementation
Document Type: Technical Task Specification
Target Audience: Development Team
Last Updated: March 28, 2026 
Task Tracking Legend:
HIGH PRIORITY - Critical path, blocking other tasks
MEDIUM PRIORITY - Important but not blocking
LOW PRIORITY - Nice-to-have, can be deferred 
MODULE 1: PROJECT MANAGEMENT (Weeks 5-6) - 50 Development Tasks
1.1 Custom DocType Development
Task PM-001: Create Custom DocType "Project Control Center"
CUSTOM DOCTYPEHIGH PRIORITY
Estimate: 8 hours
Description: Extend standard Project doctype with INET-specific fields
Technical Details: 
•	Fields: project_code, project_domain (Link to Project Domain Master), customer_type, huawei_im (Link to Employee), implementation_manager (Link to Employee), center_area (Link to Area Master), project_status (Select), budget_amount, actual_cost, completion_percentage 
•	Permissions: Role-based (Project Manager, Implementation Manager, View Only) 
•	Validation: Budget vs actual cost validation, completion percentage 0-100 range 
•	Child Tables: Project Tasks, Project Materials, Project Teams, Project Documents 
Files to Create: 
custom_app/custom_app/doctype/project_control_center/
├── project_control_center.py
├── project_control_center.js
├── project_control_center.json
└── project_control_center_dashboard.py
Task PM-002: Create Custom DocType "Daily Work Update"
CUSTOM DOCTYPEHIGH PRIORITY
Estimate: 10 hours
Description: Field team daily work progress tracking
Technical Details: 
•	Fields: project (Link), team (Link to Team Master), update_date, work_description (Text Editor), tasks_completed (Table), photos (Attach Image - multiple), gps_location, status (Draft/Submitted/Approved), approval_status, remarks 
•	Child Table: tasks_completed (task_name, activity_code, quantity, unit, progress_percentage) 
•	Server Scripts: GPS coordinate validation, photo compression, auto-notification to PM 
•	Client Scripts: Photo upload widget, GPS capture button, progress calculator 
API Endpoints to Create: 
@frappe.whitelist()
def upload_work_photos(work_update_id, photos)
def capture_gps_location()
def submit_work_update(work_update_id)
def approve_work_update(work_update_id, approved_by)
Task PM-003: Create DocType "Team Assignment"
CUSTOM DOCTYPEHIGH PRIORITY
Estimate: 6 hours
Description: Track team assignments to projects
Technical Details: 
•	Fields: team_id (Link to Team Master), project (Link to Project), assignment_date, end_date, role_in_project, daily_cost, utilization_percentage, status (Active/Completed) 
•	Validations: Prevent overlapping assignments, validate date ranges, check team availability 
•	Auto-calculations: Utilization percentage based on active assignments 
1.2 Dashboard Development
Task PM-004: Project Management Dashboard (Main)
DASHBOARDHIGH PRIORITY
Estimate: 16 hours
Description: Comprehensive dashboard for all projects
Dashboard Components: 
•	KPI Cards: Total Projects, Active Projects, Projects at Risk, Overdue Projects, Total Budget, Actual Spent, Budget Utilization % 
•	Charts: Projects by Status (Pie Chart), Budget vs Actual by Project (Bar Chart), Completion Timeline (Gantt-style), Project Distribution by Domain (Donut Chart) 
•	Project List View: Filterable table with columns: Project Code, Name, Domain, Status, Progress %, Budget, Actual, Team, IM 
•	Filters: Status, Domain, Area, IM, Date Range 
•	Actions: Quick create project, assign team, view work updates, export report 
Technical Stack: 
// Frontend: Frappe Dashboard API + Custom JavaScript
// Backend: Python server scripts for data aggregation
// Charts: Frappe Charts library
// Refresh: Real-time updates every 60 seconds
Task PM-005: Team Resource Dashboard
DASHBOARDMEDIUM PRIORITY
Estimate: 12 hours
Description: Team availability and workload visualization
Components: 
•	Team availability calendar (64 teams) 
•	Workload distribution chart 
•	Resource utilization percentage 
•	Multi-project assignment view 
•	Team performance metrics 
1.3 Purchase Order Integration
Task PM-006: PO-Project Linkage System
CUSTOMIZATIONHIGH PRIORITY
Estimate: 12 hours
Description: Automatic linking and cost allocation
Implementation: 
•	Custom Fields in Purchase Order: project_code (Link), activity_code (Link), area, cost_center 
•	Server Script: On PO submission → Update project actual_cost, On GRN creation → Update project material_received 
•	Validation: Prevent PO submission without project link, validate budget availability 
•	Alerts: Email notification to PM when PO exceeds project budget 
Code Snippet: 
def on_submit(self):
    if self.project_code:
        project = frappe.get_doc("Project Control Center", self.project_code)
        project.actual_cost += self.total
        if project.actual_cost > project.budget_amount:
            frappe.msgprint("Budget exceeded!")
            # Send alert
        project.save()
1.4 Reports Development
Task ID	Report Name	Type	Priority	Estimate
PM-007	Project Status Summary	Script Report	HIGH	4h
PM-008	Budget vs Actual by Project	Query Report	HIGH	3h
PM-009	Team Utilization Report	Script Report	MEDIUM	5h
PM-010	Daily Work Progress Report	Query Report	MEDIUM	4h
PM-011	Project Profitability Analysis	Script Report	MEDIUM	6h
PM-012	Overdue Projects Alert Report	Query Report	LOW	3h
MODULE 2: MATERIAL TRACKING SYSTEM (Week 8) - 30 Development Tasks
2.1 Material Requisition Workflow
Task MT-001: Customize Material Request DocType
CUSTOMIZATIONHIGH PRIORITY
Estimate: 8 hours
Custom Fields: 
•	project_code (Link to Project Control Center) - mandatory 
•	activity_code (Link to Activity Master) 
•	requested_by_team (Link to Team Master) 
•	area (Link to Area Master) 
•	priority (Select: Urgent, High, Normal, Low) 
•	approval_level (Int - tracks current approval level) 
•	approved_by_l1, approved_by_l2, approved_by_l3 (Link to User) 
Workflow States: Draft → Submitted → L1 Approved → L2 Approved → L3 Approved → PO Created → Received → Completed → Cancelled 
Task MT-002: Multi-Level Approval Workflow
WORKFLOWHIGH PRIORITY
Estimate: 10 hours
Approval Logic: 
•	Level 1: Team Lead (amount < 10,000 SAR) 
•	Level 2: Implementation Manager (amount 10,000 - 50,000 SAR) 
•	Level 3: Project Manager (amount > 50,000 SAR) 
•	Auto-routing based on total amount 
•	Email notifications at each level 
•	Approval deadline tracking (48 hours SLA) 
Implementation: 
frappe.workflow.create({
    doctype: "Material Request",
    states: ["Draft", "L1 Pending", "L2 Pending", ...],
    transitions: [...]
})
Task MT-003: Material Request to PO Auto-Conversion
SERVER SCRIPTHIGH PRIORITY
Estimate: 6 hours
Logic: When Material Request reaches "L3 Approved" state → Auto-create Purchase Order with project linkage, cost center mapping, approval metadata 
2.2 Material Consumption Tracking
Task ID	Task Description	Technical Details	Est.
MT-004	Project-wise Material Consumption Tracker	Custom report aggregating material issued to projects, grouped by activity, period filters	6h
MT-005	Material Issue Voucher Customization	Add fields: project, activity, team, area. Server script to update project material consumption	5h
MT-006	Material Audit Trail Report	Complete tracking from requisition → approval → PO → GRN → issue → consumption	8h
MODULE 3: WAREHOUSE MANAGEMENT (Week 9) - 25 Development Tasks
3.1 Warehouse Structure Setup
Task WH-001: Multi-Warehouse Configuration
CONFIGURATIONHIGH PRIORITY
Estimate: 4 hours
Warehouses to Create: 
•	Main Warehouse - Riyadh (with bin locations) 
•	Jeddah Warehouse, Dammam Warehouse, Abha Warehouse 
•	Project Site Warehouses (dynamic based on active projects) 
•	Rejected Stock Warehouse, In-Transit Warehouse 
Bin Location Structure: Warehouse → Aisle → Rack → Bin 
Task WH-002: Custom DocType "Gate Entry Register"
CUSTOM DOCTYPEHIGH PRIORITY
Estimate: 8 hours
Fields: entry_type (IN/OUT), entry_date, vehicle_number, driver_name, supplier (if IN), project (if OUT), items (Child Table), gate_pass_number, security_officer, entry_time, exit_time, remarks 
3.2 Stock Operations
Task ID	Task Description	Priority	Estimate
WH-003	Customize GRN with project linkage and document attachments	HIGH	6h
WH-004	Batch and Serial Number tracking setup for 820 items	HIGH	8h
WH-005	Inter-warehouse stock transfer workflow	MEDIUM	6h
WH-006	Stock reconciliation tool for physical verification	MEDIUM	5h
WH-007	Warehouse-wise stock balance report (real-time)	HIGH	5h
MODULE 4: HUMAN RESOURCES (Week 7) - 20 Development Tasks
4.1 Employee Management
Task HR-001: Employee Master Customization
CUSTOMIZATIONMEDIUM PRIORITY
Estimate: 6 hours
Custom Fields: iqama_number, iqama_expiry, passport_number, emergency_contact_ksa, bank_account_iban, skill_set (Table), certifications (Table), project_experience (Small Text) 
Task ID	Task Description	Details	Priority	Est.
HR-002	Leave Management Workflow	Configure leave types, approval hierarchy, balance calculation	MEDIUM	5h
HR-003	Shift Management for Field Teams	Day shift, Night shift, Rotation schedules	MEDIUM	6h
HR-004	Overtime Calculation Logic	Auto-calculate OT based on hours, rates, and project	LOW	8h
HR-005	Employee Performance Report	KPIs: projects completed, work updates, attendance %	LOW	6h
MODULE 5: STOCK MANAGEMENT (Week 8) - 20 Development Tasks
5.1 Item Master Configuration
Task SM-001: Import Item Master (820 items)
DATA MIGRATIONHIGH PRIORITY
Estimate: 6 hours
Source: 12_CUSTOMER_ITEM_MASTER sheet
Fields to Map: Item Code, Item Name, Item Group, UOM, Default Supplier, Last Purchase Rate, Standard Rate, HSN Code, Batch Tracking, Serial Number Tracking
Validation: Check for duplicates, validate UOM, ensure item group exists 
Task ID	Task Description	Priority	Estimate
SM-002	Stock Entry Customization (add project field)	HIGH	4h
SM-003	Stock Repack functionality for cable/fiber	MEDIUM	6h
SM-004	Stock Aging Analysis Report	MEDIUM	5h
SM-005	Min/Max Stock Level Alerts	LOW	4h
SM-006	Stock Valuation Report (FIFO/Moving Average)	MEDIUM	6h
MODULE 6: ACCOUNTS & FINANCE (Week 10) - 25 Development Tasks
6.1 Chart of Accounts Setup
Task AC-001: Configure KSA Chart of Accounts
CONFIGURATIONHIGH PRIORITY
Estimate: 8 hours
Structure: 
•	Assets: Current Assets, Fixed Assets, Investments 
•	Liabilities: Current Liabilities, Long-term Liabilities 
•	Income: Project Revenue, Service Revenue, Other Income 
•	Expenses: Direct Costs, Indirect Costs, Administrative, Marketing 
•	Equity: Share Capital, Retained Earnings 
Cost Centers: By Project Domain (STC Fixed, Mobily Fixed, Zain Core, etc.) 
6.2 Tax Configuration
Task AC-002: VAT Configuration (KSA - 15%)
TAX SETUPHIGH PRIORITY
Estimate: 4 hours
Setup: Create tax templates, configure tax accounts, set up tax categories (Standard, Zero-rated, Exempt), enable tax withholding if required 
Task ID	Task Description	Priority	Estimate
AC-003	Purchase Invoice - Project linkage	HIGH	4h
AC-004	Payment Entry workflow and approvals	HIGH	5h
AC-005	Supplier Aging Report (custom)	MEDIUM	4h
AC-006	Project-wise P&L Report	HIGH	8h
AC-007	Budget vs Actual Financial Report	MEDIUM	6h
AC-008	Cash Flow Statement (custom)	LOW	6h
MODULE 7: MASTER DATA IMPORTS (Week 11) - 15 Development Tasks
7.1 Data Migration Scripts
Task DM-001: Activity Master Import Script
DATA IMPORTHIGH PRIORITY
Estimate: 6 hours
Source: 01_ACTIVITY_MASTER (237 records)
Mapping: 
Activity_Code → Item Code
Raw_Item_Description → Item Name  
Standard_Activity → Item Group
Category → Custom Field "Activity Category"
Active_Flag → Disabled (inverted)
Validation: No duplicates, valid category values, active flag check 
Task DM-002: Project Master Import Script
DATA IMPORTHIGH PRIORITY
Estimate: 8 hours
Source: 03_PROJECT_DOMAIN_MASTER (116 records)
Complex Mapping: 
•	Handle multiple projects with same Project_Code (different names) 
•	Create project hierarchy if needed 
•	Link to customer (STC, Mobily, Zain, Huawei) 
•	Map implementation managers (validate employee exists) 
•	Set project status based on Active_Flag 
Task ID	Import Entity	Source Sheet	Records	Priority	Est.
DM-003	Team Master	07_TEAM_MASTER	64	HIGH	5h
DM-004	Customer Item Master	12_CUSTOMER_ITEM_MASTER	820	HIGH	10h
DM-005	Activity Cost Master	15_ACTIVITY_COST_MASTER	238	MEDIUM	6h
DM-006	Subcontractor Master	08_SUBCONTRACTOR_MASTER	11	MEDIUM	3h
DM-007	Area Master	04_AREA_MASTER	7	LOW	2h
DM-008	Workflow Rules Configuration	09_WORKFLOW_RULES	24	MEDIUM	6h
DM-009	Formula Map Implementation	10_FORMULA_MAP	17	LOW	5h
MODULE 8: REPORTS & DASHBOARDS (Throughout) - 35 Development Tasks
8.1 Executive Dashboards
Dashboard	Widgets	Audience	Priority	Est.
CEO Dashboard	Total revenue, project count, profitability, team utilization, expense breakdown	Executive Management	MEDIUM	10h
Operations Dashboard	Active projects, daily work updates, team locations, material requests pending	Operations Manager	HIGH	12h
Finance Dashboard	Receivables, payables, cash flow, budget utilization, project P&L	Finance Manager	MEDIUM	10h
Warehouse Dashboard	Stock levels, pending GRNs, material requests, expiry alerts	Warehouse Manager	MEDIUM	8h
8.2 Standard Reports to Customize
Report Category	Report Names	Customization Needed
Project Reports	Project Summary, Project Profitability, Team Performance, Work Progress Tracker	Add project domain filters, cost center breakdown, IM grouping
Financial Reports	Trial Balance, P&L, Balance Sheet, Budget Variance	Add project dimension, cost center grouping, period comparisons
Inventory Reports	Stock Balance, Stock Ledger, Material Consumption	Add project-wise consumption, warehouse filtering, batch tracking
HR Reports	Attendance Summary, Leave Balance, Overtime Report	Add team grouping, project-wise attendance, shift details
TECHNICAL SPECIFICATIONS
1. Development Environment Setup
Task DEV-ENV-001: Local Development Setup
Estimate: 4 hours per developer
Requirements: 
• ERPNext Version: 15 (latest stable)
• Python: 3.10+
• MariaDB: 10.6+
• Node.js: 18+
• Redis: 6+
• Git repository: Create private repo
• Branch strategy: main, staging, feature branches
2. Custom App Structure
App Name: inet_control_center
Structure: 
inet_control_center/
├── inet_control_center/
│   ├── doctype/
│   │   ├── project_control_center/
│   │   ├── daily_work_update/
│   │   ├── team_assignment/
│   │   ├── gate_entry_register/
│   │   └── ...
│   ├── report/
│   │   ├── project_status_summary/
│   │   ├── budget_vs_actual/
│   │   ├── team_utilization/
│   │   └── ...
│   ├── dashboard/
│   │   ├── project_management_dashboard.py
│   │   ├── operations_dashboard.py
│   │   └── ...
│   ├── api/
│   │   ├── project_api.py
│   │   ├── work_update_api.py
│   │   └── ...
│   ├── hooks.py
│   ├── patches.txt
│   └── modules.txt
3. Database Schema Considerations
Aspect	Specification	Reason
Indexing	Add indexes on: project_code, team_id, activity_code, area, date fields	Optimize query performance for large datasets
Naming Series	PRJ-.YYYY.-.####, WU-.YYYY.MM.-.#####, GRN-.WH.-.#####	Easy identification and tracking
Audit Trail	Enable version control on: Project, Material Request, PO, Work Updates	Compliance and change tracking
Archiving	Auto-archive projects older than 2 years	Maintain performance
4. API Development
Task API-001: REST API for Mobile App (Future Use)
APILOW PRIORITY
Estimate: 12 hours
Endpoints to Create: 
GET    /api/projects - List all projects
GET    /api/projects/{id} - Get project details
POST   /api/work-updates - Create work update
GET    /api/work-updates?project={id} - Get work updates
POST   /api/work-updates/upload-photo - Upload photo
GET    /api/teams/{id}/assignments - Get team assignments
GET    /api/material-requests - List material requests
POST   /api/material-requests - Create material request
Authentication: API Key + Secret, OAuth 2.0 for mobile app 
5. Integration Points
Integration	Method	Purpose	Priority
WhatsApp Notifications	Webhook to WhatsApp Business API	Send approval requests, status updates	LOW
Email Server	SMTP configuration	Notifications, reports, alerts	HIGH
GPS Tracking	Browser Geolocation API	Capture field team locations	MEDIUM
Backup System	Automated cron jobs	Daily backups to cloud storage	HIGH
DEVELOPMENT BEST PRACTICES
Code Standards:
•	Python: Follow PEP 8, use type hints, docstrings for all functions 
•	JavaScript: ES6+, use async/await, proper error handling 
•	Naming: snake_case for Python, camelCase for JavaScript 
•	Comments: Explain "why" not "what", document complex logic 
•	Git Commits: Conventional commits format (feat:, fix:, docs:, refactor:) 
Testing Requirements:
•	Unit Tests: For all server scripts and API methods 
•	Integration Tests: For workflows and data flow between modules 
•	Test Data: Create realistic test data (10 projects, 20 items, 5 teams) 
•	Coverage: Aim for 70%+ code coverage 
Performance Guidelines:
•	Use database queries efficiently (avoid N+1 queries) 
•	Implement caching for frequently accessed data (Redis) 
•	Optimize images (compress to < 500KB) 
•	Lazy load dashboard widgets 
•	Implement pagination for large lists (100 records per page) 
TASK SUMMARY BY DEVELOPER
Developer #1 (Senior) - Project Management & Material Tracking
Week	Tasks	Total Hours
Week 5	PM-001 to PM-006 (Project doctypes, dashboard foundation)	40h
Week 6	PM-007 to PM-012 (Reports, PO integration)	40h
Week 8	MT-001 to MT-006 (Material tracking workflow)	40h
Week 9	WH-001 to WH-007 (Warehouse management)	40h
Developer #2 (Mid-Senior) - HR, Finance & Stock
Week	Tasks	Total Hours
Week 7	HR-001 to HR-005 (HR module customization)	40h
Week 8	SM-001 to SM-006 (Stock management)	40h
Week 10	AC-001 to AC-008 (Accounts & finance)	40h
Week 11	DM-001 to DM-009 (Data migration scripts)	40h
Frontend Developer - Dashboards & UI/UX
Week	Tasks	Total Hours
Week 5-6	PM-004, PM-005 (Project dashboards)	28h
Week 7-10	Dashboard UI enhancements, mobile responsiveness, chart customizations	32h
Week 11-12	Report UI improvements, print format designs	20h
TESTING CHECKLIST
Module Testing (Week 13):
Module	Test Scenarios	Test Cases	Owner
Project Management	Create project, assign team, link PO, update work, calculate costs	25	QA Engineer
Material Tracking	Create MR, multi-level approval, auto-PO creation, GRN, material issue	20	QA Engineer
Warehouse	GRN with batch, stock transfer, material out, gate register	18	QA Engineer
Stock Management	Stock entry, reconciliation, reports, batch tracking	15	QA Engineer
HR	Employee creation, leave application, attendance, overtime	15	QA Engineer
Accounts	Invoice creation, payment, GL updates, reports	20	QA Engineer
DEPLOYMENT CHECKLIST
Production Deployment (End of Week 15):
1.	Code Freeze: No new features after Day 70 
2.	Database Backup: Full backup of staging with tested data 
3.	Production Server: Verify specs (CPU, RAM, disk), install ERPNext, configure domain and SSL 
4.	Data Migration: Execute all migration scripts, validate data integrity, generate reconciliation reports 
5.	Configuration: Copy all customizations from staging, set up email server, configure backups 
6.	Security: Change default passwords, restrict SSH access, enable firewall, configure SSL certificate 
7.	Performance: Enable query optimization, set up Redis caching, configure worker processes 
8.	Monitoring: Set up uptime monitoring, error logging (Sentry), performance monitoring 
9.	Smoke Testing: Test critical flows (login, create project, create PO, view reports) 
10.	Go/No-Go Decision: PM + Tech Lead sign-off 
DEVELOPMENT TOOLS & RESOURCES
Required Tools:
•	IDE: VS Code with Frappe extension 
•	Version Control: Git + GitHub/GitLab 
•	Database Client: MySQL Workbench / DBeaver 
•	API Testing: Postman / Insomnia 
•	Documentation: Notion / Confluence 
•	Task Tracking: Jira / Monday.com / Trello 
•	Communication: Slack / Microsoft Teams 
Reference Documentation:
•	Frappe Framework Documentation 
•	ERPNext Official Docs 
•	ERPNext GitHub Repository 
•	INET BRD (Inet Telecom ERPNext BRD.pdf) 
•	INET Blueprint (INet_Control_Command_ERP_Blueprint.pdf) 
•	Client Data File (CONTROL_CENTER.xlsx) 
DAILY DEVELOPMENT WORKFLOW
1.	09:00 - Daily Stand-up (15 min) 
•	What did I complete yesterday? 
•	What will I work on today? 
•	Any blockers? 
2.	09:15 - Development Work 
•	Pick task from sprint board 
•	Create feature branch: feature/PM-001-project-doctype 
•	Implement functionality 
•	Write unit tests 
•	Self-test on local environment 
3.	16:00 - Code Review & Commit 
•	Push code to feature branch 
•	Create pull request with description 
•	Request review from Tech Lead 
4.	17:00 - Code Review Session (30 min) 
•	Tech Lead reviews PRs 
•	Address feedback 
•	Merge to staging branch 
5.	End of Day - Update Task Board 
•	Move tasks to "Done" 
•	Log time spent 
•	Update blockers if any 
CRITICAL SUCCESS FACTORS FOR DEVELOPERS
DO's: 
•	Follow Frappe framework best practices 
•	Write clean, maintainable code with proper comments 
•	Test thoroughly before pushing to staging 
•	Communicate blockers immediately 
•	Document all custom APIs and functions 
•	Use frappe.db.get_value() instead of frappe.get_doc() for single field reads 
•	Implement proper error handling with try-except blocks 
•	Use @frappe.whitelist() for all API methods 
DON'Ts: 
•	Don't hardcode values - use system settings 
•	Don't skip code reviews 
•	Don't push directly to main branch 
•	Don't ignore linter warnings 
•	Don't use frappe.db.sql() without parameterization (SQL injection risk) 
•	Don't create duplicate doctypes - reuse existing when possible 
•	Don't forget to handle permissions in server scripts 
TASK DEPENDENCIES GRAPH
Critical Path:
Infrastructure Setup (DEV-ENV-001)
    ↓
Base Configuration (Weeks 3-4)
    ↓
Master Data Structure (DM-007, DM-009) ← Must be done first
    ↓
Project Management Module (PM-001 to PM-006) ← Parallel with MT-001
    ↓
PO Integration (PM-006, AC-003) ← Depends on Accounts setup
    ↓
Material Tracking (MT-001 to MT-006) ← Depends on PM-001
    ↓
Data Migration (DM-001 to DM-006) ← Depends on all doctypes
    ↓
Integration Testing ← All modules must be complete
    ↓
UAT ← Testing complete
    ↓
Go-Live
WEEKLY DEVELOPER SPRINT PLAN
Sprint	Focus Area	Key Tasks	Demo
Sprint 1
(Week 3-4)	Foundation Setup	ERPNext installation, user roles, base configuration, master structure	Show base system with users and roles
Sprint 2
(Week 5-6)	Project Management	Project doctypes, dashboard, PO integration, team tracking	Show project dashboard with live data
Sprint 3
(Week 7)	Human Resources	Employee management, leave, attendance, overtime	Show HR workflows and reports
Sprint 4
(Week 8)	Material & Stock	Material requisition, stock tracking, consumption reports	Show material flow from request to consumption
Sprint 5
(Week 9)	Warehouse Management	GRN, material IN/OUT, gate register, bin locations	Show warehouse operations
Sprint 6
(Week 10)	Accounts & Finance	Chart of accounts, invoices, payments, financial reports	Show GL updates and financial reports
Sprint 7
(Week 11-12)	Data Migration	Import all master data, validate, reconcile	Show migrated data and validation reports
Sprint 8
(Week 13-14)	Testing & Bug Fixes	UAT support, bug fixes, performance optimization	Show bug-free system ready for go-live
CODE REVIEW CHECKLIST
Before submitting PR, verify:
•	Code follows ERPNext coding standards 
•	All functions have docstrings 
•	No console.log() or print() statements (use logger) 
•	Permissions implemented correctly 
•	Validation rules working as expected 
•	Error handling implemented 
•	SQL queries parameterized 
•	No security vulnerabilities (XSS, SQL injection) 
•	Mobile responsive (test on small screen) 
•	Performance tested (page load < 3s) 
•	Unit tests written and passing 
•	Documentation updated 
COMMON DEVELOPMENT PATTERNS
1. Custom Field Addition:
frappe.get_doc({
    "doctype": "Custom Field",
    "dt": "Project",
    "fieldname": "project_domain",
    "fieldtype": "Link",
    "options": "Project Domain Master",
    "label": "Project Domain",
    "insert_after": "project_name",
    "reqd": 1
}).insert()
2. Server Script Example (Auto-update):
def on_submit(self):
    # Update project actual cost
    if self.project:
        frappe.db.set_value("Project Control Center", 
                          self.project, 
                          "actual_cost", 
                          frappe.db.get_value("Project Control Center", 
                                            self.project, 
                                            "actual_cost") + self.total)
        
        # Send notification
        frappe.enqueue("inet_control_center.api.notifications.send_budget_alert",
                      project=self.project,
                      amount=self.total)
3. Client Script Example (Dynamic Fetch):
frappe.ui.form.on('Daily Work Update', {
    project: function(frm) {
        frappe.call({
            method: 'inet_control_center.api.project_api.get_project_details',
            args: { project: frm.doc.project },
            callback: function(r) {
                if (r.message) {
                    frm.set_value('customer', r.message.customer);
                    frm.set_value('area', r.message.area);
                }
            }
        });
    }
});
4. Report Query Pattern:
def execute(filters=None):
    columns = get_columns()
    data = get_data(filters)
    chart = get_chart_data(data)
    return columns, data, None, chart

def get_columns():
    return [
        {"label": "Project", "fieldname": "project", "fieldtype": "Link", 
         "options": "Project", "width": 150},
        {"label": "Budget", "fieldname": "budget", "fieldtype": "Currency", 
         "width": 120},
        ...
    ]

def get_data(filters):
    return frappe.db.sql("""
        SELECT 
            p.name as project,
            p.budget_amount as budget,
            SUM(po.total) as actual
        FROM `tabProject Control Center` p
        LEFT JOIN `tabPurchase Order` po ON po.project = p.name
        WHERE p.status = 'Active'
        GROUP BY p.name
    """, as_dict=1)
PERFORMANCE OPTIMIZATION TASKS
Optimization	Implementation	Impact
Database Indexing	Add indexes on project_code, team_id, activity_code	50% faster queries
Redis Caching	Cache frequently accessed master data (activities, areas, teams)	Reduce DB load by 40%
Image Compression	Auto-compress uploaded photos to 800x600, max 500KB	Save storage, faster uploads
Lazy Loading	Load dashboard widgets on scroll, paginate project lists	Initial page load < 2s
Query Optimization	Use get_list() instead of get_all() when possible, limit fields in queries	30% faster report generation

Document Control
Document: INET_Developer_Task_Breakdown_v1.0
Total Development Tasks: 220+
Total Estimated Hours: 640 hours (16 weeks × 40 hours)
Created: March 28, 2026
For: INET Telecom ERP Development Team 
