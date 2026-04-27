import { useEffect, useRef, useState } from "react";
import { pmApi } from "../services/api";

/**
 * Three-row remarks panel keyed to a POID (PO Dispatch). Visibility/edit
 * permissions are enforced server-side; the component just renders what
 * `get_po_remarks` returns and lights up the editable rows.
 *
 * Roles (server-side rules):
 *   - PM/admin: sees all three; edits general
 *   - IM:       sees all three; edits manager
 *   - Field:    sees only team_lead; edits it
 *
 * Props:
 *   poDispatch — required, the PO Dispatch name (or business POID)
 *   compact    — optional, smaller padding for embedding inside modals
 */
export default function RemarksPanel({ poDispatch, compact = false }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [savingField, setSavingField] = useState(null);
  const [savedField, setSavedField] = useState(null);
  const dirtyRef = useRef({});

  useEffect(() => {
    if (!poDispatch) return;
    let alive = true;
    setLoading(true);
    setError(null);
    pmApi.getPoRemarks(poDispatch)
      .then((res) => { if (alive) setData(res || {}); })
      .catch((err) => { if (alive) setError(err?.message || "Failed to load remarks"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [poDispatch]);

  if (!poDispatch) return null;
  if (loading) {
    return <div style={{ padding: 12, color: "#94a3b8", fontSize: "0.82rem" }}>Loading remarks…</div>;
  }
  if (error) {
    return <div style={{ padding: 12, color: "#b91c1c", fontSize: "0.82rem" }}>⚠ {error}</div>;
  }
  if (!data) return null;

  const editable = data.editable || {};
  const role = data.role;
  const fields = [
    { key: "general_remark",   label: "General",   placeholder: "" },
    { key: "manager_remark",   label: "Manager",   placeholder: "" },
    { key: "team_lead_remark", label: "Team Lead", placeholder: "" },
  ].filter((f) => Object.prototype.hasOwnProperty.call(data, f.key));

  async function persist(field, value) {
    const remarkType = field.replace(/_remark$/, "");
    setSavingField(field);
    try {
      await pmApi.updatePoRemark(data.po_dispatch, remarkType, value);
      setData((d) => ({ ...d, [field]: value }));
      delete dirtyRef.current[field];
      setSavedField(field);
      setTimeout(() => setSavedField((cur) => (cur === field ? null : cur)), 1200);
    } catch (err) {
      setError(err?.message || "Save failed");
    } finally {
      setSavingField(null);
    }
  }

  function onChange(field, value) {
    dirtyRef.current[field] = value;
    setData((d) => ({ ...d, [field]: value }));
  }

  function onBlur(field) {
    if (!(field in dirtyRef.current)) return;
    persist(field, dirtyRef.current[field]);
  }

  return (
    <div style={{
      border: "1px solid #e2e8f0", borderRadius: 8, background: "#fff",
      padding: compact ? "10px 12px" : "12px 14px", marginTop: 8,
    }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 6,
      }}>
        <span style={{ fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "#475569" }}>Remarks</span>
        {role && (
          <span style={{ fontSize: "0.66rem", color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Viewing as {role}
          </span>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {fields.map((f) => {
          const canEdit = !!editable[f.key];
          return (
            <div key={f.key} style={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: 8, alignItems: "flex-start" }}>
              <div style={{ paddingTop: 6 }}>
                <div style={{ fontSize: "0.74rem", fontWeight: 600, color: "#334155" }}>{f.label}</div>
              </div>
              <div style={{ position: "relative" }}>
                <textarea
                  rows={2}
                  value={data[f.key] || ""}
                  onChange={canEdit ? (e) => onChange(f.key, e.target.value) : undefined}
                  onBlur={canEdit ? () => onBlur(f.key) : undefined}
                  readOnly={!canEdit}
                  placeholder={f.placeholder}
                  style={{
                    width: "100%", boxSizing: "border-box",
                    padding: "6px 8px", fontSize: "0.82rem",
                    border: "1px solid #e2e8f0", borderRadius: 6,
                    background: canEdit ? "#fff" : "#f8fafc",
                    color: canEdit ? "#0f172a" : "#475569",
                    resize: "vertical", minHeight: 38,
                    cursor: canEdit ? "text" : "default",
                  }}
                />
                {savingField === f.key && (
                  <span style={{ position: "absolute", right: 8, top: 6, fontSize: "0.66rem", color: "#94a3b8" }}>saving…</span>
                )}
                {savedField === f.key && (
                  <span style={{ position: "absolute", right: 8, top: 6, fontSize: "0.66rem", color: "#047857" }}>saved ✓</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
