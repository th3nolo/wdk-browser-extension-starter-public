import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  cdpCommand,
  cdpJson,
  cdpJsonForTarget,
  listCdpTargets,
  rewriteCdpWebSocketHost,
  waitForCdpValue
} from "./cdp.mjs";

export async function wakeExtensionServiceWorker({ host, port, extensionId, workerTimeoutMs }) {
  const scopeURL = `chrome-extension://${extensionId}/`;
  const version = await fetch(`http://${host}:${port}/json/version`).then((response) => response.json());
  if (!version.webSocketDebuggerUrl) throw new Error("Browser CDP websocket is unavailable");
  const browserWs = rewriteCdpWebSocketHost(version.webSocketDebuggerUrl, host);
  await cdpCommand(browserWs, "Target.setDiscoverTargets", { discover: true }, { timeoutMs: 5_000, label: "target discovery" });
  await cdpCommand(browserWs, "ServiceWorker.enable", {}, { timeoutMs: 5_000, label: "service worker discovery" }).catch(() => undefined);
  const startResult = await cdpCommand(browserWs, "ServiceWorker.startWorker", { scopeURL }, { timeoutMs: 5_000, label: `start ${scopeURL}` })
    .then((result) => ({ ok: true, result }))
    .catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));

  const target = await waitForExtensionServiceWorkerTarget(host, port, extensionId, workerTimeoutMs);
  if (!target) {
    const targets = await listCdpTargets(host, port).catch(() => []);
    const extensionTargets = Array.isArray(targets)
      ? targets
        .filter((entry) => typeof entry.url === "string" && entry.url.startsWith("chrome-extension://"))
        .map((entry) => ({ type: entry.type, title: entry.title, url: entry.url }))
      : targets;
    throw new Error(`Wallet service worker did not appear for ${scopeURL}; startWorker: ${JSON.stringify(startResult)}; extension targets: ${JSON.stringify(extensionTargets)}`);
  }
  if (process.env.SMOKE_WORKER_PROBE !== "1") return { skipped: true, target };
  const workerProbe = await cdpJsonForTarget({ host, port }, target, serviceWorkerProbeExpression(), {
    timeoutMs: 3_000,
    label: "service worker probe"
  });
  if (workerProbe?.runtimeId !== extensionId) throw new Error(`Wallet service worker runtime id mismatch: expected ${extensionId}, got ${workerProbe?.runtimeId ?? "missing"}`);
  if (workerProbe?.hasRuntimeListener !== true) throw new Error(`Wallet service worker has no runtime message listener: ${JSON.stringify(workerProbe)}`);
  return { probe: workerProbe, target };
}

export async function resolveWalletExtensionId({ host, port, dappWs, userDataDir, extensionLoadPath, browserExtensionPath, timeoutMs, messageTimeoutMs }) {
  const override = process.env.SMOKE_EXTENSION_ID?.trim();
  if (override) {
    assertChromeExtensionId(override, "SMOKE_EXTENSION_ID");
    return { id: override, source: "SMOKE_EXTENSION_ID" };
  }

  const candidates = [];
  const dappId = await extensionIdFromDappResource(dappWs, timeoutMs, messageTimeoutMs).catch(() => undefined);
  if (dappId) candidates.push({ id: dappId, source: "dapp inpage resource" });

  for (const id of extensionIdsFromChromeProfile(userDataDir, extensionLoadPath, browserExtensionPath)) {
    candidates.push({ id, source: "Chrome profile extension settings" });
  }

  const targetIds = await extensionIdsFromTargets(host, port).catch(() => []);
  for (const id of targetIds) {
    candidates.push({ id, source: "CDP extension target" });
  }

  const uniqueCandidates = uniqueExtensionCandidates(candidates);
  if (uniqueCandidates.length === 0) {
    const diagnostics = await extensionResolutionDiagnostics({ host, port, dappWs, userDataDir, extensionLoadPath, browserExtensionPath });
    throw new Error(`Unable to resolve wallet extension id; diagnostics: ${JSON.stringify(diagnostics)}`);
  }
  const preferred = uniqueCandidates.find((candidate) => candidate.source === "dapp inpage resource")
    ?? uniqueCandidates.find((candidate) => candidate.source === "Chrome profile extension settings")
    ?? (uniqueCandidates.length === 1 ? uniqueCandidates[0] : undefined);
  if (!preferred) {
    throw new Error(`Ambiguous wallet extension id candidates: ${JSON.stringify(uniqueCandidates)}`);
  }
  return preferred;
}

export async function extensionResolutionDiagnostics({ host, port, dappWs, userDataDir, extensionLoadPath, browserExtensionPath }) {
  const dappResources = await cdpJson(dappWs, chromeExtensionResourceExpression(), { label: "extension resource diagnostics" });
  const targets = await listCdpTargets(host, port)
    .then((entries) => entries
      .filter((entry) => typeof entry.url === "string" && entry.url.startsWith("chrome-extension://"))
      .map((entry) => ({ type: entry.type, title: entry.title, url: entry.url })))
    .catch((error) => ({ error: error instanceof Error ? error.message : String(error) }));
  return {
    dappResources,
    profileExtensionIds: extensionIdsFromChromeProfile(userDataDir, extensionLoadPath, browserExtensionPath),
    extensionTargets: targets
  };
}

