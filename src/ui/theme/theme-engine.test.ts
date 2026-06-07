// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { SKIN_MAP, SKINS, DEFAULT_SKIN_ID } from "./skins";
import { expand, applySkin, applySkinById } from "./theme-engine";
import { getStoredSkin, setSkin, getRoot, SKIN_STORAGE_KEY } from "./useTheme";

afterEach(() => {
  localStorage.clear();
});

describe("expand()", () => {
  it("emits the evolved accent verbatim and sets a background", () => {
    const tokens = expand(SKIN_MAP.evolved);
    expect(tokens["--accent"]).toBe("#2dd4bf");
    expect(tokens["--bg"]).toBeTruthy();
  });

  it("emits the --font-* family stacks from the skin spec", () => {
    const tokens = expand(SKIN_MAP.evolved);
    expect(tokens["--font-head"]).toBe("'Space Grotesk', sans-serif");
    expect(tokens["--font-mono"]).toBe("'JetBrains Mono', monospace");
  });

  it("covers every ported skin without throwing", () => {
    for (const skin of SKINS) {
      const tokens = expand(skin);
      expect(tokens["--accent"]).toBe(skin.accent.base);
      expect(tokens["--bg"]).toBeTruthy();
    }
  });
});

describe("applySkin()", () => {
  it("sets data-nav / data-icons / data-theme + color-scheme", () => {
    const el = document.createElement("div");
    applySkin(el, SKIN_MAP.pulse);
    expect(el.getAttribute("data-nav")).toBe("pill");
    expect(el.getAttribute("data-icons")).toBe("solid");
    expect(el.getAttribute("data-theme")).toBe("pulse");
    expect(el.getAttribute("data-mode")).toBe("dark");
    expect(el.style.getPropertyValue("color-scheme")).toBe("dark");
  });

  it("sets the brand mark tokens when the skin has a brand", () => {
    const el = document.createElement("div");
    applySkin(el, SKIN_MAP.evolved);
    expect(el.style.getPropertyValue("--mark-fill")).toBe(
      "linear-gradient(145deg, #2dd4bf, #6366f1)"
    );
    expect(el.style.getPropertyValue("--mark-ink")).toBe("#03231f");
  });

  it("applySkinById falls back to the default skin for unknown ids", () => {
    const el = document.createElement("div");
    applySkinById(el, "does-not-exist");
    expect(el.getAttribute("data-theme")).toBe(DEFAULT_SKIN_ID);
  });
});

describe("persistence (useTheme)", () => {
  it("defaults to evolved when nothing is stored", () => {
    expect(getStoredSkin()).toBe(DEFAULT_SKIN_ID);
  });

  it("round-trips a valid skin id through setSkin/getStoredSkin", () => {
    setSkin("terminal");
    expect(localStorage.getItem(SKIN_STORAGE_KEY)).toBe("terminal");
    expect(getStoredSkin()).toBe("terminal");
  });

  it("rejects an invalid stored id and falls back to the default", () => {
    localStorage.setItem(SKIN_STORAGE_KEY, "bogus");
    expect(getStoredSkin()).toBe(DEFAULT_SKIN_ID);
  });

  it("setSkin coerces unknown ids to the default and applies to the root", () => {
    expect(setSkin("nope")).toBe(DEFAULT_SKIN_ID);
    expect(localStorage.getItem(SKIN_STORAGE_KEY)).toBe(DEFAULT_SKIN_ID);
    expect(getRoot().getAttribute("data-theme")).toBe(DEFAULT_SKIN_ID);
  });
});
