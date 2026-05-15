import { useNavigate, useLocation } from "react-router-dom";

const TABS = [
  { id: "command", label: "Command", path: "/dashboard" },
  { id: "commercial", label: "Commercial", path: "/commercial-dashboard" },
  { id: "ceo", label: "CEO View", path: "/ceo-dashboard" },
  { id: "pm", label: "PM View", path: "/pm-dashboard" },
  { id: "ops", label: "Operations", path: "/ops-dashboard" },
  { id: "pic", label: "PIC Overview", path: "/pic-dashboard" },
  { id: "financial", label: "Financial", path: "/financial-dashboard" },
  { id: "im-view", label: "IM View", path: "/im-dashboard-view" },
];

export default function DashboardSwitcher() {
  const navigate = useNavigate();
  const location = useLocation();

  const current = TABS.find((t) => location.pathname === t.path) || TABS[0];

  return (
    <div className="nd-switcher" style={{
      display: "flex", gap: 2, padding: 3,
      background: "#e2e8f0", borderRadius: 10,
      marginBottom: 14, width: "fit-content",
      flexWrap: "wrap",
    }}>
      {TABS.map((t) => {
        const active = t.path === current.path;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => navigate(t.path)}
            style={{
              padding: "5px 13px", fontSize: "0.73rem", fontWeight: 700,
              border: "none", borderRadius: 7, cursor: "pointer",
              background: active ? "#1565C0" : "transparent",
              color: active ? "#fff" : "#475569",
              whiteSpace: "nowrap",
              transition: "all 0.12s ease",
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
