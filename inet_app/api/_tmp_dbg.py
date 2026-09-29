import frappe, json
def run():
    from inet_app.api.command_center import request_cancel_dispatch, _ensure_list
    names = frappe.db.sql_list(
        "SELECT name FROM `tabPO Dispatch` WHERE im='456' AND IFNULL(dispatch_status,'')='Dispatched' LIMIT 3")
    print("picked:", names)
    # How the browser actually sends it: a JSON string, not a Python list.
    as_json = json.dumps(names)
    print("_ensure_list(json string) ->", _ensure_list(as_json))
    try:
        res = request_cancel_dispatch(as_json, "debug test")
        print("RESULT:", res)
        # undo
        for n in names:
            frappe.db.set_value("PO Dispatch", n, {"dispatch_status": "Dispatched",
                "cancel_request_status": None, "pic_status": None, "pic_status_ms2": None,
                "cancel_reason": None, "cancel_responded_by": None, "cancel_responded_at": None},
                update_modified=False)
            frappe.db.sql("DELETE FROM `tabPO Status Event` WHERE po_dispatch=%s", (n,))
        frappe.db.commit()
        print("(reverted)")
    except Exception as e:
        print("FAILED:", frappe.utils.cstr(e)[:300])
