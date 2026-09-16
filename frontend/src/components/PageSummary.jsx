import { useEffect, useRef, useState } from "react";
import { pmApi } from "../services/api";
// Same qty formatter the tables use, so a summary tile can never
// disagree with the column it summarises.
import { qty as fmtQty } from "../utils/numberFormat";

/**
 * Headline figures for a list page, shown in the free space of `.page-header`.
 *
 * The point is that the numbers come from server-side aggregates over the FULL
 * filtered set, so they are already right when the page opens and stay right no
 * matter what the row limit is — the user never has to load every row just to
 * find out how many there are or what they add up to.
 *
 * Deliberately sized to fit the header that already exists: the strip is as
 * tall as the title + subtitle beside it, so adding it costs zero vertical
 * space on a page whose real estate belongs to the table.
 *
 *   <PageSummary source="work_done" filters={portal} />
 *
 * `source` is the same key the page already passes for column-filter options
 * (see get_page_summary / SUMMARY_SOURCES). `filters` should be the same object
 * the row fetch sends, so the figures describe the rows on screen; pass it
 * already-debounced if the page debounces its own fetch.
 */

const fmtInt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });
// Money is shown in full, never abbreviated: a header figure that reads "22K"
// is the one number on the page nobody can reconcile against the table's own
// total, which defeats the point of putting it there.
const fmtMoney = new Intl.NumberFormat("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function displayValue(m) {
  const v = Number(m.value) || 0;
  if (m.format === "money") return fmtMoney.format(v);
  if (m.format === "qty") return fmtQty.format(v);
  if (m.format === "percent") return `${fmtQty.format(v)}%`;
  return fmtInt.format(v);
}

/** Consecutive metrics sharing a `group` render as one captioned cluster. */
function clusterMetrics(metrics) {
  const out = [];
  for (const m of metrics) {
    if (m.hide_if_zero && !Number(m.value)) continue;
    const group = m.group || "";
    const last = out[out.length - 1];
    if (group && last && last.group === group) last.items.push(m);
    else out.push({ group, items: [m] });
  }
  // A cluster that lost all but one member to hide_if_zero is just a chip.
  return out.filter((c) => c.items.length);
}

export default function PageSummary({ source, filters, extra, refreshKey }) {
  const [metrics, setMetrics] = useState([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  // Only the newest request may write state — filters change faster than the
  // aggregate comes back, and an out-of-order reply would show the wrong view's
  // numbers under the right view's title.
  const reqRef = useRef(0);

  const filterKey = JSON.stringify(filters ?? null);
  const extraKey = JSON.stringify(extra ?? null);

  useEffect(() => {
    // `undefined` means the page hasn't built its query yet (see
    // usePublishedQuery) — asking now would summarise the wrong set.
    if (!source || filters === undefined) return undefined;
    const myReq = ++reqRef.current;
    let cancelled = false;
    setLoading(true);
    pmApi.getPageSummary({ source, portal_filters: filters, extra })
      .then((res) => {
        if (cancelled || myReq !== reqRef.current) return;
        setMetrics(Array.isArray(res?.metrics) ? res.metrics : []);
        setFailed(!res?.supported);
      })
      .catch(() => {
        if (cancelled || myReq !== reqRef.current) return;
        setMetrics([]);
        setFailed(true);
      })
      .finally(() => {
        if (!cancelled && myReq === reqRef.current) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [source, filterKey, extraKey, refreshKey]);

  // A summary is a convenience — when it can't be built the page carries on
  // without it rather than showing a broken or empty strip.
  if (failed && !metrics.length) return null;

  if (loading && !metrics.length) {
    return (
      <div className="page-summary page-summary--loading" aria-hidden="true">
        {[0, 1, 2].map((i) => <div key={i} className="page-summary-chip page-summary-chip--skeleton" />)}
      </div>
    );
  }
  if (!metrics.length) return null;

  const clusters = clusterMetrics(metrics);

  return (
    <div
      className={`page-summary${loading ? " is-stale" : ""}`}
      role="group"
      aria-label="Page summary"
      aria-busy={loading || undefined}
    >
      {clusters.map((cluster) => (
        cluster.group ? (
          <div key={cluster.group} className="page-summary-cluster">
            <span className="page-summary-cluster-caption">{cluster.group}</span>
            <div className="page-summary-cluster-items">
              {cluster.items.map((m) => (
                <span
                  key={m.key}
                  className={`page-summary-part tone-${m.tone || "default"}`}
                  title={m.hint ? `${m.label}: ${displayValue(m)} — ${m.hint}` : `${m.label}: ${displayValue(m)}`}
                >
                  <b className="page-summary-part-value">{displayValue(m)}</b>
                  <span className="page-summary-part-label">{m.label}</span>
                </span>
              ))}
            </div>
          </div>
        ) : (
          cluster.items.map((m) => (
            <div
              key={m.key}
              className={`page-summary-chip tone-${m.tone || "default"}`}
              title={m.hint ? `${m.label}: ${displayValue(m)} — ${m.hint}` : `${m.label}: ${displayValue(m)}`}
            >
              <span className="page-summary-value">{displayValue(m)}</span>
              <span className="page-summary-label">{m.label}</span>
            </div>
          ))
        )
      ))}
    </div>
  );
}
