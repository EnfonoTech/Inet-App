import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { frappe_login, frappe_logout, pmApi } from "../services/api";

const AuthContext = createContext(null);

/**
 * Determine user role after authentication:
 *   1. Administrator or System Manager → "admin"
 *   2. User matches an INET Team IM field → "im"
 *   3. Fallback → "field"
 */
async function detectRole(email, fullName) {
  // Administrator is always admin
  if (email === "Administrator") {
    return { role: "admin", imName: null, teamId: null };
  }

  try {
    // Check for System Manager role
    const roles = await pmApi.getUserRoles(email);
    if (roles && roles.length > 0) {
      return { role: "admin", imName: null, teamId: null };
    }
  } catch {
    // If Has Role query fails, continue to next check
  }

  try {
    // Check if user is an Installation Manager
    const imTeams = await pmApi.getTeamByIM(fullName);
    if (imTeams && imTeams.length > 0) {
      return { role: "im", imName: fullName, teamId: null };
    }
  } catch {
    // continue
  }

  try {
    // Check if user is part of a field team
    const teams = await pmApi.getTeamByMember(email);
    if (teams && teams.length > 0) {
      return { role: "field", imName: null, teamId: teams[0].team_id };
    }
  } catch {
    // continue
  }

  // Fallback: treat as field user with no specific team
  return { role: "field", imName: null, teamId: null };
}

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
        const userData = { email: res.user, full_name: res.full_name || "" };
        setUser(userData);

        // Detect role
        const detected = await detectRole(res.user, res.full_name || "");
        setRole(detected.role);
        setImName(detected.imName);
        setTeamId(detected.teamId);

        setLoading(false);
        return true;
      }
    } catch {
      // network error or unexpected response — treat as logged out
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
      // Frappe returns message "Logged In" on success
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
