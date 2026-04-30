import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import useTablePreferences from "../hooks/useTablePreferences";
import { pmApi } from "../services/api";

/** Row-select checkbox column: fixed width, not resizable / not reorderable in Manage Table. */
const TABLEPRO_SELECT_COL_PX = 44;
/** Floor width for visible columns without a saved width — min table width so many columns can scroll horizontally. */
const TABLEPRO_DEFAULT_COL_MIN_PX = 120;

function keyFromLabel(label, i) {
  const base = String(label || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return base || `col_${i}`;
}

/** Column whose cells hold the DocType `name` used to fetch dynamic fields (skip checkbox-only headers). */
function resolveLinkSourceKey(headRow, columns) {
  if (!headRow || !Array.isArray(columns) || !columns.length) return columns[0]?.key;
  const ths = Array.from(headRow.children);
  const labelIsLink = (raw) => {
    const s = String(raw || "").replace(/\s+/g, " ").trim().toLowerCase();
    if (!s) return false;
    return (
      s === "plan id"
      || s === "name"
      || s === "id"
      || s === "poid"
      || s.includes("plan id")
      || (s.includes("dispatch") && s.includes("id"))
      || s.includes("rollout")
      || s === "execution"
    );
  };
  for (let i = 0; i < ths.length && i < columns.length; i++) {
    const th = ths[i];
    const raw = String(th.textContent || "").replace(/\s+/g, " ").trim();
    const onlyCheckbox = th.querySelector('input[type="checkbox"]') && raw.length === 0;
    if (onlyCheckbox) continue;
    if (labelIsLink(raw)) return columns[i].key;
  }
  for (let i = 0; i < ths.length && i < columns.length; i++) {
    const th = ths[i];
    const raw = String(th.textContent || "").replace(/\s+/g, " ").trim();
    const onlyCheckbox = th.querySelector('input[type="checkbox"]') && raw.length === 0;
    if (onlyCheckbox) continue;
    if (raw) return columns[i].key;
  }
  return columns[0]?.key;
}

function escAttr(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function detectTableDoctype(pathname, tIdx) {
  const key = `${pathname}:${tIdx + 1}`;
  const map = {
    "/dispatch:1": "PO Dispatch",
    "/planning:1": "Rollout Plan",
    "/execution:1": "Rollout Plan",
    "/work-done:1": "Work Done",
    "/im-dispatch:1": "PO Dispatch",
    "/im-planning:1": "Rollout Plan",
    "/im-execution:1": "Daily Execution",
    "/im-projects:1": "Project Control Center",
    "/im-teams:1": "INET Team",
    "/im-timesheets:1": "Execution Time Log",
    "/field-history:1": "Daily Execution",
    "/field-timesheet:1": "Execution Time Log",
    "/po-dump:1": "PO Intake Line",
    "/im-subcon:1": "PO Dispatch",
  };
  return map[key] || null;
}

export default function DataTablePro() {
  const { pathname } = useLocation();
  const { role, user } = useAuth();
  const prefsApi = useTablePreferences();

  useEffect(() => {
    let destroyed = false;
    /** @type {{ table: HTMLTableElement, toolbar: HTMLDivElement }[]} */
    const tracked = [];
    /** @type {{ wrapper: Element, mo: MutationObserver }[]} */
    const wrapperMoList = [];
    let reinitTimer = null;
    let initLock = false;
    let initAgain = false;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    const pruneDisconnected = () => {
      for (let i = tracked.length - 1; i >= 0; i -= 1) {
        const { table, toolbar } = tracked[i];
        if (table?.isConnected) continue;
        try {
          if (typeof table?._tableproCleanup === "function") {
            table._tableproCleanup();
            delete table._tableproCleanup;
          }
        } catch {
          /* ignore */
        }
        toolbar?.remove();
        if (table) {
          table.classList.remove("data-table--tablepro");
          table.classList.remove("data-table--tablepro-ready");
          delete table.dataset.tableproInitialized;
        }
        tracked.splice(i, 1);
      }
    };

    const scheduleReinitFromDom = () => {
      if (destroyed) return;
      if (reinitTimer) clearTimeout(reinitTimer);
      reinitTimer = setTimeout(() => {
        reinitTimer = null;
        if (destroyed) return;
        pruneDisconnected();
        if (!document.querySelector(".data-table-wrapper table.data-table")) return;
        void init();
      }, 40);  // short debounce — batches rapid tbody swaps but keeps first paint snappy
    };

    async function init() {
      if (initLock) {
        initAgain = true;
        return;
      }
      initLock = true;
      try {
        pruneDisconnected();
        // Poll at one-frame intervals so we pick the table up the moment React
        // mounts it. 4.8 s total wait is plenty; check more often, not longer.
        let attempts = 0;
        while (!destroyed && attempts < 300) {
          const found = document.querySelectorAll(".data-table-wrapper table.data-table").length;
          if (found > 0) break;
          attempts += 1;
          await sleep(16);
        }
        if (destroyed) return;

        const tables = Array.from(document.querySelectorAll(".data-table-wrapper table.data-table"));
        for (let tIdx = 0; tIdx < tables.length; tIdx += 1) {
          if (destroyed) return;
          const table = tables[tIdx];
          if (table.dataset.tableproInitialized === "1") continue;
        table.dataset.tableproInitialized = "1";
        table.classList.add("data-table--tablepro");

        const wrapper = table.closest(".data-table-wrapper");
        if (!wrapper || !wrapper.parentElement) {
          delete table.dataset.tableproInitialized;
          continue;
        }
        const headRow = table.querySelector("thead tr");
        if (!headRow) continue;
        const headers = Array.from(headRow.children);
        if (!headers.length) continue;

        let columns = headers.map((th, i) => {
          const key = keyFromLabel(th.textContent, i);
          th.dataset.colKey = key;
          return { key, label: String(th.textContent || "").trim() || `Column ${i + 1}` };
        });
        const baseColumnKeys = columns.map((c) => c.key);

        const userKey = String(user?.email || "user").replace(/[:/\\]+/g, "_");
        const tableId = `${userKey}:${role || "user"}:${pathname}:table:${tIdx + 1}`;
        const tableDoctype = detectTableDoctype(pathname, tIdx);
        const saved = await prefsApi.load(tableId);
        const savedDyn = Array.isArray(saved.dynamic_fields) ? saved.dynamic_fields : [];
        // Merge saved dynamic columns into `columns` before restoring order, or saved.order
        // filters them out and refresh drops added fields from Manage Table + layout.
        savedDyn.forEach((d) => {
          if (!d?.key) return;
          if (!columns.some((c) => c.key === d.key)) {
            columns.push({
              key: d.key,
              label: String(d.label || d.fieldname || d.key).trim() || d.key,
            });
          }
        });
        const baseOrder = columns.map((c) => c.key);
        // Filter saved.order to current keys, but fall back to baseOrder if
        // none survive — otherwise applyAll() would strip every body cell
        // (allowed = new Set([])) and the tbody would render invisible.
        const restoredOrder = Array.isArray(saved.order)
          ? saved.order.filter((k) => columns.some((c) => c.key === k))
          : baseOrder;
        // Append any current column keys missing from restoredOrder so newly
        // added columns become visible the first time after a release.
        baseOrder.forEach((k) => {
          if (!restoredOrder.includes(k)) restoredOrder.push(k);
        });
        const validKeys = new Set(restoredOrder);
        const filteredHidden = Array.isArray(saved.hidden)
          ? saved.hidden.filter((k) => validKeys.has(k))
          : [];
        // Defensive: if every visible column ends up hidden (stale prefs from
        // an older release), wipe the set so the table doesn't look broken.
        const visibleCount = restoredOrder.length - filteredHidden.length;
        const safeHidden = visibleCount <= 0 ? [] : filteredHidden;
        const state = {
          order: restoredOrder.length ? restoredOrder : baseOrder,
          hidden: new Set(safeHidden),
          frozen: new Set(Array.isArray(saved.frozen) ? saved.frozen : []),
          widths: { ...(saved.widths || {}) },
          filters: { ...(saved.filters || {}) },
          show_filters: !!saved.show_filters,
          // Row sort: { key: <colKey> | null, dir: "asc" | "desc" }. Sorting
          // is applied to the rendered tbody after every (re-)init so it
          // survives data-refresh tbody swaps.
          sort: (saved.sort && typeof saved.sort === "object")
            ? { key: saved.sort.key || null, dir: saved.sort.dir === "asc" ? "asc" : "desc" }
            : { key: null, dir: "desc" },
          dynamic_fields: savedDyn,
        };
        let availableFields = [];
        if (tableDoctype) {
          try {
            const f = await pmApi.getDoctypeFields(tableDoctype);
            availableFields = Array.isArray(f?.fields) ? f.fields : [];
          } catch {
            availableFields = [];
          }
        }
        // Recover order if prefs had dynamic_fields but an older bug stripped keys from order
        state.dynamic_fields.forEach((d) => {
          if (d?.key && !state.order.includes(d.key)) state.order.push(d.key);
        });
        // Append new columns not in saved order
        columns.forEach((c) => {
          if (!state.order.includes(c.key)) state.order.push(c.key);
        });

        const thSelect = headRow.querySelector(":scope > th:first-child");
        const selectColumnKey =
          thSelect?.querySelector?.('input[type="checkbox"]') != null ? thSelect.dataset.colKey || null : null;
        if (selectColumnKey) delete state.widths[selectColumnKey];
        if (selectColumnKey) state.hidden.delete(selectColumnKey);

        const pinSelectColumnFirst = () => {
          if (selectColumnKey) state.hidden.delete(selectColumnKey);
          if (!selectColumnKey || !state.order.includes(selectColumnKey)) return;
          const i = state.order.indexOf(selectColumnKey);
          if (i > 0) {
            state.order.splice(i, 1);
            state.order.unshift(selectColumnKey);
          }
        };

        const persist = () => {
          prefsApi.saveDebounced(tableId, {
            order: state.order,
            hidden: Array.from(state.hidden),
            frozen: Array.from(state.frozen),
            widths: state.widths,
            filters: state.filters,
            show_filters: state.show_filters ? 1 : 0,
            sort: state.sort && state.sort.key ? { key: state.sort.key, dir: state.sort.dir } : null,
            dynamic_fields: state.dynamic_fields,
          });
        };

        const getRows = () => ({
          head: Array.from(table.querySelectorAll("thead tr")),
          body: Array.from(table.querySelectorAll("tbody tr")),
          foot: Array.from(table.querySelectorAll("tfoot tr")),
        });

        const normalizeRowCells = () => {
          const allRows = [...table.querySelectorAll("thead tr"), ...table.querySelectorAll("tbody tr"), ...table.querySelectorAll("tfoot tr")];
          allRows.forEach((row) => {
            const cells = Array.from(row.children);
            cells.forEach((cell, idx) => {
              if (!cell.dataset.colKey && columns[idx]) cell.dataset.colKey = columns[idx].key;
            });
          });
        };

        const ensureDynamicColumns = async () => {
          const headerTr = table.querySelector("thead tr");
          for (const dyn of state.dynamic_fields) {
            if (!dyn?.doctype || !dyn?.fieldname || !dyn?.key) continue;

            let sourceKey = dyn.source_key;
            const bodyRows = Array.from(table.querySelectorAll("tbody tr"));
            const collectNames = (sk) =>
              bodyRows
                .map((row) => Array.from(row.children).find((c) => c.dataset.colKey === sk))
                .map((cell) => String(cell?.textContent || "").trim())
                .filter(Boolean);

            let names = collectNames(sourceKey);
            if (!names.length && headerTr) {
              const fallback = resolveLinkSourceKey(headerTr, columns);
              if (fallback && fallback !== sourceKey) {
                sourceKey = fallback;
                dyn.source_key = fallback;
                names = collectNames(sourceKey);
              }
            }
            if (!names.length) continue;

            let values = {};
            try {
              const res = await pmApi.getTableFieldValues(dyn.doctype, dyn.fieldname, names);
              values = res?.values || {};
            } catch {
              values = {};
            }

            const head = table.querySelector("thead tr");
            if (head && !Array.from(head.children).some((c) => c.dataset.colKey === dyn.key)) {
              const th = document.createElement("th");
              th.dataset.colKey = dyn.key;
              th.textContent = dyn.label || dyn.fieldname;
              head.appendChild(th);
            }

            bodyRows.forEach((row) => {
              let td = Array.from(row.children).find((c) => c.dataset.colKey === dyn.key);
              if (!td) {
                td = document.createElement("td");
                td.dataset.colKey = dyn.key;
                row.appendChild(td);
              }
              const sourceCell = Array.from(row.children).find((c) => c.dataset.colKey === sourceKey);
              const sourceName = String(sourceCell?.textContent || "").trim();
              td.textContent = values[sourceName] == null || values[sourceName] === "" ? "—" : String(values[sourceName]);
            });

            if (!columns.some((c) => c.key === dyn.key)) {
              columns = [...columns, { key: dyn.key, label: dyn.label || dyn.fieldname }];
            }
            if (!state.order.includes(dyn.key)) state.order.push(dyn.key);
          }
        };

        const applyOrder = () => {
          const rows = getRows();
          const orderIndex = state.order.reduce((acc, key, idx) => {
            acc[key] = idx;
            return acc;
          }, {});
          const reorderRow = (row) => {
            const cells = Array.from(row.children);
            if (!cells.length) return;
            if (cells.length < columns.length) return; // skip rows with colspans
            const sorted = [...cells].sort((a, b) => {
              const ai = orderIndex[a.dataset.colKey ?? ""] ?? 9999;
              const bi = orderIndex[b.dataset.colKey ?? ""] ?? 9999;
              return ai - bi;
            });
            sorted.forEach((cell) => row.appendChild(cell));
          };
          [...rows.head, ...rows.body, ...rows.foot].forEach(reorderRow);
        };

        const applyHidden = () => {
          const allRows = [...table.querySelectorAll("thead tr"), ...table.querySelectorAll("tbody tr"), ...table.querySelectorAll("tfoot tr")];
          allRows.forEach((row) => {
            const cells = Array.from(row.children);
            cells.forEach((cell) => {
              const key = cell.dataset.colKey;
              cell.style.display = key && state.hidden.has(key) ? "none" : "";
            });
          });
        };

        const applyFooterColspan = () => {
          const visibleCount = state.order.filter((k) => !state.hidden.has(k)).length || 1;
          const footRows = Array.from(table.querySelectorAll("tfoot tr"));
          footRows.forEach((row) => {
            const cells = Array.from(row.children);
            if (!cells.length) return;
            const first = cells[0];
            if (!first.hasAttribute("colspan")) return;
            if (cells.length === 1) {
              // Single summary cell -> span all visible columns.
              first.setAttribute("colspan", String(visibleCount));
            } else {
              // Multi-cell footer (e.g. label + total + trailing cell):
              // keep right-side cells anchored by shrinking first colspan only.
              const reservedRightCells = cells.length - 1;
              const nextSpan = Math.max(1, visibleCount - reservedRightCells);
              first.setAttribute("colspan", String(nextSpan));
            }
          });
        };

        /**
         * Set table min-width so the wrapper can scroll horizontally when needed.
         * Uses saved px widths plus a floor for unsized columns (saved-only sum was almost always < wrapper → no scroll).
         */
        const syncTableScrollWidth = () => {
          const wrap = table.closest(".data-table-wrapper");
          if (!wrap) return;
          const cw = wrap.clientWidth || 0;
          if (cw < 1) return;

          let sum = 0;
          state.order.forEach((k) => {
            if (state.hidden.has(k)) return;
            if (selectColumnKey && k === selectColumnKey) {
              sum += TABLEPRO_SELECT_COL_PX;
              return;
            }
            const w = state.widths[k];
            if (w != null && Number.isFinite(Number(w)) && Number(w) > 0) sum += Number(w);
            else sum += TABLEPRO_DEFAULT_COL_MIN_PX;
          });

          if (sum > cw) {
            table.style.minWidth = `${Math.ceil(sum)}px`;
            table.style.width = `${Math.ceil(sum)}px`;
          } else {
            table.style.minWidth = "";
            table.style.width = "";
          }
        };

        /** Snapshot current header pixel widths into state so table-layout:fixed does not steal width from unspecified columns while resizing one. */
        const materializeColumnWidthsFromDom = () => {
          const headerCells = Array.from(table.querySelectorAll("thead tr:first-child > th"));
          headerCells.forEach((h) => {
            const k = h.dataset.colKey;
            if (!k) return;
            if (selectColumnKey && k === selectColumnKey) return;
            const w = Math.round(h.getBoundingClientRect().width);
            state.widths[k] = Math.max(60, w || 60);
          });
        };

        const widthForKeyLookup = (key) => {
          if (selectColumnKey && key === selectColumnKey) return TABLEPRO_SELECT_COL_PX;
          const w = state.widths[key];
          return w != null && Number.isFinite(Number(w)) && Number(w) > 0
            ? Number(w)
            : TABLEPRO_DEFAULT_COL_MIN_PX;
        };

        /**
         * Sticky-position every frozen column so it survives horizontal scroll.
         * Computes each column's left offset as the cumulative width of all
         * earlier frozen columns in the current visible order.
         */
        const applyFrozen = () => {
          const offsets = {};
          let cumulative = 0;
          state.order.forEach((key) => {
            if (state.hidden.has(key)) return;
            if (state.frozen.has(key)) {
              offsets[key] = cumulative;
              cumulative += widthForKeyLookup(key);
            }
          });

          const clearSticky = (cell) => {
            if (!cell) return;
            if (cell.dataset.tableproFrozen === "1") {
              cell.style.position = "";
              cell.style.left = "";
              cell.style.zIndex = "";
              cell.style.background = "";
              cell.classList.remove("tablepro-col-frozen");
              delete cell.dataset.tableproFrozen;
            }
          };
          const setSticky = (cell, left, isHeader) => {
            if (!cell) return;
            cell.dataset.tableproFrozen = "1";
            cell.classList.add("tablepro-col-frozen");
            cell.style.position = "sticky";
            cell.style.left = `${left}px`;
            // thead th has CSS z-index:10 so non-frozen headers can cover
            // frozen ones during horizontal scroll. Frozen header needs to be
            // above that (20). Body sticky just needs > 0 to cover non-frozen
            // body cells (which have no z-index).
            cell.style.zIndex = String(isHeader ? 20 : 3);
            cell.style.background = isHeader ? "#f8fafc" : "#fff";
          };

          const rows = [
            ...table.querySelectorAll("thead tr"),
            ...table.querySelectorAll("tbody tr"),
            ...table.querySelectorAll("tfoot tr"),
          ];
          rows.forEach((row) => {
            const isHeader = row.parentElement?.tagName === "THEAD";
            Array.from(row.children).forEach((cell) => {
              const k = cell.dataset.colKey;
              if (k && offsets[k] != null) setSticky(cell, offsets[k], isHeader);
              else clearSticky(cell);
            });
          });
        };

        /**
         * Mirror the active sort onto column headers — an arrow + active
         * class so the user can see at a glance which column is sorting,
         * without having to reopen the Sort panel.
         */
        const refreshHeaderSortIndicators = () => {
          const headerCells = Array.from(table.querySelectorAll("thead tr:first-child > th"));
          const activeKey = state.sort?.key || null;
          const dir = state.sort?.dir === "desc" ? "desc" : "asc";
          headerCells.forEach((th) => {
            const k = th.dataset.colKey;
            const old = th.querySelector(".tablepro-header-sort-arrow");
            if (old) old.remove();
            th.classList.remove("is-sorted-asc", "is-sorted-desc");
            if (k && activeKey && k === activeKey) {
              th.classList.add(dir === "asc" ? "is-sorted-asc" : "is-sorted-desc");
              const arrow = document.createElement("span");
              arrow.className = "tablepro-header-sort-arrow";
              arrow.textContent = dir === "asc" ? " ↑" : " ↓";
              th.appendChild(arrow);
            }
          });
        };

        /**
         * Reorder tbody rows by the chosen sort key + direction. Reads each
         * row's cell text content for that column (numeric-aware compare).
         * No-op when state.sort.key is null or the column isn't found.
         */
        const applySort = () => {
          refreshHeaderSortIndicators();
          const key = state.sort?.key;
          if (!key) return;
          const tbody = table.querySelector("tbody");
          if (!tbody) return;
          const rows = Array.from(tbody.children).filter((r) => r.tagName === "TR");
          if (rows.length < 2) return;

          const valueFor = (row) => {
            // Avoid CSS.escape edge cases — iterate children directly.
            let cell = null;
            for (const c of row.children) {
              if (c.dataset && c.dataset.colKey === key) { cell = c; break; }
            }
            if (!cell) return "";
            // Prefer the title attribute when set (often holds the full,
            // un-truncated value); else fall back to text content.
            const raw = (cell.getAttribute("title") || cell.textContent || "").trim();
            return raw;
          };

          const numericProbe = /^[-+]?[\d,]*\.?\d+(?:[eE][-+]?\d+)?$/;
          const toNum = (s) => Number(String(s).replace(/,/g, ""));

          const sign = state.sort.dir === "asc" ? 1 : -1;
          const sorted = rows.slice().sort((a, b) => {
            const av = valueFor(a);
            const bv = valueFor(b);
            const aEmpty = !av || av === "—";
            const bEmpty = !bv || bv === "—";
            // Empty / placeholder values always sink to the bottom.
            if (aEmpty && bEmpty) return 0;
            if (aEmpty) return 1;
            if (bEmpty) return -1;
            if (numericProbe.test(av) && numericProbe.test(bv)) {
              return (toNum(av) - toNum(bv)) * sign;
            }
            return av.localeCompare(bv, undefined, { numeric: true, sensitivity: "base" }) * sign;
          });
          // appendChild on an already-attached node moves it. Reattaching in
          // sorted order is the cheapest way to reorder rows.
          sorted.forEach((r) => tbody.appendChild(r));
        };

        const applyWidths = () => {
          const setCellPx = (cell, width) => {
            if (width) {
              const px = `${width}px`;
              cell.style.width = px;
              cell.style.minWidth = px;
              cell.style.maxWidth = px;
            } else {
              cell.style.width = "";
              cell.style.minWidth = "";
              cell.style.maxWidth = "";
            }
          };
          const widthForKey = (key) => {
            if (selectColumnKey && key === selectColumnKey) return TABLEPRO_SELECT_COL_PX;
            return key ? state.widths[key] : null;
          };
          const headerCells = Array.from(table.querySelectorAll("thead tr:first-child > th"));
          headerCells.forEach((th) => {
            const key = th.dataset.colKey;
            setCellPx(th, widthForKey(key));
          });
          const filterRow = table.querySelector("thead tr.tablepro-filter-row");
          if (filterRow) {
            Array.from(filterRow.children).forEach((th) => {
              const key = th.dataset.colKey;
              setCellPx(th, widthForKey(key));
            });
          }
          table.querySelectorAll("tbody tr").forEach((row) => {
            Array.from(row.children).forEach((td) => {
              const key = td.dataset.colKey;
              setCellPx(td, widthForKey(key));
            });
          });
          syncTableScrollWidth();
          applyFrozen();
        };

        const applyFilters = () => {
          const bodyRows = Array.from(table.querySelectorAll("tbody tr"));
          const activeKeys = Object.keys(state.filters).filter((k) => String(state.filters[k] || "").trim());
          bodyRows.forEach((row) => {
            const cells = Array.from(row.children);
            if (!cells.length) return;
            const pass = activeKeys.every((k) => {
              const val = String(state.filters[k] || "").trim().toLowerCase();
              if (!val) return true;
              const cell = cells.find((c) => c.dataset.colKey === k);
              if (!cell) return true;
              const txt = String(cell?.textContent || "").toLowerCase();
              return txt.includes(val);
            });
            row.style.display = pass ? "" : "none";
          });
        };

        const ensureFilterRow = () => {
          const thead = table.querySelector("thead");
          if (!thead) return;
          let filterRow = thead.querySelector(".tablepro-filter-row");
          if (!filterRow) {
            filterRow = document.createElement("tr");
            filterRow.className = "tablepro-filter-row";
            state.order.forEach((key) => {
              const th = document.createElement("th");
              th.dataset.colKey = key;
              const input = document.createElement("input");
              input.className = "tablepro-filter-input";
              input.placeholder = "Filter...";
              input.value = state.filters[key] || "";
              input.addEventListener("input", (e) => {
                state.filters[key] = e.target.value;
                applyFilters();
                persist();
              });
              th.appendChild(input);
              filterRow.appendChild(th);
            });
            thead.appendChild(filterRow);
          }
          // Ensure filter cells exist for newly added columns
          state.order.forEach((key) => {
            const exists = Array.from(filterRow.children).some((c) => c.dataset.colKey === key);
            if (!exists) {
              const th = document.createElement("th");
              th.dataset.colKey = key;
              const input = document.createElement("input");
              input.className = "tablepro-filter-input";
              input.placeholder = "Filter...";
              input.value = state.filters[key] || "";
              input.addEventListener("input", (e) => {
                state.filters[key] = e.target.value;
                applyFilters();
                persist();
              });
              th.appendChild(input);
              filterRow.appendChild(th);
            }
          });
          filterRow.style.display = state.show_filters ? "" : "none";
          const cells = Array.from(filterRow.children);
          cells.forEach((cell) => {
            cell.style.display = state.hidden.has(cell.dataset.colKey) ? "none" : "";
          });
        };

        const addResizeHandles = () => {
          const headerCells = Array.from(table.querySelectorAll("thead tr:first-child > th"));
          headerCells.forEach((th) => {
            if (th.querySelector(".tablepro-resize-handle")) return;
            const key = th.dataset.colKey;
            if (selectColumnKey && key === selectColumnKey) return;
            const handle = document.createElement("span");
            handle.className = "tablepro-resize-handle";
            let startX = 0;
            let startW = 0;
            const onMove = (ev) => {
              ev.preventDefault();
              const next = Math.max(60, startW + (ev.clientX - startX));
              const px = `${next}px`;
              // Keep min/max in sync with width while dragging; stale minWidth blocked shrinking.
              th.style.width = px;
              th.style.minWidth = px;
              th.style.maxWidth = px;
              state.widths[key] = next;
              table.querySelectorAll("tbody td").forEach((td) => {
                if (td.dataset.colKey !== key) return;
                td.style.width = px;
                td.style.minWidth = px;
                td.style.maxWidth = px;
              });
              const fr = table.querySelector("thead tr.tablepro-filter-row");
              if (fr) {
                Array.from(fr.children).forEach((fth) => {
                  if (fth.dataset.colKey !== key) return;
                  fth.style.width = px;
                  fth.style.minWidth = px;
                  fth.style.maxWidth = px;
                });
              }
            };
            const onUp = () => {
              document.removeEventListener("mousemove", onMove, true);
              document.removeEventListener("mouseup", onUp, true);
              applyWidths();
              const snap = {
                order: [...state.order],
                hidden: Array.from(state.hidden),
                widths: { ...state.widths },
                filters: { ...state.filters },
                show_filters: state.show_filters ? 1 : 0,
                dynamic_fields: state.dynamic_fields.map((d) => ({ ...d })),
              };
              void prefsApi.saveImmediate(tableId, snap);
              persist();
              syncTableScrollWidth();
            };
            handle.addEventListener("mousedown", (ev) => {
              ev.preventDefault();
              ev.stopPropagation();
              materializeColumnWidthsFromDom();
              applyWidths();
              startX = ev.clientX;
              startW = th.getBoundingClientRect().width;
              document.addEventListener("mousemove", onMove, true);
              document.addEventListener("mouseup", onUp, true);
            });
            /* Avoid th.style.position — it overrides CSS position:sticky on header cells. */
            th.appendChild(handle);
          });
        };

        const applyAll = async () => {
          pinSelectColumnFirst();
          const allowed = new Set(state.order);
          table.querySelectorAll("thead tr, tbody tr, tfoot tr").forEach((row) => {
            Array.from(row.children).forEach((cell) => {
              const k = cell.dataset.colKey;
              if (k && !allowed.has(k)) cell.remove();
            });
          });
          columns = columns.filter((c) => allowed.has(c.key));

          normalizeRowCells();
          await ensureDynamicColumns();
          normalizeRowCells();
          applyOrder();
          applyHidden();
          applyFooterColspan();
          applyWidths();
          ensureFilterRow();
          applyFilters();
          addResizeHandles();
          applyFrozen();
          // Sort runs last so it operates on the final cell layout.
          applySort();
          updateSortButtonLabel();
        };

        const toolbar = document.createElement("div");
        toolbar.className = "tablepro-toolbar";
        toolbar.innerHTML = `
          <button type="button" class="btn-secondary tablepro-btn-columns" title="Manage Table">⚙ Manage Table</button>
          <button type="button" class="btn-secondary tablepro-btn-filters">Filters</button>
          <button type="button" class="btn-secondary tablepro-btn-reset">Reset</button>
          <button type="button" class="btn-secondary tablepro-btn-sort" title="Sort rows by column">
            <span class="tablepro-sort-icon">↕</span>
            <span class="tablepro-sort-label">Sort by</span>
            <span class="tablepro-sort-dir"></span>
          </button>
        `;
        wrapper.parentElement?.insertBefore(toolbar, wrapper);
        tracked.push({ table, toolbar });
        if (!wrapperMoList.some((e) => e.wrapper === wrapper)) {
          // Watch the direct parent of the table (.data-table-scroll) so we catch
          // conditional <table> swaps (e.g. Loading… div ↔ <table> on data refetch).
          // The outer .data-table-wrapper only has .data-table-scroll as a child, so
          // observing it without subtree never fires for the actual swap.
          const observeTarget = table.parentElement || wrapper;
          const mo = new MutationObserver(() => scheduleReinitFromDom());
          mo.observe(observeTarget, { childList: true });
          wrapperMoList.push({ wrapper, mo });
        }

        const panel = document.createElement("div");
        panel.className = "tablepro-panel";
        panel.style.display = "none";
        toolbar.appendChild(panel);

        // Separate panel for the Sort menu so it doesn't share state with the
        // (busier) Manage Table panel.
        const sortPanel = document.createElement("div");
        sortPanel.className = "tablepro-panel tablepro-sort-panel";
        sortPanel.style.display = "none";
        toolbar.appendChild(sortPanel);

        // Keep the toolbar Sort button in sync with the active selection so
        // users see e.g. "Sort by: Last Updated On ↓" without opening the menu.
        const updateSortButtonLabel = () => {
          const labelEl = toolbar.querySelector(".tablepro-btn-sort .tablepro-sort-label");
          const dirEl = toolbar.querySelector(".tablepro-btn-sort .tablepro-sort-dir");
          if (!labelEl || !dirEl) return;
          if (state.sort?.key) {
            const meta = getColumnMeta(state.sort.key);
            labelEl.textContent = meta?.label || state.sort.key;
            dirEl.textContent = state.sort.dir === "asc" ? "↑" : "↓";
          } else {
            labelEl.textContent = "Sort by";
            dirEl.textContent = "";
          }
        };

        const renderSortPanel = () => {
          sortPanel.innerHTML = "";
          const head = document.createElement("div");
          head.className = "tablepro-panel-title";
          head.textContent = "Sort rows by";
          sortPanel.appendChild(head);

          // Keep visible columns only; ignore the select-checkbox column.
          state.order.forEach((key) => {
            if (selectColumnKey && key === selectColumnKey) return;
            if (state.hidden.has(key)) return;
            const meta = getColumnMeta(key);
            if (!meta) return;
            const row = document.createElement("div");
            const isActive = state.sort?.key === key;
            row.className = `tablepro-sort-row${isActive ? " is-active" : ""}`;
            const arrow = isActive ? (state.sort.dir === "asc" ? "↑" : "↓") : "";
            row.innerHTML = `
              <span class="arrow">${arrow}</span>
              <span style="flex:1;">${escAttr(meta.label)}</span>
            `;
            // Click toggles direction when the same column is clicked again,
            // otherwise switches to that column with descending (the natural
            // default for "newest first" / "biggest first").
            row.addEventListener("click", () => {
              if (state.sort?.key === key) {
                state.sort.dir = state.sort.dir === "asc" ? "desc" : "asc";
              } else {
                state.sort = { key, dir: "desc" };
              }
              renderSortPanel();
              updateSortButtonLabel();
              applySort();
              persist();
            });
            sortPanel.appendChild(row);
          });

          if (state.sort?.key) {
            const clear = document.createElement("div");
            clear.className = "tablepro-sort-clear";
            clear.textContent = "✕  Clear sort";
            clear.addEventListener("click", async () => {
              state.sort = { key: null, dir: "desc" };
              renderSortPanel();
              updateSortButtonLabel();
              await applyAll();
              persist();
            });
            sortPanel.appendChild(clear);
          }
        };

        const getColumnMeta = (key) => {
          const col = columns.find((c) => c.key === key);
          if (col) return col;
          const dyn = state.dynamic_fields.find((d) => d.key === key);
          if (dyn) {
            return { key: dyn.key, label: String(dyn.label || dyn.fieldname || dyn.key).trim() || dyn.key };
          }
          return null;
        };

        const renderPanel = () => {
          panel.innerHTML = "";
          const addField = document.createElement("div");
          addField.className = "tablepro-panel-addfield";
          addField.innerHTML = `
            <div class="tablepro-panel-title">Add Doctype Field Column</div>
            <div class="tablepro-help">${tableDoctype ? `Doctype: ${escAttr(tableDoctype)}` : "Doctype: not mapped for this table"}</div>
            <select class="tablepro-input-field">
              <option value="">Select field...</option>
              ${availableFields.map((f) => `<option value="${escAttr(f.fieldname)}">${escAttr(f.label)}</option>`).join("")}
            </select>
            <button type="button" class="btn-secondary tablepro-btn-addfield">Add Field Column</button>
          `;
          panel.appendChild(addField);
          addField.querySelector(".tablepro-btn-addfield")?.addEventListener("click", async () => {
            const fieldname = addField.querySelector(".tablepro-input-field")?.value?.trim();
            const source_key = resolveLinkSourceKey(headRow, columns);
            if (!tableDoctype || !fieldname || !source_key) return;
            const label = availableFields.find((f) => f.fieldname === fieldname)?.label || fieldname;
            const key = `dyn_${tableDoctype.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_${fieldname.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
            if (!state.dynamic_fields.some((d) => d.key === key)) {
              state.dynamic_fields.push({ key, doctype: tableDoctype, fieldname, source_key, label });
            }
            if (!state.order.includes(key)) state.order.push(key);
            await applyAll();
            persist();
            renderPanel();
          });

          state.order.forEach((key, idx) => {
            const col = getColumnMeta(key);
            if (!col) return;
            const row = document.createElement("div");
            row.className = "tablepro-panel-row";
            const isSelectCol = selectColumnKey && key === selectColumnKey;
            if (isSelectCol) {
              row.innerHTML = `
                <label class="tablepro-panel-select-col"><input type="checkbox" checked disabled> ${escAttr(col.label)}</label>
              `;
            } else {
              const frozen = state.frozen.has(key);
              row.innerHTML = `
              <label><input type="checkbox" ${state.hidden.has(key) ? "" : "checked"}> ${escAttr(col.label)}</label>
              <div class="tablepro-panel-actions">
                <button type="button" class="btn-secondary freeze" title="${frozen ? "Unfreeze column" : "Freeze column (keeps it visible while scrolling)"}" style="${frozen ? "background:#eff6ff;color:#1d4ed8;border-color:#bfdbfe;" : ""}">📌</button>
                <button type="button" class="btn-secondary up">↑</button>
                <button type="button" class="btn-secondary down">↓</button>
              </div>
            `;
            }
            const cb = row.querySelector("label.tablepro-panel-select-col") ? null : row.querySelector('label > input[type="checkbox"]');
            const freezeBtn = row.querySelector(".freeze");
            const up = row.querySelector(".up");
            const down = row.querySelector(".down");
            freezeBtn?.addEventListener("click", () => {
              if (state.frozen.has(key)) state.frozen.delete(key);
              else state.frozen.add(key);
              renderPanel();
              void applyAll();
              persist();
            });
            cb?.addEventListener("change", (e) => {
              if (e.target.checked) state.hidden.delete(key);
              else state.hidden.add(key);
              void applyAll();
              persist();
            });
            up?.addEventListener("click", () => {
              if (idx === 0) return;
              const tmp = state.order[idx - 1];
              state.order[idx - 1] = state.order[idx];
              state.order[idx] = tmp;
              renderPanel();
              void applyAll();
              persist();
            });
            down?.addEventListener("click", () => {
              if (idx >= state.order.length - 1) return;
              const tmp = state.order[idx + 1];
              state.order[idx + 1] = state.order[idx];
              state.order[idx] = tmp;
              renderPanel();
              void applyAll();
              persist();
            });
            panel.appendChild(row);
          });
        };

        toolbar.querySelector(".tablepro-btn-columns")?.addEventListener("click", () => {
          panel.style.display = panel.style.display === "none" ? "block" : "none";
          sortPanel.style.display = "none";
          if (panel.style.display === "block") renderPanel();
        });
        toolbar.querySelector(".tablepro-btn-sort")?.addEventListener("click", () => {
          sortPanel.style.display = sortPanel.style.display === "none" ? "block" : "none";
          panel.style.display = "none";
          if (sortPanel.style.display === "block") renderSortPanel();
        });
        toolbar.querySelector(".tablepro-btn-filters")?.addEventListener("click", () => {
          state.show_filters = !state.show_filters;
          ensureFilterRow();
          persist();
        });
        toolbar.querySelector(".tablepro-btn-reset")?.addEventListener("click", async () => {
          columns = columns.filter((c) => baseColumnKeys.includes(c.key));
          state.order = [...baseColumnKeys];
          state.hidden = new Set();
          state.frozen = new Set();
          state.widths = {};
          state.filters = {};
          state.show_filters = false;
          state.sort = { key: null, dir: "desc" };
          state.dynamic_fields = [];
          renderPanel();
          renderSortPanel();
          await applyAll();
          persist();
        });

        const onDocClick = (ev) => {
          if (toolbar.contains(ev.target)) return;
          if (panel.style.display !== "none") panel.style.display = "none";
          if (sortPanel.style.display !== "none") sortPanel.style.display = "none";
        };
        document.addEventListener("mousedown", onDocClick);

        await applyAll();
        renderPanel();
        // Signal to CSS that saved widths / order / hidden are applied so the
        // table fades in — avoids the "flash of old layout" before init runs.
        table.classList.add("data-table--tablepro-ready");

        const wrapEl = table.closest(".data-table-wrapper");
        let wrapResizeObs = null;
        if (wrapEl && typeof ResizeObserver !== "undefined") {
          wrapResizeObs = new ResizeObserver(() => syncTableScrollWidth());
          wrapResizeObs.observe(wrapEl);
        }

        // Re-apply layout when tbody rows are replaced in-place (e.g. limit selector / data refresh).
        // The wrapper MutationObserver only fires when the <table> element itself is swapped out;
        // it misses in-place tbody updates, so new rows come in without colKey, widths, or ordering.
        let tbodyReapplyTimer = null;
        const tbodyMo = new MutationObserver(() => {
          if (destroyed) return;
          if (tbodyReapplyTimer) clearTimeout(tbodyReapplyTimer);
          tbodyReapplyTimer = setTimeout(() => {
            tbodyReapplyTimer = null;
            if (!table.isConnected || destroyed) return;
            normalizeRowCells();
            applyOrder();
            applyHidden();
            applyWidths();
            ensureFilterRow();
            applyFilters();
            applyFrozen();
          }, 16);
        });
        const tbody = table.querySelector("tbody");
        if (tbody) tbodyMo.observe(tbody, { childList: true });

        table.dataset.tableproCleanup = "1";
        table._tableproCleanup = () => {
          document.removeEventListener("mousedown", onDocClick);
          wrapResizeObs?.disconnect();
          tbodyMo.disconnect();
          if (tbodyReapplyTimer) clearTimeout(tbodyReapplyTimer);
        };
        }
      } finally {
        initLock = false;
        if (initAgain) {
          initAgain = false;
          void init();
        }
      }
    }

    init();
    return () => {
      destroyed = true;
      if (reinitTimer) clearTimeout(reinitTimer);
      wrapperMoList.forEach(({ mo }) => {
        try {
          mo.disconnect();
        } catch {
          /* ignore */
        }
      });
      wrapperMoList.length = 0;
      while (tracked.length) {
        const { table, toolbar } = tracked.pop();
        try {
          if (typeof table?._tableproCleanup === "function") {
            table._tableproCleanup();
            delete table._tableproCleanup;
          }
        } catch {
          /* ignore */
        }
        toolbar?.remove();
        if (table) {
          table.classList.remove("data-table--tablepro");
          table.classList.remove("data-table--tablepro-ready");
          delete table.dataset.tableproInitialized;
        }
      }
    };
  }, [pathname, role, prefsApi, user?.email]);

  return null;
}
