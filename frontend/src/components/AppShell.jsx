import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const nav = [
  { to: "/dashboard", label: "Dashboard", icon: "grid" },
  { to: "/po-intake", label: "PO Intake", icon: "box" },
  { to: "/projects", label: "Projects", icon: "target" },
  { to: "/daily-updates", label: "Daily Updates", icon: "calendar" },
  { to: "/team-assignments", label: "Team Assignments", icon: "users" },
  { to: "/reports", label: "Reports", icon: "chart" },
];

const SV = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" };

function NavIcon({ name }) {
  switch (name) {
    case "grid":    return <svg {...SV}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>;
    case "box":     return <svg {...SV}><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4a2 2 0 0 0 1-1.73z"/><path d="M3.3 7l8.7 5 8.7-5"/><path d="M12 22V12"/></svg>;
    case "target":  return <svg {...SV}><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>;
    case "calendar":return <svg {...SV}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>;
    case "users":   return <svg {...SV}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
    case "chart":   return <svg {...SV}><path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 3-3"/></svg>;
    default: return null;
  }
}

export default function AppShell({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  /* close dropdown when clicking outside */
  useEffect(() => {
    const handler = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const current = useMemo(() => nav.find((n) => n.to === location.pathname)?.label || "INET PMS", [location.pathname]);

  const initials = useMemo(() => {
    const src = user?.full_name || user?.email || "";
    return src.split(/[\s@._-]/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() || "").join("") || "?";
  }, [user]);

  const handleLogout = async () => {
    setMenuOpen(false);
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <div className="app-layout">
      <aside className="sidebar">
        {/* ── Brand ── */}
        <div className="sidebar-logo">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div className="brand-mark" aria-hidden="true" />
            <div>
              <h2>INET PMS</h2>
              <div className="sidebar-tagline">Project Management</div>
            </div>
          </div>
        </div>

        {/* ── Navigation ── */}
        <nav className="sidebar-nav">
          <span className="nav-section-label">Menu</span>
          {nav.map((item) => (
            <Link
              key={item.to}
              className={`nav-item ${location.pathname === item.to ? "active" : ""}`}
              to={item.to}
            >
              <span className="nav-icon"><NavIcon name={item.icon} /></span>
              <span className="nav-label">{item.label}</span>
            </Link>
          ))}
        </nav>

        {/* ── User footer (next_pms style) ── */}
        <div className="sidebar-footer" ref={menuRef}>
          <div
            className={`sidebar-user${menuOpen ? " open" : ""}`}
            onClick={() => setMenuOpen((v) => !v)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && setMenuOpen((v) => !v)}
          >
            <span className="sidebar-user-avatar">{initials}</span>
            <div className="sidebar-user-info">
              <span className="sidebar-user-name">{user?.full_name || user?.email || "Guest"}</span>
              <span className="sidebar-user-email">{user?.email || ""}</span>
            </div>
            <svg className="sidebar-user-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>

            {/* Dropdown */}
            {menuOpen && (
              <div className="user-menu-dropdown" onClick={(e) => e.stopPropagation()}>
                <div className="user-menu-profile">
                  <div className="user-menu-avatar">{initials}</div>
                  <div>
                    <div className="user-menu-fullname">{user?.full_name || user?.email}</div>
                    <div className="user-menu-email">{user?.email}</div>
                  </div>
                </div>
                <div className="user-menu-divider" />
                <a href="/app" className="user-menu-item">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
                  <span>Switch to Desk</span>
                </a>
                <div className="user-menu-divider" />
                <button type="button" className="user-menu-item user-menu-logout" onClick={handleLogout}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
                  </svg>
                  <span>Log Out</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      <main className="content">
        <div className="topbar">
          <span className="topbar-route">{current}</span>
        </div>
        {children}
      </main>
    </div>
  );
}
