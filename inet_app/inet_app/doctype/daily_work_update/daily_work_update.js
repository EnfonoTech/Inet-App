frappe.ui.form.on("Daily Work Update", {
    refresh(frm) {
        if (!frm.doc.update_date) {
            frm.set_value("update_date", frappe.datetime.get_today());
        }
    },
});
