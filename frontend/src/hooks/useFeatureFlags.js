import { useEffect, useState } from "react";
import { pmApi } from "../services/api";

/**
 * The INET Settings feature switches.
 *
 * Defaults to everything ON while loading and if the call fails: a switch that
 * nobody has set is on, and a page that cannot reach the server should look the
 * way it did before switches existed rather than hiding half its buttons. The
 * endpoints enforce the real answer, so an optimistic UI can only ever offer
 * something the server then refuses — never the reverse.
 *
 * Cached at module level: these change about once a year, and every page that
 * shows a gated action would otherwise fetch them on mount.
 */
let cached = null;
let inflight = null;

export default function useFeatureFlags() {
  const [flags, setFlags] = useState(cached || {});
  useEffect(() => {
    if (cached) return;
    let alive = true;
    inflight = inflight || pmApi.getFeatureFlags().catch(() => ({}));
    inflight.then((res) => {
      cached = res || {};
      if (alive) setFlags(cached);
    });
    return () => { alive = false; };
  }, []);
  // `!== false` not `=== true`: an unknown key is on.
  return { enabled: (key) => flags[key] !== false, flags };
}
