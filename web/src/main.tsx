import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/noto-sans-sc";
import "@fontsource/fragment-mono";
import { WebsiteRouter } from "./marketing/WebsiteRouter";
import "./styles.css";
import "./dropdowns.css";
import "./home.css";
import "./knowledge-layout.css";
import "./creation-library.css";
import "./studio.css";
import "./studio-themes.css";
import { StudioThemeProvider } from "./components/StudioTheme";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StudioThemeProvider><WebsiteRouter /></StudioThemeProvider>
  </StrictMode>,
);
