const encoder = new TextEncoder();
const SESSION_KEY_INFO = encoder.encode("wdk-wallet-session-v1");

let swLifetimeSecret: Uint8Array | undefined;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function ensureSwLifetimeSecret(): Uint8Array {
  if (!swLifetimeSecret) {
    swLifetimeSecret = crypto.getRandomValues(new Uint8Array(32));
  }
  return swLifetimeSecret;
}

async function deriveSessionKey(keySalt: Uint8Array): Promise<Uint8Array> {
  const baseKey = await crypto.subtle.importKey("raw", asArrayBuffer(ensureSwLifetimeSecret()), "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: asArrayBuffer(keySalt),
      info: SESSION_KEY_INFO
    },
    baseKey,
    256
  );
  return new Uint8Array(bits);
}

async function importSessionKey(sessionKey: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", asArrayBuffer(sessionKey), { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export function createKeySalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16));
}

export function encodeKeySalt(keySalt: Uint8Array): string {
  return toBase64(keySalt);
}

export function decodeKeySalt(value: string): Uint8Array {
  return fromBase64(value);
}

export async function encryptSessionSeed(seedPhraseBytes: Uint8Array, keySalt: Uint8Array): Promise<{ iv: string; ciphertext: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importSessionKey(await deriveSessionKey(keySalt));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: asArrayBuffer(iv) }, key, asArrayBuffer(seedPhraseBytes));
  return { iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) };
}

export async function decryptSessionSeed(payload: { iv: string; ciphertext: string }, keySalt: Uint8Array): Promise<Uint8Array> {
  const key = await importSessionKey(await deriveSessionKey(keySalt));
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: asArrayBuffer(fromBase64(payload.iv)) },
    key,
    asArrayBuffer(fromBase64(payload.ciphertext))
  );
  return new Uint8Array(plaintext);
}

/** Test helper to simulate a service worker restart. */
export function resetSwLifetimeSecretForTests(): void {
  swLifetimeSecret = undefined;
}
