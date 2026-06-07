import { isEvmAddress } from "./personal-sign";
import type { Eip712TypedDataPayload } from "./types";

export const EIP712_MAX_JSON_BYTES = 32_768;

function normalizeEvmAddress(value: unknown): string | undefined {
  if (!isEvmAddress(value)) return undefined;
  return value.trim().toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeDomainChainId(chainId: unknown): number | undefined {
  if (chainId === undefined || chainId === null) return undefined;
  if (typeof chainId === "number") {
    if (!Number.isInteger(chainId) || chainId < 0) throw new Error("Invalid EIP-712 domain.chainId");
    return chainId;
  }
  if (typeof chainId === "bigint") {
    if (chainId < 0n || chainId > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("Invalid EIP-712 domain.chainId");
    }
    return Number(chainId);
  }
  if (typeof chainId === "string") {
    const trimmed = chainId.trim();
    if (trimmed.startsWith("0x") || trimmed.startsWith("0X")) {
      const parsed = Number.parseInt(trimmed, 16);
      if (Number.isNaN(parsed) || parsed < 0) throw new Error("Invalid EIP-712 domain.chainId");
      return parsed;
    }
    const parsed = Number(trimmed);
    if (!Number.isInteger(parsed) || parsed < 0) throw new Error("Invalid EIP-712 domain.chainId");
    return parsed;
  }
  throw new Error("Invalid EIP-712 domain.chainId");
}

function parseTypedDataObject(raw: unknown): Eip712TypedDataPayload {
  const typedData = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!isRecord(typedData)) throw new Error("Invalid EIP-712 typed data payload");
  if (!isRecord(typedData.domain)) throw new Error("Invalid EIP-712 domain");
  if (!isRecord(typedData.types)) throw new Error("Invalid EIP-712 types");
  if (!isRecord(typedData.message)) throw new Error("Invalid EIP-712 message");
  if (typeof typedData.primaryType !== "string" || typedData.primaryType.length === 0) {
    throw new Error("Invalid EIP-712 primaryType");
  }
  if (!Array.isArray(typedData.types[typedData.primaryType])) {
    throw new Error(`EIP-712 types missing primary type ${typedData.primaryType}`);
  }
  for (const [typeName, fields] of Object.entries(typedData.types)) {
    if (!Array.isArray(fields)) throw new Error(`Invalid EIP-712 field list for ${typeName}`);
    for (const field of fields) {
      if (!field || typeof field !== "object" || typeof field.name !== "string" || typeof field.type !== "string") {
        throw new Error(`Invalid EIP-712 field definition in ${typeName}`);
      }
    }
  }
  const serialized = JSON.stringify(typedData);
  if (new TextEncoder().encode(serialized).length > EIP712_MAX_JSON_BYTES) {
    throw new Error("EIP-712 typed data payload is too large");
  }
  return {
    domain: typedData.domain,
    types: typedData.types as Record<string, Array<{ name: string; type: string }>>,
    primaryType: typedData.primaryType,
    message: typedData.message
  };
}

export function parseSignTypedDataParams(
  params: unknown,
  connectedAddress: string,
  connectedChainId: number
): Eip712TypedDataPayload {
  const list = Array.isArray(params) ? params : [];
  if (list.length < 2) throw new Error("Invalid eth_signTypedData params");

  const firstAddress = normalizeEvmAddress(list[0]);
  const secondAddress = normalizeEvmAddress(list[1]);
  const connected = connectedAddress.toLowerCase();
  let typedDataRaw: unknown;

  if (firstAddress && !secondAddress) {
    if (firstAddress !== connected) throw new Error("Signature account does not match connected account");
    typedDataRaw = list[1];
  } else if (secondAddress && !firstAddress) {
    if (secondAddress !== connected) throw new Error("Signature account does not match connected account");
    typedDataRaw = list[0];
  } else if (firstAddress && secondAddress) {
    throw new Error("Invalid eth_signTypedData params");
  } else {
    typedDataRaw = list[1] ?? list[0];
  }

  let parsed: Eip712TypedDataPayload;
  try {
    parsed = parseTypedDataObject(typedDataRaw);
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("Invalid EIP-712 typed data JSON");
    throw error;
  }

  const domainChainId = normalizeDomainChainId(parsed.domain.chainId);
  if (domainChainId !== undefined && domainChainId !== connectedChainId) {
    throw new Error(
      `EIP-712 domain.chainId (${domainChainId}) does not match connected chain (${connectedChainId})`
    );
  }
  return parsed;
}

export function serializeTypedDataForDedup(payload: Eip712TypedDataPayload): string {
  return JSON.stringify({
    domain: payload.domain,
    types: payload.types,
    primaryType: payload.primaryType,
    message: payload.message
  });
}

export function summarizeTypedData(payload: Eip712TypedDataPayload): string {
  const domainName = typeof payload.domain.name === "string" ? payload.domain.name : "Unknown dApp";
  const chainId = payload.domain.chainId;
  const verifyingContract =
    typeof payload.domain.verifyingContract === "string" ? payload.domain.verifyingContract : undefined;
  const lines = [
    `Primary type: ${payload.primaryType}`,
    `Domain: ${domainName}`,
    chainId !== undefined ? `Chain ID: ${String(chainId)}` : undefined,
    verifyingContract ? `Contract: ${verifyingContract}` : undefined
  ].filter(Boolean);
  return lines.join("\n");
}
