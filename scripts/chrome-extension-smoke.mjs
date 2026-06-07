import { rm } from "node:fs/promises";
import { createSmokeConfig } from "./lib/chrome-smoke/config.mjs";
import { decodeHtml, launchCdpBrowser, runBrowser, windowsHostIp } from "./lib/chrome-smoke/browser.mjs";
import { getFreePort, waitForCdpStatus, waitForWindowsCdpStatus } from "./lib/chrome-smoke/cdp.mjs";
import { runDappFlow } from "./lib/chrome-smoke/dapp-flow.mjs";
import { startSmokeServer, validateStatus } from "./lib/chrome-smoke/server.mjs";

const config = await createSmokeConfig();
const { port: serverPort, server } = await startSmokeServer(config);
const smokeUrl = `http://${config.smokeHost}:${serverPort}/test-dapp.html`;
const smokeOrigin = new URL(smokeUrl).origin;
const trustedSmokeOriginArgs = config.trustedSmokeOriginArgs(smokeOrigin);

try {
  const smokeResult = config.smokeMode === "cdp" || config.smokeMode === "headed-cdp"
    ? await runCdpSmoke()
    : { status: await runHeadlessSmoke() };
  const { status, dappFlow } = smokeResult;
  if (config.isDappFlow && !dappFlow) throw new Error("Deep dApp smoke requires cdp or headed-cdp mode");

  validateStatus(status);
  console.log(JSON.stringify({
    ok: true,
    browser: config.browserName,
    browserPath: config.browserPath,
    mode: config.smokeMode,
    flow: config.smokeFlow,
    providerInjected: status.hasEthereum,
    announcements: status.announcements,
    testDappControls: { connect: status.hasConnectControl, sign: status.hasSignControl },
    ...(dappFlow ? { dappFlow } : {})
  }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  server.close();
  await rm(config.userDataDir, { recursive: true, force: true }).catch(() => undefined);
}

async function runHeadlessSmoke() {
  const browserArgs = [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-dev-shm-usage",
    "--disable-features=DisableLoadExtensionCommandLineSwitch",
    ...(config.smokeHost === "127.0.0.1" ? [] : [`--host-resolver-rules=MAP ${config.smokeHost} 127.0.0.1`]),
    ...trustedSmokeOriginArgs,
    "--dump-dom",
    "--virtual-time-budget=5000",
    `--user-data-dir=${config.browserUserDataDir}`,
    `--disable-extensions-except=${config.browserExtensionPath}`,
    `--load-extension=${config.browserExtensionPath}`,
    smokeUrl
  ];

  const { code, stdout, stderr, timedOut } = await runBrowser(config.browserPath, browserArgs, config.userDataDir, config.timeoutMs);
  if (code !== 0) {
    const reason = timedOut ? ` after ${config.timeoutMs}ms` : "";
    throw new Error(`Browser exited with code ${code}${reason}. stderr: ${stderr}`);
  }

  const statusMatch = stdout.match(/<pre id="smoke-status">([^<]+)<\/pre>/);
  if (!statusMatch) throw new Error(`Smoke status was not rendered. stderr: ${stderr}`);
  return JSON.parse(decodeHtml(statusMatch[1]));
}

async function runCdpSmoke() {
  const debugPort = await getFreePort();
  const cdpHost = config.isWindowsBrowser ? windowsHostIp() : "127.0.0.1";
  const browserArgs = [
    ...(config.smokeMode === "cdp" ? ["--headless=new"] : []),
    "--disable-gpu",
    "--no-sandbox",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-dev-shm-usage",
    "--disable-features=DisableLoadExtensionCommandLineSwitch",
    ...(config.smokeHost === "127.0.0.1" ? [] : [`--host-resolver-rules=MAP ${config.smokeHost} 127.0.0.1`]),
    ...trustedSmokeOriginArgs,
    "--enable-logging=stderr",
    "--v=1",
    "--remote-allow-origins=*",
    `--remote-debugging-address=${config.isWindowsBrowser ? "0.0.0.0" : "127.0.0.1"}`,
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${config.browserUserDataDir}`,
    `--disable-extensions-except=${config.browserExtensionPath}`,
    `--load-extension=${config.browserExtensionPath}`,
    smokeUrl
  ];

  const launched = await launchCdpBrowser(config.browserPath, browserArgs);
  try {
    const statusText = config.isWindowsBrowser
      ? await waitForWindowsCdpStatus({ port: debugPort, smokeUrl, timeout: config.timeoutMs })
      : await waitForCdpStatus({ host: cdpHost, port: debugPort, smokeUrl, timeout: config.timeoutMs });
    const status = JSON.parse(statusText);
    if (config.isWindowsBrowser && config.isDappFlow) {
      throw new Error("Deep dApp smoke is not supported for Windows browser CDP verification.");
    }
    const dappFlow = config.isDappFlow
      ? await runDappFlow(status, { ...config, cdpHost, debugPort, serverPort, smokeUrl })
      : undefined;
    return { status, dappFlow };
  } catch (error) {
    const stderr = config.includeBrowserStderr ? launched.stderr().split("\n").slice(-25).join("\n") : "";
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(stderr ? `${message}; browser stderr tail: ${stderr}` : message, { cause: error });
  } finally {
    await launched.kill();
  }
}
