# INET Operations Command Center — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the INET PMS portal into a full Operations Command Center with 6-stage pipeline, dark theme dashboard, and 3 user roles (Admin/IM/Field Team).

**Architecture:** Frappe backend with new doctypes for the pipeline (PO Dispatch → Rollout Plan → Daily Execution → Work Done) + master data tables. React 19 SPA frontend with role-based routing, dark ops-center theme, and 60-second auto-refresh dashboard. Financial calculations engine computes revenue/cost/margin from master data.

**Tech Stack:** Python 3.10+ (Frappe 15), React 19, Vite 6, vanilla CSS (dark theme), MariaDB 10.11, Redis 7.

**Spec:** `docs/superpowers/specs/2026-04-04-command-center-rebuild-design.md`

---

## Phase 1: Backend Master Doctypes (Tasks 1–7)

New reference-data doctypes that the pipeline depends on. Each task creates one doctype with its JSON definition, Python controller, and `__init__.py`.

### Task 1: Area Master Doctype

**Files:**
- Create: `inet_app/inet_app/doctype/area_master/__init__.py`
- Create: `inet_app/inet_app/doctype/area_master/area_master.json`
- Create: `inet_app/inet_app/doctype/area_master/area_master.py`

- [ ] **Step 1: Create `__init__.py`**

```python
# inet_app/inet_app/doctype/area_master/__init__.py
```

Empty file. Required by Frappe for doctype discovery.

- [ ] **Step 2: Create doctype JSON**

```json
{
  "actions": [],
  "autoname": "field:area_code",
  "creation": "2026-04-04 00:00:00.000000",
  "doctype": "DocType",
  "engine": "InnoDB",
  "field_order": ["area_code", "area_name"],
  "fields": [
    {
      "fieldname": "area_code",
      "fieldtype": "Data",
      "label": "Area Code",
      "in_list_view": 1,
      "reqd": 1,
      "unique": 1
    },
    {
      "fieldname": "area_name",
      "fieldtype": "Data",
      "label": "Area Name",
      "in_list_view": 1,
      "reqd": 1
    }
  ],
  "index_web_pages_for_search": 0,
  "istable": 0,
  "links": [],
  "modified": "2026-04-04 00:00:00.000000",
  "modified_by": "Administrator",
  "module": "Inet App",
  "name": "Area Master",
  "naming_rule": "By fieldname",
  "owner": "Administrator",
  "permissions": [
    {
      "create": 1, "delete": 1, "email": 1, "export": 1,
      "print": 1, "read": 1, "report": 1, "role": "System Manager",
      "share": 1, "write": 1
    }
  ],
  "sort_field": "area_code",
  "sort_order": "ASC",
  "track_changes": 1
}
```

- [ ] **Step 3: Create Python controller**

```python
# inet_app/inet_app/doctype/area_master/area_master.py
import frappe
from frappe.model.document import Document

class AreaMaster(Document):
    pass
```

- [ ] **Step 4: Run bench migrate to install doctype**

Run: `cd ~/frappe-bench && bench --site mysite.local migrate`
Expected: "Updating DocTypes for inet_app" with no errors.

- [ ] **Step 5: Verify doctype exists**

Run: `cd ~/frappe-bench && bench --site mysite.local console` then:
```python
frappe.get_meta("Area Master").fields
```
Expected: Returns list with area_code and area_name fields.

- [ ] **Step 6: Commit**

```bash
git add inet_app/inet_app/doctype/area_master/
git commit -m "feat: add Area Master doctype"
```

---

### Task 2: Team Master Doctype

**Files:**
- Create: `inet_app/inet_app/doctype/inet_team/__init__.py`
- Create: `inet_app/inet_app/doctype/inet_team/inet_team.json`
- Create: `inet_app/inet_app/doctype/inet_team/inet_team.py`

Note: Named `inet_team` to avoid conflict with Frappe core "Team" doctype.

- [ ] **Step 1: Create `__init__.py`**

Empty file.

- [ ] **Step 2: Create doctype JSON**

```json
{
  "actions": [],
  "autoname": "field:team_id",
  "creation": "2026-04-04 00:00:00.000000",
  "doctype": "DocType",
  "engine": "InnoDB",
  "field_order": [
    "team_id", "team_name", "im", "team_type", "subcontractor",
    "status", "daily_cost_applies", "daily_cost"
  ],
  "fields": [
    {
      "fieldname": "team_id",
      "fieldtype": "Data",
      "label": "Team ID",
      "in_list_view": 1,
      "reqd": 1,
      "unique": 1
    },
    {
      "fieldname": "team_name",
      "fieldtype": "Data",
      "label": "Team Name",
      "in_list_view": 1,
      "reqd": 1
    },
    {
      "fieldname": "im",
      "fieldtype": "Data",
      "label": "Implementation Manager",
      "in_list_view": 1
    },
    {
      "fieldname": "team_type",
      "fieldtype": "Select",
      "label": "Team Type",
      "options": "INET\nSUB",
      "in_list_view": 1,
      "reqd": 1
    },
    {
      "fieldname": "subcontractor",
      "fieldtype": "Data",
      "label": "Subcontractor",
      "depends_on": "eval:doc.team_type=='SUB'"
    },
    {
      "fieldname": "status",
      "fieldtype": "Select",
      "label": "Status",
      "options": "Active\nInactive",
      "default": "Active",
      "in_list_view": 1
    },
    {
      "fieldname": "daily_cost_applies",
      "fieldtype": "Check",
      "label": "Daily Cost Applies",
      "default": 1
    },
    {
      "fieldname": "daily_cost",
      "fieldtype": "Currency",
      "label": "Daily Cost (SAR)",
      "default": 1000,
      "depends_on": "daily_cost_applies"
    }
  ],
  "index_web_pages_for_search": 0,
  "istable": 0,
  "links": [],
  "modified": "2026-04-04 00:00:00.000000",
  "modified_by": "Administrator",
  "module": "Inet App",
  "name": "INET Team",
  "naming_rule": "By fieldname",
  "owner": "Administrator",
  "permissions": [
    {
      "create": 1, "delete": 1, "email": 1, "export": 1,
      "print": 1, "read": 1, "report": 1, "role": "System Manager",
      "share": 1, "write": 1
    }
  ],
  "sort_field": "team_id",
  "sort_order": "ASC",
  "track_changes": 1
}
```

- [ ] **Step 3: Create Python controller**

```python
# inet_app/inet_app/doctype/inet_team/inet_team.py
import frappe
from frappe.model.document import Document

class INETTeam(Document):
    pass
```

- [ ] **Step 4: Run bench migrate**

Run: `cd ~/frappe-bench && bench --site mysite.local migrate`

- [ ] **Step 5: Commit**

```bash
git add inet_app/inet_app/doctype/inet_team/
git commit -m "feat: add INET Team master doctype"
```

---

### Task 3: Subcontractor Master Doctype

**Files:**
- Create: `inet_app/inet_app/doctype/subcontractor_master/__init__.py`
- Create: `inet_app/inet_app/doctype/subcontractor_master/subcontractor_master.json`
- Create: `inet_app/inet_app/doctype/subcontractor_master/subcontractor_master.py`

- [ ] **Step 1: Create `__init__.py`**

Empty file.

- [ ] **Step 2: Create doctype JSON**

```json
{
  "actions": [],
  "autoname": "field:subcontractor_name",
  "creation": "2026-04-04 00:00:00.000000",
  "doctype": "DocType",
  "engine": "InnoDB",
  "field_order": [
    "subcontractor_name", "type", "inet_margin_pct", "sub_payout_pct",
    "contract_model", "status", "approved_flag"
  ],
  "fields": [
    {
      "fieldname": "subcontractor_name",
      "fieldtype": "Data",
      "label": "Subcontractor",
      "in_list_view": 1,
      "reqd": 1,
      "unique": 1
    },
    {
      "fieldname": "type",
      "fieldtype": "Select",
      "label": "Type",
      "options": "INET\nSUB",
      "in_list_view": 1,
      "reqd": 1
    },
    {
      "fieldname": "inet_margin_pct",
      "fieldtype": "Percent",
      "label": "INET Margin %",
      "in_list_view": 1
    },
    {
      "fieldname": "sub_payout_pct",
      "fieldtype": "Percent",
      "label": "Sub Payout %",
      "in_list_view": 1
    },
    {
      "fieldname": "contract_model",
      "fieldtype": "Data",
      "label": "Contract Model"
    },
    {
      "fieldname": "status",
      "fieldtype": "Select",
      "label": "Status",
      "options": "Active\nInactive",
      "default": "Active"
    },
    {
      "fieldname": "approved_flag",
      "fieldtype": "Check",
      "label": "Approved",
      "default": 0
    }
  ],
  "index_web_pages_for_search": 0,
  "istable": 0,
  "links": [],
  "modified": "2026-04-04 00:00:00.000000",
  "modified_by": "Administrator",
  "module": "Inet App",
  "name": "Subcontractor Master",
  "naming_rule": "By fieldname",
  "owner": "Administrator",
  "permissions": [
    {
      "create": 1, "delete": 1, "email": 1, "export": 1,
      "print": 1, "read": 1, "report": 1, "role": "System Manager",
      "share": 1, "write": 1
    }
  ],
  "sort_field": "modified",
  "sort_order": "DESC",
  "track_changes": 1
}
```

- [ ] **Step 3: Create Python controller**

