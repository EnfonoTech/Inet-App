import { useEffect, useState } from "react";
import DataTableWrapper from "../../components/DataTableWrapper";
import { useSearchParams } from "react-router-dom";
import { useTableRowLimit } from "../../context/TableRowLimitContext";
import TableRowsLimitFooter from "../../components/TableRowsLimitFooter";

// Correct Frappe doctype names + actual field names from each doctype JSON
const MASTER_DOCTYPES = [
  {
    label: "Area",
    doctype: "Area Master",
    description: "Geographic service areas",
    icon: "📍",
    color: "#3b82f6",
    fields: ["name", "area_code", "area_name"],
    displayCols: ["area_code", "area_name"],
  },
  {
    label: "INET Team",
    doctype: "INET Team",
    description: "Installation and execution teams",
    icon: "👥",
    color: "#22c55e",
    fields: ["name", "team_name", "im", "team_type", "status"],
    displayCols: ["team_name", "im", "team_type", "status"],
  },
  {
    label: "IM Master",
    doctype: "IM Master",
    description: "Implementation Manager profiles & cost rates",
    icon: "👤",
    color: "#8b5cf6",
    fields: ["name", "full_name", "email", "monthly_cost_sar", "daily_cost_sar", "status"],
    displayCols: ["full_name", "email", "monthly_cost_sar", "daily_cost_sar", "status"],
  },
  {
    label: "Project Domain",
    doctype: "Project Domain",
    description: "Project domain categories",
    icon: "🌐",
    color: "#0d9488",
    fields: ["name", "domain_name", "status", "description"],
    displayCols: ["domain_name", "status", "description"],
  },
  {
    label: "Huawei IM",
    doctype: "Huawei IM",
    description: "Huawei implementation manager contacts",
    icon: "📱",
    color: "#ea580c",
    fields: ["name", "full_name", "email", "phone", "status"],
    displayCols: ["full_name", "email", "phone", "status"],
  },
  {
    label: "Subcontractor",
    doctype: "Subcontractor Master",
    description: "External subcontract partners",
    icon: "🔧",
    color: "#f59e0b",
    fields: ["name", "subcontractor_name", "type", "contract_model", "status"],
    displayCols: ["subcontractor_name", "type", "contract_model", "status"],
  },
  {
    label: "Customer Item",
    doctype: "Customer Item Master",
    description: "Customer-specific billing rates",
    icon: "📦",
    color: "#6366f1",
    fields: ["name", "customer", "item_code", "item_description", "standard_rate_sar"],
    displayCols: ["customer", "item_code", "item_description", "standard_rate_sar"],
  },
  {
    label: "Activity Cost",
    doctype: "Activity Cost Master",
    description: "Cost definitions per activity type",
    icon: "💰",
    color: "#14b8a6",
    fields: ["name", "activity_code", "standard_activity", "category", "base_cost_sar"],
    displayCols: ["activity_code", "standard_activity", "category", "base_cost_sar"],
  },
  {
    label: "Item Catalog",
    doctype: "Item",
    description: "Master catalog of work items",
    icon: "🗂",
    color: "#8b5cf6",
    fields: ["name", "item_name", "item_group", "stock_uom"],
    displayCols: ["item_name", "item_group", "stock_uom"],
  },
  {
    label: "Project",
    doctype: "Project Control Center",
    description: "Project master records",
    icon: "📋",
    color: "#0ea5e9",
    fields: ["name", "project_code", "project_name", "project_status", "implementation_manager"],
    displayCols: ["project_code", "project_name", "project_status", "implementation_manager"],
  },
  {
    label: "Customer",
    doctype: "Customer",
    description: "Customer master list",
    icon: "🏢",
    color: "#22c55e",
    fields: ["name", "customer_name", "customer_group", "territory"],
    displayCols: ["customer_name", "customer_group", "territory"],
  },
  {
    label: "Visit Multiplier",
    doctype: "Visit Multiplier Master",
    description: "Visit frequency multipliers",
    icon: "🔢",
    color: "#f59e0b",
    fields: ["name", "visit_type", "multiplier", "notes"],
    displayCols: ["visit_type", "multiplier", "notes"],
  },
];

