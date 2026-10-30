import { useEffect, useState } from "react";
import { pmApi } from "../services/api";
import { money, qty as fmtQty } from "../utils/numberFormat";
import { PicStatusBadge, PicMs2Badge, SubPoStatusBadge, SubcontractorSplitTable } from "../pages/pic/picShared";
import RemarksPanel from "./RemarksPanel";

/**
 * Where one line actually is, end to end — for a detail popup that otherwise
 * only knows the PO line. Confirmation and Work Done, customer billing per
 * milestone, the supplier side per milestone, then the visits and remarks.
 * Everything comes from get_line_lifecycle, which reads each figure the way
 * its own page does.
 */
const head = {
  padding: "9px 14px", borderBottom: "1px solid #e2e8f0", background: "#f8fafc",
  fontSize: 10.5, fontWeight: 800, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em",
};
const box = { border: "1px solid #e2e8f0", borderRadius: 10, marginBottom: 14, overflowX: "auto" };
const th = { textAlign: "left", padding: "6px 10px", fontSize: "0.7rem", color: "#64748b", fontWeight: 700, borderBottom: "1px solid #e2e8f0" };
const td = { padding: "7px 10px", fontSize: "0.8rem", borderBottom: "1px solid #f1f5f9", verticalAlign: "top" };
const num = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };

const d = (v) => (v ? String(v).slice(0, 10) : "—");
const m = (v) => (v != null && v !== "" ? money.format(Number(v) || 0) : "—");

function Section({ title, children }) {
  return (
    <div style={box}>
      <div style={head}>{title}</div>
      {children}
    </div>
  );
}

function KV({ label, value }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: "0.68rem", color: "#64748b", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
      <div style={{ fontSize: "0.84rem", color: "#0f172a", marginTop: 2, wordBreak: "break-word" }}>{value ?? "—"}</div>
    </div>
  );
}