```python
# inet_app/inet_app/doctype/subcontractor_master/subcontractor_master.py
import frappe
from frappe.model.document import Document

class SubcontractorMaster(Document):
    pass
```

- [ ] **Step 4: Run bench migrate**

Run: `cd ~/frappe-bench && bench --site mysite.local migrate`

- [ ] **Step 5: Commit**

```bash
git add inet_app/inet_app/doctype/subcontractor_master/
git commit -m "feat: add Subcontractor Master doctype"
```

---

### Task 4: Customer Item Master Doctype

**Files:**
- Create: `inet_app/inet_app/doctype/customer_item_master/__init__.py`
- Create: `inet_app/inet_app/doctype/customer_item_master/customer_item_master.json`
- Create: `inet_app/inet_app/doctype/customer_item_master/customer_item_master.py`

- [ ] **Step 1: Create `__init__.py`**

Empty file.

- [ ] **Step 2: Create doctype JSON**

```json
{
  "actions": [],
  "autoname": "format:CIM-.#####",
  "creation": "2026-04-04 00:00:00.000000",
  "doctype": "DocType",
  "engine": "InnoDB",
  "field_order": [
    "customer", "item_code", "customer_activity_type", "domain",
    "item_description", "unit_type", "standard_rate_sar", "hard_rate_sar",
    "active_flag"
  ],
  "fields": [
    {
      "fieldname": "customer",
      "fieldtype": "Data",
      "label": "Customer",
      "in_list_view": 1,
      "reqd": 1
    },
    {
      "fieldname": "item_code",
      "fieldtype": "Data",
      "label": "Item Code",
      "in_list_view": 1,
      "reqd": 1
    },
    {
      "fieldname": "customer_activity_type",
      "fieldtype": "Data",
      "label": "Customer Activity Type"
    },
    {
      "fieldname": "domain",
      "fieldtype": "Data",
      "label": "Domain"
    },
    {
      "fieldname": "item_description",
      "fieldtype": "Small Text",
      "label": "Item Description"
    },
    {
      "fieldname": "unit_type",
      "fieldtype": "Data",
      "label": "Unit Type"
    },
    {
      "fieldname": "standard_rate_sar",
      "fieldtype": "Currency",
      "label": "Standard Rate (SAR)",
      "in_list_view": 1
    },
    {
      "fieldname": "hard_rate_sar",
      "fieldtype": "Currency",
      "label": "Hard Rate (SAR)",
      "in_list_view": 1
    },
    {
      "fieldname": "active_flag",
      "fieldtype": "Check",
      "label": "Active",
      "default": 1
    }
  ],
  "index_web_pages_for_search": 0,
  "istable": 0,
  "links": [],
  "modified": "2026-04-04 00:00:00.000000",
  "modified_by": "Administrator",
  "module": "Inet App",
  "name": "Customer Item Master",
  "naming_rule": "Expression (old style)",
  "owner": "Administrator",
  "permissions": [
    {
      "create": 1, "delete": 1, "email": 1, "export": 1,
      "print": 1, "read": 1, "report": 1, "role": "System Manager",
      "share": 1, "write": 1
    }
  ],
  "sort_field": "modified",
  "sort_order": "DESC",
  "track_changes": 1
}
```

- [ ] **Step 3: Create Python controller**

```python
# inet_app/inet_app/doctype/customer_item_master/customer_item_master.py
import frappe
from frappe.model.document import Document

class CustomerItemMaster(Document):
    pass
```

- [ ] **Step 4: Run bench migrate and commit**

```bash
cd ~/frappe-bench && bench --site mysite.local migrate
cd /path/to/inet_app
git add inet_app/inet_app/doctype/customer_item_master/
git commit -m "feat: add Customer Item Master doctype for billing rates"
```

---

### Task 5: Activity Cost Master + Subcontract Cost Master + Visit Multiplier Master

Three small reference doctypes created together.

**Files:**
- Create: `inet_app/inet_app/doctype/activity_cost_master/__init__.py`
- Create: `inet_app/inet_app/doctype/activity_cost_master/activity_cost_master.json`
- Create: `inet_app/inet_app/doctype/activity_cost_master/activity_cost_master.py`
- Create: `inet_app/inet_app/doctype/subcontract_cost_master/__init__.py`
- Create: `inet_app/inet_app/doctype/subcontract_cost_master/subcontract_cost_master.json`
- Create: `inet_app/inet_app/doctype/subcontract_cost_master/subcontract_cost_master.py`
- Create: `inet_app/inet_app/doctype/visit_multiplier_master/__init__.py`
- Create: `inet_app/inet_app/doctype/visit_multiplier_master/visit_multiplier_master.json`
- Create: `inet_app/inet_app/doctype/visit_multiplier_master/visit_multiplier_master.py`

- [ ] **Step 1: Create Activity Cost Master**

JSON fields: `activity_code` (Data, reqd, unique), `standard_activity` (Data), `category` (Data), `base_cost_sar` (Currency), `cost_type` (Select: Fixed/Variable), `billing_type` (Select: Billable/Non-Billable), `active_flag` (Check, default 1).
Autoname: `field:activity_code`. Module: "Inet App".

Python controller: empty `class ActivityCostMaster(Document): pass`

- [ ] **Step 2: Create Subcontract Cost Master**

JSON fields: `subcontractor` (Data, reqd), `activity_code` (Data, reqd), `region_type` (Select: Standard/Hard), `expected_cost_sar` (Currency), `effective_from` (Date), `effective_to` (Date), `active_flag` (Check, default 1).
Autoname: `format:SCC-.#####`. Module: "Inet App".

Python controller: empty `class SubcontractCostMaster(Document): pass`

- [ ] **Step 3: Create Visit Multiplier Master**

JSON fields: `visit_type` (Data, reqd, unique), `multiplier` (Float, reqd), `notes` (Small Text).
Autoname: `field:visit_type`. Module: "Inet App".

Python controller: empty `class VisitMultiplierMaster(Document): pass`

- [ ] **Step 4: Run bench migrate**

Run: `cd ~/frappe-bench && bench --site mysite.local migrate`

- [ ] **Step 5: Commit**

```bash
git add inet_app/inet_app/doctype/activity_cost_master/ inet_app/inet_app/doctype/subcontract_cost_master/ inet_app/inet_app/doctype/visit_multiplier_master/
git commit -m "feat: add Activity Cost, Subcontract Cost, and Visit Multiplier master doctypes"
```

---

### Task 6: Enhance Existing Doctypes (PO Intake + Project Control Center)

**Files:**
- Modify: `inet_app/inet_app/doctype/po_intake/po_intake.json`
- Modify: `inet_app/inet_app/doctype/po_intake_line/po_intake_line.json`
- Modify: `inet_app/inet_app/doctype/project_control_center/project_control_center.json`

- [ ] **Step 1: Add fields to PO Intake**

Add to `po_intake.json` field_order and fields array:
- `division` (Data, label "Division")
- `contract` (Data, label "Contract")
- `center_area` (Data, label "Center Area")
- `publish_date` (Date, label "Publish Date")

- [ ] **Step 2: Add fields to PO Intake Line**

Add to `po_intake_line.json` field_order and fields array:
- `shipment_number` (Data, label "Shipment No.")
- `site_name` (Data, label "Site Name")
- `po_line_status` (Select, label "Line Status", options "New\nDispatched\nCompleted", default "New")

Note: `site_code` already exists in the child table.

- [ ] **Step 3: Add fields to Project Control Center**

Add to `project_control_center.json` field_order and fields array:
- `customer` (Link, options "Customer", label "Customer")
- `huawei_im` (Data, label "Huawei IM")
- `division` (Data, label "Division")
- `monthly_target` (Currency, label "Monthly Target (SAR)")
- `active_flag` (Select, label "Active", options "Yes\nNo", default "Yes")

- [ ] **Step 4: Run bench migrate**

Run: `cd ~/frappe-bench && bench --site mysite.local migrate`

- [ ] **Step 5: Commit**

```bash
git add inet_app/inet_app/doctype/po_intake/ inet_app/inet_app/doctype/po_intake_line/ inet_app/inet_app/doctype/project_control_center/
git commit -m "feat: enhance PO Intake and Project Control Center with pipeline fields"
```

---

### Task 7: Master Data Import Script

**Files:**
- Create: `inet_app/api/data_import.py`

- [ ] **Step 1: Create import script**

