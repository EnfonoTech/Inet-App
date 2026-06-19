import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useNotifications } from "../hooks/useNotifications";

const TIER_COLOR = {
  critical: "#ef4444",
  alert:    "#f59e0b",
  info:     "#3b82f6",
};

const TIER_LABEL = {
  critical: "Critical",
  alert:    "Alert",
  info:     "Info",
};

function timeAgo(isoStr) {
  if (!isoStr) return "";
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function docUrl(notif) {
  // Only use explicitly set links — never auto-generate ERPNext /app/ URLs
  return notif.link || null;
}

const BellSvg = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
);

/* variant: "sidebar" | "dock" */
export default function NotificationBell({ collapsed, variant = "sidebar" }) {
  const { notifications, unreadCount, loading, markAsRead, markAllRead } = useNotifications();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [panelPos, setPanelPos] = useState({});
  const panelRef = useRef(null);
  const bellRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target) &&
        bellRef.current && !bellRef.current.contains(e.target)
      ) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const togglePanel = () => {
    if (!open && bellRef.current) {
      const rect = bellRef.current.getBoundingClientRect();
      const PANEL_W = 328;
      if (variant === "dock") {
        // Opens upward above the dock, centered on bell
        const leftIdeal = rect.left + rect.width / 2 - PANEL_W / 2;
        setPanelPos({
          bottom: window.innerHeight - rect.top + 8,
          top: "auto",
          left: Math.max(8, Math.min(window.innerWidth - PANEL_W - 8, leftIdeal)),
        });
      } else if (variant === "top-float") {
        // Opens downward; align left edge to button when bell is on left,
        // or clamp so the panel stays within viewport
        const leftAligned = rect.left;
        setPanelPos({
          top: rect.bottom + 8,
          bottom: "auto",
          left: Math.min(leftAligned, window.innerWidth - PANEL_W - 8),
        });
      } else {
        // Sidebar: opens to the right, top-aligned near the bell
        setPanelPos({
          top: Math.max(8, rect.top),
          bottom: "auto",
          left: rect.right + 8,
        });
      }
    }
    setOpen((v) => !v);
  };

  const handleNotifClick = (notif) => {
    // Mark as read immediately (optimistic update) — don't await so navigation is instant
    if (!notif.read) markAsRead(notif.name);
    setOpen(false);
    const url = docUrl(notif);
    if (!url) return;
    if (url.startsWith("/pms")) {
      navigate(url.slice(4) || "/");
    } else {
      window.open(url, "_blank", "noopener");
    }
  };

  const panel = open && (
    <div
      ref={panelRef}
      style={{
        position: "fixed",
        ...panelPos,
        width: 328,
        maxHeight: 420,
        background: "#ffffff",
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
        display: "flex",
        flexDirection: "column",
        zIndex: 9999,
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 16px",
        borderBottom: "1px solid #f1f5f9",
        background: "#f8fafc",
        flexShrink: 0,
      }}>
        <span style={{ fontSize: "0.85rem", fontWeight: 700, color: "#1e293b" }}>
          Notifications
          {unreadCount > 0 && (
            <span style={{ marginLeft: 6, color: "#ef4444" }}>({unreadCount})</span>
          )}
        </span>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); markAllRead(); }}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "#3b82f6", fontSize: "0.75rem", fontWeight: 600, padding: 0,
            }}
          >
            Mark all read
          </button>
        )}
      </div>

      {/* List */}
      <div style={{ overflowY: "auto", flex: 1 }}>
        {loading && (
          <div style={{ padding: "28px 0", textAlign: "center", color: "#94a3b8", fontSize: "0.82rem" }}>
            Loading…
          </div>
        )}
        {!loading && notifications.length === 0 && (
          <div style={{ padding: "36px 16px", textAlign: "center", color: "#94a3b8", fontSize: "0.84rem" }}>
            No notifications
          </div>
        )}
        {!loading && notifications.map((notif) => (
          <button
            key={notif.name}
            type="button"
            onClick={() => handleNotifClick(notif)}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              width: "100%",
              padding: "10px 14px",
              background: notif.read ? "#fff" : "#eff6ff",
              border: "none",
              borderBottom: "1px solid #f1f5f9",
              cursor: "pointer",
              textAlign: "left",
              transition: "background 0.1s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#f8fafc")}
            onMouseLeave={(e) => (e.currentTarget.style.background = notif.read ? "#fff" : "#eff6ff")}
          >
            {/* Tier indicator bar */}
            <span style={{
              width: 3,
              alignSelf: "stretch",
              borderRadius: 99,
              background: TIER_COLOR[notif.tier],
              flexShrink: 0,
              minHeight: 36,
            }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: "0.8rem",
                color: notif.read ? "#64748b" : "#1e293b",
                fontWeight: notif.read ? 400 : 600,
                lineHeight: 1.45,
                wordBreak: "break-word",
              }}>
                {notif.displayText}
              </div>
              {notif.document_name && (
                <div style={{ fontSize: "0.7rem", color: "#94a3b8", marginTop: 3 }}>
                  {notif.document_type} · {notif.document_name}
                </div>
              )}
              <div style={{ fontSize: "0.68rem", color: "#cbd5e1", marginTop: 2 }}>
                {timeAgo(notif.creation)}
              </div>
            </div>
            {!notif.read && (
              <span style={{
                width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
                background: "#3b82f6", marginTop: 6,
              }} />
            )}
          </button>
        ))}
      </div>
    </div>
  );

  /* ── Dock variant (TL bottom nav) ─────────────────────────── */
  if (variant === "dock") {
    return (
      <>
        <button
          ref={bellRef}
          type="button"
          className="field-dock-link"
          onClick={togglePanel}
          aria-label={`Alerts${unreadCount > 0 ? ` (${unreadCount})` : ""}`}
          style={{ background: "none", border: "none", cursor: "pointer", position: "relative" }}
        >
          <span className="field-dock-icon" style={{ position: "relative", display: "inline-flex" }}>
            <BellSvg />
            {unreadCount > 0 && (
              <span style={{
                position: "absolute", top: -4, right: -6,
                minWidth: 14, height: 14, padding: "0 3px",
                borderRadius: 999,
                background: "#ef4444",
                color: "#fff",
                fontSize: "0.55rem", fontWeight: 800,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                boxShadow: "0 0 0 2px #1e293b",
                lineHeight: 1,
              }}>
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </span>
          <span className="field-dock-label">Alerts</span>
        </button>
        {panel}
      </>
    );
  }

  /* ── Top-float variant (TL — fixed top-right circle) ──────── */
  if (variant === "top-float") {
    return (
      <>
        <button
          ref={bellRef}
          type="button"
          onClick={togglePanel}
          title="Notifications"
          aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount})` : ""}`}
          style={{
            width: 38, height: 38,
            borderRadius: "50%",
            background: "#1e293b",
            border: "1px solid rgba(255,255,255,0.12)",
            boxShadow: "0 2px 10px rgba(0,0,0,0.25)",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer",
            color: "#94a3b8",
            position: "relative",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "#334155")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "#1e293b")}
        >
          <BellSvg />
          {unreadCount > 0 && (
            <span style={{
              position: "absolute", top: 2, right: 2,
              minWidth: 14, height: 14, padding: "0 3px",
              borderRadius: 999,
              background: "#ef4444", color: "#fff",
              fontSize: "0.55rem", fontWeight: 800,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 0 0 2px #1e293b",
              lineHeight: 1,
            }}>
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
        {panel}
      </>
    );
  }

  /* ── Sidebar variant (IM / Admin / PIC) ────────────────────── */
  return (
    <>
      <button
        ref={bellRef}
        type="button"
        onClick={togglePanel}
        title="Notifications"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: collapsed ? "8px 0" : "8px 12px",
          borderRadius: 8,
          color: "#94a3b8",
          justifyContent: collapsed ? "center" : "flex-start",
          transition: "background 0.15s",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.07)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
      >
        <span style={{ position: "relative", width: 20, height: 20, flexShrink: 0, display: "inline-flex" }}>
          <BellSvg />
          {unreadCount > 0 && (
            <span style={{
              position: "absolute", top: -4, right: -6,
              minWidth: 14, height: 14, padding: "0 3px",
              borderRadius: 999,
              background: "#ef4444", color: "#fff",
              fontSize: "0.58rem", fontWeight: 800,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 0 0 2px var(--bg-sidebar, #0f172a)",
              lineHeight: 1,
            }}>
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </span>
        {!collapsed && (
          <>
            <span style={{ fontSize: "0.83rem", fontWeight: 500 }}>Notifications</span>
            {unreadCount > 0 && (
              <span style={{
                marginLeft: "auto",
                minWidth: 18, height: 18, padding: "0 6px",
                borderRadius: 999,
                background: "#ef4444", color: "#fff",
                fontSize: "0.62rem", fontWeight: 800,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
              }}>
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </>
        )}
      </button>
      {panel}
    </>
  );
}
