const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const HEX_MESSAGE = /^0x[0-9a-fA-F]*$/;

/**
 * Byte cap for personal_sign payloads.
 * Hex payloads (0x…) are signed as raw decoded bytes; UTF-8 is used for display when decodable.
 */
export const PERSONAL_SIGN_MAX_MESSAGE_BYTES = 32_768;

export type PersonalSignMessageEncoding = "utf8" | "hex";

export type ParsedPersonalSignMessage = {
  /** Canonical signing input (plain text or lowercased 0x hex). */
  message: string;
  /** Human-readable preview shown in the approval UI. */
  displayMessage: string;
  messageEncoding: PersonalSignMessageEncoding;
  messageByteLength: number;
};

export function isEvmAddress(value: unknown): value is string {
  return typeof value === "string" && EVM_ADDRESS.test(value.trim());
}

function normalizeEvmAddress(value: unknown): string | undefined {
  if (!isEvmAddress(value)) return undefined;
  return value.trim().toLowerCase();
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function canonicalHexMessage(trimmed: string): string {
  return `0x${trimmed.slice(2).toLowerCase()}`;
}

function tryDecodeUtf8(bytes: Uint8Array): string | undefined {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

export function decodePersonalSignMessage(raw: unknown): ParsedPersonalSignMessage {
  if (typeof raw !== "string") throw new Error("Invalid personal_sign message");
  const trimmed = raw.trim();
  if (trimmed.length === 0) throw new Error("personal_sign message cannot be empty");

  if (trimmed.startsWith("0x") || trimmed.startsWith("0X")) {
    if (!HEX_MESSAGE.test(trimmed)) throw new Error("Invalid hex-encoded personal_sign message");
    const hex = trimmed.slice(2);
    if (hex.length % 2 !== 0) throw new Error("Invalid hex-encoded personal_sign message");
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      const byte = Number.parseInt(hex.slice(i, i + 2), 16);
      if (Number.isNaN(byte)) throw new Error("Invalid hex-encoded personal_sign message");
      bytes[i / 2] = byte;
    }
    if (bytes.length === 0) throw new Error("personal_sign message cannot be empty");
    if (bytes.length > PERSONAL_SIGN_MAX_MESSAGE_BYTES) throw new Error("personal_sign message is too large");
    const message = canonicalHexMessage(trimmed);
    const decoded = tryDecodeUtf8(bytes);
    return {
      message,
      displayMessage: decoded ?? message,
      messageEncoding: "hex",
      messageByteLength: bytes.length
    };
  }

  const messageByteLength = utf8ByteLength(trimmed);
  if (messageByteLength > PERSONAL_SIGN_MAX_MESSAGE_BYTES) throw new Error("personal_sign message is too large");
  return { message: trimmed, displayMessage: trimmed, messageEncoding: "utf8", messageByteLength };
}

export function parsePersonalSignParams(params: unknown, connectedAddress: string): ParsedPersonalSignMessage {
  const list = Array.isArray(params) ? params : [];
  if (list.length < 2) throw new Error("Invalid personal_sign params");

  const firstAddress = normalizeEvmAddress(list[0]);
  const secondAddress = normalizeEvmAddress(list[1]);
  const connected = connectedAddress.toLowerCase();

  let messageRaw: unknown;
  let requestedAddress: string | undefined;

  if (firstAddress && !secondAddress) {
    requestedAddress = firstAddress;
    messageRaw = list[1];
  } else if (secondAddress && !firstAddress) {
    messageRaw = list[0];
    requestedAddress = secondAddress;
  } else if (firstAddress && secondAddress) {
    throw new Error("Invalid personal_sign params");
  } else {
    messageRaw = list[0];
    requestedAddress = undefined;
  }

  if (requestedAddress && requestedAddress !== connected) {
    throw new Error("Signature account does not match connected account");
  }

  return decodePersonalSignMessage(messageRaw);
}
