import { useEffect, useRef, useState } from "react";
import { printPanel, exportChartPng, downloadCsv, pickChartSvg } from "./chartExport";

/**
 * Print / PNG / CSV actions for a chart panel, behind a single ⋮ menu button.
 *
 * Props:
 *   panelRef   — ref to the .nd-panel wrapping the chart (print target)
 *   title      — heading stamped onto the PNG and used for filenames
 *   subtitle   — small caption line on the PNG
 *   series     — [{ key, name, color, dashed }] — legend for the PNG + CSV columns
 *   data       — the chart's rows, for the CSV
 */
export default function ChartActions({ panelRef, title, subtitle = "", series = [], data = [] }) {
  const [busy, setBusy] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  const slug = String(title || "chart").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function onPrint() {
    setOpen(false);
    printPanel(panelRef?.current);
  }

  async function onPng() {
    setOpen(false);
    setBusy("png");
    try {
      // NOT querySelector(".recharts-surface") — legend icons are surfaces too.
      const svg = pickChartSvg(panelRef?.current);
      await exportChartPng({ svg, title, subtitle, series, filename: slug });
    } catch (e) {
      // eslint-disable-next-line no-alert
      alert(e?.message || "Could not export the chart image.");
    } finally {
      setBusy("");
    }
  }

  function onCsv() {
    setOpen(false);
    const headers = ["Month", ...series.map((s) => s.name)];
    const rows = data.map((d) => [d.label, ...series.map((s) => Math.round(Number(d[s.key]) || 0))]);
    downloadCsv(slug, headers, rows);
  }

  return (
    <div className="nd-chart-actions" ref={wrapRef}>
      <button
        type="button"
        className="nd-chart-actions-trigger"
        onClick={() => setOpen((v) => !v)}
        title="Chart actions"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        ⋮
      </button>
      {open && (
        <div className="nd-chart-actions-menu" role="menu">
          <button type="button" role="menuitem" onClick={onPrint} title="Print just this chart">
            Print
          </button>
          <button type="button" role="menuitem" onClick={onPng} disabled={busy === "png"} title="Download as a PNG image">
            {busy === "png" ? "Exporting…" : "PNG"}
          </button>
          <button type="button" role="menuitem" onClick={onCsv} disabled={!data.length} title="Download the numbers behind this chart">
            CSV
          </button>
        </div>
      )}
    </div>
  );
}
