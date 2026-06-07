import { describe, expect, it, vi } from "vitest";
import { createSession, resetSessionForTests } from "../session/session";
import { resetPendingSignaturesForTests } from "./pending-signatures";
import { DAPP_PROVIDER_EVENT_MESSAGE } from "./dapp-provider-events";
import { createBackgroundWalletController } from "./controller";
import { PROVIDER_RPC_ERROR_CODES } from "../provider/errors";
import { createControllerTestHarness, dappSender, POPUP_SENDER } from "./controller-test-harness";
import { signDappSignatureForApproval, submitSendRequest } from "./wallet-execution";
import type { BackgroundMessage } from "./messages";
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

describe("background wallet controller - signature approvals", () => {
  it("holds personal_sign until the popup approves the signature request", async () => {
    harness.persisted = {
      ...harness.persisted,
      wallets: [{ id: "wallet-1", name: "Primary", createdAt: "2026-01-01T00:00:00.000Z", accountCount: 1 }],
      activeWalletId: "wallet-1",
      connectedSites: [{ origin: "https://dapp.example", walletId: "wallet-1", accountIndex: 0, evmChainId: 1, connectedAt: "2026-01-01T00:00:00.000Z", lastUsedAt: "2026-01-01T00:00:00.000Z" }]
    };
    await createSession("wallet-1", "test seed phrase");
    const controller = createBackgroundWalletController();

    const signature = controller.handleMessage({
      type: "DAPP_REQUEST",
      method: "personal_sign",
      params: ["Sign in to WDK demo", "0x9858EfFD232B4033E47d90003D41EC34EcaEda94"]
    }, dappSender("https://dapp.example")) as Promise<string>;

    const state = await waitForPendingSignature(controller);
    expect(state.pendingSignatures).toHaveLength(1);
    expect(state.pendingSignatures[0]).toMatchObject({ origin: "https://dapp.example", message: "Sign in to WDK demo" });

    await controller.handleMessage({ type: "APPROVE_SIGNATURE", id: state.pendingSignatures[0].id }, POPUP_SENDER);

    await expect(signature).resolves.toBe("0xsigned");
  });

  it("keeps the wallet unlocked after service worker restart", async () => {
    harness.persisted = {
      ...harness.persisted,
      wallets: [{ id: "wallet-1", name: "Primary", createdAt: "2026-01-01T00:00:00.000Z", accountCount: 1 }],
      activeWalletId: "wallet-1"
    };
    await createSession("wallet-1", "test seed phrase");
    resetSessionForTests();

    const controller = createBackgroundWalletController();
    const state = await controller.handleMessage({ type: "GET_STATE" }, POPUP_SENDER) as PopupState;

    expect(state.locked).toBe(false);
    expect(state.accounts).toHaveLength(1);
  });

  it("restores pending signature requests after service worker restart", async () => {
    harness.persisted = {
      ...harness.persisted,
      wallets: [{ id: "wallet-1", name: "Primary", createdAt: "2026-01-01T00:00:00.000Z", accountCount: 1 }],
      activeWalletId: "wallet-1",
      connectedSites: [{ origin: "https://dapp.example", walletId: "wallet-1", accountIndex: 0, evmChainId: 1, connectedAt: "2026-01-01T00:00:00.000Z", lastUsedAt: "2026-01-01T00:00:00.000Z" }]
    };
    await createSession("wallet-1", "test seed phrase");
    const firstController = createBackgroundWalletController();
    void firstController.handleMessage({
      type: "DAPP_REQUEST",
      method: "personal_sign",
      params: ["Sign in to WDK demo", "0x9858EfFD232B4033E47d90003D41EC34EcaEda94"]
    }, dappSender("https://dapp.example"));
    await waitForPendingSignature(firstController);

    resetSessionForTests();
    resetPendingSignaturesForTests();

    const controller = createBackgroundWalletController();
    const state = await controller.handleMessage({ type: "GET_STATE" }, POPUP_SENDER) as PopupState;

    expect(state.pendingSignatures).toHaveLength(1);
    expect(state.pendingSignatures[0]).toMatchObject({ message: "Sign in to WDK demo" });
  });

  it("delivers personal_sign to the dApp after service worker restart and popup approval", async () => {
    harness.persisted = {
      ...harness.persisted,
      wallets: [{ id: "wallet-1", name: "Primary", createdAt: "2026-01-01T00:00:00.000Z", accountCount: 1 }],
      activeWalletId: "wallet-1",
      connectedSites: [{ origin: "https://dapp.example", walletId: "wallet-1", accountIndex: 0, evmChainId: 1, connectedAt: "2026-01-01T00:00:00.000Z", lastUsedAt: "2026-01-01T00:00:00.000Z" }]
    };
    await createSession("wallet-1", "test seed phrase");
    const firstController = createBackgroundWalletController();
    void firstController.handleMessage({
      type: "DAPP_REQUEST",
      method: "personal_sign",
      params: ["Sign in to WDK demo", "0x9858EfFD232B4033E47d90003D41EC34EcaEda94"]
    }, dappSender("https://dapp.example"));
    await waitForPendingSignature(firstController);

    resetSessionForTests();
    resetPendingSignaturesForTests();

    const controller = createBackgroundWalletController();
    const state = await controller.handleMessage({ type: "GET_STATE" }, POPUP_SENDER) as PopupState;
    expect(state.pendingSignatures).toHaveLength(1);

    await controller.handleMessage({ type: "APPROVE_SIGNATURE", id: state.pendingSignatures[0].id }, POPUP_SENDER);

    const signature = controller.handleMessage({
      type: "DAPP_REQUEST",
      method: "personal_sign",
      params: ["Sign in to WDK demo", "0x9858EfFD232B4033E47d90003D41EC34EcaEda94"]
    }, dappSender("https://dapp.example")) as Promise<string>;

    await expect(signature).resolves.toBe("0xsigned");
  });

  it("cancels pending signature requests when the wallet locks", async () => {
    harness.persisted = {
      ...harness.persisted,
      wallets: [{ id: "wallet-1", name: "Primary", createdAt: "2026-01-01T00:00:00.000Z", accountCount: 1 }],
      activeWalletId: "wallet-1",
      connectedSites: [{ origin: "https://dapp.example", walletId: "wallet-1", accountIndex: 0, evmChainId: 1, connectedAt: "2026-01-01T00:00:00.000Z", lastUsedAt: "2026-01-01T00:00:00.000Z" }]
    };
    await createSession("wallet-1", "test seed phrase");
    const controller = createBackgroundWalletController();

    const signature = controller.handleMessage({
      type: "DAPP_REQUEST",
      method: "personal_sign",
      params: ["Sign in to WDK demo", "0x9858EfFD232B4033E47d90003D41EC34EcaEda94"]
    }, dappSender("https://dapp.example")) as Promise<string>;

    const state = await waitForPendingSignature(controller);
    expect(state.pendingSignatures).toHaveLength(1);

    const lockedState = await controller.handleMessage({ type: "LOCK" }, POPUP_SENDER) as PopupState;

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
    expect(lockedState.locked).toBe(true);
    expect(lockedState.pendingSignatures).toHaveLength(0);
    await expect(signature).rejects.toThrow("Signature request cancelled");
  });

  it("rejects privileged messages from content script senders", async () => {
    harness.persisted = {
      ...harness.persisted,
      wallets: [{ id: "wallet-1", name: "Primary", createdAt: "2026-01-01T00:00:00.000Z", accountCount: 1 }],
      activeWalletId: "wallet-1"
    };
    await createSession("wallet-1", "test seed phrase");
    const controller = createBackgroundWalletController();
    const sender = dappSender("https://evil.example");
    const legacySignMessage = {
      type: "SIGN_MESSAGE",
      chain: "ethereum",
      accountIndex: 0,
      message: "bypass approval"
    } as unknown as BackgroundMessage;

    await expect(controller.handleMessage({ type: "LOCK" }, sender)).rejects.toThrow("Unauthorized message sender");
    await expect(controller.handleMessage({
      type: "SEND",
      request: {
        walletId: "wallet-1",
        chain: "ethereum",
        asset: "ETH",
        accountIndex: 0,
        to: "0x0000000000000000000000000000000000000001",
        amount: "1"
      }
    }, sender)).rejects.toThrow("Unauthorized message sender");
    await expect(controller.handleMessage(legacySignMessage, sender)).rejects.toThrow("Unauthorized message sender");
    expect(submitSendRequest).not.toHaveBeenCalled();
    expect(signDappSignatureForApproval).not.toHaveBeenCalled();
  });

  it("does not expose a direct SIGN_MESSAGE signing path from the popup", async () => {
    harness.persisted = {
      ...harness.persisted,
      wallets: [{ id: "wallet-1", name: "Primary", createdAt: "2026-01-01T00:00:00.000Z", accountCount: 1 }],
      activeWalletId: "wallet-1"
    };
    await createSession("wallet-1", "test seed phrase");
    const controller = createBackgroundWalletController();

    await expect(controller.handleMessage({
      type: "SIGN_MESSAGE",
      chain: "ethereum",
      accountIndex: 0,
      message: "bypass approval"
    } as unknown as BackgroundMessage, POPUP_SENDER)).rejects.toThrow("Unsupported message");

    expect(signDappSignatureForApproval).not.toHaveBeenCalled();
  });

});

async function waitForPendingSignature(controller: ReturnType<typeof createBackgroundWalletController>) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1000) {
    const state = await controller.handleMessage({ type: "GET_STATE" }, POPUP_SENDER) as PopupState;
    if (state.pendingSignatures.length) return state;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return controller.handleMessage({ type: "GET_STATE" }, POPUP_SENDER) as Promise<PopupState>;
}