```python
# inet_app/api/data_import.py
import frappe
from frappe import _
from frappe.utils import cint, flt
import json


@frappe.whitelist()
def import_control_center_xlsx(file_url):
    """Import master data from CONTROL_CENTER.xlsx uploaded to Frappe."""
    import openpyxl

    file_path = frappe.get_site_path("public", file_url.lstrip("/"))
    wb = openpyxl.load_workbook(file_path, data_only=True)
    results = {}

    results["areas"] = _import_areas(wb["04_AREA_MASTER"])
    results["teams"] = _import_teams(wb["07_TEAM_MASTER"])
    results["subcontractors"] = _import_subcontractors(wb["08_SUBCONTRACTOR_MASTER"])
    results["projects"] = _import_projects(wb["03_PROJECT_DOMAIN_MASTER"])
    results["customer_items"] = _import_customer_items(wb["12_CUSTOMER_ITEM_MASTER"])
    results["activity_costs"] = _import_activity_costs(wb["15_ACTIVITY_COST_MASTER"])
    results["subcontract_costs"] = _import_subcontract_costs(wb["16_SUBCONTRACT_COST_MASTER"])
    results["visit_multipliers"] = _import_visit_multipliers(wb["17_VISIT_MULTIPLIER_MASTER"])

    frappe.db.commit()
    return results


def _import_areas(ws):
    created = 0
    for row in ws.iter_rows(min_row=3, values_only=True):
        code, name = row[0], row[1]
        if not code:
            continue
        if not frappe.db.exists("Area Master", str(code)):
            frappe.get_doc({
                "doctype": "Area Master",
                "area_code": str(code),
                "area_name": str(name or code),
            }).insert(ignore_permissions=True)
            created += 1
    return {"created": created}


def _import_teams(ws):
    created = 0
    for row in ws.iter_rows(min_row=3, values_only=True):
        team_id, team_name, im, team_type, subcontractor, status, daily_cost_applies, daily_cost = (
            row[0], row[1], row[2], row[3], row[4], row[5], row[6], row[7]
        )
        if not team_id:
            continue
        if not frappe.db.exists("INET Team", str(team_id)):
            frappe.get_doc({
                "doctype": "INET Team",
                "team_id": str(team_id),
                "team_name": str(team_name or ""),
                "im": str(im or ""),
                "team_type": str(team_type or "INET"),
                "subcontractor": str(subcontractor or ""),
                "status": "Active" if str(status or "").strip().lower() == "active" else "Inactive",
                "daily_cost_applies": 1 if str(daily_cost_applies or "").strip().lower() == "yes" else 0,
                "daily_cost": flt(daily_cost or 1000),
            }).insert(ignore_permissions=True)
            created += 1
    return {"created": created}


def _import_subcontractors(ws):
    created = 0
    for row in ws.iter_rows(min_row=3, values_only=True):
        name_val, type_val, margin, payout, contract, status = (
            row[0], row[1], row[2], row[3], row[4], row[5]
        )
        if not name_val:
            continue
        if not frappe.db.exists("Subcontractor Master", str(name_val)):
            frappe.get_doc({
                "doctype": "Subcontractor Master",
                "subcontractor_name": str(name_val),
                "type": str(type_val or "SUB"),
                "inet_margin_pct": flt(margin or 0) * 100,
                "sub_payout_pct": flt(payout or 0) * 100,
                "contract_model": str(contract or ""),
                "status": "Active" if str(status or "").strip().lower() == "active" else "Inactive",
                "approved_flag": 1,
            }).insert(ignore_permissions=True)
            created += 1
    return {"created": created}


def _import_projects(ws):
    created = 0
    for row in ws.iter_rows(min_row=3, values_only=True):
        code, name_val, domain, customer, huawei_im, im, active = (
            row[0], row[1], row[2], row[3], row[4], row[5], row[6]
        )
        if not code:
            continue
        if not frappe.db.exists("Project Control Center", str(code)):
            frappe.get_doc({
                "doctype": "Project Control Center",
                "project_code": str(code),
                "project_name": str(name_val or ""),
                "project_domain": str(domain or ""),
                "customer": str(customer or ""),
                "huawei_im": str(huawei_im or ""),
                "implementation_manager": str(im or ""),
                "active_flag": "Yes" if str(active or "").strip().lower() == "yes" else "No",
                "project_status": "Active" if str(active or "").strip().lower() == "yes" else "On Hold",
            }).insert(ignore_permissions=True)
            created += 1
    return {"created": created}


def _import_customer_items(ws):
    created = 0
    for row in ws.iter_rows(min_row=5, values_only=True):
        customer, item_code, activity_type, _, domain, desc, unit, std_rate, hard_rate, _, _, active = (
            row[0], row[1], row[2], row[3], row[4], row[5], row[6], row[7], row[8], row[9], row[10], row[11]
        )
        if not item_code:
            continue
        frappe.get_doc({
            "doctype": "Customer Item Master",
            "customer": str(customer or ""),
            "item_code": str(item_code),
            "customer_activity_type": str(activity_type or ""),
            "domain": str(domain or ""),
            "item_description": str(desc or ""),
            "unit_type": str(unit or ""),
            "standard_rate_sar": flt(std_rate or 0),
            "hard_rate_sar": flt(hard_rate or 0),
            "active_flag": 1 if str(active or "").strip().lower() == "yes" else 0,
        }).insert(ignore_permissions=True)
        created += 1
    return {"created": created}


def _import_activity_costs(ws):
    created = 0
    for row in ws.iter_rows(min_row=4, values_only=True):
        code, activity, category, cost, cost_type, _, billing_type, _, active = (
            row[0], row[1], row[2], row[3], row[4], row[5], row[6], row[7], row[8]
        )
        if not code:
            continue
        if not frappe.db.exists("Activity Cost Master", str(code)):
            frappe.get_doc({
                "doctype": "Activity Cost Master",
                "activity_code": str(code),
                "standard_activity": str(activity or ""),
                "category": str(category or ""),
                "base_cost_sar": flt(cost or 0),
                "cost_type": str(cost_type or "Fixed"),
                "billing_type": str(billing_type or "Billable"),
                "active_flag": 1 if str(active or "").strip().lower() == "yes" else 0,
            }).insert(ignore_permissions=True)
            created += 1
    return {"created": created}


def _import_subcontract_costs(ws):
    created = 0
    for row in ws.iter_rows(min_row=4, values_only=True):
        sub, code, region, contract, cost, cost_type, eff_from, eff_to, active = (
            row[0], row[1], row[2], row[3], row[4], row[5], row[6], row[7], row[8]
        )
        if not sub or not code:
            continue
        frappe.get_doc({
            "doctype": "Subcontract Cost Master",
            "subcontractor": str(sub),
            "activity_code": str(code),
            "region_type": str(region or "Standard"),
            "expected_cost_sar": flt(cost or 0),
            "effective_from": str(eff_from or "2026-01-01"),
            "effective_to": str(eff_to or "2028-12-31"),
            "active_flag": 1 if str(active or "").strip().lower() == "yes" else 0,
        }).insert(ignore_permissions=True)
        created += 1
    return {"created": created}


def _import_visit_multipliers(ws):
    created = 0
    for row in ws.iter_rows(min_row=4, values_only=True):
        visit_type, multiplier, notes = row[0], row[1], row[2]
        if not visit_type:
            continue
        if not frappe.db.exists("Visit Multiplier Master", str(visit_type)):
            frappe.get_doc({
                "doctype": "Visit Multiplier Master",
                "visit_type": str(visit_type),
                "multiplier": flt(multiplier or 1),
                "notes": str(notes or ""),
            }).insert(ignore_permissions=True)
            created += 1
    return {"created": created}
```

- [ ] **Step 2: Test import via bench console**

Upload CONTROL_CENTER.xlsx to the site via Frappe file manager first. Then:

Run: `cd ~/frappe-bench && bench --site mysite.local console`
```python
from inet_app.api.data_import import import_control_center_xlsx
result = import_control_center_xlsx("/files/CONTROL_CENTER.xlsx")
print(result)
```
Expected: Counts showing records created for each master table.

- [ ] **Step 3: Verify imported data**

```python
print(frappe.db.count("Area Master"))       # Expected: 7
print(frappe.db.count("INET Team"))         # Expected: ~62
print(frappe.db.count("Customer Item Master"))  # Expected: ~816
```

- [ ] **Step 4: Commit**

```bash
git add inet_app/api/data_import.py
git commit -m "feat: add master data import script for CONTROL_CENTER.xlsx"
```

---

## Phase 2: Pipeline Doctypes (Tasks 8–11)

### Task 8: PO Dispatch Doctype

**Files:**
- Create: `inet_app/inet_app/doctype/po_dispatch/__init__.py`
- Create: `inet_app/inet_app/doctype/po_dispatch/po_dispatch.json`
- Create: `inet_app/inet_app/doctype/po_dispatch/po_dispatch.py`

- [ ] **Step 1: Create `__init__.py`**

Empty file.

- [ ] **Step 2: Create doctype JSON**

