import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { pmApi } from "../services/api";
import FieldGlobalTimerBar from "./FieldGlobalTimerBar";
import DataTablePro from "./DataTablePro";
import PullToRefresh from "./PullToRefresh";
import inetLogo from "../assets/inet-logo.png";

/* ── SVG Icon Components (Feather-style) ───────────────────── */
const icons = {
  dashboard: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
    </svg>
  ),
  upload: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 16 12 12 8 16" /><line x1="12" y1="12" x2="12" y2="21" />
      <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
    </svg>
  ),
  send: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  ),
  calendar: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  ),
  eye: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
    </svg>
  ),
  checkCircle: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  ),
  barChart: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="20" x2="12" y2="10" /><line x1="18" y1="20" x2="18" y2="4" />
      <line x1="6" y1="20" x2="6" y2="16" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  user: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
    </svg>
  ),
  clipboard: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
    </svg>
  ),
  tool: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  ),
  folder: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  ),
  clock: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  search: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  briefcase: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </svg>
  ),
  // Shield-with-check — distinct from `checkCircle` (used by Work Done)
  // so "Approvals" reads visually different in the sidebar.
  shieldCheck: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  ),
  dollar: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  ),
  package: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="16.5" y1="9.4" x2="7.5" y2="4.21" />
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  ),
  layers: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  ),
};

/* ── Navigation definitions per role ────────────────────────── */
const adminNav = [
  { to: "/dashboard",  label: "Dashboard",   icon: "dashboard" },
  { to: "/po-upload",  label: "PO Upload",   icon: "upload" },
  { to: "/po-dump",    label: "PO Dump",     icon: "barChart" },
  { to: "/projects",   label: "Projects",    icon: "folder" },
  { to: "/dispatch",   label: "Dispatch",    icon: "send" },
  { to: "/planning",   label: "Planning",    icon: "calendar" },
  { to: "/execution",  label: "Execution",   icon: "eye" },
  { to: "/work-done",  label: "Work Done",   icon: "checkCircle" },
  { to: "/issues-risks", label: "Issues & Risks", icon: "clipboard" },
  { to: "/backend",    label: "Backend",       icon: "briefcase" },
  { to: "/reports",    label: "Reports",     icon: "barChart" },
  { to: "/timesheets", label: "Time logs",   icon: "clock" },
  { to: "/approvals", label: "Approvals", icon: "shieldCheck" },
  { to: "/overview",   label: "Search / Overview", icon: "search" },
  { to: "/im-material-request", label: "Material Requests", icon: "package" },
  { to: "/masters",    label: "Masters",     icon: "settings" },
];

const imNav = [
  { to: "/im-dashboard", label: "My Dashboard", icon: "dashboard" },
  { to: "/im-projects",  label: "My Projects",  icon: "folder" },
  { to: "/im-teams",     label: "My Teams",     icon: "user" },
  { to: "/im-po-intake", label: "PO Control",       icon: "upload" },
  { to: "/im-dispatch",  label: "Rollout Planning", icon: "send" },
  { to: "/im-planning",  label: "Rollout Execution", icon: "calendar" },
  { to: "/im-execution", label: "Rollout Work Done", icon: "eye" },
  { to: "/im-work-done", label: "Work Done",    icon: "checkCircle" },
  { to: "/im-issues-risks", label: "Issues & Risks", icon: "clipboard" },
  { to: "/im-material-request", label: "Material Request", icon: "package" },
  { to: "/im-reports",   label: "Reports",      icon: "barChart" },
  { to: "/im-timesheets", label: "Time logs",   icon: "clock" },
];

const picNav = [
  { to: "/pic-dashboard", label: "PIC Dashboard",   icon: "dashboard" },
  { to: "/pic-tracker",   label: "PIC Tracker",     icon: "barChart" },
  { to: "/pic-invoice-tracker", label: "Invoice Tracker", icon: "dollar" },
  { to: "/pic-reports",   label: "Reports",         icon: "clipboard" },
];

