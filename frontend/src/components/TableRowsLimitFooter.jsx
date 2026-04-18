/**
 * Segmented control: how many rows to load from the server (smaller = faster).
 * "All" maps to TABLE_ROW_LIMIT_ALL (0): server returns every matching row.
 */
import { useTableRowLimit, TABLE_ROW_LIMIT_ALL, TABLE_ROW_LIMIT_PRESETS } from "../context/TableRowLimitContext";

export { TABLE_ROW_LIMIT_ALL };

function SegmentedRowLimit({ value, onChange }) {
  const border = "var(--border, #e2e8f0)";
  const muted = "var(--bg-muted, #f1f5f9)";
  return (
    <div
      role="radiogroup"
      aria-label="Rows to load"
      style={{
        display: "inline-flex",
        alignItems: "stretch",
        border: `1px solid ${border}`,
        borderRadius: 999,
        overflow: "hidden",
        background: muted,
        flexShrink: 0,
      }}
    >
      {TABLE_ROW_LIMIT_PRESETS.map((n, idx) => {
        const selected = value === n;
        const label = n === TABLE_ROW_LIMIT_ALL ? "All" : String(n);
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(n)}
            style={{
              border: "none",
              borderLeft: idx === 0 ? "none" : `1px solid ${border}`,
              padding: "6px 14px",
              fontSize: "0.8rem",
              fontWeight: 600,
              fontFamily: "inherit",
              cursor: "pointer",
              color: "var(--text, #0f172a)",
              background: selected ? "var(--bg-white, #fff)" : "transparent",
              whiteSpace: "nowrap",
              lineHeight: 1.2,
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * When used inside TableRowLimitProvider without props, reads/writes global row limit.
 * Optional value/onChange override for rare local use.
 */
export default function TableRowsLimitFooter({
  value: valueProp,
  onChange: onChangeProp,
  loadedCount = null,
  filteredCount = null,
  filterActive = false,
  /** "tableCard" = docked under main data table (compact). */
  placement = "default",
}) {
  const ctx = useTableRowLimit();
  const value = valueProp !== undefined && valueProp !== null ? valueProp : ctx.rowLimit;
  const onChange = onChangeProp || ctx.setRowLimit;
  const inCard = placement === "tableCard";

  return (
    <div
      className={inCard ? "table-rowlimit-footer" : undefined}
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        padding: inCard ? "10px 14px" : "12px 16px",
        borderTop: "1px solid var(--border, #e2e8f0)",
        background: inCard ? "var(--bg-white, #fff)" : "var(--bg-muted, #f8fafc)",
        fontSize: "0.78rem",
        color: "var(--text-muted, #64748b)",
        borderRadius: inCard ? "0 0 var(--radius, 10px) var(--radius, 10px)" : 0,
      }}
    >
      <span style={{ minWidth: 0 }}>
        {loadedCount != null && (
          <>
            Loaded <strong style={{ color: "var(--text, #0f172a)" }}>{loadedCount}</strong>
            {" "}
            row
            {loadedCount !== 1 ? "s" : ""}
          </>
        )}
        {filterActive && filteredCount != null && loadedCount != null && (
          <>
            {" "}
            · matches filter: <strong style={{ color: "var(--text, #0f172a)" }}>{filteredCount}</strong>
          </>
        )}
        {!inCard && loadedCount == null && (
          <span style={{ color: "var(--text-muted, #94a3b8)" }}>
            Applies to main data tables in this portal
          </span>
        )}
        {inCard && loadedCount == null && (
          <span style={{ color: "var(--text-muted, #94a3b8)" }}>Server fetch size</span>
        )}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: "auto", flexWrap: "wrap" }}>
        <span style={{ whiteSpace: "nowrap", fontWeight: 600 }}>Rows to load</span>
        <SegmentedRowLimit value={value} onChange={onChange} />
      </div>
    </div>
  );
}
