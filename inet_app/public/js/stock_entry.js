// Auto-fill DUID on Stock Entry items from linked Huawei Outbound Plan.
// The 'duid' field (Source DUID) on Stock Entry Detail is an Inventory Dimension
// added by ERPNext. When a receipt is linked to an Outbound Plan, all added
// items should inherit the plan's DU ID so stock can be tracked by site.

frappe.ui.form.on('Stock Entry', {
    refresh: function(frm) {
        if (frm.doc.huawei_outbound_plan) {
            _fetch_and_cache_du_id(frm);
        }
    },

    huawei_outbound_plan: function(frm) {
        if (!frm.doc.huawei_outbound_plan) {
            frm._inet_du_id = null;
            return;
        }
        _fetch_and_cache_du_id(frm, function() {
            // Back-fill any already-added items that have no duid set
            (frm.doc.items || []).forEach(function(item) {
                if (!item.duid && frm._inet_du_id) {
                    frappe.model.set_value(item.doctype, item.name, 'duid', frm._inet_du_id);
                }
            });
        });
    },
});

frappe.ui.form.on('Stock Entry Detail', {
    // Fires when a new row is added to the items child table
    items_add: function(frm, cdt, cdn) {
        if (frm._inet_du_id) {
            frappe.model.set_value(cdt, cdn, 'duid', frm._inet_du_id);
        } else if (frm.doc.huawei_outbound_plan) {
            // Cache not warm yet — fetch and then set
            _fetch_and_cache_du_id(frm, function() {
                if (frm._inet_du_id) {
                    frappe.model.set_value(cdt, cdn, 'duid', frm._inet_du_id);
                }
            });
        }
    },
});

function _fetch_and_cache_du_id(frm, callback) {
    frappe.db.get_value('Huawei Outbound Plan', frm.doc.huawei_outbound_plan, 'du_id', function(r) {
        frm._inet_du_id = r && r.du_id || null;
        if (callback) callback();
    });
}
