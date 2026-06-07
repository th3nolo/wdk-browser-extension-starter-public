import { isAddress as isEvmAddress } from "ethers";
import { connectionEvmChainId, type ConnectedDappSession } from "./background/connected-sites";
import { ProviderRpcError } from "./provider/errors";
import { rpcFetchForChain, RpcFetchError } from "./rpc-fetch";
import { readStore } from "./storage/store";
import type { ChainId } from "./types";

const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

export const READ_ONLY_EVM_RPC_METHODS = [
  "net_version",
  "eth_blockNumber",
  "eth_getBalance",
  "eth_call",
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_feeHistory",
  "eth_getTransactionCount",
  "eth_getTransactionReceipt",
  "eth_getCode"
] as const;

export type ReadOnlyEvmRpcMethod = typeof READ_ONLY_EVM_RPC_METHODS[number];

const READ_ONLY_EVM_RPC_METHOD_SET = new Set<string>(READ_ONLY_EVM_RPC_METHODS);
const EVM_CHAINS = new Set<ChainId>(["ethereum", "polygon", "arbitrum", "plasma"]);
const BLOCK_TAGS = new Set(["latest", "earliest", "pending", "safe", "finalized"]);
const TRANSACTION_FIELDS = [
  "from",
  "to",
  "data",
  "input",
  "value",
  "gas",
  "gasPrice",
  "maxFeePerGas",
  "maxPriorityFeePerGas",
  "nonce",
  "type",
  "accessList"
] as const;

type JsonRpcPayload = {
  result?: unknown;
  error?: {
    code?: unknown;
    message?: unknown;
    data?: unknown;
  };
};

export function isReadOnlyEvmRpcMethod(method: string): method is ReadOnlyEvmRpcMethod {
  return READ_ONLY_EVM_RPC_METHOD_SET.has(method);
}

export async function proxyReadOnlyEvmRpc(
  method: ReadOnlyEvmRpcMethod,
  params: unknown,
  connected: ConnectedDappSession
): Promise<unknown> {
  if (!EVM_CHAINS.has(connected.chain)) {
    throw new ProviderRpcError(INTERNAL_ERROR, `Read-only EVM RPC is unavailable for ${connected.chain}`);
  }
  if (method === "net_version") {
    expectNoParams(params, method);
    return String(connectionEvmChainId(connected.connection));
  }

  const rpcParams = normalizeReadOnlyParams(method, params, connected.account.address);
  const store = await readStore();
  const response = await rpcFetchForChain(connected.chain, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: rpcParams })
  }, store.rpcOverrides?.[connected.chain]);
  const payload = await response.json() as JsonRpcPayload;
  if (payload.error) {
    throw new ProviderRpcError(
      typeof payload.error.code === "number" ? payload.error.code : INTERNAL_ERROR,
      typeof payload.error.message === "string" ? payload.error.message : `${method} failed`,
      payload.error.data
    );
  }
  if (!Object.prototype.hasOwnProperty.call(payload, "result")) {
    throw new ProviderRpcError(INTERNAL_ERROR, `${method} returned an invalid RPC response`);
  }
  return payload.result;
}

function normalizeReadOnlyParams(method: ReadOnlyEvmRpcMethod, params: unknown, connectedAddress: string): unknown[] {
  switch (method) {
    case "eth_blockNumber":
    case "eth_gasPrice":
      expectNoParams(params, method);
      return [];
    case "eth_getBalance":
    case "eth_getCode":
    case "eth_getTransactionCount":
      return normalizeAddressAndBlockTagParams(params, method);
    case "eth_getTransactionReceipt":
      return normalizeTransactionReceiptParams(params);
    case "eth_call":
      return normalizeCallParams(params, connectedAddress);
    case "eth_estimateGas":
      return normalizeEstimateGasParams(params, connectedAddress);
    case "eth_feeHistory":
      return normalizeFeeHistoryParams(params);
    case "net_version":
      expectNoParams(params, method);
      return [];
  }
}

function paramsArray(params: unknown, method: string): unknown[] {
  if (params === undefined) return [];
  if (!Array.isArray(params)) throw invalid(`${method} params must be an array`);
  return params;
}

function expectNoParams(params: unknown, method: string): void {
  const list = paramsArray(params, method);
  if (list.length > 0) throw invalid(`${method} does not accept params`);
}

function normalizeAddressAndBlockTagParams(params: unknown, method: string): unknown[] {
  const list = paramsArray(params, method);
  if (list.length < 1 || list.length > 2) throw invalid(`${method} requires address and optional block tag params`);
  return [normalizeAddress(list[0], "address"), normalizeBlockTag(list[1] ?? "latest", "block tag")];
}

function normalizeTransactionReceiptParams(params: unknown): unknown[] {
  const list = paramsArray(params, "eth_getTransactionReceipt");
  if (list.length !== 1) throw invalid("eth_getTransactionReceipt requires a transaction hash");
  return [normalizeHash32(list[0], "transaction hash")];
}

