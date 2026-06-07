import { clearWdkRuntimeCache } from "../wdk/runtime-cache";
import { secureZeroBytes } from "../crypto/secure-zero";
import { createKeySalt, decodeKeySalt, decryptSessionSeed, encodeKeySalt, encryptSessionSeed, resetSwLifetimeSecretForTests } from "./session-crypto";

export const SESSION_STORAGE_KEY = "wdk-wallet-session";
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const encoder = new TextEncoder();

export type WalletSession = {
  walletId: string;
  seedPhraseBytes: Uint8Array;
  unlockedAt: number;
  lastUsedAt: number;
  timeoutMs: number;
};

type PersistedWalletSession = {
  walletId: string;
  unlockedAt: number;
  lastUsedAt: number;
  timeoutMs: number;
  keySalt: string;
  iv: string;
  ciphertext: string;
};

let session: WalletSession | undefined;
let initPromise: Promise<void> | undefined;

function isExpired(entry: Pick<WalletSession, "lastUsedAt" | "timeoutMs">, now = Date.now()): boolean {
  return now - entry.lastUsedAt > entry.timeoutMs;
}

async function readPersistedSession(): Promise<PersistedWalletSession | undefined> {
  const item = await browser.storage.session.get(SESSION_STORAGE_KEY);
  return item[SESSION_STORAGE_KEY] as PersistedWalletSession | undefined;
}

async function writePersistedSession(entry: PersistedWalletSession): Promise<void> {
  await browser.storage.session.set({ [SESSION_STORAGE_KEY]: entry });
}

async function removePersistedSession(): Promise<void> {
  await browser.storage.session.remove(SESSION_STORAGE_KEY);
}

async function persistSession(active: WalletSession): Promise<void> {
  const keySalt = createKeySalt();
  const encrypted = await encryptSessionSeed(active.seedPhraseBytes, keySalt);
  await writePersistedSession({
    walletId: active.walletId,
    unlockedAt: active.unlockedAt,
    lastUsedAt: active.lastUsedAt,
    timeoutMs: active.timeoutMs,
    keySalt: encodeKeySalt(keySalt),
    iv: encrypted.iv,
    ciphertext: encrypted.ciphertext
  });
}

async function restoreFromStorage(): Promise<void> {
  const persisted = await readPersistedSession();
  if (!persisted) return;
  if (isExpired(persisted)) {
    await removePersistedSession();
    return;
  }

  try {
    const seedPhraseBytes = await decryptSessionSeed({ iv: persisted.iv, ciphertext: persisted.ciphertext }, decodeKeySalt(persisted.keySalt));
    session = {
      walletId: persisted.walletId,
      seedPhraseBytes,
      unlockedAt: persisted.unlockedAt,
      lastUsedAt: persisted.lastUsedAt,
      timeoutMs: persisted.timeoutMs
    };
  } catch {
    await removePersistedSession();
  }
}

export async function initSession(): Promise<void> {
  if (!initPromise) {
    initPromise = restoreFromStorage();
  }
  await initPromise;
}

export async function createSession(walletId: string, seedPhrase: string | Uint8Array, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<WalletSession> {
  await initSession();
  if (session) secureZeroBytes(session.seedPhraseBytes);
  await clearWdkRuntimeCache();
  const seedPhraseBytes = typeof seedPhrase === "string" ? encoder.encode(seedPhrase) : seedPhrase;
  session = { walletId, seedPhraseBytes, unlockedAt: Date.now(), lastUsedAt: Date.now(), timeoutMs };
  await persistSession(session);
  return session;
}

export function getSession(): WalletSession | undefined {
  if (!session) return undefined;
  if (isExpired(session)) {
    void clearSession();
    return undefined;
  }
  session.lastUsedAt = Date.now();
  void touchPersistedSession();
  return session;
}

async function touchPersistedSession(): Promise<void> {
  if (!session) return;
  const persisted = await readPersistedSession();
  if (!persisted || persisted.walletId !== session.walletId) return;
  await writePersistedSession({ ...persisted, lastUsedAt: session.lastUsedAt });
}

export function peekSession(): WalletSession | undefined {
  if (!session) return undefined;
  if (isExpired(session)) {
    void clearSession();
    return undefined;
  }
  return session;
}

export async function clearSession(): Promise<void> {
  if (session) secureZeroBytes(session.seedPhraseBytes);
  session = undefined;
  await clearWdkRuntimeCache();
  await removePersistedSession();
}

export function sessionExpiresAt(walletId?: string): string | undefined {
  if (!session || (walletId && session.walletId !== walletId)) return undefined;
  if (isExpired(session)) return undefined;
  return new Date(session.lastUsedAt + session.timeoutMs).toISOString();
}

export async function expireIdleSession(): Promise<void> {
  await initSession();
  if (!session) return;
  if (isExpired(session)) {
    await clearSession();
  }
}

/** Test helper to reset in-memory session state without simulating a service worker restart. */
export function resetSessionForTests(): void {
  if (session) secureZeroBytes(session.seedPhraseBytes);
  session = undefined;
  initPromise = undefined;
}

/** Test helper to simulate a full service worker restart. */
export function resetServiceWorkerForTests(): void {
  resetSessionForTests();
  resetSwLifetimeSecretForTests();
}
