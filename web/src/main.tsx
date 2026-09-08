import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/noto-sans-sc";
import "@fontsource/fragment-mono";
import { AccountGate } from "./components/AccountGate";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AccountGate />
  </StrictMode>,
);
