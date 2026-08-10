import { useCallback, useEffect, useState } from "react";
import { pmApi } from "../../services/api";
import SearchableSelect from "../../components/SearchableSelect";
import AttachmentsSection from "../../components/AttachmentsSection";
import { useTableRowLimit, TABLE_ROW_LIMIT_ALL } from "../../context/TableRowLimitContext";
import TableRowsLimitFooter from "../../components/TableRowsLimitFooter";
import { useProgressiveRows } from "../../hooks/useProgressiveRows";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtAmt(n) {
  return Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Amount the TL actually entered (VAT-inclusive grand total; falls back for old claims)
function grossAmt(c) {
  return Number(c?.grand_total ?? c?.total_claimed_amount) || 0;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// ── Status helpers ────────────────────────────────────────────────────────────

// Field user perspective: Draft = Pending (waiting for IM). Approved claims stay
// docstatus 0 until the accounts team submits them in ERPNext — still Approved here.
function effectiveStatus(claim) {
  if (!claim) return "Pending";
  const s = (claim.approval_status || "").toLowerCase();
  if (s === "draft" || !s) return "Pending";
  return claim.approval_status;
}

function statusClass(s) {
  const v = (s || "").toLowerCase();
  if (v === "approved") return "completed";
  if (v === "rejected") return "cancelled";
  if (v === "pending") return "in-progress";
  return "new";
}

function StatusBadge({ status }) {
  return (
    <span className={`status-badge ${statusClass(status)}`}>
      <span className="status-dot" />
      {status || "Draft"}
    </span>
  );
}

function paymentStatus(claim) {
  if (!claim) return null;
  if ((claim.status || "").toLowerCase() === "paid") return "Paid";
  if (effectiveStatus(claim) === "Approved") return "Unpaid";
  return null;
}

function PaymentBadge({ claim }) {
  const ps = paymentStatus(claim);
  if (!ps) return null;
  const isPaid = ps === "Paid";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 8px", borderRadius: 999, fontSize: "0.7rem", fontWeight: 700,
      background: isPaid ? "#dcfce7" : "#fef9c3",
      color: isPaid ? "#15803d" : "#92400e",
    }}>
      {isPaid ? "Paid" : "Unpaid"}
    </span>
  );
}

// ── Inline style helpers ──────────────────────────────────────────────────────

const inp = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid #e2e8f0",
  fontSize: "0.86rem",
  boxSizing: "border-box",
  fontFamily: "inherit",
  background: "#fff",
};

const lbl = (text, required) => (
  <label style={{ display: "block", fontSize: "0.76rem", fontWeight: 600, color: "#475569", marginBottom: 4 }}>
    {text}{required && <span style={{ color: "#ef4444", marginLeft: 2 }}>*</span>}
  </label>
);

// ── Modal ─────────────────────────────────────────────────────────────────────

