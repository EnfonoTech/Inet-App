// Copies any string to the clipboard and reports whether it actually worked.
//
// navigator.clipboard only exists in a secure context (HTTPS or localhost).
// This portal is also reached over plain HTTP on a LAN IP, where it is
// undefined — so the hidden-textarea execCommand("copy") path is required, not
// a nicety. Returns true/false and never throws; callers own the UI, and must
// show a real failure on false rather than assume the copy happened.
export async function copyToClipboard(text) {
  const value = String(text ?? "");
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Permission denied / document not focused — fall through to the fallback.
    }
  }
  return execCommandCopy(value);
}

function execCommandCopy(value) {
  const prevFocus = document.activeElement;
  const ta = document.createElement("textarea");
  ta.value = value;
  ta.setAttribute("readonly", "");
  ta.setAttribute("aria-hidden", "true");
  // Off-screen rather than display:none — a hidden element can't be selected.
  // font-size 16px stops iOS Safari zooming the page in on focus.
  ta.style.cssText = "position:fixed;top:0;left:-9999px;opacity:0;font-size:16px;";
  document.body.appendChild(ta);
  let ok = false;
  try {
    ta.select();
    ta.setSelectionRange(0, value.length); // iOS ignores select() on its own
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  } finally {
    document.body.removeChild(ta);
    if (prevFocus && typeof prevFocus.focus === "function") prevFocus.focus();
  }
  return ok;
}
