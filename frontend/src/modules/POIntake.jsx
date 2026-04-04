import { useEffect, useMemo, useState } from "react";
import Modal from "../components/Modal";
import NewCustomerModal from "../components/NewCustomerModal";
import { pmApi } from "../services/api";

const normalizeKey = (header) =>
  String(header || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^\w]/g, "_")
    .replace(/_+/g, "_");

const pick = (obj, keys) => {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
  }
  return undefined;
};

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];

  const rawHeaders = lines[0].split(",").map((h) => h.trim());
  const headers = rawHeaders.map(normalizeKey);

  return lines.slice(1).map((line) => {
    const cols = line.split(",").map((c) => c.trim());
    const row = {};
    headers.forEach((h, i) => {
      row[h] = cols[i] ?? "";
    });

    // Header
    const po_no = pick(row, ["po_no", "po", "po_number", "po_number_", "poid"]);
    const customer = pick(row, ["customer", "customer_name", "vendor", "vendor_name", "supplier", "supplier_name"]);
    const transaction_date = pick(row, ["transaction_date", "po_date", "date", "order_date", "posting_date"]);
    const schedule_date = pick(row, ["schedule_date", "delivery_date", "requested_delivery_date", "ship_date"]);
    const status = pick(row, ["status", "po_status", "po_intake_status", "archive_status"]);

    // Line
    const poid = pick(row, ["poid", "po_id", "p_id", "poid_"]);
    const po_line_no = pick(row, ["po_line_no", "line_no", "line_number", "line_no_"]);
    const shipment_number = pick(row, ["shipment_number", "shipment_no", "ship_no", "shipment"]);
    const site_code = pick(row, ["site_code", "site", "duid", "duid_network", "network"]);

    const item_code = pick(row, ["item_code", "item", "sku"]);
    const item_description = pick(row, ["item_description", "item_name", "description", "material_description"]);
    const qty = pick(row, ["qty", "quantity", "u_qty", "order_qty"]);
    const rate = pick(row, ["rate", "unit_rate", "unit_price", "price"]);
    const line_amount = pick(row, ["line_amount", "amount", "line_total", "line_value"]);

    // Planning
    const project_code = pick(row, ["project_code", "project", "inet_project"]);
    const activity_code = pick(row, ["activity_code", "activity", "activity_type", "activity_type_map"]);
    const area = pick(row, ["area", "center_area", "inet_center_area", "inet_area"]);

    return {
      po_no: po_no || "",
      customer: customer || "",
      transaction_date: transaction_date || "",
      schedule_date: schedule_date || "",
      status: status || "Active",
      poid: poid || "",
      po_line_no: po_line_no === undefined || po_line_no === "" ? "" : po_line_no,
      shipment_number: shipment_number || "",
      site_code: site_code || "",
      item_code: item_code || "",
      item_description: item_description || "",
      qty: qty === undefined || qty === "" ? "" : qty,
      rate: rate === undefined || rate === "" ? "" : rate,
      line_amount: line_amount === undefined || line_amount === "" ? "" : line_amount,
      project_code: project_code || "",
      activity_code: activity_code || "",
      area: area || "",
    };
  });
}

function EmptyState({ text }) {
  return <div className="empty-state">{text}</div>;
}