```json
{
  "actions": [],
  "autoname": "format:SYS-.YYYY.-.#####",
  "creation": "2026-04-04 00:00:00.000000",
  "doctype": "DocType",
  "engine": "InnoDB",
  "field_order": [
    "system_id", "po_intake", "po_no", "po_line_no",
    "item_code", "item_description", "qty", "rate", "line_amount",
    "section_assignment",
    "project_code", "customer", "im", "team",
    "target_month", "planning_mode", "dispatch_status",
    "section_site",
    "center_area", "site_code", "site_name"
  ],
  "fields": [
    {"fieldname": "system_id", "fieldtype": "Data", "label": "System ID", "read_only": 1, "in_list_view": 1},
    {"fieldname": "po_intake", "fieldtype": "Link", "label": "PO Intake", "options": "PO Intake"},
    {"fieldname": "po_no", "fieldtype": "Data", "label": "PO No.", "in_list_view": 1},
    {"fieldname": "po_line_no", "fieldtype": "Int", "label": "PO Line No."},
    {"fieldname": "item_code", "fieldtype": "Data", "label": "Item Code", "in_list_view": 1},
    {"fieldname": "item_description", "fieldtype": "Small Text", "label": "Item Description"},
    {"fieldname": "qty", "fieldtype": "Float", "label": "Qty"},
    {"fieldname": "rate", "fieldtype": "Currency", "label": "Rate (SAR)"},
    {"fieldname": "line_amount", "fieldtype": "Currency", "label": "Line Amount (SAR)", "in_list_view": 1},
    {"fieldname": "section_assignment", "fieldtype": "Section Break", "label": "Assignment"},
    {"fieldname": "project_code", "fieldtype": "Link", "label": "Project Code", "options": "Project Control Center", "in_list_view": 1},
    {"fieldname": "customer", "fieldtype": "Data", "label": "Customer"},
    {"fieldname": "im", "fieldtype": "Data", "label": "Implementation Manager", "in_list_view": 1},
    {"fieldname": "team", "fieldtype": "Data", "label": "Team"},
    {"fieldname": "target_month", "fieldtype": "Date", "label": "Target Month"},
    {"fieldname": "planning_mode", "fieldtype": "Select", "label": "Planning Mode", "options": "Plan\nDirect", "default": "Plan"},
    {"fieldname": "dispatch_status", "fieldtype": "Select", "label": "Status", "options": "Pending\nDispatched\nPlanned\nCompleted\nCancelled", "default": "Pending", "in_list_view": 1},
    {"fieldname": "section_site", "fieldtype": "Section Break", "label": "Site Details"},
    {"fieldname": "center_area", "fieldtype": "Data", "label": "Center Area"},
    {"fieldname": "site_code", "fieldtype": "Data", "label": "Site Code"},
    {"fieldname": "site_name", "fieldtype": "Data", "label": "Site Name"}
  ],
  "index_web_pages_for_search": 0,
  "istable": 0,
  "links": [],
  "modified": "2026-04-04 00:00:00.000000",
  "modified_by": "Administrator",
  "module": "Inet App",
  "name": "PO Dispatch",
  "naming_rule": "Expression (old style)",
  "owner": "Administrator",
  "permissions": [
    {
      "create": 1, "delete": 1, "email": 1, "export": 1,
      "print": 1, "read": 1, "report": 1, "role": "System Manager",
      "share": 1, "write": 1
    }
  ],
  "sort_field": "modified",
  "sort_order": "DESC",
  "track_changes": 1
}
```

- [ ] **Step 3: Create Python controller**

```python
# inet_app/inet_app/doctype/po_dispatch/po_dispatch.py
import frappe
from frappe.model.document import Document

class PODispatch(Document):
    def before_insert(self):
        # system_id is the autoname (name field) — copy it for easy reference
        pass

    def after_insert(self):
        self.system_id = self.name
        self.db_set("system_id", self.name)
```

- [ ] **Step 4: Run bench migrate and commit**

```bash
cd ~/frappe-bench && bench --site mysite.local migrate
git add inet_app/inet_app/doctype/po_dispatch/
git commit -m "feat: add PO Dispatch doctype with system_id tracking"
```

---

### Task 9: Rollout Plan Doctype

**Files:**
- Create: `inet_app/inet_app/doctype/rollout_plan/__init__.py`
- Create: `inet_app/inet_app/doctype/rollout_plan/rollout_plan.json`
- Create: `inet_app/inet_app/doctype/rollout_plan/rollout_plan.py`

- [ ] **Step 1: Create doctype JSON**

Fields: `system_id` (Data), `po_dispatch` (Link to PO Dispatch), `team` (Data), `plan_date` (Date, reqd), `visit_type` (Select: Work Done/Re-Visit/Extra Visit, default "Work Done"), `visit_number` (Int, default 1), `visit_multiplier` (Float, default 1.0), `target_amount` (Currency), `achieved_amount` (Currency), `completion_pct` (Percent), `plan_status` (Select: Planned/In Execution/Completed/Cancelled, default "Planned").

Autoname: `format:RPL-.YYYY.-.#####`. Module: "Inet App".

- [ ] **Step 2: Create Python controller**

```python
# inet_app/inet_app/doctype/rollout_plan/rollout_plan.py
import frappe
from frappe.model.document import Document
from frappe.utils import flt

class RolloutPlan(Document):
    def before_save(self):
        if not self.visit_multiplier:
            mult = frappe.db.get_value("Visit Multiplier Master", self.visit_type, "multiplier")
            self.visit_multiplier = flt(mult or 1.0)
        if self.target_amount and self.achieved_amount:
            target = flt(self.target_amount)
            if target > 0:
                self.completion_pct = round(flt(self.achieved_amount) / target * 100, 2)
```

- [ ] **Step 3: Run bench migrate and commit**

```bash
cd ~/frappe-bench && bench --site mysite.local migrate
git add inet_app/inet_app/doctype/rollout_plan/
git commit -m "feat: add Rollout Plan doctype with visit multiplier auto-calc"
```

---

### Task 10: Daily Execution Doctype

**Files:**
- Create: `inet_app/inet_app/doctype/daily_execution/__init__.py`
- Create: `inet_app/inet_app/doctype/daily_execution/daily_execution.json`
- Create: `inet_app/inet_app/doctype/daily_execution/daily_execution.py`

- [ ] **Step 1: Create doctype JSON**

Fields: `system_id` (Data), `rollout_plan` (Link to Rollout Plan), `team` (Data), `execution_date` (Date, reqd, default "Today"), `execution_status` (Select: In Progress/Completed/Hold/Cancelled/Postponed, default "In Progress"), `achieved_qty` (Float), `achieved_amount` (Currency), `gps_location` (Data), `photos` (Attach Image), `qc_status` (Select: Pending/Pass/Fail, default "Pending"), `revisit_flag` (Check), `remarks` (Small Text).

Autoname: `format:EXE-.YYYY.MM.-.#####`. Module: "Inet App".

- [ ] **Step 2: Create Python controller**

```python
# inet_app/inet_app/doctype/daily_execution/daily_execution.py
import frappe
from frappe.model.document import Document
from frappe.utils import flt

class DailyExecution(Document):
    def before_save(self):
        if self.execution_status == "Completed" and self.rollout_plan:
            # Update Rollout Plan achieved_amount
            rp = frappe.get_doc("Rollout Plan", self.rollout_plan)
            rp.achieved_amount = flt(rp.achieved_amount) + flt(self.achieved_amount)
            if flt(rp.target_amount) > 0:
                rp.completion_pct = round(flt(rp.achieved_amount) / flt(rp.target_amount) * 100, 2)
            rp.plan_status = "Completed" if rp.completion_pct >= 100 else "In Execution"
            rp.save(ignore_permissions=True)
```

- [ ] **Step 3: Run bench migrate and commit**

```bash
cd ~/frappe-bench && bench --site mysite.local migrate
git add inet_app/inet_app/doctype/daily_execution/
git commit -m "feat: add Daily Execution doctype with rollout plan linkage"
```

---

### Task 11: Work Done Doctype

**Files:**
- Create: `inet_app/inet_app/doctype/work_done/__init__.py`
- Create: `inet_app/inet_app/doctype/work_done/work_done.json`
- Create: `inet_app/inet_app/doctype/work_done/work_done.py`

- [ ] **Step 1: Create doctype JSON**

Fields: `system_id` (Data), `execution` (Link to Daily Execution), `item_code` (Data), `executed_qty` (Float), `billing_rate_sar` (Currency), `revenue_sar` (Currency), `team_cost_sar` (Currency), `subcontract_cost_sar` (Currency), `total_cost_sar` (Currency), `margin_sar` (Currency), `inet_margin_pct` (Percent), `billing_status` (Select: Pending/Invoiced/Closed, default "Pending").

Autoname: `format:WD-.YYYY.-.#####`. Module: "Inet App".

- [ ] **Step 2: Create Python controller**

```python
# inet_app/inet_app/doctype/work_done/work_done.py
import frappe
from frappe.model.document import Document
from frappe.utils import flt

class WorkDone(Document):
    def before_save(self):
        self.revenue_sar = flt(self.billing_rate_sar) * flt(self.executed_qty)
        self.total_cost_sar = flt(self.team_cost_sar) + flt(self.subcontract_cost_sar)
        self.margin_sar = flt(self.revenue_sar) - flt(self.total_cost_sar)
```

- [ ] **Step 3: Run bench migrate and commit**

```bash
cd ~/frappe-bench && bench --site mysite.local migrate
git add inet_app/inet_app/doctype/work_done/
git commit -m "feat: add Work Done doctype with revenue/cost/margin calculation"
```

---

## Phase 3: Command Center API (Tasks 12–14)

### Task 12: Pipeline Operations API

**Files:**
- Create: `inet_app/api/command_center.py`

- [ ] **Step 1: Create command_center.py with pipeline operations**

