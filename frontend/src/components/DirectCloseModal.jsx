import { useEffect, useState } from "react";
import SearchableSelect from "./SearchableSelect";
import { pmApi } from "../services/api";
import { missingImRows, imRequiredMessage } from "../utils/requireIm";
import { missingFields, missingFieldsMessage } from "../utils/requiredFields";
import { money } from "../utils/numberFormat";

/**
 * Close lines directly, with or without a milestone scope.
 *
 * Lifted out of IMPOIntake so Work Done can direct-close a line's OUTSTANDING
 * quantity through the same dialog — including the milestone choice, which is
 * what decides whether the closure counts against MS1 or MS2.
 */
function todayDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function DirectCloseModal({
  open, rows = [], huaweiIms = [], projectDomains = [],
  onClose, onDone,
}) {
  const [dcNote, setDcNote] = useState("");
  const [dcType, setDcType] = useState("INET");
  const [dcSubcontractor, setDcSubcontractor] = useState("");
  const [dcMilestone, setDcMilestone] = useState("full");
  const [dcClosedOn, setDcClosedOn] = useState(todayDate());
  const [dcHuaweiIm, setDcHuaweiIm] = useState("");
  const [dcProjectDomain, setDcProjectDomain] = useState("");
  const [dcSubconOptions, setDcSubconOptions] = useState([]);
  const [dcSubconLoading, setDcSubconLoading] = useState(false);
  const [dcBusy, setDcBusy] = useState(false);
  const [dcError, setDcError] = useState(null);
  // Whether this user may close a single milestone rather than the whole line.
  // Asked for here rather than passed in, so every caller gets the same answer
  // without having to know the capability exists.
  const [canMilestoneClose, setCanMilestoneClose] = useState(false);
  // Which of the selected lines cannot be closed, asked BEFORE the form is
  // filled in. PO Intake lists PO Intake Lines by their own `po_line_status`,
  // which nothing advances when a line is planned — so a line already on the
  // rollout track still appears there, and used to let someone fill in the
  // whole form before being told. The preflight re-runs on the milestone
  // choice because "MS1 already closed" depends on it.
  const [dcPreflight, setDcPreflight] = useState(null);
  useEffect(() => {
    if (!open || rows.length === 0) { setDcPreflight(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await pmApi.previewDirectClose(
          rows.map((r) => r.name), dcMilestone !== "full" ? dcMilestone : null);
        if (!cancelled) setDcPreflight(res);
      } catch {
        // Best-effort: the submit re-checks everything server-side anyway, so a
        // failed preflight must not stop someone trying.
        if (!cancelled) setDcPreflight(null);
      }
    })();
    return () => { cancelled = true; };
  }, [open, rows, dcMilestone]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    pmApi.getMyDirectCloseCapability()
      .then((res) => { if (!cancelled) setCanMilestoneClose(!!res?.can_milestone_close); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [open]);

  async function loadDcSubcontractors(type) {
    setDcSubconLoading(true);
    setDcSubcontractor("");
    try {
      const opts = await pmApi.getSubcontractorsByType(type);
      setDcSubconOptions(Array.isArray(opts) ? opts.map((o) => ({ id: o.name, label: o.label })) : []);
    } catch {
      setDcSubconOptions([]);
    } finally {
      setDcSubconLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    setDcError(null);
    setDcNote("");
    setDcType("INET");
    setDcSubcontractor("");
    setDcMilestone("full");
    setDcClosedOn(todayDate());
    // Pre-fill only where every row agrees, so a mixed batch is not silently
    // unified under one row's value.
    const hv = [...new Set(rows.map((r) => r.huawei_im).filter(Boolean))];
    setDcHuaweiIm(hv.length === 1 ? hv[0] : "");
    const dv = [...new Set(rows.map((r) => r.project_domain).filter(Boolean))];
    setDcProjectDomain(dv.length === 1 ? dv[0] : "");
    loadDcSubcontractors("INET");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function submitDirectClose() {
    const sel = new Set(rows.map((r) => r.name));
    const noIm = missingImRows(rows, sel);
    if (noIm.length > 0) {
      setDcError(imRequiredMessage(noIm, "direct close"));
      return;
    }
    const missing = missingFields({
      "Close Type": dcType,
      "Subcontractor": dcSubcontractor,
      "Closing Date": dcClosedOn,
    });
    if (missing.length > 0) {
      setDcError(missingFieldsMessage(missing, "direct close"));
      return;
    }
    setDcBusy(true);
    setDcError(null);
    try {
      const milestone = dcMilestone !== "full" ? dcMilestone : null;
      const res = await pmApi.directCloseDispatches(
        rows.map((r) => r.name), dcType, dcSubcontractor, dcNote, milestone, {
          huawei_im: dcHuaweiIm || undefined,
          project_domain: dcProjectDomain || undefined,
          closed_on: dcClosedOn,
        });
      // A Direct Close is now a REQUEST an admin decides, so "0 closed" is the
      // normal, successful outcome for everyone but an admin — the old message
      // read it as a failure and, worse, threw away the per-line reason. The
      // reasons are the only thing that tells the user what to do next, so a
      // fully-blocked batch keeps the dialog open and shows them in place
      // rather than closing behind a toast.
      const blocked = res?.blocked || res?.errors || [];
      const closed = res?.closed ?? (res?.updated?.length || 0);
      if (!res?.created) {
        setDcError(
          blocked.length
            ? `Nothing could be closed:\n${blocked.map((b) => `• ${b.poid}: ${b.error}`).join("\n")}`
            : "Nothing could be closed.",
        );
        return;
      }
      const tail = blocked.length
        ? ` ${blocked.length} line${blocked.length !== 1 ? "s" : ""} left out: ${blocked.map((b) => `${b.poid} (${b.error})`).join("; ")}`
        : "";
      await onDone?.(
        res?.auto_approved
          ? `Direct Close: ${closed} POID${closed !== 1 ? "s" : ""} closed.${tail}`
          : `Direct Close requested — ${res.poid_count} POID${res.poid_count !== 1 ? "s" : ""} waiting for Admin approval (${res.request}).${tail}`,
        res,
      );
      onClose?.();
    } catch (e) {
      setDcError(e.message || "Failed to direct-close");
    } finally {
      setDcBusy(false);
    }
  }

  // Named here, not inline in the JSX, so the banner and the button cannot
  // disagree about how many lines are actually closable.
  const dcBlocked = (dcPreflight?.rows || []).filter((r) => r.blocked);
  const dcClosable = rows.length - dcBlocked.length;

  if (!open) return null;
  return (
        <div style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
             onClick={dcBusy ? undefined : () => onClose?.()}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 20, width: "min(520px, 100%)", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)" }}
               onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: "1rem" }}>Direct Close <span style={{ color: "#64748b", fontWeight: 500 }}>· {rows.length} POID{rows.length !== 1 ? "s" : ""}</span></h3>
              <button type="button" onClick={() => onClose?.()} disabled={dcBusy} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#94a3b8", lineHeight: 1 }}>&times;</button>
            </div>
            {dcError && <div className="notice error" style={{ marginBottom: 10, fontSize: "0.82rem", whiteSpace: "pre-line" }}><span>!</span> {dcError}</div>}
            {dcBlocked.length > 0 && (
              <div className={dcClosable === 0 ? "notice error" : "notice"} style={{ marginBottom: 10, fontSize: "0.8rem" }}>
                <span>{dcClosable === 0 ? "!" : "⚠"}</span>
                <div>
                  <strong>{dcBlocked.length} of {rows.length}</strong> cannot be closed
                  {dcClosable === 0 ? " — nothing here to close." : " and will be left out:"}
                  <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                    {dcBlocked.slice(0, 6).map((b) => (
                      <li key={b.po_dispatch || b.poid} title={b.issues?.[0]?.detail || ""}>
                        <span style={{ fontFamily: "monospace" }}>{b.poid}</span> — {b.issues?.[0]?.short}
                      </li>
                    ))}
                    {dcBlocked.length > 6 && <li>+{dcBlocked.length - 6} more</li>}
                  </ul>
                </div>
              </div>
            )}
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
              <label>Type *</label>
              <div style={{ display: "inline-flex", gap: 0, background: "#f1f5f9", borderRadius: 8, padding: 3, border: "1px solid #e2e8f0" }}>
                {["INET", "SUB"].map((t) => (
                  <button key={t} type="button" disabled={dcBusy}
                    onClick={() => { setDcType(t); loadDcSubcontractors(t); }}
                    style={{ padding: "5px 18px", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: dcType === t ? 700 : 400, background: dcType === t ? "#0369a1" : "transparent", color: dcType === t ? "#fff" : "#64748b", transition: "all 0.15s" }}>
                    {t}
                  </button>
                ))}
              </div>
            </div>
            {(() => {
              const singleRow = rows.length === 1 ? rows[0] : null;
              const subLocked = dcMilestone !== "full" && singleRow?.wd_subcontractor &&
                (dcMilestone === "MS1" ? singleRow?.ms2_closed : singleRow?.ms1_closed);
              return (
                <div className="form-group" style={{ marginBottom: 10 }}>
                  <label>Subcontract *</label>
                  <SearchableSelect
                    value={dcSubcontractor}
                    onChange={setDcSubcontractor}
                    options={dcSubconOptions}
                    placeholder={dcSubconLoading ? "Loading…" : "— Select subcontractor —"}
                    disabled={dcBusy || dcSubconLoading || !!subLocked}
                  />
                </div>
              );
            })()}
            {canMilestoneClose && (() => {
              const singleRow = rows.length === 1 ? rows[0] : null;
              const msOpts = [
                { id: "full",  label: "Full Close",  color: "#0369a1" },
                { id: "MS1",   label: "MS1 Only",    color: "#7c3aed" },
                { id: "MS2",   label: "MS2 Only",    color: "#0891b2" },
              ];
              return (
                <div className="form-group" style={{ marginBottom: 10 }}>
                  <label>Milestone</label>
                  <div style={{ display: "inline-flex", gap: 0, background: "#f1f5f9", borderRadius: 8, padding: 3, border: "1px solid #e2e8f0" }}>
                    {msOpts.map((opt) => {
                      const alreadyClosed = singleRow && (
                        (opt.id === "MS1" && singleRow.ms1_closed) ||
                        (opt.id === "MS2" && singleRow.ms2_closed)
                      );
                      const noAmount = singleRow && (
                        (opt.id === "MS1" && !singleRow.ms1_amount) ||
                        (opt.id === "MS2" && !singleRow.ms2_amount)
                      );
                      const isDisabled = dcBusy || alreadyClosed || noAmount;
                      const active = dcMilestone === opt.id;
                      const tip = alreadyClosed ? `${opt.id} already closed`
                                : noAmount ? `${opt.id} amount not set on this POID`
                                : "";
                      return (
                        <button key={opt.id} type="button" disabled={isDisabled}
                          onClick={() => setDcMilestone(opt.id)}
                          title={tip}
                          style={{ padding: "5px 14px", border: "none", borderRadius: 6,
                            cursor: isDisabled ? "not-allowed" : "pointer",
                            fontWeight: active ? 700 : 400,
                            background: active ? opt.color : "transparent",
                            color: active ? "#fff" : isDisabled ? "#cbd5e1" : "#64748b",
                            opacity: isDisabled ? 0.45 : 1,
                            transition: "all 0.15s" }}>
                          {opt.label}{alreadyClosed ? " ✓" : ""}
                        </button>
                      );
                    })}
                  </div>
                  {dcMilestone !== "full" && singleRow && (() => {
                    const amt = dcMilestone === "MS1" ? (singleRow.ms1_amount || 0) : (singleRow.ms2_amount || 0);
                    const total = (singleRow.ms1_amount || 0) + (singleRow.ms2_amount || 0) || singleRow.line_amount || 0;
                    const pct = total > 0 ? Math.round((amt / total) * 100) : 0;
                    return (
                      <div style={{ marginTop: 5, fontSize: "0.76rem", color: "#64748b" }}>
                        Revenue: <strong>SAR {money.format(amt)}</strong> · {pct}% of total
                      </div>
                    );
                  })()}
                </div>
              );
            })()}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0 12px" }}>
              <div className="form-group" style={{ marginBottom: 10 }}>
                <label>Huawei IM</label>
                <SearchableSelect
                  value={dcHuaweiIm}
                  onChange={setDcHuaweiIm}
                  options={huaweiIms.map((h) => ({ id: h.name, label: `${h.full_name}${h.email ? ` (${h.email})` : ""}` }))}
                  placeholder="Defaults from project — set to override"
                  disabled={dcBusy}
                  style={{ width: "100%" }}
                  minWidth={0}
                />
              </div>
              <div className="form-group" style={{ marginBottom: 10 }}>
                <label>Project Domain</label>
                <SearchableSelect
                  value={dcProjectDomain}
                  onChange={setDcProjectDomain}
                  options={projectDomains.map((d) => ({ id: d.name, label: d.domain_name || d.name }))}
                  placeholder="Defaults from project — set to override"
                  disabled={dcBusy}
                  style={{ width: "100%" }}
                  minWidth={0}
                />
              </div>
            </div>
            <div className="form-group" style={{ marginBottom: 10 }}>
              <label>Closing Date *</label>
              <input
                type="date"
                value={dcClosedOn}
                max={todayDate()}
                onChange={(e) => setDcClosedOn(e.target.value)}
                disabled={dcBusy}
                style={{ width: "100%" }}
              />
            </div>
            <div className="form-group" style={{ marginBottom: 10 }}>
              <label>Note (optional)</label>
              <textarea rows={2} value={dcNote} onChange={(e) => setDcNote(e.target.value)} disabled={dcBusy} style={{ width: "100%", boxSizing: "border-box", padding: "6px 8px", fontSize: "0.85rem", border: "1px solid #e2e8f0", borderRadius: 6, resize: "vertical" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button type="button" className="btn-secondary" onClick={() => onClose?.()} disabled={dcBusy}>Cancel</button>
              {/* Not disabled on a missing field: submitDirectClose names what
                  is missing at the top of this popup, and a dead button with no
                  explanation is what sent the IM looking in the first place. */}
              <button type="button" className="btn-primary" onClick={submitDirectClose}
                      disabled={dcBusy || dcClosable === 0}
                      title={dcClosable === 0 ? "Every selected line is already closed, planned or otherwise off this route." : undefined}
                      style={{ background: "#0369a1", borderColor: "#0369a1" }}>
                {dcBusy ? "Closing…" : dcMilestone !== "full" ? `Close ${dcMilestone} · ${dcClosable} POID${dcClosable !== 1 ? "s" : ""}` : `Close ${dcClosable} POID${dcClosable !== 1 ? "s" : ""}`}
              </button>
            </div>
          </div>
        </div>
  );
}