function deskUrl(doctype, name) {
  return `/app/${doctype.toLowerCase().replace(/ /g, "-")}/${encodeURIComponent(name)}`;
}

function deskNewUrl(doctype) {
  return `/app/${doctype.toLowerCase().replace(/ /g, "-")}/new`;
}

async function fetchCount(doctype) {
  try {
    const res = await fetch(
      `/api/method/frappe.client.get_count?doctype=${encodeURIComponent(doctype)}`,
      { credentials: "include" }
    );
    const json = await res.json();
    if (json?.message !== undefined) return json.message;
    return "–";
  } catch {
    return "–";
  }
}

async function fetchRecords(doctype, fields, limit) {
  const fieldParam = encodeURIComponent(JSON.stringify(fields));
  const n = Number(limit);
  const lim = n === 0 ? 0 : n > 0 ? Math.min(n, 10000) : 200;
  try {
    const res = await fetch(
      `/api/resource/${encodeURIComponent(doctype)}?fields=${fieldParam}&limit_page_length=${lim}&order_by=modified+desc`,
      { credentials: "include" }
    );
    const json = await res.json();
    return json?.data || [];
  } catch {
    return [];
  }
}

function MasterCard({ label, description, icon, color, count, isExpanded, onToggle, doctype }) {
  return (
    <div
      onClick={onToggle}
      style={{
        background: "#fff",
        border: isExpanded ? `2px solid ${color}` : "1px solid #e2e8f0",
        borderRadius: 10,
        padding: "18px 20px",
        cursor: "pointer",
        transition: "all 0.15s ease",
        boxShadow: isExpanded ? `0 0 0 3px ${color}20` : "0 1px 3px rgba(0,0,0,0.06)",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
        <div style={{
          fontSize: "1.4rem",
          width: 44,
          height: 44,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: `${color}12`,
          borderRadius: 8,
          flexShrink: 0,
        }}>
          {icon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: "0.92rem", color: "#1e293b", marginBottom: 2 }}>
            {label}
          </div>
          <div style={{ fontSize: "0.76rem", color: "#94a3b8", lineHeight: 1.3 }}>
            {description}
          </div>
        </div>
      </div>
      <div style={{
        marginTop: 14,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <div style={{ fontSize: "1.5rem", fontWeight: 800, color }}>
          {count !== null && count !== undefined ? count : "..."}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <a
            href={deskNewUrl(doctype)}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{
              fontSize: "0.7rem",
              color: "#fff",
              background: color,
              fontWeight: 600,
              padding: "3px 10px",
              borderRadius: 6,
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
            }}
          >
            + New
          </a>
          <div style={{
            fontSize: "0.72rem",
            color,
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}>
            {isExpanded ? "▲ Hide" : "▼ View"}
          </div>
        </div>
      </div>
    </div>
  );
}

function RecordsTable({ doctype, fields, displayCols, rowLimit }) {
  const [records, setRecords] = useState(null);
  const [loading, setLoading] = useState(true);
  const [prevRowLimit, setPrevRowLimit] = useState(rowLimit);
  if (prevRowLimit !== rowLimit) {
    setPrevRowLimit(rowLimit);
    setRecords(null);
    setLoading(true);
  }

  useEffect(() => {
    setLoading(true);
    fetchRecords(doctype, fields, rowLimit).then((rows) => {
      setRecords(rows);
      setLoading(false);
    });
  }, [doctype, rowLimit]);

  if (loading) {
    return (
      <div style={{ padding: 24, textAlign: "center", color: "#94a3b8", fontSize: "0.85rem" }}>
        Loading records...
      </div>
    );
  }

  if (!records || records.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: "center", color: "#94a3b8", fontSize: "0.85rem" }}>
        No records found.
      </div>
    );
  }

  const cols = displayCols && displayCols.length > 0 ? displayCols : fields.filter((f) => f !== "name");

  return (
    <>
    <DataTableWrapper style={{ marginTop: 0 }}>
      <table className="data-table">
        <thead>
          <tr>
            <th style={{ width: 40, color: "#94a3b8" }}>#</th>
            <th>Name / ID</th>
            {cols.map((f) => (
              <th key={f} style={{ textTransform: "capitalize" }}>
                {f.replace(/_/g, " ")}
              </th>
            ))}
            <th style={{ width: 80, textAlign: "center" }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {records.map((row, idx) => (
            <tr key={idx}>
              <td style={{ color: "#94a3b8", fontSize: "0.75rem" }}>{idx + 1}</td>
              <td>
                <a
                  href={deskUrl(doctype, row.name)}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "#2563eb", fontWeight: 600, textDecoration: "none", fontSize: "0.82rem" }}
                >
                  {row.name}
                </a>
              </td>
              {cols.map((f) => (
                <td key={f}>{row[f] ?? "–"}</td>
              ))}
              <td style={{ textAlign: "center" }}>
                <a
                  href={deskUrl(doctype, row.name)}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    fontSize: "0.72rem",
                    color: "#2563eb",
                    fontWeight: 600,
                    textDecoration: "none",
                    padding: "3px 10px",
                    border: "1px solid #dbeafe",
                    borderRadius: 6,
                    background: "#eff6ff",
                  }}
                >
                  Edit
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </DataTableWrapper>
    <TableRowsLimitFooter placement="tableCard" loadedCount={records.length} />
    </>
  );
}

