import { useEffect } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import AppShell from "./components/AppShell";
import Login from "./pages/Login";
import Dashboard from "./modules/Dashboard";
import POIntakePortal from "./modules/POIntakePortal";
import Projects from "./modules/Projects";
import DailyUpdates from "./modules/DailyUpdates";
import TeamAssignments from "./modules/TeamAssignments";
import Reports from "./modules/Reports";

function LoadingScreen() {
  return (
    <div className="login-screen">
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
        <div className="login-brand-mark" style={{ width: 48, height: 48, borderRadius: 14 }} />
        <p style={{ color: "rgba(255,255,255,0.7)", fontSize: 14, letterSpacing: "0.05em" }}>Loading…</p>
      </div>
    </div>
  );
}

function AppContent() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) {
      navigate("/login", { replace: true });
    }
  }, [user, loading, navigate]);

  if (loading) return <LoadingScreen />;
  if (!user) return null;

  return (
    <AppShell>
      <Routes>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/po-intake" element={<POIntakePortal />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/daily-updates" element={<DailyUpdates />} />
        <Route path="/team-assignments" element={<TeamAssignments />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AppShell>
  );
}

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
