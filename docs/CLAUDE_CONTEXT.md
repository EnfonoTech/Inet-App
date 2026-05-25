# INET App — Claude Code Context

Paste this file at the start of a new Claude Code session to give full
project context without re-explaining everything.

---

## What this project is

**INET App** (`apps/inet_app`) — a Frappe v15 + ERPNext custom app that runs
a Huawei Telecom rollout PMS for a company called INET. The portal lives at
`/pms/*` as a React 18 SPA (Vite-built, PWA-installable). Four roles:
Admin/PM, IM (Implementation Manager), Field Team, PIC (invoicing).

Working directory: `/home/ramees/frappe-bench`  
Site: `inet` (run bench commands as `bench --site inet ...`)  
Frontend: `apps/inet_app/frontend/` — build with `npm run build` inside that dir  
Main API: `apps/inet_app/inet_app/api/`  
Doctypes: `apps/inet_app/inet_app/inet_app/doctype/`

---

## Tech stack

| Layer | Details |
|-------|---------|
| Backend | Frappe v15, ERPNext, Python 3.11, MariaDB |
| Frontend | React 18, Vite, React Router v6, no external UI lib |
| State | React Context only (AuthContext, TableRowLimitContext) |
| API | All endpoints are `@frappe.whitelist()` Python functions |
| PWA | Vite PWA plugin, scope `/pms/`, autoUpdate service worker |

---

## Key files to know

```
inet_app/api/command_center.py      # ~10k lines — main pipeline API
inet_app/api/material_management.py # material request / stock / SE hooks; includes return flow
inet_app/api/pic.py                 # PIC invoicing
inet_app/api/expense.py             # project expense claims (field → IM approval)
inet_app/api/project_management.py  # session bootstrap (get_logged_user)
inet_app/hooks.py                   # role_home_page, fixtures, doc_events
inet_app/setup.py                   # after_migrate hook (adds is_return_request custom field)

frontend/src/App.jsx                # role-gated route table; all pages are React.lazy chunks
frontend/src/services/api.js        # all API calls go through here
frontend/src/components/AppShell.jsx       # sidebar + nav
frontend/src/components/DataTablePro.jsx   # table chrome (Manage Table etc.)
frontend/src/components/DataTableWrapper.jsx  # wraps every data table
frontend/src/pages/im/IMMaterialRequest.jsx   # material request + returns tabs
frontend/src/pages/field/FieldMyStock.jsx     # field user stock + return requests
frontend/src/pages/im/IMTeams.jsx             # IM teams + stock detail
frontend/src/pages/im/IMBackend.jsx           # backend/subcon team assignment (can_assign_backend)
frontend/src/pages/im/IMExpense.jsx           # IM expense claim approvals
frontend/src/pages/field/FieldExpense.jsx     # field team expense submission

inet_app/public/js/stock_entry.js   # Frappe Desk: auto-fill DUID on SE items
```

---

## Roles and routing

```python
role_home_page = {
    "INET Field Team": "pms/today",
    "INET IM":         "pms/im-dashboard",
    "INET Admin":      "pms/dashboard",
    "INET PIC":        "pms/pic-dashboard",
}
```

`get_logged_user` resolves role priority: PIC → IM → Field → Admin.
`INET Admin`, `System Manager`, `Administrator` all resolve to `"admin"`.

---

## Data model (key doctypes)

### PO Dispatch — the spine
Every active POID is one row here. Fields to know:
- `name` = system_id (e.g. `SYS-2026-00001`), `poid` = human POID
- `im` → IM Master, `site_code` → DUID string
- `dispatch_status`: Pending → Dispatched → Planned → Completed
- `pic_status`, `pic_status_ms2`: invoicing milestones MS1 / MS2

### Material chain doctypes
- **Huawei Outbound Plan**: Huawei shipment. `du_id` = DUID string,
  `duid_master` = Link to DUID Master, `outbound_status` = Received/Prepared.
- **Material Request** (ERPNext standard + custom fields): `poid`, `duid`,
  `im`, `team_warehouse`, `request_status` (custom).
