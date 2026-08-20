frappe.listview_settings["Huawei Outbound Plan"] = {
    onload(listview) {
        // Default to INET-only for non-admin users (admins see all for analytics)
        const isAdmin = frappe.user_roles.includes("System Manager") || frappe.user_roles.includes("Administrator");
        if (!isAdmin) {
            listview.filter_area.add([["Huawei Outbound Plan", "subcon", "=", "INET"]]);
        }

        // Just the two create actions, standalone (not tucked inside an
        // "Actions" dropdown) — no separate "View" buttons, since both
        // doctypes' own lists are already one search/sidebar click away.
        listview.page.add_inner_button(__("New Huawei Outbound Import"), () => {
            frappe.new_doc("Huawei Outbound Import");
        });
        listview.page.add_inner_button(__("Import Material Receipt Excel"), () => {
            frappe.new_doc("Huawei MR Import");
        });
    },
    get_indicator(doc) {
        if (doc.outbound_status === "Received") return ["Received", "green", "outbound_status,=,Received"];
        if (doc.outbound_status === "Prepared") return ["Prepared", "blue", "outbound_status,=,Prepared"];
        if (doc.outbound_status === "Pending") return ["Pending", "orange", "outbound_status,=,Pending"];
        return ["Unknown", "gray", ""];
    },
};
