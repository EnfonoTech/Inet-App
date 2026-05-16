# Material Management System — Implementation Plan

## Context

INET Telecom needs a material management system. Two material sources:
1. **Customer-Provided (Zero Valuation)**: Huawei sends daily Excel outbound files. Each row = one shipment. When Subcon = "INET", Warehouse Manager manually creates Material Receipt from the record.
2. **Company-Owned Stock (With Valuation)**: Standard Purchase Invoice/Purchase Receipt items.

Workflow: Huawei Excel Import → Store all data → Warehouse Manager creates Material Receipt for INET items → IM requests materials for POID → Stock Manager approves in Desk → Material Transfer to Team Warehouse → Work Complete → Material Issue (with POID as accounting dimension, DUID as inventory dimension).

---

## Phase 1: Huawei Outbound Import & Warehouse Manager Workspace

### Doctype: `Huawei Outbound Plan`

Stores ALL Excel rows (INET + competitors) for analytics. Uses `bill_no` as document name (unique per shipment). Warehouse Manager's list view defaults to INET-only.

```
Fields:
├── bill_no (Data, reqd, unique)           — document name, from "Bill No." column
├── request_no (Data, in_list_view)        — "Request No."
├── outbound_date (Date, in_list_view)     — parsed from Excel filename (e.g. "10th May 2026")
├── project_name (Data)
├── subcon (Data, in_list_view, in_standard_filter)
├── outbound_status (Select)               — "Prepared" (from Excel) / "Received" (auto when MR submitted)
├── du_id (Data, in_list_view)             — "DU ID" → maps to Inventory Dimension
├── customer_site_id (Data)                — "Customer Site ID"
├── delivery_purpose (Data)                — "Delivery Purpose"
├── total_volume (Float)                   — "Total Volume"
├── material_receipt (Link → Stock Entry)  — manually created by Warehouse Manager
Naming: By fieldname → bill_no
```

**Outbound Status Flow**:
- Imported from Excel → status = "Prepared"
- When Material Receipt is created → linked but still "Prepared"
- When Material Receipt is **submitted** → auto-update status to "Received"
- Done via `on_submit` hook on Stock Entry

**DUID as ERPNext Inventory Dimension**:
- Use ERPNext's built-in Inventory Dimension feature (not a custom field on Stock Entry Detail)
- Create Inventory Dimension "DUID" linked to `DUID Master` doctype (already exists in the app)
- When creating Material Receipt from Outbound Plan, DUID auto-fills from the `du_id` field
- DUID appears on all stock transactions for that item — enables DUID-wise stock balance reports

**Outbound Date from Filename**: Parse from Excel filename using regex:
- `JDL Outbound Plan of HUAWEI CWH For 10th_May_2026.xlsx` → `2026-05-10`
- Pattern: extract `{day}th_{Month}_{Year}` and convert to date

**DUID as Inventory Dimension**: DUID is tracked on Stock Entry Detail items to show which DUID/site the materials were received for. This is separate from POID (which is the accounting dimension). IM can see stock availability by DUID when creating material requests.

**Permissions**:
- Stock Manager: create/write/read/delete
- System Manager: all
- INET IM, INET Admin: read only

**List View Default Filter** (Stock Manager):
- `subcon = "INET"` (show only INET items by default)
- Admin/System Manager sees all (for analytics)

**Form Action** (when subcon = "INET" and material_receipt is empty):
- "Create Material Receipt" button → opens dialog to select target Warehouse
- Creates Stock Entry (type: Material Receipt) in Draft
- DUID auto-filled from Outbound Plan's `du_id` field (via Inventory Dimension)
- Items: auto-creates an Item linked to DU ID (or uses placeholder "Huawei Material")
- Links Stock Entry back to material_receipt field
- **on_submit hook**: When Stock Entry is submitted → Outbound Plan status auto-changes to "Received"

### API: `import_huawei_outbound(file_url)`

```python
@frappe.whitelist()
def import_huawei_outbound(file_url):
    # 1. Read Excel file via openpyxl, sheet "orderQuery"
    # 2. Parse: Request No, Bill No, Project Name, Subcon, Status, DU ID, Customer Site ID, Delivery Purpose, Total Volume
    # 3. Batch insert Huawei Outbound Plan documents (skip duplicates by bill_no)
    # 4. Return: {total_rows, new_rows, duplicates_skipped, inet_count}
```

### Warehouse Manager Workspace

Create a Frappe Desk Workspace "Warehouse Management" with shortcuts:
- **Huawei Outbound Plan** (list view — filtered to INET by default)
- **Stock Entry** (list view)
- **Material Request (INET)** (list view)
- **Item** (list view)
- **Warehouse** (list view)

Register in hooks.py as a fixture or create via `_ensure_workspace()` in setup.py.

### Analytics (Admin Only)

Dashboard/report for System Manager based on all Huawei Outbound data:
- Volume by Subcontractor (bar chart) — competitive analysis
- Volume trend over time (line chart)
- Project-wise volume distribution
- INET vs Others split

---

## Phase 2: Material Request (IM Frontend + Desk Approval)

