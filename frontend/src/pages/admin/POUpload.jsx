import { useState, useEffect, useRef } from "react";
import DataTableWrapper from "../../components/DataTableWrapper";
import { pmApi } from "../../services/api";
import FileUpload from "../../components/FileUpload";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

/** Survives navigation within the portal until confirm, reset, or tab close. */
const PO_UPLOAD_DRAFT_KEY = "inet_po_upload_draft_v1";
const PO_UPLOAD_DRAFT_MAX_AGE_MS = 48 * 60 * 60 * 1000;

function clearPoUploadDraft() {
  try {
    sessionStorage.removeItem(PO_UPLOAD_DRAFT_KEY);
  } catch { /* ignore */ }
}

function savePoUploadDraft(customer, parseResult) {
  try {
    sessionStorage.setItem(
      PO_UPLOAD_DRAFT_KEY,
      JSON.stringify({
        customer: customer || "",
        parseResult: {
          valid_rows: parseResult.valid_rows || [],
          error_rows: parseResult.error_rows || [],
          total: parseResult.total,
        },
        savedAt: Date.now(),
      }),
    );
  } catch (e) {
    console.warn("PO upload: could not save draft (storage full?)", e);
  }
}

const STEPS = ["Upload", "Review", "Confirm"];

function ItemBadge({ exists }) {
  return exists ? (
    <span style={{
      display: "inline-block", padding: "2px 9px", borderRadius: 10,
      fontSize: "0.7rem", fontWeight: 700,
      background: "rgba(16,185,129,0.12)", color: "#059669",
    }}>
      ✓ Exists
    </span>
  ) : (
    <span style={{
      display: "inline-block", padding: "2px 9px", borderRadius: 10,
      fontSize: "0.7rem", fontWeight: 700,
      background: "rgba(245,158,11,0.13)", color: "#b45309",
    }}>
      ⚠ New
    </span>
  );
}

function ProjectBadge({ exists }) {
  return exists ? null : (
    <span style={{
      display: "inline-block", padding: "2px 9px", borderRadius: 10,
      fontSize: "0.7rem", fontWeight: 700,
      background: "rgba(239,68,68,0.1)", color: "#dc2626",
    }}>
      ✕ Not Found
    </span>
  );
}

