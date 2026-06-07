import { rewriteCdpWebSocketHost } from "./cdp.mjs";
import { resultFor } from "./rpc-intercept.mjs";

const COMMAND_TIMEOUT_MS = 10_000;
const CSP_PATTERNS = [
  /content security policy/i,
  /violates the following content security policy directive/i,
  /refused to connect because it violates/i,
  /fetch api cannot load .*content security policy/i
];

export async function startExtensionDiagnostics({ host, port, target, log = false }) {
  const connection = await attachToTarget({ host, port, target, label: "extension diagnostics" });
  const entries = [];
  const requestUrls = new Map();

  const onEvent = (message) => {
    if (message.method === "Runtime.consoleAPICalled") {
      const entry = {
        kind: "console",
        level: message.params?.type,
        text: (message.params?.args ?? []).map(remoteObjectText).join(" "),
        url: message.params?.stackTrace?.callFrames?.[0]?.url
      };
      entries.push(entry);
      if (log) console.error(`[extension-diagnostics] ${entry.level}: ${entry.text}`);
      return;
    }
    if (message.method === "Runtime.exceptionThrown") {
      const details = message.params?.exceptionDetails;
      entries.push({
        kind: "exception",
        text: details?.exception?.description ?? details?.text ?? "Runtime exception",
        url: details?.url,
        lineNumber: details?.lineNumber,
        columnNumber: details?.columnNumber
      });
      return;
    }
    if (message.method === "Log.entryAdded") {
      const entry = message.params?.entry ?? {};
      entries.push({
        kind: "log",
        level: entry.level,
        source: entry.source,
        text: entry.text,
        url: entry.url
      });
      return;
    }
    if (message.method === "Network.requestWillBeSent") {
      requestUrls.set(message.params?.requestId, message.params?.request?.url);
      return;
    }
    if (message.method === "Network.loadingFailed") {
      entries.push({
        kind: "network-failed",
        text: message.params?.errorText,
        blockedReason: message.params?.blockedReason,
        url: requestUrls.get(message.params?.requestId),
        type: message.params?.type
      });
    }
  };

  connection.onEvent(onEvent);
  await connection.send("Runtime.enable");
  await connection.send("Log.enable");
  await connection.send("Network.enable");

  return {
    entries,
    snapshot: () => entries.slice(),
    assertClean() {
      const failures = entries.filter(isFatalDiagnosticEntry);
      if (failures.length) {
        throw new Error(`Extension diagnostics found blocked/unsafe runtime errors: ${JSON.stringify(failures)}`);
      }
      return { checked: true, entries: entries.length };
    },
    stop: () => connection.stop()
  };
}

export async function startBalanceEgressMock({ host, port, target, log = false }) {
  const connection = await attachToTarget({ host, port, target, label: "balance egress mock" });

  const onRequestPaused = async ({ requestId, request, networkId }) => {
    try {
      const mocked = await mockedResponseForRequest(connection, request, networkId);
      if (!mocked) {
        await connection.send("Fetch.continueRequest", { requestId });
        return;
      }
      if (log) console.error(`[balance-egress-mock] ${request.method} ${request.url}`);
      await connection.send("Fetch.fulfillRequest", {
        requestId,
        responseCode: mocked.status,
        responseHeaders: [{ name: "content-type", value: "application/json" }],
        body: Buffer.from(JSON.stringify(mocked.body)).toString("base64")
      });
    } catch {
      await connection.send("Fetch.continueRequest", { requestId }).catch(() => undefined);
    }
  };

  connection.onEvent((message) => {
    if (message.method === "Fetch.requestPaused") void onRequestPaused(message.params);
  });
  await connection.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });

  return {
    stop: async () => {
      await connection.send("Fetch.disable").catch(() => undefined);
      await connection.stop();
    }
  };
}

