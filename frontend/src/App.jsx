import { lazy, Suspense, useEffect } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { TableRowLimitProvider } from "./context/TableRowLimitContext";
import { prefetchTablePreferences } from "./hooks/useTablePreferences";
import AppShell from "./components/AppShell";
import Login from "./pages/Login";
import inetLogo from "./assets/inet-logo.png";

/* -- Admin pages ------------------------------------------------ */
const CommandDashboard    = lazy(() => import("./pages/admin/CommandDashboard"));
const POUpload            = lazy(() => import("./pages/admin/POUpload"));
const PODispatch          = lazy(() => import("./pages/admin/PODispatch"));
const RolloutPlanning     = lazy(() => import("./pages/admin/RolloutPlanning"));
const ExecutionMonitor    = lazy(() => import("./pages/admin/ExecutionMonitor"));
const WorkDone            = lazy(() => import("./pages/admin/WorkDone"));
const IssuesRisks         = lazy(() => import("./pages/admin/IssuesRisks"));
const Reports             = lazy(() => import("./pages/admin/Reports"));
const Masters             = lazy(() => import("./pages/admin/Masters"));
const Projects            = lazy(() => import("./pages/admin/Projects"));
const ProjectDetail       = lazy(() => import("./pages/admin/ProjectDetail"));
const AdminTimesheets     = lazy(() => import("./pages/admin/Timesheets"));
const PODump              = lazy(() => import("./pages/admin/PODump"));
const TeamAllocationApprovals = lazy(() => import("./pages/admin/TeamAllocationApprovals"));
const AdminTeams              = lazy(() => import("./pages/admin/Teams"));
const CEODashboard        = lazy(() => import("./pages/admin/CEODashboard"));
const CommercialDashboard = lazy(() => import("./pages/admin/CommercialDashboard"));
const PMDashboard         = lazy(() => import("./pages/admin/PMDashboard"));
const OpsDashboard        = lazy(() => import("./pages/admin/OpsDashboard"));
const FinancialDashboard  = lazy(() => import("./pages/admin/FinancialDashboard"));
const IMDashboardView     = lazy(() => import("./pages/admin/IMDashboardView"));

/* -- IM pages --------------------------------------------------- */
const IMDashboard         = lazy(() => import("./pages/im/IMDashboard"));
const IMProjects          = lazy(() => import("./pages/im/IMProjects"));
const IMTeams             = lazy(() => import("./pages/im/IMTeams"));
const IMPlanning          = lazy(() => import("./pages/im/IMPlanning"));
const IMExecution         = lazy(() => import("./pages/im/IMExecution"));
const IMReports           = lazy(() => import("./pages/im/IMReports"));
const IMTimesheets        = lazy(() => import("./pages/im/IMTimesheets"));
const IMDispatch          = lazy(() => import("./pages/im/IMDispatch"));
const IMPOIntake          = lazy(() => import("./pages/im/IMPOIntake"));
const IMBackend           = lazy(() => import("./pages/im/IMBackend"));
const IMWorkDone          = lazy(() => import("./pages/im/IMWorkDone"));
const IMIssuesRisks       = lazy(() => import("./pages/im/IMIssuesRisks"));
const IMMaterialRequest   = lazy(() => import("./pages/im/IMMaterialRequest"));
const IMExpense           = lazy(() => import("./pages/im/IMExpense"));
const OperationsOverview  = lazy(() => import("./pages/OperationsOverview"));

/* -- PIC pages -------------------------------------------------- */
const PICDashboard        = lazy(() => import("./pages/pic/PICDashboard"));
const PICTracker          = lazy(() => import("./pages/pic/PICTracker"));
const InvoiceTracker      = lazy(() => import("./pages/pic/InvoiceTracker"));
const PICReports          = lazy(() => import("./pages/pic/PICReports"));