const fieldNav = [
  { to: "/today", label: "Today's Work", shortLabel: "Today", icon: "clipboard" },
  { to: "/field-execute", label: "Execute", shortLabel: "Execute", icon: "tool" },
  { to: "/field-qc-ciag", label: "QC / CIAG", shortLabel: "QC", icon: "eye" },
  { to: "/field-history", label: "History", shortLabel: "History", icon: "checkCircle" },
  { to: "/field-my-stock", label: "Materials", shortLabel: "Stock", icon: "layers" },
  { to: "/field-timesheet", label: "Time log", shortLabel: "Time", icon: "clock" },
];

/* ── Chevron SVG ───────────────────────────────────────────── */
function ChevronLeft() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

export default function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, role, logout } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  /* IMs with `can_assign_backend=1` get the Backend menu item injected. */
  const [imCanBackend, setImCanBackend] = useState(false);
  useEffect(() => {
    if (role !== "im") return;
    let cancelled = false;
    (async () => {
      try {
        const res = await pmApi.getMyBackendCapability();
        if (!cancelled) setImCanBackend(!!res?.can_assign_backend);
      } catch {
        if (!cancelled) setImCanBackend(false);
      }
    })();
    return () => { cancelled = true; };
  }, [role]);

  /* Approval-queue dot for the sidebar:
     - PM / Admin: count of requests in `Pending PM Approval`
     - IM:        count of incoming requests in `Pending Source IM`
     Polls every 60 s for arrivals from elsewhere, AND listens for
     `inet:approvals-changed` so the dot updates instantly after the
     current user accepts / rejects / approves a request locally. */
  const [approvalDotCount, setApprovalDotCount] = useState(0);
  useEffect(() => {
    if (role !== "admin" && role !== "im") return;
    let cancelled = false;
    let timer = null;
    const poll = async () => {
      try {
        if (role === "admin") {
          const [teamList, cancelList] = await Promise.all([
            pmApi.listTeamAllocationRequests("pending_pm"),
            pmApi.listPendingCancelRequests("Pending PM Approval"),
          ]);
          const teamCount = (Array.isArray(teamList) ? teamList.length : 0);
          const cancelCount = (Array.isArray(cancelList) ? cancelList.length : 0);
          if (!cancelled) setApprovalDotCount(teamCount + cancelCount);
        } else {
          const list = await pmApi.listTeamAllocationRequests("incoming");
          const pending = (Array.isArray(list) ? list : []).filter(
            (r) => r.request_status === "Pending Source IM",
          );
          if (!cancelled) setApprovalDotCount(pending.length);
        }
      } catch {
        if (!cancelled) setApprovalDotCount(0);
      }
    };
    poll();
    timer = setInterval(poll, 60_000);
    const onChanged = () => poll();
    window.addEventListener("inet:approvals-changed", onChanged);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      window.removeEventListener("inet:approvals-changed", onChanged);
    };
  }, [role]);

  /* Pick nav items based on role */
  const navItems = useMemo(() => {
    if (role === "im") {
      if (!imCanBackend) return imNav;
      const out = [];
      imNav.forEach((item) => {
        out.push(item);
        if (item.to === "/im-po-intake") {
          out.push({ to: "/im-backend", label: "Backend", icon: "briefcase" });
        }
      });
      return out;
    }
    if (role === "field") return fieldNav;
    if (role === "pic") return picNav;
    return adminNav;
  }, [role, imCanBackend]);

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

  const sidebarWidth = collapsed ? 64 : 260;

  return (
    <div
      className={`app-layout${mobileNavOpen ? " app-layout--mobile-nav-open" : ""}`}
      data-role={role || ""}
    >
      <button
        type="button"
        className="sidebar-backdrop"
        aria-label="Close navigation"
        tabIndex={-1}
        onClick={() => setMobileNavOpen(false)}
      />
      <button
        type="button"
        className="mobile-menu-btn"
        aria-label="Open navigation menu"
        aria-expanded={mobileNavOpen}
        onClick={() => setMobileNavOpen((v) => !v)}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="4" y1="7" x2="20" y2="7" />
          <line x1="4" y1="12" x2="20" y2="12" />
          <line x1="4" y1="17" x2="20" y2="17" />
        </svg>
      </button>
      {/* ── Sidebar ─────────────────────────────────────────── */}
      <aside className={`sidebar${collapsed ? " collapsed" : ""}`}>
        {/* Toggle button */}
        <button
          className="sidebar-toggle"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <ChevronLeft />
        </button>

        {/* Brand */}
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">
            <img
              src={inetLogo}
              alt="INET Telecom"
              style={{ width: collapsed ? 28 : 32, height: "auto", objectFit: "contain", transition: "width 0.2s ease" }}
            />
          </div>
          {!collapsed && (
            <div className="sidebar-logo-text">
              <h2>INET PMS</h2>
              <div className="sidebar-tagline">OPERATIONS COMMAND</div>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="sidebar-nav">
          <span className="nav-section-label">Menu</span>
          {navItems.map((item) => {
            // Approvals dot — admin queue lives at /approvals; IM
            // incoming queue lives at /im-teams (the page hosts both
            // the All Teams picker and the Incoming requests tab).
            const showDot = approvalDotCount > 0 && (
              (role === "admin" && item.to === "/approvals")
              || (role === "im" && item.to === "/im-teams")
            );
            return (
              <NavLink
                key={item.to}
                className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
                to={item.to}
                data-tooltip={item.label}
                onClick={() => setMobileNavOpen(false)}
              >
                <span className="nav-icon" style={{ position: "relative" }}>
                  {icons[item.icon]}
                  {showDot && (
                    <span
                      aria-label={`${approvalDotCount} pending`}
                      title={`${approvalDotCount} pending`}
                      style={{
                        position: "absolute",
                        top: -4, right: -6,
                        minWidth: 14, height: 14, padding: "0 4px",
                        borderRadius: 999,
                        background: "#ef4444",
                        color: "#fff",
                        fontSize: "0.6rem",
                        fontWeight: 800,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        boxShadow: "0 0 0 2px var(--bg-sidebar, #0f172a)",
                        lineHeight: 1,
                      }}
                    >
                      {approvalDotCount > 9 ? "9+" : approvalDotCount}
                    </span>
                  )}
                </span>
                <span className="nav-text">{item.label}</span>
                {showDot && !collapsed && (
                  <span style={{
                    marginLeft: "auto",
                    minWidth: 18, height: 18, padding: "0 6px",
                    borderRadius: 999,
                    background: "#ef4444",
                    color: "#fff",
                    fontSize: "0.62rem",
                    fontWeight: 800,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}>
                    {approvalDotCount > 99 ? "99+" : approvalDotCount}
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>

        {/* Bottom actions */}
        {!collapsed && (
          <div className="sidebar-actions">
            <a href="/app" className="sidebar-action-link">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
              </svg>
              <span>Switch to Desk</span>
            </a>
          </div>
        )}

        {/* User footer */}
        <div className="sidebar-footer" ref={menuRef}>
          <div className="sidebar-user">
            <span className="sidebar-user-avatar">{initials}</span>
            {!collapsed && (
              <>
                <div className="sidebar-user-info">
                  <span className="sidebar-user-name">{user?.full_name || user?.email || "Guest"}</span>
                  <span className="sidebar-user-email">{user?.email || ""}</span>
                </div>
                <button
                  type="button"
                  className="sidebar-logout-btn"
                  onClick={handleLogout}
                  title="Log Out"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                </button>
              </>
            )}
          </div>
        </div>
      </aside>

      {/* ── Main Content ────────────────────────────────────── */}
      <main
        className="content"
        style={{
          marginLeft: sidebarWidth,
          width: `calc(100% - ${sidebarWidth}px)`,
        }}
      >
        <PullToRefresh />
        <FieldGlobalTimerBar role={role} />
        <DataTablePro />
        <div className="content-outlet">
          <Outlet />
        </div>
      </main>

      {role === "field" && (
        <nav className="field-dock" aria-label="Quick navigation">
          {fieldNav.map((item) => (
            <NavLink
              key={item.to}
              className={({ isActive }) => `field-dock-link${isActive ? " active" : ""}`}
              to={item.to}
              onClick={() => setMobileNavOpen(false)}
            >
              <span className="field-dock-icon">{icons[item.icon]}</span>
              <span className="field-dock-label">{item.shortLabel}</span>
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}
