import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_STORAGE_KEY } from "./session";
import {
  initSession,
  createSession,
  getSession,
  peekSession,
  sessionExpiresAt,
  clearSession,
  resetSessionForTests,
  resetServiceWorkerForTests
} from "./session";

let sessionStorage: Record<string, unknown> = {};

beforeEach(() => {
  sessionStorage = {};
  resetSessionForTests();
  vi.stubGlobal("browser", {
    storage: {
      session: {
        get: vi.fn(async (key?: string | string[] | Record<string, unknown> | null) => {
          if (typeof key === "string") return { [key]: sessionStorage[key] };
          return { ...sessionStorage };
        }),
        set: vi.fn(async (items: Record<string, unknown>) => {
          Object.assign(sessionStorage, items);
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete sessionStorage[key];
        })
      }
    }
  });
});

afterEach(() => {
  vi.useRealTimers();
  void clearSession();
  resetSessionForTests();
});

describe("wallet session", () => {
  it("extends session expiry when the unlocked wallet is used", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    await createSession("wallet-1", "test seed phrase", 1_000);

    vi.setSystemTime(new Date("2026-01-01T00:00:00.500Z"));
    expect(new TextDecoder().decode(getSession()!.seedPhraseBytes)).toBe("test seed phrase");

    expect(sessionExpiresAt("wallet-1")).toBe("2026-01-01T00:00:01.500Z");
    expect(sessionStorage[SESSION_STORAGE_KEY]).toBeTruthy();
  });

  it("clears seed material when peekSession finds an expired session", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const active = await createSession("wallet-1", "test seed phrase", 1_000);

    vi.setSystemTime(new Date("2026-01-01T00:00:01.001Z"));

    expect(peekSession()).toBeUndefined();
    expectSeedBytesZeroed(active);
    await flushPromises();
    expect(sessionStorage[SESSION_STORAGE_KEY]).toBeUndefined();
  });

  it("clears seed material after idle timeout", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const active = await createSession("wallet-1", "test seed phrase", 1_000);

    vi.setSystemTime(new Date("2026-01-01T00:00:01.001Z"));

    expect(getSession()).toBeUndefined();
    expectSeedBytesZeroed(active);
    expect(peekSession()).toBeUndefined();
    await flushPromises();
    expect(sessionStorage[SESSION_STORAGE_KEY]).toBeUndefined();
  });

  it("restores an unlocked session within the same service worker lifetime", async () => {
    await createSession("wallet-1", "test seed phrase", 10_000);
    resetSessionForTests();
    sessionStorage = { ...sessionStorage };

    await initSession();

    expect(peekSession()?.walletId).toBe("wallet-1");
    expect(new TextDecoder().decode(getSession()!.seedPhraseBytes)).toBe("test seed phrase");
  });

  it("does not restore session after service worker restart", async () => {
    await createSession("wallet-1", "test seed phrase", 10_000);
    const persisted = sessionStorage[SESSION_STORAGE_KEY];
    resetServiceWorkerForTests();
    sessionStorage = { [SESSION_STORAGE_KEY]: persisted };

    await initSession();

    expect(peekSession()).toBeUndefined();
    expect(sessionStorage[SESSION_STORAGE_KEY]).toBeUndefined();
  });

  it("does not persist the encryption key alongside ciphertext", async () => {
    await createSession("wallet-1", "test seed phrase", 10_000);

    const persisted = sessionStorage[SESSION_STORAGE_KEY] as Record<string, unknown>;
    expect(persisted.keySalt).toBeTruthy();
    expect(persisted.iv).toBeTruthy();
    expect(persisted.ciphertext).toBeTruthy();
    expect(persisted).not.toHaveProperty("sessionKey");
  });

  it("does not restore an expired persisted session", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    await createSession("wallet-1", "test seed phrase", 1_000);
    resetSessionForTests();
    sessionStorage = { ...sessionStorage };
    vi.setSystemTime(new Date("2026-01-01T00:00:02.000Z"));

    await initSession();

    expect(peekSession()).toBeUndefined();
    expect(sessionStorage[SESSION_STORAGE_KEY]).toBeUndefined();
  });
});

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function expectSeedBytesZeroed(session: { seedPhraseBytes: Uint8Array }): void {
  expect([...session.seedPhraseBytes].every((byte) => byte === 0)).toBe(true);
}
