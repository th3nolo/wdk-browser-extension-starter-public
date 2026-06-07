import { describe, expect, it, vi } from "vitest";
import type { BackgroundMessage } from "../background/messages";
import type { EncryptedVault } from "../crypto/vault";
import { readStore } from "../storage/store";
import { parseBackgroundMessage } from "./messages";
import { parseStoredStateInput } from "./store";
import { parseEncryptedVault } from "./vault";

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

const wallet = {
  id: "wallet-1",
  name: "Primary",
  createdAt: "2026-01-01T00:00:00.000Z",
  accountCount: 1
};

describe("parseBackgroundMessage", () => {
  it("accepts valid wallet messages", () => {
    expect(parseBackgroundMessage({ type: "GET_STATE" })).toEqual({ type: "GET_STATE" });
    expect(parseBackgroundMessage({ type: "GET_STATE_SUMMARY" })).toEqual({ type: "GET_STATE_SUMMARY" });
    expect(parseBackgroundMessage({ type: "GET_BALANCES" })).toEqual({ type: "GET_BALANCES" });
    expect(parseBackgroundMessage({
      type: "SEND",
      request: {
        walletId: "wallet-1",
        chain: "ethereum",
        asset: "ETH",
        accountIndex: 0,
        to: "0xabc",
        amount: "1"
      }
    }).type).toBe("SEND");
  });

  it("rejects malformed messages", () => {
    expect(() => parseBackgroundMessage(null)).toThrow("Invalid background message");
    expect(() => parseBackgroundMessage({ type: "LOCK", extra: true })).toThrow("Invalid background message");
    expect(() => parseBackgroundMessage({ type: "SEND", request: { walletId: "wallet-1" } })).toThrow("Invalid background message");
    expect(() => parseBackgroundMessage({ type: "UNKNOWN" })).toThrow("Invalid background message");
    expect(() => parseBackgroundMessage({
      type: "SIGN_MESSAGE",
      chain: "ethereum",
      accountIndex: 0,
      message: "bypass approval"
    })).toThrow("Invalid background message");
  });

  it("parses every BackgroundMessage type", () => {
    const sendRequest = {
      walletId: "wallet-1",
      chain: "ethereum" as const,
      asset: "ETH" as const,
      accountIndex: 0,
      to: "0xabc",
      amount: "1"
    };

    const samples: Record<BackgroundMessage["type"], BackgroundMessage> = {
      GET_STATE: { type: "GET_STATE" },
      GET_STATE_SUMMARY: { type: "GET_STATE_SUMMARY" },
      GET_BALANCES: { type: "GET_BALANCES" },
      CREATE_WALLET: { type: "CREATE_WALLET", name: "Primary", password: "secret", seedPhrase: "seed words" },
      IMPORT_WALLET: { type: "IMPORT_WALLET", name: "Imported", password: "secret", seedPhrase: "seed words" },
      UNLOCK: { type: "UNLOCK", password: "secret" },
      SWITCH_WALLET: { type: "SWITCH_WALLET", walletId: "wallet-1", password: "secret" },
      LOCK: { type: "LOCK" },
      DELETE_WALLET: { type: "DELETE_WALLET", walletId: "wallet-1", password: "secret" },
      ADD_ACCOUNT: { type: "ADD_ACCOUNT", walletId: "wallet-1" },
      REFRESH: { type: "REFRESH" },
      APPROVE_DAPP: { type: "APPROVE_DAPP", origin: "https://dapp.example", accountIndex: 0 },
      REJECT_DAPP: { type: "REJECT_DAPP", origin: "https://dapp.example" },
      REVOKE_DAPP: { type: "REVOKE_DAPP", origin: "https://dapp.example" },
      APPROVE_SIGNATURE: { type: "APPROVE_SIGNATURE", id: "sig-1" },
      REJECT_SIGNATURE: { type: "REJECT_SIGNATURE", id: "sig-1" },
      APPROVE_DAPP_TRANSACTION: { type: "APPROVE_DAPP_TRANSACTION", id: "tx-1" },
      REJECT_DAPP_TRANSACTION: { type: "REJECT_DAPP_TRANSACTION", id: "tx-1" },
      SEND: { type: "SEND", request: sendRequest },
      SET_RPC_OVERRIDE: { type: "SET_RPC_OVERRIDE", chain: "ethereum", url: "https://rpc.example" },
      OPEN_QR_SCANNER: { type: "OPEN_QR_SCANNER" },
      SUBMIT_QR_SCAN: { type: "SUBMIT_QR_SCAN", value: "0xabc" },
      TAKE_QR_SCAN: { type: "TAKE_QR_SCAN" },
      DAPP_REQUEST: { type: "DAPP_REQUEST", method: "eth_chainId", params: [] }
    };

    for (const message of Object.values(samples)) {
      expect(parseBackgroundMessage(message).type).toBe(message.type);
    }
  });
});

