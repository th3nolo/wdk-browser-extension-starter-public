import { generateMnemonic } from "bip39";
import { MIN_VAULT_ITERATIONS, parseEncryptedVault } from "../schemas/vault";
import { normalizeSeedPhrase, validatePassword, validateSeedPhrase } from "../validation";
import { secureZeroBytes } from "./secure-zero";

export type EncryptedVault = {
  version: 1;
  kdf: "PBKDF2-SHA256";
  cipher: "AES-256-GCM";
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
  createdAt: string;
};

const ITERATIONS = MIN_VAULT_ITERATIONS;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
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

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: asArrayBuffer(salt), iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export function createSeedPhrase(): string {
  return generateMnemonic(256);
}

export async function encryptSeedPhrase(seedPhrase: string, password: string): Promise<EncryptedVault> {
  const normalized = normalizeSeedPhrase(seedPhrase);
  if (!validateSeedPhrase(normalized)) throw new Error("Invalid BIP-39 seed phrase");
  if (!validatePassword(password)) throw new Error("Password must be at least 12 characters with sufficient strength");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, ITERATIONS);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: asArrayBuffer(iv) }, key, encoder.encode(normalized));
  return {
    version: 1,
    kdf: "PBKDF2-SHA256",
    cipher: "AES-256-GCM",
    iterations: ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertext),
    createdAt: new Date().toISOString()
  };
}

export async function decryptSeedPhraseBytes(vault: EncryptedVault, password: string): Promise<Uint8Array> {
  const validated = parseEncryptedVault(vault);
  const key = await deriveKey(password, fromBase64(validated.salt), validated.iterations);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: asArrayBuffer(fromBase64(validated.iv)) }, key, asArrayBuffer(fromBase64(validated.ciphertext)));
  const seedPhraseBytes = new Uint8Array(plaintext);
  const seedPhrase = decoder.decode(seedPhraseBytes);
  if (!validateSeedPhrase(seedPhrase)) {
    secureZeroBytes(seedPhraseBytes);
    throw new Error("Vault decrypted but seed phrase failed validation");
  }
  return seedPhraseBytes;
}

export async function decryptSeedPhrase(vault: EncryptedVault, password: string): Promise<string> {
  const seedPhraseBytes = await decryptSeedPhraseBytes(vault, password);
  try {
    return decoder.decode(seedPhraseBytes);
  } finally {
    secureZeroBytes(seedPhraseBytes);
  }
}
