import { useEffect, useMemo, useState } from "react";
import { pmApi } from "../services/api";
import DataTableWrapper from "./DataTableWrapper";
import { useDebounced } from "../hooks/useDebounced";
import { useTableRowLimit } from "../context/TableRowLimitContext";

/**
 * The DSA register — see docs/DSA_MAPPING.md.
 *
 * Purpose-built rather than reusing the Bill Wise report: that one needs
 * the batch-tracked Receipt flow for its quantities and filters to
 * subcon = 'INET', so with no receipts it returns 0 rows of 9,866. A flow
 * with no receipts is exactly what it cannot show.
 *
 * Scoped server-side to the IM's own sites. There is no "close" action:
 * CIAG closes a DSA, and the column here reads that state rather than
 * keeping a second copy of it.
 */
export default function DsaRegisterTab({ imName }) {
  const { rowLimit } = useTableRowLimit();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [search, setSearch] = useState("");
  const [mapped, setMapped] = useState("");
  const searchDebounced = useDebounced(search, 300);

  useEffect(() => {
    let dead = false;
    setLoading(true);
    pmApi.listDsaRegister({
      im: imName || undefined,
      mapped: mapped || undefined,
      search: searchDebounced || undefined,
      limit: rowLimit,
    })
      .then((res) => {
        if (dead) return;
        setEnabled(!!res?.enabled);
        setRows(res?.rows || []);
      })
      .catch(() => { if (!dead) setRows([]); })
      .finally(() => { if (!dead) setLoading(false); });
    return () => { dead = true; };
  }, [imName, mapped, searchDebounced, rowLimit]);

  const counts = useMemo(() => ({
    total: rows.length,
    mapped: rows.filter((r) => (r.mapped_on || []).length).length,
    closed: rows.filter((r) => r.closed).length,
  }), [rows]);

  if (!enabled) {
    return (
      <div style={{ padding: 20, color: "#94a3b8", fontSize: "0.86rem" }}>
        DSA mapping is turned off. Enable it in INET Settings → Features.
      </div>
    );
  }

  return (
    <>
      <div className="toolbar">
        <input value={search} onChange={(e) => setSearch(e.target.value)}
               placeholder="Search DSA, MSA, DUID, project…"
               style={{ minWidth: 240, padding: "6px 10px", fontSize: "0.84rem",
                        border: "1px solid #e2e8f0", borderRadius: 6 }} />
        <select value={mapped} onChange={(e) => setMapped(e.target.value)}
                style={{ padding: "6px 8px", fontSize: "0.84rem", borderRadius: 6, border: "1px solid #e2e8f0" }}>
          <option value="">All</option>
          <option value="no">Not mapped</option>
          <option value="yes">Mapped</option>
        </select>
        <span style={{ fontSize: "0.78rem", color: "#64748b" }}>
          {counts.total} DSA{counts.total === 1 ? "" : "s"} · {counts.mapped} mapped · {counts.closed} closed
        </span>
      </div>

      <div className="page-content">
        <DataTableWrapper loading={loading && rows.length > 0}>
          <table className="data-table" data-excel-filter-all="1" data-table-key="dsa-register-v1">
            <thead>
              <tr>
                <th>DSA</th>
                <th>MSA</th>
                <th>DU ID</th>
                <th>Project</th>
                <th>Subcon</th>
                <th>Outbound Status</th>
                <th>Outbound Date</th>
                <th>Mapped To</th>
                <th>CIAG</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
                    {loading ? "Loading…" : "No DSAs for your sites."}
                  </td>
                </tr>
              ) : rows.map((r) => (
                <tr key={r.name}>
                  <td style={{ fontFamily: "monospace", fontSize: "0.78rem", fontWeight: 700 }}>{r.bill_no}</td>
                  <td style={{ fontFamily: "monospace", fontSize: "0.76rem", color: "#64748b" }}>{r.request_no || "—"}</td>
                  <td style={{ fontSize: "0.8rem" }}>{r.du_id || "—"}</td>
                  <td style={{ fontSize: "0.8rem" }}>{r.project_name || "—"}</td>
                  <td style={{ fontSize: "0.8rem" }}>{r.subcon || "—"}</td>
                  <td style={{ fontSize: "0.8rem" }}>{r.outbound_status || "—"}</td>
                  <td style={{ fontSize: "0.8rem", whiteSpace: "nowrap" }}>
                    {r.outbound_date ? String(r.outbound_date).slice(0, 10) : "—"}
                  </td>
                  <td style={{ fontSize: "0.76rem", fontFamily: "monospace" }}>
                    {(r.mapped_on || []).length ? r.mapped_on.join(", ") : <span style={{ color: "#cbd5e1" }}>—</span>}
                  </td>
                  <td>
                    {r.closed ? (
                      <span style={{ fontSize: "0.7rem", fontWeight: 700, color: "#047857", background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 999, padding: "1px 7px" }}>Closed</span>
                    ) : (r.mapped_on || []).length ? (
                      <span style={{ fontSize: "0.7rem", fontWeight: 700, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 999, padding: "1px 7px" }}>Open</span>
                    ) : <span style={{ color: "#cbd5e1" }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataTableWrapper>
      </div>
    </>
  );
}
