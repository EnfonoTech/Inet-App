// Excel export — produces a real .xlsx (Office Open XML) workbook via
// SheetJS. Older versions wrote a Microsoft HTML-table .xls; newer
// Excel versions warn about that ("the file format does not match the
// extension"), and Google Sheets refuses it. Real .xlsx avoids both.
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

import * as XLSX from "xlsx";

function _format(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") {
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return value;
}

// Domain acronyms that should stay uppercase in humanised labels.
const _ACRONYMS = new Set([
  "po", "poid", "duid", "im", "tl", "qc", "ciag", "pic", "pcc", "ms1", "ms2",
  "sar", "kpi", "id", "url", "json", "csv", "xls", "pwa", "etl",
]);

// Per-key label overrides — for keys whose humanised form would still
// look awkward. Add sparingly; most fields humanise cleanly.
const _LABEL_OVERRIDES = {
  poid: "POID",
  po_no: "PO No",
  po_dispatch: "PO Dispatch",
  im_full_name: "IM Name",
  site_code: "DUID",
  site_name: "Site Name",
  activity_type: "Activity Type",
  qty: "Qty",
  line_amount: "Line Amount",
  target_month: "Target Month",
  dispatch_status: "Status",
  manager_remark: "IM Note",
  team_lead_remark: "TL Remark",
  general_remark: "General Remark",
  qc_required: "QC Required",
  ciag_required: "CIAG Required",
  visit_number: "Visit #",
  rollout_plan: "Rollout Plan",
  plan_status: "Plan Status",
  execution_status: "Execution Status",
  achieved_amount: "Achieved (SAR)",
  target_amount: "Target (SAR)",
  achieved_qty: "Achieved Qty",
  planned_qty: "Planned Qty",
  remaining_qty: "Remaining Qty",
  planned_qty_total: "Planned Total",
};

function _humanise(key) {
  if (!key) return "";
  if (_LABEL_OVERRIDES[key]) return _LABEL_OVERRIDES[key];
  return String(key)
    .replace(/_/g, " ")
    .trim()
    .split(/\s+/)
    .map((w) => {
      const lower = w.toLowerCase();
      if (_ACRONYMS.has(lower)) return lower.toUpperCase();
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
}

function _autoColumns(rows) {
  const first = rows.find((r) => r && typeof r === "object");
  if (!first) return [];
  return Object.keys(first)
    .filter((k) => !k.startsWith("__"))
    .map((k) => ({ key: k, label: _humanise(k) }));
}

export function exportToExcel({ filename = "export", columns, rows, sheetName = "Sheet1" }) {
  if (!Array.isArray(rows) || rows.length === 0) return false;
  const cols = (columns && columns.length ? columns : _autoColumns(rows));
  const headerLabels = cols.map((c) => c.label || _humanise(c.key));

  // Build an array-of-arrays (AOA) — SheetJS turns this into a proper
  // worksheet with native cell types (numbers stay numeric, dates stay
  // dates) so Excel sorting & filtering Just Works.
  const aoa = [headerLabels];
  for (const r of rows) {
    aoa.push(cols.map((c) => {
      const raw = typeof c.value === "function" ? c.value(r) : r?.[c.key];
      return _format(raw);
    }));
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Auto-size columns to the longest cell in each column (capped at
  // 60 chars so a long description doesn't blow the sheet up).
  const colWidths = cols.map((_, ci) => {
    let max = String(headerLabels[ci] || "").length;
    for (let ri = 1; ri < aoa.length; ri += 1) {
      const v = aoa[ri][ci];
      const len = v == null ? 0 : String(v).length;
      if (len > max) max = len;
    }
    return { wch: Math.min(Math.max(max + 2, 8), 60) };
  });
  ws["!cols"] = colWidths;
  // Freeze the header row so it stays visible while scrolling.
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, (sheetName || "Sheet1").slice(0, 31));

  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `${filename || "export"}-${stamp}.xlsx`, {
    bookType: "xlsx",
    compression: true,
  });
  return true;
}
