import { useEffect, useRef, useState } from "react";

/**
 * Mounts a large row array into the DOM in chunks across animation frames
 * instead of one synchronous batch. React must commit every <tr>/<td> once,
 * and DataTablePro's enhancer (colKey stamping, filters, sort, resize) walks
 * the whole table again on top of that — doing both in one pass for 10k+
 * rows is what triggers the browser's "Page Unresponsive" warning on tables
 * with "All" rows loaded. The full `rows` array is still held/fetched as-is
 * (nothing is capped) — only how fast it lands in the DOM changes. Tables
 * at or under `initial` rows mount in a single frame, exactly as before.
 *
 * Deliberately NOT using startTransition here — that makes React keep the
 * previous render visible (and this hook's own in-progress chunk-growth
 * keeps running) while a new one builds in the background, which reads as
 * "switching tabs shows the old tab's rows, then snaps to the right ones a
 * moment later." Plain synchronous updates mean switching `rows` (e.g. a
 * tab/filter change) immediately cancels the old chunking loop and restarts
 * clean, no stale in-between state.
 *
 * `window.__inetTableBulkLoading` is a cooperative signal to DataTablePro
 * (components/DataTablePro.jsx): while it's set, DataTablePro skips its
 * per-mutation full-table re-scan instead of re-running on every single
 * chunk (which made progressive mounting cost O(rows²) — each chunk's scan
 * re-walking every row mounted so far). It's a plain counter so multiple
 * tables progressively mounting at once don't clear it for each other.
 *
 * SHRINKING an already-large table costs React roughly the same as growing
 * one, and slicing doesn't help with it: swapping `rows` to a smaller/
 * different array still leaves the OLD render (however many rows it had
 * grown to) as what has to be reconciled away in whatever the very next
 * commit is, regardless of how small the new slice is — measured at over
 * 30 seconds of main-thread block switching away from a ~17k-row "All"
 * table, independent of and on top of anything in DataTablePro. So this
 * hook tracks a `{ source, count }` view: while `source` is still the OLD
 * array, `count` shrinks toward a small floor a `chunk` at a time (still
 * showing old-but-shrinking content — invisible in practice since this
 * always happens under the page's own loading overlay); only once the old
 * table has been brought down to something small does `source` switch to
 * the new array, which then grows normally.
 *
 * `paused` (pass a page's own `loading` flag): stops scheduling further
 * growth/shrink steps for whatever `rows` currently is, without touching
 * anything already on screen. Without this, switching tabs while the
 * current tab's own progressive mount is still climbing toward its full
 * count keeps growing it — via requestAnimationFrame, independent of the
 * fetch for the NEW tab already in flight — for however long that fetch
 * takes, only to immediately turn around and shrink it back down once the
 * new data arrives. `loading` flips true the instant a page starts
 * fetching (before the new array exists), so pausing on it stops that
 * wasted growth right away instead of a beat later. It never blocks
 * reacting to an actual `rows` change (the render-time reset above always
 * runs) — it only pauses idling on data that's about to be replaced.
 *
 * `onMountingChange` (optional, pass a stable setter e.g. `setMounting`):
 * fires true/false in lockstep with the same bulk-loading flag DataTablePro
 * watches. A page's own `loading` (fetch in flight) turns false as soon as
 * the response arrives — on a huge "All" table, chunked mounting is still
 * running for several more seconds after that, invisibly, so the loading
 * overlay would disappear looking "done" while scrolling still reveals
 * blank not-yet-mounted rows. Fold this into the page's own loading state
 * (e.g. `loading={loading || mounting}`) to keep the overlay up for the
 * whole actual duration instead of just the fetch portion of it.
 */
function beginBulkLoad() {
  window.__inetTableBulkLoading = (window.__inetTableBulkLoading || 0) + 1;
}
function endBulkLoad() {
  window.__inetTableBulkLoading = Math.max(0, (window.__inetTableBulkLoading || 0) - 1);
}

function nextView(view, rows, initial, chunk) {
  const { source, count } = view;
  if (source !== rows) {
    const floor = Math.min(initial, source.length);
    // Only take a dedicated shrink step when there's more than one chunk's
    // worth left to shed — otherwise just switch straight to the new array
    // (matches the old, simpler behavior for small/medium tables, where
    // this extra step would just be wasted frames for no real benefit).
    if (count - floor > chunk) return { source, count: count - chunk };
    return { source: rows, count: Math.min(initial, rows.length) };
  }
  if (count < rows.length) return { source, count: Math.min(rows.length, count + chunk) };
  return view;
}

