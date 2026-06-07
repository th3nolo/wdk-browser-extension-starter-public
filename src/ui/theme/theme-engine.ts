/* ============================================================================
   WDK Whitelabel Theme Engine — pure TS port of theme-engine.js.
   ----------------------------------------------------------------------------
   `expand(spec)` turns a skin into the full semantic token map; `applySkin(el)`
   writes those tokens as inline CSS custom properties on a target element and
   sets the driving data-* attributes + color-scheme. All visual change flows
   from these inline vars + attributes — no component code changes.

   Differences from the original JS engine (deliberate, for the extension):
   - `loadFonts()` is DROPPED. It injected a Google Fonts CDN <link>, which the
     MV3 popup CSP forbids. Fonts are bundled locally via @fontsource (fonts.css)
     so the engine only needs to emit the matching --font-* family stacks.
   - Tokens are applied via el.style.setProperty (CSSOM inline styles), which is
     CSP-safe under extension_pages — no stylesheet injection.
   ========================================================================== */

import {
  SHAPE,
  DENSITY,
  SKIN_MAP,
  DEFAULT_SKIN_ID,
  type ThemeSpec,
  type ThemeMode
} from "./skins";

/* ---- helpers ---------------------------------------------------------- */
// Neutrals are built in OKLCH so any brand hue tints the greys consistently.
export function oklch(l: number, c: number, h: number): string {
  return `oklch(${l} ${c} ${h})`;
}

export function rgba(hex: string, a: number): string {
  const v = hex.replace("#", "");
  const n =
    v.length === 3
      ? v
          .split("")
          .map((x) => x + x)
          .join("")
      : v;
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/* ---- neutral ramp from mode + tint hue -------------------------------- */
export function neutrals(mode: ThemeMode, hue: number, chroma?: number): Record<string, string> {
  const c = chroma == null ? 0.012 : chroma;
  if (mode === "light") {
    return {
      "--bg": oklch(0.975, c * 0.6, hue),
      "--bg-elevated": oklch(0.94, c, hue),
      "--surface": oklch(0.998, c * 0.3, hue),
      "--surface-soft": oklch(0.965, c, hue),
      "--surface-strong": oklch(0.93, c, hue),
      "--border": oklch(0.9, c, hue),
      "--border-strong": oklch(0.83, c * 1.2, hue),
      "--ink": oklch(0.24, c * 1.4, hue),
      "--muted": oklch(0.5, c * 1.2, hue),
      "--faint": oklch(0.64, c, hue),
      "--scrim": "rgba(20, 22, 28, 0.42)"
    };
  }
  return {
    "--bg": oklch(0.16, c, hue),
    "--bg-elevated": oklch(0.195, c, hue),
    "--surface": oklch(0.225, c, hue),
    "--surface-soft": oklch(0.265, c, hue),
    "--surface-strong": oklch(0.305, c, hue),
    "--border": oklch(0.31, c * 1.3, hue),
    "--border-strong": oklch(0.4, c * 1.4, hue),
    "--ink": oklch(0.96, c * 0.5, hue),
    "--muted": oklch(0.7, c, hue),
    "--faint": oklch(0.54, c, hue),
    "--scrim": "rgba(0, 0, 0, 0.55)"
  };
}

/* ---- build the full token map from a skin spec ------------------------ */
export function expand(t: ThemeSpec): Record<string, string> {
  const shape = SHAPE[t.shape] || SHAPE.rounded;
  const dens = DENSITY[t.density] || DENSITY.cozy;
  const n = neutrals(t.mode, t.tint == null ? 250 : t.tint, t.chroma);
  const a = t.accent;
  const sem = t.semantic || {};
  const danger = sem.danger || (t.mode === "light" ? "#dc2626" : "#f87171");
  const warn = sem.warn || (t.mode === "light" ? "#d97706" : "#fbbf24");
  const good = sem.good || (t.mode === "light" ? "#16a34a" : "#34d399");
  const info = sem.info || (t.mode === "light" ? "#2563eb" : "#60a5fa");
  const shadowColor = t.mode === "light" ? "rgba(15, 23, 42, 0.10)" : "rgba(0, 0, 0, 0.5)";
  const shadowSoft = t.mode === "light" ? "rgba(15, 23, 42, 0.07)" : "rgba(0, 0, 0, 0.32)";
  const hairline =
    t.mode === "light"
      ? "inset 0 1px 0 rgba(255,255,255,0.8)"
      : "inset 0 1px 0 rgba(255,255,255,0.055)";

  return Object.assign({}, n, {
    "--accent": a.base,
    "--accent-strong": a.strong || a.base,
    "--accent-ink": a.ink || (t.mode === "light" ? "#ffffff" : "#04201d"),
    "--accent-soft": rgba(a.base, t.mode === "light" ? 0.1 : 0.16),
    "--accent-ring": rgba(a.base, 0.4),
    "--accent-2": a.second || a.base,
    "--danger": danger,
    "--danger-soft": rgba(danger, t.mode === "light" ? 0.1 : 0.14),
    "--warn": warn,
    "--warn-soft": rgba(warn, t.mode === "light" ? 0.12 : 0.14),
    "--good": good,
    "--good-soft": rgba(good, 0.14),
    "--info": info,
    "--info-soft": rgba(info, 0.14),
    "--radius": shape.lg,
    "--radius-md": shape.md,
    "--radius-sm": shape.sm,
    "--radius-pill": shape.pill,
    "--radius-field": shape.field,
    "--pad": dens.pad,
    "--gap": dens.gap,
    "--control-h": dens.ctrl,
    "--row-pad": dens.row,
    "--sect-gap": dens.sect,
    "--font-head": t.fonts.head,
    "--font-body": t.fonts.body,
    "--font-mono": t.fonts.mono,
    "--shadow": `0 18px 40px ${shadowColor}`,
    "--shadow-soft": `0 6px 18px ${shadowSoft}`,
    "--hairline": hairline,
    "--glow": t.glow || "transparent"
  });
}

/* ---- apply a skin spec to an element ---------------------------------- */
// Mirrors the original applySpec: inline CSS vars (CSP-safe CSSOM path) + the
// brand mark tokens + color-scheme + data-* attributes that drive CSS variants.
export function applySkin(el: HTMLElement, spec: ThemeSpec): ThemeSpec {
  const tokens = expand(spec);
  for (const k in tokens) el.style.setProperty(k, tokens[k]);
  if (spec.brand) {
    el.style.setProperty("--mark-fill", spec.brand.markFill || tokens["--accent"]);
    el.style.setProperty("--mark-ink", spec.brand.markInk || tokens["--accent-ink"]);
  }
  el.style.setProperty("color-scheme", spec.mode);
  el.setAttribute("data-theme", spec.id || "custom");
  el.setAttribute("data-mode", spec.mode);
  el.setAttribute("data-nav", spec.nav);
  el.setAttribute("data-icons", spec.icons);
  return spec;
}

/* ---- apply by id (falls back to the default skin) --------------------- */
export function applySkinById(el: HTMLElement, id: string): ThemeSpec {
  const spec = SKIN_MAP[id] || SKIN_MAP[DEFAULT_SKIN_ID];
  return applySkin(el, spec);
}
