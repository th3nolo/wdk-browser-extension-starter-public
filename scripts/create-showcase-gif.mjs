import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createBrowserContext, detectBrowser, launchCdpBrowser, windowsHostIp } from "./lib/chrome-smoke/browser.mjs";
import { cdpCommand, evaluateCdp, getFreePort, openCdpTarget, rewriteCdpWebSocketHost, waitForCdpExpression } from "./lib/chrome-smoke/cdp.mjs";
import { resolveWalletExtensionId } from "./lib/chrome-smoke/extension.mjs";

const root = resolve(".");
const outputDir = join(root, ".output", "showcase");
const popupDir = join(outputDir, "popup");
const frameDir = join(outputDir, "frames");
const specPath = join(outputDir, "showcase-frames.json");
const outputGif = join(outputDir, "wdk-browser-extension-showcase.gif");
const docsGif = join(root, "docs", "showcase.gif");
const publicTestRecoveryWords = [...Array(11).fill("abandon"), "about"].join(" ");
const password = "showcase-password-1234";
const browserName = process.env.BROWSER ?? "cft";

await ensureBuild();
await rm(outputDir, { recursive: true, force: true });
await mkdir(popupDir, { recursive: true });
await mkdir(frameDir, { recursive: true });

const browserPath = process.env.BROWSER_PATH ?? process.env.CHROME_PATH ?? detectBrowser(root, browserName);
const browser = await createBrowserContext({ root, browserName, browserPath });
const debugPort = await getFreePort();
const cdpHost = browser.isWindowsBrowser ? windowsHostIp() : "127.0.0.1";
const args = [
  "--headless=new",
  "--disable-gpu",
  "--no-sandbox",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-dev-shm-usage",
  "--disable-features=DisableLoadExtensionCommandLineSwitch",
  "--remote-allow-origins=*",
  `--remote-debugging-address=${browser.isWindowsBrowser ? "0.0.0.0" : "127.0.0.1"}`,
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${browser.browserUserDataDir}`,
  `--disable-extensions-except=${browser.browserExtensionPath}`,
  `--load-extension=${browser.browserExtensionPath}`,
  "about:blank"
];

const launched = await launchCdpBrowser(browserPath, args);
try {
  const blankTarget = await waitForTarget("about:blank");
  const blankWs = rewriteCdpWebSocketHost(blankTarget.webSocketDebuggerUrl, cdpHost);
  const extension = await resolveWalletExtensionId({
    host: cdpHost,
    port: debugPort,
    dappWs: blankWs,
    userDataDir: browser.userDataDir,
    extensionLoadPath: browser.extensionLoadPath,
    browserExtensionPath: browser.browserExtensionPath,
    timeoutMs: 10000,
    messageTimeoutMs: 5000
  });

  const popupTarget = await openCdpTarget(cdpHost, debugPort, `chrome-extension://${extension.id}/popup.html`);
  const popupWs = rewriteCdpWebSocketHost(popupTarget.webSocketDebuggerUrl, cdpHost);
  await setupPopupViewport(popupWs);
  await cdpCommand(popupWs, "Page.reload", { ignoreCache: true });
  await waitForRender();
  await evaluateCdp(popupWs, `import(document.scripts[0].src).then(() => {
    window.__showcaseImportError = "";
    return true;
  }).catch((error) => {
    window.__showcaseImportError = String(error?.stack ?? error);
    return false;
  })`, { awaitPromise: true, timeoutMs: 15000 }).catch(() => undefined);

  await waitForText(popupWs, "RECOVERY PHRASE BACKUP").catch(async (error) => {
    const diagnostics = await popupDiagnostics(popupWs);
    throw new Error(`Popup onboarding did not render: ${error instanceof Error ? error.message : String(error)}; diagnostics=${JSON.stringify(diagnostics)}`);
  });
  await capture(popupWs, join(popupDir, "01-onboarding.png"));

  const createResult = await chromeMessage(popupWs, {
    type: "CREATE_WALLET",
    name: "Showcase wallet",
    password,
    seedPhrase: publicTestRecoveryWords
  });
  if (!createResult?.hasVault) {
    throw new Error(`Showcase wallet creation failed: ${JSON.stringify(createResult)}`);
  }

  await cdpCommand(popupWs, "Page.reload", { ignoreCache: true });
  await waitForText(popupWs, "ACCOUNTS");
  await waitForRender();
  await capture(popupWs, join(popupDir, "02-accounts.png"));

  await clickButton(popupWs, "Send");
  await waitForText(popupWs, "Recipient");
  await setInputByPlaceholder(popupWs, "Paste address", "0x0000000000000000000000000000000000000001");
  await setInputByPlaceholder(popupWs, "0.00", "0.01");
  await capture(popupWs, join(popupDir, "03-send.png"));
  await clickButton(popupWs, "Review send");
  await waitForText(popupWs, "Confirm send");
  await capture(popupWs, join(popupDir, "04-review.png"));

  await clickButton(popupWs, "Cancel");
  await clickButton(popupWs, "Tokens");
  await clickButton(popupWs, "Receive");
  await waitForSelector(popupWs, "img.qr");
  await capture(popupWs, join(popupDir, "05-receive.png"));

  await clickButton(popupWs, "Settings");
  await waitForText(popupWs, "RPC OVERRIDES");
  await capture(popupWs, join(popupDir, "06-rpc.png"));
} finally {
  await launched.kill();
  await rm(browser.userDataDir, { recursive: true, force: true }).catch(() => undefined);
}

