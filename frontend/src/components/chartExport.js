/**
 * Print / PNG export for a dashboard chart panel.
 *
 * Both work on the SVG recharts has already rendered — no extra library, and
 * nothing is re-plotted, so what you get is exactly what's on screen.
 */

/**
 * Print one panel on its own page.
 *
 * Marks the element as the print target and flags <body>; the `@media print`
 * block in new-dashboard.css hides everything else. Uses `visibility` rather
 * than `display: none` on the ancestors: collapsing the grid would leave
 * recharts' fixed-width SVG (already rendered at the on-screen size) printing
 * at the wrong scale, since it can't re-measure during the print snapshot.
 */
export function printPanel(el) {
  if (!el) return;
  const cleanup = () => {
    el.classList.remove("nd-print-target");
    document.body.classList.remove("nd-printing");
    window.removeEventListener("afterprint", cleanup);
  };
  el.classList.add("nd-print-target");
  document.body.classList.add("nd-printing");
  window.addEventListener("afterprint", cleanup);
  window.print();
  // Safari/Firefox don't always fire afterprint — belt-and-braces so the page
  // can never get stuck in the print-isolated state.
  setTimeout(cleanup, 1500);
}

/**
 * The plot surface inside a chart panel.
 *
 * `querySelector("svg.recharts-surface")` is WRONG here: recharts gives every
 * legend item its own 14x14 `<svg class="recharts-surface">` icon, and those
 * sit earlier in the DOM than the plot — so "first match" returns a legend
 * swatch and the export renders a single dash. Pick the largest surface
 * instead, which is order-, role- and version-independent.
 */
export function pickChartSvg(root) {
  const all = Array.from(root?.querySelectorAll("svg.recharts-surface") || []);
  if (!all.length) return null;
  let best = null, bestArea = -1;
  for (const el of all) {
    const vb = (el.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number);
    const r = el.getBoundingClientRect();
    // Use the on-screen box; fall back to the viewBox for a hidden chart.
    const w = r.width || (vb.length === 4 ? vb[2] : 0);
    const h = r.height || (vb.length === 4 ? vb[3] : 0);
    const area = w * h;
    if (area > bestArea) { bestArea = area; best = el; }
  }
  return best;
}

/** A numeric px value, or 0 for anything non-numeric (notably "100%"). */
function px(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) && !String(v).trim().endsWith("%") && n > 0 ? n : 0;
}

/**
 * Pixel size of a recharts surface, from whichever source actually knows.
 *
 * No single source is trustworthy on its own: the width/height attributes can
 * read "100%", a chart inside a hidden/collapsed ancestor measures 0, and the
 * viewBox is only present once recharts has measured. Take the largest
 * plausible candidate — they agree when everything is healthy, and the max
 * defends against one source having collapsed.
 */
function measureSvg(svg) {
  const cands = [];

  const vb = (svg.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number);
  if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) cands.push({ w: vb[2], h: vb[3] });

  const a = { w: px(svg.getAttribute("width")), h: px(svg.getAttribute("height")) };
  if (a.w && a.h) cands.push(a);

  const r = svg.getBoundingClientRect();
  if (r.width > 0 && r.height > 0) cands.push({ w: r.width, h: r.height });

  // recharts puts the true pixel size on the .recharts-wrapper div's style.
  // Only trust it for the plot surface itself (a direct child) — legend-icon
  // surfaces are nested deeper inside the same wrapper and would otherwise
  // borrow the whole chart's dimensions.
  const wrap = svg.parentElement?.classList?.contains("recharts-wrapper")
    ? svg.parentElement : null;
  if (wrap) {
    const wr = wrap.getBoundingClientRect();
    if (wr.width > 0 && wr.height > 0) cands.push({ w: wr.width, h: wr.height });
  }

  const w = Math.round(Math.max(0, ...cands.map((c) => c.w)));
  const h = Math.round(Math.max(0, ...cands.map((c) => c.h)));

  // Better a clear message than a silently broken image.
  if (w < 120 || h < 80) {
    throw new Error(
      `Chart is not measurable right now (got ${w}×${h}). ` +
      "Make sure it is visible on screen, then try again.",
    );
  }
  return { w, h };
}

