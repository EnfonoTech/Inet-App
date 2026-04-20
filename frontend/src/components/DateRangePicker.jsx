import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Date-range picker with preset shortcuts (Today, This Week, This Month,
 * This Quarter, YTD, previous periods, etc.) plus free-form Custom date
 * inputs. Emits `{ from, to }` as ISO strings (YYYY-MM-DD).
 *
 * Props:
 *   value       — { from, to }
 *   onChange    — ({ from, to, preset }) => void
 *   presets     — optional array of preset keys to show (default = all)
 *   style       — outer wrapper style
 */
const ISO = (d) => {
  if (!d) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

function startOfWeek(d) {
  // Week starts Monday (ISO). Change to 0 to start Sunday if ever needed.
  const r = new Date(d);
  const day = (r.getDay() + 6) % 7; // 0 = Monday
  r.setDate(r.getDate() - day);
  r.setHours(0, 0, 0, 0);
  return r;
}

function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
function startOfQuarter(d) { return new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1); }
function endOfQuarter(d) { return new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3 + 3, 0); }
function startOfYear(d) { return new Date(d.getFullYear(), 0, 1); }
function endOfYear(d) { return new Date(d.getFullYear(), 11, 31); }

export const DATE_PRESETS = {
  today:             { label: "Today",             range: (now) => ({ from: now, to: now }) },
  yesterday:         { label: "Yesterday",         range: (now) => { const y = addDays(now, -1); return { from: y, to: y }; } },
  this_week:         { label: "This Week",         range: (now) => ({ from: startOfWeek(now), to: addDays(startOfWeek(now), 6) }) },
  previous_week:     { label: "Previous Week",     range: (now) => { const s = addDays(startOfWeek(now), -7); return { from: s, to: addDays(s, 6) }; } },
  this_month:        { label: "This Month",        range: (now) => ({ from: startOfMonth(now), to: endOfMonth(now) }) },
  previous_month:    { label: "Previous Month",    range: (now) => { const s = startOfMonth(new Date(now.getFullYear(), now.getMonth() - 1, 1)); return { from: s, to: endOfMonth(s) }; } },
  this_quarter:      { label: "This Quarter",      range: (now) => ({ from: startOfQuarter(now), to: endOfQuarter(now) }) },
  previous_quarter:  { label: "Previous Quarter",  range: (now) => { const s = new Date(startOfQuarter(now).getFullYear(), startOfQuarter(now).getMonth() - 3, 1); return { from: s, to: endOfQuarter(s) }; } },
  ytd:               { label: "Year To Date",      range: (now) => ({ from: startOfYear(now), to: now }) },
  this_year:         { label: "This Year",         range: (now) => ({ from: startOfYear(now), to: endOfYear(now) }) },
  previous_year:     { label: "Previous Year",     range: (now) => { const s = new Date(now.getFullYear() - 1, 0, 1); return { from: s, to: endOfYear(s) }; } },
  last_7_days:       { label: "Last 7 Days",       range: (now) => ({ from: addDays(now, -6), to: now }) },
  last_30_days:      { label: "Last 30 Days",      range: (now) => ({ from: addDays(now, -29), to: now }) },
  last_90_days:      { label: "Last 90 Days",      range: (now) => ({ from: addDays(now, -89), to: now }) },
};

const DEFAULT_ORDER = [
  "today", "yesterday",
  "this_week", "previous_week",
  "this_month", "previous_month",
  "this_quarter", "previous_quarter",
  "ytd", "this_year", "previous_year",
  "last_7_days", "last_30_days", "last_90_days",
];

/** Try to match the current { from, to } pair against a preset name. */
function detectPreset(from, to, now = new Date()) {
  if (!from || !to) return "custom";
  for (const [key, def] of Object.entries(DATE_PRESETS)) {
    const r = def.range(now);
    if (ISO(r.from) === from && ISO(r.to) === to) return key;
  }
  return "custom";
}