function StepIndicator({ current }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: 32 }}>
      {STEPS.map((step, idx) => (
        <div key={step} style={{ display: "flex", alignItems: "center" }}>
          <div style={{
            width: 32,
            height: 32,
            borderRadius: "50%",
            background: idx < current ? "var(--green)" : idx === current ? "var(--blue-bright)" : "rgba(100,160,220,0.15)",
            color: idx <= current ? "white" : "var(--text-muted)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "0.8rem",
            fontWeight: 700,
          }}>
            {idx < current ? "\u2713" : idx + 1}
          </div>
          <span style={{
            marginLeft: 10,
            fontSize: "0.88rem",
            fontWeight: idx === current ? 700 : 500,
            color: idx === current ? "var(--text)" : "var(--text-muted)",
          }}>
            {step}
          </span>
          {idx < STEPS.length - 1 && (
            <div style={{
              width: 48,
              height: 2,
              borderRadius: 1,
              background: idx < current ? "var(--green)" : "var(--border-medium)",
              margin: "0 16px",
            }} />
          )}
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ valid }) {
  return (
    <span className={`status-badge ${valid ? "completed" : "overdue"}`}>
      <span className="status-dot" />
      {valid ? "Valid" : "Error"}
    </span>
  );
}

export default function POUpload() {
  const [step, setStep] = useState(0);
  const [customer, setCustomer] = useState("");
  const [customers, setCustomers] = useState([]);
  const [parseResult, setParseResult] = useState(null); // { valid_rows, error_rows }
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [uploadedFileName, setUploadedFileName] = useState("");
  const [uploadedFileUrl, setUploadedFileUrl] = useState("");
  const [recentLogs, setRecentLogs] = useState([]);
  const [detailLog, setDetailLog] = useState(null); // full log for modal/expanded view
  const [summarySearch, setSummarySearch] = useState("");
  const [summaryStatusFilter, setSummaryStatusFilter] = useState("all");
  /** @type {{ linesImported: number, skipped: number, poDocsCreated: number } | null} */
  const [successSummary, setSuccessSummary] = useState(null);
  const [confirmError, setConfirmError] = useState(null);
  const draftRestoreDone = useRef(false);

  // Load customers on mount
  useEffect(() => {
    pmApi.listCustomers().then(res => {
      setCustomers(res || []);
    }).catch(() => {});
  }, []);

  // Load recent upload history
  const refreshRecentLogs = () => {
    pmApi.listPOUploadLogs(25).then(res => {
      setRecentLogs(Array.isArray(res) ? res : []);
    }).catch(() => setRecentLogs([]));
  };
  useEffect(() => {
    refreshRecentLogs();
  }, []);

  // Restore parse review after navigating away (same browser tab)
  useEffect(() => {
    if (draftRestoreDone.current) return;
    draftRestoreDone.current = true;
    try {
      const raw = sessionStorage.getItem(PO_UPLOAD_DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw);
      if (typeof draft.savedAt !== "number" || Date.now() - draft.savedAt > PO_UPLOAD_DRAFT_MAX_AGE_MS) {
        clearPoUploadDraft();
        return;
      }
      const pr = draft.parseResult;
      if (!pr || !Array.isArray(pr.valid_rows) || !Array.isArray(pr.error_rows)) {
        clearPoUploadDraft();
        return;
      }
      if (draft.customer) setCustomer(draft.customer);
      setParseResult({
        valid_rows: pr.valid_rows,
        error_rows: pr.error_rows,
        total: pr.total ?? pr.valid_rows.length + pr.error_rows.length,
      });
      setStep(1);
    } catch {
      clearPoUploadDraft();
    }
  }, []);

  // Keep draft in sync while on the review step
  useEffect(() => {
    if (!parseResult) return;
    savePoUploadDraft(customer, parseResult);
  }, [parseResult, customer]);

  async function handleFileUploaded(file_url, file_name) {
    if (!customer) {
      setParseError("Please select a customer before uploading.");
      return;
    }
    setUploadedFileUrl(file_url || "");
    setUploadedFileName(file_name || "");
    setParsing(true);
    setParseError(null);
    try {
      const result = await pmApi.uploadPOFile(file_url, customer);
      setParseResult(result);
      setStep(1);
      savePoUploadDraft(customer, result);
    } catch (err) {
      setParseError(err.message || "Failed to parse file");
    } finally {
      setParsing(false);
    }
  }

  async function handleConfirm() {
    if (!parseResult?.valid_rows?.length) return;
    if (!customer) {
      setConfirmError("Please select a customer before importing.");
      return;
    }
    setConfirming(true);
    setConfirmError(null);
    setUploadProgress({ done: 0, total: parseResult.valid_rows.length });
    try {
      // Attach customer to each row before sending
      const rowsWithCustomer = parseResult.valid_rows.map(r => ({ ...r, customer }));
      const rowCount = parseResult.valid_rows.length;
      const result = await pmApi.confirmPOUpload(rowsWithCustomer, setUploadProgress);
      clearPoUploadDraft();
      setParseResult(null);
      const poDocsCreated = result?.created ?? 0;
      const skipped = result?.lines_skipped_duplicate ?? 0;
      const linesImported =
        typeof result?.lines_imported === "number"
          ? result.lines_imported
          : poDocsCreated > 0
            ? rowCount
            : 0;
      const poSummary = Array.isArray(result?.po_summary) ? result.po_summary : [];
      const poUpdated = poSummary.filter(p => !p.is_new && (p.lines_added || 0) > 0).length;
      // Persist an audit log so history is recoverable beyond this tab
      try {
        await pmApi.recordPOUploadLog({
          file_name: uploadedFileName,
          file_url: uploadedFileUrl,
          customer,
          total_rows: rowCount,
          lines_imported: linesImported,
          lines_skipped: skipped,
          po_created: poDocsCreated,
          po_updated: poUpdated,
          auto_dispatched: result?.auto_dispatched || 0,
          po_summary: poSummary,
          status: linesImported > 0 ? "Completed" : (skipped > 0 ? "Completed" : "Failed"),
        });
      } catch (logErr) {
        // Non-fatal: upload succeeded even if the log fails to save
        console.warn("Could not save PO upload log:", logErr);
      }
      refreshRecentLogs();
      setSuccessSummary({ linesImported, skipped, poDocsCreated, poSummary, fileName: uploadedFileName });
      setStep(2);
    } catch (err) {
      setConfirmError(err.message || "Failed to import rows");
    } finally {
      setConfirming(false);
      setUploadProgress(null);
    }
  }

  function handleReset() {
    clearPoUploadDraft();
    setStep(0);
    setParseResult(null);
    setParseError(null);
    setSuccessSummary(null);
    setConfirmError(null);
  }

  const validRows = parseResult?.valid_rows || [];
  const errorRows = parseResult?.error_rows || [];
  const newItems = [...new Set(errorRows.filter(r => (r._errors || []).some(e => String(e).includes("Customer Item Master"))).map(r => r.item_code).filter(Boolean))];
  const missingProjects = [...new Set(errorRows.filter(r => (r._errors || []).some(e => String(e).includes("project_code not found"))).map(r => r.project_code).filter(Boolean))];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">PO Upload</h1>
          <div className="page-subtitle">
            Upload Purchase Order data from Excel or CSV. Missing projects and items are created automatically when a
            customer is selected (minimal defaults).
          </div>
        </div>
      </div>

      <div className="page-content">
        <StepIndicator current={step} />

        {/* ── Step 0: Upload ─────────────────────────────────── */}
        {step === 0 && (
          <div style={{ maxWidth: 600 }}>
            {/* Customer selector */}
            <div style={{
              background: "var(--bg-white, #fff)",
              border: "1px solid var(--border, #e2e8f0)",
              borderRadius: "var(--radius, 10px)",
              padding: "20px 24px",
              marginBottom: 20,
              boxShadow: "var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.06))",
            }}>
              <label style={{
                display: "block",
                fontSize: "0.8rem",
                fontWeight: 700,
                color: "var(--text-secondary, #64748b)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                marginBottom: 8,
              }}>
                Select Customer
              </label>
              <select
                value={customer}
                onChange={e => setCustomer(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  fontSize: "0.9rem",
                  fontWeight: 600,
                  border: "1px solid var(--border, #e2e8f0)",
                  borderRadius: "var(--radius-sm, 6px)",
                  background: "var(--bg, #f6f8fb)",
                  color: "var(--text, #1e293b)",
                  cursor: "pointer",
                }}
              >
                <option value="">-- Choose Customer --</option>
                {customers.map(c => (
                  <option key={c.name} value={c.customer_name || c.name}>{c.customer_name || c.name}</option>
                ))}
              </select>
              <p style={{ fontSize: "0.78rem", color: "var(--text-muted, #94a3b8)", marginTop: 6, marginBottom: 0 }}>
                All PO lines in this file will be assigned to this customer.
              </p>
            </div>

            {parsing ? (
              <div className="notice info">
                <span>⏳</span> Parsing file, please wait…
              </div>
            ) : (
              <FileUpload onFileUploaded={handleFileUploaded} accept=".xlsx,.csv" />
            )}
            {parseError && (
              <div className="notice error" style={{ marginTop: 12 }}>
                <span>⚠</span> {parseError}
              </div>
            )}
          </div>
        )}

        {/* ── Step 1: Review ─────────────────────────────────── */}
        {step === 1 && parseResult && (
          <div>
            <div className="validation-summary">
              <div className="validation-stat">
                <div className="stat-dot green" />
                <span className="stat-label">Valid rows</span>
                <span className="stat-value">{validRows.length}</span>
              </div>
              <div className="validation-stat">
                <div className="stat-dot red" />
                <span className="stat-label">Error rows</span>
                <span className="stat-value">{errorRows.length}</span>
              </div>
              <div className="validation-stat">
                <div className="stat-dot amber" />
                <span className="stat-label">Total rows</span>
                <span className="stat-value">{validRows.length + errorRows.length}</span>
              </div>
              {newItems.length > 0 && (
                <div className="validation-stat">
                  <div className="stat-dot" style={{ background: "#f59e0b" }} />
                  <span className="stat-label">New products</span>
                  <span className="stat-value" style={{ color: "#b45309" }}>{newItems.length}</span>
                </div>
              )}
              {missingProjects.length > 0 && (
                <div className="validation-stat">
                  <div className="stat-dot" style={{ background: "#ef4444" }} />
                  <span className="stat-label">Missing projects</span>
                  <span className="stat-value" style={{ color: "#dc2626" }}>{missingProjects.length}</span>
                </div>
              )}
            </div>

            {/* Advisory: New Items */}
            {newItems.length > 0 && (
              <div style={{
                background: "rgba(245,158,11,0.08)",
                border: "1.5px solid rgba(245,158,11,0.35)",
                borderRadius: 10,
                padding: "14px 20px",
                marginBottom: 16,
              }}>
                <div style={{ fontWeight: 700, color: "#b45309", marginBottom: 6, fontSize: "0.9rem" }}>
                  ⚠ {newItems.length} Product{newItems.length !== 1 ? "s" : ""} Not Found in Catalog
                </div>
                <p style={{ margin: "0 0 8px", color: "#92400e", fontSize: "0.84rem" }}>
                  The following item codes do not exist in the ERPNext Item master. They will be
                  <strong> auto-created</strong> on import with a generic setup. To use existing
                  pricing and full details, please create them in ERPNext first.
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {newItems.map(code => (
                    <span key={code} style={{
                      padding: "3px 12px", background: "rgba(245,158,11,0.18)",
                      borderRadius: 6, fontSize: "0.8rem", fontWeight: 600, color: "#78350f",
                      fontFamily: "monospace",
                    }}>
                      {code}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Advisory: Missing Projects */}
            {missingProjects.length > 0 && (
              <div style={{
                background: "rgba(239,68,68,0.06)",
                border: "1.5px solid rgba(239,68,68,0.3)",
                borderRadius: 10,
                padding: "14px 20px",
                marginBottom: 16,
              }}>
                <div style={{ fontWeight: 700, color: "#dc2626", marginBottom: 6, fontSize: "0.9rem" }}>
                  ✕ {missingProjects.length} Project Code{missingProjects.length !== 1 ? "s" : ""} Not Found
                </div>
                <p style={{ margin: "0 0 8px", color: "#991b1b", fontSize: "0.84rem" }}>
                  These project codes do not exist in the Project Control Center.
                  Please create the projects before importing, or the lines will have no project linkage.
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {missingProjects.map(code => (
                    <span key={code} style={{
                      padding: "3px 12px", background: "rgba(239,68,68,0.12)",
                      borderRadius: 6, fontSize: "0.8rem", fontWeight: 600, color: "#7f1d1d",
                      fontFamily: "monospace",
                    }}>
                      {code}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Valid rows table */}
            {validRows.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div style={{
                  fontSize: "0.72rem",
                  fontWeight: 700,
                  color: "var(--green)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  marginBottom: 8,
                }}>
                  Valid Rows ({validRows.length})
                  {newItems.length > 0 && (
                    <span style={{ marginLeft: 12, color: "#b45309", textTransform: "none", fontWeight: 600 }}>
                      — ⚠ badge = item will be auto-created
                    </span>
                  )}
                </div>
                <DataTableWrapper>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Item Code</th>
                        <th>Item</th>
                        <th>PO No</th>
                        <th>Project Code</th>
                        <th>Project</th>
                        <th style={{ textAlign: "right" }}>Qty</th>
                        <th style={{ textAlign: "right" }}>Rate</th>
                        <th style={{ textAlign: "right" }}>Line Amount</th>
                        <th>Row Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {validRows.map((row, i) => (
                        <tr
                          key={i}
                          style={{
                            background: !row.item_exists
                              ? "rgba(245,158,11,0.05)"
                              : !row.project_exists
                              ? "rgba(239,68,68,0.04)"
                              : undefined,
                          }}
                        >
                          <td style={{ color: "var(--text-muted)", fontSize: "0.72rem" }}>{i + 1}</td>
                          <td style={{ fontFamily: "monospace", fontSize: "0.82rem" }}>{row.item_code}</td>
                          <td><ItemBadge exists={row.item_exists} /></td>
                          <td>{row.po_no}</td>
                          <td style={{ fontFamily: "monospace", fontSize: "0.82rem" }}>{row.project_code}</td>
                          <td><ProjectBadge exists={row.project_exists} /></td>
                          <td style={{ textAlign: "right" }}>{row.qty}</td>
                          <td style={{ textAlign: "right" }}>{fmt.format(row.rate || 0)}</td>
                          <td style={{ textAlign: "right" }}>{fmt.format(row.line_amount || 0)}</td>
                          <td><StatusBadge valid={true} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </DataTableWrapper>
              </div>
            )}

            {/* Error rows table */}
            {errorRows.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div style={{
                  fontSize: "0.72rem",
                  fontWeight: 700,
                  color: "var(--red)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  marginBottom: 8,
                }}>
                  Error Rows ({errorRows.length})
                </div>
                <DataTableWrapper>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Item Code</th>
                        <th>PO No</th>
                        <th>Project Code</th>
                        <th style={{ textAlign: "right" }}>Qty</th>
                        <th style={{ textAlign: "right" }}>Rate</th>
                        <th style={{ textAlign: "right" }}>Line Amount</th>
                        <th>Status</th>
                        <th>Error</th>
                      </tr>
                    </thead>
                    <tbody>
                      {errorRows.map((row, i) => (
                        <tr key={i} style={{ background: "rgba(248,113,113,0.06)" }}>
                          <td style={{ color: "var(--text-muted)", fontSize: "0.72rem" }}>{i + 1}</td>
                          <td>{row.item_code}</td>
                          <td>{row.po_no}</td>
                          <td>{row.project_code}</td>
                          <td style={{ textAlign: "right" }}>{row.qty}</td>
                          <td style={{ textAlign: "right" }}>{fmt.format(row.rate || 0)}</td>
                          <td style={{ textAlign: "right" }}>{fmt.format(row.line_amount || 0)}</td>
                          <td><StatusBadge valid={false} /></td>
                          <td style={{ color: "var(--red)", fontSize: "0.78rem" }}>
                            {(row._errors || []).join("; ") || row.error || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </DataTableWrapper>
              </div>
            )}

            {confirmError && (
              <div className="notice error" style={{ marginBottom: 12 }}>
                <span>⚠</span> {confirmError}
              </div>
            )}

            <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
              <button className="btn-secondary" onClick={handleReset}>
                Start Over
              </button>
              {validRows.length > 0 && errorRows.length === 0 && (
                <button
                  className="btn-primary"
                  onClick={handleConfirm}
                  disabled={confirming}
                >
                  {confirming
                    ? uploadProgress && uploadProgress.total > 0
                      ? `Importing… ${uploadProgress.done}/${uploadProgress.total}`
                      : "Importing…"
                    : `Confirm Import (${validRows.length} rows)`}
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── Step 2: Success ────────────────────────────────── */}
        {step === 2 && successSummary && (
          <POUploadSuccessView
            successSummary={successSummary}
            summarySearch={summarySearch}
            setSummarySearch={setSummarySearch}
            summaryStatusFilter={summaryStatusFilter}
            setSummaryStatusFilter={setSummaryStatusFilter}
            onReset={handleReset}
          />
        )}

        {/* ── Upload History (always visible on step 0 and 2) ── */}
        {(step === 0 || step === 2) && (
          <POUploadHistory
            logs={recentLogs}
            onRefresh={refreshRecentLogs}
            onSelect={async (name) => {
              try {
                const detail = await pmApi.getPOUploadLog(name);
                setDetailLog(detail);
              } catch (err) {
                console.warn("Could not load log:", err);
              }
            }}
          />
        )}

        {detailLog && (
          <POUploadDetailModal log={detailLog} onClose={() => setDetailLog(null)} />
        )}
      </div>
    </div>
  );
}

function StatusPill({ status, lines_added }) {
  const s = (status || "").toLowerCase();
  if (s === "new" || (!status && lines_added > 0)) {
    return <span style={{ color: "#059669", fontWeight: 600, fontSize: "0.78rem" }}>● New</span>;
  }
  if (s === "appended") {
    return <span style={{ color: "#2563eb", fontWeight: 600, fontSize: "0.78rem" }}>● Appended</span>;
  }
  return <span style={{ color: "#94a3b8", fontWeight: 600, fontSize: "0.78rem" }}>● Duplicate</span>;
}

function SummaryChip({ label, value, color = "#334155", bg = "rgba(100,116,139,0.08)" }) {
  return (
    <div style={{
      background: bg,
      border: "1px solid rgba(100,116,139,0.15)",
      borderRadius: 10,
      padding: "10px 16px",
      minWidth: 120,
    }}>
      <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--text-secondary, #64748b)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ fontSize: "1.4rem", fontWeight: 700, color, fontVariantNumeric: "tabular-nums", marginTop: 4 }}>
        {fmt.format(value || 0)}
      </div>
    </div>
  );
}

function POUploadSuccessView({ successSummary, summarySearch, setSummarySearch, summaryStatusFilter, setSummaryStatusFilter, onReset }) {
  const rows = Array.isArray(successSummary.poSummary) ? successSummary.poSummary : [];
  const q = summarySearch.trim().toLowerCase();
  const filtered = rows.filter((p) => {
    const pass_s = summaryStatusFilter === "all"
      || (summaryStatusFilter === "new" && p.is_new)
      || (summaryStatusFilter === "appended" && !p.is_new && (p.lines_added || 0) > 0)
      || (summaryStatusFilter === "duplicate" && (p.lines_added || 0) === 0);
    if (!pass_s) return false;
    if (!q) return true;
    return String(p.po_no || "").toLowerCase().includes(q) || String(p.intake_name || "").toLowerCase().includes(q);
  });
  const totals = filtered.reduce((a, p) => {
    a.added += p.lines_added || 0;
    a.skipped += p.lines_skipped || 0;
    return a;
  }, { added: 0, skipped: 0 });
  const byStatusCount = {
    new: rows.filter(p => p.is_new).length,
    appended: rows.filter(p => !p.is_new && (p.lines_added || 0) > 0).length,
    duplicate: rows.filter(p => (p.lines_added || 0) === 0).length,
  };

  return (
    <div>
      {/* Top banner */}
      {successSummary.linesImported > 0 ? (
        <div className="notice success" style={{ marginBottom: 16 }}>
          <span>✅</span>{" "}
          Successfully imported <strong>{successSummary.linesImported}</strong> PO line
          {successSummary.linesImported !== 1 ? "s" : ""}
          {successSummary.fileName ? <> from <strong>{successSummary.fileName}</strong></> : null}.
        </div>
      ) : (
        <div className="notice error" style={{ marginBottom: 16 }}>
          <span>!</span>{" "}
          No new PO lines were added.
          {successSummary.skipped > 0 ? (
            <span style={{ display: "block", marginTop: 6, fontSize: "0.88rem" }}>
              {successSummary.skipped} row{successSummary.skipped !== 1 ? "s" : ""} match lines already on PO Intake (same PO number, line number, and shipment).
            </span>
          ) : (
            <span style={{ display: "block", marginTop: 6, fontSize: "0.88rem" }}>
              Check that your file has valid rows and the correct customer.
            </span>
          )}
        </div>
      )}

      {/* Summary strip */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        <SummaryChip label="Lines Imported" value={successSummary.linesImported} color="#059669" bg="rgba(16,185,129,0.08)" />
        <SummaryChip label="Duplicates Skipped" value={successSummary.skipped} color="#b45309" bg="rgba(245,158,11,0.1)" />
        <SummaryChip label="New POs" value={byStatusCount.new} color="#059669" bg="rgba(16,185,129,0.05)" />
        <SummaryChip label="Appended POs" value={byStatusCount.appended} color="#2563eb" bg="rgba(37,99,235,0.08)" />
        <SummaryChip label="Total POs Touched" value={rows.length} />
      </div>

      {/* Per-PO breakdown */}
      {rows.length > 0 && (
        <div style={{
          background: "var(--bg-white, #fff)",
          border: "1px solid var(--border, #e2e8f0)",
          borderRadius: "var(--radius, 10px)",
          boxShadow: "var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.06))",
          marginBottom: 20,
          overflow: "hidden",
        }}>
          <div style={{
            padding: "14px 18px",
            borderBottom: "1px solid var(--border, #e2e8f0)",
            display: "flex",
            gap: 12,
            alignItems: "center",
            flexWrap: "wrap",
          }}>
            <div style={{ fontSize: "0.92rem", fontWeight: 700, color: "var(--text, #1e293b)" }}>
              Upload Record — {rows.length} PO{rows.length !== 1 ? "s" : ""}
            </div>
            <input
              type="text"
              placeholder="Search PO no or Intake doc…"
              value={summarySearch}
              onChange={(e) => setSummarySearch(e.target.value)}
              style={{
                flex: "1 1 260px",
                padding: "8px 12px",
                fontSize: "0.85rem",
                border: "1px solid var(--border, #e2e8f0)",
                borderRadius: 6,
                background: "var(--bg, #f6f8fb)",
              }}
            />
            <select
              value={summaryStatusFilter}
              onChange={(e) => setSummaryStatusFilter(e.target.value)}
              style={{
                padding: "8px 12px",
                fontSize: "0.85rem",
                border: "1px solid var(--border, #e2e8f0)",
                borderRadius: 6,
                background: "var(--bg, #f6f8fb)",
                fontWeight: 600,
              }}
            >
              <option value="all">All Statuses</option>
              <option value="new">New only</option>
              <option value="appended">Appended only</option>
              <option value="duplicate">Duplicate only</option>
            </select>
          </div>
          <div style={{ maxHeight: 540, overflowY: "auto" }}>
            <table style={{ width: "100%", fontSize: "0.88rem", borderCollapse: "collapse" }}>
              <thead style={{ position: "sticky", top: 0, background: "var(--bg, #f6f8fb)", zIndex: 1 }}>
                <tr style={{ borderBottom: "1px solid var(--border, #e2e8f0)", color: "var(--text-secondary, #64748b)" }}>
                  <th style={{ textAlign: "left", padding: "10px 14px", fontWeight: 700, fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>PO No</th>
                  <th style={{ textAlign: "left", padding: "10px 14px", fontWeight: 700, fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>Intake Doc</th>
                  <th style={{ textAlign: "left", padding: "10px 14px", fontWeight: 700, fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>Status</th>
                  <th style={{ textAlign: "right", padding: "10px 14px", fontWeight: 700, fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>Added</th>
                  <th style={{ textAlign: "right", padding: "10px 14px", fontWeight: 700, fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>Skipped</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: "center", padding: 24, color: "var(--text-muted, #94a3b8)" }}>
                      No POs match your filter.
                    </td>
                  </tr>
                ) : filtered.map((p, idx) => (
                  <tr key={`${p.po_no}-${idx}`}
                      style={{ borderBottom: "1px solid var(--border-light, #f1f5f9)", background: idx % 2 === 0 ? "white" : "rgba(100,116,139,0.02)" }}>
                    <td style={{ padding: "10px 14px", fontFamily: "monospace", fontSize: "0.85rem", color: "var(--text, #1e293b)" }}>{p.po_no}</td>
                    <td style={{ padding: "10px 14px" }}>
                      {p.intake_name ? (
                        <a href={`/app/po-intake/${encodeURIComponent(p.intake_name)}`} target="_blank" rel="noreferrer"
                           style={{ color: "var(--primary, #2563eb)", fontFamily: "monospace", fontSize: "0.85rem", textDecoration: "none" }}>
                          {p.intake_name}
                        </a>
                      ) : <span style={{ color: "var(--text-muted, #94a3b8)" }}>—</span>}
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      <StatusPill status={p.is_new ? "New" : ((p.lines_added || 0) > 0 ? "Appended" : "Duplicate")} lines_added={p.lines_added} />
                    </td>
                    <td style={{ textAlign: "right", padding: "10px 14px", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{p.lines_added}</td>
                    <td style={{ textAlign: "right", padding: "10px 14px", fontVariantNumeric: "tabular-nums", color: p.lines_skipped > 0 ? "#b45309" : "var(--text-muted, #94a3b8)" }}>{p.lines_skipped}</td>
                  </tr>
                ))}
              </tbody>
              {filtered.length > 0 && (
                <tfoot>
                  <tr style={{ borderTop: "2px solid var(--border, #e2e8f0)", background: "var(--bg, #f6f8fb)", fontWeight: 700 }}>
                    <td colSpan={3} style={{ padding: "10px 14px", fontSize: "0.82rem", color: "var(--text-secondary, #64748b)" }}>
                      Total ({filtered.length} PO{filtered.length !== 1 ? "s" : ""})
                    </td>
                    <td style={{ textAlign: "right", padding: "10px 14px", fontVariantNumeric: "tabular-nums", color: "#059669" }}>{fmt.format(totals.added)}</td>
                    <td style={{ textAlign: "right", padding: "10px 14px", fontVariantNumeric: "tabular-nums", color: "#b45309" }}>{fmt.format(totals.skipped)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      <button className="btn-primary" onClick={onReset}>
        Upload Another File
      </button>
    </div>
  );
}

function POUploadHistory({ logs, onRefresh, onSelect }) {
  if (!logs || logs.length === 0) {
    return (
      <div style={{
        background: "var(--bg-white, #fff)",
        border: "1px solid var(--border, #e2e8f0)",
        borderRadius: "var(--radius, 10px)",
        padding: "18px 20px",
        marginTop: 24,
        boxShadow: "var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.06))",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <div style={{ fontSize: "0.92rem", fontWeight: 700 }}>Upload History</div>
          <button className="btn-secondary" style={{ fontSize: "0.78rem" }} onClick={onRefresh}>Refresh</button>
        </div>
        <div style={{ color: "var(--text-muted, #94a3b8)", fontSize: "0.85rem" }}>No uploads recorded yet.</div>
      </div>
    );
  }
  return (
    <div style={{
      background: "var(--bg-white, #fff)",
      border: "1px solid var(--border, #e2e8f0)",
      borderRadius: "var(--radius, 10px)",
      marginTop: 24,
      boxShadow: "var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.06))",
      overflow: "hidden",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: "1px solid var(--border, #e2e8f0)" }}>
        <div style={{ fontSize: "0.92rem", fontWeight: 700 }}>Upload History <span style={{ color: "var(--text-muted, #94a3b8)", fontWeight: 500 }}>({logs.length})</span></div>
        <button className="btn-secondary" style={{ fontSize: "0.78rem" }} onClick={onRefresh}>Refresh</button>
      </div>
      <div style={{ maxHeight: 420, overflowY: "auto" }}>
        <table style={{ width: "100%", fontSize: "0.85rem", borderCollapse: "collapse" }}>
          <thead style={{ position: "sticky", top: 0, background: "var(--bg, #f6f8fb)", zIndex: 1 }}>
            <tr style={{ borderBottom: "1px solid var(--border, #e2e8f0)", color: "var(--text-secondary, #64748b)" }}>
              <th style={{ textAlign: "left", padding: "10px 14px", fontWeight: 700, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>Uploaded At</th>
              <th style={{ textAlign: "left", padding: "10px 14px", fontWeight: 700, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>By</th>
              <th style={{ textAlign: "left", padding: "10px 14px", fontWeight: 700, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>File</th>
              <th style={{ textAlign: "left", padding: "10px 14px", fontWeight: 700, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>Customer</th>
              <th style={{ textAlign: "right", padding: "10px 14px", fontWeight: 700, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>POs</th>
              <th style={{ textAlign: "right", padding: "10px 14px", fontWeight: 700, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>Imported</th>
              <th style={{ textAlign: "right", padding: "10px 14px", fontWeight: 700, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>Skipped</th>
              <th style={{ textAlign: "left", padding: "10px 14px", fontWeight: 700, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>Status</th>
              <th style={{ padding: "10px 14px" }}></th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log, idx) => (
              <tr key={log.name}
                  style={{ borderBottom: "1px solid var(--border-light, #f1f5f9)", background: idx % 2 === 0 ? "white" : "rgba(100,116,139,0.02)" }}>
                <td style={{ padding: "10px 14px", whiteSpace: "nowrap", fontSize: "0.82rem" }}>{formatDateTime(log.uploaded_at)}</td>
                <td style={{ padding: "10px 14px", fontSize: "0.82rem", color: "var(--text-secondary, #64748b)" }}>{log.uploaded_by || "—"}</td>
                <td style={{ padding: "10px 14px", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={log.file_name || ""}>
                  {log.file_name || <span style={{ color: "var(--text-muted, #94a3b8)" }}>—</span>}
                </td>
                <td style={{ padding: "10px 14px", fontSize: "0.82rem" }}>{log.customer || "—"}</td>
                <td style={{ textAlign: "right", padding: "10px 14px", fontVariantNumeric: "tabular-nums" }}>{log.po_count || 0}</td>
                <td style={{ textAlign: "right", padding: "10px 14px", fontVariantNumeric: "tabular-nums", color: "#059669", fontWeight: 600 }}>{fmt.format(log.lines_imported || 0)}</td>
                <td style={{ textAlign: "right", padding: "10px 14px", fontVariantNumeric: "tabular-nums", color: (log.lines_skipped || 0) > 0 ? "#b45309" : "var(--text-muted, #94a3b8)" }}>{fmt.format(log.lines_skipped || 0)}</td>
                <td style={{ padding: "10px 14px" }}>
                  <span style={{
                    fontSize: "0.72rem",
                    fontWeight: 700,
                    padding: "2px 8px",
                    borderRadius: 10,
                    background: log.status === "Completed" ? "rgba(16,185,129,0.12)" : log.status === "Partial" ? "rgba(245,158,11,0.13)" : "rgba(239,68,68,0.1)",
                    color: log.status === "Completed" ? "#059669" : log.status === "Partial" ? "#b45309" : "#dc2626",
                  }}>
                    {log.status || "Completed"}
                  </span>
                </td>
                <td style={{ padding: "10px 14px", textAlign: "right" }}>
                  <button className="btn-secondary" style={{ fontSize: "0.76rem", padding: "4px 10px" }}
                          onClick={() => onSelect(log.name)}>
                    View
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function POUploadDetailModal({ log, onClose }) {
  const rows = Array.isArray(log.po_details) ? log.po_details : [];
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "rgba(15,23,42,0.55)", backdropFilter: "blur(2px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "white", borderRadius: 12, width: "min(900px, 100%)",
        maxHeight: "85vh", display: "flex", flexDirection: "column",
        boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)",
      }}>
        <div style={{ padding: "16px 22px", borderBottom: "1px solid var(--border, #e2e8f0)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: "1rem", fontWeight: 700 }}>{log.file_name || log.name}</div>
            <div style={{ fontSize: "0.78rem", color: "var(--text-secondary, #64748b)", marginTop: 2 }}>
              {formatDateTime(log.uploaded_at)} · {log.uploaded_by || "—"} · {log.customer || "no customer"}
            </div>
          </div>
          <button className="btn-secondary" onClick={onClose} style={{ fontSize: "0.82rem" }}>Close</button>
        </div>
        <div style={{ padding: "14px 22px", display: "flex", gap: 10, flexWrap: "wrap", borderBottom: "1px solid var(--border, #e2e8f0)" }}>
          <SummaryChip label="Imported" value={log.lines_imported} color="#059669" bg="rgba(16,185,129,0.08)" />
          <SummaryChip label="Skipped" value={log.lines_skipped} color="#b45309" bg="rgba(245,158,11,0.1)" />
          <SummaryChip label="New POs" value={log.po_created} color="#059669" bg="rgba(16,185,129,0.05)" />
          <SummaryChip label="Appended" value={log.po_updated} color="#2563eb" bg="rgba(37,99,235,0.08)" />
          <SummaryChip label="Auto Dispatched" value={log.auto_dispatched} />
        </div>
        <div style={{ overflowY: "auto", padding: "0 4px" }}>
          <table style={{ width: "100%", fontSize: "0.86rem", borderCollapse: "collapse" }}>
            <thead style={{ position: "sticky", top: 0, background: "var(--bg, #f6f8fb)" }}>
              <tr style={{ borderBottom: "1px solid var(--border, #e2e8f0)", color: "var(--text-secondary, #64748b)" }}>
                <th style={{ textAlign: "left", padding: "10px 14px", fontWeight: 700, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>PO No</th>
                <th style={{ textAlign: "left", padding: "10px 14px", fontWeight: 700, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>Intake Doc</th>
                <th style={{ textAlign: "left", padding: "10px 14px", fontWeight: 700, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>Status</th>
                <th style={{ textAlign: "right", padding: "10px 14px", fontWeight: 700, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>Added</th>
                <th style={{ textAlign: "right", padding: "10px 14px", fontWeight: 700, fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>Skipped</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={5} style={{ padding: 24, textAlign: "center", color: "var(--text-muted, #94a3b8)" }}>No per-PO rows on this log.</td></tr>
              ) : rows.map((p, idx) => (
                <tr key={idx} style={{ borderBottom: "1px solid var(--border-light, #f1f5f9)", background: idx % 2 === 0 ? "white" : "rgba(100,116,139,0.02)" }}>
                  <td style={{ padding: "10px 14px", fontFamily: "monospace", fontSize: "0.85rem" }}>{p.po_no}</td>
                  <td style={{ padding: "10px 14px" }}>
                    {p.intake_name ? (
                      <a href={`/app/po-intake/${encodeURIComponent(p.intake_name)}`} target="_blank" rel="noreferrer"
                         style={{ color: "var(--primary, #2563eb)", fontFamily: "monospace", fontSize: "0.85rem", textDecoration: "none" }}>
                        {p.intake_name}
                      </a>
                    ) : <span style={{ color: "var(--text-muted, #94a3b8)" }}>—</span>}
                  </td>
                  <td style={{ padding: "10px 14px" }}>
                    <StatusPill status={p.status} lines_added={p.lines_added} />
                  </td>
                  <td style={{ textAlign: "right", padding: "10px 14px", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{p.lines_added}</td>
                  <td style={{ textAlign: "right", padding: "10px 14px", fontVariantNumeric: "tabular-nums", color: p.lines_skipped > 0 ? "#b45309" : "var(--text-muted, #94a3b8)" }}>{p.lines_skipped}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function formatDateTime(s) {
  if (!s) return "—";
  try {
    const d = new Date(s.replace(" ", "T"));
    if (!isNaN(d.getTime())) {
      return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    }
  } catch { /* fallthrough */ }
  return String(s);
}
