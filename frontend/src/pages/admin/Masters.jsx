import { useEffect, useState } from "react";

// Correct Frappe doctype names + display fields for each master
const MASTER_DOCTYPES = [
  {
    label: "Area",
    doctype: "Area Master",
    description: "Geographic service areas",
    icon: "📍",
    color: "var(--blue)",
    fields: ["name", "area_name", "region"],
  },
  {
    label: "INET Team",
    doctype: "INET Team",
    description: "Installation and execution teams",
    icon: "👥",
    color: "var(--green)",
    fields: ["name", "team_name", "im", "team_type", "status"],
  },
  {
    label: "Subcontractor",
    doctype: "Subcontractor Master",
    description: "External subcontract partners",
    icon: "🔧",
    color: "var(--amber)",
    fields: ["name", "subcontractor_name", "contact", "status"],
  },
  {
    label: "Customer Item",
    doctype: "Customer Item Master",
    description: "Customer-specific item codes",
    icon: "📦",
    color: "var(--blue)",
    fields: ["name", "customer", "item_code", "customer_item_code"],
  },
  {
    label: "Activity Cost",
    doctype: "Activity Cost Master",
    description: "Cost definitions per activity type",
    icon: "💰",
    color: "var(--green)",
    fields: ["name", "activity_type", "billing_rate", "costing_rate"],
  },
  {
    label: "Item Catalog",
    doctype: "Item",
    description: "Master catalog of work items",
    icon: "🗂",
    color: "var(--amber)",
    fields: ["name", "item_name", "item_group", "stock_uom"],
  },
  {
    label: "Project",
    doctype: "Project Control Center",
    description: "Project master records",
    icon: "📋",
    color: "var(--blue)",
    fields: ["name", "project_code", "project_name", "project_status", "implementation_manager"],
  },
  {
    label: "Customer",
    doctype: "Customer",
    description: "Customer master list",
    icon: "🏢",
    color: "var(--green)",
    fields: ["name", "customer_name", "customer_group", "territory"],
  },
  {
    label: "Visit Multiplier",
    doctype: "Visit Multiplier Master",
    description: "Visit frequency multipliers",
    icon: "🔢",
    color: "var(--amber)",
    fields: ["name", "multiplier_type", "multiplier_value"],
  },
];

// Fetch count for a doctype using frappe.client.get_count via REST
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

// Fetch list records for a doctype
async function fetchRecords(doctype, fields) {
  const fieldParam = encodeURIComponent(JSON.stringify(fields));
  try {
    const res = await fetch(
      `/api/resource/${encodeURIComponent(doctype)}?fields=${fieldParam}&limit_page_length=100`,
      { credentials: "include" }
    );
    const json = await res.json();
    return json?.data || [];
  } catch {
    return [];
  }
}

function MasterCard({ doctype, label, description, icon, color, count, isExpanded, onToggle }) {
  return (
    <div
      className="panel"
      style={{
        cursor: "pointer",
        transition: "all var(--transition)",
        outline: isExpanded ? `2px solid ${color}` : "none",
      }}
      onClick={onToggle}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "4px 0 8px" }}>
        <div style={{
          fontSize: "1.5rem",
          width: 40,
          height: 40,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(10,22,40,0.5)",
          borderRadius: "var(--radius-sm)",
          flexShrink: 0,
        }}>
          {icon}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: "0.9rem", color: "var(--text-primary)", marginBottom: 2 }}>
            {label}
          </div>
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: 8 }}>
            {description}
          </div>
          {count !== null && count !== undefined ? (
            <div style={{ fontSize: "1.2rem", fontWeight: 800, color }}>
              {count}
            </div>
          ) : (
            <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
              Loading…
            </div>
          )}
        </div>
      </div>
      <div style={{
        marginTop: 8,
        paddingTop: 10,
        borderTop: "1px solid var(--border-subtle)",
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontSize: "0.72rem",
        color,
        fontWeight: 600,
      }}>
        {isExpanded ? "▲ Hide records" : "▼ View records"}
      </div>
    </div>
  );
}

function RecordsTable({ doctype, fields }) {
  const [records, setRecords] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchRecords(doctype, fields).then((rows) => {
      setRecords(rows);
      setLoading(false);
    });
  }, [doctype, fields]);

  if (loading) {
    return (
      <div style={{ padding: "20px", textAlign: "center", color: "var(--text-muted)", fontSize: "0.85rem" }}>
        Loading records…
      </div>
    );
  }

  if (!records || records.length === 0) {
    return (
      <div style={{ padding: "20px", textAlign: "center", color: "var(--text-muted)", fontSize: "0.85rem" }}>
        No records found.
      </div>
    );
  }

  // Determine display columns: skip "name" if other identifier fields exist, but keep it for reference
  const displayFields = fields.filter((f) => f !== "name");
  const allCols = ["name", ...displayFields];

  return (
    <div className="data-table-wrapper" style={{ marginTop: 0 }}>
      <table className="data-table">
        <thead>
          <tr>
            {allCols.map((f) => (
              <th key={f} style={{ textTransform: "capitalize" }}>
                {f.replace(/_/g, " ")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {records.map((row, idx) => (
            <tr key={idx}>
              {allCols.map((f) => (
                <td key={f}>{row[f] ?? "–"}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Masters() {
  const [counts, setCounts] = useState({});
  const [expandedDoctype, setExpandedDoctype] = useState(null);

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
    setExpandedDoctype((prev) => (prev === doctype ? null : doctype));
  }

  const expanded = MASTER_DOCTYPES.find((m) => m.doctype === expandedDoctype);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Masters</h1>
          <div className="page-subtitle">Reference data — click a card to view records inline</div>
        </div>
      </div>

      <div className="page-content">
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
          gap: 14,
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
          <div className="panel" style={{ marginTop: 20 }}>
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 14,
            }}>
              <div style={{ fontWeight: 700, fontSize: "1rem", color: "var(--text-primary)" }}>
                {expanded.icon} {expanded.label} Records
                {counts[expanded.doctype] !== undefined && (
                  <span style={{ marginLeft: 8, fontSize: "0.78rem", color: "var(--text-muted)", fontWeight: 400 }}>
                    ({counts[expanded.doctype]} total)
                  </span>
                )}
              </div>
              <button
                className="btn-secondary"
                style={{ fontSize: "0.78rem", padding: "4px 12px" }}
                onClick={() => setExpandedDoctype(null)}
              >
                Close
              </button>
            </div>
            <RecordsTable doctype={expanded.doctype} fields={expanded.fields} />
          </div>
        )}
      </div>
    </div>
  );
}
