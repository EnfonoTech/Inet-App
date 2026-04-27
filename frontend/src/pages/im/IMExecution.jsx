import { useCallback, useEffect, useMemo, useState } from "react";
import DataTableWrapper from "../../components/DataTableWrapper";
import { useAuth } from "../../context/AuthContext";
import { useTableRowLimit, useResetOnRowLimitChange } from "../../context/TableRowLimitContext";
import TableRowsLimitFooter from "../../components/TableRowsLimitFooter";
import { useDebounced } from "../../hooks/useDebounced";
import { pmApi } from "../../services/api";
import { EXECUTION_STATUS_OPTIONS, ISSUE_CATEGORY_OPTIONS } from "../../constants/executionStatuses";
import useFilterOptions from "../../hooks/useFilterOptions";
import SearchableSelect from "../../components/SearchableSelect";
import RecordDetailView from "../../components/RecordDetailView";
import DateRangePicker from "../../components/DateRangePicker";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });
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
  const { rowLimit } = useTableRowLimit();
  const [executions, setExecutions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState([]);
  const [qcFilter, setQcFilter] = useState([]);
  const [ciagFilter, setCiagFilter] = useState([]);
  const [search, setSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState([]);
  const [teamFilter, setTeamFilter] = useState([]);
  const [duidFilter, setDuidFilter] = useState([]);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const searchDebounced = useDebounced(search, 300);
  const [reopenFor, setReopenFor] = useState(null);
  const [issueCategory, setIssueCategory] = useState("");
  const [reopenRemarks, setReopenRemarks] = useState("");
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
  const [execStatusFor, setExecStatusFor] = useState(null);
  const [execStatusPick, setExecStatusPick] = useState("In Progress");
  const [execStatusBusy, setExecStatusBusy] = useState(false);
  const [execStatusErr, setExecStatusErr] = useState(null);
  const [tlStatusFor, setTlStatusFor] = useState(null);
  const [tlStatusPick, setTlStatusPick] = useState("In Progress");
  const [tlStatusBusy, setTlStatusBusy] = useState(false);
  const [tlStatusErr, setTlStatusErr] = useState(null);
  const [issueCatFor, setIssueCatFor] = useState(null);
  const [issueCatPick, setIssueCatPick] = useState("");
  const [issueCatBusy, setIssueCatBusy] = useState(false);
  const [issueCatErr, setIssueCatErr] = useState(null);
  const [wdBusy, setWdBusy] = useState("");
  const [wdErr, setWdErr] = useState(null);
  const [selectedExecs, setSelectedExecs] = useState(new Set());

  useResetOnRowLimitChange(() => {
    setExecutions([]);
    setLoading(true);
  });

  const loadExecutions = useCallback(async () => {
    if (!imName) {
      setExecutions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const portal = {};
      if (searchDebounced.trim()) portal.search = searchDebounced.trim();
      if (qcFilter.length) portal.qc_status = qcFilter;
      if (ciagFilter.length) portal.ciag_status = ciagFilter;
      if (projectFilter.length) portal.project_code = projectFilter;
      if (teamFilter.length) portal.team = teamFilter;
      if (duidFilter.length) portal.site_code = duidFilter;
      if (fromDate) portal.from_date = fromDate;
      if (toDate) portal.to_date = toDate;
      const portalArg = Object.keys(portal).length ? portal : undefined;
      const res = await pmApi.listIMDailyExecutions(imName, statusFilter.length ? statusFilter : undefined, rowLimit, portalArg);
      setExecutions(Array.isArray(res) ? res : []);
    } catch {
      setExecutions([]);
    } finally {
      setLoading(false);
    }
  }, [
    imName,
    statusFilter,
    rowLimit,
    searchDebounced,
    qcFilter,
    ciagFilter,
    projectFilter,
    teamFilter,
    duidFilter,
    fromDate,
    toDate,
  ]);

  useEffect(() => {
    loadExecutions();
  }, [loadExecutions]);

  const qcOptions = [...new Set(executions.map((e) => e.qc_status).filter(Boolean))].sort();
  const ciagOptions = [...new Set(executions.map((e) => e.ciag_status).filter(Boolean))].sort();
  // Distinct master values — so dropdowns are complete regardless of row limit.
  const { options: dispOpts } = useFilterOptions("PO Dispatch", ["project_code", "site_code"]);
  const projectOptions = dispOpts.project_code || [];
  const teamEntries = useMemo(() => {
    const m = new Map();
    executions.forEach((e) => {
      if (!e.team) return;
      m.set(e.team, e.team_name || e.team);
    });
    return [...m.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1]), undefined, { sensitivity: "base" }));
  }, [executions]);
  const duidOptions = dispOpts.site_code || [];
  const hasFilters = !!(statusFilter.length || qcFilter.length || ciagFilter.length || search || projectFilter.length || teamFilter.length || duidFilter.length || fromDate || toDate);
  const totalAchieved = executions.reduce((s, e) => s + (e.achieved_qty || 0), 0);
  const eligibleForWorkDone = executions.filter((e) => e.execution_status === "Completed" && e.qc_status === "Pass" && !e.work_done);
  const selectedEligible = eligibleForWorkDone.filter((e) => selectedExecs.has(e.name));

  async function submitReopen() {
    if (!reopenFor) return;
    setReopenBusy(true);
    setReopenErr(null);
    try {
      await pmApi.reopenRolloutForRevisit(reopenFor, issueCategory, reopenRemarks);
      setReopenFor(null);
      setIssueCategory("");
      setReopenRemarks("");
      await loadExecutions();
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
      await loadExecutions();
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
      await loadExecutions();
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
      await loadExecutions();
    } catch (err) {
      setCiagErr(err.message || "Failed to update CIAG");
    } finally {
      setCiagBusy(false);
    }
  }

  async function submitExecStatus() {
    if (!execStatusFor?.name) return;
    setExecStatusBusy(true);
    setExecStatusErr(null);
    try {
      await pmApi.updateExecution({
        name: execStatusFor.name,
        execution_status: execStatusPick,
      });
      setExecStatusFor(null);
      await loadExecutions();
    } catch (err) {
      setExecStatusErr(err.message || "Failed to update execution status");
    } finally {
      setExecStatusBusy(false);
    }
  }

  async function submitTlStatus() {
    if (!tlStatusFor?.name) return;
    setTlStatusBusy(true);
    setTlStatusErr(null);
    try {
      await pmApi.updateExecution({
        name: tlStatusFor.name,
        tl_status: tlStatusPick,
      });
      setTlStatusFor(null);
      await loadExecutions();
    } catch (err) {
      setTlStatusErr(err.message || "Failed to update TL status");
    } finally {
      setTlStatusBusy(false);
    }
  }

  async function submitIssueCat() {
    if (!issueCatFor?.name) return;
    setIssueCatBusy(true);
    setIssueCatErr(null);
    try {
      await pmApi.updateExecution({
        name: issueCatFor.name,
        issue_category: issueCatPick || "",
      });
      setIssueCatFor(null);
      await loadExecutions();
    } catch (err) {
      setIssueCatErr(err.message || "Failed to update issue category");
    } finally {
      setIssueCatBusy(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Rollout Work Done</h1>
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
              <select value={issueCategory} onChange={(e) => setIssueCategory(e.target.value)} style={{ width: "100%", maxWidth: 460, padding: 8 }}>
                <option value="">— Select category —</option>
                {ISSUE_CATEGORY_OPTIONS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 10 }}>
              <label>Issue remarks (optional)</label>
              <textarea
                value={reopenRemarks}
                onChange={(e) => setReopenRemarks(e.target.value)}
                rows={3}
                placeholder=""
                style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid #e2e8f0", fontSize: "0.84rem", resize: "vertical" }}
              />
            </div>
            <button className="btn-primary" disabled={reopenBusy} onClick={submitReopen}>{reopenBusy ? "…" : "Confirm"}</button>
            <button type="button" className="btn-secondary" style={{ marginLeft: 8 }} onClick={() => { setReopenFor(null); setReopenRemarks(""); }}>Cancel</button>
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
              <select
                value={qcIssueCategory}
                onChange={(e) => setQcIssueCategory(e.target.value)}
                style={{ width: "100%", maxWidth: 460, padding: 8 }}
              >
                <option value="">— Select category —</option>
                {ISSUE_CATEGORY_OPTIONS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
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

      {execStatusFor && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setExecStatusFor(null)}>
          <div style={{ width: "min(520px, 94vw)", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 20 }} onClick={(e) => e.stopPropagation()}>
            <h4 style={{ margin: "0 0 12px" }}>Execution status: {execStatusFor.name}</h4>
            {execStatusErr && <div className="notice error" style={{ marginBottom: 10 }}>{execStatusErr}</div>}
            <div className="form-group" style={{ marginBottom: 12 }}>
              <label>Status</label>
              <select value={execStatusPick} onChange={(e) => setExecStatusPick(e.target.value)} style={{ padding: 8, minWidth: 280, width: "100%" }}>
                {EXECUTION_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <button className="btn-primary" disabled={execStatusBusy} onClick={submitExecStatus}>{execStatusBusy ? "…" : "Save"}</button>
            <button type="button" className="btn-secondary" style={{ marginLeft: 8 }} onClick={() => setExecStatusFor(null)}>Cancel</button>
          </div>
        </div>
      )}

      {tlStatusFor && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setTlStatusFor(null)}>
          <div style={{ width: "min(520px, 94vw)", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 20 }} onClick={(e) => e.stopPropagation()}>
            <h4 style={{ margin: "0 0 12px" }}>TL status: {tlStatusFor.name}</h4>
            {tlStatusErr && <div className="notice error" style={{ marginBottom: 10 }}>{tlStatusErr}</div>}
            <div className="form-group" style={{ marginBottom: 12 }}>
              <label>Status (set by Team Lead — editable by IM)</label>
              <select value={tlStatusPick} onChange={(e) => setTlStatusPick(e.target.value)} style={{ padding: 8, minWidth: 280, width: "100%" }}>
                {EXECUTION_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <button className="btn-primary" disabled={tlStatusBusy} onClick={submitTlStatus}>{tlStatusBusy ? "…" : "Save"}</button>
            <button type="button" className="btn-secondary" style={{ marginLeft: 8 }} onClick={() => setTlStatusFor(null)}>Cancel</button>
          </div>
        </div>
      )}

      {issueCatFor && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setIssueCatFor(null)}>
          <div style={{ width: "min(520px, 94vw)", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 20 }} onClick={(e) => e.stopPropagation()}>
            <h4 style={{ margin: "0 0 12px" }}>Issue category: {issueCatFor.name}</h4>
            {issueCatErr && <div className="notice error" style={{ marginBottom: 10 }}>{issueCatErr}</div>}
            <div className="form-group" style={{ marginBottom: 12 }}>
              <label>Category</label>
              <select value={issueCatPick} onChange={(e) => setIssueCatPick(e.target.value)} style={{ padding: 8, minWidth: 280, width: "100%" }}>
                <option value="">— None —</option>
                {ISSUE_CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <button className="btn-primary" disabled={issueCatBusy} onClick={submitIssueCat}>{issueCatBusy ? "…" : "Save"}</button>
            <button type="button" className="btn-secondary" style={{ marginLeft: 8 }} onClick={() => setIssueCatFor(null)}>Cancel</button>
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
        <SearchableSelect multi value={statusFilter} onChange={setStatusFilter} options={EXECUTION_STATUS_OPTIONS} placeholder="All Statuses" minWidth={150} />
        <SearchableSelect multi value={qcFilter} onChange={setQcFilter} options={qcOptions} placeholder="All QC" minWidth={130} />
        <SearchableSelect multi value={ciagFilter} onChange={setCiagFilter} options={ciagOptions} placeholder="All CIAG" minWidth={130} />
        <SearchableSelect multi value={projectFilter} onChange={setProjectFilter} options={projectOptions} placeholder="All Projects" minWidth={170} />
        <SearchableSelect multi value={teamFilter} onChange={setTeamFilter} options={teamEntries.map(([id, label]) => ({ id, label }))} placeholder="All Teams" minWidth={150} />
        <SearchableSelect multi value={duidFilter} onChange={setDuidFilter} options={duidOptions} placeholder="All DUIDs" minWidth={150} />
        <DateRangePicker value={{ from: fromDate, to: toDate }} onChange={({ from, to }) => { setFromDate(from); setToDate(to); }} />
        {hasFilters && (
          <button
            className="btn-secondary"
            style={{ fontSize: "0.78rem", padding: "5px 12px" }}
            onClick={() => { setSearch(""); setStatusFilter([]); setQcFilter([]); setCiagFilter([]); setProjectFilter([]); setTeamFilter([]); setDuidFilter([]); setFromDate(""); setToDate(""); }}
          >
            Clear
          </button>
        )}
        <div className="toolbar-actions">
          {selectedEligible.length > 0 && (
            <span style={{ fontSize: "0.78rem", color: "#64748b", whiteSpace: "nowrap" }}>
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
      </div>

      <div className="page-content">
        <DataTableWrapper>
          {loading ? (
            <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Loading...</div>
          ) : executions.length === 0 ? (
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
                  <th>Dummy POID</th>
                  <th>Item code</th>
                  <th>Description</th>
                  <th>Activity Type</th>
                  <th>Project</th>
                  <th>DUID</th>
                  <th>Center area</th>
                  <th>Region</th>
                  <th>PO</th>
                  <th>Team</th>
                  <th>IM</th>
                  <th>Date</th>
                  <th>TL Status</th>
                  <th>Execution Status</th>
                  <th>Issue Category</th>
                  <th>QC</th>
                  <th>CIAG</th>
                  <th style={{ textAlign: "right" }}>Qty</th>
                  <th style={{ textAlign: "right" }} title="Which visit this execution is (1, 2, 3…)">Visit #</th>
                  <th style={{ minWidth: 160, width: 160, whiteSpace: "nowrap" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {executions.map((e) => (
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
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{e.poid || e.system_id || "—"}</td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.72rem", maxWidth: 140 }} title={(e.original_dummy_poid || "").trim() ? `Dummy POID: ${e.original_dummy_poid}` : ""}>
                      {(e.original_dummy_poid || "").trim() || "—"}
                    </td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{e.item_code || "—"}</td>
                    <td style={{ fontSize: "0.82rem", maxWidth: 200 }}>{e.item_description || "—"}</td>
                    <td style={{ fontSize: "0.82rem" }}>{e.customer_activity_type || "—"}</td>
                    <td>{e.project_code || "—"}</td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }} title={e.site_name || ""}>{e.site_code || "—"}</td>
                    <td style={{ fontSize: "0.82rem", maxWidth: 120 }} title={e.center_area || ""}>
                      {e.center_area || "—"}
                    </td>
                    <td style={{ fontSize: "0.82rem" }}>{e.region_type || "—"}</td>
                    <td>{e.po_no || "—"}</td>
                    <td style={{ fontSize: "0.82rem" }}>{e.team_name || e.team || "—"}</td>
                    <td style={{ fontSize: "0.82rem" }}>{e.im_full_name || e.dispatch_im || "—"}</td>
                    <td>{e.execution_date}</td>
                    <td>
                      <button
                        type="button"
                        onClick={() => {
                          setTlStatusErr(null);
                          setTlStatusPick(e.tl_status || "In Progress");
                          setTlStatusFor(e);
                        }}
                        style={{ border: "none", background: "none", padding: 0, cursor: "pointer" }}
                        title="Click to change TL status"
                      >
                        <StatusPill value={e.tl_status || "—"} />
                      </button>
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => {
                          setExecStatusErr(null);
                          setExecStatusPick(e.execution_status || "In Progress");
                          setExecStatusFor(e);
                        }}
                        style={{ border: "none", background: "none", padding: 0, cursor: "pointer" }}
                        title="Click to change execution status"
                      >
                        <StatusPill value={e.execution_status} />
                      </button>
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => {
                          setIssueCatErr(null);
                          setIssueCatPick(e.issue_category || "");
                          setIssueCatFor(e);
                        }}
                        style={{ border: "none", background: "none", padding: 0, cursor: "pointer", fontSize: "0.78rem", color: e.issue_category ? "#b45309" : "#94a3b8", fontWeight: e.issue_category ? 600 : 500 }}
                        title="Click to set issue category"
                      >
                        {e.issue_category || "— Set —"}
                      </button>
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
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{e.visit_number != null ? e.visit_number : "—"}</td>
                    <td style={{ minWidth: 160, width: 160, whiteSpace: "nowrap" }}>
                      <div style={{ display: "flex", gap: 4, flexWrap: "nowrap" }}>
                        <button
                          type="button"
                          className="btn-secondary"
                          style={{ fontSize: "0.7rem", padding: "3px 8px", whiteSpace: "nowrap", flexShrink: 0 }}
                          onClick={() => setDetailRow(e)}
                        >
                          View
                        </button>
                        {!e.work_done && (
                          <button
                            type="button"
                            className="btn-secondary"
                            style={{ fontSize: "0.7rem", padding: "3px 8px", whiteSpace: "nowrap", flexShrink: 0 }}
                            onClick={() => setReopenFor(e.rollout_plan)}
                          >
                            Re-plan
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={21} style={{ padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0", fontWeight: 700, fontSize: "0.78rem" }}>
                    {executions.length} row{executions.length !== 1 ? "s" : ""}
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 700, padding: "10px 16px", background: "#f8fafc", borderTop: "1px solid #e2e8f0" }}>
                    {fmt.format(totalAchieved)}
                  </td>
                  <td style={{ background: "#f8fafc", borderTop: "1px solid #e2e8f0" }} />
                  <td style={{ background: "#f8fafc", borderTop: "1px solid #e2e8f0" }} />
                </tr>
              </tfoot>
            </table>
          )}
        </DataTableWrapper>
        <TableRowsLimitFooter
          placement="tableCard"
          loadedCount={executions.length}
          filteredCount={executions.length}
          filterActive={!!hasFilters}
        />
      </div>
      {detailRow && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setDetailRow(null)}>
          <div style={{ background: "#fff", borderRadius: 12, padding: 20, width: "min(860px, 94vw)", maxHeight: "78vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ margin: 0, fontSize: "1rem" }}>Execution Details</h3>
              <button type="button" onClick={() => setDetailRow(null)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#94a3b8" }}>&times;</button>
            </div>
            <RecordDetailView
              row={detailRow}
              pills={[
                { label: "Execution", value: detailRow.name || "—", tone: "blue" },
                { label: "PO", value: detailRow.po_no || "—", tone: "amber" },
                { label: "Team", value: detailRow.team_name || detailRow.team || "—", tone: "green" },
                detailRow.execution_status ? { label: "Status", value: detailRow.execution_status, tone: /complete/i.test(detailRow.execution_status) ? "green" : /cancel/i.test(detailRow.execution_status) ? "rose" : "slate" } : null,
              ].filter(Boolean)}
            />
            {parseAttachments(detailRow.photos).length > 0 && (
              <div style={{ marginTop: 12, background: "#fff", borderRadius: 10, padding: 12, border: "1px solid #eef2f7" }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Attachments</div>
                {parseAttachments(detailRow.photos).map((url, idx) => (
                  <div key={`${url}-${idx}`} style={{ marginBottom: 4, fontSize: 13 }}>
                    <a href={url} target="_blank" rel="noreferrer" style={{ color: "#2563eb", wordBreak: "break-all" }}>{url}</a>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
