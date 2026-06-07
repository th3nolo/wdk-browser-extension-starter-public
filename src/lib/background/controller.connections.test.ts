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

describe("background wallet controller - dapp connections", () => {
  it("returns empty accounts for passive dapp reads while locked", async () => {
    harness.persisted = {
      ...harness.persisted,
      wallets: [{ id: "wallet-1", name: "Primary", createdAt: "2026-01-01T00:00:00.000Z", accountCount: 1 }],
      activeWalletId: "wallet-1",
      connectedSites: [{ origin: "https://dapp.example", walletId: "wallet-1", accountIndex: 0, evmChainId: 1, connectedAt: "2026-01-01T00:00:00.000Z", lastUsedAt: "2026-01-01T00:00:00.000Z" }]
    };
    const controller = createBackgroundWalletController();

    await expect(controller.handleMessage({
      type: "DAPP_REQUEST",
      method: "eth_accounts"
    }, dappSender("https://dapp.example"))).resolves.toEqual([]);
  });

  it("queues connect requests while locked instead of failing early", async () => {
    harness.persisted = {
      ...harness.persisted,
      wallets: [{ id: "wallet-1", name: "Primary", createdAt: "2026-01-01T00:00:00.000Z", accountCount: 1 }],
      activeWalletId: "wallet-1"
    };
    const controller = createBackgroundWalletController();

    const connectPromise = controller.handleMessage({
      type: "DAPP_REQUEST",
      method: "eth_requestAccounts"
    }, dappSender("https://dapp.example"));
    connectPromise.catch(() => undefined);
    await vi.waitFor(() => expect(harness.persisted.pendingConnections).toEqual([
      { origin: "https://dapp.example", walletId: "wallet-1", requestedAt: expect.any(String) }
    ]));
    await controller.handleMessage({ type: "REJECT_DAPP", origin: "https://dapp.example" }, POPUP_SENDER);
    await expect(connectPromise).rejects.toMatchObject({ code: PROVIDER_RPC_ERROR_CODES.USER_REJECTED });
  });

  it("returns EIP-1193 unauthorized when connect is requested while locked", async () => {
    harness.persisted = {
      ...harness.persisted,
      wallets: [{ id: "wallet-1", name: "Primary", createdAt: "2026-01-01T00:00:00.000Z", accountCount: 1 }],
      activeWalletId: "wallet-1",
      connectedSites: [{ origin: "https://dapp.example", walletId: "wallet-1", accountIndex: 0, evmChainId: 1, connectedAt: "2026-01-01T00:00:00.000Z", lastUsedAt: "2026-01-01T00:00:00.000Z" }]
    };
    const controller = createBackgroundWalletController();

    await expect(controller.handleMessage({
      type: "DAPP_REQUEST",
      method: "eth_requestAccounts"
    }, dappSender("https://dapp.example"))).rejects.toMatchObject({
      code: PROVIDER_RPC_ERROR_CODES.UNAUTHORIZED,
      message: "Wallet is locked"
    });
    expect(harness.persisted.pendingConnections).toHaveLength(0);
  });

  it("queues, approves, and revokes origin-scoped account access", async () => {
    harness.persisted = {
      ...harness.persisted,
      wallets: [{ id: "wallet-1", name: "Primary", createdAt: "2026-01-01T00:00:00.000Z", accountCount: 1 }],
      activeWalletId: "wallet-1"
    };
    await createSession("wallet-1", "test seed phrase");
    const controller = createBackgroundWalletController();

    const connect1 = controller.handleMessage({
      type: "DAPP_REQUEST",
      method: "eth_requestAccounts"
    }, dappSender("https://dapp.example/path"));
    connect1.catch(() => undefined);
    await vi.waitFor(() => expect(harness.persisted.pendingConnections).toHaveLength(1));
    const connect2 = controller.handleMessage({
      type: "DAPP_REQUEST",
      method: "eth_requestAccounts"
    }, dappSender("https://dapp.example/path"));
    connect2.catch(() => undefined);
    expect(harness.persisted.pendingConnections).toEqual([{ origin: "https://dapp.example", walletId: "wallet-1", requestedAt: expect.any(String) }]);

    const approved = await controller.handleMessage({ type: "APPROVE_DAPP", origin: "https://dapp.example/path", accountIndex: 0 }, POPUP_SENDER) as PopupState;
    await expect(connect1).resolves.toEqual(["0x9858EfFD232B4033E47d90003D41EC34EcaEda94"]);
    await expect(connect2).resolves.toEqual(["0x9858EfFD232B4033E47d90003D41EC34EcaEda94"]);

    expect(harness.tabsSendMessage).toHaveBeenCalledWith(1, {
      type: DAPP_PROVIDER_EVENT_MESSAGE,
      event: "connect",
      chainId: "0x1"
    }, {});
    expect(harness.tabsSendMessage).toHaveBeenCalledWith(1, {
      type: DAPP_PROVIDER_EVENT_MESSAGE,
      event: "accountsChanged",
      accounts: ["0x9858EfFD232B4033E47d90003D41EC34EcaEda94"]
    }, {});
    expect(browser.tabs.query).not.toHaveBeenCalled();
    expect(approved.pendingConnections).toHaveLength(0);
    expect(approved.connectedSites).toEqual([expect.objectContaining({ origin: "https://dapp.example", walletId: "wallet-1", accountIndex: 0 })]);
    await expect(controller.handleMessage({
      type: "DAPP_REQUEST",
      method: "eth_accounts"
    }, dappSender("https://dapp.example/path"))).resolves.toEqual(["0x9858EfFD232B4033E47d90003D41EC34EcaEda94"]);

    const revoked = await controller.handleMessage({ type: "REVOKE_DAPP", origin: "https://dapp.example/path" }, POPUP_SENDER) as PopupState;

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
    expect(revoked.connectedSites).toHaveLength(0);
    await expect(controller.handleMessage({
      type: "DAPP_REQUEST",
      method: "eth_accounts"
    }, dappSender("https://dapp.example/path"))).resolves.toEqual([]);
  });

  it("targets the exact dapp document when broadcasting provider events", async () => {
    harness.persisted = {
      ...harness.persisted,
      wallets: [{ id: "wallet-1", name: "Primary", createdAt: "2026-01-01T00:00:00.000Z", accountCount: 1 }],
      activeWalletId: "wallet-1"
    };
    await createSession("wallet-1", "test seed phrase");
    const controller = createBackgroundWalletController();

    const connectPromise = controller.handleMessage({
      type: "DAPP_REQUEST",
      method: "eth_requestAccounts"
    }, dappSender("https://dapp.example/path", { tabId: 42, documentId: "doc-1", frameId: 7 }));
    connectPromise.catch(() => undefined);
    await vi.waitFor(() => expect(harness.persisted.pendingConnections).toHaveLength(1));

    await controller.handleMessage({ type: "APPROVE_DAPP", origin: "https://dapp.example/path", accountIndex: 0 }, POPUP_SENDER);
    await expect(connectPromise).resolves.toEqual(["0x9858EfFD232B4033E47d90003D41EC34EcaEda94"]);

    expect(harness.tabsSendMessage).toHaveBeenCalledWith(42, {
      type: DAPP_PROVIDER_EVENT_MESSAGE,
      event: "connect",
      chainId: "0x1"
    }, { documentId: "doc-1" });
    expect(harness.tabsSendMessage).toHaveBeenCalledWith(42, {
      type: DAPP_PROVIDER_EVENT_MESSAGE,
      event: "accountsChanged",
      accounts: ["0x9858EfFD232B4033E47d90003D41EC34EcaEda94"]
    }, { documentId: "doc-1" });
  });

  it("persists the selected account index when approving a connection", async () => {
    harness.persisted = {
      ...harness.persisted,
      wallets: [{ id: "wallet-1", name: "Primary", createdAt: "2026-01-01T00:00:00.000Z", accountCount: 2 }],
      activeWalletId: "wallet-1"
    };
    await createSession("wallet-1", "test seed phrase");
    const controller = createBackgroundWalletController();

    const connectPromise = controller.handleMessage({
      type: "DAPP_REQUEST",
      method: "eth_requestAccounts"
    }, dappSender("https://dapp.example"));
    connectPromise.catch(() => undefined);
    await vi.waitFor(() => expect(harness.persisted.pendingConnections).toHaveLength(1));

    const approved = await controller.handleMessage({
      type: "APPROVE_DAPP",
      origin: "https://dapp.example",
      accountIndex: 1
    }, POPUP_SENDER) as PopupState;
    await expect(connectPromise).resolves.toEqual(["0x70997970C51812dc3A010C7d01b50e0d17dc79C8"]);

    expect(approved.connectedSites).toEqual([
      expect.objectContaining({ origin: "https://dapp.example", walletId: "wallet-1", accountIndex: 1 })
    ]);
    expect(harness.tabsSendMessage).toHaveBeenCalledWith(1, {
      type: DAPP_PROVIDER_EVENT_MESSAGE,
      event: "accountsChanged",
      accounts: ["0x70997970C51812dc3A010C7d01b50e0d17dc79C8"]
    }, {});
    await expect(controller.handleMessage({
      type: "DAPP_REQUEST",
      method: "eth_accounts"
    }, dappSender("https://dapp.example"))).resolves.toEqual(["0x70997970C51812dc3A010C7d01b50e0d17dc79C8"]);
  });

  it("exposes a set of accounts when approving with accountIndexes", async () => {
    harness.persisted = {
      ...harness.persisted,
      wallets: [{ id: "wallet-1", name: "Primary", createdAt: "2026-01-01T00:00:00.000Z", accountCount: 2 }],
      activeWalletId: "wallet-1"
    };
    await createSession("wallet-1", "test seed phrase");
    const controller = createBackgroundWalletController();

    const connectPromise = controller.handleMessage({
      type: "DAPP_REQUEST",
      method: "eth_requestAccounts"
    }, dappSender("https://dapp.example"));
    connectPromise.catch(() => undefined);
    await vi.waitFor(() => expect(harness.persisted.pendingConnections).toHaveLength(1));

    const approved = await controller.handleMessage({
      type: "APPROVE_DAPP",
      origin: "https://dapp.example",
      accountIndex: 0,
      accountIndexes: [0, 1]
    }, POPUP_SENDER) as PopupState;

    // Primary first, then the second exposed account.
    await expect(connectPromise).resolves.toEqual([
      "0x9858EfFD232B4033E47d90003D41EC34EcaEda94",
      "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
    ]);
    expect(approved.connectedSites).toEqual([
      expect.objectContaining({
        origin: "https://dapp.example",
        walletId: "wallet-1",
        accountIndex: 0,
        accountIndexes: [0, 1]
      })
    ]);
    expect(harness.tabsSendMessage).toHaveBeenCalledWith(1, {
      type: DAPP_PROVIDER_EVENT_MESSAGE,
      event: "accountsChanged",
      accounts: [
        "0x9858EfFD232B4033E47d90003D41EC34EcaEda94",
        "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
      ]
    }, {});
    await expect(controller.handleMessage({
      type: "DAPP_REQUEST",
      method: "eth_accounts"
    }, dappSender("https://dapp.example"))).resolves.toEqual([
      "0x9858EfFD232B4033E47d90003D41EC34EcaEda94",
      "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
    ]);
  });

  it("rejects approval when the selected account index is unavailable", async () => {
    harness.persisted = {
      ...harness.persisted,
      wallets: [{ id: "wallet-1", name: "Primary", createdAt: "2026-01-01T00:00:00.000Z", accountCount: 1 }],
      activeWalletId: "wallet-1"
    };
    await createSession("wallet-1", "test seed phrase");
    const controller = createBackgroundWalletController();

    const connectPromise = controller.handleMessage({
      type: "DAPP_REQUEST",
      method: "eth_requestAccounts"
    }, dappSender("https://dapp.example"));
    connectPromise.catch(() => undefined);
    await vi.waitFor(() => expect(harness.persisted.pendingConnections).toHaveLength(1));

    await expect(controller.handleMessage({
      type: "APPROVE_DAPP",
      origin: "https://dapp.example",
      accountIndex: 1
    }, POPUP_SENDER)).rejects.toThrow("Selected account is not available for this wallet");

    await controller.handleMessage({ type: "REJECT_DAPP", origin: "https://dapp.example" }, POPUP_SENDER);
    await expect(connectPromise).rejects.toMatchObject({ code: PROVIDER_RPC_ERROR_CODES.USER_REJECTED });
  });

  it("scopes pending connections to the wallet active when the site requested access", async () => {
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

    const connectPromise = controller.handleMessage({
      type: "DAPP_REQUEST",
      method: "eth_requestAccounts"
    }, dappSender("https://dapp.example"));
    connectPromise.catch(() => undefined);
    await vi.waitFor(() => expect(harness.persisted.pendingConnections).toEqual([
      { origin: "https://dapp.example", walletId: "wallet-1", requestedAt: expect.any(String) }
    ]));

    const switched = await controller.handleMessage({
      type: "SWITCH_WALLET",
      walletId: "wallet-2",
      password: "second wallet password"
    }, POPUP_SENDER) as PopupState;

    expect(switched.pendingConnections).toHaveLength(0);
    await expect(controller.handleMessage({ type: "APPROVE_DAPP", origin: "https://dapp.example", accountIndex: 0 }, POPUP_SENDER)).rejects.toThrow(
      "Connection request was not found or already resolved"
    );
    expect(harness.persisted.connectedSites).toHaveLength(0);

    await controller.handleMessage({
      type: "SWITCH_WALLET",
      walletId: "wallet-1",
      password: "primary wallet password"
    }, POPUP_SENDER);

    const approved = await controller.handleMessage({ type: "APPROVE_DAPP", origin: "https://dapp.example", accountIndex: 0 }, POPUP_SENDER) as PopupState;
    await expect(connectPromise).resolves.toEqual(["0x9858EfFD232B4033E47d90003D41EC34EcaEda94"]);

    expect(approved.connectedSites).toEqual([expect.objectContaining({ origin: "https://dapp.example", walletId: "wallet-1" })]);
    expect(harness.persisted.pendingConnections).toHaveLength(0);
  });
});