export default function POIntake() {
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  const [openImport, setOpenImport] = useState(false);
  const [openCreate, setOpenCreate] = useState(false);
  const [pageMsg, setPageMsg] = useState("");
  const [formMsg, setFormMsg] = useState("");

  const [openNewCustomer, setOpenNewCustomer] = useState(false);

  const [customers, setCustomers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [itemsCatalog, setItemsCatalog] = useState([]);

  const [form, setForm] = useState({
    po_no: "",
    customer: "",
    transaction_date: new Date().toISOString().slice(0, 10),
    schedule_date: new Date().toISOString().slice(0, 10),
    status: "Active",
    po_lines: [
      {
        poid: "",
        po_line_no: 1,
        shipment_number: "",
        site_code: "",
        item_code: "",
        item_description: "",
        qty: 1,
        uom: "",
        rate: 0,
        project_code: "",
        activity_code: "",
        area: "",
        line_amount: 0,
      },
    ],
  });

  const load = async () => {
    setLoading(true);
    setPageMsg("");
    try {
      const data = await pmApi.listPoIntake({ limit: 50, search: search || "" });
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setRows([]);
      setPageMsg(e?.message || "Failed to load PO Intake.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!openCreate) return;
    setFormMsg("");
    Promise.all([
      pmApi.listCustomers({ limit: 300 }).catch(() => []),
      pmApi.listProjects({ limit: 500 }).catch(() => []),
      pmApi.listItemCatalog({ limit: 900 }).catch(() => []),
    ]).then(([c, p, items]) => {
      setCustomers(Array.isArray(c) ? c : []);
      setProjects(Array.isArray(p) ? p : []);
      setItemsCatalog(Array.isArray(items) ? items : []);
    });
  }, [openCreate]);

  const importFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setPageMsg("");
    setFormMsg("");
    const text = await file.text();
    const parsed = parseCsv(text);

    try {
      const result = await pmApi.importPoIntake(parsed);
      setPageMsg(`Imported: ${result?.created_count ?? 0} PO(s).`);
      if (Array.isArray(result?.validation_errors) && result.validation_errors.length) {
        setPageMsg((m) => `${m} Validation errors: ${result.validation_errors.length}`);
      }
      setOpenImport(false);
      await load();
    } catch (err) {
      setPageMsg(err?.message || "Import failed");
    }
  };

  const subtotal = useMemo(() => form.po_lines.reduce((s, r) => s + Number(r.qty || 0) * Number(r.rate || 0), 0), [form.po_lines]);

  const onSelectItem = (idx, item_code) => {
    const it = itemsCatalog.find((d) => d.item_code === item_code);
    setForm((p) => ({
      ...p,
      po_lines: p.po_lines.map((row, i) =>
        i === idx
          ? {
              ...row,
              item_code,
              item_description: it?.description || it?.item_name || "",
              uom: it?.uom || "",
              rate: Number(it?.rate || 0),
              line_amount: Number(row.qty || 0) * Number(it?.rate || 0),
            }
          : row
      ),
    }));
  };

  const setLine = (idx, patch) => {
    setForm((p) => ({
      ...p,
      po_lines: p.po_lines.map((row, i) => {
        if (i !== idx) return row;
        const next = { ...row, ...patch };
        next.line_amount = Number(next.qty || 0) * Number(next.rate || 0);
        return next;
      }),
    }));
  };

  const addLine = () => {
    setForm((p) => ({
      ...p,
      po_lines: [
        ...p.po_lines,
        {
          poid: "",
          po_line_no: p.po_lines.length + 1,
          shipment_number: "",
          site_code: "",
          item_code: "",
          item_description: "",
          qty: 1,
          uom: "",
          rate: 0,
          project_code: "",
          activity_code: "",
          area: "",
          line_amount: 0,
        },
      ],
    }));
  };

  const removeLine = (idx) => {
    setForm((p) => ({
      ...p,
      po_lines: p.po_lines.filter((_, i) => i !== idx).map((r, i) => ({ ...r, po_line_no: i + 1 })),
    }));
  };

  const save = async () => {
    setFormMsg("");
    if (!form.po_no.trim()) return setFormMsg("PO No is required.");
    if (!form.customer) return setFormMsg("Customer is required.");

    for (let i = 0; i < form.po_lines.length; i++) {
      const r = form.po_lines[i];
      if (!r.item_code) return setFormMsg(`Line ${i + 1}: Item is required.`);
      if (!r.project_code) return setFormMsg(`Line ${i + 1}: Project Code is required.`);
      if (Number(r.qty || 0) <= 0) return setFormMsg(`Line ${i + 1}: Qty must be > 0.`);
    }

    const payload = {
      po_no: form.po_no,
      customer: form.customer,
      transaction_date: form.transaction_date,
      schedule_date: form.schedule_date,
      status: form.status,
      po_lines: form.po_lines.map((r, i) => ({
        poid: r.poid || `${form.po_no}-${i + 1}`,
        po_line_no: r.po_line_no || i + 1,
        shipment_number: r.shipment_number || "",
        site_code: r.site_code || "",
        item_code: r.item_code,
        item_description: r.item_description || "",
        qty: Number(r.qty || 0),
        uom: r.uom || "",
        rate: Number(r.rate || 0),
        project_code: r.project_code,
        activity_code: r.activity_code || "",
        area: r.area || "",
        line_amount: Number(r.line_amount || 0),
      })),
    };

    try {
      const result = await pmApi.createPoIntake(payload);
      setPageMsg(`Created PO Intake: ${result?.name}`);
      setOpenCreate(false);
      setFormMsg("");

      setForm({
        po_no: "",
        customer: "",
        transaction_date: new Date().toISOString().slice(0, 10),
        schedule_date: new Date().toISOString().slice(0, 10),
        status: "Active",
        po_lines: [
          {
            poid: "",
            po_line_no: 1,
            shipment_number: "",
            site_code: "",
            item_code: "",
            item_description: "",
            qty: 1,
            uom: "",
            rate: 0,
            project_code: "",
            activity_code: "",
            area: "",
            line_amount: 0,
          },
        ],
      });

      await load();
    } catch (e) {
      setFormMsg(e?.message || "Failed to create PO Intake.");
    }
  };

  const statusBadge = (st) => {
    const s = String(st || "").toLowerCase();
    if (s.includes("archive")) return "badge-risk";
    return "badge-done";
  };

  return (
    <div className="page-wrap">
      <div className="page-header">
        <h1 className="page-title">PO Intake</h1>
        <div className="toolbar">
          <input placeholder="Search PO / Customer / Project" value={search} onChange={(e) => setSearch(e.target.value)} />
          <button className="btn-secondary" onClick={load}>
            Search
          </button>
          <button className="btn-primary" onClick={() => setOpenCreate(true)}>
            Create PO
          </button>
          <button className="btn-primary" onClick={() => setOpenImport(true)}>
            Import CSV
          </button>
        </div>
      </div>

      {pageMsg ? <p>{pageMsg}</p> : null}

      <div className="card table-card">
        <div className="table-title">Incoming Customer POs</div>
        {loading ? (
          <EmptyState text="Loading..." />
        ) : rows.length === 0 ? (
          <EmptyState text="No PO Intake records found." />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>PO No</th>
                <th>Customer</th>
                <th>PO Date</th>
                <th>Schedule</th>
                <th>Total</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name}>
                  <td className="mono" style={{ color: "var(--blue)", fontWeight: 700 }}>
                    {r.po_no}
                  </td>
                  <td>{r.customer || "-"}</td>
                  <td>{r.transaction_date || "-"}</td>
                  <td>{r.schedule_date || "-"}</td>
                  <td>{Number(r.grand_total || 0).toFixed(2)}</td>
                  <td>
                    <span className={`badge ${statusBadge(r.status)}`}>{r.status || "Active"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={openImport} title="Import Customer PO (CSV)" onClose={() => setOpenImport(false)} maxWidth={520}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <div className="label" style={{ marginBottom: 8 }}>
              Expected CSV headers (case-insensitive)
            </div>
            <div style={{ color: "var(--text-muted)", fontSize: "0.86rem", lineHeight: 1.5 }}>
              Header: `po_no`, `customer`, `transaction_date`, `schedule_date`, `status`
              <br />
              Lines: `poid`, `po_line_no`, `shipment_number`, `site_code`, `item_code`, `item_description`, `qty`, `rate` (or `line_amount`),
              `project_code`, `activity_code`, `area`.
            </div>
          </div>

          <label className="btn-like" style={{ width: "fit-content" }}>
            Choose CSV
            <input type="file" accept=".csv" onChange={importFile} />
          </label>
        </div>
      </Modal>

      <Modal open={openCreate} title="Create PO Intake" onClose={() => setOpenCreate(false)} maxWidth={1280}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {formMsg ? <div className="form-error">{formMsg}</div> : null}

          <div className="form-grid" style={{ gridTemplateColumns: "repeat(5, minmax(180px, 1fr))" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span className="label">PO No.</span>
              <input value={form.po_no} onChange={(e) => setForm((p) => ({ ...p, po_no: e.target.value }))} />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span className="label">Customer</span>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <select value={form.customer} onChange={(e) => setForm((p) => ({ ...p, customer: e.target.value }))} style={{ flex: 1 }}>
                  <option value="">Select Customer</option>
                  {customers.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.customer_name || c.name}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn-like" onClick={() => setOpenNewCustomer(true)} title="Create Customer">
                  +
                </button>
              </div>
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span className="label">PO Date</span>
              <input type="date" value={form.transaction_date} onChange={(e) => setForm((p) => ({ ...p, transaction_date: e.target.value }))} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span className="label">Schedule</span>
              <input type="date" value={form.schedule_date} onChange={(e) => setForm((p) => ({ ...p, schedule_date: e.target.value }))} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span className="label">Status</span>
              <select value={form.status} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))}>
                <option value="Active">Active</option>
                <option value="Archive">Archive</option>
              </select>
            </label>
          </div>

          <div className="table-title" style={{ marginTop: 4, marginBottom: 0 }}>
            PO Lines
          </div>

          <div className="po-items-editor">
            <div className="po-items-editor-head">
              <span>#</span>
              <span>Item</span>
              <span>Qty</span>
              <span>Rate</span>
              <span>Amount</span>
              <span>Project</span>
              <span>Activity</span>
              <span>Area</span>
              <span>Shipment</span>
              <span />
            </div>

            {form.po_lines.map((row, idx) => (
              <div key={idx} className="po-item-row">
                <span className="mono" style={{ fontWeight: 800 }}>
                  {idx + 1}
                </span>

                <select value={row.item_code} onChange={(e) => onSelectItem(idx, e.target.value)}>
                  <option value="">Select Item</option>
                  {itemsCatalog.map((it) => (
                    <option key={it.item_code} value={it.item_code}>
                      {it.item_code}
                    </option>
                  ))}
                </select>

                <input type="number" value={row.qty} onChange={(e) => setLine(idx, { qty: Number(e.target.value || 0) })} />
                <input type="number" value={row.rate} onChange={(e) => setLine(idx, { rate: Number(e.target.value || 0) })} />

                <input readOnly value={Number(row.line_amount || 0).toFixed(2)} className="po-amount-readonly" />

                <select value={row.project_code} onChange={(e) => setLine(idx, { project_code: e.target.value })}>
                  <option value="">Select Project</option>
                  {projects.map((p) => (
                    <option key={p.name} value={p.project_code}>
                      {p.project_code}
                    </option>
                  ))}
                </select>

                <input placeholder="Activity" value={row.activity_code} onChange={(e) => setLine(idx, { activity_code: e.target.value })} />
                <input placeholder="Area" value={row.area} onChange={(e) => setLine(idx, { area: e.target.value })} />
                <input placeholder="Shipment" value={row.shipment_number} onChange={(e) => setLine(idx, { shipment_number: e.target.value })} />

                <button type="button" className="po-remove-btn" onClick={() => removeLine(idx)} title="Remove line">
                  ×
                </button>
              </div>
            ))}

            <button type="button" className="po-add-line-btn" onClick={addLine}>
              + Add Line
            </button>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
            <div />
            <div style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
              <span className="label" style={{ textTransform: "uppercase" }}>
                Subtotal
              </span>
              <strong style={{ fontSize: 18 }}>{subtotal.toFixed(2)}</strong>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 10 }}>
            <button className="btn-secondary" onClick={() => setOpenCreate(false)}>
              Cancel
            </button>
            <button className="btn-primary" onClick={save}>
              Create PO Intake
            </button>
          </div>
        </div>
      </Modal>

      <NewCustomerModal
        open={openNewCustomer}
        onClose={() => setOpenNewCustomer(false)}
        onCreated={(result) => {
          if (!result?.name) return;
          setCustomers((prev) => [{ name: result.name, customer_name: result.customer_name }, ...prev]);
          setForm((p) => ({ ...p, customer: result.name }));
        }}
      />
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import Modal from "../components/Modal";
import NewCustomerModal from "../components/NewCustomerModal";
import { pmApi } from "../services/api";

const normalizeKey = (header) =>
  String(header || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^\w]/g, "_")
    .replace(/_+/g, "_");

const pick = (obj, keys) => {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
  }
  return undefined;
};

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];

  const rawHeaders = lines[0].split(",").map((h) => h.trim());
  const headers = rawHeaders.map(normalizeKey);

  return lines.slice(1).map((line) => {
    const cols = line.split(",").map((c) => c.trim());
    const row = {};
    headers.forEach((h, i) => {
      row[h] = cols[i] ?? "";
    });

    // Customer PO header
    const po_no = pick(row, ["po_no", "po", "po_number", "po_number_", "poid"]);
    const customer = pick(row, ["customer", "customer_name", "vendor", "vendor_name", "supplier", "supplier_name"]);
    const transaction_date = pick(row, ["transaction_date", "po_date", "date", "order_date", "posting_date"]);
    const schedule_date = pick(row, ["schedule_date", "delivery_date", "requested_delivery_date", "ship_date"]);
    const status = pick(row, ["status", "po_status", "po_intake_status", "archive_status"]);

    // PO line identity & routing
    const poid = pick(row, ["poid", "po_id", "p_id", "poid_"]);
    const po_line_no = pick(row, ["po_line_no", "line_no", "line_number", "line_no_"]);
    const shipment_number = pick(row, ["shipment_number", "shipment_no", "ship_no", "shipment"]);
    const site_code = pick(row, ["site_code", "site", "duid", "duid_network", "network"]);

    // Item line
    const item_code = pick(row, ["item_code", "item", "sku"]);
    const item_description = pick(row, ["item_description", "item_name", "description", "material_description"]);
    const qty = pick(row, ["qty", "quantity", "u_qty", "order_qty"]);
    const rate = pick(row, ["rate", "unit_rate", "unit_price", "price"]);
    const line_amount = pick(row, ["line_amount", "amount", "line_total", "line_value"]);

    // Planning linkage
    const project_code = pick(row, ["project_code", "project", "inet_project"]);
    const activity_code = pick(row, ["activity_code", "activity", "activity_type", "activity_type_map"]);
    const area = pick(row, ["area", "center_area", "inet_center_area", "inet_area"]);

    return {
      po_no: po_no || "",
      customer: customer || "",
      transaction_date: transaction_date || "",
      schedule_date: schedule_date || "",
      status: status || "Active",
      poid: poid || "",
      po_line_no: po_line_no === undefined || po_line_no === "" ? "" : po_line_no,
      shipment_number: shipment_number || "",
      site_code: site_code || "",
      item_code: item_code || "",
      item_description: item_description || "",
      qty: qty === undefined || qty === "" ? "" : qty,
      rate: rate === undefined || rate === "" ? "" : rate,
      line_amount: line_amount === undefined || line_amount === "" ? "" : line_amount,
      project_code: project_code || "",
      activity_code: activity_code || "",
      area: area || "",
    };
  });
}