export default function LineLifecycle({ poDispatch }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [visits, setVisits] = useState(null);

  useEffect(() => {
    if (!poDispatch) return;
    let alive = true;
    setData(null);
    setError(null);
    pmApi.getLineLifecycle(poDispatch)
      .then((res) => { if (alive) setData(res || {}); })
      .catch((e) => { if (alive) setError(e.message || "Could not load the line"); });
    // Every visit, including a line's only one — DispatchVisitHistory hides
    // itself below two, which is right for a history strip but leaves this
    // section empty on most lines.
    setVisits(null);
    pmApi.listDispatchVisits(poDispatch, "")
      .then((res) => { if (alive) setVisits(Array.isArray(res) ? res : []); })
      .catch(() => { if (alive) setVisits([]); });
    return () => { alive = false; };
  }, [poDispatch]);

  if (!poDispatch) return null;
  if (error) return <div className="notice error" style={{ marginBottom: 14 }}><span>!</span> {error}</div>;
  if (!data) return <div style={{ padding: 14, color: "#94a3b8", fontSize: "0.84rem" }}>Loading line details…</div>;

  const l = data.line || {};
  const wds = data.work_done || [];
  const inv = data.invoices || {};
  const hasMs2 = Number(l.ms2_pct || 0) > 0;
  const milestones = hasMs2 ? [1, 2] : [1];

  return (
    <div style={{ marginTop: 14 }}>
      <Section title="Confirmation & Work Done">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, padding: "12px 14px" }}>
          <KV label="Confirmed Qty" value={l.confirmed_qty != null ? `${fmtQty.format(l.confirmed_qty)} of ${fmtQty.format(l.qty || 0)}` : "—"} />
          <KV label="Confirmed Amount" value={m(l.confirmed_amount)} />
          <KV label="Remaining Qty" value={Number(l.remaining_qty || 0) ? `${fmtQty.format(l.remaining_qty)}${l.remaining_qty_action ? ` · ${l.remaining_qty_action}` : ""}` : "—"} />
          <KV label="Confirmed On" value={d(l.confirmation_date)} />
          <KV label="Confirmed By" value={l.confirmed_by || "—"} />
          <KV label="SQC / PAT" value={[l.sqc_status, l.pat_status].filter(Boolean).join(" · ") || "—"} />
        </div>
        {l.im_confirmation_note && (
          <div style={{ padding: "0 14px 12px", fontSize: "0.8rem", color: "#334155" }}><strong>IM note:</strong> {l.im_confirmation_note}</div>
        )}
        {wds.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={th}>Work Done</th><th style={th}>Closed Via</th><th style={{ ...th, textAlign: "right" }}>Qty</th>
              <th style={{ ...th, textAlign: "right" }}>Revenue</th><th style={th}>Submission</th>
              <th style={th}>MS1 Closed</th><th style={th}>MS2 Closed</th>
            </tr></thead>
            <tbody>
              {wds.map((w) => (
                <tr key={w.name}>
                  <td style={{ ...td, fontFamily: "monospace" }}>{w.name}</td>
                  <td style={td}>{w.source || "Rollout Execution"}{w.direct_close_by ? ` · ${w.direct_close_by}` : ""}</td>
                  <td style={num}>{fmtQty.format(w.executed_qty || 0)}</td>
                  <td style={num}>{m(w.revenue_sar)}</td>
                  <td style={td}>{w.submission_status || "—"}</td>
                  <td style={td}>{w.ms1_closed ? d(w.ms1_closed_at) || "Yes" : "—"}</td>
                  <td style={td}>{w.ms2_closed ? d(w.ms2_closed_at) || "Yes" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Customer Billing">
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            <th style={th}>Milestone</th><th style={th}>PIC Status</th><th style={{ ...th, textAlign: "right" }}>Amount</th>
            <th style={th}>Applied</th><th style={th}>Invoice</th><th style={th}>Invoice Date</th>
            <th style={{ ...th, textAlign: "right" }}>Invoiced</th><th style={{ ...th, textAlign: "right" }}>Unbilled</th>
            <th style={th}>Payment Received</th>
          </tr></thead>
          <tbody>
            {milestones.map((n) => {
              const i = inv[`ms${n}`] || {};
              return (
                <tr key={n}>
                  <td style={td}><strong>MS{n}</strong>{l[`ms${n}_pct`] ? ` · ${fmtQty.format(l[`ms${n}_pct`])}%` : ""}</td>
                  <td style={td}>{n === 1 ? <PicStatusBadge value={l.pic_status} /> : <PicMs2Badge value={l.pic_status_ms2} ms2Pct={l.ms2_pct} />}</td>
                  <td style={num}>{m(l[`ms${n}_amount`])}</td>
                  <td style={td}>{d(l[`ms${n}_applied_date`])}</td>
                  <td style={{ ...td, fontFamily: "monospace" }}>{i.invoice_no || "—"}{i.source === "Legacy" ? " (legacy)" : ""}</td>
                  <td style={td}>{d(i.invoice_date)}</td>
                  <td style={num}>{m(l[`ms${n}_invoiced`])}</td>
                  <td style={num}>{m(l[`ms${n}_unbilled`])}</td>
                  <td style={td}>{d(l[`ms${n}_payment_received_date`])}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {(l.pic_detail_remark || l.pic_detail_remark_ms2 || l.pic_rejection_remark) && (
          <div style={{ padding: "8px 14px", fontSize: "0.8rem", color: "#334155", display: "grid", gap: 4 }}>
            {l.pic_detail_remark && <div><strong>PIC MS1:</strong> {l.pic_detail_remark}</div>}
            {l.pic_detail_remark_ms2 && <div><strong>PIC MS2:</strong> {l.pic_detail_remark_ms2}</div>}
            {l.pic_rejection_remark && <div style={{ color: "#b91c1c" }}><strong>Rejected:</strong> {l.pic_rejection_remark}</div>}
          </div>
        )}
      </Section>

      <Section title="Subcontractor">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, padding: "12px 14px" }}>
          <KV label="Subcontractor" value={l.contract || "—"} />
          <KV label="Contract Model" value={l.contract_model || "—"} />
          <KV label="Supplier" value={l.sub_po_supplier || "—"} />
        </div>
        <div style={{ padding: "0 14px" }}>
          <SubcontractorSplitTable rows={data.allocations} rate={l.rate} />
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            <th style={th}>Milestone</th><th style={th}>Supplier PO</th><th style={{ ...th, textAlign: "right" }}>Payout %</th>
            <th style={{ ...th, textAlign: "right" }}>PO Amount</th><th style={th}>PO Date</th><th style={th}>Paid</th><th style={th}>Remark</th>
          </tr></thead>
          <tbody>
            {milestones.map((n) => (
              <tr key={n}>
                <td style={td}><strong>MS{n}</strong></td>
                <td style={td}><SubPoStatusBadge value={l[`sub_po_status_ms${n}`]} /></td>
                <td style={num}>{l[`sub_po_pct_ms${n}`] ? `${fmtQty.format(l[`sub_po_pct_ms${n}`])}%` : "—"}</td>
                <td style={num}>{m(l[`sub_po_amount_ms${n}`])}</td>
                <td style={td}>{d(l[`sub_po_date_ms${n}`])}</td>
                <td style={td}>{d(l[`sub_paid_date_ms${n}`])}</td>
                <td style={td}>{l[`sub_po_remark_ms${n}`] || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title={`Visits${visits?.length ? ` · ${visits.length}` : ""}`}>
        {visits === null ? (
          <div style={{ padding: 14, color: "#94a3b8", fontSize: "0.84rem" }}>Loading…</div>
        ) : visits.length === 0 ? (
          <div style={{ padding: 14, color: "#94a3b8", fontSize: "0.84rem" }}>Not planned yet.</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={th}>Visit</th><th style={th}>Plan</th><th style={th}>Date</th><th style={th}>Team</th>
              <th style={th}>Status</th><th style={{ ...th, textAlign: "right" }}>Target</th><th style={th}>Work Done</th>
            </tr></thead>
            <tbody>
              {visits.map((v, i) => (
                <tr key={v.name || i}>
                  <td style={td}><strong>#{v.visit_number}</strong>{v.is_current ? " · current" : ""}</td>
                  <td style={{ ...td, fontFamily: "monospace" }}>{v.name || "—"}</td>
                  <td style={td}>{d(v.plan_date)}</td>
                  <td style={td}>{v.team_name || v.team || "—"}</td>
                  <td style={td}>{v.plan_status || "—"}{v.issue_category ? ` (${v.issue_category})` : ""}</td>
                  <td style={num}>{m(v.target_amount)}</td>
                  <td style={{ ...td, fontFamily: "monospace" }}>{v.work_done || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Remarks">
        <div style={{ padding: 10 }}><RemarksPanel poDispatch={poDispatch} compact /></div>
      </Section>
    </div>
  );
}
