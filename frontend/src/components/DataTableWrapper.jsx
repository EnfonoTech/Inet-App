/**
 * Table card: outer box scrolls horizontally (wide columns), inner box scrolls
 * vertically. Sticky thead th uses the inner scrollport — reliable in Chromium
 * (single element with overflow-x + overflow-y auto often breaks sticky).
 *
 * Optional row-limit footer: pass loadedCount to attach TableRowsLimitFooter as
 * a DOM sibling so the CSS .data-table-wrapper + .table-rowlimit-footer rules apply.
 */
import TableRowsLimitFooter from "./TableRowsLimitFooter";

export default function DataTableWrapper({ children, className = "", style, loadedCount, filteredCount, filterActive }) {
  const outerClass = ["data-table-wrapper", className].filter(Boolean).join(" ");
  const wrapper = (
    <div className={outerClass} style={style}>
      <div className="data-table-scroll">{children}</div>
    </div>
  );
  if (loadedCount == null) return wrapper;
  return (
    <>
      {wrapper}
      <TableRowsLimitFooter
        placement="tableCard"
        loadedCount={loadedCount}
        filteredCount={filteredCount}
        filterActive={filterActive}
      />
    </>
  );
}
