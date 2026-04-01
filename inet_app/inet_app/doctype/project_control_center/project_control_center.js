frappe.ui.form.on("Project Control Center", {
    refresh(frm) {
        frm.dashboard.add_indicator(__("Status: {0}", [frm.doc.project_status || "Draft"]), "blue");
    },
});
