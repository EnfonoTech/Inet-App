import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import inetLogo from "../assets/inet-logo.png";

function EyeIcon({ off }) {
  return off ? (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: "spin 0.9s linear infinite" }}>
      <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
    </svg>
  );
}

const FEATURES = [
  "Real-time KPI Dashboard",
  "6-Stage Pipeline Tracking",
  "Team Performance Analytics",
  "Financial P&L Monitoring",
];

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({ username: "", password: "" });
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.username.trim() || !form.password) {
      setError("Email and password are required.");
      return;
    }
    setLoading(true);
    try {
      await login(form.username.trim(), form.password);
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(err?.message || "Login failed. Please check your credentials.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-screen">
      {/* ── Left branding panel ─────────────────────────────── */}
      <div className="login-brand-panel">
        <div className="login-brand-inner">
          {/* Logo mark + name */}
          <div className="login-brand-logo">
            <img src={inetLogo} alt="INET Telecom" style={{ height: 52, width: "auto", objectFit: "contain" }} />
            <span className="login-brand-name">PMS</span>
          </div>

          {/* Headline */}
          <h2 className="login-brand-headline">
            Operations Command Center
          </h2>

          {/* Subtitle */}
          <p className="login-brand-sub">
            Centralized telecom project management, field operations, and financial monitoring.
          </p>

          {/* Feature bullets */}
          <div className="login-brand-features">
            {FEATURES.map((f) => (
              <div key={f} className="login-brand-feature">
                <span className="login-brand-feature-dot" />
                {f}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Right login form ────────────────────────────────── */}
      <div className="login-form-panel">
        <div className="login-card">
          {/* Small logo at top of card */}
          <div className="login-logo-sm">
            <img src={inetLogo} alt="INET Telecom" style={{ height: 36, width: "auto", objectFit: "contain" }} />
            <span className="login-mark-text">PMS</span>
          </div>

          <h1 className="login-title">Sign In</h1>
          <p className="login-subtitle">Access your command center</p>

          {error && <div className="login-error">{error}</div>}

          <form onSubmit={handleSubmit} className="login-form" noValidate>
            <div className="form-group">
              <label htmlFor="login-email">Email / Username</label>
              <input
                id="login-email"
                type="text"
                autoComplete="username"
                required
                placeholder="admin@example.com"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                disabled={loading}
              />
            </div>

            <div className="form-group">
              <label htmlFor="login-password">Password</label>
              <div className="input-icon-wrap">
                <input
                  id="login-password"
                  type={showPass ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  placeholder="••••••••"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  disabled={loading}
                />
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setShowPass((v) => !v)}
                  tabIndex={-1}
                  aria-label={showPass ? "Hide password" : "Show password"}
                >
                  <EyeIcon off={showPass} />
                </button>
              </div>
            </div>

            <button
              type="submit"
              className="login-submit-btn"
              disabled={loading}
            >
              {loading ? (
                <span style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center" }}>
                  <SpinnerIcon /> Signing in…
                </span>
              ) : (
                "Sign In"
              )}
            </button>
          </form>

          <p className="login-footer-note">
            Powered by INET Telecom ERP
          </p>
        </div>
      </div>
    </div>
  );
}
