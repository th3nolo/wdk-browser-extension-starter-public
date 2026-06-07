const encoder = new TextEncoder();

export const BRIDGE_MAC_FIELD = "mac";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (isRecord(value)) {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortKeys(value[key]);
        return acc;
      }, {});
  }
  return value;
}

function canonicalizeBridgePayload(payload: Record<string, unknown>): string {
  return JSON.stringify(sortKeys(payload));
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return mismatch === 0;
}

export function generateBridgeSecret(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

export function encodeBridgeSecret(secret: Uint8Array): string {
  return toBase64Url(secret);
}

export function decodeBridgeSecret(encoded: string): Uint8Array {
  return fromBase64Url(encoded);
}

async function importBridgeHmacKey(secret: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", asArrayBuffer(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function payloadWithoutMac(payload: Record<string, unknown>): Record<string, unknown> {
  const unsigned = { ...payload };
  delete unsigned[BRIDGE_MAC_FIELD];
  return unsigned;
}

export async function signBridgePayload(secret: Uint8Array, payload: Record<string, unknown>): Promise<string> {
  const unsigned = payloadWithoutMac(payload);
  const key = await importBridgeHmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(canonicalizeBridgePayload(unsigned)));
  return toBase64Url(new Uint8Array(signature));
}

export async function verifyBridgePayload(secret: Uint8Array, payload: Record<string, unknown>): Promise<boolean> {
  const mac = payload[BRIDGE_MAC_FIELD];
  if (typeof mac !== "string" || mac.length === 0) return false;
  const expected = await signBridgePayload(secret, payload);
  return timingSafeEqual(expected, mac);
}

export async function attachBridgeMac(secret: Uint8Array, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const mac = await signBridgePayload(secret, payload);
  return { ...payload, [BRIDGE_MAC_FIELD]: mac };
}

export async function verifyBridgeMessage(
  secret: Uint8Array,
  data: unknown
): Promise<Record<string, unknown> | undefined> {
  if (!isRecord(data)) return undefined;
  if (!(await verifyBridgePayload(secret, data))) return undefined;
  return payloadWithoutMac(data);
}
