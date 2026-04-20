import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Drop-in replacement for `<select>` filters with a type-to-search panel.
 *
 * Props:
 *   value       — current selection (string id)
 *   onChange    — (id: string) => void
 *   options     — string[] | { id: string, label?: string }[]
 *   placeholder — text when no value (e.g. "All Projects")
 *   allLabel    — label for the clear/"all" option (default = placeholder)
 *   style       — outer wrapper style
 *   minWidth    — override min trigger width
 *   disabled
 */
export default function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "All",
  allLabel,
  style,
  minWidth,
  disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(-1);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Normalize options to [{id, label}]
  const normalized = useMemo(() => {
    if (!Array.isArray(options)) return [];
    return options
      .map((o) => (typeof o === "string" ? { id: o, label: o } : { id: String(o.id ?? o.value ?? o.name ?? ""), label: String(o.label ?? o.name ?? o.id ?? "") }))
      .filter((o) => o.id);
  }, [options]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return normalized;
    return normalized.filter((o) => o.label.toLowerCase().includes(q) || o.id.toLowerCase().includes(q));
  }, [normalized, query]);

  const currentLabel = useMemo(() => {
    if (!value) return "";
    const hit = normalized.find((o) => o.id === value);
    return hit ? hit.label : String(value);
  }, [value, normalized]);

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Focus search on open
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIdx(-1);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Keep highlighted option in view
  useEffect(() => {
    if (!open || activeIdx < 0 || !listRef.current) return;
    const node = listRef.current.querySelector(`[data-idx="${activeIdx}"]`);
    node?.scrollIntoView({ block: "nearest" });
  }, [activeIdx, open]);

  function commit(id) {
    onChange?.(id || "");
    setOpen(false);
  }

  function onKeyDownInput(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min((i < 0 ? -1 : i) + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIdx >= 0 && filtered[activeIdx]) commit(filtered[activeIdx].id);
      else if (filtered.length === 1) commit(filtered[0].id);
    }
  }

  const clearLabel = allLabel || placeholder;

  return (
    <div ref={wrapRef} style={{ position: "relative", display: "inline-block", ...style }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        style={{
          padding: "7px 28px 7px 12px",
          borderRadius: 7,
          border: "1px solid #e2e8f0",
          fontSize: "0.84rem",
          background: disabled ? "#f1f5f9" : "#fff",
          color: value ? "var(--text, #1e293b)" : "#94a3b8",
          cursor: disabled ? "not-allowed" : "pointer",
          minWidth: minWidth || 140,
          textAlign: "left",
          position: "relative",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          fontWeight: value ? 600 : 500,
        }}
      >
        {value ? currentLabel : placeholder}
        <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", color: "#94a3b8", fontSize: "0.7rem", pointerEvents: "none" }}>
          {open ? "▲" : "▾"}
        </span>
      </button>

      {value && !disabled && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); commit(""); }}
          title="Clear"
          style={{
            position: "absolute",
            right: 28,
            top: "50%",
            transform: "translateY(-50%)",
            border: 0,
            background: "transparent",
            color: "#94a3b8",
            fontSize: "0.8rem",
            cursor: "pointer",
            padding: 0,
            lineHeight: 1,
          }}
        >
          ✕
        </button>
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
          minWidth: Math.max(minWidth || 220, 220),
          maxWidth: 360,
          overflow: "hidden",
        }}>
          <div style={{ padding: 8, borderBottom: "1px solid #f1f5f9" }}>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setActiveIdx(0); }}
              onKeyDown={onKeyDownInput}
              placeholder="Search…"
              style={{
                width: "100%",
                padding: "7px 10px",
                border: "1px solid #e2e8f0",
                borderRadius: 6,
                fontSize: "0.84rem",
                boxSizing: "border-box",
                outline: "none",
              }}
            />
          </div>
          <div ref={listRef} style={{ maxHeight: 280, overflowY: "auto", padding: "4px 0" }}>
            <div
              onClick={() => commit("")}
              style={{
                padding: "7px 12px",
                fontSize: "0.84rem",
                cursor: "pointer",
                color: value === "" ? "var(--primary, #2563eb)" : "#64748b",
                fontWeight: value === "" ? 700 : 500,
                background: value === "" ? "rgba(37,99,235,0.06)" : "transparent",
              }}
            >
              {clearLabel}
            </div>
            {filtered.length === 0 ? (
              <div style={{ padding: "12px", fontSize: "0.82rem", color: "#94a3b8", textAlign: "center" }}>
                No matches
              </div>
            ) : (
              filtered.map((o, idx) => {
                const selected = o.id === value;
                const active = idx === activeIdx;
                return (
                  <div
                    key={o.id}
                    data-idx={idx}
                    onMouseEnter={() => setActiveIdx(idx)}
                    onClick={() => commit(o.id)}
                    style={{
                      padding: "7px 12px",
                      fontSize: "0.84rem",
                      cursor: "pointer",
                      background: selected ? "rgba(37,99,235,0.10)" : active ? "rgba(100,116,139,0.08)" : "transparent",
                      color: selected ? "var(--primary, #2563eb)" : "var(--text, #1e293b)",
                      fontWeight: selected ? 700 : 500,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                    title={o.label}
                  >
                    {o.label}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