### Doctype: `Material Request (INET)`

```
Fields:
├── request_date (Date, default=now)
├── requested_by (Link → User)
├── im (Link → IM Master)
├── poid (Link → PO Dispatch)         — POID materials needed for
├── duid (Data, fetch from PO Dispatch)
├── team (Link → INET Team)           — receiving team
├── team_warehouse (Link → Warehouse)  — target warehouse
├── source_warehouse (Link → Warehouse) — default "Stores - INET"
├── request_status (Select): Draft / Pending Approval / Approved / Rejected / Issued
├── approved_by (Link → User)
├── approved_on (Datetime)
├── stock_entry_transfer (Link → Stock Entry)  — Material Transfer
├── stock_entry_issue (Link → Stock Entry)     — Material Issue
├── remark (Small Text)
└── items (Table → Material Request Item):
    ├── item_code (Link → Item)
    ├── item_name (Data)
    ├── qty (Float)
    ├── uom (Link → UOM)
    └── valuation_rate (Currency)      — 0 for customer-provided
Naming: MAT-REQ-{YYYY}-{#####}
```

**Workflow**:
1. IM creates from portal → status = "Pending Approval"
2. Stock Manager opens in Desk → reviews → clicks "Approve" or "Reject"
3. **On Approve**: 
   - Create Stock Entry (Material Transfer): source_warehouse → team_warehouse
   - Items from request, with `poid` and `duid` accounting dimensions
   - Link stock_entry_transfer
   - Status → "Approved"
4. **On Work Complete** (triggered by Work Done submit or manual):
   - Create Stock Entry (Material Issue) from team_warehouse
   - Link stock_entry_issue
   - Status → "Issued"

### Frontend: IM Material Request Page

- **Route**: `/im-material-request` (admin + im)
- **Nav item**: "Material Request" in IM sidebar (briefcase icon)
- **List view**: IM sees own requests; admin sees all; filter by status
- **New Request form**:
  - Select POID → auto-fills team, duid from PO Dispatch
  - Shows available stock for that DUID (from Huawei Outbound Plan records)
  - Search Item master → add items with qty
  - Submit → status = "Pending Approval"
- **Request detail**: view items, linked Stock Entries, status timeline
- **DUID Stock View**: Show what materials arrived for each DUID (from Huawei Outbound Plan + Material Receipts)

### Backend API Functions (`material_management.py`):

```python
list_material_requests(im, status, limit)   — list with filters
create_material_request(payload)            — IM creates request
approve_material_request(name)             — Stock Manager approves → creates transfer
reject_material_request(name, reason)      — Stock Manager rejects
issue_materials_for_work_done(name)        — Creates Material Issue on work complete
```

---

## Phase 3: Company-Owned Stock Flow

For items purchased via ERPNext Purchase Invoice/Receipt (with valuation):

1. Items received via standard Purchase Receipt → stored in "Stores - INET"
2. IM can see available stock qty when creating Material Request
3. Same request → approve → transfer → issue flow applies
4. Valuation tracked through standard ERPNext stock ledger
5. Both zero-valuation (customer) and valuation (company) items coexist in same request

No additional doctypes needed — standard ERPNext Item/Warehouse/Stock Entry handles this.

---

## Files Summary

| File | Change |
|------|--------|
| **Doctypes** | |
| `doctype/huawei_outbound_plan/huawei_outbound_plan.json` | NEW |
| `doctype/huawei_outbound_plan/huawei_outbound_plan.py` | NEW |
| `doctype/material_request_inet/material_request_inet.json` | NEW |
| `doctype/material_request_inet/material_request_inet.py` | NEW |
| `doctype/material_request_inet_item/material_request_inet_item.json` | NEW (child table) |
| **API** | |
| `api/material_management.py` | NEW — all API functions |
| **Config** | |
| `hooks.py` | Add Stock Entry `on_submit` hook to update Outbound Plan status |
| `setup.py` | `_ensure_material_permissions()`, `_ensure_warehouse_workspace()`, `_ensure_duid_inventory_dimension()` |
| `fixtures/custom_field.json` | (no changes needed — DUID uses Inventory Dimension, not custom field) |
| **Frontend** | |
| `pages/im/IMMaterialRequest.jsx` | NEW — IM material request page |
| `services/api.js` | Add material management API methods |
| `App.jsx` | Add `/im-material-request` route |
| `components/AppShell.jsx` | Add nav item for IM + admin |
| **Workspace** | |
| `workspace/warehouse_management/warehouse_management.json` | NEW — Desk workspace |

---

## Verification

1. Stock Manager uploads Huawei Excel → records created, INET items visible by default
2. Stock Manager clicks "Create Material Receipt" on INET row → Stock Entry (Draft) created with DUID dimension
3. IM logs in → navigates to Material Request → creates request for POID → submits
4. Stock Manager opens Desk → approves request → Stock Entry (Material Transfer) created
5. Work Done completes → Material Issue created with POID + DUID dimensions
6. Admin views analytics dashboard → sees all subcontractor data for competitive analysis
