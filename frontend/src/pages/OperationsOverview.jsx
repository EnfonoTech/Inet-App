import { useState } from "react";
import DataTableWrapper from "../components/DataTableWrapper";
import { pmApi } from "../services/api";

/**
 * DUID / POID / PO-No search — PM (admin portal) only (spec §11).
 *
 * One free-text box rather than three tabs: a search box has no reliable way
 * to know which of the three identifier kinds was typed, and the old
 * per-kind tabs made the user decide that up front — every token here is
 * matched against all three fields at once (see get_duid_overview). Multiple
 * values are supported the same way SearchableSelect already does elsewhere
 * in this app: one per line, or comma/semicolon/tab-separated, mixed kinds
 * allowed on different lines.
 */
const fmtMoney = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";
};

export default function OperationsOverview() {
  const [query, setQuery] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  async function runSearch() {
    setErr(null);
    const q = query.trim();
    if (!q) {
      setErr("Enter one or more DUID / POID / PO number values (one per line).");
      return;
    }
    setLoading(true);
    try {
      const res = await pmApi.getDuidOverview(q);
      setData(res);
    } catch (e) {
      setData(null);
      setErr(e.message || "Search failed");
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(e) {
    // Enter searches; Shift+Enter (or plain paste) still adds a new line —
    // the whole point is supporting multiple lines, so Enter alone must not
    // be swallowed as "submit" the way a single-line input would.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      runSearch();
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Search / overview</h1>
          <div className="page-subtitle">PM overview</div>
        </div>
      </div>

      <div style={{ margin: "12px 28px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="DUID / POID / PO No — one or more, one per line"
          rows={1}
          style={{
            flex: "1 1 320px", minWidth: 220, padding: "6px 10px", borderRadius: 8, border: "1px solid #e2e8f0",
            fontFamily: "inherit", fontSize: "0.82rem", lineHeight: 1.4, resize: "vertical", minHeight: 32, maxHeight: 120,
          }}
        />
        <button type="button" className="btn-primary" onClick={runSearch} disabled={loading} style={{ padding: "6px 16px", fontSize: "0.82rem" }}>
          {loading ? "Searching…" : "Search"}
        </button>
      </div>

      {err && <div className="notice error" style={{ margin: "0 28px 12px" }}>{err}</div>}

      <div className="page-content">
        {data && (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <div style={{ margin: "0 28px", fontSize: "0.82rem", color: "#64748b" }}>
              Matched <strong style={{ color: "#0f172a" }}>{data.matched_count}</strong> PO line{data.matched_count === 1 ? "" : "s"}
              {" "}across <strong style={{ color: "#0f172a" }}>{(data.query_tokens || []).length}</strong> search value{(data.query_tokens || []).length === 1 ? "" : "s"}.
            </div>
            {data.dispatches && (
              <section style={{ margin: "0 28px" }}>
                <h3 style={{ fontSize: "1rem", marginBottom: 12 }}>PO line / Dispatch</h3>
                <DataTableWrapper>
                  {data.dispatches.length === 0 ? (
                    <p style={{ padding: 24, color: "#94a3b8" }}>No dispatch rows.</p>
                  ) : (
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>POID</th>
                          <th>PO</th>
                          <th>DUID</th>
                          <th>Item</th>
                          <th>IM</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.dispatches.map((d) => (
                          <tr key={d.name}>
                            <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{d.poid || d.name}</td>
                            <td>{d.po_no}</td>
                            <td>{d.site_code}</td>
                            <td>{d.item_code}</td>
                            <td>{d.im || "—"}</td>
                            <td>{d.dispatch_status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </DataTableWrapper>
              </section>
            )}
            {data.rollout_plans && (
              <section style={{ margin: "0 28px" }}>
                <h3 style={{ fontSize: "1rem", marginBottom: 12 }}>Planned activity</h3>
                <DataTableWrapper>
                  {data.rollout_plans.length === 0 ? (
                    <p style={{ padding: 24, color: "#94a3b8" }}>No rollout plans.</p>
                  ) : (
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Plan</th>
                          <th>Date</th>
                          <th>Visit</th>
                          <th>Status</th>
                          <th>Team</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.rollout_plans.map((p) => (
                          <tr key={p.name}>
                            <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{p.name}</td>
                            <td>{p.plan_date}</td>
                            <td>{p.visit_type}</td>
                            <td>{p.plan_status}</td>
                            <td>{p.team}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </DataTableWrapper>
              </section>
            )}
            {data.executions && (
              <section style={{ margin: "0 28px" }}>
                <h3 style={{ fontSize: "1rem", marginBottom: 12 }}>Execution &amp; QC</h3>
                <DataTableWrapper>
                  {data.executions.length === 0 ? (
                    <p style={{ padding: 24, color: "#94a3b8" }}>No executions.</p>
                  ) : (
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Execution</th>
                          <th>Date</th>
                          <th>Status</th>
                          <th>QC</th>
                          <th>CIAG</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.executions.map((e) => (
                          <tr key={e.name}>
                            <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{e.name}</td>
                            <td>{e.execution_date}</td>
                            <td>{e.execution_status}</td>
                            <td>{e.qc_status}</td>
                            <td>{e.ciag_status || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </DataTableWrapper>
              </section>
            )}
            {data.acceptance && (
              <section style={{ margin: "0 28px" }}>
                <h3 style={{ fontSize: "1rem", marginBottom: 12 }}>PIC / Acceptance</h3>
                <DataTableWrapper>
                  {data.acceptance.length === 0 ? (
                    <p style={{ padding: 24, color: "#94a3b8" }}>No PIC / acceptance rows.</p>
                  ) : (
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>POID</th>
                          <th>MS1 Status</th>
                          <th style={{ textAlign: "right" }}>MS1 %</th>
                          <th style={{ textAlign: "right" }}>MS1 Amount</th>
                          <th style={{ textAlign: "right" }}>MS1 Invoiced</th>
                          <th style={{ textAlign: "right" }}>MS1 Unbilled</th>
                          <th>MS2 Status</th>
                          <th style={{ textAlign: "right" }}>MS2 Amount</th>
                          <th style={{ textAlign: "right" }}>MS2 Invoiced</th>
                          <th>Invoices</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.acceptance.map((a) => (
                          <tr key={a.po_dispatch}>
                            <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{a.poid}</td>
                            <td>{a.pic_status || "—"}</td>
                            <td style={{ textAlign: "right" }}>{a.ms1_pct ? `${a.ms1_pct}%` : "—"}</td>
                            <td style={{ textAlign: "right" }}>{fmtMoney(a.ms1_amount)}</td>
                            <td style={{ textAlign: "right" }}>{fmtMoney(a.ms1_invoiced)}</td>
                            <td style={{ textAlign: "right", color: a.ms1_unbilled > 0 ? "#b45309" : undefined }}>{fmtMoney(a.ms1_unbilled)}</td>
                            <td>{a.pic_status_ms2 || "—"}</td>
                            <td style={{ textAlign: "right" }}>{fmtMoney(a.ms2_amount)}</td>
                            <td style={{ textAlign: "right" }}>{fmtMoney(a.ms2_invoiced)}</td>
                            <td style={{ fontSize: "0.76rem", color: "#64748b" }}>{a.invoices || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </DataTableWrapper>
              </section>
            )}
            {data.subcon && (
              <section style={{ margin: "0 28px" }}>
                <h3 style={{ fontSize: "1rem", marginBottom: 12 }}>Subcon</h3>
                <DataTableWrapper>
                  {data.subcon.length === 0 ? (
                    <p style={{ padding: 24, color: "#94a3b8" }}>No subcontracted lines — INET-executed work has no subcontract to show here.</p>
                  ) : (
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>POID</th>
                          <th>Subcontractor</th>
                          <th>Contract Model</th>
                          <th style={{ textAlign: "right" }}>Payout %</th>
                          <th style={{ textAlign: "right" }}>MS1 Payout</th>
                          <th style={{ textAlign: "right" }}>MS2 Payout</th>
                          <th>Supplier PO</th>
                          <th>Purchase Invoice</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.subcon.map((r) => (
                          <tr key={r.po_dispatch}>
                            <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{r.poid}</td>
                            <td>{r.subcontractor_name || r.subcontract || "—"}</td>
                            <td>{r.contract_model || "—"}</td>
                            <td style={{ textAlign: "right" }}>{r.payout_pct ? `${r.payout_pct}%` : "—"}</td>
                            <td style={{ textAlign: "right" }}>{fmtMoney(r.ms1_payout)}</td>
                            <td style={{ textAlign: "right" }}>{fmtMoney(r.ms2_payout)}</td>
                            <td style={{ fontSize: "0.76rem", color: "#64748b" }}>{r.purchase_orders || "—"}</td>
                            <td style={{ fontSize: "0.76rem", color: "#64748b" }}>{r.purchase_invoices || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </DataTableWrapper>
              </section>
            )}
            {data.expenses && data.expenses.length === 0 && data.dispatches?.length > 0 && (
              <section style={{ margin: "0 28px", fontSize: "0.85rem", color: "#64748b" }}>
                <strong>Expenses (per DUID):</strong> {data.notes || "No expense rows linked yet."}
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
