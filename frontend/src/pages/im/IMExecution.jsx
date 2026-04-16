import { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { pmApi } from "../../services/api";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });
const EXECUTION_STATUS_OPTIONS = [
  "In Progress",
  "Completed",
  "Hold",
  "Cancelled",
  "Postponed",
  "POD Pending",
  "PO Required",
  "Span Loss",
  "Spare Parts",
  "Extra Visit",
  "Late Arrival",
  "Quality Issue",
  "Travel",
];
const CIAG_STATUS_OPTIONS = ["Open", "In Progress", "Submitted", "Approved", "Rejected", "N/A"];

function badgeTone(value) {
  const s = String(value || "").toLowerCase();
  if (!s) return { bg: "#f1f5f9", fg: "#334155", dot: "#64748b" };

  // Explicit execution statuses
  const tones = {
    "in progress": { bg: "#eff6ff", fg: "#1d4ed8", dot: "#3b82f6" },
    completed: { bg: "#ecfdf5", fg: "#047857", dot: "#10b981" },
    hold: { bg: "#fffbeb", fg: "#b45309", dot: "#f59e0b" },
    cancelled: { bg: "#fef2f2", fg: "#b91c1c", dot: "#ef4444" },
    postponed: { bg: "#fefce8", fg: "#a16207", dot: "#eab308" },
    "pod pending": { bg: "#fff7ed", fg: "#c2410c", dot: "#f97316" },
    "po required": { bg: "#fff7ed", fg: "#9a3412", dot: "#ea580c" },
    "span loss": { bg: "#fef2f2", fg: "#991b1b", dot: "#dc2626" },
    "spare parts": { bg: "#ecfeff", fg: "#0e7490", dot: "#06b6d4" },
    "extra visit": { bg: "#f5f3ff", fg: "#6d28d9", dot: "#8b5cf6" },
    "late arrival": { bg: "#fff7ed", fg: "#9a3412", dot: "#f97316" },
    "quality issue": { bg: "#fef2f2", fg: "#991b1b", dot: "#ef4444" },
    travel: { bg: "#eef2ff", fg: "#3730a3", dot: "#6366f1" },
  };
  if (tones[s]) return tones[s];

  // Fallbacks for any future values
  if (s.includes("complete") || s.includes("approved") || s.includes("done") || s.includes("pass")) return { bg: "#ecfdf5", fg: "#047857", dot: "#10b981" };
  if (s.includes("cancel") || s.includes("reject") || s.includes("fail")) return { bg: "#fef2f2", fg: "#b91c1c", dot: "#ef4444" };
  if (s.includes("progress") || s.includes("review") || s.includes("open")) return { bg: "#eff6ff", fg: "#1d4ed8", dot: "#3b82f6" };
  if (s.includes("hold") || s.includes("pending") || s.includes("wait") || s.includes("postponed")) return { bg: "#fffbeb", fg: "#b45309", dot: "#f59e0b" };
  return { bg: "#f8fafc", fg: "#334155", dot: "#64748b" };
}

function StatusPill({ value }) {
  const tone = badgeTone(value);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 10px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.03em",
        background: tone.bg,
        color: tone.fg,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 999, background: tone.dot }} />
      {value || "—"}
    </span>
  );
}

function statusTone(value) {
  const s = String(value || "").toLowerCase();
  if (s.includes("complete") || s.includes("approved") || s.includes("done")) return { bg: "#ecfdf5", fg: "#047857" };
  if (s.includes("cancel") || s.includes("reject") || s.includes("fail")) return { bg: "#fef2f2", fg: "#b91c1c" };
  if (s.includes("progress") || s.includes("planned") || s.includes("running")) return { bg: "#eff6ff", fg: "#1d4ed8" };
  return { bg: "#fffbeb", fg: "#b45309" };
}

