frappe.ui.form.on('Huawei Outbound Import', {
    refresh: function(frm) {
        if (frm.doc.status === 'Draft' && frm.doc.file) {
            frm.page.set_primary_action('Start Import', function() {
                frappe.call({
                    method: 'inet_app.api.material_management.start_huawei_outbound_import',
                    args: { name: frm.doc.name },
                    freeze: true,
                    freeze_message: 'Processing import...',
                    callback: function(r) {
                        if (r.message) {
                            frm.reload_doc();
                            frappe.show_alert({ message: 'Import completed', indicator: 'green' });
                        }
                    }
                });
            });
        }
    }
});
