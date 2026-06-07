/** EIP-1193 / EIP-1474 provider RPC error codes used by dApps. */
export const PROVIDER_RPC_ERROR_CODES = {
  USER_REJECTED: 4001,
  UNAUTHORIZED: 4100,
  UNSUPPORTED_METHOD: 4200,
  DISCONNECTED: 4900,
  CHAIN_DISCONNECTED: 4901,
  UNRECOGNIZED_CHAIN: 4902
} as const;

export type ProviderRpcErrorPayload = {
  code: number;
  message: string;
  data?: unknown;
};

export const PROVIDER_RPC_ERROR_RESPONSE_KEY = "__wdkProviderRpcError";

export class ProviderRpcError extends Error {
  readonly code: number;
  readonly data?: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "ProviderRpcError";
    this.code = code;
    this.data = data;
  }

  toJSON(): ProviderRpcErrorPayload {
    return { code: this.code, message: this.message, data: this.data };
  }
}

export function isProviderRpcErrorPayload(value: unknown): value is ProviderRpcErrorPayload {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.code === "number" && typeof record.message === "string";
}

export function isProviderRpcErrorResponse(value: unknown): value is Record<typeof PROVIDER_RPC_ERROR_RESPONSE_KEY, ProviderRpcErrorPayload> {
  if (typeof value !== "object" || value === null) return false;
  const payload = (value as Record<string, unknown>)[PROVIDER_RPC_ERROR_RESPONSE_KEY];
  return isProviderRpcErrorPayload(payload);
}

const MESSAGE_CODE_RULES: Array<{ match: (message: string) => boolean; code: number }> = [
  { match: (message) => message === "User rejected signature request" || message === "Signature request cancelled", code: PROVIDER_RPC_ERROR_CODES.USER_REJECTED },
  { match: (message) => message.startsWith("Unsupported dApp method:"), code: PROVIDER_RPC_ERROR_CODES.UNSUPPORTED_METHOD },
  { match: (message) => message.startsWith("Unsupported ") && message.includes(" in dApp transaction request"), code: PROVIDER_RPC_ERROR_CODES.UNSUPPORTED_METHOD },
  { match: (message) => message.startsWith("Contract dApp transactions are not supported"), code: PROVIDER_RPC_ERROR_CODES.UNSUPPORTED_METHOD },
  { match: (message) => message.includes("Unrecognized chain ID"), code: PROVIDER_RPC_ERROR_CODES.UNRECOGNIZED_CHAIN },
  { match: (message) => message === "Invalid chain ID", code: PROVIDER_RPC_ERROR_CODES.UNRECOGNIZED_CHAIN },
  { match: (message) => message === "Wallet is locked", code: PROVIDER_RPC_ERROR_CODES.UNAUTHORIZED },
  { match: (message) => message === "No active wallet", code: PROVIDER_RPC_ERROR_CODES.UNAUTHORIZED },
  { match: (message) => message.startsWith("Connection approval required"), code: PROVIDER_RPC_ERROR_CODES.UNAUTHORIZED },
  { match: (message) => message === "Site is not connected to this wallet", code: PROVIDER_RPC_ERROR_CODES.UNAUTHORIZED },
  { match: (message) => message === "Invalid provider method" || message === "Invalid provider params", code: PROVIDER_RPC_ERROR_CODES.UNSUPPORTED_METHOD },
  { match: (message) => message === "Invalid wallet_switchEthereumChain params", code: PROVIDER_RPC_ERROR_CODES.UNRECOGNIZED_CHAIN }
];

export function providerRpcErrorFromMessage(message: string, code?: number): ProviderRpcError {
  if (code !== undefined) return new ProviderRpcError(code, message);
  const rule = MESSAGE_CODE_RULES.find((entry) => entry.match(message));
  return new ProviderRpcError(rule?.code ?? -32603, message);
}

export function toProviderRpcError(error: unknown): ProviderRpcError {
  if (error instanceof ProviderRpcError) return error;
  const message = error instanceof Error ? error.message : "Unknown provider error";
  return providerRpcErrorFromMessage(message);
}

export function toProviderRpcErrorPayload(error: unknown): ProviderRpcErrorPayload {
  return toProviderRpcError(error).toJSON();
}

export function providerRpcErrorFromPayload(payload: ProviderRpcErrorPayload): ProviderRpcError {
  return new ProviderRpcError(payload.code, payload.message, payload.data);
}