- **INET Team**: has `warehouse` field linking to ERPNext warehouse.
- **Daily Execution**: has `material_usage` child table (Table field).
- **Daily Execution Material**: child table — `item_code`, `material_request`
  (Link), `qty_transferred`, `qty_used`, `uom`.
- **INET Settings**: `source_warehouse` = main INET warehouse docname.

---

## DUID Inventory Dimension — critical rules

ERPNext Inventory Dimensions added two columns to `tabStock Entry Detail`:

| Column | Meaning | Set for |
|--------|---------|---------|
| `duid` | Source DUID (leaving) | Material Transfer (source), Material Issue |
| `to_duid` | Target DUID (arriving) | Material Receipt, Material Transfer (destination) |

**`duid` does NOT exist on `tabStock Ledger Entry`** in this installation.
Never query `sle.duid` — it raises `OperationalError 1054`.

Per-DUID balance = Transfer SE in-flow (`to_duid`) minus Issue SE out-flow (`duid`):
```sql
-- In (transferred to team WH)
SELECT sed.to_duid, SUM(sed.qty)
FROM `tabStock Entry Detail` sed
JOIN `tabStock Entry` se ON se.name = sed.parent
WHERE se.docstatus=1 AND se.stock_entry_type='Material Transfer'
  AND sed.t_warehouse = %s AND sed.to_duid IS NOT NULL

-- Out (issued/consumed)
SELECT sed.duid, SUM(sed.qty)
FROM `tabStock Entry Detail` sed
JOIN `tabStock Entry` se ON se.name = sed.parent
WHERE se.docstatus=1 AND se.stock_entry_type='Material Issue'
  AND sed.s_warehouse = %s AND sed.duid IS NOT NULL
```

Legacy SEs (created before direction fix) may have `duid` set on receipts
instead of `to_duid`. Use `COALESCE(NULLIF(sed.to_duid,''), NULLIF(sed.duid,''))`
for receipt queries to handle both.

---

## Material management flow

```
1. Huawei Outbound Plan (outbound_status=Received)
       ↓  create_material_receipt_from_outbound()
2. Material Receipt SE  → to_duid = DUID, t_warehouse = source_warehouse
       ↓  IM uses portal /pms/im-material-request
3. Material Request (docstatus=1, type=Material Transfer)
       ↓  approve_material_request() → creates Transfer SE
4. Material Transfer SE → duid = source_wh DUID, to_duid = team DUID
                          s_warehouse = source_wh, t_warehouse = team_wh
       ↓  Field team enters qty_used on Execution Form (material_usage tab)
5. Daily Execution.material_usage[] child rows
       ↓  generate_work_done() → _auto_issue_materials_for_execution()
6. Material Issue SE → duid = team DUID, s_warehouse = team_wh
```

Duplicate guard in `create_material_request`: blocks if active MR exists
for same `poid + set_warehouse`.

Auto-issue is idempotent: checks existing Issue SE via
`sed.material_request = mr.name` join before creating.

## Material return flow

```
1. Field user opens FieldMyStock → "Returns" tab
2. create_material_return_request() — creates Material Request with is_return_request=1
3. IM opens IMMaterialRequest → "Returns" tab → sees pending return requests
4. approve_material_return_request(name) — creates Material Transfer SE
   (s_warehouse=team_wh, t_warehouse=source_wh, duid=team_duid, reversed direction)
```

Normal `list_material_requests` filters out `is_return_request=1` rows so returns
don't pollute the forward-request queue.
`is_return_request` is a custom field added by `setup.py` `after_migrate` hook.

## Expense claim flow

```
1. Field team lead opens FieldExpense → fills date, remarks, expense lines (type + amount + POIDs)
2. create_project_expense_claim() → creates ERPNext Expense Claim (draft → submitted)
   - Each expense_line.poids is a list; amount split equally across selected POIDs
   - expense_approver = IM's Frappe user; employee = field user's Employee record
3. IM opens IMExpense → "Pending" tab → approve_expense_claim() or reject_expense_claim(reason)
4. Admin views all via /expenses (list_all_expense_claims)
```