function DetailItem({ label, value }) {
  const isStatus = /status|mode/i.test(label);
  const tone = statusTone(value);
  return (
    <div style={{ background: "#fff", borderRadius: 8, padding: "8px 10px" }}>
      <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>{label}</div>
      {isStatus ? (
        <span style={{ display: "inline-block", borderRadius: 999, padding: "3px 10px", fontSize: 12, fontWeight: 700, background: tone.bg, color: tone.fg }}>
          {value == null || value === "" ? "—" : String(value)}
        </span>
      ) : (
        <div style={{ fontSize: 13, color: "#0f172a", fontWeight: 500 }}>{value == null || value === "" ? "—" : String(value)}</div>
      )}
    </div>
  );
}

function parseAttachments(raw) {
  if (!raw) return [];
  const text = String(raw).trim();
  if (!text) return [];
  if (text.startsWith("[")) {
    try {
      const arr = JSON.parse(text);
      if (Array.isArray(arr)) return arr.map((v) => String(v || "").trim()).filter(Boolean);
    } catch {
      // ignore and use fallback
    }
  }
  return text.split(/\r?\n|,/).map((v) => v.trim()).filter(Boolean);
}

export default function IMExecution() {
  const { imName } = useAuth();
  const [executions, setExecutions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [qcFilter, setQcFilter] = useState("");
  const [ciagFilter, setCiagFilter] = useState("");
  const [search, setSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [teamFilter, setTeamFilter] = useState("");
  const [duidFilter, setDuidFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [reopenFor, setReopenFor] = useState(null);
  const [issueCategory, setIssueCategory] = useState("");
  const [reopenBusy, setReopenBusy] = useState(false);
  const [reopenErr, setReopenErr] = useState(null);
  const [detailRow, setDetailRow] = useState(null);
  const [qcFor, setQcFor] = useState(null);
  const [qcDecision, setQcDecision] = useState("Pass");
  const [qcIssueCategory, setQcIssueCategory] = useState("");
  const [qcBusy, setQcBusy] = useState(false);
  const [qcErr, setQcErr] = useState(null);
  const [ciagFor, setCiagFor] = useState(null);
  const [ciagDecision, setCiagDecision] = useState("Open");
  const [ciagBusy, setCiagBusy] = useState(false);
  const [ciagErr, setCiagErr] = useState(null);
  const [wdBusy, setWdBusy] = useState("");
  const [wdErr, setWdErr] = useState(null);
  const [selectedExecs, setSelectedExecs] = useState(new Set());

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await pmApi.listIMDailyExecutions(imName, statusFilter || undefined);
        setExecutions(Array.isArray(res) ? res : []);
      } catch {
        setExecutions([]);
      }
      setLoading(false);
    }
    load();
  }, [imName, statusFilter]);

  const filtered = executions.filter((e) => {
    if (qcFilter && (e.qc_status || "") !== qcFilter) return false;
    if (ciagFilter && (e.ciag_status || "") !== ciagFilter) return false;
    if (projectFilter && (e.project_code || "") !== projectFilter) return false;
    if (teamFilter && (e.team || "") !== teamFilter) return false;
    if (duidFilter && (e.site_code || "") !== duidFilter) return false;
    if (fromDate && (e.execution_date || "").slice(0, 10) < fromDate) return false;
    if (toDate && (e.execution_date || "").slice(0, 10) > toDate) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (e.name || "").toLowerCase().includes(q) ||
      (e.rollout_plan || "").toLowerCase().includes(q) ||
      (e.team || "").toLowerCase().includes(q) ||
      (e.execution_date || "").toLowerCase().includes(q) ||
      (e.site_code || "").toLowerCase().includes(q) ||
      (e.po_no || "").toLowerCase().includes(q) ||
      (e.center_area || "").toLowerCase().includes(q) ||
      (e.region_type || "").toLowerCase().includes(q)
    );
  });

  const qcOptions = [...new Set(executions.map((e) => e.qc_status).filter(Boolean))].sort();
  const ciagOptions = [...new Set(executions.map((e) => e.ciag_status).filter(Boolean))].sort();
  const projectOptions = [...new Set(executions.map((e) => e.project_code).filter(Boolean))].sort();
  const teamOptions = [...new Set(executions.map((e) => e.team).filter(Boolean))].sort();
  const duidOptions = [...new Set(executions.map((e) => e.site_code).filter(Boolean))].sort();
  const hasFilters = statusFilter || qcFilter || ciagFilter || search || projectFilter || teamFilter || duidFilter || fromDate || toDate;
  const totalAchieved = filtered.reduce((s, e) => s + (e.achieved_qty || 0), 0);
  const eligibleForWorkDone = filtered.filter((e) => e.execution_status === "Completed" && e.qc_status === "Pass" && !e.work_done);
  const selectedEligible = eligibleForWorkDone.filter((e) => selectedExecs.has(e.name));

  async function submitReopen() {
    if (!reopenFor) return;
    setReopenBusy(true);
    setReopenErr(null);
    try {
      await pmApi.reopenRolloutForRevisit(reopenFor, issueCategory);
      setReopenFor(null);
      setIssueCategory("");
      const res = await pmApi.listIMDailyExecutions(imName, statusFilter || undefined);
      setExecutions(Array.isArray(res) ? res : []);
    } catch (err) {
      setReopenErr(err.message || "Failed");
    } finally {
      setReopenBusy(false);
    }
  }

  async function submitQc() {
    if (!qcFor?.name) return;
    if (qcDecision === "Fail" && !qcIssueCategory.trim()) {
      setQcErr("Issue category is required when QC = Fail.");
      return;
    }
    setQcBusy(true);
    setQcErr(null);
    try {
      await pmApi.updateExecution({
        name: qcFor.name,
        execution_status: "Completed",
        qc_status: qcDecision,
        issue_category: qcDecision === "Fail" ? qcIssueCategory.trim() : undefined,
      });
      setQcFor(null);
      setQcIssueCategory("");
      const res = await pmApi.listIMDailyExecutions(imName, statusFilter || undefined);
      setExecutions(Array.isArray(res) ? res : []);
    } catch (err) {
      setQcErr(err.message || "Failed to update QC");
    } finally {
      setQcBusy(false);
    }
  }

  async function createWorkDoneBulk() {
    if (selectedEligible.length === 0) return;
    setWdBusy("bulk");
    setWdErr(null);
    try {
      for (const row of selectedEligible) {
        // Sequentially create to keep error attribution simple.
        // eslint-disable-next-line no-await-in-loop
        await pmApi.generateWorkDone(row.name);
      }
      setSelectedExecs(new Set());
      const res = await pmApi.listIMDailyExecutions(imName, statusFilter || undefined);
      setExecutions(Array.isArray(res) ? res : []);
    } catch (err) {
      setWdErr(err.message || "Could not create Work Done");
    } finally {
      setWdBusy("");
    }
  }

  async function submitCiag() {
    if (!ciagFor?.name) return;
    setCiagBusy(true);
    setCiagErr(null);
    try {
      await pmApi.updateExecution({
        name: ciagFor.name,
        ciag_status: ciagDecision,
      });
      setCiagFor(null);
      const res = await pmApi.listIMDailyExecutions(imName, statusFilter || undefined);
      setExecutions(Array.isArray(res) ? res : []);
    } catch (err) {
      setCiagErr(err.message || "Failed to update CIAG");
    } finally {
      setCiagBusy(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Execution Monitor</h1>
        </div>
      </div>

      {wdErr && (
        <div className="notice error" style={{ margin: "0 28px 12px" }}>
          <span>!</span> {wdErr}
          <button type="button" className="btn-secondary" style={{ marginLeft: 12, fontSize: "0.75rem" }} onClick={() => setWdErr(null)}>Dismiss</button>
        </div>
      )}

      {reopenFor && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setReopenFor(null)}>
          <div style={{ width: "min(520px, 94vw)", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 20 }} onClick={(e) => e.stopPropagation()}>
            <h4 style={{ margin: "0 0 12px" }}>Return rollout to planning: {reopenFor}</h4>
            {reopenErr && <div className="notice error" style={{ marginBottom: 10 }}>{reopenErr}</div>}
            <div className="form-group" style={{ marginBottom: 10 }}>
              <label>Issue category</label>
              <input value={issueCategory} onChange={(e) => setIssueCategory(e.target.value)} placeholder="e.g. PAT Rejection, QC Rejection" style={{ width: "100%", maxWidth: 460, padding: 8 }} />
            </div>
            <button className="btn-primary" disabled={reopenBusy} onClick={submitReopen}>{reopenBusy ? "…" : "Confirm"}</button>
            <button type="button" className="btn-secondary" style={{ marginLeft: 8 }} onClick={() => setReopenFor(null)}>Cancel</button>
          </div>
        </div>
      )}

      {qcFor && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setQcFor(null)}>
          <div style={{ width: "min(520px, 94vw)", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 20 }} onClick={(e) => e.stopPropagation()}>
          <h4 style={{ margin: "0 0 12px" }}>Set QC: {qcFor.name}</h4>
          {qcErr && <div className="notice error" style={{ marginBottom: 10 }}>{qcErr}</div>}
          <div className="form-group" style={{ marginBottom: 12 }}>
            <label>QC Result</label>
            <select value={qcDecision} onChange={(e) => setQcDecision(e.target.value)} style={{ padding: 8, minWidth: 220 }}>
              <option value="Pass">Pass</option>
              <option value="Fail">Fail</option>
            </select>
          </div>
          {qcDecision === "Fail" && (
            <div className="form-group" style={{ marginBottom: 12 }}>
              <label>Issue category</label>
              <input
                value={qcIssueCategory}
                onChange={(e) => setQcIssueCategory(e.target.value)}
                placeholder="e.g. PAT Rejection, QC Rejection, POD Pending"
                style={{ width: "100%", maxWidth: 460, padding: 8 }}
              />
            </div>
          )}
          <button className="btn-primary" disabled={qcBusy} onClick={submitQc}>{qcBusy ? "…" : "Submit QC"}</button>
          <button type="button" className="btn-secondary" style={{ marginLeft: 8 }} onClick={() => setQcFor(null)}>Cancel</button>
          <p style={{ marginTop: 12, fontSize: 12, color: "#64748b" }}>
            Work Done is not created automatically. After QC Pass, use the top <strong>Create Work Done</strong> action.
          </p>
          </div>
        </div>
      )}

      {ciagFor && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setCiagFor(null)}>
          <div style={{ width: "min(520px, 94vw)", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 20 }} onClick={(e) => e.stopPropagation()}>
            <h4 style={{ margin: "0 0 12px" }}>Set CIAG: {ciagFor.name}</h4>
            {ciagErr && <div className="notice error" style={{ marginBottom: 10 }}>{ciagErr}</div>}
            <div className="form-group" style={{ marginBottom: 12 }}>
              <label>CIAG Status</label>
              <select value={ciagDecision} onChange={(e) => setCiagDecision(e.target.value)} style={{ padding: 8, minWidth: 220 }}>
                {CIAG_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <button className="btn-primary" disabled={ciagBusy} onClick={submitCiag}>{ciagBusy ? "…" : "Submit CIAG"}</button>
            <button type="button" className="btn-secondary" style={{ marginLeft: 8 }} onClick={() => setCiagFor(null)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="toolbar">
        <input
          type="search"
          placeholder="Search Execution ID, Plan, DUID, PO, Team, Center area, Region…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: "7px 14px", borderRadius: 8,
            border: "1px solid #e2e8f0", fontSize: "0.84rem", minWidth: 260,
          }}
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem" }}
        >
          <option value="">All Statuses</option>
          {EXECUTION_STATUS_OPTIONS.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
        <select
          value={qcFilter}
          onChange={(e) => setQcFilter(e.target.value)}
          style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem" }}
        >
          <option value="">All QC</option>
          {qcOptions.map((qc) => (
            <option key={qc} value={qc}>{qc}</option>
          ))}
        </select>
        <select
          value={ciagFilter}
          onChange={(e) => setCiagFilter(e.target.value)}
          style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem" }}
        >
          <option value="">All CIAG</option>
          {ciagOptions.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem" }}>
          <option value="">All Projects</option>
          {projectOptions.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem" }}>
          <option value="">All Teams</option>
          {teamOptions.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={duidFilter} onChange={(e) => setDuidFilter(e.target.value)} style={{ maxWidth: 200, padding: "7px 10px", borderRadius: 8, border: "1px solid #dbe3ef", fontSize: "0.84rem", background: "#fff" }}>
          <option value="">All DUIDs</option>
          {duidOptions.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem" }} />
        <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem" }} />
        {hasFilters && (
          <button
            className="btn-secondary"
            style={{ fontSize: "0.78rem", padding: "5px 12px" }}
            onClick={() => { setSearch(""); setStatusFilter(""); setQcFilter(""); setCiagFilter(""); setProjectFilter(""); setTeamFilter(""); setDuidFilter(""); setFromDate(""); setToDate(""); }}
          >
            Clear
          </button>
        )}
        {selectedEligible.length > 0 && (
          <span style={{ fontSize: "0.78rem", color: "#64748b" }}>
            {selectedEligible.length} selected for Work Done
          </span>
        )}
        <button
          type="button"
          className="btn-primary"
          disabled={selectedEligible.length === 0 || wdBusy === "bulk"}
          onClick={createWorkDoneBulk}
        >
          {wdBusy === "bulk" ? "Creating…" : `Create Work Done (${selectedEligible.length})`}
        </button>
      </div>

      <div className="page-content">
        <div className="data-table-wrapper">
          {loading ? (
            <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📊</div>
              <h3>{hasFilters ? "No results match your filters" : "No execution records"}</h3>
              <p>
                {hasFilters
                  ? "Try adjusting your search or filter criteria."
                  : "Executions appear after teams log work against planned rollouts."}
              </p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}>
                    <input
                      type="checkbox"
                      checked={eligibleForWorkDone.length > 0 && eligibleForWorkDone.every((e) => selectedExecs.has(e.name))}
                      onChange={() => {
                        if (eligibleForWorkDone.length > 0 && eligibleForWorkDone.every((e) => selectedExecs.has(e.name))) {
                          setSelectedExecs(new Set());
                        } else {
                          setSelectedExecs(new Set(eligibleForWorkDone.map((e) => e.name)));
                        }
                      }}
                    />
                  </th>
                  <th>Execution</th>
                  <th>Rollout Plan</th>
                  <th>POID</th>
                  <th>DUID</th>
                  <th>Center area</th>
                  <th>Region</th>
                  <th>PO</th>
                  <th>Team</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th>QC</th>
                  <th>CIAG</th>
                  <th style={{ textAlign: "right" }}>Qty</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <tr key={e.name}>
                    <td>
                      <input
                        type="checkbox"
                        disabled={!(e.execution_status === "Completed" && e.qc_status === "Pass" && !e.work_done)}
                        checked={selectedExecs.has(e.name)}
                        onChange={() => {
                          setSelectedExecs((prev) => {
                            const next = new Set(prev);
                            if (next.has(e.name)) next.delete(e.name);
                            else next.add(e.name);
                            return next;
                          });
                        }}
                      />
                    </td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{e.name}</td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{e.rollout_plan}</td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{e.system_id || "—"}</td>
                    <td>{e.site_code || "—"}</td>
                    <td style={{ fontSize: "0.82rem", maxWidth: 120 }} title={e.center_area || ""}>
                      {e.center_area || "—"}
                    </td>
                    <td style={{ fontSize: "0.82rem" }}>{e.region_type || "—"}</td>
                    <td>{e.po_no || "—"}</td>
                    <td>{e.team}</td>
                    <td>{e.execution_date}</td>
                    <td>
                      <StatusPill value={e.execution_status} />
                    </td>
                    <td>
                      {String(e.execution_status || "") !== "Completed" ? (
                        <span style={{ color: "#94a3b8", fontSize: "0.78rem" }}>—</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setQcErr(null);
                            setQcDecision((e.qc_status === "Fail" || e.qc_status === "Pass") ? e.qc_status : "Pass");
                            setQcIssueCategory("");
                            setQcFor(e);
                          }}
                          style={{ border: "none", background: "none", padding: 0, cursor: "pointer" }}
                          title="Click to set QC"
                        >
                          <StatusPill value={e.qc_status || "Pending"} />
                        </button>
                      )}
                    </td>
                    <td>
                      {String(e.execution_status || "") !== "Completed" ? (
                        <span style={{ color: "#94a3b8", fontSize: "0.78rem" }}>—</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setCiagErr(null);
                            setCiagDecision(e.ciag_status || "Open");
                            setCiagFor(e);
                          }}
                          style={{ border: "none", background: "none", padding: 0, cursor: "pointer" }}
                          title="Click to set CIAG"
                        >
                          <StatusPill value={e.ciag_status || "Open"} />
                        </button>
                      )}
                    </td>
                    <td style={{ textAlign: "right" }}>{e.achieved_qty || 0}</td>
                    <td>
                      <button
                        type="button"
                        className="btn-secondary"
                        style={{ fontSize: "0.72rem", padding: "4px 8px", marginRight: 6 }}
                        onClick={() => setDetailRow(e)}
                      >
                        View
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        style={{ fontSize: "0.72rem", padding: "4px 8px" }}
                        onClick={() => setReopenFor(e.rollout_plan)}
                      >
                        Re-plan
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={13} style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", fontWeight: 700, fontSize: "0.78rem" }}>
                    {filtered.length}{hasFilters && ` of ${executions.length}`} rows
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 700, padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0" }}>
                    {fmt.format(totalAchieved)}
                  </td>
                  <td style={{ background: "#f8fafc", borderTop: "1px solid #e2e8f0" }} />
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
      {detailRow && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setDetailRow(null)}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 20, width: "min(860px, 94vw)", maxHeight: "78vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ margin: 0, fontSize: "1rem" }}>Execution Details</h3>
              <button type="button" onClick={() => setDetailRow(null)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8" }}>&times;</button>
            </div>
            <div style={{ maxHeight: "65vh", overflow: "auto", background: "#f8fafc", borderRadius: 8, padding: 12 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                <div style={{ border: "1px solid #bfdbfe", background: "#eff6ff", color: "#1d4ed8", borderRadius: 999, padding: "4px 10px", fontSize: 12, fontWeight: 700 }}>
                  Execution: {detailRow.name || "—"}
                </div>
                <div style={{ border: "1px solid #fde68a", background: "#fffbeb", color: "#b45309", borderRadius: 999, padding: "4px 10px", fontSize: 12, fontWeight: 700 }}>
                  PO: {detailRow.po_no || "—"}
                </div>
                <div style={{ border: "1px solid #a7f3d0", background: "#ecfdf5", color: "#047857", borderRadius: 999, padding: "4px 10px", fontSize: 12, fontWeight: 700 }}>
                  Team: {detailRow.team || "—"}
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                {Object.entries(detailRow).map(([k, v]) => (
                  <DetailItem
                    key={k}
                    label={String(k).toLowerCase() === "system_id" ? "POID" : k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                    value={v}
                  />
                ))}
              </div>
              {parseAttachments(detailRow.photos).length > 0 && (
                <div style={{ marginTop: 12, background: "#fff", borderRadius: 8, padding: 10 }}>
                  <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>Attachments</div>
                  {parseAttachments(detailRow.photos).map((url, idx) => (
                    <div key={`${url}-${idx}`} style={{ marginBottom: 4 }}>
                      <a href={url} target="_blank" rel="noreferrer">{url}</a>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
