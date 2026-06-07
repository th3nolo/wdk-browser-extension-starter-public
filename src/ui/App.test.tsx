/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { sendMessage } from "./api";
import { createUiTestHarness, waitFor } from "./test-utils";
import type { AccountRecord, PopupState, TransactionRecord } from "../lib/types";
import type { BackgroundMessage } from "../lib/background/messages";

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
let clipboardWriteText: ReturnType<typeof vi.fn>;
let ui: ReturnType<typeof createUiTestHarness>;

beforeEach(() => {
  state = emptyState();
  clipboardWriteText = vi.fn();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: clipboardWriteText }
  });
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

describe("popup wallet workflow", () => {
  it("creates, expands, locks, unlocks, receives, and prepares send", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<App />);
    });

    await ui.waitForText("WDK Wallet");
    await ui.setField("Wallet name", "Smoke wallet");
    await ui.setField("Password", "smoke-password-1234");
    await ui.waitForText("Recovery phrase backup");
    expect(ui.buttonByText("Create wallet").disabled).toBe(true);
    await ui.setCheckbox("I saved this recovery phrase", true);
    await waitFor(() => !ui.buttonByText("Create wallet").disabled);
    await ui.clickButton("Create wallet");
    expect(mockedSendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "CREATE_WALLET",
      seedPhrase: expect.stringMatching(/^[a-z]+( [a-z]+){23}$/)
    }));

    // The Tokens screen is the default destination after onboarding.
    await ui.waitForText("Accounts");
    await ui.waitForText("Bitcoin #1");
    await ui.waitForText("Ethereum #1");

    await ui.clickTitle("Add account");
    await ui.waitForText("Create account"); // confirm step before creating
    await ui.clickButton("Create account");
    await ui.waitForText("Account 2 added"); // clear confirmation that Add worked
    await ui.waitForText("Ethereum #2");
    expect(ui.pageText()).toContain("Ethereum · Account 2"); // hero switches to the new account

    await ui.clickTitle("Lock");
    await ui.waitForText("Wallet locked");
    await ui.setField("Password", "smoke-password-1234");
    await ui.clickButton("Unlock");
    await ui.waitForText("Accounts");

    // Receive is now an action button on the Tokens screen.
    await ui.clickButton("Receive");
    await ui.waitForSelector("img.qr");
    await ui.waitForSelector(".address");
    await ui.clickButton("Copy");
    expect(clipboardWriteText).toHaveBeenLastCalledWith("bc1qsmoke0");

    // Back out of Receive, then open the Send action.
    await ui.clickTitle("Back");
    await ui.clickButton("Send");
    await ui.waitForText("Recipient");
    expect(container.querySelector("button[title='Scan QR code']")).toBeTruthy();
    await ui.selectField("Network", "bitcoin");
    await waitFor(() => ui.fieldByLabel("Asset").value === "BTC");
    expect(ui.selectOptions("Asset")).toEqual(["BTC"]);
    await ui.selectField("Network", "ethereum");
    await waitFor(() => ui.fieldByLabel("Asset").value === "ETH");
    expect(ui.selectOptions("Asset")).toEqual(["ETH", "USDt", "XAUt"]);
    await ui.selectField("Asset", "XAUt");
    await ui.selectField("Network", "polygon");
    await waitFor(() => ui.fieldByLabel("Asset").value === "POL");
    expect(ui.selectOptions("Asset")).toEqual(["POL", "USDt"]);
    await ui.selectField("Network", "plasma");
    await waitFor(() => ui.fieldByLabel("Asset").value === "XPL");
    expect(ui.selectOptions("Asset")).toEqual(["XPL"]);
    await ui.selectField("Network", "ethereum");
    await waitFor(() => ui.fieldByLabel("Asset").value === "ETH");
    await ui.setField("Recipient", "0x0000000000000000000000000000000000000001");
    await ui.setField("Amount", "0.01");
    await ui.clickButton("Review send");
    await ui.waitForText("Confirm send");
    expect(mockedSendMessage).not.toHaveBeenLastCalledWith(expect.objectContaining({ type: "SEND" }));
    await ui.clickButton("Confirm send");
    expect(mockedSendMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: "SEND" }));

    await ui.clickButton("Activity");
    await ui.waitForText("0xsent");
    await ui.waitForText("ETH on Ethereum");
    await ui.waitForText("BTC on Bitcoin");
    await ui.selectField("Status", "confirmed");
    await ui.waitForText("BTC on Bitcoin");
    expect(container.textContent).not.toContain("ETH on Ethereum");
    await ui.selectField("Status", "all");
    await ui.setField("Search", "0xconfirmed");
    await ui.waitForText("BTC on Bitcoin");
    expect(container.textContent).not.toContain("ETH on Ethereum");

  }, 20_000);

  it("surfaces pending dApp requests in the focused approval view", async () => {
    state = unlockedState(2, true);
    await act(async () => {
      root = createRoot(container);
      root.render(<App />);
    });

    await ui.waitForText("Review this request carefully");
    await ui.waitForText("https://dapp.example");
    await ui.waitForText("Plain UTF-8 text");

    await ui.clickTitle("Approve site");
    expect(mockedSendMessage).toHaveBeenCalledWith({
      type: "APPROVE_DAPP",
      origin: "https://dapp.example",
      accountIndex: 0,
      accountIndexes: [0]
    });

    await ui.waitForText("You are signing on");
    await ui.waitForText("Sign in to WDK demo");
    await ui.clickTitle("Approve signature");
    expect(mockedSendMessage).toHaveBeenCalledWith({ type: "APPROVE_SIGNATURE", id: "sig-1" });

    // Both requests cleared — the dashboard returns.
    await ui.waitForText("Accounts");
  }, 20_000);
});

