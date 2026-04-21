import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Drop-in replacement for `<select>` filters with a type-to-search panel.
 *
 * Single-select mode (default): `value` is a string id; `onChange(id)` gets
 * the new id or "" for clear.
 *
 * Multi-select mode (`multi`): `value` is a string[] of ids; `onChange(ids)`
 * gets a new string[]. Paste multiple whitespace/comma/newline-separated
 * tokens into the search box and press Enter — every option whose id or
 * label contains any token is auto-selected.
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
  multi = false,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(-1);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const normalized = useMemo(() => {
    if (!Array.isArray(options)) return [];
    return options
      .map((o) => (typeof o === "string" ? { id: o, label: o } : { id: String(o.id ?? o.value ?? o.name ?? ""), label: String(o.label ?? o.name ?? o.id ?? "") }))
      .filter((o) => o.id);
  }, [options]);

  const selectedIds = useMemo(() => {
    if (multi) return Array.isArray(value) ? value.filter(Boolean) : [];
    return value ? [value] : [];
  }, [value, multi]);

  const tokens = useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    return q
      .split(/[\s,;|]+/)
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
  }, [query]);

  const filtered = useMemo(() => {
    if (tokens.length === 0) return normalized;
    return normalized.filter((o) => {
      const hay = `${o.label} ${o.id}`.toLowerCase();
      return tokens.some((t) => hay.includes(t));
    });
  }, [normalized, tokens]);

  const currentLabel = useMemo(() => {
    if (!selectedIds.length) return "";
    if (!multi) {
      const hit = normalized.find((o) => o.id === selectedIds[0]);
      return hit ? hit.label : String(selectedIds[0]);
    }
    if (selectedIds.length === 1) {
      const hit = normalized.find((o) => o.id === selectedIds[0]);
      return hit ? hit.label : String(selectedIds[0]);
    }
    return `${selectedIds.length} selected`;
  }, [selectedIds, normalized, multi]);

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

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIdx(-1);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    if (!open || activeIdx < 0 || !listRef.current) return;
    const node = listRef.current.querySelector(`[data-idx="${activeIdx}"]`);
    node?.scrollIntoView({ block: "nearest" });
  }, [activeIdx, open]);

  function commitSingle(id) {
    onChange?.(id || "");
    setOpen(false);
  }

  function toggleMulti(id) {
    if (!id) return;
    const set = new Set(selectedIds);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    onChange?.(Array.from(set));
  }

  function clearAll() {
    onChange?.(multi ? [] : "");
    setOpen(false);
  }

  function selectAllTokenMatches() {
    if (!multi || tokens.length === 0) return;
    const toAdd = filtered.map((o) => o.id);
    if (toAdd.length === 0) return;
    const set = new Set([...selectedIds, ...toAdd]);
    onChange?.(Array.from(set));
    setQuery("");
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
      if (multi) {
        if (tokens.length > 1) selectAllTokenMatches();
        else if (activeIdx >= 0 && filtered[activeIdx]) toggleMulti(filtered[activeIdx].id);
        else if (filtered.length === 1) toggleMulti(filtered[0].id);
      } else {
        if (activeIdx >= 0 && filtered[activeIdx]) commitSingle(filtered[activeIdx].id);
        else if (filtered.length === 1) commitSingle(filtered[0].id);
      }
    }
  }

  const clearLabel = allLabel || placeholder;
  const hasSelection = selectedIds.length > 0;

  return (
    <div ref={wrapRef} className="searchable-select-wrap" style={{ position: "relative", display: "inline-block", ...style }}>
      <button
        type="button"
        className="searchable-select-trigger"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        style={{
          padding: "5px 22px 5px 10px",
          borderRadius: 6,
          border: "1px solid #e2e8f0",
          fontSize: "0.8rem",
          background: disabled ? "#f1f5f9" : "#fff",
          color: hasSelection ? "var(--text, #1e293b)" : "#94a3b8",
          cursor: disabled ? "not-allowed" : "pointer",
          minWidth: minWidth || 120,
          textAlign: "left",
          position: "relative",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          fontWeight: hasSelection ? 600 : 500,
        }}
      >
        {hasSelection ? currentLabel : placeholder}
        <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", color: "#94a3b8", fontSize: "0.7rem", pointerEvents: "none" }}>
          {open ? "▲" : "▾"}
        </span>
      </button>

      {hasSelection && !disabled && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); clearAll(); }}
          title="Clear"
          style={{
            position: "absolute",
            right: 22,
            top: "50%",
            transform: "translateY(-50%)",
            border: 0,
            background: "transparent",
            color: "#94a3b8",
            fontSize: "0.72rem",
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
              placeholder={multi ? "Search (paste space/comma separated, press Enter)…" : "Search…"}
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
            {multi && tokens.length > 1 && (
              <button
                type="button"
                onClick={selectAllTokenMatches}
                style={{
                  marginTop: 6,
                  width: "100%",
                  padding: "5px 10px",
                  borderRadius: 6,
                  border: "1px solid #bfdbfe",
                  background: "#eff6ff",
                  color: "#1d4ed8",
                  fontSize: "0.78rem",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Add {filtered.length} match{filtered.length !== 1 ? "es" : ""} from {tokens.length} tokens
              </button>
            )}
          </div>
          <div ref={listRef} style={{ maxHeight: 280, overflowY: "auto", padding: "4px 0" }}>
            {!multi && (
              <div
                onClick={() => commitSingle("")}
                style={{
                  padding: "7px 12px",
                  fontSize: "0.84rem",
                  cursor: "pointer",
                  color: !hasSelection ? "var(--primary, #2563eb)" : "#64748b",
                  fontWeight: !hasSelection ? 700 : 500,
                  background: !hasSelection ? "rgba(37,99,235,0.06)" : "transparent",
                }}
              >
                {clearLabel}
              </div>
            )}
            {multi && hasSelection && (
              <div
                onClick={clearAll}
                style={{
                  padding: "7px 12px",
                  fontSize: "0.78rem",
                  cursor: "pointer",
                  color: "#64748b",
                  fontWeight: 600,
                  borderBottom: "1px solid #f1f5f9",
                }}
              >
                Clear {selectedIds.length} selected
              </div>
            )}
            {filtered.length === 0 ? (
              <div style={{ padding: "12px", fontSize: "0.82rem", color: "#94a3b8", textAlign: "center" }}>
                No matches
              </div>
            ) : (
              filtered.map((o, idx) => {
                const selected = selectedIds.includes(o.id);
                const active = idx === activeIdx;
                return (
                  <div
                    key={o.id}
                    data-idx={idx}
                    onMouseEnter={() => setActiveIdx(idx)}
                    onClick={() => (multi ? toggleMulti(o.id) : commitSingle(o.id))}
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
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                    title={o.label}
                  >
                    {multi && (
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => {}}
                        onClick={(e) => e.stopPropagation()}
                        style={{ margin: 0, pointerEvents: "none" }}
                      />
                    )}
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{o.label}</span>
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