/** Escape text going into the serialized SVG / canvas. */
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Export a chart panel's SVG as a PNG download.
 *
 * recharts renders the plot as SVG but its <Legend> as HTML, so a plain SVG
 * serialization loses the legend. We therefore draw the title and legend onto
 * the canvas ourselves from the same props the chart was given — the export
 * carries its own caption instead of a bare, unlabelled plot.
 *
 * @param {SVGElement} svg     the .recharts-surface node
 * @param {string}     title   heading drawn above the plot
 * @param {string}     subtitle small grey line under the title
 * @param {Array}      series  [{ name, color, dashed }] for the legend
 * @param {string}     filename download name (without extension)
 * @param {number}     scale   pixel ratio (2 = retina-sharp)
 */
export async function exportChartPng({
  svg, title = "Chart", subtitle = "", series = [], filename = "chart", scale = 2,
}) {
  if (!svg) throw new Error("No chart to export");

  const { w, h } = measureSvg(svg);

  const HEAD = series.length ? 62 : 46;   // room for title (+ legend row)
  const FOOT = subtitle ? 22 : 10;
  const PAD = 18;

  // Build the standalone SVG root OURSELVES rather than cloning recharts'.
  //
  // recharts' RootSurface hard-codes style={{width:'100%',height:'100%'}} on
  // its root <svg>. A CSS inline style beats the width/height presentation
  // attributes, so patching those on a clone does not win — and once the
  // markup is handed to an <img>, "100%" has no containing block to resolve
  // against, so the browser falls back to the default replaced-element size
  // and the export comes out as a small strip. Re-emitting only the CHILDREN
  // under a root we control removes every attribute and style that could
  // fight the size we want.
  const ser = new XMLSerializer();
  const inner = Array.from(svg.childNodes)
    .map((n) => ser.serializeToString(n))
    .join("");

  const svgText =
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    // The page's font never reaches a standalone SVG; without this the text
    // rasterizes in the browser's default serif.
    `<style>text{font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}</style>` +
    `<rect width="${w}" height="${h}" fill="#ffffff"/>` +
    inner +
    `</svg>`;

  // Blob URL rather than a data: URL — no percent-encoding step to get wrong
  // and no practical length ceiling on a big chart.
  const blobUrl = URL.createObjectURL(new Blob([svgText], { type: "image/svg+xml;charset=utf-8" }));

  let img;
  try {
    img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.width = w;
      i.height = h;
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Could not rasterize the chart"));
      i.src = blobUrl;
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(blobUrl), 4000);
  }

  const cw = w + PAD * 2;
  const ch = h + HEAD + FOOT;
  const canvas = document.createElement("canvas");
  canvas.width = cw * scale;
  canvas.height = ch * scale;
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);

  // Opaque background — a transparent PNG pasted into Excel or a deck goes black.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, cw, ch);

  ctx.fillStyle = "#0f172a";
  ctx.font = "700 14px system-ui, -apple-system, Segoe UI, sans-serif";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(title, PAD, 24);

  // Legend row: swatch + name, laid out left to right.
  if (series.length) {
    let x = PAD;
    const y = 44;
    ctx.font = "600 11px system-ui, -apple-system, Segoe UI, sans-serif";
    for (const s of series) {
      ctx.fillStyle = s.color;
      if (s.dashed) {
        // Mirror the on-screen dash so the two series stay distinguishable
        // in print and for colour-blind readers.
        ctx.fillRect(x, y - 4, 7, 3);
        ctx.fillRect(x + 10, y - 4, 7, 3);
      } else {
        ctx.fillRect(x, y - 4, 17, 3);
      }
      x += 22;
      ctx.fillStyle = "#334155";
      ctx.fillText(s.name, x, y);
      x += ctx.measureText(s.name).width + 18;
    }
  }

  ctx.drawImage(img, PAD, HEAD, w, h);

  if (subtitle) {
    ctx.fillStyle = "#94a3b8";
    ctx.font = "400 10px system-ui, -apple-system, Segoe UI, sans-serif";
    ctx.fillText(subtitle, PAD, ch - 7);
  }

  const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
  if (!blob) throw new Error("Could not encode the PNG");

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick — revoking synchronously can cancel the download.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Rows -> CSV text, quoting anything containing a comma/quote/newline. */
export function toCsv(headers, rows) {
  const cell = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.map(cell).join(","), ...rows.map((r) => r.map(cell).join(","))].join("\n");
}

/** Download a CSV of the chart's underlying numbers (the table view). */
export function downloadCsv(filename, headers, rows) {
  const blob = new Blob(["﻿" + toCsv(headers, rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export { esc, measureSvg };
