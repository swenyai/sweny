import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App.js";
import "./index.css";
import { THEME_CSS } from "./theme.js";

const themeEl = document.createElement("style");
themeEl.textContent = THEME_CSS;
document.head.appendChild(themeEl);

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("No #root element found");

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
