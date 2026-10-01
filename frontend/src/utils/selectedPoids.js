import { copyToClipboard } from "./copyToClipboard";

// Copies the human POIDs of the selected rows, one per line — no header, no
// quotes, no trailing newline (Excel would paste a blank last row). The Set
// holds doc names (PO Dispatch / Rollout Plan / Work Done …), not POIDs, so the
// page passes `keyOf` to map a row to whatever its Set stores.
//
// Several rows can share one POID (visits, Work Done lines), so POIDs are
// de-duplicated in row order; the message says so when the numbers differ, so
// a user expecting a different count notices.
//
// Returns { ok, message } — the page shows it with its own notice banner.
export async function copySelectedPoids(rows, selected, keyOf) {
  const seen = new Set();
  let matched = 0;
  for (const r of rows) {
    if (!selected.has(keyOf(r))) continue;
    matched += 1;
    const poid = String(r.poid ?? "").trim();
    if (poid) seen.add(poid);
  }
  const poids = [...seen];
  if (!poids.length) return { ok: false, message: "No POIDs found on the selected rows." };

  const ok = await copyToClipboard(poids.join("\n"));
  if (!ok) {
    return { ok: false, message: "Couldn't copy to the clipboard — your browser blocked it. Try again, or use HTTPS." };
  }
  const n = poids.length;
  let message = `Copied ${n} POID${n !== 1 ? "s" : ""}`;
  if (n !== selected.size) message += ` (${selected.size} row${selected.size !== 1 ? "s" : ""} selected)`;
  if (matched < selected.size) message += ` — ${selected.size - matched} selected row${selected.size - matched !== 1 ? "s" : ""} no longer loaded`;
  return { ok: true, message: `${message}.` };
}
