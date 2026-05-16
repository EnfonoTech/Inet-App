import frappe

def execute():
    if frappe.db.exists("Client Script", "Huawei Outbound Plan - Import Button"):
        frappe.delete_doc("Client Script", "Huawei Outbound Plan - Import Button", force=True)
        frappe.db.commit()
