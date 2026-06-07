/**
 * @vitest-environment jsdom
 */
import { useState } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BackgroundMessage } from "../../lib/background/messages";
import type { PopupState, PopupSummaryState, SendRequest, TransactionRecord } from "../../lib/types";
import { sendMessage } from "../api";
import { createUiTestHarness, waitFor } from "../test-utils";
import { SendPanel } from "./SendPanel";

vi.mock("../api", async () => {
  const { createWalletClient } = await import("../../sdk");
  const sendMessage = vi.fn();
  return { sendMessage, walletClient: createWalletClient(sendMessage) };
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockedSendMessage = vi.mocked(sendMessage);
const recipient = "0x0000000000000000000000000000000000000001";

let container: HTMLDivElement;
let root: Root;
let ui: ReturnType<typeof createUiTestHarness>;

beforeEach(() => {
  mockedSendMessage.mockImplementation(async (message: BackgroundMessage) => {
    if (message.type === "TAKE_QR_SCAN") return null; // SendPanel checks for a scanned address on mount
    throw new Error("Unexpected send message");
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  ui = createUiTestHarness(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe("SendPanel", () => {
  it("renders send details in review and cancels back without sending", async () => {
    await renderSendPanel();

    await ui.setField("Recipient", recipient);
    await ui.setField("Amount", "0.25");
    await ui.clickButton("Review send");

    const review = reviewPanel();
    expect(review.textContent).toContain("Confirm send");
    expect(review.textContent).toContain("Network");
    expect(review.textContent).toContain("Ethereum");
    expect(review.textContent).toContain("Asset");
    expect(review.textContent).toContain("ETH");
    expect(review.textContent).toContain("From");
    expect(review.textContent).toContain("0x1234...5678");
    expect(review.textContent).toContain("To");
    expect(review.textContent).toContain("0x0000...0001");
    expect(review.textContent).toContain("Amount");
    expect(review.textContent).toContain("0.25");

    await ui.clickButton("Cancel");

    expect(container.querySelector(".review-panel")).toBeNull();
    expect(ui.buttonByText("Review send").disabled).toBe(false);
    expect(mockedSendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "SEND" }));
  });

  it("confirms send and applies the returned transaction state", async () => {
    mockedSendMessage.mockImplementation(async (message: BackgroundMessage) => {
      if (message.type === "TAKE_QR_SCAN") return null;
      if (message.type !== "SEND") throw new Error(`Unexpected message: ${message.type}`);
      return stateWithSubmittedTransaction(baseState(), message.request);
    });

    await renderSendPanel();
    await ui.setField("Recipient", recipient);
    await ui.setField("Amount", "0.25");
    await ui.clickButton("Review send");
    await ui.clickButton("Confirm send");

    await waitFor(() => mockedSendMessage.mock.calls.some(([message]) => message.type === "SEND"));
    expect(mockedSendMessage).toHaveBeenCalledWith({
      type: "SEND",
      request: {
        walletId: "wallet-1",
        chain: "ethereum",
        asset: "ETH",
        accountIndex: 0,
        to: recipient,
        amount: "0.25"
      }
    });
    await ui.waitForText("0xsent");

    expect(container.querySelector(".review-panel")).toBeNull();
    expect(ui.fieldByLabel("Recipient").value).toBe("");
    expect(ui.fieldByLabel("Amount").value).toBe("");
  });
});

async function renderSendPanel(initialState = baseState()) {
  await act(async () => {
    root = createRoot(container);
    root.render(<SendPanelHarness initialState={initialState} />);
  });
}

function SendPanelHarness({ initialState }: { initialState: PopupState }) {
  const [state, setState] = useState(initialState);

  async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
    return action();
  }

  function applyState(next: PopupSummaryState | PopupState) {
    setState((previous) => ("balances" in next ? next : { ...next, balances: previous.balances }));
  }

  return (
    <>
      <SendPanel state={state} busy={false} run={run} onState={applyState} />
      <output>{state.transactions.map((transaction) => transaction.txHash).join(",") || "No transactions"}</output>
    </>
  );
}

function baseState(): PopupState {
  return {
    locked: false,
    hasVault: true,
    wallets: [{ id: "wallet-1", name: "Test wallet", createdAt: "2026-01-01T00:00:00.000Z", accountCount: 1 }],
    activeWalletId: "wallet-1",
    sessionExpiresAt: "2026-01-01T00:10:00.000Z",
    accounts: [
      {
        walletId: "wallet-1",
        chain: "ethereum",
        index: 0,
        address: "0x1234567890abcdef1234567890abcdef12345678",
        path: "m/44'/60'/0'/0/0"
      }
    ],
    balances: [],
    transactions: [],
    connectedSites: [],
    pendingConnections: [],
    pendingSignatures: [],
    pendingTransactions: []
  };
}

function stateWithSubmittedTransaction(state: PopupState, request: SendRequest): PopupState {
  return {
    ...state,
    transactions: [submittedTransaction(request), ...state.transactions]
  };
}

function submittedTransaction(request: SendRequest): TransactionRecord {
  return {
    id: "tx-sent",
    walletId: request.walletId,
    chain: request.chain,
    asset: request.asset,
    from: "0x1234567890abcdef1234567890abcdef12345678",
    to: request.to,
    amount: request.amount,
    status: "pending",
    txHash: "0xsent",
    createdAt: "2026-01-01T00:01:00.000Z",
    updatedAt: "2026-01-01T00:01:00.000Z"
  };
}

function reviewPanel(): HTMLDivElement {
  const panel = container.querySelector(".review-panel");
  if (!(panel instanceof HTMLDivElement)) throw new Error("Review panel not found");
  return panel;
}
