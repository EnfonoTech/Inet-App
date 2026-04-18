import { useEffect, useState } from "react";

/** Returns `value` after it has stayed unchanged for `delayMs` (default 300). */
export function useDebounced(value, delayMs = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}
