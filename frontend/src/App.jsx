import { Navigate, Route, Routes } from "react-router-dom";
import AppShell from "./components/AppShell";
import Dashboard from "./modules/Dashboard";
import Projects from "./modules/Projects";
import DailyUpdates from "./modules/DailyUpdates";
import TeamAssignments from "./modules/TeamAssignments";

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/daily-updates" element={<DailyUpdates />} />
        <Route path="/team-assignments" element={<TeamAssignments />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AppShell>
  );
}
