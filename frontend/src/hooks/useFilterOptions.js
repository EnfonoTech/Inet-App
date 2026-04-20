import { useEffect, useState } from "react";
import { pmApi } from "../services/api";

/**
 * Fetch distinct values for one or more fields on a doctype so filter
 * dropdowns show ALL possible values, not just those present in the current
 * row-limited slice. Results come from the shared API cache (5-min TTL).
 *
 * Usage:
 *   const { options } = useFilterOptions("PO Intake Line", ["project_code", "site_code"]);
 *   options.project_code // => sorted list of all distinct project codes
 */
export default function useFilterOptions(doctype, fields) {
  const [options, setOptions] = useState({});
  const key = `${doctype}::${(fields || []).join(",")}`;

  useEffect(() => {
    let cancelled = false;
    if (!doctype || !Array.isArray(fields) || fields.length === 0) return;
    pmApi.getDistinctFieldValues(doctype, fields)
      .then((data) => {
        if (cancelled) return;
        const out = {};
        for (const f of fields) {
          const vals = Array.isArray(data?.[f]) ? data[f] : [];
          out[f] = [...vals].sort((a, b) => String(a).localeCompare(String(b), undefined, { sensitivity: "base" }));
        }
        setOptions(out);
      })
      .catch(() => { if (!cancelled) setOptions({}); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { options };
}
