import { useEffect, useMemo, useRef, useState } from "react";

/** Matches FILTER_BLANK in the Python filter helpers — keep the two in step. */
export const BLANK_ID = "__NONE__";

/**
 * Drop-in replacement for `<select>` filters with a type-to-search panel.
 *
 * Single-select mode (default): `value` is a string id; `onChange(id)` gets
 * the new id or "" for clear.
 *
 * `allowBlank` adds a "(Blanks)" row that selects rows where the field is
 * empty — pass `true`, or a string to relabel it ("No IM", "Not set"). It
 * sends the id "__NONE__", which the backend filter helpers understand
 * (see FILTER_BLANK / _sql_in_or_eq); only turn it on where the filter
 * actually reaches one of those, or it will select nothing.
 *
 * Multi-select mode (`multi`): `value` is a string[] of ids; `onChange(ids)`
 * gets a new string[]. Pasting multiple newline/tab/comma/semicolon-separated
 * values (e.g. an Excel column or row) directly selects exactly those exact
 * matches, replacing any prior selection. A plain space does NOT split
 * values — it's kept as part of one value, since many real values (DUID
 * names, etc.) contain internal spaces. Typing (not pasting) several
 * comma/semicolon-separated values and pressing Enter uses the "Add N
 * matches" button instead, which is substring-matched and additive.
 */
