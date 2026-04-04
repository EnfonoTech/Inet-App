import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

/* ── Navigation definitions per role ────────────────────────── */
const adminNav = [
  { to: "/dashboard",  label: "Dashboard",        icon: "\u25C6" },
  { to: "/po-upload",  label: "PO Upload",         icon: "\u2191" },
  { to: "/dispatch",   label: "Dispatch",           icon: "\u2192" },
  { to: "/planning",   label: "Planning",           icon: "\u2630" },
  { to: "/execution",  label: "Execution",          icon: "\u25CE" },
  { to: "/work-done",  label: "Work Done",          icon: "\u2713" },
  { to: "/reports",    label: "Reports",            icon: "\u25EB" },
  { to: "/masters",    label: "Masters",            icon: "\u2699" },
];

const imNav = [
  { to: "/im-dashboard", label: "My Dashboard", icon: "\u25C6" },
];

const fieldNav = [
  { to: "/today", label: "Today's Work", icon: "\u25C6" },
];

export default function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, role, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  /* Close dropdown when clicking outside */
  useEffect(() => {
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  /* Pick nav items based on role */
  const navItems = useMemo(() => {
    if (role === "im") return imNav;
    if (role === "field") return fieldNav;
    return adminNav;
  }, [role]);

  /* Current page title for topbar */
  const current = useMemo(
    () => navItems.find((n) => location.pathname.startsWith(n.to))?.label || "INET PMS",
    [location.pathname, navItems]
  );

  /* User initials */
  const initials = useMemo(() => {
    const src = user?.full_name || user?.email || "";
    return src
      .split(/[\s@._-]/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() || "")
      .join("") || "?";
  }, [user]);

  const handleLogout = async () => {
    setMenuOpen(false);
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <div className="app-layout">
      {/* ── Sidebar ─────────────────────────────────────────── */}
      <aside className="sidebar">
        {/* Brand */}
        <div className="sidebar-logo">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div className="brand-mark" aria-hidden="true" />
            <div>
              <h2>INET PMS</h2>
              <div className="sidebar-tagline">Operations Command</div>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="sidebar-nav">
          <span className="nav-section-label">Menu</span>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}
              to={item.to}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        {/* User footer */}
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
            <svg
              className="sidebar-user-chevron"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
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
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="7" height="7" />
                    <rect x="14" y="3" width="7" height="7" />
                    <rect x="3" y="14" width="7" height="7" />
                    <rect x="14" y="14" width="7" height="7" />
                  </svg>
                  <span>Switch to Desk</span>
                </a>
                <div className="user-menu-divider" />
                <button type="button" className="user-menu-item user-menu-logout" onClick={handleLogout}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                  <span>Log Out</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* ── Main Content ────────────────────────────────────── */}
      <main className="content">
        <div className="topbar">
          <span className="topbar-route">{current}</span>
        </div>
        <Outlet />
      </main>
    </div>
  );
}
