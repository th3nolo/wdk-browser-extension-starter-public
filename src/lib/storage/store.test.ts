import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EncryptedVault } from "../crypto/vault";
import { readStore, updateStore, writeStore, type ParsedStoredState, type StoredState } from "./store";

const STORE_KEY = "wdk-wallet-state";

const vault: EncryptedVault = {
  version: 1,
  kdf: "PBKDF2-SHA256",
  cipher: "AES-256-GCM",
  iterations: 600_000,
  salt: "salt",
  iv: "iv",
  ciphertext: "ciphertext",
  createdAt: "2026-01-01T00:00:00.000Z"
};

let persisted: Record<string, unknown>;

beforeEach(() => {
  persisted = {};
  vi.stubGlobal("browser", {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: persisted[key] })),
        set: vi.fn(async (next: Record<string, unknown>) => {
          persisted = { ...persisted, ...next };
        })
      }
    }
  });
});

describe("extension storage store", () => {
  it("normalizes empty storage into the default wallet state", async () => {
    await expect(readStore()).resolves.toEqual({
      vaults: {},
      wallets: [],
      activeWalletId: undefined,
      transactions: [],
      connectedSites: [],
      pendingConnections: []
    });
  });

  it("migrates legacy single-vault storage into the active wallet vault map", async () => {
    persisted[STORE_KEY] = {
      vault,
      wallets: [{ id: "wallet-1", name: "Primary", createdAt: "2026-01-01T00:00:00.000Z", accountCount: 1 }]
    } satisfies ParsedStoredState;

    const state = await readStore();

    expect(state.activeWalletId).toBe("wallet-1");
    expect(state.vaults).toEqual({ "wallet-1": vault });
  });

  it("drops the legacy vault field when writing normalized storage", async () => {
    await writeStore(({
      vault,
      vaults: { "wallet-1": vault },
      wallets: [{ id: "wallet-1", name: "Primary", createdAt: "2026-01-01T00:00:00.000Z", accountCount: 1 }],
      activeWalletId: "wallet-1",
      transactions: [],
      connectedSites: [],
      pendingConnections: []
    }) as StoredState);

    expect((persisted[STORE_KEY] as Record<string, unknown>).vault).toBeUndefined();
    expect((persisted[STORE_KEY] as StoredState).vaults).toEqual({ "wallet-1": vault });
  });

  it("does not re-persist legacy vault after read/write normalization", async () => {
    persisted[STORE_KEY] = {
      vault,
      wallets: [{ id: "wallet-1", name: "Primary", createdAt: "2026-01-01T00:00:00.000Z", accountCount: 1 }]
    } satisfies ParsedStoredState;

    await writeStore(await readStore());

    expect((persisted[STORE_KEY] as Record<string, unknown>).vault).toBeUndefined();
    expect((persisted[STORE_KEY] as StoredState).vaults).toEqual({ "wallet-1": vault });
  });

  it("persists async updates against the normalized current state", async () => {
    persisted[STORE_KEY] = {
      wallets: [{ id: "wallet-1", name: "Primary", createdAt: "2026-01-01T00:00:00.000Z", accountCount: 1 }]
    } satisfies Partial<StoredState>;

    const next = await updateStore(async (state) => ({
      ...state,
      connectedSites: [{ origin: "https://dapp.example", walletId: state.activeWalletId!, accountIndex: 0, evmChainId: 1, connectedAt: "2026-01-01T00:00:00.000Z", lastUsedAt: "2026-01-01T00:00:00.000Z" }]
    }));

    expect(next.activeWalletId).toBe("wallet-1");
    expect((persisted[STORE_KEY] as StoredState).connectedSites).toHaveLength(1);
  });

  it("serializes concurrent updates so mutations are not lost", async () => {
    persisted[STORE_KEY] = {
      wallets: [{ id: "wallet-1", name: "Primary", createdAt: "2026-01-01T00:00:00.000Z", accountCount: 1 }],
      transactions: []
    } satisfies Partial<StoredState>;

    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const tx = (id: string) => ({
      id,
      walletId: "wallet-1",
      chain: "ethereum" as const,
      asset: "ETH" as const,
      from: "0xfrom",
      to: "0xto",
      amount: "1",
      status: "pending" as const,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });

    await Promise.all([
      updateStore(async (state) => {
        await delay(10);
        return { ...state, transactions: [...state.transactions, tx("tx-1")] };
      }),
      updateStore((state) => ({ ...state, transactions: [...state.transactions, tx("tx-2")] }))
    ]);

    const ids = ((persisted[STORE_KEY] as StoredState).transactions ?? []).map((record) => record.id).sort();
    expect(ids).toEqual(["tx-1", "tx-2"]);
  });
});
