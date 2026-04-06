import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { frappe_login, frappe_logout, pmApi } from "../services/api";

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
        setUser({ email: res.user, full_name: res.full_name || "" });
        setRole(res.app_role || "field");
        setImName(res.im_name || null);
        setTeamId(res.team_id || null);
        setLoading(false);
        return true;
      }
    } catch {
      // treat as logged out
    }
    setUser(null);
    setRole(null);
    setImName(null);
    setTeamId(null);
    setLoading(false);
    return false;
  }, []);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  const login = useCallback(
    async (usr, pwd) => {
      const data = await frappe_login(usr, pwd);
      if (data.message !== "Logged In") {
        throw new Error(data.message || "Login failed");
      }
      await checkSession();
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