function EmptyState({ text }) {
  return <div className="empty-state">{text}</div>;
}

export default function POIntake() {
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  const [openImport, setOpenImport] = useState(false);
  const [openCreate, setOpenCreate] = useState(false);
  const [formMsg, setFormMsg] = useState("");
  const [pageMsg, setPageMsg] = useState("");

  const [openNewCustomer, setOpenNewCustomer] = useState(false);

  const [customers, setCustomers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [itemsCatalog, setItemsCatalog] = useState([]);

  const [form, setForm] = useState({
    po_no: "",
    customer: "",
    transaction_date: new Date().toISOString().slice(0, 10),
    schedule_date: new Date().toISOString().slice(0, 10),
    status: "Active",
    po_lines: [
      {
        poid: "",
        po_line_no: 1,
        shipment_number: "",
        site_code: "",
        item_code: "",
        item_description: "",
        qty: 1,
        uom: "",
        rate: 0,
        project_code: "",
        activity_code: "",
        area: "",
        line_amount: 0,
      },
    ],
  });

  const load = async () => {
    setLoading(true);
    setPageMsg("");
    try {
      const data = await pmApi.listPoIntake({ limit: 50, search: search || "" });
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setRows([]);
      setPageMsg(e?.message || "Failed to load PO Intake.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!openCreate) return;

    setFormMsg("");
    Promise.all([
      pmApi.listCustomers({ limit: 300 }).catch(() => []),
      pmApi.listProjects({ limit: 500 }).catch(() => []),
      pmApi.listItemCatalog({ limit: 900 }).catch(() => []),
    ]).then(([c, p, items]) => {
      setCustomers(Array.isArray(c) ? c : []);
      setProjects(Array.isArray(p) ? p : []);
      setItemsCatalog(Array.isArray(items) ? items : []);
    });
  }, [openCreate]);

  const importFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setPageMsg("");
    setFormMsg("");
    const text = await file.text();
    const parsed = parseCsv(text);

    try {
      const result = await pmApi.importPoIntake(parsed);
      setPageMsg(`Imported: ${result?.created_count ?? 0} PO(s).`);
      if (Array.isArray(result?.validation_errors) && result.validation_errors.length) {
        setPageMsg((m) => `${m} Validation errors: ${result.validation_errors.length}`);
      }
      setOpenImport(false);
      await load();
    } catch (err) {
      setPageMsg(err?.message || "Import failed");
    }
  };

  const subtotal = useMemo(() => form.po_lines.reduce((s, r) => s + Number(r.qty || 0) * Number(r.rate || 0), 0), [form.po_lines]);

  const onSelectItem = (idx, item_code) => {
    const it = itemsCatalog.find((d) => d.item_code === item_code);
    setForm((p) => ({
      ...p,
      po_lines: p.po_lines.map((row, i) =>
        i === idx
          ? {
              ...row,
              item_code,
              item_description: it?.description || it?.item_name || "",
              uom: it?.uom || "",
              rate: Number(it?.rate || 0),
              line_amount: Number(row.qty || 0) * Number(it?.rate || 0),
            }
          : row
      ),
    }));
  };

  const setLine = (idx, patch) => {
    setForm((p) => ({
      ...p,
      po_lines: p.po_lines.map((row, i) => {
        if (i !== idx) return row;
        const next = { ...row, ...patch };
        next.line_amount = Number(next.qty || 0) * Number(next.rate || 0);
        return next;
      }),
    }));
  };

  const addLine = () => {
    setForm((p) => ({
      ...p,
      po_lines: [
        ...p.po_lines,
        {
          poid: "",
          po_line_no: p.po_lines.length + 1,
          shipment_number: "",
          site_code: "",
          item_code: "",
          item_description: "",
          qty: 1,
          uom: "",
          rate: 0,
          project_code: "",
          activity_code: "",
          area: "",
          line_amount: 0,
        },
      ],
    }));
  };

  const removeLine = (idx) => {
    setForm((p) => ({
      ...p,
      po_lines: p.po_lines.filter((_, i) => i !== idx).map((r, i) => ({ ...r, po_line_no: i + 1 })),
    }));
  };

  const save = async () => {
    setFormMsg("");
    if (!form.po_no.trim()) {
      setFormMsg("PO No is required.");
      return;
    }
    if (!form.customer) {
      setFormMsg("Customer is required.");
      return;
    }

    for (let i = 0; i < form.po_lines.length; i++) {
      const r = form.po_lines[i];
      if (!r.item_code) {
        setFormMsg(`Line ${i + 1}: Item is required.`);
        return;
      }
      if (!r.project_code) {
        setFormMsg(`Line ${i + 1}: Project Code is required.`);
        return;
      }
      if (Number(r.qty || 0) <= 0) {
        setFormMsg(`Line ${i + 1}: Qty must be > 0.`);
        return;
      }
    }

    const payload = {
      po_no: form.po_no,
      customer: form.customer,
      transaction_date: form.transaction_date,
      schedule_date: form.schedule_date,
      status: form.status,
      po_lines: form.po_lines.map((r, i) => ({
        poid: r.poid || `${form.po_no}-${i + 1}`,
        po_line_no: r.po_line_no || i + 1,
        shipment_number: r.shipment_number || "",
        site_code: r.site_code || "",
        item_code: r.item_code,
        item_description: r.item_description || "",
        qty: Number(r.qty || 0),
        uom: r.uom || "",
        rate: Number(r.rate || 0),
        project_code: r.project_code,
        activity_code: r.activity_code || "",
        area: r.area || "",
        line_amount: Number(r.line_amount || 0),
      })),
    };

    try {
      const result = await pmApi.createPoIntake(payload);
      setPageMsg(`Created PO Intake: ${result?.name}`);
      setOpenCreate(false);
      setFormMsg("");

      setForm({
        po_no: "",
        customer: "",
        transaction_date: new Date().toISOString().slice(0, 10),
        schedule_date: new Date().toISOString().slice(0, 10),
        status: "Active",
        po_lines: [
          {
            poid: "",
            po_line_no: 1,
            shipment_number: "",
            site_code: "",
            item_code: "",
            item_description: "",
            qty: 1,
            uom: "",
            rate: 0,
            project_code: "",
            activity_code: "",
            area: "",
            line_amount: 0,
          },
        ],
      });
      await load();
    } catch (e) {
      setFormMsg(e?.message || "Failed to create PO Intake.");
    }
  };

  const statusBadge = (st) => {
    const s = String(st || "").toLowerCase();
    if (s.includes("archive")) return "badge-risk";
    return "badge-done";
  };

  return (
    <div className="page-wrap">
      <div className="page-header">
        <h1 className="page-title">PO Intake</h1>
        <div className="toolbar">
          <input placeholder="Search PO / Customer / Project" value={search} onChange={(e) => setSearch(e.target.value)} />
          <button className="btn-secondary" onClick={load}>
            Search
          </button>
          <button className="btn-primary" onClick={() => setOpenCreate(true)}>
            Create PO
          </button>
          <button className="btn-primary" onClick={() => setOpenImport(true)}>
            Import CSV
          </button>
        </div>
      </div>

      {pageMsg ? <p>{pageMsg}</p> : null}

      <div className="card table-card">
        <div className="table-title">Incoming Customer POs</div>
        {loading ? (
          <EmptyState text="Loading..." />
        ) : rows.length === 0 ? (
          <EmptyState text="No PO Intake records found." />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>PO No</th>
                <th>Customer</th>
                <th>PO Date</th>
                <th>Schedule</th>
                <th>Total</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name}>
                  <td className="mono" style={{ color: "var(--blue)", fontWeight: 700 }}>
                    {r.po_no}
                  </td>
                  <td>{r.customer || "-"}</td>
                  <td>{r.transaction_date || "-"}</td>
                  <td>{r.schedule_date || "-"}</td>
                  <td>{Number(r.grand_total || 0).toFixed(2)}</td>
                  <td>
                    <span className={`badge ${statusBadge(r.status)}`}>{r.status || "Active"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={openImport} title="Import Customer PO (CSV)" onClose={() => setOpenImport(false)} maxWidth={520}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <div className="label" style={{ marginBottom: 8 }}>
              Expected CSV headers (case-insensitive)
            </div>
            <div style={{ color: "var(--text-muted)", fontSize: "0.86rem", lineHeight: 1.5 }}>
              Header: `po_no`, `customer`, `transaction_date`, `schedule_date`, `status`
              <br />
              Lines: `poid`, `po_line_no`, `shipment_number`, `site_code`, `item_code`, `item_description`, `qty`, `rate` (or `line_amount`),
              `project_code`, `activity_code`, `area`.
            </div>
          </div>

          <label className="btn-like" style={{ width: "fit-content" }}>
            Choose CSV
            <input type="file" accept=".csv" onChange={importFile} />
          </label>
        </div>
      </Modal>

      <Modal open={openCreate} title="Create PO Intake" onClose={() => setOpenCreate(false)} maxWidth={1280}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {formMsg ? <div className="form-error">{formMsg}</div> : null}

          <div className="form-grid" style={{ gridTemplateColumns: "repeat(5, minmax(180px, 1fr))" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span className="label">PO No.</span>
              <input value={form.po_no} onChange={(e) => setForm((p) => ({ ...p, po_no: e.target.value }))} />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span className="label">Customer</span>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <select value={form.customer} onChange={(e) => setForm((p) => ({ ...p, customer: e.target.value }))} style={{ flex: 1 }}>
                  <option value="">Select Customer</option>
                  {customers.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.customer_name || c.name}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn-like" onClick={() => setOpenNewCustomer(true)} title="Create Customer">
                  +
                </button>
              </div>
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span className="label">PO Date</span>
              <input type="date" value={form.transaction_date} onChange={(e) => setForm((p) => ({ ...p, transaction_date: e.target.value }))} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span className="label">Schedule</span>
              <input type="date" value={form.schedule_date} onChange={(e) => setForm((p) => ({ ...p, schedule_date: e.target.value }))} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span className="label">Status</span>
              <select value={form.status} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))}>
                <option value="Active">Active</option>
                <option value="Archive">Archive</option>
              </select>
            </label>
          </div>

          <div className="table-title" style={{ marginTop: 4, marginBottom: 0 }}>
            PO Lines
          </div>

          <div className="po-items-editor">
            <div className="po-items-editor-head">
              <span>#</span>
              <span>Item</span>
              <span>Qty</span>
              <span>Rate</span>
              <span>Amount</span>
              <span>Project</span>
              <span>Activity</span>
              <span>Area</span>
              <span>Shipment</span>
              <span />
            </div>

            {form.po_lines.map((row, idx) => (
              <div key={idx} className="po-item-row">
                <span className="mono" style={{ fontWeight: 800 }}>
                  {idx + 1}
                </span>

                <select value={row.item_code} onChange={(e) => onSelectItem(idx, e.target.value)}>
                  <option value="">Select Item</option>
                  {itemsCatalog.map((it) => (
                    <option key={it.item_code} value={it.item_code}>
                      {it.item_code}
                    </option>
                  ))}
                </select>

                <input type="number" value={row.qty} onChange={(e) => setLine(idx, { qty: Number(e.target.value || 0) })} />
                <input type="number" value={row.rate} onChange={(e) => setLine(idx, { rate: Number(e.target.value || 0) })} />

                <input readOnly value={Number(row.line_amount || 0).toFixed(2)} className="po-amount-readonly" />

                <select value={row.project_code} onChange={(e) => setLine(idx, { project_code: e.target.value })}>
                  <option value="">Select Project</option>
                  {projects.map((p) => (
                    <option key={p.name} value={p.project_code}>
                      {p.project_code}
                    </option>
                  ))}
                </select>

                <input placeholder="Activity" value={row.activity_code} onChange={(e) => setLine(idx, { activity_code: e.target.value })} />
                <input placeholder="Area" value={row.area} onChange={(e) => setLine(idx, { area: e.target.value })} />
                <input placeholder="Shipment" value={row.shipment_number} onChange={(e) => setLine(idx, { shipment_number: e.target.value })} />

                <button type="button" className="po-remove-btn" onClick={() => removeLine(idx)} title="Remove line">
                  ×
                </button>
              </div>
            ))}

            <button type="button" className="po-add-line-btn" onClick={addLine}>
              + Add Line
            </button>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
            <div />
            <div style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
              <span className="label" style={{ textTransform: "uppercase" }}>
                Subtotal
              </span>
              <strong style={{ fontSize: 18 }}>{subtotal.toFixed(2)}</strong>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 10 }}>
            <button className="btn-secondary" onClick={() => setOpenCreate(false)}>
              Cancel
            </button>
            <button className="btn-primary" onClick={save}>
              Create PO Intake
            </button>
          </div>
        </div>
      </Modal>

      <NewCustomerModal
        open={openNewCustomer}
        onClose={() => setOpenNewCustomer(false)}
        onCreated={(result) => {
          if (!result?.name) return;
          setCustomers((prev) => [{ name: result.name, customer_name: result.customer_name }, ...prev]);
          setForm((p) => ({ ...p, customer: result.name }));
        }}
      />
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import Modal from "../components/Modal";
import NewCustomerModal from "../components/NewCustomerModal";
import { pmApi } from "../services/api";

const normalizeKey = (header) =>
  String(header || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^\w]/g, "_")
    .replace(/_+/g, "_");

const pick = (obj, keys) => {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
  }
  return undefined;
};

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];

  const rawHeaders = lines[0].split(",").map((h) => h.trim());
  const headers = rawHeaders.map(normalizeKey);

  return lines.slice(1).map((line) => {
    const cols = line.split(",").map((c) => c.trim());
    const row = {};
    headers.forEach((h, i) => {
      row[h] = cols[i] ?? "";
    });

    // Customer PO header
    const po_no = pick(row, ["po_no", "po", "po_number", "po_number_", "poid"]);
    const customer = pick(row, ["customer", "customer_name", "vendor", "vendor_name", "supplier", "supplier_name"]);
    const transaction_date = pick(row, ["transaction_date", "po_date", "date", "order_date", "posting_date"]);
    const schedule_date = pick(row, ["schedule_date", "delivery_date", "requested_delivery_date", "ship_date"]);
    const status = pick(row, ["status", "po_status", "po_intake_status", "archive_status"]);

    // PO line identity & routing
    const poid = pick(row, ["poid", "po_id", "p_id", "poid_"]);
    const po_line_no = pick(row, ["po_line_no", "line_no", "line_number", "line_no_"]);
    const shipment_number = pick(row, ["shipment_number", "shipment_no", "ship_no", "shipment"]);
    const site_code = pick(row, ["site_code", "site", "duid", "duid_network", "network"]);

    // Item line
    const item_code = pick(row, ["item_code", "item", "sku"]);
    const item_description = pick(row, ["item_description", "item_name", "description", "material_description"]);
    const qty = pick(row, ["qty", "quantity", "u_qty", "order_qty"]);
    const rate = pick(row, ["rate", "unit_rate", "unit_price", "price"]);
    const line_amount = pick(row, ["line_amount", "amount", "line_total", "line_value"]);

    // Planning linkage
    const project_code = pick(row, ["project_code", "project", "inet_project"]);
    const activity_code = pick(row, ["activity_code", "activity", "activity_type", "activity_type_map"]);
    const area = pick(row, ["area", "center_area", "inet_center_area", "inet_area"]);

    return {
      po_no: po_no || "",
      customer: customer || "",
      transaction_date: transaction_date || "",
      schedule_date: schedule_date || "",
      status: status || "Active",
      poid: poid || "",
      po_line_no: po_line_no === undefined || po_line_no === "" ? "" : po_line_no,
      shipment_number: shipment_number || "",
      site_code: site_code || "",
      item_code: item_code || "",
      item_description: item_description || "",
      qty: qty === undefined || qty === "" ? "" : qty,
      rate: rate === undefined || rate === "" ? "" : rate,
      line_amount: line_amount === undefined || line_amount === "" ? "" : line_amount,
      project_code: project_code || "",
      activity_code: activity_code || "",
      area: area || "",
    };
  });
}