```python
# inet_app/api/command_center.py
import frappe
from frappe import _
from frappe.utils import cint, flt, nowdate, getdate, get_first_day, get_last_day


def _as_dict(doc):
    if isinstance(doc, str):
        return frappe._dict(frappe.parse_json(doc))
    return frappe._dict(doc or {})


@frappe.whitelist()
def upload_po_file(file_url):
    """Parse uploaded Huawei PO export (.xlsx) and return validated rows."""
    import openpyxl

    file_path = frappe.get_site_path("public", file_url.lstrip("/"))
    wb = openpyxl.load_workbook(file_path, data_only=True)
    ws = wb.active

    rows = []
    errors = []
    headers = [str(c.value or "").strip() for c in next(ws.iter_rows(min_row=1, max_row=1))]

    col_map = {}
    header_aliases = {
        "ID": "id", "PO Status": "po_status", "PO NO.": "po_no", "PO Line NO.": "po_line_no",
        "Shipment NO.": "shipment_no", "Site Name": "site_name", "Site Code": "site_code",
        "Item Code": "item_code", "Item Description": "item_description", "Unit": "unit",
        "Requested Qty": "qty", "Unit Price": "rate", "Line Amount": "line_amount",
        "Tax Rate": "tax_rate", "Payment Terms": "payment_terms",
        "Project Code": "project_code", "Project Name": "project_name",
        "Center Area": "center_area", "Publish Date": "publish_date",
        "Due Qty": "due_qty", "Billed Quantity": "billed_qty",
        "Start Date": "start_date", "End Date": "end_date",
        "Sub Contract NO.": "sub_contract_no", "Currency": "currency",
    }
    for idx, h in enumerate(headers):
        if h in header_aliases:
            col_map[header_aliases[h]] = idx

    for row_idx, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        def val(key):
            ci = col_map.get(key)
            return row[ci] if ci is not None and ci < len(row) else None

        po_no = val("po_no")
        item_code = val("item_code")
        project_code = val("project_code")

        if not po_no:
            continue

        row_errors = []
        if not item_code:
            row_errors.append("Missing Item Code")
        if not project_code:
            row_errors.append("Missing Project Code")

        qty = flt(val("qty") or 0)
        rate = flt(val("rate") or 0)
        if qty <= 0:
            row_errors.append("Qty must be > 0")

        parsed = {
            "row": row_idx,
            "po_no": str(po_no or ""),
            "po_line_no": cint(val("po_line_no") or 1),
            "shipment_no": str(val("shipment_no") or ""),
            "site_name": str(val("site_name") or ""),
            "site_code": str(val("site_code") or ""),
            "item_code": str(item_code or ""),
            "item_description": str(val("item_description") or ""),
            "unit": str(val("unit") or ""),
            "qty": qty,
            "rate": rate,
            "line_amount": flt(val("line_amount") or qty * rate),
            "project_code": str(project_code or ""),
            "project_name": str(val("project_name") or ""),
            "center_area": str(val("center_area") or ""),
            "publish_date": str(val("publish_date") or ""),
            "errors": row_errors,
        }
        if row_errors:
            errors.append(parsed)
        else:
            rows.append(parsed)

    return {"valid_rows": rows, "error_rows": errors, "total": len(rows) + len(errors)}


@frappe.whitelist()
def confirm_po_upload(rows):
    """Create PO Intake records from validated upload rows."""
    parsed = frappe.parse_json(rows) if isinstance(rows, str) else rows
    grouped = {}
    for row in parsed:
        po_no = row["po_no"]
        group = grouped.setdefault(po_no, {
            "po_no": po_no,
            "customer": "Huawei",
            "transaction_date": row.get("publish_date") or nowdate(),
            "schedule_date": row.get("publish_date") or nowdate(),
            "status": "New",
            "division": "",
            "center_area": row.get("center_area", ""),
            "publish_date": row.get("publish_date", ""),
            "lines": [],
        })
        group["lines"].append(row)

    created = []
    for po_no, data in grouped.items():
        if frappe.db.exists("PO Intake", {"po_no": po_no}):
            continue
        doc = frappe.get_doc({
            "doctype": "PO Intake",
            "po_no": data["po_no"],
            "customer": data["customer"],
            "transaction_date": data["transaction_date"],
            "schedule_date": data["schedule_date"],
            "status": "New",
            "center_area": data["center_area"],
            "publish_date": data["publish_date"],
        })
        for line in data["lines"]:
            doc.append("po_lines", {
                "po_line_no": line.get("po_line_no", 1),
                "shipment_number": line.get("shipment_no", ""),
                "site_code": line.get("site_code", ""),
                "site_name": line.get("site_name", ""),
                "item_code": line.get("item_code"),
                "item_description": line.get("item_description", ""),
                "qty": line.get("qty"),
                "rate": line.get("rate"),
                "uom": line.get("unit", ""),
                "project_code": line.get("project_code"),
                "area": line.get("center_area", ""),
                "po_line_status": "New",
            })
        doc.insert(ignore_permissions=True)
        created.append(doc.name)

    frappe.db.commit()
    return {"created": len(created), "names": created}


@frappe.whitelist()
def dispatch_po_lines(payload):
    """Create PO Dispatch records from PO Intake lines. Bulk operation."""
    data = frappe.parse_json(payload) if isinstance(payload, str) else payload
    lines = data.get("lines", [])
    team = data.get("team")
    target_month = data.get("target_month")
    planning_mode = data.get("planning_mode", "Plan")

    if not lines:
        frappe.throw(_("No lines selected for dispatch."))

    created = []
    for line in lines:
        po_intake_name = line.get("po_intake")
        item_code = line.get("item_code")
        project_code = line.get("project_code")

        # Auto-map IM from project → team master
        im = ""
        if team:
            im = frappe.db.get_value("INET Team", team, "im") or ""

        customer = ""
        if project_code and frappe.db.exists("Project Control Center", project_code):
            customer = frappe.db.get_value("Project Control Center", project_code, "customer") or ""

        doc = frappe.get_doc({
            "doctype": "PO Dispatch",
            "po_intake": po_intake_name,
            "po_no": line.get("po_no", ""),
            "po_line_no": cint(line.get("po_line_no", 1)),
            "item_code": item_code,
            "item_description": line.get("item_description", ""),
            "qty": flt(line.get("qty", 0)),
            "rate": flt(line.get("rate", 0)),
            "line_amount": flt(line.get("line_amount", 0)),
            "project_code": project_code,
            "customer": customer,
            "im": im,
            "team": team or line.get("team", ""),
            "target_month": target_month,
            "planning_mode": planning_mode,
            "dispatch_status": "Dispatched",
            "center_area": line.get("center_area", ""),
            "site_code": line.get("site_code", ""),
            "site_name": line.get("site_name", ""),
        })
        doc.insert(ignore_permissions=True)
        created.append(doc.name)

    frappe.db.commit()
    return {"created": len(created), "system_ids": created}


@frappe.whitelist()
def create_rollout_plans(payload):
    """Create Rollout Plan records from dispatched PO lines."""
    data = frappe.parse_json(payload) if isinstance(payload, str) else payload
    dispatches = data.get("dispatches", [])
    plan_date = data.get("plan_date", nowdate())
    visit_type = data.get("visit_type", "Work Done")

    mult = flt(frappe.db.get_value("Visit Multiplier Master", visit_type, "multiplier") or 1.0)

    created = []
    for d in dispatches:
        dispatch_name = d if isinstance(d, str) else d.get("name")
        dispatch = frappe.get_doc("PO Dispatch", dispatch_name)

        target_amount = flt(dispatch.line_amount) * mult

        doc = frappe.get_doc({
            "doctype": "Rollout Plan",
            "system_id": dispatch.system_id or dispatch.name,
            "po_dispatch": dispatch.name,
            "team": dispatch.team,
            "plan_date": plan_date,
            "visit_type": visit_type,
            "visit_number": 1,
            "visit_multiplier": mult,
            "target_amount": target_amount,
            "achieved_amount": 0,
            "completion_pct": 0,
            "plan_status": "Planned",
        })
        doc.insert(ignore_permissions=True)

        dispatch.dispatch_status = "Planned"
        dispatch.save(ignore_permissions=True)

        created.append(doc.name)

    frappe.db.commit()
    return {"created": len(created), "names": created}


@frappe.whitelist()
def update_execution(payload):
    """Field team submits execution update."""
    data = _as_dict(payload)
    name = data.get("name")

    if name and frappe.db.exists("Daily Execution", name):
        doc = frappe.get_doc("Daily Execution", name)
        doc.update({
            "execution_status": data.get("execution_status", doc.execution_status),
            "achieved_qty": flt(data.get("achieved_qty", doc.achieved_qty)),
            "achieved_amount": flt(data.get("achieved_amount", doc.achieved_amount)),
            "gps_location": data.get("gps_location", doc.gps_location),
            "qc_status": data.get("qc_status", doc.qc_status),
            "remarks": data.get("remarks", doc.remarks),
        })
        doc.save(ignore_permissions=True)
    else:
        rollout_plan = data.get("rollout_plan")
        if not rollout_plan:
            frappe.throw(_("rollout_plan is required for new execution."))
        rp = frappe.get_doc("Rollout Plan", rollout_plan)
        doc = frappe.get_doc({
            "doctype": "Daily Execution",
            "system_id": rp.system_id,
            "rollout_plan": rollout_plan,
            "team": data.get("team", rp.team),
            "execution_date": data.get("execution_date", nowdate()),
            "execution_status": data.get("execution_status", "In Progress"),
            "achieved_qty": flt(data.get("achieved_qty", 0)),
            "achieved_amount": flt(data.get("achieved_amount", 0)),
            "gps_location": data.get("gps_location", ""),
            "qc_status": data.get("qc_status", "Pending"),
            "remarks": data.get("remarks", ""),
        })
        doc.insert(ignore_permissions=True)

    frappe.db.commit()
    return {"name": doc.name, "status": doc.execution_status}


@frappe.whitelist()
def generate_work_done(execution_name):
    """Create Work Done record from a completed Daily Execution."""
    exe = frappe.get_doc("Daily Execution", execution_name)
    if exe.execution_status != "Completed":
        frappe.throw(_("Execution must be Completed to generate Work Done."))

    if frappe.db.exists("Work Done", {"execution": execution_name}):
        return {"name": frappe.db.get_value("Work Done", {"execution": execution_name}, "name")}

    # Get dispatch data for item_code and rates
    dispatch = None
    if exe.rollout_plan:
        rp = frappe.get_doc("Rollout Plan", exe.rollout_plan)
        if rp.po_dispatch:
            dispatch = frappe.get_doc("PO Dispatch", rp.po_dispatch)

    item_code = dispatch.item_code if dispatch else ""
    center_area = dispatch.center_area if dispatch else ""

    # Determine billing rate from Customer Item Master
    billing_rate = 0
    if item_code:
        is_hard = "Hard" in (center_area or "")
        rate_field = "hard_rate_sar" if is_hard else "standard_rate_sar"
        cim = frappe.db.get_value(
            "Customer Item Master",
            {"item_code": item_code, "active_flag": 1},
            rate_field,
        )
        billing_rate = flt(cim or 0)
    if not billing_rate and dispatch:
        billing_rate = flt(dispatch.rate)

    # Team cost
    team_cost = 0
    if exe.team:
        daily_cost = flt(frappe.db.get_value("INET Team", exe.team, "daily_cost") or 0)
        team_cost = daily_cost  # Prorated per execution

    # Subcontract cost
    sub_cost = 0
    if dispatch and item_code:
        team_type = frappe.db.get_value("INET Team", exe.team, "team_type") or "INET"
        if team_type == "SUB":
            sub = frappe.db.get_value("INET Team", exe.team, "subcontractor") or ""
            if sub:
                sub_cost = flt(frappe.db.get_value(
                    "Subcontract Cost Master",
                    {"subcontractor": sub, "activity_code": item_code, "active_flag": 1},
                    "expected_cost_sar",
                ))

    inet_margin_pct = 0
    if exe.team:
        team_type = frappe.db.get_value("INET Team", exe.team, "team_type") or "INET"
        if team_type == "SUB":
            sub = frappe.db.get_value("INET Team", exe.team, "subcontractor") or ""
            if sub:
                inet_margin_pct = flt(frappe.db.get_value(
                    "Subcontractor Master", sub, "inet_margin_pct"
                ))

    doc = frappe.get_doc({
        "doctype": "Work Done",
        "system_id": exe.system_id,
        "execution": execution_name,
        "item_code": item_code,
        "executed_qty": flt(exe.achieved_qty),
        "billing_rate_sar": billing_rate,
        "team_cost_sar": team_cost,
        "subcontract_cost_sar": sub_cost,
        "inet_margin_pct": inet_margin_pct,
        "billing_status": "Pending",
    })
    doc.insert(ignore_permissions=True)
    frappe.db.commit()
    return {"name": doc.name}
```

