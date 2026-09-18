/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest";
import { installInpageProvider } from "../provider/inpage";
import { createSession } from "../session/session";
import { createControllerTestHarness, dappSender, POPUP_SENDER } from "./controller-test-harness";
import { listPendingDappTransactions, resetPendingDappTransactionsForTests } from "./pending-dapp-transactions";
import { submitDappTransactionForApproval } from "./wallet-execution";
import { isBackgroundErrorResponse, BACKGROUND_ERROR_RESPONSE_KEY } from "./error-response";

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

afterEach(() => {
  resetPendingDappTransactionsForTests();
  vi.restoreAllMocks();
});

it("returns one fake submission through the actual inpage, content and background entrypoints under concurrent popup approval", async () => {
  const origin = window.location.origin;
  const now = new Date().toISOString();
  harness.persisted = {
    ...harness.persisted,
    wallets: [{ id: "wallet-1", name: "Test", createdAt: now, accountCount: 1 }],
    activeWalletId: "wallet-1",
    connectedSites: [{ origin, walletId: "wallet-1", accountIndex: 0, evmChainId: 1, connectedAt: now, lastUsedAt: now }]
  };
  await createSession("wallet-1", "test seed phrase");

  type RuntimeListener = (message: unknown, sender: Browser.runtime.MessageSender, respond: (value: unknown) => void) => boolean;
  const runtimeListeners: RuntimeListener[] = [];
  Object.assign(browser.runtime, { onMessage: { addListener: (listener: RuntimeListener) => runtimeListeners.push(listener) } });
  Object.assign(browser, { alarms: { create: vi.fn(async () => undefined), onAlarm: { addListener: vi.fn() } } });
  vi.stubGlobal("defineBackground", (main: () => void) => main);
  vi.stubGlobal("defineContentScript", (definition: unknown) => definition);
  const background = await import("../../../entrypoints/background");
  (background.default as unknown as () => void)();
  const sendMessage = (message: unknown, sender: Browser.runtime.MessageSender) => new Promise<unknown>((resolve) => {
    expect(runtimeListeners[0](message, sender, resolve)).toBe(true);
  });
  vi.stubGlobal("chrome", { runtime: { sendMessage: (message: unknown, respond: (value: unknown) => void) => {
    void sendMessage(message, dappSender(origin)).then(respond);
  } } });

  // jsdom has no extension runtime; preserve the real authenticated bridge and
  // replace only browser message transport and wallet/network execution.
  vi.spyOn(window, "postMessage").mockImplementation((data: unknown) => {
    window.dispatchEvent(new MessageEvent("message", { source: window, data }));
  });
  const listeners = vi.spyOn(window, "addEventListener");
  const content = await import("../../../entrypoints/content");
  (content.default as unknown as { main: () => void }).main();
  const script = document.querySelector<HTMLScriptElement>("script[data-wdk-bridge-token]");
  expect(script).not.toBeNull();
  const { provider, teardown } = installInpageProvider(script!.dataset.wdkBridgeToken!);
  try {
    const response = provider.request({ method: "eth_sendTransaction", params: [{
      to: "0x0000000000000000000000000000000000000001", value: "0x1"
    }] });
    await vi.waitFor(() => expect(listPendingDappTransactions()).toHaveLength(1));
    const message = { type: "APPROVE_DAPP_TRANSACTION", id: listPendingDappTransactions()[0].id };
    const approvals = await Promise.all([sendMessage(message, POPUP_SENDER), sendMessage(message, POPUP_SENDER)]);
    await expect(response).resolves.toBe("0xtxhash");
    expect(submitDappTransactionForApproval).toHaveBeenCalledTimes(1);
    const errors = approvals.filter(isBackgroundErrorResponse);
    expect(errors).toHaveLength(1);
    expect(errors[0][BACKGROUND_ERROR_RESPONSE_KEY].message).toContain("already being processed");
  } finally {
    teardown();
    script?.remove();
    for (const [event, listener] of listeners.mock.calls) window.removeEventListener(event, listener);
  }
});
