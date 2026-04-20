import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import "./styles/theme.css";
import "./styles/dashboard.css";
import "./styles/pages.css";

if (import.meta.env.PROD) {
  const updateSW = registerSW({
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
