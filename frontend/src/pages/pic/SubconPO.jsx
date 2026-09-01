import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DataTableWrapper from "../../components/DataTableWrapper";
import TableRowsLimitFooter from "../../components/TableRowsLimitFooter";
import { useTableRowLimit, TABLE_ROW_LIMIT_ALL } from "../../context/TableRowLimitContext";
import { useDebounced } from "../../hooks/useDebounced";
import { pmApi } from "../../services/api";
import SearchableSelect from "../../components/SearchableSelect";
import DateRangePicker from "../../components/DateRangePicker";
import ExportExcelButton from "../../components/ExportExcelButton";
import { handleSearchPaste } from "../../utils/searchPaste";
import { useProgressiveRows } from "../../hooks/useProgressiveRows";
import RecordDetailView, { DetailHero, DetailStatTile } from "../../components/RecordDetailView";
import { PoStatusBadge, PicStatusBadge, SubPoStatusBadge } from "./picShared";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const fmtInt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });
const fmtQty = new Intl.NumberFormat("en", { maximumFractionDigits: 3 });

// Tabs map 1:1 onto the `stage` arg of list_subcon_po_rows. They deliberately
// OVERLAP — a line whose MS1 is paid while MS2 is still unordered appears on
// both Closed and To Order, because the MS2 order still has to be raised. That
// is why every action here works off an explicit milestone rather than
// assuming the row has only one open leg.
const TABS = [
  { id: "to_order", label: "To Order" },
  { id: "ordered", label: "Ordered" },
  { id: "invoiced", label: "Invoiced" },
  { id: "closed", label: "Closed" },
  { id: "all", label: "All" },
];

// SUB_PO_OVERALL_STATUSES in subcon_po.py — the milestone ladder plus the
// derived "Partially …" rollups. There is no subcon-side "cancelled": a killed
// line is cancelled on the PO line itself (dispatch_status / pic_status), which
// shows in the PO Status column.
const SUB_PO_STATUSES = [
  "Not Ordered",
  "Partially Ready",
  "Ready to Order",
  "Partially Created",
  "PO Created",
  "Partially Ordered",
  "PO Submitted",
  "Partially Invoiced",
  "Invoice Received",
  "Purchase Invoice Submitted",
  "Partially Closed",
  "Closed",
];

// Statuses PIC sets by hand. Everything else follows the documents, so
// offering them here would only let PIC contradict a real Purchase Order.
// "Ready to Order" is PIC's own readiness call — the purchase-side mirror of
// "Ready for Invoice" — and is what the Auto create mode picks up.
// "Closed" covers both a settled PO and backlog work paid outside this system.
const MANUAL_STATUSES = [
  { id: "Ready to Order", label: "Ready to Order" },
  { id: "Invoice Received", label: "Invoice Received" },
  { id: "Closed", label: "Closed" },
  { id: "", label: "Reset to Not Ordered" },
];

const TEXTAREA = {
  width: "100%", boxSizing: "border-box", padding: "6px 8px", fontSize: "0.85rem",
  border: "1px solid #e2e8f0", borderRadius: 6, resize: "vertical",
};

// One modal shell for every action, so all six behave and look identical
// (Esc/backdrop close, busy lock, error slot, footer buttons) instead of each
// re-implementing the chrome.
function Sheet({ title, count, busy, error, onClose, footer, children, width = 520 }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
         onClick={busy ? undefined : onClose}>
      <div style={{ background: "#fff", borderRadius: 12, width: `min(${width}px, 100%)`, maxHeight: "88vh", display: "flex", flexDirection: "column", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)" }}
           onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px 12px", borderBottom: "1px solid #f1f5f9" }}>
          <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 700 }}>
            {title}
            {count != null && count > 0 && (
              <span style={{ color: "#64748b", fontWeight: 500 }}> · {count}</span>
            )}
          </h3>
          <button type="button" onClick={onClose} disabled={busy}
            style={{ background: "none", border: "none", fontSize: 22, cursor: busy ? "default" : "pointer", color: "#94a3b8", lineHeight: 1 }}>&times;</button>
        </div>
        <div style={{ padding: "14px 20px", overflow: "auto", flex: 1 }}>
          {children}
          {error && (
            <div className="notice error" style={{ marginTop: 12, marginBottom: 0, fontSize: "0.82rem" }}>
              <span>!</span> {error}
            </div>
          )}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, padding: "12px 20px 16px", borderTop: "1px solid #f1f5f9" }}>
          {footer}
        </div>
      </div>
    </div>
  );
}

// Full-record view, same component and layout the other PIC pages use so the
// "View" column behaves identically everywhere.
// One consolidated Remark instead of two per-milestone fields, and the
// per-milestone columns dropped — the list already shows Subcon Status and
// Remark, and the money is in the hero tiles above.
function detailFields(row) {
  const drop = new Set([
    "sub_po_status_ms1", "sub_po_status_ms2",
    "sub_po_remark_ms1", "sub_po_remark_ms2",
    "sub_po_pct_ms1", "sub_po_pct_ms2",
    "sub_po_amount_ms1", "sub_po_amount_ms2",
    "expected_payout_ms1", "expected_payout_ms2",
    "vat_ms1", "vat_ms2",
    "can_order_ms1", "can_order_ms2", "ready_ms1", "ready_ms2",
    "supplier_missing",
  ]);
  const out = {};
  Object.entries(row).forEach(([k, v]) => { if (!drop.has(k)) out[k] = v; });
  const a = (row.sub_po_remark_ms1 || "").trim();
  const b = (row.sub_po_remark_ms2 || "").trim();
  out.remark = (a && b) ? `MS1: ${a} · MS2: ${b}` : (a || b || null);
  return out;
}

// Small key/value line used by the identity + document blocks. Values wrap
// instead of truncating — RecordDetailView's Pill caps at 220px with an
// ellipsis, which cut Subcontract / Supplier / DUID mid-word, and that Pill is
// shared with the other PIC pages so it can't be widened just for this one.
function KV({ label, value, mono }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </div>
      <div style={{ fontSize: "0.86rem", fontWeight: 600, color: "#0f172a", overflowWrap: "anywhere",
                    fontFamily: mono ? "monospace" : undefined }}>
        {value || "—"}
      </div>
    </div>
  );
}

function DocStateChip({ state }) {
  const tone = state === "Submitted" ? { bg: "#ecfdf5", fg: "#047857", bd: "#a7f3d0" }
    : state === "Cancelled" ? { bg: "#fef2f2", fg: "#b91c1c", bd: "#fecaca" }
      : { bg: "#fffbeb", fg: "#b45309", bd: "#fde68a" };
  return (
    <span style={{ fontSize: 10.5, fontWeight: 800, padding: "1px 7px", borderRadius: 999,
                   background: tone.bg, color: tone.fg, border: `1px solid ${tone.bd}` }}>
      {state}
    </span>
  );
}

