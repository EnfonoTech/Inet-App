// Excel export — produces a Microsoft HTML-table .xls file (no npm dep).
// Excel opens this directly as a real spreadsheet (not text), preserves
// column boundaries, and stays UTF-8 friendly via the BOM marker.
//
// Usage:
//   exportToExcel({
//     filename: "rollout-plans",
//     columns: [{ key: "poid", label: "POID" }, ...],   // optional
//     rows:    [{ poid: "...", ... }, ...],
//   });
//
// When `columns` is omitted the helper falls back to the keys of the
// first row (skipping internal __ keys). Cell values run through a
// formatter that turns Date / boolean / null / objects into stable
// strings so Excel doesn't render `[object Object]` cells.

const _esc = (v) => String(v ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/\r?\n/g, "<br/>");

function _format(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") {
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return value;
}

function _autoColumns(rows) {
  const first = rows.find((r) => r && typeof r === "object");
  if (!first) return [];
  return Object.keys(first)
    .filter((k) => !k.startsWith("__"))
    .map((k) => ({ key: k, label: k }));
}

export function exportToExcel({ filename = "export", columns, rows, sheetName = "Sheet1" }) {
  if (!Array.isArray(rows) || rows.length === 0) return false;
  const cols = (columns && columns.length ? columns : _autoColumns(rows));
  const ths = cols.map((c) => `<th>${_esc(c.label || c.key)}</th>`).join("");
  const trs = rows.map((r) => {
    const tds = cols.map((c) => {
      const raw = typeof c.value === "function" ? c.value(r) : r?.[c.key];
      return `<td>${_esc(_format(raw))}</td>`;
    }).join("");
    return `<tr>${tds}</tr>`;
  }).join("");

  // The xmlns trio + ExcelWorkbook block is what makes Excel open this
  // as a workbook (with a real sheet name) rather than fall through to
  // its HTML-import wizard.
  const html = `﻿<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8"/>
<xml>
  <x:ExcelWorkbook>
    <x:ExcelWorksheets>
      <x:ExcelWorksheet>
        <x:Name>${_esc(sheetName)}</x:Name>
        <x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
      </x:ExcelWorksheet>
    </x:ExcelWorksheets>
  </x:ExcelWorkbook>
</xml>
<style>
  th { background:#1d4ed8; color:#fff; font-weight:bold; padding:6px; border:1px solid #94a3b8; }
  td { padding:4px 6px; border:1px solid #cbd5e1; vertical-align:top; }
</style>
</head>
<body><table>
<thead><tr>${ths}</tr></thead>
<tbody>${trs}</tbody>
</table></body></html>`;

  const blob = new Blob([html], { type: "application/vnd.ms-excel" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const stamp = new Date().toISOString().slice(0, 10);
  a.download = `${filename || "export"}-${stamp}.xls`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  return true;
}
