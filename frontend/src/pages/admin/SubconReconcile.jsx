import { useState } from "react";
import { pmApi } from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { money, qty as qtyFmt } from "../../utils/numberFormat";

/**
 * Correct a line's subcontractor split — Administrator only.
 *
 * Every other screen shows what the system DERIVED. This one shows each
 * source separately — the closure ledger, the rollout plan's teams, the line's
 * own stamp — so the disagreement between them is visible, and lets a person
 * settle it. The client's own records beat anything we can infer, and nothing
 * inside the system can decide which source is right.
 *
 * The server enforces the Administrator check (`roles.is_superuser`); hiding
 * the page is only so it stays out of everyone else's way.
 */
const card = {
  background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10,
  padding: "14px 16px", marginBottom: 14,
};
const h = { margin: "0 0 10px", fontSize: "0.92rem", color: "#0f172a" };
const mono = { fontFamily: "monospace", fontSize: "0.78rem" };
const dim = { color: "#64748b", fontSize: "0.78rem" };

// Deliberately NOT `className="data-table"`. That class carries
// `min-width: max-content`, which is what lets DataTablePro's
// `.data-table-wrapper` scroll a wide table — but these tables have no such
// wrapper, so the rule just made them burst out of their card and overlap
// everything beside and below them. A bare <table> still picks up the global
// th/td padding and borders, so it looks the same without the blow-out.
const scroll = { overflowX: "auto", margin: "0 -16px", padding: "0 16px" };
const table = { margin: 0, width: "100%", minWidth: 560, borderCollapse: "collapse" };
const cell = { whiteSpace: "nowrap", verticalAlign: "middle" };

// `minWidth: 0` is the part that matters: without it a grid item refuses to
// shrink below its content, so "Saleh Abdul Aziz Al Dosari Contracting Company"
// pushed straight over the next column. Label above, value wrapping below.
function Fact({ label, children }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: "0.68rem", textTransform: "uppercase",
                    letterSpacing: "0.4px", color: "#94a3b8" }}>{label}</div>
      <div style={{ color: "#0f172a", fontWeight: 600, fontSize: "0.82rem",
                    overflowWrap: "anywhere" }}>{children}</div>
    </div>
  );
}