async function mockedResponseForRequest(connection, request, networkId) {
  if (!isHttpUrl(request.url)) return undefined;
  const rpcPayload = await readJsonPostData(connection, request, networkId);
  if (rpcPayload) return { status: 200, body: rpcResponseForPayload(rpcPayload) };

  const url = new URL(request.url);
  if (url.hostname === "api.sparkscan.io" && url.pathname.includes("/tokens")) {
    return { status: 200, body: { tokens: [] } };
  }
  if (url.hostname === "api.sparkscan.io" && url.pathname.startsWith("/v1/address/")) {
    return {
      status: 200,
      body: {
        balance: {
          btcHardBalanceSats: 0,
          btcSoftBalanceSats: 0,
          btcValueUsdHard: 0,
          btcValueUsdSoft: 0,
          totalTokenValueUsd: 0
        },
        tokens: [],
        totalValueUsd: 0,
        transactionCount: 0,
        tokenCount: 0
      }
    };
  }
  if ((url.hostname === "blockstream.info" || url.hostname === "mempool.space") && url.pathname.includes("/address/")) {
    return {
      status: 200,
      body: {
        chain_stats: { funded_txo_sum: 0, spent_txo_sum: 0 },
        mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0 }
      }
    };
  }
  if (url.hostname === "btc1.trezor.io" && url.pathname.includes("/address/")) {
    return { status: 200, body: { balance: "0", unconfirmedBalance: "0", txs: 0 } };
  }
  return { status: 200, body: {} };
}

async function readJsonPostData(connection, request, networkId) {
  if (request.method !== "POST") return undefined;
  let body = request.postData;
  if (body === undefined && request.hasPostData && networkId) {
    body = (await connection.send("Network.getRequestPostData", { requestId: networkId }).catch(() => undefined))?.postData;
  }
  if (!body) return undefined;
  try {
    const parsed = JSON.parse(body);
    const entry = Array.isArray(parsed) ? parsed[0] : parsed;
    return entry?.jsonrpc ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function rpcResponseForPayload(payload) {
  const one = (entry) => ({ jsonrpc: "2.0", id: entry?.id ?? null, result: rpcResultFor(entry?.method, entry?.params) });
  return Array.isArray(payload) ? payload.map(one) : one(payload);
}

function rpcResultFor(method, params) {
  const evmResult = resultFor(method, params);
  if (evmResult !== null) return evmResult;
  switch (method) {
    case "getBalance": return { value: 0 };
    case "getHealth": return "ok";
    case "getLatestBlockhash":
      return { value: { blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1 } };
    case "getAccountInfo": return { value: null };
    case "getTokenAccountsByOwner": return { value: [] };
    case "getSignatureStatuses": return { value: [null] };
    default: return null;
  }
}

async function attachToTarget({ host, port, target, label }) {
  const version = await fetch(`http://${host}:${port}/json/version`).then((response) => response.json());
  if (!version.webSocketDebuggerUrl) throw new Error(`Browser CDP websocket unavailable for ${label}`);
  const socket = new WebSocket(rewriteCdpWebSocketHost(version.webSocketDebuggerUrl, host));
  const targetId = target.targetId ?? target.id;
  if (!targetId) throw new Error(`CDP target has no id for ${label}`);
  let nextId = 1;
  let sessionId;
  const pending = new Map();
  const eventHandlers = new Set();

  const rejectAll = (error) => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    pending.clear();
  };

  const send = (method, params = {}, useSession = true) => {
    const id = nextId++;
    const payload = useSession && sessionId ? { id, method, params, sessionId } : { id, method, params };
    socket.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error(`CDP ${method} timed out during ${label}`));
      }, COMMAND_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
    });
  };

  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error(`CDP websocket failed during ${label}`)), { once: true });
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data.toString());
    if (message.id && pending.has(message.id)) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result);
      return;
    }
    if (message.sessionId && message.sessionId !== sessionId) return;
    for (const handler of eventHandlers) handler(message);
  });
  socket.addEventListener("close", () => rejectAll(new Error(`CDP websocket closed during ${label}`)));
  socket.addEventListener("error", () => rejectAll(new Error(`CDP websocket errored during ${label}`)));
  sessionId = (await send("Target.attachToTarget", { targetId, flatten: true }, false)).sessionId;

  return {
    send,
    onEvent(handler) {
      eventHandlers.add(handler);
      return () => eventHandlers.delete(handler);
    },
    async stop() {
      if (sessionId) await send("Target.detachFromTarget", { sessionId }, false).catch(() => undefined);
      socket.close();
    }
  };
}

function remoteObjectText(value) {
  if (!value) return "";
  if ("value" in value) return typeof value.value === "string" ? value.value : JSON.stringify(value.value);
  return value.description ?? value.unserializableValue ?? value.type ?? "";
}

function isFatalDiagnosticEntry(entry) {
  if (entry.kind === "exception") return true;
  if (String(entry.blockedReason ?? "").toLowerCase().includes("csp")) return true;
  const text = `${entry.text ?? ""} ${entry.url ?? ""}`;
  return CSP_PATTERNS.some((pattern) => pattern.test(text));
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
