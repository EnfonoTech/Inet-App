import { useEffect, useState } from "react";
import SearchableSelect from "./SearchableSelect";
import { pmApi } from "../services/api";
import { missingImRows, imRequiredMessage } from "../utils/requireIm";

/**
 * Assign lines to a backend (sub-contract) team.
 *
 * Lifted out of IMPOIntake so Work Done can hand a line's OUTSTANDING quantity
 * to a backend team through the same dialog rather than a reduced copy of it.
 * `rows` are the dispatch rows being assigned.
 */
export default function BackendAssignModal({
  open, rows = [], huaweiIms = [], projectDomains = [],
  title, onClose, onDone,
}) {
  const [backendTeamId, setBackendTeamId] = useState("");
  const [backendRemark, setBackendRemark] = useState("");
  const [backendHuaweiIm, setBackendHuaweiIm] = useState("");
  const [backendProjectDomain, setBackendProjectDomain] = useState("");
  const [backendTeams, setBackendTeams] = useState([]);
  const [backendTeamsLoading, setBackendTeamsLoading] = useState(false);
  const [backendBusy, setBackendBusy] = useState(false);
  const [backendError, setBackendError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setBackendError(null);
    setBackendTeamId("");
    setBackendRemark("");
    // Pre-fill only where every row agrees, so a mixed batch is not silently
    // unified under one row's value.
    const hv = [...new Set(rows.map((r) => r.huawei_im).filter(Boolean))];
    setBackendHuaweiIm(hv.length === 1 ? hv[0] : "");
    const dv = [...new Set(rows.map((r) => r.project_domain).filter(Boolean))];
    setBackendProjectDomain(dv.length === 1 ? dv[0] : "");
    setBackendTeamsLoading(true);
    pmApi.listBackendTeamsForPicker()
      .then((list) => setBackendTeams(Array.isArray(list) ? list : []))
      .catch((err) => { setBackendError(err.message || "Failed to load backend teams"); setBackendTeams([]); })
      .finally(() => setBackendTeamsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function submitBackend() {
    if (!rows.length || !backendTeamId) return;
    const sel = new Set(rows.map((r) => r.name));
    const blocked = rows.filter((r) => ["Closed", "Partially Closed", "Submitted", "Partially Submitted", "Completed"].includes(r.dispatch_status));
    // A line with an outstanding confirmed remainder is NOT finished, so its
    // terminal-looking status must not block handing the rest to a team.
    const reallyBlocked = blocked.filter((r) => !(Number(r.remaining_qty) > 0));
    if (reallyBlocked.length > 0) {
      setBackendError(`Cannot assign: ${reallyBlocked.length} POID(s) have status ${[...new Set(reallyBlocked.map((r) => r.dispatch_status))].join(", ")}. Deselect to continue.`);
      return;
    }
    const noIm = missingImRows(rows, sel);
    if (noIm.length > 0) {
      setBackendError(imRequiredMessage(noIm, "assign to a backend team"));
      return;
    }
    setBackendBusy(true);
    setBackendError(null);
    try {
      const res = await pmApi.assignBackend(rows.map((r) => r.name), backendTeamId, backendRemark, {
        huawei_im: backendHuaweiIm || undefined,
        project_domain: backendProjectDomain || undefined,
      });
      const summary = res?.summary || {};
      const okN = summary.updated_count ?? 0;
      const errN = summary.error_count ?? 0;
      if (errN === 0) {
        await onDone?.(`Assigned ${okN} POID${okN !== 1 ? "s" : ""} to backend team ${summary.backend_team_name || backendTeamId}.`);
        onClose?.();
      } else {
        const firstErr = (res?.errors || [])[0];
        setBackendError(`${okN} assigned, ${errN} failed (${firstErr ? `${firstErr.poid}: ${firstErr.error}` : "see errors"})`);
        if (okN > 0) await onDone?.();
      }
    } catch (err) {
      setBackendError(err.message || "Failed to assign to backend");
    } finally {
      setBackendBusy(false);
    }
  }

  if (!open) return null;
  return (
        <div style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
             onClick={backendBusy ? undefined : () => onClose?.()}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 20, width: "min(520px, 100%)", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)" }}
               onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: "1rem" }}>Assign to Backend <span style={{ color: "#64748b", fontWeight: 500 }}>· {rows.length} POID{rows.length !== 1 ? "s" : ""}</span></h3>
              <button type="button" onClick={() => onClose?.()} disabled={backendBusy} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#94a3b8", lineHeight: 1 }}>&times;</button>
            </div>
            {rows.length > 0 && (
              <div style={{ fontSize: "0.76rem", color: "#475569", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 10px", marginBottom: 12, maxHeight: 140, overflowY: "auto" }}>
                {rows.map((r) => (
                  <div key={r.name} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "2px 0" }}>
                    <span style={{ fontFamily: "monospace", fontWeight: 700, color: "#0f172a" }}>{r.poid || r.name}</span>
                    <span style={{ color: "#64748b" }}>{r.po_no || "—"} · {r.item_code || "—"} · {r.site_code || "—"}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="form-group" style={{ marginBottom: 10 }}>
              <label>Backend Team *</label>
              <select value={backendTeamId} onChange={(e) => setBackendTeamId(e.target.value)} disabled={backendBusy || backendTeamsLoading} required>
                <option value="">{backendTeamsLoading ? "Loading teams…" : "— Select a backend team —"}</option>
                {backendTeams.map((t) => <option key={t.name} value={t.name}>{t.team_name || t.team_id}{t.team_id && t.team_name ? ` (${t.team_id})` : ""}</option>)}
              </select>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0 12px" }}>
              <div className="form-group" style={{ marginBottom: 10 }}>
                <label>Huawei IM</label>
                <SearchableSelect
                  value={backendHuaweiIm}
                  onChange={setBackendHuaweiIm}
                  options={huaweiIms.map((h) => ({ id: h.name, label: `${h.full_name}${h.email ? ` (${h.email})` : ""}` }))}
                  placeholder="Defaults from project — set to override"
                  disabled={backendBusy}
                  style={{ width: "100%" }}
                  minWidth={0}
                />
              </div>
              <div className="form-group" style={{ marginBottom: 10 }}>
                <label>Project Domain</label>
                <SearchableSelect
                  value={backendProjectDomain}
                  onChange={setBackendProjectDomain}
                  options={projectDomains.map((d) => ({ id: d.name, label: d.domain_name || d.name }))}
                  placeholder="Defaults from project — set to override"
                  disabled={backendBusy}
                  style={{ width: "100%" }}
                  minWidth={0}
                />
              </div>
            </div>
            <div className="form-group" style={{ marginBottom: 10 }}>
              <label>Note (optional)</label>
              <textarea rows={3} value={backendRemark} onChange={(e) => setBackendRemark(e.target.value)} disabled={backendBusy} style={{ width: "100%", boxSizing: "border-box", padding: "6px 8px", fontSize: "0.85rem", border: "1px solid #e2e8f0", borderRadius: 6, resize: "vertical" }} />
            </div>
            {backendError && <div className="notice error" style={{ marginBottom: 10, fontSize: "0.82rem" }}><span>!</span> {backendError}</div>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button type="button" className="btn-secondary" onClick={() => onClose?.()} disabled={backendBusy}>Cancel</button>
              <button type="button" className="btn-primary" onClick={submitBackend} disabled={backendBusy || !backendTeamId} style={{ background: "#7c3aed", borderColor: "#7c3aed" }}>
                {backendBusy ? "Assigning…" : `Assign ${rows.length} POID${rows.length !== 1 ? "s" : ""}`}
              </button>
            </div>
          </div>
        </div>
  );
}
