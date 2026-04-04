import { useEffect } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import AppShell from "./components/AppShell";
import Login from "./pages/Login";
import CommandDashboard from "./pages/admin/CommandDashboard";

/* ── Placeholder for pages not yet built ────────────────────── */
function Placeholder({ title }) {
  return (
    <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)" }}>
      <h2 style={{ color: "var(--text-primary)", marginBottom: "8px" }}>{title}</h2>
      <p>Coming soon</p>
    </div>
  );
}

/* ── Loading Screen ─────────────────────────────────────────── */
function LoadingScreen() {
  return (
    <div className="loading-screen">
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
        <div className="brand-mark" style={{ width: 48, height: 48, borderRadius: 14 }} />
        <p style={{ color: "var(--text-muted)", fontSize: 14, letterSpacing: "0.05em" }}>Loading...</p>
      </div>
    </div>
  );
}

/* ── Role-based default redirect ────────────────────────────── */
function DefaultRedirect() {
  const { role } = useAuth();
  if (role === "im") return <Navigate to="/im-dashboard" replace />;
  if (role === "field") return <Navigate to="/today" replace />;
  return <Navigate to="/dashboard" replace />;
}

/* ── Authenticated App Content ──────────────────────────────── */
function AppContent() {
  const { user, loading, role } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) {
      navigate("/login", { replace: true });
    }
  }, [user, loading, navigate]);

  if (loading) return <LoadingScreen />;
  if (!user) return null;

  return (
    <Routes>
      <Route element={<AppShell />}>
        {/* ── Admin routes ──────────────────────────────────── */}
        {role === "admin" && (
          <>
            <Route path="/dashboard"  element={<CommandDashboard />} />
            <Route path="/po-upload"  element={<Placeholder title="PO Upload" />} />
            <Route path="/dispatch"   element={<Placeholder title="PO Dispatch" />} />
            <Route path="/planning"   element={<Placeholder title="Rollout Planning" />} />
            <Route path="/execution"  element={<Placeholder title="Execution Monitor" />} />
            <Route path="/work-done"  element={<Placeholder title="Work Done" />} />
            <Route path="/reports"    element={<Placeholder title="Reports" />} />
            <Route path="/masters"    element={<Placeholder title="Masters" />} />
          </>
        )}

        {/* ── IM routes ─────────────────────────────────────── */}
        {role === "im" && (
          <Route path="/im-dashboard" element={<Placeholder title="IM Dashboard" />} />
        )}

        {/* ── Field team routes ─────────────────────────────── */}
        {role === "field" && (
          <>
            <Route path="/today"        element={<Placeholder title="Today's Work" />} />
            <Route path="/execute/:id"  element={<Placeholder title="Execution Form" />} />
          </>
        )}

        {/* ── Default redirect based on role ────────────────── */}
        <Route path="*" element={<DefaultRedirect />} />
      </Route>
    </Routes>
  );
}

/* ── Root App ───────────────────────────────────────────────── */
export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/*" element={<AppContent />} />
      </Routes>
    </AuthProvider>
  );
}