Key fields: `Expense Claim Detail.poid` (Link → PO Dispatch, custom field).
The IM is resolved from the field user's INET Team → IM Master → Frappe User chain.

---

## Frontend conventions

### Standard page structure (IM pages)
```jsx
<div>
  <div className="page-header">
    <h1 className="page-title">...</h1>
    <div className="page-actions"><button className="btn-primary">...</button></div>
  </div>

  {/* Pill tab bar */}
  <div role="tablist" style={{ display:"flex", gap:4, padding:4,
    background:"#f1f5f9", borderRadius:8, border:"1px solid #e2e8f0",
    margin:"0 16px 8px", width:"fit-content" }}>
    {tabs.map(t => <button key={t.id} role="tab" ... />)}
  </div>

  {/* Filter toolbar */}
  <div className="toolbar">
    <input type="search" ... />
    <select .../>
    <button className="btn-secondary">Clear</button>
  </div>

  {/* Table */}
  <div className="page-content">
    <DataTableWrapper>
      <table className="data-table">...</table>
    </DataTableWrapper>
  </div>
</div>
```

### Standard field/PWA card structure
```jsx
<div className="exec-page">
  <div className="page-header">...</div>
  <div className="exec-body">
    <div className="exec-section">
      <div className="history-card">...</div>
    </div>
  </div>
</div>
```

### Tab switching with DataTablePro
When a tab switch unmounts the whole `.data-table-wrapper` subtree, React
removes it in one shot so the `.data-table-scroll` MutationObserver never
fires — DataTablePro never re-inits. Fix:
```js
function switchTab(id) {
  setTab(id);
  setTimeout(() => document.dispatchEvent(new CustomEvent("tablepro:check")), 60);
}
```
DataTablePro listens for `"tablepro:check"` and calls `scheduleReinitFromDom()`.

### Adding an API call
1. Add `@frappe.whitelist()` function in the relevant `api/*.py` file.
2. Add the call to `frontend/src/services/api.js`:
   ```js
   myNewEndpoint: (args) => call("inet_app.api.module.function_name", args),
   ```
3. Call via `pmApi.myNewEndpoint(args)` in the component.

---

## Common patterns

### Backend: get current user's team
```python
team = frappe.db.get_value("INET Team Member", {"user": frappe.session.user}, "parent")
# or via Employee → INET Team Member chain if direct lookup fails
```

### Backend: check role
```python
roles = set(frappe.get_roles(frappe.session.user))
if not roles & {"INET IM", "INET Admin", "System Manager", "Administrator"}:
    user_roles = ", ".join(sorted(roles - {"All", "Guest"})) or "none"
    frappe.throw(
        f"Not permitted. Your roles: {user_roles}. Required (any one of): INET IM, INET Admin, ...",
        frappe.PermissionError,
    )
```

### Backend: check backend team capability
```python
# In command_center.py:
cap = get_my_backend_capability()  # returns {"can_assign_backend": bool, "im": name}
# IM Master field: can_assign_backend (Check/Int)
flag = frappe.db.get_value("IM Master", im_name, "can_assign_backend")
```

### Backend: get source warehouse
```python
source_wh = frappe.db.get_single_value("INET Settings", "source_warehouse") or ""
```

### Frontend: auth context
```jsx
const { imName, teamId, role, user } = useAuth();
// role: "admin" | "im" | "field" | "pic"
// imName: IM Master name (null for admin/field)
// teamId: INET Team name (null for admin/im)
```

### Frontend: API call with loading state
```jsx
const [data, setData] = useState([]);
const [loading, setLoading] = useState(true);
const load = useCallback(async () => {
  setLoading(true);
  try {
    const res = await pmApi.someEndpoint(args);
    setData(Array.isArray(res) ? res : []);
  } catch (e) {
    // handle error
  } finally {
    setLoading(false);
  }
}, [args]);
useEffect(() => { load(); }, [load]);
```

