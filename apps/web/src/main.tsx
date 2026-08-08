import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { Providers } from "./app/providers";
import "./styles/tokens.css";
import "./styles/globals.css";
import "./styles/components.css";
import "./styles/animations.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Providers><App /></Providers>
  </StrictMode>,
);
