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
import type { AccountRecord, DappConnection, DappConnectionRequest, PopupState } from "../lib/types";

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
const walletId = "wallet-1";
const pendingOrigin = "https://pending.example";
const connectedOrigin = "https://connected.example";

let container: HTMLDivElement;
let root: Root | undefined;
let state: PopupState;
let ui: ReturnType<typeof createUiTestHarness>;

beforeEach(() => {
  state = unlockedState();
  mockedSendMessage.mockImplementation(async (message: BackgroundMessage) => handleMessage(message));
  container = document.createElement("div");
  document.body.appendChild(container);
  ui = createUiTestHarness(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
  vi.clearAllMocks();
});

describe("Sites popup view", () => {
  it("approves a pending dApp connection and shows it as connected", async () => {
    state = unlockedState({ pendingConnections: [connectionRequest(pendingOrigin)] });

    await renderApprovalView();

    expect(ui.pageText()).toContain(pendingOrigin);
    expect(ui.pageText()).toContain("Accounts to share");
    expect(ui.pageText()).toContain("Review this request carefully");

    await ui.clickTitle("Approve site");

    await waitFor(() => !container.querySelector(".connection-request-card"));
    await ui.clickButton("Sites");
    await ui.waitForText("No pending site requests.");
    expect(ui.pageText()).toContain(pendingOrigin);
    expect(ui.pageText()).toContain("Account 1 - Chain 1");
    expect(ui.pageText()).not.toContain("No connected sites.");
    expect(mockedSendMessage).toHaveBeenCalledWith({
      type: "APPROVE_DAPP",
      origin: pendingOrigin,
      accountIndex: 0,
      accountIndexes: [0]
    });
  });

  it("shares multiple checked accounts and lists them on the connected site", async () => {
    state = unlockedState({ pendingConnections: [connectionRequest(pendingOrigin)] });

    await renderApprovalView();

    // Account 1 is checked by default; also share Account 2.
    await ui.setCheckbox("Account 2", true);
    await ui.clickTitle("Approve site");

    expect(mockedSendMessage).toHaveBeenCalledWith({
      type: "APPROVE_DAPP",
      origin: pendingOrigin,
      accountIndex: 0,
      accountIndexes: [0, 1]
    });

    await waitFor(() => !container.querySelector(".connection-request-card"));
    await ui.clickButton("Sites");
    await ui.waitForText("No pending site requests.");
    expect(ui.pageText()).toContain("Account 1, Account 2 - Chain 1");
  });

  it("rejects a pending dApp connection and removes the visible request", async () => {
    state = unlockedState({ pendingConnections: [connectionRequest(pendingOrigin)] });

    await renderApprovalView();
    await ui.clickTitle("Reject site");

    await waitFor(() => !container.querySelector(".connection-request-card"));
    await ui.clickButton("Sites");
    await ui.waitForText("No pending site requests.");
    expect(ui.pageText()).toContain("No connected sites.");
    expect(ui.pageText()).not.toContain(pendingOrigin);
    expect(mockedSendMessage).toHaveBeenCalledWith({ type: "REJECT_DAPP", origin: pendingOrigin });
  });

  it("revokes an already connected site and removes it from the Sites view", async () => {
    state = unlockedState({ connectedSites: [connectedSite(connectedOrigin, 1, 137)] });

    await renderSitesView();

    expect(ui.pageText()).toContain(connectedOrigin);
    expect(ui.pageText()).toContain("Account 2 - Chain 137");

    await ui.clickTitle("Disconnect site");

    await ui.waitForText("No connected sites.");
    expect(ui.pageText()).not.toContain(connectedOrigin);
    expect(mockedSendMessage).toHaveBeenCalledWith({ type: "REVOKE_DAPP", origin: connectedOrigin });
  });
});

async function handleMessage(message: BackgroundMessage): Promise<PopupState | PopupState["balances"]> {
  switch (message.type) {
    case "GET_STATE":
    case "GET_STATE_SUMMARY":
      return state;
    case "GET_BALANCES":
      return state.balances;
    case "APPROVE_DAPP":
      state = {
        ...state,
        pendingConnections: withoutPendingConnection(message.origin),
        connectedSites: [
          ...state.connectedSites.filter((site) => !(site.origin === message.origin && site.walletId === walletId)),
          connectedSite(message.origin, message.accountIndex, 1, message.accountIndexes)
        ]
      };
      return state;
    case "REJECT_DAPP":
      state = { ...state, pendingConnections: withoutPendingConnection(message.origin) };
      return state;
    case "REVOKE_DAPP":
      state = {
        ...state,
        connectedSites: state.connectedSites.filter((site) => !(site.origin === message.origin && site.walletId === walletId))
      };
      return state;
    default:
      throw new Error(`Unexpected background message in Sites view test: ${message.type}`);
  }
}

function withoutPendingConnection(origin: string): DappConnectionRequest[] {
  return state.pendingConnections.filter((request) => !(request.origin === origin && request.walletId === walletId));
}

function unlockedState(overrides: Partial<PopupState> = {}): PopupState {
  return {
    locked: false,
    hasVault: true,
    wallets: [{ id: walletId, name: "Sites wallet", createdAt: "2026-05-31T00:00:00.000Z", accountCount: 2 }],
    activeWalletId: walletId,
    sessionExpiresAt: "2026-05-31T00:10:00.000Z",
    accounts: accounts(),
    balances: [],
    transactions: [],
    connectedSites: [],
    pendingConnections: [],
    pendingSignatures: [],
    pendingTransactions: [],
    ...overrides
  };
}

function accounts(): AccountRecord[] {
  return [
    { walletId, chain: "bitcoin", index: 0, address: "bc1qsites0", path: "m/84'/0'/0'/0/0" },
    { walletId, chain: "ethereum", index: 0, address: "0x0000000000000000000000000000000000000000", path: "m/44'/60'/0'/0/0" },
    { walletId, chain: "bitcoin", index: 1, address: "bc1qsites1", path: "m/84'/0'/0'/0/1" },
    { walletId, chain: "ethereum", index: 1, address: "0x0000000000000000000000000000000000000001", path: "m/44'/60'/0'/0/1" }
  ];
}

function connectionRequest(origin: string): DappConnectionRequest {
  return { origin, walletId, requestedAt: "2026-05-31T00:01:00.000Z" };
}

function connectedSite(origin: string, accountIndex: number, evmChainId: number, accountIndexes?: number[]): DappConnection {
  return {
    origin,
    walletId,
    accountIndex,
    accountIndexes,
    evmChainId,
    connectedAt: "2026-05-31T00:02:00.000Z",
    lastUsedAt: "2026-05-31T00:03:00.000Z"
  };
}

async function renderSitesView() {
  await act(async () => {
    root = createRoot(container);
    root.render(<App />);
  });
  await ui.waitForText("Sites wallet");
  await ui.clickButton("Sites");
  await waitFor(() => (
    ui.pageText().includes("Pending requests") || ui.pageText().includes("Review this request carefully")
  ));
}

// Pending requests now render the focused ApprovalView directly (no tab nav).
async function renderApprovalView() {
  await act(async () => {
    root = createRoot(container);
    root.render(<App />);
  });
  await ui.waitForText("Review this request carefully");
}
