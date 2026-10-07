import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/noto-sans-sc";
import "@fontsource/fragment-mono/latin-400.css";
import "./typography.css";
import { WebsiteRouter } from "./marketing/WebsiteRouter";
import "./styles.css";
import { StudioThemeProvider } from "./components/StudioTheme";
import { AppUpdateProvider } from "./components/AppUpdate";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StudioThemeProvider><AppUpdateProvider><WebsiteRouter /></AppUpdateProvider></StudioThemeProvider>
  </StrictMode>,
);