export default function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "All",
  allLabel,
  style,
  triggerStyle,
  panelStyle,
  minWidth,
  disabled = false,
  multi = false,
  onSearch,
  onCreateNew,
  wrap = false,
  allowBlank = false,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(-1);
  // Set right after a multi-value paste to the exact rows that matched (see
  // handlePaste). While set, the panel shows ONLY those rows instead of the
  // normal substring-matched list — otherwise a pasted value that happens to
  // be a prefix of a different, unrelated option (e.g. pasting
  // "ZJB192-Incremental-Mod-L700" when "ZJB192-Incremental-Mod-L700-Dis"
  // also exists) would show that unrelated row alongside the real matches,
  // even though it was correctly left unchecked — confusing, since the
  // panel would show one more row than values you actually pasted. Typing
  // anything afterwards clears it and resumes normal search.
  const [pasteFocusIds, setPasteFocusIds] = useState(null);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const normalized = useMemo(() => {
    if (!Array.isArray(options)) return [];
    const list = options
      .map((o) => (typeof o === "string" ? { id: o, label: o } : { id: String(o.id ?? o.value ?? o.name ?? ""), label: String(o.label ?? o.name ?? o.id ?? "") }))
      .filter((o) => o.id);
    // Pinned to the top rather than sorted in with the values: it is a
    // different KIND of answer, and it is the one you cannot type a search
    // for. Skipped when the caller already supplies its own blank row.
    if (allowBlank && !list.some((o) => o.id === BLANK_ID)) {
      list.unshift({
        id: BLANK_ID,
        label: typeof allowBlank === "string" ? allowBlank : "(Blanks)",
        isBlank: true,
      });
    }
    return list;
  }, [options, allowBlank]);

  const selectedIds = useMemo(() => {
    if (multi) return Array.isArray(value) ? value.filter(Boolean) : [];
    return value ? [value] : [];
  }, [value, multi]);

  const tokens = useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    // Split only on separators that mean "these are different pasted values"
    // (Excel column paste = newlines, row paste = tabs, or an explicit
    // comma/semicolon list) — NOT a plain space, which is very often part
    // of a single value's own name (e.g. a DUID like "...M24_rack Fuse
    // Upgrade"). Splitting on space there wrongly treats "Fuse" and
    // "Upgrade" as separate search terms and pulls in unrelated matches.
    return q
      .split(/[\n\r\t,;|]+/)
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
  }, [query]);

  // Debounced server-side search callback
  useEffect(() => {
    if (typeof onSearch !== "function") return;
    const timer = setTimeout(() => onSearch(query), 250);
    return () => clearTimeout(timer);
  }, [query, onSearch]);

  const filtered = useMemo(() => {
    if (pasteFocusIds !== null) {
      const idSet = new Set(pasteFocusIds);
      return normalized.filter((o) => idSet.has(o.id));
    }
    if (tokens.length === 0) return normalized;
    return normalized.filter((o) => {
      const hay = `${o.label} ${o.id}`.toLowerCase();
      return tokens.some((t) => hay.includes(t));
    });
  }, [normalized, tokens, pasteFocusIds]);

  // Cap rendered rows. With 5,000+ DUIDs the dropdown used to commit one DOM
  // node per option, freezing scroll on lower-end machines. We render the
  // first MAX_VISIBLE matches and tell the user to narrow their search if
  // there's more. The full ``filtered`` list is still used by
  // ``selectAllTokenMatches`` so a "select all that match these tokens"
  // bulk action stays unaffected.
  const MAX_VISIBLE = 200;
  const visible = useMemo(
    () => (filtered.length > MAX_VISIBLE ? filtered.slice(0, MAX_VISIBLE) : filtered),
    [filtered],
  );
  const hiddenCount = filtered.length - visible.length;

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
      setPasteFocusIds(null);
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

  // A single-line <input> can't reliably keep real newlines from a paste —
  // browsers commonly collapse them into spaces (or strip them) before our
  // onChange ever sees the value, which is why splitting on space seemed to
  // "support Excel paste" before: it was really splitting on what used to be
  // a newline. That made a single value with a genuine internal space (e.g.
  // a DUID like "...M24_rack Fuse Upgrade") get wrongly split into pieces.
  // Reading the clipboard directly in onPaste sidesteps the problem: we see
  // the real newlines/tabs from an Excel column/row copy before the browser
  // can mangle them, so a genuine multi-value paste and a single value that
  // merely contains spaces are never confused with each other again.
  function handlePaste(e) {
    const raw = e.clipboardData?.getData("text") ?? "";
    if (!/[\r\n\t]/.test(raw)) return; // no real separators — treat as one value, let default paste happen
    const pasted = raw
      .split(/[\r\n\t,;]+/)
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    if (pasted.length === 0) return;
    e.preventDefault();
    if (multi) {
      // Exact match only — a pasted value should select exactly the row it
      // names, never an unrelated row that merely contains it as a
      // substring (e.g. pasting "SITE-1" must not also select "SITE-10").
      const matchedIds = [];
      for (const t of pasted) {
        const hit = normalized.find((o) => o.id.toLowerCase() === t || o.label.toLowerCase() === t);
        if (hit) matchedIds.push(hit.id);
      }
      // Paste sets the selection to exactly what you pasted, rather than
      // adding to whatever was already selected — the count always matches
      // what you just pasted. (The "Add N matches" button stays additive;
      // that's a separate, deliberate action.) If nothing matched, leave
      // any existing selection alone instead of wiping it out.
      if (matchedIds.length) onChange?.(Array.from(new Set(matchedIds)));
      // Show ONLY the exact matches in the panel (see pasteFocusIds above) —
      // not a substring-matched superset that could include an unrelated
      // row and make it look like more came back than you pasted.
      setQuery(pasted.join(", "));
      setPasteFocusIds(matchedIds);
    } else {
      // Single-select can't bulk-pick, but still benefit from a clean
      // (trimmed, newline-free) value instead of whatever the raw paste held.
      setQuery(pasted[0] || "");
    }
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
      setActiveIdx((i) => Math.min((i < 0 ? -1 : i) + 1, visible.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (multi) {
        if (tokens.length > 1) selectAllTokenMatches();
        else if (activeIdx >= 0 && visible[activeIdx]) toggleMulti(visible[activeIdx].id);
        else if (visible.length === 1) toggleMulti(visible[0].id);
      } else {
        if (activeIdx >= 0 && visible[activeIdx]) commitSingle(visible[activeIdx].id);
        else if (visible.length === 1) commitSingle(visible[0].id);
      }
    }
  }

  const clearLabel = allLabel || placeholder;
  const hasSelection = selectedIds.length > 0;

  return (
    <div ref={wrapRef} className="searchable-select-wrap" style={{ position: "relative", display: "inline-block", ...style }}>
      <div
        className="searchable-select-trigger"
        role="button"
        tabIndex={disabled ? -1 : 0}
        onClick={() => !disabled && setOpen((v) => !v)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); !disabled && setOpen((v) => !v); } }}
        style={{
          width: "100%",
          padding: "0",
          borderRadius: "var(--radius-sm, 6px)",
          border: `1px solid ${open ? "var(--blue, #3b82f6)" : "var(--border, #e2e8f0)"}`,
          boxShadow: open ? "0 0 0 3px rgba(59,130,246,0.12)" : "none",
          fontSize: 13,
          background: disabled ? "var(--bg, #f8fafc)" : "var(--bg-white, #fff)",
          cursor: disabled ? "not-allowed" : "pointer",
          display: "inline-flex",
          alignItems: "center",
          minWidth: minWidth != null ? minWidth : 0,
          transition: "border-color 0.15s, box-shadow 0.15s",
          boxSizing: "border-box",
          userSelect: "none",
          ...triggerStyle,
        }}
      >
        <span style={{
          flex: 1,
          padding: "9px 8px 9px 12px",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: hasSelection ? "var(--text, #1e293b)" : "var(--text-muted, #94a3b8)",
          fontWeight: hasSelection ? 500 : 400,
          lineHeight: "1.4",
        }}>
          {hasSelection ? currentLabel : placeholder}
        </span>
        {hasSelection && !disabled && (
          <span
            role="button"
            tabIndex={0}
            title="Clear"
            onClick={(e) => { e.stopPropagation(); clearAll(); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); clearAll(); } }}
            style={{
              flexShrink: 0,
              padding: "0 6px",
              color: "var(--text-muted, #94a3b8)",
              fontSize: "0.72rem",
              lineHeight: 1,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
            }}
          >
            ✕
          </span>
        )}
        <span style={{
          flexShrink: 0,
          padding: "0 10px 0 4px",
          color: "var(--text-muted, #94a3b8)",
          fontSize: "0.65rem",
          pointerEvents: "none",
          display: "flex",
          alignItems: "center",
        }}>
          {open ? "▲" : "▾"}
        </span>
      </div>

      {open && (
        <div style={{
          position: "absolute",
          top: "calc(100% + 4px)",
          left: 0,
          right: 0,
          zIndex: 50,
          background: "white",
          border: "1px solid #e2e8f0",
          borderRadius: 8,
          boxShadow: "0 10px 25px rgba(15,23,42,0.15)",
          minWidth: Math.max(minWidth != null ? minWidth : 0, 180),
          overflow: "hidden",
          ...panelStyle,
        }}>
          <div style={{ padding: 8, borderBottom: "1px solid #f1f5f9" }}>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setActiveIdx(0); setPasteFocusIds(null); }}
              onKeyDown={onKeyDownInput}
              onPaste={handlePaste}
              placeholder={multi ? "Search (paste comma/newline separated, press Enter)…" : "Search…"}
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
              <>
                <div style={{ padding: "12px", fontSize: "0.82rem", color: "#94a3b8", textAlign: "center" }}>
                  No matches
                </div>
                {onCreateNew && query.trim() && (
                  <div
                    onClick={() => { onCreateNew(query.trim()); setOpen(false); }}
                    style={{
                      padding: "8px 12px",
                      fontSize: "0.84rem",
                      cursor: "pointer",
                      borderTop: "1px solid #f1f5f9",
                      color: "#2563eb",
                      fontWeight: 600,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <span style={{ fontSize: "1rem", lineHeight: 1 }}>+</span>
                    Create &ldquo;{query.trim()}&rdquo;
                  </div>
                )}
              </>
            ) : (
              <>
                {visible.map((o, idx) => {
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
                        whiteSpace: wrap ? "normal" : "nowrap",
                        overflow: wrap ? "visible" : "hidden",
                        textOverflow: wrap ? "unset" : "ellipsis",
                        // "(Blanks)" is a different kind of answer from the
                        // values beneath it — italic and a hairline rule say
                        // so without needing a section header.
                        fontStyle: o.isBlank ? "italic" : undefined,
                        borderBottom: o.isBlank ? "1px solid var(--border, #e2e8f0)" : undefined,
                        display: "flex",
                        alignItems: wrap ? "flex-start" : "center",
                        gap: 8,
                      }}
                      title={wrap ? undefined : o.label}
                    >
                      {multi && (
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleMulti(o.id)}
                          onClick={(e) => e.stopPropagation()}
                          style={{ margin: 0, cursor: "pointer", flexShrink: 0 }}
                        />
                      )}
                      <span style={{ overflow: wrap ? "visible" : "hidden", textOverflow: wrap ? "unset" : "ellipsis" }}>{o.label}</span>
                    </div>
                  );
                })}
                {hiddenCount > 0 && (
                  <div style={{
                    padding: "8px 12px",
                    fontSize: "0.74rem",
                    color: "#64748b",
                    background: "#f8fafc",
                    borderTop: "1px solid #f1f5f9",
                    textAlign: "center",
                  }}>
                    {hiddenCount.toLocaleString()} more not shown — type to narrow
                    {multi && tokens.length > 1 && " (use the “Add matches” button to bulk-select)"}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
