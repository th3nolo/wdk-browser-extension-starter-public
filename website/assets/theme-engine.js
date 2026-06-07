/* ============================================================================
   WDK Whitelabel Theme Engine
   ----------------------------------------------------------------------------
   The wallet UI references ONLY semantic CSS custom properties (the "token
   contract"). A theme is a small JS object; applyTheme() expands it into the
   full token set and writes the variables onto a target element. Swapping the
   theme object fully rebrands the wallet — no component, flow, or backend code
   changes. This file is the single source of truth shared by the design-system
   page and the interactive prototype.
   ========================================================================== */
(function () {
  "use strict";

  /* ---- helpers ---------------------------------------------------------- */
  // Neutrals built in OKLCH so any brand hue tints the greys consistently.
  function oklch(l, c, h) { return `oklch(${l} ${c} ${h})`; }
  function rgba(hex, a) {
    const v = hex.replace("#", "");
    const n = v.length === 3 ? v.split("").map((x) => x + x).join("") : v;
    const r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }

  /* ---- shape → radius scale -------------------------------------------- */
  const SHAPE = {
    sharp:   { lg: "4px",  md: "3px",  sm: "2px",  pill: "6px",   field: "3px" },
    edged:   { lg: "8px",  md: "6px",  sm: "5px",  pill: "999px", field: "6px" },
    rounded: { lg: "14px", md: "11px", sm: "8px",  pill: "999px", field: "10px" },
    soft:    { lg: "20px", md: "16px", sm: "12px", pill: "999px", field: "14px" },
    pill:    { lg: "26px", md: "22px", sm: "16px", pill: "999px", field: "999px" }
  };

  /* ---- density → spacing scale ----------------------------------------- */
  const DENSITY = {
    compact:  { pad: "11px", gap: "8px",  ctrl: "38px", row: "9px 11px",  sect: "10px" },
    cozy:     { pad: "14px", gap: "11px", ctrl: "44px", row: "12px 14px", sect: "14px" },
    spacious: { pad: "18px", gap: "15px", ctrl: "50px", row: "15px 16px", sect: "18px" }
  };

  /* ---- neutral ramp from mode + tint hue -------------------------------- */
  function neutrals(mode, hue, chroma) {
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

  /* ---- build the full token map from a theme spec ----------------------- */
  function expand(t) {
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
    const hairline = t.mode === "light" ? "inset 0 1px 0 rgba(255,255,255,0.8)" : "inset 0 1px 0 rgba(255,255,255,0.055)";

    return Object.assign({}, n, {
      "--accent": a.base,
      "--accent-strong": a.strong || a.base,
      "--accent-ink": a.ink || (t.mode === "light" ? "#ffffff" : "#04201d"),
      "--accent-soft": rgba(a.base, t.mode === "light" ? 0.1 : 0.16),
      "--accent-ring": rgba(a.base, 0.4),
      "--accent-2": a.second || a.base,
      "--danger": danger, "--danger-soft": rgba(danger, t.mode === "light" ? 0.1 : 0.14),
      "--warn": warn, "--warn-soft": rgba(warn, t.mode === "light" ? 0.12 : 0.14),
      "--good": good, "--good-soft": rgba(good, 0.14),
      "--info": info, "--info-soft": rgba(info, 0.14),
      "--radius": shape.lg, "--radius-md": shape.md, "--radius-sm": shape.sm,
      "--radius-pill": shape.pill, "--radius-field": shape.field,
      "--pad": dens.pad, "--gap": dens.gap, "--control-h": dens.ctrl,
      "--row-pad": dens.row, "--sect-gap": dens.sect,
      "--font-head": t.fonts.head, "--font-body": t.fonts.body, "--font-mono": t.fonts.mono,
      "--shadow": `0 18px 40px ${shadowColor}`,
      "--shadow-soft": `0 6px 18px ${shadowSoft}`,
      "--hairline": hairline,
      "--glow": t.glow || "transparent"
    });
  }

  function applyTheme(el, themeId) {
    const t = THEME_MAP[themeId] || THEMES[0];
    return applySpec(el, t);
  }

  // Apply an arbitrary (possibly user-overridden) theme spec object.
  function applySpec(el, spec) {
    const t = Object.assign({}, spec);
    const tokens = expand(t);
    for (const k in tokens) el.style.setProperty(k, tokens[k]);
    if (t.brand) {
      el.style.setProperty("--mark-fill", t.brand.markFill || tokens["--accent"]);
      el.style.setProperty("--mark-ink", t.brand.markInk || tokens["--accent-ink"]);
    }
    el.style.setProperty("color-scheme", t.mode);
    el.setAttribute("data-theme", t.id || "custom");
    el.setAttribute("data-mode", t.mode);
    el.setAttribute("data-nav", t.nav);
    el.setAttribute("data-icons", t.icons);
    return t;
  }

  /* ---- font loading ----------------------------------------------------- */
  const FONT_QUERIES = [
    "Space+Grotesk:wght@400;500;600;700",
    "JetBrains+Mono:wght@400;500;700",
    "Hanken+Grotesk:wght@400;500;600;700;800",
    "IBM+Plex+Mono:wght@400;500;600",
    "Manrope:wght@400;500;600;700;800",
    "Spectral:wght@400;500;600;700",
    "Chakra+Petch:wght@400;500;600;700",
    "Space+Mono:wght@400;700",
    "Sora:wght@400;500;600;700;800",
    "Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600"
  ];
  function loadFonts() {
    if (document.getElementById("wdk-fonts")) return;
    const l = document.createElement("link");
    l.id = "wdk-fonts";
    l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?" + FONT_QUERIES.map((q) => "family=" + q).join("&") + "&display=swap";
    document.head.appendChild(l);
  }

  /* ======================================================================
     THEMES — 2 base directions + 6 fictional whitelabel brands
     ====================================================================== */
  const sans = "'Hanken Grotesk', ui-sans-serif, system-ui, sans-serif";
  const THEMES = [
    /* ---- BASE 1: evolved premium dark (refines the shipped UI) -------- */
    {
      id: "evolved", name: "WDK Evolved", group: "Base",
      tagline: "Refined premium dark — the shipped UI, leveled up.",
      mode: "dark", tint: 255, chroma: 0.014,
      accent: { base: "#2dd4bf", strong: "#14b8a6", ink: "#03231f", second: "#6366f1" },
      fonts: { head: "'Space Grotesk', sans-serif", body: "'Space Grotesk', sans-serif", mono: "'JetBrains Mono', monospace" },
      shape: "rounded", density: "cozy", nav: "bottom", icons: "line",
      glow: "radial-gradient(150% 70% at 50% -30%, rgba(45,212,191,0.09), transparent 55%)",
      brand: { name: "WDK Wallet", glyph: "◈", markFill: "linear-gradient(145deg, #2dd4bf, #6366f1)", markInk: "#03231f" }
    },
    /* ---- BASE 2a: fresh brand-neutral light --------------------------- */
    {
      id: "neutral-light", name: "Neutral Light", group: "Base",
      tagline: "Brand-neutral light base, tuned for easy recoloring.",
      mode: "light", tint: 255, chroma: 0.01,
      accent: { base: "#4f46e5", strong: "#4338ca", ink: "#ffffff", second: "#0ea5e9" },
      fonts: { head: "'Hanken Grotesk', sans-serif", body: sans, mono: "'IBM Plex Mono', monospace" },
      shape: "rounded", density: "cozy", nav: "bottom", icons: "line",
      brand: { name: "Acme Wallet", glyph: "●", markFill: "#4f46e5", markInk: "#ffffff" }
    },
    /* ---- BASE 2b: fresh brand-neutral dark ---------------------------- */
    {
      id: "neutral-dark", name: "Neutral Dark", group: "Base",
      tagline: "The neutral base in dark mode — same tokens, flipped.",
      mode: "dark", tint: 255, chroma: 0.011,
      accent: { base: "#818cf8", strong: "#6366f1", ink: "#0b1030", second: "#38bdf8" },
      fonts: { head: "'Hanken Grotesk', sans-serif", body: sans, mono: "'IBM Plex Mono', monospace" },
      shape: "rounded", density: "cozy", nav: "bottom", icons: "line",
      brand: { name: "Acme Wallet", glyph: "●", markFill: "#818cf8", markInk: "#0b1030" }
    },
    /* ---- BRAND: Aurum — luxury gold (XAUt energy) --------------------- */
    {
      id: "aurum", name: "Aurum", group: "Brand",
      tagline: "Luxury gold custody. Serif, sharp, spacious.",
      mode: "dark", tint: 70, chroma: 0.02,
      accent: { base: "#d4af37", strong: "#c79a26", ink: "#241a02", second: "#e8c766" },
      fonts: { head: "'Spectral', serif", body: sans, mono: "'JetBrains Mono', monospace" },
      shape: "sharp", density: "spacious", nav: "rail", icons: "line",
      glow: "radial-gradient(circle at 50% -10%, rgba(212,175,55,0.1), transparent 45%)",
      brand: { name: "Aurum Reserve", glyph: "Au", markFill: "linear-gradient(145deg,#e8c766,#b8901f)", markInk: "#241a02" }
    },
    /* ---- BRAND: Pulse — neon gaming ---------------------------------- */
    {
      id: "pulse", name: "Pulse", group: "Brand",
      tagline: "Neon gaming wallet. High energy, rounded, glowing.",
      mode: "dark", tint: 285, chroma: 0.02,
      accent: { base: "#e836c6", strong: "#d121b1", ink: "#1a0418", second: "#22d3ee" },
      fonts: { head: "'Chakra Petch', sans-serif", body: "'Chakra Petch', sans-serif", mono: "'Space Mono', monospace" },
      shape: "soft", density: "cozy", nav: "pill", icons: "solid",
      glow: "radial-gradient(130% 65% at 50% -25%, rgba(232,54,198,0.12), transparent 60%)",
      brand: { name: "Pulse", glyph: "▶", markFill: "linear-gradient(145deg,#e836c6,#22d3ee)", markInk: "#1a0418" }
    },
    /* ---- BRAND: Meridian — clean fintech ----------------------------- */
    {
      id: "meridian", name: "Meridian", group: "Brand",
      tagline: "Trustworthy fintech. Light, blue, spacious, calm.",
      mode: "light", tint: 245, chroma: 0.008,
      accent: { base: "#1d6ef0", strong: "#1559cf", ink: "#ffffff", second: "#0ea5e9" },
      fonts: { head: "'Manrope', sans-serif", body: "'Manrope', sans-serif", mono: "'IBM Plex Mono', monospace" },
      shape: "rounded", density: "spacious", nav: "bottom", icons: "line",
      brand: { name: "Meridian", glyph: "◐", markFill: "#1d6ef0", markInk: "#ffffff" }
    },
    /* ---- BRAND: Terminal — developer / pro --------------------------- */
    {
      id: "terminal", name: "Terminal", group: "Brand",
      tagline: "Power-user mono. Dense, sharp, green-on-black.",
      mode: "dark", tint: 150, chroma: 0.012,
      accent: { base: "#4ade80", strong: "#22c55e", ink: "#04210f", second: "#a3e635" },
      fonts: { head: "'JetBrains Mono', monospace", body: "'JetBrains Mono', monospace", mono: "'JetBrains Mono', monospace" },
      shape: "sharp", density: "compact", nav: "rail", icons: "line",
      brand: { name: "wdk://term", glyph: ">_", markFill: "#0b1410", markInk: "#4ade80" }
    },
    /* ---- BRAND: Bloom — friendly consumer ---------------------------- */
    {
      id: "bloom", name: "Bloom", group: "Brand",
      tagline: "Warm consumer wallet. Coral, pill-soft, approachable.",
      mode: "light", tint: 30, chroma: 0.012,
      accent: { base: "#fb6a4a", strong: "#ef4f2c", ink: "#ffffff", second: "#f6a821" },
      fonts: { head: "'Sora', sans-serif", body: "'Sora', sans-serif", mono: "'IBM Plex Mono', monospace" },
      shape: "pill", density: "spacious", nav: "pill", icons: "solid",
      brand: { name: "Bloom", glyph: "✿", markFill: "linear-gradient(145deg,#fb6a4a,#f6a821)", markInk: "#ffffff" }
    },
    /* ---- BRAND: Nocturne — after-dark violet luxe -------------------- */
    {
      id: "nocturne", name: "Nocturne", group: "Brand",
      tagline: "After-dark luxe. Deep violet, soft, quietly glowing.",
      mode: "dark", tint: 300, chroma: 0.017,
      accent: { base: "#a78bfa", strong: "#8b5cf6", ink: "#1b0b30", second: "#f0abfc" },
      fonts: { head: "'Sora', sans-serif", body: sans, mono: "'IBM Plex Mono', monospace" },
      shape: "soft", density: "cozy", nav: "bottom", icons: "line",
      glow: "radial-gradient(140% 70% at 50% -25%, rgba(167,139,250,0.12), transparent 58%)",
      brand: { name: "Nocturne", glyph: "☾", markFill: "linear-gradient(145deg,#a78bfa,#f0abfc)", markInk: "#1b0b30" }
    },
    /* ---- BRAND: Arctic Glass — frosted icy light -------------------- */
    {
      id: "arctic", name: "Arctic Glass", group: "Brand",
      tagline: "Frosted glass custody. Icy light, crisp, calm.",
      mode: "light", tint: 240, chroma: 0.015,
      accent: { base: "#3b82f6", strong: "#2563eb", ink: "#ffffff", second: "#7dd3fc" },
      fonts: { head: "'Manrope', sans-serif", body: "'Manrope', sans-serif", mono: "'IBM Plex Mono', monospace" },
      shape: "rounded", density: "cozy", nav: "bottom", icons: "line",
      glow: "radial-gradient(150% 75% at 50% -20%, rgba(125,211,252,0.16), transparent 60%)",
      brand: { name: "Arctic Glass", glyph: "❄", markFill: "linear-gradient(145deg,#7dd3fc,#3b82f6)", markInk: "#ffffff" }
    },
    /* ---- BRAND: Ivory Vault — ivory + navy + gold luxe -------------- */
    {
      id: "ivory", name: "Ivory Vault", group: "Brand",
      tagline: "Heritage private bank. Ivory, deep navy, gold crest.",
      mode: "light", tint: 85, chroma: 0.016,
      accent: { base: "#1e3a5f", strong: "#16304e", ink: "#ffffff", second: "#c9a35e" },
      fonts: { head: "'Newsreader', serif", body: sans, mono: "'IBM Plex Mono', monospace" },
      shape: "rounded", density: "cozy", nav: "bottom", icons: "line",
      glow: "radial-gradient(150% 75% at 50% -20%, rgba(201,163,94,0.12), transparent 60%)",
      brand: { name: "Ivory Vault", glyph: "❖", markFill: "linear-gradient(145deg,#e3c987,#b8923f)", markInk: "#1e3a5f" }
    },
    /* ---- BRAND: Swiss Ledger — neutral Swiss precision ------------- */
    {
      id: "swiss", name: "Swiss Ledger", group: "Brand",
      tagline: "Swiss precision custody. Neutral, exact, grotesque.",
      mode: "light", tint: 255, chroma: 0.004,
      accent: { base: "#1d4ed8", strong: "#1e40af", ink: "#ffffff", second: "#3b82f6" },
      semantic: { danger: "#d4202a" },
      fonts: { head: "'Helvetica Neue', Helvetica, Arial, sans-serif", body: "'Helvetica Neue', Helvetica, Arial, sans-serif", mono: "'IBM Plex Mono', monospace" },
      shape: "edged", density: "cozy", nav: "bottom", icons: "line",
      brand: { name: "Swiss Ledger", glyph: "✚", markFill: "#111418", markInk: "#ffffff" }
    }
  ];

  const THEME_MAP = Object.fromEntries(THEMES.map((t) => [t.id, t]));

  /* ---- public surface --------------------------------------------------- */
  window.WDK = {
    THEMES, THEME_MAP, applyTheme, applySpec, expand, loadFonts,
    SHAPE_KEYS: Object.keys(SHAPE), DENSITY_KEYS: Object.keys(DENSITY)
  };
})();
