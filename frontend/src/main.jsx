import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import "./styles/theme.css";
import "./styles/dashboard.css";
import "./styles/pages.css";

// Guard: an older PWA service worker was scoped at "/" and could intercept
// non-PMS URLs (e.g. /app), serving this SPA shell. The basename below would
// then refuse to match and React Router would render nothing. Detect that
// situation early, unregister any out-of-scope SW, and redirect away.
if (typeof window !== "undefined") {
  const path = window.location.pathname;
  if (!path.startsWith("/pms")) {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        regs.forEach((r) => {
          if (!r.scope.endsWith("/pms/")) r.unregister();
        });
      });
    }
    // Send the user to the Frappe Desk root and stop booting the SPA.
    window.location.replace("/app");
    throw new Error("INET PMS shell loaded outside /pms — redirecting to /app");
  }
}

if (import.meta.env.PROD) {
  const updateSW = registerSW({
    // Auto-activate new service workers so an old wider-scope SW doesn't keep
    // hijacking root-level navigation.
    immediate: true,
    onNeedRefresh() {
      if (window.confirm("A new version is available. Reload now?")) {
        updateSW(true);
      }
    },
    onOfflineReady() {},
    onRegisterError(err) {
      console.warn("INET PMS service worker registration:", err);
    },
  });
} else if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((r) => r.unregister());
  });
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter basename="/pms">
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
