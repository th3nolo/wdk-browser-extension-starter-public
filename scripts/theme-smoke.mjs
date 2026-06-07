/* ============================================================================
   THEME SMOKE — per-skin VISUAL + FUNCTIONAL verification for the 12 skins.
   ----------------------------------------------------------------------------
   Launches Chrome-for-Testing headless with the built extension, creates a
   wallet so the home screen renders, then for EACH skin in
   `src/ui/theme/skins.ts`:
     - writes localStorage["wdk:skin"] = <id> and reloads the popup;
     - asserts #root carries the skin's data-mode / data-nav;
     - asserts the popup is NOT blank;
     - asserts the nav (.nav / .nav-item) renders and its items are reachable;
     - asserts the Tokens primary actions (Send / Receive / Add) exist, fit the
       410px-wide viewport, are enabled, and are the top element at their centre
       (no overlay intercepts);
     - navigates to Send and asserts "Review send" + button[title='Scan QR code']
       are present and reachable;
     - captures a full-page screenshot to .output/theme-shots/<id>.png;
     - records any Runtime.exceptionThrown / error console / CSP entries from a
       popup-attached diagnostics socket (must be zero).
   Restores the skin to `evolved`, writes .output/theme-shots/report.json, and
   prints a PASS/FAIL matrix. Exits non-zero if ANY skin fails a hard check.

   scripts/ + package.json only — no src/ file is touched. The skin id list is
   regex'd out of src/ui/theme/skins.ts at runtime so it stays in sync.
   ========================================================================== */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createSmokeConfig } from "./lib/chrome-smoke/config.mjs";
import { launchCdpBrowser, windowsHostIp } from "./lib/chrome-smoke/browser.mjs";
import {
  cdpCommand,
  delay,
  evaluateCdp,
  getFreePort,
  listCdpTargets,
  openCdpTarget,
  rewriteCdpWebSocketHost,
  waitForCdpExpression
} from "./lib/chrome-smoke/cdp.mjs";
import {
  findExtensionServiceWorkerTarget,
  resolveWalletExtensionId,
  wakeExtensionServiceWorker
} from "./lib/chrome-smoke/extension.mjs";
import { startExtensionDiagnostics } from "./lib/chrome-smoke/diagnostics.mjs";

const SMOKE_WALLET_PASSWORD = "correct horse battery staple";
const SMOKE_SEED_PHRASE =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const DEFAULT_SKIN_ID = "evolved";
const SKIN_STORAGE_KEY = "wdk:skin";
const VIEWPORT_WIDTH = 410;
// Below this body text length the popup is treated as blank.
const MIN_BODY_TEXT_LENGTH = 60;

const config = await createSmokeConfig();
const root = config.root;
const shotsDir = resolve(root, ".output", "theme-shots");

const skins = await readSkins(join(root, "src", "ui", "theme", "skins.ts"));
if (skins.length !== 12) {
  console.warn(`[theme-smoke] expected 12 skins, found ${skins.length}: ${skins.map((s) => s.id).join(", ")}`);
}

await rm(shotsDir, { recursive: true, force: true }).catch(() => undefined);
await mkdir(shotsDir, { recursive: true });

const debugPort = await getFreePort();
const cdpHost = config.isWindowsBrowser ? windowsHostIp() : "127.0.0.1";
const browserArgs = [
  "--headless=new",
  "--disable-gpu",
  "--no-sandbox",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-dev-shm-usage",
  "--disable-features=DisableLoadExtensionCommandLineSwitch",
  "--remote-allow-origins=*",
  `--remote-debugging-address=${config.isWindowsBrowser ? "0.0.0.0" : "127.0.0.1"}`,
  `--remote-debugging-port=${debugPort}`,
  `--window-size=${VIEWPORT_WIDTH},900`,
  `--user-data-dir=${config.browserUserDataDir}`,
  `--disable-extensions-except=${config.browserExtensionPath}`,
  `--load-extension=${config.browserExtensionPath}`,
  "about:blank"
];

