import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSession, resetSessionForTests } from "../session/session";
import type { StoredState } from "../storage/store";
import type { SendRequest, WalletRecord } from "../types";
import {
  listAccounts,
  listAllBalances,
  sendDappEvmTransaction,
  sendTransaction,
  signMessage,
  signTypedData
} from "../wdk/client";
import {
  listBalancesForWalletAccounts,
  listWalletAccounts,
  signDappSignatureForApproval,
  submitDappTransactionForApproval,
  submitSendRequest,
  validateDappTransactionForApproval
} from "./wallet-execution";

vi.mock("../wdk/client", () => ({
  listAccounts: vi.fn(async (_seedPhraseBytes: Uint8Array, walletId: string) => [
    {
      walletId,
      chain: "ethereum",
      index: 0,
      address: "0x9858EfFD232B4033E47d90003D41EC34EcaEda94",
      path: "m/44'/60'/0'/0/0"
    }
  ]),
  listAllBalances: vi.fn(async () => []),
  sendTransaction: vi.fn(async (_seedPhraseBytes: Uint8Array, request: SendRequest) => ({
    id: "tx-new",
    walletId: request.walletId,
    chain: request.chain,
    asset: request.asset,
    from: "0x9858EfFD232B4033E47d90003D41EC34EcaEda94",
    to: request.to,
    amount: request.amount,
    status: "pending",
    txHash: "0xdef",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  })),
  signMessage: vi.fn(async () => "0xsigned"),
  signTypedData: vi.fn(async () => "0xtyped"),
  sendDappEvmTransaction: vi.fn(async () => "0xtxhash")
}));

const wallet: WalletRecord = { id: "wallet-1", name: "Primary", createdAt: "2026-01-01T00:00:00.000Z", accountCount: 1 };
const store: StoredState = {
  vaults: {},
  wallets: [wallet],
  activeWalletId: wallet.id,
  transactions: [],
  connectedSites: [],
  pendingConnections: [],
  rpcOverrides: { ethereum: "https://rpc.example" }
};

beforeEach(() => {
  vi.clearAllMocks();
  resetSessionForTests();
  vi.stubGlobal("browser", {
    storage: {
      session: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => undefined),
        remove: vi.fn(async () => undefined)
      }
    }
  });
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { method: string };
    const result = body.method === "eth_getCode" ? "0x" : "0x5208";
    return { ok: true, json: async () => ({ result }) } as Response;
  }));
});

describe("wallet execution boundary", () => {
  it("does not call WDK account derivation while the wallet is locked", async () => {
    await expect(listWalletAccounts(wallet, store)).resolves.toBeUndefined();

    expect(listAccounts).not.toHaveBeenCalled();
  });

  it("routes account, balance, and popup send execution through WDK with the session context", async () => {
    await createSession(wallet.id, "test seed phrase");
    const accounts = await listWalletAccounts(wallet, store);
    await listBalancesForWalletAccounts(wallet.id, accounts ?? [], store);
    await submitSendRequest({
      walletId: wallet.id,
      chain: "ethereum",
      asset: "ETH",
      accountIndex: 0,
      to: "0x0000000000000000000000000000000000000001",
      amount: "1"
    }, store);

    expect(listAccounts).toHaveBeenCalledWith(expect.any(Uint8Array), wallet.id, 1, store.rpcOverrides);
    expect(listAllBalances).toHaveBeenCalledWith(expect.any(Uint8Array), accounts, store.rpcOverrides);
    expect(sendTransaction).toHaveBeenCalledWith(expect.any(Uint8Array), expect.objectContaining({ walletId: wallet.id }), store.rpcOverrides);
  });

  it("routes dApp signatures and transactions through WDK without exposing seed bytes to approval workflow callers", async () => {
    await createSession(wallet.id, "test seed phrase");
    const typedData = {
      domain: { chainId: 1 },
      types: { EIP712Domain: [{ name: "chainId", type: "uint256" }] },
      primaryType: "Mail",
      message: { contents: "Hello" }
    };

    await signDappSignatureForApproval(wallet.id, "ethereum", {
      signatureKind: "personal_sign",
      accountIndex: 0,
      message: "Hello",
      messageEncoding: "utf8"
    }, store);
    await signDappSignatureForApproval(wallet.id, "ethereum", {
      signatureKind: "eth_signTypedData_v4",
      accountIndex: 0,
      message: JSON.stringify(typedData),
      messageEncoding: "utf8",
      typedData
    }, store);
    await submitDappTransactionForApproval(wallet.id, "ethereum", 0, {
      to: "0x0000000000000000000000000000000000000001",
      value: 1n
    }, store);

    expect(signMessage).toHaveBeenCalledWith(expect.any(Uint8Array), "ethereum", 0, "Hello", "utf8", store.rpcOverrides);
    expect(signTypedData).toHaveBeenCalledWith(expect.any(Uint8Array), "ethereum", 0, typedData, store.rpcOverrides);
    expect(sendDappEvmTransaction).toHaveBeenCalledWith(expect.any(Uint8Array), "ethereum", 0, expect.objectContaining({ value: 1n }), store.rpcOverrides);
  });

  it("validates dApp transaction recipients with stored RPC overrides", async () => {
    await validateDappTransactionForApproval("ethereum", {
      to: "0x0000000000000000000000000000000000000001",
      value: 0n
    }, store);

    expect(fetch).toHaveBeenCalledWith("https://rpc.example", expect.objectContaining({ method: "POST" }));
  });
});