export function findExtensionServiceWorkerTarget(targets, extensionId) {
  const origin = `chrome-extension://${extensionId}/`;
  return targets.find((target) =>
    target.type === "service_worker"
    && typeof target.url === "string"
    && target.url.startsWith(origin)
  ) ?? targets.find((target) =>
    typeof target.url === "string"
    && (target.url === `${origin}background.js` || target.url.startsWith(origin))
    && target.title?.includes("Service Worker")
  );
}

async function waitForExtensionServiceWorkerTarget(host, port, extensionId, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const targets = await listCdpTargets(host, port).catch(() => []);
    if (Array.isArray(targets)) {
      const target = findExtensionServiceWorkerTarget(targets, extensionId);
      if (target) return target;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  return undefined;
}

function serviceWorkerProbeExpression() {
  return `JSON.stringify({
    url: self.location.href,
    runtimeId: chrome.runtime.id,
    hasRuntime: typeof chrome?.runtime?.onMessage?.hasListeners === "function",
    hasRuntimeListener: chrome.runtime.onMessage.hasListeners(),
    hasSessionStorage: typeof chrome.storage?.session?.get === "function"
  })`;
}

async function extensionIdFromDappResource(wsUrl, timeoutMs, messageTimeoutMs) {
  const resources = await waitForCdpValue(wsUrl, chromeExtensionResourceExpression(), Math.min(timeoutMs, messageTimeoutMs));
  const entries = JSON.parse(resources);
  const entry = entries.find((name) => name.includes("/inpage.js"));
  const id = entry?.match(/^chrome-extension:\/\/([^/]+)\//)?.[1];
  if (typeof id !== "string" || !id) throw new Error("Unable to infer extension ID from injected inpage resource");
  assertChromeExtensionId(id, "dapp inpage resource");
  return id;
}

function extensionIdsFromChromeProfile(userDataDir, extensionLoadPath, browserExtensionPath) {
  const preferencesPath = join(userDataDir, "Default", "Preferences");
  if (!existsSync(preferencesPath)) return [];
  try {
    const preferences = JSON.parse(readFileSync(preferencesPath, "utf8"));
    const settings = preferences?.extensions?.settings;
    if (!settings || typeof settings !== "object") return [];
    return Object.entries(settings)
      .filter(([, value]) => isLoadedWalletExtensionSetting(value, extensionLoadPath, browserExtensionPath))
      .map(([id]) => id)
      .filter((id) => {
        try {
          assertChromeExtensionId(id, "Chrome profile extension settings");
          return true;
        } catch {
          return false;
        }
      });
  } catch {
    return [];
  }
}

function isLoadedWalletExtensionSetting(value, extensionLoadPath, browserExtensionPath) {
  if (!value || typeof value !== "object") return false;
  const manifest = value.manifest;
  const manifestName = typeof manifest?.name === "string" ? manifest.name : "";
  const settingPath = typeof value.path === "string" ? value.path : "";
  const normalizedSettingPath = normalizePathForComparison(settingPath);
  const normalizedExtensionPath = normalizePathForComparison(extensionLoadPath);
  const normalizedBrowserExtensionPath = normalizePathForComparison(browserExtensionPath);
  return (
    value.state !== 0
    && manifestName.includes("WDK")
    && manifestName.includes("Wallet")
    && (
      normalizedSettingPath === normalizedExtensionPath
      || normalizedSettingPath === normalizedBrowserExtensionPath
      || normalizedSettingPath.endsWith("/chrome-mv3")
      || normalizedSettingPath.endsWith("/extension")
    )
  );
}

async function extensionIdsFromTargets(host, port) {
  const targets = await listCdpTargets(host, port);
  const ids = targets
    .map((target) => {
      if (typeof target.url !== "string" || !target.url.startsWith("chrome-extension://")) return undefined;
      if (!target.url.endsWith("/popup.html") && !target.url.endsWith("/background.js") && !target.url.endsWith("/inpage.js")) return undefined;
      return target.url.match(/^chrome-extension:\/\/([^/]+)\//)?.[1];
    })
    .filter(Boolean);
  return [...new Set(ids)];
}

function chromeExtensionResourceExpression() {
  return `JSON.stringify([...new Set([
    ...performance.getEntriesByType("resource").map(entry => entry.name),
    ...[...document.scripts].map(script => script.src).filter(Boolean)
  ].filter(name => name.startsWith("chrome-extension://")))])`;
}

function uniqueExtensionCandidates(candidates) {
  const byId = new Map();
  for (const candidate of candidates) {
    if (!candidate?.id) continue;
    const existing = byId.get(candidate.id);
    byId.set(candidate.id, existing
      ? { id: candidate.id, source: `${existing.source}, ${candidate.source}` }
      : candidate);
  }
  return [...byId.values()];
}

function assertChromeExtensionId(id, source) {
  if (!/^[a-p]{32}$/.test(id)) {
    throw new Error(`Invalid Chrome extension id from ${source}: ${id}`);
  }
}

function normalizePathForComparison(path) {
  return path.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
}
