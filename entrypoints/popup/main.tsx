import "../../src/shims/buffer";
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "../../src/ui/App";
import { ScanView } from "../../src/ui/ScanView";
import "../../src/ui/theme/fonts.css";
import "../../src/ui/styles.css";
import { applySkinById } from "../../src/ui/theme/theme-engine";
import { getStoredSkin } from "../../src/ui/theme/useTheme";

// popup.html#scan is the standalone camera-scanner window; everything else is the wallet.
const isScanWindow = window.location.hash.includes("scan");

// Theme the root before the first React paint so the popup is fully tokenised on
// mount (no flash of an unstyled/default theme). The .wlt class added to #root in
// App's shell roots scopes the token-driven stylesheet; this writes the matching
// CSS custom properties onto the same node via getRoot() === #root.
const themeRoot = document.getElementById("root");
if (themeRoot) {
  themeRoot.classList.add("wlt");
  applySkinById(themeRoot, getStoredSkin());
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isScanWindow ? <ScanView /> : <App />}
  </React.StrictMode>
);
