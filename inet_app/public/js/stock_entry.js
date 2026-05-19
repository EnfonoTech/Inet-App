// Auto-fill DUID Inventory Dimension on Stock Entry items.
//
// Correct direction per entry type:
//   Material Receipt  → to_duid only          (stock arrives at target)
//   Material Transfer → duid + to_duid         (stock moves between locations)
//   Material Issue    → duid only              (stock consumed from source)
//
// Sources:
//   Material Receipt  ← Huawei Outbound Plan.duid_master / du_id
//   Transfer / Issue  ← Material Request.duid  (→ PO Dispatch.site_code fallback)

frappe.ui.form.on('Stock Entry', {
    refresh: function(frm) {
        if (frm.doc.huawei_outbound_plan) {
            _fetch_and_cache_du_id_from_plan(frm);
        }
        _backfill_duid_from_items(frm);
    },

    huawei_outbound_plan: function(frm) {
        if (!frm.doc.huawei_outbound_plan) { frm._inet_du_id = null; return; }
        _fetch_and_cache_du_id_from_plan(frm, function() {
            (frm.doc.items || []).forEach(function(item) {
                _apply_duid_to_row(frm, item.doctype, item.name, frm._inet_du_id);
            });
        });
    },
});

frappe.ui.form.on('Stock Entry Detail', {
    items_add: function(frm, cdt, cdn) {
        if (frm._inet_du_id) {
            _apply_duid_to_row(frm, cdt, cdn, frm._inet_du_id);
        } else if (frm.doc.huawei_outbound_plan) {
            _fetch_and_cache_du_id_from_plan(frm, function() {
                if (frm._inet_du_id) _apply_duid_to_row(frm, cdt, cdn, frm._inet_du_id);
            });
        }
    },

    // When material_request is set on an item row, fill the appropriate DUID fields
    material_request: function(frm, cdt, cdn) {
        var row = frappe.get_doc(cdt, cdn);
        if (!row.material_request) return;
        frappe.db.get_value('Material Request', row.material_request, ['duid', 'poid'], function(r) {
            if (!r) return;
            var duid = r.duid;
            if (duid) {
                _apply_duid_to_row(frm, cdt, cdn, duid);
            } else if (r.poid) {
                frappe.db.get_value('PO Dispatch', r.poid, 'site_code', function(pd) {
                    if (pd && pd.site_code) _apply_duid_to_row(frm, cdt, cdn, pd.site_code);
                });
            }
        });
    },
});

// Set duid / to_duid on an item row based on the SE type.
function _apply_duid_to_row(frm, cdt, cdn, duid) {
    if (!duid) return;
    var se_type = frm.doc.stock_entry_type || '';
    var set_source = (se_type === 'Material Transfer' || se_type === 'Material Issue');
    var set_target = (se_type === 'Material Receipt' || se_type === 'Material Transfer');
    var row = frappe.get_doc(cdt, cdn);
    if (set_source && !row.duid)    frappe.model.set_value(cdt, cdn, 'duid',    duid);
    if (set_target && !row.to_duid) frappe.model.set_value(cdt, cdn, 'to_duid', duid);
}

// Back-fill items that have material_request set but missing duid / to_duid.
function _backfill_duid_from_items(frm) {
    var se_type = frm.doc.stock_entry_type || '';
    var need_source = (se_type === 'Material Transfer' || se_type === 'Material Issue');
    var need_target = (se_type === 'Material Receipt' || se_type === 'Material Transfer');

    var items = (frm.doc.items || []).filter(function(i) {
        return i.material_request && (
            (need_source && !i.duid) || (need_target && !i.to_duid)
        );
    });
    if (!items.length) return;

    var mrs = [...new Set(items.map(function(i) { return i.material_request; }))];
    var duidCache = {};

    function applyAll() {
        items.forEach(function(item) {
            var d = duidCache[item.material_request];
            if (d) _apply_duid_to_row(frm, item.doctype, item.name, d);
        });
    }

    var pending = mrs.length;
    mrs.forEach(function(mr) {
        frappe.db.get_value('Material Request', mr, ['duid', 'poid'], function(r) {
            if (r && r.duid) {
                duidCache[mr] = r.duid;
                if (!--pending) applyAll();
            } else if (r && r.poid) {
                frappe.db.get_value('PO Dispatch', r.poid, 'site_code', function(pd) {
                    if (pd && pd.site_code) duidCache[mr] = pd.site_code;
                    if (!--pending) applyAll();
                });
            } else {
                if (!--pending) applyAll();
            }
        });
    });
}

function _fetch_and_cache_du_id_from_plan(frm, callback) {
    frappe.db.get_value('Huawei Outbound Plan', frm.doc.huawei_outbound_plan, ['duid_master', 'du_id'], function(r) {
        frm._inet_du_id = (r && (r.duid_master || r.du_id)) || null;
        if (callback) callback();
    });
}
