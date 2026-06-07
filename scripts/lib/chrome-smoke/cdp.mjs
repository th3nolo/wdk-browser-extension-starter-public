import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:http";

export async function getFreePort() {
  const probe = createServer();
  await new Promise((resolveListen) => probe.listen(0, "127.0.0.1", resolveListen));
  const address = probe.address();
  await new Promise((resolveClose) => probe.close(resolveClose));
  if (!address || typeof address === "string") throw new Error("Unable to allocate CDP port");
  return address.port;
}

export async function waitForCdpStatus({ host, port, smokeUrl, timeout }) {
  const deadline = Date.now() + timeout;
  let lastError = "";
  let lastStatus = "";
  while (Date.now() < deadline) {
    try {
      const target = await findCdpTarget(host, port, smokeUrl);
      if (target?.webSocketDebuggerUrl) {
        const status = await evaluateCdp(rewriteCdpWebSocketHost(target.webSocketDebuggerUrl, host), "document.getElementById('smoke-status')?.textContent");
        if (typeof status === "string") {
          lastStatus = status;
          if (status.includes("io.tether.wdk.browser-starter")) return status;
        }
      }
    } catch (cause) {
      lastError = cause instanceof Error ? cause.message : String(cause);
    }
    await delay(250);
  }
  const suffix = lastStatus ? `; last status: ${lastStatus}` : lastError ? `: ${lastError}` : "";
  throw new Error(`CDP smoke status was not observed after ${timeout}ms${suffix}`);
}

export async function waitForWindowsCdpStatus({ port, smokeUrl, timeout }) {
  const script = windowsCdpStatusScript({ port, smokeUrl, timeout });
  const child = spawn(windowsNodePath(), ["--input-type=module", "-"], {
    stdio: ["pipe", "pipe", "pipe"]
  });
  child.stdin.end(script);

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk.toString(); });
  child.stderr.on("data", chunk => { stderr += chunk.toString(); });
  const code = await new Promise((resolveExit) => child.on("exit", resolveExit));
  const parsed = parseLastJson(stdout);
  if (code !== 0 || !parsed?.ok) {
    const detail = parsed?.error ?? stderr.trim() ?? stdout.trim() ?? "no Windows CDP output";
    throw new Error(`Windows CDP smoke status was not observed: ${detail}`);
  }
  return parsed.statusText;
}

export async function openCdpTarget(host, port, url) {
  const response = await fetch(`http://${host}:${port}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  if (!response.ok) throw new Error(`Unable to open CDP target ${url}: ${response.status}`);
  return response.json();
}

export async function findCdpTarget(host, port, smokeUrl) {
  const response = await fetch(`http://${host}:${port}/json/list`);
  const targets = await response.json();
  return targets.find((target) => target.type === "page" && target.url === smokeUrl)
    ?? targets.find((target) => target.type === "page" && target.url.startsWith("http://127.0.0.1:"));
}

export function rewriteCdpWebSocketHost(wsUrl, host) {
  const url = new URL(wsUrl);
  url.hostname = host;
  return url.toString();
}

export function evaluateCdp(wsUrl, expression, options = {}) {
  return cdpCommand(wsUrl, "Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: Boolean(options.awaitPromise)
  }, options).then((message) => {
    const exception = message?.exceptionDetails;
    const result = message?.result;
    if (exception) throw new Error(exception.exception?.description ?? exception.text ?? "CDP evaluation exception");
    if (result?.subtype === "error") throw new Error(result.description ?? result.value ?? "CDP evaluation error");
    return result?.value;
  });
}

export async function evaluateCdpTarget({ host, port }, target, expression, options = {}) {
  if (target.webSocketDebuggerUrl) {
    return evaluateCdp(rewriteCdpWebSocketHost(target.webSocketDebuggerUrl, host), expression, options);
  }

  const targetId = target.targetId ?? target.id;
  if (!targetId) throw new Error("CDP target does not expose a target id or websocket debugger URL");
  const version = await fetch(`http://${host}:${port}/json/version`).then((response) => response.json());
  if (!version.webSocketDebuggerUrl) throw new Error("Browser CDP websocket is unavailable");
  const browserWs = rewriteCdpWebSocketHost(version.webSocketDebuggerUrl, host);
  return evaluateCdpViaBrowserTarget(browserWs, targetId, expression, options);
}

