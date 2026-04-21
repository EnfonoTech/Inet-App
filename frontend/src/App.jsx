import { useEffect } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { TableRowLimitProvider } from "./context/TableRowLimitContext";
import { prefetchTablePreferences } from "./hooks/useTablePreferences";
import AppShell from "./components/AppShell";
import Login from "./pages/Login";
import inetLogo from "./assets/inet-logo.png";

/* -- Admin pages ------------------------------------------------ */
import CommandDashboard from "./pages/admin/CommandDashboard";
import POUpload from "./pages/admin/POUpload";
import PODispatch from "./pages/admin/PODispatch";
import RolloutPlanning from "./pages/admin/RolloutPlanning";
import ExecutionMonitor from "./pages/admin/ExecutionMonitor";
import WorkDone from "./pages/admin/WorkDone";
import IssuesRisks from "./pages/admin/IssuesRisks";
import Reports from "./pages/admin/Reports";
import Masters from "./pages/admin/Masters";
import Projects from "./pages/admin/Projects";
import ProjectDetail from "./pages/admin/ProjectDetail";
import AdminTimesheets from "./pages/admin/Timesheets";
import PODump from "./pages/admin/PODump";

/* -- IM pages --------------------------------------------------- */
import IMDashboard from "./pages/im/IMDashboard";
import IMProjects from "./pages/im/IMProjects";
import IMTeams from "./pages/im/IMTeams";
import IMPlanning from "./pages/im/IMPlanning";
import IMExecution from "./pages/im/IMExecution";
import IMReports from "./pages/im/IMReports";
import IMTimesheets from "./pages/im/IMTimesheets";
import IMDispatch from "./pages/im/IMDispatch";
import IMPOIntake from "./pages/im/IMPOIntake";
import IMWorkDone from "./pages/im/IMWorkDone";
import IMIssuesRisks from "./pages/im/IMIssuesRisks";
import OperationsOverview from "./pages/OperationsOverview";

/* -- Field pages ------------------------------------------------ */
import TodaysWork from "./pages/field/TodaysWork";
import ExecutionForm from "./pages/field/ExecutionForm";
import FieldQcCiag from "./pages/field/FieldQcCiag";
import FieldHistory from "./pages/field/FieldHistory";
import FieldTimesheet from "./pages/field/Timesheet";

/* -- Loading Screen --------------------------------------------- */
function LoadingScreen() {
  return (
    <div className="loading-screen">
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
        <img src={inetLogo} alt="INET Telecom" style={{ height: 56, width: "auto", objectFit: "contain" }} />
        <p style={{ color: "#94a3b8", fontSize: 14, letterSpacing: "0.05em" }}>Loading...</p>
      </div>
    </div>
  );
}

/* -- Role-based default redirect -------------------------------- */
function DefaultRedirect() {
  const { role } = useAuth();
  if (role === "im") return <Navigate to="/im-dashboard" replace />;
  if (role === "field") return <Navigate to="/today" replace />;
  return <Navigate to="/dashboard" replace />;
}

/* -- Authenticated App Content ---------------------------------- */
function AppContent() {
  const { user, loading, role } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) {
      navigate("/login", { replace: true });
    }
  }, [user, loading, navigate]);

  // Warm the table-preferences cache in parallel with the first render so
  // DataTablePro's per-table `load()` calls resolve synchronously from cache.
  useEffect(() => {
    if (user) prefetchTablePreferences();
  }, [user]);

  if (loading) return <LoadingScreen />;
  if (!user) return null;

  return (
    <Routes>
      <Route element={<AppShell />}>
        {/* -- Admin routes -------------------------------------- */}
        {role === "admin" && (
          <>
            <Route path="/dashboard" element={<CommandDashboard />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/projects/:projectCode" element={<ProjectDetail />} />
            <Route path="/po-upload" element={<POUpload />} />
            <Route path="/po-dump" element={<PODump />} />
            <Route path="/dispatch" element={<PODispatch />} />
            <Route path="/planning" element={<RolloutPlanning />} />
            <Route path="/execution" element={<ExecutionMonitor />} />
            <Route path="/work-done" element={<WorkDone />} />
            <Route path="/issues-risks" element={<IssuesRisks />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/timesheets" element={<AdminTimesheets />} />
            <Route path="/masters" element={<Masters />} />
            <Route path="/overview" element={<OperationsOverview />} />
          </>
        )}

        {/* -- IM routes ----------------------------------------- */}
        {role === "im" && (
          <>
            <Route path="/im-dashboard" element={<IMDashboard />} />
            <Route path="/im-projects" element={<IMProjects />} />
            <Route path="/im-teams" element={<IMTeams />} />
            <Route path="/im-po-intake" element={<IMPOIntake />} />
            <Route path="/im-dispatch" element={<IMDispatch />} />
            <Route path="/im-planning" element={<IMPlanning />} />
            <Route path="/im-execution" element={<IMExecution />} />
            <Route path="/im-work-done" element={<IMWorkDone />} />
            <Route path="/im-issues-risks" element={<IMIssuesRisks />} />
            <Route path="/im-reports" element={<IMReports />} />
            <Route path="/im-timesheets" element={<IMTimesheets />} />
          </>
        )}

        {/* -- Field team routes --------------------------------- */}
        {role === "field" && (
          <>
            <Route path="/today" element={<TodaysWork />} />
            <Route path="/field-execute" element={<ExecutionForm />} />
            <Route path="/field-execute/:id" element={<ExecutionForm />} />
            <Route path="/field-qc-ciag" element={<FieldQcCiag />} />
            <Route path="/field-history" element={<FieldHistory />} />
            <Route path="/field-timesheet" element={<FieldTimesheet />} />
          </>
        )}

        {/* -- Default redirect based on role -------------------- */}
        <Route path="*" element={<DefaultRedirect />} />
      </Route>
    </Routes>
  );
}

/* -- Root App --------------------------------------------------- */
export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/*"
          element={
            <TableRowLimitProvider>
              <AppContent />
            </TableRowLimitProvider>
          }
        />
      </Routes>
    </AuthProvider>
  );
}