function SourceTable({ title, rows, cols, empty }) {
  return (
    <div style={card}>
      <h3 style={h}>{title}</h3>
      {!rows?.length ? (
        <div style={dim}>{empty}</div>
      ) : (
        <div style={scroll}>
          <table style={table}>
            <thead>
              <tr>{cols.map((c) => (
                <th key={c.key} style={{ ...cell, textAlign: c.right ? "right" : "left" }}>
                  {c.label}
                </th>
              ))}</tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  {cols.map((c) => (
                    <td key={c.key} style={{
                      ...cell,
                      textAlign: c.right ? "right" : "left",
                      fontVariantNumeric: c.right ? "tabular-nums" : undefined,
                      // Free text can be long; cap it and show the rest on hover
                      // rather than letting one cell stretch the whole table.
                      ...(c.wide ? { whiteSpace: "normal", maxWidth: 260 } : null),
                      ...(c.mono ? mono : null),
                    }} title={c.render ? undefined : String(r[c.key] ?? "")}>
                      {c.render ? c.render(r) : (r[c.key] ?? "—")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function SubconReconcile() {
  const { user } = useAuth();
  const isSuperuser = user?.email === "Administrator";

  const [poid, setPoid] = useState("");
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState([]);
  const [remark, setRemark] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);

  function adopt(res) {
    setData(res);
    setDraft((res?.allocations || []).map((a) => ({
      subcontractor: a.subcontractor, qty: Number(a.qty) || 0,
    })));
  }

  async function load(e) {
    e?.preventDefault?.();
    if (!poid.trim()) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      adopt(await pmApi.getSubcontractorReconcile(poid.trim()));
    } catch (e2) {
      setData(null); setErr(e2.message || "Could not load that POID");
    } finally { setBusy(false); }
  }

  async function save() {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const rows = draft.filter((d) => d.subcontractor && Number(d.qty) > 0);
      adopt(await pmApi.setSubcontractorAllocation(data.line.name, rows, remark || undefined));
      setMsg("Split saved — set by hand, so nothing will re-derive it.");
      setRemark("");
    } catch (e2) { setErr(e2.message || "Could not save"); }
    finally { setBusy(false); }
  }

  async function clearOverride() {
    setBusy(true); setErr(null); setMsg(null);
    try {
      adopt(await pmApi.clearSubcontractorOverride(data.line.name));
      setMsg("Override removed — the line is derived again.");
    } catch (e2) { setErr(e2.message || "Could not clear"); }
    finally { setBusy(false); }
  }

  if (!isSuperuser) {
    return (
      <div>
        <div className="page-header"><div><h1 className="page-title">Subcontractor reconcile</h1></div></div>
        <div className="page-content">
          <div className="notice error" style={{ margin: 28 }}>
            <span>!</span> This screen is restricted to the Administrator.
          </div>
        </div>
      </div>
    );
  }

  const line = data?.line || {};
  const draftTotal = draft.reduce((s, d) => s + (Number(d.qty) || 0), 0);
  // What the split must add up to: what was actually closed when there is a
  // Work Done, else the confirmed quantity, else what was ordered. Mirrors the
  // server's own rule so the page can say so before the save is attempted.
  const expected = data?.work_done?.length
    ? Number(data.work_done[0].executed_qty) || 0
    : (Number(line.confirmed_qty) || Number(line.qty) || 0);
  const balanced = Math.abs(draftTotal - expected) < 0.0001;
  const isOverride = (data?.allocations || []).some((a) => a.source === "Administrator");

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Subcontractor reconcile</h1>
          <div className="page-subtitle">Administrator only · corrects who a line's quantity belongs to</div>
        </div>
      </div>

      <form className="toolbar" onSubmit={load}>
        <input
          value={poid}
          onChange={(e) => setPoid(e.target.value)}
          placeholder="POID or PO Dispatch name"
          style={{ flex: "1 1 260px", minWidth: 0, maxWidth: 420, fontFamily: "monospace" }}
        />
        <button type="submit" className="btn-primary" disabled={busy || !poid.trim()}>
          {busy ? "Loading…" : "Open"}
        </button>
      </form>

      <div className="page-content">
        <div style={{ margin: "0 28px 28px" }}>
          {err && <div className="notice error" style={{ marginBottom: 12, whiteSpace: "pre-line" }}><span>!</span> {err}</div>}
          {msg && <div className="notice" style={{ marginBottom: 12 }}><span>✓</span> {msg}</div>}

          {data && (
            <>
              <div style={card}>
                <h3 style={h}>
                  <span style={mono}>{line.poid}</span>
                  {isOverride && (
                    <span style={{
                      marginLeft: 8, padding: "1px 7px", borderRadius: 999, fontSize: "0.68rem",
                      fontWeight: 700, background: "#fef3c7", border: "1px solid #fde68a", color: "#92400e",
                    }}>set by hand</span>
                  )}
                </h3>
                <div style={{ display: "grid",
                              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                              gap: "10px 14px" }}>
                  <Fact label="PO">{line.po_no || "—"}</Fact>
                  <Fact label="DUID">{line.site_code || "—"}</Fact>
                  <Fact label="Item">{line.item_code || "—"}</Fact>
                  <Fact label="IM">{line.im || "—"}</Fact>
                  <Fact label="Ordered qty">{qtyFmt.format(Number(line.qty) || 0)}</Fact>
                  <Fact label="Confirmed">
                    {line.confirmed_qty ? qtyFmt.format(Number(line.confirmed_qty)) : "—"}
                  </Fact>
                  <Fact label="Line amount">SAR {money.format(Number(line.line_amount) || 0)}</Fact>
                  <Fact label="Line stamp">{line.contract || "—"}</Fact>
                  <Fact label="Status">{line.dispatch_status || "—"}</Fact>
                </div>
                {data.locked && (
                  <div className="notice error" style={{ marginTop: 12, fontSize: "0.8rem" }}>
                    <span>!</span>
                    <div>
                      A supplier PO is <strong>submitted</strong> on this line. Cancel or amend
                      it before changing the split.
                      <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                        {Object.entries(data.locks).map(([sub, info]) => (
                          <li key={sub}>{sub} — {qtyFmt.format(Number(info.qty) || 0)} ({info.statuses.join(" / ")})</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </div>

              <div style={card}>
                <h3 style={h}>The split</h3>
                <div style={{ ...dim, marginBottom: 10 }}>
                  Re-divides {qtyFmt.format(expected)} between subcontractors. It does not change
                  how much was done.
                </div>
                <div style={scroll}>
                <table style={{ ...table, tableLayout: "fixed" }}>
                  <thead>
                    <tr>
                      <th style={cell}>Subcontractor</th>
                      <th style={{ ...cell, width: 110, textAlign: "right" }}>Qty</th>
                      <th style={{ ...cell, width: 150, textAlign: "right" }}>Share of amount</th>
                      <th style={{ ...cell, width: 48 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {draft.map((d, i) => (
                      <tr key={i}>
                        <td>
                          <select
                            value={d.subcontractor}
                            disabled={busy || data.locked}
                            onChange={(e) => setDraft(draft.map((x, j) =>
                              j === i ? { ...x, subcontractor: e.target.value } : x))}
                            style={{ width: "100%", minWidth: 0, boxSizing: "border-box" }}
                          >
                            <option value="">— select —</option>
                            {(data.subcontractors || []).map((s) => (
                              <option key={s.name} value={s.name}>
                                {s.subcontractor_name || s.name} ({s.type}{s.sub_payout_pct ? ` · ${s.sub_payout_pct}%` : ""})
                              </option>
                            ))}
                          </select>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <input
                            type="number" step="0.0001" min="0" value={d.qty}
                            disabled={busy || data.locked}
                            onChange={(e) => setDraft(draft.map((x, j) =>
                              j === i ? { ...x, qty: e.target.value } : x))}
                            style={{ width: "100%", minWidth: 0, boxSizing: "border-box",
                                     textAlign: "right" }}
                          />
                        </td>
                        <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                          {expected > 0
                            ? `SAR ${money.format((Number(line.line_amount) || 0) * (Number(d.qty) || 0) / expected)}`
                            : "—"}
                        </td>
                        <td>
                          <button type="button" className="btn-secondary" disabled={busy || data.locked}
                                  onClick={() => setDraft(draft.filter((_, j) => j !== i))}
                                  style={{ padding: "2px 8px" }}>
                            ×
                          </button>
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <td colSpan={4}>
                        <button type="button" className="btn-secondary" disabled={busy || data.locked}
                                onClick={() => setDraft([...draft, { subcontractor: "", qty: 0 }])}>
                          + Add subcontractor
                        </button>
                      </td>
                    </tr>
                  </tbody>
                  <tfoot>
                    <tr>
                      <td style={{ fontWeight: 700 }}>Total</td>
                      <td style={{
                        textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums",
                        color: balanced ? "#15803d" : "#b91c1c",
                      }}>
                        {qtyFmt.format(draftTotal)}
                      </td>
                      <td style={{ textAlign: "right", ...dim }}>
                        {balanced ? "matches the line" : `must be ${qtyFmt.format(expected)}`}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
                </div>
                <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
                  <input
                    value={remark} onChange={(e) => setRemark(e.target.value)}
                    placeholder="Why (optional) — goes on the ledger and the status trail"
                    disabled={busy || data.locked}
                    style={{ flex: "1 1 240px", minWidth: 0 }}
                  />
                  <button type="button" className="btn-primary"
                          disabled={busy || data.locked || !balanced}
                          title={data.locked ? "A submitted supplier PO blocks this"
                                 : !balanced ? `The split must add up to ${qtyFmt.format(expected)}` : undefined}
                          onClick={save}>
                    {busy ? "Saving…" : "Save split"}
                  </button>
                  {isOverride && (
                    <button type="button" className="btn-secondary" disabled={busy} onClick={clearOverride}>
                      Remove override
                    </button>
                  )}
                </div>
              </div>

              <SourceTable
                title="Stored allocation"
                rows={data.allocations}
                empty="No allocation rows — this line has never been split."
                cols={[
                  { key: "subcontractor", label: "Subcontractor" },
                  { key: "qty", label: "Qty", right: true, render: (r) => qtyFmt.format(Number(r.qty) || 0) },
                  { key: "amount", label: "Amount", right: true, render: (r) => money.format(Number(r.amount) || 0) },
                  { key: "source", label: "Derived from" },
                  { key: "po", label: "Supplier PO", render: (r) => [r.sub_po_status_ms1, r.sub_po_status_ms2].filter(Boolean).join(" / ") || "—" },
                ]}
              />

              <SourceTable
                title="Closure ledger — what each supplier is paid on"
                rows={data.ledger}
                empty="No closure ledger. Either the line is not closed, or it was closed before the ledger existed — in which case the Work Done header carries the whole figure."
                cols={[
                  { key: "subcontractor", label: "Subcontractor" },
                  { key: "closed_qty", label: "Qty", right: true, render: (r) => qtyFmt.format(Number(r.closed_qty) || 0) },
                  { key: "closed_amount", label: "Amount", right: true, render: (r) => money.format(Number(r.closed_amount) || 0) },
                  { key: "milestone", label: "MS" },
                  { key: "source", label: "Route" },
                  { key: "closed_on", label: "Closed on", render: (r) => (r.closed_on || "").slice(0, 16) },
                  { key: "closed_by", label: "By" },
                ]}
              />

              <SourceTable
                title="Work Done — whichever route closed it"
                rows={data.work_done}
                empty="No Work Done on this line yet."
                cols={[
                  { key: "name", label: "Work Done", mono: true },
                  { key: "source", label: "Route" },
                  { key: "executed_qty", label: "Executed", right: true, render: (r) => qtyFmt.format(Number(r.executed_qty) || 0) },
                  { key: "revenue_sar", label: "Revenue", right: true, render: (r) => money.format(Number(r.revenue_sar) || 0) },
                  { key: "subcontractor", label: "Stamped sub" },
                  { key: "submission_status", label: "Submission" },
                ]}
              />

              <SourceTable
                title="Rollout plans and their teams"
                rows={data.plans}
                empty="No rollout plans — this line was closed off the rollout track."
                cols={[
                  { key: "name", label: "Plan", mono: true },
                  { key: "plan_date", label: "Date" },
                  { key: "visit_number", label: "Visit", right: true },
                  { key: "plan_status", label: "Status" },
                  { key: "team_name", label: "Team" },
                  { key: "subcontractor", label: "Team's sub" },
                  { key: "assigned_qty", label: "Assigned", right: true, render: (r) => r.assigned_qty != null ? qtyFmt.format(Number(r.assigned_qty)) : "—" },
                  { key: "achieved_qty", label: "Achieved", right: true, render: (r) => r.achieved_qty != null ? qtyFmt.format(Number(r.achieved_qty)) : "—" },
                ]}
              />

              <SourceTable
                title="What the system would derive, right now"
                rows={data.derived}
                empty="Nothing derivable — no ledger, no plan team with a subcontractor, no line stamp."
                cols={[
                  { key: "subcontractor", label: "Subcontractor" },
                  { key: "qty", label: "Qty", right: true, render: (r) => qtyFmt.format(Number(r.qty) || 0) },
                  { key: "source", label: "From" },
                ]}
              />

              <SourceTable
                title="Subcontractor changes on this line"
                rows={data.history}
                empty="Never changed."
                cols={[
                  { key: "changed_at", label: "When", render: (r) => (r.changed_at || "").slice(0, 16) },
                  { key: "old_value", label: "From" },
                  { key: "new_value", label: "To" },
                  { key: "remark", label: "Why", wide: true },
                  { key: "changed_by", label: "By" },
                ]}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
