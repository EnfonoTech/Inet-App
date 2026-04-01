frappe.ui.form.on("Team Assignment", {
    assignment_date(frm) {
        if (frm.doc.end_date && frm.doc.assignment_date && frm.doc.end_date < frm.doc.assignment_date) {
            frm.set_value("end_date", frm.doc.assignment_date);
        }
    },
});