function Modal({ open, onClose, title, children, footer, width = 600 }) {
  if (!open) return null;
  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "20px 16px", overflowY: "auto" }}
      onClick={onClose}
    >
      <div
        style={{ background: "#fff", borderRadius: 14, width, maxWidth: "calc(100vw - 32px)", boxShadow: "0 20px 60px rgba(0,0,0,0.22)", display: "flex", flexDirection: "column", overflow: "hidden", marginTop: 20 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px", borderBottom: "1px solid #e2e8f0", flexShrink: 0 }}>
          <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 700 }}>{title}</h3>
          <button type="button" onClick={onClose} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#94a3b8", lineHeight: 1 }}>&times;</button>
        </div>
        <div style={{ padding: "18px 20px", overflowY: "auto", maxHeight: "70dvh" }}>
          {children}
        </div>
        {footer && (
          <div style={{ padding: "12px 20px", borderTop: "1px solid #e2e8f0", display: "flex", gap: 10, justifyContent: "flex-end", background: "#fafbfc" }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

// ── DUID Multi-Select ─────────────────────────────────────────────────────────

function DuidMultiSelect({ duids, value, onChange }) {
  const [query, setQuery] = useState("");
  const filtered = duids.filter((d) => {
    const q = query.toLowerCase();
    return !q || (d.duid || "").toLowerCase().includes(q) || (d.site_name || "").toLowerCase().includes(q);
  });

  const toggle = (duid) => {
    if (value.includes(duid)) {
      onChange(value.filter((v) => v !== duid));
    } else {
      onChange([...value, duid]);
    }
  };

  // Pasting a column/row from Excel selects exactly those DUIDs (exact
  // match, replacing the current selection) — same behavior as the shared
  // SearchableSelect component, so every DUID picker in the app is
  // consistent. A single-line <input> collapses real newlines before
  // onChange ever sees them, so we read the clipboard directly here to
  // tell "pasted several values" apart from "one value with a space in it".
  const handlePaste = (e) => {
    const raw = e.clipboardData?.getData("text") ?? "";
    if (!/[\r\n\t]/.test(raw)) return; // one value, possibly with its own spaces — let default paste happen
    const pasted = raw.split(/[\r\n\t,;]+/).map((t) => t.trim().toLowerCase()).filter(Boolean);
    if (pasted.length === 0) return;
    e.preventDefault();
    const matched = [];
    for (const t of pasted) {
      const hit = duids.find((d) => (d.duid || "").toLowerCase() === t || (d.site_name || "").toLowerCase() === t);
      if (hit) matched.push(hit.duid);
    }
    if (matched.length) onChange(Array.from(new Set(matched)));
    setQuery(pasted.join(", "));
  };

  return (
    <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden" }}>
      <input
        type="text"
        placeholder="Search DUID or site..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onPaste={handlePaste}
        style={{ ...inp, border: "none", borderBottom: "1px solid #e2e8f0", borderRadius: 0, padding: "7px 10px" }}
      />
      <div style={{ maxHeight: 180, overflowY: "auto" }}>
        {filtered.length === 0 && (
          <div style={{ padding: "10px 12px", fontSize: "0.8rem", color: "#94a3b8" }}>No DUIDs found</div>
        )}
        {filtered.map((d) => (
          <label key={d.duid} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", cursor: "pointer", fontSize: "0.82rem", background: value.includes(d.duid) ? "#eff6ff" : "transparent" }}>
            <input
              type="checkbox"
              checked={value.includes(d.duid)}
              onChange={() => toggle(d.duid)}
              style={{ cursor: "pointer" }}
            />
            <span style={{ fontFamily: "monospace", color: "#1e40af", fontWeight: 600 }}>{d.duid}</span>
            {d.site_name && <span style={{ color: "#64748b", fontSize: "0.76rem" }}>{d.site_name}</span>}
          </label>
        ))}
      </div>
      {value.length > 0 && (
        <div style={{ padding: "5px 10px", borderTop: "1px solid #e2e8f0", fontSize: "0.75rem", color: "#475569", background: "#f8fafc" }}>
          {value.length} DUID{value.length > 1 ? "s" : ""} selected
        </div>
      )}
    </div>
  );
}

// ── Expense Line ──────────────────────────────────────────────────────────────

function ExpenseLine({ line, idx, expenseTypes, duids, projects, onChange, onRemove, taxRate = 0 }) {
  const mode = line.duid_mode || "single";
  const isMulti = mode === "multi";
  const isGeneral = mode === "general";

  const modeBtn = (key, label, onClick) => {
    const active = mode === key;
    return (
      <button
        type="button"
        onClick={onClick}
        style={{ flex: 1, padding: "6px 0", borderRadius: 6, border: `1.5px solid ${active ? "#3b82f6" : "#e2e8f0"}`, background: active ? "#eff6ff" : "#fff", color: active ? "#1d4ed8" : "#475569", fontSize: "0.78rem", fontWeight: 700, cursor: "pointer" }}
      >
        {label}
      </button>
    );
  };

  return (
    <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "14px 14px 10px", marginBottom: 12, position: "relative" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "#64748b" }}>Expense #{idx + 1}</span>
        <button type="button" onClick={onRemove} style={{ background: "none", border: "none", cursor: "pointer", color: "#94a3b8", fontSize: 18, lineHeight: 1, padding: 0 }}>&times;</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
        <div>
          {lbl("Expense Type", true)}
          <select
            value={line.expense_type}
            onChange={(e) => onChange({ ...line, expense_type: e.target.value })}
            style={inp}
          >
            <option value="">Select type...</option>
            {expenseTypes.map((t) => (
              <option key={t.name} value={t.name}>{t.expense_type || t.name}</option>
            ))}
          </select>
        </div>
        <div>
          {lbl(taxRate > 0 ? "Amount (SAR, incl. VAT)" : "Amount (SAR)", true)}
          <input
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={line.amount}
            onChange={(e) => onChange({ ...line, amount: e.target.value })}
            placeholder="0.00"
            style={inp}
          />
        </div>
      </div>

      <div style={{ marginBottom: 10 }}>
        {lbl("Description")}
        <input
          type="text"
          value={line.description}
          onChange={(e) => onChange({ ...line, description: e.target.value })}
          placeholder="Optional description"
          style={inp}
        />
      </div>

      <div style={{ marginBottom: 8 }}>
        {lbl("Allocation", true)}
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          {modeBtn("single", "Single DUID", () => onChange({ ...line, duid_mode: "single", duids: line.duids.slice(0, 1), project: "" }))}
          {modeBtn("multi", "Split DUIDs", () => onChange({ ...line, duid_mode: "multi", project: "" }))}
          {modeBtn("general", "General (Project)", () => onChange({ ...line, duid_mode: "general", duids: [] }))}
        </div>

        {isGeneral ? (
          <SearchableSelect
            value={line.project || ""}
            onChange={(id) => onChange({ ...line, project: id || "" })}
            options={(projects || []).map((p) => ({
              id: p.name,
              label: p.project_name ? `${p.project_code || p.name} — ${p.project_name}` : (p.project_code || p.name),
            }))}
            placeholder="Select project..."
            style={{ width: "100%", display: "block" }}
            triggerStyle={{ width: "100%", boxSizing: "border-box", padding: "8px 30px 8px 10px", fontSize: "0.86rem", borderRadius: 8 }}
          />
        ) : !isMulti ? (
          <SearchableSelect
            value={line.duids[0] || ""}
            onChange={(id) => onChange({ ...line, duids: id ? [id] : [] })}
            options={duids.map((d) => ({
              id: d.duid,
              label: d.site_name ? `${d.duid} — ${d.site_name}` : d.duid,
            }))}
            placeholder="Select DUID..."
            style={{ width: "100%", display: "block" }}
            triggerStyle={{ width: "100%", boxSizing: "border-box", padding: "8px 30px 8px 10px", fontSize: "0.86rem", borderRadius: 8 }}
          />
        ) : (
          <DuidMultiSelect
            duids={duids}
            value={line.duids}
            onChange={(selected) => onChange({ ...line, duids: selected })}
          />
        )}
      </div>

      {isMulti && line.duids.length > 1 && line.amount > 0 && (
        <div style={{ fontSize: "0.76rem", color: "#475569", background: "#eff6ff", padding: "6px 10px", borderRadius: 6, marginTop: 4 }}>
          SAR {fmtAmt(line.amount)} ÷ {line.duids.length} DUIDs = <strong>SAR {fmtAmt(Number(line.amount) / line.duids.length)}</strong> each
        </div>
      )}
    </div>
  );
}

// ── Create Expense Modal ──────────────────────────────────────────────────────

function emptyLine() {
  return { expense_type: "", description: "", amount: "", duid_mode: "single", duids: [], project: "" };
}

function CreateExpenseModal({ open, onClose, team, onCreated }) {
  const [date, setDate] = useState(today());
  const [remarks, setRemarks] = useState("");
  const [lines, setLines] = useState([emptyLine()]);
  const [attachments, setAttachments] = useState([]);
  const [expenseTypes, setExpenseTypes] = useState([]);
  const [duids, setDuids] = useState([]);
  const [projects, setProjects] = useState([]);
  const [taxRate, setTaxRate] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setDate(today());
    setRemarks("");
    setLines([emptyLine()]);
    setAttachments([]);
    setError(null);
    Promise.all([
      pmApi.getExpenseClaimTypes(),
      pmApi.getAvailableDuids(team?.name),
      pmApi.getAvailableProjects(team?.name),
      pmApi.getExpenseTaxInfo(),
    ])
      .then(([types, ds, projs, tax]) => {
        setExpenseTypes(types || []);
        setDuids(ds || []);
        setProjects(projs || []);
        setTaxRate(Number(tax?.tax_rate) || 0);
      })
      .catch(() => {});
  }, [open, team?.name]);

  const updateLine = (idx, updated) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? updated : l)));
  };

  const removeLine = (idx) => {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  };

  const addLine = () => setLines((prev) => [...prev, emptyLine()]);

  const handleSubmit = async () => {
    setError(null);
    for (const l of lines) {
      if (!l.expense_type) { setError("Select expense type for all lines."); return; }
      if (!l.amount || Number(l.amount) <= 0) { setError("Enter a valid amount for all lines."); return; }
      if (l.duid_mode === "general") {
        if (!l.project) { setError("Select a project for each general expense line."); return; }
      } else if (l.duids.length === 0) { setError("Select at least one DUID for each line."); return; }
    }

    setSaving(true);
    try {
      const result = await pmApi.createProjectExpenseClaim({
        date,
        remarks,
        inet_team: team?.name || "",
        expense_lines: lines.map((l) => ({
          expense_type: l.expense_type,
          description: l.description,
          amount: Number(l.amount),
          is_general: l.duid_mode === "general",
          project: l.duid_mode === "general" ? l.project : "",
          duids: l.duid_mode === "general" ? [] : l.duids,
        })),
        attachments,
      });
      window.dispatchEvent(new CustomEvent("inet:notifications-changed"));
      onCreated(result);
      onClose();
    } catch (err) {
      setError(err.message || "Failed to submit expense claim.");
    } finally {
      setSaving(false);
    }
  };

  const totalAmt = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New Project Expense Claim"
      width={620}
      footer={
        <>
          <button type="button" onClick={onClose} style={{ padding: "8px 18px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", cursor: "pointer", fontSize: "0.86rem" }}>Cancel</button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving || lines.length === 0}
            style={{ padding: "8px 22px", borderRadius: 8, border: "none", background: saving ? "#94a3b8" : "#3b82f6", color: "#fff", fontWeight: 700, cursor: saving ? "not-allowed" : "pointer", fontSize: "0.86rem" }}
          >
            {saving ? "Submitting..." : "Submit Claim"}
          </button>
        </>
      }
    >
      {error && (
        <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, padding: "10px 14px", color: "#dc2626", fontSize: "0.83rem", marginBottom: 14 }}>
          {error}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
        <div>
          {lbl("Date", true)}
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inp} />
        </div>
        <div>
          {lbl("Team")}
          <div style={{ ...inp, background: "#f8fafc", color: "#475569" }}>{team?.team_name || "—"}</div>
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        {lbl("Remarks")}
        <input type="text" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional notes" style={inp} />
      </div>

      <div style={{ marginBottom: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <span style={{ fontSize: "0.82rem", fontWeight: 700, color: "#334155" }}>Expense Lines</span>
          {totalAmt > 0 && (
            <span style={{ fontSize: "0.82rem", fontWeight: 700, color: "#1d4ed8" }}>
              Total: SAR {fmtAmt(totalAmt)}{taxRate > 0 ? " (incl. VAT)" : ""}
            </span>
          )}
        </div>

        {lines.map((line, idx) => (
          <ExpenseLine
            key={idx}
            idx={idx}
            line={line}
            expenseTypes={expenseTypes}
            duids={duids}
            projects={projects}
            taxRate={taxRate}
            onChange={(updated) => updateLine(idx, updated)}
            onRemove={() => removeLine(idx)}
          />
        ))}

        <button
          type="button"
          onClick={addLine}
          style={{ width: "100%", padding: "9px", borderRadius: 8, border: "2px dashed #cbd5e1", background: "transparent", color: "#475569", cursor: "pointer", fontSize: "0.83rem", fontWeight: 600 }}
        >
          + Add Expense Line
        </button>
      </div>

      <AttachmentsSection
        urls={attachments}
        onChange={setAttachments}
        title="Receipts / Documents"
      />
    </Modal>
  );
}

