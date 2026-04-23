import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { fetchPortalSession, frappe_login, frappe_logout, pmApi } from "../services/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);      // { email, full_name } or null
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState(null);       // "admin" | "im" | "field"
  const [imName, setImName] = useState(null);
  const [teamId, setTeamId] = useState(null);

  const checkSession = useCallback(async () => {
    setLoading(true);
    try {
      const res = await pmApi.getLoggedUser();
      if (res && res.authenticated === true && res.user && res.user !== "Guest") {
        const resolvedRole = res.app_role || "field";
        setUser({ email: res.user, full_name: res.full_name || "" });
        setRole(resolvedRole);
        setImName(res.im_name || null);
        setTeamId(res.team_id || null);
        setLoading(false);
        return { ok: true, role: resolvedRole };
      }
    } catch {
      // treat as logged out
    }
    setUser(null);
    setRole(null);
    setImName(null);
    setTeamId(null);
    setLoading(false);
    return { ok: false, role: null };
  }, []);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  // Desk (/app) in another tab rotates the session CSRF; refresh when returning to PMS.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      if (!user) return;
      (async () => {
        try {
          const res = await fetchPortalSession();
          if (!res?.authenticated) {
            setUser(null);
            setRole(null);
            setImName(null);
            setTeamId(null);
          }
        } catch {
          /* ignore transient errors */
        }
      })();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [user]);

  const login = useCallback(
    async (usr, pwd) => {
      // Frappe's /api/method/login returns:
      //   "Logged In"  — success, user has a Desk home_page
      //   "No App"     — credentials ok, session IS created, but the user has
      //                  no Desk app access. For portal/field users this is
      //                  still a successful login; skip the throw and verify
      //                  via checkSession().
      //   "Incorrect User or Password" (and friends) — real failure
      const data = await frappe_login(usr, pwd);
      const msg = String(data?.message || "").trim();
      const clearlyOk = msg === "Logged In" || msg === "No App" || msg === "Already Logged In";
      const sess = await checkSession();
      if (!sess.ok) {
        throw new Error(clearlyOk ? "Session could not be established" : (msg || "Login failed"));
      }
      return { role: sess.role };
    },
    [checkSession]
  );

  const logout = useCallback(async () => {
    try {
      await frappe_logout();
    } catch {
      // ignore
    }
    setUser(null);
    setRole(null);
    setImName(null);
    setTeamId(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, role, imName, teamId, login, logout, checkSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
