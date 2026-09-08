import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/noto-sans-sc";
import "@fontsource/fragment-mono";
import { WebsiteRouter } from "./marketing/WebsiteRouter";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WebsiteRouter />
  </StrictMode>,
);
