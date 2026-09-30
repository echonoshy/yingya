import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/noto-sans-sc";
import "@fontsource-variable/noto-serif-sc";
import { WebsiteRouter } from "./marketing/WebsiteRouter";
import "./styles.css";
import "./dropdowns.css";
import "./home.css";
import "./knowledge-layout.css";
import "./creation-library.css";
import "./print-studio.css";
import "./editorial-studio.css";
import { StudioThemeProvider } from "./components/StudioTheme";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StudioThemeProvider><WebsiteRouter /></StudioThemeProvider>
  </StrictMode>,
);