async function handleMessage(message: BackgroundMessage): Promise<PopupState | PopupState["balances"] | null> {
  switch (message.type) {
    case "GET_STATE":
    case "GET_STATE_SUMMARY":
      return state;
    case "GET_BALANCES":
      return state.balances;
    case "TAKE_QR_SCAN":
      return null;
    case "CREATE_WALLET":
      expect(message.seedPhrase).toMatch(/^[a-z]+( [a-z]+){23}$/);
      state = unlockedState(1);
      return state;
    case "ADD_ACCOUNT":
      state = unlockedState(2);
      return state;
    case "LOCK":
      state = { ...state, locked: true, accounts: [], balances: [], sessionExpiresAt: undefined };
      return state;
    case "UNLOCK":
      state = unlockedState(2);
      return state;
    case "APPROVE_DAPP":
      state = {
        ...state,
        pendingConnections: state.pendingConnections.filter(
          (request) => !(request.origin === message.origin && request.walletId === state.activeWalletId)
        ),
        connectedSites: [{
          origin: message.origin,
          walletId: "wallet-1",
          accountIndex: message.accountIndex,
          evmChainId: 1,
          connectedAt: "2026-01-01T00:03:00.000Z",
          lastUsedAt: "2026-01-01T00:03:00.000Z"
        }]
      };
      return state;
    case "REVOKE_DAPP":
      state = { ...state, connectedSites: state.connectedSites.filter((site) => site.origin !== message.origin) };
      return state;
    case "REJECT_DAPP":
      state = {
        ...state,
        pendingConnections: state.pendingConnections.filter(
          (request) => !(request.origin === message.origin && request.walletId === state.activeWalletId)
        )
      };
      return state;
    case "APPROVE_SIGNATURE":
    case "REJECT_SIGNATURE":
      state = { ...state, pendingSignatures: state.pendingSignatures.filter((request) => request.id !== message.id) };
      return state;
    case "SEND":
      state = {
        ...state,
        transactions: [
          {
            id: "tx-sent",
            walletId: message.request.walletId,
            chain: message.request.chain,
            asset: message.request.asset,
            from: "0x0000000000000000000000000000000000000000",
            to: message.request.to,
            amount: message.request.amount,
            status: "pending",
            txHash: "0xsent",
            createdAt: "2026-01-01T00:04:00.000Z",
            updatedAt: "2026-01-01T00:04:00.000Z"
          },
          ...state.transactions
        ]
      };
      return state;
    default:
      return state;
  }
}

function emptyState(): PopupState {
  return {
    locked: true,
    hasVault: false,
    wallets: [],
    accounts: [],
    balances: [],
    transactions: [],
    connectedSites: [],
    pendingConnections: [],
    pendingSignatures: [],
    pendingTransactions: []
  };
}

function unlockedState(accountCount: number, withPending = false): PopupState {
  const walletId = "wallet-1";
  return {
    locked: false,
    hasVault: true,
    wallets: [{ id: walletId, name: "Smoke wallet", createdAt: "2026-01-01T00:00:00.000Z", accountCount }],
    activeWalletId: walletId,
    sessionExpiresAt: "2026-01-01T00:10:00.000Z",
    accounts: accounts(walletId, accountCount),
    balances: [],
    transactions: transactions(walletId),
    connectedSites: [],
    pendingConnections: withPending ? [{ origin: "https://dapp.example", walletId: "wallet-1", requestedAt: "2026-01-01T00:02:00.000Z" }] : [],
    pendingSignatures: withPending ? [{
      id: "sig-1",
      origin: "https://dapp.example",
      walletId,
      accountIndex: 0,
      kind: "personal_sign",
      message: "Sign in to WDK demo",
      displayMessage: "Sign in to WDK demo",
      messageEncoding: "utf8",
      messageByteLength: 19,
      requestedAt: "2026-01-01T00:02:30.000Z"
    }] : [],
    pendingTransactions: []
  };
}

function accounts(walletId: string, accountCount: number): AccountRecord[] {
  const records: AccountRecord[] = [];
  for (let index = 0; index < accountCount; index += 1) {
    records.push({ walletId, chain: "bitcoin", index, address: `bc1qsmoke${index}`, path: `m/84'/0'/0'/0/${index}` });
    records.push({ walletId, chain: "ethereum", index, address: `0x000000000000000000000000000000000000000${index}`, path: `m/44'/60'/0'/0/${index}` });
  }
  return records;
}

function transactions(walletId: string): TransactionRecord[] {
  return [
    {
      id: "tx-pending",
      walletId,
      chain: "ethereum",
      asset: "ETH",
      from: "0x0000000000000000000000000000000000000000",
      to: "0x0000000000000000000000000000000000000001",
      amount: "1",
      status: "pending",
      txHash: "0xpending",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    },
    {
      id: "tx-confirmed",
      walletId,
      chain: "bitcoin",
      asset: "BTC",
      from: "bc1qfrom",
      to: "bc1qto",
      amount: "2",
      status: "confirmed",
      txHash: "0xconfirmed",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:01:00.000Z"
    }
  ];
}