const scenes = [
  {
    title: "WDK Browser Wallet",
    lines: ["Chrome/Brave MV3 extension", "Local encrypted vault", "WDK-powered accounts"],
    button: "Install extension"
  },
  {
    title: "Create a vault",
    lines: ["Generate or import BIP-39", "Confirm recovery backup", "Encrypt with local password"],
    button: "Create wallet",
    image: join(popupDir, "01-onboarding.png")
  },
  {
    title: "Multi-network accounts",
    lines: ["Bitcoin, Spark, EVM, Solana", "Multi-account derivation", "Balances stay in the popup"],
    button: "View accounts",
    image: join(popupDir, "02-accounts.png")
  },
  {
    title: "Send flow",
    lines: ["Network-safe asset picker", "Address validation", "Two-step confirmation"],
    button: "Review send",
    image: join(popupDir, "03-send.png")
  },
  {
    title: "Confirm before signing",
    lines: ["Recipient and amount preview", "User-controlled approval", "Background WDK execution"],
    button: "Confirm send",
    image: join(popupDir, "04-review.png")
  },
  {
    title: "Receive assets",
    lines: ["Per-account QR codes", "Copyable addresses", "No page seed access"],
    button: "Show QR",
    image: join(popupDir, "05-receive.png")
  },
  {
    title: "Advanced controls",
    lines: ["RPC overrides", "Dapp approval path", "Automated smoke coverage"],
    button: "Open tools",
    image: join(popupDir, "06-rpc.png")
  }
];

await writeFile(specPath, `${JSON.stringify({ scenes }, null, 2)}\n`);
run("python3", ["scripts/render-showcase-frames.py", specPath, frameDir]);
renderGif(outputGif);
await writeFile(docsGif, await readFile(outputGif));

console.log(JSON.stringify({
  ok: true,
  outputGif,
  docsGif,
  frames: (await countFrames(frameDir)),
  referenceStyle: "1280x720 full-size animated browser-extension showcase GIF"
}, null, 2));

async function ensureBuild() {
  if (process.env.SHOWCASE_SKIP_BUILD !== "1") {
    run("pnpm", ["run", "build"]);
    return;
  }
  const manifest = await stat(join(root, ".output", "chrome-mv3", "manifest.json")).catch(() => undefined);
  if (manifest?.isFile()) return;
  run("pnpm", ["run", "build"]);
}

async function waitForTarget(url) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const targets = await fetch(`http://${cdpHost}:${debugPort}/json/list`).then((response) => response.json()).catch(() => []);
    const target = targets.find((entry) => entry.type === "page" && entry.url === url)
      ?? targets.find((entry) => entry.type === "page" && entry.webSocketDebuggerUrl);
    if (target?.webSocketDebuggerUrl) return target;
    await waitForRender();
  }
  throw new Error(`Timed out waiting for CDP target ${url}`);
}

async function setupPopupViewport(wsUrl) {
  await cdpCommand(wsUrl, "Page.enable", {});
  await cdpCommand(wsUrl, "Emulation.setDeviceMetricsOverride", {
    width: 410,
    height: 600,
    deviceScaleFactor: 1,
    mobile: false
  });
}

