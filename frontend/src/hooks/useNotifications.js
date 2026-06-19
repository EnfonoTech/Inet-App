import { useState, useEffect, useCallback, useRef } from "react";
import { pmApi } from "../services/api";

const POLL_INTERVAL_MS = 30_000;

function stripHtml(html) {
  try {
    const div = document.createElement("div");
    div.innerHTML = html || "";
    return div.textContent || div.innerText || "";
  } catch {
    return html || "";
  }
}

function parseTier(subject) {
  if (subject.startsWith("[CRITICAL]")) return "critical";
  if (subject.startsWith("[ALERT]")) return "alert";
  return "info";
}

function cleanSubject(subject) {
  return stripHtml(
    subject
      .replace(/^\[CRITICAL\]\s*/, "")
      .replace(/^\[ALERT\]\s*/, "")
      .replace(/^\[INFO\]\s*/, "")
  );
}

export function useNotifications() {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await pmApi.getNotifications(50);
      const list = (res?.notification_logs || [])
        .filter((n) => /^\[(CRITICAL|ALERT|INFO)\]/.test(n.subject || ""))
        .map((n) => ({
          ...n,
          tier: parseTier(n.subject || ""),
          displayText: cleanSubject(n.subject || ""),
        }));
      setNotifications(list);
    } catch (err) {
      console.warn("[useNotifications] fetch failed:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch + polling
  useEffect(() => {
    fetchNotifications();
    timerRef.current = setInterval(fetchNotifications, POLL_INTERVAL_MS);
    return () => clearInterval(timerRef.current);
  }, [fetchNotifications]);

  // Refresh immediately on inet:notifications-changed event
  useEffect(() => {
    const handler = () => fetchNotifications();
    window.addEventListener("inet:notifications-changed", handler);
    return () => window.removeEventListener("inet:notifications-changed", handler);
  }, [fetchNotifications]);

  const markAsRead = useCallback(async (name) => {
    setNotifications((prev) =>
      prev.map((n) => (n.name === name ? { ...n, read: 1 } : n))
    );
    try {
      await pmApi.markNotificationRead(name);
    } catch {
      // revert optimistic update on error
      setNotifications((prev) =>
        prev.map((n) => (n.name === name ? { ...n, read: 0 } : n))
      );
    }
  }, []);

  const markAllRead = useCallback(async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: 1 })));
    try {
      await pmApi.markAllNotificationsRead();
    } catch {
      fetchNotifications();
    }
  }, [fetchNotifications]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return { notifications, unreadCount, loading, markAsRead, markAllRead };
}
