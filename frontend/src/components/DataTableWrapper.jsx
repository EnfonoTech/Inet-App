/**
 * Table card: outer box scrolls horizontally (wide columns), inner box scrolls
 * vertically. Sticky thead th uses the inner scrollport — reliable in Chromium
 * (single element with overflow-x + overflow-y auto often breaks sticky).
 */
export default function DataTableWrapper({ children, className = "", style }) {
  const outerClass = ["data-table-wrapper", className].filter(Boolean).join(" ");
  return (
    <div className={outerClass} style={style}>
      <div className="data-table-scroll">{children}</div>
    </div>
  );
}
