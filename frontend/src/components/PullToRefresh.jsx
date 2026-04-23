import { useEffect, useRef, useState } from "react";

const TRIGGER_DISTANCE = 80;      // px the user must pull down to trigger a refresh
const MAX_INDICATOR_PULL = 120;   // cap the indicator so it doesn't fly off

/**
 * Native-feeling pull-to-refresh for the PWA. Works on touch devices only;
 * desktop scroll wheels are ignored. When the user pulls the page down from
 * the top past TRIGGER_DISTANCE, we hard-refresh (unregister the service
 * worker + clear caches so a stale cached shell doesn't stick around).
 *
 * Render this ONCE near the top of the app tree (e.g. inside AppShell).
 */
export default function PullToRefresh() {
  const [pull, setPull] = useState(0);        // current pull distance in px
  const [refreshing, setRefreshing] = useState(false);
  const startYRef = useRef(0);
  const trackingRef = useRef(false);

  useEffect(() => {
    // Touch-only: avoid hijacking desktop scrolling.
    const isTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    if (!isTouch) return;

    const onTouchStart = (e) => {
      if (refreshing) return;
      if (window.scrollY > 0) return; // only when page is at the very top
      const t = e.touches[0];
      if (!t) return;
      startYRef.current = t.clientY;
      trackingRef.current = true;
    };

    const onTouchMove = (e) => {
      if (!trackingRef.current || refreshing) return;
      const t = e.touches[0];
      if (!t) return;
      const delta = t.clientY - startYRef.current;
      if (delta <= 0) {
        if (pull !== 0) setPull(0);
        return;
      }
      if (window.scrollY > 0) {
        trackingRef.current = false;
        setPull(0);
        return;
      }
      // Rubber-band effect: move slower than finger once past the trigger.
      const eased = delta < TRIGGER_DISTANCE
        ? delta
        : TRIGGER_DISTANCE + (delta - TRIGGER_DISTANCE) * 0.35;
      const next = Math.min(eased, MAX_INDICATOR_PULL);
      setPull(next);
      if (e.cancelable) e.preventDefault();
    };

    const onTouchEnd = async () => {
      if (!trackingRef.current) return;
      trackingRef.current = false;
      const shouldRefresh = pull >= TRIGGER_DISTANCE;
      if (shouldRefresh) {
        setRefreshing(true);
        setPull(TRIGGER_DISTANCE); // snap to the ready position while reloading
        try {
          if ("serviceWorker" in navigator) {
            const regs = await navigator.serviceWorker.getRegistrations();
            await Promise.all(regs.map((r) => r.unregister().catch(() => {})));
          }
          if (typeof caches !== "undefined") {
            const keys = await caches.keys();
            await Promise.all(keys.map((k) => caches.delete(k).catch(() => {})));
          }
        } catch {
          /* best-effort cleanup */
        }
        window.location.reload();
      } else {
        setPull(0);
      }
    };

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [pull, refreshing]);

  const ready = pull >= TRIGGER_DISTANCE;
  const progress = Math.min(pull / TRIGGER_DISTANCE, 1);

  if (pull <= 0 && !refreshing) return null;

  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        pointerEvents: "none",
        zIndex: 9999,
        transform: `translateY(${Math.max(0, pull - 36)}px)`,
        transition: refreshing ? "transform 0.2s ease" : "none",
      }}
    >
      <div
        style={{
          marginTop: 8,
          width: 44,
          height: 44,
          borderRadius: 999,
          background: "#ffffff",
          boxShadow: "0 6px 18px rgba(15, 23, 42, 0.18)",
          border: "1px solid #e2e8f0",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: ready || refreshing ? "#1d4ed8" : "#64748b",
          opacity: refreshing ? 1 : 0.4 + 0.6 * progress,
        }}
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            transform: refreshing
              ? "rotate(0deg)"
              : `rotate(${progress * 360}deg)`,
            transition: refreshing ? "none" : "transform 0.05s linear",
            animation: refreshing ? "ptr-spin 0.8s linear infinite" : "none",
          }}
        >
          <path d="M21 12a9 9 0 1 1-3-6.7" />
          <polyline points="21 4 21 10 15 10" />
        </svg>
      </div>
      <style>{`@keyframes ptr-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
