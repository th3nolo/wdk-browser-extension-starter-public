import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSession, createSession } from "../session/session";
import { encryptSeedPhrase } from "../crypto/vault";
import { createBackgroundWalletController } from "./controller";
import { createControllerTestHarness, dappSender, POPUP_SENDER } from "./controller-test-harness";
import { DAPP_TRANSACTION_TTL_MS, listPendingDappTransactions, resetPendingDappTransactionsForTests } from "./pending-dapp-transactions";
import { DAPP_APPROVALS_STORAGE_KEY, type StoredPendingApproval } from "./pending-dapp-approvals";
import { listPendingSignatures } from "./pending-signatures";
import { connectedAccountForWallet, signDappSignatureForApproval, submitDappTransactionForApproval } from "./wallet-execution";

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
const origin = "https://dapp.example";
const transaction = {
  type: "DAPP_REQUEST" as const,
  method: "eth_sendTransaction" as const,
  params: [{ to: "0x0000000000000000000000000000000000000001", value: "0x1" }]
};

function sessionStorageMock() {
  return browser.storage.session as {
    set: (items: Record<string, unknown>) => Promise<void>;
    remove: (keys: string | string[]) => Promise<void>;
  };
}

beforeEach(async () => {
  vi.mocked(sessionStorageMock().set).mockImplementation(async (items) => {
    Object.assign(harness.sessionStorage, structuredClone(items));
  });
  harness.persisted = {
    ...harness.persisted,
    wallets: [{ id: "wallet-1", name: "Primary", createdAt: new Date().toISOString(), accountCount: 1 }],
    activeWalletId: "wallet-1",
    connectedSites: [{ origin, walletId: "wallet-1", accountIndex: 0, evmChainId: 1,
      connectedAt: new Date().toISOString(), lastUsedAt: new Date().toISOString() }]
  };
  await createSession("wallet-1", "test seed phrase");
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function pauseConnectionCheck() {
  const entered = deferred<void>();
  const release = deferred<void>();
  const lookup = vi.mocked(connectedAccountForWallet).getMockImplementation()!;
  vi.mocked(connectedAccountForWallet).mockImplementationOnce(async (...args) => {
    const result = await lookup(...args);
    entered.resolve();
    await release.promise;
    return result;
  });
  return { entered: entered.promise, release: () => release.resolve() };
}

afterEach(() => {
  vi.useRealTimers();
  resetPendingDappTransactionsForTests();
});

async function queuedTransaction(controller: ReturnType<typeof createBackgroundWalletController>) {
  const response = controller.handleMessage(transaction, dappSender(origin));
  // Observe failures immediately, including rejection/expiry while approval is paused.
  const outcome = response.then((value) => ({ value }), (error: unknown) => ({ error }));
  await vi.waitFor(() => expect(listPendingDappTransactions()).toHaveLength(1));
  return { id: listPendingDappTransactions()[0].id, response, outcome };
}

describe("controller approval execution races", () => {
  it("submits one transaction when two popup approvals race", async () => {
    const controller = createBackgroundWalletController();
    const queued = await queuedTransaction(controller);
    const results = await Promise.allSettled([
      controller.handleMessage({ type: "APPROVE_DAPP_TRANSACTION", id: queued.id }, POPUP_SENDER),
      controller.handleMessage({ type: "APPROVE_DAPP_TRANSACTION", id: queued.id }, POPUP_SENDER)
    ]);
    expect(submitDappTransactionForApproval).toHaveBeenCalledTimes(1);
    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    await expect(queued.response).resolves.toBe("0xtxhash");
  });

  it("signs once when two signature approvals race", async () => {
    const controller = createBackgroundWalletController();
    const signature = controller.handleMessage({ type: "DAPP_REQUEST", method: "personal_sign",
      params: ["hello", "0x9858EfFD232B4033E47d90003D41EC34EcaEda94"] }, dappSender(origin));
    await vi.waitFor(() => expect(listPendingSignatures()).toHaveLength(1));
    const id = listPendingSignatures()[0].id;
    const results = await Promise.allSettled([
      controller.handleMessage({ type: "APPROVE_SIGNATURE", id }, POPUP_SENDER),
      controller.handleMessage({ type: "APPROVE_SIGNATURE", id }, POPUP_SENDER)
    ]);
    expect(signDappSignatureForApproval).toHaveBeenCalledTimes(1);
    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    await expect(signature).resolves.toBe("0xsigned");
  });

  it.each(["reject", "expire"] as const)("never executes a request after %s wins", async (action) => {
    const controller = createBackgroundWalletController();
    const queued = await queuedTransaction(controller);
    if (action === "reject") {
      await controller.handleMessage({ type: "REJECT_DAPP_TRANSACTION", id: queued.id }, POPUP_SENDER);
    } else {
      vi.useFakeTimers();
      await vi.advanceTimersByTimeAsync(DAPP_TRANSACTION_TTL_MS + 1);
    }
    await expect(controller.handleMessage({ type: "APPROVE_DAPP_TRANSACTION", id: queued.id }, POPUP_SENDER)).rejects.toThrow();
    expect(submitDappTransactionForApproval).not.toHaveBeenCalled();
    if (action === "expire") {
      // The waiter timer predates fake timers; explicitly settle it after proving
      // the approval path checks the deadline without relying on timer delivery.
      await controller.handleMessage({ type: "REJECT_DAPP_TRANSACTION", id: queued.id }, POPUP_SENDER);
    }
    expect(await queued.outcome).toHaveProperty("error");
  });

  it.each(["reject", "revoke", "lock", "chain", "account"] as const)("cancels a claimed request when %s wins during validation", async (action) => {
    const controller = createBackgroundWalletController();
    const queued = await queuedTransaction(controller);
    if (action === "account") {
      harness.persisted = {
        ...harness.persisted,
        wallets: harness.persisted.wallets.map((wallet) => ({ ...wallet, accountCount: 2 })),
        pendingConnections: [{ origin, walletId: "wallet-1", requestedAt: new Date().toISOString() }]
      };
    }
    const check = pauseConnectionCheck();
    const approval = controller.handleMessage({ type: "APPROVE_DAPP_TRANSACTION", id: queued.id }, POPUP_SENDER);
    const result = expect(approval).rejects.toThrow(/cancelled|resolved/);
    await check.entered;
    if (action === "reject") await controller.handleMessage({ type: "REJECT_DAPP_TRANSACTION", id: queued.id }, POPUP_SENDER);
    if (action === "revoke") await controller.handleMessage({ type: "REVOKE_DAPP", origin }, POPUP_SENDER);
    if (action === "lock") await controller.handleMessage({ type: "LOCK" }, POPUP_SENDER);
    if (action === "chain") await controller.handleMessage({ type: "DAPP_REQUEST", method: "wallet_switchEthereumChain", params: [{ chainId: "0x89" }] }, dappSender(origin));
    if (action === "account") await controller.handleMessage({ type: "APPROVE_DAPP", origin, accountIndex: 1 }, POPUP_SENDER);
    check.release();
    await result;
    expect(await queued.outcome).toHaveProperty("error");
    expect(submitDappTransactionForApproval).not.toHaveBeenCalled();
  });

  it("checks expiry again after slow approval validation", async () => {
    const controller = createBackgroundWalletController();
    const queued = await queuedTransaction(controller);
    const check = pauseConnectionCheck();
    const approval = controller.handleMessage({ type: "APPROVE_DAPP_TRANSACTION", id: queued.id }, POPUP_SENDER);
    const result = expect(approval).rejects.toThrow(/expired/);
    await check.entered;
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + DAPP_TRANSACTION_TTL_MS + 1);
    check.release();
    await result;
    expect(await queued.outcome).toHaveProperty("error");
    expect(submitDappTransactionForApproval).not.toHaveBeenCalled();
  });

  it.each(["lock", "replace"] as const)("refuses a stale session after %s during validation", async (action) => {
    const controller = createBackgroundWalletController();
    const queued = await queuedTransaction(controller);
    const check = pauseConnectionCheck();
    const approval = controller.handleMessage({ type: "APPROVE_DAPP_TRANSACTION", id: queued.id }, POPUP_SENDER);
    const result = expect(approval).rejects.toThrow("Wallet session changed");
    await check.entered;
    if (action === "lock") await clearSession();
    else await createSession("wallet-1", "replacement test seed phrase");
    check.release();
    await result;
    expect(await queued.outcome).toHaveProperty("error");
    expect(submitDappTransactionForApproval).not.toHaveBeenCalled();
  });

  it("does not cancel or resubmit once the provider is executing", async () => {
    const controller = createBackgroundWalletController();
    const queued = await queuedTransaction(controller);
    const submission = deferred<string>();
    vi.mocked(submitDappTransactionForApproval).mockReturnValueOnce(submission.promise);
    const approval = controller.handleMessage({ type: "APPROVE_DAPP_TRANSACTION", id: queued.id }, POPUP_SENDER);
    await vi.waitFor(() => expect(submitDappTransactionForApproval).toHaveBeenCalledTimes(1));
    await expect(controller.handleMessage({ type: "REJECT_DAPP_TRANSACTION", id: queued.id }, POPUP_SENDER)).rejects.toThrow("already started");
    await controller.handleMessage({ type: "LOCK" }, POPUP_SENDER);
    await expect(controller.handleMessage({ type: "APPROVE_DAPP_TRANSACTION", id: queued.id }, POPUP_SENDER)).rejects.toThrow("already being processed");
    submission.resolve("0xlatehash");
    await approval;
    await expect(queued.response).resolves.toBe("0xlatehash");
    expect(submitDappTransactionForApproval).toHaveBeenCalledTimes(1);
  });

  it("does not restore deleted wallet history when execution completes after deletion", async () => {
    const password = "Local-only!ApprovalFixture-2026";
    const vault = await encryptSeedPhrase("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about", password);
    harness.persisted = { ...harness.persisted, vaults: { "wallet-1": vault } };
    const controller = createBackgroundWalletController();
    const queued = await queuedTransaction(controller);
    const submission = deferred<string>();
    vi.mocked(submitDappTransactionForApproval).mockReturnValueOnce(submission.promise);
    const approval = controller.handleMessage({ type: "APPROVE_DAPP_TRANSACTION", id: queued.id }, POPUP_SENDER);
    await vi.waitFor(() => expect(submitDappTransactionForApproval).toHaveBeenCalledTimes(1));
    await controller.handleMessage({ type: "DELETE_WALLET", walletId: "wallet-1", password }, POPUP_SENDER);
    submission.resolve("0xcompleted");
    await approval;
    await expect(queued.response).resolves.toBe("0xcompleted");
    expect(harness.persisted.wallets).toHaveLength(0);
    expect(harness.persisted.transactions).toHaveLength(0);
    expect(submitDappTransactionForApproval).toHaveBeenCalledTimes(1);
  });

  it("retains uncertain submissions across retries, expiry, revocation and worker restart", async () => {
    const controller = createBackgroundWalletController();
    const queued = await queuedTransaction(controller);
    vi.mocked(submitDappTransactionForApproval).mockRejectedValueOnce(new Error("RPC disconnected after broadcast"));
    await expect(controller.handleMessage({ type: "APPROVE_DAPP_TRANSACTION", id: queued.id }, POPUP_SENDER)).rejects.toThrow("outcome is unknown");
    await expect(queued.response).rejects.toThrow("outcome is unknown");
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(controller.handleMessage(transaction, dappSender(origin))).rejects.toThrow("outcome is unknown");
    }
    await controller.handleMessage({ type: "REVOKE_DAPP", origin }, POPUP_SENDER);
    expect(harness.sessionStorage[DAPP_APPROVALS_STORAGE_KEY]).toEqual([expect.objectContaining({ executionState: "uncertain" })]);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + DAPP_TRANSACTION_TTL_MS + 1);
    resetPendingDappTransactionsForTests();
    const restarted = createBackgroundWalletController();
    await restarted.initialize();
    await expect(restarted.handleMessage({ type: "APPROVE_DAPP_TRANSACTION", id: queued.id }, POPUP_SENDER)).rejects.toThrow();
    expect(harness.sessionStorage[DAPP_APPROVALS_STORAGE_KEY]).toEqual([expect.objectContaining({ executionState: "uncertain" })]);
    expect(submitDappTransactionForApproval).toHaveBeenCalledTimes(1);
  });

  it("fails before any submission if persisting the claim fails", async () => {
    const controller = createBackgroundWalletController();
    const queued = await queuedTransaction(controller);
    const save = vi.mocked(sessionStorageMock().set).getMockImplementation()!;
    vi.mocked(sessionStorageMock().set).mockImplementation(async (items) => {
      const approvals = items[DAPP_APPROVALS_STORAGE_KEY] as StoredPendingApproval[] | undefined;
      if (approvals?.some((entry) => entry.executionState === "claimed")) throw new Error("session storage unavailable");
      await save(items);
    });
    await expect(controller.handleMessage({ type: "APPROVE_DAPP_TRANSACTION", id: queued.id }, POPUP_SENDER)).rejects.toThrow("storage unavailable");
    await expect(queued.response).rejects.toThrow("could not be saved");
    expect(submitDappTransactionForApproval).not.toHaveBeenCalled();
  });

  it("recovers a known hash after settlement storage fails without submitting again", async () => {
    const controller = createBackgroundWalletController();
    const queued = await queuedTransaction(controller);
    const remove = vi.mocked(sessionStorageMock().remove).getMockImplementation()!;
    vi.mocked(sessionStorageMock().remove).mockImplementation(async (keys) => {
      if (keys === DAPP_APPROVALS_STORAGE_KEY) throw new Error("settlement storage unavailable");
      await remove(keys);
    });
    await expect(controller.handleMessage({ type: "APPROVE_DAPP_TRANSACTION", id: queued.id }, POPUP_SENDER)).rejects.toThrow("settlement storage unavailable");
    await expect(queued.response).resolves.toBe("0xtxhash");
    vi.mocked(sessionStorageMock().remove).mockImplementation(remove);
    resetPendingDappTransactionsForTests();
    const restarted = createBackgroundWalletController();
    await expect(restarted.handleMessage(transaction, dappSender(origin))).resolves.toBe("0xtxhash");
    expect(submitDappTransactionForApproval).toHaveBeenCalledTimes(1);
  });

  it("keeps a successful receipt for recovery when delivery is interrupted by a worker restart", async () => {
    const controller = createBackgroundWalletController();
    const queued = await queuedTransaction(controller);
    await controller.handleMessage({ type: "APPROVE_DAPP_TRANSACTION", id: queued.id }, POPUP_SENDER);
    await expect(queued.response).resolves.toBe("0xtxhash");
    resetPendingDappTransactionsForTests();
    const restarted = createBackgroundWalletController();
    await expect(restarted.handleMessage(transaction, dappSender(origin))).resolves.toBe("0xtxhash");
    expect(submitDappTransactionForApproval).toHaveBeenCalledTimes(1);
  });

  it("cancels a failed validation and lets the dApp request fresh approval", async () => {
    const controller = createBackgroundWalletController();
    const queued = await queuedTransaction(controller);
    vi.mocked(connectedAccountForWallet).mockRejectedValueOnce(new Error("account lookup failed"));
    await expect(controller.handleMessage({ type: "APPROVE_DAPP_TRANSACTION", id: queued.id }, POPUP_SENDER)).rejects.toThrow("account lookup failed");
    await expect(queued.response).rejects.toThrow("failed before execution");
    expect(submitDappTransactionForApproval).not.toHaveBeenCalled();
    const retry = await queuedTransaction(controller);
    expect(retry.id).not.toBe(queued.id);
    await controller.handleMessage({ type: "APPROVE_DAPP_TRANSACTION", id: retry.id }, POPUP_SENDER);
    await expect(retry.response).resolves.toBe("0xtxhash");
    expect(submitDappTransactionForApproval).toHaveBeenCalledTimes(1);
  });

  it("never calls the provider when the execution transition cannot be persisted", async () => {
    const controller = createBackgroundWalletController();
    const queued = await queuedTransaction(controller);
    const save = vi.mocked(sessionStorageMock().set).getMockImplementation()!;
    vi.mocked(sessionStorageMock().set).mockImplementation(async (items) => {
      const approvals = items[DAPP_APPROVALS_STORAGE_KEY] as StoredPendingApproval[] | undefined;
      if (approvals?.some((entry) => entry.executionState === "executing")) throw new Error("execution storage unavailable");
      await save(items);
    });
    await expect(controller.handleMessage({ type: "APPROVE_DAPP_TRANSACTION", id: queued.id }, POPUP_SENDER)).rejects.toThrow("execution storage unavailable");
    await expect(queued.response).rejects.toThrow("failed before execution");
    expect(submitDappTransactionForApproval).not.toHaveBeenCalled();
  });

  it("does not hold the global approval queue while a provider call is pending", async () => {
    const controller = createBackgroundWalletController();
    const first = await queuedTransaction(controller);
    const submission = deferred<string>();
    vi.mocked(submitDappTransactionForApproval).mockReturnValueOnce(submission.promise);
    const approval = controller.handleMessage({ type: "APPROVE_DAPP_TRANSACTION", id: first.id }, POPUP_SENDER);
    await vi.waitFor(() => expect(submitDappTransactionForApproval).toHaveBeenCalledTimes(1));
    const second = controller.handleMessage({ ...transaction, params: [{ ...transaction.params[0], value: "0x2" }] }, dappSender(origin));
    await vi.waitFor(() => expect(listPendingDappTransactions()).toHaveLength(1));
    await controller.handleMessage({ type: "APPROVE_DAPP_TRANSACTION", id: listPendingDappTransactions()[0].id }, POPUP_SENDER);
    await expect(second).resolves.toBe("0xtxhash");
    submission.resolve("0xfirst");
    await approval;
    await expect(first.response).resolves.toBe("0xfirst");
    expect(submitDappTransactionForApproval).toHaveBeenCalledTimes(2);
  });

  it("preserves execution across timeout and recovers a late hash", async () => {
    vi.useFakeTimers();
    const controller = createBackgroundWalletController();
    const queued = await queuedTransaction(controller);
    const submission = deferred<string>();
    vi.mocked(submitDappTransactionForApproval).mockReturnValueOnce(submission.promise);
    const approval = controller.handleMessage({ type: "APPROVE_DAPP_TRANSACTION", id: queued.id }, POPUP_SENDER);
    await vi.waitFor(() => expect(submitDappTransactionForApproval).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(DAPP_TRANSACTION_TTL_MS + 1);
    await expect(queued.response).rejects.toThrow("outcome is unknown");
    expect(harness.sessionStorage[DAPP_APPROVALS_STORAGE_KEY]).toEqual([expect.objectContaining({ executionState: "executing" })]);
    submission.resolve("0xlatehash");
    await approval;
    await expect(controller.handleMessage(transaction, dappSender(origin))).resolves.toBe("0xlatehash");
    expect(submitDappTransactionForApproval).toHaveBeenCalledTimes(1);
  });

  it.each(["claimed", "executing"] as const)("recovers a worker interrupted while %s without replaying execution", async (executionState) => {
    const controller = createBackgroundWalletController();
    const queued = await queuedTransaction(controller);
    // Simulate persisted state at the exact restart boundary; no old worker or
    // callback survives. Session storage clones records, as the browser does.
    const approvals = harness.sessionStorage[DAPP_APPROVALS_STORAGE_KEY] as StoredPendingApproval[];
    approvals[0].executionState = executionState;
    resetPendingDappTransactionsForTests();
    const restarted = createBackgroundWalletController();
    await restarted.initialize();
    await expect(restarted.handleMessage({ type: "APPROVE_DAPP_TRANSACTION", id: queued.id }, POPUP_SENDER)).rejects.toThrow();
    await expect(restarted.handleMessage(transaction, dappSender(origin))).rejects.toThrow(
      executionState === "claimed" ? "interrupted before execution" : "outcome is unknown"
    );
    expect(listPendingDappTransactions()).toHaveLength(0);
    expect(submitDappTransactionForApproval).not.toHaveBeenCalled();
  });
});
