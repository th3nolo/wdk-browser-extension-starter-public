import type { ParsedDappEvmTransaction } from "../dapp-transaction";
import type { ParsedPersonalSignMessage } from "../personal-sign";
import type { Eip712TypedDataPayload, SignatureRequestKind, TypedDataSignatureRequestKind } from "../types";
import { calldataByteLength, calldataDigest } from "./calldata";
import { hexBytes, keccakHex, utf8Bytes, type Hex } from "./hash";
import { eip712DigestEvidence } from "./typed-data";

export type VerificationSource = "raw-dapp-request";
export type VerificationVectorSet = "wysiwys-v1";

export type DappTransactionVerificationEvidence = {
  kind: "eth_sendTransaction";
  requestDigest: Hex;
  requestByteLength: number;
  calldataDigest: Hex | null;
  target: string;
  value: string;
  dataByteLength: number;
  source: VerificationSource;
  algorithm: "erc8213-calldata-digest";
  verifiedByVectors: boolean;
  vectorSet: VerificationVectorSet;
};

export type DappPersonalSignVerificationEvidence = {
  kind: "personal_sign";
  requestDigest: Hex;
  requestByteLength: number;
  messageDigest: Hex;
  messageByteLength: number;
  messageEncoding: "utf8" | "hex";
  source: VerificationSource;
  algorithm: "eip191-personal-sign";
  verifiedByVectors: boolean;
  vectorSet: VerificationVectorSet;
};

export type DappTypedDataVerificationEvidence = {
  kind: TypedDataSignatureRequestKind;
  requestDigest: Hex;
  requestByteLength: number;
  finalDigest: Hex;
  domainSeparator: Hex;
  messageHash: Hex;
  primaryType: string;
  source: VerificationSource;
  algorithm: "eip712";
  verifiedByVectors: boolean;
  vectorSet: VerificationVectorSet;
};

export type DappSignatureVerificationEvidence =
  | DappPersonalSignVerificationEvidence
  | DappTypedDataVerificationEvidence;

export type RawDappRequestParams = unknown;

const VECTOR_SET: VerificationVectorSet = "wysiwys-v1";

export function captureRawDappRequestParams(params: unknown): RawDappRequestParams {
  return deepFreeze(typeof structuredClone === "function" ? structuredClone(params) : jsonClone(params));
}

export function buildTransactionVerificationEvidence(
  rawParams: RawDappRequestParams,
  tx: ParsedDappEvmTransaction
): DappTransactionVerificationEvidence {
  const raw = rawRequestDigest(rawParams);
  const data = tx.data ?? null;
  return {
    kind: "eth_sendTransaction",
    requestDigest: raw.digest,
    requestByteLength: raw.byteLength,
    calldataDigest: data ? calldataDigest(data) : null,
    target: tx.to,
    value: tx.value.toString(),
    dataByteLength: data ? calldataByteLength(data) : 0,
    source: "raw-dapp-request",
    algorithm: "erc8213-calldata-digest",
    verifiedByVectors: true,
    vectorSet: VECTOR_SET
  };
}

export function buildPersonalSignVerificationEvidence(
  rawParams: RawDappRequestParams,
  parsed: ParsedPersonalSignMessage
): DappPersonalSignVerificationEvidence {
  const raw = rawRequestDigest(rawParams);
  return {
    kind: "personal_sign",
    requestDigest: raw.digest,
    requestByteLength: raw.byteLength,
    messageDigest: personalSignDigest(parsed.message, parsed.messageEncoding),
    messageByteLength: parsed.messageByteLength,
    messageEncoding: parsed.messageEncoding,
    source: "raw-dapp-request",
    algorithm: "eip191-personal-sign",
    verifiedByVectors: true,
    vectorSet: VECTOR_SET
  };
}

export function buildTypedDataVerificationEvidence(
  rawParams: RawDappRequestParams,
  kind: Extract<SignatureRequestKind, "eth_signTypedData_v3" | "eth_signTypedData_v4">,
  typedData: Eip712TypedDataPayload
): DappTypedDataVerificationEvidence {
  const raw = rawRequestDigest(rawParams);
  const digest = eip712DigestEvidence(typedData);
  return {
    kind,
    requestDigest: raw.digest,
    requestByteLength: raw.byteLength,
    ...digest,
    primaryType: typedData.primaryType,
    source: "raw-dapp-request",
    algorithm: "eip712",
    verifiedByVectors: true,
    vectorSet: VECTOR_SET
  };
}

export function rawRequestDigest(rawParams: unknown): { digest: Hex; byteLength: number; serialized: string } {
  const serialized = stableSerialize(rawParams);
  const bytes = utf8Bytes(serialized);
  return {
    digest: keccakHex(bytes),
    byteLength: bytes.length,
    serialized
  };
}

export function personalSignDigest(message: string, encoding: "utf8" | "hex"): Hex {
  const messageBytes = encoding === "hex" ? hexBytes(message, "personal_sign message") : utf8Bytes(message);
  return keccakHex(new Uint8Array([
    ...utf8Bytes(`\x19Ethereum Signed Message:\n${messageBytes.length}`),
    ...messageBytes
  ]));
}

export function stableSerialize(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function stableValue(value: unknown, seen = new Set<object>()): unknown {
  if (value === undefined) return { $type: "undefined" };
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "bigint") return { $type: "bigint", value: value.toString() };
  if (Array.isArray(value)) return value.map((entry) => stableValue(entry, seen));
  if (value instanceof Date) return { $type: "date", value: value.toISOString() };
  if (typeof value === "object") {
    if (seen.has(value)) throw new Error("Cannot serialize cyclic dApp request params");
    seen.add(value);
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      output[key] = stableValue((value as Record<string, unknown>)[key], seen);
    }
    seen.delete(value);
    return output;
  }
  throw new Error("Cannot serialize non-data dApp request params");
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object") return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return value;
}

function jsonClone(value: unknown): unknown {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value)) as unknown;
}
