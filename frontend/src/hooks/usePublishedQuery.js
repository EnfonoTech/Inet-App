import { useCallback, useRef, useState } from "react";

/**
 * Publish the query a page just built so a sibling component can react to it.
 *
 * List pages assemble their filter/portal object INSIDE the fetch effect and
 * stash it in a ref (`queryArgsRef`) for the column-filter option handler to
 * read. A ref is invisible to React, so a header summary can't follow it —
 * and lifting every page's filter assembly into a memo would mean reworking
 * ~20 fetch effects, each with its own skip-refetch bookkeeping.
 *
 * So: publish alongside the ref write. The value only ever re-renders when it
 * actually changed (compared by shape, not identity — these objects are rebuilt
 * from scratch on every effect run), which keeps the extra render to one per
 * real filter change rather than one per fetch.
 *
 *   const [summaryQuery, publishSummaryQuery] = usePublishedQuery();
 *   ...
 *   queryArgsRef.current = portal;
 *   publishSummaryQuery(portal);
 *   ...
 *   <PageSummary source="pic_rows" filters={summaryQuery} />
 *
 * Starts as `undefined`, which PageSummary reads as "not ready yet" and skips
 * — so the strip never fires a request against a query the page hasn't built.
 */
export function usePublishedQuery() {
  const [value, setValue] = useState(undefined);
  const keyRef = useRef(null);

  const publish = useCallback((next) => {
    const key = JSON.stringify(next ?? null);
    if (key === keyRef.current) return;
    keyRef.current = key;
    setValue(next);
  }, []);

  return [value, publish];
}