function EmptyState({ text }) {
  return <div className="empty-state">{text}</div>;
}

export default function POIntake() {
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  const [openImport, setOpenImport] = useState(false);
  const [openCreate, setOpenCreate] = useState(false);
  const [formMsg, setFormMsg] = useState("");

  const [openNewCustomer, setOpenNewCustomer] = useState(false);
  const [pageMsg, setPageMsg] = useState("");

  const [customers, setCustomers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [itemsCatalog, setItemsCatalog] = useState([]);

  const [form, setForm] = useState({
    po_no: "",
    customer: "",
    transaction_date: new Date().toISOString().slice(0, 10),
    schedule_date: new Date().toISOString().slice(0, 10),
    status: "Active",
    po_lines: [
      {
        poid: "",
        po_line_no: 1,
        shipment_number: "",
        site_code: "",
        item_code: "",
        item_description: "",
        qty: 1,
        uom: "",
        rate: 0,
        project_code: "",
        activity_code: "",
        area: "",
        line_amount: 0,
      },
    ],
  });

  const load = async () => {
    setLoading(true);
    setPageMsg("");
    try {
      const data = await pmApi.listPoIntake({ limit: 50, search: search || "" });
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setRows([]);
      setPageMsg(e?.message || "Failed to load PO Intake.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!openCreate) return;
    setFormMsg("");
    Promise.all([
      pmApi.listCustomers({ limit: 300 }).catch(() => []),
      pmApi.listProjects({ limit: 500 }).catch(() => []),
      pmApi.listItemCatalog({ limit: 900 }).catch(() => []),
    ]).then(([c, p, items]) => {
      setCustomers(Array.isArray(c) ? c : []);
      setProjects(Array.isArray(p) ? p : []);
      setItemsCatalog(Array.isArray(items) ? items : []);
    });
  }, [openCreate]);

  const importFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPageMsg("");
    setFormMsg("");
    const text = await file.text();
    const parsed = parseCsv(text);
    try {
      const result = await pmApi.importPoIntake(parsed);
      setPageMsg(`Imported: ${result?.created_count ?? 0} PO(s).`);
      if (result?.validation_errors?.length) {
        setPageMsg((m) => `${m} Validation errors: ${result.validation_errors.length}`);
      }
      setOpenImport(false);
      await load();
    } catch (err) {
      setPageMsg(err?.message || "Import failed");
    }
  };

  const subtotal = useMemo(() => form.po_lines.reduce((s, r) => s + Number(r.qty || 0) * Number(r.rate || 0), 0), [form.po_lines]);

  const onSelectItem = (idx, item_code) => {
    const it = itemsCatalog.find((d) => d.item_code === item_code);
    setForm((p) => ({
      ...p,
      po_lines: p.po_lines.map((row, i) =>
        i === idx
          ? {
              ...row,
              item_code,
              item_description: it?.description || it?.item_name || "",
              uom: it?.uom || "",
              rate: Number(it?.rate || 0),
              line_amount: Number(row.qty || 0) * Number(it?.rate || 0),
            }
          : row
      ),
    }));
  };

  const setLine = (idx, patch) => {
    setForm((p) => ({
      ...p,
      po_lines: p.po_lines.map((row, i) => {
        if (i !== idx) return row;
        const next = { ...row, ...patch };
        next.line_amount = Number(next.qty || 0) * Number(next.rate || 0);
        return next;
      }),
    }));
  };

  const addLine = () => {
    setForm((p) => ({
      ...p,
      po_lines: [
        ...p.po_lines,
        {
          poid: "",
          po_line_no: p.po_lines.length + 1,
          shipment_number: "",
          site_code: "",
          item_code: "",
          item_description: "",
          qty: 1,
          uom: "",
          rate: 0,
          project_code: "",
          activity_code: "",
          area: "",
          line_amount: 0,
        },
      ],
    }));
  };

  const removeLine = (idx) => {
    setForm((p) => ({
      ...p,
      po_lines: p.po_lines
        .filter((_, i) => i !== idx)
        .map((r, i) => ({ ...r, po_line_no: i + 1 })),
    }));
  };

  const save = async () => {
    setFormMsg("");
    if (!form.po_no.trim()) {
      setFormMsg("PO No is required.");
      return;
    }
    if (!form.customer) {
      setFormMsg("Customer is required.");
      return;
    }
    for (let i = 0; i < form.po_lines.length; i++) {
      const r = form.po_lines[i];
      if (!r.item_code) {
        setFormMsg(`Line ${i + 1}: Item is required.`);
        return;
      }
      if (!r.project_code) {
        setFormMsg(`Line ${i + 1}: Project Code is required.`);
        return;
      }
      if (Number(r.qty || 0) <= 0) {
        setFormMsg(`Line ${i + 1}: Qty must be > 0.`);
        return;
      }
    }

    const payload = {
      po_no: form.po_no,
      customer: form.customer,
      transaction_date: form.transaction_date,
      schedule_date: form.schedule_date,
      status: form.status,
      po_lines: form.po_lines.map((r, i) => ({
        poid: r.poid || `${form.po_no}-${i + 1}`,
        po_line_no: r.po_line_no || i + 1,
        shipment_number: r.shipment_number || "",
        site_code: r.site_code || "",
        item_code: r.item_code,
        item_description: r.item_description || "",
        qty: Number(r.qty || 0),
        uom: r.uom || "",
        rate: Number(r.rate || 0),
        project_code: r.project_code,
        activity_code: r.activity_code || "",
        area: r.area || "",
        line_amount: Number(r.line_amount || 0),
      })),
    };

    try {
      const result = await pmApi.createPoIntake(payload);
      setPageMsg(`Created PO Intake: ${result?.name}`);
      setOpenCreate(false);
      setFormMsg("");
      setForm({
        po_no: "",
        customer: "",
        transaction_date: new Date().toISOString().slice(0, 10),
        schedule_date: new Date().toISOString().slice(0, 10),
        status: "Active",
        po_lines: [
          {
            poid: "",
            po_line_no: 1,
            shipment_number: "",
            site_code: "",
            item_code: "",
            item_description: "",
            qty: 1,
            uom: "",
            rate: 0,
            project_code: "",
            activity_code: "",
            area: "",
            line_amount: 0,
          },
        ],
      });
      await load();
    } catch (e) {
      setFormMsg(e?.message || "Failed to create PO Intake.");
    }
  };

  const statusBadge = (st) => {
    const s = String(st || "").toLowerCase();
    if (s.includes("archive")) return "badge-risk";
    return "badge-done";
  };

  return (
    <div className="page-wrap">
      <div className="page-header">
        <h1 className="page-title">PO Intake</h1>
        <div className="toolbar">
          <input placeholder="Search PO / Customer / Project" value={search} onChange={(e) => setSearch(e.target.value)} />
          <button className="btn-secondary" onClick={load}>
            Search
          </button>
          <button className="btn-primary" onClick={() => setOpenCreate(true)}>
            Create PO
          </button>
          <button className="btn-primary" onClick={() => setOpenImport(true)}>
            Import CSV
          </button>
        </div>
      </div>

      {pageMsg ? <p>{pageMsg}</p> : null}

      <div className="card table-card">
        <div className="table-title">Incoming Customer POs</div>
        {loading ? (
          <EmptyState text="Loading..." />
        ) : rows.length === 0 ? (
          <EmptyState text="No PO Intake records found." />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>PO No</th>
                <th>Customer</th>
                <th>PO Date</th>
                <th>Schedule</th>
                <th>Total</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name}>
                  <td className="mono" style={{ color: "var(--blue)", fontWeight: 700 }}>
                    {r.po_no}
                  </td>
                  <td>{r.customer || "-"}</td>
                  <td>{r.transaction_date || "-"}</td>
                  <td>{r.schedule_date || "-"}</td>
                  <td>{Number(r.grand_total || 0).toFixed(2)}</td>
                  <td>
                    <span className={`badge ${statusBadge(r.status)}`}>{r.status || "Active"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={openImport} title="Import Customer PO (CSV)" onClose={() => setOpenImport(false)} maxWidth={520}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <div className="label" style={{ marginBottom: 8 }}>
              Expected CSV headers (case-insensitive)
            </div>
            <div style={{ color: "var(--text-muted)", fontSize: "0.86rem", lineHeight: 1.5 }}>
              Header: `po_no`, `customer`, `transaction_date`, `schedule_date`, `status`
              <br />
              Lines: `poid`, `po_line_no`, `shipment_number`, `site_code`, `item_code`, `item_description`, `qty`, `rate` (or `line_amount`),
              `project_code`, `activity_code`, `area`.
            </div>
          </div>

          <label className="btn-like" style={{ width: "fit-content" }}>
            Choose CSV
            <input type="file" accept=".csv" onChange={importFile} />
          </label>
          {pageMsg ? <p>{pageMsg}</p> : null}
        </div>
      </Modal>

      <Modal open={openCreate} title="Create PO Intake" onClose={() => setOpenCreate(false)} maxWidth={1280}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {formMsg ? <div className="form-error">{formMsg}</div> : null}

          <div className="form-grid" style={{ gridTemplateColumns: "repeat(5, minmax(180px, 1fr))" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span className="label">PO No.</span>
              <input value={form.po_no} onChange={(e) => setForm((p) => ({ ...p, po_no: e.target.value }))} />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span className="label">Customer</span>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <select value={form.customer} onChange={(e) => setForm((p) => ({ ...p, customer: e.target.value }))} style={{ flex: 1 }}>
                  <option value="">Select Customer</option>
                  {customers.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.customer_name || c.name}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn-like" onClick={() => setOpenNewCustomer(true)} title="Create Customer">
                  +
                </button>
              </div>
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span className="label">PO Date</span>
              <input type="date" value={form.transaction_date} onChange={(e) => setForm((p) => ({ ...p, transaction_date: e.target.value }))} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span className="label">Schedule</span>
              <input type="date" value={form.schedule_date} onChange={(e) => setForm((p) => ({ ...p, schedule_date: e.target.value }))} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span className="label">Status</span>
              <select value={form.status} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))}>
                <option value="Active">Active</option>
                <option value="Archive">Archive</option>
              </select>
            </label>
          </div>

          <div className="table-title" style={{ marginTop: 4, marginBottom: 0 }}>
            PO Lines
          </div>

          <div className="po-items-editor">
            <div className="po-items-editor-head">
              <span>#</span>
              <span>Item</span>
              <span>Qty</span>
              <span>Rate</span>
              <span>Amount</span>
              <span>Project</span>
              <span>Activity</span>
              <span>Area</span>
              <span>Shipment</span>
              <span />
            </div>

            {form.po_lines.map((row, idx) => (
              <div key={idx} className="po-item-row">
                <span className="mono" style={{ fontWeight: 800 }}>
                  {idx + 1}
                </span>

                <select value={row.item_code} onChange={(e) => onSelectItem(idx, e.target.value)}>
                  <option value="">Select Item</option>
                  {itemsCatalog.map((it) => (
                    <option key={it.item_code} value={it.item_code}>
                      {it.item_code}
                    </option>
                  ))}
                </select>

                <input type="number" value={row.qty} onChange={(e) => setLine(idx, { qty: Number(e.target.value || 0) })} />
                <input type="number" value={row.rate} onChange={(e) => setLine(idx, { rate: Number(e.target.value || 0) })} />

                <input readOnly value={Number(row.line_amount || 0).toFixed(2)} className="po-amount-readonly" />

                <select value={row.project_code} onChange={(e) => setLine(idx, { project_code: e.target.value })}>
                  <option value="">Select Project</option>
                  {projects.map((p) => (
                    <option key={p.name} value={p.project_code}>
                      {p.project_code}
                    </option>
                  ))}
                </select>

                <input placeholder="Activity" value={row.activity_code} onChange={(e) => setLine(idx, { activity_code: e.target.value })} />
                <input placeholder="Area" value={row.area} onChange={(e) => setLine(idx, { area: e.target.value })} />
                <input placeholder="Shipment" value={row.shipment_number} onChange={(e) => setLine(idx, { shipment_number: e.target.value })} />

                <button type="button" className="po-remove-btn" onClick={() => removeLine(idx)} title="Remove line">
                  ×
                </button>
              </div>
            ))}

            <button type="button" className="po-add-line-btn" onClick={addLine}>
              + Add Line
            </button>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
            <div />
            <div style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
              <span className="label" style={{ textTransform: "uppercase" }}>
                Subtotal
              </span>
              <strong style={{ fontSize: 18 }}>{subtotal.toFixed(2)}</strong>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 10 }}>
            <button className="btn-secondary" onClick={() => setOpenCreate(false)}>
              Cancel
            </button>
            <button className="btn-primary" onClick={save}>
              Create PO Intake
            </button>
          </div>
        </div>
      </Modal>

      <NewCustomerModal
        open={openNewCustomer}
        onClose={() => setOpenNewCustomer(false)}
        onCreated={(result) => {
          if (!result?.name) return;
          setCustomers((prev) => [{ name: result.name, customer_name: result.customer_name }, ...prev]);
          setForm((p) => ({ ...p, customer: result.name }));
        }}
      />
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import Modal from "../components/Modal";
import { pmApi } from "../services/api";

const normalizeKey = (header) =>
  String(header || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^\w]/g, "_")
    .replace(/_+/g, "_");

const pick = (obj, keys) => {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
  }
  return undefined;
};

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];

  const rawHeaders = lines[0].split(",").map((h) => h.trim());
  const headers = rawHeaders.map(normalizeKey);

  return lines.slice(1).map((line) => {
    const cols = line.split(",").map((c) => c.trim());
    const row = {};
    headers.forEach((h, i) => {
      row[h] = cols[i] ?? "";
    });

    // Customer PO header
    const po_no = pick(row, ["po_no", "po", "po_number", "po_number_"]);
    const customer = pick(row, ["customer", "customer_name", "vendor", "vendor_name", "supplier", "supplier_name"]);
    const transaction_date = pick(row, ["transaction_date", "po_date", "date", "order_date", "posting_date"]);
    const schedule_date = pick(row, ["schedule_date", "delivery_date", "requested_delivery_date", "ship_date"]);
    const status = pick(row, ["status", "po_status", "po_intake_status", "archive_status"]);

    // PO line fields (client doc.md mapping)
    const poid = pick(row, ["poid", "po_id", "poid_", "p_id"]);
    const po_line_no = pick(row, ["po_line_no", "po_line_no_", "line_no", "line_no_", "line_number"]);
    const shipment_number = pick(row, ["shipment_number", "shipment_no", "ship_no", "shipment"]);
    const site_code = pick(row, ["site_code", "site", "duid", "duid_network", "network"]);

    const item_code = pick(row, ["item_code", "item", "sku"]);
    const item_description = pick(row, ["item_description", "item_name", "description"]);
    const qty = pick(row, ["qty", "quantity", "u_qty", "order_qty"]);
    const rate = pick(row, ["rate", "unit_rate", "unit_price", "price"]);
    const line_amount = pick(row, ["line_amount", "amount", "line_value", "line_total"]);

    // Planning linkage fields
    const project_code = pick(row, ["project_code", "project", "inet_project", "project_code_"]);
    const activity_code = pick(row, ["activity_code", "activity", "activity_type", "activity_type_map"]);
    const area = pick(row, ["area", "center_area", "inet_center_area", "inet_area"]);

    return {
      po_no,
      customer,
      transaction_date,
      schedule_date,
      status,
      poid,
      po_line_no: po_line_no === undefined || po_line_no === "" ? "" : po_line_no,
      shipment_number: shipment_number || "",
      site_code: site_code || "",
      item_code,
      item_description: item_description || "",
      qty: qty === undefined || qty === "" ? "" : qty,
      rate: rate === undefined || rate === "" ? "" : rate,
      line_amount: line_amount === undefined || line_amount === "" ? "" : line_amount,
      project_code,
      activity_code,
      area,
    };
  });
}

