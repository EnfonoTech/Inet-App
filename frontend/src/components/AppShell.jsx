import { Link, useLocation } from "react-router-dom";

const nav = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/projects", label: "Projects" },
  { to: "/daily-updates", label: "Daily Updates" },
  { to: "/team-assignments", label: "Team Assignments" },
];

export default function AppShell({ children }) {
  const location = useLocation();
  return (
    <div className="app-layout">
      <aside className="sidebar">
        <h2>INET Portal</h2>
        {nav.map((item) => (
          <Link key={item.to} className={location.pathname === item.to ? "active" : ""} to={item.to}>
            {item.label}
          </Link>
        ))}
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}
