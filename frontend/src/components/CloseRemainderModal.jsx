import { useEffect, useState } from "react";
import { pmApi } from "../services/api";
import { qty as qtyFmt } from "../utils/numberFormat";
import RolloutPlanModal from "./RolloutPlanModal";
import DirectCloseModal from "./DirectCloseModal";
import BackendAssignModal from "./BackendAssignModal";

/**
 * Close the outstanding quantity on a line that was confirmed short.
 *
 * The route is not a choice: a POID keeps ONE Work Done for its whole life and
 * the backend only accepts a further closure through the route that closed it
 * first ("this line was closed by Rollout Execution. Close the remaining 0.5
 * the same way"). So this picks the matching dialog and shows nothing else.
 *
 * Each dialog is the SAME component the originating page renders — not a
 * reduced copy — so the remainder form cannot drift from the real one.
 */
export default function CloseRemainderModal({ row, onClose, onDone }) {
  const [huaweiIms, setHuaweiIms] = useState([]);
  const [projectDomains, setProjectDomains] = useState([]);

  useEffect(() => {
    if (!row) return;
    pmApi.listHuaweiIMs?.().then((r) => setHuaweiIms(r || [])).catch(() => setHuaweiIms([]));
    pmApi.listProjectDomains?.().then((r) => setProjectDomains(r || [])).catch(() => setProjectDomains([]));
  }, [row]);

  if (!row) return null;

  const source = (row.source || "").trim();
  const outstanding = Number(row.remaining_qty) || 0;
  const target = row.po_dispatch || row.system_id;

  // What the dialogs treat as "the line": the dispatch, carrying the
  // OUTSTANDING quantity rather than the ordered one.
  const asRow = {
    name: target,
    poid: row.poid,
    po_no: row.po_no,
    item_code: row.item_code,
    site_code: row.site_code,
    qty: outstanding,
    remaining_qty: outstanding,
    line_amount: Number(row.rate) ? Number(row.rate) * outstanding : row.line_amount,
    huawei_im: row.huawei_im,
    project_domain: row.project_domain,
    is_internal_work: row.is_internal_work,
    dispatch_status: row.dispatch_status,
    im: row.im,
  };
  const shared = {
    open: true,
    rows: [asRow],
    huaweiIms,
    projectDomains,
    onClose,
    onDone: () => onDone?.(),
  };

  if (source === "Rollout Execution") {
    return (
      <RolloutPlanModal
        {...shared}
        imName={row.im}
        qtyOf={(r) => Number(r.remaining_qty ?? r.qty ?? 0)}
        defaultVisitType="Execution"
        title={`Plan the remaining ${qtyFmt.format(outstanding)} of ${row.poid || ""}`}
        submitLabel="Create plan"
        onCreated={() => onDone?.()}
      />
    );
  }
  if (source === "Direct Close") return <DirectCloseModal {...shared} />;
  if (source === "Backend") return <BackendAssignModal {...shared} />;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
         onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 22, width: "min(460px, 100%)" }}
           onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: "0 0 8px", fontSize: "1rem" }}>Cannot close the remainder</h3>
        <div style={{ fontSize: "0.84rem", color: "#475569", marginBottom: 16 }}>
          This line has no closing route recorded (source is
          {" "}<strong>{source || "unset"}</strong>), so there is no matching form to open.
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button type="button" className="btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