/* -- Field pages ------------------------------------------------ */
const TodaysWork          = lazy(() => import("./pages/field/TodaysWork"));
const ExecutionForm       = lazy(() => import("./pages/field/ExecutionForm"));
const FieldQcCiag         = lazy(() => import("./pages/field/FieldQcCiag"));
const FieldHistory        = lazy(() => import("./pages/field/FieldHistory"));
const FieldTimesheet      = lazy(() => import("./pages/field/Timesheet"));
const FieldMyStock        = lazy(() => import("./pages/field/FieldMyStock"));
const FieldExpense        = lazy(() => import("./pages/field/FieldExpense"));

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
  if (role === "pic") return <Navigate to="/pic-dashboard" replace />;
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
    <Suspense fallback={<LoadingScreen />}>
      <Routes>
        <Route element={<AppShell />}>
          {/* -- Admin routes -------------------------------------- */}
          {role === "admin" && (
            <>
              <Route path="/dashboard" element={<CommandDashboard />} />
              <Route path="/ceo-dashboard" element={<CEODashboard />} />
              <Route path="/commercial-dashboard" element={<CommercialDashboard />} />
              <Route path="/pm-dashboard" element={<PMDashboard />} />
              <Route path="/ops-dashboard" element={<OpsDashboard />} />
              <Route path="/financial-dashboard" element={<FinancialDashboard />} />
              <Route path="/im-dashboard-view" element={<IMDashboardView />} />
              <Route path="/projects" element={<Projects />} />
              <Route path="/projects/:projectCode" element={<ProjectDetail />} />
              <Route path="/po-upload" element={<POUpload />} />
              <Route path="/po-dump" element={<PODump />} />
              <Route path="/dispatch" element={<PODispatch />} />
              <Route path="/planning" element={<RolloutPlanning />} />
              <Route path="/execution" element={<ExecutionMonitor />} />
              <Route path="/work-done" element={<WorkDone />} />
              <Route path="/issues-risks" element={<IssuesRisks />} />
              <Route path="/backend" element={<IMBackend />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/timesheets" element={<AdminTimesheets />} />
              <Route path="/approvals" element={<TeamAllocationApprovals />} />
              <Route path="/teams" element={<AdminTeams />} />
              <Route path="/expenses" element={<IMExpense isAdmin={true} />} />
              <Route path="/masters" element={<Masters />} />
              <Route path="/overview" element={<OperationsOverview />} />
              <Route path="/im-material-request" element={<IMMaterialRequest />} />
            </>
          )}

          {/* -- IM routes ----------------------------------------- */}
          {role === "im" && (
            <>
              <Route path="/im-dashboard" element={<IMDashboard />} />
              <Route path="/im-projects" element={<IMProjects />} />
              <Route path="/im-teams" element={<IMTeams />} />
              <Route path="/im-po-intake" element={<IMPOIntake />} />
              <Route path="/im-backend" element={<IMBackend />} />
              {/* Back-compat alias for the old /im-subcon URL */}
              <Route path="/im-subcon" element={<IMBackend />} />
              <Route path="/im-dispatch" element={<IMDispatch />} />
              <Route path="/im-planning" element={<IMPlanning />} />
              <Route path="/im-execution" element={<IMExecution />} />
              <Route path="/im-work-done" element={<IMWorkDone />} />
              <Route path="/im-issues-risks" element={<IMIssuesRisks />} />
              <Route path="/im-material-request" element={<IMMaterialRequest />} />
              <Route path="/im-expense" element={<IMExpense />} />
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
              <Route path="/field-my-stock" element={<FieldMyStock />} />
              <Route path="/field-expense" element={<FieldExpense />} />
            </>
          )}

          {/* -- PIC routes ---------------------------------------- */}
          {role === "pic" && (
            <>
              <Route path="/pic-dashboard" element={<PICDashboard />} />
              <Route path="/pic-tracker" element={<PICTracker />} />
              <Route path="/pic-invoice-tracker" element={<InvoiceTracker />} />
              <Route path="/pic-reports" element={<PICReports />} />
            </>
          )}
          {/* Admins also reach PIC pages so they can support / audit. */}
          {role === "admin" && (
            <>
              <Route path="/pic-dashboard" element={<PICDashboard showSwitcher />} />
              <Route path="/pic-tracker" element={<PICTracker />} />
              <Route path="/pic-invoice-tracker" element={<InvoiceTracker />} />
              <Route path="/pic-reports" element={<PICReports />} />
            </>
          )}

          {/* -- Default redirect based on role -------------------- */}
          <Route path="*" element={<DefaultRedirect />} />
        </Route>
      </Routes>
    </Suspense>
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