- [ ] **Step 2: Commit**

```bash
git add inet_app/api/command_center.py
git commit -m "feat: add command center API with pipeline operations"
```

---

### Task 13: Dashboard Aggregation API

**Files:**
- Modify: `inet_app/api/command_center.py` (append to existing file)

- [ ] **Step 1: Add dashboard aggregation endpoints**

Append to `inet_app/api/command_center.py`:

```python
@frappe.whitelist()
def get_command_dashboard():
    """Return all data for the Command Dashboard in one API call."""
    today = getdate(nowdate())
    month_start = get_first_day(today)
    month_end = get_last_day(today)

    # --- KPI Row 1: Operational Overview ---
    total_open_po = flt(frappe.db.sql(
        "SELECT IFNULL(SUM(line_amount), 0) FROM `tabPO Dispatch` WHERE dispatch_status NOT IN ('Completed','Cancelled')"
    )[0][0])

    all_teams = frappe.get_all("INET Team", filters={"status": "Active"}, fields=["team_id", "team_name", "im", "team_type", "daily_cost"])
    all_team_ids = [t.team_id for t in all_teams]

    teams_with_execution = frappe.db.sql_list(
        "SELECT DISTINCT team FROM `tabDaily Execution` WHERE execution_date = %s AND execution_status != 'Cancelled'",
        today,
    )
    active_teams = len([t for t in teams_with_execution if t in all_team_ids])
    idle_teams = len(all_team_ids) - active_teams

    planned_activities = frappe.db.count("Rollout Plan", {"plan_status": "Planned"})
    closed_activities = frappe.db.count("Daily Execution", {
        "execution_status": "Completed",
        "execution_date": ["between", [str(month_start), str(month_end)]],
    })
    revisits = frappe.db.count("Rollout Plan", {
        "visit_type": "Re-Visit",
        "plan_date": ["between", [str(month_start), str(month_end)]],
    })

    # --- KPI Row 2 & 3: INET and Sub-Con Performance ---
    inet_teams = [t for t in all_teams if t.team_type == "INET"]
    sub_teams = [t for t in all_teams if t.team_type == "SUB"]

    inet_monthly_cost = sum(flt(t.daily_cost) * 26 for t in inet_teams)  # ~26 working days
    sub_monthly_cost = sum(flt(t.daily_cost) * 26 for t in sub_teams)

    # Revenue from Work Done this month
    inet_team_ids = [t.team_id for t in inet_teams]
    sub_team_ids = [t.team_id for t in sub_teams]

    def _revenue_for_teams(team_ids):
        if not team_ids:
            return 0
        placeholders = ", ".join(["%s"] * len(team_ids))
        return flt(frappe.db.sql(
            f"""SELECT IFNULL(SUM(wd.revenue_sar), 0)
                FROM `tabWork Done` wd
                JOIN `tabDaily Execution` ex ON wd.execution = ex.name
                WHERE ex.team IN ({placeholders})
                AND ex.execution_date BETWEEN %s AND %s""",
            tuple(team_ids) + (str(month_start), str(month_end)),
        )[0][0])

    def _cost_for_teams(team_ids):
        if not team_ids:
            return 0
        placeholders = ", ".join(["%s"] * len(team_ids))
        return flt(frappe.db.sql(
            f"""SELECT IFNULL(SUM(wd.total_cost_sar), 0)
                FROM `tabWork Done` wd
                JOIN `tabDaily Execution` ex ON wd.execution = ex.name
                WHERE ex.team IN ({placeholders})
                AND ex.execution_date BETWEEN %s AND %s""",
            tuple(team_ids) + (str(month_start), str(month_end)),
        )[0][0])

    inet_achieved = _revenue_for_teams(inet_team_ids)
    sub_achieved = _revenue_for_teams(sub_team_ids)
    sub_expense = _cost_for_teams(sub_team_ids)

    # Targets from system settings (sum of project monthly_target grouped by IM type)
    inet_monthly_target = flt(frappe.db.sql(
        "SELECT IFNULL(SUM(monthly_target), 0) FROM `tabProject Control Center` WHERE active_flag = 'Yes'"
    )[0][0]) or 465000  # fallback default

    # Prorate target to today
    import calendar
    days_in_month = calendar.monthrange(today.year, today.month)[1]
    day_of_month = today.day
    inet_target_today = round(inet_monthly_target * day_of_month / days_in_month, 2)
    inet_gap_today = inet_target_today - inet_achieved

    sub_monthly_target = 354000  # from Excel default
    sub_target_today = round(sub_monthly_target * day_of_month / days_in_month, 2)

    # Sub-Con margin
    inet_margin_sub = 0
    if sub_achieved > 0:
        avg_margin = flt(frappe.db.sql(
            "SELECT AVG(inet_margin_pct) FROM `tabSubcontractor Master` WHERE type = 'SUB' AND status = 'Active'"
        )[0][0]) or 20
        inet_margin_sub = round(sub_achieved * avg_margin / 100, 2)

    # --- KPI Row 4: Company Summary ---
    company_target = inet_monthly_target + sub_monthly_target
    total_achieved = inet_achieved + sub_achieved
    company_gap = company_target - total_achieved
    total_cost = inet_monthly_cost + sub_expense
    profit_loss = total_achieved - total_cost
    coverage_pct = round(total_achieved / company_target * 100, 2) if company_target else 0

    # --- Bottom Panels ---
    # Top 5 teams by achievement
    top_teams = frappe.db.sql("""
        SELECT ex.team, t.team_name,
            IFNULL(SUM(wd.revenue_sar), 0) as achieved,
            0 as target
        FROM `tabWork Done` wd
        JOIN `tabDaily Execution` ex ON wd.execution = ex.name
        LEFT JOIN `tabINET Team` t ON ex.team = t.team_id
        WHERE ex.execution_date BETWEEN %s AND %s
        GROUP BY ex.team
        ORDER BY achieved DESC
        LIMIT 5
    """, (str(month_start), str(month_end)), as_dict=True)

    # IM Performance
    im_performance = frappe.db.sql("""
        SELECT t.im,
            COUNT(DISTINCT t.team_id) as teams,
            IFNULL(SUM(wd.revenue_sar), 0) as revenue,
            0 as team_cost,
            0 as profit
        FROM `tabWork Done` wd
        JOIN `tabDaily Execution` ex ON wd.execution = ex.name
        JOIN `tabINET Team` t ON ex.team = t.team_id
        WHERE ex.execution_date BETWEEN %s AND %s
        GROUP BY t.im
    """, (str(month_start), str(month_end)), as_dict=True)

    # Calculate team costs for each IM
    for im_row in im_performance:
        im_teams = [t for t in all_teams if t.im == im_row.im]
        im_row["team_cost"] = sum(flt(t.daily_cost) * day_of_month for t in im_teams)
        im_row["profit"] = flt(im_row["revenue"]) - flt(im_row["team_cost"])

    # Team status counts
    team_status = {
        "active": active_teams,
        "idle": idle_teams,
        "planned": frappe.db.count("Rollout Plan", {"plan_status": "Planned"}),
        "in_progress": frappe.db.count("Rollout Plan", {"plan_status": "In Execution"}),
    }

    # Action Watchlist
    missed_activities = frappe.db.count("Rollout Plan", {
        "plan_status": "Planned",
        "plan_date": ["<", str(today)],
    })

    watchlist = [
        {"indicator": "Idle Teams Today", "current": idle_teams, "target": 0, "status": "Optimized" if idle_teams <= 5 else "Recover"},
        {"indicator": "Missed Activities", "current": missed_activities, "target": 0, "status": "Recover" if missed_activities > 0 else "Optimized"},
        {"indicator": "Schedule Gap", "current": missed_activities, "target": "-", "status": "Behind" if missed_activities > 10 else "Normal"},
        {"indicator": "Forecast Gap", "current": round(company_gap, 2), "target": ">=0", "status": "Ahead" if company_gap <= 0 else "Behind"},
        {"indicator": "Real-Time P/L", "current": round(profit_loss, 2), "target": ">=0", "status": "Monitor" if profit_loss < 0 else "Optimized"},
        {"indicator": "Re-Visits", "current": revisits, "target": "<=5", "status": "Normal" if revisits <= 5 else "Recover"},
    ]

    return {
        "operational": {
            "total_open_po": total_open_po,
            "active_teams": active_teams,
            "idle_teams": idle_teams,
            "planned_activities": planned_activities,
            "closed_activities": closed_activities,
            "revisits": revisits,
        },
        "inet": {
            "active_inet_teams": len(inet_teams),
            "inet_monthly_cost": inet_monthly_cost,
            "inet_monthly_target": inet_monthly_target,
            "inet_target_today": inet_target_today,
            "inet_achieved": inet_achieved,
            "inet_gap_today": inet_gap_today,
        },
        "subcon": {
            "active_sub_teams": len(sub_teams),
            "sub_target": sub_monthly_target,
            "sub_revenue": sub_achieved,
            "sub_expense": sub_expense,
            "inet_margin_sub": inet_margin_sub,
            "sub_gap": sub_monthly_target - sub_achieved,
        },
        "company": {
            "company_target": company_target,
            "total_achieved": total_achieved,
            "company_gap": company_gap,
            "total_cost": total_cost,
            "profit_loss": profit_loss,
            "coverage_pct": coverage_pct,
        },
        "top_teams": top_teams,
        "im_performance": im_performance,
        "team_status": team_status,
        "watchlist": watchlist,
        "last_updated": frappe.utils.now(),
    }


@frappe.whitelist()
def get_im_dashboard(im=None):
    """Filtered dashboard for a single Implementation Manager."""
    if not im:
        # Auto-detect from logged-in user's full_name
        im = frappe.db.get_value("User", frappe.session.user, "full_name")

    today = getdate(nowdate())
    month_start = get_first_day(today)
    month_end = get_last_day(today)

    my_teams = frappe.get_all("INET Team", filters={"im": im, "status": "Active"},
                              fields=["team_id", "team_name", "team_type", "daily_cost"])
    my_team_ids = [t.team_id for t in my_teams]

    # My team execution today
    teams_with_execution = []
    if my_team_ids:
        placeholders = ", ".join(["%s"] * len(my_team_ids))
        teams_with_execution = frappe.db.sql_list(
            f"SELECT DISTINCT team FROM `tabDaily Execution` WHERE execution_date = %s AND team IN ({placeholders})",
            [str(today)] + my_team_ids,
        )

    # Revenue this month
    my_revenue = 0
    my_cost = 0
    if my_team_ids:
        placeholders = ", ".join(["%s"] * len(my_team_ids))
        my_revenue = flt(frappe.db.sql(
            f"""SELECT IFNULL(SUM(wd.revenue_sar), 0)
                FROM `tabWork Done` wd
                JOIN `tabDaily Execution` ex ON wd.execution = ex.name
                WHERE ex.team IN ({placeholders})
                AND ex.execution_date BETWEEN %s AND %s""",
            tuple(my_team_ids) + (str(month_start), str(month_end)),
        )[0][0])

    import calendar
    day_of_month = today.day
    my_cost = sum(flt(t.daily_cost) * day_of_month for t in my_teams)

    # My projects
    my_projects = frappe.get_all("Project Control Center",
                                  filters={"implementation_manager": im, "active_flag": "Yes"},
                                  fields=["name", "project_code", "project_name", "project_status",
                                          "budget_amount", "actual_cost", "completion_percentage"])

    return {
        "im": im,
        "teams": my_teams,
        "active_teams": len(teams_with_execution),
        "idle_teams": len(my_team_ids) - len(teams_with_execution),
        "revenue": my_revenue,
        "cost": my_cost,
        "profit": my_revenue - my_cost,
        "projects": my_projects,
    }


@frappe.whitelist()
def get_field_team_dashboard(team_id=None):
    """Today's work for a field team."""
    if not team_id:
        frappe.throw(_("team_id is required"))

    today = nowdate()
    plans = frappe.get_all("Rollout Plan",
                           filters={"team": team_id, "plan_date": today, "plan_status": ["in", ["Planned", "In Execution"]]},
                           fields=["name", "system_id", "po_dispatch", "plan_date", "visit_type",
                                   "target_amount", "achieved_amount", "completion_pct", "plan_status"])

    # Enrich with dispatch info
    for p in plans:
        if p.po_dispatch:
            d = frappe.db.get_value("PO Dispatch", p.po_dispatch,
                                     ["item_code", "item_description", "project_code", "site_name"], as_dict=True)
            p.update(d or {})

    # Existing executions today
    executions = frappe.get_all("Daily Execution",
                                 filters={"team": team_id, "execution_date": today},
                                 fields=["name", "rollout_plan", "execution_status", "achieved_qty",
                                          "achieved_amount", "qc_status"])

    return {"team_id": team_id, "date": today, "plans": plans, "executions": executions}
```

