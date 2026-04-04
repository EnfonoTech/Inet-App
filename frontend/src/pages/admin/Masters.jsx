import { useEffect, useState } from "react";

const MASTER_DOCTYPES = [
  {
    label: "Area",
    doctype: "Area",
    description: "Geographic service areas",
    icon: "📍",
    color: "var(--blue)",
  },
  {
    label: "INET Team",
    doctype: "INET Team",
    description: "Installation and execution teams",
    icon: "👥",
    color: "var(--green)",
  },
  {
    label: "Subcontractor",
    doctype: "Subcontractor",
    description: "External subcontract partners",
    icon: "🔧",
    color: "var(--amber)",
  },
  {
    label: "Customer Item",
    doctype: "Customer Item",
    description: "Customer-specific item codes",
    icon: "📦",
    color: "var(--blue)",
  },
  {
    label: "Activity Cost",
    doctype: "Activity Cost",
    description: "Cost definitions per activity type",
    icon: "💰",
    color: "var(--green)",
  },
  {
    label: "Item Catalog",
    doctype: "Item Catalog",
    description: "Master catalog of work items",
    icon: "🗂",
    color: "var(--amber)",
  },
  {
    label: "Project",
    doctype: "Project Management",
    description: "Project master records",
    icon: "📋",
    color: "var(--blue)",
  },
  {
    label: "Customer",
    doctype: "Customer",
    description: "Customer master list",
    icon: "🏢",
    color: "var(--green)",
  },
];

function MasterCard({ doctype, label, description, icon, color, count }) {
  const deskUrl = `/app/${doctype.toLowerCase().replace(/\s+/g, "-")}`;

  return (
    <div
      className="panel"
      style={{ cursor: "pointer", transition: "all var(--transition)" }}
      onClick={() => window.open(deskUrl, "_blank")}
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
        color: "var(--blue)",
        fontWeight: 600,
      }}>
        Open in Frappe Desk →
      </div>
    </div>
  );
}

export default function Masters() {
  const [counts, setCounts] = useState({});
  const [activeTab, setActiveTab] = useState("overview");

  useEffect(() => {
    // Load counts for each doctype
    const loadCounts = async () => {
      const results = {};
      for (const master of MASTER_DOCTYPES) {
        try {
          const res = await fetch(
            `/api/resource/${encodeURIComponent(master.doctype)}?limit_page_length=1&fields=["name"]`,
            { credentials: "include" }
          );
          const json = await res.json();
          // Frappe returns total_count header or estimate via data length
          results[master.doctype] = json?.data?.length !== undefined
            ? (json._meta?.total_count ?? json.data.length)
            : "–";
        } catch {
          results[master.doctype] = "–";
        }
      }
      setCounts(results);
    };
    loadCounts();
  }, []);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Masters</h1>
          <div className="page-subtitle">Reference data and master records — click to open in Frappe Desk</div>
        </div>
        <div className="page-actions">
          <a
            href="/app"
            target="_blank"
            rel="noreferrer"
            className="btn-secondary"
            style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            Open Frappe Desk
          </a>
        </div>
      </div>

      <div className="tabs">
        <button
          className={`tab ${activeTab === "overview" ? "active" : ""}`}
          onClick={() => setActiveTab("overview")}
        >
          Overview
        </button>
        <button
          className={`tab ${activeTab === "teams" ? "active" : ""}`}
          onClick={() => setActiveTab("teams")}
        >
          Teams & People
        </button>
        <button
          className={`tab ${activeTab === "items" ? "active" : ""}`}
          onClick={() => setActiveTab("items")}
        >
          Items & Costs
        </button>
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
            />
          ))}
        </div>

        <div className="notice info" style={{ marginTop: 24 }}>
          <span>ℹ</span>
          Master data is managed directly in Frappe Desk. Click any card above to open the list view. Changes made in Frappe Desk are immediately reflected in the Command Center.
        </div>
      </div>
    </div>
  );
}
