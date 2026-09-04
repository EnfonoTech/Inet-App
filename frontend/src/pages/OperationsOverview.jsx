import { useState } from "react";
import DataTableWrapper from "../components/DataTableWrapper";
import { pmApi } from "../services/api";

/**
 * DUID / PO / Acceptance search — PM (admin portal) only (spec §11).
 * Acceptance tab shows placeholder until linked doctype exists.
 */
const fmtMoney = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";
};

export default function OperationsOverview() {
  const [duid, setDuid] = useState("");
  const [poNo, setPoNo] = useState("");
  const [poid, setPoid] = useState("");
  const [tab, setTab] = useState("duid");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  async function runSearch() {
    setErr(null);
    setData(null);
    const d = tab === "duid" ? duid.trim() : "";
    const p = tab === "po" ? poNo.trim() : "";
    const pid = tab === "poid" ? poid.trim() : "";
    if (tab === "duid" && !d && !poNo.trim()) {
      setErr("Enter a DUID (site code), or use the PO tab.");
      return;
    }
    if (tab === "po" && !p) {
      setErr("Enter a PO number.");
      return;
    }
    if (tab === "poid" && !pid) {
      setErr("Enter a POID.");
      return;
    }
    setLoading(true);
    try {
      const res = tab === "po"
        ? await pmApi.getDuidOverview("", p)
        : tab === "poid"
        ? await pmApi.getDuidOverview("", "", pid)
        : await pmApi.getDuidOverview(d, poNo.trim() || "");
      setData(res);
    } catch (e) {
      setErr(e.message || "Search failed");
    } finally {
      setLoading(false);
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

      <div className="toolbar" style={{ flexWrap: "wrap", gap: 12 }}>
        {[
          { id: "duid", label: "DUID / Site" },
          { id: "poid", label: "POID" },
          { id: "po", label: "PO" },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => { setTab(t.id); setData(null); setErr(null); }}
            style={{
              padding: "8px 18px",
              borderRadius: 20,
              border: tab === t.id ? "2px solid #6366f1" : "1px solid #e2e8f0",
              background: tab === t.id ? "#eef2ff" : "#fff",
              fontWeight: 600,
              fontSize: "0.82rem",
              cursor: "pointer",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ margin: "16px 28px", display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        {tab === "duid" && (
          <>
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, marginBottom: 4 }}>DUID (Site Code)</label>
              <input value={duid} onChange={(e) => setDuid(e.target.value)} placeholder="e.g. site identifier" style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #e2e8f0", minWidth: 200 }} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, marginBottom: 4 }}>Optional PO No</label>
              <input value={poNo} onChange={(e) => setPoNo(e.target.value)} placeholder="Narrow by PO" style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #e2e8f0", minWidth: 160 }} />
            </div>
          </>
        )}
        {tab === "po" && (
          <div>
            <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, marginBottom: 4 }}>PO No</label>
            <input value={poNo} onChange={(e) => setPoNo(e.target.value)} placeholder="PO number" style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #e2e8f0", minWidth: 220 }} />
          </div>
        )}
        {tab === "poid" && (
          <div>
            <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, marginBottom: 4 }}>POID</label>
            <input value={poid} onChange={(e) => setPoid(e.target.value)} placeholder="POID" style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #e2e8f0", minWidth: 220 }} />
          </div>
        )}
        <button type="button" className="btn-primary" onClick={runSearch} disabled={loading}>
          {loading ? "Searching…" : "Search"}
        </button>
      </div>

      {err && <div className="notice error" style={{ margin: "0 28px 16px" }}>{err}</div>}

      <div className="page-content">
        {data && (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {data.note && (
              <div className="notice" style={{ margin: "0 28px" }}>{data.note}</div>
            )}
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
