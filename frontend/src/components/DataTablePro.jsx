import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import useTablePreferences from "../hooks/useTablePreferences";
import { pmApi } from "../services/api";

function keyFromLabel(label, i) {
  const base = String(label || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return base || `col_${i}`;
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
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    const init = async () => {
      let attempts = 0;
      while (!destroyed && attempts < 60) {
        const found = document.querySelectorAll(".data-table-wrapper > table.data-table").length;
        if (found > 0) break;
        attempts += 1;
        await sleep(80);
      }
      if (destroyed) return;

      const tables = Array.from(document.querySelectorAll(".data-table-wrapper > table.data-table"));
      for (let tIdx = 0; tIdx < tables.length; tIdx += 1) {
        if (destroyed) return;
        const table = tables[tIdx];
        if (table.dataset.tableproInitialized === "1") continue;
        table.dataset.tableproInitialized = "1";

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

        const userKey = String(user?.email || "user").replace(/[:/\\]+/g, "_");
        const tableId = `${userKey}:${role || "user"}:${pathname}:table:${tIdx + 1}`;
        const tableDoctype = detectTableDoctype(pathname, tIdx);
        const saved = await prefsApi.load(tableId);
        const state = {
          order: Array.isArray(saved.order) ? saved.order.filter((k) => columns.some((c) => c.key === k)) : columns.map((c) => c.key),
          hidden: new Set(Array.isArray(saved.hidden) ? saved.hidden : []),
          widths: { ...(saved.widths || {}) },
          filters: { ...(saved.filters || {}) },
          show_filters: !!saved.show_filters,
          dynamic_fields: Array.isArray(saved.dynamic_fields) ? saved.dynamic_fields : [],
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
        // Append new columns not in saved order
        columns.forEach((c) => {
          if (!state.order.includes(c.key)) state.order.push(c.key);
        });

        const persist = () => {
          prefsApi.saveDebounced(tableId, {
            order: state.order,
            hidden: Array.from(state.hidden),
            widths: state.widths,
            filters: state.filters,
            show_filters: state.show_filters ? 1 : 0,
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
          for (const dyn of state.dynamic_fields) {
            if (!dyn?.doctype || !dyn?.fieldname || !dyn?.source_key || !dyn?.key) continue;

            const bodyRows = Array.from(table.querySelectorAll("tbody tr"));
            const names = bodyRows
              .map((row) => Array.from(row.children).find((c) => c.dataset.colKey === dyn.source_key))
              .map((cell) => String(cell?.textContent || "").trim())
              .filter(Boolean);
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
              const sourceCell = Array.from(row.children).find((c) => c.dataset.colKey === dyn.source_key);
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

        const applyWidths = () => {
          const headerCells = Array.from(table.querySelectorAll("thead tr:first-child > th"));
          headerCells.forEach((th) => {
            const key = th.dataset.colKey;
            const width = state.widths[key];
            if (width) {
              th.style.width = `${width}px`;
              th.style.minWidth = `${Math.min(width, 120)}px`;
              th.style.maxWidth = `${Math.max(width, 120)}px`;
            }
          });
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

        const applyAll = async () => {
          normalizeRowCells();
          await ensureDynamicColumns();
          normalizeRowCells();
          applyOrder();
          applyHidden();
          applyFooterColspan();
          applyWidths();
          ensureFilterRow();
          applyFilters();
        };

        const addResizeHandles = () => {
          const headerCells = Array.from(table.querySelectorAll("thead tr:first-child > th"));
          headerCells.forEach((th) => {
            if (th.querySelector(".tablepro-resize-handle")) return;
            const key = th.dataset.colKey;
            const handle = document.createElement("span");
            handle.className = "tablepro-resize-handle";
            let startX = 0;
            let startW = 0;
            const onMove = (ev) => {
              const next = Math.max(60, startW + (ev.clientX - startX));
              th.style.width = `${next}px`;
              state.widths[key] = next;
            };
            const onUp = () => {
              document.removeEventListener("mousemove", onMove);
              document.removeEventListener("mouseup", onUp);
              persist();
            };
            handle.addEventListener("mousedown", (ev) => {
              ev.preventDefault();
              startX = ev.clientX;
              startW = th.getBoundingClientRect().width;
              document.addEventListener("mousemove", onMove);
              document.addEventListener("mouseup", onUp);
            });
            th.style.position = "relative";
            th.appendChild(handle);
          });
        };

        const toolbar = document.createElement("div");
        toolbar.className = "tablepro-toolbar";
        toolbar.innerHTML = `
          <button type="button" class="btn-secondary tablepro-btn-columns" title="Manage Table">⚙ Manage Table</button>
          <button type="button" class="btn-secondary tablepro-btn-filters">Filters</button>
          <button type="button" class="btn-secondary tablepro-btn-reset">Reset</button>
        `;
        wrapper.parentElement?.insertBefore(toolbar, wrapper);

        const panel = document.createElement("div");
        panel.className = "tablepro-panel";
        panel.style.display = "none";
        toolbar.appendChild(panel);

        const renderPanel = () => {
          panel.innerHTML = "";
          const addField = document.createElement("div");
          addField.className = "tablepro-panel-addfield";
          addField.innerHTML = `
            <div class="tablepro-panel-title">Add Doctype Field Column</div>
            <div class="tablepro-help">${tableDoctype ? `Doctype: ${tableDoctype}` : "Doctype: not mapped for this table"}</div>
            <select class="tablepro-input-field">
              <option value="">Select field...</option>
              ${availableFields.map((f) => `<option value="${f.fieldname}">${f.label}</option>`).join("")}
            </select>
            <button type="button" class="btn-secondary tablepro-btn-addfield">Add Field Column</button>
          `;
          panel.appendChild(addField);
          addField.querySelector(".tablepro-btn-addfield")?.addEventListener("click", async () => {
            const fieldname = addField.querySelector(".tablepro-input-field")?.value?.trim();
            const source_key = columns[0]?.key; // use first column as source doc name
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
            const col = columns.find((c) => c.key === key);
            if (!col) return;
            const row = document.createElement("div");
            row.className = "tablepro-panel-row";
            row.innerHTML = `
              <label><input type="checkbox" ${state.hidden.has(key) ? "" : "checked"}> ${col.label}</label>
              <div class="tablepro-panel-actions">
                <button type="button" class="btn-secondary up">↑</button>
                <button type="button" class="btn-secondary down">↓</button>
              </div>
            `;
            const cb = row.querySelector("input");
            const up = row.querySelector(".up");
            const down = row.querySelector(".down");
            cb?.addEventListener("change", (e) => {
              if (e.target.checked) state.hidden.delete(key);
              else state.hidden.add(key);
              applyAll();
              persist();
            });
            up?.addEventListener("click", () => {
              if (idx === 0) return;
              const tmp = state.order[idx - 1];
              state.order[idx - 1] = state.order[idx];
              state.order[idx] = tmp;
              renderPanel();
              applyAll();
              persist();
            });
            down?.addEventListener("click", () => {
              if (idx >= state.order.length - 1) return;
              const tmp = state.order[idx + 1];
              state.order[idx + 1] = state.order[idx];
              state.order[idx] = tmp;
              renderPanel();
              applyAll();
              persist();
            });
            panel.appendChild(row);
          });
        };
        renderPanel();

        toolbar.querySelector(".tablepro-btn-columns")?.addEventListener("click", () => {
          panel.style.display = panel.style.display === "none" ? "block" : "none";
        });
        toolbar.querySelector(".tablepro-btn-filters")?.addEventListener("click", () => {
          state.show_filters = !state.show_filters;
          ensureFilterRow();
          persist();
        });
        toolbar.querySelector(".tablepro-btn-reset")?.addEventListener("click", async () => {
          state.order = columns.map((c) => c.key);
          state.hidden = new Set();
          state.widths = {};
          state.filters = {};
          state.show_filters = false;
          state.dynamic_fields = [];
          renderPanel();
          await applyAll();
          persist();
        });

        const onDocClick = (ev) => {
          if (panel.style.display === "none") return;
          if (!toolbar.contains(ev.target)) {
            panel.style.display = "none";
          }
        };
        document.addEventListener("mousedown", onDocClick);

        addResizeHandles();
        await applyAll();

        table.dataset.tableproCleanup = "1";
        table._tableproCleanup = () => {
          document.removeEventListener("mousedown", onDocClick);
        };
      }
    };

    init();
    return () => {
      destroyed = true;
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
        if (table) delete table.dataset.tableproInitialized;
      }
    };
  }, [pathname, role, prefsApi, user?.email]);

  return null;
}
