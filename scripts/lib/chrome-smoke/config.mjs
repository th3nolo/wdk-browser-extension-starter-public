import { resolve } from "node:path";
import { createBrowserContext, detectBrowser } from "./browser.mjs";

export async function createSmokeConfig() {
  const root = resolve(".");
  const browserName = argValue("--browser=") ?? process.env.BROWSER ?? "cft";
  const browserPath = process.env.BROWSER_PATH ?? process.env.CHROME_PATH ?? detectBrowser(root, browserName);
  const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS ?? 25_000);
  const smokeMode = argValue("--mode=") ?? process.env.SMOKE_MODE ?? "cdp";
  const smokeFlow = argValue("--flow=") ?? process.env.SMOKE_FLOW ?? "basic";
  // The real-UI variant ("dapp-ui") runs the full dApp flow but drives the
  // popup React DOM (clicks the real Connect button) instead of approving via a
  // chrome.runtime message. SMOKE_REAL_UI=1 opts a plain "dapp" run into it too.
  const isDappFlow = smokeFlow === "dapp" || smokeFlow === "dapp-ui";
  const realUi = smokeFlow === "dapp-ui" || process.env.SMOKE_REAL_UI === "1";
  const balanceEgressMode = argValue("--balance-egress=") ?? process.env.SMOKE_BALANCE_EGRESS_MODE ?? "mocked";
  const smokeHost = isDappFlow ? "wdk-smoke.test" : "127.0.0.1";
  const browser = await createBrowserContext({ root, browserName, browserPath });

  return {
    ...browser,
    backgroundErrorResponseKey: "__wdkBackgroundError",
    balanceEgressMode,
    browserName,
    browserPath,
    includeBrowserStderr: process.env.SMOKE_BROWSER_STDERR === "1",
    isDappFlow,
    messageTimeoutMs: Number(process.env.SMOKE_MESSAGE_TIMEOUT_MS ?? Math.min(timeoutMs, 10_000)),
    realUi,
    root,
    smokeFlow,
    smokeHost,
    smokeMode,
    smokeRunId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    timeoutMs,
    trustedSmokeOriginArgs: (isDappFlow && smokeHost !== "127.0.0.1")
      ? (smokeOrigin) => [`--unsafely-treat-insecure-origin-as-secure=${smokeOrigin}`]
      : () => [],
    workerTimeoutMs: Number(process.env.SMOKE_WORKER_TIMEOUT_MS ?? Math.min(timeoutMs, 10_000))
  };
}

function argValue(prefix) {
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}
