import { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useTableRowLimit, useResetOnRowLimitChange } from "../../context/TableRowLimitContext";
import TableRowsLimitFooter from "../../components/TableRowsLimitFooter";
import { useDebounced } from "../../hooks/useDebounced";
import { pmApi } from "../../services/api";

const fmt = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });

function billingBadgeClass(status) {
  if (!status) return "new";
  const s = status.toLowerCase();
  if (s === "closed") return "completed";
  if (s === "invoiced") return "in-progress";
  if (s === "pending") return "in-progress";
  return "new";
}

export default function IMWorkDone() {
  const { imName } = useAuth();
  const { rowLimit } = useTableRowLimit();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const searchDebounced = useDebounced(search, 300);

  useResetOnRowLimitChange(() => {
    setRows([]);
    setLoading(true);
  });

  async function loadData() {
    setLoading(true);
    try {
      const filters = { im: imName || "" };
      if (searchDebounced.trim()) filters.search = searchDebounced.trim();
      const list = await pmApi.listWorkDoneRows(filters, rowLimit);
      setRows(Array.isArray(list) ? list : []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, [imName, rowLimit, searchDebounced]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Work Done</h1>
          <div className="page-subtitle">Completed work rows for your IM scope.</div>
        </div>
        <div className="page-actions">
          <button className="btn-secondary" onClick={loadData} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
        </div>
      </div>
      <div className="toolbar">
        <input
          type="search"
          placeholder="Search POID, dummy POID, execution, project, DUID, item…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: "0.84rem", minWidth: 280 }}
        />
      </div>
      <div className="page-content">
        <div className="data-table-wrapper">
          {loading ? (
            <div style={{ padding: 32, textAlign: "center", color: "#94a3b8" }}>Loading work done…</div>
          ) : rows.length === 0 ? (
            <div className="empty-state"><h3>No work done rows</h3></div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>POID</th>
                  <th>Dummy POID</th>
                  <th>Execution</th>
                  <th>Project</th>
                  <th>DUID</th>
                  <th>Item</th>
                  <th style={{ textAlign: "right" }}>Qty</th>
                  <th style={{ textAlign: "right" }}>Revenue</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.name}>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{r.po_dispatch || "—"}</td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.72rem", maxWidth: 140 }} title={(r.original_dummy_poid || "").trim() && String(r.original_dummy_poid) !== String(r.po_dispatch || "") ? `Original dummy POID: ${r.original_dummy_poid}` : ""}>
                      {(r.original_dummy_poid || "").trim() && String(r.original_dummy_poid) !== String(r.po_dispatch || "")
                        ? (r.original_dummy_poid || "").trim()
                        : "—"}
                    </td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.78rem" }}>{r.execution || "—"}</td>
                    <td>{r.project_code || "—"}</td>
                    <td>{r.site_code || "—"}</td>
                    <td>{r.item_code || "—"}</td>
                    <td style={{ textAlign: "right" }}>{fmt.format(r.executed_qty || 0)}</td>
                    <td style={{ textAlign: "right" }}>{fmt.format(r.revenue_sar || 0)}</td>
                    <td>
                      <span className={`status-badge ${billingBadgeClass(r.billing_status)}`}>
                        <span className="status-dot" />
                        {r.billing_status || "Pending"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <TableRowsLimitFooter
          placement="tableCard"
          loadedCount={rows.length}
          filteredCount={rows.length}
          filterActive={!!search}
        />
      </div>
    </div>
  );
}