- [ ] **Step 2: Commit**

```bash
git add inet_app/api/command_center.py
git commit -m "feat: add dashboard aggregation APIs (command, IM, field team)"
```

---

### Task 14: Update hooks.py for modules.txt

**Files:**
- Modify: `inet_app/hooks.py`
- Modify: `inet_app/modules.txt`

- [ ] **Step 1: Verify modules.txt includes module**

Check `inet_app/modules.txt` contains "Inet App" (it should already). No change needed if present.

- [ ] **Step 2: Run bench migrate for all new doctypes**

Run: `cd ~/frappe-bench && bench --site mysite.local migrate`
Expected: All new doctypes created successfully.

- [ ] **Step 3: Run bench build**

Run: `cd ~/frappe-bench && bench build --app inet_app`
Expected: Build completes without errors.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: finalize Phase 2 backend — all pipeline doctypes and APIs ready"
```

---

## Phase 4: Frontend Rebuild (Tasks 15–22)

### Task 15: CSS Theme + New File Structure

**Files:**
- Create: `frontend/src/styles/theme.css`
- Create: `frontend/src/styles/dashboard.css`
- Create: `frontend/src/styles/pages.css`
- Delete content of: `frontend/src/styles.css` (replaced by imports)
- Modify: `frontend/src/main.jsx`

- [ ] **Step 1: Create `theme.css`** — Dark ops-center CSS variables, base reset, typography, form/table/button base styles, sidebar, topbar, badges, modal. All color variables use the dark palette from the spec (`#060d18` background, `#e8ecf4` text, `#7db8e8` labels, green/amber/red accents).

- [ ] **Step 2: Create `dashboard.css`** — KPI row grid, KPI card component, section labels, panel cards, mini-table, chart bar/donut, watchlist items, live-dot animation, auto-refresh timestamp.

- [ ] **Step 3: Create `pages.css`** — Operational page styles: PO upload dropzone, dispatch table, rollout planning cards, execution form, work done table, file upload component.

- [ ] **Step 4: Update `main.jsx`** to import the 3 new CSS files instead of `styles.css`:

```jsx
import './styles/theme.css';
import './styles/dashboard.css';
import './styles/pages.css';
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/styles/ frontend/src/main.jsx
git commit -m "feat: add dark ops-center CSS theme system"
```

---

### Task 16: Auth Context with Role Detection

**Files:**
- Modify: `frontend/src/context/AuthContext.jsx`
- Modify: `frontend/src/services/api.js`

- [ ] **Step 1: Add role-detection API call to `api.js`**

