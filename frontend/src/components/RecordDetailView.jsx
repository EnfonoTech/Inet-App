/**
 * Renders a record object as a polished detail view. Auto-classifies each
 * field by name so that:
 *   - Long text (description / area / notes / address / > ~60 chars) spans full width
 *   - Comma-separated center_area values render as chips, not one wall of text
 *   - Status / mode fields render as colored pills
 *   - Identifiers (name, parent, *_id, *_code, po_no, poid) get monospace font
 *   - Numeric fields (qty, rate, *_amount, *_qty) are right-aligned + formatted
 *
 * Props:
 *   row         — the record object to display
 *   pills       — optional array of { label, value, tone } shown at the very top
 *   hero        — optional JSX to render above the grid (e.g. stat tiles)
 *   hiddenFields — Set of field names to skip (lowercase)
 *   keyOrder    — optional array controlling priority order
 */
const fmtNum = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });

const LONG_FIELD_RX = /description|notes|remark|address|message|comments?|summary|reason|feedback/i;
const AREA_FIELD_RX = /^(center_area|area|region_list)$/i;
const STATUS_FIELD_RX = /(^|_)(status|mode|flag|result|decision|level)(_|$)/i;
const NUMERIC_FIELD_RX = /(^|_)(qty|quantity|rate|amount|total|cost|revenue|hours|hrs|minutes|seconds|count|percent|pct)(_|$)/i;
const ID_FIELD_RX = /^(name|parent|id|poid|po_no|po_intake|po_dispatch|po_line_no|shipment_number|item_code|project_code|site_code|system_id|rollout_plan|execution|team|subcontractor|customer_id|sub_contract_no|source_id)$/i;
const DATE_FIELD_RX = /(^|_)(date|on|at|time|publish|end|start|modified|creation)(_|$)/i;

function humanizeLabel(key) {
  return String(key || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function statusTone(value) {
  const s = String(value || "").toLowerCase();
  if (!s || s === "—") return { bg: "#f1f5f9", fg: "#64748b", border: "#e2e8f0" };
  if (/(complete|approved|dispatched|done|pass|success|active)/.test(s)) return { bg: "#ecfdf5", fg: "#047857", border: "#a7f3d0" };
  if (/(cancel|reject|fail|error|overdue|block)/.test(s)) return { bg: "#fef2f2", fg: "#b91c1c", border: "#fecaca" };
  if (/(progress|execution|planned|auto|running|submitted|pending review)/.test(s)) return { bg: "#eff6ff", fg: "#1d4ed8", border: "#bfdbfe" };
  if (/(new|pending|draft|open|revisit|hold)/.test(s)) return { bg: "#fffbeb", fg: "#b45309", border: "#fde68a" };
  return { bg: "#f1f5f9", fg: "#334155", border: "#e2e8f0" };
}

function isEmpty(v) {
  return v == null || v === "" || (Array.isArray(v) && v.length === 0);
}

function classifyField(key, value) {
  const k = String(key || "");
  if (AREA_FIELD_RX.test(k)) return "area";
  if (LONG_FIELD_RX.test(k)) return "long";
  if (STATUS_FIELD_RX.test(k)) return "status";
  if (NUMERIC_FIELD_RX.test(k) && (typeof value === "number" || (!isNaN(parseFloat(value)) && value !== ""))) return "number";
  if (ID_FIELD_RX.test(k)) return "id";
  if (DATE_FIELD_RX.test(k) && typeof value === "string") return "date";
  if (typeof value === "string" && value.length > 60) return "long";
  return "text";
}

function formatDate(v) {
  if (!v || typeof v !== "string") return v;
  const d = new Date(v.replace(" ", "T"));
  if (isNaN(d.getTime())) return v;
  // Date-only vs datetime heuristic: strings with time part include ":"
  const hasTime = /\d{2}:\d{2}/.test(v);
  return hasTime
    ? d.toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

function renderValue(kind, value) {
  if (isEmpty(value)) return <span style={{ color: "#94a3b8" }}>—</span>;
  if (kind === "status") {
    const tone = statusTone(value);
    return (
      <span style={{
        display: "inline-block", padding: "3px 10px", borderRadius: 999,
        fontSize: 12, fontWeight: 700,
        background: tone.bg, color: tone.fg, border: `1px solid ${tone.border}`,
      }}>
        {String(value)}
      </span>
    );
  }
  if (kind === "number") {
    const n = typeof value === "number" ? value : parseFloat(value);
    return (
      <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600, color: "#0f172a" }}>
        {isNaN(n) ? String(value) : fmtNum.format(n)}
      </span>
    );
  }
  if (kind === "id") {
    return (
      <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12.5, color: "#0f172a" }}>
        {String(value)}
      </span>
    );
  }
  if (kind === "date") {
    return <span style={{ color: "#0f172a" }}>{formatDate(value)}</span>;
  }
  if (kind === "area") {
    const parts = String(value).split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length <= 1) return <span style={{ color: "#0f172a" }}>{String(value)}</span>;
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {parts.map((p, i) => (
          <span key={i} style={{
            background: "rgba(99,102,241,0.08)",
            color: "#4338ca",
            border: "1px solid rgba(99,102,241,0.18)",
            borderRadius: 6, padding: "2px 8px",
            fontSize: 12, fontWeight: 500,
          }}>{p}</span>
        ))}
      </div>
    );
  }
  return <span style={{ color: "#0f172a" }}>{String(value)}</span>;
}

