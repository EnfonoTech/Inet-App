import { useState, useEffect, useRef } from "react";
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

  async function handleFileUploaded(file_url) {
    if (!customer) {
      setParseError("Please select a customer before uploading.");
      return;
    }
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
    try {
      // Attach customer to each row before sending
      const rowsWithCustomer = parseResult.valid_rows.map(r => ({ ...r, customer }));
      const rowCount = parseResult.valid_rows.length;
      const result = await pmApi.confirmPOUpload(rowsWithCustomer);
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
      setSuccessSummary({ linesImported, skipped, poDocsCreated });
      setStep(2);
    } catch (err) {
      setConfirmError(err.message || "Failed to import rows");
    } finally {
      setConfirming(false);
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
                <div className="data-table-wrapper">
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
                </div>
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
                <div className="data-table-wrapper">
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
                </div>
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
                  {confirming ? "Importing…" : `Confirm Import (${validRows.length} rows)`}
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── Step 2: Success ────────────────────────────────── */}
        {step === 2 && successSummary && (
          <div style={{ maxWidth: 520 }}>
            {successSummary.linesImported > 0 ? (
              <div className="notice success" style={{ marginBottom: 16 }}>
                <span>✅</span>{" "}
                Successfully imported <strong>{successSummary.linesImported}</strong> PO line
                {successSummary.linesImported !== 1 ? "s" : ""} into PO Intake.
                {successSummary.poDocsCreated > 0 && (
                  <span style={{ display: "block", marginTop: 8, fontSize: "0.88rem", opacity: 0.95 }}>
                    ({successSummary.poDocsCreated} new PO Intake document
                    {successSummary.poDocsCreated !== 1 ? "s" : ""})
                  </span>
                )}
              </div>
            ) : (
              <div className="notice error" style={{ marginBottom: 16 }}>
                <span>!</span>{" "}
                No new PO lines were added.
                {successSummary.skipped > 0 ? (
                  <span style={{ display: "block", marginTop: 8, fontSize: "0.88rem" }}>
                    {successSummary.skipped} row{successSummary.skipped !== 1 ? "s" : ""} match lines already on PO Intake
                    (same PO number, line number, and shipment).
                  </span>
                ) : (
                  <span style={{ display: "block", marginTop: 8, fontSize: "0.88rem" }}>
                    Check that your file has valid rows and the correct customer.
                  </span>
                )}
              </div>
            )}
            {successSummary.skipped > 0 && successSummary.linesImported > 0 && (
              <div
                className="notice"
                style={{
                  marginBottom: 16,
                  background: "rgba(245,158,11,0.12)",
                  border: "1px solid rgba(245,158,11,0.35)",
                  color: "#92400e",
                }}
              >
                <span>ℹ</span> Skipped <strong>{successSummary.skipped}</strong> duplicate line
                {successSummary.skipped !== 1 ? "s" : ""} already on PO Intake.
              </div>
            )}
            <button className="btn-primary" onClick={handleReset}>
              Upload Another File
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
