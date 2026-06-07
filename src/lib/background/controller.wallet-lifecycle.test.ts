import { describe, expect, it, vi } from "vitest";
import { encryptSeedPhrase } from "../crypto/vault";
import { createSession } from "../session/session";
import { DAPP_PROVIDER_EVENT_MESSAGE } from "./dapp-provider-events";
import { createBackgroundWalletController } from "./controller";
import { PROVIDER_RPC_ERROR_CODES } from "../provider/errors";
import { createControllerTestHarness, dappSender, POPUP_SENDER } from "./controller-test-harness";
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

describe("background wallet controller - wallet lifecycle and sender trust", () => {
  it("deletes a wallet vault after password confirmation and notifies connected dApps", async () => {
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
      activeWalletId: "wallet-1",
      transactions: [{
        id: "tx-wallet-1",
        walletId: "wallet-1",
        chain: "ethereum",
        asset: "ETH",
        from: "0x9858EfFD232B4033E47d90003D41EC34EcaEda94",
        to: "0x0000000000000000000000000000000000000001",
        amount: "1",
        status: "pending",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }],
      connectedSites: [{ origin: "https://dapp.example", walletId: "wallet-1", accountIndex: 0, evmChainId: 1, connectedAt: "2026-01-01T00:00:00.000Z", lastUsedAt: "2026-01-01T00:00:00.000Z" }]
    };
    await createSession("wallet-1", "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about");
    const controller = createBackgroundWalletController();
    await expect(controller.handleMessage({
      type: "DAPP_REQUEST",
      method: "eth_accounts"
    }, dappSender("https://dapp.example/path"))).resolves.toEqual(["0x9858EfFD232B4033E47d90003D41EC34EcaEda94"]);

    await expect(controller.handleMessage({
      type: "DELETE_WALLET",
      walletId: "wallet-1",
      password: "wrong password"
    }, POPUP_SENDER)).rejects.toThrow();

    const state = await controller.handleMessage({
      type: "DELETE_WALLET",
      walletId: "wallet-1",
      password: "primary wallet password"
    }, POPUP_SENDER) as PopupState;

    expect(state.wallets).toEqual([expect.objectContaining({ id: "wallet-2" })]);
    expect(state.activeWalletId).toBe("wallet-2");
    expect(state.hasVault).toBe(true);
    expect(state.locked).toBe(true);
    expect(harness.persisted.vaults["wallet-1"]).toBeUndefined();
    expect(harness.persisted.transactions).toHaveLength(0);
    expect(harness.persisted.connectedSites).toHaveLength(0);
    expect(harness.tabsSendMessage).toHaveBeenCalledWith(1, {
      type: DAPP_PROVIDER_EVENT_MESSAGE,
      event: "accountsChanged",
      accounts: []
    }, {});
    expect(harness.tabsSendMessage).toHaveBeenCalledWith(1, {
      type: DAPP_PROVIDER_EVENT_MESSAGE,
      event: "disconnect",
      error: { code: PROVIDER_RPC_ERROR_CODES.DISCONNECTED, message: "Wallet disconnected from site" }
    }, {});
  });

  it("uses the sender tab URL for dApp origin instead of a spoofed value", async () => {
    harness.persisted = {
      ...harness.persisted,
      wallets: [{ id: "wallet-1", name: "Primary", createdAt: "2026-01-01T00:00:00.000Z", accountCount: 1 }],
      activeWalletId: "wallet-1",
      connectedSites: [{ origin: "https://trusted.example", walletId: "wallet-1", accountIndex: 0, evmChainId: 1, connectedAt: "2026-01-01T00:00:00.000Z", lastUsedAt: "2026-01-01T00:00:00.000Z" }]
    };
    await createSession("wallet-1", "test seed phrase");
    const controller = createBackgroundWalletController();

    await expect(controller.handleMessage({
      type: "DAPP_REQUEST",
      method: "eth_accounts"
    }, dappSender("https://untrusted.example/page"))).resolves.toEqual([]);
    await expect(controller.handleMessage({
      type: "DAPP_REQUEST",
      method: "eth_accounts"
    }, dappSender("https://trusted.example/app"))).resolves.toEqual(["0x9858EfFD232B4033E47d90003D41EC34EcaEda94"]);
  });
});
