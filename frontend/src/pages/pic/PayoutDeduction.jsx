// Payout deductions — money taken off what a line pays its subcontractor
// (payout_deduction.py). Three pieces, shared by the Subcon PO toolbar and its
// View popup so the two can never behave differently:
//
//   DeductionSheet   — Add Deduction for one or many lines, with a live
//                      preview computed by the same SQL the reports read
//   DeductionsPanel  — a line's deductions inside the View popup
//   DeductionMark    — the small marker beside a payout that was reduced
//
// A deduction can only change while the milestones it falls on are unordered;
// the backend enforces that and every control here explains it rather than
// letting the user click through to an error.
import { useEffect, useMemo, useState } from "react";
import { pmApi } from "../../services/api";
import SearchableSelect from "../../components/SearchableSelect";
import { useConfirm } from "../../components/ConfirmDialog";
import { useDebounced } from "../../hooks/useDebounced";
import { money } from "../../utils/numberFormat";

const SETTLEMENT_STYLE = {
  Retained: { bg: "#ecfdf5", fg: "#047857", bd: "#a7f3d0" },
  "Paid Out": { bg: "#fffbeb", fg: "#b45309", bd: "#fde68a" },
};

const SETTLEMENT_HINT = {
  Retained: "The amount stays with the company — it is not paid to anyone.",
  "Paid Out": "The amount is paid to another party, so it is a cost against the line.",
};

const BASIS_HINT = {
  "Line Value": "Comes off the line value before the payout % is applied.",
  Payout: "Comes off the subcontractor's payout itself.",
};

function Chip({ children, tone, title }) {
  const s = SETTLEMENT_STYLE[tone] || { bg: "#f1f5f9", fg: "#475569", bd: "#e2e8f0" };
  return (
    <span title={title} style={{
      display: "inline-block", padding: "1px 8px", borderRadius: 999, fontSize: "0.72rem",
      fontWeight: 700, background: s.bg, color: s.fg, border: `1px solid ${s.bd}`, whiteSpace: "nowrap",
    }}>{children}</span>
  );
}

function signed(n) {
  const v = Number(n) || 0;
  if (Math.abs(v) < 0.005) return "0.00";
  return `${v > 0 ? "+" : "−"}${money.format(Math.abs(v))}`;
}

function Label({ children }) {
  return (
    <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase",
                  letterSpacing: "0.04em", marginBottom: 5 }}>{children}</div>
  );
}