// ── Claim Detail Modal ────────────────────────────────────────────────────────

function ClaimDetailModal({ open, onClose, claim }) {
  if (!claim) return null;
  return (
    <Modal open={open} onClose={onClose} title={`Expense Claim — ${claim.name}`} width={560}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
          <div style={{ flex: 1, minWidth: 120 }}>
            <div style={{ fontSize: "0.72rem", color: "#64748b", marginBottom: 2 }}>Date</div>
            <div style={{ fontSize: "0.88rem", fontWeight: 600 }}>{claim.posting_date}</div>
          </div>
          <div style={{ flex: 1, minWidth: 120 }}>
            <div style={{ fontSize: "0.72rem", color: "#64748b", marginBottom: 2 }}>Status</div>
            <StatusBadge status={effectiveStatus(claim)} />
          </div>
          <div style={{ flex: 1, minWidth: 120 }}>
            <div style={{ fontSize: "0.72rem", color: "#64748b", marginBottom: 2 }}>Total Amount</div>
            <div style={{ fontSize: "0.95rem", fontWeight: 700, color: "#1d4ed8" }}>SAR {fmtAmt(grossAmt(claim))}</div>
          </div>
        </div>
        {claim.remark && (
          <div style={{ fontSize: "0.82rem", color: "#475569", background: "#f8fafc", padding: "8px 12px", borderRadius: 6, marginBottom: 10 }}>
            {claim.remark}
          </div>
        )}
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
        <thead>
          <tr style={{ background: "#f1f5f9" }}>
            <th style={{ padding: "7px 10px", textAlign: "left", fontWeight: 700, color: "#475569" }}>Expense Type</th>
            <th style={{ padding: "7px 10px", textAlign: "left", fontWeight: 700, color: "#475569" }}>DUID / Project</th>
            <th style={{ padding: "7px 10px", textAlign: "right", fontWeight: 700, color: "#475569" }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {(claim.lines || []).map((l, i) => (
            <tr key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
              <td style={{ padding: "7px 10px" }}>{l.expense_type}</td>
              <td style={{ padding: "7px 10px", fontFamily: "monospace", fontSize: "0.78rem", color: l.duid ? "#1e40af" : "#7c3aed" }}>
                {l.duid || (l.project ? `${l.project} (General)` : "—")}
              </td>
              <td style={{ padding: "7px 10px", textAlign: "right", fontWeight: 600 }}>SAR {fmtAmt(l.amount)}</td>
            </tr>
          ))}
          {Number(claim.total_taxes_and_charges) > 0 && (
            <>
              <tr style={{ borderTop: "2px solid #e2e8f0" }}>
                <td colSpan={2} style={{ padding: "6px 10px", textAlign: "right", color: "#64748b" }}>Net Total</td>
                <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: 600 }}>SAR {fmtAmt(claim.total_claimed_amount)}</td>
              </tr>
              <tr>
                <td colSpan={2} style={{ padding: "6px 10px", textAlign: "right", color: "#64748b" }}>VAT (included)</td>
                <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: 600 }}>SAR {fmtAmt(claim.total_taxes_and_charges)}</td>
              </tr>
              <tr style={{ background: "#f8fafc" }}>
                <td colSpan={2} style={{ padding: "6px 10px", textAlign: "right", fontWeight: 700, color: "#334155" }}>Total</td>
                <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: 800, color: "#1d4ed8" }}>SAR {fmtAmt(claim.grand_total)}</td>
              </tr>
            </>
          )}
        </tbody>
      </table>

      <AttachmentsSection
        urls={(claim.attachments || []).map((a) => a.file_url)}
        title="Receipts / Documents"
        readOnly
        noCamera
      />
    </Modal>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function FieldExpense() {
  const [team, setTeam] = useState(null);
  const [claims, setClaims] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("pending");
  const [showCreate, setShowCreate] = useState(false);
  const [selectedClaim, setSelectedClaim] = useState(null);
  const [error, setError] = useState(null);
  const { rowLimit } = useTableRowLimit();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [teamInfo, claimList] = await Promise.all([
        pmApi.getFieldUserTeam(),
        pmApi.listMyExpenseClaims(),
      ]);
      setTeam(teamInfo);
      setClaims(claimList || []);
    } catch (err) {
      setError(err.message || "Failed to load expense data.");
    } finally {
      setLoading(false);
    }
  }, []);

  const pendingClaims = claims.filter(
    (c) => effectiveStatus(c) !== "Approved" && effectiveStatus(c) !== "Rejected"
  );
  const unpaidClaims = claims.filter(
    (c) => effectiveStatus(c) === "Approved" && (c.status || "").toLowerCase() !== "paid"
  );
  const paidClaims = claims.filter((c) => (c.status || "").toLowerCase() === "paid");

  const visibleClaims =
    tab === "pending" ? pendingClaims :
    tab === "unpaid"  ? unpaidClaims :
    tab === "paid"    ? paidClaims :
    claims;

  const tabTotal = visibleClaims.reduce((s, c) => s + grossAmt(c), 0);
  const tabTotalColor = { pending: "#b45309", unpaid: "#92400e", paid: "#15803d", all: "#1d4ed8" }[tab];

  // This page's fetch (`load`) never depends on `rowLimit` — it always pulls
  // every claim and limits client-side, so there's no re-fetch to skip here.
  // But slicing `visibleClaims` down to `rowLimit` BEFORE handing it to
  // useProgressiveRows swapped in a new, shorter array reference on every
  // limit change, forcing that hook through its expensive shrink-then-regrow
  // chunking even though nothing was re-fetched. Pass the full (unsliced)
  // tab-filtered claims through instead, and hide anything past the limit
  // via CSS in the render loop below (see displayLimit) — a style change on
  // already-mounted cards, not a removal.
  const pagedClaims = visibleClaims;
  // See useProgressiveRows — mounts large row sets in chunks so the browser
  // doesn't show "Page Unresponsive" on tables with "All" rows loaded.
  const visiblePagedClaims = useProgressiveRows(pagedClaims, { paused: loading });
  const displayLimit = rowLimit === TABLE_ROW_LIMIT_ALL ? Infinity : rowLimit;
  const displayedCount = Math.min(pagedClaims.length, displayLimit);

  useEffect(() => { load(); }, [load]);

  const handleCreated = () => load();

  const tabDefs = [
    { key: "pending", label: "Pending", count: pendingClaims.length },
    { key: "unpaid",  label: "Unpaid",  count: unpaidClaims.length },
    { key: "paid",    label: "Paid",    count: paidClaims.length },
    { key: "all",     label: "All",     count: claims.length },
  ];

  return (
    <div className="exec-page" style={{ paddingBottom: "100px" }}>

      {/* Sticky header + tabs */}
      <div style={{
        position: "sticky", top: 0, zIndex: 39,
        background: "var(--bg, #fff)",
        borderBottom: "1px solid #e2e8f0",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px 8px" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 800 }}>My Expense Claims</h2>
            <div style={{ fontSize: "0.76rem", color: "#64748b", marginTop: 2 }}>
              {team && <><strong>{team.team_name}</strong>{team.im_name ? ` · ${team.im_name}` : ""}</>}
              {!loading && tabTotal > 0 && (
                <span style={{ color: tabTotalColor, fontWeight: 600 }}>
                  {team ? " · " : ""}
                  {{ pending: "Pending", unpaid: "Unpaid", paid: "Paid", all: "Total" }[tab]}: SAR {fmtAmt(tabTotal)}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            disabled={!team || !team.has_employee}
            style={{ padding: "9px 16px", borderRadius: 9, border: "none", background: (team && team.has_employee) ? "#3b82f6" : "#94a3b8", color: "#fff", fontWeight: 700, cursor: (team && team.has_employee) ? "pointer" : "not-allowed", fontSize: "0.84rem", flexShrink: 0 }}
          >
            + New Claim
          </button>
        </div>

        {/* Tab bar */}
        <div style={{ display: "flex", overflowX: "auto", padding: "0 16px" }}>
          {tabDefs.map(({ key, label, count }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              style={{
                padding: "8px 14px",
                fontSize: "0.83rem",
                fontWeight: tab === key ? 700 : 500,
                color: tab === key ? "#2563eb" : "#64748b",
                background: "none",
                border: "none",
                borderBottom: tab === key ? "2px solid #2563eb" : "2px solid transparent",
                cursor: "pointer",
                marginBottom: -1,
                display: "flex",
                alignItems: "center",
                gap: 5,
                whiteSpace: "nowrap",
              }}
            >
              {label}
              {count > 0 && (
                <span style={{ background: tab === key ? "#dbeafe" : "#f1f5f9", color: tab === key ? "#1d4ed8" : "#64748b", borderRadius: 10, padding: "1px 6px", fontSize: "0.7rem", fontWeight: 700 }}>
                  {count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Scrollable content */}
      <div style={{ padding: "12px 16px 0" }}>
        {error && (
          <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, padding: "10px 14px", color: "#dc2626", fontSize: "0.83rem", marginBottom: 14 }}>
            {error}
          </div>
        )}

        {!team && !loading && (
          <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: "14px 16px", color: "#92400e", fontSize: "0.86rem", marginBottom: 16 }}>
            No active INET Team found for your account. Contact your IM or admin.
          </div>
        )}

        {team && !team.has_employee && !loading && (
          <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 10, padding: "14px 16px", color: "#991b1b", fontSize: "0.86rem", marginBottom: 16 }}>
            No active Employee record linked to your account. Expense claims require an Employee record — contact HR or admin.
          </div>
        )}
      </div>

      <div style={{ padding: "0 16px" }}>
      {visibleClaims.length > 0 ? (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {visiblePagedClaims.map((c, idx) => (
              <button
                key={c.name}
                type="button"
                onClick={() => setSelectedClaim(c)}
                style={{ all: "unset", display: idx >= displayLimit ? "none" : "block", cursor: "pointer" }}
              >
                <div className="history-card" style={{ borderLeftColor: (c.status || "").toLowerCase() === "paid" ? "#22c55e" : effectiveStatus(c) === "Approved" ? "#f59e0b" : effectiveStatus(c) === "Rejected" ? "var(--red, #ef4444)" : "var(--blue, #3b82f6)" }}>
                  <div className="history-card-row">
                    <div style={{ fontWeight: 700, fontSize: "0.86rem" }}>{c.name}</div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <StatusBadge status={effectiveStatus(c)} />
                      <PaymentBadge claim={c} />
                    </div>
                  </div>
                  <div style={{ fontSize: "0.76rem", color: "#64748b", marginTop: 3 }}>{c.posting_date}</div>
                  <div className="history-card-row" style={{ marginTop: 8 }}>
                    <span style={{ fontSize: "0.76rem", color: "#64748b" }}>
                      {(c.lines || []).length} line{(c.lines || []).length !== 1 ? "s" : ""}
                      {(c.lines || []).some((l) => l.duid) && (
                        <> · {[...new Set((c.lines || []).map((l) => l.duid).filter(Boolean))].length} DUID{[...new Set((c.lines || []).map((l) => l.duid).filter(Boolean))].length !== 1 ? "s" : ""}</>
                      )}
                      {(c.lines || []).some((l) => !l.duid && l.project) && <> · General</>}
                    </span>
                    <span style={{ fontWeight: 700, color: "#1d4ed8", fontSize: "0.9rem" }}>
                      SAR {fmtAmt(grossAmt(c))}
                    </span>
                  </div>
                  {c.remark && (
                    <div style={{ fontSize: "0.75rem", color: "#64748b", marginTop: 4, fontStyle: "italic" }}>
                      {c.remark}
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
          <TableRowsLimitFooter
            placement="tableCard"
            loadedCount={visibleClaims.length}
            filteredCount={displayedCount}
            filterActive={rowLimit > 0 && visibleClaims.length > displayedCount}
          />
        </>
      ) : loading ? (
        <div style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}>Loading...</div>
      ) : (
        <div style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}>
          <div style={{ fontSize: "2rem", marginBottom: 8 }}>📋</div>
          <div>
            {tab === "pending" ? "No pending claims." :
             tab === "unpaid"  ? "No unpaid claims." :
             tab === "paid"    ? "No paid claims yet." :
             "No expense claims yet."}
          </div>
          {tab !== "all" && claims.length > 0 && (
            <div style={{ fontSize: "0.8rem", marginTop: 4 }}>
              <button type="button" onClick={() => setTab("all")} style={{ background: "none", border: "none", color: "#3b82f6", cursor: "pointer", fontSize: "0.8rem", textDecoration: "underline" }}>
                View all claims
              </button>
            </div>
          )}
          {tab === "pending" && claims.length === 0 && (
            <div style={{ fontSize: "0.8rem", marginTop: 4 }}>Tap + New Claim to file one.</div>
          )}
        </div>
      )}

      <CreateExpenseModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        team={team}
        onCreated={handleCreated}
      />

      <ClaimDetailModal
        open={!!selectedClaim}
        onClose={() => setSelectedClaim(null)}
        claim={selectedClaim}
      />
    </div>
  </div>
  );
}