export default function POIntake() {
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  const [openImport, setOpenImport] = useState(false);
  const [openCreate, setOpenCreate] = useState(false);
  const [msg, setMsg] = useState("");

  const [customers, setCustomers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [itemsCatalog, setItemsCatalog] = useState([]);

  const [form, setForm] = useState({
    po_no: "",
    customer: "",
    transaction_date: new Date().toISOString().slice(0, 10),
    schedule_date: new Date().toISOString().slice(0, 10),
    status: "Active",
    po_lines: [
      {
        poid: "",
        po_line_no: 1,
        shipment_number: "",
        site_code: "",
        item_code: "",
        item_description: "",
        qty: 1,
        uom: "",
        rate: 0,
        project_code: "",
        activity_code: "",
        area: "",
      },
    ],
  });

  const load = async () => {
    setLoading(true);
    try {
      const data = await pmApi.listPoIntake({ limit: 50, search: search || "" });
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!openCreate) return;
    setMsg("");
    Promise.all([
      pmApi.listCustomers({ limit: 300 }).catch(() => []),
      pmApi.listProjects({ limit: 500 }).catch(() => []),
      pmApi.listItemCatalog({ limit: 800 }).catch(() => []),
    ]).then(([c, p, items]) => {
      setCustomers(Array.isArray(c) ? c : []);
      setProjects(Array.isArray(p) ? p : []);
      setItemsCatalog(Array.isArray(items) ? items : []);
    });
  }, [openCreate]);

  const importFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setMsg("");
    const text = await file.text();
    const parsed = parseCsv(text);

    try {
      const result = await pmApi.importPoIntake(parsed);
      setMsg(`Imported: ${result?.created_count ?? 0} PO(s).`);
      if (Array.isArray(result?.validation_errors) && result.validation_errors.length) {
        setMsg((m) => `${m} Validation errors: ${result.validation_errors.length}`);
      }
      setOpenImport(false);
      await load();
    } catch (err) {
      setMsg(err?.message || "Import failed");
    }
  };

  const onSelectItem = (idx, item_code) => {
    const it = itemsCatalog.find((d) => d.item_code === item_code);
    setForm((p) => ({
      ...p,
      po_lines: p.po_lines.map((row, i) =>
        i === idx
          ? {
              ...row,
              item_code,
              uom: it?.uom || "",
              item_description: it?.description || it?.item_name || "",
            }
          : row
      ),
    }));
  };

  const addLineRow = () => {
    setForm((p) => ({
      ...p,
      po_lines: [
        ...p.po_lines,
        {
          poid: "",
          po_line_no: p.po_lines.length + 1,
          shipment_number: "",
          site_code: "",
          item_code: "",
          item_description: "",
          qty: 1,
          uom: "",
          rate: 0,
          project_code: "",
          activity_code: "",
          area: "",
        },
      ],
    }));
  };

  const removeLineRow = (idx) => {
    setForm((p) => ({
      ...p,
      po_lines: p.po_lines.filter((_, i) => i !== idx).map((r, i) => ({ ...r, po_line_no: i + 1 })),
    }));
  };

  const lineAmount = (row) => Number(row.qty || 0) * Number(row.rate || 0);
  const subtotal = useMemo(() => form.po_lines.reduce((s, r) => s + lineAmount(r), 0), [form.po_lines]);

  const savePoIntake = async () => {
    setMsg("");
    if (!form.po_no || !form.customer) {
      setMsg("PO No and Customer are required.");
      return;
    }
    for (let i = 0; i < form.po_lines.length; i++) {
      const r = form.po_lines[i];
      if (!r.item_code) {
        setMsg(`Line ${i + 1}: Item is required.`);
        return;
      }
      if (!r.project_code) {
        setMsg(`Line ${i + 1}: Project Code is required.`);
        return;
      }
      if (Number(r.qty || 0) <= 0) {
        setMsg(`Line ${i + 1}: Qty must be > 0.`);
        return;
      }
    }

    const payload = {
      po_no: form.po_no,
      customer: form.customer,
      transaction_date: form.transaction_date,
      schedule_date: form.schedule_date,
      status: form.status,
      po_lines: form.po_lines.map((r, i) => ({
        poid: r.poid || `${form.po_no}-${i + 1}`,
        po_line_no: r.po_line_no || i + 1,
        shipment_number: r.shipment_number || "",
        site_code: r.site_code || "",
        item_code: r.item_code,
        item_description: r.item_description || "",
        qty: Number(r.qty || 0),
        uom: r.uom || "",
        rate: Number(r.rate || 0),
        project_code: r.project_code,
        activity_code: r.activity_code || "",
        area: r.area || "",
        line_amount: lineAmount(r),
      })),
    };

    const result = await pmApi.createPoIntake(payload);
    setMsg(`Created PO Intake: ${result?.name}`);
    setOpenCreate(false);
    setForm((p) => ({
      ...p,
      po_no: "",
      customer: "",
      status: "Active",
      po_lines: [
        {
          poid: "",
          po_line_no: 1,
          shipment_number: "",
          site_code: "",
          item_code: "",
          item_description: "",
          qty: 1,
          uom: "",
          rate: 0,
          project_code: "",
          activity_code: "",
          area: "",
        },
      ],
    }));
    await load();
  };

  const statusLabel = useMemo(() => {
    return (r) => {
      const st = String(r?.status || "").toLowerCase();
      if (st.includes("archive")) return { text: "Archive", cls: "badge-risk" };
      return { text: "Active", cls: "badge-done" };
    };
  }, []);

  return (
    <div className="page-wrap">
      <div className="page-header">
        <h1 className="page-title">PO Intake</h1>
        <div className="toolbar">
          <input placeholder="Search PO / Supplier / Project" value={search} onChange={(e) => setSearch(e.target.value)} />
          <button className="btn-secondary" onClick={load}>
            Search
          </button>
          <button className="btn-primary" onClick={() => setOpenCreate(true)}>
            Create PO
          </button>
          <button className="btn-primary" onClick={() => setOpenImport(true)}>
            Import CSV
          </button>
        </div>
      </div>

      {msg ? <p>{msg}</p> : null}

      <div className="card table-card">
        <div className="table-title">Incoming Customer POs</div>
        <table className="data-table">
          <thead>
            <tr>
              <th>PO No.</th>
              <th>Customer</th>
              <th>PO Date</th>
              <th>Schedule</th>
              <th>Total</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="empty-state">
                  Loading...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="empty-state">
                  No PO Intake records found.
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const st = statusLabel(r);
                return (
                  <tr key={r.name}>
                    <td className="mono" style={{ color: "var(--blue)", fontWeight: 600 }}>{r.po_no}</td>
                    <td>{r.customer || "-"}</td>
                    <td>{r.transaction_date || "-"}</td>
                    <td>{r.schedule_date || "-"}</td>
                    <td>{r.grand_total || 0}</td>
                    <td>
                      <span className={`badge ${st.cls}`}>{st.text}</span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <Modal open={openImport} title="Import Customer PO (CSV)" onClose={() => setOpenImport(false)} maxWidth={520}>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
          <div>
            <div className="label" style={{ marginBottom: 8 }}>
              Expected CSV headers (case-insensitive)
            </div>
            <div style={{ color: "var(--text-muted)", fontSize: "0.86rem", lineHeight: 1.5 }}>
              Customer PO header: `po_no`, `customer`, `transaction_date`, `schedule_date`, `status`.
              <br />
              PO line fields: `poid`, `po_line_no`, `shipment_number`, `site_code`, `item_code`, `item_description`, `qty`, `rate` (or `line_amount`),
              `project_code`, `activity_code`, `area`.
            </div>
          </div>

          <label className="btn-like" style={{ width: "fit-content" }}>
            Choose CSV
            <input type="file" accept=".csv" onChange={importFile} />
          </label>

          {msg ? <p>{msg}</p> : null}
        </div>
      </Modal>

      <Modal open={openCreate} title="Create PO Intake" onClose={() => setOpenCreate(false)} maxWidth={1240}>
        <div className="form-grid" style={{ gridTemplateColumns: "repeat(5, minmax(180px, 1fr))" }}>
          <input placeholder="PO No." value={form.po_no} onChange={(e) => setForm((p) => ({ ...p, po_no: e.target.value }))} />
          <select value={form.customer} onChange={(e) => setForm((p) => ({ ...p, customer: e.target.value }))}>
            <option value="">Select Customer</option>
            {customers.map((c) => (
              <option key={c.name} value={c.name}>
                {c.customer_name || c.name}
              </option>
            ))}
          </select>
          <input type="date" value={form.transaction_date} onChange={(e) => setForm((p) => ({ ...p, transaction_date: e.target.value }))} />
          <input type="date" value={form.schedule_date} onChange={(e) => setForm((p) => ({ ...p, schedule_date: e.target.value }))} />
          <select value={form.status} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))}>
            <option value="Active">Active</option>
            <option value="Archive">Archive</option>
          </select>
        </div>

        <div style={{ marginTop: 14 }}>
          <div className="table-title" style={{ fontSize: 13, marginBottom: 10 }}>
            PO Lines
          </div>
          <div style={{ maxHeight: 360, overflow: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Item</th>
                  <th>Qty</th>
                  <th>Rate</th>
                  <th>Amount</th>
                  <th>Project</th>
                  <th>Activity</th>
                  <th>Area</th>
                  <th>Shipment</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {form.po_lines.map((row, idx) => (
                  <tr key={idx}>
                    <td className="mono">{idx + 1}</td>
                    <td style={{ minWidth: 220 }}>
                      <select
                        value={row.item_code}
                        onChange={(e) => onSelectItem(idx, e.target.value)}
                      >
                        <option value="">Select Item</option>
                        {itemsCatalog.map((it) => (
                          <option key={it.item_code} value={it.item_code}>
                            {it.item_code}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td style={{ width: 110 }}>
                      <input
                        type="number"
                        value={row.qty}
                        onChange={(e) => {
                          const v = Number(e.target.value || 0);
                          setForm((p) => ({
                            ...p,
                            po_lines: p.po_lines.map((r, i) => (i === idx ? { ...r, qty: v } : r)),
                          }));
                        }}
                      />
                    </td>
                    <td style={{ width: 110 }}>
                      <input
                        type="number"
                        value={row.rate}
                        onChange={(e) => {
                          const v = Number(e.target.value || 0);
                          setForm((p) => ({
                            ...p,
                            po_lines: p.po_lines.map((r, i) => (i === idx ? { ...r, rate: v } : r)),
                          }));
                        }}
                      />
                    </td>
                    <td style={{ width: 130 }}>
                      <span style={{ fontWeight: 800 }}>{lineAmount(row).toFixed(2)}</span>
                    </td>
                    <td style={{ minWidth: 220 }}>
                      <select
                        value={row.project_code}
                        onChange={(e) => {
                          const v = e.target.value;
                          setForm((p) => ({
                            ...p,
                            po_lines: p.po_lines.map((r, i) => (i === idx ? { ...r, project_code: v } : r)),
                          }));
                        }}
                      >
                        <option value="">Select Project</option>
                        {projects.map((p) => (
                          <option key={p.name} value={p.project_code}>
                            {p.project_code}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td style={{ width: 140 }}>
                      <input
                        placeholder="Activity"
                        value={row.activity_code}
                        onChange={(e) => {
                          const v = e.target.value;
                          setForm((p) => ({
                            ...p,
                            po_lines: p.po_lines.map((r, i) => (i === idx ? { ...r, activity_code: v } : r)),
                          }));
                        }}
                      />
                    </td>
                    <td style={{ width: 120 }}>
                      <input
                        placeholder="Area"
                        value={row.area}
                        onChange={(e) => {
                          const v = e.target.value;
                          setForm((p) => ({
                            ...p,
                            po_lines: p.po_lines.map((r, i) => (i === idx ? { ...r, area: v } : r)),
                          }));
                        }}
                      />
                    </td>
                    <td style={{ width: 140 }}>
                      <input
                        placeholder="Shipment"
                        value={row.shipment_number}
                        onChange={(e) => {
                          const v = e.target.value;
                          setForm((p) => ({
                            ...p,
                            po_lines: p.po_lines.map((r, i) => (i === idx ? { ...r, shipment_number: v } : r)),
                          }));
                        }}
                      />
                    </td>
                    <td style={{ width: 90 }}>
                      <button className="btn-danger-lite" onClick={() => removeLineRow(idx)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
            <button className="btn-secondary" onClick={addLineRow}>
              Add Line
            </button>
            <div style={{ fontSize: 14 }}>
              <span style={{ color: "var(--text-muted)", marginRight: 8 }}>Subtotal</span>
              <strong>{subtotal.toFixed(2)}</strong>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
          <button className="btn-secondary" onClick={() => setOpenCreate(false)}>
            Cancel
          </button>
          <button className="btn-primary" onClick={savePoIntake}>
            Create PO Intake
          </button>
        </div>
      </Modal>
    </div>
  );
}

