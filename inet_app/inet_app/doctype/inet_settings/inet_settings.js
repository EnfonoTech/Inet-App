frappe.ui.form.on("INET Settings", {
	refresh: function (frm) {
		frm.add_custom_button("Run Legacy Invoice Import", function () {
			run_legacy_invoice_import();
		});
	},
});

function run_legacy_invoice_import() {
	frappe.call({
		method: "inet_app.api.pic.run_legacy_invoice_import",
		freeze: true,
		freeze_message: "Starting import…",
		callback: function () {
			frappe.show_alert({ message: "Import started — running in the background.", indicator: "blue" });
			poll_legacy_invoice_import_status();
		},
	});
}

function poll_legacy_invoice_import_status() {
	const interval = setInterval(function () {
		frappe.call({
			method: "inet_app.api.pic.get_legacy_invoice_import_status",
			callback: function (r) {
				const res = r.message;
				if (res && res.done) {
					clearInterval(interval);
					const result = res.result || {};
					frappe.msgprint({
						title: "Legacy Invoice Import Complete",
						indicator: "green",
						message:
							`${result.csv_rows || 0} rows read, ${result.updated || 0} PO Dispatch records updated, ` +
							`${(result.unmatched || []).length} POIDs not found, ${(result.errors || []).length} errors.`,
					});
				}
			},
		});
	}, 5000);
}
