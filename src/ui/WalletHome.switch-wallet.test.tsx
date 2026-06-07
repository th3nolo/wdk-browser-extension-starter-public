/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { sendMessage } from "./api";
import { createUiTestHarness, waitFor } from "./test-utils";
import type { BackgroundMessage } from "../lib/background/messages";
import type { AccountRecord, PopupState, WalletRecord } from "../lib/types";

vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn(async () => "data:image/png;base64,qr") }
}));

vi.mock("./api", async () => {
  const { createWalletClient } = await import("../sdk");
  const sendMessage = vi.fn();
  return { sendMessage, walletClient: createWalletClient(sendMessage) };
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockedSendMessage = vi.mocked(sendMessage);

let container: HTMLDivElement;
let root: Root;
let state: PopupState;
let ui: ReturnType<typeof createUiTestHarness>;

beforeEach(() => {
  state = multiWalletState("wallet-1");
  mockedSendMessage.mockImplementation(async (message: BackgroundMessage) => handleMessage(message));
  container = document.createElement("div");
  document.body.appendChild(container);
  ui = createUiTestHarness(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe("WalletHome wallet switching", () => {
  it("keeps the active wallet on wrong password and unlocks the selected wallet on success", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<App />);
    });

    await ui.waitForText("Accounts");
    expect(activeWalletName()).toBe("Primary wallet");
    expect(accountAddresses()).toEqual(["bc1qpr...0000", "0xprim...0001"]);

    // The wallet/account switcher now lives in a sheet opened from the header pill.
    await ui.clickTitle("Switch wallet");
    await ui.clickTitle("Switch to Second wallet");
    await ui.waitForText("Wallet password");
    await ui.setField("Wallet password", "primary wallet password");
    await ui.clickButton("Switch");

    await ui.waitForText("Incorrect wallet password");
    expect(mockedSendMessage).toHaveBeenCalledWith({
      type: "SWITCH_WALLET",
      walletId: "wallet-2",
      password: "primary wallet password"
    });
    expect(state.activeWalletId).toBe("wallet-1");
    expect(state.locked).toBe(false);
    // The sheet stays open on the password step so the user can retry.
    expect(activeWalletName()).toBe("Primary wallet");
    expect(accountAddresses()).toEqual(["bc1qpr...0000", "0xprim...0001"]);

    await ui.setField("Wallet password", "second wallet password");
    await ui.clickButton("Switch");

    await waitFor(() => activeWalletName() === "Second wallet");
    expect(mockedSendMessage).toHaveBeenCalledWith({
      type: "SWITCH_WALLET",
      walletId: "wallet-2",
      password: "second wallet password"
    });
    expect(state.activeWalletId).toBe("wallet-2");
    expect(state.locked).toBe(false);
    // Sheet closed after a successful switch.
    await waitFor(() => !container.querySelector(".sheet"));
    expect(container.textContent).not.toContain("Incorrect wallet password");
    expect(container.textContent).not.toContain("Wallet locked");
    expect(accountAddresses()).toEqual(["bc1qse...1111", "0xseco...2222"]);
  });
});

async function handleMessage(message: BackgroundMessage): Promise<PopupState | PopupState["balances"]> {
  switch (message.type) {
    case "GET_STATE":
    case "GET_STATE_SUMMARY":
      return state;
    case "GET_BALANCES":
      return state.balances;
    case "SWITCH_WALLET":
      if (message.walletId === "wallet-2" && message.password !== "second wallet password") {
        throw new Error("Incorrect wallet password");
      }
      if (message.walletId !== "wallet-1" && message.walletId !== "wallet-2") {
        throw new Error("Selected wallet vault was not found");
      }
      state = multiWalletState(message.walletId);
      return state;
    default:
      return state;
  }
}

function multiWalletState(activeWalletId: "wallet-1" | "wallet-2"): PopupState {
  const wallets: WalletRecord[] = [
    { id: "wallet-1", name: "Primary wallet", createdAt: "2026-01-01T00:00:00.000Z", accountCount: 1 },
    { id: "wallet-2", name: "Second wallet", createdAt: "2026-01-01T00:01:00.000Z", accountCount: 1 }
  ];

  return {
    locked: false,
    hasVault: true,
    wallets,
    activeWalletId,
    sessionExpiresAt: "2026-01-01T00:10:00.000Z",
    accounts: accountsForWallet(activeWalletId),
    balances: [],
    transactions: [],
    connectedSites: [],
    pendingConnections: [],
    pendingSignatures: [],
    pendingTransactions: []
  };
}

function accountsForWallet(walletId: "wallet-1" | "wallet-2"): AccountRecord[] {
  if (walletId === "wallet-2") {
    return [
      { walletId, chain: "bitcoin", index: 0, address: "bc1qsecondarywallet1111", path: "m/84'/0'/0'/0/0" },
      { walletId, chain: "ethereum", index: 0, address: "0xsecondwallet000000000000000000000000002222", path: "m/44'/60'/0'/0/0" }
    ];
  }

  return [
    { walletId, chain: "bitcoin", index: 0, address: "bc1qprimarywallet0000", path: "m/84'/0'/0'/0/0" },
    { walletId, chain: "ethereum", index: 0, address: "0xprimarywallet0000000000000000000000000001", path: "m/44'/60'/0'/0/0" }
  ];
}

function activeWalletName(): string {
  const name = container.querySelector(".wallet-pill-text strong")?.textContent;
  if (!name) throw new Error("Active wallet name not found");
  return name;
}

function accountAddresses(): string[] {
  return [...container.querySelectorAll(".account-grid code")].map((entry) => entry.textContent ?? "");
}
