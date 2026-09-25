frappe.ui.form.on('Huawei Outbound Import', {
    refresh: function(frm) {
        if (frm.doc.status === 'Draft' && frm.doc.file) {
            frm.page.set_primary_action('Start Import', function() {
                frappe.call({
                    method: 'inet_app.api.material_management.start_huawei_outbound_import',
                    args: { name: frm.doc.name },
                    callback: function(r) {
                        if (r.message && r.message.queued) {
                            frappe.show_alert({
                                message: __('Import started in the background — this page will update automatically when it finishes (large files can take several minutes).'),
                                indicator: 'blue',
                            });
                            frm.reload_doc();
                        }
                    }
                });
            });
        }

        if (frm.doc.status === 'Processing') {
            start_huawei_import_poll(frm);
        }
    }
});

// A large Huawei export runs as a background job (see
// start_huawei_outbound_import) rather than blocking the request — this
// polls get_huawei_outbound_import_status instead of waiting on that call,
// so the form updates on its own once the job finishes.
function start_huawei_import_poll(frm) {
    if (frm.__huawei_import_poll) return;

    frm.__huawei_import_poll = setInterval(function() {
        if (!cur_frm || cur_frm.doc.doctype !== 'Huawei Outbound Import' || cur_frm.doc.name !== frm.doc.name) {
            clearInterval(frm.__huawei_import_poll);
            frm.__huawei_import_poll = null;
            return;
        }
        frappe.call({
            method: 'inet_app.api.material_management.get_huawei_outbound_import_status',
            args: { name: frm.doc.name },
            callback: function(r) {
                const data = r.message;
                if (!data) return;
                if (data.status === 'Processing') {
                    frm.page.set_indicator(
                        data.processed_rows ? __('Processing… {0} rows', [data.processed_rows]) : __('Processing…'),
                        'orange'
                    );
                    return;
                }
                clearInterval(frm.__huawei_import_poll);
                frm.__huawei_import_poll = null;
                frm.reload_doc();
                frappe.show_alert({
                    message: data.status === 'Completed' ? __('Import completed') : __('Import failed'),
                    indicator: data.status === 'Completed' ? 'green' : 'red',
                });
            }
        });
    }, 4000);
}
