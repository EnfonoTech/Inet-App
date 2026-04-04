/**
 * MiniTable — compact table for dashboard panels.
 *
 * Props:
 *   columns   — array of { label, key, align?, colorFn? }
 *                align: "right" | "left" (default "left")
 *                colorFn: (value, row) => className string or ""
 *   rows      — array of row objects
 *   emptyText — string shown when rows is empty
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

export default function MiniTable({ columns = [], rows = [], emptyText = "No data" }) {
  if (!rows.length) {
    return (
      <div style={{ padding: "16px 0", textAlign: "center", color: "var(--text-muted)", fontSize: "0.78rem" }}>
        {emptyText}
      </div>
    );
  }

  return (
    <table className="mini-table">
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
                  {cell(val)}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