function normalizeCallParams(params: unknown, connectedAddress: string): unknown[] {
  const list = paramsArray(params, "eth_call");
  if (list.length < 1 || list.length > 2) throw invalid("eth_call requires transaction and optional block tag params");
  return [normalizeTransactionObject(list[0], connectedAddress, "eth_call"), normalizeBlockTag(list[1] ?? "latest", "block tag")];
}

function normalizeEstimateGasParams(params: unknown, connectedAddress: string): unknown[] {
  const list = paramsArray(params, "eth_estimateGas");
  if (list.length < 1 || list.length > 2) throw invalid("eth_estimateGas requires transaction params");
  const normalized: unknown[] = [normalizeTransactionObject(list[0], connectedAddress, "eth_estimateGas")];
  if (list.length === 2) normalized.push(normalizeBlockTag(list[1], "block tag"));
  return normalized;
}

function normalizeFeeHistoryParams(params: unknown): unknown[] {
  const list = paramsArray(params, "eth_feeHistory");
  if (list.length < 2 || list.length > 3) throw invalid("eth_feeHistory requires block count, newest block, and optional reward percentiles");
  const normalized: unknown[] = [normalizeQuantity(list[0], "block count"), normalizeBlockTag(list[1], "newest block")];
  if (list.length === 3) normalized.push(normalizeRewardPercentiles(list[2]));
  return normalized;
}

function normalizeTransactionObject(value: unknown, connectedAddress: string, method: string): Record<string, unknown> {
  if (!isRecord(value)) throw invalid(`${method} transaction must be an object`);
  const unknownField = Object.keys(value).find((field) => !TRANSACTION_FIELDS.includes(field as typeof TRANSACTION_FIELDS[number]));
  if (unknownField) throw invalid(`Unsupported ${unknownField} in ${method} transaction`);

  const normalized: Record<string, unknown> = { from: connectedAddress };
  if (value.from !== undefined) {
    const from = normalizeAddress(value.from, "from");
    if (from.toLowerCase() !== connectedAddress.toLowerCase()) {
      throw invalid(`${method} from must match the connected account`);
    }
    normalized.from = from;
  }
  if (value.to !== undefined) normalized.to = normalizeAddress(value.to, "to");
  if (value.data !== undefined) normalized.data = normalizeHexData(value.data, "data");
  if (value.input !== undefined) normalized.input = normalizeHexData(value.input, "input");
  for (const field of ["value", "gas", "gasPrice", "maxFeePerGas", "maxPriorityFeePerGas", "nonce", "type"] as const) {
    if (value[field] !== undefined) normalized[field] = normalizeQuantity(value[field], field);
  }
  if (value.accessList !== undefined) {
    if (!Array.isArray(value.accessList)) throw invalid("accessList must be an array");
    normalized.accessList = value.accessList;
  }
  return normalized;
}

function normalizeAddress(value: unknown, field: string): string {
  if (typeof value !== "string" || !isEvmAddress(value.trim())) {
    throw invalid(`Invalid ${field}`);
  }
  return value.trim();
}

function normalizeHash32(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw invalid(`Invalid ${field}`);
  }
  return value;
}

function normalizeHexData(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^0x([0-9a-fA-F]{2})*$/.test(value)) {
    throw invalid(`Invalid ${field}`);
  }
  return value;
}

function normalizeQuantity(value: unknown, field: string): string {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return `0x${value.toString(16)}`;
  if (typeof value !== "string" || !/^0x([0-9a-fA-F]+)?$/.test(value)) throw invalid(`Invalid ${field}`);
  return value === "0x" ? "0x0" : value;
}

function normalizeBlockTag(value: unknown, field: string): string {
  if (typeof value !== "string") throw invalid(`Invalid ${field}`);
  if (BLOCK_TAGS.has(value)) return value;
  return normalizeQuantity(value, field);
}

function normalizeRewardPercentiles(value: unknown): number[] {
  if (!Array.isArray(value)) throw invalid("reward percentiles must be an array");
  return value.map((entry) => {
    if (typeof entry !== "number" || !Number.isFinite(entry) || entry < 0 || entry > 100) {
      throw invalid("Invalid reward percentile");
    }
    return entry;
  });
}

function invalid(message: string): ProviderRpcError {
  return new ProviderRpcError(INVALID_PARAMS, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readOnlyRpcError(error: unknown): ProviderRpcError {
  if (error instanceof ProviderRpcError) return error;
  if (error instanceof RpcFetchError) return new ProviderRpcError(INTERNAL_ERROR, error.message, { url: error.url, timedOut: error.timedOut });
  return new ProviderRpcError(INTERNAL_ERROR, error instanceof Error ? error.message : "Read-only RPC request failed");
}
