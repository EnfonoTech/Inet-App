/**
 * Table card: outer box scrolls horizontally (wide columns), inner box scrolls
 * vertically. Sticky thead th uses the inner scrollport — reliable in Chromium
 * (single element with overflow-x + overflow-y auto often breaks sticky).
 *
 * Optional row-limit footer: pass loadedCount to attach TableRowsLimitFooter as
 * a DOM sibling so the CSS .data-table-wrapper + .table-rowlimit-footer rules apply.
 *
 * Optional `loading` overlay: pass `loading={true}` while a refetch is in
 * flight (e.g. switching tabs, changing a filter) to dim the table and show a
 * spinner on top of whatever's currently rendered, instead of silently
 * leaving the previous tab/filter's rows on screen with no indication
 * they're stale until the new data swaps in.
 */
import TableRowsLimitFooter from "./TableRowsLimitFooter";

export default function DataTableWrapper({ children, className = "", style, loadedCount, filteredCount, filterActive, loading, rowLimitValue, onRowLimitChange }) {
  const outerClass = ["data-table-wrapper", className].filter(Boolean).join(" ");
  const wrapper = (
    <div className={outerClass} style={style}>
      <div className="data-table-scroll">{children}</div>
      {loading && (
        <div className="data-table-loading-overlay">
          <div className="data-table-loading-spinner" />
        </div>
      )}
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
        value={rowLimitValue}
        onChange={onRowLimitChange}
      />
    </>
  );
}
