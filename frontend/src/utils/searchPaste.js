// A single-line <input> can't keep real newlines from a clipboard paste —
// browsers collapse a multi-line Excel-column paste into spaces before
// onChange ever sees it, making it indistinguishable from one value that
// simply has internal spaces (e.g. a DUID like "...M24_rack Fuse Upgrade").
// Reading the clipboard directly here preserves the true line/tab boundary:
// several distinct pasted values get joined back together with "; ", a hard
// separator the backend search tokenizer treats as a value boundary — while
// a single value's own internal spaces are left untouched either way.
export function handleSearchPaste(e, setValue) {
  const raw = e.clipboardData?.getData("text") ?? "";
  if (!/[\r\n\t]/.test(raw)) return; // no real separators — let default paste happen
  const parts = raw
    .split(/[\r\n\t]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) return;
  e.preventDefault();
  setValue(parts.join("; "));
}
