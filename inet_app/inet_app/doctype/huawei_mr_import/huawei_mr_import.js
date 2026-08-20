frappe.ui.form.on('Huawei MR Import', {
    refresh: function(frm) {
        if (['Draft', 'Failed', 'No Receipts Created', 'Partially Completed'].includes(frm.doc.status) && frm.doc.file) {
            frm.page.set_primary_action('Start Import', function() {
                start_import(frm);
            });
        }
    }
});

function start_import(frm) {
    frappe.call({
        method: 'inet_app.api.material_management.preview_huawei_mr_import',
        args: { name: frm.doc.name },
        freeze: true,
        freeze_message: 'Checking bills...',
        callback: function(r) {
            const preview = r.message;
            if (!preview) return;

            const problems = [];
            if (preview.missing.length) {
                problems.push(`<b>No matching Huawei Outbound Plan yet</b> (import the header-level Outbound Import first): ${preview.missing.join(', ')}`);
            }
            if (preview.already_received.length) {
                problems.push(`<b>Already has a Material Receipt</b>: ${preview.already_received.join(', ')}`);
            }
            if (preview.wrong_subcon.length) {
                problems.push(`<b>Not an INET subcon bill</b>: ${preview.wrong_subcon.join(', ')}`);
            }
            if (preview.blank_cl_rows) {
                problems.push(`<b>${preview.blank_cl_rows} row(s) have no C/L No.</b> and will be skipped.`);
            }

            if (!problems.length) {
                run_actual_import(frm);
                return;
            }

            if (!preview.eligible.length) {
                frappe.msgprint({
                    title: __('Nothing to import'),
                    indicator: 'red',
                    message: `None of the ${preview.bill_count} bill(s) in this file can get a Material Receipt right now:<br><br>${problems.join('<br><br>')}`,
                });
                return;
            }

            frappe.confirm(
                `${preview.eligible.length} of ${preview.bill_count} bill(s) are ready to receive. The rest have a problem:<br><br>${problems.join('<br><br>')}<br><br>Continue and create receipts only for the ready ones?`,
                () => run_actual_import(frm)
            );
        }
    });
}

function run_actual_import(frm) {
    frappe.call({
        method: 'inet_app.api.material_management.start_huawei_mr_import',
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
}
