import { Interface, Transaction } from "ethers";
import { rewriteCdpWebSocketHost } from "./cdp.mjs";

const ONE_GWEI = "0x3b9aca00";
const BIG_BALANCE = "0x56bc75e2d63100000"; // 100 ETH — covers any value + fees
const ERC20_INFO_INTERFACE = new Interface([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function allowance(address owner,address spender) view returns (uint256)"
]);

// Canned JSON-RPC results: enough for ethers to validate a recipient (eth_getCode -> 0x)
// and to build + broadcast a native transfer. eth_sendRawTransaction returns the *real* hash
// of the submitted raw tx because ethers v6 verifies the broadcast hash matches the signed tx.
export function resultFor(method, params) {
  switch (method) {
    case "eth_chainId": return "0x1";
    case "net_version": return "1";
    case "eth_blockNumber": return "0x1";
    case "eth_call": return erc20InfoResult(params?.[0]?.data) ?? "0x";
    case "eth_getCode": return "0x";
    case "eth_getBalance": return BIG_BALANCE;
    case "eth_getTransactionCount": return "0x0";
    case "eth_gasPrice": return ONE_GWEI;
    case "eth_maxPriorityFeePerGas": return ONE_GWEI;
    case "eth_estimateGas": return "0x5208"; // 21000
    case "eth_getBlockByNumber":
      return {
        number: "0x1", hash: `0x${"00".repeat(32)}`, parentHash: `0x${"00".repeat(32)}`,
        nonce: "0x0000000000000000", sha3Uncles: `0x${"00".repeat(32)}`, logsBloom: `0x${"00".repeat(256)}`,
        transactionsRoot: `0x${"00".repeat(32)}`, stateRoot: `0x${"00".repeat(32)}`, receiptsRoot: `0x${"00".repeat(32)}`,
        miner: `0x${"00".repeat(20)}`, difficulty: "0x0", totalDifficulty: "0x0", extraData: "0x", size: "0x0",
        gasLimit: "0x1c9c380", gasUsed: "0x0", baseFeePerGas: ONE_GWEI, timestamp: "0x0",
        mixHash: `0x${"00".repeat(32)}`, uncles: [], transactions: []
      };
    case "eth_feeHistory":
      return { oldestBlock: "0x1", baseFeePerGas: [ONE_GWEI, ONE_GWEI], gasUsedRatio: [0.5], reward: [[ONE_GWEI]] };
    case "eth_sendRawTransaction":
      try { return Transaction.from(params?.[0]).hash; } catch { return `0x${"11".repeat(32)}`; }
    case "eth_getTransactionReceipt":
      return {
        transactionHash: params?.[0] ?? `0x${"11".repeat(32)}`, transactionIndex: "0x0",
        blockNumber: "0x1", blockHash: `0x${"22".repeat(32)}`, from: `0x${"00".repeat(20)}`,
        to: `0x${"00".repeat(20)}`, cumulativeGasUsed: "0x5208", gasUsed: "0x5208", status: "0x1",
        type: "0x2", effectiveGasPrice: ONE_GWEI, logs: [], logsBloom: `0x${"00".repeat(256)}`
      };
    default: return null;
  }
}

function erc20InfoResult(data) {
  if (typeof data !== "string") return undefined;
  const normalized = data.toLowerCase();
  if (normalized === ERC20_INFO_INTERFACE.encodeFunctionData("name").toLowerCase()) {
    return ERC20_INFO_INTERFACE.encodeFunctionResult("name", ["Tether USD"]);
  }
  if (normalized === ERC20_INFO_INTERFACE.encodeFunctionData("symbol").toLowerCase()) {
    return ERC20_INFO_INTERFACE.encodeFunctionResult("symbol", ["USDt"]);
  }
  if (normalized === ERC20_INFO_INTERFACE.encodeFunctionData("decimals").toLowerCase()) {
    return ERC20_INFO_INTERFACE.encodeFunctionResult("decimals", [6]);
  }
  if (normalized.startsWith(ERC20_INFO_INTERFACE.getFunction("allowance").selector)) {
    return ERC20_INFO_INTERFACE.encodeFunctionResult("allowance", [250n]);
  }
  return undefined;
}

function buildRpcResponse(payload, calls, log) {
  const handleOne = (entry) => {
    if (log) console.error(`[rpc-intercept] ${entry?.method}`);
    calls.push({ method: entry?.method, params: entry?.params });
    return { jsonrpc: "2.0", id: entry?.id ?? null, result: resultFor(entry?.method, entry?.params) };
  };
  return Array.isArray(payload) ? payload.map(handleOne) : handleOne(payload);
}

// Intercept the extension service worker's JSON-RPC fetches at Chrome's network layer and
// fulfill them with canned responses — so a dApp transaction can be validated, approved, and
// "broadcast" without reaching any real or loopback RPC. Non-RPC requests pass through untouched.
export async function startRpcInterception({ host, port, target, log = false }) {
  const calls = [];
  const version = await fetch(`http://${host}:${port}/json/version`).then((response) => response.json());
  if (!version.webSocketDebuggerUrl) throw new Error("Browser CDP websocket unavailable for RPC interception");

  const socket = new WebSocket(rewriteCdpWebSocketHost(version.webSocketDebuggerUrl, host));
  let nextId = 1;
  let sessionId;
  const pending = new Map();

  const COMMAND_TIMEOUT_MS = 10_000;
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
        reject(new Error(`CDP ${method} timed out after ${COMMAND_TIMEOUT_MS}ms`));
      }, COMMAND_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
    });
  };

  const onRequestPaused = async (requestId, request, networkId) => {
    try {
      let body = request.postData;
      if (body === undefined && request.hasPostData && networkId) {
        body = (await send("Network.getRequestPostData", { requestId: networkId }).catch(() => undefined))?.postData;
      }
      let rpc;
      try { rpc = body ? JSON.parse(body) : undefined; } catch { rpc = undefined; }
      const isRpc = request.method === "POST" && (Array.isArray(rpc) ? rpc[0]?.jsonrpc : rpc?.jsonrpc);
      if (!isRpc) {
        await send("Fetch.continueRequest", { requestId });
        return;
      }
      await send("Fetch.fulfillRequest", {
        requestId,
        responseCode: 200,
        responseHeaders: [{ name: "content-type", value: "application/json" }],
        body: Buffer.from(JSON.stringify(buildRpcResponse(rpc, calls, log))).toString("base64")
      });
    } catch {
      await send("Fetch.continueRequest", { requestId }).catch(() => undefined);
    }
  };

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
    if (message.method === "Fetch.requestPaused") {
      void onRequestPaused(message.params.requestId, message.params.request, message.params.networkId);
    }
  });

  let opened = false;
  socket.addEventListener("close", () => rejectAll(new Error("RPC interception websocket closed before commands completed")));
  socket.addEventListener("error", () => { if (opened) rejectAll(new Error("RPC interception websocket errored")); });
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", () => { opened = true; resolve(); }, { once: true });
    socket.addEventListener("error", () => { if (!opened) reject(new Error("RPC interception websocket failed to open")); }, { once: true });
  });

  const targetId = target.targetId ?? target.id;
  if (!targetId) throw new Error("Service worker target has no id for RPC interception");
  sessionId = (await send("Target.attachToTarget", { targetId, flatten: true }, false)).sessionId;
  await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });

  return {
    calls,
    stop: async () => {
      await send("Fetch.disable").catch(() => undefined);
      if (sessionId) await send("Target.detachFromTarget", { sessionId }, false).catch(() => undefined);
      socket.close();
    }
  };
}