function Segmented({ value, onChange, options, disabled }) {
  return (
    <div role="radiogroup" style={{ display: "inline-flex", border: "1px solid #cbd5e1", borderRadius: 8, overflow: "hidden" }}>
      {options.map((o) => {
        const on = value === o.id;
        return (
          <button key={o.id} type="button" role="radio" aria-checked={on} disabled={disabled}
            onClick={() => onChange(o.id)}
            style={{
              padding: "6px 14px", fontSize: "0.82rem", fontWeight: on ? 700 : 500, border: "none",
              borderLeft: o === options[0] ? "none" : "1px solid #cbd5e1",
              background: on ? "#0f172a" : "#fff", color: on ? "#fff" : "#334155",
              cursor: disabled ? "default" : "pointer",
            }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function useEscape(onClose, busy) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);
}

// ── Add Deduction ────────────────────────────────────────────────────────
// `paidOutOnly`: opened for an INET-crew line, which pays no subcontractor —
// only a third party's cost (Paid Out, off the line value) can sit on it.
export function DeductionSheet({ lines, onClose, onDone, paidOutOnly = false }) {
  const names = useMemo(() => lines.map((l) => l.po_dispatch), [lines]);
  const [types, setTypes] = useState(null);
  const [type, setType] = useState("");
  const [settlement, setSettlement] = useState(paidOutOnly ? "Paid Out" : "Retained");
  const [payee, setPayee] = useState("");
  const [payeeOpts, setPayeeOpts] = useState([]);
  const [payeeSearch, setPayeeSearch] = useState("");
  const [mode, setMode] = useState("each");
  const [amount, setAmount] = useState("");
  const [overrides, setOverrides] = useState({});
  const [milestone, setMilestone] = useState("");
  const [remark, setRemark] = useState("");
  const [more, setMore] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  useEscape(onClose, busy);

  useEffect(() => {
    pmApi.getDeductionTypes()
      .then((t) => {
        const usable = paidOutOnly ? (t || []).filter((x) => x.deduct_from !== "Payout") : (t || []);
        setTypes(usable);
        if (usable.length) pickType(usable[0], usable);
      })
      .catch((e) => { setTypes([]); setError(e.message || "Could not load deduction types"); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const payeeSearchDebounced = useDebounced(payeeSearch, 250);
  useEffect(() => {
    if (settlement !== "Paid Out") return;
    let dead = false;
    pmApi.searchDeductionPayees(payeeSearchDebounced)
      .then((r) => { if (!dead) setPayeeOpts(r || []); })
      .catch(() => {});
    return () => { dead = true; };
  }, [payeeSearchDebounced, settlement]);

  function pickType(t, list = types) {
    const found = typeof t === "string" ? (list || []).find((x) => x.name === t) : t;
    setType(found?.name || "");
    if (found?.default_amount) setAmount(String(found.default_amount));
    if (found?.default_settlement && !paidOutOnly) setSettlement(found.default_settlement);
  }
  const typeRow = (types || []).find((t) => t.name === type);

  const args = useMemo(() => ({
    po_dispatches: names, deduction_type: type, settlement,
    amount: Number(amount) || 0, amount_mode: mode, amounts: overrides,
    payee: settlement === "Paid Out" ? payee : "", milestone,
  }), [names, type, settlement, amount, mode, overrides, payee, milestone]);
  const argsKey = useDebounced(JSON.stringify(args), 350);
  const ready = !!type && Number(amount) > 0 && (settlement !== "Paid Out" || !!payee);

  useEffect(() => {
    if (!ready) { setPreview(null); return; }
    let dead = false;
    setPreviewing(true);
    pmApi.previewPayoutDeduction(JSON.parse(argsKey))
      .then((p) => { if (!dead) { setPreview(p); setError(null); } })
      .catch((e) => { if (!dead) { setPreview(null); setError(e.message || "Preview failed"); } })
      .finally(() => { if (!dead) setPreviewing(false); });
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [argsKey]);

  const okCount = preview?.lines?.length || 0;
  const stale = argsKey !== JSON.stringify(args);

  async function submit() {
    setBusy(true); setError(null);
    try {
      const res = await pmApi.addPayoutDeduction({ ...args, remark });
      onDone(`${type} added to ${res.added} line${res.added === 1 ? "" : "s"} — SAR ${money.format(res.total)}`
        + (res.blocked?.length ? ` (${res.blocked.length} skipped)` : ""));
    } catch (e) {
      setError(e.message || "Could not add the deduction");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div onClick={busy ? undefined : onClose}
         style={{ position: "fixed", inset: 0, zIndex: 10002, background: "rgba(15,23,42,0.5)",
                  display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()}
           style={{ background: "#fff", borderRadius: 12, width: "min(720px, 100%)", maxHeight: "90vh",
                    display: "flex", flexDirection: "column", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "16px 20px 12px", borderBottom: "1px solid #f1f5f9" }}>
          <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 700 }}>
            Add Deduction
            <span style={{ color: "#64748b", fontWeight: 500 }}> · {names.length} line{names.length === 1 ? "" : "s"}</span>
          </h3>
          <button type="button" onClick={onClose} disabled={busy}
            style={{ background: "none", border: "none", fontSize: 22, cursor: busy ? "default" : "pointer", color: "#94a3b8", lineHeight: 1 }}>&times;</button>
        </div>

        <div style={{ padding: "14px 20px", overflow: "auto", flex: 1 }}>
          {types && types.length === 0 ? (
            <div className="notice" style={{ fontSize: "0.84rem" }}>
              No deduction types yet. Add one on the <b>Masters</b> page (Deduction Type) first —
              for example <i>Report Preparation</i>, default amount 100.
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
              <div>
                <Label>Type</Label>
                <select value={type} disabled={busy || !types} onChange={(e) => pickType(e.target.value)}
                        style={{ width: "100%" }}>
                  {(types || []).map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
                </select>
                {typeRow && (
                  <div style={{ fontSize: "0.74rem", color: "#64748b", marginTop: 4 }}>{BASIS_HINT[typeRow.deduct_from]}</div>
                )}
              </div>

              <div>
                <Label>Settlement</Label>
                <Segmented value={settlement} disabled={busy} onChange={setSettlement}
                  options={paidOutOnly ? [{ id: "Paid Out", label: "Paid Out" }]
                    : [{ id: "Retained", label: "Retained" }, { id: "Paid Out", label: "Paid Out" }]} />
                <div style={{ fontSize: "0.74rem", color: "#64748b", marginTop: 4 }}>
                  {paidOutOnly
                    ? "This line is worked by an INET crew — no subcontractor is paid, so only a third party's cost can be recorded."
                    : SETTLEMENT_HINT[settlement]}
                </div>
              </div>

              {settlement === "Paid Out" && (
                <div style={{ gridColumn: "1 / -1" }}>
                  <Label>Paid to</Label>
                  <SearchableSelect value={payee} onChange={(v) => setPayee(v || "")}
                    onSearch={setPayeeSearch} options={payeeOpts} disabled={busy}
                    placeholder="Search supplier…" allLabel="Choose a supplier" style={{ width: "100%" }} />
                  {!payee && (
                    <div style={{ fontSize: "0.74rem", color: "#b45309", marginTop: 4 }}>
                      Choose who is paid — a draft purchase invoice can then be raised to them.
                    </div>
                  )}
                </div>
              )}

              <div style={{ gridColumn: "1 / -1" }}>
                <Label>Amount (SAR)</Label>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  {names.length > 1 && (
                    <Segmented value={mode} disabled={busy} onChange={(m) => { setMode(m); setOverrides({}); }}
                      options={[{ id: "each", label: "Same on each line" }, { id: "split", label: "Split a total" }]} />
                  )}
                  <input type="number" min="0" step="0.01" value={amount} disabled={busy}
                    onChange={(e) => { setAmount(e.target.value); setOverrides({}); }}
                    style={{ width: 140, fontVariantNumeric: "tabular-nums" }} />
                  {names.length > 1 && mode === "split" && Number(amount) > 0 && (
                    <span style={{ fontSize: "0.78rem", color: "#64748b" }}>
                      split equally across the lines that can take it — each share can be changed below
                    </span>
                  )}
                </div>
              </div>

              <div style={{ gridColumn: "1 / -1" }}>
                <button type="button" onClick={() => setMore((m) => !m)}
                  style={{ background: "none", border: "none", padding: 0, color: "#2563eb", fontSize: "0.8rem",
                           fontWeight: 600, cursor: "pointer" }}>
                  {more ? "▾" : "▸"} More options
                </button>
                {more && (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, marginTop: 10 }}>
                    <div>
                      <Label>Milestone</Label>
                      <select value={milestone} disabled={busy} onChange={(e) => setMilestone(e.target.value)} style={{ width: "100%" }}>
                        <option value="">Auto — follows the MS1 / MS2 split</option>
                        <option value="MS1">MS1 only</option>
                        <option value="MS2">MS2 only</option>
                      </select>
                    </div>
                    <div>
                      <Label>Remark</Label>
                      <input type="text" value={remark} disabled={busy} onChange={(e) => setRemark(e.target.value)}
                        placeholder="Optional" style={{ width: "100%" }} />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* The preview is the point of this form: what each line pays and
              keeps, before → after, computed by the same SQL the reports use. */}
          {ready && (
            <div style={{ marginTop: 16, border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden",
                          opacity: previewing || stale ? 0.6 : 1, transition: "opacity 120ms" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
                            padding: "9px 14px", background: "#f8fafc", borderBottom: "1px solid #e2e8f0", flexWrap: "wrap" }}>
                <span style={{ fontSize: 10.5, fontWeight: 800, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Preview {previewing ? "· updating…" : ""}
                </span>
                {preview && (
                  <span style={{ fontSize: "0.8rem", color: "#334155", display: "flex", gap: 14, flexWrap: "wrap" }}>
                    <span>Deduction <b>{money.format(preview.total)}</b></span>
                    <span>Payout <b style={{ color: "#b91c1c" }}>{signed(preview.payout_change)}</b></span>
                    <span>Margin <b style={{ color: preview.margin_change >= 0 ? "#047857" : "#b91c1c" }}>{signed(preview.margin_change)}</b></span>
                  </span>
                )}
              </div>
              {preview && (
                <div style={{ maxHeight: 260, overflow: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
                    <thead>
                      <tr style={{ color: "#64748b", textAlign: "left" }}>
                        <th style={{ padding: "6px 14px", fontWeight: 600 }}>POID</th>
                        <th style={{ padding: "6px 8px", fontWeight: 600, textAlign: "right" }}>Deduction</th>
                        <th style={{ padding: "6px 8px", fontWeight: 600, textAlign: "right" }}>Payout</th>
                        <th style={{ padding: "6px 14px", fontWeight: 600, textAlign: "right" }}>Margin</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.lines.map((l) => (
                        <tr key={l.po_dispatch} style={{ borderTop: "1px solid #f1f5f9" }}>
                          <td style={{ padding: "6px 14px" }}>
                            <div style={{ fontFamily: "monospace", fontSize: "0.76rem" }}>{l.poid}</div>
                            <SplitNote legs={l.split} amount={l.amount} />
                          </td>
                          <td style={{ padding: "4px 8px", textAlign: "right" }}>
                            {names.length > 1 ? (
                              <input type="number" min="0" step="0.01" disabled={busy}
                                value={overrides[l.po_dispatch] ?? l.amount}
                                onChange={(e) => setOverrides((o) => ({ ...o, [l.po_dispatch]: e.target.value }))}
                                style={{ width: 90, textAlign: "right", fontVariantNumeric: "tabular-nums", padding: "2px 6px" }} />
                            ) : money.format(l.amount)}
                          </td>
                          {l.inet_line ? (
                            <>
                              <td style={{ padding: "6px 8px", textAlign: "right", color: "#94a3b8", whiteSpace: "nowrap" }}
                                  title="INET-crew line — no subcontractor payout">INET crew</td>
                              <td style={{ padding: "6px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}
                                  title="A third party's cost against the line">
                                <b style={{ color: "#b91c1c" }}>cost −{money.format(l.cost)}</b>
                              </td>
                            </>
                          ) : (
                            <>
                              <td style={{ padding: "6px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                                <span style={{ color: "#94a3b8" }}>{money.format(l.payout_before)}</span>
                                {" → "}<b>{money.format(l.payout_after)}</b>
                              </td>
                              <td style={{ padding: "6px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                                <b style={{ color: l.margin_after >= l.margin_before ? "#047857" : "#b91c1c" }}>{money.format(l.margin_after)}</b>
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {preview?.blocked?.length > 0 && (
                <div style={{ padding: "10px 14px", background: "#fffbeb", borderTop: "1px solid #fde68a", fontSize: "0.78rem", color: "#92400e" }}>
                  <b>{preview.blocked.length} line{preview.blocked.length === 1 ? "" : "s"} will be skipped:</b>
                  <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                    {preview.blocked.slice(0, 8).map((b) => (
                      <li key={b.po_dispatch}><span style={{ fontFamily: "monospace" }}>{b.poid}</span> — {b.reason}</li>
                    ))}
                    {preview.blocked.length > 8 && <li>…and {preview.blocked.length - 8} more</li>}
                  </ul>
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="notice error" style={{ marginTop: 12, marginBottom: 0, fontSize: "0.82rem" }}>
              <span>!</span> {error}
            </div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, padding: "12px 20px 16px", borderTop: "1px solid #f1f5f9" }}>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn-primary" onClick={submit}
            disabled={busy || !ready || !okCount || previewing || stale}
            title={!ready ? (settlement === "Paid Out" && !payee ? "Choose who is paid" : "Choose a type and an amount")
              : !okCount ? "None of the selected lines can take this deduction" : ""}>
            {busy ? "Adding…" : `Add to ${okCount || 0} line${okCount === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// On a line split across legs, every payout / margin figure here is the
// PAYABLE legs' share only — say so, or a half-INET line reads as an INET line
// with a payout on it.
function SplitNote({ legs, amount }) {
  if (!legs || legs.length < 2) return null;
  const payable = legs.filter((l) => l.payable);
  const own = legs.filter((l) => !l.payable);
  const paySharePct = payable.reduce((a, l) => a + (Number(l.share) || 0), 0);
  return (
    <div style={{ fontSize: "0.72rem", color: "#92400e", marginTop: 3, lineHeight: 1.4, fontFamily: "inherit" }}>
      Split line — {legs.map((l) => `${l.label} ${l.share}%`).join(" · ")}.{" "}
      {payable.length > 0 ? (
        <>
          Payout and margin are {payable.map((l) => l.label).join(", ")}'s share
          {amount ? <> — {money.format((Number(amount) || 0) * paySharePct / 100)} of the {money.format(Number(amount) || 0)} falls on it</> : null}
          {own.length > 0 ? `; ${own.map((l) => l.label).join(", ")} pays no one.` : "."}
        </>
      ) : "No leg pays a subcontractor."}
    </div>
  );
}

// ── A line's deductions, inside the View popup ───────────────────────────
export function DeductionsPanel({ poDispatch, poid, onChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busyRow, setBusyRow] = useState(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);   // { name, amount, settlement, payee, milestone }
  const confirm = useConfirm();
  const [payeeOpts, setPayeeOpts] = useState([]);
  const [payeeSearch, setPayeeSearch] = useState("");
  const payeeSearchDebounced = useDebounced(payeeSearch, 250);

  const load = () => {
    setError(null);
    pmApi.getLineDeductions(poDispatch).then(setData).catch((e) => setError(e.message || "Could not load"));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (poDispatch) load(); }, [poDispatch]);
  useEffect(() => {
    if (!editing || editing.settlement !== "Paid Out") return;
    pmApi.searchDeductionPayees(payeeSearchDebounced).then((r) => setPayeeOpts(r || [])).catch(() => {});
  }, [payeeSearchDebounced, editing]);

  async function act(name, fn) {
    setBusyRow(name); setError(null);
    try {
      const res = await fn();
      if (res && res.rows) setData(res); else load();
      onChanged?.();
      return res;
    } catch (e) {
      setError(e.message || "That did not work");
      return null;
    } finally {
      setBusyRow(null);
    }
  }

  const rows = data?.rows || [];
  const m = data?.metrics || {};
  const reduced = (Number(m.gross_payout) || 0) - (Number(m.payout) || 0);

  return (
    <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, marginBottom: 14 }}>
      <div style={{ padding: "9px 14px", borderBottom: "1px solid #e2e8f0", background: "#f8fafc",
                    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10.5, fontWeight: 800, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Payout Deductions {data ? `· ${rows.length}` : ""}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          {data?.split?.length > 0 && (
            <span style={{ flexBasis: "100%" }}><SplitNote legs={data.split} /></span>
          )}
          {rows.length > 0 && data?.has_payout && (
            <span style={{ fontSize: "0.78rem", color: "#334155" }}>
              Payout <span style={{ color: "#94a3b8" }}>{money.format(m.gross_payout || 0)}</span> → <b>{money.format(m.payout || 0)}</b>
              {" · "}Margin <b>{money.format(m.margin || 0)}</b>
            </span>
          )}
          {rows.length > 0 && data && !data.has_payout && (
            <span style={{ fontSize: "0.78rem", color: "#334155" }} title="INET-crew line — no subcontractor payout">
              Third-party cost <b>{money.format(rows.filter((x) => x.settlement === "Paid Out")
                .reduce((a, x) => a + (Number(x.amount) || 0), 0))}</b>
            </span>
          )}
          <button type="button" className="btn-secondary" style={{ padding: "2px 10px", fontSize: "0.76rem" }}
            disabled={!data || !data.can_add}
            title={data && !data.can_add ? `${data.add_lock_reason} — a deduction can only be added while the milestone is unordered` : ""}
            onClick={() => setAdding(true)}>+ Add</button>
        </span>
      </div>

      {!data && !error ? (
        <div style={{ padding: 14, color: "#94a3b8", fontSize: "0.84rem" }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 14, color: "#94a3b8", fontSize: "0.84rem" }}>No deductions on this line.</div>
      ) : rows.map((r) => {
        const locked = !!r.lock_reason;
        const isEditing = editing?.name === r.name;
        return (
          <div key={r.name} style={{ padding: "10px 14px", borderTop: "1px solid #f1f5f9", opacity: busyRow === r.name ? 0.6 : 1 }}>
            {!isEditing ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <b style={{ fontSize: "0.86rem" }}>{r.deduction_type}</b>
                <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{money.format(r.amount)}</span>
                <Chip tone={r.settlement} title={SETTLEMENT_HINT[r.settlement]}>{r.settlement}</Chip>
                {r.payee && <span style={{ fontSize: "0.8rem", color: "#475569" }}>→ {r.payee}</span>}
                <Chip title={BASIS_HINT[r.deduct_from]}>{r.deduct_from === "Payout" ? "off payout" : "off line value"}</Chip>
                {r.milestone && <Chip>{r.milestone} only</Chip>}
                {r.purchase_invoice && (
                  <a href={`/app/purchase-invoice/${r.purchase_invoice}`} target="_blank" rel="noreferrer"
                     style={{ fontFamily: "monospace", fontSize: "0.78rem", fontWeight: 700 }}>
                    {r.purchase_invoice}{r.purchase_invoice_status ? ` · ${r.purchase_invoice_status}` : ""}
                  </a>
                )}
                <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                  {r.settlement === "Paid Out" && (!r.purchase_invoice || r.purchase_invoice_status === "Cancelled") && (
                    <button type="button" className="btn-secondary" style={{ padding: "2px 9px", fontSize: "0.74rem" }}
                      disabled={busyRow === r.name}
                      title="Raise a draft purchase invoice to the payee — Accounts submits it as usual"
                      onClick={() => act(r.name, () => pmApi.createDeductionPurchaseInvoice(r.name).then((res) => {
                        if (res?.purchase_invoice_url) window.open(res.purchase_invoice_url, "_blank");
                        return null;
                      }))}>Raise Invoice</button>
                  )}
                  <button type="button" className="btn-secondary" style={{ padding: "2px 9px", fontSize: "0.74rem" }}
                    disabled={locked || busyRow === r.name || !!r.purchase_invoice}
                    title={locked ? `Locked — ${r.lock_reason}` : r.purchase_invoice ? "Remove it and add it again to change a deduction that has an invoice" : ""}
                    onClick={() => setEditing({ name: r.name, amount: r.amount, settlement: r.settlement,
                                                payee: r.payee || "", milestone: r.milestone || "" })}>Edit</button>
                  <button type="button" className="btn-secondary" style={{ padding: "2px 9px", fontSize: "0.74rem", color: "#b91c1c" }}
                    disabled={locked || busyRow === r.name}
                    title={locked ? `Locked — ${r.lock_reason}` : r.purchase_invoice ? "Also deletes its draft purchase invoice" : ""}
                    onClick={async () => {
                      const ok = await confirm({
                        title: `Remove ${r.deduction_type}?`,
                        message: (
                          <>
                            {money.format(r.amount)} · {r.settlement}{r.payee ? ` → ${r.payee}` : ""}.
                            {r.purchase_invoice && <> Its draft invoice <b>{r.purchase_invoice}</b> is deleted with it.</>}
                            {data?.has_payout ? " The payout goes back up by the same amount." : ""}
                          </>
                        ),
                        confirmLabel: "Remove",
                        tone: "danger",
                      });
                      if (ok) act(r.name, () => pmApi.removePayoutDeduction(r.name));
                    }}>Remove</button>
                </span>

                {(locked || r.remark || r.added_by) && (
                  <div style={{ flexBasis: "100%", fontSize: "0.74rem", color: "#94a3b8" }}>
                    {locked && <span style={{ color: "#92400e" }}>🔒 {r.lock_reason}. </span>}
                    {r.remark && <span>{r.remark} · </span>}
                    {r.added_by && <span>added by {r.added_by}{r.added_on ? ` on ${String(r.added_on).slice(0, 10)}` : ""}</span>}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "flex-end", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <Label>Amount</Label>
                  <input type="number" min="0" step="0.01" value={editing.amount}
                    onChange={(e) => setEditing((x) => ({ ...x, amount: e.target.value }))} style={{ width: 110 }} />
                </div>
                <div>
                  <Label>Settlement</Label>
                  <Segmented value={editing.settlement} onChange={(v) => setEditing((x) => ({ ...x, settlement: v }))}
                    options={[{ id: "Retained", label: "Retained" }, { id: "Paid Out", label: "Paid Out" }]} />
                </div>
                {editing.settlement === "Paid Out" && (
                  <div style={{ minWidth: 220 }}>
                    <Label>Paid to</Label>
                    <SearchableSelect value={editing.payee} onChange={(v) => setEditing((x) => ({ ...x, payee: v || "" }))}
                      onSearch={setPayeeSearch}
                      options={editing.payee && !payeeOpts.some((o) => o.id === editing.payee)
                        ? [{ id: editing.payee, label: editing.payee }, ...payeeOpts] : payeeOpts}
                      placeholder="Search supplier…" allLabel="Choose a supplier" />
                  </div>
                )}
                <div>
                  <Label>Milestone</Label>
                  <select value={editing.milestone} onChange={(e) => setEditing((x) => ({ ...x, milestone: e.target.value }))}>
                    <option value="">Auto</option>
                    <option value="MS1">MS1 only</option>
                    <option value="MS2">MS2 only</option>
                  </select>
                </div>
                <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                  <button type="button" className="btn-secondary" style={{ padding: "4px 10px", fontSize: "0.78rem" }}
                    onClick={() => setEditing(null)}>Cancel</button>
                  <button type="button" className="btn-primary" style={{ padding: "4px 10px", fontSize: "0.78rem" }}
                    disabled={busyRow === r.name || !(Number(editing.amount) > 0)
                      || (editing.settlement === "Paid Out" && !editing.payee)}
                    onClick={async () => {
                      const res = await act(r.name, () => pmApi.updatePayoutDeduction(r.name, {
                        amount: editing.amount, settlement: editing.settlement,
                        payee: editing.settlement === "Paid Out" ? editing.payee : "",
                        milestone: editing.milestone,
                      }));
                      if (res) setEditing(null);
                    }}>Save</button>
                </span>
              </div>
            )}
          </div>
        );
      })}

      {reduced > 0.005 && rows.length > 0 && (
        <div style={{ padding: "8px 14px", borderTop: "1px solid #f1f5f9", fontSize: "0.76rem", color: "#64748b" }}>
          A supplier PO raised for this line prints the agreed rate with the deduction as its discount.
        </div>
      )}
      {error && (
        <div className="notice error" style={{ margin: 10, fontSize: "0.8rem" }}><span>!</span> {error}</div>
      )}

      {adding && (
        <DeductionSheet lines={[{ po_dispatch: poDispatch, poid }]}
          paidOutOnly={data ? !data.has_payout : false}
          onClose={() => setAdding(false)}
          onDone={() => { setAdding(false); load(); onChanged?.(); }} />
      )}
    </div>
  );
}

// ── Marker beside a reduced payout ───────────────────────────────────────
export function DeductionMark({ row, n }) {
  const gross = Number(row[`gross_payout_ms${n}`]) || 0;
  const net = Number(row[`expected_payout_ms${n}`]) || 0;
  const cut = gross - net;
  if (!(Number(row.deduction_amount) > 0) || cut < 0.005) return null;
  const names = [...new Set((row.payout_deductions || [])
    .filter((d) => !d.milestone || d.milestone === `MS${n}`)
    .map((d) => d.deduction_type))].join(", ");
  return (
    <span title={`Reduced by ${money.format(cut)}${names ? ` — ${names}` : ""}. Before deductions: ${money.format(gross)}.`}
      style={{ marginLeft: 5, padding: "0 5px", borderRadius: 999, background: "#fffbeb", border: "1px solid #fde68a",
               color: "#b45309", fontSize: "0.64rem", fontWeight: 800, cursor: "help" }}>
      −{money.format(cut)}
    </span>
  );
}

// ── The list's Deductions cell: amount + what still has to happen ────────
const STATE_STYLE = {
  "Invoice Due": { bg: "#fffbeb", fg: "#b45309", bd: "#fde68a",
                   hint: "A Paid Out deduction has no invoice yet — select the line and use Raise Deduction Invoice" },
  Invoiced: { bg: "#ecfdf5", fg: "#047857", bd: "#a7f3d0", hint: "Every Paid Out deduction has its invoice" },
  Retained: { bg: "#f1f5f9", fg: "#475569", bd: "#e2e8f0", hint: "Kept by the company — nothing to invoice" },
};

export function DeductionStateCell({ row }) {
  const amt = Number(row.deduction_amount) || 0;
  const st = STATE_STYLE[row.deduction_state];
  if (!amt && !st) return <span style={{ color: "#cbd5e1" }}>—</span>;
  const detail = (row.payout_deductions || []).map((d) =>
    `${d.deduction_type} ${money.format(d.amount)} · ${d.settlement}${d.payee ? ` → ${d.payee}` : ""}`
    + `${d.purchase_invoice ? ` · ${d.purchase_invoice}` : d.settlement === "Paid Out" ? " · no invoice" : ""}`).join("\n");
  return (
    <span title={[st?.hint, detail].filter(Boolean).join("\n\n")}
      style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", cursor: "help" }}>
      <span style={{ fontVariantNumeric: "tabular-nums", color: "#b45309", fontWeight: 600 }}>−{money.format(amt)}</span>
      {st && (
        <span style={{ padding: "0 7px", borderRadius: 999, fontSize: "0.68rem", fontWeight: 700,
                       background: st.bg, color: st.fg, border: `1px solid ${st.bd}` }}>
          {row.deduction_state}
        </span>
      )}
    </span>
  );
}
