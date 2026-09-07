import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { validatePreviewTexts } from "./editor/previewTextValidation";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App integration={window.pixelweaveIntegration} preview={!!validatePreviewTexts && !window.pixelweaveIntegration} />
  </StrictMode>,
);