describe("parseEncryptedVault", () => {
  it("accepts valid vault payloads", () => {
    expect(parseEncryptedVault(vault)).toEqual(vault);
  });

  it("rejects tampered vault payloads", () => {
    expect(() => parseEncryptedVault({ ...vault, version: 2 })).toThrow("Invalid encrypted vault");
    expect(() => parseEncryptedVault({ ...vault, iterations: -1 })).toThrow("Invalid encrypted vault");
    expect(() => parseEncryptedVault({ ...vault, iterations: 599_999 })).toThrow("Invalid encrypted vault");
    expect(() => parseEncryptedVault({ ...vault, iterations: 1_000_001 })).toThrow("Invalid encrypted vault");
    expect(() => parseEncryptedVault({ ...vault, kdf: "scrypt" })).toThrow("Invalid encrypted vault");
    expect(() => parseEncryptedVault({ ...vault, cipher: "AES-128-GCM" })).toThrow("Invalid encrypted vault");
    expect(() => parseEncryptedVault({ ...vault, salt: "" })).toThrow("Invalid encrypted vault");
  });
});

describe("parseStoredStateInput", () => {
  it("returns undefined for missing or non-object storage", () => {
    expect(parseStoredStateInput(undefined)).toBeUndefined();
    expect(parseStoredStateInput(null)).toBeUndefined();
    expect(parseStoredStateInput("bad")).toBeUndefined();
    expect(parseStoredStateInput([])).toBeUndefined();
  });

  it("keeps dropped transactions when reloading persisted storage", () => {
    expect(parseStoredStateInput({
      wallets: [wallet],
      vaults: { "wallet-1": vault },
      transactions: [{
        id: "tx-dropped",
        walletId: "wallet-1",
        chain: "ethereum",
        asset: "ETH",
        from: "0xfrom",
        to: "0xto",
        amount: "1",
        status: "dropped",
        txHash: "0xhash",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T06:00:01.000Z"
      }],
      activeWalletId: "wallet-1"
    })).toEqual({
      wallets: [wallet],
      vaults: { "wallet-1": vault },
      transactions: [{
        id: "tx-dropped",
        walletId: "wallet-1",
        chain: "ethereum",
        asset: "ETH",
        from: "0xfrom",
        to: "0xto",
        amount: "1",
        status: "dropped",
        txHash: "0xhash",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T06:00:01.000Z"
      }],
      connectedSites: [],
      pendingConnections: [],
      activeWalletId: "wallet-1"
    });
  });

  it("drops invalid records while keeping valid wallet state", () => {
    expect(parseStoredStateInput({
      wallets: [wallet, { id: "", name: "Bad", createdAt: "2026-01-01T00:00:00.000Z", accountCount: 1 }],
      vaults: {
        "wallet-1": vault,
        "wallet-2": { ...vault, cipher: "AES-128-GCM" }
      },
      transactions: [{
        id: "tx-1",
        walletId: "wallet-1",
        chain: "ethereum",
        asset: "ETH",
        from: "0xfrom",
        to: "0xto",
        amount: "1",
        status: "pending",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }, { id: "tx-bad" }],
      activeWalletId: "wallet-1"
    })).toEqual({
      wallets: [wallet],
      vaults: { "wallet-1": vault },
      transactions: [{
        id: "tx-1",
        walletId: "wallet-1",
        chain: "ethereum",
        asset: "ETH",
        from: "0xfrom",
        to: "0xto",
        amount: "1",
        status: "pending",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }],
      connectedSites: [],
      pendingConnections: [],
      activeWalletId: "wallet-1"
    });
  });
});

describe("readStore integration", () => {
  it("normalizes tampered persisted storage through validators", async () => {
    vi.stubGlobal("browser", {
      storage: {
        local: {
          get: vi.fn(async () => ({
            [STORE_KEY]: {
              wallets: [wallet, { bad: true }],
              vaults: { "wallet-1": vault, bad: null },
              connectedSites: [{ origin: "https://dapp.example" }]
            }
          })),
          set: vi.fn()
        }
      }
    });

    await expect(readStore()).resolves.toEqual({
      vaults: { "wallet-1": vault },
      wallets: [wallet],
      activeWalletId: "wallet-1",
      transactions: [],
      connectedSites: [],
      pendingConnections: []
    });
  });
});