function Field({ label, value, span }) {
  return (
    <div style={{
      gridColumn: span === "full" ? "1 / -1" : "auto",
      background: "#fff",
      border: "1px solid #eef2f7",
      borderRadius: 10,
      padding: "10px 14px",
      minWidth: 0,
    }}>
      <div style={{
        fontSize: 10.5,
        fontWeight: 700,
        color: "#94a3b8",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        marginBottom: 5,
      }}>
        {label}
      </div>
      <div style={{ fontSize: 13.5, lineHeight: 1.45, wordBreak: "break-word" }}>
        {value}
      </div>
    </div>
  );
}

function Pill({ label, tone = "blue" }) {
  const tones = {
    blue: { bg: "#eff6ff", fg: "#1d4ed8", border: "#bfdbfe" },
    amber: { bg: "#fffbeb", fg: "#b45309", border: "#fde68a" },
    green: { bg: "#ecfdf5", fg: "#047857", border: "#a7f3d0" },
    violet: { bg: "#f5f3ff", fg: "#6d28d9", border: "#ddd6fe" },
    slate: { bg: "#f1f5f9", fg: "#334155", border: "#cbd5e1" },
  };
  const t = tones[tone] || tones.slate;
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      border: `1px solid ${t.border}`,
      background: t.bg,
      color: t.fg,
      borderRadius: 999,
      padding: "4px 12px",
      fontSize: 12.5,
      fontWeight: 700,
      maxWidth: "100%",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    }}>
      {label}
    </span>
  );
}

export default function RecordDetailView({ row, pills, hero, hiddenFields, keyOrder }) {
  if (!row) return null;
  const hidden = hiddenFields instanceof Set
    ? hiddenFields
    : new Set((hiddenFields || []).map((k) => String(k).toLowerCase()));
  const allHidden = new Set([...hidden, "owner", "creation", "modified", "modified_by", "docstatus", "idx"]);

  // Order fields: keyOrder first, then everything else
  const entries = Object.entries(row).filter(([k]) => !allHidden.has(String(k).toLowerCase()));
  let ordered = entries;
  if (Array.isArray(keyOrder) && keyOrder.length) {
    const idx = new Map(keyOrder.map((k, i) => [k, i]));
    ordered = entries.slice().sort(([a], [b]) => {
      const ai = idx.has(a) ? idx.get(a) : 999;
      const bi = idx.has(b) ? idx.get(b) : 999;
      return ai - bi;
    });
  }

  const fields = ordered.map(([k, v]) => {
    const kind = classifyField(k, v);
    const span = kind === "long" || kind === "area" ? "full" : "auto";
    return { key: k, label: humanizeLabel(k), kind, span, value: renderValue(kind, v) };
  });

  return (
    <div style={{ background: "#f8fafc", borderRadius: 10, padding: 14, maxHeight: "70vh", overflow: "auto" }}>
      {Array.isArray(pills) && pills.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: hero ? 12 : 14 }}>
          {pills.filter(p => p && (p.label || p.value)).map((p, i) => (
            <Pill key={i} label={p.label ? `${p.label}: ${p.value ?? "—"}` : p.value} tone={p.tone} />
          ))}
        </div>
      )}
      {hero && <div style={{ marginBottom: 14 }}>{hero}</div>}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
        gap: 8,
      }}>
        {fields.map((f) => (
          <Field key={f.key} label={f.label} value={f.value} span={f.span} />
        ))}
      </div>
    </div>
  );
}

/** Small stat tile — use in `hero` prop to highlight key metrics. */
export function DetailStatTile({ label, value, tone = "slate", accent }) {
  const tones = {
    slate: { bg: "#fff", fg: "#0f172a", border: "#e2e8f0" },
    blue:  { bg: "#eff6ff", fg: "#1d4ed8", border: "#bfdbfe" },
    green: { bg: "#ecfdf5", fg: "#047857", border: "#a7f3d0" },
    amber: { bg: "#fffbeb", fg: "#b45309", border: "#fde68a" },
    violet: { bg: "#f5f3ff", fg: "#6d28d9", border: "#ddd6fe" },
    rose: { bg: "#fff1f2", fg: "#be123c", border: "#fecdd3" },
  };
  const t = tones[tone] || tones.slate;
  return (
    <div style={{
      flex: "1 1 140px",
      minWidth: 120,
      border: `1px solid ${t.border}`,
      background: t.bg,
      borderRadius: 10,
      padding: "12px 14px",
    }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color: t.fg, fontVariantNumeric: "tabular-nums", wordBreak: "break-word" }}>
        {value ?? "—"}
      </div>
      {accent && (
        <div style={{ fontSize: 11, color: t.fg, opacity: 0.75, marginTop: 3 }}>{accent}</div>
      )}
    </div>
  );
}

/** Hero tile row — convenience wrapper for stat tiles. */
export function DetailHero({ children }) {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {children}
    </div>
  );
}
