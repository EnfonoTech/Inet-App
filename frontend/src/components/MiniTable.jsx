/**
 * MiniTable — compact table for dashboard panels and report sections.
 *
 * Props:
 *   columns    — array of { label, key, align?, colorFn?, render? }
 *                 align: "right" | "left" (default "left")
 *                 colorFn: (value, row) => className string or ""
 *                 render: (value, row) => ReactNode
 *   rows       — array of row objects
 *   emptyText  — string shown when rows is empty
 *   resizable  — opt-in: when true, wraps the table in .data-table-wrapper
 *                 and adds the "data-table" class so the global DataTablePro
 *                 enhancer picks it up (column resize, Manage Table, Filters,
 *                 Reset) — the same capability every other list page in the
 *                 app already has. Off by default so existing dashboard
 *                 widgets (e.g. CommandDashboard) stay exactly as compact as
 *                 they are today.
 *   tableKey   — REQUIRED when resizable is true and more than one MiniTable
 *                 can exist on the same page (e.g. one per report tab).
 *                 Passed straight through as data-table-key — without a
 *                 distinct key per instance, DataTablePro falls back to a
 *                 shared positional key and mutually-exclusive tables (only
 *                 one mounted at a time, like per-tab report panels) end up
 *                 sharing saved column widths that don't belong to each
 *                 other. See im/IMReports.jsx for the reference usage.
 */

const fmt = new Intl.NumberFormat("en-US");

function cell(val) {
  if (val === null || val === undefined) return "—";
  if (typeof val === "number") {
    if (val < 0) return `(${fmt.format(Math.abs(val))})`;
    return fmt.format(val);
  }
  return String(val);
}

export default function MiniTable({ columns = [], rows = [], emptyText = "No data", resizable = false, tableKey }) {
  if (!rows.length) {
    return (
      <div style={{ padding: "16px 0", textAlign: "center", color: "var(--text-muted)", fontSize: "0.78rem" }}>
        {emptyText}
      </div>
    );
  }

  const table = (
    <table className={resizable ? "data-table mini-table" : "mini-table"} data-table-key={resizable ? tableKey : undefined}>
      <thead>
        <tr>
          {columns.map((col) => (
            <th key={col.key} style={{ textAlign: col.align || "left" }}>
              {col.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {columns.map((col) => {
              const val = row[col.key];
              const color = col.colorFn ? col.colorFn(val, row) : "";
              return (
                <td
                  key={col.key}
                  className={`mono ${color}`.trim()}
                  style={{ textAlign: col.align || "left" }}
                >
                  {col.render ? col.render(val, row) : cell(val)}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );

  if (!resizable) return table;
  return (
    <div className="data-table-wrapper">
      <div className="data-table-scroll">{table}</div>
    </div>
  );
}
