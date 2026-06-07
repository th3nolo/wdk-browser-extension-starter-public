import { INPAGE_TO_CONTENT } from "./constants";
import { PROVIDER_RPC_ERROR_CODES, type ProviderRpcErrorPayload } from "./errors";

export type ParsedInpageRequest = {
  id: string;
  method: string;
  params?: unknown[] | Record<string, unknown>;
};

export type InpageRequestParseResult =
  | { ok: true; request: ParsedInpageRequest }
  | { ok: false; id: string; error: ProviderRpcErrorPayload };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isParams(value: unknown): value is unknown[] | Record<string, unknown> | undefined {
  return value === undefined || Array.isArray(value) || isRecord(value);
}

export function parseInpageRequestMessage(data: unknown): InpageRequestParseResult | undefined {
  if (!isRecord(data) || data.target !== INPAGE_TO_CONTENT) return undefined;
  if (typeof data.id !== "string" || data.id.length === 0) return undefined;
  if (typeof data.method !== "string" || data.method.length === 0) {
    return {
      ok: false,
      id: data.id,
      error: { code: PROVIDER_RPC_ERROR_CODES.UNSUPPORTED_METHOD, message: "Invalid provider method" }
    };
  }
  if (!isParams(data.params)) {
    return {
      ok: false,
      id: data.id,
      error: { code: PROVIDER_RPC_ERROR_CODES.UNSUPPORTED_METHOD, message: "Invalid provider params" }
    };
  }
  return {
    ok: true,
    request: {
      id: data.id,
      method: data.method,
      params: data.params
    }
  };
}