export async function listCdpTargets(host, port) {
  const targets = await fetch(`http://${host}:${port}/json/list`).then((response) => response.json());
  const browserTargets = await listBrowserCdpTargets(host, port).catch(() => []);
  const byId = new Map();
  for (const target of [...targets, ...browserTargets]) {
    if (target.id || target.targetId) byId.set(target.id ?? target.targetId, target);
  }
  return [...byId.values()];
}

export async function cdpJson(wsUrl, expression, options = {}) {
  try {
    const value = await evaluateCdp(wsUrl, expression, { timeoutMs: 5_000, ...options });
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function cdpJsonForTarget(endpoint, target, expression, options = {}) {
  try {
    const value = await evaluateCdpTarget(endpoint, target, expression, { timeoutMs: 5_000, ...options });
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function waitForCdpExpression(wsUrl, expression, timeout) {
  const deadline = Date.now() + timeout;
  let lastValue;
  let lastPage = "";
  while (Date.now() < deadline) {
    lastValue = await evaluateCdp(wsUrl, expression).catch((error) => String(error));
    if (lastValue === true) return;
    lastPage = await evaluateCdp(wsUrl, "JSON.stringify({ url: location.href, text: document.body?.innerText?.slice(0, 500) })").catch(() => "");
    await delay(250);
  }
  throw new Error(`Timed out waiting for CDP expression: ${expression}; last value: ${lastValue}; page: ${lastPage}`);
}

export async function waitForCdpValue(wsUrl, expression, timeout) {
  const deadline = Date.now() + timeout;
  let lastValue;
  while (Date.now() < deadline) {
    lastValue = await evaluateCdp(wsUrl, expression).catch((error) => String(error));
    if (lastValue !== undefined && lastValue !== null && lastValue !== "") return lastValue;
    await delay(250);
  }
  throw new Error(`Timed out waiting for CDP value: ${expression}; last value: ${lastValue}`);
}

export function cdpCommand(wsUrl, method, params, options = {}) {
  return new Promise((resolveCommand, rejectCommand) => {
    const socket = new WebSocket(wsUrl);
    const id = 1;
    const commandTimeoutMs = options.timeoutMs ?? 5000;
    const timeout = setTimeout(() => {
      socket.close();
      const label = options.label ? ` during ${options.label}` : "";
      rejectCommand(new Error(`CDP ${method} timed out${label}`));
    }, commandTimeoutMs);

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ id, method, params }));
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data.toString());
      if (message.id !== id) return;
      clearTimeout(timeout);
      socket.close();
      if (message.error) rejectCommand(new Error(message.error.message));
      else resolveCommand(message.result);
    });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      rejectCommand(new Error("CDP websocket connection failed"));
    });
  });
}

export function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function listBrowserCdpTargets(host, port) {
  const version = await fetch(`http://${host}:${port}/json/version`).then((response) => response.json());
  if (!version.webSocketDebuggerUrl) return [];
  const browserWs = rewriteCdpWebSocketHost(version.webSocketDebuggerUrl, host);
  const result = await cdpCommand(browserWs, "Target.getTargets", {});
  return (result?.targetInfos ?? []).map((target) => ({
    id: target.targetId,
    targetId: target.targetId,
    type: target.type,
    title: target.title,
    url: target.url
  }));
}

