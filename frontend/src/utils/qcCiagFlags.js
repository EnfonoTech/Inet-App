// Plan-level QC/CIAG _required flags come from the backend as Frappe
// Check fields. Depending on the transport (raw SQL select vs.
// frappe.db.get_value vs. JSON serializer quirks), the value can arrive
// as 0 (number), false (bool), or "0" (string). Normalize here so every
// caller can ask the same question.
//
// IMPORTANT: null/undefined is treated as REQUIRED. Legacy plans created
// before the column existed will not have an explicit flag, and the safe
// default is to keep the QC/CIAG step in place.
export function isNotRequired(v) {
  if (v === 0 || v === false || v === "0") return true;
  if (typeof v === "string" && v.toLowerCase() === "false") return true;
  return false;
}