---

## Deploy after changes

```bash
# Backend only
bench --site inet migrate   # if doctype/fixture changes
bench restart               # if Python code changes

# Frontend
cd apps/inet_app/frontend && npm run build
# Output goes to inet_app/public/portal/assets/
# Main bundle: index.js (~317 kB); each page is a separate chunk via React.lazy

# Both
bench --site inet migrate && npm run build && bench restart
```

---

## Gotchas / things that have burned us

1. **`sle.duid` doesn't exist** — always use `tabStock Entry Detail` for
   DUID-scoped stock queries, never `tabStock Ledger Entry`.

2. **Material Request `request_status`** is a custom field, not ERPNext's
   standard `status`. In raw SQL use `mr.request_status`; in ORM use
   `frappe.db.get_all("Material Request", fields=["request_status", ...])`.

3. **`material_request` is on `tabStock Entry Detail`** (item row), not on
   `tabStock Entry` header. Joins must be `sed.material_request = mr.name`.

4. **Custom DocPerm disables ALL standard DocPerm** for that doctype —
   if you add a Custom DocPerm record, you must add ALL needed roles there.

5. **Legacy SE direction** — old Material Receipt SEs have `duid` set
   (wrong) instead of `to_duid`. Use `COALESCE(NULLIF(to_duid,''), NULLIF(duid,''))`
   in receipt queries.

6. **`transfer_status` on Material Request is always empty** — don't rely
   on it; check for existing Transfer SE via `sed.material_request` join.

7. **`frappe.db.set_value` bypasses validate** — derived fields
   (`ms1_unbilled`, `ms2_unbilled`) go stale. Acceptable for bulk PIC
   status updates; avoid for monetary changes.

8. **DataTablePro tab reinit** — any page that mounts/unmounts tables via
   tab switching must dispatch `tablepro:check`. See Tab switching section.

9. **Admin has no IM Master** — `imName` in auth context is `null` for
   admin users. When admin creates a Material Request, fetch IM from the
   selected POID (`poidInfo.im`).

10. **`Daily Execution-material_usage` custom field conflict** — if a
    stale Custom Field (Long Text) exists from an old migration, it conflicts
    with the Table field. Fix: delete the Custom Field from Frappe Desk,
    then `bench --site inet clear-cache`.

11. **`IMBackend` is gated by `can_assign_backend`** — the "Backend" nav item
    in the IM sidebar only appears if `get_my_backend_capability()` returns
    `can_assign_backend: true`. The flag lives on `IM Master.can_assign_backend`.
    If an IM can't see the Backend page, check that field in Frappe Desk.

12. **Expense claim `expense_approver`** is the IM's *Frappe User* (email), not
    the IM Master name. `_get_im_user(im_master_name)` fetches it. If the IM
    has no linked Frappe User, expense submission will fail with a validation error.

13. **`is_return_request` field** — added by `setup.py` `after_migrate`. On a
    fresh site run `bench --site inet migrate` to ensure the custom field exists
    before using the Returns tab. The `list_material_requests` query guards with
    `has_column("Material Request", "is_return_request")` before filtering.

---

## Useful bench commands

```bash
# Clear cache after Python changes
bench --site inet clear-cache

# Check a specific API function interactively
bench --site inet console
# >>> import frappe; frappe.connect()
# >>> from inet_app.api.material_management import get_team_material_stock
# >>> print(get_team_material_stock())

# Run migration
bench --site inet migrate

# Check site DB credentials (for direct MySQL queries)
cat sites/inet/site_config.json   # db_name, db_password
mysql -u <db_name> -p<db_password> <db_name> -e "SELECT ..."
```

---

## Read these docs for deeper context

- `docs/SYSTEM_OVERVIEW.md` — architecture, data model, all flows, API surface
- `docs/PROJECT_SUMMARY.md` — concise overview + architectural decisions
- `docs/FINDINGS.md` — known bugs and backlog (check before starting new work)
- `docs/USER_GUIDE.md` — role-by-role workflows
