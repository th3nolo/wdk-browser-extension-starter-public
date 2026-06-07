import { describe, expect, it, vi } from "vitest";
import { encryptSeedPhrase } from "../crypto/vault";
import { createSession } from "../session/session";
import { createBackgroundWalletController } from "./controller";
import { createControllerTestHarness, POPUP_SENDER } from "./controller-test-harness";
import { listBalancesForWalletAccounts, listWalletAccounts, submitSendRequest } from "./wallet-execution";
import type { PopupState } from "../types";

vi.mock("./wallet-execution", () => ({
  connectedAccountForWallet: vi.fn(),
  listBalancesForWalletAccounts: vi.fn(),
  listWalletAccounts: vi.fn(),
  prepareDappTransactionForApproval: vi.fn(),
  signDappSignatureForApproval: vi.fn(),
  submitDappTransactionForApproval: vi.fn(),
  submitSendRequest: vi.fn(),
  validateDappTransactionForApproval: vi.fn()
}));

const harness = createControllerTestHarness();

describe("background wallet controller - state and wallet commands", () => {
  it("loads balances for every account index, not just account 0", async () => {
    harness.persisted = {
      ...harness.persisted,
      wallets: [{ id: "wallet-1", name: "Primary", createdAt: "2026-01-01T00:00:00.000Z", accountCount: 2 }],
      activeWalletId: "wallet-1"
    };
    await createSession("wallet-1", "test seed phrase");
    vi.mocked(listWalletAccounts).mockResolvedValue([
      {
        walletId: "wallet-1",
        chain: "ethereum",
        index: 0,
        address: "0x9858EfFD232B4033E47d90003D41EC34EcaEda94",
        path: "m/44'/60'/0'/0/0"
      },
      {
        walletId: "wallet-1",
        chain: "ethereum",
        index: 1,
        address: "0x0000000000000000000000000000000000000002",
        path: "m/44'/60'/0'/0/1"
      }
    ]);
    vi.mocked(listBalancesForWalletAccounts).mockImplementation(async (_walletId, accounts) =>
      accounts.map((account) => ({
        chain: account.chain,
        asset: "ETH" as const,
        amount: account.index === 0 ? "1000000000000000000" : "2000000000000000000",
        symbol: "ETH",
        decimals: 18
      }))
    );
    const controller = createBackgroundWalletController();

    const state = await controller.handleMessage({ type: "GET_STATE" }, POPUP_SENDER) as PopupState;

    expect(listBalancesForWalletAccounts).toHaveBeenCalledTimes(1);
    expect(state.balances).toEqual([{
      chain: "ethereum",
      asset: "ETH",
      amount: "3000000000000000000",
      symbol: "ETH",
      decimals: 18
    }]);
  });

  it("returns summary state without fetching balances", async () => {
    harness.persisted = {
      ...harness.persisted,
      wallets: [{ id: "wallet-1", name: "Primary", createdAt: "2026-01-01T00:00:00.000Z", accountCount: 1 }],
      activeWalletId: "wallet-1"
    };
    await createSession("wallet-1", "test seed phrase");
    const controller = createBackgroundWalletController();

    const state = await controller.handleMessage({ type: "GET_STATE_SUMMARY" }, POPUP_SENDER) as PopupState;

    expect(listWalletAccounts).toHaveBeenCalledTimes(1);
    expect(listBalancesForWalletAccounts).not.toHaveBeenCalled();
    expect(state.accounts).toHaveLength(1);
    expect(state.balances).toBeUndefined();
  });

  it("loads balances on demand via GET_BALANCES", async () => {
    harness.persisted = {
      ...harness.persisted,
      wallets: [{ id: "wallet-1", name: "Primary", createdAt: "2026-01-01T00:00:00.000Z", accountCount: 1 }],
      activeWalletId: "wallet-1"
    };
    await createSession("wallet-1", "test seed phrase");
    vi.mocked(listBalancesForWalletAccounts).mockResolvedValue([{
      chain: "ethereum",
      asset: "ETH",
      amount: "1000000000000000000",
      symbol: "ETH",
      decimals: 18
    }]);
    const controller = createBackgroundWalletController();

    const balances = await controller.handleMessage({ type: "GET_BALANCES" }, POPUP_SENDER);

    expect(listBalancesForWalletAccounts).toHaveBeenCalledTimes(1);
    expect(balances).toEqual([{
      chain: "ethereum",
      asset: "ETH",
      amount: "1000000000000000000",
      symbol: "ETH",
      decimals: 18
    }]);
  });

  it("rejects short passwords at the background authority layer", async () => {
    const controller = createBackgroundWalletController();

    await expect(controller.handleMessage({ type: "CREATE_WALLET", name: "Primary", password: "too-short", seedPhrase: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about" }, POPUP_SENDER)).rejects.toThrow("Password must be at least 12 characters with sufficient strength");
    expect(harness.persisted.wallets).toHaveLength(0);
    expect(Object.keys(harness.persisted.vaults)).toHaveLength(0);
  });

  it("switches between encrypted wallets only with the selected wallet password", async () => {
    harness.persisted = {
      ...harness.persisted,
      vaults: {
        "wallet-1": await encryptSeedPhrase("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about", "primary wallet password"),
        "wallet-2": await encryptSeedPhrase("legal winner thank year wave sausage worth useful legal winner thank yellow", "second wallet password")
      },
      wallets: [
        { id: "wallet-1", name: "Primary", createdAt: "2026-01-01T00:00:00.000Z", accountCount: 1 },
        { id: "wallet-2", name: "Second", createdAt: "2026-01-01T00:01:00.000Z", accountCount: 1 }
      ],
      activeWalletId: "wallet-1"
    };
    await createSession("wallet-1", "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about");
    const controller = createBackgroundWalletController();

    await expect(controller.handleMessage({ type: "SWITCH_WALLET", walletId: "wallet-2", password: "primary wallet password" }, POPUP_SENDER)).rejects.toThrow();
    expect(harness.persisted.activeWalletId).toBe("wallet-1");

    const state = await controller.handleMessage({ type: "SWITCH_WALLET", walletId: "wallet-2", password: "second wallet password" }, POPUP_SENDER) as PopupState;

    expect(state.locked).toBe(false);
    expect(state.activeWalletId).toBe("wallet-2");
    expect(harness.persisted.activeWalletId).toBe("wallet-2");
    expect(state.accounts).toEqual([expect.objectContaining({ walletId: "wallet-2" })]);
  });

  it("rejects invalid send requests before calling WDK", async () => {
    harness.persisted = {
      ...harness.persisted,
      wallets: [{ id: "wallet-1", name: "Primary", createdAt: "2026-01-01T00:00:00.000Z", accountCount: 1 }],
      activeWalletId: "wallet-1"
    };
    await createSession("wallet-1", "test seed phrase");
    const controller = createBackgroundWalletController();

    await expect(controller.handleMessage({
      type: "SEND",
      request: {
        walletId: "wallet-1",
        chain: "ethereum",
        asset: "ETH",
        accountIndex: 0,
        to: "not-an-address",
        amount: "1"
      }
    }, POPUP_SENDER)).rejects.toThrow("Invalid recipient address for selected network");

    expect(submitSendRequest).not.toHaveBeenCalled();
    expect(harness.persisted.transactions).toHaveLength(1);
  });

  it("rejects unavailable wallet accounts before calling WDK", async () => {
    harness.persisted = {
      ...harness.persisted,
      wallets: [{ id: "wallet-1", name: "Primary", createdAt: "2026-01-01T00:00:00.000Z", accountCount: 1 }],
      activeWalletId: "wallet-1"
    };
    await createSession("wallet-1", "test seed phrase");
    const controller = createBackgroundWalletController();

    await expect(controller.handleMessage({
      type: "SEND",
      request: {
        walletId: "wallet-1",
        chain: "ethereum",
        asset: "ETH",
        accountIndex: 4,
        to: "0x0000000000000000000000000000000000000001",
        amount: "1"
      }
    }, POPUP_SENDER)).rejects.toThrow("Selected account is not available for this wallet");

    expect(submitSendRequest).not.toHaveBeenCalled();
  });

  it("persists a pending transaction after a valid WDK send", async () => {
    harness.persisted = {
      ...harness.persisted,
      wallets: [{ id: "wallet-1", name: "Primary", createdAt: "2026-01-01T00:00:00.000Z", accountCount: 1 }],
      activeWalletId: "wallet-1"
    };
    await createSession("wallet-1", "test seed phrase");
    vi.mocked(submitSendRequest).mockResolvedValueOnce({
      id: "tx-new",
      walletId: "wallet-1",
      chain: "ethereum",
      asset: "ETH",
      from: "0x9858EfFD232B4033E47d90003D41EC34EcaEda94",
      to: "0x0000000000000000000000000000000000000001",
      amount: "1",
      status: "pending",
      txHash: "0xdef",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    const request = {
      walletId: "wallet-1",
      chain: "ethereum" as const,
      asset: "ETH" as const,
      accountIndex: 0,
      to: "0x0000000000000000000000000000000000000001",
      amount: "1"
    };
    const controller = createBackgroundWalletController();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ result: null })
    } as Response);

    const state = await controller.handleMessage({ type: "SEND", request }, POPUP_SENDER) as PopupState;

    expect(submitSendRequest).toHaveBeenCalledWith(request, expect.objectContaining({ activeWalletId: "wallet-1" }));
    expect(harness.persisted.transactions).toHaveLength(2);
    expect(harness.persisted.transactions[0]).toMatchObject({ id: "tx-new", status: "pending", txHash: "0xdef" });
    expect(state.transactions[0]).toMatchObject({ id: "tx-new", status: "pending", txHash: "0xdef" });
  });

  it("refreshes pending transaction status from the background alarm path", async () => {
    const controller = createBackgroundWalletController();

    await controller.refreshPendingTransactions();

    expect(harness.persisted.transactions[0]).toMatchObject({
      id: "tx-pending",
      status: "confirmed"
    });
    expect(harness.persisted.transactions[0].updatedAt).not.toBe("2026-01-01T00:00:00.000Z");
  });
});
