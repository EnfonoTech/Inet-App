// Auto-fill DUID Inventory Dimension on Stock Entry items, and (for a
// manually-created Huawei Material Receipt) tag each item with the same
// (bill, item) Batch the automated Huawei MR Import path already uses.
//
// Correct direction per entry type:
//   Material Receipt  → to_duid only          (stock arrives at target)
//   Material Transfer → duid + to_duid         (stock moves between locations)
//   Material Issue    → duid only              (stock consumed from source)
//
// Sources:
//   Material Receipt  ← Huawei Outbound Plan.duid_master / du_id
//   Transfer / Issue  ← Material Request.duid  (→ PO Dispatch.site_code fallback)
//
// There is no stored "which bill" field on Stock Entry — batch tracking
// (batch = bill, see _get_or_create_huawei_batch in material_management.py)
// carries that per item instead. The manual "Create Material Receipt"
// button on Huawei Outbound Plan passes the bill via `bill_no_hint`, a
// virtual (never persisted, no DB column at all — see setup.py) field on
// Stock Entry that exists ONLY to survive page load reliably:
//   - frappe.route_options is NOT reliable here — Frappe's own
//     get_new_doc() (model/create_new.js) always clears it right after
//     applying it to matching fields, and a URL param with no matching
//     field just gets dropped, not applied — this is why a plain
//     `?bill_no=` param (not a real field) silently failed.
//   - The raw URL query string is ALSO not reliable — Frappe's router
//     (router.js push_state()) rewrites the visible URL down to just the
//     pathname shortly after the route resolves, before this refresh
//     handler runs, so window.location.search is already stripped by then.
//   - A route_options value that DOES match a real field name (even
//     virtual/hidden) gets copied onto the new doc's in-memory object
//     inside that same get_new_doc() call — so frm.doc.bill_no_hint
//     survives everything above, because by then it's just normal (if
//     virtual) doc data, not something route_options/URL state anymore.
frappe.ui.form.on('Stock Entry', {
    refresh: function(frm) {
        if (frm.is_new() && !frm._inet_bill_no && frm.doc.bill_no_hint) {
            frm._inet_bill_no = frm.doc.bill_no_hint;
            _fetch_and_cache_du_id_from_plan(frm);
        }
        _backfill_duid_from_items(frm);
        _show_confirmation_stage_banner(frm);
    },
});

frappe.ui.form.on('Stock Entry Detail', {
    items_add: function(frm, cdt, cdn) {
        if (frm._inet_du_id) {
            _apply_duid_to_row(frm, cdt, cdn, frm._inet_du_id);
        } else if (frm._inet_bill_no) {
            _fetch_and_cache_du_id_from_plan(frm, function() {
                if (frm._inet_du_id) _apply_duid_to_row(frm, cdt, cdn, frm._inet_du_id);
            });
        }
    },

    // Manually adding/changing an item on a bill-tracked Material Receipt —
    // tag the same (bill, item) Batch the automated import path uses, so a
    // hand-typed row lands on the correct bill's ledger too.
    item_code: function(frm, cdt, cdn) {
        if (frm.doc.stock_entry_type !== 'Material Receipt' || !frm._inet_bill_no) return;
        var row = frappe.get_doc(cdt, cdn);
        if (!row.item_code) return;
        frappe.call({
            method: 'inet_app.api.material_management.get_or_create_batch_for_bill_item',
            args: { bill_no: frm._inet_bill_no, item_code: row.item_code },
            callback: function(r) {
                if (r.message) {
                    frappe.model.set_value(cdt, cdn, 'batch_no', r.message);
                    frappe.model.set_value(cdt, cdn, 'use_serial_batch_fields', 1);
                }
            }
        });
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
    if (!frm._inet_bill_no) { if (callback) callback(); return; }
    frappe.db.get_value('Huawei Outbound Plan', frm._inet_bill_no, ['duid_master', 'du_id'], function(r) {
        frm._inet_du_id = (r && (r.duid_master || r.du_id)) || null;
        if (callback) callback();
    });
}

// A Draft Stock Entry staged by the Material Request flow isn't just an
// ordinary unfinished draft — it's specifically waiting on the OTHER side
// (Team Lead or Warehouse Manager) to confirm before it can be submitted.
// Plain "Draft" on the form gives no hint of that, so show it explicitly.
function _show_confirmation_stage_banner(frm) {
    var stage = frm.doc.confirmation_stage;
    if (!stage) return;

    if (stage === 'Rejected') {
        // Kept (not deleted) as a visible record of the declined attempt —
        // this Draft is abandoned; a fresh Stock Entry was staged for any
        // retry, so this one should not be acted on again.
        frm.dashboard.set_headline_alert(
            '<div class="row"><div class="col-xs-12">' +
            '<span class="indicator-pill red">' + __('Rejected') + '</span>&nbsp; ' +
            __('This staged transfer was declined and was never submitted. It is kept only as a record — see the Material Request for the current, re-staged attempt.') +
            '</div></div>',
            'red'
        );
        return;
    }

    if (frm.doc.docstatus !== 0) return;  // "Confirmed" on an already-submitted doc needs no banner

    var is_team_stage = stage === 'Awaiting Team Confirmation';
    var who = is_team_stage ? "the receiving team's Team Lead (via the Field app)" : 'the Warehouse Manager';
    frm.dashboard.set_headline_alert(
        '<div class="row"><div class="col-xs-12">' +
        '<span class="indicator-pill orange">' +
        __('Awaiting Confirmation') +
        '</span>&nbsp; ' +
        __('This transfer is staged and can only be submitted once {0} confirms receipt.', [who]) +
        '</div></div>',
        'orange'
    );
}
