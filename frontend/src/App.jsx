import { useEffect } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import AppShell from "./components/AppShell";
import Login from "./pages/Login";

/* ── Admin pages ─────────────────────────────────────────────── */
import CommandDashboard from "./pages/admin/CommandDashboard";
import POUpload from "./pages/admin/POUpload";
import PODispatch from "./pages/admin/PODispatch";
import RolloutPlanning from "./pages/admin/RolloutPlanning";
import ExecutionMonitor from "./pages/admin/ExecutionMonitor";
import WorkDone from "./pages/admin/WorkDone";
import Reports from "./pages/admin/Reports";
import Masters from "./pages/admin/Masters";
import Projects from "./pages/admin/Projects";

/* ── IM pages ────────────────────────────────────────────────── */
import IMDashboard from "./pages/im/IMDashboard";

/* ── Field pages ─────────────────────────────────────────────── */
import TodaysWork from "./pages/field/TodaysWork";
import ExecutionForm from "./pages/field/ExecutionForm";

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
            <Route path="/projects"   element={<Projects />} />
            <Route path="/po-upload"  element={<POUpload />} />
            <Route path="/dispatch"   element={<PODispatch />} />
            <Route path="/planning"   element={<RolloutPlanning />} />
            <Route path="/execution"  element={<ExecutionMonitor />} />
            <Route path="/work-done"  element={<WorkDone />} />
            <Route path="/reports"    element={<Reports />} />
            <Route path="/masters"    element={<Masters />} />
          </>
        )}

        {/* ── IM routes ─────────────────────────────────────── */}
        {role === "im" && (
          <Route path="/im-dashboard" element={<IMDashboard />} />
        )}

        {/* ── Field team routes ─────────────────────────────── */}
        {role === "field" && (
          <>
            <Route path="/today"        element={<TodaysWork />} />
            <Route path="/execute/:id"  element={<ExecutionForm />} />
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
