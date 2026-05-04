import { exportToExcel } from "../utils/exportExcel";

// Icon-only Excel export button. Designed to sit in the page-actions
// row next to "Refresh". Renders a green spreadsheet glyph with a
// tooltip; disables itself when no rows are available.
//
// Props:
//   rows       — array (preferred) OR
//   getRows    — fn returning array (for deferred / lazy gathering)
//   columns    — optional [{key,label,value?}] (auto if omitted)
//   filename   — base name for the .xls file
//   disabled   — manual override
//   title      — tooltip override (default: "Download as Excel")
export default function ExportExcelButton({
  rows,
  getRows,
  columns,
  filename,
  disabled,
  title,
}) {
  const empty = !getRows && (!rows || rows.length === 0);
  const isDisabled = disabled || empty;
  const handleClick = () => {
    if (isDisabled) return;
    const data = typeof getRows === "function" ? getRows() : rows;
    if (!data || !data.length) return;
    exportToExcel({ filename, columns, rows: data });
  };
  const tooltip = title || (empty ? "No rows to export" : "Download as Excel (.xls)");
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isDisabled}
      aria-label={tooltip}
      title={tooltip}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 36, height: 36,
        padding: 0,
        borderRadius: 8,
        border: "1px solid #d1fae5",
        background: isDisabled ? "#f1f5f9" : "linear-gradient(135deg,#10b981 0%,#059669 100%)",
        color: isDisabled ? "#94a3b8" : "#fff",
        cursor: isDisabled ? "not-allowed" : "pointer",
        boxShadow: isDisabled ? "none" : "0 1px 3px rgba(16,185,129,0.25)",
        transition: "transform 100ms, box-shadow 100ms",
      }}
      onMouseDown={(e) => { if (!isDisabled) e.currentTarget.style.transform = "scale(0.96)"; }}
      onMouseUp={(e) => { e.currentTarget.style.transform = ""; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = ""; }}
    >
      {/* Spreadsheet + down-arrow glyph (inline SVG, no asset dep). */}
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"
              stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/>
        <path d="M14 2v6h6" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/>
        <path d="M9 13l3 3 3-3M12 16v-5" stroke="currentColor" strokeWidth="1.6"
              strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </button>
  );
}
