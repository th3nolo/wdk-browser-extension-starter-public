/* ============================================================================
   WDK skin persistence + selection — strictly client-side, UI-only.
   ----------------------------------------------------------------------------
   The selected skin id is stored in localStorage (synchronous, perfect for a
   popup). This NEVER touches chrome.storage or background messaging — that path
   belongs to the wallet core. The stored id is validated against SKIN_MAP so a
   stale/bad value can't brick theming; it falls back to the default skin.
   ========================================================================== */

import { SKIN_MAP, DEFAULT_SKIN_ID } from "./skins";
import { applySkinById } from "./theme-engine";

/** localStorage key holding the selected skin id. */
export const SKIN_STORAGE_KEY = "wdk:skin";

/**
 * Read the persisted skin id, validated against SKIN_MAP. Returns the default
 * skin id if nothing is stored, the value is unknown, or storage is unavailable.
 */
export function getStoredSkin(): string {
  try {
    const stored = localStorage.getItem(SKIN_STORAGE_KEY);
    if (stored && SKIN_MAP[stored]) return stored;
  } catch {
    // localStorage can throw (private mode / disabled) — fall through to default.
  }
  return DEFAULT_SKIN_ID;
}

/**
 * The root element the skin tokens are applied to. The extension mounts React at
 * #root; applying there lets the inline CSS vars cascade to the whole popup.
 * Falls back to <html> if #root is not present.
 */
export function getRoot(): HTMLElement {
  return document.getElementById("root") ?? document.documentElement;
}

/**
 * Persist a skin id (validated) and apply it to the root immediately. Unknown
 * ids fall back to the default skin for both persistence and application.
 */
export function setSkin(id: string): string {
  const valid = SKIN_MAP[id] ? id : DEFAULT_SKIN_ID;
  try {
    localStorage.setItem(SKIN_STORAGE_KEY, valid);
  } catch {
    // Persisting is best-effort; still apply for the current session.
  }
  applySkinById(getRoot(), valid);
  return valid;
}
