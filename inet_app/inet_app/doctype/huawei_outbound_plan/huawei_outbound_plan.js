frappe.ui.form.on('Huawei Outbound Plan', {
    refresh: function(frm) {
        if (frm.doc.subcon === 'INET' && !frm.doc.material_receipt) {
            frm.page.set_primary_action('Create Material Receipt', function() {
                frappe.call({
                    method: 'inet_app.api.material_management.create_material_receipt_from_outbound',
                    args: { bill_no: frm.doc.name },
                    freeze: true,
                    callback: function(r) {
                        if (r.message && r.message.redirect_url) {
                            window.open(r.message.redirect_url, '_blank');
                        }
                    }
                });
            });
        }
    }
});
