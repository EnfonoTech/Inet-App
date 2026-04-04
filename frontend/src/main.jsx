import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./styles/theme.css";
import "./styles/dashboard.css";
import "./styles/pages.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter basename="/pms">
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