Add to `pmApi` object:
```javascript
getCommandDashboard: () => call("inet_app.api.command_center.get_command_dashboard"),
getIMDashboard: (im) => call("inet_app.api.command_center.get_im_dashboard", { im }),
getFieldTeamDashboard: (team_id) => call("inet_app.api.command_center.get_field_team_dashboard", { team_id }),
uploadPOFile: (file_url) => call("inet_app.api.command_center.upload_po_file", { file_url }),
confirmPOUpload: (rows) => call("inet_app.api.command_center.confirm_po_upload", { rows }),
dispatchPOLines: (payload) => call("inet_app.api.command_center.dispatch_po_lines", { payload }),
createRolloutPlans: (payload) => call("inet_app.api.command_center.create_rollout_plans", { payload }),
updateExecution: (payload) => call("inet_app.api.command_center.update_execution", { payload }),
generateWorkDone: (execution_name) => call("inet_app.api.command_center.generate_work_done", { execution_name }),
listTeams: (filters) => call("inet_app.api.command_center.list_teams", filters || {}),
```

- [ ] **Step 2: Update AuthContext to detect Admin/IM/Field role**

Add role detection after login: check if user has "System Manager" role → Admin. Otherwise check INET Team master for IM match → IM role. Otherwise check team membership → Field role.

Store `role` ("admin" | "im" | "field") and `teamId`/`imName` in context state.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/context/AuthContext.jsx frontend/src/services/api.js
git commit -m "feat: add role detection (admin/im/field) and command center API client"
```

---

### Task 17: App.jsx with Role-Based Routing

**Files:**
- Modify: `frontend/src/App.jsx`

- [ ] **Step 1: Rewrite App.jsx routing**

```jsx
// Role-based routing:
// Admin → /dashboard (Command), /po-upload, /dispatch, /planning, /execution, /work-done, /reports, /masters
// IM → /im-dashboard
// Field → /today, /execute
// All → /login
```

Route structure uses `role` from AuthContext to render the appropriate set of routes. Admin sees full nav, IM sees their dashboard, Field sees today's work.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/App.jsx
git commit -m "feat: role-based routing for admin/im/field views"
```

---

### Task 18: AppShell (Dark Sidebar + Role Nav)

**Files:**
- Modify: `frontend/src/components/AppShell.jsx`

- [ ] **Step 1: Rebuild AppShell with dark theme**

Dark sidebar (`#060d18`) with nav items based on user role. Admin sees: Dashboard, PO Upload, Dispatch, Planning, Execution, Work Done, Reports, Masters. IM sees: My Dashboard. Field sees: Today's Work, Execute.

Live-dot indicator in header area. User menu at bottom.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/AppShell.jsx
git commit -m "feat: dark ops-center sidebar with role-based navigation"
```

---

### Task 19: Command Dashboard Page

**Files:**
- Create: `frontend/src/pages/admin/CommandDashboard.jsx`
- Create: `frontend/src/components/KPICard.jsx`
- Create: `frontend/src/components/MiniTable.jsx`
- Create: `frontend/src/components/Charts.jsx`

- [ ] **Step 1: Create KPICard component**

Reusable card: accepts `label`, `value`, `colorClass` (text-green/text-red/text-amber). Renders the dark-themed KPI cell.

- [ ] **Step 2: Create MiniTable component**

Accepts `columns` (array of {label, key, align}) and `rows` (array of objects). Renders compact dark table.

- [ ] **Step 3: Create Charts component**

`BarChart`: accepts `bars` array of {label, value, color, maxValue}. Renders proportional bars.
`DonutChart`: accepts `value` (0-100) and `label`. Renders SVG donut.

- [ ] **Step 4: Create CommandDashboard.jsx**

Full dashboard matching the mockup. Calls `pmApi.getCommandDashboard()` on mount and every 60 seconds via `setInterval`. Renders:
- Header with live dot and timestamp
- 4 KPI rows using KPICard grid
- 4 bottom panels (Top Teams, IM Performance, Team Status chart, Action Watchlist)

- [ ] **Step 5: Build and test**

Run: `cd frontend && npm run build`
Expected: Build succeeds. Open http://mysite.local:8001/pms/ — should show dark dashboard (with zero data until import runs).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/admin/CommandDashboard.jsx frontend/src/components/KPICard.jsx frontend/src/components/MiniTable.jsx frontend/src/components/Charts.jsx
git commit -m "feat: Command Dashboard with KPI rows, team snapshot, and watchlist"
```

---

### Task 20: PO Upload Page

**Files:**
- Create: `frontend/src/pages/admin/POUpload.jsx`
- Create: `frontend/src/components/FileUpload.jsx`

- [ ] **Step 1: Create FileUpload component**

Drag-drop zone that accepts .xlsx/.csv files. On drop, uploads file to Frappe via `/api/method/upload_file`, returns the file URL. Dark-themed with dashed border.

- [ ] **Step 2: Create POUpload.jsx**

Page flow:
1. Upload file → calls `pmApi.uploadPOFile(file_url)`
2. Show validation results: valid rows count, error rows with details
3. Admin reviews and clicks "Confirm Import"
4. Calls `pmApi.confirmPOUpload(valid_rows)` → shows success count

Table showing parsed rows with status indicators (green check / red X).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/admin/POUpload.jsx frontend/src/components/FileUpload.jsx
git commit -m "feat: PO Upload page with drag-drop and validation preview"
```

---

### Task 21: PO Dispatch + Rollout Planning Pages

**Files:**
- Create: `frontend/src/pages/admin/PODispatch.jsx`
- Create: `frontend/src/pages/admin/RolloutPlanning.jsx`

- [ ] **Step 1: Create PODispatch.jsx**

Table of PO Intake lines with status "New". Checkboxes for bulk selection. Sidebar/modal for assigning: Team (dropdown from INET Team), Target Month, Planning Mode. Calls `pmApi.dispatchPOLines()`.

- [ ] **Step 2: Create RolloutPlanning.jsx**

Table of PO Dispatch records with status "Dispatched". Assign Plan Date, Visit Type dropdown. Calls `pmApi.createRolloutPlans()`. Shows target amounts with visit multiplier applied.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/admin/PODispatch.jsx frontend/src/pages/admin/RolloutPlanning.jsx
git commit -m "feat: PO Dispatch and Rollout Planning admin pages"
```

---

### Task 22: IM Dashboard + Field Team Pages

**Files:**
- Create: `frontend/src/pages/im/IMDashboard.jsx`
- Create: `frontend/src/pages/field/TodaysWork.jsx`
- Create: `frontend/src/pages/field/ExecutionForm.jsx`

- [ ] **Step 1: Create IMDashboard.jsx**

Calls `pmApi.getIMDashboard(imName)`. Renders: My KPI cards (revenue, cost, profit, team count), My Teams table, My Projects list. Same dark theme, same KPICard/MiniTable components.

- [ ] **Step 2: Create TodaysWork.jsx**

Calls `pmApi.getFieldTeamDashboard(teamId)`. Shows today's planned activities as cards. Each card shows: item description, site, target amount, status. Click to open execution form.

- [ ] **Step 3: Create ExecutionForm.jsx**

Form for a single rollout plan item. Fields: Execution Status (dropdown), Achieved Qty (number), GPS Location (auto-capture button), Remarks (textarea). Submit calls `pmApi.updateExecution()`. On "Completed", also calls `pmApi.generateWorkDone()`.

- [ ] **Step 4: Build and verify**

Run: `cd frontend && npm run build`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/im/ frontend/src/pages/field/
git commit -m "feat: IM Dashboard and Field Team execution pages"
```

---

### Task 23: Login Page Retheme + Final Integration

**Files:**
- Modify: `frontend/src/pages/Login.jsx`

- [ ] **Step 1: Retheme Login.jsx**

Update the login page to use the dark ops-center palette. Left panel background matches `#060d18`. Right panel uses dark card. Update gradient, text colors, and button to match theme.

- [ ] **Step 2: Final build + test**

Run: `cd frontend && npm run build`
Then: `cd ~/frappe-bench && bench build --app inet_app`

Verify at http://mysite.local:8001/pms/:
- Login page renders with dark theme
- After login as Administrator → Command Dashboard appears
- All KPI rows show (with zero/default data)
- Navigation sidebar works for all pages
- Auto-refresh timer ticks every 60s

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: complete INET Operations Command Center rebuild"
```

---

## Phase 5: Data Import + Smoke Test (Task 24)

### Task 24: Import Master Data and End-to-End Test

- [ ] **Step 1: Upload CONTROL_CENTER.xlsx to Frappe**

Via Frappe desk at http://mysite.local:8001 → File Manager → Upload `/Users/sayanthns/Downloads/CONTROL_CENTER.xlsx`.

- [ ] **Step 2: Run master data import**

```bash
cd ~/frappe-bench && bench --site mysite.local console
```
```python
from inet_app.api.data_import import import_control_center_xlsx
result = import_control_center_xlsx("/files/CONTROL_CENTER.xlsx")
print(result)
frappe.db.commit()
```

- [ ] **Step 3: Upload a test PO file**

Upload `PURCHASE_ORDER_20260325003415.xlsx` via the PO Upload page in the portal. Verify:
- File parses correctly (17 rows)
- Validation shows green for valid rows
- Click "Confirm Import" creates PO Intake records

- [ ] **Step 4: Test pipeline flow**

1. Go to PO Dispatch → select imported lines → assign Team-01, target month → Dispatch
2. Go to Rollout Planning → select dispatched items → set plan date to today → Create Plans
3. Command Dashboard should now show data in KPI rows

- [ ] **Step 5: Verify dashboard**

Open http://mysite.local:8001/pms/dashboard
Expected: KPI cards show real numbers from imported data. Auto-refresh works. Bottom panels populate.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "chore: Phase 5 complete — master data imported and pipeline tested"
```
