import type { Eip712TypedDataPayload, PersonalSignMessageEncoding } from "./types";
import { PERSONAL_SIGN_MAX_MESSAGE_BYTES } from "./personal-sign";

export const SIGNATURE_PHISHING_WARNING =
  "Only approve if you trust this site. Malicious sites can ask you to sign messages that approve transfers or permissions elsewhere.";

export const PERSONAL_SIGN_HEX_NOTICE =
  "This dApp sent a 0x hex payload. WDK Wallet signs the raw decoded bytes (EIP-191). UTF-8 text is shown below when the payload is decodable; otherwise the hex string is shown.";

export function personalSignEncodingLabel(encoding: PersonalSignMessageEncoding): string {
  return encoding === "hex" ? "Hex payload (raw bytes signed)" : "Plain UTF-8 text";
}

export function formatMessageByteCount(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/** True when a dapp sent JSON that resembles EIP-712 typed data via personal_sign. */
export function looksLikeEip712PersonalSign(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed.startsWith("{")) return false;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return false;
    const hasTypedDataShape = "types" in parsed && "domain" in parsed && "message" in parsed;
    const hasPrimaryType = typeof parsed.primaryType === "string";
    return hasTypedDataShape || hasPrimaryType;
  } catch {
    return false;
  }
}

export function signatureMessageScrollHint(byteLength: number): string | undefined {
  if (byteLength <= 512) return undefined;
  const cap = formatMessageByteCount(PERSONAL_SIGN_MAX_MESSAGE_BYTES);
  return `Large message (${formatMessageByteCount(byteLength)}). Scroll to read all of it (max ${cap}).`;
}

export function typedDataEncodingLabel(): string {
  return "EIP-712 typed data";
}

export function formatTypedDataDomain(payload: Eip712TypedDataPayload): string {
  const parts: string[] = [];
  if (typeof payload.domain.name === "string") parts.push(`Name: ${payload.domain.name}`);
  if (payload.domain.chainId !== undefined) parts.push(`Chain ID: ${String(payload.domain.chainId)}`);
  if (typeof payload.domain.verifyingContract === "string") parts.push(`Contract: ${payload.domain.verifyingContract}`);
  if (typeof payload.domain.version === "string") parts.push(`Version: ${payload.domain.version}`);
  return parts.length ? parts.join(" · ") : "No domain metadata";
}

export function formatTypedDataMessagePreview(payload: Eip712TypedDataPayload): string {
  return JSON.stringify(payload.message, null, 2);
}