const results = [];
let popupDiagnostics;
const launched = await launchCdpBrowser(config.browserPath, browserArgs);
try {
  await waitForCdpEndpoint(cdpHost, debugPort, config.timeoutMs);

  // Resolve the extension id off CDP targets (no dApp page in this flow).
  const extensionId = await resolveExtensionId({ cdpHost, debugPort });
  log(`extension id ${extensionId}`);

  // Wake the service worker so chrome.runtime messaging is live, then open the popup.
  await wakeExtensionServiceWorker({ host: cdpHost, port: debugPort, extensionId, workerTimeoutMs: config.workerTimeoutMs });
  const popupUrl = `chrome-extension://${extensionId}/popup.html`;
  const popupTarget = await openCdpTarget(cdpHost, debugPort, popupUrl);
  if (!popupTarget.webSocketDebuggerUrl) throw new Error("Unable to open extension popup target");
  const popupWs = rewriteCdpWebSocketHost(popupTarget.webSocketDebuggerUrl, cdpHost);

  await waitForCdpExpression(popupWs, "typeof chrome?.runtime?.sendMessage === 'function'", config.timeoutMs);
  // Pin the popup to the real 410px-wide extension viewport so overflow and
  // elementFromPoint checks reflect the production popup width.
  await cdpCommand(popupWs, "Page.enable", {}).catch(() => undefined);
  await cdpCommand(popupWs, "Emulation.setDeviceMetricsOverride", {
    width: VIEWPORT_WIDTH,
    height: 600,
    deviceScaleFactor: 1,
    mobile: false
  }).catch(() => undefined);

  // Create the wallet (mirrors the existing harness CREATE_WALLET pattern) so
  // hasVault + an unlocked session render the home screen after a reload.
  await extensionMessage(popupWs, {
    type: "CREATE_WALLET",
    name: "Theme smoke wallet",
    password: SMOKE_WALLET_PASSWORD,
    seedPhrase: SMOKE_SEED_PHRASE
  });
  log("created smoke wallet");

  // Attach a popup-scoped diagnostics socket once; we snapshot its length
  // before/after each skin so a skin's render only owns its own entries.
  popupDiagnostics = await startExtensionDiagnostics({
    host: cdpHost,
    port: debugPort,
    target: popupTarget,
    log: process.env.SMOKE_POPUP_DIAGNOSTICS_LOG === "1"
  });

  for (const skin of skins) {
    const before = popupDiagnostics.snapshot().length;
    const result = await verifySkin({ popupWs, skin });
    const diagEntries = popupDiagnostics.snapshot().slice(before);
    const fatal = diagEntries.filter(isFatalEntry);
    if (fatal.length) {
      result.ok = false;
      result.reasons.push(`diagnostics: ${fatal.length} fatal entr${fatal.length === 1 ? "y" : "ies"} (${summariseEntries(fatal)})`);
    }
    result.diagnostics = { total: diagEntries.length, fatal: fatal.length, entries: fatal.slice(0, 5) };
    results.push(result);
    log(`${result.ok ? "PASS" : "FAIL"} ${skin.id}${result.reasons.length ? ` — ${result.reasons.join("; ")}` : ""}`);
  }

  // Restore the default skin so the profile (if reused) is left on `evolved`.
  await evaluateCdp(
    popupWs,
    `(() => { localStorage.setItem(${JSON.stringify(SKIN_STORAGE_KEY)}, ${JSON.stringify(DEFAULT_SKIN_ID)}); return true; })()`
  ).catch(() => undefined);
} catch (error) {
  console.error(`[theme-smoke] fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await popupDiagnostics?.stop().catch(() => undefined);
  await launched.kill().catch(() => undefined);
  await rm(config.userDataDir, { recursive: true, force: true }).catch(() => undefined);
}

const passed = results.filter((entry) => entry.ok).length;
const failed = results.filter((entry) => !entry.ok);
const report = {
  ok: failed.length === 0 && results.length === skins.length,
  browser: config.browserName,
  browserPath: config.browserPath,
  skinCount: skins.length,
  passed,
  failed: failed.length,
  shotsDir,
  generatedAt: new Date().toISOString(),
  skins: results
};
await writeFile(join(shotsDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`).catch((error) => {
  console.error(`[theme-smoke] unable to write report.json: ${error instanceof Error ? error.message : String(error)}`);
});

printMatrix(results, skins);

if (results.length !== skins.length) {
  console.error(`[theme-smoke] only ${results.length}/${skins.length} skins were verified`);
  process.exitCode = 1;
}
if (failed.length) {
  process.exitCode = 1;
}

/* ----------------------------------------------------------------------- */

async function verifySkin({ popupWs, skin }) {
  const reasons = [];
  const warnings = [];
  const checks = {};
  const shotPath = join(shotsDir, `${skin.id}.png`);

  try {
    // Apply the skin and reload so main.tsx re-themes #root at first paint.
    await evaluateCdp(
      popupWs,
      `(() => { localStorage.setItem(${JSON.stringify(SKIN_STORAGE_KEY)}, ${JSON.stringify(skin.id)}); location.reload(); return true; })()`
    );
    // Wait for the document to settle and the wallet shell (.wlt) to mount.
    await waitForCdpExpression(
      popupWs,
      "document.readyState === 'complete' && !!document.querySelector('#root .wlt, #root.wlt')",
      config.timeoutMs
    );
    await unlockIfLocked(popupWs);
    // Ensure the home screen (Tokens actions) is present before asserting.
    await waitForCdpExpression(
      popupWs,
      "!!document.querySelector('.token-actions') && document.querySelectorAll('.nav .nav-item').length > 0",
      config.timeoutMs
    ).catch(() => undefined);

    const home = parse(await evaluateCdp(popupWs, homeAssertionExpression(skin), { label: `assert home ${skin.id}` }));
    checks.dataMode = home.dataMode;
    checks.dataNav = home.dataNav;
    checks.bodyTextLength = home.bodyTextLength;
    checks.navItemCount = home.navItemCount;

    if (home.dataMode !== skin.mode) reasons.push(`#root data-mode "${home.dataMode}" != expected "${skin.mode}"`);
    if (home.dataNav !== skin.nav) reasons.push(`#root data-nav "${home.dataNav}" != expected "${skin.nav}"`);
    if (home.bodyTextLength < MIN_BODY_TEXT_LENGTH) reasons.push(`popup looks blank (body text length ${home.bodyTextLength} < ${MIN_BODY_TEXT_LENGTH})`);
    if (!home.navPresent) reasons.push("nav (.nav) is not present");
    if (home.navItemCount < 1) reasons.push("nav has no reachable .nav-item entries");
    for (const item of home.navIssues) reasons.push(`nav item "${item.label}": ${item.reason}`);

    for (const action of home.actions) {
      if (!action.present) { reasons.push(`Tokens "${action.title}" button missing`); continue; }
      if (action.disabled) reasons.push(`Tokens "${action.title}" button is disabled`);
      if (action.overflowsViewport) reasons.push(`Tokens "${action.title}" button overflows the ${VIEWPORT_WIDTH}px viewport (right=${action.right})`);
      if (action.zeroSize) reasons.push(`Tokens "${action.title}" button has zero size`);
      if (action.intercepted) reasons.push(`Tokens "${action.title}" button is overlaid by ${action.intercepting}`);
    }
    if (Array.isArray(home.contrastWarnings)) warnings.push(...home.contrastWarnings);

    // Navigate to Send and assert Review send + Scan QR are reachable.
    const send = parse(await evaluateCdp(popupWs, sendAssertionExpression(), { awaitPromise: true, timeoutMs: 10_000, label: `assert send ${skin.id}` }));
    checks.sendReviewPresent = send.reviewPresent;
    checks.sendScanPresent = send.scanPresent;
    if (!send.opened) reasons.push("could not open the Send screen (Send action not found/clickable)");
    if (!send.reviewPresent) reasons.push("Send screen: 'Review send' button missing");
    else if (send.reviewOverflows) reasons.push(`Send screen: 'Review send' overflows the ${VIEWPORT_WIDTH}px viewport (right=${send.reviewRight})`);
    if (!send.scanPresent) reasons.push("Send screen: button[title='Scan QR code'] missing");
    else if (send.scanZeroSize) reasons.push("Send screen: Scan QR button has zero size (not laid out)");
    else if (send.scanIntercepted) reasons.push(`Send screen: Scan QR button is overlaid by ${send.scanIntercepting}`);

    // Return to the Tokens overview so the screenshot shows the home screen.
    await evaluateCdp(popupWs, backToTokensExpression(), { awaitPromise: true, timeoutMs: 10_000, label: `return to tokens ${skin.id}` }).catch(() => undefined);
    await waitForCdpExpression(popupWs, "!!document.querySelector('.token-actions')", config.timeoutMs).catch(() => undefined);
    // Wait for balances to finish loading (hero count replaces the "Loading balances…" state)
    // so every skin's screenshot frames the same settled data, not a mid-load race.
    await waitForCdpExpression(popupWs, "!!document.querySelector('.tokens-hero-count')", config.timeoutMs).catch(() => undefined);

    // Full-page screenshot at the 410px popup width.
    await captureSkinShot(popupWs, shotPath);
    checks.screenshot = `theme-shots/${skin.id}.png`;
  } catch (error) {
    reasons.push(`verification threw: ${error instanceof Error ? error.message : String(error)}`);
    // Best-effort screenshot even on failure so the matrix still has context.
    await captureSkinShot(popupWs, shotPath).catch(() => undefined);
    checks.screenshot = `theme-shots/${skin.id}.png`;
  }

  return {
    id: skin.id,
    name: skin.name,
    mode: skin.mode,
    nav: skin.nav,
    ok: reasons.length === 0,
    reasons,
    warnings,
    checks
  };
}

// In-page assertion for the home screen: reads #root attributes, body text
// length, the nav, and probes each Tokens primary action (present / enabled /
// in-viewport / not overlaid). Returns a JSON string evaluated in the popup.
function homeAssertionExpression(skin) {
  return `(() => {
    const viewportWidth = ${VIEWPORT_WIDTH};
    const describe = (node) => {
      if (!node) return "null";
      const cls = typeof node.className === "string" && node.className
        ? "." + node.className.trim().replace(/\\s+/g, ".")
        : "";
      return node.tagName ? node.tagName.toLowerCase() + cls : String(node);
    };
    const reachable = (el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return { zeroSize: true };
      const right = Math.round(rect.right);
      const overflowsViewport = rect.right > viewportWidth + 1 || rect.left < -1;
      const x = Math.round(Math.min(Math.max(rect.left + rect.width / 2, 1), viewportWidth - 1));
      const y = Math.round(rect.top + rect.height / 2);
      const top = document.elementFromPoint(x, y);
      const intercepted = !!(top && top !== el && !el.contains(top) && !top.contains(el));
      return {
        zeroSize: false,
        right,
        overflowsViewport,
        intercepted,
        intercepting: intercepted ? describe(top) : ""
      };
    };

    const rootEl = document.getElementById("root");
    const body = document.body;
    const bodyText = (body?.innerText || "").replace(/\\s+/g, " ").trim();

    // Nav: .nav with .nav-item children, reachable (clickable, not overlaid).
    const navEl = document.querySelector(".nav");
    const navItems = Array.from(document.querySelectorAll(".nav .nav-item"));
    const navIssues = [];
    for (const item of navItems) {
      const label = (item.textContent || "").replace(/\\s+/g, " ").trim() || "(icon)";
      if (item.disabled) { navIssues.push({ label, reason: "disabled" }); continue; }
      const probe = reachable(item);
      if (probe.zeroSize) navIssues.push({ label, reason: "zero size" });
      else if (probe.intercepted) navIssues.push({ label, reason: "overlaid by " + probe.intercepting });
    }

    // Tokens primary actions by their title attribute.
    const actionTitles = ["Send", "Receive", "Add account"];
    const actions = actionTitles.map((title) => {
      const btn = document.querySelector('.token-actions button[title="' + title + '"]')
        || Array.from(document.querySelectorAll(".token-actions button")).find((b) => (b.textContent || "").trim() === title.split(" ")[0]);
      if (!btn) return { title, present: false };
      const probe = reachable(btn);
      return {
        title,
        present: true,
        disabled: !!btn.disabled,
        zeroSize: probe.zeroSize,
        right: probe.right,
        overflowsViewport: probe.overflowsViewport,
        intercepted: probe.intercepted,
        intercepting: probe.intercepting
      };
    });

    return JSON.stringify({
      dataMode: rootEl?.getAttribute("data-mode") ?? null,
      dataNav: rootEl?.getAttribute("data-nav") ?? null,
      bodyTextLength: bodyText.length,
      navPresent: !!navEl,
      navItemCount: navItems.length,
      navIssues,
      actions,
      contrastWarnings: []
    });
  })()`;
}

// In-page navigation+assertion for the Send screen. Clicks the Tokens "Send"
// action, waits for the SendPanel, then probes Review send + Scan QR.
function sendAssertionExpression() {
  return `(async () => {
    const viewportWidth = ${VIEWPORT_WIDTH};
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const describe = (node) => {
      if (!node) return "null";
      const cls = typeof node.className === "string" && node.className
        ? "." + node.className.trim().replace(/\\s+/g, ".")
        : "";
      return node.tagName ? node.tagName.toLowerCase() + cls : String(node);
    };
    const sendBtn = document.querySelector('.token-actions button[title="Send"]')
      || Array.from(document.querySelectorAll(".token-actions button")).find((b) => (b.textContent || "").trim() === "Send");
    if (!sendBtn || sendBtn.disabled) {
      return JSON.stringify({ opened: false, reviewPresent: false, scanPresent: false });
    }
    sendBtn.click();
    let scan = null;
    for (let i = 0; i < 40; i++) {
      scan = document.querySelector("button[title='Scan QR code']");
      if (scan) break;
      await sleep(75);
    }
    const reviewBtn = Array.from(document.querySelectorAll("button"))
      .find((b) => (b.textContent || "").replace(/\\s+/g, " ").trim() === "Review send");
    let reviewOverflows = false;
    let reviewRight = null;
    if (reviewBtn) {
      const r = reviewBtn.getBoundingClientRect();
      reviewRight = Math.round(r.right);
      reviewOverflows = r.right > viewportWidth + 1 || r.left < -1;
    }
    let scanZeroSize = false;
    let scanIntercepted = false;
    let scanIntercepting = "";
    if (scan) {
      const r = scan.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) scanZeroSize = true;
      else {
        const x = Math.round(Math.min(Math.max(r.left + r.width / 2, 1), viewportWidth - 1));
        const y = Math.round(r.top + r.height / 2);
        const top = document.elementFromPoint(x, y);
        if (top && top !== scan && !scan.contains(top) && !top.contains(scan)) {
          scanIntercepted = true;
          scanIntercepting = describe(top);
        }
      }
    }
    return JSON.stringify({
      opened: true,
      reviewPresent: !!reviewBtn,
      reviewOverflows,
      reviewRight,
      scanPresent: !!scan,
      scanZeroSize,
      scanIntercepted,
      scanIntercepting
    });
  })()`;
}

// Click the Tokens nav item then the Back button (if on a subview) to return to
// the Tokens overview so the screenshot frames the home screen.
function backToTokensExpression() {
  return `(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const tokensNav = Array.from(document.querySelectorAll(".nav .nav-item"))
      .find((b) => (b.textContent || "").replace(/\\s+/g, " ").trim().startsWith("Tokens"));
    if (tokensNav) tokensNav.click();
    for (let i = 0; i < 20; i++) {
      if (document.querySelector(".token-actions")) break;
      const back = document.querySelector(".subview-bar button[title='Back']");
      if (back) back.click();
      await sleep(75);
    }
    return true;
  })()`;
}

async function captureSkinShot(popupWs, path) {
  const height = await evaluateCdp(popupWs, `(() => {
    const shell = document.querySelector(".shell") || document.getElementById("root") || document.body;
    const measured = Math.ceil(Math.max(
      shell?.getBoundingClientRect?.().bottom ?? 0,
      shell?.scrollHeight ?? 0,
      document.documentElement?.scrollHeight ?? 0,
      document.body?.scrollHeight ?? 0,
      600
    ));
    return Math.min(Math.max(measured, 600), 1400);
  })()`).catch(() => 600);
  // Capture the real 600px popup viewport (NOT the full scroll height): the bottom
  // nav is pinned and the pill/rail variants are positioned relative to the shell,
  // so a beyond-viewport capture would strand them. height is kept for the matrix.
  void height;
  const result = await cdpCommand(popupWs, "Page.captureScreenshot", {
    format: "png",
    clip: { x: 0, y: 0, width: VIEWPORT_WIDTH, height: 600, scale: 1 },
    captureBeyondViewport: false,
    fromSurface: true
  }, { timeoutMs: 10_000, label: "capture theme screenshot" });
  await writeFile(path, Buffer.from(result.data, "base64"));
}

async function unlockIfLocked(popupWs) {
  await evaluateCdp(
    popupWs,
    `(() => {
      const input = document.querySelector('input[type="password"]');
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      if (setter) setter.call(input, ${JSON.stringify(SMOKE_WALLET_PASSWORD)});
      else input.value = ${JSON.stringify(SMOKE_WALLET_PASSWORD)};
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      const unlock = Array.from(document.querySelectorAll("button")).find((b) => /unlock/i.test((b.textContent || "").trim()));
      if (unlock && !unlock.disabled) { unlock.click(); return true; }
      return false;
    })()`
  ).catch(() => undefined);
  await waitForCdpExpression(popupWs, "document.querySelector('input[type=\"password\"]') === null", config.timeoutMs).catch(() => undefined);
}

async function extensionMessage(popupWs, message) {
  const timeoutMs = config.messageTimeoutMs;
  return evaluateCdp(popupWs, `(async () => {
    const message = ${JSON.stringify(message)};
    const timeoutMs = ${timeoutMs};
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error(message.type + " timed out after " + timeoutMs + "ms")), timeoutMs));
    const runtime = globalThis.chrome?.runtime ?? globalThis.browser?.runtime;
    if (!runtime?.sendMessage) throw new Error("Extension runtime messaging is unavailable");
    const send = new Promise((resolve, reject) => {
      try {
        const maybe = runtime.sendMessage(message, (response) => {
          const err = globalThis.chrome?.runtime?.lastError;
          if (err) { reject(new Error(err.message)); return; }
          resolve(response);
        });
        if (maybe && typeof maybe.then === "function") maybe.then(resolve, reject);
      } catch (error) { reject(error); }
    });
    return Promise.race([send, timeout]);
  })()`, { awaitPromise: true, timeoutMs: timeoutMs + 1_000, label: message.type });
}

async function resolveExtensionId({ cdpHost, debugPort }) {
  const override = process.env.SMOKE_EXTENSION_ID?.trim();
  if (override) return override;
  const deadline = Date.now() + config.timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const resolved = await resolveWalletExtensionId({
        host: cdpHost,
        port: debugPort,
        dappWs: undefined,
        userDataDir: config.userDataDir,
        extensionLoadPath: config.extensionLoadPath,
        browserExtensionPath: config.browserExtensionPath,
        timeoutMs: config.timeoutMs,
        messageTimeoutMs: config.messageTimeoutMs
      });
      if (resolved?.id) return resolved.id;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    // Fall back to scanning CDP targets directly for a chrome-extension origin.
    const targets = await listCdpTargets(cdpHost, debugPort).catch(() => []);
    const sw = findExtensionServiceWorkerTarget(Array.isArray(targets) ? targets : [], "");
    const fromTargets = (Array.isArray(targets) ? targets : [])
      .map((t) => typeof t.url === "string" ? t.url.match(/^chrome-extension:\/\/([a-p]{32})\//)?.[1] : undefined)
      .find(Boolean);
    if (fromTargets) return fromTargets;
    if (sw?.url) {
      const id = sw.url.match(/^chrome-extension:\/\/([a-p]{32})\//)?.[1];
      if (id) return id;
    }
    await delay(250);
  }
  throw new Error(`Unable to resolve wallet extension id${lastError ? `: ${lastError}` : ""}`);
}

async function waitForCdpEndpoint(host, port, timeout) {
  const deadline = Date.now() + timeout;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://${host}:${port}/json/version`);
      if (response.ok) return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(200);
  }
  throw new Error(`CDP endpoint ${host}:${port} did not come up after ${timeout}ms${lastError ? `: ${lastError}` : ""}`);
}

async function readSkins(skinsPath) {
  const source = await readFile(skinsPath, "utf8");
  // Only consider the SKINS array body so types/maps elsewhere don't leak ids.
  const start = source.indexOf("export const SKINS");
  const slice = start >= 0 ? source.slice(start) : source;
  const out = [];
  const seen = new Set();
  const blockRegex = /\{\s*id:\s*"([^"]+)"[\s\S]*?\bmode:\s*"([^"]+)"[\s\S]*?\bnav:\s*"([^"]+)"/g;
  let match;
  while ((match = blockRegex.exec(slice)) !== null) {
    const [, id, mode, nav] = match;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, mode, nav, name: nameFor(source, id) });
  }
  if (out.length === 0) throw new Error(`No skins parsed from ${skinsPath}`);
  return out;
}

