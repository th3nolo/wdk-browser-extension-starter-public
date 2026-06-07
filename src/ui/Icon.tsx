/* ============================================================================
   WDK icon set — line icons drawn with currentColor strokes.
   ----------------------------------------------------------------------------
   Verbatim TS port of the prototype's icons.jsx (ICON_PATHS + Icon). Every
   screen references these names, so the table must stay in lockstep with the
   prototype. The `[data-icons='solid']` token (set by the theme engine on the
   .wlt root) bumps stroke-width to 2.6 via styles.css for the solid icon axis.
   Pure presentational — no business logic, no SDK imports.
   ========================================================================== */
import type { CSSProperties } from "react";

export const ICON_PATHS: Record<string, string> = {
  chevronDown: "m6 9 6 6 6-6",
  chevronRight: "m9 6 6 6-6 6",
  chevronLeft: "m15 6-6 6 6 6",
  arrowLeft: "M19 12H5m6-7-7 7 7 7",
  send: "M7 17 17 7M8 7h9v9",
  receive: "M17 7 7 17M16 17H7V8",
  swap: "M7 4v13m0 0 3-3m-3 3-3-3M17 20V7m0 0 3 3m-3-3-3 3",
  plus: "M12 5v14M5 12h14",
  coins: "M2 8a6 6 0 1 0 12 0 6 6 0 1 0-12 0|M18.09 10.37A6 6 0 1 1 10.34 18|M7 6h1v4|m16.71 13.88.7.71-2.82 2.82",
  history: "M3 20h18|M7.5 20v-4.5|M12 20v-9|M16.5 20v-13",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3 12h18M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18",
  settings: "M4 6.5h16M4 12h16M4 17.5h16|M15 4.5v4M8.5 10v4M16 15.5v4",
  lock: "M5 11h14v9H5zM8 11V8a4 4 0 0 1 8 0v3",
  unlock: "M5 11h14v9H5zM8 11V7a4 4 0 0 1 7.5-2",
  refresh: "M21 12a9 9 0 1 1-3-6.7M21 4v4h-4",
  copy: "M9 9h11v11H9zM5 15V5a2 2 0 0 1 2-2h10",
  check: "m5 13 4 4L19 7",
  checkCircle: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z|m8 12 3 3 5-6",
  x: "M6 6 18 18M18 6 6 18",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z|M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  eyeOff: "M3 3l18 18M10.6 10.6a3 3 0 0 0 4 4M9.4 5.2A9.5 9.5 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-2.2 3M6.2 6.2A17 17 0 0 0 2 12s4 7 10 7a9.5 9.5 0 0 0 2.6-.4",
  shield: "M12 3 5 6v5c0 4 3 7 7 9 4-2 7-5 7-9V6l-7-3Z|m9 12 2 2 4-4",
  alert: "M12 3 2 20h20L12 3Z|M12 9v5M12 17h.01",
  scan: "M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16",
  wallet: "M3 7h15a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Zm0 0 1.5-3H16M16 13h2",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13",
  external: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  dots: "M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z",
  qr: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z",
  layers: "M12 3 2 8l10 5 10-5-10-5ZM2 13l10 5 10-5M2 18l10 5 10-5",
  power: "M12 3v9M6.5 7a8 8 0 1 0 11 0",
  link: "M9 15l6-6M11 6l1-1a4 4 0 0 1 6 6l-1 1M13 18l-1 1a4 4 0 0 1-6-6l1-1",
  download: "M12 3v12m0 0 4-4m-4 4-4-4M4 21h16",
  filter: "M3 5h18l-7 8v6l-4 2v-8L3 5Z",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2"
};

export type IconName = keyof typeof ICON_PATHS;

export function Icon({
  name,
  size = 18,
  strokeWidth = 2,
  style
}: {
  name: IconName | string;
  size?: number;
  strokeWidth?: number;
  style?: CSSProperties;
}) {
  const d = ICON_PATHS[name] ?? "";
  const parts = d.split("|");
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      aria-hidden="true"
    >
      {parts.map((p, i) => (
        <path key={i} d={p} />
      ))}
    </svg>
  );
}