function evaluateCdpViaBrowserTarget(browserWs, targetId, expression, options = {}) {
  return new Promise((resolveEvaluation, rejectEvaluation) => {
    const socket = new WebSocket(browserWs);
    let nextId = 1;
    let sessionId;
    const pending = new Map();
    const commandTimeoutMs = options.timeoutMs ?? 5000;
    let timeout;

    const rejectAll = (error) => {
      clearTimeout(timeout);
      for (const entry of pending.values()) entry.reject(error);
      pending.clear();
      rejectEvaluation(error);
    };

    timeout = setTimeout(() => {
      const label = options.label ? ` during ${options.label}` : "";
      socket.close();
      rejectAll(new Error(`CDP target evaluation timed out${label}`));
    }, commandTimeoutMs);

    const send = (method, params = {}, commandSessionId = undefined) => {
      const id = nextId++;
      const payload = commandSessionId
        ? { id, method, params, sessionId: commandSessionId }
        : { id, method, params };
      socket.send(JSON.stringify(payload));
      return new Promise((resolveCommand, rejectCommand) => {
        pending.set(id, { resolve: resolveCommand, reject: rejectCommand });
      });
    };

    socket.addEventListener("open", async () => {
      try {
        const attachResult = await send("Target.attachToTarget", { targetId, flatten: true });
        sessionId = attachResult.sessionId;
        const evaluation = await send("Runtime.evaluate", {
          expression,
          returnByValue: true,
          awaitPromise: Boolean(options.awaitPromise)
        }, sessionId);
        const exception = evaluation?.exceptionDetails;
        const result = evaluation?.result;
        if (exception) throw new Error(exception.exception?.description ?? exception.text ?? "CDP evaluation exception");
        if (result?.subtype === "error") throw new Error(result.description ?? result.value ?? "CDP evaluation error");
        if (sessionId) await send("Target.detachFromTarget", { sessionId }).catch(() => undefined);
        clearTimeout(timeout);
        socket.close();
        resolveEvaluation(result?.value);
      } catch (error) {
        if (sessionId) await send("Target.detachFromTarget", { sessionId }).catch(() => undefined);
        socket.close();
        rejectAll(error instanceof Error ? error : new Error(String(error)));
      }
    });

    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data.toString());
      if (!message.id || !pending.has(message.id)) return;
      const entry = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result);
    });
    socket.addEventListener("error", () => {
      rejectAll(new Error("CDP browser websocket connection failed"));
    });
  });
}

function windowsNodePath() {
  const candidates = [
    "/mnt/c/Program Files/nodejs/node.exe",
    "/mnt/c/Program Files (x86)/nodejs/node.exe"
  ];
  const path = candidates.find((candidate) => existsSync(candidate));
  if (!path) throw new Error("Windows Node.js was not found; install Node.js for Windows or use a Linux browser binary.");
  return path;
}

function parseLastJson(output) {
  const line = output.trim().split(/\r?\n/).filter(Boolean).at(-1);
  if (!line) return undefined;
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

function windowsCdpStatusScript({ port, smokeUrl, timeout }) {
  return `
const port = ${JSON.stringify(port)};
const smokeUrl = ${JSON.stringify(smokeUrl)};
const timeoutMs = ${JSON.stringify(timeout)};

try {
  const statusText = await waitForStatus();
  console.log(JSON.stringify({ ok: true, statusText }));
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
}

async function waitForStatus() {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = "";
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const targets = await fetch("http://127.0.0.1:" + port + "/json/list").then((response) => response.json());
      const target = targets.find((entry) => entry.type === "page" && entry.url === smokeUrl)
        ?? targets.find((entry) => entry.type === "page" && entry.url.startsWith("http://127.0.0.1:"));
      if (target?.webSocketDebuggerUrl) {
        const status = await evaluate(target.webSocketDebuggerUrl, "document.getElementById('smoke-status')?.textContent || ''");
        if (typeof status === "string") {
          lastStatus = status;
          if (status.includes("io.tether.wdk.browser-starter")) return status;
        }
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  const suffix = lastStatus ? "; last status: " + lastStatus : lastError ? ": " + lastError : "";
  throw new Error("CDP smoke status was not observed after " + timeoutMs + "ms" + suffix);
}

function evaluate(wsUrl, expression) {
  return new Promise((resolveEvaluation, rejectEvaluation) => {
    const socket = new WebSocket(wsUrl);
    const timeout = setTimeout(() => {
      socket.close();
      rejectEvaluation(new Error("CDP Runtime.evaluate timed out"));
    }, 5000);
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: { expression, returnByValue: true }
      }));
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data.toString());
      if (message.id !== 1) return;
      clearTimeout(timeout);
      socket.close();
      if (message.error) rejectEvaluation(new Error(message.error.message));
      else if (message.result?.exceptionDetails) rejectEvaluation(new Error(message.result.exceptionDetails.text ?? "CDP evaluation exception"));
      else resolveEvaluation(message.result?.result?.value);
    });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      rejectEvaluation(new Error("CDP websocket connection failed"));
    });
  });
}
`;
}