function DetailModal({ row, onClose }) {
  const [docs, setDocs] = useState(null);
  const name = row?.po_dispatch;
  useEffect(() => {
    if (!name) { setDocs(null); return; }
    let dead = false;
    setDocs(null);
    pmApi.getSubconLineDocuments(name)
      .then((d) => { if (!dead) setDocs(d); })
      .catch(() => { if (!dead) setDocs({ purchase_orders: [], purchase_invoices: [] }); });
    return () => { dead = true; };
  }, [name]);

  if (!row) return null;
  const pos = docs?.purchase_orders || [];
  const pis = docs?.purchase_invoices || [];

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", zIndex: 10001, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div style={{ width: "min(900px, 100%)", maxHeight: "88vh", overflow: "auto", background: "#fff", borderRadius: 14, padding: 20, boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700 }}>{row.poid || row.po_dispatch}</h3>
          <button className="btn-secondary" onClick={onClose}>Close</button>
        </div>

        {/* Identity, in full — these are the values the pills were clipping. */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                      gap: 12, padding: "12px 14px", border: "1px solid #e2e8f0",
                      borderRadius: 10, marginBottom: 14 }}>
          <KV label="Subcontract" value={row.subcontractor_name || row.subcontract} />
          <KV label="Supplier" value={row.supplier_name || row.supplier} />
          <KV label="DUID" value={row.site_code} mono />
          <KV label="Project" value={row.project_code} mono />
        </div>

        <div style={{ marginBottom: 14 }}>
          <DetailHero>
            <DetailStatTile label="Subcon Status" value={<SubPoStatusBadge value={row.sub_po_status} />} />
            <DetailStatTile label="Subcon MS1" value={<SubPoStatusBadge value={row.sub_po_status_ms1} />} />
            <DetailStatTile label="Subcon MS2"
              value={row.ms2_amount ? <SubPoStatusBadge value={row.sub_po_status_ms2} /> : "—"} />
            <DetailStatTile label="Payout %" value={row.payout_pct != null ? `${fmtQty.format(row.payout_pct)}%` : "—"} />
            <DetailStatTile label="Line Amount" value={fmt.format(row.line_amount || 0)} />
            <DetailStatTile label="Payout MS1"
              value={fmt.format(row.sub_po_amount_ms1 || row.expected_payout_ms1 || 0)}
              tone="green"
              accent={row.vat_ms1 ? `+ ${fmt.format(row.vat_ms1)} VAT` : undefined} />
            <DetailStatTile label="Payout MS2"
              value={row.ms2_amount ? fmt.format(row.sub_po_amount_ms2 || row.expected_payout_ms2 || 0) : "—"}
              tone="green"
              accent={row.ms2_amount && row.vat_ms2 ? `+ ${fmt.format(row.vat_ms2)} VAT` : undefined} />
          </DetailHero>
        </div>

        {/* Documents, properly — replaces the raw "name|MS1|Submitted" CSV
            fields, and is the only place the supplier's own bill reference and
            the attached invoice file can be seen. */}
        <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, marginBottom: 14 }}>
          <div style={{ padding: "9px 14px", borderBottom: "1px solid #e2e8f0", background: "#f8fafc",
                        fontSize: 10.5, fontWeight: 800, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Purchase Orders {docs ? `· ${pos.length}` : ""}
          </div>
          {!docs ? (
            <div style={{ padding: 14, color: "#94a3b8", fontSize: "0.84rem" }}>Loading…</div>
          ) : pos.length === 0 ? (
            <div style={{ padding: 14, color: "#94a3b8", fontSize: "0.84rem" }}>No Purchase Order raised yet.</div>
          ) : pos.map((d) => (
            <div key={d.name} style={{ padding: "10px 14px", borderTop: "1px solid #f1f5f9",
                                       display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <a href={d.url} target="_blank" rel="noreferrer"
                     style={{ fontFamily: "monospace", fontSize: "0.8rem", fontWeight: 700 }}>{d.name}</a>
                  <DocStateChip state={d.state} />
                </div>
                <div style={{ fontSize: "0.74rem", color: "#64748b", marginTop: 2 }}>
                  {d.milestones.join("+") || "—"}
                </div>
              </div>
              <KV label="PO Date" value={d.date} />
              <KV label="Total (incl. VAT)" value={`${d.currency || "SAR"} ${fmt.format(d.grand_total)}`} />
            </div>
          ))}
        </div>

        <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, marginBottom: 14 }}>
          <div style={{ padding: "9px 14px", borderBottom: "1px solid #e2e8f0", background: "#f8fafc",
                        fontSize: 10.5, fontWeight: 800, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Purchase Invoices {docs ? `· ${pis.length}` : ""}
          </div>
          {!docs ? (
            <div style={{ padding: 14, color: "#94a3b8", fontSize: "0.84rem" }}>Loading…</div>
          ) : pis.length === 0 ? (
            <div style={{ padding: 14, color: "#94a3b8", fontSize: "0.84rem" }}>No supplier invoice recorded yet.</div>
          ) : pis.map((d) => (
            <div key={d.name} style={{ padding: "10px 14px", borderTop: "1px solid #f1f5f9" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <a href={d.url} target="_blank" rel="noreferrer"
                       style={{ fontFamily: "monospace", fontSize: "0.8rem", fontWeight: 700 }}>{d.name}</a>
                    <DocStateChip state={d.state} />
                  </div>
                  <div style={{ fontSize: "0.74rem", color: "#64748b", marginTop: 2 }}>
                    {d.milestones.join("+") || "—"}
                    {d.purchase_order ? ` · from ${d.purchase_order}` : ""}
                  </div>
                </div>
                <KV label="Supplier Bill No" value={d.bill_no} mono />
                <KV label="Supplier Bill Date" value={d.bill_date} />
                <KV label="Total (incl. VAT)" value={`${d.currency || "SAR"} ${fmt.format(d.grand_total)}`} />
              </div>
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
                  Attachments
                </div>
                {d.attachments.length === 0 ? (
                  <span style={{ fontSize: "0.8rem", color: "#94a3b8" }}>No file attached</span>
                ) : (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {d.attachments.map((f) => (
                      <a key={f.file_url} href={f.file_url} target="_blank" rel="noreferrer"
                         style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: "0.78rem",
                                  padding: "3px 9px", borderRadius: 6, border: "1px solid #a7f3d0",
                                  background: "#ecfdf5", color: "#065f46", textDecoration: "none",
                                  maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                         title={f.file_name}>
                        📄 {f.file_name}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <RecordDetailView
          row={detailFields(row)}
          hiddenFields={[
            // in the identity block / hero / documents sections above
            "po_dispatch", "poid", "subcontractor_name", "supplier", "site_code",
            "project_code", "payout_pct", "line_amount", "sub_po_status",
            "purchase_orders_csv", "purchase_invoices_csv",
          ]}
          keyOrder={[
            "remark", "sub_po_supplier",
            "sub_po_date_ms1", "sub_po_date_ms2",
            "sub_paid_date_ms1", "sub_paid_date_ms2",
            "pic_status_ms1", "pic_status_ms2",
            "ms1_pct", "ms2_pct", "ms1_amount", "ms2_amount",
            "subcontract", "contract_model", "inet_margin_pct",
            "po_no", "po_line_no", "item_code", "item_description",
            "qty", "rate", "tax_rate",
            "project_name", "site_name", "center_area", "region_type",
            "im", "im_full_name", "dispatch_status",
            "ms1_invoiced", "ms2_invoiced",
            "ms1_applied_date", "ms2_applied_date",
            "ms1_invoice_month", "ms2_invoice_month",
            "ms1_payment_received_date", "ms2_payment_received_date",
          ]}
        />
      </div>
    </div>
  );
}

// Click-or-drag upload zone. A bare <input type="file"> was the weakest part
// of this screen — this keeps the same input under the hood (so keyboard and
// screen readers still work) but hides it behind a real target.
function FileDrop({ file, onPick, disabled, accept }) {
  const inputRef = useRef(null);
  const [over, setOver] = useState(false);
  const pick = (f) => { if (f) onPick(f); };
  return (
    <div>
      <input ref={inputRef} type="file" accept={accept} disabled={disabled}
        style={{ display: "none" }}
        onChange={(e) => pick(e.target.files?.[0])} />
      {file ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: "1px solid #a7f3d0", background: "#ecfdf5", borderRadius: 8 }}>
          <span style={{ fontSize: 18 }}>📄</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "0.84rem", fontWeight: 600, color: "#065f46", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {file.name}
            </div>
            <div style={{ fontSize: "0.74rem", color: "#059669" }}>
              {file.size < 1024 * 1024
                ? `${Math.max(1, Math.round(file.size / 1024))} KB`
                : `${(file.size / 1024 / 1024).toFixed(1)} MB`}
            </div>
          </div>
          <button type="button" className="btn-secondary" disabled={disabled}
            style={{ padding: "2px 9px", fontSize: "0.76rem" }}
            onClick={() => { onPick(null); if (inputRef.current) inputRef.current.value = ""; }}>
            Remove
          </button>
        </div>
      ) : (
        <button type="button" disabled={disabled}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files?.[0]); }}
          style={{
            width: "100%", padding: "18px 12px", textAlign: "center", cursor: disabled ? "default" : "pointer",
            border: `1.5px dashed ${over ? "#1d4ed8" : "#cbd5e1"}`, borderRadius: 8,
            background: over ? "#eff6ff" : "#f8fafc", color: "#64748b", fontSize: "0.84rem",
          }}>
          <div style={{ fontSize: 20, marginBottom: 4 }}>⬆</div>
          <div style={{ fontWeight: 600, color: "#334155" }}>Drop the invoice here, or click to browse</div>
          <div style={{ fontSize: "0.74rem", marginTop: 2 }}>PDF, image, Excel or Word</div>
        </button>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="form-group" style={{ marginBottom: 12 }}>
      <label>{label}</label>
      {children}
    </div>
  );
}

// Read-only facts about what the action will do — replaces the paragraphs of
// explanatory prose the modals used to carry.
function Summary({ rows }) {
  return (
    <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 12px", marginBottom: 14, fontSize: "0.84rem" }}>
      {rows.filter(Boolean).map(([k, v]) => (
        <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "2px 0" }}>
          <span style={{ color: "#64748b" }}>{k}</span>
          <span style={{ fontWeight: 600, textAlign: "right" }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

// Renders "PUR-ORD-2026-00001|MS1|Submitted, ..." as linked chips into Desk.
// The CSV carries one entry per (document, milestone) pair, so a single PO that
// covers both MS1 and MS2 of a line arrives twice under the same name — group
// by document and list its milestones once instead of repeating the name.
function DocLinks({ csv, base }) {
  if (!csv) return <span style={{ color: "#94a3b8" }}>—</span>;
  const byName = new Map();
  String(csv).split(", ").filter(Boolean).forEach((chunk) => {
    const [name, ms, state] = chunk.split("|");
    const cur = byName.get(name) || { name, state, ms: [] };
    if (ms && !cur.ms.includes(ms)) cur.ms.push(ms);
    byName.set(name, cur);
  });
  const docs = Array.from(byName.values());
  return (
    <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 4 }}>
      {docs.map(({ name, state, ms }) => {
        const tone = state === "Submitted" ? "#047857" : state === "Cancelled" ? "#b91c1c" : "#b45309";
        const legs = ms.sort().join("+");
        return (
          <a key={name} href={`/app/${base}/${name}`} target="_blank" rel="noreferrer"
             onClick={(e) => e.stopPropagation()}
             title={`${name} · ${legs || "—"} · ${state || "?"}`}
             style={{ fontFamily: "monospace", fontSize: "0.72rem", color: tone, textDecoration: "none", borderBottom: `1px dotted ${tone}` }}>
            {name}{legs ? ` ${legs}` : ""}
          </a>
        );
      })}
    </span>
  );
}

export default function SubconPO() {
  const { rowLimit } = useTableRowLimit();
  const [tab, setTab] = useState("to_order");
  const [rows, setRows] = useState([]);
  const [totals, setTotals] = useState({});
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const visibleRows = useProgressiveRows(rows, { paused: loading });
  const displayLimit = rowLimit === TABLE_ROW_LIMIT_ALL ? Infinity : rowLimit;
  const displayedCount = Math.min(rows.length, displayLimit);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [toastMsg, setToastMsg] = useState(null);
  const [capability, setCapability] = useState(null);
  const [detailRow, setDetailRow] = useState(null);

  const [search, setSearch] = useState("");
  const searchDebounced = useDebounced(search, 300);

  // Per-column "Manage Table" filters. Each column's value is matched only
  // against that column on the backend (col_filter_map in list_subcon_po_rows),
  // not blended into the top search box.
  const [columnFilters, setColumnFilters] = useState({});
  useEffect(() => {
    const onFiltersChanged = (e) => {
      if (e.detail?.tableKey !== "subcon-po-v6") return;
      setColumnFilters(e.detail.filters || {});
    };
    document.addEventListener("tablepro:filters-changed", onFiltersChanged);
    return () => document.removeEventListener("tablepro:filters-changed", onFiltersChanged);
  }, []);
  // Tabs are different datasets through one table key — don't carry a filter across.
  useEffect(() => {
    setColumnFilters({});
    document.dispatchEvent(new CustomEvent("tablepro:clear-filters", {
      detail: { tableKey: "subcon-po-v6" },
    }));
  }, [tab]);
  const activeColumnFilters = Object.fromEntries(
    Object.entries(columnFilters).filter(([, v]) => (
      v && typeof v === "object"
        ? (Array.isArray(v.values) && v.values.some((x) => String(x ?? "").trim()))
          || !!v.blanks || !!String(v.contains || "").trim()
        : String(v || "").trim()
    ))
  );
  const columnFiltersKey = JSON.stringify(activeColumnFilters);
  const columnFiltersDebounced = useDebounced(columnFiltersKey, 300);

  // Excel column-filter dropdowns cascade off exactly the query the rows
  // were fetched with (recorded by the fetch effect below).
  const queryArgsRef = useRef({});
  const tabRef = useRef(tab);
  useEffect(() => {
    const onRequestOptions = (e) => {
      if (e.detail?.tableKey !== "subcon-po-v6") return;
      e.detail.respond(pmApi.getColumnFilterOptions({
        source: "subcon_po",
        col_key: e.detail.colKey,
        bucket: e.detail.bucket,
        search: e.detail.search,
        limit: e.detail.limit,
        portal_filters: queryArgsRef.current,
        extra: { stage: tabRef.current },
        exclude_column: e.detail.colKey,
      }));
    };
    document.addEventListener("tablepro:request-column-options", onRequestOptions);
    return () => document.removeEventListener("tablepro:request-column-options", onRequestOptions);
  }, []);
  const [projectFilter, setProjectFilter] = useState([]);
  const [subconFilter, setSubconFilter] = useState([]);
  const [supplierFilter, setSupplierFilter] = useState([]);
  const [modelFilter, setModelFilter] = useState([]);
  const [statusFilter, setStatusFilter] = useState([]);
  const [duidFilter, setDuidFilter] = useState([]);
  const [poFilter, setPoFilter] = useState([]);
  const [dateRange, setDateRange] = useState({ from: "", to: "" });

  // ONE action at a time, named by what it does. Replaces the three separate
  // show* booleans — each tab exposes only its own stage's actions, so the
  // toolbar no longer carries every button on every tab.
  const [action, setAction] = useState(null);   // ready|create|receive|close|reopen|status
  const [busy, setBusy] = useState(false);
  const [actErr, setActErr] = useState(null);
  const [createResult, setCreateResult] = useState(null);

  const [readyMs, setReadyMs] = useState("MS1");         // Mark Ready
  const [recvPo, setRecvPo] = useState("");              // Receive Invoice
  const [recvBillNo, setRecvBillNo] = useState("");
  const [recvBillDate, setRecvBillDate] = useState("");
  const [recvFile, setRecvFile] = useState(null);
  const [recvSummary, setRecvSummary] = useState(null);   // real PO header, fetched on open

  // Re-read the PO whenever the choice changes. A line carries one PO per
  // milestone, so a single selected row can legitimately offer two — the modal
  // has to let PIC pick which instalment they are invoicing rather than
  // silently taking the first (which is what blocked receiving the second PO).
  const loadRecvSummary = useCallback((po) => {
    setRecvPo(po);
    setRecvSummary(null);
    if (!po) return;
    pmApi.getPurchaseOrderSummary(po)
      .then(setRecvSummary)
      .catch((e) => setActErr(e.message || "Could not load the Purchase Order"));
  }, []);
  const [actDate, setActDate] = useState("");            // Close / Reopen
  const [actRemark, setActRemark] = useState("");
  const [stStatus, setStStatus] = useState("Closed");    // generic Update Status
  const [stMs, setStMs] = useState("BOTH");

  const [options, setOptions] = useState({});
  const [refreshKey, setRefreshKey] = useState(0);
  // Same skip-refetch-on-shrink contract as PICTracker: shrinking the row limit
  // never needs a round-trip, and the render hides the surplus rows via CSS
  // rather than slicing the array.
  const lastFetchRef = useRef({ signature: null, limit: null });
  const load = useCallback(() => {
    // Also clear the skip-refetch cache. The signature includes refreshKey so a
    // bump alone is enough today, but this makes a forced reload unconditional
    // rather than dependent on that coupling holding.
    lastFetchRef.current = { signature: null, limit: null };
    setRefreshKey((k) => k + 1);
  }, []);

  // "All" on a tab the user didn't ask for must not silently re-trigger an
  // unlimited fetch — same guard as PODispatch.jsx / IMWorkDone.jsx.
  const confirmedAllTabRef = useRef(null);

  // Keyed on refreshKey, not [] — creating a PO adds to the Purchase Order
  // filter list, and mounting-only meant that dropdown was stale until a full
  // page reload.
  useEffect(() => {
    pmApi.getSubconPoFilterOptions().then(setOptions).catch(() => {});
    pmApi.getSubconPoCapability().then(setCapability).catch(() => {});
  }, [refreshKey]);

  // Submitting a Purchase Order (To Order -> Ordered) and submitting the
  // Purchase Invoice both happen in Desk, in a different browser tab. Returning
  // here would otherwise show the pre-submit stage until Refresh was pressed.
  const awaySinceRef = useRef(0);
  useEffect(() => {
    const onHide = () => { awaySinceRef.current = Date.now(); };
    const onShow = () => {
      if (document.visibilityState !== "visible") return;
      if (action || busy) return;              // don't yank the table under a modal
      const away = Date.now() - (awaySinceRef.current || 0);
      if (away < 4000) return;                 // a stray focus event, not a trip to Desk
      // Deliberately skipped on "All": re-running an unlimited query on every
      // tab switch is exactly the freeze this page is careful to avoid. The
      // Refresh button is still there for that case.
      if (rowLimit === TABLE_ROW_LIMIT_ALL) return;
      awaySinceRef.current = Date.now();
      load();
    };
    // Named, not inline — this effect re-registers whenever a modal opens or
    // closes, so an unremovable listener would accumulate one per action.
    const onVisibility = () => (
      document.visibilityState === "visible" ? onShow() : onHide());
    window.addEventListener("blur", onHide);
    window.addEventListener("focus", onShow);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", onHide);
      window.removeEventListener("focus", onShow);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [action, busy, rowLimit, load]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const portal = {};
      if (searchDebounced.trim()) portal.search = searchDebounced.trim();
      if (projectFilter.length) portal.project_code = projectFilter;
      if (subconFilter.length) portal.subcontract = subconFilter;
      if (supplierFilter.length) portal.supplier = supplierFilter;
      if (modelFilter.length) portal.contract_model = modelFilter;
      if (statusFilter.length) portal.sub_po_status = statusFilter;
      if (duidFilter.length) portal.site_code = duidFilter;
      if (poFilter.length) portal.purchase_order = poFilter;
      if (dateRange.from) portal.from_date = dateRange.from;
      if (dateRange.to) portal.to_date = dateRange.to;
      const colFilters = JSON.parse(columnFiltersDebounced);
      if (Object.keys(colFilters).length) portal.column_filters = colFilters;
      queryArgsRef.current = portal;
      tabRef.current = tab;
      const signature = JSON.stringify([tab, portal, refreshKey]);

      const prev = lastFetchRef.current;
      const alreadyHaveEnough = prev.signature === signature && (
        prev.limit === TABLE_ROW_LIMIT_ALL
        || (rowLimit !== TABLE_ROW_LIMIT_ALL && rowLimit <= prev.limit)
      );
      if (alreadyHaveEnough) return;

      if (rowLimit === TABLE_ROW_LIMIT_ALL && confirmedAllTabRef.current !== tab) {
        // Switching tabs while the limit is still "All" — confirm once per tab
        // instead of firing an unlimited query the user never asked for here.
        confirmedAllTabRef.current = tab;
      }

      setLoading(true);
      setError(null);
      try {
        const res = await pmApi.listSubconPoRows(tab, portal, rowLimit);
        if (cancelled) return;
        const fetched = Array.isArray(res?.rows) ? res.rows : [];
        setRows(fetched);
        setTotals(res?.totals || {});
        setTotalCount(Number(res?.total_count) || 0);
        setSelected(new Set());
        lastFetchRef.current = { signature, limit: rowLimit };
      } catch (err) {
        if (cancelled) return;
        setError(err.message || "Failed to load subcon PO lines");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, searchDebounced, columnFiltersDebounced, projectFilter, subconFilter, supplierFilter, modelFilter,
      statusFilter, duidFilter, poFilter, dateRange, rowLimit, refreshKey]);

  const projectOptions = options.project_code || [];
  const subconOptions = (options.subcontract || []).map((v) => ({ id: v, label: v }));
  const supplierOptions = (options.supplier || []).map((v) => ({ id: v, label: v }));
  const modelOptions = options.contract_model || [];
  const duidOptions = (options.site_code || []).map((v) => ({ id: v, label: v }));

  const hasFilters = !!(search || projectFilter.length || subconFilter.length
    || supplierFilter.length || modelFilter.length || statusFilter.length
    || duidFilter.length || poFilter.length || dateRange.from || dateRange.to);

  function clearFilters() {
    setSearch(""); setProjectFilter([]); setSubconFilter([]); setSupplierFilter([]);
    setModelFilter([]); setStatusFilter([]); setDuidFilter([]); setPoFilter([]);
    setDateRange({ from: "", to: "" });
  }

  const footTotals = useMemo(() => {
    const shown = rows.slice(0, displayedCount);
    const sum = (k) => shown.reduce((a, r) => a + (Number(r[k]) || 0), 0);
    // Payout totals must sum whatever the cells actually render — the stamped
    // PO amount where one exists, the expected figure otherwise — or the
    // footer wouldn't add up to the column above it.
    const payout = (n) => shown.reduce((a, r) => a
      + (Number(r[`sub_po_amount_ms${n}`]) || Number(r[`expected_payout_ms${n}`]) || 0), 0);
    return {
      line_amount: sum("line_amount"),
      ms1_amount: sum("ms1_amount"), ms2_amount: sum("ms2_amount"),
      payout_ms1: payout(1), payout_ms2: payout(2),
      vat_ms1: sum("vat_ms1"), vat_ms2: sum("vat_ms2"),
    };
  }, [rows, displayedCount]);

  const selectedRows = useMemo(
    () => rows.filter((r) => selected.has(r.po_dispatch)), [rows, selected]);

  // Create PO acts on exactly what PIC marked Ready to Order — there is no
  // milestone picker any more. Marking Ready (which does take a milestone) is
  // the separate, earlier step, so the readiness marks ARE the choice. Each
  // ready milestone becomes its own item row on the same per-supplier PO.
  // MS1/MS2 remarks are separate fields; label them only when both exist, so
  // the common single-remark case stays terse.
  const remarkOf = (r) => {
    const a = (r.sub_po_remark_ms1 || "").trim();
    const b = (r.sub_po_remark_ms2 || "").trim();
    if (a && b) return `MS1: ${a} · MS2: ${b}`;
    return a || b || "";
  };

  const readyLegs = (r) => (r.ready_ms1 ? 1 : 0) + (r.ready_ms2 ? 1 : 0);
  const creatable = useMemo(
    () => selectedRows.filter((r) => readyLegs(r) > 0 && !r.supplier_missing),
    [selectedRows]);
  const creatableLegs = useMemo(
    () => creatable.reduce((n, r) => n + readyLegs(r), 0), [creatable]);
  const expectedTotal = useMemo(() => creatable.reduce((a, r) => a
    + (r.ready_ms1 ? Number(r.expected_payout_ms1) || 0 : 0)
    + (r.ready_ms2 ? Number(r.expected_payout_ms2) || 0 : 0), 0), [creatable]);
  const blockedNoSupplier = useMemo(
    () => selectedRows.filter((r) => r.supplier_missing && readyLegs(r) > 0),
    [selectedRows]);
  const supplierSpread = useMemo(
    () => Array.from(new Set(creatable.map((r) => r.supplier).filter(Boolean))), [creatable]);
  // One PO per supplier, so the popup shows the actual breakdown rather than a
  // count with a supplier name crammed in beside it.
  const createBySupplier = useMemo(() => {
    const by = new Map();
    creatable.forEach((r) => {
      const key = r.supplier_name || r.supplier || "—";
      const cur = by.get(key) || { supplier: key, lines: 0, legs: 0, payout: 0, vat: 0 };
      cur.lines += 1;
      cur.legs += readyLegs(r);
      if (r.ready_ms1) {
        cur.payout += Number(r.expected_payout_ms1) || 0;
        cur.vat += Number(r.vat_ms1) || 0;
      }
      if (r.ready_ms2) {
        cur.payout += Number(r.expected_payout_ms2) || 0;
        cur.vat += Number(r.vat_ms2) || 0;
      }
      by.set(key, cur);
    });
    return Array.from(by.values()).sort((a, b) => b.payout - a.payout);
  }, [creatable]);
  const createVat = useMemo(
    () => createBySupplier.reduce((a, r) => a + r.vat, 0), [createBySupplier]);

  // Selected lines that still have an unordered milestone to mark Ready. Used
  // for the toolbar button count, which can't know the milestone yet.
  const markable = useMemo(
    () => selectedRows.filter((r) => r.can_order_ms1 || r.can_order_ms2), [selectedRows]);
  // Once the modal names a milestone, narrow to that leg and total its payout —
  // Mark Ready takes ONE milestone at a time (mark twice for both), so the
  // count and amount shown must be for that leg alone, not the union.
  const readyTargets = useMemo(() => selectedRows.filter(
    (r) => (readyMs === "MS1" ? r.can_order_ms1 : r.can_order_ms2)),
    [selectedRows, readyMs]);
  const readyTotal = useMemo(() => {
    const k = readyMs === "MS1" ? "expected_payout_ms1" : "expected_payout_ms2";
    return readyTargets.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  }, [readyTargets, readyMs]);
  // Selected lines sitting at Purchase Invoice Submitted — what Close acts on.
  // Invoiced, to PIC, means the sub's bill is recorded — whether or not
  // Accounts has submitted the Purchase Invoice yet. Both states can be closed.
  const INVOICED = ["Invoice Received", "Purchase Invoice Submitted"];
  const closable = useMemo(() => selectedRows.filter(
    (r) => INVOICED.includes(r.sub_po_status_ms1)
        || INVOICED.includes(r.sub_po_status_ms2)), [selectedRows]);
  const reopenable = useMemo(() => selectedRows.filter(
    (r) => r.sub_po_status_ms1 === "Closed" || r.sub_po_status_ms2 === "Closed"),
    [selectedRows]);

  // Selected rows that sit on the PO being invoiced, and the not-yet-invoiced
  // legs of those rows — the instalment being recorded.
  const recvLines = useMemo(() => (recvPo
    ? selectedRows.filter((r) => String(r.purchase_orders_csv || "").includes(recvPo))
    : []), [selectedRows, recvPo]);
  const recvItems = useMemo(() => {
    if (!recvSummary) return [];
    const wanted = new Set(recvLines.map((r) => r.po_dispatch));
    return recvSummary.items.filter((i) => !wanted.size || wanted.has(i.poid));
  }, [recvSummary, recvLines]);
  const recvOpen = useMemo(() => recvItems.filter((i) => !i.invoiced_on), [recvItems]);
  const recvNet = useMemo(
    () => recvOpen.reduce((a, i) => a + (Number(i.amount) || 0), 0), [recvOpen]);
  // Effective VAT rate taken from the PO itself (taxes / net), so the figure
  // matches whatever template the PO actually carries rather than assuming 15%.
  const recvVatRate = useMemo(() => {
    const net = Number(recvSummary?.net_total) || 0;
    return net ? (Number(recvSummary?.total_taxes) || 0) / net : 0;
  }, [recvSummary]);
  const recvVat = useMemo(() => Math.round(recvNet * recvVatRate * 100) / 100,
    [recvNet, recvVatRate]);

  // Purchase Orders behind the selection, split by docstatus. A line can carry
  // one PO per milestone, so a single selected row legitimately has two.
  const posByState = useMemo(() => {
    const out = { Draft: [], Submitted: [], Cancelled: [] };
    selectedRows.forEach((r) => {
      String(r.purchase_orders_csv || "").split(", ").filter(Boolean).forEach((chunk) => {
        const [name, , state] = chunk.split("|");
        if (out[state] && !out[state].includes(name)) out[state].push(name);
      });
    });
    return out;
  }, [selectedRows]);
  const submittedPos = posByState.Submitted;

  // (line|milestone) pairs that already sit on a live Purchase Invoice, read
  // off the row's own invoice CSV.
  const invoicedLegs = useMemo(() => {
    const set = new Set();
    selectedRows.forEach((r) => {
      String(r.purchase_invoices_csv || "").split(", ").filter(Boolean).forEach((chunk) => {
        const [, ms, state] = chunk.split("|");
        if (state !== "Cancelled") set.add(`${r.po_dispatch}|${ms}`);
      });
    });
    return set;
  }, [selectedRows]);

  // Only POs with something LEFT to invoice. A line carries one PO per
  // milestone, so once MS1 is invoiced its PO is finished — offering it (let
  // alone defaulting to it) just showed "0 lines" and a dead button.
  const receivablePos = useMemo(() => submittedPos.filter((po) =>
    selectedRows.some((r) =>
      String(r.purchase_orders_csv || "").split(", ").filter(Boolean).some((chunk) => {
        const [name, ms, state] = chunk.split("|");
        return name === po && state === "Submitted"
               && !invoicedLegs.has(`${r.po_dispatch}|${ms}`);
      }))), [submittedPos, selectedRows, invoicedLegs]);

  function toggleRow(name) {
    setSelected((p) => {
      const next = new Set(p);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }
  function toggleAll() {
    if (rows.length === 0) return;
    const visible = rows.slice(0, displayedCount);
    if (visible.length > 0 && visible.every((r) => selected.has(r.po_dispatch))) {
      setSelected(new Set());
    } else {
      setSelected(new Set(visible.map((r) => r.po_dispatch)));
    }
  }

  function openAction(name, init) {
    setActErr(null); setCreateResult(null);
    if (init) init();
    setAction(name);
  }
  function closeAction() {
    if (busy) return;
    setAction(null); setActErr(null); setCreateResult(null);
  }
  function done(msg, ms = 6000) {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), ms);
    setSelected(new Set());
    load();
  }
  // Every action funnels through here so busy/error/close behave identically
  // in all five modals instead of each one re-implementing it.
  async function run(fn, failMsg, keepOpen = false) {
    setBusy(true); setActErr(null);
    try {
      await fn();
      if (!keepOpen) setAction(null);
    } catch (err) {
      setActErr(err.message || failMsg);
    } finally {
      setBusy(false);
    }
  }

  const markReady = () => run(async () => {
    const res = await pmApi.bulkUpdateSubconPoStatus(
      readyTargets.map((r) => r.po_dispatch), "Ready to Order", readyMs, "", actRemark,
      ["", "Ready to Order"]);
    done(`${res.updated} line(s) marked Ready to Order (${readyMs}).`);
  }, "Could not mark ready");

  const createPo = () => run(async () => {
    // No milestone argument — AUTO orders exactly what is marked Ready.
    const res = await pmApi.createPurchaseOrderFromPic(
      creatable.map((r) => r.po_dispatch), "AUTO");
    setCreateResult(res);
    done(`${res.created.length} draft Purchase Order(s) created — `
      + `${res.line_count} line(s), SAR ${fmt.format(res.amount)}.`, 9000);
  }, "Purchase Order creation failed", true);

  const receiveInvoice = () => run(async () => {
    // Only the selected lines of that PO — partial invoicing.
    const res = await pmApi.receiveSupplierInvoice(
      recvPo, recvLines.map((r) => r.po_dispatch), recvBillNo, recvBillDate);
    // Attach the supplier's own invoice file to the Purchase Invoice we just
    // drafted. Non-fatal: the invoice is already recorded, so a failed upload
    // is reported rather than rolling the whole action back.
    let attachNote = "";
    if (recvFile) {
      try {
        await pmApi.uploadDocAttachment(res.attach_to_doctype, res.attach_to_name, recvFile);
        attachNote = ` ${recvFile.name} attached.`;
      } catch (e) {
        attachNote = ` (file not attached: ${e.message})`;
      }
    }
    setRecvBillNo(""); setRecvBillDate(""); setRecvFile(null);
    done(`Invoice received — draft ${res.purchase_invoice}, SAR ${fmt.format(res.amount)}.`
      + attachNote, 9000);
  }, "Could not record the invoice");

  const closeLines = () => run(async () => {
    const res = await pmApi.bulkUpdateSubconPoStatus(
      closable.map((r) => r.po_dispatch), "Closed", "AUTO", actDate, actRemark,
      INVOICED);
    setActRemark("");
    done(`${res.updated} line(s) closed${actDate ? ` on ${actDate}` : ""}.`);
  }, "Could not close");

  const reopenLines = () => run(async () => {
    const res = await pmApi.bulkUpdateSubconPoStatus(
      reopenable.map((r) => r.po_dispatch), "Purchase Invoice Submitted", "AUTO",
      "", actRemark, ["Closed"]);
    setActRemark("");
    done(`${res.updated} line(s) reopened.`);
  }, "Could not reopen");

  const updateStatus = () => run(async () => {
    const res = await pmApi.bulkUpdateSubconPoStatus(
      Array.from(selected), stStatus, stMs, actDate, actRemark);
    setActRemark("");
    done(`${res.updated} line(s) → ${stStatus || "Not Ordered"}.`);
  }, "Update failed");

  // Which buttons this tab gets. `n` drives the count in the label and the
  // disabled state, `why` explains a disabled button instead of letting the
  // user click through to an error.
  const ACTIONS = {
    to_order: [
      { key: "ready", label: "Mark Ready", n: markable.length, primary: false,
        why: "Select lines with an unordered milestone" },
      { key: "create", label: "Create PO", n: creatable.length, primary: true,
        why: blockedNoSupplier.length
          ? "Selected lines have no Supplier linked on their Subcontract Master"
          : "Mark a milestone Ready to Order first" },
    ],
    ordered: [
      { key: "receive", label: "Receive Invoice", n: receivablePos.length, primary: true,
        hideCount: receivablePos.length < 2,
        why: submittedPos.length
          ? "Every Purchase Order on this selection is already fully invoiced"
          : "Select lines covered by a submitted Purchase Order" },
    ],
    invoiced: [
      { key: "close", label: "Close", n: closable.length, primary: true,
        why: "Select lines whose supplier invoice is recorded" },
    ],
    closed: [
      { key: "reopen", label: "Reopen", n: reopenable.length, primary: false,
        why: "Select closed lines" },
    ],
    all: [
      { key: "status", label: "Update Status", n: selected.size, primary: true,
        why: "Select lines" },
    ],
  };
  const tabActions = ACTIONS[tab] || [];

  function beginAction(key) {
    if (key === "receive") {
      const po = receivablePos[0] || "";
      openAction("receive", () => loadRecvSummary(po));
    } else if (key === "close") {
      openAction("close", () => { setActDate(""); setActRemark(""); });
    } else if (key === "reopen") {
      openAction("reopen", () => setActRemark(""));
    } else if (key === "ready") {
      openAction("ready", () => setActRemark(""));
    } else {
      openAction(key);
    }
  }

  const COLS = 32;

  return (
    <div>
      <div className="page-header">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h1 className="page-title">Subcon PO</h1>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 999, background: "#f1f5f9", color: "#334155", border: "1px solid #e2e8f0", fontSize: "0.74rem", fontWeight: 700 }}>
              <span style={{ opacity: 0.85 }}>Total Lines</span> <span>{fmtInt.format(totalCount)}</span>
            </div>
            {!!totals.expected_ms1 || !!totals.expected_ms2 ? (
              <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 999, background: "#ecfdf5", color: "#047857", border: "1px solid #a7f3d0", fontSize: "0.74rem", fontWeight: 700 }}>
                <span style={{ opacity: 0.85 }}>Expected Payout</span>
                <span>{fmt.format((totals.expected_ms1 || 0) + (totals.expected_ms2 || 0))}</span>
              </div>
            ) : null}
          </div>
          <div className="page-subtitle">
            Purchase Orders to subcontractors, priced from the Subcontract Master payout %.
          </div>
        </div>
        <div className="page-actions">
          <ExportExcelButton filename={`subcon-po-${tab}`} rows={rows.slice(0, displayedCount)} />
          <button type="button" className="btn-secondary" onClick={load} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* Tab bar — always rendered (see the tab pattern in inet_app/CLAUDE.md) */}
      <div role="tablist" style={{ display: "flex", gap: 4, padding: 4, background: "#f1f5f9", borderRadius: 8, border: "1px solid #e2e8f0", margin: "0 16px 8px", width: "fit-content" }}>
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button key={t.id} type="button" role="tab" aria-selected={active}
              onClick={() => setTab(t.id)}
              style={{ padding: "5px 14px", fontSize: "0.78rem", fontWeight: 700, border: "none", borderRadius: 6, cursor: "pointer", background: active ? "#1d4ed8" : "transparent", color: active ? "#fff" : "#475569" }}>
              {t.label}
            </button>
          );
        })}
      </div>

      {toastMsg && (
        <div className="notice success" style={{ margin: "0 16px 8px" }}>
          <span>✓</span> {toastMsg}
          <button type="button" className="btn-secondary" style={{ marginLeft: 12, fontSize: "0.7rem", padding: "2px 8px" }} onClick={() => setToastMsg(null)}>Dismiss</button>
        </div>
      )}

      {capability && !capability.purchase_tax_template && (
        <div className="notice error" style={{ margin: "0 16px 8px" }}>
          <span>!</span> No Purchase Taxes and Charges Template set in INET Settings —
          Purchase Orders will be raised with no VAT. Set it before ordering.
        </div>
      )}
      <div className="toolbar">
        <input
          type="search"
          placeholder="Search POID, PO, Item, Project, DUID, Subcontract…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onPaste={(e) => handleSearchPaste(e, setSearch)}
          style={{ minWidth: 260 }}
        />
        <SearchableSelect multi value={subconFilter} onChange={setSubconFilter} options={subconOptions} placeholder="Subcontract" minWidth={170} />
        <SearchableSelect multi value={supplierFilter} onChange={setSupplierFilter} options={supplierOptions} placeholder="Supplier" minWidth={160} />
        <SearchableSelect multi value={modelFilter} onChange={setModelFilter} options={modelOptions} placeholder="Contract Model" minWidth={150} />
        <SearchableSelect multi value={projectFilter} onChange={setProjectFilter} options={projectOptions} placeholder="All Projects" minWidth={150} />
        <SearchableSelect multi value={statusFilter} onChange={setStatusFilter} options={SUB_PO_STATUSES} placeholder="Subcon PO Status" minWidth={165} />
        <SearchableSelect multi value={duidFilter} onChange={setDuidFilter} options={duidOptions} placeholder="DUID" minWidth={165} />
        {/* Filter to one supplier PO, select all, Receive Invoice — that's how
            you bill a whole PO in one go now that invoicing is per-line. */}
        <SearchableSelect multi value={poFilter} onChange={setPoFilter}
          options={(options.purchase_order || []).map((v) => ({ id: v, label: v }))}
          placeholder="Purchase Order" minWidth={175} />
        <DateRangePicker value={dateRange} onChange={setDateRange} />
        {hasFilters && <button className="btn-secondary" onClick={clearFilters}>Clear</button>}
        <div className="toolbar-actions">
          {selected.size > 0 && (
            <span style={{ fontSize: "0.78rem", color: "#64748b", whiteSpace: "nowrap" }}>
              {selected.size} selected
            </span>
          )}
          {/* Only this tab's actions. A button that can't act is disabled with
              the reason in its tooltip — never enabled so the user can click
              through to an error message. */}
          {tabActions.map((a) => {
            const disabled = a.n === 0;
            return (
              <button
                key={a.key}
                type="button"
                className={a.primary ? "btn-primary" : "btn-secondary"}
                disabled={disabled}
                title={disabled ? a.why : ""}
                onClick={() => beginAction(a.key)}
              >
                {a.label}{!a.hideCount && a.n > 0 ? ` (${a.n})` : ""}
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="notice error" style={{ margin: "0 16px 8px" }}>
          <span>!</span> {error}
        </div>
      )}

      {/* ONE page-content / ONE DataTableWrapper, always rendered — the CSS
          full-height chain matches on :has(.page-content > .data-table-wrapper)
          and must resolve the same way on every tab. */}
      <div className="page-content">
        <DataTableWrapper loading={loading && rows.length > 0}>
          {/* v2: the column set changed (added Status) — a data-table-key must
              never be reused across different column sets or DataTablePro's
              saved widths/filters desync from the body cells. */}
          <table className="data-table" data-excel-filter-all="1" data-table-key="subcon-po-v6">
            <thead>
              <tr>
                <th>
                  <input type="checkbox"
                    checked={displayedCount > 0 && rows.slice(0, displayedCount).every((r) => selected.has(r.po_dispatch))}
                    onChange={toggleAll} />
                </th>
                <th>Subcontract</th>
                <th>Supplier</th>
                <th>Contract Model</th>
                <th style={{ textAlign: "right" }}>Payout %</th>
                <th>POID</th>
                <th>PO No</th>
                <th>Project</th>
                <th>DUID</th>
                {/* One rolled-up status for the whole line — the two
                    per-milestone status columns were dropped in favour of it.
                    See _overall_status_sql in subcon_po.py. */}
                <th>Subcon Status</th>
                <th>Item</th>
                <th>Description</th>
                <th style={{ textAlign: "right" }}>Qty</th>
                <th style={{ textAlign: "right" }}>Rate</th>
                <th style={{ textAlign: "right" }}>Line Amount</th>
                <th>PO Status</th>
                <th>IM</th>
                <th style={{ textAlign: "right" }}>MS1 %</th>
                <th style={{ textAlign: "right" }}>MS1 Amt</th>
                <th>Cust. MS1</th>
                <th>Subcon MS1</th>
                <th style={{ textAlign: "right" }}>Payout MS1</th>
                <th style={{ textAlign: "right" }}>VAT MS1</th>
                <th style={{ textAlign: "right" }}>MS2 Amt</th>
                <th>Cust. MS2</th>
                <th>Subcon MS2</th>
                <th style={{ textAlign: "right" }}>Payout MS2</th>
                <th style={{ textAlign: "right" }}>VAT MS2</th>
                <th>Purchase Orders</th>
                <th>Purchase Invoices</th>
                {/* Remarks captured by Mark Ready / Close / Update Status had
                    nowhere to be read back — this is that column. */}
                <th>Remark</th>
                <th data-excel-filter="0">View</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={COLS} style={{ padding: 0 }}>
                    {loading ? (
                      <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Loading…</div>
                    ) : (
                      <div className="empty-state">
                        <div className="empty-icon">🧾</div>
                        <h3>{hasFilters ? "No matching lines" : "Nothing here"}</h3>
                        <p>
                          {hasFilters ? "Adjust your filters."
                            : tab === "to_order"
                              ? "Every subcontractor line has been ordered or closed. Only SUB-type contracts appear here — INET crews never get a supplier PO."
                              : "No lines at this stage yet."}
                        </p>
                      </div>
                    )}
                  </td>
                </tr>
              ) : visibleRows.map((r, idx) => (
                <tr key={r.po_dispatch}
                    data-doc-name={r.po_dispatch}
                    className={selected.has(r.po_dispatch) ? "row-selected" : ""}
                    onClick={() => toggleRow(r.po_dispatch)}
                    style={idx >= displayLimit ? { display: "none" } : { cursor: "pointer" }}>
                  <td onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(r.po_dispatch)} onChange={() => toggleRow(r.po_dispatch)} />
                  </td>
                  <td style={{ fontSize: "0.82rem" }} title={r.subcontract || ""}>{r.subcontractor_name || r.subcontract || "—"}</td>
                  <td style={{ fontSize: "0.82rem" }}>
                    {r.supplier_missing
                      ? <span style={{ color: "#b45309", fontWeight: 700 }} title="No Supplier linked on the Subcontract Master — this line can't be ordered">⚠ Not linked</span>
                      : (r.supplier_name || r.supplier || "—")}
                  </td>
                  <td style={{ fontSize: "0.82rem" }}>{r.contract_model || "—"}</td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.payout_pct != null ? `${fmtQty.format(r.payout_pct)}%` : "—"}</td>
                  <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{r.poid}</td>
                  <td>{r.po_no || "—"}</td>
                  <td title={r.project_name || ""}>{r.project_code || "—"}</td>
                  <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }} title={r.site_name || ""}>{r.site_code || "—"}</td>
                  {/* Plain rollup — the Subcon MS1 / MS2 columns show which
                      leg a "Partially …" refers to, so no qualifier needed. */}
                  <td><SubPoStatusBadge value={r.sub_po_status} /></td>
                  <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{r.item_code || "—"}</td>
                  <td style={{ fontSize: "0.82rem", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.item_description || ""}>{r.item_description || "—"}</td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.qty != null ? fmtQty.format(r.qty) : "—"}</td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.rate != null ? fmt.format(r.rate) : "—"}</td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{fmt.format(r.line_amount || 0)}</td>
                  <td><PoStatusBadge value={r.dispatch_status} /></td>
                  <td style={{ fontSize: "0.82rem" }} title={r.im || ""}>{r.im_full_name || "—"}</td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.ms1_pct != null ? `${fmtInt.format(r.ms1_pct)}%` : "—"}</td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt.format(r.ms1_amount || 0)}</td>
                  <td><PicStatusBadge value={r.pic_status_ms1} /></td>
                  <td><SubPoStatusBadge value={r.sub_po_status_ms1} /></td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}
                      title={r.sub_po_amount_ms1 ? "Amount on the issued Purchase Order" : "Expected from the master payout %"}>
                    {fmt.format(r.sub_po_amount_ms1 || r.expected_payout_ms1 || 0)}
                  </td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#64748b" }}>{fmt.format(r.vat_ms1 || 0)}</td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt.format(r.ms2_amount || 0)}</td>
                  <td><PicStatusBadge value={r.pic_status_ms2} /></td>
                  <td>{r.ms2_amount ? <SubPoStatusBadge value={r.sub_po_status_ms2} />
                        : <span style={{ color: "#cbd5e1" }}>—</span>}</td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}
                      title={r.sub_po_amount_ms2 ? "Amount on the issued Purchase Order" : "Expected from the master payout %"}>
                    {r.ms2_amount
                      ? fmt.format(r.sub_po_amount_ms2 || r.expected_payout_ms2 || 0)
                      : <span style={{ color: "#cbd5e1" }}>—</span>}
                  </td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#64748b" }}>
                    {r.ms2_amount ? fmt.format(r.vat_ms2 || 0) : <span style={{ color: "#cbd5e1" }}>—</span>}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}><DocLinks csv={r.purchase_orders_csv} base="purchase-order" /></td>
                  <td onClick={(e) => e.stopPropagation()}><DocLinks csv={r.purchase_invoices_csv} base="purchase-invoice" /></td>
                  <td style={{ fontSize: "0.78rem", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#64748b" }}
                      title={remarkOf(r)}>
                    {remarkOf(r) || "—"}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <button type="button" className="btn-secondary"
                      style={{ padding: "3px 10px", fontSize: "0.78rem" }}
                      onClick={() => setDetailRow(r)}>View</button>
                  </td>
                </tr>
              ))}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                {/* One <td> per column — colSpan in a tfoot desyncs the
                    column widths DataTablePro computes from the header. */}
                <tr style={{ background: "#f1f5f9", fontWeight: 700 }}>
                  <td></td>{/* checkbox */}
                  <td style={{ fontSize: "0.78rem", color: "#475569" }}>
                    {fmtInt.format(displayedCount)} row{displayedCount !== 1 ? "s" : ""}
                  </td>{/* Subcontract */}
                  <td></td>{/* Supplier */}
                  <td></td>{/* Contract Model */}
                  <td></td>{/* Payout % */}
                  <td></td>{/* POID */}
                  <td></td>{/* PO No */}
                  <td></td>{/* Project */}
                  <td></td>{/* DUID */}
                  <td></td>{/* Subcon Status */}
                  <td></td>{/* Item */}
                  <td></td>{/* Description */}
                  <td></td>{/* Qty */}
                  <td></td>{/* Rate */}
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt.format(footTotals.line_amount)}</td>
                  <td></td>{/* PO Status */}
                  <td></td>{/* IM */}
                  <td></td>{/* MS1 % */}
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt.format(footTotals.ms1_amount)}</td>
                  <td></td>{/* Cust. MS1 */}
                  <td></td>{/* Subcon MS1 */}
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt.format(footTotals.payout_ms1)}</td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt.format(footTotals.vat_ms1)}</td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt.format(footTotals.ms2_amount)}</td>
                  <td></td>{/* Cust. MS2 */}
                  <td></td>{/* Subcon MS2 */}
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt.format(footTotals.payout_ms2)}</td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt.format(footTotals.vat_ms2)}</td>
                  <td></td>{/* Purchase Orders */}
                  <td></td>{/* Purchase Invoices */}
                  <td></td>{/* Remark */}
                  <td></td>{/* View */}
                </tr>
              </tfoot>
            )}
          </table>
        </DataTableWrapper>
        <TableRowsLimitFooter
          placement="tableCard"
          loadedCount={displayedCount}
          filteredCount={displayedCount}
          filterActive={!!hasFilters}
        />
      </div>

      {action && (
        <Sheet
          title={{
            ready:   "Mark Ready to Order",
            create:  "Create Purchase Order",
            receive: "Receive Supplier Invoice",
            close:   "Close",
            reopen:  "Reopen",
            status:  "Update Subcon PO Status",
          }[action]}
          count={{
            ready: readyTargets.length, create: creatable.length,
            close: closable.length,
            reopen: reopenable.length, status: selected.size,
          }[action]}
          busy={busy}
          width={action === "create" ? 660 : action === "receive" ? 600 : 520}
          onClose={closeAction}
          error={actErr}
          footer={
            createResult ? (
              <button type="button" className="btn-primary" onClick={closeAction}>Done</button>
            ) : (
              <>
                <button type="button" className="btn-secondary" onClick={closeAction} disabled={busy}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy || !{
                    ready: readyTargets.length, create: creatable.length,
                    receive: recvOpen.length, close: closable.length,
                    reopen: reopenable.length, status: selected.size,
                  }[action]}
                  onClick={{
                    ready: markReady, create: createPo, receive: receiveInvoice,
                    close: closeLines, reopen: reopenLines, status: updateStatus,
                  }[action]}
                >
                  {busy ? "Working…" : {
                    ready:   `Mark Ready (${readyTargets.length})`,
                    create:  `Create ${supplierSpread.length || 1} PO${supplierSpread.length === 1 ? "" : "s"}`,
                    receive: "Record Invoice",
                    close:   `Close (${closable.length})`,
                    reopen:  `Reopen (${reopenable.length})`,
                    status:  `Update (${selected.size})`,
                  }[action]}
                </button>
              </>
            )
          }
        >
          {action === "ready" && (
            <>
              <Field label="Milestone">
                <select value={readyMs} onChange={(e) => setReadyMs(e.target.value)} disabled={busy}>
                  <option value="MS1">MS1</option>
                  <option value="MS2">MS2</option>
                </select>
              </Field>
              <Summary rows={[
                ["Total lines", fmtInt.format(readyTargets.length)],
                ["Total amount", `SAR ${fmt.format(readyTotal)}`],
              ]} />
              <Field label="Remark (optional)">
                <textarea rows={2} value={actRemark} disabled={busy}
                  onChange={(e) => setActRemark(e.target.value)} style={TEXTAREA} />
              </Field>
            </>
          )}

          {action === "create" && (createResult ? (
            <>
              <div className="notice success" style={{ marginBottom: 12 }}>
                <span>✓</span> {createResult.created.length} draft Purchase Order(s) created.
              </div>
              <table className="data-table" style={{ marginBottom: 4 }}>
                <thead><tr><th>Purchase Order</th><th>Supplier</th><th style={{ textAlign: "right" }}>Lines</th><th style={{ textAlign: "right" }}>Amount</th><th>MS</th></tr></thead>
                <tbody>
                  {createResult.created.map((c) => (
                    <tr key={c.purchase_order}>
                      <td><a href={c.purchase_order_url} target="_blank" rel="noreferrer" style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{c.purchase_order}</a></td>
                      <td style={{ fontSize: "0.82rem" }}>{c.supplier}</td>
                      <td style={{ textAlign: "right" }}>{c.line_count}</td>
                      <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt.format(c.amount)}</td>
                      <td>{c.milestones}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <>
              <div style={{ fontSize: "0.82rem", color: "#64748b", marginBottom: 10 }}>
                One Purchase Order per supplier · {fmtInt.format(creatableLegs)} line
                {creatableLegs !== 1 ? "s" : ""} → {fmtInt.format(supplierSpread.length)} PO
                {supplierSpread.length !== 1 ? "s" : ""}
              </div>

              {/* Cards, not a table: a supplier name is long enough to force
                  horizontal scrolling in a modal-width table, and it's the one
                  thing that must stay readable. Here it wraps and the money
                  stays right-aligned. */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {createBySupplier.map((g) => (
                  <div key={g.supplier}
                       style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, padding: "12px 14px", border: "1px solid #e2e8f0", borderRadius: 10, background: "#fff" }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: "0.88rem", fontWeight: 700, color: "#0f172a", overflowWrap: "anywhere" }}>
                        {g.supplier}
                      </div>
                      <div style={{ fontSize: "0.76rem", color: "#64748b", marginTop: 3 }}>
                        {fmtInt.format(g.lines)} line{g.lines !== 1 ? "s" : ""}
                        {g.legs !== g.lines ? ` · ${fmtInt.format(g.legs)} PO rows` : ""}
                        {" · 1 Purchase Order"}
                      </div>
                    </div>
                    <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <div style={{ fontSize: "1.05rem", fontWeight: 800, color: "#047857", fontVariantNumeric: "tabular-nums" }}>
                        {fmt.format(g.payout + g.vat)}
                      </div>
                      <div style={{ fontSize: "0.74rem", color: "#64748b", fontVariantNumeric: "tabular-nums", marginTop: 2 }}>
                        {fmt.format(g.payout)} + {fmt.format(g.vat)} VAT
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {createBySupplier.length > 1 && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 16, marginTop: 10, paddingTop: 10, borderTop: "1px solid #e2e8f0" }}>
                  <span style={{ fontWeight: 700 }}>
                    Total · {fmtInt.format(supplierSpread.length)} Purchase Orders
                  </span>
                  <span style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <span style={{ fontSize: "1.05rem", fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
                      {fmt.format(expectedTotal + createVat)}
                    </span>
                    <span style={{ display: "block", fontSize: "0.74rem", color: "#64748b", fontVariantNumeric: "tabular-nums" }}>
                      {fmt.format(expectedTotal)} + {fmt.format(createVat)} VAT
                    </span>
                  </span>
                </div>
              )}
            </>
          ))}

          {action === "receive" && (
            <>
              {receivablePos.length > 1 && (
                <Field label={`Purchase Order (${receivablePos.length} with lines to invoice)`}>
                  <select value={recvPo} disabled={busy}
                          onChange={(e) => loadRecvSummary(e.target.value)}>
                    {receivablePos.map((po) => <option key={po} value={po}>{po}</option>)}
                  </select>
                </Field>
              )}

              {/* PO header card — identifies the document, totals what THIS
                  instalment covers, and links into Desk to check the PO. */}
              <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden", marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 12px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: "monospace", fontWeight: 700, fontSize: "0.86rem" }}>{recvPo}</div>
                    <div style={{ fontSize: "0.78rem", color: "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {recvSummary ? (recvSummary.supplier_name || recvSummary.supplier) : "Loading…"}
                    </div>
                  </div>
                  <a href={recvSummary?.url || `/app/purchase-order/${recvPo}`}
                     target="_blank" rel="noreferrer" className="btn-secondary"
                     style={{ whiteSpace: "nowrap", textDecoration: "none", padding: "4px 10px", fontSize: "0.78rem" }}>
                    Open PO ↗
                  </a>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "6px 14px", padding: "10px 12px", fontSize: "0.84rem" }}>
                  {[
                    ["PO date", recvSummary?.transaction_date || "—"],
                    ["PO total (incl. VAT)", recvSummary ? fmt.format(recvSummary.grand_total) : "—"],
                    ["Lines on this PO", recvSummary ? fmtInt.format(recvSummary.line_count) : "—"],
                    ["Already invoiced", recvSummary ? fmtInt.format(recvSummary.invoiced_line_count) : "—"],
                  ].map(([k, v]) => (
                    <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ color: "#64748b" }}>{k}</span>
                      <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{v}</span>
                    </div>
                  ))}
                  <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "space-between", gap: 8, paddingTop: 6, marginTop: 2, borderTop: "1px solid #f1f5f9" }}>
                    <span style={{ fontWeight: 700 }}>
                      This invoice · {fmtInt.format(recvOpen.length)} line{recvOpen.length !== 1 ? "s" : ""}
                    </span>
                    <span style={{ textAlign: "right" }}>
                      <span style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums", color: "#047857" }}>
                        {recvSummary ? `${recvSummary.currency || "SAR"} ${fmt.format(recvNet + recvVat)}` : "—"}
                      </span>
                      <span style={{ display: "block", fontWeight: 500, color: "#64748b", fontSize: "0.74rem", fontVariantNumeric: "tabular-nums" }}>
                        {fmt.format(recvNet)} + {fmt.format(recvVat)} VAT
                        {recvVatRate ? ` (${(recvVatRate * 100).toFixed(0)}%)` : ""}
                      </span>
                    </span>
                  </div>
                </div>
                {recvItems.length > 0 && (
                  <div style={{ borderTop: "1px solid #e2e8f0", maxHeight: 140, overflow: "auto" }}>
                    {recvItems.map((it, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "5px 12px", fontSize: "0.78rem", borderTop: i ? "1px solid #f8fafc" : "none", opacity: it.invoiced_on ? 0.5 : 1 }}>
                        <span style={{ fontFamily: "monospace", color: "#475569", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                              title={`${it.poid_label} · ${it.item_code}${it.duid ? ` · ${it.duid}` : ""}${it.invoiced_on ? ` · already on ${it.invoiced_on}` : ""}`}>
                          {it.invoiced_on ? "✓ " : ""}{it.poid_label}
                          <span style={{ color: "#94a3b8" }}> {it.milestone}</span>
                        </span>
                        <span style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", textDecoration: it.invoiced_on ? "line-through" : "none" }}>
                          {fmt.format(it.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {recvSummary?.existing_purchase_invoices?.length > 0 && (
                <div className="notice" style={{ marginBottom: 12, fontSize: "0.82rem", background: "#eff6ff", borderColor: "#bfdbfe", color: "#1e40af" }}>
                  <span>i</span> This PO already has {recvSummary.existing_purchase_invoices.join(", ")}.
                  Lines they cover are struck through above and left out of this invoice.
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Field label="Supplier Invoice No">
                  <input type="text" value={recvBillNo} disabled={busy}
                    placeholder="e.g. INV-4471"
                    onChange={(e) => setRecvBillNo(e.target.value)} />
                </Field>
                <Field label="Supplier Invoice Date">
                  <input type="date" value={recvBillDate} disabled={busy}
                    onChange={(e) => setRecvBillDate(e.target.value)} />
                </Field>
              </div>
              <Field label="Attach Invoice">
                <FileDrop file={recvFile} onPick={setRecvFile} disabled={busy}
                  accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls,.doc,.docx" />
              </Field>
            </>
          )}

          {action === "close" && (
            <>
              <Summary rows={[
                ["Lines", fmtInt.format(closable.length)],
                ["From", "Invoice Received / Purchase Invoice Submitted"],
              ]} />
              <Field label="Closed On">
                <input type="date" value={actDate} disabled={busy}
                  onChange={(e) => setActDate(e.target.value)} />
              </Field>
              <Field label="Remark (optional)">
                <textarea rows={2} value={actRemark} disabled={busy}
                  onChange={(e) => setActRemark(e.target.value)} style={TEXTAREA} />
              </Field>
            </>
          )}

          {action === "reopen" && (
            <>
              <Summary rows={[
                ["Lines", fmtInt.format(reopenable.length)],
                ["Back to", "Purchase Invoice Submitted"],
              ]} />
              <Field label="Remark (optional)">
                <textarea rows={2} value={actRemark} disabled={busy}
                  onChange={(e) => setActRemark(e.target.value)} style={TEXTAREA} />
              </Field>
            </>
          )}

          {action === "status" && (
            <>
              <Field label="Milestone">
                <select value={stMs} onChange={(e) => setStMs(e.target.value)} disabled={busy}>
                  <option value="BOTH">Both milestones</option>
                  <option value="MS1">MS1 only</option>
                  <option value="MS2">MS2 only</option>
                </select>
              </Field>
              <Field label="New Status">
                <select value={stStatus} onChange={(e) => setStStatus(e.target.value)} disabled={busy}>
                  {MANUAL_STATUSES.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
              </Field>
              {stStatus === "Closed" && (
                <Field label="Closed On">
                  <input type="date" value={actDate} disabled={busy}
                    onChange={(e) => setActDate(e.target.value)} />
                </Field>
              )}
              <Field label="Remark (optional)">
                <textarea rows={2} value={actRemark} disabled={busy}
                  onChange={(e) => setActRemark(e.target.value)} style={TEXTAREA} />
              </Field>
            </>
          )}
        </Sheet>
      )}

      <DetailModal row={detailRow} onClose={() => setDetailRow(null)} />
    </div>
  );
}