export default function Masters() {
  const { rowLimit } = useTableRowLimit();
  const [searchParams, setSearchParams] = useSearchParams();
  const [counts, setCounts] = useState({});
  const [expandedDoctype, setExpandedDoctype] = useState(null);

  useEffect(() => {
    const raw = searchParams.get("expand");
    if (!raw) {
      setExpandedDoctype(null);
      return;
    }
    const decoded = decodeURIComponent(raw);
    const ok = MASTER_DOCTYPES.some((m) => m.doctype === decoded);
    setExpandedDoctype(ok ? decoded : null);
  }, [searchParams]);

  useEffect(() => {
    const loadCounts = async () => {
      const results = {};
      await Promise.all(
        MASTER_DOCTYPES.map(async (m) => {
          results[m.doctype] = await fetchCount(m.doctype);
        })
      );
      setCounts({ ...results });
    };
    loadCounts();
  }, []);

  function toggleExpand(doctype) {
    const next = expandedDoctype === doctype ? null : doctype;
    setExpandedDoctype(next);
    if (next) setSearchParams({ expand: next }, { replace: true });
    else setSearchParams({}, { replace: true });
  }

  const expanded = MASTER_DOCTYPES.find((m) => m.doctype === expandedDoctype);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Masters</h1>
          <div className="page-subtitle">Reference data — click a card to view, create or edit records</div>
        </div>
      </div>

      <div className="page-content">
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
          gap: 16,
        }}>
          {MASTER_DOCTYPES.map((m) => (
            <MasterCard
              key={m.doctype}
              {...m}
              count={counts[m.doctype]}
              isExpanded={expandedDoctype === m.doctype}
              onToggle={() => toggleExpand(m.doctype)}
            />
          ))}
        </div>

        {expanded && (
          <div style={{
            marginTop: 20,
            background: "#fff",
            border: "1px solid #e2e8f0",
            borderRadius: 10,
            padding: "20px 24px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
          }}>
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 14,
            }}>
              <div style={{ fontWeight: 700, fontSize: "1rem", color: "#1e293b" }}>
                {expanded.icon} {expanded.label} Records
                {counts[expanded.doctype] !== undefined && (
                  <span style={{ marginLeft: 8, fontSize: "0.78rem", color: "#94a3b8", fontWeight: 400 }}>
                    ({counts[expanded.doctype]} total)
                  </span>
                )}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <a
                  href={deskNewUrl(expanded.doctype)}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-primary"
                  style={{ fontSize: "0.78rem", padding: "6px 16px", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}
                >
                  + New {expanded.label}
                </a>
                <button
                  className="btn-secondary"
                  style={{ fontSize: "0.78rem", padding: "4px 14px" }}
                  onClick={() => {
                    setExpandedDoctype(null);
                    setSearchParams({}, { replace: true });
                  }}
                >
                  Close
                </button>
              </div>
            </div>
            <RecordsTable doctype={expanded.doctype} fields={expanded.fields} displayCols={expanded.displayCols} rowLimit={rowLimit} />
          </div>
        )}
      </div>
    </div>
  );
}