async function capture(wsUrl, path) {
  await waitForRender();
  await evaluateCdp(wsUrl, `(() => {
    let style = document.getElementById("showcase-capture-style");
    if (!style) {
      style = document.createElement("style");
      style.id = "showcase-capture-style";
      style.textContent = [
        "html,body,#root{width:410px!important;min-width:410px!important;max-width:410px!important;background:#eaf0f5!important}",
        ".error{display:none!important}",
        ".shell{width:410px!important;max-width:410px!important;min-height:600px!important;box-shadow:none!important;overflow:visible!important}"
      ].join("");
      document.head.appendChild(style);
    }
    document.querySelectorAll("header p").forEach((entry) => {
      if (entry.textContent?.startsWith("Session until")) entry.textContent = "Unlocked demo session";
    });
    return true;
  })()`).catch(() => undefined);
  const height = await evaluateCdp(wsUrl, `(() => {
    const shell = document.querySelector(".shell");
    const bounds = shell?.getBoundingClientRect();
    const measured = Math.ceil(Math.max(
      bounds?.bottom ?? 0,
      shell?.scrollHeight ?? 0,
      document.documentElement?.scrollHeight ?? 0,
      document.body?.scrollHeight ?? 0,
      600
    ));
    return Math.min(Math.max(measured, 600), 980);
  })()`).catch(() => 600);
  const result = await cdpCommand(wsUrl, "Page.captureScreenshot", {
    format: "png",
    clip: { x: 0, y: 0, width: 410, height, scale: 1 },
    captureBeyondViewport: true,
    fromSurface: true
  }, { timeoutMs: 10000, label: "capture showcase screenshot" });
  await writeFile(path, Buffer.from(result.data, "base64"));
}

function chromeMessage(wsUrl, message) {
  return evaluateCdp(wsUrl, `new Promise((resolve) => {
    chrome.runtime.sendMessage(${JSON.stringify(message)}, (response) => {
      resolve(JSON.stringify({ response, error: chrome.runtime.lastError?.message ?? null }));
    });
  })`, { awaitPromise: true, timeoutMs: 15000 }).then((raw) => {
    const parsed = JSON.parse(raw);
    if (parsed.error) throw new Error(parsed.error);
    return parsed.response;
  });
}

async function clickButton(wsUrl, text) {
  const clicked = await evaluateCdp(wsUrl, `(() => {
    const button = [...document.querySelectorAll("button")].find((entry) => entry.textContent.trim() === ${JSON.stringify(text)});
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Unable to click button ${text}`);
  await waitForRender();
}

async function setInputByPlaceholder(wsUrl, placeholder, value) {
  const changed = await evaluateCdp(wsUrl, `(() => {
    const input = [...document.querySelectorAll("input")].find((entry) => entry.placeholder === ${JSON.stringify(placeholder)});
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  if (!changed) throw new Error(`Unable to set input ${placeholder}`);
  await waitForRender();
}

function waitForText(wsUrl, text) {
  return waitForCdpExpression(wsUrl, `document.body?.innerText?.includes(${JSON.stringify(text)}) === true`, 15000);
}

function waitForSelector(wsUrl, selector) {
  return waitForCdpExpression(wsUrl, `Boolean(document.querySelector(${JSON.stringify(selector)}))`, 15000);
}

async function popupDiagnostics(wsUrl) {
  const raw = await evaluateCdp(wsUrl, `(async () => JSON.stringify({
    readyState: document.readyState,
    url: location.href,
    bodyText: document.body?.innerText ?? "",
    rootHtml: document.getElementById("root")?.innerHTML?.slice(0, 500) ?? null,
    scripts: [...document.scripts].map((script) => script.src),
    resources: performance.getEntriesByType("resource").map((entry) => ({ name: entry.name, initiatorType: entry.initiatorType })),
    importError: window.__showcaseImportError ?? null,
    scriptFetch: await fetch(document.scripts[0]?.src ?? location.href).then(async (response) => ({
      ok: response.ok,
      status: response.status,
      contentType: response.headers.get("content-type"),
      textStart: (await response.text()).slice(0, 120)
    })).catch((error) => ({ error: String(error) }))
  }))()`, { awaitPromise: true }).catch((error) => JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  return JSON.parse(raw);
}

function waitForRender() {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, 350));
}

function renderGif(gifPath) {
  const palettePath = join(outputDir, "palette.png");
  run("ffmpeg", [
    "-y",
    "-framerate",
    "2",
    "-i",
    join(frameDir, "frame-%03d.png"),
    "-vf",
    "fps=10,palettegen=stats_mode=diff",
    palettePath
  ]);
  run("ffmpeg", [
    "-y",
    "-framerate",
    "2",
    "-i",
    join(frameDir, "frame-%03d.png"),
    "-i",
    palettePath,
    "-lavfi",
    "fps=10[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3",
    "-loop",
    "0",
    gifPath
  ]);
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`);
  }
  return result;
}

async function countFrames(dir) {
  const result = spawnSync("find", [dir, "-maxdepth", "1", "-name", "frame-*.png"], { encoding: "utf8" });
  return result.stdout.trim().split("\n").filter(Boolean).length;
}