/**
 * `scrollRef` (optional, opt-in): a ref to the element that scrolls the table.
 *
 * Without it the hook keeps its original behaviour — grow every frame until
 * every row is mounted. That is right for a few hundred rows and wrong for
 * tens of thousands: "All" on PO Dispatch is 33 columns x 17k rows, about
 * 575,000 cells, and building all of them up front locks the tab for minutes.
 *
 * With it, growth stops once enough rows are mounted to fill the scrollport
 * plus a buffer, and resumes when the user scrolls near the end of what is
 * mounted. "All" still means all — every row was fetched, `rows` is complete,
 * so totals, Export and select-all are unaffected, and scrolling to the bottom
 * still reaches the last row. Only the DOM fills in as you go instead of all
 * at once.
 *
 * Deliberately opt-in per page rather than a behaviour change for the ~24
 * pages already using this hook.
 */
export function useProgressiveRows(rows, { initial = 300, chunk = 3000, paused = false, onMountingChange, scrollRef } = {}) {
  const [view, setView] = useState(() => ({ source: rows, count: Math.min(initial, rows.length) }));
  // Tracks whether WE currently hold window.__inetTableBulkLoading up, shared
  // between the render-time step below and the effect's step() loop — a ref
  // (not a plain closure var scoped to one effect run) so both sides agree
  // on the SAME in-progress-or-not state and never double-raise/double-lower.
  const bulkLoadingRef = useRef(false);
  const raise = () => {
    if (!bulkLoadingRef.current) {
      bulkLoadingRef.current = true;
      beginBulkLoad();
      onMountingChange?.(true);
    }
  };
  const lower = () => {
    if (bulkLoadingRef.current) {
      bulkLoadingRef.current = false;
      endBulkLoad();
      onMountingChange?.(false);
    }
  };

  // Adjust synchronously during render (not in an effect) the instant `rows`
  // switches to a new array reference — e.g. a tab change. Without this, the
  // very next commit would still be showing the full old table (or jump
  // straight to the full new one) before the effect below ever gets a
  // chance to start bounding it. Deliberately unconditional on `paused` —
  // reacting to real new data must never be blocked by it.
  //
  // Raising the bulk-load flag here too (not just in the effect) matters:
  // effects run strictly after their triggering commit, so without this, that
  // very first bounded step would commit to the DOM BEFORE the flag went up,
  // leaving it unprotected — DataTablePro would run one real, full-table pass
  // on it. Safe against React re-invoking this render: prevRowsRef is a ref,
  // so a retry of the same render sees it already updated and skips this
  // block entirely (same guarantee the "reset state during render" pattern
  // itself relies on).
  const prevRowsRef = useRef(rows);
  if (prevRowsRef.current !== rows) {
    prevRowsRef.current = rows;
    const next = nextView(view, rows, initial, chunk);
    if (next.source !== rows || next.count !== rows.length) raise();
    setView(next);
  }

  useEffect(() => {
    let cancelled = false;
    let handle = null;
    let parked = false;

    // Enough mounted to cover the viewport and a screenful beyond it. Growing
    // past that buys nothing the user can see yet.
    const BUFFER_PX = 1200;
    const needsMoreForScroll = () => {
      const el = scrollRef?.current;
      // No scrollport yet (first paint) — keep growing so the table fills.
      if (!el) return true;
      return el.scrollHeight - el.scrollTop - el.clientHeight < BUFFER_PX;
    };

    const step = () => {
      if (cancelled) return;
      setView((v) => {
        const next = nextView(v, rows, initial, chunk);
        const settled = next.source === rows && next.count === rows.length;
        if (!settled) {
          // Shrinking (source still the OLD array) must always run to
          // completion — parking mid-shrink would strand the old table.
          const shrinking = next.source !== rows;
          if (scrollRef && !shrinking && !needsMoreForScroll()) {
            // Enough is on screen. Stop burning frames and wait for a scroll.
            parked = true;
            lower();
            return next;
          }
          raise();
          handle = requestAnimationFrame(step);
        } else {
          // Clear the flag before this final chunk commits so the mutation
          // it produces is the one DataTablePro actually re-scans on.
          lower();
        }
        return next;
      });
    };

    const onScroll = () => {
      if (cancelled || !parked || paused) return;
      if (!needsMoreForScroll()) return;
      parked = false;
      handle = requestAnimationFrame(step);
    };
    const scrollEl = scrollRef?.current;
    if (scrollEl) scrollEl.addEventListener("scroll", onScroll, { passive: true });
    // `paused` only skips scheduling the loop below — the cleanup still
    // always registers, so a flag raised by the render-time step above is
    // guaranteed to get released (here, or by whichever later effect run
    // actually settles) rather than staying up if `paused` never flips.
    if (!paused) handle = requestAnimationFrame(step);
    return () => {
      cancelled = true;
      if (scrollEl) scrollEl.removeEventListener("scroll", onScroll);
      if (handle) cancelAnimationFrame(handle);
      // Switching `rows` again (or unmounting) mid-transition — release the
      // flag now rather than leaking it; if a new transition starts right
      // behind this, the render-time step above raises it again immediately.
      lower();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, initial, chunk, paused, scrollRef]);

  const { source, count } = view;
  return source.length > count ? source.slice(0, count) : source;
}
