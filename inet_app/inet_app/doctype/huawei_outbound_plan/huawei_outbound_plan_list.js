frappe.listview_settings["Huawei Outbound Plan"] = {
    onload(listview) {
        listview.page.add_inner_button(__("Import from Excel"), () => {
            frappe.new_doc("Huawei Outbound Import");
        }, __("Actions"));
        listview.page.add_inner_button(__("View Imports"), () => {
            frappe.set_route("List", "Huawei Outbound Import");
        }, __("Actions"));
    },
    get_indicator(doc) {
        if (doc.outbound_status === "Received") return ["Received", "green", "outbound_status,=,Received"];
        if (doc.outbound_status === "Prepared") return ["Prepared", "blue", "outbound_status,=,Prepared"];
        if (doc.outbound_status === "Pending") return ["Pending", "orange", "outbound_status,=,Pending"];
        return ["Unknown", "gray", ""];
    },
};