function nameFor(source, id) {
  const idIndex = source.indexOf(`id: "${id}"`);
  if (idIndex < 0) return id;
  const nameMatch = source.slice(idIndex, idIndex + 200).match(/name:\s*"([^"]+)"/);
  return nameMatch?.[1] ?? id;
}

function isFatalEntry(entry) {
  if (entry.kind === "exception") return true;
  if (entry.kind === "console" && (entry.level === "error" || entry.level === "assert")) return true;
  if (String(entry.blockedReason ?? "").toLowerCase().includes("csp")) return true;
  const text = `${entry.text ?? ""} ${entry.url ?? ""}`;
  return /content security policy|violates the following content security policy/i.test(text);
}

function summariseEntries(entries) {
  return entries.slice(0, 3).map((e) => `${e.kind}${e.level ? "/" + e.level : ""}: ${(e.text || "").slice(0, 120)}`).join(" | ");
}

function parse(value) {
  return typeof value === "string" ? JSON.parse(value) : value;
}

function printMatrix(results, skins) {
  const idWidth = Math.max(4, ...results.map((r) => r.id.length));
  const modeWidth = Math.max(4, ...results.map((r) => (r.mode || "").length));
  const navWidth = Math.max(3, ...results.map((r) => (r.nav || "").length));
  const header = `${"SKIN".padEnd(idWidth)}  ${"MODE".padEnd(modeWidth)}  ${"NAV".padEnd(navWidth)}  RESULT  DETAIL`;
  console.log("\n=== THEME SKIN VERIFICATION MATRIX ===");
  console.log(header);
  console.log("-".repeat(header.length + 20));
  for (const r of results) {
    const status = r.ok ? "PASS" : "FAIL";
    const detail = r.ok
      ? (r.warnings.length ? `warn: ${r.warnings.slice(0, 1).join("; ")}` : "")
      : r.reasons.join("; ");
    console.log(`${r.id.padEnd(idWidth)}  ${(r.mode || "").padEnd(modeWidth)}  ${(r.nav || "").padEnd(navWidth)}  ${status.padEnd(6)}  ${detail}`);
  }
  const passed = results.filter((r) => r.ok).length;
  console.log("-".repeat(header.length + 20));
  console.log(`${passed}/${skins.length} skins passed; screenshots in ${shotsDir}`);
  if (passed !== skins.length) {
    console.log("FAILED SKINS:");
    for (const r of results.filter((entry) => !entry.ok)) console.log(`  - ${r.id}: ${r.reasons.join("; ")}`);
  }
}

function log(message) {
  console.error(`[theme-smoke] ${message}`);
}
