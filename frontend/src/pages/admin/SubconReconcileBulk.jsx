import { useState } from "react";
import { pmApi } from "../../services/api";
import { money, qty as qtyFmt } from "../../utils/numberFormat";
import DataTableWrapper from "../../components/DataTableWrapper";
import SearchableSelect from "../../components/SearchableSelect";

/**
 * Subcontractor reconcile — many lines at once (the "Multiple lines" tab).
 *
 * Corrections arrive as lists ("these POIDs were done by Team No. 10"), so this
 * loads pasted POIDs — or every line whose stamped contract disagrees with the
 * team on its last visit — one row each, and moves the selected lines' WHOLE
 * quantity to one subcontractor. Each line is saved on its own through the
 * same checks as the single-line save, so a line with a submitted supplier PO
 * is refused and reported without stopping the rest.
 *
 * A split between several subcontractors stays on the "One line" tab.
 * State is owned by SubconReconcile so it survives opening a line and coming back.
 */
const short = (s) => (s || "").replace(/ Contracting Company| Contracting Co\.| Establishment| Technical Solutions & Business Services/g, "");

export default function BulkReconcile({ state, setState, confirm, onOpenLine }) {
  const { input, source, rows, missing, subcontractors, selected, results, summary, target, remark } = state;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (patch) => setState((s) => ({ ...s, ...patch }));

  async function fetchRows(src = source, text = input) {
    setBusy(true); setErr(null);
    try {
      const res = src === "disagreements"
        ? await pmApi.getSubcontractorReconcileLines({ disagreements: true })
        : await pmApi.getSubcontractorReconcileLines({ poids: text.split(/[\s,]+/).filter(Boolean) });
      setState((s) => ({
        ...s, source: src, rows: res.rows || [], missing: res.missing || [],
        subcontractors: res.subcontractors || s.subcontractors,
        selected: new Set([...s.selected].filter((n) => (res.rows || []).some((r) => r.name === n))),
      }));
      return res;
    } catch (e) {
      setErr(e.message || "Could not load the lines");
      return null;
    } finally { setBusy(false); }
  }

  function loadPasted(e) {
    e?.preventDefault?.();
    if (!input.trim()) return;
    set({ results: {}, summary: null });
    fetchRows("pasted", input);
  }

  function loadDisagreements() {
    set({ results: {}, summary: null });
    fetchRows("disagreements");
  }

  const selectable = (r) => !r.locked;

  function toggle(name) {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name); else next.add(name);
    set({ selected: next });
  }

  // Only rows the column filters leave visible — the same rule as PODispatch.
  function toggleAll() {
    const hidden = new Set(Array.from(document.querySelectorAll("tbody tr[data-tablepro-filtered]"))
      .map((tr) => tr.dataset.docName).filter(Boolean));
    const visible = rows.filter((r) => selectable(r) && !hidden.has(r.name));
    if (visible.length > 0 && visible.every((r) => selected.has(r.name))) set({ selected: new Set() });
    else set({ selected: new Set(visible.map((r) => r.name)) });
  }

  const selectableRows = rows.filter(selectable);
  const allChecked = selectableRows.length > 0 && selectableRows.every((r) => selected.has(r.name));
  const someChecked = selectableRows.some((r) => selected.has(r.name)) && !allChecked;
  const targetLabel = subcontractors.find((s) => s.name === target)?.subcontractor_name || target;

  async function apply() {
    if (!target || selected.size === 0) return;
    const chosen = rows.filter((r) => selected.has(r.name));
    const ok = await confirm({
      title: `Move ${chosen.length} line${chosen.length === 1 ? "" : "s"} to ${targetLabel}?`,
      message: (
        <div>
          Each line's whole quantity goes to <strong>{targetLabel}</strong>, marked as set by
          hand so nothing re-derives it. A line with a submitted supplier PO is refused and
          left as it is.
        </div>
      ),
      confirmLabel: "Move lines",
    });
    if (!ok) return;
    setBusy(true); setErr(null);
    try {
      const res = await pmApi.setSubcontractorBulk(chosen.map((r) => r.name), target, remark || undefined);
      const byName = {};
      (res.results || []).forEach((x) => { byName[x.po_dispatch] = x; });
      set({ results: byName, summary: res, selected: new Set(), remark: "" });
      await fetchRows();
    } catch (e) { setErr(e.message || "Could not save"); }
    finally { setBusy(false); }
  }

  const subOptions = subcontractors.map((s) => ({
    id: s.name,
    label: `${s.subcontractor_name || s.name} (${s.type}${s.sub_payout_pct ? ` · ${s.sub_payout_pct}%` : ""})`,
  }));

  return (
    <>
      <form className="toolbar" onSubmit={loadPasted}>
        <input
          value={input}
          onChange={(e) => set({ input: e.target.value })}
          placeholder="Paste POIDs — one per line, or separated by spaces or commas"
          style={{ flex: "1 1 320px", minWidth: 0, maxWidth: 560, fontFamily: "monospace" }}
        />
        <button type="submit" className="btn-primary" disabled={busy || !input.trim()}>
          {busy && source === "pasted" ? "Loading…" : "Load lines"}
        </button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={loadDisagreements}
                title="Every line whose contract names a different party from the team on its last visit">
          {busy && source === "disagreements" ? "Loading…" : "Find disagreements"}
        </button>
      </form>

      {rows.length > 0 && (
        <div className="toolbar">
          <div style={{ flex: "0 1 340px", minWidth: 220 }}>
            <SearchableSelect
              value={target}
              onChange={(v) => set({ target: v || "" })}
              options={subOptions}
              placeholder="Move selected to…"
            />
          </div>
          <input
            value={remark} onChange={(e) => set({ remark: e.target.value })}
            placeholder="Why (optional) — goes on each line's trail"
            style={{ flex: "1 1 220px", minWidth: 0, maxWidth: 420 }}
          />
          <div className="toolbar-actions">
            <button type="button" className="btn-primary" disabled={busy || !target || selected.size === 0} onClick={apply}>
              {selected.size ? `Move selected (${selected.size})` : "Move selected"}
            </button>
          </div>
        </div>
      )}

      {(err || missing.length > 0 || summary) && (
        <div style={{ margin: "0 16px 8px", display: "grid", gap: 6 }}>
          {err && <div className="notice error"><span>!</span> {err}</div>}
          {missing.length > 0 && (
            <div className="notice error" style={{ fontSize: "0.8rem" }}>
              <span>!</span> Not found ({missing.length}): <span style={{ fontFamily: "monospace" }}>{missing.join(", ")}</span>
            </div>
          )}
          {summary && (
            <div className={`notice${summary.failed ? " error" : ""}`} style={{ fontSize: "0.8rem" }}>
              <span>{summary.failed ? "!" : "✓"}</span>
              {summary.ok} moved{summary.unchanged ? `, ${summary.unchanged} already on it` : ""}
              {summary.failed ? `, ${summary.failed} refused — see the Result column` : ""}.
            </div>
          )}
        </div>
      )}

      <div className="page-content">
        <DataTableWrapper loading={busy && rows.length > 0}>
          <table className="data-table" data-excel-filter-all="1" data-table-key="subcon-reconcile-bulk-v1">
            <thead>
              <tr>
                <th data-excel-filter="0">
                  <input type="checkbox" checked={allChecked} disabled={!selectableRows.length}
                         ref={(el) => { if (el) el.indeterminate = someChecked; }} onChange={toggleAll} />
                </th>
                <th>POID</th>
                <th>IM</th>
                <th>Status</th>
                <th>Contract on line</th>
                <th>Team (last visit)</th>
                <th>Team type</th>
                <th>Team's subcontractor</th>
                <th>Work Done sub</th>
                <th>Current split</th>
                <th>Qty</th>
                <th>Line amount</th>
                <th>Supplier PO</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={14} style={{ textAlign: "center", color: "#64748b", padding: 28 }}>
                    {busy ? "Loading…" : "Paste POIDs and load them, or find every line whose contract disagrees with its team."}
                  </td>
                </tr>
              ) : rows.map((r) => {
                const disagree = r.plan_team_sub && r.contract && r.plan_team_sub !== r.contract;
                const res = results[r.name];
                return (
                  <tr key={r.name} data-doc-name={r.name}
                      style={disagree ? { background: "#fffbeb" } : undefined}>
                    <td>
                      <input type="checkbox" checked={selected.has(r.name)} disabled={!selectable(r)}
                             title={r.locked ? "A submitted supplier PO blocks this line" : undefined}
                             onChange={() => toggle(r.name)} />
                    </td>
                    <td>
                      <button type="button" className="link-button" onClick={() => onOpenLine(r.poid || r.name)}
                              style={{ background: "none", border: "none", padding: 0, color: "#1d4ed8", cursor: "pointer", fontFamily: "monospace", fontSize: "0.78rem" }}
                              title="Open this line on the One line tab">
                        {r.poid || r.name}
                      </button>
                      {r.is_override && (
                        <span style={{ marginLeft: 6, padding: "0 6px", borderRadius: 999, fontSize: "0.64rem", fontWeight: 700, background: "#fef3c7", border: "1px solid #fde68a", color: "#92400e" }}>by hand</span>
                      )}
                    </td>
                    <td>{r.im || ""}</td>
                    <td>{r.dispatch_status || ""}</td>
                    <td title={r.contract}>{short(r.contract)}</td>
                    <td>{r.plan_team ? `${r.plan_team}${r.plan_team_name ? ` · ${r.plan_team_name}` : ""}` : ""}</td>
                    <td>{r.plan_team_type || ""}</td>
                    <td title={r.plan_team_sub} style={disagree ? { color: "#b45309", fontWeight: 700 } : undefined}>{short(r.plan_team_sub)}</td>
                    <td title={r.wd_subcontractor}>{short(r.wd_subcontractor)}</td>
                    <td title={r.split}>{short(r.split)}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{qtyFmt.format(Number(r.split_qty) || 0)}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money.format(Number(r.line_amount) || 0)}</td>
                    <td style={r.locked ? { color: "#b91c1c", fontWeight: 600 } : undefined}>{short(r.lock_text)}</td>
                    <td style={res ? { color: res.status === "error" ? "#b91c1c" : res.status === "ok" ? "#15803d" : "#64748b", whiteSpace: "normal", maxWidth: 320 } : undefined}>
                      {res ? (res.status === "ok" ? `✓ ${short(res.message)}` : res.message) : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </DataTableWrapper>
      </div>
    </>
  );
}