export default function DateRangePicker({ value, onChange, presets, style, compact = false }) {
  const from = value?.from || "";
  const to = value?.to || "";
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const order = useMemo(() => {
    if (Array.isArray(presets) && presets.length) return presets;
    return DEFAULT_ORDER;
  }, [presets]);
  const currentPreset = useMemo(() => detectPreset(from, to), [from, to]);
  const currentLabel = currentPreset === "custom"
    ? (from || to ? `Custom: ${from || "…"} → ${to || "…"}` : "Custom")
    : DATE_PRESETS[currentPreset]?.label || "Custom";

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    const onEsc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  function applyPreset(key) {
    if (key === "custom") { setOpen(false); return; }
    const def = DATE_PRESETS[key];
    if (!def) return;
    const r = def.range(new Date());
    onChange?.({ from: ISO(r.from), to: ISO(r.to), preset: key });
    setOpen(false);
  }

  function handleFromChange(v) { onChange?.({ from: v, to, preset: "custom" }); }
  function handleToChange(v) { onChange?.({ from, to: v, preset: "custom" }); }

  return (
    <div ref={wrapRef} style={{ position: "relative", display: "inline-flex", gap: 6, alignItems: "center", ...style }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          padding: "5px 10px",
          border: "1px solid #e2e8f0",
          borderRadius: 6,
          background: "#fff",
          fontSize: "0.8rem",
          fontWeight: 600,
          cursor: "pointer",
          whiteSpace: "nowrap",
          color: currentPreset === "custom" ? "#64748b" : "var(--text, #1e293b)",
        }}
        title="Pick a date range preset"
      >
        <span style={{ marginRight: 6, fontSize: "0.72rem", color: "#94a3b8", fontWeight: 500 }}>Date:</span>
        {currentLabel}
        <span style={{ marginLeft: 6, fontSize: "0.7rem", color: "#94a3b8" }}>{open ? "▲" : "▾"}</span>
      </button>
      {!compact && (
        <>
          <input
            type="date"
            value={from}
            onChange={(e) => handleFromChange(e.target.value)}
            style={{ padding: "5px 8px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: "0.8rem", minHeight: 30 }}
            title="From"
          />
          <input
            type="date"
            value={to}
            onChange={(e) => handleToChange(e.target.value)}
            style={{ padding: "5px 8px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: "0.8rem", minHeight: 30 }}
            title="To"
          />
        </>
      )}

      {open && (
        <div style={{
          position: "absolute",
          top: "calc(100% + 4px)",
          left: 0,
          zIndex: 50,
          background: "white",
          border: "1px solid #e2e8f0",
          borderRadius: 8,
          boxShadow: "0 10px 25px rgba(15,23,42,0.15)",
          minWidth: 200,
          maxHeight: 320,
          overflowY: "auto",
          padding: "4px 0",
        }}>
          {order.map((key) => {
            const def = DATE_PRESETS[key];
            if (!def) return null;
            const selected = key === currentPreset;
            return (
              <div
                key={key}
                onClick={() => applyPreset(key)}
                style={{
                  padding: "7px 14px",
                  cursor: "pointer",
                  fontSize: "0.84rem",
                  background: selected ? "rgba(37,99,235,0.10)" : "transparent",
                  color: selected ? "var(--primary, #2563eb)" : "var(--text, #1e293b)",
                  fontWeight: selected ? 700 : 500,
                }}
                onMouseEnter={(e) => { if (!selected) e.currentTarget.style.background = "rgba(100,116,139,0.08)"; }}
                onMouseLeave={(e) => { if (!selected) e.currentTarget.style.background = "transparent"; }}
              >
                {def.label}
              </div>
            );
          })}
          <div
            onClick={() => applyPreset("custom")}
            style={{
              padding: "7px 14px",
              cursor: "pointer",
              fontSize: "0.84rem",
              borderTop: "1px solid #eef2f7",
              color: "#64748b",
              fontWeight: currentPreset === "custom" ? 700 : 500,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(100,116,139,0.08)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
          >
            Custom…
          </div>
        </div>
      )}
    </div>
  );
}
